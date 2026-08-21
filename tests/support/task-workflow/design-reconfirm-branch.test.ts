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
    deliveryTarget: "testcase_only" as const
  };
}

test("design_reconfirm builds the revalidation chain ending at a reconfirm-scoped confirmation", () => {
  const definition = buildReusableWorkflowDefinition(input("design_reconfirm"));
  const ids = definition.activities.map((activity) => activity.id);
  assert.deepEqual(ids, [
    "reuse-assessment",
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

test("design_reconfirm refuses a full_run delivery target", () => {
  assert.throws(
    () => buildReusableWorkflowDefinition({ ...input("design_reconfirm"), deliveryTarget: "full_run" }),
    /design_reconfirm is a testcase_only reuse decision/
  );
});

test("affected_rebuild keeps its targeted chain for testcase_only delivery", () => {
  const definition = buildReusableWorkflowDefinition(input("affected_rebuild"));
  const ids = definition.activities.map((activity) => activity.id);
  assert.ok(ids.includes("impact-location"));
  assert.ok(ids.includes("targeted-evolution"));
  assert.ok(ids.includes("targeted-review"));
  assert.ok(ids.includes("case-confirmation"));
  assert.ok(!ids.includes("build"));
  const confirmation = definition.activities.find((activity) => activity.id === "case-confirmation")!;
  assert.equal(confirmation.metadata?.scope, "affected");
});
