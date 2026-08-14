import { readFile } from "node:fs/promises";

export const DEFAULT_REQUIRED_CASE_SECTIONS = [
  "基本信息",
  "来源",
  "前置条件",
  "操作步骤",
  "预期结果",
  "覆盖关联",
  "合理推断",
  "待补充信息",
  "评审与演进回链"
] as const;

export const V2_REQUIRED_CASE_SECTIONS = [
  "基本信息",
  "来源",
  "前置条件",
  "步骤",
  "预期结果",
  "假设与待确认项"
] as const;

export interface TestcaseBodyCompleteness {
  caseId?: string;
  title: string;
  sourceIndex: number;
  duplicateCaseId: boolean;
  missingSections: string[];
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
  cases: TestcaseBodyCompleteness[];
  reasons: string[];
}

export interface TestcasePackageCompletenessOptions {
  expectedCount?: number;
  expectedCaseIds?: string[];
  requiredSections?: readonly string[];
  caseIdPattern?: RegExp;
}

/**
 * Computes package completeness from actual testcase bodies. Human-authored
 * labels such as "草案完整" are intentionally ignored.
 */
export function evaluateTestcasePackage(
  markdownSources: string | string[],
  options: TestcasePackageCompletenessOptions = {}
): TestcasePackageCompleteness {
  const sources = Array.isArray(markdownSources) ? markdownSources : [markdownSources];
  const v2Structure = sources.some((source) => /结构版本[：:]\s*testcase-v2\b/u.test(source));
  const requiredSections = [...(
    options.requiredSections
    ?? (v2Structure ? V2_REQUIRED_CASE_SECTIONS : DEFAULT_REQUIRED_CASE_SECTIONS)
  )];
  const caseIdPattern = options.caseIdPattern ?? /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
  const directoryIds = unique(
    sources.flatMap((source) => extractDirectoryCaseIds(source, caseIdPattern))
  );
  const expectedCaseIds = unique(options.expectedCaseIds ?? directoryIds);
  const expectedCount = options.expectedCount ?? expectedCaseIds.length;
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error("expectedCount must be a non-negative integer.");
  }

  const cases = sources.flatMap((source, sourceIndex) =>
    extractCaseBodies(source, sourceIndex, requiredSections, caseIdPattern)
  );
  const counts = new Map<string, number>();
  for (const testcase of cases) {
    if (testcase.caseId) counts.set(testcase.caseId, (counts.get(testcase.caseId) ?? 0) + 1);
  }
  const duplicateCaseIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([caseId]) => caseId)
    .sort();
  for (const testcase of cases) {
    testcase.duplicateCaseId = Boolean(
      testcase.caseId && duplicateCaseIds.includes(testcase.caseId)
    );
  }
  const actualCaseIds = [...counts.keys()].sort();
  const missingCaseIds = expectedCaseIds
    .filter((caseId) => !counts.has(caseId))
    .sort();
  const expectedSet = new Set(expectedCaseIds);
  const unexpectedCaseIds = expectedCaseIds.length === 0
    ? []
    : actualCaseIds.filter((caseId) => !expectedSet.has(caseId)).sort();
  const bodiesWithoutCaseId = cases
    .filter((testcase) => !testcase.caseId)
    .map((testcase) => testcase.title);
  const casesWithMissingSections = cases
    .filter((testcase) => testcase.missingSections.length > 0)
    .map((testcase) => ({
      caseId: testcase.caseId ?? testcase.title,
      missingSections: testcase.missingSections
    }));

  const reasons: string[] = [];
  if (cases.length !== expectedCount) {
    reasons.push(`Expected ${expectedCount} testcase bodies but found ${cases.length}.`);
  }
  if (bodiesWithoutCaseId.length > 0) {
    reasons.push(`${bodiesWithoutCaseId.length} testcase bodies have no valid caseId.`);
  }
  if (duplicateCaseIds.length > 0) {
    reasons.push(`Duplicate caseIds: ${duplicateCaseIds.join(", ")}.`);
  }
  if (missingCaseIds.length > 0) {
    reasons.push(`Missing expected caseIds: ${missingCaseIds.join(", ")}.`);
  }
  if (unexpectedCaseIds.length > 0) {
    reasons.push(`Unexpected caseIds: ${unexpectedCaseIds.join(", ")}.`);
  }
  if (casesWithMissingSections.length > 0) {
    reasons.push(
      `${casesWithMissingSections.length} testcase bodies are missing required sections.`
    );
  }
  if (expectedCount === 0) {
    reasons.push("Expected testcase count cannot be inferred and was not provided.");
  }

  return {
    complete: reasons.length === 0,
    expectedCount,
    actualBodyCount: cases.length,
    uniqueCaseIdCount: actualCaseIds.length,
    expectedCaseIds: [...expectedCaseIds].sort(),
    actualCaseIds,
    missingCaseIds,
    unexpectedCaseIds,
    duplicateCaseIds,
    bodiesWithoutCaseId,
    casesWithMissingSections,
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

function extractDirectoryCaseIds(source: string, caseIdPattern: RegExp): string[] {
  const match = /^##\s+用例目录\s*$/m.exec(source);
  if (!match) return [];
  const start = match.index + match[0].length;
  const nextHeading = /^##\s+/m.exec(source.slice(start));
  const section = source.slice(start, nextHeading ? start + nextHeading.index : undefined);
  const ids: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    const candidate = cells[0];
    if (candidate && matchesCaseId(candidate, caseIdPattern)) ids.push(candidate);
  }
  return ids;
}

function extractCaseBodies(
  source: string,
  sourceIndex: number,
  requiredSections: string[],
  caseIdPattern: RegExp
): TestcaseBodyCompleteness[] {
  const starts = [...source.matchAll(/^##\s+测试用例[：:]\s*(.+?)\s*$/gm)];
  return starts.map((start, index) => {
    const bodyStart = start.index ?? 0;
    const bodyEnd = starts[index + 1]?.index ?? source.length;
    const body = source.slice(bodyStart, bodyEnd);
    const title = start[1]?.trim() ?? "未命名用例";
    const caseId = extractBodyCaseId(body, caseIdPattern);
    const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)]
      .map((heading) => heading[1]?.trim() ?? "")
      .filter((heading) => !heading.startsWith("测试用例：") && !heading.startsWith("测试用例:"));
    const missingSections = requiredSections.filter(
      (required) => !headings.some((heading) =>
        heading === required
        || heading.startsWith(`${required}（`)
        || heading.startsWith(`${required}(`)
      )
    );
    return {
      caseId,
      title,
      sourceIndex,
      duplicateCaseId: false,
      missingSections
    };
  });
}

function extractBodyCaseId(body: string, caseIdPattern: RegExp): string | undefined {
  const rows = body.matchAll(/^\|\s*用例编号\s*\|\s*([^|]+?)\s*\|/gm);
  for (const row of rows) {
    const candidate = row[1]?.trim().replace(/^`|`$/g, "");
    if (candidate && matchesCaseId(candidate, caseIdPattern)) return candidate;
  }
  return undefined;
}

function matchesCaseId(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
