import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { RULE_COVERAGE_MARKER, parseRuleRecords, summarizeRuleCoverage, validateRuleCoverage } from "./testcase-quality-gate.ts";
import { CASE_RELATION_PROJECTION_MARKER, synchronizeRequest } from "./testcase-relation-projections.ts";
import { inspectMarkdownFormat, splitMarkdownTableRow } from "./markdown-format.ts";
import { loadTestAssetManifest, validateTestAssetManifest } from "../src/support/test-assets/assetManifest.js";
import { validateKnowledgeDecisionRows } from "../src/support/testcase/knowledgeDecision.ts";
import { RULE_DESIGN_MATRIX_MARKER, validateRuleDesignMatrix } from "./rule-design-preflight.ts";
import { inspectFormalSpecSource } from "../src/support/formal-execution/sourceGate.js";

type CheckStatus = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
}

interface CaseRecord {
  caseId: string;
  traceIds: string[];
  ruleIds: string[];
  source: string;
}

interface RequirementTrace {
  traceId: string;
  applicable: boolean;
  caseIds: string[];
}

interface PlannedPackage {
  fileName: string;
  actualCaseIds: string[];
  generationStatus: string;
}

const results: CheckResult[] = [];
const projectRoot = resolve(import.meta.dirname, "..");
const testTypes = ["web", "app", "api", "iot-chain"];
const requiredPlanSections = ["## 测试范围", "## 需求追溯矩阵", "## 用例集评审与演进"];
const coverageInventorySection = "## 覆盖基准与拆分清单";
const changeImpactSection = "## 变更影响分析";
const testcaseStandardMarker = "结构版本：coverage-inventory-v1";
const ruleDesignMatrixMarker = "结构版本：rule-design-matrix-v1";
const sourceReferenceLinksMarker = "结构版本：source-reference-links-v1";
const testcaseGenerationMarker = "结构版本：testcase-generation-v1";
const environmentStatusMarker = "结构版本：environment-status-v1";
const testAssetSelectionMarker = "test-asset-selection-v1";
const testDataPolicySection = "## 测试数据策略与残留台账";
const testDataPolicyMarker = "结构版本：test-data-policy-v1";
const multiRoleReviewSection = "## 多角色评审记录";
const multiRoleReviewMarker = "结构版本：multi-role-review-v1";
const evidenceDrivenEvolutionMarker = "结构版本：evidence-driven-evolution-v1";
const reviewerExecutionMarker = "结构版本：reviewer-execution-v1";
const autoEvolutionLoopMarker = "结构版本：auto-evolution-loop-v1";
const knowledgeDecisionMarker = "结构版本：knowledge-decision-v1";
const taskExecutionListSection = "## 任务执行清单";
const taskExecutionListMarker = "结构版本：task-execution-list-v1";
const webScriptGovernanceMarker = "结构版本：web-script-governance-v1";
const pageSessionGroupMarker = "结构版本：page-session-group-v1";
const caseEvidencePolicyMarker = "结构版本：case-evidence-policy-v1";
const baseReviewRoles = ["需求一致性评审", "测试设计评审", "追溯审计"];
const impactReviewRole = "变更影响评审";
const interactionReviewRole = "交互与状态专项评审";
const validReviewerConclusions = new Set(["评审中", "通过", "需演进", "阻塞"]);
const validReviewerExecutionStatuses = new Set(["等待资源", "已启动", "已完成", "失败", "超时", "阻塞"]);
const validFindingStatuses = new Set(["待处理", "待用户裁决", "已关闭", "不适用"]);
const validBatchConclusions = new Set(["评审中", "可提交确认", "需演进", "阻塞"]);
const validHumanConfirmationStatuses = new Set(["待用户确认", "已确认", "退回草案", "未请求"]);
const validFindingCategories = new Set(["需求覆盖缺口", "资料明确的设计缺口", "业务裁决/资料冲突", "质量建议"]);
const validFindingDispositions = new Set(["自动演进", "用户裁决", "风险登记"]);
const validGenerationStatuses = new Set(["未开始", "生成中", "待评审", "待用户确认", "已确认"]);
const validPackageGenerationStatuses = new Set(["待生成", "生成中", "草案完整", "已确认"]);
const validTestDataPolicies = new Set([
  "no_write",
  "managed_cleanup",
  "tracked_residual",
  "无写入",
  "受控残留",
  "必须清理"
]);
const validTestDataConfirmationStatuses = new Set(["待用户确认", "已确认", "不适用"]);
const validTaskExecutionStatuses = new Set(["待开始", "进行中", "已完成", "等待确认", "阻塞", "跳过"]);
const engineeringPlanSection = "## 工程层：代码定位与自动化设计";
const caseIdPattern = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g;
const traceIdPattern = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const ruleIdPattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;

function record(status: CheckStatus, name: string, detail: string) {
  results.push({ status, name, detail });
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function hasStructureMarker(content: string, marker: string): boolean {
  const version = marker.replace("结构版本：", "");
  return content.includes(marker) || content.includes(`<!-- testcase-standard: ${version} -->`);
}

function countOccurrences(content: string, token: string): number {
  return content.split(token).length - 1;
}

function listDirectories(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function listMarkdownFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();
}

function containsConfirmedCase(packagePath: string): boolean {
  return /\|\s*状态\s*\|\s*已确认\s*\|/.test(readFileSync(packagePath, "utf8"));
}

function extractCaseIds(value: string): string[] {
  return [...new Set((value.match(caseIdPattern) ?? []).filter((id) => !id.startsWith("REQ-")))];
}

function extractTraceIds(value: string): string[] {
  return [...new Set(value.match(traceIdPattern) ?? [])];
}

function extractRuleIds(value: string): string[] {
  return [...new Set(value.match(ruleIdPattern) ?? [])];
}

function extractMarkdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start === -1) {
    return "";
  }
  const nextSection = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, nextSection === -1 ? undefined : nextSection);
}

function extractTableCell(content: string, label: string): string {
  const match = content.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, "m"));
  return match?.[1] ?? "";
}

function parseRequirementTraces(plan: string): RequirementTrace[] {
  const section = extractMarkdownSection(plan, "## 需求追溯矩阵");
  const rows = parseMarkdownRows(section);
  const headers = rows.find((cells) => cells.includes("追溯编号")) ?? [];
  const applicabilityIndex = headers.indexOf("适用性");
  const caseIdIndex = headers.indexOf("派生 caseId") >= 0 ? headers.indexOf("派生 caseId") : headers.indexOf("计划覆盖范围 / 原子用例关联");
  return rows
    .filter((cells) => extractTraceIds(cells[0] ?? "").length > 0)
    .map((cells) => {
      const applicability = cells[applicabilityIndex] ?? "";
      return {
        traceId: extractTraceIds(cells[0] ?? "")[0] ?? "",
        applicable: applicability.includes("适用") && !applicability.includes("不适用") && !applicability.includes("超出"),
        caseIds: extractCaseIds(cells[caseIdIndex] ?? "")
      };
    });
}

function extractCaseRecords(packagePath: string): CaseRecord[] {
  const content = readFileSync(packagePath, "utf8");
  const source = packagePath.split(sep).at(-1) ?? packagePath;
  return content
    .split(/^## 测试用例：/m)
    .slice(1)
    .flatMap((caseBlock) => {
      const traceIds = extractTraceIds(extractTableCell(caseBlock, "需求追溯编号"));
      const ruleIds = extractRuleIds(extractTableCell(caseBlock, "规则覆盖编号"));
      return extractCaseIds(extractTableCell(caseBlock, "用例编号")).map((caseId) => ({ caseId, traceIds, ruleIds, source }));
    });
}

function statusFor(strict: boolean, passed: boolean): CheckStatus {
  return passed ? "PASS" : strict ? "FAIL" : "WARN";
}

function parseMarkdownRows(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-{3,}/.test(line.trim()))
    .map((line) => splitMarkdownTableRow(line.trim()));
}

function validateMarkdownTableStructure(content: string, label: string, strict: boolean) {
  const malformedTables = inspectMarkdownFormat(content)
    .filter((issue) => !issue.detail.includes("字面量"))
    .map((issue) => `第 ${issue.line} 行${issue.detail}`);
  record(
    statusFor(strict, malformedTables.length === 0),
    `Markdown 表格结构 ${label}`,
    malformedTables.length === 0 ? "所有表头、分隔行与数据行列数一致。" : malformedTables.join("；")
  );
}

function validateMarkdownLineBreaks(content: string, label: string, strict: boolean) {
  const escapedLineBreaks = inspectMarkdownFormat(content).filter((issue) => issue.detail.includes("字面量")).length;
  record(
    statusFor(strict, escapedLineBreaks === 0),
    `Markdown 换行 ${label}`,
    escapedLineBreaks === 0
      ? "未发现被当作正文换行的字面量转义字符。"
      : `发现 ${escapedLineBreaks} 个字面量 \\n 或 \\r；必须转换为真实 Markdown 换行后才可展示。`
  );
}

function extractMarkdownLinks(content: string): string[] {
  return [...content.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function parsePlannedCaseIds(value: string): string[] {
  const caseIds = new Set(extractCaseIds(value));
  const ranges = value.matchAll(/([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+-)(\d+)\s*至\s*(?:[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+-)?(\d+)/g);
  for (const range of ranges) {
    const prefix = range[1];
    const start = Number(range[2]);
    const end = Number(range[3]);
    const width = range[2].length;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start > 999) {
      continue;
    }
    for (let index = start; index <= end; index += 1) {
      caseIds.add(`${prefix}${String(index).padStart(width, "0")}`);
    }
  }
  return [...caseIds];
}

function parsePlannedPackages(plan: string): PlannedPackage[] {
  return parseMarkdownRows(extractMarkdownSection(plan, "## 用例包目录"))
    .filter((cells) => cells.length >= 6 && /^`?cases-[a-z0-9][a-z0-9-]*\.md`?$/.test(cells[0] ?? ""))
    .map((cells) => ({
      fileName: (cells[0] ?? "").replace(/`/g, ""),
      actualCaseIds: parsePlannedCaseIds(cells[3] ?? ""),
      generationStatus: cells[4] ?? ""
    }));
}

function validateGenerationClosure(
  plan: string,
  packageFiles: string[],
  caseRecords: CaseRecord[],
  requestLabel: string
) {
  const generationSection = extractMarkdownSection(plan, "## 用例集生成状态");
  const strict = hasStructureMarker(plan, testcaseGenerationMarker);
  const generationStatus = extractTableCell(generationSection, "用例集状态");
  const hasStructure =
    hasStructureMarker(generationSection, testcaseGenerationMarker) &&
    validGenerationStatuses.has(generationStatus) &&
    ["已完成用例包", "待生成或待补齐用例包", "当前阻塞项", "下一门禁"].every((label) => hasFilledValue(extractTableCell(generationSection, label)));
  record(
    statusFor(strict, hasStructure),
    `用例集生成状态 ${requestLabel}`,
    hasStructure ? `当前阶段二状态为“${generationStatus}”。` : "缺少有效的用例集生成状态区块或必填字段。"
  );

  const plannedPackages = parsePlannedPackages(plan);
  const validPackageStates = plannedPackages.every((item) => validPackageGenerationStatuses.has(item.generationStatus));
  record(
    statusFor(strict, plannedPackages.length > 0 && validPackageStates),
    `用例包生成清单 ${requestLabel}`,
    plannedPackages.length > 0 && validPackageStates
      ? `${plannedPackages.length} 个计划用例包均已声明生成状态。`
      : "用例包目录缺少计划包、生成状态，或使用了无效状态。"
  );

  const closureRequired = ["待评审", "待用户确认", "已确认"].includes(generationStatus);
  if (!strict || !hasStructure) {
    return closureRequired;
  }

  const planStatus = extractTableCell(extractMarkdownSection(plan, "## 基本信息"), "状态");
  if (closureRequired) {
    record(
      planStatus === "已确认" ? "PASS" : "FAIL",
      `计划与用例集状态 ${requestLabel}`,
      planStatus === "已确认" ? "测试计划已确认，可进入用例集评审或确认。" : "用例集进入评审或确认前，测试计划必须为“已确认”。"
    );
  }

  const expectedPackageNames = new Set(plannedPackages.map((item) => item.fileName));
  const missingPackages = plannedPackages.filter((item) => !packageFiles.includes(item.fileName)).map((item) => item.fileName);
  const unexpectedPackages = packageFiles.filter((fileName) => !expectedPackageNames.has(fileName));
  const expectedCaseIds = new Set(plannedPackages.flatMap((item) => item.actualCaseIds));
  const actualCaseIds = new Set(caseRecords.map((item) => item.caseId));
  const packagesWithoutActualCaseIds = plannedPackages.filter((item) => item.actualCaseIds.length === 0).map((item) => item.fileName);
  const missingCaseIds = [...expectedCaseIds].filter((caseId) => !actualCaseIds.has(caseId));
  const unexpectedCaseIds = [...actualCaseIds].filter((caseId) => !expectedCaseIds.has(caseId));
  const packageStateMismatches = plannedPackages
    .filter((item) => item.generationStatus === "待生成" && packageFiles.includes(item.fileName))
    .map((item) => item.fileName);
  const isComplete =
    missingPackages.length === 0 &&
    unexpectedPackages.length === 0 &&
    packagesWithoutActualCaseIds.length === 0 &&
    missingCaseIds.length === 0 &&
    unexpectedCaseIds.length === 0 &&
    packageStateMismatches.length === 0;
  record(
    generationStatus === "未开始" ? "PASS" : isComplete ? "PASS" : closureRequired ? "FAIL" : "WARN",
    `用例集包级闭环 ${requestLabel}`,
    generationStatus === "未开始"
      ? "计划阶段仅定义用例包边界与覆盖范围；尚未要求创建用例包或分配 caseId。"
      : isComplete
        ? "计划包、实际 caseId 与草案完全一致。"
        : `缺少包：${missingPackages.join("、") || "无"}；未回填实际 caseId 的包：${packagesWithoutActualCaseIds.join("、") || "无"}；未生成 caseId：${missingCaseIds.join("、") || "无"}；未登记包：${unexpectedPackages.join("、") || "无"}；未登记 caseId：${unexpectedCaseIds.join("、") || "无"}；状态矛盾包：${packageStateMismatches.join("、") || "无"}。`
  );

  if (generationStatus === "未开始" && caseRecords.length > 0) {
    record("FAIL", `生成状态一致性 ${requestLabel}`, "用例集状态为“未开始”时不得存在原子用例。");
  }
  if (generationStatus === "生成中") {
    record(
      "PASS",
      `生成中边界 ${requestLabel}`,
      "允许部分草案；在包级闭环、追溯回填和评审完成前不得称为完整用例集。"
    );
  }
  return closureRequired;
}

function validateEnvironmentStatus(plan: string, requestLabel: string) {
  const section = extractMarkdownSection(plan, "## 环境选择");
  const strict = hasStructureMarker(plan, environmentStatusMarker);
  if (!strict) {
    record("WARN", `环境状态 ${requestLabel}`, "历史请求未标记 environment-status-v1，建议下次变更时补充配置、预检和用户确认状态。");
    return;
  }

  const requiredHeaders = ["本地配置状态", "预检状态", "用户确认状态", "未闭合项"];
  const rows = parseMarkdownRows(section).filter((cells) => ["test", "pre", "prod"].includes(cells[0] ?? ""));
  const validRows = rows.length > 0 && rows.every((cells) => cells.length >= 6 && ["待用户确认", "已确认"].includes(cells[4] ?? ""));
  const hasStructure = hasStructureMarker(section, environmentStatusMarker) && requiredHeaders.every((header) => section.includes(header)) && validRows;
  record(
    hasStructure ? "PASS" : "FAIL",
    `环境状态 ${requestLabel}`,
    hasStructure
      ? "已区分本地配置、预检、用户确认状态与未闭合项。"
      : "环境选择缺少 environment-status-v1 标记、三层状态字段，或有效的环境状态行。"
  );
}

function validateTestDataPolicy(plan: string, requestLabel: string) {
  const section = extractMarkdownSection(plan, testDataPolicySection);
  const strict = hasStructureMarker(plan, testDataPolicyMarker);
  const generationStatus = extractTableCell(extractMarkdownSection(plan, "## 用例集生成状态"), "用例集状态");
  const deferCaseIds = ["未开始", "生成中"].includes(generationStatus);
  if (!strict) {
    record("WARN", `测试数据策略 ${requestLabel}`, "历史请求未标记 test-data-policy-v1，建议下次变更时补充数据策略与残留台账。" );
    return;
  }

  const requiredHeaders = ["数据策略", "允许环境", "资源类型", "最大数量", "关联覆盖范围 / caseId", "用户确认状态"];
  const rows = parseMarkdownRows(section).filter((cells) => validTestDataPolicies.has(cells[0] ?? ""));
  const details = extractMarkdownSection(section, "### 写入策略明细");
  const hasStructure = hasStructureMarker(section, testDataPolicyMarker) && requiredHeaders.every((header) => section.includes(header)) && rows.length > 0 && details.includes("唯一合成标识") && details.includes("cleanupActionId");
  record(
    hasStructure ? "PASS" : "FAIL",
    `测试数据策略 ${requestLabel}`,
    hasStructure ? "测试数据策略区块与台账字段完整。" : "缺少 test-data-policy-v1 标记、策略表头或有效策略行。"
  );

  const invalidRows = rows.filter((cells) => {
    const [policy, environments, resourceType, maximum, caseIds, confirmation] = cells;
    if (cells.length < 6 || !validTestDataConfirmationStatuses.has(confirmation ?? "") || !hasFilledValue(resourceType ?? "")) {
      return true;
    }
    if (policy === "no_write" || policy === "无写入") {
      const allowedNoWriteEnvironment = environments === "不适用" || /^(test|pre)(?:\s*[/、,]\s*(test|pre))*$/.test(environments ?? "");
      const validNoWriteCoverage = deferCaseIds
        ? hasFilledValue(caseIds ?? "")
        : caseIds === "不适用" || extractCaseIds(caseIds ?? "").length > 0;
      return maximum !== "0" || !allowedNoWriteEnvironment || !validNoWriteCoverage;
    }
    const trackedResidual = policy === "tracked_residual" || policy === "受控残留";
    const managedCleanup = policy === "managed_cleanup" || policy === "必须清理";
    const allowedEnvironment = trackedResidual
      ? environments === "test"
      : /^(test|pre)(?:\s*[/、,]\s*(test|pre))*$/.test(environments ?? "");
    const positiveMaximum = /^[1-9]\d*$/.test(maximum ?? "");
    const hasCoverageReference = deferCaseIds
      ? hasFilledValue(caseIds ?? "")
      : extractCaseIds(caseIds ?? "").length > 0;
    const detailsPresent = details.includes("唯一合成标识") && details.includes("cleanupActionId");
    const cleanupPlanPresent = !managedCleanup || details.includes("清理");
    return !allowedEnvironment || !positiveMaximum || !hasCoverageReference || !detailsPresent || !cleanupPlanPresent;
  });
  record(
    invalidRows.length === 0 ? "PASS" : "FAIL",
    `测试数据策略字段 ${requestLabel}`,
    invalidRows.length === 0
      ? `${deferCaseIds ? "计划覆盖范围" : "caseId"}、环境、数量与创建/处理明细均已声明。`
      : `${invalidRows.length} 条数据策略缺少合法环境、数量上限、覆盖范围、唯一合成标识、后续处理或清理说明。`
  );
}

function validateTaskExecutionList(plan: string, requestLabel: string) {
  const section = extractMarkdownSection(plan, taskExecutionListSection);
  const strict = hasStructureMarker(plan, taskExecutionListMarker);
  if (!strict) {
    record("WARN", "任务执行清单 " + requestLabel, "历史请求未标记 task-execution-list-v1，建议下次变更时补充任务状态与执行证据。");
    return;
  }

  const requiredHeaders = ["序号", "阶段", "任务", "进入条件", "完成标志", "状态", "当前结论 / 需要动作", "证据或输出"];
  const rows = parseMarkdownRows(section).filter((cells) => cells.length === requiredHeaders.length && cells[0] !== "序号");
  const hasHeader = requiredHeaders.every((header) => section.includes("| " + header + " |"));
  record(
    hasHeader && rows.length > 0 ? "PASS" : "FAIL",
    "任务执行清单结构 " + requestLabel,
    hasHeader && rows.length > 0
      ? "已记录 " + rows.length + " 项任务，并使用 task-execution-list-v1 结构。"
      : "缺少 task-execution-list-v1 标记、八列任务表头或至少一项任务。"
  );
  if (!hasHeader || rows.length === 0) {
    return;
  }

  const duplicateNumbers = rows
    .map((cells) => cells[0] ?? "")
    .filter((number, index, all) => all.indexOf(number) !== index);
  const incompleteRows = rows.filter((cells) => cells.some((cell) => !hasFilledValue(cell)));
  const invalidStatuses = rows.filter((cells) => !validTaskExecutionStatuses.has(cells[5] ?? "")).map((cells) => cells[0]);
  record(
    duplicateNumbers.length === 0 && incompleteRows.length === 0 && invalidStatuses.length === 0 ? "PASS" : "FAIL",
    "任务执行清单字段 " + requestLabel,
    duplicateNumbers.length > 0
      ? "存在重复任务序号：" + [...new Set(duplicateNumbers)].join("、") + "。"
      : incompleteRows.length > 0
        ? "存在未填写或仍为模板占位符的任务：" + incompleteRows.map((cells) => cells[0]).join("、") + "。"
        : invalidStatuses.length > 0
          ? "存在非法状态的任务：" + invalidStatuses.join("、") + "；仅允许“" + [...validTaskExecutionStatuses].join("、") + "”。"
          : "任务序号、阶段、条件、状态与输出字段完整。"
  );

  const blockedRows = rows.filter((cells) => cells[5] === "阻塞");
  const invalidBlockedRows = blockedRows.filter((cells) => {
    const detail = cells[6] ?? "";
    return !/(缺少项|缺少|原因)/.test(detail) || !detail.includes("影响") || !/(解除条件|恢复条件|解除|恢复)/.test(detail);
  });
  record(
    invalidBlockedRows.length === 0 ? "PASS" : "FAIL",
    "阻塞任务闭环 " + requestLabel,
    invalidBlockedRows.length === 0
      ? (blockedRows.length === 0 ? "当前没有阻塞任务。" : "每项阻塞任务均记录缺少项、影响和解除条件。")
      : "阻塞任务必须说明具体缺少项、影响和解除条件：" + invalidBlockedRows.map((cells) => cells[0]).join("、") + "。"
  );

  const confirmationRows = rows.filter((cells) => cells[5] === "等待确认");
  const invalidConfirmationRows = confirmationRows.filter((cells) => {
    const detail = cells[6] ?? "";
    return !detail.includes("最小问题") || !/(确认后动作|确认后)/.test(detail);
  });
  record(
    invalidConfirmationRows.length === 0 ? "PASS" : "FAIL",
    "待确认任务闭环 " + requestLabel,
    invalidConfirmationRows.length === 0
      ? (confirmationRows.length === 0 ? "当前没有等待确认任务。" : "每项等待确认任务均限定最小问题和确认后动作。")
      : "等待确认任务必须说明最小问题和确认后动作：" + invalidConfirmationRows.map((cells) => cells[0]).join("、") + "。"
  );

  const completedRows = rows.filter((cells) => cells[5] === "已完成");
  const invalidCompletedRows = completedRows.filter((cells) => {
    const evidence = cells[7] ?? "";
    return !hasFilledValue(evidence) || /^(无|不适用|待补充|未产出)$/.test(evidence);
  });
  record(
    invalidCompletedRows.length === 0 ? "PASS" : "FAIL",
    "已完成任务证据 " + requestLabel,
    invalidCompletedRows.length === 0
      ? (completedRows.length === 0 ? "当前没有已完成任务。" : "每项已完成任务均提供证据或输出。")
      : "已完成任务必须提供非空的证据或输出：" + invalidCompletedRows.map((cells) => cells[0]).join("、") + "。"
  );
}

function extractReviewBatches(section: string): Array<{ id: string; content: string }> {
  const canonical = [...section.matchAll(/<!-- review-batch:(REV-[A-Za-z0-9-]+):start -->([\s\S]*?)<!-- review-batch:\1:end -->/g)];
  if (canonical.length > 0) return canonical.map((match) => ({ id: match[1], content: match[0] }));
  const matches = [...section.matchAll(/^###\s+评审批次：\s*(REV-[A-Za-z0-9-]+)\s*$/gm)];
  return matches.map((match, index) => ({ id: match[1], content: section.slice(match.index, matches[index + 1]?.index) }));
}

function hasHighRiskCase(packagePaths: string[]): boolean {
  return packagePaths.some((packagePath) => /\|\s*风险等级\s*\|\s*高\s*\|/.test(readFileSync(packagePath, "utf8")));
}

function hasRecordedChange(plan: string): boolean {
  return /^\|\s*CHG-[A-Z0-9-]+\s*\|/m.test(extractMarkdownSection(plan, changeImpactSection));
}

function hasFilledValue(value: string): boolean {
  return Boolean(value.trim()) && !value.includes("<") && !value.includes(">");
}

function sameReviewRole(left: string, right: string): boolean {
  return left === right || ((left.includes(impactReviewRole) && right.includes(impactReviewRole)) || (left.includes(interactionReviewRole) && right.includes(interactionReviewRole)));
}

function referencedFindingIds(value: string): string[] {
  return [...new Set([...(value ?? "").matchAll(/MRR-[A-Z]+-[0-9]+/g)].map((match) => match[0]))].sort();
}

function sameFindingReferences(left: string, right: string): boolean {
  const leftIds = referencedFindingIds(left);
  const rightIds = referencedFindingIds(right);
  return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
}

function validateKnowledgeDecisions(
  batch: { id: string; content: string },
  findings: string[][],
  strict: boolean,
  requestLabel: string
) {
  const rows = parseMarkdownRows(batch.content);
  const hasTable = batch.content.includes("| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |");
  if (!strict) {
    record("WARN", `沉淀判定 ${requestLabel}/${batch.id}`, "历史请求未标记 knowledge-decision-v1，建议下次实质变更时补充沉淀判定。");
    return;
  }

  const decisions = rows
    .filter((cells) => cells.length === 5 && (cells[0] === "无" || ["需求事实", "通用规则", "项目经验候选", "项目经验", "未验证推断"].includes(cells[1] ?? "")))
    .map((cells) => ({
      findingId: cells[0] ?? "",
      scope: cells[1] ?? "",
      target: cells[2] ?? "",
      evidenceStatus: cells[3] ?? "",
      disposition: cells[4] ?? ""
    }));
  const issues = validateKnowledgeDecisionRows(
    findings.map((cells) => ({ id: cells[0] ?? "", category: cells[3] as "需求覆盖缺口" | "资料明确的设计缺口" | "业务裁决/资料冲突" | "质量建议" })),
    decisions as Parameters<typeof validateKnowledgeDecisionRows>[1]
  );
  const valid = hasTable && issues.length === 0;
  record(
    valid ? "PASS" : "FAIL",
    `沉淀判定 ${requestLabel}/${batch.id}`,
    valid
      ? (findings.length === 0
        ? (decisions.some((decision) => decision.findingId.startsWith("EXP-CAND-")) ? "本批次无评审发现项，项目经验候选已保留待验证。" : "本批次无发现项，已明确无需沉淀。")
        : "每项发现均已按需求事实、通用规则、项目经验候选或未验证推断完成分流。")
      : !hasTable
        ? "缺少“沉淀判定”表。"
        : issues.join("；") + "。"
  );
}

function validateReviewerExecutions(
  batch: { id: string; content: string },
  roleRows: string[][],
  requiredRoles: string[],
  strict: boolean,
  requestLabel: string
) {
  const hasTable = batch.content.includes("| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |");
  const executionRows = parseMarkdownRows(batch.content).filter(
    (cells) =>
      cells.length === 9 &&
      requiredRoles.some((role) => sameReviewRole(cells[0] ?? "", role))
  );
  const missingRoles = requiredRoles.filter(
    (role) => !executionRows.some((cells) => sameReviewRole(cells[0] ?? "", role))
  );
  const duplicateRoles = requiredRoles.filter(
    (role) => executionRows.filter((cells) => sameReviewRole(cells[0] ?? "", role)).length !== 1
  );
  const invalidRows = executionRows.filter((cells) => {
    const roleRow = roleRows.find((item) => sameReviewRole(item[0] ?? "", cells[0] ?? ""));
    return (
      cells[1] !== "真实子智能体" ||
      !hasFilledValue(cells[2] ?? "") ||
      cells[3] !== "fork_turns=none" ||
      !hasFilledValue(cells[4] ?? "") ||
      !validReviewerExecutionStatuses.has(cells[5] ?? "") ||
      cells[5] !== "已完成" ||
      !validReviewerConclusions.has(cells[6] ?? "") ||
      !roleRow ||
      cells[6] !== roleRow[2] ||
      !sameFindingReferences(cells[7] ?? "", roleRow[3] ?? "")
    );
  });
  const passed = hasTable && missingRoles.length === 0 && duplicateRoles.length === 0 && invalidRows.length === 0;
  record(
    statusFor(strict, passed),
    `真实 reviewer 执行记录 ${requestLabel}/${batch.id}`,
    passed
      ? "每个适用角色均记录真实子智能体任务标识、fork_turns=none 隔离、完成状态与对应结论。静态检查仅验证记录字段和关联，不能独立证明平台运行历史。"
      : `执行表=${hasTable ? "存在" : "缺失"}；缺少角色：${missingRoles.join("、") || "无"}；重复或不一一对应角色：${duplicateRoles.join("、") || "无"}；无效执行记录：${invalidRows.map((cells) => cells[0]).join("、") || "无"}。`
  );
}

function validateMultiRoleReview(
  plan: string,
  caseRecords: CaseRecord[],
  packagePaths: string[],
  reviewRequired: boolean,
  requestLabel: string
) {
  const strict = hasStructureMarker(plan, multiRoleReviewMarker) && reviewRequired;
  const strictEvidenceDriven = hasStructureMarker(plan, evidenceDrivenEvolutionMarker) && reviewRequired;
  const strictAutoEvolution = hasStructureMarker(plan, autoEvolutionLoopMarker) && reviewRequired;
  const strictKnowledgeDecision = hasStructureMarker(plan, knowledgeDecisionMarker) && reviewRequired;
  const generationStatus = extractTableCell(extractMarkdownSection(plan, "## 用例集生成状态"), "用例集状态");
  const executionRequired = hasStructureMarker(plan, reviewerExecutionMarker) && reviewRequired && ["待用户确认", "已确认"].includes(generationStatus);
  const section = extractMarkdownSection(plan, multiRoleReviewSection);
  const hasCanonicalOutsideSection = plan.replace(section, "").includes("<!-- review-batch:");
  const hasStructure = hasStructureMarker(section, multiRoleReviewMarker)
    && section.includes("| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |")
    && !hasCanonicalOutsideSection;
  record(
    statusFor(strict, Boolean(section) && hasStructure),
    `多角色评审结构 ${requestLabel}`,
    hasStructure
      ? "多角色评审记录区块及版本标记存在；静态检查不证明 reviewer 实际独立运行。"
      : strict
        ? "当前规范请求缺少多角色评审记录区块、角色结论表或版本标记，或 canonical 评审批次位于区块外。"
        : "历史请求未标记 multi-role-review-v1，建议在下次变更时补充评审记录。"
  );

  if (caseRecords.length === 0) {
    record("WARN", `多角色评审批次 ${requestLabel}`, "尚无完整原子用例，暂不要求填写实际 reviewer 结论。");
    return;
  }
  if (!reviewRequired) {
    record("WARN", `多角色评审批次 ${requestLabel}`, "用例集仍处于生成中，暂不要求 reviewer 批次；不得将其描述为评审完成。");
    return;
  }
  if (!strict) {
    record("WARN", `多角色评审批次 ${requestLabel}`, "存量请求未标记 multi-role-review-v1，仅提示补充，不迁移历史资产。");
    return;
  }
  if (!hasStructureMarker(plan, reviewerExecutionMarker)) {
    record(
      "WARN",
      `真实 reviewer 隔离 ${requestLabel}`,
      "评审记录未标记 reviewer-execution-v1；历史隔离结论不得描述为已验证的真实子智能体执行。"
    );
  }

  const batches = extractReviewBatches(section);
  if (batches.length === 0) {
    record("FAIL", `多角色评审批次 ${requestLabel}`, "存在原子用例但没有可解析的 REV-<序号> 评审批次。");
    return;
  }

  const impactRequired = hasHighRiskCase(packagePaths) || hasRecordedChange(plan);
  const interactionReviewRequired = parseRuleRecords(plan).some((rule) => rule.applicability === "适用" && ["页面交互", "状态流转"].includes(rule.type));
  let priorAutomaticRound: number | undefined;
  for (const [batchIndex, batch] of batches.entries()) {
    const rows = parseMarkdownRows(batch.content);
    const roleRows = rows
      .filter((cells) => cells.length === 9 && cells[1] === "真实子智能体")
      .map((cells) => [cells[0], cells[4], cells[6], cells[7], cells[8]]);
    const triggerType = extractTableCell(batch.content, "触发类型");
    const inputBaseline = extractTableCell(batch.content, "输入基线版本");
    const isolationRule = extractTableCell(batch.content, "隔离规则");
    const overallConclusion = extractTableCell(batch.content, "综合结论");
    const automaticRoundText = extractTableCell(batch.content, "自动演进轮次");
    const convergenceStatus = extractTableCell(batch.content, "收敛状态");
    const humanConfirmationStatus = extractTableCell(batch.content, "人工确认状态");
    const completeBatchMetadata =
      hasFilledValue(triggerType) &&
      hasFilledValue(inputBaseline) &&
      hasFilledValue(isolationRule) &&
      validBatchConclusions.has(overallConclusion) &&
      validHumanConfirmationStatuses.has(humanConfirmationStatus);
    record(
      completeBatchMetadata ? "PASS" : "FAIL",
      `评审批次元数据 ${requestLabel}/${batch.id}`,
      completeBatchMetadata
        ? "触发类型、输入基线、隔离规则、综合结论和人工确认状态完整。"
        : "评审批次缺少有效的触发类型、输入基线、隔离规则、综合结论或人工确认状态。"
    );
    if (strictAutoEvolution) {
      const automaticRound = Number(automaticRoundText);
      const repeatsPriorRound = batchIndex > 0 && (triggerType.includes("用户裁决") || triggerType.includes("恢复"));
      const expectedRound = batchIndex === 0
        ? 0
        : repeatsPriorRound
          ? priorAutomaticRound ?? -1
          : (priorAutomaticRound ?? -1) + 1;
      const expectedConvergence = overallConclusion === "可提交确认"
        ? "已收敛"
        : overallConclusion === "阻塞"
          ? "阻塞"
          : overallConclusion === "评审中"
            ? "等待 reviewer"
            : "继续自动演进";
      const validAutomaticLoopMetadata =
        Number.isInteger(automaticRound) &&
        automaticRound >= 0 &&
        automaticRound <= 3 &&
        automaticRound === expectedRound &&
        convergenceStatus === expectedConvergence &&
        !(automaticRound === 3 && overallConclusion === "需演进");
      record(
        validAutomaticLoopMetadata ? "PASS" : "FAIL",
        `自动演进轮次 ${requestLabel}/${batch.id}`,
        validAutomaticLoopMetadata
          ? `${repeatsPriorRound ? "用户裁决或恢复复审保持" : "自动演进进入"}第 ${automaticRound} 轮，且收敛状态一致。`
          : `自动演进轮次必须从 0 递增至 3；用户裁决或恢复复审只能保持前一轮次；收敛状态必须与综合结论一致，且第 3 轮不能仍为“需演进”。`
      );
      priorAutomaticRound = automaticRound;
    }
    const requiredRoles = impactRequired || triggerType.includes("高风险") || triggerType.includes("变更")
      ? [...baseReviewRoles, impactReviewRole]
      : baseReviewRoles;
    if (interactionReviewRequired) {
      requiredRoles.push(interactionReviewRole);
    }

    const missingRoles = requiredRoles.filter((role) =>
      !roleRows.some((cells) => (role === impactReviewRole || role === interactionReviewRole ? cells[0].includes(role) : cells[0] === role))
    );
    const incompleteRoles = roleRows
      .filter((cells) => requiredRoles.some((role) => (role === impactReviewRole || role === interactionReviewRole ? cells[0].includes(role) : cells[0] === role)))
      .filter((cells) => {
        const isImpactRole = cells[0].includes(impactReviewRole);
        const validConclusion = validReviewerConclusions.has(cells[2]) || (isImpactRole && cells[2] === "不适用" && !impactRequired);
        return !validConclusion || !validFindingStatuses.has(cells[4]);
      })
      .map((cells) => cells[0]);
    const reviewInProgress = overallConclusion === "评审中";
    record(
      missingRoles.length === 0 && incompleteRoles.length === 0 ? "PASS" : reviewInProgress ? "WARN" : "FAIL",
      `多角色覆盖 ${requestLabel}/${batch.id}`,
      missingRoles.length === 0 && incompleteRoles.length === 0
        ? `已记录${requiredRoles.join("、")}的独立结论和处理状态。`
        : `缺少角色：${missingRoles.join("、") || "无"}；结论或处理状态不完整：${incompleteRoles.join("、") || "无"}。`
    );
    if (executionRequired) {
      validateReviewerExecutions(batch, roleRows, requiredRoles, true, requestLabel);
    } else if (hasStructureMarker(plan, reviewerExecutionMarker)) {
      validateReviewerExecutions(batch, roleRows, requiredRoles, false, requestLabel);
    }

    // “沉淀判定”会复用发现项编号；只有九列正式发现项表可参与
    // 评审闭环，避免把五列沉淀行误判为未闭合发现。
    const findings = rows.filter((cells) => /^MRR-(?:[A-Z]+-)*[0-9]+$/.test(cells[0] ?? "") && (!strictEvidenceDriven || cells.length === 9));
    const findingIds = new Set(findings.map((cells) => cells[0]));
    validateKnowledgeDecisions(batch, findings, strictKnowledgeDecision, requestLabel);
    const invalidFindings = findings.filter((cells) => {
      if (strictEvidenceDriven) {
        return cells.length !== 9 || !hasFilledValue(cells[1] ?? "") || !hasFilledValue(cells[2] ?? "") || !validFindingCategories.has(cells[3] ?? "") || !hasFilledValue(cells[4] ?? "") || !hasFilledValue(cells[5] ?? "") || !validFindingDispositions.has(cells[6] ?? "") || !hasFilledValue(cells[7] ?? "") || !validFindingStatuses.has(cells[8] ?? "");
      }
      return cells.length !== 7 || !validFindingStatuses.has(cells[6] ?? "");
    });
    const pendingFindings = findings.filter((cells) => (strictEvidenceDriven ? cells[8] : cells[6]) === "待处理");
    const automaticFindings = strictEvidenceDriven ? findings.filter((cells) => cells[6] === "自动演进") : [];
    const invalidAutomaticFindings = automaticFindings.filter((cells) => {
      const resolution = cells[7] ?? "";
      return !["需求覆盖缺口", "资料明确的设计缺口"].includes(cells[3] ?? "") || cells[8] !== "已关闭" || extractCaseIds(resolution).length === 0 || !resolution.includes("资料证据");
    });
    const adjudicationFindings = strictEvidenceDriven ? findings.filter((cells) => cells[6] === "用户裁决") : [];
    const invalidAdjudications = adjudicationFindings.filter((cells) => {
      const resolution = cells[7] ?? "";
      const closedByUser = cells[8] === "已关闭";
      return cells[3] !== "业务裁决/资料冲突" || !hasFilledValue(cells[1] ?? "") || !hasFilledValue(cells[4] ?? "") || (closedByUser
        ? !resolution.includes("用户裁决")
        : !resolution.includes("最小待确认问题") || !resolution.includes("未裁决") || !/(适用待补充|受控执行)/.test(resolution));
    });
    const invalidRiskFindings = strictEvidenceDriven
      ? findings.filter((cells) => cells[6] === "风险登记" && (cells[3] !== "质量建议" || !cells[7]?.includes("非本次验收阻塞") || !["已关闭", "不适用"].includes(cells[8] ?? "")))
      : [];
    const roleFindingRefs = roleRows.flatMap((cells) => [...(cells[3] ?? "").matchAll(/(MRR-[A-Z]+-[0-9]+)/g)].map((match) => cells[0] + " → " + match[1]));
    const unknownFindingRefs = roleFindingRefs.filter((reference) => !findingIds.has(reference.split(" → ")[1] ?? ""));
    const canSubmit = overallConclusion === "可提交确认";
    const latestBatch = batch === batches.at(-1);
    const pendingAutomatic = automaticFindings.filter((cells) => cells[8] === "待处理");
    // “待用户裁决”可以在范围已界定时保留，不阻塞未受影响的明确功能用例；只有未处置的“待处理”才阻塞提交。
    const unresolvedAdjudications = adjudicationFindings.filter((cells) => cells[8] === "待处理");
    const unboundedAdjudications = adjudicationFindings.filter((cells) => {
      const resolution = cells[7] ?? "";
      return cells[8] !== "已关闭" && (!resolution.includes("最小待确认问题") || !resolution.includes("未裁决") || !/(适用待补充|受控执行)/.test(resolution));
    });
    const inconsistentOverall = strictEvidenceDriven && canSubmit && roleRows.some((cells) => ["需演进", "阻塞"].includes(cells[2] ?? ""));
    record(
      invalidFindings.length === 0 && invalidAutomaticFindings.length === 0 && invalidAdjudications.length === 0 && invalidRiskFindings.length === 0 && unknownFindingRefs.length === 0 && !inconsistentOverall && (!latestBatch || overallConclusion !== "需演进" || pendingAutomatic.length === 0) && (!canSubmit || (pendingFindings.length === 0 && unresolvedAdjudications.length === 0 && unboundedAdjudications.length === 0)) ? "PASS" : "FAIL",
      `评审发现项 ${requestLabel}/${batch.id}`,
      invalidFindings.length > 0
        ? `发现项结构、分类、处置方式或状态无效：${invalidFindings.map((cells) => cells[0]).join("、")}。`
        : invalidAutomaticFindings.length > 0
          ? `自动演进项必须填写资料证据、已修订 caseId 且关闭：${invalidAutomaticFindings.map((cells) => cells[0]).join("、")}。`
          : invalidAdjudications.length > 0
            ? `用户裁决项必须限定冲突、最小问题和未裁决用例状态：${invalidAdjudications.map((cells) => cells[0]).join("、")}。`
            : invalidRiskFindings.length > 0
              ? `风险登记必须为质量建议并标明“非本次验收阻塞”：${invalidRiskFindings.map((cells) => cells[0]).join("、")}。`
              : latestBatch && overallConclusion === "需演进" && pendingAutomatic.length > 0
                ? `最新“需演进”批次遗留待处理自动演进项：${pendingAutomatic.map((cells) => cells[0]).join("、")}。`
                : canSubmit && (pendingFindings.length > 0 || unresolvedAdjudications.length > 0 || unboundedAdjudications.length > 0)
                  ? `综合结论为“可提交确认”但仍有未闭环发现项：${[...pendingFindings, ...unresolvedAdjudications, ...unboundedAdjudications].map((cells) => cells[0]).join("、")}。`
                  : "发现项分类与闭环证据完整。"
    );
    if (strictEvidenceDriven && unknownFindingRefs.length > 0) {
      record("FAIL", "发现项引用 " + requestLabel + "/" + batch.id, "角色结论引用了不存在的发现项：" + unknownFindingRefs.join("、") + "。");
    }
    if (inconsistentOverall) {
      record("FAIL", "评审结论一致性 " + requestLabel + "/" + batch.id, "综合结论为“可提交确认”时，角色结论不得仍为“需演进”或“阻塞”。");
    }
    if (strictEvidenceDriven && batchIndex > 0) {
      const priorAutomaticIds = new Set(
        batches[batchIndex - 1].content
          .split("\n")
          .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
          .filter((cells) => cells[6] === "自动演进")
          .map((cells) => cells[0])
      );
      if (priorAutomaticIds.size > 0) {
        const priorCaseIds = extractCaseIds(batches[batchIndex - 1].content);
        const hasRevisionEvidence = [...priorAutomaticIds].every((id) => batch.content.includes(id)) || priorCaseIds.some((caseId) => batch.content.includes(caseId));
        record(
          hasRevisionEvidence ? "PASS" : overallConclusion === "评审中" ? "WARN" : "FAIL",
          "自动演进复审 " + requestLabel + "/" + batch.id,
          hasRevisionEvidence ? "后续评审批次保留了前批次自动演进项的复审证据。" : "前批次自动演进项未在后续评审批次中留下复审证据。"
        );
      }
    }
  }
  if (strictAutoEvolution) {
    const latest = batches.at(-1);
    const latestConclusion = latest ? extractTableCell(latest.content, "综合结论") : "";
    const latestConvergence = latest ? extractTableCell(latest.content, "收敛状态") : "";
    const readyForUserConfirmation = latestConclusion === "可提交确认" && latestConvergence === "已收敛";
    const safelyBlocked = latestConclusion === "阻塞" && latestConvergence === "阻塞";
    const reviewInProgress = latestConclusion === "评审中" && latestConvergence === "等待 reviewer";
    record(
      readyForUserConfirmation || safelyBlocked ? "PASS" : reviewInProgress ? "WARN" : "FAIL",
      `自动演进收敛 ${requestLabel}`,
      readyForUserConfirmation
        ? "最新最终复审已收敛，可进入一次用户确认。"
        : safelyBlocked
          ? "最新最终复审以最小解除条件阻塞；TASK-04 必须保持待恢复，不得提交。"
        : reviewInProgress
          ? "最新最终复审仍在收集真实 reviewer 结论；任务保持可恢复，尚不可请求用户确认。"
          : "自动演进未收敛；必须继续自动复审或以“阻塞”记录最小解除条件，不得请求普通继续操作。"
    );
  }
}

function validateCasePackage(packagePath: string, strict: boolean, sourceLinks: Set<string>, requestLabel: string) {
  const content = readFileSync(packagePath, "utf8");
  const caseBlocks = content.split(/^## 测试用例：/m).slice(1);
  const packageName = packagePath.split(sep).at(-1) ?? packagePath;
  validateMarkdownLineBreaks(content, `${requestLabel}/${packageName}`, strict);
  validateMarkdownTableStructure(content, `${requestLabel}/${packageName}`, strict);
  if (caseBlocks.length === 0) {
    record("WARN", `原子用例 ${requestLabel}/${packageName}`, "用例包尚无完整原子用例，暂不校验字段关联。");
    return [];
  }

  const requiredFields = [
    ["稳定 caseId", /\|\s*用例编号\s*\|\s*[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\s*\|/],
    ["需求追溯", /\|\s*需求追溯编号\s*\|\s*REQ-[A-Z0-9]+(?:-[A-Z0-9]+)+/],
    ["前置条件", /## 前置条件\s*\n\s*[-*]\s*\S/],
    ["操作步骤", /## 操作步骤[\s\S]*?\|\s*\d+\s*\|\s*[^\n|]+\|\s*[^\n|]*\|\s*[^\n|]+\|/],
    ["最终预期结果", /## 预期结果\s*\n\s*[-*]\s*(?!.*(?:页面正常|操作成功|符合预期))\S/],
    ["覆盖关联", /## 覆盖关联/],
    ["覆盖拆分项", /\|\s*覆盖域\s*\|\s*覆盖拆分项\s*\|/]
  ] as const;

  for (const [field, pattern] of requiredFields) {
    const incomplete = caseBlocks.filter((caseBlock) => !pattern.test(caseBlock)).length;
    const status: CheckStatus = incomplete === 0 ? "PASS" : strict ? "FAIL" : "WARN";
    record(
      status,
      `${field} ${requestLabel}/${packageName}`,
      incomplete === 0
        ? `${caseBlocks.length} 条原子用例均已关联。`
        : `${incomplete}/${caseBlocks.length} 条原子用例缺少${field}${strict ? "。" : "；历史请求建议迁移到 coverage-inventory-v1。"}`
    );
  }

  const invalidSources = caseBlocks.filter((caseBlock) => {
    const sourceSection = extractMarkdownSection(caseBlock, "## 来源");
    const links = extractMarkdownLinks(sourceSection);
    return !sourceSection || (links.length === 0 && !sourceSection.includes("仅对话附件，暂无持久链接")) || links.some((link) => !sourceLinks.has(link));
  }).length;
  record(
    invalidSources === 0 ? "PASS" : strict ? "FAIL" : "WARN",
    `引用资料链接 ${requestLabel}/${packageName}`,
    invalidSources === 0
      ? `${caseBlocks.length} 条原子用例均回链到计划中的实际引用资料。`
      : `${invalidSources}/${caseBlocks.length} 条原子用例缺少可点击来源，或来源未列入计划实际引用资料。`
  );

  return extractCaseRecords(packagePath);
}

function validateTraceability(plan: string, caseRecords: CaseRecord[], strict: boolean, requestLabel: string) {
  if (caseRecords.length === 0) {
    record("WARN", `深度追溯 ${requestLabel}`, "尚无完整原子用例，暂不校验 REQ 与 caseId 的双向关系。");
    return;
  }

  const requirementTraces = parseRequirementTraces(plan);
  if (requirementTraces.length === 0) {
    record(statusFor(strict, false), `深度追溯 ${requestLabel}`, "需求追溯矩阵没有可解析的 REQ 行。");
    return;
  }

  const caseIds = caseRecords.map((caseRecord) => caseRecord.caseId);
  const caseIdSet = new Set(caseIds);
  const duplicateCaseIds = [...new Set(caseIds.filter((caseId, index) => caseIds.indexOf(caseId) !== index))];
  record(
    statusFor(strict, duplicateCaseIds.length === 0),
    `caseId 唯一性 ${requestLabel}`,
    duplicateCaseIds.length === 0 ? "原子用例编号无重复。" : `重复 caseId：${duplicateCaseIds.join("、")}。`
  );

  const missingApplicableLinks = requirementTraces.filter((trace) => trace.applicable && trace.caseIds.length === 0);
  record(
    statusFor(strict, missingApplicableLinks.length === 0),
    `适用需求关联 ${requestLabel}`,
    missingApplicableLinks.length === 0
      ? "每项适用 REQ 均关联至少一个 caseId。"
      : `缺少 caseId 的适用 REQ：${missingApplicableLinks.map((trace) => trace.traceId).join("、")}。`
  );

  const missingCases = requirementTraces.flatMap((trace) => trace.caseIds.filter((caseId) => !caseIdSet.has(caseId)).map((caseId) => `${trace.traceId} → ${caseId}`));
  record(
    statusFor(strict, missingCases.length === 0),
    `需求回链存在性 ${requestLabel}`,
    missingCases.length === 0 ? "需求追溯矩阵关联的 caseId 均存在。" : `不存在的 caseId：${missingCases.join("、")}。`
  );

  const tracesByCaseId = new Map<string, Set<string>>();
  for (const trace of requirementTraces) {
    for (const caseId of trace.caseIds) {
      const traceIds = tracesByCaseId.get(caseId) ?? new Set<string>();
      traceIds.add(trace.traceId);
      tracesByCaseId.set(caseId, traceIds);
    }
  }

  const orphanCaseIds = caseRecords.filter((caseRecord) => !tracesByCaseId.has(caseRecord.caseId)).map((caseRecord) => caseRecord.caseId);
  record(
    statusFor(strict, orphanCaseIds.length === 0),
    `孤儿 caseId ${requestLabel}`,
    orphanCaseIds.length === 0 ? "每个 caseId 都被需求追溯矩阵关联。" : `未被需求追溯矩阵关联：${[...new Set(orphanCaseIds)].join("、")}。`
  );

  const traceIdSet = new Set(requirementTraces.map((trace) => trace.traceId));
  const invalidCaseTraces = caseRecords.flatMap((caseRecord) => caseRecord.traceIds.filter((traceId) => !traceIdSet.has(traceId)).map((traceId) => `${caseRecord.caseId} → ${traceId}`));
  record(
    statusFor(strict, invalidCaseTraces.length === 0),
    `用例追溯存在性 ${requestLabel}`,
    invalidCaseTraces.length === 0 ? "用例中的需求追溯编号均存在于计划。" : `不存在的需求追溯编号：${invalidCaseTraces.join("、")}。`
  );

  const inconsistentLinks = caseRecords.flatMap((caseRecord) => {
    const expectedTraceIds = tracesByCaseId.get(caseRecord.caseId);
    if (!expectedTraceIds) {
      return [];
    }
    const missingReverseLinks = [...expectedTraceIds]
      .filter((traceId) => !caseRecord.traceIds.includes(traceId))
      .map((traceId) => `${traceId} → ${caseRecord.caseId}`);
    const unexpectedReverseLinks = caseRecord.traceIds
      .filter((traceId) => !expectedTraceIds.has(traceId))
      .map((traceId) => `${caseRecord.caseId} → ${traceId}`);
    return [...missingReverseLinks, ...unexpectedReverseLinks];
  });
  record(
    statusFor(strict, inconsistentLinks.length === 0),
    `双向追溯一致性 ${requestLabel}`,
    inconsistentLinks.length === 0 ? "计划与用例包的 REQ ↔ caseId 关系一致。" : `用例包缺少反向追溯：${inconsistentLinks.join("、")}。`
  );
}

function validateRuleCoverageGate(plan: string, caseRecords: CaseRecord[], requestLabel: string) {
  const strict = hasStructureMarker(plan, RULE_COVERAGE_MARKER);
  const generationStatus = extractTableCell(extractMarkdownSection(plan, "## 用例集生成状态"), "用例集状态");
  const requireCaseLinks = ["待评审", "待用户确认", "已确认"].includes(generationStatus);
  const issues = validateRuleCoverage(plan, caseRecords, { requireCaseLinks });
  if (!strict) {
    record("WARN", `规则覆盖台账 ${requestLabel}`, "历史请求未标记 rule-coverage-v1，保持兼容；首次实质变更时必须迁移为 RULE ↔ caseId 双向追溯。");
    return;
  }
  if (issues.length === 0) {
    record("PASS", `规则覆盖质量门禁 ${requestLabel}`, `${summarizeRuleCoverage(plan)}${requireCaseLinks ? " 已进入评审前阶段，执行 RULE ↔ caseId 双向校验。" : " 计划阶段仅校验 REQ → RULE、设计证据与适用性依据。"}`);
    return;
  }
  for (const issue of issues) {
    record("FAIL", `${issue.name} ${requestLabel}`, issue.detail);
  }
  record("FAIL", `规则覆盖统计 ${requestLabel}`, summarizeRuleCoverage(plan));
}

function validateRuleDesignPreflight(plan: string, requestLabel: string) {
  const strict = hasStructureMarker(plan, ruleDesignMatrixMarker);
  const generationStatus = extractTableCell(extractMarkdownSection(plan, "## 用例集生成状态"), "用例集状态");
  if (!strict) {
    record(
      ["待评审", "待用户确认", "已确认"].includes(generationStatus) ? "FAIL" : "WARN",
      `规则设计矩阵 ${requestLabel}`,
      "缺少 rule-design-matrix-v1；进入评审前必须补齐从已引用 RULE 派生的规则设计矩阵。"
    );
    return;
  }
  const issues = validateRuleDesignMatrix(plan);
  if (issues.length === 0) {
    record("PASS", `规则设计预检 ${requestLabel}`, "适用 RULE 的必填/选填、输入、可观察预期、前置、门禁和 caseId 已形成可审查矩阵。");
    return;
  }
  for (const issue of issues) record("FAIL", `规则设计预检 ${requestLabel}`, issue);
}

function checkDocumentationBoundaries() {
  const sourcesReadme = readProjectFile("sources/README.md");
  const projectKnowledgeReadme = readProjectFile("docs/testing/knowledge/README.md");
  const testcasesReadme = readProjectFile("testcases/README.md");
  const testcaseGuideline = readProjectFile("docs/testing/testcase-guideline.md");
  const automationGuideline = readProjectFile("docs/testing/automation-guideline.md");
  const selectorGuideline = readProjectFile("docs/testing/selector-guideline.md");
  const environmentGuideline = readProjectFile("docs/testing/environment-guideline.md");
  const reportGuideline = readProjectFile("docs/testing/report-guideline.md");
  const scriptsReadme = readProjectFile("scripts/README.md");
  const testingSkill = readProjectFile("skills/iot-automation-testing/SKILL.md");
  const testPlanTemplate = readProjectFile("skills/iot-automation-testing/templates/test-plan.template.md");
  const playwrightSpecTemplate = readProjectFile("skills/iot-automation-testing/templates/playwright.spec.template.ts");
  const testcasePackageTemplate = readProjectFile("skills/iot-automation-testing/templates/testcase-package.template.md");
  const testcaseTemplate = readProjectFile("skills/iot-automation-testing/templates/testcase.template.md");
  const taskStateTypes = readProjectFile("src/support/task-state/types.ts");
  const taskStateManager = readProjectFile("src/support/task-state/testTaskStateManager.ts");
  const taskStateStore = readProjectFile("src/support/task-state/taskStateStore.ts");
  const executionAuthorization = readProjectFile("src/support/task-state/executionAuthorization.ts");
  const automationMode = readProjectFile("src/support/web/automationMode.ts");
  const testDataTypes = readProjectFile("src/support/test-data/types.ts");
  const testDataManager = readProjectFile("src/support/test-data/testDataManager.ts");
  const formalExecutionTypes = readProjectFile("src/support/formal-execution/types.ts");
  const formalExecutionManifest = readProjectFile("src/support/formal-execution/manifest.ts");
  const formalExecutionStore = readProjectFile("src/support/formal-execution/formalExecutionStore.ts");
  const formalCase = readProjectFile("src/support/formal-execution/formalCase.ts");
  const formalFixture = readProjectFile("src/fixtures/formalWebFixture.ts");
  const formalRunner = readProjectFile("scripts/run-formal-web-tests.ts");
  const playwrightConfig = readProjectFile("playwright.config.ts");
  const playwrightDebugConfig = readProjectFile("playwright.debug.config.ts");
  const taskGate = readProjectFile("src/support/task-state/gate.ts");
  const stopHook = readProjectFile("scripts/codex-stop-stage-envelope.mjs");
  const stopHookConfig = readProjectFile(".codex/hooks.json");
  const docsIndex = readProjectFile("docs/testing/README.md");
  const taskOutput = readProjectFile("src/support/task-state/taskOutput.ts");
  const candidateStore = readProjectFile("src/support/project-knowledge/candidateStore.ts");
  const candidateScript = readProjectFile("scripts/manage-project-knowledge.ts");
  const packageJsonText = readProjectFile("package.json");
  const agents = readProjectFile("AGENTS.md");
  const rootReadme = readProjectFile("README.md");

  // Historical phrase checks are retained only as source context while responsibility
  // ownership is migrated. New validation deliberately checks links and structures,
  // rather than requiring every document to repeat the same protocol prose.
  const legacyChecks = [
    ["知识资料与项目经验边界", sourcesReadme.includes("原始知识资料库") && projectKnowledgeReadme.includes("项目测试经验") && projectKnowledgeReadme.includes("不得复制需求正文") && automationGuideline.includes("项目测试经验库只沉淀已验证的测试策略"), "原始知识资料库与项目测试经验库的职责、冲突优先级或复制边界不完整。"],
    ["资料目录", sourcesReadme.includes("`knowledge-base/`") && sourcesReadme.includes("`indexes/`"), "sources/README.md 未说明 knowledge-base/ 或 indexes/ 职责。"],
    ["章节级知识检索", sourcesReadme.includes("knowledge_indexes") && automationGuideline.includes("受控章节索引") && testingSkill.includes("sectionId") && testPlanTemplate.includes("manifest id / sectionId") && rootReadme.includes("check:knowledge-index"), "原始资料、流程、Skill、模板或命令入口缺少章节级知识检索规则。"],
    ["实际引用资料告知", automationGuideline.includes("本轮实际引用资料") && testcaseGuideline.includes("实际引用清单") && testingSkill.includes("本轮实际引用资料") && testPlanTemplate.includes("实际引用资料清单") && testPlanTemplate.includes("本次用途"), "流程、用例规范、Skill 或计划模板缺少实际引用资料的记录与用户告知规则。"],
    ["引用资料可点击定位", automationGuideline.includes("可点击资料链接") && testcaseGuideline.includes("可点击的仓库相对 Markdown 链接") && testingSkill.includes("可点击资料链接") && testPlanTemplate.includes("可点击资料链接") && testPlanTemplate.includes("仅对话附件，暂无持久链接"), "流程、用例规范、Skill 或计划模板缺少可点击资料链接、章节定位或对话附件边界。"],
    ["用例集生成闭环", automationGuideline.includes("用例集生成状态") && testcaseGuideline.includes("用例集生成状态与包级闭环") && testingSkill.includes("用例集生成状态") && hasStructureMarker(testPlanTemplate, testcaseGenerationMarker) && testPlanTemplate.includes("待生成或待补齐用例包"), "流程、用例规范、Skill 或计划模板缺少用例集生成状态和包级闭环门禁。"],
    ["Markdown 写入格式", testcaseGuideline.includes("表头、分隔行及每条数据行必须保持相同列数") && testcaseGuideline.includes("转义序列作为正文换行") && automationGuideline.includes("Markdown 表格或换行失败") && testingSkill.includes("Markdown 表格列数不一致") && testPlanTemplate.includes("表格写入约束") && testcasePackageTemplate.includes("反斜杠转义序列") && testcaseTemplate.includes("转义形式的换行标记"), "用例规范、流程、Skill 或模板缺少 Markdown 表格完整性、真实换行或展示前校验门禁。"],
    ["测试数据脚本边界", !environmentGuideline.includes("scripts/prepare-test-data.ts") && !environmentGuideline.includes("scripts/cleanup-test-data.ts") && environmentGuideline.includes("当前已确认测试请求"), "环境规范仍引用已归档的固定测试数据脚本，或未要求数据操作关联当前测试请求。"],
    ["本机测试数据生命周期", environmentGuideline.includes(".local/test-ledger/") && testcaseGuideline.includes("cleanupActionId") && automationGuideline.includes("cleanupActionId") && reportGuideline.includes(".local/test-ledger/") && testingSkill.includes(".local/test-ledger/") && testPlanTemplate.includes("### 写入策略明细") && testPlanTemplate.includes("cleanupActionId") && existsSync(resolve(projectRoot, "src/support/test-data/testDataManager.ts")) && existsSync(resolve(projectRoot, "src/support/test-data/recover.ts")) && existsSync(resolve(projectRoot, "src/fixtures/testDataFixture.ts")) && !existsSync(resolve(projectRoot, "src/support/testDataLedger.ts")), "环境、用例、流程、报告、Skill、模板、台账能力或旧台账迁移规则不完整。"],
    ["计划环境状态", environmentGuideline.includes("测试计划安全环境预检") && environmentGuideline.includes("默认候选环境") && automationGuideline.includes("默认将 `test` 写为候选环境") && automationGuideline.includes("check:environment -- --plan") && testingSkill.includes("未明确环境时默认 `test`") && hasStructureMarker(testPlanTemplate, environmentStatusMarker) && testPlanTemplate.includes("用户未指定环境时默认") && testPlanTemplate.includes("本地配置状态") && testPlanTemplate.includes("用户确认状态"), "环境规范、流程、Skill 或计划模板缺少 test 默认候选、安全预检或三层环境状态规则。"],
    ["静态资产选择门禁", agents.includes("`test-assets/manifest.yaml`") && automationGuideline.includes("test-assets/manifest.yaml") && automationGuideline.includes("不能阻塞计划或用例生成") && environmentGuideline.includes("--asset <assetId>") && testcaseGuideline.includes("测试资产选择记录") && testingSkill.includes("test-assets/manifest.yaml") && hasStructureMarker(testPlanTemplate, testAssetSelectionMarker) && testPlanTemplate.includes("## 测试资产选择") && rootReadme.includes("check:test-assets") && scriptsReadme.includes("test-assets:select") && readProjectFile("scripts/reset-full-test-state.ts").includes('"test-assets"'), "静态测试资产清单、选择、阶段门禁、重置保留或模板记录规则不完整。"],
    ["完整测试状态重置", rootReadme.includes("reset:full-test-state") && scriptsReadme.includes("reset-full-test-state.ts") && !scriptsReadme.includes("reset-local-test-state.ts") && testcasesReadme.includes("reset:full-test-state"), "README、脚本说明或用例归档说明缺少完整测试状态重置入口，或仍保留局部重置脚本说明。"],
    ["原始资料读取规则", sourcesReadme.includes("读取与登记规则") && automationGuideline.includes("sources/manifest.yaml") && testingSkill.includes("不得全量阅读 `sources/`"), "sources/、流程规范或 Skill 缺少按 manifest 筛选原始资料的规则。"],
    ["代码仓库定位边界", agents.includes("`.local/repositories/`：本机被测代码仓库根目录") && automationGuideline.includes("仓库路径、Graphify 图谱和源码定位依据只能写入当前测试请求的 `plan.md` 工程层") && testingSkill.includes("不得将代码仓库或图谱登记到 `sources/manifest.yaml`") && testPlanTemplate.includes("| 代码仓库 | `.local/repositories/<repository>` |"), "代码仓库位置未在工程层规则、Skill、模板或目录边界中保持一致。"],
    ["自动化代码归档", agents.includes("`archive/automation/`：纳入 Git 的只读历史测试专用实现") && automationGuideline.includes("`archive/automation/` 中的内容是已废弃的测试专用实现") && testingSkill.includes("`archive/automation/` 仅在用户明确要求") && rootReadme.includes("archive/automation/"), "归档自动化代码的目录职责或默认隔离规则不完整。"],
    ["用例包结构", testcasesReadme.includes("cases-<module-a>.md"), "testcases/README.md 未使用用例包结构。"],
    ["用例单文件旧示例", !testcasesReadme.includes("<case-1>.md"), "testcases/README.md 仍保留单用例文件结构。"],
    ["历史用例归档", testcasesReadme.includes("testcases/archive/") && testcaseGuideline.includes("归档请求只读") && automationGuideline.includes("匹配的活跃 `plan.md` 不存在时") && testingSkill.includes("当前请求没有活跃 `plan.md`") && testingSkill.includes("不能作为新测试的默认输入"), "流程、用例规范、入口说明或 Skill 缺少活跃计划重建与历史请求归档隔离规则。"],
    ["覆盖拆分规范", testcaseGuideline.includes("用例生成前的覆盖基准与拆分"), "testcase-guideline.md 未定义覆盖基准与拆分规则。"],
    ["规则设计预检与邻域复核", testcaseGuideline.includes("规则设计矩阵与严格预检") && testcaseGuideline.includes("规则邻域复核") && automationGuideline.includes("check:rule-design") && testingSkill.includes("规则设计矩阵") && testingSkill.includes("规则邻域") && testPlanTemplate.includes("## 规则设计矩阵") && testPlanTemplate.includes("## 规则邻域复核") && hasStructureMarker(testPlanTemplate, ruleDesignMatrixMarker) && scriptsReadme.includes("check:rule-design") && packageJsonText.includes('"check:rule-design"'), "规范、流程、Skill、模板或命令入口缺少严格规则设计预检或规则邻域复核。"],
    ["深度追溯规范", testcaseGuideline.includes("变更影响分析") && testcaseGuideline.includes("测试设计技术选择"), "testcase-guideline.md 未定义深度追溯、变更影响或测试设计技术规则。"],
    ["状态术语", testcaseGuideline.includes("草案 → draft") && !automationGuideline.includes("`draft`") && !automationGuideline.includes("`confirmed`"), "状态字段必须统一使用中文，并在用例规范中明确 statusCode 映射。"],
    ["计划文件模型", automationGuideline.includes("`testcases/<type>/<project>/<test-request>/plan.md`") && !automationGuideline.includes("文件名使用 `*.plan.md`") && !automationGuideline.includes("| 测试计划 | `*.plan.md`"), "流程规范仍使用 *.plan.md，未统一为测试请求目录中的 plan.md。"],
    ["规范差异告知", automationGuideline.includes("自动化规范差异的简短告知") && testPlanTemplate.includes("### 规范差异与用户告知") && testingSkill.includes("具体事实、受影响 `caseId`、自动化影响和最小处理建议"), "流程、模板或 Skill 缺少自动化规范差异的简短告知规则。"],
    ["覆盖拆分模板", testPlanTemplate.includes(coverageInventorySection) && testPlanTemplate.includes("### 测试设计技术与依据") && testPlanTemplate.includes(changeImpactSection) && hasStructureMarker(testPlanTemplate, testcaseStandardMarker), "测试计划模板缺少覆盖拆分、测试设计技术、变更影响或版本标记。"],
    ["多角色评审流程", automationGuideline.includes("真实、只读的 reviewer 子智能体") && testcaseGuideline.includes("真实子智能体隔离评审") && testcaseGuideline.includes("需求一致性评审") && testcaseGuideline.includes("追溯审计"), "流程或用例规范缺少真实子智能体隔离评审规则。"],
    ["多角色评审提示卡", testingSkill.includes("多角色隔离评审提示卡") && testingSkill.includes("spawn_agent") && testingSkill.includes("fork_turns=none") && testingSkill.includes("变更影响评审"), "Skill 未内嵌真实 reviewer 的角色提示卡或隔离启动规则。"],
    ["真实 reviewer 执行门禁", agents.includes("真实只读 reviewer 子智能体") && agents.includes("fork_turns=none") && automationGuideline.includes("reviewer-execution-v1") && automationGuideline.includes("不得降级为主 Agent 自评") && testcaseGuideline.includes("Agent 任务标识") && testcaseGuideline.includes("TASK-04"), "AGENTS、流程或用例规范缺少真实 reviewer、不可降级或 TASK-04 阻塞门禁。"],
    ["多角色评审模板", testPlanTemplate.includes(multiRoleReviewSection) && hasStructureMarker(testPlanTemplate, multiRoleReviewMarker) && hasStructureMarker(testPlanTemplate, evidenceDrivenEvolutionMarker) && hasStructureMarker(testPlanTemplate, reviewerExecutionMarker) && hasStructureMarker(testPlanTemplate, knowledgeDecisionMarker) && testPlanTemplate.includes("#### reviewer 执行记录") && testPlanTemplate.includes("#### 沉淀判定") && testPlanTemplate.includes("| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 |") && testPlanTemplate.includes("| 发现项编号 | 角色 | 证据 | 发现项分类 |") && testPlanTemplate.includes("| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |"), "测试计划模板缺少真实 reviewer 执行记录、证据驱动评审或沉淀判定结构。"],
    ["任务执行清单边界", agents.includes(".local/test-task-state/") && automationGuideline.includes("任务执行清单") && automationGuideline.includes("简短阶段进度表") && testcaseGuideline.includes("任务执行清单") && reportGuideline.includes(".local/test-task-state/") && testingSkill.includes("任务执行清单") && testingSkill.includes("简短进度") && hasStructureMarker(testPlanTemplate, taskExecutionListMarker) && testPlanTemplate.includes("| 序号 | 阶段 | 任务 | 进入条件 | 完成标志 | 状态 | 当前结论 / 需要动作 | 证据或输出 |"), "AGENTS、流程、用例、报告、Skill 或计划模板缺少本机任务状态与任务执行清单边界。"],
    ["本轮产出卡", automationGuideline.includes("本轮产出卡") && automationGuideline.includes("npm run task:output") && testingSkill.includes("本轮产出卡") && testPlanTemplate.includes("本机“本轮产出卡”") && taskStateTypes.includes("TaskOutputRef") && taskStateTypes.includes("test-task-state-v10") && taskStateManager.includes("recordTaskOutputs") && taskOutput.includes("assertSafeOutputPath") && taskOutput.includes("inferPreviewKind") && scriptsReadme.includes("task:output"), "流程、Skill、模板、本机任务状态或脚本说明缺少本轮产出卡、路径安全或预览类型能力。"],
    ["reviewer 任务状态门禁", taskStateTypes.includes("ReviewAgentExecution") && taskStateTypes.includes("ReviewBatch") && taskStateTypes.includes("ReviewTransaction") && taskStateManager.includes("completeReviewTransaction") && taskStateManager.includes("fork_turns=none") && taskStateManager.includes("真实子智能体") && scriptsReadme.includes("review-transaction-finalize"), "本机任务状态缺少 reviewer 执行记录、可恢复事务或 TASK-04 完成门禁。"],
    ["静态测试资产", agents.includes("`test-assets/`"), "AGENTS.md 未说明 test-assets/ 职责。"],
    ["本地认证会话", agents.includes("`.auth/`"), "AGENTS.md 未说明 .auth/ 职责。"],
    ["架构检查入口", rootReadme.includes("npm run check:architecture"), "README.md 未提供架构检查命令。"],
    ["Markdown 格式门禁", rootReadme.includes("npm run check:markdown") && scriptsReadme.includes("Markdown 格式门禁") && testingSkill.includes("npm run check:markdown"), "README、脚本说明或 Skill 缺少实际 Markdown 格式门禁入口。"]
  ] as const;

  const responsibilityDocuments = [
    automationGuideline,
    environmentGuideline,
    testcaseGuideline,
    selectorGuideline,
    reportGuideline
  ];
  const responsibilityMarkers = [
    "owns: automation.lifecycle",
    "owns: automation.environment",
    "owns: automation.testcases",
    "owns: automation.selectors",
    "owns: automation.reporting"
  ];
  const uniqueResponsibilityOwners = responsibilityMarkers.every(
    (marker) => responsibilityDocuments.reduce((total, content) => total + countOccurrences(content, marker), 0) === 1
  );
  const pageSessionSchemaFields = [
    "sessionGroupId",
    "targetRoute",
    "resetStrategy",
    "isolationReason",
    "executionOrder"
  ];
  const nonEnvironmentRuleDocuments = [
    automationGuideline,
    testcaseGuideline,
    selectorGuideline,
    reportGuideline,
    testingSkill,
    scriptsReadme
  ];
  const pageSessionSchemaHasSingleOwner = pageSessionSchemaFields.every(
    (field) =>
      environmentGuideline.includes(field)
      && testPlanTemplate.includes(field)
      && nonEnvironmentRuleDocuments.every((content) => !content.includes(field))
  );
  const evidenceSchemaFields = [
    "checkpointScreenshots",
    "videoReference",
    "traceReference",
    "sanitizedNetworkSummary",
    "sanitizedConsoleSummary",
    "redactionStatus"
  ];
  const nonReportRuleDocuments = [
    automationGuideline,
    environmentGuideline,
    testcaseGuideline,
    selectorGuideline,
    testingSkill,
    scriptsReadme,
    testPlanTemplate
  ];
  const evidenceSchemaHasSingleOwner = evidenceSchemaFields.every(
    (field) => reportGuideline.includes(field) && nonReportRuleDocuments.every((content) => !content.includes(field))
  );

  const checks = [
    ["责任文档索引", agents.includes("docs/testing/README.md") && docsIndex.includes("automation-guideline.md") && docsIndex.includes("testcase-guideline.md") && docsIndex.includes("environment-guideline.md") && docsIndex.includes("report-guideline.md"), "唯一职责索引或 AGENTS 引用缺失。"],
    ["成熟化规则唯一责任", uniqueResponsibilityOwners && docsIndex.includes("PageSessionGroup") && docsIndex.includes("CaseEvidenceBundle") && docsIndex.includes("Inspector/ARIA"), "五份责任规范的 owns 标记不唯一，或职责索引未覆盖页面会话、可见探索与逐用例证据。"],
    ["Web 可见 Inspector 探索门禁", automationGuideline.includes("新建或重新打开执行范围的 Web/H5 请求") && automationGuideline.includes("正式脚本阶段保持关闭") && selectorGuideline.includes("专用 Chrome 与 Playwright Inspector") && selectorGuideline.includes("ARIA 无障碍树") && selectorGuideline.includes("候选 locator") && selectorGuideline.includes("匹配数量") && selectorGuideline.includes("未解决问题") && testingSkill.includes("test:web:inspect") && testingSkill.includes("test:web:explore:reuse:inspect") && testingSkill.includes("确定性重放") && scriptsReadme.includes("test:web:inspect") && scriptsReadme.includes("test:web:explore:reuse:inspect"), "流程、定位规范、Skill 或命令说明未闭合正式脚本前的可见 Inspector/ARIA 探索门禁。"],
    ["Web 成熟化兼容边界", automationGuideline.includes("成熟化规则不迁移或改写生效前已有的计划、用例、脚本、运行记录与本机台账") && hasStructureMarker(testPlanTemplate, webScriptGovernanceMarker), "流程规范未声明仅面向新建或重开范围，或未来计划模板缺少 Web 成熟化标记。"],
    ["页面场景组契约", pageSessionSchemaHasSingleOwner && environmentGuideline.includes("一个可见 Chrome BrowserServer") && environmentGuideline.includes("异常 → 边界 → 正常") && environmentGuideline.includes("重建 Context/Page") && environmentGuideline.includes("不得重启 Chrome") && environmentGuideline.includes("认证或验证码") && testcaseGuideline.includes("恰好映射一个") && testcaseGuideline.includes("单 case 场景组") && hasStructureMarker(testPlanTemplate, pageSessionGroupMarker) && testPlanTemplate.includes("#### 页面场景组映射"), "PageSessionGroup 未由环境规范唯一维护，或复位、隔离、BrowserServer 复用及未来模板映射不完整。"],
    ["正式用例完整覆盖", testcaseGuideline.includes("正式执行清单和正式脚本中恰好出现一次") && testcaseGuideline.includes("不得成为静默省略依据") && testcaseGuideline.includes("每个 case 必须独立建立前置、复位和断言边界") && playwrightSpecTemplate.includes("formalCase("), "用例规范或未来 Playwright 模板未保证每个适用 caseId 唯一、独立地进入正式脚本。"],
    ["逐用例证据包契约", evidenceSchemaHasSingleOwner && reportGuideline.includes("CaseEvidenceBundle") && reportGuideline.includes("test.step") && reportGuideline.includes("证据包完整且脱敏状态有效") && reportGuideline.includes("状态只能为 `unknown`") && reportGuideline.includes("非敏感采集区间的完整 Trace") && reportGuideline.includes("安全替代证据") && hasStructureMarker(testPlanTemplate, caseEvidencePolicyMarker) && testPlanTemplate.includes("#### 证据策略映射") && playwrightSpecTemplate.includes("test.step") && playwrightSpecTemplate.includes("testInfo.attach"), "CaseEvidenceBundle 未由报告规范唯一维护，或通过/失败/敏感替代证据资格及未来模板不完整。"],
    ["成熟化规则去重", !testingSkill.includes("sessionGroupId") && !testingSkill.includes("checkpointScreenshots") && !testingSkill.includes("redactionStatus") && !scriptsReadme.includes("sessionGroupId") && !scriptsReadme.includes("checkpointScreenshots") && !scriptsReadme.includes("redactionStatus"), "Skill 或 scripts/README.md 复制了 PageSessionGroup 或 CaseEvidenceBundle 字段级规则。"],
    ["AGENTS 全局边界", !agents.includes("fork_turns=none") && !agents.includes("cleanupActionId") && !agents.includes("reviewer-execution-v1") && agents.includes("已引用资料能够明确证明的用例缺口必须自动修订") && agents.includes("未由已引用资料定义的行为不得作为通过/失败断言") && agents.includes("安全与数据边界") && agents.includes("目录边界") && agents.includes("`.local/test-ledger/`") && agents.includes("environment-guideline.md") && agents.includes(".local/test-task-state/") && agents.includes("不作为业务资料、发现项正文、正式评审证据"), "AGENTS.md 缺少自动评审、未定义行为或本机台账边界，或仍允许任务状态复制正式评审正文。"],
    ["连续自动演进", agents.includes("已引用资料能够明确证明的用例缺口必须自动修订") && automationGuideline.includes("连续自动演进与收敛") && automationGuideline.includes("第 3 轮") && testcaseGuideline.includes("自动演进的收敛只以客观证据判断") && testingSkill.includes("执行连续自动演进") && taskStateTypes.includes("maxAutomaticEvolutionRounds") && taskStateTypes.includes("test-task-state-v10") && taskStateManager.includes("revisionEvidence") && taskStateManager.includes("review_convergence_blocked"), "AGENTS、流程、用例规范、Skill 或任务状态缺少连续自动演进、三轮上限或收敛阻断门禁。"],
    ["短事务恢复门禁", automationGuideline.includes("claim token") && testingSkill.includes("claim token") && taskStateTypes.includes("ShortTransaction") && taskStateTypes.includes("WakeRequest") && taskStateManager.includes("claimNextShortTransaction") && taskStateManager.includes("commitShortTransaction") && taskStateManager.includes("requestTransactionConfirmation") && taskStateManager.includes("enqueueWakeIfRunnable") && taskStateStore.includes("commitSnapshot") && taskStateStore.includes("reconcileAuditLog") && scriptsReadme.includes("transaction-claim") && scriptsReadme.includes("wake-list"), "流程、Skill、命令或本机状态缺少租约、唯一下一动作、确认、唤醒、事件修复或 CAS 门禁。"],
    ["执行信封与宿主续跑", agents.includes("task:gate") && agents.includes("--assert-final") && automationGuideline.includes("owns: automation.lifecycle") && taskStateTypes.includes("ExecutionEnvelope") && taskStateTypes.includes("HostContinuationBinding") && taskStateTypes.includes("sessionId") && taskStateManager.includes("executionEnvelope") && taskStateManager.includes("blockForUnavailableHost") && taskGate.includes("--assert-final") && stopHook.includes("gate.ts") && stopHook.includes('decision: "block"') && !stopHook.includes("continue: false") && stopHook.includes("session_id") && stopHookConfig.includes('"Stop"') && testingSkill.includes("thread-heartbeat.prompt.md") && testingSkill.includes("host-block") && !testPlanTemplate.includes("stage-run-envelope-v1") && !testcaseGuideline.includes("| `active` |") && !testingSkill.includes("只有 `waiting_confirmation`"), "执行信封缺少唯一责任、可执行最终回复门禁、Stop Hook、任务级 heartbeat 绑定或宿主不可用阻塞，或非责任文件仍复制状态正文。"],
    ["流程规范职责", automationGuideline.includes("任务执行清单") && automationGuideline.includes("受控探索") && automationGuideline.includes("工程层进入条件") && automationGuideline.includes("testcase-guideline.md") && automationGuideline.includes("environment-guideline.md") && automationGuideline.includes("report-guideline.md"), "流程规范缺少生命周期职责或到责任文档的引用。"],
    ["用例规范职责", testcaseGuideline.includes("REQ ↔ RULE ↔ caseId") && testcaseGuideline.includes("规则覆盖台账") && testcaseGuideline.includes("需求缺口处置与沉淀判定") && testcaseGuideline.includes("真实子智能体隔离评审") && testcaseGuideline.includes("变更影响分析") && testcaseGuideline.includes("automation-guideline.md") && testcaseGuideline.includes("environment-guideline.md"), "用例规范缺少追溯、需求缺口分流、评审、变更影响或责任引用。"],
    ["环境规范职责", environmentGuideline.includes(".local/test-ledger/") && environmentGuideline.includes("cleanupActionId") && environmentGuideline.includes("测试数据") && environmentGuideline.includes("生产"), "环境规范缺少环境或测试数据生命周期正文。"],
    ["探索与执行模式", environmentGuideline.includes('`explore`') && environmentGuideline.includes('`execute`') && environmentGuideline.includes("业务写入预算") && automationMode.includes('AutomationMode = "explore" | "execute"') && automationMode.includes("installExploreMutationGuard") && playwrightConfig.includes('automationMode: "execute"') && playwrightDebugConfig.includes('automationMode: "explore"') && playwrightDebugConfig.includes("**/*.formal.spec.ts"), "环境规范或 Playwright 能力未实现探索零写入与正式执行隔离。"],
    ["创建意图与双状态报告", environmentGuideline.includes("CreateIntent") && environmentGuideline.includes("功能结论与数据卫生结论") && testDataTypes.includes('DataWritePolicy = "no_write" | "managed_cleanup" | "tracked_residual"') && testDataTypes.includes("CreateIntentRecord") && testDataManager.includes("reserveCreateIntent") && testDataManager.includes("reconcileCreateIntent") && testDataManager.includes("assertManagedWriteAllowed") && reportGuideline.includes("functionalStatus") && reportGuideline.includes("dataHygieneStatus"), "环境规范或台账未闭合创建意图，或报告规范未独立定义功能/数据卫生双状态。"],
    ["统一执行清单与范围重开", automationGuideline.includes("ExecutionAuthorizationSnapshot") && automationGuideline.includes("execution-scope-reopen") && taskStateTypes.includes("ExecutionAuthorizationSnapshot") && taskStateTypes.includes("test-task-state-v10") && taskStateManager.includes("createExecutionAuthorization") && taskStateManager.includes("reopenExecutionScope") && executionAuthorization.includes("loadConfirmedExecutionAuthorization") && scriptsReadme.includes("execution-authorization-request") && scriptsReadme.includes("execution-scope-reopen"), "流程规范或运行时缺少不可变统一执行清单、摘要校验或受控范围重开。"],
    ["正式执行生命周期", environmentGuideline.includes("setup → test → teardown → report") && playwrightConfig.includes('name: "formal-setup"') && playwrightConfig.includes('name: "formal-teardown"') && playwrightConfig.includes('"**/*.formal.spec.ts"') && packageJsonText.includes('"test:web:execute"') && existsSync(resolve(projectRoot, "tests/web/_lifecycle/formal.setup.ts")) && existsSync(resolve(projectRoot, "tests/web/_lifecycle/formal.teardown.ts")), "环境规范、Playwright project dependencies 或正式执行命令不完整。"],
    ["正式原子执行与依赖隔离", testcaseGuideline.includes("`formalCase()`") && testcaseGuideline.includes("一条测试只绑定一个 `caseId`") && automationGuideline.includes("固定单 worker") && automationGuideline.includes("无依赖用例") && environmentGuideline.includes("命名运行资源") && reportGuideline.includes("每个 `caseId` 必须恰好出现一次") && formalExecutionTypes.includes("FormalCaseDefinition") && formalExecutionTypes.includes("FormalCaseStatus") && formalExecutionManifest.includes("assertAcyclic") && formalExecutionStore.includes("FormalExecutionRecord") && formalExecutionStore.includes("reconcileOpenAttempts") && formalCase.includes("formalCase") && formalFixture.includes("PLAYWRIGHT_FORMAL_BROWSER_WS_ENDPOINT") && formalFixture.includes('scope: "worker"') && formalRunner.includes("chromium.launchServer") && formalRunner.includes("Only --request and --resume are allowed") && packageJsonText.includes('"test:web:execute": "tsx scripts/run-formal-web-tests.ts"') && playwrightConfig.includes("maxFailures: 0") && playwrightConfig.includes("formalLifecycleEnabled ? 1"), "原子 case 契约、能力/资源依赖、Runner 持有的单一浏览器进程、超时回收或受控完整入口不完整。"],
    ["数据规则唯一所有者", !automationGuideline.includes('type DataWritePolicy') && !testcaseGuideline.includes('type DataWritePolicy') && !testingSkill.includes('type DataWritePolicy') && !reportGuideline.includes('type DataWritePolicy') && !testcaseGuideline.includes("planned → creating") && !testingSkill.includes("planned → creating"), "运行模式、数据策略或创建意图状态正文被复制到非环境责任文档。"],
    ["报告规范职责", reportGuideline.includes("范围完成") && reportGuideline.includes("证据") && reportGuideline.includes("残留风险") && reportGuideline.includes("项目经验候选") && reportGuideline.includes("automation-guideline.md") && reportGuideline.includes("environment-guideline.md"), "报告规范缺少结果、证据、残留风险、项目经验提升或责任引用。"],
    ["偏好与项目经验双通道", agents.includes(".local/project-knowledge-candidates/") && reportGuideline.includes(".local/project-knowledge-candidates/") && projectKnowledgeReadme.includes("CAND-<编号>") && testcaseGuideline.includes("项目经验") && testingSkill.includes("CAND-<编号>") && testPlanTemplate.includes("CAND-<编号>") && candidateStore.includes("project-knowledge-candidates-v1") && candidateStore.includes("待验证") && candidateStore.includes("已提升") && candidateScript.includes("candidate-promote") && packageJsonText.includes("knowledge:manage"), "偏好、候选队列、直接经验提升、模板或候选管理入口不完整。"],
    ["Skill 编排边界", testingSkill.includes("任务阅读顺序") && testingSkill.includes("多角色隔离评审提示卡") && testingSkill.includes("每次回复的最小信息") && testingSkill.includes("automation-guideline.md") && testingSkill.includes("testcase-guideline.md") && !testingSkill.includes("cleanupActionId"), "Skill 应只保留阅读顺序、提示卡、回复格式及责任文档引用。"],
    ["计划模板结构", hasStructureMarker(testPlanTemplate, taskExecutionListMarker) && hasStructureMarker(testPlanTemplate, environmentStatusMarker) && hasStructureMarker(testPlanTemplate, testAssetSelectionMarker) && hasStructureMarker(testPlanTemplate, testcaseGenerationMarker) && hasStructureMarker(testPlanTemplate, testcaseStandardMarker) && hasStructureMarker(testPlanTemplate, ruleDesignMatrixMarker) && hasStructureMarker(testPlanTemplate, multiRoleReviewMarker) && hasStructureMarker(testPlanTemplate, reviewerExecutionMarker) && hasStructureMarker(testPlanTemplate, autoEvolutionLoopMarker) && hasStructureMarker(testPlanTemplate, knowledgeDecisionMarker) && hasStructureMarker(testPlanTemplate, webScriptGovernanceMarker) && hasStructureMarker(testPlanTemplate, pageSessionGroupMarker) && hasStructureMarker(testPlanTemplate, caseEvidencePolicyMarker), "测试计划模板缺少任务、资产、环境、用例、追溯、规则设计、评审、沉淀判定、页面场景组或证据策略结构标记。"],
    ["模板责任引用", testPlanTemplate.includes("automation-guideline.md") && testPlanTemplate.includes("testcase-guideline.md") && testPlanTemplate.includes("environment-guideline.md") && testPlanTemplate.includes("selector-guideline.md") && testPlanTemplate.includes("report-guideline.md") && testcaseTemplate.includes("testcase-guideline.md") && testcaseTemplate.includes("environment-guideline.md"), "计划或用例模板缺少责任文档引用。"],
    ["用例包模板结构", testcasePackageTemplate.includes("# 用例包") && testcasePackageTemplate.includes("用例目录") && testcasePackageTemplate.includes("反斜杠转义序列"), "用例包模板缺少必要结构或 Markdown 写入提示。"],
    ["历史请求兼容", testcaseGuideline.includes("历史计划") && testcaseGuideline.includes("兼容") && automationGuideline.includes("历史"), "规范未声明历史请求兼容方式。"],
    ["reviewer 任务状态门禁", taskStateTypes.includes("ReviewAgentExecution") && taskStateTypes.includes("ReviewBatch") && taskStateTypes.includes("ReviewTransaction") && taskStateTypes.includes("maxConcurrentReviewers") && taskStateTypes.includes("revisionDigest") && taskStateTypes.includes("planRecordDigest") && taskStateTypes.includes("lastSyncedAt") && taskStateTypes.includes("automaticEvolutionRound") && !taskStateTypes.includes("findingIds") && !taskStateTypes.includes("conclusion?:") && taskStateManager.includes("completeReviewTransaction") && taskStateManager.includes("readReviewPlanEvidence") && taskStateManager.includes("revisionEvidenceDigest") && taskStateManager.includes("syncFormalReviewRecord") && scriptsReadme.includes("review-transaction-finalize") && scriptsReadme.includes("task:confirm-plan"), "本机任务状态未收敛为 reviewer 运行事实、并发补派、可恢复事务与 plan.md 正式记录一致性门禁。"],
    ["静态测试资产", agents.includes("`test-assets/`"), "AGENTS.md 未说明 test-assets/ 职责。"],
    ["本地认证会话", agents.includes("`.auth/`"), "AGENTS.md 未说明 .auth/ 职责。"],
    ["架构检查入口", rootReadme.includes("npm run check:architecture"), "README.md 未提供架构检查命令。"],
    ["本机维护命令优先", agents.includes("本机维护命令硬门禁") && agents.includes("不得先扫描目录后自行决定删除范围") && automationGuideline.includes("本机维护命令发现与执行") && automationGuideline.includes("不得用目录扫描或 `rm` 模拟") && testingSkill.includes("先读取 `package.json` 的 scripts 与 `scripts/README.md`") && scriptsReadme.includes("唯一入口") && rootReadme.includes("完整重置 / 清除所有测试数据 / 从头测试"), "AGENTS、流程、Skill、README 或脚本说明缺少本机维护命令发现、预演或命令优先门禁。"]
  ] as const;

  void legacyChecks;
  for (const [name, passed, failureDetail] of checks) {
    record(passed ? "PASS" : "FAIL", name, passed ? "文档职责与目录规则一致。" : failureDetail);
  }

  validateMarkdownTableStructure(testPlanTemplate, "测试计划模板", true);
  validateMarkdownTableStructure(testcasePackageTemplate, "用例包模板", true);
  validateMarkdownTableStructure(testcaseTemplate, "原子用例模板", true);

  const packageJson = JSON.parse(readProjectFile("package.json")) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const maintenanceCommandsPresent = scripts["reset:full-test-state"] === "tsx scripts/reset-full-test-state.ts"
    && scripts["test-data:recover"] === "tsx src/support/test-data/recover.ts";
  record(
    maintenanceCommandsPresent ? "PASS" : "FAIL",
    "本机维护命令注册",
    maintenanceCommandsPresent
      ? "完整重置和本机台账恢复命令均已注册，且可由维护门禁发现。"
      : "缺少完整重置或本机台账恢复命令，无法作为维护请求的受控入口。"
  );
  const markdownFormatGatePresent = scripts["check:markdown"] === "tsx scripts/check-markdown-format.ts"
    && existsSync(resolve(projectRoot, "scripts/check-markdown-format.ts"))
    && existsSync(resolve(projectRoot, "scripts/markdown-format.ts"));
  record(
    markdownFormatGatePresent ? "PASS" : "FAIL",
    "Markdown 格式检查命令",
    markdownFormatGatePresent
      ? "实际 Markdown 文件检查与确定性分隔行修复入口存在。"
      : "缺少 check:markdown 命令或 Markdown 格式检查模块。"
  );
  record(
    scripts["reset:full-test-state"] === "tsx scripts/reset-full-test-state.ts" && existsSync(resolve(projectRoot, "scripts/reset-full-test-state.ts"))
      ? "PASS"
      : "FAIL",
    "完整重置命令",
    scripts["reset:full-test-state"] === "tsx scripts/reset-full-test-state.ts" && existsSync(resolve(projectRoot, "scripts/reset-full-test-state.ts"))
      ? "完整测试状态重置命令与脚本存在。"
      : "完整测试状态重置命令或脚本缺失。"
  );
  const localResetRemoved = !("reset:local-test-state" in scripts) && !existsSync(resolve(projectRoot, "scripts/reset-local-test-state.ts"));
  record(
    localResetRemoved ? "PASS" : "FAIL",
    "局部重置入口",
    localResetRemoved
      ? "未保留局部重置命令或脚本；完整重置是唯一入口。"
      : "仍保留 reset:local-test-state 命令或 reset-local-test-state.ts 脚本。"
  );
  const resetScript = readProjectFile("scripts/reset-full-test-state.ts");
  const resetPreservesSharedCapabilities = resetScript.includes("collectRequestTestFiles()")
    && resetScript.includes('type.name === "support"')
    && resetScript.includes('project.name.startsWith("_")')
    && resetScript.includes('request.name.startsWith("_")')
    && resetScript.includes("保留共享基础能力")
    && !resetScript.includes("testImplementationFiles")
    && !resetScript.includes("customScriptFiles");
  record(
    resetPreservesSharedCapabilities ? "PASS" : "FAIL",
    "完整重置共享能力保护",
    resetPreservesSharedCapabilities
      ? "完整重置只归档 tests/<type>/<project>/<request> 专属脚本，不扫描 scripts、src 或测试共享目录。"
      : "完整重置可能把工程命令、架构依赖或跨请求模块误判为请求专属实现。"
  );
  const debugConfig = readProjectFile("playwright.debug.config.ts");
  const debugUsesInspector = scripts["test:web:inspect"] === "playwright test --config=playwright.debug.config.ts --debug=inspector"
    && scripts["test:web:explore:reuse:inspect"]?.includes("--debug=inspector")
    && scripts["test:web:explore"] === "playwright test --config=playwright.debug.config.ts"
    && debugConfig.includes("headless: false")
    && debugConfig.includes('trace: "off"')
    && debugConfig.includes('screenshot: "off"')
    && debugConfig.includes('video: "off"');
  record(
    debugUsesInspector ? "PASS" : "FAIL",
    "Web 可见探索与 Inspector 调试命令",
    debugUsesInspector
      ? "test:web:inspect 与复用会话入口启动可见 Inspector；test:web:explore 仅保留为门禁后的确定性重放。"
      : "缺少默认可见 Inspector、复用会话 Inspector 或无正式产物的探索配置。"
  );
  const reusableExploreSession = scripts["playwright:explore-session"] === "tsx scripts/manage-playwright-explore-session.ts"
    && scripts["test:web:explore:reuse"]?.includes("PLAYWRIGHT_EXPLORE_CDP_URL=http://127.0.0.1:9323")
    && scripts["test:web:explore:reuse:inspect"]?.includes("--debug=inspector")
    && existsSync(resolve(projectRoot, "scripts/manage-playwright-explore-session.ts"))
    && scriptsReadme.includes("playwright:explore-session")
    && environmentGuideline.includes("专用调试会话")
    && testingSkill.includes("test:web:explore:reuse:inspect");
  record(
    reusableExploreSession ? "PASS" : "FAIL",
    "Web 受管探索会话",
    reusableExploreSession
      ? "隔离 Chrome 会话具备显式启动、复用、状态查询与停止入口，且未替代正式 Runner。"
      : "受管探索会话的命令、脚本或职责说明不完整。"
  );
  const localLedgerCommandsPresent =
    scripts["test-data:recover"] === "tsx src/support/test-data/recover.ts" &&
    scripts["test:test-data"] === "tsx --test tests/support/test-data/*.test.ts";
  record(
    localLedgerCommandsPresent ? "PASS" : "FAIL",
    "本机台账命令",
    localLedgerCommandsPresent
      ? "本机台账恢复与验证命令存在。"
      : "缺少 test-data:recover 或 test:test-data 命令。"
  );
  const taskStateModules = [
    "src/support/task-state/types.ts",
    "src/support/task-state/taskStateStore.ts",
    "src/support/task-state/testTaskStateManager.ts",
    "src/support/task-state/taskOutput.ts",
    "src/support/task-state/render.ts",
    "src/support/task-state/status.ts",
    "src/support/task-state/manage.ts"
  ];
  const missingTaskStateModules = taskStateModules.filter((path) => !existsSync(resolve(projectRoot, path)));
  const taskStateCommandsPresent =
    scripts["task:status"] === "tsx src/support/task-state/status.ts" &&
    scripts["task:initialize"] === "tsx src/support/task-state/manage.ts init" &&
    scripts["task:update"] === "tsx src/support/task-state/manage.ts update" &&
    scripts["task:output"] === "tsx src/support/task-state/manage.ts output" &&
    scripts["task:review"] === "tsx src/support/task-state/manage.ts";
  record(
    missingTaskStateModules.length === 0 && taskStateCommandsPresent ? "PASS" : "FAIL",
    "本机任务状态能力",
    missingTaskStateModules.length === 0 && taskStateCommandsPresent
      ? "任务状态模块与只读查询、初始化、更新、产出卡和 reviewer 门禁命令均存在；不读取本地运行状态。"
      : "缺少任务状态模块：" + (missingTaskStateModules.join("、") || "无") + "；命令状态：" + (taskStateCommandsPresent ? "完整" : "缺少或目标不一致") + "。"
  );
  const removedScriptNames = [
    "test:web:account-login",
    "test:web:login-verification",
    "test:web:firmware",
    "test:web:firmware-upload",
    "test:app:firmware-info",
    "test:all"
  ];
  const retainedRemovedScripts = removedScriptNames.filter((name) => name in scripts);
  record(
    retainedRemovedScripts.length === 0 ? "PASS" : "FAIL",
    "失效专用命令",
    retainedRemovedScripts.length === 0 ? "未保留已归档脚本的专用执行命令。" : `仍存在失效命令：${retainedRemovedScripts.join("、")}。`
  );

  const missingScriptTargets = Object.entries(scripts).flatMap(([name, command]) => {
    const testFiles = [...command.matchAll(/\b(tests\/[^\s'"`]+\.(?:spec|manual)\.ts)\b/g)].map((match) => match[1]);
    const configFiles = [...command.matchAll(/--config(?:=|\s+)([^\s'"`]+)/g)].map((match) => match[1]);
    return [...testFiles, ...configFiles]
      .filter((path) => !existsSync(resolve(projectRoot, path)))
      .map((path) => `${name} → ${path}`);
  });
  record(
    missingScriptTargets.length === 0 ? "PASS" : "FAIL",
    "执行命令目标",
    missingScriptTargets.length === 0 ? "活跃命令未引用不存在的测试文件或配置。" : `不存在的命令目标：${missingScriptTargets.join("、")}。`
  );
}

function listSourceMaterialFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory() && !(path === resolve(projectRoot, "sources") && entry.name === "indexes")) {
      files.push(...listSourceMaterialFiles(entryPath));
    } else if (entry.isFile() && entry.name !== "README.md" && entry.name !== "manifest.yaml") {
      files.push(relative(resolve(projectRoot, "sources"), entryPath));
    }
  }
  return files.sort();
}

function checkSourceManifest() {
  const manifest = readProjectFile("sources/manifest.yaml");
  const obsoleteFields = ["related_testcases", "received_at", "applicable_environments"].filter((field) => new RegExp(`^\\s+${field}:`, "m").test(manifest));
  record(
    obsoleteFields.length === 0 ? "PASS" : "FAIL",
    "资料总账字段边界",
    obsoleteFields.length === 0
      ? "manifest 仅保留资料身份、来源、版本、适用范围、状态和必要说明；测试追溯由 plan.md 管理。"
      : `manifest 不应保留已废弃字段：${obsoleteFields.join("、")}。`
  );
  const registeredPaths = [...new Set([...manifest.matchAll(/^\s{4}path:\s*(.+?)\s*$/gm)].map((match) => match[1]))];
  const registeredDirectories = registeredPaths.filter((path) => {
    const absolutePath = resolve(projectRoot, "sources", path);
    return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
  });
  const sourceFiles = listSourceMaterialFiles(resolve(projectRoot, "sources"));
  const unregistered = sourceFiles.filter(
    (path) => !registeredPaths.includes(path) && !registeredDirectories.some((directory) => path.startsWith(`${directory}/`))
  );
  const missingFiles = registeredPaths.filter((path) => !existsSync(resolve(projectRoot, "sources", path)));

  record(
    unregistered.length === 0 ? "PASS" : "FAIL",
    "原始资料登记",
    unregistered.length === 0 ? `sources/ 中 ${sourceFiles.length} 份原始资料均已登记。` : `未登记资料：${unregistered.join("、")}。`
  );
  record(
    missingFiles.length === 0 ? "PASS" : "FAIL",
    "原始资料路径",
    missingFiles.length === 0 ? "manifest 中的资料路径均存在。" : `登记路径不存在：${missingFiles.join("、")}。`
  );
  const hasCodeReference = /^code_references:/m.test(manifest) || manifest.includes(".local/repositories/");
  record(
    hasCodeReference ? "FAIL" : "PASS",
    "源码与资料隔离",
    hasCodeReference ? "sources/manifest.yaml 不得登记本机代码仓库或图谱。" : "manifest 仅登记 sources/ 中的原始资料；代码仓库位置由工程层管理。"
  );
}

function checkTestAssetManifest() {
  try {
    const errors = validateTestAssetManifest(loadTestAssetManifest());
    record(
      errors.length === 0 ? "PASS" : "FAIL",
      "静态测试资产清单",
      errors.length === 0 ? "test-assets/ 中全部非系统文件均已登记且完整性一致。" : errors.join("；")
    );
  } catch (error) {
    record("FAIL", "静态测试资产清单", error instanceof Error ? error.message : "无法读取 test-assets/manifest.yaml。");
  }
}

function checkTestRequestStructure() {
  let requestCount = 0;
  for (const type of testTypes) {
    const typePath = resolve(projectRoot, "testcases", type);
    for (const project of listDirectories(typePath)) {
      if (project === "shared") {
        continue;
      }
      for (const request of listDirectories(resolve(typePath, project))) {
        const requestPath = resolve(typePath, project, request);
        const markdownFiles = listMarkdownFiles(requestPath);
        if (markdownFiles.length === 0) {
          continue;
        }

        requestCount += 1;
        const requestLabel = `${type}/${project}/${request}`;
        const planPath = resolve(requestPath, "plan.md");
        if (!existsSync(planPath)) {
          record("FAIL", `测试请求 ${requestLabel}`, "存在测试资产但缺少 plan.md。");
          continue;
        }

        const plan = readFileSync(planPath, "utf8");
        // Active requests must never expose malformed Markdown, even when they
        // predate a newer content-schema marker.
        const strictCoverageInventory = true;
        const strictSourceReferenceLinks = hasStructureMarker(plan, sourceReferenceLinksMarker);
        const missingSections = requiredPlanSections.filter((section) => !plan.includes(section));
        record(
          missingSections.length === 0 ? "PASS" : "FAIL",
          `计划结构 ${requestLabel}`,
          missingSections.length === 0 ? "业务层必备区块完整。" : `缺少区块：${missingSections.join("、")}。`
        );
        validateMarkdownTableStructure(plan, requestLabel, strictCoverageInventory);
        validateMarkdownLineBreaks(plan, requestLabel, strictCoverageInventory);

        const sourceReferenceSection = extractMarkdownSection(plan, "## 输入资料");
        const sourceReferenceRows = sourceReferenceSection
          .split("\n")
          .filter((line) => line.trim().startsWith("|"))
          .filter((line) => !line.includes("---") && !line.includes("manifest id / sectionId"));
        const invalidSourceReferenceRows = sourceReferenceRows.filter(
          (line) => !line.includes("](") && !line.includes("仅对话附件，暂无持久链接")
        );
        const hasSourceReferenceStructure = sourceReferenceSection.includes("可点击资料链接");
        record(
          hasSourceReferenceStructure && invalidSourceReferenceRows.length === 0 ? "PASS" : strictSourceReferenceLinks ? "FAIL" : "WARN",
          `引用资料链接 ${requestLabel}`,
          hasSourceReferenceStructure && invalidSourceReferenceRows.length === 0
            ? "实际引用资料均提供可点击链接，或明确为无持久链接的对话附件。"
            : strictSourceReferenceLinks
              ? `引用资料表缺少可点击资料链接列，或存在未链接资料：${invalidSourceReferenceRows.join("、") || "无"}。`
              : "历史请求未标记 source-reference-links-v1，建议在下次变更时补充可点击资料链接。"
        );

        const hasCoverageInventory = plan.includes(coverageInventorySection);
        const hasCoverageInventoryStructure = plan.includes("### 基准资料与模块映射") && plan.includes("### 拆分清单") && plan.includes("### 测试设计技术与依据");
        record(
          hasCoverageInventory && hasCoverageInventoryStructure ? "PASS" : strictCoverageInventory ? "FAIL" : "WARN",
          `覆盖拆分 ${requestLabel}`,
          hasCoverageInventory && hasCoverageInventoryStructure
            ? "覆盖基准与拆分清单存在。"
            : strictCoverageInventory
              ? "当前规范请求缺少覆盖基准与拆分清单、测试设计技术或其必备表格。"
              : "历史请求未标记 coverage-inventory-v1，建议在下次变更时补充覆盖基准与拆分清单。"
        );

        const hasChangeImpactAnalysis = plan.includes(changeImpactSection);
        record(
          statusFor(strictCoverageInventory, hasChangeImpactAnalysis),
          `变更影响 ${requestLabel}`,
          hasChangeImpactAnalysis ? "变更影响分析区块存在。" : "缺少变更影响分析区块。"
        );

        const packageFiles = markdownFiles.filter((file) => file !== "plan.md");
        const invalidPackages = packageFiles.filter((file) => !/^cases-[a-z0-9][a-z0-9-]*\.md$/.test(file));
        record(
          invalidPackages.length === 0 ? "PASS" : "FAIL",
          `用例包命名 ${requestLabel}`,
          invalidPackages.length === 0 ? "仅使用 plan.md 和 cases-<module>.md。" : `不符合用例包命名：${invalidPackages.join("、")}。`
        );

        const planSourceLinks = new Set(extractMarkdownLinks(sourceReferenceSection));
        validateEnvironmentStatus(plan, requestLabel);
        validateTestDataPolicy(plan, requestLabel);
        validateTaskExecutionList(plan, requestLabel);
        const caseRecords = packageFiles.flatMap((packageFile) =>
          validateCasePackage(resolve(requestPath, packageFile), strictCoverageInventory || strictSourceReferenceLinks, planSourceLinks, requestLabel)
        );
        const reviewRequired = validateGenerationClosure(plan, packageFiles, caseRecords, requestLabel);
        validateTraceability(plan, caseRecords, reviewRequired, requestLabel);
        validateRuleCoverageGate(plan, caseRecords, requestLabel);
        validateRuleDesignPreflight(plan, requestLabel);
        const generationStatus = extractTableCell(extractMarkdownSection(plan, "## 用例集生成状态"), "用例集状态");
        if (["未开始", "生成中"].includes(generationStatus)) {
          record("PASS", `caseId 派生视图 ${requestLabel}`, "计划阶段尚未生成原子用例；仅校验 RULE 关系源，待阶段二生成后再同步派生 caseId 视图。");
        } else {
          const relationProjection = synchronizeRequest(requestPath, { check: true });
          if (!relationProjection.strict) {
          record("WARN", `caseId 派生视图 ${requestLabel}`, "历史请求未标记 case-relation-projection-v1，保持兼容；首次实质变更时启用单一 RULE 关系源。");
          } else if (relationProjection.issues.length === 0) {
          record("PASS", `caseId 派生视图 ${requestLabel}`, "需求、覆盖、用例包与原子用例视图均由 RULE → caseId 关系源同步。");
          } else {
          for (const issue of relationProjection.issues) {
            record("FAIL", `caseId 派生视图 ${requestLabel}/${issue.name}`, issue.detail);
          }
          }
        }
        validateMultiRoleReview(
          plan,
          caseRecords,
          packageFiles.map((packageFile) => resolve(requestPath, packageFile)),
          reviewRequired,
          requestLabel
        );

        if (packageFiles.some((file) => containsConfirmedCase(resolve(requestPath, file)))) {
          record(
            plan.includes(engineeringPlanSection) ? "PASS" : "FAIL",
            `工程层设计 ${requestLabel}`,
            plan.includes(engineeringPlanSection)
              ? "已确认用例对应的工程层设计区块存在。"
              : "存在已确认用例，但 plan.md 缺少工程层设计区块。"
          );
        } else {
          record("WARN", `工程层设计 ${requestLabel}`, "尚无已确认用例，暂不要求填写工程层设计区块。");
        }
      }
    }
  }
  record(requestCount > 0 ? "PASS" : "WARN", "测试请求发现", requestCount > 0 ? `检测到 ${requestCount} 个测试请求。` : "尚未发现测试请求资产。");
}

function walkTypeScriptFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function checkScriptMirrors() {
  let scriptCount = 0;
  for (const type of testTypes) {
    const typePath = resolve(projectRoot, "tests", type);
    for (const scriptPath of walkTypeScriptFiles(typePath)) {
      scriptCount += 1;
      const relativePath = relative(typePath, scriptPath).split(sep);
      const lifecycleHelper = relativePath[0] === "_lifecycle"
        && /\.(?:setup|teardown)\.ts$/.test(relativePath.at(-1) ?? "");
      const label = relative(projectRoot, scriptPath);
      if (lifecycleHelper) {
        record("PASS", `执行生命周期 ${label}`, "setup/teardown 是跨请求 Runner 门禁，不映射业务 caseId。");
        continue;
      }
      const validDepth = relativePath.length >= 3;
      const requestSegments = relativePath.slice(0, -1);
      const mirroredRequest = resolve(projectRoot, "testcases", type, ...requestSegments);
      const hasMirror = validDepth && existsSync(resolve(mirroredRequest, "plan.md"));
      const script = readFileSync(scriptPath, "utf8");
      const hasCaseId = /[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}/.test(script);
      record(
        hasMirror ? "PASS" : "FAIL",
        `脚本镜像 ${label}`,
        hasMirror ? "存在对应测试请求计划。" : "脚本必须位于 tests/<type>/<project>/<request>/ 并镜像到 testcases/。"
      );
      record(hasCaseId ? "PASS" : "FAIL", `用例关联 ${label}`, hasCaseId ? "检测到稳定 caseId。" : "脚本缺少稳定 caseId 关联。");

      if (scriptPath.endsWith(".formal.spec.ts")) {
        const packageCaseIds = validDepth
          ? listMarkdownFiles(mirroredRequest)
            .filter((file) => file !== "plan.md")
            .flatMap((file) => [...readFileSync(resolve(mirroredRequest, file), "utf8")
              .matchAll(/\|\s*用例编号\s*\|\s*([A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,})\s*\|/g)]
              .map((match) => match[1]!))
          : [];
        const inspection = inspectFormalSpecSource(script, packageCaseIds);
        const manifestPath = resolve(scriptPath, "..", "execution.manifest.ts");
        record(
          inspection.issues.length === 0 && existsSync(manifestPath)
            ? "PASS"
            : "FAIL",
          `正式原子脚本 ${label}`,
          inspection.issues.length > 0
            ? inspection.issues.join(" ")
            : !existsSync(manifestPath)
              ? "正式脚本缺少同目录 execution.manifest.ts。"
              : `每个确认 caseId 恰好注册一次，共 ${inspection.caseIds.length} 条。`
        );
      }
    }
  }
  record(scriptCount > 0 ? "PASS" : "WARN", "测试脚本发现", scriptCount > 0 ? `检测到 ${scriptCount} 个 TypeScript 测试脚本。` : "尚未发现可执行测试脚本。");
}

function checkArtifactConfiguration() {
  const configurationFiles = [
    "playwright.config.ts",
    "playwright.chrome.config.ts",
    "wdio.conf.ts",
    "package.json"
  ];
  const invalidFiles = configurationFiles.filter((file) => {
    const content = readProjectFile(file);
    return /(outputDir|outputFolder|ALLURE_RESULTS_DIR|show-report|allure generate)[\s\S]{0,120}(?<!artifacts\/)(?:test-results|playwright-report|allure-results|allure-report)/.test(
      content
    );
  });

  record(
    invalidFiles.length === 0 ? "PASS" : "FAIL",
    "正式产物路径",
    invalidFiles.length === 0 ? "Runner 配置和报告命令均使用 artifacts/。" : `存在非 artifacts/ 产物路径：${invalidFiles.join("、")}。`
  );

  const legacyRootArtifacts = ["allure-results"].filter((directory) => existsSync(resolve(projectRoot, directory)));
  record(
    legacyRootArtifacts.length === 0 ? "PASS" : "FAIL",
    "根目录遗留运行产物",
    legacyRootArtifacts.length === 0
      ? "未发现绕过 artifacts/ 的根目录运行产物。"
      : `发现遗留运行产物：${legacyRootArtifacts.join("、")}；请执行 npm run reset:full-test-state 清理。`
  );
}

function checkLocalBoundaries() {
  const gitignore = readProjectFile(".gitignore");
  const requiredIgnoredPaths = [".auth/", ".local/", "artifacts/", "testcases/archive/**/test-data/", "testcases/archive/**/test-ledger/", "testcases/archive/legacy-local-test-data/"];
  const missing = requiredIgnoredPaths.filter((path) => !gitignore.includes(path));
  record(
    missing.length === 0 ? "PASS" : "FAIL",
    "本地边界",
    missing.length === 0 ? "认证会话、代码仓库与运行产物均受 Git 忽略规则保护。" : `缺少忽略规则：${missing.join("、")}。`
  );
}

function printResults() {
  console.log("自动化工程架构检查（不读取 .env、.auth 或 .local 内容）");
  for (const result of results) {
    console.log(`[${result.status}] ${result.name}：${result.detail}`);
  }
  const failed = results.filter((result) => result.status === "FAIL").length;
  const warned = results.filter((result) => result.status === "WARN").length;
  console.log(`汇总：通过 ${results.length - failed - warned}，警告 ${warned}，失败 ${failed}。`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

checkDocumentationBoundaries();
checkSourceManifest();
checkTestAssetManifest();
checkTestRequestStructure();
checkScriptMirrors();
checkArtifactConfiguration();
checkLocalBoundaries();
printResults();
