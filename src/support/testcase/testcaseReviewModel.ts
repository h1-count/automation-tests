import { createHash } from "node:crypto";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import {
  parseTestcaseDocument,
  TESTCASE_V6_LAYERED_MARKER,
  type ParsedTestcase,
  type ParsedTestcaseExecutionRow
} from "./testcaseDocument.js";

export const TESTCASE_REVIEW_MODEL_SCHEMA = "testcase-review-model-v1" as const;
export const TESTCASE_REVIEW_EXPORT_SCHEMA = "testcase-review-export-v1" as const;
export const TESTCASE_REVIEW_WORKBOOK_RECEIPT_SCHEMA =
  "testcase-review-workbook-receipt-v1" as const;
export const TESTCASE_REVIEW_RENDERER_VERSION = "testcase-review-renderer-v1" as const;
export const TESTCASE_REVIEW_WORKBOOK_SHEETS = ["说明", "用例索引", "用例详情"] as const;

export interface TestcaseReviewModelCase {
  module: string;
  caseId: string;
  title: string;
  priority: string;
  risk: string;
  ruleIds: string[];
  preconditions: string;
  environment: string;
  dataStrategy: string;
  sourceRefs: string[];
  differences: string[];
  executionRows: ParsedTestcaseExecutionRow[];
}

export interface TestcaseReviewModel {
  schema: typeof TESTCASE_REVIEW_MODEL_SCHEMA;
  requestId: string;
  title: string;
  formatVersion: typeof TESTCASE_V6_LAYERED_MARKER;
  callbackSubjectDigest: string;
  selectedCaseIds: string[];
  semanticDigest: string;
  contentDigest: string;
  bindingDigest: string;
  defaults: {
    testType: string;
    environment: string;
    dataStrategy: string;
  };
  statistics: {
    caseCount: number;
    p0Count: number;
    highRiskCount: number;
    parameterizedCount: number;
  };
  indexRows: Array<{
    module: string;
    caseId: string;
    title: string;
    priority: string;
    risk: string;
  }>;
  modules: Array<{
    name: string;
    cases: TestcaseReviewModelCase[];
  }>;
}

export interface TestcaseReviewExport {
  schema: typeof TESTCASE_REVIEW_EXPORT_SCHEMA;
  modelDigest: string;
  callbackSubjectDigest: string;
  semanticDigest: string;
  contentDigest: string;
  bindingDigest: string;
  model: TestcaseReviewModel;
}

export interface TestcaseReviewWorkbookReceipt {
  schema: typeof TESTCASE_REVIEW_WORKBOOK_RECEIPT_SCHEMA;
  modelDigest: string;
  callbackSubjectDigest: string;
  semanticDigest: string;
  contentDigest: string;
  bindingDigest: string;
  workbookSha256: string;
  sheets: string[];
  statistics: {
    moduleCount: number;
    caseCount: number;
    executionRowCount: number;
  };
  formulaErrorCount: number;
  previews: Array<{
    sheet: string;
    path: string;
    sha256: string;
  }>;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function splitMarkdownRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map((cell) => cell.replace(/\\\|/gu, "|").trim());
}

function ruleSources(plan: string): Map<string, string[]> {
  const lines = plan.split(/\r?\n/u);
  const heading = lines.findIndex((line) => /^##\s+规则设计台账\s*$/u.test(line.trim()));
  if (heading < 0) return new Map();
  const tableLines = lines.slice(heading + 1).filter((line, index, values) => {
    const nextHeading = values.findIndex((value, candidate) => candidate < index && /^##\s+/u.test(value));
    return nextHeading < 0 && line.trim().startsWith("|");
  });
  const rows = tableLines.map(splitMarkdownRow);
  const header = rows.find((row) => row[0] === "RULE");
  if (!header) return new Map();
  const ruleIndex = header.indexOf("RULE");
  const sourceIndex = header.indexOf("sourceRef");
  return new Map(rows
    .filter((row) => /^RULE-/u.test(row[ruleIndex] ?? ""))
    .map((row) => [
      row[ruleIndex]!,
      unique((row[sourceIndex] ?? "").match(/\bSRC-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu) ?? [])
    ]));
}

function effectiveCase(
  testcase: ParsedTestcase,
  defaults: TestcaseReviewModel["defaults"],
  sourcesByRule: ReadonlyMap<string, string[]>
): TestcaseReviewModelCase {
  const environment = testcase.overrides.environment ?? defaults.environment;
  const dataStrategy = testcase.overrides.dataStrategy ?? defaults.dataStrategy;
  const sourceRefs = unique([
    ...testcase.ruleIds.flatMap((ruleId) => sourcesByRule.get(ruleId) ?? []),
    ...testcase.overrides.sourceRefs
  ]);
  return {
    module: testcase.module,
    caseId: testcase.caseId,
    title: testcase.title,
    priority: testcase.priority,
    risk: testcase.overrides.risk ?? "",
    ruleIds: [...testcase.ruleIds],
    preconditions: testcase.preconditions,
    environment,
    dataStrategy,
    sourceRefs,
    differences: [
      ...(testcase.overrides.environment ? [`环境=${testcase.overrides.environment}`] : []),
      ...(testcase.overrides.dataStrategy ? [`数据策略=${testcase.overrides.dataStrategy}`] : []),
      ...(testcase.overrides.sourceRefs.length ? [`来源=${testcase.overrides.sourceRefs.join("、")}`] : [])
    ],
    executionRows: testcase.executionRows.map((row) => ({ ...row }))
  };
}

export function buildTestcaseReviewModel(input: {
  requestId: string;
  plan: string;
  cases: string;
  callbackSubjectDigest: string;
  selectedCaseIds?: string[];
}): TestcaseReviewModel {
  if (!/^[a-f0-9]{64}$/u.test(input.callbackSubjectDigest)) {
    throw new Error("callbackSubjectDigest must be a lowercase SHA-256 digest.");
  }
  const document = parseTestcaseDocument(input.cases);
  if (document.version !== TESTCASE_V6_LAYERED_MARKER) {
    throw new Error("Review model requires testcase-v1-layered Markdown.");
  }
  const defaults = {
    testType: document.defaults.testType ?? "",
    environment: document.defaults.environment ?? "",
    dataStrategy: document.defaults.dataStrategy ?? ""
  };
  const sourcesByRule = ruleSources(input.plan);
  const allCases = document.cases.map((testcase) => effectiveCase(testcase, defaults, sourcesByRule));
  const selectedCaseIds = [...new Set(input.selectedCaseIds ?? allCases.map((testcase) => testcase.caseId))].sort();
  if (!selectedCaseIds.length) throw new Error("Review model requires a non-empty selected case scope.");
  const cases = allCases.filter((testcase) => selectedCaseIds.includes(testcase.caseId));
  const missingCaseIds = selectedCaseIds.filter((caseId) => !cases.some((testcase) => testcase.caseId === caseId));
  if (missingCaseIds.length) throw new Error(`Review model selected cases are missing: ${missingCaseIds.join(", ")}`);
  const moduleNames = [...new Set(cases.map((testcase) => testcase.module))];
  const title = /^#\s+(?:用例集|完整用例表)[：:]\s*(.+?)\s*$/mu.exec(input.cases)?.[1]?.trim() ?? input.requestId;
  const semanticDigest = createHash("sha256")
    .update(canonicalJson(JSON.parse(JSON.stringify({ selectedCaseIds, cases })) as SafeJsonValue), "utf8")
    .digest("hex");
  const statistics = {
    caseCount: cases.length,
    p0Count: cases.filter((testcase) => testcase.priority === "P0").length,
    highRiskCount: cases.filter((testcase) => testcase.risk === "高").length,
    parameterizedCount: document.cases.filter((testcase) => testcase.dataInstances.length > 0).length
  };
  const indexRows = cases.map(({ module, caseId, title: caseTitle, priority, risk }) => ({
    module, caseId, title: caseTitle, priority, risk
  }));
  const modules = moduleNames.map((name) => ({ name, cases: cases.filter((testcase) => testcase.module === name) }));
  const contentDigest = createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify({
    rendererVersion: TESTCASE_REVIEW_RENDERER_VERSION, selectedCaseIds,
    title, formatVersion: TESTCASE_V6_LAYERED_MARKER, semanticDigest, defaults, statistics, indexRows, modules
  })) as SafeJsonValue), "utf8").digest("hex");
  const bindingDigest = createHash("sha256").update(canonicalJson({
    schema: TESTCASE_REVIEW_MODEL_SCHEMA,
    requestId: input.requestId,
    callbackSubjectDigest: input.callbackSubjectDigest,
    contentDigest
  }), "utf8").digest("hex");
  return {
    schema: TESTCASE_REVIEW_MODEL_SCHEMA,
    requestId: input.requestId,
    title,
    formatVersion: TESTCASE_V6_LAYERED_MARKER,
    callbackSubjectDigest: input.callbackSubjectDigest,
    selectedCaseIds,
    semanticDigest,
    contentDigest,
    bindingDigest,
    defaults,
    statistics,
    indexRows,
    modules
  };
}

export function testcaseReviewModelDigest(model: TestcaseReviewModel): string {
  const json = JSON.parse(JSON.stringify(model)) as SafeJsonValue;
  return createHash("sha256").update(canonicalJson(json), "utf8").digest("hex");
}

/** Request-independent index/detail body and the layout inputs derived from it. */
export function testcaseReviewWorkbookBodyProjectionDigest(model: TestcaseReviewModel): string {
  const projection = JSON.parse(JSON.stringify({
    rendererVersion: TESTCASE_REVIEW_RENDERER_VERSION,
    selectedCaseIds: model.selectedCaseIds,
    statistics: model.statistics,
    indexRows: model.indexRows,
    modules: model.modules
  })) as SafeJsonValue;
  return createHash("sha256").update(canonicalJson(projection), "utf8").digest("hex");
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function requireReviewModel(value: unknown): asserts value is TestcaseReviewModel {
  if (!value || typeof value !== "object") throw new Error("Review export model is missing.");
  const model = value as Partial<TestcaseReviewModel>;
  if (model.schema !== TESTCASE_REVIEW_MODEL_SCHEMA) {
    throw new Error(`Review model schema must be ${TESTCASE_REVIEW_MODEL_SCHEMA}.`);
  }
  if (model.formatVersion !== TESTCASE_V6_LAYERED_MARKER) {
    throw new Error("Review model must use testcase-v1-layered.");
  }
  requireDigest(model.callbackSubjectDigest, "model.callbackSubjectDigest");
  requireDigest(model.semanticDigest, "model.semanticDigest");
  requireDigest(model.contentDigest, "model.contentDigest");
  requireDigest(model.bindingDigest, "model.bindingDigest");
  if (!Array.isArray(model.selectedCaseIds) || !model.selectedCaseIds.length
    || model.selectedCaseIds.some((caseId) => typeof caseId !== "string" || !caseId.trim())) {
    throw new Error("Review model selectedCaseIds must be a non-empty string array.");
  }
  if (!Array.isArray(model.indexRows) || !model.indexRows.length) {
    throw new Error("Review model must contain at least one testcase index row.");
  }
  if (!Array.isArray(model.modules) || !model.modules.length) {
    throw new Error("Review model must contain at least one module.");
  }
  const cases = model.modules.flatMap((module) => module.cases ?? []);
  if (cases.length !== model.indexRows.length) {
    throw new Error("Review model module cases do not match index rows.");
  }
  if (canonicalJson([...model.selectedCaseIds].sort() as unknown as SafeJsonValue)
    !== canonicalJson(model.indexRows.map((row) => row.caseId).sort() as unknown as SafeJsonValue)) {
    throw new Error("Review model selectedCaseIds do not match index rows.");
  }
  if (cases.some((testcase) => !Array.isArray(testcase.executionRows) || !testcase.executionRows.length)) {
    throw new Error("Every review model testcase must contain execution rows.");
  }
  if (model.statistics?.caseCount !== cases.length) {
    throw new Error("Review model case statistics do not match module cases.");
  }
}

export function buildTestcaseReviewExport(model: TestcaseReviewModel): TestcaseReviewExport {
  requireReviewModel(model);
  return {
    schema: TESTCASE_REVIEW_EXPORT_SCHEMA,
    modelDigest: testcaseReviewModelDigest(model),
    callbackSubjectDigest: model.callbackSubjectDigest,
    semanticDigest: model.semanticDigest,
    contentDigest: model.contentDigest,
    bindingDigest: model.bindingDigest,
    model
  };
}

export function parseTestcaseReviewExport(value: unknown): TestcaseReviewExport {
  if (!value || typeof value !== "object") throw new Error("Review export is missing.");
  const exported = value as Partial<TestcaseReviewExport>;
  if (exported.schema !== TESTCASE_REVIEW_EXPORT_SCHEMA) {
    throw new Error(`Review export schema must be ${TESTCASE_REVIEW_EXPORT_SCHEMA}.`);
  }
  requireDigest(exported.modelDigest, "modelDigest");
  requireDigest(exported.callbackSubjectDigest, "callbackSubjectDigest");
  requireDigest(exported.semanticDigest, "semanticDigest");
  requireDigest(exported.contentDigest, "contentDigest");
  requireDigest(exported.bindingDigest, "bindingDigest");
  requireReviewModel(exported.model);
  const actualModelDigest = testcaseReviewModelDigest(exported.model);
  if (exported.modelDigest !== actualModelDigest) {
    throw new Error("Review export modelDigest does not match its model.");
  }
  if (exported.callbackSubjectDigest !== exported.model.callbackSubjectDigest) {
    throw new Error("Review export callbackSubjectDigest does not match its model.");
  }
  if (exported.semanticDigest !== exported.model.semanticDigest) {
    throw new Error("Review export semanticDigest does not match its model.");
  }
  if (exported.contentDigest !== exported.model.contentDigest || exported.bindingDigest !== exported.model.bindingDigest) {
    throw new Error("Review export content or binding digest does not match its model.");
  }
  return exported as TestcaseReviewExport;
}

export function assertTestcaseReviewExportCurrent(
  exported: TestcaseReviewExport,
  current: TestcaseReviewExport
): void {
  if (
    exported.modelDigest !== current.modelDigest
    || exported.callbackSubjectDigest !== current.callbackSubjectDigest
    || exported.semanticDigest !== current.semanticDigest
    || exported.contentDigest !== current.contentDigest
    || exported.bindingDigest !== current.bindingDigest
  ) {
    throw new Error("The testcase review model is stale and must be regenerated.");
  }
}

export function testcaseReviewWorkbookStatistics(model: TestcaseReviewModel): {
  moduleCount: number;
  caseCount: number;
  executionRowCount: number;
} {
  return {
    moduleCount: model.modules.length,
    caseCount: model.indexRows.length,
    executionRowCount: model.modules.reduce(
      (total, module) => total + module.cases.reduce(
        (moduleTotal, testcase) => moduleTotal + testcase.executionRows.length,
        0
      ),
      0
    )
  };
}

export function validateTestcaseReviewWorkbookReceipt(input: {
  receipt: unknown;
  exported: TestcaseReviewExport;
  workbookSha256: string;
}): TestcaseReviewWorkbookReceipt {
  requireDigest(input.workbookSha256, "workbookSha256");
  if (!input.receipt || typeof input.receipt !== "object") {
    throw new Error("Workbook receipt is missing.");
  }
  const receipt = input.receipt as Partial<TestcaseReviewWorkbookReceipt>;
  if (receipt.schema !== TESTCASE_REVIEW_WORKBOOK_RECEIPT_SCHEMA) {
    throw new Error(`Workbook receipt schema must be ${TESTCASE_REVIEW_WORKBOOK_RECEIPT_SCHEMA}.`);
  }
  if (
    receipt.modelDigest !== input.exported.modelDigest
    || receipt.callbackSubjectDigest !== input.exported.callbackSubjectDigest
    || receipt.semanticDigest !== input.exported.semanticDigest
    || receipt.contentDigest !== input.exported.contentDigest
    || receipt.bindingDigest !== input.exported.bindingDigest
  ) {
    throw new Error("Workbook receipt digests do not match the review export.");
  }
  if (receipt.workbookSha256 !== input.workbookSha256) {
    throw new Error("Workbook receipt SHA-256 does not match the generated workbook.");
  }
  if (JSON.stringify(receipt.sheets) !== JSON.stringify(TESTCASE_REVIEW_WORKBOOK_SHEETS)) {
    throw new Error("Workbook receipt must contain the three required sheets in order.");
  }
  const expectedStatistics = testcaseReviewWorkbookStatistics(input.exported.model);
  if (JSON.stringify(receipt.statistics) !== JSON.stringify(expectedStatistics)) {
    throw new Error("Workbook receipt statistics do not match the review model.");
  }
  if (receipt.formulaErrorCount !== 0) {
    throw new Error("Workbook receipt reports formula errors.");
  }
  if (!Array.isArray(receipt.previews) || receipt.previews.length !== TESTCASE_REVIEW_WORKBOOK_SHEETS.length) {
    throw new Error("Workbook receipt must contain one preview for every sheet.");
  }
  const previewSheets = receipt.previews.map((preview) => preview.sheet);
  if (JSON.stringify(previewSheets) !== JSON.stringify(TESTCASE_REVIEW_WORKBOOK_SHEETS)) {
    throw new Error("Workbook receipt previews do not match the required sheet order.");
  }
  for (const preview of receipt.previews) {
    if (!preview.path) throw new Error(`Workbook preview path is missing for ${preview.sheet}.`);
    requireDigest(preview.sha256, `preview ${preview.sheet} SHA-256`);
  }
  return receipt as TestcaseReviewWorkbookReceipt;
}
