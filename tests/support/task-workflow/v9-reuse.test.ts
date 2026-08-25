import assert from "node:assert/strict";
import test from "node:test";
import { buildReusableWorkflowDefinition } from "../../../src/support/task-workflow/definition.ts";
import { buildImpactClosure, parseDesignDelta } from "../../../src/support/task-workflow/impactClosure.ts";

const digest = "a".repeat(64);
const assessment = (decision: "direct_execute" | "design_reconfirm" | "affected_rebuild" | "full_replan") => ({
  schemaVersion: "test-suite-reuse-assessment-v1" as const,
  suiteId: "web/demo/login",
  suiteVersion: "b".repeat(64),
  assessmentDigest: "c".repeat(64),
  decision,
  requestedProfile: "full_feature" as const,
  effectiveProfile: "full_feature" as const,
  selectedCaseIds: ["CASE-LOGIN-001"],
  affectedCaseIds: ["CASE-LOGIN-001"]
});

test("v9 direct_execute contains a run intent but no candidate or reviewer activity", () => {
  const definition = buildReusableWorkflowDefinition({
    requestId: "web/demo/direct-v9",
    planDigest: digest,
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "full_run",
    reuseProtocol: "v9",
    reuseAssessment: assessment("direct_execute")
  });
  assert.equal(definition.definitionVersion, "v9");
  assert.ok(definition.activities.some((activity) => activity.id === "run-intent-derive"));
  assert.equal(definition.activities.some((activity) => activity.kind.startsWith("candidate_")), false);
  assert.equal(definition.activities.some((activity) => activity.kind === "review"), false);
});

test("v9 affected_rebuild freezes closure/delta control activities before candidate work", () => {
  const definition = buildReusableWorkflowDefinition({
    requestId: "web/demo/affected-v9",
    planDigest: digest,
    planText: "rule-design-ledger-v3",
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "testcase_only",
    fragmented: true,
    reuseProtocol: "v9",
    reuseAssessment: assessment("affected_rebuild")
  });
  assert.equal(definition.definitionVersion, "v9");
  assert.deepEqual(
    definition.activities.slice(0, 9).map((activity) => activity.id),
    ["reuse-assessment", "impact-location", "run-intent-derive", "impact-closure-build", "delta-preflight", "delta-skeleton", "delta-candidate-preflight", "delta-candidate-skeleton", "full-source-selection"]
  );
  assert.equal(definition.activities.find((activity) => activity.id === "delta-candidate-skeleton")?.dependencies[0], "delta-candidate-preflight");
  assert.deepEqual(definition.activities.find((activity) => activity.id === "candidate-preflight")?.activation, {
    activityId: "impact-closure-build", outcomes: ["full_replan"]
  });
});

test("v9 full_replan keeps the v8 candidate control plane with a run-intent-capable definition", () => {
  const definition = buildReusableWorkflowDefinition({
    requestId: "web/demo/full-v9", planDigest: digest, planText: "rule-design-ledger-v3",
    capabilities: ["web"], casePackages: ["cases.md"], deliveryTarget: "testcase_only",
    reuseProtocol: "v9", reuseAssessment: assessment("full_replan")
  });
  assert.equal(definition.definitionVersion, "v9");
  assert.ok(definition.activities.some((activity) => activity.id === "source-selection"));
  assert.ok(definition.activities.some((activity) => activity.id === "candidate-preflight"));
});

test("impact closure is bounded and fails closed before delta model work", () => {
  assert.deepEqual(buildImpactClosure({
    suiteId: "web/demo/login",
    baselineVersion: "b".repeat(64),
    caseIds: ["CASE-2", "CASE-1", "CASE-1"],
    ruleIds: ["RULE-1"], sourceRefs: ["SRC-1"], moduleIds: ["登录"]
  }).caseIds, ["CASE-1", "CASE-2"]);
  assert.throws(() => buildImpactClosure({
    suiteId: "web/demo/login", baselineVersion: "b".repeat(64), caseIds: [], ruleIds: ["RULE-1"], sourceRefs: ["SRC-1"], moduleIds: ["登录"]
  }), /full_replan/u);
  assert.throws(() => buildImpactClosure({
    suiteId: "web/demo/login", baselineVersion: "b".repeat(64),
    caseIds: Array.from({ length: 9 }, (_, index) => `CASE-${index}`), ruleIds: ["RULE-1"], sourceRefs: ["SRC-1"], moduleIds: ["登录"]
  }), /full_replan/u);
});

test("design delta cannot escape its frozen closure", () => {
  const closure = buildImpactClosure({
    suiteId: "web/demo/login", baselineVersion: "b".repeat(64),
    caseIds: ["CASE-1"], ruleIds: ["RULE-1"], sourceRefs: ["SRC-1"], moduleIds: ["登录"]
  });
  assert.deepEqual(parseDesignDelta(JSON.stringify({
    schemaVersion: "design-delta-v1", baselineVersion: "b".repeat(64), caseIds: ["CASE-1"], ruleIds: ["RULE-1"], moduleIds: ["登录"]
  }), closure).ruleIds, ["RULE-1"]);
  assert.throws(() => parseDesignDelta(JSON.stringify({
    schemaVersion: "design-delta-v1", baselineVersion: "b".repeat(64), caseIds: ["CASE-2"], ruleIds: ["RULE-1"], moduleIds: ["登录"]
  }), closure), /frozen impact closure/u);
});
