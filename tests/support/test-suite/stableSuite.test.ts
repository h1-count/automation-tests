import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  STABLE_TEST_SUITE_SCHEMA_VERSION,
  assessStableTestSuite,
  digestStableTestSuiteDesign,
  loadStableTestSuite,
  stableSuiteEntryScriptsForCases,
  stableSuiteManifestPath,
  validateStableTestSuite,
  type StableTestSuiteManifest
} from "../../../src/support/test-suite/stableSuite.js";
import {
  semanticBuildEvidenceDigest,
  semanticBuildEvidenceValue
} from "../../../src/support/formal-execution/buildEvidenceIdentity.js";
import { digestStableScriptClosure } from "../../../src/support/test-suite/scriptAssets.js";
import { sha256Canonical } from "../../../src/support/task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../../../src/support/task-workflow/types.js";

const suiteId = "web/demo/registration";

test("exact stable suite selects direct execution without regenerating design assets", async () => {
  const harness = await createHarness();
  const result = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "direct_execute");
  assert.deepEqual(result.selectedCaseIds, ["CASE-001"]);
  assert.deepEqual(result.reasons, ["stable_scripts_verified", "suite_assets_exact"]);
  const suite = await loadStableTestSuite(suiteId, harness.root);
  assert.deepEqual(stableSuiteEntryScriptsForCases(suite, ["CASE-001"]), [
    "tests/web/demo/suites/registration/execution.manifest.ts",
    "tests/web/demo/suites/registration/registration.formal.spec.ts"
  ]);
});

test("a mapped formal script drift selects affected rebuild", async () => {
  const harness = await createHarness();
  await writeFile(resolve(harness.root, harness.specPath), "export const id = 'CASE-001';\nexport const changed = true;\n");
  const result = await assessStableTestSuite({
    suiteId,
    environment: "pre",
    profile: "affected",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "affected_rebuild");
  assert.deepEqual(result.affectedCaseIds, ["CASE-001"]);
  assert.deepEqual(result.selectedCaseIds, ["CASE-001"]);
});

test("core plan drift and dependency closure drift fail closed to full replan", async () => {
  const harness = await createHarness();
  await writeFile(resolve(harness.root, harness.planPath), "# changed plan\n");
  let result = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "full_replan");

  await writeFile(resolve(harness.root, harness.planPath), "# plan\n");
  await writeFile(resolve(harness.root, harness.specPath), "import './helper.js';\nexport const id = 'CASE-001';\n");
  await writeFile(
    resolve(harness.root, "tests/web/demo/suites/registration/helper.ts"),
    "export const helper = true;\n"
  );
  result = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "full_replan");
  assert.ok(result.reasons.includes("script_dependency_closure_drift"));
});

test("affected profile without a deterministic change map falls back to full feature", async () => {
  const harness = await createHarness();
  const result = await assessStableTestSuite({
    suiteId,
    environment: "test",
    profile: "affected",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "direct_execute");
  assert.equal(result.effectiveProfile, "full_feature");
  assert.deepEqual(result.selectedCaseIds, ["CASE-001"]);
});

test("target build refresh without selector semantic drift remains direct", async () => {
  const harness = await createHarness("selector_contract");
  await writeFile(resolve(harness.root, harness.contractPath), JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    targetBuildDigest: "9".repeat(64),
    locators: [{ role: "button", name: "Submit" }],
    verifiedAt: "2026-08-11T00:00:00.000Z"
  }));
  const result = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "direct_execute");
  assert.ok(result.reasons.includes("target_build_changed_contract_semantics_unchanged"));
});

test("one mapped selector component invalidates only its consuming case", async () => {
  const harness = await createHarness("selector_contract");
  const suitePath = stableSuiteManifestPath(suiteId, harness.root);
  const manifest = JSON.parse(await readFile(suitePath, "utf8")) as StableTestSuiteManifest;
  const contract = {
    schemaVersion: "selector-contract-evidence-v1",
    targetBuildDigest: "1".repeat(64),
    contracts: {
      registration: { role: "button", name: "Register" },
      login: { role: "button", name: "Login" }
    }
  };
  const contractText = JSON.stringify(contract);
  await writeFile(resolve(harness.root, harness.contractPath), contractText);
  manifest.caseIds = ["CASE-001", "CASE-002"];
  manifest.profiles = {
    full_feature: ["CASE-001", "CASE-002"],
    smoke: ["CASE-001"],
    failed_or_blocked: []
  };
  manifest.caseScriptBindings = [
    manifest.caseScriptBindings[0]!,
    { ...manifest.caseScriptBindings[0]!, caseId: "CASE-002" }
  ];
  manifest.buildContracts[0]!.digest = createHash("sha256").update(contractText).digest("hex");
  manifest.buildContracts[0]!.semanticDigest = semanticBuildEvidenceDigest(
    "selector_contract",
    Buffer.from(contractText)
  );
  const semantic = semanticBuildEvidenceValue(contract) as Record<string, unknown>;
  manifest.impactMap = [{
    path: harness.contractPath,
    kind: "json_contract_object",
    componentId: "registration",
    digest: sha256Canonical(contract.contracts.registration),
    caseIds: ["CASE-001"]
  }, {
    path: harness.contractPath,
    kind: "json_contract_object",
    componentId: "login",
    digest: sha256Canonical(contract.contracts.login),
    caseIds: ["CASE-002"]
  }, {
    path: harness.contractPath,
    kind: "json_contract_remainder",
    digest: sha256Canonical({ ...semantic, contracts: {} } as SafeJsonValue),
    caseIds: []
  }, ...manifest.impactMap.filter((entry) => entry.kind === "file")];
  const {
    suiteVersion: _suiteVersion,
    status: _status,
    sourceRequestId: _sourceRequestId,
    promotion: _promotion,
    ...design
  } = manifest;
  manifest.suiteVersion = digestStableTestSuiteDesign(design);
  await writeFile(suitePath, `${JSON.stringify(manifest, null, 2)}\n`);

  contract.contracts.registration.name = "Create account";
  await writeFile(resolve(harness.root, harness.contractPath), JSON.stringify(contract));
  const result = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(result.decision, "affected_rebuild");
  assert.deepEqual(result.affectedCaseIds, ["CASE-001"]);
});

async function createHarness(
  contractKind: "source_contract" | "selector_contract" = "source_contract"
): Promise<{
  root: string;
  planPath: string;
  specPath: string;
  contractPath: string;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "stable-suite-"));
  const planPath = "testcases/web/demo/suites/registration/plan.md";
  const casesPath = "testcases/web/demo/suites/registration/cases-registration.md";
  const manifestPath = "tests/web/demo/suites/registration/execution.manifest.ts";
  const specPath = "tests/web/demo/suites/registration/registration.formal.spec.ts";
  const contractPath = "testcases/web/demo/suites/registration/source-contract.json";
  await Promise.all([
    mkdir(resolve(root, "testcases/web/demo/suites/registration"), { recursive: true }),
    mkdir(resolve(root, "tests/web/demo/suites/registration"), { recursive: true })
  ]);
  await writeFile(resolve(root, planPath), "# plan\n");
  await writeFile(resolve(root, casesPath), "# cases\n");
  const contractContent = contractKind === "selector_contract"
    ? JSON.stringify({
        schemaVersion: "selector-contract-evidence-v1",
        targetBuildDigest: "1".repeat(64),
        locators: [{ role: "button", name: "Submit" }],
        verifiedAt: "2026-08-10T00:00:00.000Z"
      })
    : "{}\n";
  await writeFile(resolve(root, contractPath), contractContent);
  await writeFile(resolve(root, manifestPath), "export const formalExecutionManifest = {};\n");
  await writeFile(resolve(root, specPath), "export const id = 'CASE-001';\n");
  const identity = async (path: string) => ({
    path,
    digest: createHash("sha256").update(await import("node:fs/promises").then((fs) => fs.readFile(resolve(root, path)))).digest("hex")
  });
  const immutable = {
    schemaVersion: STABLE_TEST_SUITE_SCHEMA_VERSION,
    suiteId,
    plan: await identity(planPath),
    casePackages: [await identity(casesPath)],
    caseIds: ["CASE-001"],
    profiles: {
      full_feature: ["CASE-001"],
      smoke: ["CASE-001"],
      failed_or_blocked: []
    },
    formalManifest: { ...(await identity(manifestPath)), schemaVersion: "formal-execution-manifest-v1" as const },
    entryScripts: [await identity(manifestPath), await identity(specPath)].sort((left, right) => left.path.localeCompare(right.path)),
    scriptClosure: [await identity(manifestPath), await identity(specPath)].sort((left, right) => left.path.localeCompare(right.path)),
    caseScriptBindings: [{
      caseId: "CASE-001",
      entryScript: await identity(specPath),
      closureDigest: "",
      reviewDigest: "4".repeat(64),
      level: "verified" as const,
      verificationDigest: "5".repeat(64)
    }],
    impactMap: [{
      path: specPath,
      kind: "file" as const,
      digest: (await identity(specPath)).digest,
      caseIds: ["CASE-001"]
    }, {
      path: contractPath,
      kind: "json_contract_remainder" as const,
      digest: semanticBuildEvidenceDigest(contractKind, Buffer.from(contractContent)),
      caseIds: []
    }],
    buildContracts: [{
      kind: contractKind,
      ...(await identity(contractPath)),
      semanticDigest: semanticBuildEvidenceDigest(
        contractKind,
        Buffer.from(contractContent)
      )
    }],
    oracleContractDigest: "1".repeat(64),
    dataWritePolicy: "no_write" as const,
    resourceBudgets: [],
    resourcePoolBudgets: [],
    allowedEnvironments: ["test", "pre"] as Array<"test" | "pre">,
    scriptReview: { level: "light" as const, evidenceDigests: [] }
  };
  immutable.caseScriptBindings[0]!.closureDigest = digestStableScriptClosure(immutable.scriptClosure);
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
  const path = stableSuiteManifestPath(suiteId, root);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const validation = await validateStableTestSuite(suiteId, root);
  assert.deepEqual(validation.driftedPaths, []);
  return { root, planPath, specPath, contractPath };
}
