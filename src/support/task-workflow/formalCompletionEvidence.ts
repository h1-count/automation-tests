import type {
  FormalExecutionWorkflowEvidence,
  SafeJsonValue,
  TestOutcome
} from "./types.js";

const digestPattern = /^[a-f0-9]{64}$/;
const evidenceKeys = [
  "schemaVersion",
  "executionSubjectDigest",
  "manifestDigest",
  "resultDigest",
  "caseCounts",
  "scopeStatus",
  "dataHygieneStatus",
  "testOutcome"
] as const;
const countKeys = [
  "passed",
  "failed",
  "blocked",
  "skipped",
  "unknown",
  "deferred"
] as const;
const acceptedDataHygieneStatuses = new Set(["clean", "reusable", "retained"]);
const testOutcomes = new Set<TestOutcome>(["passed", "failed", "mixed", "inconclusive"]);

export function parseFormalExecutionWorkflowEvidence(
  value: SafeJsonValue | undefined
): FormalExecutionWorkflowEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Formal execution completion requires structured workflow evidence.");
  }
  const raw = value as Record<string, SafeJsonValue>;
  const unexpected = Object.keys(raw).filter((key) =>
    !evidenceKeys.includes(key as (typeof evidenceKeys)[number])
  );
  if (unexpected.length > 0 || Object.keys(raw).length !== evidenceKeys.length) {
    throw new Error("Formal execution workflow evidence has unsupported or missing fields.");
  }
  if (raw.schemaVersion !== "formal-execution-workflow-evidence-v1") {
    throw new Error("Unsupported formal execution workflow evidence schema.");
  }
  for (const field of ["executionSubjectDigest", "manifestDigest", "resultDigest"] as const) {
    if (typeof raw[field] !== "string" || !digestPattern.test(raw[field])) {
      throw new Error(`Formal execution workflow evidence requires lowercase SHA-256 ${field}.`);
    }
  }
  if (!raw.caseCounts || typeof raw.caseCounts !== "object" || Array.isArray(raw.caseCounts)) {
    throw new Error("Formal execution workflow evidence requires caseCounts.");
  }
  const rawCounts = raw.caseCounts as Record<string, SafeJsonValue>;
  if (
    Object.keys(rawCounts).length !== countKeys.length
    || Object.keys(rawCounts).some((key) => !countKeys.includes(key as (typeof countKeys)[number]))
  ) {
    throw new Error("Formal execution workflow evidence caseCounts are incomplete.");
  }
  const caseCounts = Object.fromEntries(countKeys.map((key) => {
    const count = rawCounts[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`Formal execution workflow evidence ${key} count is invalid.`);
    }
    return [key, count];
  })) as FormalExecutionWorkflowEvidence["caseCounts"];
  if (caseCounts.unknown !== 0) {
    throw new Error("Formal execution completion cannot contain unknown cases.");
  }
  if (caseCounts.skipped !== 0) {
    throw new Error("Formal execution completion cannot contain skipped runnable cases.");
  }
  if (raw.scopeStatus !== "complete" && raw.scopeStatus !== "partial") {
    throw new Error("Formal execution completion requires decided scope status.");
  }
  const hasScopeGap = caseCounts.blocked > 0
    || caseCounts.skipped > 0
    || caseCounts.deferred > 0;
  if ((raw.scopeStatus === "partial") !== hasScopeGap) {
    throw new Error(
      "Formal execution workflow evidence scopeStatus differs from blocked/skipped/deferred counts."
    );
  }
  if (typeof raw.dataHygieneStatus !== "string"
    || !acceptedDataHygieneStatuses.has(raw.dataHygieneStatus)) {
    throw new Error("Formal execution completion requires settled data hygiene.");
  }
  if (typeof raw.testOutcome !== "string" || !testOutcomes.has(raw.testOutcome as TestOutcome)) {
    throw new Error("Formal execution workflow evidence contains an invalid test outcome.");
  }
  const expectedOutcome = deriveFormalTestOutcome(caseCounts, raw.scopeStatus);
  if (raw.testOutcome !== expectedOutcome) {
    throw new Error(
      `Formal execution workflow evidence testOutcome must be derived as ${expectedOutcome}.`
    );
  }
  return {
    schemaVersion: "formal-execution-workflow-evidence-v1",
    executionSubjectDigest: raw.executionSubjectDigest as string,
    manifestDigest: raw.manifestDigest as string,
    resultDigest: raw.resultDigest as string,
    caseCounts,
    scopeStatus: raw.scopeStatus,
    dataHygieneStatus: raw.dataHygieneStatus as FormalExecutionWorkflowEvidence["dataHygieneStatus"],
    testOutcome: raw.testOutcome as TestOutcome
  };
}

export function deriveFormalTestOutcome(
  counts: FormalExecutionWorkflowEvidence["caseCounts"],
  scopeStatus: FormalExecutionWorkflowEvidence["scopeStatus"]
): TestOutcome {
  if (scopeStatus === "partial") {
    return counts.passed > 0 || counts.failed > 0 ? "mixed" : "inconclusive";
  }
  if (counts.blocked > 0 || counts.skipped > 0 || counts.deferred > 0) {
    throw new Error("Complete formal scope cannot contain blocked, skipped or deferred cases.");
  }
  if (counts.passed > 0 && counts.failed === 0) return "passed";
  if (counts.failed > 0 && counts.passed === 0) return "failed";
  if (counts.passed > 0 && counts.failed > 0) return "mixed";
  return "inconclusive";
}

export function sameFormalExecutionWorkflowEvidence(
  left: FormalExecutionWorkflowEvidence,
  right: FormalExecutionWorkflowEvidence
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function formalReportOutputPaths(executionSubjectDigest: string): [string, string] {
  if (!digestPattern.test(executionSubjectDigest)) {
    throw new Error("Formal report output binding requires a lowercase execution subject digest.");
  }
  const directory = `artifacts/test-results/formal/${executionSubjectDigest.slice(0, 12)}`;
  return [
    `${directory}/run-summary.json`,
    `${directory}/execution-summary.md`
  ];
}
