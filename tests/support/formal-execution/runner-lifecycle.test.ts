import assert from "node:assert/strict";
import test from "node:test";
import type { FormalSettlement } from "../../../src/support/formal-execution/finalize.js";
import {
  formalRunnerExitCode,
  runFormalTeardown
} from "../../../src/support/formal-execution/runnerLifecycle.js";
import type { FormalExecutionSummary } from "../../../src/support/formal-execution/types.js";

test("teardown runs browser, settlement, capability and artifacts in order despite failures", async () => {
  const calls: string[] = [];
  const settlement = terminalSettlement();
  const result = await runFormalTeardown({
    closeBrowser: async () => {
      calls.push("browser");
      throw new Error("browser close failed");
    },
    settle: async () => {
      calls.push("settlement");
      return settlement;
    },
    cleanupCapabilities: async () => {
      calls.push("capability");
      throw new Error("capability cleanup failed");
    },
    sanitizeArtifacts: async () => {
      calls.push("artifacts");
      return ["unsafe.zip"];
    }
  });

  assert.deepEqual(calls, ["browser", "settlement", "capability", "artifacts"]);
  assert.equal(result.settlement, settlement);
  assert.deepEqual(result.removedArtifacts, ["unsafe.zip"]);
  assert.deepEqual(result.errors.map((item) => item.phase), ["browser", "capability"]);
});

test("settlement failure cannot skip capability cleanup or artifact sanitation", async () => {
  const calls: string[] = [];
  const result = await runFormalTeardown({
    closeBrowser: async () => {
      calls.push("browser");
    },
    settle: async () => {
      calls.push("settlement");
      throw new Error("formal settlement failed");
    },
    cleanupCapabilities: async () => {
      calls.push("capability");
    },
    sanitizeArtifacts: async () => {
      calls.push("artifacts");
      return [];
    }
  });

  assert.deepEqual(calls, ["browser", "settlement", "capability", "artifacts"]);
  assert.equal(result.settlement, undefined);
  assert.deepEqual(result.errors.map((item) => item.phase), ["formal-settlement"]);
});

test("runner exit codes distinguish product, infrastructure, park and cleanup outcomes", () => {
  assert.equal(exitCode({ settlement: terminalSettlement() }), 0);
  assert.equal(exitCode({ settlement: parkedSettlement() }), 2);
  assert.equal(exitCode({
    settlement: terminalSettlement({
      cleanup: {
        status: "failed",
        dataHygieneStatus: "manual_required",
        reason: "manual_required=1"
      }
    })
  }), 2);
  assert.equal(exitCode({
    settlement: terminalSettlement({ summary: formalSummary({ blocked: 1 }) })
  }), 2);
  assert.equal(exitCode({
    settlement: terminalSettlement({ summary: formalSummary({ failed: 1 }) })
  }), 1);
  assert.equal(exitCode({ settlement: terminalSettlement(), playwrightFailed: true }), 1);
  assert.equal(exitCode({ settlement: terminalSettlement(), runnerError: new Error("infra") }), 1);
  assert.equal(formalRunnerExitCode({
    settlement: terminalSettlement(),
    playwrightFailed: false,
    teardownErrors: [{ phase: "browser", error: new Error("close") }]
  }), 1);
  assert.equal(exitCode({}), 1);
});

function exitCode(input: {
  settlement?: FormalSettlement;
  playwrightFailed?: boolean;
  runnerError?: Error;
}): 0 | 1 | 2 {
  return formalRunnerExitCode({
    settlement: input.settlement,
    runnerError: input.runnerError,
    playwrightFailed: input.playwrightFailed ?? false,
    teardownErrors: []
  });
}

function terminalSettlement(overrides: {
  summary?: FormalExecutionSummary;
  cleanup?: Extract<FormalSettlement, { kind: "terminal" }>["cleanup"];
} = {}): FormalSettlement {
  return {
    kind: "terminal",
    summary: overrides.summary ?? formalSummary(),
    cleanup: overrides.cleanup ?? { status: "passed", dataHygieneStatus: "clean" }
  };
}

function parkedSettlement(): FormalSettlement {
  return {
    kind: "parked",
    summary: formalSummary({ blocked: 1 }, false),
    pendingTransitionIds: ["approved"]
  };
}

function formalSummary(
  counts: Partial<FormalExecutionSummary["counts"]> = {},
  complete = true
): FormalExecutionSummary {
  return {
    requestId: "web/example/lifecycle",
    projectId: "example",
    environment: "test",
    authorizationDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    complete,
    counts: {
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      unknown: 0,
      ...counts
    },
    cases: [],
    capabilities: [],
    resources: [],
    stageProgress: [],
    pendingTransitions: [],
    deferredCases: [],
    cleanup: { status: "passed", dataHygieneStatus: "clean" },
    scopeStatus: "complete",
    testOutcome: "passed",
    dataHygieneStatus: "clean"
  };
}
