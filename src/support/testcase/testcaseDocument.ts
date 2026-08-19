export const TESTCASE_V6_LAYERED_MARKER = "testcase-v6-layered" as const;
export const CURRENT_TESTCASE_DOCUMENT_VERSION = TESTCASE_V6_LAYERED_MARKER;
export const UNSUPPORTED_TESTCASE_DOCUMENT_VERSION = "unsupported" as const;

export type TestcaseDocumentVersion =
  | typeof TESTCASE_V6_LAYERED_MARKER
  | typeof UNSUPPORTED_TESTCASE_DOCUMENT_VERSION;

export interface ParsedTestcaseStep {
  index: string;
  action: string;
  data: string;
  expected: string;
}

export interface ParsedTestcaseDataInstance {
  dataId: string;
  data: string;
  expected: string;
}

export interface ParsedTestcaseExecutionRow {
  dataId?: string;
  stepIndex: string;
  action: string;
  data: string;
  expected: string;
}

export interface ParsedTestcaseOverrides {
  environment?: string;
  dataStrategy?: string;
  risk?: string;
  sourceRefs: string[];
}

export interface ParsedTestcase {
  module: string;
  caseId: string;
  title: string;
  priority: string;
  ruleIds: string[];
  preconditions: string;
  dataInstances: ParsedTestcaseDataInstance[];
  steps: ParsedTestcaseStep[];
  executionRows: ParsedTestcaseExecutionRow[];
  overrides: ParsedTestcaseOverrides;
  rawBody: string;
}

export interface TestcaseOverviewRow {
  module: string;
  caseId: string;
  title: string;
  priority: string;
}

export interface TestcaseReviewIndexRow extends TestcaseOverviewRow {
  risk: string;
}

export interface ParsedTestcaseDocument {
  version: TestcaseDocumentVersion;
  defaults: {
    testType?: string;
    environment?: string;
    dataStrategy?: string;
  };
  overview: TestcaseOverviewRow[];
  reviewIndex: TestcaseReviewIndexRow[];
  cases: ParsedTestcase[];
}

const caseIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u;
const dataIdPattern = /^D(?:0[1-9]|[1-9]\d)$/u;
const ruleIdPattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu;
const sourceIdPattern = /\bSRC-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu;
const compoundActionPattern = /(?:创建|删除|提交|发起请求|调用接口)[^。；\n]*(?:；|，|并且|然后|随后)[^。；\n]*(?:查询|核对|检查|确认|查看)/u;
const indexHeader = ["模块", "用例编号", "用例标题", "优先级", "风险"] as const;
const executionHeader = ["数据编号", "步骤", "操作", "测试数据", "预期结果"] as const;

export function isCurrentTestcaseDocumentVersion(
  version: TestcaseDocumentVersion
): version is typeof TESTCASE_V6_LAYERED_MARKER {
  return version === TESTCASE_V6_LAYERED_MARKER;
}

export function isStructuredTestcaseDocumentVersion(
  version: TestcaseDocumentVersion
): version is typeof TESTCASE_V6_LAYERED_MARKER {
  return isCurrentTestcaseDocumentVersion(version);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function clean(value: string): string {
  return value.replace(/`/gu, "").trim();
}

function placeholder(value: string): boolean {
  return !clean(value) || /<[^>]+>|待填写|待补充/u.test(value);
}

function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      cell += character;
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells.slice(1, -1);
}

function tableRows(value: string): string[][] {
  return value.split(/\r?\n/u)
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*:?-{3,}/u.test(line.trim()))
    .map(splitMarkdownRow);
}

function section(value: string, heading: RegExp, nextHeading: RegExp): string {
  const match = heading.exec(value);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const next = nextHeading.exec(value.slice(start));
  return value.slice(start, next ? start + next.index : undefined).trim();
}

function attribute(line: string, label: string): string | undefined {
  const normalized = line.replace(/^>\s*/u, "");
  const match = new RegExp(`(?:^|｜)\\s*${label}[：:]\\s*([^｜]+)`, "u").exec(normalized);
  return match?.[1]?.trim();
}

function parseDefaults(value: string): ParsedTestcaseDocument["defaults"] {
  const line = value.split(/\r?\n/u).find((candidate) =>
    /^>\s*测试类型[：:]/u.test(candidate.trim())
  ) ?? "";
  return {
    testType: attribute(line, "测试类型"),
    environment: attribute(line, "默认环境"),
    dataStrategy: attribute(line, "默认数据策略")
  };
}

function parseDifference(
  value: string,
  label: string,
  issues: string[]
): Omit<ParsedTestcaseOverrides, "risk"> {
  const overrides: Omit<ParsedTestcaseOverrides, "risk"> = { sourceRefs: [] };
  if (!clean(value)) return overrides;
  const allowed = new Set(["环境", "数据策略", "来源"]);
  const seen = new Set<string>();
  for (const token of value.split(/[；;]/u).map((item) => item.trim()).filter(Boolean)) {
    const match = /^([^=]+)=(.+)$/u.exec(token);
    const key = match?.[1]?.trim() ?? "";
    const entry = match?.[2]?.trim() ?? "";
    if (!match || !allowed.has(key) || !entry) {
      issues.push(`${label} 差异字段无效：${token || "未填写"}。`);
      continue;
    }
    if (seen.has(key)) issues.push(`${label} 差异字段重复声明 ${key}。`);
    seen.add(key);
    if (key === "环境") overrides.environment = entry;
    if (key === "数据策略") overrides.dataStrategy = entry;
    if (key === "来源") {
      overrides.sourceRefs = unique(entry.match(sourceIdPattern) ?? []);
      if (!overrides.sourceRefs.length) issues.push(`${label} 来源差异缺少有效 SRC。`);
    }
  }
  return overrides;
}

function executionViews(executionRows: ParsedTestcaseExecutionRow[]): {
  dataInstances: ParsedTestcaseDataInstance[];
  steps: ParsedTestcaseStep[];
} {
  const parameterized = executionRows.some((row) => row.dataId);
  const dataOrder = [...new Set(executionRows.flatMap((row) => row.dataId ? [row.dataId] : []))];
  const dataInstances = dataOrder.map((dataId) => {
    const rows = executionRows.filter((row) => row.dataId === dataId);
    return {
      dataId,
      data: unique(rows.map((row) => row.data)).length === 1
        ? rows[0]?.data ?? ""
        : rows.map((row) => `步骤 ${row.stepIndex}：${row.data}`).join("；"),
      expected: rows.length === 1
        ? rows[0]?.expected ?? ""
        : rows.map((row) => `步骤 ${row.stepIndex}：${row.expected}`).join("；")
    };
  });
  const stepOrder = [...new Set(executionRows.map((row) => row.stepIndex))];
  const steps = stepOrder.map((stepIndex) => {
    const rows = executionRows.filter((row) => row.stepIndex === stepIndex);
    return {
      index: stepIndex,
      action: rows[0]?.action ?? "",
      data: parameterized ? "按数据编号逐项执行" : rows[0]?.data ?? "",
      expected: parameterized ? "各数据实例得到对应预期结果" : rows[0]?.expected ?? ""
    };
  });
  return { dataInstances, steps };
}

function parseReviewIndex(value: string): TestcaseReviewIndexRow[] {
  const body = section(value, /^##\s+快速索引\s*$/mu, /^##\s+/mu);
  return tableRows(body)
    .filter((row) => row[0] !== "模块" && row.length >= 5)
    .map((row) => ({
      module: clean(row[0] ?? ""),
      caseId: clean(row[1] ?? ""),
      title: clean(row[2] ?? ""),
      priority: clean(row[3] ?? ""),
      risk: clean(row[4] ?? "").replace(/风险$/u, "")
    }));
}

function parseCases(value: string): { cases: ParsedTestcase[]; issues: string[] } {
  const issues: string[] = [];
  const cases: ParsedTestcase[] = [];
  const modules = [...value.matchAll(/^##\s+模块[：:]\s*(.+?)\s*$/gmu)];
  for (const [moduleIndex, moduleMatch] of modules.entries()) {
    const module = clean(moduleMatch[1] ?? "");
    const start = (moduleMatch.index ?? 0) + moduleMatch[0].length;
    const end = modules[moduleIndex + 1]?.index ?? value.length;
    const moduleBody = value.slice(start, end);
    const details = [...moduleBody.matchAll(/<details(?:\s+open)?>([\s\S]*?)<\/details>/gu)];
    if (!details.length) issues.push(`模块 ${module || "未填写"} 缺少折叠用例详情。`);
    for (const detail of details) {
      const rawBody = detail[0].trim();
      const summaryLine = rawBody.split(/\r?\n/u).find((line) =>
        /^<summary>.*<\/summary>$/u.test(line.trim())
      )?.trim() ?? "";
      const summary = /^<summary>\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*｜\s*(.+?)\s*｜\s*(P[0-2])\s*｜\s*(低|中|高)风险\s*<\/summary>$/u.exec(summaryLine);
      const caseId = clean(summary?.[1] ?? "");
      const label = caseId || "unknown-case";
      if (!summary) issues.push(`${label} 折叠标题必须包含 caseId、标题、优先级和有效风险。`);
      const lines = rawBody.split(/\r?\n/u);
      const ruleLine = lines.find((line) => /^>\s*规则[：:]/u.test(line.trim())) ?? "";
      const preconditionLine = lines.find((line) => /^>\s*前置条件[：:]/u.test(line.trim())) ?? "";
      const differenceLine = lines.find((line) => /^>\s*差异[：:]/u.test(line.trim())) ?? "";
      const difference = differenceLine.replace(/^>\s*差异[：:]\s*/u, "").trim();
      const parsedDifference = parseDifference(difference, label, issues);
      const rows = tableRows(rawBody);
      const headerIndex = rows.findIndex((row) => row.join("|") === executionHeader.join("|"));
      if (headerIndex < 0) issues.push(`${label} 执行表必须使用固定五列。`);
      const executionRows = (headerIndex < 0 ? [] : rows.slice(headerIndex + 1)).map((row) => {
        if (row.length !== executionHeader.length) issues.push(`${label} 执行数据行必须严格包含五列。`);
        const rawDataId = clean(row[0] ?? "");
        return {
          ...(rawDataId && rawDataId !== "—" ? { dataId: rawDataId } : {}),
          stepIndex: clean(row[1] ?? ""),
          action: clean(row[2] ?? ""),
          data: clean(row[3] ?? ""),
          expected: clean(row[4] ?? "")
        };
      });
      const views = executionViews(executionRows);
      cases.push({
        module,
        caseId,
        title: clean(summary?.[2] ?? ""),
        priority: clean(summary?.[3] ?? ""),
        ruleIds: unique(ruleLine.match(ruleIdPattern) ?? []),
        preconditions: clean(preconditionLine.replace(/^>\s*前置条件[：:]\s*/u, "")),
        dataInstances: views.dataInstances,
        steps: views.steps,
        executionRows,
        overrides: { ...parsedDifference, risk: clean(summary?.[4] ?? "") || undefined },
        rawBody
      });
    }
  }
  return { cases, issues };
}

export function parseTestcaseDocument(value: string): ParsedTestcaseDocument {
  if (!/结构版本[：:]\s*testcase-v6-layered\b/u.test(value)) {
    return {
      version: UNSUPPORTED_TESTCASE_DOCUMENT_VERSION,
      defaults: {},
      overview: [],
      reviewIndex: [],
      cases: []
    };
  }
  return {
    version: TESTCASE_V6_LAYERED_MARKER,
    defaults: parseDefaults(value),
    overview: [],
    reviewIndex: parseReviewIndex(value),
    cases: parseCases(value).cases
  };
}

function normalizedRisk(value: string | undefined): string {
  return clean(value ?? "").replace(/风险$/u, "");
}

export function renderTestcaseV6DerivedView(cases: ParsedTestcase[]): string {
  const counts = {
    P0: cases.filter((testcase) => testcase.priority === "P0").length,
    high: cases.filter((testcase) => normalizedRisk(testcase.overrides.risk) === "高").length,
    parameterized: cases.filter((testcase) => testcase.dataInstances.length > 0).length
  };
  return [
    `> 共 ${cases.length} 条 ｜ P0 ${counts.P0} 条 ｜ 高风险 ${counts.high} 条 ｜ 参数化 ${counts.parameterized} 条`,
    "",
    "## 快速索引",
    "",
    "| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |",
    "| --- | --- | --- | --- | --- |",
    ...cases.map((testcase) =>
      `| ${testcase.module} | ${testcase.caseId} | ${testcase.title} | ${testcase.priority} | ${normalizedRisk(testcase.overrides.risk)} |`
    )
  ].join("\n");
}

export function projectTestcaseV6DerivedView(value: string): string {
  const document = parseTestcaseDocument(value);
  if (!isCurrentTestcaseDocumentVersion(document.version)) return value;
  const derived = renderTestcaseV6DerivedView(document.cases);
  const firstModule = /^##\s+模块[：:]/mu.exec(value);
  if (!firstModule || firstModule.index === undefined) return value;
  const beforeModules = value.slice(0, firstModule.index);
  const existingIndex = /^>\s*共\s+\d+\s+条[^\n]*$[\s\S]*?^##\s+快速索引\s*$[\s\S]*?(?=^##\s+模块[：:])/mu;
  if (existingIndex.test(value)) return value.replace(existingIndex, `${derived}\n\n`);
  return `${beforeModules.trimEnd()}\n\n${derived}\n\n${value.slice(firstModule.index)}`;
}

export function projectTestcaseV6Rules(
  value: string,
  rulesByCase: ReadonlyMap<string, string[]>
): string {
  if (!isCurrentTestcaseDocumentVersion(parseTestcaseDocument(value).version)) return value;
  const projected = value.replace(
    /(<details(?:\s+open)?>[\s\S]*?<summary>\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)[^\n]*<\/summary>[\s\S]*?^>\s*规则[：:]\s*)[^\n]*/gmu,
    (_line, prefix: string, caseId: string) =>
      `${prefix}${rulesByCase.get(caseId)?.join("、") ?? "无"}`
  );
  return projectTestcaseV6DerivedView(projected);
}

export function testcaseV6LayeredSemanticProjection(value: string): string {
  const document = parseTestcaseDocument(value);
  if (!isCurrentTestcaseDocumentVersion(document.version)) return value;
  return document.cases.map((testcase) => [
    `### ${testcase.caseId}｜${testcase.title}`,
    JSON.stringify({
      module: testcase.module,
      caseId: testcase.caseId,
      title: testcase.title,
      priority: testcase.priority,
      effectiveRisk: normalizedRisk(testcase.overrides.risk),
      ruleIds: testcase.ruleIds,
      preconditions: testcase.preconditions,
      governance: {
        environment: testcase.overrides.environment ?? document.defaults.environment ?? "",
        dataStrategy: testcase.overrides.dataStrategy ?? document.defaults.dataStrategy ?? "",
        sourceRefs: testcase.overrides.sourceRefs
      },
      executionRows: testcase.executionRows
    })
  ].join("\n")).join("\n\n");
}

export function validateTestcaseV6Layered(value: string): string[] {
  const document = parseTestcaseDocument(value);
  if (!isCurrentTestcaseDocumentVersion(document.version)) {
    return [`用例文档必须使用 ${TESTCASE_V6_LAYERED_MARKER}。`];
  }
  const parsed = parseCases(value);
  const issues = [...parsed.issues];
  for (const [label, field] of [
    ["测试类型", document.defaults.testType],
    ["默认环境", document.defaults.environment],
    ["默认数据策略", document.defaults.dataStrategy]
  ] as const) {
    if (!field || placeholder(field)) issues.push(`用例集${label}缺失。`);
  }
  if (!/^>\s*本文档仅用于确认测试设计，不代表授权执行或业务写入。\s*$/mu.test(value)) {
    issues.push("testcase-v6-layered 缺少文件级执行授权声明。");
  }
  if ((value.match(/<details(?:\s+open)?>/gu) ?? []).length !== (value.match(/<\/details>/gu) ?? []).length) {
    issues.push("testcase-v6-layered 存在未闭合的折叠用例详情。");
  }
  if (!document.cases.length) issues.push("testcase-v6-layered 至少需要一条用例。");
  const indexRows = tableRows(section(value, /^##\s+快速索引\s*$/mu, /^##\s+/mu));
  if (indexRows[0]?.join("|") !== indexHeader.join("|")) {
    issues.push("快速索引必须固定为模块、用例编号、用例标题、优先级、风险五列。");
  }
  if (indexRows.slice(1).some((row) => row.length !== indexHeader.length)) {
    issues.push("快速索引的数据行必须严格包含五列。");
  }
  const caseIds = new Set<string>();
  for (const testcase of document.cases) {
    const label = testcase.caseId || "unknown-case";
    if (!caseIdPattern.test(testcase.caseId)) issues.push(`${label} 缺少有效 caseId。`);
    if (caseIds.has(testcase.caseId)) issues.push(`重复 caseId：${testcase.caseId}。`);
    caseIds.add(testcase.caseId);
    if (placeholder(testcase.module)) issues.push(`${label} 缺少模块。`);
    if (placeholder(testcase.title)) issues.push(`${label} 缺少用例标题。`);
    if (!/^P[0-2]$/u.test(testcase.priority)) issues.push(`${label} 优先级必须是 P0/P1/P2。`);
    if (!/^(?:低|中|高)$/u.test(normalizedRisk(testcase.overrides.risk))) {
      issues.push(`${label} 有效风险必须是低/中/高。`);
    }
    if (!testcase.ruleIds.length) issues.push(`${label} 缺少关联 RULE。`);
    if (placeholder(testcase.preconditions)) issues.push(`${label} 缺少前置条件；没有时填写“无”。`);
    if (/本轮不执行/u.test(testcase.preconditions)) issues.push(`${label} 前置条件不得重复文件级执行授权声明。`);
    const parameterized = testcase.executionRows.some((row) => row.dataId);
    if (parameterized && testcase.executionRows.some((row) => !row.dataId)) {
      issues.push(`${label} 参数用例不能混用数据编号与“—”。`);
    }
    if (parameterized && testcase.dataInstances.length < 2) issues.push(`${label} 参数用例至少需要两条数据实例。`);
    const keys = new Set<string>();
    const stepsByData = new Map<string, string[]>();
    const actionsByStep = new Map<string, string>();
    for (const row of testcase.executionRows) {
      const dataId = row.dataId ?? "—";
      if (row.dataId && !dataIdPattern.test(row.dataId)) issues.push(`${label} 数据编号 ${row.dataId} 无效，应使用 D01-D99。`);
      if (!/^\d+$/u.test(row.stepIndex) || Number(row.stepIndex) < 1) issues.push(`${label} 步骤 ${row.stepIndex || "未填写"} 无效，应使用正整数。`);
      const key = `${dataId}:${row.stepIndex}`;
      if (keys.has(key)) issues.push(`${label} 存在重复执行行 ${key}。`);
      keys.add(key);
      stepsByData.set(dataId, [...(stepsByData.get(dataId) ?? []), row.stepIndex]);
      const knownAction = actionsByStep.get(row.stepIndex);
      if (knownAction && knownAction !== row.action) issues.push(`${label} 步骤 ${row.stepIndex} 在不同数据实例中操作不一致。`);
      if (!knownAction && row.action) actionsByStep.set(row.stepIndex, row.action);
      if (placeholder(row.action)) issues.push(`${label} ${key} 缺少操作。`);
      if (compoundActionPattern.test(row.action)) issues.push(`${label} ${key} 聚合了多个业务动作，必须拆分步骤。`);
      if (placeholder(row.data)) issues.push(`${label} ${key} 缺少测试数据。`);
      if (placeholder(row.expected)) issues.push(`${label} ${key} 缺少预期结果。`);
    }
    const stepSets = [...stepsByData.entries()];
    for (const [dataId, steps] of stepSets) {
      const expected = steps.map((_, index) => String(index + 1));
      if (steps.some((step, index) => step !== expected[index])) issues.push(`${label} 数据编号 ${dataId} 的步骤必须从 1 连续递增。`);
    }
    if (parameterized && stepSets.length > 1) {
      const expected = stepSets[0]?.[1].join(",") ?? "";
      for (const [dataId, steps] of stepSets.slice(1)) {
        if (steps.join(",") !== expected) issues.push(`${label} 数据编号 ${dataId} 的步骤集合与其他实例不一致。`);
      }
    }
  }
  const expectedIndex = document.cases.map((testcase) => ({
    module: testcase.module,
    caseId: testcase.caseId,
    title: testcase.title,
    priority: testcase.priority,
    risk: normalizedRisk(testcase.overrides.risk)
  }));
  if (JSON.stringify(document.reviewIndex) !== JSON.stringify(expectedIndex)) issues.push("快速索引与折叠用例详情不一致。");
  const expectedStats = renderTestcaseV6DerivedView(document.cases).split("\n", 1)[0];
  const actualStats = value.split(/\r?\n/u).find((line) => /^>\s*共\s+\d+\s+条/u.test(line.trim()));
  if (actualStats?.trim() !== expectedStats) issues.push("顶部用例统计与折叠用例详情不一致。");
  // 派生区（统计行+快速索引）必须与 projectTestcaseV6DerivedView 的重投影完全一致；
  // 任何漂移（计数、索引行、模块归属、格式）在此确定性拦截，禁止手写派生区。
  if (projectTestcaseV6DerivedView(value) !== value) {
    issues.push("派生视图漂移：统计行/快速索引与用例体不一致，必须以 projectTestcaseV6DerivedView 重投影。");
  }
  return unique(issues);
}
