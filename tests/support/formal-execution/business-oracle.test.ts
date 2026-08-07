import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  resolveFormalOracleCompletion
} from "../../../src/support/formal-execution/formalCase.js";
import {
  digestBusinessOracleContracts,
  FormalExecutionStore
} from "../../../src/support/formal-execution/formalExecutionStore.js";
import { inspectFormalSpecSource } from "../../../src/support/formal-execution/sourceGate.js";
import type {
  FormalBusinessOracleDefinition,
  FormalBusinessOracleResult,
  FormalExecutionManifest,
  FormalExecutionRecord,
  FormalExecutionSealInput
} from "../../../src/support/formal-execution/types.js";

const authorizationDigest = "a".repeat(64);
const manifestDigest = "b".repeat(64);
const targetBuildDigest = "c".repeat(64);

const oracle: FormalBusinessOracleDefinition = {
  oracleId: "ORACLE-CASE-001",
  ruleRef: "RULE-CASE-001",
  observationKind: "dom",
  authorities: [{
    kind: "registered_source",
    materialId: "material-case-requirements",
    sectionId: "case-visible-state",
    sourceSha256: "d".repeat(64)
  }]
};

const secondOracle: FormalBusinessOracleDefinition = {
  ...oracle,
  oracleId: "ORACLE-CASE-001-SECONDARY",
  ruleRef: "RULE-CASE-001-SECONDARY"
};

function oracleResult(
  outcome: FormalBusinessOracleResult["outcome"],
  evaluationBasis: FormalBusinessOracleResult["evaluationBasis"]
): Pick<FormalBusinessOracleResult, "oracleId" | "outcome" | "evaluationBasis"> {
  return {
    oracleId: oracle.oracleId,
    outcome,
    evaluationBasis
  };
}

test("business oracle completion derives only passed, product failed, or terminal unknown", () => {
  assert.deepEqual(resolveFormalOracleCompletion({
    definitions: [oracle],
    oracleResults: [oracleResult("satisfied", "normal_return")],
    errors: []
  }), { status: "passed" });

  assert.deepEqual(resolveFormalOracleCompletion({
    definitions: [oracle],
    oracleResults: [oracleResult("violated", "assertion_violation")],
    errors: []
  }), {
    status: "failed",
    reason: "At least one business oracle result was violated.",
    failureClassification: { code: "product", basis: "business_oracle_violated" }
  });

  assert.equal(resolveFormalOracleCompletion({
    definitions: [oracle, secondOracle],
    oracleResults: [oracleResult("violated", "assertion_violation")],
    errors: []
  }).status, "failed");

  assert.deepEqual(resolveFormalOracleCompletion({
    definitions: [oracle],
    oracleResults: [oracleResult("indeterminate", "explicit_indeterminate")],
    errors: []
  }), {
    status: "unknown",
    reason: "At least one business oracle result is indeterminate.",
    failureClassification: { code: "unknown", basis: "business_oracle_indeterminate" }
  });

  const missing = resolveFormalOracleCompletion({
    definitions: [oracle],
    oracleResults: [],
    errors: []
  });
  assert.equal(missing.status, "unknown");
  assert.deepEqual(missing.failureClassification, {
    code: "script",
    basis: "missing_business_oracle"
  });

  const runtimeFailure = resolveFormalOracleCompletion({
    definitions: [oracle],
    oracleResults: [oracleResult("satisfied", "normal_return")],
    errors: [new Error("assertion failed")]
  });
  assert.equal(runtimeFailure.status, "unknown");
  assert.deepEqual(runtimeFailure.failureClassification, {
    code: "script",
    basis: "runtime_error"
  });
});

test("v3 source gate rejects direct outcomes and empty evaluators while legacy inspection stays compatible", () => {
  const diagnosticOnly = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async (_f, runtime) => { runtime.addAssertion("looks good"); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v3" }
  );
  assert.match(diagnosticOnly.issues.join("\n"), /does not verify any structured business oracle/);
  assert.match(diagnosticOnly.issues.join("\n"), /no business action or assertion/);

  const structured = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async ({ page }, runtime) => { await runtime.verifyBusinessOracle("ORACLE-1", async () => { await expect(page.getByRole("heading")).toBeVisible(); }); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v3" }
  );
  assert.deepEqual(structured.issues, []);

  const direct = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async (_f, runtime) => { runtime.recordOracleResult({ oracleId: "ORACLE-1", outcome: "satisfied" }); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v3" }
  );
  assert.match(direct.issues.join("\n"), /directly records a business oracle outcome/);
  assert.match(direct.issues.join("\n"), /literal business oracle outcome/);

  const empty = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async (_f, runtime) => { await runtime.verifyBusinessOracle("ORACLE-1", async () => {}); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v3" }
  );
  assert.match(empty.issues.join("\n"), /no reviewed assertion decision/);

  const observationWithoutDecision = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async ({ page }, runtime) => { await runtime.verifyBusinessOracle("ORACLE-1", async () => { await page.getByRole("heading").isVisible(); }); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v3" }
  );
  assert.match(
    observationWithoutDecision.issues.join("\n"),
    /no reviewed assertion decision/
  );

  const mutatingEvaluator = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async ({ page }, runtime) => { await runtime.verifyBusinessOracle("ORACLE-1", async () => { await page.click("button"); await expect(page).toBeTruthy(); }); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v3" }
  );
  assert.match(mutatingEvaluator.issues.join("\n"), /mutates runtime state inside a business oracle evaluator/);

  const legacy = inspectFormalSpecSource(
    'formalCase("APP-CASE-001", "one", async (_f, runtime) => { runtime.addAssertion("legacy diagnostic"); });',
    ["APP-CASE-001"],
    { manifestSchemaVersion: "formal-execution-manifest-v2" }
  );
  assert.deepEqual(legacy.issues, []);
});

test("v3 oracle identity is caseId plus oracleId, while duplicates inside one case are rejected", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-business-oracle-identity-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sharedOracleId = "ORACLE-SHARED";
  const manifest: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v3",
    requestId: "web/example/business-oracle-identity",
    projectId: "example",
    environment: "test",
    buildEvidence: [{
      kind: "source_contract",
      path: "contracts/business-oracle-identity.json",
      sha256: "e".repeat(64)
    }],
    capabilities: [],
    cases: ["CASE-ONE", "CASE-TWO"].map((caseId) => ({
      caseId,
      title: caseId,
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only" as const,
      requiredOperations: [],
      dataWritePolicy: "no_write" as const,
      implementation: { status: "source_complete" as const },
      businessOracles: [{
        oracleId: sharedOracleId,
        ruleRef: `RULE-${caseId}`,
        observationKind: "runtime_state" as const,
        authorities: [{
          kind: "formal_user_decision" as const,
          decisionType: "confirmed_test_contract",
          subjectDigest: "f".repeat(64)
        }]
      }]
    }))
  };
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const initialized = await store.initialize({
    manifest,
    authorizationDigest,
    targetBuildDigest,
    testDataRunId: "business-oracle-identity-run",
    capabilities: []
  });
  assert.deepEqual(
    Object.values(initialized.caseBusinessOracles ?? {}).map((definitions) =>
      definitions[0]?.oracleId
    ),
    [sharedOracleId, sharedOracleId]
  );
  for (const caseId of ["CASE-ONE", "CASE-TWO"]) {
    const attempt = await store.beginCase(authorizationDigest, caseId);
    await store.verifyBusinessOracle({
      authorizationDigest,
      caseId,
      attempt,
      oracleId: sharedOracleId,
      evaluator: async () => {
        assert.ok(true);
      }
    });
    await store.finishCase(authorizationDigest, caseId, attempt, "passed");
  }

  const duplicate = structuredClone(manifest);
  duplicate.cases[0]!.businessOracles!.push({
    ...duplicate.cases[0]!.businessOracles![0]!,
    ruleRef: "RULE-DUPLICATE"
  });
  await assert.rejects(
    () => store.initialize({
      manifest: duplicate,
      authorizationDigest: "1".repeat(64),
      targetBuildDigest,
      testDataRunId: "business-oracle-duplicate-run",
      capabilities: []
    }),
    /Duplicate CASE-ONE business oracleId: ORACLE-SHARED/u
  );
});

async function createRecordHarness(
  context: TestContext,
  schemaVersion: FormalExecutionRecord["schemaVersion"] = "formal-execution-record-v3",
  oracleDefinitions: FormalBusinessOracleDefinition[] = [oracle]
) {
  const root = await mkdtemp(resolve(tmpdir(), "formal-business-oracle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const ledgerRoot = resolve(root, "ledger");
  const artifactRoot = resolve(root, "artifacts");
  const recordPath = resolve(ledgerRoot, "formal", `${authorizationDigest}.json`);
  await mkdir(resolve(ledgerRoot, "formal"), { recursive: true });
  const timestamp = new Date().toISOString();
  const record: FormalExecutionRecord = {
    schemaVersion,
    requestId: "web/example/business-oracle",
    projectId: "example",
    environment: "test",
    authorizationDigest,
    manifestDigest,
    businessOracleContractDigest: digestBusinessOracleContracts({
      "CASE-001": oracleDefinitions
    }),
    targetBuildDigest,
    testDataRunId: "business-oracle-run",
    startedAt: timestamp,
    updatedAt: timestamp,
    cases: {
      "CASE-001": {
        caseId: "CASE-001",
        status: "unknown",
        attempts: [],
        updatedAt: timestamp
      }
    },
    capabilities: {},
    resources: {},
    stageProgress: {
      "CASE-001": { completedStages: [], transitions: {} }
    },
    deferredCases: [],
    caseEvidencePolicies: { "CASE-001": "standard" },
    caseBusinessOracles: { "CASE-001": oracleDefinitions },
    caseBlockContracts: {
      "CASE-001": { capabilityIds: [], resourceNames: [] }
    },
    cleanup: { status: "unknown" },
    dataEvidence: {},
    operationReservations: { "CASE-001": {} }
  };
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return {
    store: new FormalExecutionStore(ledgerRoot, artifactRoot),
    recordPath,
    artifactRoot
  };
}

test("v3 Store derives passed and failed only from complete immutable oracle results", async (context) => {
  const { store } = await createRecordHarness(context);
  const firstAttempt = await store.beginCase(authorizationDigest, "CASE-001");
  await assert.rejects(
    () => store.finishCase(authorizationDigest, "CASE-001", firstAttempt, "passed"),
    /without complete business oracle results/
  );

  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt: firstAttempt,
    oracleId: oracle.oracleId,
    evaluator: async () => {
      assert.equal(2 + 2, 4);
    },
    evidenceRefs: ["artifacts/test-results/formal/case-visible-state.json"]
  });

  await store.finishCase(
    authorizationDigest,
    "CASE-001",
    firstAttempt,
    "passed",
    undefined,
    undefined
  );
  const passedRecord = await store.read(authorizationDigest);
  const passedAttempt = passedRecord?.cases["CASE-001"]?.attempts[0];
  assert.equal(passedAttempt?.finality, "terminal");
  assert.equal(passedAttempt?.oracleResults?.[0]?.contractId, undefined);
  assert.match(passedAttempt?.oracleResults?.[0]?.authorityDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(passedAttempt?.failureClassification, undefined);

  const reopened = await store.reopenSafeRetryableCases(authorizationDigest);
  assert.deepEqual(reopened, []);
  await assert.rejects(
    () => store.beginCase(authorizationDigest, "CASE-001"),
    /already has a terminal attempt; use a controlled retry/u
  );
});

test("a conclusive Oracle violation dominates missing Oracles and cannot become blocked", async (context) => {
  const { store, recordPath } = await createRecordHarness(
    context,
    "formal-execution-record-v3",
    [oracle, secondOracle]
  );
  const record = JSON.parse(await readFile(recordPath, "utf8")) as FormalExecutionRecord;
  record.capabilities["known-unavailable"] = {
    capabilityId: "known-unavailable",
    available: false,
    affectedCaseIds: ["CASE-001"],
    checkedAt: "2026-08-07T00:00:00.000Z",
    evidenceDigest: "e".repeat(64),
    reason: "The isolated capability is unavailable.",
    unblockCondition: "Restore the isolated capability."
  };
  record.caseBlockContracts!["CASE-001"]!.capabilityIds = ["known-unavailable"];
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt,
    oracleId: oracle.oracleId,
    evaluator: async () => {
      assert.fail("reviewed business assertion violated");
    }
  });
  await assert.rejects(
    () => store.finishCase(
      authorizationDigest,
      "CASE-001",
      attempt,
      "unknown"
    ),
    /must finish as failed/u
  );
  await assert.rejects(
    () => store.finishCase(
      authorizationDigest,
      "CASE-001",
      attempt,
      "blocked",
      undefined,
      undefined,
      {
        blockEvidence: {
          cause: "capability_unavailable",
          capabilityId: "known-unavailable"
        }
      }
    ),
    /must finish as failed/u
  );
  await store.finishCase(authorizationDigest, "CASE-001", attempt, "failed");
  assert.equal((await store.summarize(authorizationDigest)).cases[0]?.status, "failed");
});

test("v3 runnable cases cannot bypass business oracles through skipped", async (context) => {
  const { store } = await createRecordHarness(context);
  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  await assert.rejects(
    () => store.finishCase(
      authorizationDigest,
      "CASE-001",
      attempt,
      "forged" as never
    ),
    /unsupported case status/u
  );
  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt,
    oracleId: oracle.oracleId,
    evaluator: async () => undefined
  });
  await assert.rejects(
    () => store.finishCase(authorizationDigest, "CASE-001", attempt, "skipped"),
    /v3 runnable cases cannot finish as skipped/u
  );
});

test("v3 blocked results require a persisted non-business fact", async (context) => {
  const { store } = await createRecordHarness(context);
  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  await assert.rejects(
    () => store.finishCase(authorizationDigest, "CASE-001", attempt, "blocked"),
    /requires persisted block evidence/u
  );
  await assert.rejects(
    () => store.finishCase(
      authorizationDigest,
      "CASE-001",
      attempt,
      "blocked",
      undefined,
      undefined,
      {
        blockEvidence: {
          cause: "capability_unavailable",
          capabilityId: "forged-capability"
        }
      }
    ),
    /undeclared capability/u
  );
  assert.equal(
    (await store.read(authorizationDigest))?.cases["CASE-001"]?.attempts[0]?.finality,
    "pending"
  );
});

test("Store maps assertion violations and evaluator errors without caller-written outcomes", async (context) => {
  const violatedHarness = await createRecordHarness(context);
  const violatedAttempt = await violatedHarness.store.beginCase(authorizationDigest, "CASE-001");
  let invalidEvaluatorCalled = false;
  await assert.rejects(
    () => violatedHarness.store.verifyBusinessOracle({
      authorizationDigest,
      caseId: "CASE-001",
      attempt: violatedAttempt,
      oracleId: "ORACLE-OUTSIDE-SCOPE",
      evaluator: async () => {
        invalidEvaluatorCalled = true;
      }
    }),
    /outside the immutable case contract/
  );
  assert.equal(invalidEvaluatorCalled, false);
  const violatedOutcome = await violatedHarness.store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt: violatedAttempt,
    oracleId: oracle.oracleId,
    evaluator: async () => {
      assert.equal("actual", "expected");
    }
  });
  assert.equal(violatedOutcome, "violated");
  const openRecord = await violatedHarness.store.read(authorizationDigest);
  assert.equal(openRecord?.cases["CASE-001"]?.attempts[0]?.finality, "pending");
  assert.equal(
    openRecord?.cases["CASE-001"]?.attempts[0]?.oracleResults?.[0]?.evaluationBasis,
    "assertion_violation"
  );
  await violatedHarness.store.finishCase(
    authorizationDigest,
    "CASE-001",
    violatedAttempt,
    "failed"
  );
  const failed = await violatedHarness.store.summarize(authorizationDigest);
  assert.deepEqual(failed.cases[0]?.failureClassification, {
    code: "product",
    basis: "business_oracle_violated"
  });
  assert.deepEqual(
    await violatedHarness.store.reopenSafeRetryableCases(authorizationDigest),
    [],
    "a conclusive product failure must remain terminal under the same authorization"
  );

  const errorHarness = await createRecordHarness(context);
  const errorAttempt = await errorHarness.store.beginCase(authorizationDigest, "CASE-001");
  const errorOutcome = await errorHarness.store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt: errorAttempt,
    oracleId: oracle.oracleId,
    evaluator: async () => {
      throw new Error("adapter disconnected");
    }
  });
  assert.equal(errorOutcome, "indeterminate");
  await errorHarness.store.finishCase(
    authorizationDigest,
    "CASE-001",
    errorAttempt,
    "unknown"
  );
  const unknown = await errorHarness.store.summarize(authorizationDigest);
  assert.deepEqual(unknown.cases[0]?.failureClassification, {
    code: "script",
    basis: "oracle_evaluator_error"
  });
});

test("v3 Store persists terminal unknown without converting it to product failure and refuses a seal", async (context) => {
  const { store, recordPath, artifactRoot } = await createRecordHarness(context);
  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  const secretReason = "otp=314159 token=must-never-reach-disk";
  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt,
    oracleId: oracle.oracleId,
    evaluator: async () => ({
      kind: "indeterminate",
      reason: secretReason
    })
  });
  await store.finishCase(
    authorizationDigest,
    "CASE-001",
    attempt,
    "unknown",
    "The reviewed observation was indeterminate.",
    undefined
  );
  const summary = await store.summarize(authorizationDigest);
  assert.equal(summary.counts.unknown, 1);
  assert.equal(summary.cases[0]?.attemptFinality, "terminal");
  assert.deepEqual(summary.cases[0]?.failureClassification, {
    code: "unknown",
    basis: "business_oracle_indeterminate"
  });
  assert.equal(summary.scopeStatus, "partial");
  assert.equal(summary.testOutcome, "inconclusive");
  assert.equal(
    summary.cases[0]?.oracleResults?.[0]?.reason,
    "Business oracle evaluator reported an indeterminate observation."
  );
  const evidenceBundlePath = resolve(
    artifactRoot,
    authorizationDigest.slice(0, 12),
    "case-evidence/CASE-001.json"
  );
  assert.doesNotMatch(await readFile(recordPath, "utf8"), /314159|must-never-reach-disk/u);
  assert.doesNotMatch(await readFile(evidenceBundlePath, "utf8"), /314159|must-never-reach-disk/u);

  const sealInput: FormalExecutionSealInput = {
    authorizationDigest,
    requestId: "web/example/business-oracle",
    environment: "test",
    manifestDigest,
    targetBuildDigest,
    runnableCaseIds: ["CASE-001"],
    deferredCaseIds: []
  };
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /cannot be sealed while unknown cases remain/
  );
});

test("seal rejects a legacy v3 retry that hides an earlier Oracle violation", async (context) => {
  const { store, recordPath } = await createRecordHarness(context);
  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt,
    oracleId: oracle.oracleId,
    evaluator: async () => {
      assert.fail("reviewed business assertion violated");
    }
  });
  await store.finishCase(authorizationDigest, "CASE-001", attempt, "failed");

  const record = JSON.parse(await readFile(recordPath, "utf8")) as FormalExecutionRecord;
  const violated = record.cases["CASE-001"]!.attempts[0]!.oracleResults![0]!;
  const { reason: _reason, ...satisfiedBase } = violated;
  const timestamp = "2026-08-07T01:00:00.000Z";
  record.cases["CASE-001"]!.attempts.push({
    attempt: 2,
    status: "passed",
    finality: "terminal",
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    oracleResults: [{
      ...satisfiedBase,
      outcome: "satisfied",
      evaluationBasis: "normal_return"
    }]
  });
  record.cases["CASE-001"]!.status = "passed";
  record.cases["CASE-001"]!.updatedAt = timestamp;
  record.cleanup = {
    status: "not_required",
    completedAt: timestamp,
    dataHygieneStatus: "clean"
  };
  record.dataEvidence = { "CASE-001": { intents: [], resources: [] } };
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => store.sealForWorkflow({
      authorizationDigest,
      requestId: "web/example/business-oracle",
      environment: "test",
      manifestDigest,
      targetBuildDigest,
      runnableCaseIds: ["CASE-001"],
      deferredCaseIds: []
    }),
    /cannot hide a historical business oracle violation/u
  );
});

test("seal rejects forged case status and result-attempt status drift", async (context) => {
  const { store, recordPath } = await createRecordHarness(context);
  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt,
    oracleId: oracle.oracleId,
    evaluator: async () => undefined
  });
  await store.finishCase(authorizationDigest, "CASE-001", attempt, "passed");
  const sealInput: FormalExecutionSealInput = {
    authorizationDigest,
    requestId: "web/example/business-oracle",
    environment: "test",
    manifestDigest,
    targetBuildDigest,
    runnableCaseIds: ["CASE-001"],
    deferredCaseIds: []
  };
  const record = JSON.parse(await readFile(recordPath, "utf8")) as FormalExecutionRecord;
  record.cleanup = {
    status: "not_required",
    completedAt: "2026-08-07T01:00:00.000Z",
    dataHygieneStatus: "clean"
  };
  record.dataEvidence = { "CASE-001": { intents: [], resources: [] } };
  record.cases["CASE-001"]!.status = "failed";
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /status differs from its latest terminal attempt/u
  );

  record.cases["CASE-001"]!.status = "forged" as never;
  record.cases["CASE-001"]!.attempts.at(-1)!.status = "forged" as never;
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => store.sealForWorkflow(sealInput),
    /unsupported case status/u
  );
});

test("finish and seal reject business oracle contract digest drift", async (context) => {
  const { store, recordPath } = await createRecordHarness(context);
  const attempt = await store.beginCase(authorizationDigest, "CASE-001");
  await store.verifyBusinessOracle({
    authorizationDigest,
    caseId: "CASE-001",
    attempt,
    oracleId: oracle.oracleId,
    evaluator: async () => {
      assert.ok(true);
    }
  });
  const record = JSON.parse(await readFile(recordPath, "utf8")) as FormalExecutionRecord;
  record.caseBusinessOracles!["CASE-001"]![0]!.ruleRef = "RULE-TAMPERED";
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => store.finishCase(authorizationDigest, "CASE-001", attempt, "passed"),
    /contract differs from its immutable digest/
  );
  await assert.rejects(
    () => store.sealForWorkflow({
      authorizationDigest,
      requestId: "web/example/business-oracle",
      environment: "test",
      manifestDigest,
      targetBuildDigest,
      runnableCaseIds: ["CASE-001"],
      deferredCaseIds: []
    }),
    /contract differs from its immutable digest/
  );
});

test("interrupted v3 attempts reconcile to terminal infrastructure unknown", async (context) => {
  const { store } = await createRecordHarness(context);
  await store.beginCase(authorizationDigest, "CASE-001");
  assert.deepEqual(
    await store.reconcileOpenAttempts(authorizationDigest, "worker interrupted"),
    ["CASE-001"]
  );
  const record = await store.read(authorizationDigest);
  const attempt = record?.cases["CASE-001"]?.attempts[0];
  assert.equal(attempt?.status, "unknown");
  assert.equal(attempt?.finality, "terminal");
  assert.deepEqual(attempt?.failureClassification, {
    code: "infrastructure",
    basis: "worker_interrupted"
  });
});

test("legacy formal records remain readable but reject every continuation write", async (context) => {
  const { store, recordPath } = await createRecordHarness(context, "formal-execution-record-v2");
  const legacyRecord = JSON.parse(await readFile(recordPath, "utf8")) as FormalExecutionRecord;
  const timestamp = new Date().toISOString();
  legacyRecord.cases["CASE-001"]!.status = "failed";
  legacyRecord.cases["CASE-001"]!.attempts.push({
    attempt: 1,
    status: "failed",
    startedAt: timestamp,
    endedAt: timestamp,
    failureClassification: "PRODUCT"
  });
  await writeFile(recordPath, `${JSON.stringify(legacyRecord, null, 2)}\n`, "utf8");
  const summary = await store.summarize(authorizationDigest);
  assert.equal(summary.cases[0]?.attemptFinality, "terminal");
  assert.equal(summary.cases[0]?.failureClassification, "PRODUCT");
  await assert.rejects(
    () => store.beginCase(authorizationDigest, "CASE-001"),
    /Legacy formal execution records are read-only/
  );
  const record = JSON.parse(await readFile(recordPath, "utf8")) as FormalExecutionRecord;
  assert.equal(record.schemaVersion, "formal-execution-record-v2");
  assert.equal(record.cases["CASE-001"]?.attempts.length, 1);
});
