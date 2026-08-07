import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  classifyCleanupSummary,
  finalizeFormalExecution,
  type FinalizeFormalExecutionOptions
} from "../../../src/support/formal-execution/finalize.js";
import { FormalExecutionStore } from "../../../src/support/formal-execution/formalExecutionStore.js";
import {
  defineFormalExecutionManifest,
  evaluateCapabilities
} from "../../../src/support/formal-execution/manifest.js";
import { TestDataManager } from "../../../src/support/test-data/testDataManager.js";
import type { TestDataSummary } from "../../../src/support/test-data/types.js";
import type { FormalExecutionManifest } from "../../../src/support/formal-execution/types.js";

const requestId = "web/example/finalize";
const digest = "9".repeat(64);

test("cleanup classification accepts only safe terminal data states", () => {
  assert.deepEqual(classifyCleanupSummary(dataSummary()), {
    status: "not_required",
    dataHygieneStatus: "clean"
  });
  assert.deepEqual(classifyCleanupSummary(dataSummary({
    totalResources: 1,
    cleaned: 1,
    resources: [resource("cleaned")]
  })), {
    status: "passed",
    dataHygieneStatus: "clean"
  });
  assert.deepEqual(classifyCleanupSummary(dataSummary({
    totalResources: 1,
    reusableAvailable: 1,
    dataHygieneStatus: "reusable",
    resources: [resource("available", true)]
  })), {
    status: "passed",
    dataHygieneStatus: "reusable"
  });
  assert.deepEqual(classifyCleanupSummary(dataSummary({
    totalResources: 1,
    retained: 1,
    dataHygieneStatus: "retained",
    resources: [resource("retained")]
  })), {
    status: "passed",
    dataHygieneStatus: "retained"
  });
});

test("cleanup classification fails closed with count-only reasons", () => {
  const cases: Array<{
    state: TestDataSummary["resources"][number]["state"];
    summary: Partial<TestDataSummary>;
    hygiene: "cleanup_failed" | "manual_required";
  }> = [
    {
      state: "cleanup_failed",
      summary: { cleanupFailed: 1, dataHygieneStatus: "cleanup_failed" },
      hygiene: "cleanup_failed"
    },
    {
      state: "manual_required",
      summary: { manualRequired: 1, dataHygieneStatus: "manual_required" },
      hygiene: "manual_required"
    },
    {
      state: "dirty",
      summary: { dirty: 1 },
      hygiene: "manual_required"
    },
    {
      state: "quarantined",
      summary: { quarantined: 1, dataHygieneStatus: "manual_required" },
      hygiene: "manual_required"
    },
    {
      state: "retired",
      summary: { retired: 1, dataHygieneStatus: "manual_required" },
      hygiene: "manual_required"
    },
    {
      state: "retained",
      summary: { retained: 1, expiredResidual: 1, dataHygieneStatus: "manual_required" },
      hygiene: "manual_required"
    },
    {
      state: "cleanup_pending",
      summary: {},
      hygiene: "manual_required"
    }
  ];
  for (const item of cases) {
    const result = classifyCleanupSummary(dataSummary({
      totalResources: 1,
      resources: [resource(item.state)],
      ...item.summary
    }));
    assert.equal(result.status, "failed");
    assert.equal(result.dataHygieneStatus, item.hygiene);
    assert.match(result.reason, /^(?:[a-z_]+=[1-9]\d*)(?:,[a-z_]+=[1-9]\d*)*$/);
    assert.doesNotMatch(result.reason, /sensitive-resource-id/);
    assert.equal("summary" in result, false);
  }
  assert.deepEqual(classifyCleanupSummary(dataSummary({
    totalResources: 1,
    resources: [resource("cleaned")]
  })), {
    status: "failed",
    dataHygieneStatus: "manual_required",
    reason: "summary_unaccepted=1"
  });
});

test("pending external transitions park without constructing the test-data manager", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-finalize-park-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifest = stagedManifest();
  const store = new FormalExecutionStore(resolve(root, "formal"), resolve(root, "artifacts"));
  await store.initialize({
    manifest,
    authorizationDigest: digest,
    testDataRunId: "run-parked",
    capabilities: evaluateCapabilities(manifest.capabilities, {})
  });
  await store.completeStage(digest, manifest.cases[0]!, "submitted");
  await store.awaitExternalTransition(digest, manifest.cases[0]!, "approved");
  let managerFactoryCalls = 0;

  const settlement = await finalizeFormalExecution(requestId, {
    snapshot: snapshot(),
    manifest,
    store,
    managerFactory: () => {
      managerFactoryCalls += 1;
      throw new Error("test-data manager must not be constructed while parked");
    }
  });

  assert.equal(settlement.kind, "parked");
  if (settlement.kind === "parked") {
    assert.deepEqual(settlement.pendingTransitionIds, ["approved"]);
  }
  assert.equal(managerFactoryCalls, 0);
  assert.equal((await store.read(digest))?.cleanup?.status, "unknown");
});

test("cleanup summary failure is terminal but leaves the test-data run open", async (context) => {
  const harness = await terminalHarness(context);
  let endRunCalls = 0;
  const manager = fakeManager({
    cleanup: dataSummary({
      totalResources: 1,
      cleanupFailed: 1,
      dataHygieneStatus: "cleanup_failed",
      resources: [resource("cleanup_failed")]
    }),
    endRun: () => {
      endRunCalls += 1;
    }
  });

  const settlement = await finalizeFormalExecution(requestId, {
    ...harness.options,
    managerFactory: () => manager
  });

  assert.equal(settlement.kind, "terminal");
  if (settlement.kind === "terminal") {
    assert.deepEqual(settlement.cleanup, {
      status: "failed",
      dataHygieneStatus: "cleanup_failed",
      reason: "cleanup_failed=1,state_cleanup_failed=1"
    });
  }
  assert.equal(endRunCalls, 0);
  assert.equal((await harness.store.read(digest))?.cleanup?.status, "failed");
});

test("cleanup exception records a count-only failure and does not close the run", async (context) => {
  const harness = await terminalHarness(context);
  let endRunCalls = 0;
  const manager = fakeManager({
    cleanupError: new Error("secret resource sensitive-resource-id failed"),
    endRun: () => {
      endRunCalls += 1;
    }
  });

  const settlement = await finalizeFormalExecution(requestId, {
    ...harness.options,
    managerFactory: () => manager
  });

  assert.equal(settlement.kind, "terminal");
  if (settlement.kind === "terminal") {
    assert.deepEqual(settlement.cleanup, {
      status: "failed",
      dataHygieneStatus: "cleanup_failed",
      reason: "cleanup_exception=1"
    });
  }
  assert.equal(endRunCalls, 0);
  assert.doesNotMatch(JSON.stringify(settlement), /sensitive-resource-id/);
});

test("accepted cleanup ends the run with an explicit functional status", async (context) => {
  const harness = await terminalHarness(context, "blocked");
  const calls: unknown[][] = [];
  const manager = fakeManager({
    cleanup: dataSummary(),
    endRun: (...args) => calls.push(args)
  });

  const settlement = await finalizeFormalExecution(requestId, {
    ...harness.options,
    managerFactory: () => manager
  });

  assert.equal(settlement.kind, "terminal");
  if (settlement.kind === "terminal") {
    assert.deepEqual(settlement.cleanup, {
      status: "not_required",
      dataHygieneStatus: "clean"
    });
  }
  assert.deepEqual(calls, [["run-terminal", "failed", "blocked"]]);
});

function dataSummary(overrides: Partial<TestDataSummary> = {}): TestDataSummary {
  return {
    runId: "run-terminal",
    totalResources: 0,
    created: 0,
    reused: 0,
    cleaned: 0,
    cleanupFailed: 0,
    manualRequired: 0,
    retained: 0,
    reusableAvailable: 0,
    quarantined: 0,
    retired: 0,
    expiredResidual: 0,
    dirty: 0,
    dataHygieneStatus: "clean",
    resources: [],
    ...overrides
  };
}

function resource(
  state: TestDataSummary["resources"][number]["state"],
  reusable = false
): TestDataSummary["resources"][number] {
  return {
    resourceId: "sensitive-resource-id",
    resourceType: "product",
    state,
    reusable
  };
}

function baseManifest(): FormalExecutionManifest {
  return {
    schemaVersion: "formal-execution-manifest-v3",
    requestId,
    projectId: "example",
    environment: "test",
    buildEvidence: [{
      kind: "source_contract",
      path: "contracts/finalize-source-contract.json",
      sha256: "a".repeat(64)
    }],
    capabilities: [],
    cases: [{
      caseId: "CASE-001",
      title: "formal lifecycle",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      dataWritePolicy: "no_write",
      requiredOperations: [],
      implementation: { status: "source_complete" },
      businessOracles: [{
        oracleId: "ORACLE-CASE-001",
        ruleRef: "RULE-CASE-001",
        observationKind: "runtime_state",
        authorities: [{
          kind: "formal_user_decision",
          decisionType: "confirmed_test_contract",
          subjectDigest: "b".repeat(64)
        }]
      }]
    }]
  };
}

function stagedManifest() {
  const input = baseManifest();
  input.cases[0]!.executionStages = [{
    stageId: "submitted",
    title: "submit",
    externalTransition: {
      transitionId: "approved",
      kind: "human_attestation",
      actionSummary: "Approve the synthetic request.",
      allowedOutcomes: ["approved"]
    }
  }];
  return defineFormalExecutionManifest(input);
}

function snapshot(): NonNullable<FinalizeFormalExecutionOptions["snapshot"]> {
  return {
    environment: "test",
    digest,
    caseIds: ["CASE-001"]
  } as NonNullable<FinalizeFormalExecutionOptions["snapshot"]>;
}

async function terminalHarness(
  context: test.TestContext,
  status: "passed" | "blocked" = "passed"
) {
  const root = await mkdtemp(resolve(tmpdir(), "formal-finalize-terminal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const candidate = baseManifest();
  if (status === "blocked") {
    candidate.capabilities = [{
      id: "terminal-capability",
      requiredForCaseIds: ["CASE-001"],
      source: { kind: "environment", variable: "FORMAL_TERMINAL_CAPABILITY" },
      unavailableReason: "environment not ready",
      unblockCondition: "Provide the isolated terminal capability."
    }];
    candidate.cases[0]!.requiredCapabilities = ["terminal-capability"];
  }
  const manifest = defineFormalExecutionManifest(candidate);
  const store = new FormalExecutionStore(resolve(root, "formal"), resolve(root, "artifacts"));
  await store.initialize({
    manifest,
    authorizationDigest: digest,
    testDataRunId: "run-terminal",
    capabilities: evaluateCapabilities(manifest.capabilities, {})
  });
  if (status === "passed") {
    const attempt = await store.beginCase(digest, "CASE-001");
    await store.verifyBusinessOracle({
      authorizationDigest: digest,
      caseId: "CASE-001",
      attempt,
      oracleId: "ORACLE-CASE-001",
      evaluator: async () => {
        assert.ok(true);
      }
    });
    await store.finishCase(digest, "CASE-001", attempt, "passed");
  } else {
    await store.markBlocked(digest, "CASE-001", "environment not ready", {
      cause: "capability_unavailable",
      capabilityId: "terminal-capability"
    });
  }
  return {
    store,
    options: { snapshot: snapshot(), manifest, store }
  };
}

function fakeManager(input: {
  cleanup?: TestDataSummary;
  cleanupError?: Error;
  endRun?: (...args: unknown[]) => void;
}): TestDataManager {
  return {
    cleanupRun: async () => {
      if (input.cleanupError) throw input.cleanupError;
      return input.cleanup ?? dataSummary();
    },
    endRun: async (...args: unknown[]) => {
      input.endRun?.(...args);
      return {};
    },
    store: {
      listIntents: async () => [],
      readRun: async () => ({ status: "running", resources: [] }),
      listResources: async () => []
    }
  } as unknown as TestDataManager;
}
