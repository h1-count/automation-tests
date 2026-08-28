/**
 * 需求事实预提取（requirement-facts-v1）。
 *
 * 对受控来源的指定行区间做行级确定性抽取：上限/下限、必填、格式、分页/排序、
 * 枚举、状态类候选事实——每条为「行号 + 类别 + 原文逐字引用」，零推理。
 * 生成阶段的主 Agent 从转录者变为校对者：边界候选表兜底红线 6（规则边界完整性）。
 *
 * 行覆盖闭包审计复用 reviewReadingMap 的区间运算：scope 内未被 RULE 引用的
 * 间隙区间连同其中的非空内容行一并报告，漏覆盖从「信任模型读全了」变成机判。
 * 本模块只做纯计算，不触 IO。
 */

export const REQUIREMENT_FACTS_SCHEMA_VERSION = "requirement-facts-v1";

export type FactCategory = "limit" | "required" | "format" | "listRule" | "enum" | "state";

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  limit: "上限/下限/数量",
  required: "必填/必传",
  format: "格式/长度",
  listRule: "分页/排序/条数",
  enum: "枚举/选项",
  state: "状态/流转"
};

const CATEGORY_PATTERNS: Record<FactCategory, RegExp> = {
  limit: /(不超过|最多|至少|不少于|上限|下限|之内|超过\s*\d|\d+\s*(?:字|条|次|个以内|分钟|天|小时|秒))/,
  required: /(必填|必选|必须填写|必须输入|必须选择|需要输入|不能为空|必传)/,
  format: /(yyyy|hh:mm|格式为|格式：|11\s*位|手机号码|邮箱格式|正则)/,
  listRule: /(每页|分页|倒序|正序|按.{0,6}排序|总审核数|总.{0,4}数|条数|翻页)/,
  enum: /(分为|分成|两类|两种|三类|三个|下拉|单选|多选|复选|枚举|选项有|\b[A-Za-z][A-Za-z0-9]*Enum\b|\benum\s+[A-Za-z][A-Za-z0-9]*)/,
  state: /(待审核|已通过|未通过|已驳回|状态为|注册状态|审核状态)/
};

export type RequirementFact = {
  line: number;
  category: FactCategory;
  quote: string;
  truncated: boolean;
};

/** 单行文本中的句子级切分（句号/分号/逗号），保留命中关键词的句子。 */
function sentencesOf(line: string): string[] {
  return line
    .split(/[。；;，,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const MAX_QUOTE_LENGTH = 160;

function clipQuote(sentence: string, pattern: RegExp): { quote: string; truncated: boolean } {
  if (sentence.length <= MAX_QUOTE_LENGTH) {
    return { quote: sentence, truncated: false };
  }
  const match = pattern.exec(sentence);
  const center = match ? match.index + Math.floor(match[0].length / 2) : Math.floor(sentence.length / 2);
  const start = Math.max(0, center - 80);
  const end = Math.min(sentence.length, center + 80);
  return {
    quote: `${start > 0 ? "…" : ""}${sentence.slice(start, end)}${end < sentence.length ? "…" : ""}`,
    truncated: true
  };
}

/** 对给定文本行（1-based 行号对应）与行区间做确定性事实抽取。 */
export function extractRequirementFacts(lines: string[], ranges: Array<{ start: number; end: number }>): RequirementFact[] {
  const facts: RequirementFact[] = [];
  const inRange = (lineNo: number): boolean =>
    ranges.length === 0 || ranges.some((range) => lineNo >= range.start && lineNo <= range.end);
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    if (!inRange(lineNo)) return;
    const text = raw.trim();
    if (!text || text.startsWith("#") || /^\|[\s:-]+\|?$/.test(text)) return;
    const hit = new Map<FactCategory, { quote: string; truncated: boolean }>();
    for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS) as Array<[FactCategory, RegExp]>) {
      if (!pattern.test(text)) continue;
      const sentence = sentencesOf(text).find((part) => pattern.test(part)) ?? text;
      if (!hit.has(category)) {
        hit.set(category, clipQuote(sentence, pattern));
      }
    }
    for (const [category, clipped] of hit) {
      facts.push({ line: lineNo, category, ...clipped });
    }
  });
  return facts.sort((left, right) => left.line - right.line || left.category.localeCompare(right.category));
}

export type GapReport = {
  ranges: Array<{ start: number; end: number }>;
  contentLines: Array<{ line: number; text: string }>;
};

/** 间隙区间内的非空内容行（标题/纯符号行除外），供覆盖闭包审计。 */
export function collectGapContentLines(
  lines: string[],
  gapRanges: Array<{ start: number; end: number }>
): GapReport {
  const contentLines: Array<{ line: number; text: string }> = [];
  for (const range of gapRanges) {
    for (let lineNo = range.start; lineNo <= range.end; lineNo += 1) {
      const text = (lines[lineNo - 1] ?? "").trim();
      // 标题行保留：间隙里的章节标题正是漏覆盖的直接信号；仅滤空行与表格分隔线。
      if (!text || /^[-*|:\s—─]+$/.test(text)) continue;
      contentLines.push({ line: lineNo, text: text.length > 120 ? `${text.slice(0, 120)}…` : text });
    }
  }
  return { ranges: gapRanges, contentLines };
}

export function renderFactsReport(input: {
  srcId: string;
  label: string;
  scopeRanges: Array<{ start: number; end: number }>;
  facts: RequirementFact[];
  gap: GapReport;
  categories?: FactCategory[];
}): string {
  const lines: string[] = [];
  const categories = input.categories && input.categories.length > 0
    ? new Set(input.categories)
    : undefined;
  const facts = input.facts.filter((fact) => !categories || categories.has(fact.category));
  lines.push(`### ${input.srcId} ${input.label}`, "");
  lines.push(`> 口径版本：${REQUIREMENT_FACTS_SCHEMA_VERSION}。候选表为原文逐字引用（零推理），生成阶段逐条校对：已建模 → 对应 RULE；未建模 → 登记歧义或排除。`, "");
  lines.push("#### 候选事实", "");
  lines.push("| 行 | 类别 | 原文引用 |", "| --- | --- | --- |");
  if (facts.length === 0) {
    lines.push("| 无 | — | — |");
  }
  for (const fact of facts) {
    lines.push(`| ${fact.line} | ${FACT_CATEGORY_LABELS[fact.category]} | ${fact.quote.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "#### 覆盖闭包（scope 内未被 RULE 引用的区间）", "");
  if (input.gap.ranges.length === 0) {
    lines.push("- 无间隙：scope 行区间全部被 RULE 引用覆盖。");
  } else {
    const rangeText = input.gap.ranges
      .map((range) => (range.start === range.end ? `行 ${range.start}` : `行 ${range.start}-${range.end}`))
      .join("、");
    lines.push(`- 间隙区间：${rangeText}`);
    if (input.gap.contentLines.length === 0) {
      lines.push("- 间隙内无实质内容行（标题/空行/表格分隔线），无需登记。");
    } else {
      lines.push("- 间隙内的内容行必须在 design.md 需求索引「适用性」或「缺口与风险」显式登记（不适用/排除/语义登记），未登记即漏覆盖：");
      for (const item of input.gap.contentLines) {
        lines.push(`  - 行 ${item.line}：${item.text.replace(/\|/g, "\\|")}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}
