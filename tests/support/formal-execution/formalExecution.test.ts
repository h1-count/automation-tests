import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { FormalExecutionStore } from "../../../src/support/formal-execution/formalExecutionStore.js";
import {
  defineFormalExecutionManifest,
  evaluateCapabilities
} from "../../../src/support/formal-execution/manifest.js";
import {
  caseExecutionScopeBlock,
  resolveFormalCompletion
} from "../../../src/support/formal-execution/formalCase.js";
import type { FormalExecutionManifest } from "../../../src/support/formal-execution/types.js";
import { inspectFormalSpecSource } from "../../../src/support/formal-execution/sourceGate.js";
import {
  assertFormalSpecSources,
  formalWorkerCount,
  interactiveOtpCaseIds,
  parseFormalWorkerCount
} from "../../../src/support/formal-execution/runnerPolicy.js";
import { matchesOperationPath } from "../../../src/support/formal-execution/operationEvidence.js";
import {
  formalCaseIdFromTestTitle,
  pageSessionGroupsRequireSingleWorker
} from "../../../src/support/formal-execution/pageSessionGroups.js";
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

test("operation response matching tolerates reviewed environment API base paths", () => {
  assert.equal(
    matchesOperationPath(
      "https://open-gateway-test.example.com/open-platform/company/file-upload",
      "/company/file-upload"
    ),
    true
  );
  assert.equal(
    matchesOperationPath(
      "https://open-gateway.example.com/api/aiot-open-plat/company/file-upload?request=redacted",
      "/company/file-upload"
    ),
    true
  );
  assert.equal(
    matchesOperationPath(
      "https://open-gateway-test.example.com/open-platform/company/file-upload-preview",
      "/company/file-upload"
    ),
    false
  );
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

test("v2 manifests keep build evidence out of runtime capabilities and require reusable pool contracts", () => {
  const valid: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v2",
    requestId: "web/example/reusable-manifest",
    projectId: "example",
    environment: "test",
    buildEvidence: [{ kind: "selector_contract", path: "contracts/selectors.json" }],
    capabilities: [],
    cases: [{
      caseId: "CASE-REUSABLE-001",
      title: "create reusable tenant",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [{
        name: "approved-tenant",
        resourceType: "tenant",
        disposition: "reusable_fixture",
        baselineContractId: "approved-enterprise-v1",
        baselineVersion: "v1",
        leaseMode: "exclusive",
        maxPoolSize: 3,
        retirementPolicy: "validate_quarantine_replace"
      }],
      permissionProfile: "test_write",
      requiredOperations: ["create_test_resource"],
      dataWritePolicy: "reusable_fixture",
      implementation: { status: "source_complete" },
      operationEvidence: [{
        operation: "create_test_resource",
        strategy: "response_contract",
        responseContractId: "tenant-create-response-v1",
        finality: "final",
        stableIdentityRequired: true
      }]
    }]
  };
  assert.doesNotThrow(() => defineFormalExecutionManifest(valid));

  const selectorProvider = structuredClone(valid);
  selectorProvider.capabilities = [{
    id: "selector-runtime",
    requiredForCaseIds: ["CASE-REUSABLE-001"],
    source: { kind: "provider", providerId: "selector_evidence" },
    unavailableReason: "missing",
    unblockCondition: "regenerate"
  }];
  selectorProvider.cases[0]!.requiredCapabilities = ["selector-runtime"];
  assert.throws(() => defineFormalExecutionManifest(selectorProvider), /build evidence, not a runtime provider/);

  const missingBaseline = structuredClone(valid);
  const produced = missingBaseline.cases[0]!.producesResources[0];
  if (typeof produced !== "string") delete produced.baselineContractId;
  assert.throws(() => defineFormalExecutionManifest(missingBaseline), /requires baseline/);
});

test("v2 test assets are frozen build evidence and never runtime capabilities", () => {
  const valid: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v2",
    requestId: "web/example/asset-manifest",
    projectId: "example",
    environment: "test",
    buildEvidence: [{
      kind: "test_asset",
      assetId: "synthetic-document",
      sha256: "a".repeat(64),
      scope: "registration",
      path: "test-assets/documents/synthetic.png"
    }],
    capabilities: [],
    cases: [{
      caseId: "CASE-ASSET-001",
      title: "upload static test asset",
      requiredCapabilities: [],
      requiredTestAssetIds: ["synthetic-document"],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: [],
      dataWritePolicy: "no_write",
      implementation: { status: "source_complete" }
    }]
  };
  assert.doesNotThrow(() => defineFormalExecutionManifest(valid));

  const missingEvidence = structuredClone(valid);
  missingEvidence.buildEvidence = [{ kind: "source_contract", path: "contracts/source.json" }];
  assert.throws(() => defineFormalExecutionManifest(missingEvidence), /without frozen test_asset/);

  const orphanEvidence = structuredClone(valid);
  orphanEvidence.cases[0]!.requiredTestAssetIds = [];
  assert.throws(() => defineFormalExecutionManifest(orphanEvidence), /is not required by any formal case/);
});

test("v5 case implementation metadata is complete and keeps runtime readiness separate", () => {
  const valid = manifest();
  valid.cases[0]!.requiredOperations = ["submit_registration"];
  valid.cases[0]!.dataWritePolicy = "tracked_residual";
  valid.cases[0]!.implementation = {
    status: "runtime_validation_pending",
    reachableBoundary: "registration submit",
    pendingCapabilityIds: []
  };
  assert.throws(() => defineFormalExecutionManifest(valid), /pendingCapabilityIds/);

  valid.cases[0]!.requiredCapabilities = ["test-phone"];
  valid.capabilities[0]!.requiredForCaseIds = ["CASE-001", "CASE-002"];
  valid.cases[0]!.implementation.pendingCapabilityIds = ["test-phone"];
  assert.doesNotThrow(() => defineFormalExecutionManifest(valid));

  const incomplete = manifest();
  incomplete.cases[0]!.requiredOperations = [];
  assert.throws(
    () => defineFormalExecutionManifest(incomplete),
    /requiredOperations, dataWritePolicy and implementation together/
  );
});

test("effectful v5 cases require a valid result-evidence strategy", () => {
  const missingEvidence = manifest();
  missingEvidence.cases[0]!.requiredOperations = [
    "upload_synthetic_file",
    "retain_tracked_residual"
  ];
  missingEvidence.cases[0]!.dataWritePolicy = "tracked_residual";
  missingEvidence.cases[0]!.implementation = { status: "source_complete" };
  missingEvidence.cases[0]!.operationEvidence = [];
  assert.throws(
    () => defineFormalExecutionManifest(missingEvidence),
    /Effectful operations require operationEvidence/
  );

  const responseFinal = manifest();
  responseFinal.cases[0]!.requiredOperations = [
    "upload_synthetic_file",
    "retain_tracked_residual"
  ];
  responseFinal.cases[0]!.dataWritePolicy = "tracked_residual";
  responseFinal.cases[0]!.implementation = { status: "source_complete" };
  responseFinal.cases[0]!.operationEvidence = [{
    operation: "upload_synthetic_file",
    strategy: "response_contract",
    responseContractId: "upload-response-v1",
    finality: "final",
    stableIdentityRequired: true
  }];
  assert.doesNotThrow(() => defineFormalExecutionManifest(responseFinal));

  const asyncWithoutQuery = structuredClone(responseFinal);
  asyncWithoutQuery.cases[0]!.operationEvidence = [{
    operation: "upload_synthetic_file",
    strategy: "response_then_query",
    responseContractId: "upload-response-v1",
    finality: "accepted",
    stableIdentityRequired: true
  }];
  assert.throws(
    () => defineFormalExecutionManifest(asyncWithoutQuery),
    /requires queryCapabilityId/
  );
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

test("multi-stage checkpoints survive resume and external transitions resolve idempotently", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-stages-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = manifest();
  definition.cases[0]!.executionStages = [{
    stageId: "submit",
    title: "submit registration",
    externalTransition: {
      transitionId: "registration-approved",
      kind: "human_attestation",
      actionSummary: "Approve the synthetic registration.",
      allowedOutcomes: ["approved"],
      requiredAttestationKeys: ["review_completed", "credential_sms_received"]
    }
  }, {
    stageId: "verify-login",
    title: "verify login",
    dependsOnStageIds: ["submit"]
  }];
  const frozen = defineFormalExecutionManifest(definition);
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const digest = "7".repeat(64);
  const initialized = await store.initialize({
    manifest: frozen,
    authorizationDigest: digest,
    testDataRunId: "run-staged",
    capabilities: evaluateCapabilities(frozen.capabilities, {})
  });
  assert.equal(initialized.schemaVersion, "formal-execution-record-v2");
  await store.completeStage(digest, frozen.cases[0]!, "submit");
  await store.awaitExternalTransition(digest, frozen.cases[0]!, "registration-approved");
  assert.equal((await store.pendingTransitions(digest)).length, 1);
  await assert.rejects(
    () => store.resolveExternalTransition({
      authorizationDigest: digest,
      manifest: frozen,
      transitionId: "registration-approved",
      outcome: "rejected",
      attestations: {
        review_completed: true,
        credential_sms_received: true
      }
    }),
    /rejects outcome/
  );
  await assert.rejects(
    () => store.resolveExternalTransition({
      authorizationDigest: digest,
      manifest: frozen,
      transitionId: "registration-approved",
      outcome: "approved",
      attestations: { review_completed: true }
    }),
    /requires true attestations/
  );
  const resolved = await store.resolveExternalTransition({
    authorizationDigest: digest,
    manifest: frozen,
    transitionId: "registration-approved",
    outcome: "approved",
    attestations: {
      review_completed: true,
      credential_sms_received: true
    }
  });
  assert.equal(resolved.duplicate, false);
  assert.equal((await store.resolveExternalTransition({
    authorizationDigest: digest,
    manifest: frozen,
    transitionId: "registration-approved",
    outcome: "approved",
    attestations: {
      review_completed: true,
      credential_sms_received: true
    }
  })).duplicate, true);
  await assert.rejects(
    () => store.resolveExternalTransition({
      authorizationDigest: digest,
      manifest: frozen,
      transitionId: "registration-approved",
      outcome: "approved",
      attestations: {
        review_completed: true,
        credential_sms_received: false
      }
    }),
    /requires true attestations/
  );
  assert.equal(await store.transitionOutcome(digest, "CASE-001", "registration-approved"), "approved");
  await store.completeStage(digest, frozen.cases[0]!, "verify-login");
  const summary = await store.summarize(digest);
  assert.deepEqual(summary.stageProgress[0]?.completedStageIds, ["submit", "verify-login"]);
  assert.equal(summary.pendingTransitions.length, 0);
});

test("per-case operation budgets are durable and idempotent across resume", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-operation-budget-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = manifest();
  definition.cases[0]!.requiredOperations = ["upload_synthetic_file"];
  definition.cases[0]!.operationBudgets = [{
    operation: "upload_synthetic_file",
    maxExecutions: 2
  }];
  definition.cases[0]!.dataWritePolicy = "tracked_residual";
  definition.cases[0]!.permissionProfile = "test_write";
  definition.cases[0]!.implementation = { status: "source_complete" };
  definition.cases[0]!.operationEvidence = [{
    operation: "upload_synthetic_file",
    strategy: "response_contract",
    responseContractId: "upload-response-v1",
    finality: "final",
    stableIdentityRequired: true
  }];
  const frozen = defineFormalExecutionManifest(definition);
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const digest = "8".repeat(64);
  await store.initialize({
    manifest: frozen,
    authorizationDigest: digest,
    testDataRunId: "run-budgeted",
    capabilities: []
  });
  assert.equal(
    await store.reserveOperation(digest, frozen.cases[0]!, "upload_synthetic_file", "variant-a"),
    "reserved"
  );
  assert.equal(
    await store.reserveOperation(digest, frozen.cases[0]!, "upload_synthetic_file", "variant-a"),
    "existing"
  );
  assert.equal(
    await store.reserveOperation(digest, frozen.cases[0]!, "upload_synthetic_file", "variant-b"),
    "reserved"
  );
  await assert.rejects(
    () => store.reserveOperation(digest, frozen.cases[0]!, "upload_synthetic_file", "variant-c"),
    /exhausted its upload_synthetic_file execution budget/
  );
});

test("v3 authorizations inherit operation budgets from their frozen manifest", () => {
  const definition = manifest().cases[0]!;
  definition.requiredOperations = ["upload_synthetic_file"];
  definition.operationBudgets = [{ operation: "upload_synthetic_file", maxExecutions: 2 }];
  assert.equal(caseExecutionScopeBlock(definition, {
    schemaVersion: "execution-authorization-v3",
    allowedOperations: ["upload_synthetic_file"]
  } as never), undefined);
  assert.match(caseExecutionScopeBlock(definition, {
    schemaVersion: "execution-authorization-v4",
    allowedOperations: ["upload_synthetic_file"],
    caseScopes: []
  } as never) ?? "", /no frozen execution-authorization-v4 case scope/);
});

test("resume reopens only terminal cases without durable side effects", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-safe-resume-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = defineFormalExecutionManifest(manifest());
  const store = new FormalExecutionStore(resolve(root, "ledger"), resolve(root, "artifacts"));
  const digest = "9".repeat(64);
  await store.initialize({
    manifest: definition,
    authorizationDigest: digest,
    testDataRunId: "run-safe-resume",
    capabilities: evaluateCapabilities(definition.capabilities, {})
  });
  await store.markBlocked(digest, "CASE-001", "Environment unavailable.");
  const passedAttempt = await store.beginCase(digest, "CASE-003");
  await store.finishCase(digest, "CASE-003", passedAttempt, "passed");
  assert.deepEqual(await store.reopenSafeRetryableCases(digest), ["CASE-001"]);
  const record = await store.read(digest);
  assert.equal(record?.cases["CASE-001"]?.status, "unknown");
  assert.equal(record?.cases["CASE-001"]?.attempts.length, 1);
  assert.equal(record?.cases["CASE-003"]?.status, "passed");
  assert.equal(record?.cleanup?.status, "unknown");
});

test("deterministic report separates deferred cases and keeps retry-aware redacted evidence", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-report-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const definition = defineFormalExecutionManifest(manifest());
  definition.cases[0]!.evidencePolicy = "sensitive";
  const artifactRoot = resolve(root, "artifacts");
  const store = new FormalExecutionStore(resolve(root, "ledger"), artifactRoot);
  const digest = "1".repeat(64);
  await store.initialize({
    manifest: definition,
    authorizationDigest: digest,
    targetBuildDigest: "2".repeat(64),
    testDataRunId: "run-report",
    capabilities: evaluateCapabilities(definition.capabilities, {}),
    caseIds: ["CASE-001"],
    deferredCases: [{
      caseId: "CASE-002",
      blockers: [{
        code: "capability_unavailable",
        source: "test-phone",
        unblockCondition: "Configure the isolated test phone provider."
      }]
    }]
  });
  const attempt = await store.beginCase(digest, "CASE-001");
  await store.finishCase(
    digest,
    "CASE-001",
    attempt,
    "passed",
    "password=secret-value",
    [],
    { assertions: ["token=private-value is not exposed"] }
  );
  await store.appendEvidenceRefs(digest, "CASE-001", [
    "artifacts/test-results/playwright/case-001-trace.zip"
  ]);
  await store.recordCleanup(digest, "passed");
  const summary = await store.summarize(digest);
  assert.equal(summary.cases.length, 1);
  assert.equal(summary.deferredCases[0]?.caseId, "CASE-002");
  assert.equal(summary.cleanup.status, "passed");
  const directory = resolve(artifactRoot, digest.slice(0, 12));
  const evidence = JSON.parse(
    await readFile(resolve(directory, "case-evidence/CASE-001.json"), "utf8")
  ) as {
    schemaVersion?: string;
    redactionStatus?: string;
    attempts?: Array<{
      reason?: string;
      assertions?: string[];
      operationEvidence?: unknown[];
    }>;
  };
  assert.equal(evidence.schemaVersion, "case-evidence-bundle-v2");
  assert.equal(evidence.redactionStatus, "safe_alternative_evidence");
  assert.equal(JSON.stringify(evidence).includes("secret-value"), false);
  assert.equal(JSON.stringify(evidence).includes("private-value"), false);
  assert.match(JSON.stringify(evidence), /case-001-trace\.zip/);
  const markdown = await readFile(resolve(directory, "execution-summary.md"), "utf8");
  assert.match(markdown, /CASE-002/);
  assert.match(markdown, /Configure the isolated test phone provider/);
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

test("formal source gate rejects blocker-only scripts and accepts runtime-pending implementations", () => {
  const blockerOnly = `
    formalCase("APP-CASE-001", "blocked", async (_fixtures, runtime) => {
      requireAllowedOperations(runtime);
      blockForMissingContracts("APP-CASE-001", ["adapter"]);
    });
  `;
  assert.match(
    inspectFormalSpecSource(blockerOnly, ["APP-CASE-001"]).issues.join("\n"),
    /fixed missing-contract blocker|no business action or assertion/
  );

  const unconditional = `
    formalCase("APP-CASE-001", "blocked", async () => {
      throw new FormalBlockedError("not implemented");
    });
  `;
  assert.match(
    inspectFormalSpecSource(unconditional, ["APP-CASE-001"]).issues.join("\n"),
    /unconditional FormalBlockedError/
  );

  const pending = `
    formalCase("APP-CASE-001", "candidate", async ({ page }, runtime) => {
      await page.goto("/register");
      const adapter = await runtime.useCapability("registration-postcondition");
      await expect(page.getByRole("button", { name: "提交" })).toBeVisible();
      runtime.addAssertion(String(adapter));
    });
  `;
  assert.deepEqual(inspectFormalSpecSource(pending, ["APP-CASE-001"]).issues, []);

  const sourceBackedBoundary = `
    formalCase("APP-CASE-002", "candidate", async ({ page }) => {
      await page.goto("/source-backed");
      await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
      throw new FormalBlockedError("Downstream runtime validation remains pending.");
    });
  `;
  assert.deepEqual(
    inspectFormalSpecSource(sourceBackedBoundary, ["APP-CASE-002"]).issues,
    []
  );
});

test("formal Runner applies the source gate to the complete discovered script set", () => {
  assert.doesNotThrow(() => assertFormalSpecSources([
    {
      path: "tests/web/example/one.formal.spec.ts",
      source: 'formalCase("APP-CASE-001", "one", async (_f, runtime) => { runtime.addAssertion("one"); });'
    },
    {
      path: "tests/web/example/two.formal.spec.ts",
      source: 'formalCase("APP-CASE-002", "two", async (_f, runtime) => { runtime.addAssertion("two"); });'
    }
  ], ["APP-CASE-001", "APP-CASE-002"]));
  assert.throws(
    () => assertFormalSpecSources([{
      path: "tests/web/example/one.formal.spec.ts",
      source: 'test.skip(); formalCase("APP-CASE-001", "one", async (_f, runtime) => { runtime.addAssertion("one"); });'
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

test("page session groups require complete, read-only mappings and serialize shared pages", () => {
  const definition = manifest();
  for (const item of definition.cases) {
    item.requiredOperations = [];
    item.dataWritePolicy = "no_write";
    item.permissionProfile = "read_only";
    item.implementation = { status: "source_complete" };
  }
  definition.pageSessionGroups = [{
    sessionGroupId: "shared-form",
    targetRoute: "/register",
    caseIds: ["CASE-001", "CASE-002"],
    resetStrategy: "preserve_unrelated_fields",
    isolationReason: "independent local fields",
    executionOrder: ["CASE-001", "CASE-002"]
  }, {
    sessionGroupId: "isolated",
    targetRoute: "/",
    caseIds: ["CASE-003"],
    resetStrategy: "new_context_per_case",
    isolationReason: "independent route",
    executionOrder: ["CASE-003"]
  }];
  assert.doesNotThrow(() => defineFormalExecutionManifest(definition));
  assert.equal(
    pageSessionGroupsRequireSingleWorker(definition, ["CASE-001", "CASE-002"]),
    true
  );
  assert.equal(
    pageSessionGroupsRequireSingleWorker(definition, ["CASE-001", "CASE-003"]),
    false
  );
  assert.equal(formalCaseIdFromTestTitle("CASE-001：producer"), "CASE-001");

  const incomplete = structuredClone(definition);
  incomplete.pageSessionGroups![1]!.caseIds = [];
  incomplete.pageSessionGroups![1]!.executionOrder = [];
  assert.throws(
    () => defineFormalExecutionManifest(incomplete),
    /must contain at least one case/
  );

  const unsafe = structuredClone(definition);
  unsafe.cases[0]!.requiredOperations = ["submit_registration"];
  unsafe.cases[0]!.dataWritePolicy = "tracked_residual";
  unsafe.cases[0]!.permissionProfile = "test_write";
  assert.throws(
    () => defineFormalExecutionManifest(unsafe),
    /may reuse a page only for read-only no-write cases without authorized external operations/
  );

  const authInSharedGroup = structuredClone(definition);
  authInSharedGroup.cases[0]!.requiredOperations = ["authenticate_test_account"];
  assert.throws(
    () => defineFormalExecutionManifest(authInSharedGroup),
    /without authorized external operations/
  );
});

test("manual OTP evidence requires a visible-browser execution path without an OTP provider", () => {
  const definition = manifest();
  definition.cases[0]!.requiredOperations = ["send_test_otp"];
  definition.cases[0]!.operationEvidence = [{
    operation: "send_test_otp",
    strategy: "ui_state",
    uiContractId: "otp-resend-countdown-v1",
    finality: "final",
    stableIdentityRequired: false
  }];
  assert.deepEqual(interactiveOtpCaseIds(definition, ["CASE-001"]), ["CASE-001"]);
  assert.deepEqual(interactiveOtpCaseIds(definition, ["CASE-002"]), []);
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
