import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  assertCurrentAuthorizedScripts,
  buildExecutionAuthorizationManifest
} from "../../../src/support/formal-execution/authorization.js";

test("execution-authorization-v5 separates run identity from a frozen stable suite", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "suite-auth-v5-"));
  await Promise.all([
    mkdir(resolve(root, "testcases/web/demo/suites/registration"), { recursive: true }),
    mkdir(resolve(root, "tests/web/demo/source"), { recursive: true })
  ]);
  await writeFile(resolve(root, "testcases/web/demo/suites/registration/plan.md"), "# plan\n");
  await writeFile(resolve(root, "testcases/web/demo/suites/registration/suite.manifest.json"), "{}\n");
  await writeFile(resolve(root, "tests/web/demo/source/execution.manifest.ts"), "export const formalExecutionManifest = {};\n");
  await writeFile(resolve(root, "tests/web/demo/source/case.formal.spec.ts"), "export const caseId = 'CASE-001';\n");
  const suiteManifestDigest = createHash("sha256").update("{}\n").digest("hex");
  const manifest = buildExecutionAuthorizationManifest({
    schemaVersion: STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    requestId: "web/demo/retest-001",
    environment: "test",
    scriptPaths: [
      "tests/web/demo/source/execution.manifest.ts",
      "tests/web/demo/source/case.formal.spec.ts"
    ],
    caseIds: ["CASE-001"],
    runnableCaseIds: ["CASE-001"],
    deferredCases: [],
    capabilityEvidence: [],
    targetBuildDigest: "1".repeat(64),
    selectorEvidenceDigests: ["2".repeat(64)],
    scriptReview: { level: "light", evidenceDigests: ["3".repeat(64)] },
    caseScopes: [{
      caseId: "CASE-001",
      permissionProfile: "read_only",
      requiredOperations: ["query_postcondition"],
      operationBudgets: [{ operation: "query_postcondition", maxExecutions: 1 }],
      dataWritePolicy: "no_write",
      consumesResources: [],
      producesResources: []
    }],
    resourcePoolBudgets: [],
    resourcePoolEvidence: [],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [],
    dataWritePolicy: "no_write",
    workspaceRoot: root,
    createdAt: "2026-08-10T00:00:00.000Z",
    suiteRef: {
      suiteId: "web/demo/registration",
      suiteVersion: "4".repeat(64),
      suiteManifestPath: "testcases/web/demo/suites/registration/suite.manifest.json",
      suiteManifestDigest,
      suitePlanPath: "testcases/web/demo/suites/registration/plan.md",
      formalManifestPath: "tests/web/demo/source/execution.manifest.ts",
      entryScriptPaths: [
        "tests/web/demo/source/execution.manifest.ts",
        "tests/web/demo/source/case.formal.spec.ts"
      ],
      authorizationMode: "policy_auto_no_write"
    }
  });
  assert.equal(manifest.schemaVersion, "execution-authorization-v5");
  if (manifest.schemaVersion !== "execution-authorization-v5") return;
  assert.equal(manifest.requestId, "web/demo/retest-001");
  assert.equal(manifest.runRequestId, "web/demo/retest-001");
  assert.equal(manifest.suiteId, "web/demo/registration");
  assert.equal(manifest.authorizationMode, "policy_auto_no_write");
  assert.match(manifest.digest, /^[a-f0-9]{64}$/u);
  assert.doesNotThrow(() => assertCurrentAuthorizedScripts(
    manifest,
    manifest.entryScriptPaths,
    root
  ));
  await writeFile(
    resolve(root, "tests/web/demo/source/case.formal.spec.ts"),
    "export const caseId = 'CASE-001';\nexport const drift = true;\n"
  );
  assert.throws(
    () => assertCurrentAuthorizedScripts(manifest, manifest.entryScriptPaths, root),
    /Script changed after execution authorization/u
  );
});

test("policy_auto_no_write rejects a write-capable case scope", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "suite-auth-v5-write-"));
  await Promise.all([
    mkdir(resolve(root, "testcases/web/demo/suites/registration"), { recursive: true }),
    mkdir(resolve(root, "tests/web/demo/source"), { recursive: true })
  ]);
  await writeFile(resolve(root, "testcases/web/demo/suites/registration/plan.md"), "# plan\n");
  await writeFile(resolve(root, "testcases/web/demo/suites/registration/suite.manifest.json"), "{}\n");
  await writeFile(resolve(root, "tests/web/demo/source/execution.manifest.ts"), "export const formalExecutionManifest = {};\n");
  await writeFile(resolve(root, "tests/web/demo/source/case.formal.spec.ts"), "export const caseId = 'CASE-001';\n");
  assert.throws(() => buildExecutionAuthorizationManifest({
    schemaVersion: STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    requestId: "web/demo/retest-001",
    environment: "test",
    scriptPaths: ["tests/web/demo/source/execution.manifest.ts", "tests/web/demo/source/case.formal.spec.ts"],
    caseIds: ["CASE-001"],
    runnableCaseIds: ["CASE-001"],
    targetBuildDigest: "1".repeat(64),
    selectorEvidenceDigests: [],
    scriptReview: { level: "standard", evidenceDigests: [] },
    caseScopes: [{
      caseId: "CASE-001",
      permissionProfile: "test_write",
      requiredOperations: ["create_test_resource"],
      operationBudgets: [{ operation: "create_test_resource", maxExecutions: 1 }],
      dataWritePolicy: "ephemeral_cleanup",
      consumesResources: [],
      producesResources: []
    }],
    allowedOperations: ["create_test_resource"],
    resourceBudgets: [],
    dataWritePolicy: "ephemeral_cleanup",
    workspaceRoot: root,
    suiteRef: {
      suiteId: "web/demo/registration",
      suiteVersion: "4".repeat(64),
      suiteManifestPath: "testcases/web/demo/suites/registration/suite.manifest.json",
      suiteManifestDigest: "5".repeat(64),
      suitePlanPath: "testcases/web/demo/suites/registration/plan.md",
      formalManifestPath: "tests/web/demo/source/execution.manifest.ts",
      entryScriptPaths: ["tests/web/demo/source/execution.manifest.ts", "tests/web/demo/source/case.formal.spec.ts"],
      authorizationMode: "policy_auto_no_write"
    }
  }), /policy_auto_no_write/u);
});
