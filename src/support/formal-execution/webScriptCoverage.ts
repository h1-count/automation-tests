import { createHash } from "node:crypto";
import {
  isCurrentTestcaseDocumentVersion,
  parseTestcaseDocument,
  type ParsedTestcaseExecutionRow
} from "../testcase/testcaseDocument.js";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";

/** The immutable, per-execution-row coverage target for a Web candidate build. */
export const FORMAL_WEB_COVERAGE_PLAN_SCHEMA_VERSION = "formal-web-coverage-plan-v1" as const;

export interface FormalWebCoverageEntry {
  coverageId: string;
  caseId: string;
  dataId?: string;
  /** One-based occurrence of an execution row inside its formal case. */
  rowIndex: number;
  stepIndex: string;
  action: string;
  data: string;
  expected: string;
  ruleRefs: string[];
  preconditions: string;
}

export interface FormalWebCoveragePlan {
  schemaVersion: typeof FORMAL_WEB_COVERAGE_PLAN_SCHEMA_VERSION;
  selectedCaseIds: string[];
  entries: FormalWebCoverageEntry[];
  digest: string;
}

export interface FormalWebCoverageStepRef {
  caseId: string;
  coverageId: string;
}

/**
 * Derives the complete execution coverage target from the already-confirmed
 * testcase package.  It deliberately does not infer a new business row.
 */
export function deriveFormalWebCoveragePlan(input: {
  cases: string;
  selectedCaseIds: string[];
}): FormalWebCoveragePlan {
  const document = parseTestcaseDocument(input.cases);
  if (!isCurrentTestcaseDocumentVersion(document.version)) {
    throw new Error("web_script_coverage: cases.md must use testcase-v1-layered.");
  }
  const selectedCaseIds = [...input.selectedCaseIds];
  if (!selectedCaseIds.length || new Set(selectedCaseIds).size !== selectedCaseIds.length) {
    throw new Error("web_script_coverage: selected caseIds must be a unique non-empty frozen list.");
  }
  const cases = new Map(document.cases.map((testcase) => [testcase.caseId, testcase]));
  const entries: FormalWebCoverageEntry[] = [];
  for (const caseId of selectedCaseIds) {
    const testcase = cases.get(caseId);
    if (!testcase || !testcase.executionRows.length) {
      throw new Error(`web_script_coverage: ${caseId} has no confirmed execution rows.`);
    }
    const seenIds = new Set<string>();
    testcase.executionRows.forEach((row, index) => {
      const coverageId = coverageIdFor(caseId, row, index + 1);
      if (seenIds.has(coverageId)) throw new Error(`web_script_coverage: duplicate ${coverageId}.`);
      seenIds.add(coverageId);
      entries.push({
        coverageId,
        caseId,
        ...(row.dataId ? { dataId: row.dataId } : {}),
        rowIndex: index + 1,
        stepIndex: row.stepIndex,
        action: row.action,
        data: row.data,
        expected: row.expected,
        ruleRefs: [...testcase.ruleIds],
        preconditions: testcase.preconditions
      });
    });
  }
  const canonical = {
    schemaVersion: FORMAL_WEB_COVERAGE_PLAN_SCHEMA_VERSION,
    selectedCaseIds,
    entries
  };
  return {
    ...canonical,
    digest: sha256(canonical)
  };
}

export function assertFormalWebCoveragePlan(value: unknown): asserts value is FormalWebCoveragePlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("web_script_coverage: coverage plan must be an object.");
  }
  const plan = value as Partial<FormalWebCoveragePlan>;
  if (plan.schemaVersion !== FORMAL_WEB_COVERAGE_PLAN_SCHEMA_VERSION
    || !Array.isArray(plan.selectedCaseIds) || !plan.selectedCaseIds.length
    || !Array.isArray(plan.entries) || !plan.entries.length
    || typeof plan.digest !== "string" || !isDigest(plan.digest)) {
    throw new Error("web_script_coverage: coverage plan has an invalid schema.");
  }
  const selected = new Set(plan.selectedCaseIds);
  const seen = new Set<string>();
  for (const entry of plan.entries) {
    if (!entry || typeof entry !== "object" || !selected.has(entry.caseId)
      || !isCoverageId(entry.coverageId) || seen.has(entry.coverageId)
      || !Number.isInteger(entry.rowIndex) || entry.rowIndex < 1
      || !nonEmpty(entry.stepIndex) || !nonEmpty(entry.action) || !nonEmpty(entry.data)
      || !nonEmpty(entry.expected) || !Array.isArray(entry.ruleRefs)) {
      throw new Error("web_script_coverage: coverage entry is invalid.");
    }
    seen.add(entry.coverageId);
  }
  const canonical = {
    schemaVersion: plan.schemaVersion,
    selectedCaseIds: plan.selectedCaseIds,
    entries: plan.entries
  };
  if (sha256(canonical) !== plan.digest) {
    throw new Error("web_script_coverage: coverage plan digest drifted.");
  }
}

export function assertExactFormalWebCoverage(input: {
  plan: FormalWebCoveragePlan;
  coveragePlanDigest: string;
  steps: FormalWebCoverageStepRef[];
}): void {
  assertFormalWebCoveragePlan(input.plan);
  if (input.coveragePlanDigest !== input.plan.digest) {
    throw new Error("coverage_plan_drift: Web spec does not bind the current coverage plan.");
  }
  const expected = input.plan.entries.map((entry) => entry.coverageId);
  const actual = input.steps.map((step) => step.coverageId);
  if (actual.length !== expected.length || new Set(actual).size !== actual.length
    || expected.some((coverageId) => !actual.includes(coverageId))
    || actual.some((coverageId) => !expected.includes(coverageId))) {
    throw new Error(`coverage_gap: Web script steps cover ${actual.length}/${expected.length} confirmed execution rows.`);
  }
  const expectedCaseByCoverage = new Map(input.plan.entries.map((entry) => [entry.coverageId, entry.caseId]));
  for (const step of input.steps) {
    if (expectedCaseByCoverage.get(step.coverageId) !== step.caseId) {
      throw new Error(`coverage_scope_mismatch: ${step.coverageId} belongs to another case.`);
    }
  }
}

export function coverageEntryById(plan: FormalWebCoveragePlan, coverageId: string): FormalWebCoverageEntry | undefined {
  return plan.entries.find((entry) => entry.coverageId === coverageId);
}

export function coverageIdFor(caseId: string, row: ParsedTestcaseExecutionRow, rowIndex: number): string {
  const data = row.dataId ?? `S${String(rowIndex).padStart(2, "0")}`;
  return `${caseId}#${data}-R${String(rowIndex).padStart(2, "0")}`;
}

export function isCoverageId(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+#(?:D\d{2}|S\d{2})-R\d{2}$/u.test(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value as SafeJsonValue), "utf8").digest("hex");
}

function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
