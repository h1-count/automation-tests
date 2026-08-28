import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  CapabilityProviderRegistry,
  createDefaultCapabilityProviderRegistry
} from "../../../src/support/formal-execution/capabilityProvider.js";
import { assessExecutionReadiness } from "../../../src/support/formal-execution/readiness.js";
import { resolveSelectorBuildIdentity } from "../../../src/support/formal-execution/selectorBuildIdentity.js";
import type {
  FormalCapabilityResult,
  FormalExecutionManifest
} from "../../../src/support/formal-execution/types.js";

const checkedAt = "2026-07-31T00:00:00.000Z";

function manifest(): FormalExecutionManifest {
  return {
    schemaVersion: "formal-execution-manifest-v1",
    scope: "request",
    requestId: "web/example/readiness",
    projectId: "example",
    environment: "test",
    cases: [
      {
        caseId: "READY-CASE-001",
        title: "read-only",
        requiredCapabilities: [],
        requiredResources: [],
        producesResources: []
      },
      {
        caseId: "READY-CASE-002",
        title: "producer",
        requiredCapabilities: ["write-fixture"],
        requiredResources: [],
        producesResources: ["created-resource"]
      },
      {
        caseId: "READY-CASE-003",
        title: "consumer",
        requiredCapabilities: [],
        requiredResources: ["created-resource"],
        producesResources: []
      }
    ],
    capabilities: [{
      id: "write-fixture",
      requiredForCaseIds: ["READY-CASE-002"],
      source: {
        kind: "provider",
        providerId: "write-fixture"
      },
      unavailableReason: "Fixture unavailable.",
      unblockCondition: "Register the write fixture provider."
    }]
  };
}

function unavailable(): FormalCapabilityResult[] {
  return [{
    capabilityId: "write-fixture",
    available: false,
    affectedCaseIds: ["READY-CASE-002"],
    reason: "Fixture unavailable.",
    unblockCondition: "Register the write fixture provider.",
    checkedAt,
    evidenceDigest: "a".repeat(64)
  }];
}

test("readiness runs available cases and defers unavailable producers and consumers", () => {
  const readiness = assessExecutionReadiness({
    manifest: manifest(),
    requestedCaseIds: [
      "READY-CASE-001",
      "READY-CASE-002",
      "READY-CASE-003"
    ],
    capabilityResults: unavailable()
  });
  assert.deepEqual(readiness.runnableCaseIds, ["READY-CASE-001"]);
  assert.deepEqual(
    readiness.deferredCases.map((item) => item.caseId),
    ["READY-CASE-002", "READY-CASE-003"]
  );
  assert.match(
    readiness.deferredCases[1]?.blockers[0]?.code ?? "",
    /dependency_root_deferred/
  );
});

test("readiness defers late capabilities until their external transition resolves", () => {
  const staged = manifest();
  staged.cases[1]!.executionStages = [{
    stageId: "submit",
    title: "submit synthetic registration",
    externalTransition: {
      transitionId: "review-approved",
      kind: "human_attestation",
      actionSummary: "Approve the synthetic registration in the test environment.",
      allowedOutcomes: ["approved"],
      requiredAttestationKeys: ["review_completed"]
    }
  }, {
    stageId: "verify",
    title: "verify approved login",
    dependsOnStageIds: ["submit"]
  }];
  staged.cases[1]!.requiredCapabilities = [{
    capabilityId: "write-fixture",
    checkAfterTransitionId: "review-approved"
  }];
  const readiness = assessExecutionReadiness({
    manifest: staged,
    requestedCaseIds: ["READY-CASE-002", "READY-CASE-003"],
    capabilityResults: unavailable()
  });
  assert.deepEqual(readiness.runnableCaseIds, ["READY-CASE-002", "READY-CASE-003"]);
  assert.equal(readiness.capabilityEvidence.length, 0);
});

test("a requested reusable-fixture producer makes its consumer runnable in the same run", () => {
  const reusable = manifest();
  reusable.cases[0]!.producesResources = [{
    name: "approved-tenant",
    resourceType: "tenant",
    disposition: "reusable_fixture",
    baselineContractId: "approved-enterprise-v1",
    baselineVersion: "v1",
    leaseMode: "exclusive",
    maxPoolSize: 2,
    retirementPolicy: "validate_quarantine_replace"
  }];
  reusable.cases[2]!.consumesResources = [{
    name: "approved-tenant",
    resourceType: "tenant",
    baselineContractId: "approved-enterprise-v1",
    leaseMode: "shared_read"
  }];
  reusable.cases[2]!.requiredResources = [];
  const readiness = assessExecutionReadiness({
    manifest: reusable,
    requestedCaseIds: ["READY-CASE-001", "READY-CASE-003"],
    capabilityResults: [],
    resourcePoolEvidence: []
  });
  assert.deepEqual(readiness.runnableCaseIds, ["READY-CASE-001", "READY-CASE-003"]);
  assert.deepEqual(readiness.initialRunnableCaseIds, ["READY-CASE-001"]);
  assert.deepEqual(readiness.scheduledCaseIds, ["READY-CASE-003"]);
  assert.deepEqual(readiness.executionWaves, [
    { index: 0, caseIds: ["READY-CASE-001"] },
    { index: 1, caseIds: ["READY-CASE-003"] }
  ]);
});

test("readiness distinguishes an invalid case from an unavailable valid case", () => {
  const readiness = assessExecutionReadiness({
    manifest: manifest(),
    requestedCaseIds: ["READY-CASE-002", "READY-CASE-999"],
    capabilityResults: unavailable()
  });
  assert.equal(readiness.runnableCount, 0);
  assert.equal(readiness.deferredCount, 1);
  assert.equal(readiness.invalidCount, 1);
  assert.equal(readiness.invalidCases[0]?.blockers[0]?.code, "case_not_declared");
});

test("readiness does not reinterpret frozen test assets as runtime capabilities", () => {
  const assetManifest: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v1",
    scope: "request",
    requestId: "web/example/asset-readiness",
    projectId: "example",
    environment: "test",
    buildEvidence: [{
      kind: "test_asset",
      assetId: "synthetic-document",
      sha256: "a".repeat(64),
      path: "test-assets/documents/synthetic.png"
    }],
    capabilities: [],
    cases: [{
      caseId: "ASSET-READY-001",
      title: "uses a frozen synthetic document",
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
  const readiness = assessExecutionReadiness({
    manifest: assetManifest,
    requestedCaseIds: ["ASSET-READY-001"],
    capabilityResults: []
  });
  assert.deepEqual(readiness.runnableCaseIds, ["ASSET-READY-001"]);
  assert.equal(readiness.deferredCount, 0);
});

test("reusable fixtures require a validated pool entry or an authorized lazy replacement", () => {
  const reusableManifest: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v1",
    scope: "request",
    requestId: "web/example/reusable-readiness",
    projectId: "example",
    environment: "test",
    buildEvidence: [{ kind: "source_contract", path: "contracts/reusable.json" }],
    capabilities: [],
    cases: [{
      caseId: "REUSABLE-LOGIN-001",
      title: "login with validated tenant",
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [{
        name: "approved-tenant",
        resourceType: "tenant",
        baselineContractId: "approved-enterprise-v1",
        leaseMode: "shared_read"
      }],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: ["authenticate_test_account"],
      dataWritePolicy: "no_write",
      implementation: { status: "source_complete" }
    }]
  };
  const withoutFixture = assessExecutionReadiness({
    manifest: reusableManifest,
    requestedCaseIds: ["REUSABLE-LOGIN-001"],
    capabilityResults: [],
    allowedOperations: ["authenticate_test_account"],
    resourcePoolEvidence: []
  });
  assert.equal(withoutFixture.deferredCases[0]?.blockers[0]?.code, "reusable_fixture_unavailable");

  const withPool = assessExecutionReadiness({
    manifest: reusableManifest,
    requestedCaseIds: ["REUSABLE-LOGIN-001"],
    capabilityResults: [],
    allowedOperations: ["authenticate_test_account"],
    resourcePoolEvidence: [{
      resourceType: "tenant",
      baselineContractId: "approved-enterprise-v1",
      availableCount: 1,
      evidenceDigest: "a".repeat(64),
      checkedAt
    }]
  });
  assert.deepEqual(withPool.runnableCaseIds, ["REUSABLE-LOGIN-001"]);

  const withReplacement = assessExecutionReadiness({
    manifest: reusableManifest,
    requestedCaseIds: ["REUSABLE-LOGIN-001"],
    capabilityResults: [],
    allowedOperations: ["authenticate_test_account", "create_test_resource"],
    resourcePoolEvidence: [],
    resourcePoolBudgets: [{
      resourceType: "tenant",
      baselineContractId: "approved-enterprise-v1",
      maxAvailable: 3,
      replacementBudget: 1,
      ttlHours: 72,
      retirementPolicy: "validate_quarantine_replace"
    }]
  });
  assert.deepEqual(withReplacement.runnableCaseIds, ["REUSABLE-LOGIN-001"]);
});

test("readiness validates case operation and write-policy declarations", () => {
  const definition = manifest();
  Object.assign(definition.cases[1]!, {
    requiredOperations: ["submit_registration"],
    dataWritePolicy: "tracked_residual",
    implementation: {
      status: "runtime_validation_pending",
      reachableBoundary: "submit",
      pendingCapabilityIds: ["write-fixture"]
    }
  });
  const missingOperation = assessExecutionReadiness({
    manifest: definition,
    requestedCaseIds: ["READY-CASE-002"],
    capabilityResults: unavailable(),
    allowedOperations: ["query_postcondition"],
    dataWritePolicy: "tracked_residual"
  });
  assert.equal(missingOperation.invalidCases[0]?.blockers[0]?.code, "operation_scope_mismatch");

  const wrongPolicy = assessExecutionReadiness({
    manifest: definition,
    requestedCaseIds: ["READY-CASE-002"],
    capabilityResults: unavailable(),
    allowedOperations: ["submit_registration"],
    dataWritePolicy: "ephemeral_cleanup"
  });
  assert.equal(wrongPolicy.invalidCases[0]?.blockers[0]?.code, "data_write_policy_mismatch");
});

test("an unimplemented runner adapter defers every valid case before authorization", () => {
  const readiness = assessExecutionReadiness({
    manifest: manifest(),
    requestedCaseIds: ["READY-CASE-001", "READY-CASE-002"],
    capabilityResults: unavailable(),
    globalBlockers: [{
      code: "runner_adapter_unavailable",
      source: "api",
      unblockCondition: "Implement and verify the api formal runner adapter."
    }]
  });
  assert.equal(readiness.runnableCount, 0);
  assert.equal(readiness.deferredCount, 2);
  assert.ok(readiness.deferredCases.every((item) =>
    item.blockers.some((blocker) => blocker.code === "runner_adapter_unavailable")
  ));
});

test("provider registry marks an unimplemented provider as invalid manifest input", async () => {
  const result = await new CapabilityProviderRegistry().check(
    manifest().capabilities,
    {
      requestId: "web/example/readiness",
      environment: "test",
      targetBuildDigest: "b".repeat(64)
    }
  );
  assert.equal(result[0]?.available, false);
  assert.equal(result[0]?.configurationError, "provider_not_registered");
  assert.match(result[0]?.evidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("readiness rejects only cases that reference an unimplemented provider", async () => {
  const capabilityResults = await new CapabilityProviderRegistry().check(
    manifest().capabilities,
    {
      requestId: "web/example/readiness",
      environment: "test"
    }
  );
  const readiness = assessExecutionReadiness({
    manifest: manifest(),
    requestedCaseIds: ["READY-CASE-001", "READY-CASE-002"],
    capabilityResults
  });
  assert.deepEqual(readiness.runnableCaseIds, ["READY-CASE-001"]);
  assert.equal(readiness.deferredCount, 0);
  assert.equal(readiness.invalidCount, 1);
  assert.equal(
    readiness.invalidCases[0]?.blockers[0]?.code,
    "provider_not_registered"
  );
});

test("default file provider binds real workspace evidence without exposing its contents", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "capability-provider-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const targetBuildDigest = "b".repeat(64);
  const contents = `${JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId: "web/example/readiness",
    targetBuildDigest,
    runtimeValidation: "runtime_verified"
  })}\n`;
  await writeFile(resolve(root, "selector-evidence.json"), contents, "utf8");
  const definition: FormalExecutionManifest["capabilities"][number] = {
    id: "selector-contract",
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "provider",
      providerId: "selector_evidence",
      configuration: {
        path: "selector-evidence.json",
        expectedDigest: createHash("sha256").update(contents).digest("hex")
      }
    },
    unavailableReason: "Selector evidence unavailable.",
    unblockCondition: "Regenerate selector evidence."
  };
  const result = await createDefaultCapabilityProviderRegistry().check(
    [definition],
    {
      requestId: "web/example/readiness",
      environment: "test",
      targetBuildDigest,
      workspaceRoot: root
    }
  );
  assert.equal(result[0]?.available, true);
  assert.match(result[0]?.evidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(contents.trim()), false);
});

test("selector evidence remains unavailable while runtime validation is pending", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-evidence-pending-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const targetBuildDigest = "c".repeat(64);
  const contents = `${JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId: "web/example/readiness",
    targetBuildDigest,
    runtimeValidation: "pending"
  })}\n`;
  await writeFile(resolve(root, "selector-evidence.json"), contents, "utf8");
  const definition: FormalExecutionManifest["capabilities"][number] = {
    id: "selector-contract",
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "provider",
      providerId: "selector_evidence",
      configuration: {
        path: "selector-evidence.json",
        expectedDigest: createHash("sha256").update(contents).digest("hex")
      }
    },
    unavailableReason: "Selector evidence unavailable.",
    unblockCondition: "Regenerate selector evidence."
  };
  const [result] = await createDefaultCapabilityProviderRegistry().check(
    [definition],
    {
      requestId: "web/example/readiness",
      environment: "test",
      targetBuildDigest,
      workspaceRoot: root
    }
  );
  assert.equal(result?.available, false);
  assert.match(result?.evidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(contents.trim()), false);
});

test("selector evidence scopes do not promote unverified routes", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-evidence-scopes-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const targetBuildDigest = "d".repeat(64);
  const contents = `${JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId: "web/example/readiness",
    targetBuildDigest,
    runtimeValidation: "pending",
    runtimeScopes: {
      registration: { status: "runtime_verified" },
      companyInfo: { status: "pending" }
    }
  })}\n`;
  await writeFile(resolve(root, "selector-evidence.json"), contents, "utf8");
  const definition = (scopeId: string): FormalExecutionManifest["capabilities"][number] => ({
    id: `selector-${scopeId}`,
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "provider",
      providerId: "selector_evidence",
      configuration: {
        path: "selector-evidence.json",
        expectedDigest: createHash("sha256").update(contents).digest("hex"),
        scopeId
      }
    },
    unavailableReason: "Selector evidence unavailable.",
    unblockCondition: "Regenerate selector evidence."
  });

  const result = await createDefaultCapabilityProviderRegistry().check(
    [definition("registration"), definition("companyInfo")],
    {
      requestId: "web/example/readiness",
      environment: "test",
      targetBuildDigest,
      workspaceRoot: root
    }
  );

  assert.equal(result[0]?.available, true);
  assert.equal(result[1]?.available, false);
});

test("runtime validation pending sentinel is not a registered capability", async () => {
  const definition: FormalExecutionManifest["capabilities"][number] = {
    id: "runtime-validation-pending",
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "provider",
      providerId: "runtime_validation_pending"
    },
    unavailableReason: "The callable adapter is not implemented.",
    unblockCondition: "Implement and review the adapter before readiness."
  };
  const [result] = await createDefaultCapabilityProviderRegistry().check(
    [definition],
    {
      requestId: "web/example/readiness",
      environment: "test"
    }
  );
  assert.equal(result?.available, false);
  assert.equal(result?.configurationError, "provider_not_registered");
  assert.match(result?.reason ?? "", /is not registered/);
  assert.match(result?.unblockCondition ?? "", /Implement and register/);
  assert.match(result?.evidenceDigest ?? "", /^[a-f0-9]{64}$/);
});

test("readiness derives the complete build digest from frozen selector evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-build-identity-"));
  const targetBuildDigest = "a".repeat(63) + "1";
  const source = resolve(root, "selector-contract.json");
  const sourceContent = JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId: "web/example/readiness",
    targetBuildDigest
  });
  await writeFile(source, sourceContent);
  const selectorManifest = manifest();
  selectorManifest.buildEvidence = [{
    kind: "selector_contract",
    path: "selector-contract.json",
    sha256: createHash("sha256").update(sourceContent).digest("hex")
  }];
  selectorManifest.cases[0]!.requiredCapabilities = ["selector-contract"];
  selectorManifest.capabilities.push({
    id: "selector-contract",
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "provider",
      providerId: "selector_evidence",
      configuration: { path: "selector-contract.json" }
    },
    unavailableReason: "Selector contract unavailable.",
    unblockCondition: "Regenerate selector evidence."
  });
  try {
    const resolved = await resolveSelectorBuildIdentity({
      manifest: selectorManifest,
      workspaceRoot: root
    });
    assert.equal(resolved.targetBuildDigest, targetBuildDigest);
    assert.deepEqual(resolved.sources, ["selector-contract.json"]);
    assert.match(resolved.evidenceDigests[0] ?? "", /^[a-f0-9]{64}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build identity validates active project-scoped test assets and freezes their digest", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "test-asset-build-identity-"));
  const targetBuildDigest = "b".repeat(64);
  const assetContent = Buffer.from("synthetic-static-asset", "utf8");
  const assetDigest = createHash("sha256").update(assetContent).digest("hex");
  await mkdir(resolve(root, "contracts"), { recursive: true });
  await mkdir(resolve(root, "test-assets/documents"), { recursive: true });
  const sourceContent = JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId: "web/example/asset-build",
    targetBuildDigest
  });
  await writeFile(resolve(root, "contracts/source.json"), sourceContent);
  await writeFile(resolve(root, "test-assets/documents/synthetic.bin"), assetContent);
  await writeFile(resolve(root, "test-assets/manifest.yaml"), `version: 1\nassets:\n  - assetId: synthetic-document\n    kind: test-document\n    path: documents/synthetic.bin\n    sha256: ${assetDigest}\n    status: active\n    projects: [example]\n    platform: web\n    version: 1.0.0\n    scopes: [registration]\n    defaultSelection: true\n    description: synthetic\n`);
  const assetManifest: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v1",
    scope: "request",
    requestId: "web/example/asset-build",
    projectId: "example",
    environment: "test",
    buildEvidence: [{
      kind: "selector_contract",
      path: "contracts/source.json",
      sha256: createHash("sha256").update(sourceContent).digest("hex")
    }, {
      kind: "test_asset",
      assetId: "synthetic-document",
      sha256: assetDigest,
      scope: "registration",
      path: "test-assets/documents/synthetic.bin"
    }],
    capabilities: [],
    cases: [{
      caseId: "ASSET-BUILD-001",
      title: "asset build",
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
  try {
    const resolved = await resolveSelectorBuildIdentity({ manifest: assetManifest, workspaceRoot: root });
    assert.equal(resolved.targetBuildDigest, targetBuildDigest);
    assert.equal(resolved.evidenceDigests.length, 2);
    assert.deepEqual(resolved.sources, [
      "contracts/source.json",
      "test-assets/documents/synthetic.bin"
    ]);
    await writeFile(resolve(root, "test-assets/documents/synthetic.bin"), "drifted");
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: assetManifest, workspaceRoot: root }),
      /digest differs/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a supplied build digest mismatch is invalid input with full evidence values", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-build-mismatch-"));
  const frozenDigest = "f".repeat(63) + "0";
  const suppliedDigest = "f".repeat(63) + "1";
  const sourceContent = JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId: "web/example/readiness",
    targetBuildDigest: frozenDigest
  });
  await writeFile(resolve(root, "selector-contract.json"), sourceContent);
  const selectorManifest = manifest();
  selectorManifest.buildEvidence = [{
    kind: "selector_contract",
    path: "selector-contract.json",
    sha256: createHash("sha256").update(sourceContent).digest("hex")
  }];
  selectorManifest.cases[0]!.requiredCapabilities = ["selector-contract"];
  selectorManifest.capabilities.push({
    id: "selector-contract",
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "provider",
      providerId: "selector_evidence",
      configuration: { path: "selector-contract.json" }
    },
    unavailableReason: "Selector contract unavailable.",
    unblockCondition: "Regenerate selector evidence."
  });
  try {
    await assert.rejects(
      resolveSelectorBuildIdentity({
        manifest: selectorManifest,
        workspaceRoot: root,
        suppliedTargetBuildDigest: suppliedDigest
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, new RegExp(frozenDigest));
        assert.match(message, new RegExp(suppliedDigest));
        assert.match(message, /selector-contract\.json/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capability runtime use is scoped to an available provider value", async () => {
  const definition: FormalExecutionManifest["capabilities"][number] = {
    id: "test-channel",
    requiredForCaseIds: ["READY-CASE-001"],
    source: {
      kind: "environment",
      variable: "FORMAL_TEST_CHANNEL",
      pattern: "^channel-[a-z]+$"
    },
    unavailableReason: "Test channel unavailable.",
    unblockCondition: "Configure the test channel."
  };
  const registry = new CapabilityProviderRegistry();
  await assert.rejects(
    registry.use(definition, {
      requestId: "web/example/readiness",
      environment: "test",
      processEnvironment: {}
    }),
    /Test channel unavailable/
  );
  assert.equal(await registry.use<string>(definition, {
    requestId: "web/example/readiness",
    environment: "test",
    processEnvironment: { FORMAL_TEST_CHANNEL: "channel-safe" }
  }), "channel-safe");
});
