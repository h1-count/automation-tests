/**
 * reviewer 定向读取图（review-reading-map-v1）。
 *
 * 从套件 design.md 的「请求内来源」与「规则设计台账」确定性推导 reviewer 的
 * 定向读取范围：必读行区间并集、交叉对照配对（引用区间重叠/相邻的 RULE 对）、
 * 可选抽查区间（scope 内未被引用的间隙）。
 *
 * 本模块只做纯计算，不触 IO；文件读取与输出在 scripts/build-review-reading-map.ts。
 * 输出只是读取指导，不改变评审快照契约（reviewer 输入文件集与冻结 digest 不变）。
 */

export const REVIEW_READING_MAP_SCHEMA_VERSION = "review-reading-map-v1";

export type LineRange = { start: number; end: number };

export type SourceRegistration = {
  srcId: string;
  label: string;
  relativePath: string;
  scopeRanges: LineRange[];
};

export type RuleRef = {
  ruleId: string;
  reqIds: string[];
  refs: Array<{ srcId: string; ranges: LineRange[] }>;
};

export type CrossCheckPair = {
  left: string;
  right: string;
  srcId: string;
  /** 两侧引用区间并集：交叉对照时两侧都要读。 */
  ranges: LineRange[];
};

export type SourceReadingMap = {
  srcId: string;
  label: string;
  relativePath: string;
  scopeRanges: LineRange[];
  mustReadRanges: LineRange[];
  optionalGapRanges: LineRange[];
  citingRules: string[];
};

export type ReadingMap = {
  sources: SourceReadingMap[];
  crossCheckPairs: CrossCheckPair[];
  uncoveredReqWarnings: string[];
  selectedRuleIds?: string[];
};

/** 解析 `行 12`、`行 12-15`、`行 12、15-18` 形式的行引用；返回升序去重区间。 */
export function parseLineRefs(text: string): LineRange[] {
  const ranges: LineRange[] = [];
  // 「行 124、132-140」中后续裸数字（顿号/逗号后）补回「行」前缀再统一匹配。
  const normalized = text.replace(/([、,，])\s*(?=\d)/g, "$1行 ");
  const pattern = /行\s*(\d+)(?:\s*[-–]\s*(\d+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      ranges.push({ start, end });
    }
  }
  return normalizeRanges(ranges);
}

export function normalizeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: LineRange[] = [{ ...sorted[0]! }];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function unionRanges(a: LineRange[], b: LineRange[]): LineRange[] {
  return normalizeRanges([...a, ...b]);
}

export function subtractRanges(from: LineRange[], remove: LineRange[]): LineRange[] {
  const result: LineRange[] = [];
  const sortedRemove = normalizeRanges(remove);
  for (const range of normalizeRanges(from)) {
    let cursor = range.start;
    for (const cut of sortedRemove) {
      if (cut.end < cursor || cut.start > range.end) continue;
      if (cut.start > cursor) {
        result.push({ start: cursor, end: Math.min(cut.start - 1, range.end) });
      }
      cursor = Math.max(cursor, cut.end + 1);
      if (cursor > range.end) break;
    }
    if (cursor <= range.end) {
      result.push({ start: cursor, end: range.end });
    }
  }
  return result;
}

export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** 相邻阈值：引用区间端点距离不超过该行数视为同段交叉对照候选。 */
export const CROSS_CHECK_ADJACENCY_LINES = 3;

export function rangesCrossCheck(a: LineRange, b: LineRange): boolean {
  if (rangesOverlap(a, b)) return true;
  return Math.min(Math.abs(a.start - b.end), Math.abs(b.start - a.end)) <= CROSS_CHECK_ADJACENCY_LINES;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDataRow(line: string): boolean {
  return line.trim().startsWith("|") && !/^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?$/.test(line.trim());
}

/** 解析 design.md「请求内来源」表：SRC id、显示名、相对链接、scope 行区间。 */
export function parseSourceRegistrations(designMd: string): SourceRegistration[] {
  const sources: SourceRegistration[] = [];
  let inSection = false;
  for (const line of designMd.split("\n")) {
    const heading = line.trim();
    if (heading.startsWith("## ")) {
      inSection = heading.includes("来源");
      continue;
    }
    if (!inSection || !isTableDataRow(line)) continue;
    const cells = splitTableRow(line);
    const srcId = cells[0] ?? "";
    const locator = cells[1] ?? "";
    if (!/^SRC-[A-Z0-9-]+$/i.test(srcId)) continue;
    const linkMatch = locator.match(/\[([^\]]+)\]\(([^)]+)\)/);
    sources.push({
      srcId,
      label: linkMatch?.[1] ?? locator.slice(0, 40),
      relativePath: linkMatch?.[2] ?? "",
      scopeRanges: parseLineRefs(locator)
    });
  }
  return sources;
}

/** 解析 design.md「规则设计台账」表：RULE、REQ 列表与 sourceRef 行引用。 */
export function parseRuleSourceRefs(designMd: string): RuleRef[] {
  const rules: RuleRef[] = [];
  let inSection = false;
  for (const line of designMd.split("\n")) {
    const heading = line.trim();
    if (heading.startsWith("## ")) {
      inSection = heading.includes("规则设计台账");
      continue;
    }
    if (!inSection || !isTableDataRow(line)) continue;
    const cells = splitTableRow(line);
    const ruleId = cells[0] ?? "";
    const reqCell = cells[1] ?? "";
    const sourceRef = cells[2] ?? "";
    if (!/^RULE-[A-Z0-9-]+$/i.test(ruleId)) continue;
    const refs: Array<{ srcId: string; ranges: LineRange[] }> = [];
    const seen = new Set<string>();
    const srcPattern = /(SRC-[A-Z0-9-]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = srcPattern.exec(sourceRef)) !== null) {
      const srcId = match[1]!;
      if (seen.has(srcId)) continue;
      seen.add(srcId);
      const after = sourceRef.slice(match.index + match[0].length);
      const stop = after.search(/SRC-[A-Z0-9-]+/i);
      const segment = stop >= 0 ? after.slice(0, stop) : after;
      refs.push({ srcId, ranges: parseLineRefs(segment) });
    }
    rules.push({
      ruleId,
      reqIds: reqCell.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
      refs
    });
  }
  return rules;
}

/** 解析「需求索引」表的 REQ 行引用，用于覆盖审计预警。 */
export function parseReqSourceRefs(designMd: string): Array<{ reqId: string; refs: Array<{ srcId: string; ranges: LineRange[] }> }> {
  const reqs: Array<{ reqId: string; refs: Array<{ srcId: string; ranges: LineRange[] }> }> = [];
  let inSection = false;
  for (const line of designMd.split("\n")) {
    const heading = line.trim();
    if (heading.startsWith("## ")) {
      inSection = heading.includes("需求索引");
      continue;
    }
    if (!inSection || !isTableDataRow(line)) continue;
    const cells = splitTableRow(line);
    const reqId = cells[0] ?? "";
    const sourceRef = cells[1] ?? "";
    if (!/^REQ-[A-Z0-9-]+$/i.test(reqId)) continue;
    const refs: Array<{ srcId: string; ranges: LineRange[] }> = [];
    const segment = sourceRef.split("；").filter((part) => /SRC-/i.test(part))[0] ?? sourceRef;
    const srcMatch = segment.match(/SRC-[A-Z0-9-]+/i);
    if (srcMatch) {
      refs.push({ srcId: srcMatch[0]!, ranges: parseLineRefs(segment) });
    }
    reqs.push({ reqId, refs });
  }
  return reqs;
}

export function buildReadingMap(input: {
  sources: SourceRegistration[];
  rules: RuleRef[];
  reqs?: Array<{ reqId: string; refs: Array<{ srcId: string; ranges: LineRange[] }> }>;
  onlyRuleIds?: string[];
}): ReadingMap {
  const selected = input.onlyRuleIds && input.onlyRuleIds.length > 0
    ? new Set(input.onlyRuleIds)
    : undefined;
  const activeRules = selected ? input.rules.filter((rule) => selected.has(rule.ruleId)) : input.rules;

  const crossCheckPairs: CrossCheckPair[] = [];
  for (let i = 0; i < activeRules.length; i += 1) {
    for (let j = i + 1; j < activeRules.length; j += 1) {
      const left = activeRules[i]!;
      const right = activeRules[j]!;
      for (const leftRef of left.refs) {
        for (const rightRef of right.refs) {
          if (leftRef.srcId !== rightRef.srcId) continue;
          if (leftRef.ranges.some((leftRange) => rightRef.ranges.some((rightRange) => rangesCrossCheck(leftRange, rightRange)))) {
            crossCheckPairs.push({
              left: left.ruleId,
              right: right.ruleId,
              srcId: leftRef.srcId,
              ranges: normalizeRanges([...leftRef.ranges, ...rightRef.ranges])
            });
          }
        }
      }
    }
  }

  const sourceMaps: SourceReadingMap[] = input.sources.map((source) => {
    const citingRules = activeRules
      .filter((rule) => rule.refs.some((ref) => ref.srcId === source.srcId))
      .map((rule) => rule.ruleId);
    const mustReadRanges = citingRules.length === 0
      ? []
      : normalizeRanges(
          activeRules.flatMap((rule) =>
            rule.refs.filter((ref) => ref.srcId === source.srcId).flatMap((ref) => ref.ranges)
          )
        );
    const scope = source.scopeRanges.length > 0 ? source.scopeRanges : mustReadRanges;
    return {
      srcId: source.srcId,
      label: source.label,
      relativePath: source.relativePath,
      scopeRanges: scope,
      mustReadRanges,
      optionalGapRanges: subtractRanges(scope, mustReadRanges),
      citingRules
    };
  });

  const uncoveredReqWarnings: string[] = [];
  for (const req of input.reqs ?? []) {
    for (const ref of req.refs) {
      const covered = activeRules.some((rule) =>
        rule.refs.some((ruleRef) =>
          ruleRef.srcId === ref.srcId
          && ref.ranges.some((range) => ruleRef.ranges.some((ruleRange) => rangesOverlap(range, ruleRange)))
        )
      );
      if (!covered && ref.ranges.length > 0) {
        uncoveredReqWarnings.push(
          `${req.reqId} 引用 ${ref.srcId} 行 ${formatRanges(ref.ranges)} 未被任何入选 RULE 引用重叠，需确认语义登记或补录。`
        );
      }
    }
  }

  return {
    sources: sourceMaps,
    crossCheckPairs,
    uncoveredReqWarnings,
    selectedRuleIds: input.onlyRuleIds
  };
}

export function formatRanges(ranges: LineRange[]): string {
  return ranges.map((range) => range.start === range.end ? `行 ${range.start}` : `行 ${range.start}-${range.end}`).join("、");
}

export function renderReadingMapMd(map: ReadingMap): string {
  const lines: string[] = [];
  lines.push("# reviewer 定向读取图", "");
  lines.push(`> 口径版本：${REVIEW_READING_MAP_SCHEMA_VERSION}。本图是读取指导，不改变评审输入快照；`);
  lines.push(`> 与资料矛盾、边界存疑或交叉对照需要时，必须回退读取来源全文（规范红线不可绕过）。`, "");
  if (map.selectedRuleIds && map.selectedRuleIds.length > 0) {
    lines.push(`> 定向模式：仅入选 RULE ${map.selectedRuleIds.join("、")}；未入选引用的相邻区间见交叉对照提示。`, "");
  }
  lines.push("## 必读区间（按来源）", "");
  lines.push("| 来源 | 定位 | 必读区间 | 引用 RULE | 可选抽查区间（scope 内未引用） |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const source of map.sources) {
    lines.push(`| ${source.srcId} | ${source.label} | ${formatRanges(source.mustReadRanges) || "—"} | ${source.citingRules.join("、") || "—"} | ${formatRanges(source.optionalGapRanges) || "—"} |`);
  }
  lines.push("", "## 交叉对照配对（引用区间重叠或相邻的 RULE 对，两侧必须一起读）", "");
  lines.push("| RULE 对 | 来源 | 对照区间（两侧并集） |", "| --- | --- | --- |");
  if (map.crossCheckPairs.length === 0) {
    lines.push("| 无 | — | — |");
  }
  for (const pair of map.crossCheckPairs) {
    lines.push(`| ${pair.left} ↔ ${pair.right} | ${pair.srcId} | ${formatRanges(pair.ranges)} |`);
  }
  if (map.uncoveredReqWarnings.length > 0) {
    lines.push("", "## 覆盖预警", "");
    for (const warning of map.uncoveredReqWarnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return lines.join("\n");
}
