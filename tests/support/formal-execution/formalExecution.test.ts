import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { FormalExecutionStore } from "../../../src/support/formal-execution/formalExecutionStore.js";
import {
  defineFormalExecutionManifest,
  evaluateCapabilities
} from "../../../src/support/formal-execution/manifest.js";
import { resolveFormalCompletion } from "../../../src/support/formal-execution/formalCase.js";
import type { FormalExecutionManifest } from "../../../src/support/formal-execution/types.js";
import { inspectFormalSpecSource } from "../../../src/support/formal-execution/sourceGate.js";
import {
  assertFormalSpecSources,
  formalWorkerCount,
  parseFormalWorkerCount
} from "../../../src/support/formal-execution/runnerPolicy.js";
import {
  activitiesExpandedPayload,
  buildWorkflowDefinition,
  workflowStartedPayload
} from "../../../src/support/task-workflow/definition.js";
import { reduceWorkflow } from "../../../src/support/task-workflow/reducer.js";
import type { WorkflowEvent } from "../../../src/support/task-workflow/types.js";
import { calculateEventDigest, GENESIS_DIGEST } from "../../../src/support/task-workflow/historyStore.js";

function manifest(): FormalExecutionManifest {
  return {
    schemaVersion: "formal-execution-manifest-v1",
    requestId: "web/example/atomic-run",
    projectId: "example",
    environment: "test",
    capabilities: [{
      id: "test-phone",
      requiredForCaseIds: ["CASE-002"],
      source: { kind: "environment", variable: "FORMAL_PHONE", pattern: "^1[3-9]\\d{9}$" },
      unavailableReason: "Test phone unavailable.",
      unblockCondition: "Configure FORMAL_PHONE."
    }],
    cases: [
      {
        caseId: "CASE-001",
        title: "producer",
        requiredCapabilities: [],
        requiredResources: [],
        producesResources: ["company-a"]
      },
      {
        caseId: "CASE-002",
        title: "consumer",
        requiredCapabilities: ["test-phone"],
        requiredResources: ["company-a"],
        producesResources: []
      },
      {
        caseId: "CASE-003",
        title: "independent",
        requiredCapabilities: [],
        requiredResources: [],
        producesResources: []
      }
    ]
  };
}

test("rejects duplicate caseIds and cyclic named-resource dependencies", () => {
  const duplicate = manifest();
  duplicate.cases.push({ ...duplicate.cases[0]! });
  assert.throws(() => defineFormalExecutionManifest(duplicate), /Duplicate caseId/);

  const cyclic = manifest();
  cyclic.cases[0]!.requiredResources = ["company-b"];
  cyclic.cases[1]!.producesResources = ["company-b"];
  assert.throws(() => defineFormalExecutionManifest(cyclic), /dependency cycle/);
});

test("formal case timeouts are bounded by the immutable manifest", () => {
  const valid = manifest();
  valid.cases[0]!.timeoutMs = 360_000;
  assert.equal(defineFormalExecutionManifest(valid).cases[0]?.timeoutMs, 360_000);

  const tooShort = manifest();
  tooShort.cases[0]!.timeoutMs = 29_999;
  assert.throws(() => defineFormalExecutionManifest(tooShort), /timeoutMs/);

  const tooLong = manifest();
  tooLong.cases[0]!.timeoutMs = 600_001;
  assert.throws(() => defineFormalExecutionManifest(tooLong), /timeoutMs/);
});

test("soft assertion errors are committed as a failed atomic case result", () => {
  assert.deepEqual(resolveFormalCompletion([]), { status: "passed" });
  assert.deepEqual(resolveFormalCompletion([new Error("sensitive value must not be persisted")]), {
    status: "failed",
    reason: "1 soft assertion failure(s); inspect the redacted Playwright evidence."
  });
});

test("capability preflight stores availability only and maps exactly the affected cases", () => {
  const unavailable = evaluateCapabilities(manifest().capabilities, {});
  assert.deepEqual(unavailable.map((item) => ({
    capabilityId: item.capabilityId,
    available: item.available,
    affectedCaseIds: item.affectedCaseIds
  })), [{
    capabilityId: "test-phone",
    available: false,
    affectedCaseIds: ["CASE-002"]
  }]);
  assert.equal(JSON.stringify(unavailable).includes("FORMAL_PHONE"), true);
  assert.equal(JSON.stringify(unavailable).includes("13800138000"), false);
  assert.equal(evaluateCapabilities(manifest().capabilities, { FORMAL_PHONE: "13800138000" })[0]?.available, true);
});

test("a failed case does not change an independent case and only missing resources block consumers", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-execution-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = defineFormalExecutionManifest(manifest());
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const authorizationDigest = "d".repeat(64);
  await store.initialize({
    manifest: definition,
    authorizationDigest,
    testDataRunId: "run-one",
    capabilities: evaluateCapabilities(definition.capabilities, { FORMAL_PHONE: "13800138000" })
  });

  const failedAttempt = await store.beginCase(authorizationDigest, "CASE-001");
  await store.confirmResource(authorizationDigest, "company-a", "CASE-001", "Exact synthetic company confirmed.");
  await store.finishCase(authorizationDigest, "CASE-001", failedAttempt, "failed", "Administrator assertion failed.");
  const independentAttempt = await store.beginCase(authorizationDigest, "CASE-003");
  await store.finishCase(authorizationDigest, "CASE-003", independentAttempt, "passed");

  const record = await store.read(authorizationDigest);
  assert.equal(record?.cases["CASE-001"]?.status, "failed");
  assert.equal(record?.cases["CASE-003"]?.status, "passed");
  assert.equal(record?.resources["company-a"]?.available, true);
});

test("summary keeps every declared caseId and treats unexecuted cases as unknown", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-summary-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = defineFormalExecutionManifest(manifest());
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const digest = "e".repeat(64);
  await store.initialize({
    manifest: definition,
    authorizationDigest: digest,
    testDataRunId: "run-two",
    capabilities: evaluateCapabilities(definition.capabilities, {})
  });
  await store.markBlocked(digest, "CASE-002", "Test phone unavailable.");
  const summary = await store.summarize(digest);
  assert.deepEqual(summary.counts, { passed: 0, failed: 0, blocked: 1, skipped: 0, unknown: 2 });
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.cases.map((item) => item.caseId), ["CASE-001", "CASE-002", "CASE-003"]);
});

test("teardown reconciliation closes only interrupted open attempts", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-reconcile-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = defineFormalExecutionManifest(manifest());
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const digest = "f".repeat(64);
  await store.initialize({
    manifest: definition,
    authorizationDigest: digest,
    testDataRunId: "run-three",
    capabilities: evaluateCapabilities(definition.capabilities, {})
  });
  await store.beginCase(digest, "CASE-001");

  assert.deepEqual(await store.reconcileOpenAttempts(digest, "Worker timeout."), ["CASE-001"]);
  assert.deepEqual(await store.reconcileOpenAttempts(digest, "Duplicate teardown."), []);
  const summary = await store.summarize(digest);
  assert.equal(summary.cases.find((item) => item.caseId === "CASE-001")?.status, "failed");
  assert.equal(summary.cases.find((item) => item.caseId === "CASE-002")?.status, "unknown");
  assert.equal(summary.complete, false);
});

test("formal source gate rejects serial, aggregate, skip, duplicate and incomplete scripts", () => {
  const invalid = `
    test.describe.configure({ mode: "serial" });
    formalCase("APP-CASE-001", "APP-CASE-001、APP-CASE-002 aggregate", async () => {});
    formalCase("APP-CASE-001", "duplicate", async () => {});
    test.skip();
  `;
  const inspection = inspectFormalSpecSource(invalid, ["APP-CASE-001", "APP-CASE-002"]);
  assert.match(inspection.issues.join("\n"), /serial/);
  assert.match(inspection.issues.join("\n"), /aggregate/);
  assert.match(inspection.issues.join("\n"), /Duplicate/);
  assert.match(inspection.issues.join("\n"), /test\.skip/);
  assert.match(inspection.issues.join("\n"), /scope differs/);
});

test("formal Runner applies the source gate to the complete discovered script set", () => {
  assert.doesNotThrow(() => assertFormalSpecSources([
    {
      path: "tests/web/example/one.formal.spec.ts",
      source: 'formalCase("APP-CASE-001", "one", async () => {});'
    },
    {
      path: "tests/web/example/two.formal.spec.ts",
      source: 'formalCase("APP-CASE-002", "two", async () => {});'
    }
  ], ["APP-CASE-001", "APP-CASE-002"]));
  assert.throws(
    () => assertFormalSpecSources([{
      path: "tests/web/example/one.formal.spec.ts",
      source: 'test.skip(); formalCase("APP-CASE-001", "one", async () => {});'
    }], ["APP-CASE-001"]),
    /Formal source gate failed.*test\.skip/
  );
});

test("formal Runner uses two workers only for a pinned isolated no-write definition", () => {
  const isolated = workflowProjection({
    writesData: false,
    executionIsolation: {
      contexts: true,
      accounts: true,
      data: true,
      sharedAccount: false
    }
  });
  const shared = workflowProjection({
    writesData: false,
    executionIsolation: {
      contexts: true,
      accounts: true,
      data: true,
      sharedAccount: true
    }
  });
  assert.equal(formalWorkerCount(isolated, { dataWritePolicy: "no_write" }), 2);
  assert.equal(formalWorkerCount(shared, { dataWritePolicy: "no_write" }), 1);
  assert.equal(formalWorkerCount(isolated, { dataWritePolicy: "managed_cleanup" }), 1);
  assert.equal(parseFormalWorkerCount(undefined), 1);
  assert.equal(parseFormalWorkerCount("2"), 2);
  assert.throws(() => parseFormalWorkerCount("3"), /must be 1 or 2/);
});

function workflowProjection(input: {
  writesData: boolean;
  executionIsolation: {
    contexts: boolean;
    accounts: boolean;
    data: boolean;
    sharedAccount?: boolean;
  };
}) {
  const definition = buildWorkflowDefinition({
    requestId: "web/example/runner-policy",
    planDigest: "a".repeat(64),
    capabilities: ["web"],
    writesData: input.writesData,
    casePackages: ["cases-core.md"],
    reviewerRoles: ["requirements"],
    executionIsolation: input.executionIsolation
  });
  const identity = {
    runId: "runner-policy",
    requestId: definition.requestId,
    definitionId: definition.definitionId,
    definitionVersion: definition.definitionVersion
  };
  let previous = GENESIS_DIGEST;
  const events = [
    event({
      ...identity,
      type: "WorkflowStarted",
      idempotencyKey: "runner-policy-started",
      payload: workflowStartedPayload(definition)
    }, 1, previous),
    undefined as WorkflowEvent | undefined
  ];
  previous = events[0]!.digest;
  events[1] = event({
    ...identity,
    type: "ActivitiesExpanded",
    idempotencyKey: "runner-policy-expanded",
    payload: activitiesExpandedPayload(definition)
  }, 2, previous);
  return reduceWorkflow(events as WorkflowEvent[]);
}

function event(
  input: {
    runId: string;
    requestId: string;
    definitionId: string;
    definitionVersion: string;
    type: WorkflowEvent["type"];
    idempotencyKey: string;
    payload: WorkflowEvent["payload"];
  },
  seq: number,
  prevDigest: string
): WorkflowEvent {
  const unsigned: Omit<WorkflowEvent, "digest"> = {
    schemaVersion: "test-workflow-event-v1",
    eventId: `runner-policy-${seq}`,
    seq,
    ...input,
    occurredAt: `2026-07-29T00:00:0${seq}.000Z`,
    actorType: "system",
    prevDigest
  };
  return { ...unsigned, digest: calculateEventDigest(unsigned) };
}
