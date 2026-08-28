import assert from "node:assert/strict";
import test from "node:test";
import { buildReusableWorkflowDefinition } from "../../../src/support/task-workflow/definition.js";

function assessment(decision: "design_reconfirm" | "affected_rebuild" | "full_replan") {
  return {
    schemaVersion: "test-suite-reuse-assessment-v1" as const,
    suiteId: "web/demo/registration",
    suiteVersion: "a".repeat(64),
    assessmentDigest: "b".repeat(64),
    decision,
    requestedProfile: "full_feature" as const,
    effectiveProfile: "full_feature" as const,
    selectedCaseIds: ["OPEN-LOGIN-001"],
    affectedCaseIds: decision === "affected_rebuild" ? ["OPEN-LOGIN-001"] : []
  };
}

function input(decision: "design_reconfirm" | "affected_rebuild" | "full_replan") {
  return {
    requestId: "web/demo/run-r1",
    planDigest: "c".repeat(64),
    capabilities: ["web"] as never[],
    casePackages: ["cases-registration.md"],
    reviewPolicy: { reviewerRoles: ["combined"] } as never,
    reuseAssessment: assessment(decision),
    reuseProtocol: "v1" as const,
    deliveryTarget: "testcase_only" as const
  };
}

test("design_reconfirm builds the revalidation chain ending at a reconfirm-scoped confirmation", () => {
  const definition = buildReusableWorkflowDefinition(input("design_reconfirm"));
  const ids = definition.activities.map((activity) => activity.id);
  assert.deepEqual(ids, [
    "reuse-assessment",
    "run-intent-derive",
    "design-revalidation",
    "case-confirmation"
  ]);
  const revalidation = definition.activities.find((activity) => activity.id === "design-revalidation")!;
  assert.equal(revalidation.kind, "design_revalidation");
  assert.equal(revalidation.metadata?.scope, "reconfirm");
  const confirmation = definition.activities.find((activity) => activity.id === "case-confirmation")!;
  assert.equal(confirmation.metadata?.scope, "reconfirm");
  assert.equal(confirmation.metadata?.completesWorkflow, true);
  assert.equal(confirmation.metadata?.deliveryTarget, "testcase_only");
});

test("v1 design_reconfirm publishes review evidence before full_run engineering", () => {
  const definition = buildReusableWorkflowDefinition({
    ...input("design_reconfirm"),
    deliveryTarget: "full_run",
    reuseProtocol: "v1"
  });
  const ids = definition.activities.map((activity) => activity.id);
  assert.deepEqual(ids, [
    "reuse-assessment",
    "run-intent-derive",
    "design-revalidation",
    "case-confirmation",
    "build",
    "script-review-assessment",
    "script-review-quality",
    "script-review-safety",
    "script-review",
    "readiness-preflight",
    "readiness",
    "execution-authorization",
    "run",
    "report"
  ]);
  assert.ok(definition.activities.find((activity) => activity.id === "case-confirmation"));
  assert.equal(definition.activities.find((activity) => activity.id === "build")?.dependencies[0], "case-confirmation");
  assert.deepEqual(definition.activities.find((activity) => activity.id === "readiness-preflight")?.dependencies, ["script-review"]);
  assert.deepEqual(definition.activities.find((activity) => activity.id === "readiness")?.dependencies, ["readiness-preflight"]);
  assert.equal(definition.activities.find((activity) => activity.id === "build")?.metadata?.designReuseExecution, "stable_design_zero_drift");
});

test("v1 full_run reuses valid reviewed scripts without reopening script review", () => {
  const reusable = assessment("design_reconfirm");
  const definition = buildReusableWorkflowDefinition({
    ...input("design_reconfirm"),
    deliveryTarget: "full_run",
    reuseAssessment: {
      ...reusable,
      reasons: ["stable_scripts_reviewed_not_verified:OPEN-LOGIN-001"]
    },
    reuseProtocol: "v1"
  });
  const ids = definition.activities.map((activity) => activity.id);
  assert.ok(!ids.includes("script-review"));
  assert.ok(!ids.includes("script-review-assessment"));
  assert.deepEqual(definition.activities.find((activity) => activity.id === "readiness-preflight")?.dependencies, ["build"]);
  assert.equal(definition.activities.find((activity) => activity.id === "readiness")?.metadata?.scriptReviewReuse, "stable_reviewed");
});

test("v1 design_reconfirm completes script_only only after script review", () => {
  const definition = buildReusableWorkflowDefinition({
    ...input("design_reconfirm"),
    deliveryTarget: "script_only",
    reuseProtocol: "v1"
  });
  assert.deepEqual(definition.activities.map((activity) => activity.id), [
    "reuse-assessment",
    "run-intent-derive",
    "design-revalidation",
    "case-confirmation",
    "build",
    "script-review-assessment",
    "script-review-quality",
    "script-review-safety",
    "script-review"
  ]);
  assert.equal(definition.activities.find((activity) => activity.id === "build")?.metadata?.completesWorkflow, undefined);
  assert.equal(definition.activities.find((activity) => activity.id === "script-review")?.metadata?.deliveryTarget, "script_only");
  assert.equal(definition.activities.find((activity) => activity.id === "script-review")?.metadata?.completesWorkflow, true);
});

test("affected_rebuild keeps its targeted chain for testcase_only delivery", () => {
  const definition = buildReusableWorkflowDefinition(input("affected_rebuild"));
  const ids = definition.activities.map((activity) => activity.id);
  assert.ok(ids.includes("impact-location"));
  assert.ok(ids.includes("run-intent-derive"));
  assert.ok(ids.includes("impact-closure-build"));
  assert.ok(ids.includes("delta-preflight"));
  assert.ok(ids.includes("delta-candidate-compiler"));
  assert.ok(ids.includes("full-source-selection"));
  assert.ok(!ids.includes("build"));
  assert.equal(definition.requestPolicy.reuseDecision, "affected_rebuild");
});
