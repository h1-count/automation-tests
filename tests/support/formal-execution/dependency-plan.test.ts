import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionDependencyPlan } from "../../../src/support/formal-execution/dependencyPlan.js";
import { selectNextExecutionWave } from "../../../src/support/formal-execution/executionScheduler.js";
import type {
  FormalExecutionManifest,
  FormalExecutionRecord
} from "../../../src/support/formal-execution/types.js";

test("named resources derive deterministic create-query-delete waves", () => {
  const plan = buildExecutionDependencyPlan(manifest(), ["DELETE", "READ", "CREATE", "INDEPENDENT"]);
  assert.deepEqual(plan.waves, [
    { index: 0, caseIds: ["CREATE", "INDEPENDENT"] },
    { index: 1, caseIds: ["READ"] },
    { index: 2, caseIds: ["DELETE"] }
  ]);
  assert.deepEqual(plan.initialCaseIds, ["CREATE", "INDEPENDENT"]);
  assert.deepEqual(plan.scheduledCaseIds, ["READ", "DELETE"]);
  assert.equal(plan.graphDigest.length, 64);
  assert.deepEqual(
    plan.nodes.find((node) => node.caseId === "DELETE")?.dependencyPaths,
    [["CREATE", "READ", "DELETE"]]
  );
});

test("stage-produced resources annotate their exact producer stage", () => {
  const value = manifest();
  value.cases[0]!.executionStages = [{
    stageId: "created",
    title: "create synthetic tenant",
    producesResources: ["created-tenant"]
  }];
  const plan = buildExecutionDependencyPlan(value, ["CREATE", "READ"]);
  assert.equal(plan.edges[0]?.producerStageId, "created");
});

test("dependency planner rejects cycles and ambiguous pool producers", () => {
  const cyclic = manifest();
  cyclic.cases[0]!.requiredResources = ["read-tenant"];
  cyclic.cases[1]!.producesResources = ["read-tenant"];
  assert.throws(
    () => buildExecutionDependencyPlan(cyclic, ["CREATE", "READ"]),
    /contains a cycle/
  );

  const ambiguous = manifest();
  ambiguous.cases[0]!.producesResources = [{
    name: "pool-a",
    resourceType: "tenant",
    disposition: "reusable_fixture",
    baselineContractId: "tenant-v1",
    baselineVersion: "1",
    leaseMode: "exclusive",
    maxPoolSize: 2,
    retirementPolicy: "validate_quarantine_replace"
  }];
  ambiguous.cases[1]!.producesResources = [{
    name: "pool-b",
    resourceType: "tenant",
    disposition: "reusable_fixture",
    baselineContractId: "tenant-v1",
    baselineVersion: "1",
    leaseMode: "exclusive",
    maxPoolSize: 2,
    retirementPolicy: "validate_quarantine_replace"
  }];
  ambiguous.cases[2]!.consumesResources = [{
    name: "requested-pool-tenant",
    resourceType: "tenant",
    baselineContractId: "tenant-v1",
    leaseMode: "exclusive"
  }];
  ambiguous.cases[2]!.requiredResources = [];
  assert.throws(
    () => buildExecutionDependencyPlan(ambiguous, ["CREATE", "READ", "DELETE"]),
    /ambiguous in-run producers/
  );
});

test("a unique in-run pool producer safely maps an aliased consumer contract", () => {
  const value = manifest();
  value.cases[0]!.producesResources = [{
    name: "created-tenant",
    resourceType: "tenant",
    disposition: "reusable_fixture",
    baselineContractId: "tenant-v1",
    baselineVersion: "1",
    leaseMode: "exclusive",
    maxPoolSize: 2,
    retirementPolicy: "validate_quarantine_replace"
  }];
  value.cases[1]!.requiredResources = [];
  value.cases[1]!.consumesResources = [{
    name: "available-tenant",
    resourceType: "tenant",
    baselineContractId: "tenant-v1",
    leaseMode: "exclusive"
  }];
  const plan = buildExecutionDependencyPlan(value, ["CREATE", "READ"]);
  assert.deepEqual(plan.edges, [{
    producerCaseId: "CREATE",
    consumerCaseId: "READ",
    resourceName: "created-tenant",
    consumerResourceName: "available-tenant"
  }]);
});

test("scheduler unlocks consumers only after exact resources are confirmed", () => {
  const plan = buildExecutionDependencyPlan(manifest(), ["CREATE", "READ", "DELETE", "INDEPENDENT"]);
  const record = executionRecord();
  assert.deepEqual(
    selectNextExecutionWave(plan, record).runnableCaseIds,
    ["CREATE", "INDEPENDENT"]
  );
  record.cases.CREATE!.status = "passed";
  record.cases.INDEPENDENT!.status = "passed";
  record.resources["created-tenant"]!.available = true;
  assert.deepEqual(selectNextExecutionWave(plan, record).runnableCaseIds, ["READ"]);
  record.cases.READ!.status = "passed";
  record.resources["read-tenant"]!.available = true;
  assert.deepEqual(selectNextExecutionWave(plan, record).runnableCaseIds, ["DELETE"]);
});

test("scheduler does not rerun terminal unknown or blocked cases", () => {
  const plan = buildExecutionDependencyPlan(manifest(), ["INDEPENDENT"]);
  const record = executionRecord(["INDEPENDENT"]);
  record.cases.INDEPENDENT!.attempts = [{
    attempt: 1,
    status: "unknown",
    finality: "terminal",
    startedAt: "2026-08-05T00:00:00.000Z",
    endedAt: "2026-08-05T00:00:01.000Z"
  }];
  let decision = selectNextExecutionWave(plan, record);
  assert.deepEqual(decision.runnableCaseIds, []);
  assert.equal(decision.complete, true);

  record.cases.INDEPENDENT!.status = "blocked";
  record.cases.INDEPENDENT!.attempts[0]!.status = "blocked";
  record.stageProgress!.INDEPENDENT = transitionProgress("resolved-transition");
  record.stageProgress!.INDEPENDENT!.transitions["resolved-transition"]!.status = "resolved";
  decision = selectNextExecutionWave(plan, record);
  assert.deepEqual(decision.runnableCaseIds, []);
  assert.equal(decision.complete, true);
});

test("scheduler blocks only descendants of a failed producer and aggregates transitions", () => {
  const value = manifest();
  value.cases.push({
    caseId: "REVIEW-A",
    title: "review a",
    requiredCapabilities: [],
    requiredResources: [],
    producesResources: []
  }, {
    caseId: "REVIEW-B",
    title: "review b",
    requiredCapabilities: [],
    requiredResources: [],
    producesResources: []
  });
  const selected = value.cases.map((item) => item.caseId);
  const plan = buildExecutionDependencyPlan(value, selected);
  const record = executionRecord(selected);
  record.cases.CREATE!.status = "failed";
  record.cases.INDEPENDENT!.status = "unknown";
  record.cases["REVIEW-A"]!.status = "blocked";
  record.cases["REVIEW-B"]!.status = "blocked";
  record.stageProgress!["REVIEW-A"] = transitionProgress("transition-a");
  record.stageProgress!["REVIEW-B"] = transitionProgress("transition-b");
  const decision = selectNextExecutionWave(plan, record);
  assert.deepEqual(decision.runnableCaseIds, ["INDEPENDENT"]);
  assert.deepEqual(decision.blockedCases.map((item) => item.caseId), ["READ"]);
  assert.deepEqual(decision.waitingTransitionIds, ["transition-a", "transition-b"]);

  record.cases.INDEPENDENT!.status = "passed";
  record.cases.READ!.status = "blocked";
  record.cases.READ!.reason = decision.blockedCases[0]!.reason;
  record.cases["REVIEW-A"]!.status = "passed";
  record.cases["REVIEW-B"]!.status = "passed";
  record.stageProgress!["REVIEW-A"]!.transitions["transition-a"]!.status = "resolved";
  record.stageProgress!["REVIEW-B"]!.transitions["transition-b"]!.status = "resolved";
  assert.equal(selectNextExecutionWave(plan, record).complete, true);
});

function manifest(): FormalExecutionManifest {
  return {
    schemaVersion: "formal-execution-manifest-v2",
    requestId: "web/example/dependency-plan",
    projectId: "example",
    environment: "test",
    cases: [{
      caseId: "CREATE",
      title: "create",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: ["created-tenant"]
    }, {
      caseId: "READ",
      title: "read",
      requiredCapabilities: [],
      requiredResources: ["created-tenant"],
      producesResources: ["read-tenant"]
    }, {
      caseId: "DELETE",
      title: "delete",
      requiredCapabilities: [],
      requiredResources: ["read-tenant"],
      producesResources: []
    }, {
      caseId: "INDEPENDENT",
      title: "independent",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: []
    }],
    capabilities: []
  };
}

function executionRecord(caseIds = ["CREATE", "READ", "DELETE", "INDEPENDENT"]): FormalExecutionRecord {
  const now = "2026-08-05T00:00:00.000Z";
  return {
    schemaVersion: "formal-execution-record-v2",
    requestId: "web/example/dependency-plan",
    projectId: "example",
    environment: "test",
    authorizationDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    testDataRunId: "run",
    startedAt: now,
    updatedAt: now,
    cases: Object.fromEntries(caseIds.map((caseId) => [caseId, {
      caseId,
      status: "unknown",
      attempts: [],
      updatedAt: now
    }])),
    capabilities: {},
    resources: {
      "created-tenant": { name: "created-tenant", available: false, producerCaseId: "CREATE" },
      "read-tenant": { name: "read-tenant", available: false, producerCaseId: "READ" }
    },
    stageProgress: Object.fromEntries(caseIds.map((caseId) => [
      caseId,
      { completedStages: [], transitions: {} }
    ]))
  };
}

function transitionProgress(transitionId: string) {
  return {
    completedStages: [{ stageId: "submitted", completedAt: "2026-08-05T00:00:00.000Z", evidenceRefs: [] }],
    transitions: {
      [transitionId]: {
        transitionId,
        caseId: transitionId,
        status: "waiting" as const,
        allowedOutcomes: ["approved"],
        requiredAttestationKeys: [],
        checkpointDigest: "c".repeat(64),
        requestedAt: "2026-08-05T00:00:00.000Z",
        resumeCount: 0
      }
    }
  };
}
