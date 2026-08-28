import { canonicalJson } from "./canonicalJson.js";
import type {
  CallbackResolution,
  WorkflowProjection
} from "./types.js";
import {
  parseTestcaseDocument,
  TESTCASE_V6_LAYERED_MARKER
} from "../testcase/testcaseDocument.js";

export const PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION = "plan-confirmation-subject-v1";
export const CASE_CONFIRMATION_SUBJECT_SCHEMA_VERSION = "case-confirmation-subject-v1";

export function normalizeDecisionMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

function markdownSections(value: string): Array<{ heading: string; body: string }> {
  const source = normalizeDecisionMarkdown(value);
  const starts = [...source.matchAll(/^##\s+(.+?)\s*$/gm)];
  return starts.map((start, index) => {
    const from = start.index ?? 0;
    const to = starts[index + 1]?.index ?? source.length;
    return {
      heading: start[1]?.trim() ?? "",
      body: source.slice(from, to).trimEnd()
    };
  });
}

function removeMarkdownSubsection(
  value: string,
  level: number,
  heading: string
): string {
  const lines = value.split("\n");
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startPattern = new RegExp(`^#{${level}}\\s+${escapedHeading}\\s*$`);
  const boundaryPattern = new RegExp(`^#{1,${level}}\\s+`);
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start < 0) return value;
  const nextOffset = lines
    .slice(start + 1)
    .findIndex((line) => boundaryPattern.test(line));
  const end = nextOffset < 0 ? lines.length : start + 1 + nextOffset;
  lines.splice(start, end - start);
  return lines.join("\n");
}

export function markdownDecisionTableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  const content = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  let backslashRun = 0;
  for (const character of content) {
    if (character === "|" && backslashRun % 2 === 0) {
      cells.push(current.trim());
      current = "";
      backslashRun = 0;
      continue;
    }
    current += character;
    backslashRun = character === "\\" ? backslashRun + 1 : 0;
  }
  cells.push(current.trim());
  return cells;
}

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function markdownTables(value: string): MarkdownTable[] {
  const lines = value.split("\n");
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = markdownDecisionTableCells(lines[index]!);
    const separator = markdownDecisionTableCells(lines[index + 1]!);
    if (
      !headers
      || !separator
      || separator.length !== headers.length
      || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))
    ) continue;
    const rows: string[][] = [];
    let row = index + 2;
    for (; row < lines.length; row += 1) {
      const cells = markdownDecisionTableCells(lines[row]!);
      if (!cells || cells.length !== headers.length) break;
      rows.push(cells);
    }
    tables.push({ headers, rows });
    index = row - 1;
  }
  return tables;
}

function cleanPlanSubjectText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\\([|\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedBoundaryValue(value: string): string {
  return cleanPlanSubjectText(value)
    .replace(/[。；;，,\s]+$/g, "")
    .trim()
    .toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  );
}

function markdownSubsection(
  value: string,
  level: number,
  heading: string
): string | undefined {
  const lines = value.split("\n");
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startPattern = new RegExp(`^#{${level}}\\s+${escapedHeading}\\s*$`);
  const boundaryPattern = new RegExp(`^#{1,${level}}\\s+`);
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start < 0) return undefined;
  const nextOffset = lines
    .slice(start + 1)
    .findIndex((line) => boundaryPattern.test(line));
  const end = nextOffset < 0 ? lines.length : start + 1 + nextOffset;
  return lines.slice(start + 1, end).join("\n");
}

function listItems(value: string): string[] {
  return value.split("\n").flatMap((line) => {
    const match = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    return match?.[1] ? [match[1]] : [];
  });
}

function topLevelScopeItem(value: string): string {
  const cleaned = cleanPlanSubjectText(value);
  const detailBoundary = cleaned.search(/[:：;；]/);
  return normalizedBoundaryValue(
    detailBoundary < 0 ? cleaned : cleaned.slice(0, detailBoundary)
  );
}

function scopeItems(
  scope: string,
  kind: "包含" | "不包含"
): string[] {
  const subsection = markdownSubsection(scope, 3, kind);
  const fromList = subsection ? listItems(subsection) : [];
  const fromTables = markdownTables(scope).flatMap((table) => {
    const column = table.headers
      .map(cleanPlanSubjectText)
      .findIndex((header) => header === kind);
    return column < 0
      ? []
      : table.rows.map((row) => row[column] ?? "");
  });
  return uniqueSorted([...fromList, ...fromTables].map(topLevelScopeItem));
}

function keyValueField(value: string, key: string): string | undefined {
  for (const table of markdownTables(value)) {
    const normalizedHeaders = table.headers.map(cleanPlanSubjectText);
    if (
      normalizedHeaders.length !== 2
      || !["项目", "字段"].includes(normalizedHeaders[0] ?? "")
      || !["内容", "结论"].includes(normalizedHeaders[1] ?? "")
    ) continue;
    const row = table.rows.find((candidate) =>
      cleanPlanSubjectText(candidate[0] ?? "") === key
    );
    if (row) return cleanPlanSubjectText(row[1] ?? "");
  }
  return undefined;
}

function normalizedTestTypes(rawType: string | undefined, requestId: string | undefined): string[] {
  const source = `${rawType ?? ""} ${requestId?.split("/")[0] ?? ""}`.toLowerCase();
  const matches = [
    ["webview", /\bwebview\b|web\s*view/i],
    ["web", /\bweb\b/i],
    ["h5", /\bh5\b/i],
    ["app", /\bapp\b/i],
    ["api", /\bapi\b/i],
    ["mqtt", /\bmqtt\b/i],
    ["iot_chain", /\biot\b.{0,8}(链路|chain)/i]
  ] as const;
  const normalized = matches.flatMap(([name, pattern]) =>
    pattern.test(source) ? [name] : []
  );
  if (normalized.length) return uniqueSorted(normalized);
  return rawType ? [normalizedBoundaryValue(rawType)] : [];
}

function normalizedEnvironment(value: string | undefined): string {
  const source = normalizedBoundaryValue(value ?? "");
  const known = [
    ["prod", /(^|[^a-z])(prod|production)([^a-z]|$)|生产/],
    ["pre", /(^|[^a-z])(pre|staging)([^a-z]|$)|预发布/],
    ["test", /(^|[^a-z])test([^a-z]|$)|测试环境/],
    ["dev", /(^|[^a-z])dev([^a-z]|$)|开发环境/],
    ["local", /(^|[^a-z])local([^a-z]|$)|本地环境/]
  ] as const;
  return known.find(([, pattern]) => pattern.test(source))?.[0] ?? source;
}

function normalizedDataStrategy(value: string): string {
  const source = normalizedBoundaryValue(value);
  if (/no[_ -]?write|无写入|零写入|只读/.test(source)) return "no_write";
  if (/可清理/.test(source)) return "ephemeral_cleanup";
  if (/tracked[_ -]?residual|受控残留/.test(source)) return "tracked_residual";
  if (/受控写入|写入/.test(source)) return "controlled_write";
  return source;
}

function splitBoundaryValues(value: string): string[] {
  return uniqueSorted(
    cleanPlanSubjectText(value)
      .split(/\s*(?:、|,|，|\/|\+)\s*/)
      .map(normalizedBoundaryValue)
  );
}

function dataBoundaryRows(value: string): Array<{
  strategy: string;
  allowedEnvironments: string[];
  resourceTypes: string[];
}> {
  const dataSections = markdownSections(value).filter((section) =>
    ["测试数据策略与残留台账", "数据策略与安全边界"].includes(section.heading)
  );
  const rows = dataSections.flatMap((section) =>
    markdownTables(section.body).flatMap((table) => {
      const headers = table.headers.map(cleanPlanSubjectText);
      const strategyColumn = headers.indexOf("数据策略");
      if (strategyColumn < 0) return [];
      const environmentColumn = headers.indexOf("允许环境");
      const resourceColumn = headers.indexOf("资源类型");
      return table.rows.map((row) => ({
        strategy: normalizedDataStrategy(row[strategyColumn] ?? ""),
        allowedEnvironments: environmentColumn < 0
          ? []
          : uniqueSorted(
            splitBoundaryValues(row[environmentColumn] ?? "")
              .map((environment) => normalizedEnvironment(environment))
          ),
        resourceTypes: resourceColumn < 0
          ? []
          : splitBoundaryValues(row[resourceColumn] ?? "")
      }));
    })
  );
  return [...new Map(
    rows.map((row) => [canonicalJson(row), row])
  ).values()].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right))
  );
}

function categoricalBoundaries(value: string, scope: string): {
  sideEffects: string[];
  permissions: string[];
} {
  const relevantHeadings = new Set([
    "测试数据策略与残留台账",
    "数据策略与安全边界",
    "环境与数据预检",
    "风险与审核事项"
  ]);
  const boundarySections = markdownSections(value)
    .filter((section) => relevantHeadings.has(section.heading))
    .map((section) => section.body);
  const scopeLabels = [
    ...scopeItems(scope, "包含"),
    ...scopeItems(scope, "不包含")
  ];
  const source = cleanPlanSubjectText([...scopeLabels, ...boundarySections].join("\n"));
  const sideEffectRules = [
    ["business_write", /业务写入|外部副作用|受控写入|写入授权|提交|创建|更新|修改|删除/],
    ["file_upload", /上传|文件写入/],
    ["message_delivery", /短信|邮件|通知通道/],
    ["authentication", /登录认证|认证会话|oauth/],
    ["configuration_change", /配置变更|修改配置/],
    ["device_action", /设备动作|设备控制|控制硬件|刷固件|断网/]
  ] as const;
  const permissionRules = [
    ["security_challenge", /安全挑战|验证码|滑块|人机验证|oauth/],
    ["privileged_operation", /特权|权限申请|管理员操作|审批操作/],
    ["business_adjudication", /资料冲突|验收标准[^。\n]*(?:用户)?裁决|需要用户裁决/],
    ["production_access", /生产环境|production|\bprod\b/i],
    ["destructive_operation", /删除真实|批量操作|刷固件|断网/],
    ["device_control", /设备动作|设备控制|控制硬件|刷固件|断网/],
    ["sensitive_data", /真实用户|真实手机号|凭据|token|cookie|敏感/]
  ] as const;
  return {
    sideEffects: sideEffectRules.flatMap(([category, pattern]) =>
      pattern.test(source) ? [category] : []
    ),
    permissions: permissionRules.flatMap(([category, pattern]) =>
      pattern.test(source) ? [category] : []
    )
  };
}

/**
 * Projects only the user-owned plan boundary. Reviewer findings, REQ/RULE
 * detail, case identities, source metadata and execution-list detail are
 * intentionally absent so evidence-backed testcase evolution stays within the
 * accepted plan subject.
 */
export function planConfirmationSubjectProjection(value: string): string {
  const source = normalizeDecisionMarkdown(value);
  const firstSection = source.search(/^##\s+/m);
  const basicInformation = markdownSections(source)
    .find((section) => ["基本信息", "请求默认值"].includes(section.heading))?.body
    ?? (firstSection < 0 ? source : source.slice(0, firstSection));
  const requestId = keyValueField(basicInformation, "测试请求")
    ?? keyValueField(basicInformation, "计划编号");
  const scope = markdownSections(source)
    .find((section) => section.heading === "测试范围")?.body
    ?? "";
  const categorical = categoricalBoundaries(source, scope);
  const included = scopeItems(scope, "包含");
  const excluded = scopeItems(scope, "不包含");
  const ungroupedScopeItems = [...scope.matchAll(/^\s*-\s+(.+)$/gmu)]
    .map((match) => match[1]!.trim());
  return canonicalJson({
    schemaVersion: PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION,
    requestId: normalizedBoundaryValue(requestId ?? ""),
    businessScope: {
      included: included.length ? included : ungroupedScopeItems.filter((item) => !/^不包含/.test(item)),
      excluded: excluded.length ? excluded : ungroupedScopeItems.filter((item) => /^不包含/.test(item))
    },
    testTypes: normalizedTestTypes(
      keyValueField(basicInformation, "测试类型"),
      requestId
    ),
    targetEnvironment: normalizedEnvironment(
      keyValueField(basicInformation, "目标环境")
    ),
    dataBoundary: {
      policies: dataBoundaryRows(source),
      sideEffects: categorical.sideEffects
    },
    permissionBoundary: categorical.permissions
  });
}

function normalizeDerivedPlanTableCells(value: string): string {
  const lines = value.split("\n");
  const derivedHeaders = new Set(["派生 caseId", "实际原子用例编号"]);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = markdownDecisionTableCells(lines[index]!);
    const separator = markdownDecisionTableCells(lines[index + 1]!);
    if (
      !header
      || !separator
      || separator.length !== header.length
      || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))
    ) continue;
    const derivedColumns = header
      .map((cell, column) =>
        derivedHeaders.has(cell.replace(/^`|`$/g, "")) ? column : -1
      )
      .filter((column) => column >= 0);
    if (!derivedColumns.length) continue;
    for (let row = index + 2; row < lines.length; row += 1) {
      const cells = markdownDecisionTableCells(lines[row]!);
      if (!cells || cells.length !== header.length) break;
      for (const column of derivedColumns) cells[column] = "<derived>";
      lines[row] = `| ${cells.join(" | ")} |`;
    }
  }
  return lines.join("\n");
}

function normalizeRuleCaseAssociationForPlanSubject(value: string): string {
  const lines = value.split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = markdownDecisionTableCells(lines[index]!);
    const separator = markdownDecisionTableCells(lines[index + 1]!);
    if (
      !header
      || !separator
      || separator.length !== header.length
      || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))
    ) continue;
    const associationColumns = header
      .map((cell, column) => cell.replace(/^`|`$/g, "") === "关联 caseId" ? column : -1)
      .filter((column) => column >= 0);
    if (!associationColumns.length) continue;
    for (let row = index + 2; row < lines.length; row += 1) {
      const cells = markdownDecisionTableCells(lines[row]!);
      if (!cells || cells.length !== header.length) break;
      for (const column of associationColumns) cells[column] = "阶段二生成";
      lines[row] = `| ${cells.join(" | ")} |`;
    }
  }
  return lines.join("\n");
}

export function planDecisionProjection(value: string): string {
  const excluded = new Set([
    "正式用户决定",
    "任务执行清单",
    "用例集生成状态",
    "覆盖基准与拆分清单",
    "覆盖矩阵",
    "需求追溯矩阵",
    "规则覆盖台账",
    "规则设计矩阵",
    "规则邻域复核",
    "用例包目录",
    "变更影响分析",
    "多角色评审记录",
    "用例集评审与演进",
    "工程层：代码定位与自动化设计"
  ]);
  const source = normalizeDecisionMarkdown(value);
  const firstSection = source.search(/^##\s+/m);
  const preamble = firstSection < 0
    ? source.trimEnd()
    : firstSection > 0
      ? source.slice(0, firstSection).trimEnd()
      : "";
  const sections = markdownSections(source)
    .filter((section) => !excluded.has(section.heading))
    .map((section) => section.heading === "测试数据策略与残留台账"
      ? removeMarkdownSubsection(section.body, 3, "执行清单映射").trimEnd()
      : section.body);
  const projectionParts = [preamble, ...sections].filter(Boolean);
  const projected = `${projectionParts.join("\n\n")}\n`;
  return normalizeRuleCaseAssociationForPlanSubject(
    normalizeDerivedPlanTableCells(projected)
  ).replace(
    /^\|\s*状态\s*\|[^|\n]*\|\s*$/gm,
    "| 状态 | <derived> |"
  );
}

export function caseDecisionPlanProjection(value: string): string {
  const source = normalizeDecisionMarkdown(value);
  const excluded = new Set(["正式用户决定", "工程层：代码定位与自动化设计"]);
  const firstSection = source.search(/^##\s+/m);
  const preamble = firstSection < 0
    ? source.trimEnd()
    : firstSection > 0
      ? source.slice(0, firstSection).trimEnd()
      : "";
  const sections = markdownSections(source)
    .filter((section) => !excluded.has(section.heading))
    .map((section) => section.body);
  const projected = `${[preamble, ...sections].filter(Boolean).join("\n\n")}\n`;
  return projected.replace(
    /^\|\s*状态\s*\|[^|\n]*\|\s*$/gm,
    "| 状态 | <derived> |"
  );
}

export function casePackageDecisionProjection(value: string): string {
  return normalizeDecisionMarkdown(value).replace(
    /^\|\s*状态\s*\|[^|\n]*\|\s*$/gm,
    "| 状态 | <derived> |"
  );
}

export interface CaseConfirmationSemanticCase {
  caseId: string;
  semanticSummary: string;
  refs: string[];
}

/** Returns the complete semantic body for each testcase while excluding package
 * directories and any obsolete status/review backlinks. */
export function caseConfirmationSemanticCases(value: string): CaseConfirmationSemanticCase[] {
  const source = normalizeDecisionMarkdown(value);
  const document = parseTestcaseDocument(source);
  if (document.version === TESTCASE_V6_LAYERED_MARKER) {
    return document.cases.map((testcase) => {
      const semanticSummary = JSON.stringify({
        module: testcase.module,
        caseId: testcase.caseId,
        title: testcase.title,
        priority: testcase.priority,
        ruleIds: testcase.ruleIds,
        preconditions: testcase.preconditions,
        executionRows: testcase.executionRows,
        overrides: testcase.overrides
      });
      const refs = uniqueSorted(
        [...semanticSummary.matchAll(/\b(?:REQ|RULE|SRC|ISO)-[A-Z0-9][A-Z0-9-]*\b/g)]
          .map((match) => match[0]!)
      );
      return { caseId: testcase.caseId, semanticSummary, refs };
    });
  }
  throw new Error("Case confirmation only accepts testcase-v1-layered; unsupported formats cannot create a new confirmation.");
}

/** The frozen confirmation range is shared by the callback subject and the
 * review workbook; callers must not independently reimplement affected scope. */
export function selectCaseConfirmationSemanticCases<T extends CaseConfirmationSemanticCase>(input: {
  cases: T[];
  scope: "full" | "affected";
  affectedCaseIds?: string[];
}): T[] {
  const allIds = input.cases.map((testcase) => testcase.caseId);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("Case confirmation requires globally unique caseIds.");
  }
  const requested = input.scope === "affected"
    ? [...new Set(input.affectedCaseIds ?? [])].sort()
    : [...allIds].sort();
  const selected = input.cases
    .filter((testcase) => requested.includes(testcase.caseId))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const missing = requested.filter((caseId) => !selected.some((testcase) => testcase.caseId === caseId));
  if (!selected.length || missing.length) {
    throw new Error(`Case confirmation scope is incomplete${missing.length ? `: ${missing.join(", ")}` : "."}`);
  }
  return selected;
}

function filterAffectedDesignSection(body: string, refs: Set<string>): string {
  const [heading, ...lines] = body.split("\n");
  const kept = lines.filter((line) => {
    const found = [...line.matchAll(/\b(?:REQ|RULE|SRC|ISO|[A-Z][A-Z0-9]*)-[A-Z0-9][A-Z0-9-]*\b/g)]
      .map((match) => match[0]!);
    return found.some((ref) => refs.has(ref));
  });
  return [heading, ...kept].join("\n").trimEnd();
}

/** Case confirmation projection. Formal decisions, runtime state and
 * post-confirmation engineering mapping never participate in the subject. */
export function caseConfirmationPlanProjection(input: {
  plan: string;
  scope: "full" | "affected";
  caseIds: string[];
  refs: string[];
}): string {
  const source = normalizeDecisionMarkdown(input.plan);
  const globalHeadings = new Set([
    "基本信息",
    "测试范围",
    "环境、静态资产与数据安全边界",
    "环境与数据预检",
    "测试数据策略与残留台账"
  ]);
  const designHeadings = new Set([
    "资料来源",
    "需求索引",
    "规则设计台账",
    "用例包目录",
    "变更影响分析",
    "假设、缺口与风险",
    "假设/缺口/风险",
    "评审记录",
    "多角色评审记录",
    "用例集评审与演进"
  ]);
  const relevant = new Set([...input.caseIds, ...input.refs]);
  const firstSection = source.search(/^##\s+/m);
  const preamble = firstSection > 0 ? source.slice(0, firstSection).trimEnd() : "";
  const sections = markdownSections(source).flatMap((section) => {
    if (globalHeadings.has(section.heading)) return [section.body];
    if (!designHeadings.has(section.heading)) return [];
    if (input.scope === "full") return [section.body];
    const affected = filterAffectedDesignSection(section.body, relevant);
    return affected.split("\n").length > 1 ? [affected] : [];
  });
  return canonicalJson({
    schemaVersion: CASE_CONFIRMATION_SUBJECT_SCHEMA_VERSION,
    globalBoundary: planConfirmationSubjectProjection(source),
    design: normalizeDecisionMarkdown([preamble, ...sections].filter(Boolean).join("\n\n"))
  });
}

export function decisionTypeForActivity(activityId: string): string | undefined {
  return {
    "plan-confirmation": "计划确认",
    "case-confirmation": "用例确认",
    "execution-authorization": "执行清单确认",
    "case-review-conflict-decision": "业务裁决"
  }[activityId];
}

export function formalUserDecisionResolutions(
  plan: string,
  activityId: string,
  subjectDigest: string
): CallbackResolution[] {
  const decisionType = decisionTypeForActivity(activityId);
  if (!decisionType) return [];
  const section = markdownSections(plan)
    .find((candidate) => candidate.heading === "正式用户决定");
  if (!section) {
    throw new Error(
      `plan.md must record the ${decisionType} formal user decision before callback resolution.`
    );
  }
  const lines = section.body.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownDecisionTableCells(line);
    return cells?.includes("决定类型")
      && cells.includes("subjectDigest")
      && cells.includes("正式决定");
  });
  if (headerIndex < 0) {
    throw new Error("plan.md formal user decision table is missing its required columns.");
  }
  const headers = markdownDecisionTableCells(lines[headerIndex]!)!;
  const typeIndex = headers.indexOf("决定类型");
  const digestIndex = headers.indexOf("subjectDigest");
  const resolutionIndex = headers.indexOf("正式决定");
  return lines.slice(headerIndex + 2).flatMap((line) => {
    const cells = markdownDecisionTableCells(line);
    if (!cells || cells.length !== headers.length) return [];
    const clean = (value: string) => value.trim().replace(/^`|`$/g, "");
    if (
      clean(cells[typeIndex] ?? "") !== decisionType
      || clean(cells[digestIndex] ?? "") !== subjectDigest
    ) return [];
    const resolution = clean(cells[resolutionIndex] ?? "");
    return ["accepted", "rejected", "revision_requested", "cancelled"].includes(resolution)
      ? [resolution as CallbackResolution]
      : [];
  });
}

export function formalUserDecisionResolution(
  plan: string,
  activityId: string,
  subjectDigest: string
): CallbackResolution | undefined {
  return formalUserDecisionResolutions(plan, activityId, subjectDigest).at(-1);
}

export function assertFormalUserDecision(
  plan: string,
  activityId: string,
  subjectDigest: string,
  resolution: CallbackResolution
): void {
  const decisionType = decisionTypeForActivity(activityId);
  if (!decisionType) return;
  if (formalUserDecisionResolution(plan, activityId, subjectDigest) !== resolution) {
    throw new Error(
      `plan.md has no ${decisionType} decision matching subjectDigest ${subjectDigest} and resolution ${resolution}.`
    );
  }
}

export function assertRecordedFormalUserDecision(
  plan: string,
  activityId: string,
  subjectDigest: string,
  resolution: CallbackResolution
): void {
  const decisionType = decisionTypeForActivity(activityId);
  if (!decisionType) return;
  if (!formalUserDecisionResolutions(plan, activityId, subjectDigest).includes(resolution)) {
    throw new Error(
      `plan.md no longer contains the recorded ${decisionType} decision for subjectDigest ${subjectDigest} and resolution ${resolution}.`
    );
  }
}

export function planWithoutFormalDecisions(value: string): string {
  const source = normalizeDecisionMarkdown(value);
  const starts = [...source.matchAll(/^##\s+(.+?)\s*$/gm)];
  const decision = starts.find((start) => start[1]?.trim() === "正式用户决定");
  if (!decision) return source;
  const from = decision.index ?? 0;
  const next = starts.find((start) => (start.index ?? 0) > from);
  return normalizeDecisionMarkdown(
    `${source.slice(0, from)}${source.slice(next?.index ?? source.length)}`
  );
}

function formalDecisionRows(value: string): string[][] {
  const section = markdownSections(value)
    .find((candidate) => candidate.heading === "正式用户决定");
  if (!section) return [];
  const lines = section.body.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownDecisionTableCells(line);
    return cells?.includes("决定类型")
      && cells.includes("subjectDigest")
      && cells.includes("正式决定");
  });
  if (headerIndex < 0) return [];
  const headers = markdownDecisionTableCells(lines[headerIndex]!)!;
  return lines.slice(headerIndex + 2).flatMap((line) => {
    const cells = markdownDecisionTableCells(line);
    return cells?.length === headers.length ? [cells] : [];
  });
}

export function assertFormalDecisionAppendOnly(
  current: string,
  candidate: string
): void {
  const existingRows = formalDecisionRows(current);
  const candidateRows = formalDecisionRows(candidate);
  if (
    candidateRows.length !== existingRows.length + 1
    || canonicalJson(candidateRows.slice(0, existingRows.length))
      !== canonicalJson(existingRows)
  ) {
    throw new Error(
      "callback-resolve plan publication must preserve every existing formal decision row in order and append exactly one decision."
    );
  }
}

export function isFormalCallbackActivity(activityId: string): boolean {
  return [
    "plan-confirmation",
    "case-confirmation",
    "case-review-conflict-decision",
    "execution-authorization"
  ].includes(activityId);
}

export function callbackDriftRecovery(activityId: string, hasInFlightWork: boolean): {
  referenceId: string;
  reason: "callback_subject_drift" | "callback_subject_drift_reconcile";
} {
  return {
    referenceId: activityId,
    reason: hasInFlightWork ? "callback_subject_drift_reconcile" : "callback_subject_drift"
  };
}

export function callbackDecisionIsCurrent(input: {
  acceptedSubject: string;
  actualSubject: string;
  formalDecisionValid: boolean;
}): boolean {
  return input.acceptedSubject === input.actualSubject && input.formalDecisionValid;
}

export function dependentActivityIds(
  projection: WorkflowProjection,
  activityId: string
): Set<string> {
  const affected = new Set([activityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of Object.values(projection.activities)) {
      if (
        !affected.has(candidate.id)
        && candidate.definition.dependencies.some((dependency) => affected.has(dependency))
      ) {
        affected.add(candidate.id);
        changed = true;
      }
    }
  }
  return affected;
}

/** Applies callback-subject drift to an in-memory projection only. Repository
 * reads and durable recovery events remain owned by the manager facade. */
export function applyCallbackDriftProjection(input: {
  projection: WorkflowProjection;
  activityId: string;
  acceptedSubject: string;
  actualSubject: string;
  formalDecisionValid: boolean;
}): { affected: Set<string>; inFlight: string[] } {
  const {
    projection,
    activityId,
    acceptedSubject,
    actualSubject,
    formalDecisionValid
  } = input;
  const activity = projection.activities[activityId];
  if (!activity) throw new Error(`Unknown callback activity: ${activityId}.`);
  const affected = dependentActivityIds(projection, activityId);
  const inFlight = [...affected].filter((downstreamId) =>
    downstreamId !== activityId
    && ["RUNNING", "RECONCILING"].includes(
      projection.activities[downstreamId]?.state ?? ""
    )
  );
  activity.state = "BLOCKED";
  activity.blockerIds = [...new Set([
    ...activity.blockerIds,
    `callback-subject-drift-${activityId}`
  ])];
  for (const downstreamId of affected) {
    if (downstreamId === activityId) continue;
    const downstream = projection.activities[downstreamId]!;
    if (!["RUNNING", "RECONCILING"].includes(downstream.state)) {
      downstream.state = "PENDING";
    }
  }
  projection.readyActivities = projection.readyActivities
    .filter((id) => !affected.has(id));
  projection.runningActivities = projection.runningActivities
    .filter((id) => projection.activities[id]?.state === "RUNNING");
  projection.waits = [
    ...projection.waits.filter((wait) =>
      wait.referenceId !== `callback-subject-drift-${activityId}`
    ),
    {
      kind: "blocker",
      activityId,
      referenceId: `callback-subject-drift-${activityId}`,
      detail: formalDecisionValid
        ? `Repository subject changed from ${acceptedSubject} to ${actualSubject}.`
        : "The accepted callback no longer has a matching formal user decision in plan.md."
    }
  ];
  projection.workflowState = inFlight.length ? "RECONCILING" : "RUNNING";
  projection.nextActions = inFlight.length
    ? inFlight
    : [`callback-reopen:${activityId}`];
  const recovery = callbackDriftRecovery(activityId, inFlight.length > 0);
  projection.continuation = {
    kind: "continue_now",
    referenceId: recovery.referenceId,
    reason: recovery.reason
  };
  projection.reply = {
    kind: "none",
    allowed: false,
    reason: "automatic_work_remaining"
  };
  return { affected, inFlight };
}
