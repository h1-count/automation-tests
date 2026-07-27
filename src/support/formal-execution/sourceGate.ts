export interface FormalSpecInspection {
  caseIds: string[];
  issues: string[];
}

export function inspectFormalSpecSource(source: string, expectedCaseIds: string[]): FormalSpecInspection {
  const caseIds = [...source.matchAll(/formalCase\(\s*"([A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,})"/g)]
    .map((match) => match[1]!);
  const issues: string[] = [];
  if (caseIds.length === 0) issues.push("Formal scripts must register tests through formalCase().");
  if (/mode\s*:\s*["']serial["']/.test(source)) issues.push("File-level serial mode is forbidden.");
  if (/\btest\.skip\s*\(/.test(source)) issues.push("Bare test.skip() is forbidden.");
  if (/(^|[^\w.])test\s*\(/m.test(source)) issues.push("Bare test() is forbidden.");
  const duplicate = caseIds.filter((caseId, index) => caseIds.indexOf(caseId) !== index);
  if (duplicate.length > 0) issues.push(`Duplicate formal caseIds: ${[...new Set(duplicate)].join(", ")}.`);
  for (const line of source.split(/\r?\n/).filter((item) => item.includes("formalCase("))) {
    const ids = line.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g) ?? [];
    if (ids.length > 1) issues.push("A formalCase declaration contains an aggregate caseId title.");
  }
  const actual = [...new Set(caseIds)].sort();
  const expected = [...new Set(expectedCaseIds)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`Formal case scope differs from confirmed testcase packages: ${actual.length}/${expected.length}.`);
  }
  return { caseIds, issues };
}
