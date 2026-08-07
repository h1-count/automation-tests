import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { FormalExecutionStore } from "../../../src/support/formal-execution/formalExecutionStore.js";
import {
  defineFormalExecutionManifest,
  digestFormalExecutionManifest
} from "../../../src/support/formal-execution/manifest.js";
import type {
  FormalExecutionManifest,
  FormalExecutionSealInput
} from "../../../src/support/formal-execution/types.js";

const authorizationDigest = "a".repeat(64);
const targetBuildDigest = "b".repeat(64);

function completionManifest(): FormalExecutionManifest {
  return defineFormalExecutionManifest({
    schemaVersion: "formal-execution-manifest-v3",
    requestId: "web/example/completion-seal",
    projectId: "example",
    environment: "test",
    buildEvidence: [{
      kind: "source_contract",
      path: "contracts/completion-seal-source-contract.json",
      sha256: "c".repeat(64)
    }],
    capabilities: [{
      id: "blocked-capability",
      requiredForCaseIds: ["CASE-BLOCK"],
      source: { kind: "environment", variable: "FORMAL_BLOCKED_CAPABILITY" },
      unavailableReason: "Synthetic capability unavailable.",
      unblockCondition: "Provide the isolated synthetic capability."
    }],
    cases: [{
      caseId: "CASE-PASS",
      title: "pass",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [{
        name: "sealed-resource",
        resourceType: "tenant",
        disposition: "tracked_residual"
      }],
      permissionProfile: "test_write",
      dataWritePolicy: "tracked_residual",
      requiredOperations: [],
      implementation: { status: "source_complete" },
      businessOracles: [businessOracle("CASE-PASS")],
      executionStages: [{
        stageId: "stage-one",
        title: "stage one",
        externalTransition: {
          transitionId: "approval-one",
          kind: "human_attestation",
          actionSummary: "Approve the synthetic result.",
          allowedOutcomes: ["approved"]
        }
      }]
    }, {
      caseId: "CASE-FAIL",
      title: "fail",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      dataWritePolicy: "no_write",
      requiredOperations: [],
      implementation: { status: "source_complete" },
      businessOracles: [businessOracle("CASE-FAIL")]
    }, {
      caseId: "CASE-BLOCK",
      title: "block",
      requiredCapabilities: ["blocked-capability"],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      dataWritePolicy: "no_write",
      requiredOperations: [],
      implementation: { status: "source_complete" },
      businessOracles: [businessOracle("CASE-BLOCK")]
    }, {
      caseId: "CASE-DEFER",
      title: "defer",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      dataWritePolicy: "no_write",
      requiredOperations: [],
      implementation: { status: "source_complete" },
      businessOracles: [businessOracle("CASE-DEFER")]
    }]
  });
}

function businessOracle(caseId: string) {
  return {
    oracleId: `ORACLE-${caseId}`,
    ruleRef: `RULE-${caseId}`,
    observationKind: "runtime_state" as const,
    authorities: [{
      kind: "formal_user_decision" as const,
      decisionType: "confirmed_test_contract",
      subjectDigest: "d".repeat(64)
    }]
  };
}

async function createHarness(
  context: TestContext,
  options: {
    runnableCaseIds?: string[];
    deferredCaseIds?: string[];
  } = {}
) {
  const root = await mkdtemp(resolve(tmpdir(), "formal-completion-seal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifest = completionManifest();
  const runnableCaseIds = options.runnableCaseIds ?? ["CASE-PASS"];
  const deferredCaseIds = options.deferredCaseIds ?? [];
  const ledgerRoot = resolve(root, "ledger");
  const artifactRoot = resolve(root, "artifacts");
  const store = new FormalExecutionStore(ledgerRoot, artifactRoot);
  await store.initialize({
    manifest,
    authorizationDigest,
    targetBuildDigest,
    testDataRunId: "completion-seal-run",
    capabilities: [{
      capabilityId: "blocked-capability",
      available: false,
      affectedCaseIds: ["CASE-BLOCK"],
      checkedAt: "2026-08-07T00:00:00.000Z",
      evidenceDigest: "e".repeat(64),
      reason: "Synthetic capability unavailable.",
      unblockCondition: "Provide the isolated synthetic capability."
    }],
    caseIds: runnableCaseIds,
    deferredCases: deferredCaseIds.map((caseId) => ({
      caseId,
      blockers: [{
        code: "capability_unavailable",
        source: "synthetic-provider",
        unblockCondition: "Provide the isolated synthetic capability."
      }]
    }))
  });
  const sealInput: FormalExecutionSealInput = {
    authorizationDigest,
    requestId: manifest.requestId,
    environment: manifest.environment,
    manifestDigest: digestFormalExecutionManifest(manifest),
    targetBuildDigest,
    runnableCaseIds,
    deferredCaseIds
  };
  return { root, ledgerRoot, artifactRoot, manifest, store, sealInput };
}

async function finish(
  store: FormalExecutionStore,
  caseId: string,
  status: "passed" | "failed" | "blocked"
): Promise<number> {
  const attempt = await store.beginCase(authorizationDigest, caseId);
  if (status !== "blocked") {
    await store.verifyBusinessOracle({
      authorizationDigest,
      caseId,
      attempt,
      oracleId: `ORACLE-${caseId}`,
      evaluator: async () => {
        if (status === "failed") {
          assert.fail("reviewed business assertion violated");
        }
      }
    });
  }
  const record = await store.read(authorizationDigest);
  const waitingTransition = Object.values(
    record?.stageProgress?.[caseId]?.transitions ?? {}
  ).find((item) => item.status === "waiting");
  await store.finishCase(
    authorizationDigest,
    caseId,
    attempt,
    status,
    `${caseId} ${status}`,
    undefined,
    status === "blocked"
      ? {
          blockEvidence: waitingTransition
            ? { cause: "external_transition", transitionId: waitingTransition.transitionId }
            : { cause: "capability_unavailable", capabilityId: "blocked-capability" }
        }
      : undefined
  );
  return attempt;
}

function emptyDataEvidence(caseIds: string[]) {
  return Object.fromEntries(caseIds.map((caseId) => [caseId, {
    intents: [],
    resources: []
  }]));
}

test("summary separates scope, test outcome and explicit data hygiene", async (context) => {
  const { store, sealInput } = await createHarness(context);
  const initial = await store.summarize(authorizationDigest);
  assert.equal(initial.scopeStatus, "partial");
  assert.equal(initial.testOutcome, "inconclusive");
  assert.equal(initial.dataHygieneStatus, "unknown");
  assert.equal(initial.complete, false);

  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(authorizationDigest, "passed");
  const legacyCleanup = await store.summarize(authorizationDigest);
  assert.equal(legacyCleanup.scopeStatus, "complete");
  assert.equal(legacyCleanup.testOutcome, "passed");
  assert.equal(legacyCleanup.dataHygieneStatus, "unknown");
  assert.equal(legacyCleanup.cleanup.dataHygieneStatus, "unknown");
  assert.equal(legacyCleanup.complete, false);
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /explicitly accepted data hygiene/
  );

  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  const accepted = await store.summarize(authorizationDigest);
  assert.equal(accepted.scopeStatus, "complete");
  assert.equal(accepted.testOutcome, "passed");
  assert.equal(accepted.dataHygieneStatus, "clean");
  assert.equal(accepted.complete, true);
});

test("legacy v1 records remain readable but reject continuation writes", async (context) => {
  const { ledgerRoot, artifactRoot, store, sealInput } = await createHarness(context);
  const recordPath = resolve(ledgerRoot, "formal", `${authorizationDigest}.json`);
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    schemaVersion: string;
  };
  record.schemaVersion = "formal-execution-record-v1";
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const reportDirectory = resolve(artifactRoot, authorizationDigest.slice(0, 12));
  const runSummaryPath = resolve(reportDirectory, "run-summary.json");
  const legacyBytes = `${JSON.stringify({
    schemaVersion: "formal-run-summary-v1",
    legacy: true
  }, null, 2)}\n`;
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(runSummaryPath, legacyBytes, "utf8");

  await store.summarize(authorizationDigest);

  assert.equal(await readFile(runSummaryPath, "utf8"), legacyBytes);
  await assert.rejects(
    () => store.beginCase(authorizationDigest, "CASE-PASS"),
    /Legacy formal execution records are read-only/
  );
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /Legacy formal execution records are read-only/
  );
  const persisted = await store.read(authorizationDigest);
  assert.equal(persisted?.schemaVersion, "formal-execution-record-v1");
  assert.equal(persisted?.completionSeal, undefined);
  assert.equal(await readFile(runSummaryPath, "utf8"), legacyBytes);
});

test("legacy v1 report artifacts remain read-only for a sealable v3 record", async (context) => {
  const { artifactRoot, store, sealInput } = await createHarness(context);
  const reportDirectory = resolve(artifactRoot, authorizationDigest.slice(0, 12));
  const runSummaryPath = resolve(reportDirectory, "run-summary.json");
  const legacyBytes = `${JSON.stringify({
    schemaVersion: "formal-run-summary-v1",
    legacy: true
  }, null, 2)}\n`;
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(runSummaryPath, legacyBytes, "utf8");

  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /artifacts are read-only/
  );
  assert.equal((await store.read(authorizationDigest))?.completionSeal, undefined);
  assert.equal(await readFile(runSummaryPath, "utf8"), legacyBytes);
});

test("an orphan execution summary is rejected before sealing and is never overwritten", async (context) => {
  const { artifactRoot, store, sealInput } = await createHarness(context);
  const reportDirectory = resolve(artifactRoot, authorizationDigest.slice(0, 12));
  const markdownPath = resolve(reportDirectory, "execution-summary.md");
  const legacyBytes = "# legacy execution summary\n";
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(markdownPath, legacyBytes, "utf8");

  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );

  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /no matching v2 run-summary\.json/
  );
  assert.equal((await store.read(authorizationDigest))?.completionSeal, undefined);
  assert.equal(await readFile(markdownPath, "utf8"), legacyBytes);
});

test("unsealed v3 summaries do not materialize formal report files", async (context) => {
  const { artifactRoot, store } = await createHarness(context);
  await store.summarize(authorizationDigest);
  const reportDirectory = resolve(artifactRoot, authorizationDigest.slice(0, 12));

  await assert.rejects(
    () => readFile(resolve(reportDirectory, "run-summary.json"), "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );
  await assert.rejects(
    () => readFile(resolve(reportDirectory, "execution-summary.md"), "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );
});

test("cleanup failure persistence accepts only known status counts", async (context) => {
  const { store } = await createHarness(context);
  await assert.rejects(
    () => store.recordCleanup(
      authorizationDigest,
      "failed",
      "resource_id=12345",
      { dataHygieneStatus: "cleanup_failed" }
    ),
    /only known status counts/
  );
  assert.equal((await store.read(authorizationDigest))?.cleanup?.status, "unknown");

  await store.recordCleanup(
    authorizationDigest,
    "failed",
    "state_cleanup_failed=2,cleanup_failed=1",
    { dataHygieneStatus: "cleanup_failed" }
  );
  assert.equal(
    (await store.read(authorizationDigest))?.cleanup?.reason,
    "cleanup_failed=1,state_cleanup_failed=2"
  );
});

test("failed, blocked and deferred results can be sealed without becoming complete", async (context) => {
  const runnableCaseIds = ["CASE-PASS", "CASE-FAIL", "CASE-BLOCK"];
  const { store, sealInput, ledgerRoot } = await createHarness(context, {
    runnableCaseIds,
    deferredCaseIds: ["CASE-DEFER"]
  });
  await finish(store, "CASE-PASS", "passed");
  await finish(store, "CASE-FAIL", "failed");
  await finish(store, "CASE-BLOCK", "blocked");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(runnableCaseIds));
  await store.recordCleanup(
    authorizationDigest,
    "passed",
    undefined,
    { dataHygieneStatus: "retained" }
  );

  const first = await store.sealForWorkflow(sealInput);
  assert.equal(first.summary.scopeStatus, "partial");
  assert.equal(first.summary.testOutcome, "mixed");
  assert.equal(first.summary.dataHygieneStatus, "retained");
  assert.equal(first.summary.complete, false);
  assert.deepEqual(Object.keys(first.seal).sort(), ["resultDigest", "schemaVersion", "sealedAt"]);

  const duplicate = await store.sealForWorkflow({
    ...sealInput,
    runnableCaseIds: [...sealInput.runnableCaseIds].reverse()
  });
  assert.deepEqual(duplicate, first);

  const recordPath = resolve(ledgerRoot, "formal", `${authorizationDigest}.json`);
  const tampered = JSON.parse(await readFile(recordPath, "utf8")) as {
    cases: Record<string, { attempts: Array<{ blockEvidence?: unknown }> }>;
  };
  delete tampered.cases["CASE-BLOCK"]!.attempts.at(-1)!.blockEvidence;
  await writeFile(recordPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => store.materializeSealedReport(authorizationDigest),
    /no persisted block evidence/u
  );
});

test("seal validates immutable identities and exact runnable/deferred sets", async (context) => {
  const { store, sealInput } = await createHarness(context, {
    runnableCaseIds: ["CASE-PASS"],
    deferredCaseIds: ["CASE-DEFER"]
  });
  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(
    authorizationDigest,
    "passed",
    undefined,
    { dataHygieneStatus: "reusable" }
  );

  const invalidInputs: Array<[Partial<FormalExecutionSealInput>, RegExp]> = [
    [{ requestId: "web/example/other" }, /request differs/],
    [{ environment: "staging" }, /environment differs/],
    [{ manifestDigest: "c".repeat(64) }, /manifest differs/],
    [{ targetBuildDigest: "d".repeat(64) }, /target build differs/],
    [{ runnableCaseIds: ["CASE-FAIL"] }, /runnable case set differs/],
    [{ deferredCaseIds: [] }, /deferred case set differs/],
    [{ runnableCaseIds: ["CASE-PASS", "CASE-PASS"] }, /contains duplicates/]
  ];
  for (const [change, error] of invalidInputs) {
    await assert.rejects(() => store.sealForWorkflow({ ...sealInput, ...change }), error);
  }
});

test("seal rejects a failed result whose derived classification was removed", async (context) => {
  const { store, sealInput, ledgerRoot } = await createHarness(context, {
    runnableCaseIds: ["CASE-FAIL"]
  });
  await finish(store, "CASE-FAIL", "failed");
  await store.recordDataEvidence(
    authorizationDigest,
    emptyDataEvidence(["CASE-FAIL"])
  );
  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  const recordPath = resolve(ledgerRoot, "formal", `${authorizationDigest}.json`);
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    cases: Record<string, { attempts: Array<{ failureClassification?: unknown }> }>;
  };
  delete record.cases["CASE-FAIL"]!.attempts.at(-1)!.failureClassification;
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /failure classification differs from its persisted facts/u
  );
});

test("seal rejects unknown cases, pending transitions and incomplete data evidence", async (context) => {
  const unknownHarness = await createHarness(context);
  await unknownHarness.store.recordDataEvidence(
    authorizationDigest,
    emptyDataEvidence(["CASE-PASS"])
  );
  await unknownHarness.store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await assert.rejects(
    () => unknownHarness.store.sealForWorkflow(unknownHarness.sealInput),
    /unknown cases remain/
  );

  const missingEvidenceHarness = await createHarness(context);
  await finish(missingEvidenceHarness.store, "CASE-PASS", "passed");
  await missingEvidenceHarness.store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await assert.rejects(
    () => missingEvidenceHarness.store.sealForWorkflow(missingEvidenceHarness.sealInput),
    /data evidence case set differs/
  );

  const pendingHarness = await createHarness(context);
  const definition = pendingHarness.manifest.cases[0]!;
  await pendingHarness.store.completeStage(
    authorizationDigest,
    definition,
    "stage-one"
  );
  await pendingHarness.store.awaitExternalTransition(
    authorizationDigest,
    definition,
    "approval-one"
  );
  await finish(pendingHarness.store, "CASE-PASS", "blocked");
  await pendingHarness.store.recordDataEvidence(
    authorizationDigest,
    emptyDataEvidence(["CASE-PASS"])
  );
  await pendingHarness.store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await assert.rejects(
    () => pendingHarness.store.sealForWorkflow(pendingHarness.sealInput),
    /external transitions are pending/
  );
});

test("completion seal freezes every formal record mutation category", async (context) => {
  const { store, manifest, sealInput } = await createHarness(context);
  const attempt = await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await store.sealForWorkflow(sealInput);
  const sealedError = /Formal execution is sealed/;

  await assert.rejects(() => store.beginCase(authorizationDigest, "CASE-PASS"), sealedError);
  await assert.rejects(
    () => store.finishCase(authorizationDigest, "CASE-PASS", attempt, "passed"),
    sealedError
  );
  await assert.rejects(
    () => store.recordCleanup(
      authorizationDigest,
      "not_required",
      undefined,
      { dataHygieneStatus: "clean" }
    ),
    sealedError
  );
  await assert.rejects(
    () => store.initialize({
      manifest,
      authorizationDigest,
      targetBuildDigest,
      testDataRunId: "completion-seal-run",
      capabilities: [],
      caseIds: ["CASE-PASS"]
    }),
    sealedError
  );
  await assert.rejects(
    () => store.publishResource(
      authorizationDigest,
      "sealed-resource",
      "CASE-PASS",
      "synthetic resource"
    ),
    sealedError
  );
  await assert.rejects(
    () => store.appendEvidenceRefs(
      authorizationDigest,
      "CASE-PASS",
      ["artifacts/test-results/formal/evidence.json"]
    ),
    sealedError
  );
  await assert.rejects(
    () => store.recordDataEvidence(
      authorizationDigest,
      emptyDataEvidence(["CASE-PASS"])
    ),
    sealedError
  );
  await assert.rejects(
    () => store.completeStage(
      authorizationDigest,
      manifest.cases[0]!,
      "stage-one"
    ),
    sealedError
  );
  await assert.rejects(
    () => store.awaitExternalTransition(
      authorizationDigest,
      manifest.cases[0]!,
      "approval-one"
    ),
    sealedError
  );
  await assert.rejects(
    () => store.resolveExternalTransition({
      authorizationDigest,
      manifest,
      transitionId: "approval-one",
      outcome: "approved",
      attestations: {}
    }),
    sealedError
  );
  await assert.rejects(
    () => store.reserveOperation(
      authorizationDigest,
      manifest.cases[0]!,
      "query_postcondition",
      "post-seal-operation"
    ),
    sealedError
  );
});

test("different sealed results are rejected even if the record is tampered", async (context) => {
  const { ledgerRoot, store, sealInput } = await createHarness(context);
  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await store.sealForWorkflow(sealInput);

  const recordPath = resolve(ledgerRoot, "formal", `${authorizationDigest}.json`);
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    cases: Record<string, { reason?: string }>;
  };
  record.cases["CASE-PASS"]!.reason = "tampered result";
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /already sealed with a different result/
  );
  await assert.rejects(
    () => store.materializeSealedReport(authorizationDigest),
    /differs from the current record/
  );
});

test("persisted completion seals reject unsupported fields", async (context) => {
  const { ledgerRoot, store, sealInput } = await createHarness(context);
  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  await store.recordCleanup(
    authorizationDigest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  await store.sealForWorkflow(sealInput);

  const recordPath = resolve(ledgerRoot, "formal", `${authorizationDigest}.json`);
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    completionSeal: Record<string, unknown>;
  };
  record.completionSeal.injected = "not-allowed";
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => store.materializeSealedReport(authorizationDigest),
    /unsupported or missing fields/
  );
});

test("materializeSealedReport deterministically rebuilds the two v2 report files", async (context) => {
  const { artifactRoot, store, sealInput } = await createHarness(context);
  await finish(store, "CASE-PASS", "passed");
  await store.recordDataEvidence(authorizationDigest, emptyDataEvidence(["CASE-PASS"]));
  const sealed = await (async () => {
    await store.recordCleanup(
      authorizationDigest,
      "not_required",
      undefined,
      { dataHygieneStatus: "clean" }
    );
    return store.sealForWorkflow(sealInput);
  })();

  const first = await store.materializeSealedReport(authorizationDigest);
  assert.deepEqual(first.summary, sealed.summary);
  assert.deepEqual(first.artifacts.map((item) => item.path), [
    `artifacts/test-results/formal/${authorizationDigest.slice(0, 12)}/run-summary.json`,
    `artifacts/test-results/formal/${authorizationDigest.slice(0, 12)}/execution-summary.md`
  ]);
  const directory = resolve(artifactRoot, authorizationDigest.slice(0, 12));
  const runSummaryPath = resolve(directory, "run-summary.json");
  const markdownPath = resolve(directory, "execution-summary.md");
  const firstRunSummary = await readFile(runSummaryPath, "utf8");
  const firstMarkdown = await readFile(markdownPath, "utf8");
  const parsed = JSON.parse(firstRunSummary) as {
    schemaVersion?: string;
    completionSeal?: Record<string, unknown>;
  };
  assert.equal(parsed.schemaVersion, "formal-run-summary-v2");
  assert.deepEqual(Object.keys(parsed.completionSeal ?? {}).sort(), [
    "resultDigest",
    "schemaVersion",
    "sealedAt"
  ]);
  assert.match(firstMarkdown, /范围状态：complete/);
  assert.match(firstMarkdown, /业务 Oracle/);
  assert.match(firstMarkdown, /ORACLE-CASE-PASS \/ RULE-CASE-PASS \/ runtime_state \/ satisfied \/ normal_return/);
  assert.match(firstMarkdown, new RegExp(sealed.seal.resultDigest));
  assert.deepEqual(first.artifacts.map((item) => item.digest), [
    createHash("sha256").update(firstRunSummary).digest("hex"),
    createHash("sha256").update(firstMarkdown).digest("hex")
  ]);

  await writeFile(markdownPath, "stale\n", "utf8");
  const second = await store.materializeSealedReport(authorizationDigest);
  assert.deepEqual(second, first);
  assert.equal(await readFile(runSummaryPath, "utf8"), firstRunSummary);
  assert.equal(await readFile(markdownPath, "utf8"), firstMarkdown);
});
