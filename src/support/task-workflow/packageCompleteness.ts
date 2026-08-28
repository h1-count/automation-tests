import { readFile } from "node:fs/promises";
import {
  isCurrentTestcaseDocumentVersion,
  parseTestcaseDocument,
  TESTCASE_V6_LAYERED_MARKER,
  validateTestcaseV6Layered
} from "../testcase/testcaseDocument.js";

export interface TestcaseBodyCompleteness {
  caseId?: string;
  title: string;
  sourceIndex: number;
  duplicateCaseId: boolean;
  missingSections: string[];
  missingBasicInformationFields: string[];
}

export interface TestcasePackageCompleteness {
  complete: boolean;
  expectedCount: number;
  actualBodyCount: number;
  uniqueCaseIdCount: number;
  expectedCaseIds: string[];
  actualCaseIds: string[];
  missingCaseIds: string[];
  unexpectedCaseIds: string[];
  duplicateCaseIds: string[];
  bodiesWithoutCaseId: string[];
  casesWithMissingSections: Array<{ caseId: string; missingSections: string[] }>;
  casesWithMissingBasicInformation: Array<{ caseId: string; missingFields: string[] }>;
  cases: TestcaseBodyCompleteness[];
  reasons: string[];
}

export interface TestcasePackageCompletenessOptions {
  expectedCount?: number;
  expectedCaseIds?: string[];
}

export function evaluateTestcasePackage(
  markdownSources: string | string[],
  options: TestcasePackageCompletenessOptions = {}
): TestcasePackageCompleteness {
  const sources = Array.isArray(markdownSources) ? markdownSources : [markdownSources];
  const documents = sources.map(parseTestcaseDocument);
  const unsupported = documents
    .map((document, index) => ({ document, index }))
    .filter(({ document }) => !isCurrentTestcaseDocumentVersion(document.version));
  const parsedCases = documents.flatMap((document, sourceIndex) =>
    document.cases.map((testcase) => ({ testcase, sourceIndex }))
  );
  const counts = new Map<string, number>();
  for (const { testcase } of parsedCases) {
    if (testcase.caseId) counts.set(testcase.caseId, (counts.get(testcase.caseId) ?? 0) + 1);
  }
  const duplicateCaseIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([caseId]) => caseId)
    .sort();
  const actualCaseIds = [...counts.keys()].sort();
  const expectedCaseIds = unique(options.expectedCaseIds ?? actualCaseIds).sort();
  const expectedCount = options.expectedCount ?? expectedCaseIds.length;
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error("expectedCount must be a non-negative integer.");
  }
  const actualSet = new Set(actualCaseIds);
  const expectedSet = new Set(expectedCaseIds);
  const missingCaseIds = expectedCaseIds.filter((caseId) => !actualSet.has(caseId));
  const unexpectedCaseIds = actualCaseIds.filter((caseId) => !expectedSet.has(caseId));
  const cases: TestcaseBodyCompleteness[] = parsedCases.map(({ testcase, sourceIndex }) => ({
    caseId: testcase.caseId || undefined,
    title: testcase.title || "未命名用例",
    sourceIndex,
    duplicateCaseId: duplicateCaseIds.includes(testcase.caseId),
    missingSections: [
      ...(!testcase.preconditions.trim() ? ["前置条件"] : []),
      ...(!testcase.executionRows.length ? ["执行步骤表"] : [])
    ],
    missingBasicInformationFields: [
      ...(!testcase.module.trim() ? ["模块"] : []),
      ...(!testcase.caseId.trim() ? ["用例编号"] : []),
      ...(!testcase.title.trim() ? ["用例标题"] : []),
      ...(!testcase.priority.trim() ? ["优先级"] : []),
      ...(!testcase.ruleIds.length ? ["规则"] : [])
    ]
  }));
  const casesWithMissingSections = cases
    .filter((testcase) => testcase.missingSections.length > 0)
    .map((testcase) => ({ caseId: testcase.caseId ?? testcase.title, missingSections: testcase.missingSections }));
  const casesWithMissingBasicInformation = cases
    .filter((testcase) => testcase.missingBasicInformationFields.length > 0)
    .map((testcase) => ({
      caseId: testcase.caseId ?? testcase.title,
      missingFields: testcase.missingBasicInformationFields
    }));
  const reasons = unique([
    ...unsupported.map(({ index }) =>
      `Source ${index + 1} must use ${TESTCASE_V6_LAYERED_MARKER}; unsupported formats are not executable inputs.`
    ),
    ...sources.flatMap((source, index) =>
      isCurrentTestcaseDocumentVersion(documents[index]!.version)
        ? validateTestcaseV6Layered(source)
        : []
    ),
    ...(parsedCases.length !== expectedCount
      ? [`Expected ${expectedCount} testcase bodies but found ${parsedCases.length}.`]
      : []),
    ...(duplicateCaseIds.length ? [`Duplicate caseIds: ${duplicateCaseIds.join(", ")}.`] : []),
    ...(missingCaseIds.length ? [`Missing expected caseIds: ${missingCaseIds.join(", ")}.`] : []),
    ...(unexpectedCaseIds.length ? [`Unexpected caseIds: ${unexpectedCaseIds.join(", ")}.`] : []),
    ...(casesWithMissingSections.length ? [
      `${casesWithMissingSections.length} testcase bodies are missing required sections.`
    ] : []),
    ...(casesWithMissingBasicInformation.length ? [
      `${casesWithMissingBasicInformation.length} testcase bodies are missing required basic information.`
    ] : []),
    ...(expectedCount === 0 ? ["Expected testcase count cannot be inferred and was not provided."] : [])
  ]);
  return {
    complete: reasons.length === 0,
    expectedCount,
    actualBodyCount: parsedCases.length,
    uniqueCaseIdCount: actualCaseIds.length,
    expectedCaseIds,
    actualCaseIds,
    missingCaseIds,
    unexpectedCaseIds,
    duplicateCaseIds,
    bodiesWithoutCaseId: cases.filter((testcase) => !testcase.caseId).map((testcase) => testcase.title),
    casesWithMissingSections,
    casesWithMissingBasicInformation,
    cases,
    reasons
  };
}

export async function evaluateTestcasePackageFiles(
  paths: string[],
  options: TestcasePackageCompletenessOptions = {}
): Promise<TestcasePackageCompleteness> {
  if (paths.length === 0) throw new Error("At least one testcase package path is required.");
  const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  return evaluateTestcasePackage(sources, options);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
