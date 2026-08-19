import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  STABLE_TEST_SUITE_SCHEMA_VERSION,
  digestStableTestSuiteDesign,
  stableSuiteManifestPath,
  type StableTestSuiteManifest
} from "../../../src/support/test-suite/stableSuite.js";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";
import { semanticBuildEvidenceDigest } from "../../../src/support/formal-execution/buildEvidenceIdentity.js";

test("v7 direct reuse records assessment and skips design confirmation", async () => {
  const root = await createStableSuiteHarness();
  const manager = new DurableWorkflowManager("web/demo/retest-001", root);
  const gate = await manager.initialize({
    suiteId: "web/demo/registration",
    reuse: "auto",
    environment: "test"
  });
  assert.equal(gate.definitionVersion, "v7");
  assert.equal(gate.activities["reuse-assessment"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["reuse-assessment"]?.outcome, "direct_execute");
  assert.equal(gate.activities["suite-validation"]?.state, "SUCCEEDED");
  assert.equal(gate.activities.readiness?.state, "READY");
  assert.equal(gate.activities["source-selection"], undefined);
  assert.equal(gate.activities["case-confirmation"], undefined);
  assert.equal(gate.activities["execution-authorization"]?.definition.kind, "policy_authorization");
  assert.equal(await fileExists(resolve(root, "testcases/web/demo/retest-001/plan.md")), false);
  const started = (await manager.events())[0]!;
  assert.equal(
    (started.payload.reuseAssessment as Record<string, unknown>).decision,
    "direct_execute"
  );
});

test("v7 affected rebuild confirms affected cases before build and readiness", async () => {
  const root = await createStableSuiteHarness();
  await writeFile(
    resolve(root, "tests/web/demo/suites/registration/registration.formal.spec.ts"),
    "export const id = 'CASE-001';\nexport const changed = true;\n"
  );
  const manager = new DurableWorkflowManager("web/demo/retest-affected", root);
  const gate = await manager.initialize({
    suiteId: "web/demo/registration",
    reuse: "auto",
    environment: "test"
  });
  assert.equal(gate.definitionVersion, "v7");
  assert.equal(gate.activities["reuse-assessment"]?.outcome, "affected_rebuild");
  assert.equal(gate.activities["impact-location"]?.state, "READY");
  assert.equal(gate.activities["source-selection"], undefined);
  assert.deepEqual(gate.activities["case-confirmation"]?.definition.dependencies, ["targeted-review"]);
  assert.deepEqual(gate.activities.build?.definition.dependencies, ["case-confirmation"]);
  assert.deepEqual(gate.activities.readiness?.definition.dependencies, ["build"]);
  assert.equal(
    gate.activities.readiness?.definition.metadata?.outputSchemaVersion,
    "execution-authorization-v4"
  );
  assert.equal(gate.activities["execution-authorization"]?.definition.kind, "execution_authorization");
  assert.equal(
    await fileExists(resolve(root, ".local/test-runs/web/demo/retest-affected/plan.md")),
    true
  );
  assert.equal(
    await fileExists(resolve(root, "tests/web/demo/retest-affected/registration.formal.spec.ts")),
    true
  );
  assert.match(
    await readFile(resolve(root, "tests/web/demo/retest-affected/execution.manifest.ts"), "utf8"),
    /formal-execution-manifest-v3/u
  );
});

test("v7 full replan keeps one case confirmation and no plan confirmation", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "stable-suite-v6-full-"));
  const requestRoot = resolve(root, "testcases/web/demo/new-feature-run");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), [
    "# plan",
    "",
    "| 用例包 | 说明 |",
    "| --- | --- |",
    "| `cases-feature.md` | full |"
  ].join("\n"));
  await writeFile(resolve(requestRoot, "cases-feature.md"), "# cases\n");
  const manager = new DurableWorkflowManager("web/demo/new-feature-run", root);
  const gate = await manager.initialize({
    suiteId: "web/demo/new-feature",
    reuse: "auto",
    environment: "test"
  });
  assert.equal(gate.definitionVersion, "v7");
  assert.equal(gate.activities["reuse-assessment"]?.outcome, "full_replan");
  assert.equal(gate.activities["source-selection"]?.state, "READY");
  assert.equal(gate.activities["impact-location"], undefined);
  assert.equal(gate.activities["plan-confirmation"], undefined);
  assert.ok(gate.activities["case-confirmation"]);
  assert.equal(
    gate.activities.readiness?.definition.metadata?.outputSchemaVersion,
    "execution-authorization-v4"
  );
});

async function createStableSuiteHarness(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "stable-suite-v6-"));
  const planPath = "testcases/web/demo/suites/registration/plan.md";
  const casesPath = "testcases/web/demo/suites/registration/cases-registration.md";
  const manifestPath = "tests/web/demo/suites/registration/execution.manifest.ts";
  const specPath = "tests/web/demo/suites/registration/registration.formal.spec.ts";
  const contractPath = "testcases/web/demo/suites/registration/source-contract.json";
  for (const path of [planPath, casesPath, manifestPath, specPath, contractPath]) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
  }
  await writeFile(resolve(root, planPath), "# stable plan\n");
  await writeFile(resolve(root, casesPath), "# stable cases\n");
  await writeFile(resolve(root, specPath), "export const id = 'CASE-001';\n");
  await writeFile(resolve(root, contractPath), "{}\n");
  const contractSemanticDigest = semanticBuildEvidenceDigest(
    "source_contract",
    Buffer.from("{}\n")
  );
  await writeFile(resolve(root, manifestPath), [
    "export const formalExecutionManifest = ",
    JSON.stringify({
      schemaVersion: "formal-execution-manifest-v4",
      requestId: "web/demo/source",
      suiteId: "web/demo/registration",
      sourceRequestId: "web/demo/source",
      projectId: "demo",
      environment: "test",
      buildEvidence: [{
        kind: "source_contract",
        path: contractPath,
        sha256: contractSemanticDigest
      }],
      capabilities: [],
      cases: [{
        caseId: "CASE-001",
        title: "registration",
        requiredCapabilities: [],
        requiredResources: [],
        producesResources: [],
        permissionProfile: "read_only",
        requiredOperations: [],
        dataWritePolicy: "no_write",
        implementation: { status: "source_complete" },
        businessOracles: [{
          oracleId: "ORACLE-CASE-001",
          ruleRef: "RULE-CASE-001",
          observationKind: "runtime_state",
          authorities: [{
            kind: "formal_user_decision",
            decisionType: "confirmed_test_contract",
            subjectDigest: "6".repeat(64)
          }]
        }]
      }]
    }, null, 2),
    ";\n"
  ].join(""));
  const identity = async (path: string) => ({
    path,
    digest: createHash("sha256").update(await readFile(resolve(root, path))).digest("hex")
  });
  const immutable = {
    schemaVersion: STABLE_TEST_SUITE_SCHEMA_VERSION,
    suiteId: "web/demo/registration",
    plan: await identity(planPath),
    casePackages: [await identity(casesPath)],
    caseIds: ["CASE-001"],
    profiles: {
      full_feature: ["CASE-001"],
      smoke: ["CASE-001"],
      failed_or_blocked: []
    },
    formalManifest: { ...(await identity(manifestPath)), schemaVersion: "formal-execution-manifest-v4" as const },
    entryScripts: [await identity(manifestPath), await identity(specPath)].sort((a, b) => a.path.localeCompare(b.path)),
    scriptClosure: [await identity(manifestPath), await identity(specPath)].sort((a, b) => a.path.localeCompare(b.path)),
    impactMap: [{
      path: specPath,
      kind: "file" as const,
      digest: (await identity(specPath)).digest,
      caseIds: ["CASE-001"]
    }, {
      path: contractPath,
      kind: "json_contract_remainder" as const,
      digest: semanticBuildEvidenceDigest("source_contract", Buffer.from("{}\n")),
      caseIds: []
    }],
    buildContracts: [{
      kind: "source_contract" as const,
      ...(await identity(contractPath)),
      semanticDigest: contractSemanticDigest
    }],
    oracleContractDigest: "1".repeat(64),
    dataWritePolicy: "no_write" as const,
    resourceBudgets: [],
    resourcePoolBudgets: [],
    allowedEnvironments: ["test"] as Array<"test" | "pre">,
    scriptReview: { level: "light" as const, evidenceDigests: ["2".repeat(64)] }
  };
  const manifest: StableTestSuiteManifest = {
    ...immutable,
    suiteVersion: digestStableTestSuiteDesign(immutable),
    status: "stable",
    sourceRequestId: "web/demo/source",
    promotion: {
      workflowHeadDigest: "3".repeat(64),
      authorizationDigest: "4".repeat(64),
      resultDigest: "5".repeat(64),
      promotedAt: "2026-08-10T00:00:00.000Z"
    }
  };
  const suitePath = stableSuiteManifestPath(manifest.suiteId, root);
  await mkdir(dirname(suitePath), { recursive: true });
  await writeFile(suitePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
