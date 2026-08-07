import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  assertCurrentAuthorizedScripts,
  buildExecutionAuthorizationManifest
} from "../../../src/support/formal-execution/authorization.js";
import { resolveLocalScriptDependencyClosure } from "../../../src/support/formal-execution/scriptDependencyClosure.js";

test("authorization and Runner share the exact recursive local script dependency closure", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-script-closure-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "api/project/dependency-closure";
  const planPath = resolve(root, "testcases/api/project/dependency-closure/plan.md");
  const entryPath = resolve(root, "tests/api/project/dependency-closure/example.formal.spec.ts");
  const helperPath = resolve(root, "tests/api/project/dependency-closure/helper.ts");
  const nestedPath = resolve(root, "tests/api/project/dependency-closure/nested.ts");
  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(dirname(entryPath), { recursive: true });
  await writeFile(planPath, "# Dependency closure plan\n", "utf8");
  await writeFile(
    entryPath,
    'import type { IgnoredType } from "./types.js";\nimport { helper } from "./helper.js";\nexport const formalScript: IgnoredType = helper;\n',
    "utf8"
  );
  await writeFile(
    helperPath,
    'export { nested as helper } from "./nested.js";\n',
    "utf8"
  );
  await writeFile(nestedPath, "export const nested = true;\n", "utf8");
  await writeFile(
    resolve(root, "tests/api/project/dependency-closure/types.ts"),
    "export type IgnoredType = boolean;\n",
    "utf8"
  );

  const manifest = buildExecutionAuthorizationManifest({
    schemaVersion: "execution-authorization-v3",
    requestId,
    environment: "test",
    scriptPaths: [entryPath],
    caseIds: ["CLOSURE-CASE-001"],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [],
    dataWritePolicy: "no_write",
    targetBuildDigest: "a".repeat(64),
    runnableCaseIds: ["CLOSURE-CASE-001"],
    deferredCases: [],
    capabilityEvidence: [],
    selectorEvidenceDigests: [],
    scriptReview: { level: "light", evidenceDigests: [] },
    workspaceRoot: root,
    createdAt: "2026-08-07T00:00:00.000Z"
  });
  assert.deepEqual(manifest.scriptDigests.map((item) => item.path), [
    "tests/api/project/dependency-closure/example.formal.spec.ts",
    "tests/api/project/dependency-closure/helper.ts",
    "tests/api/project/dependency-closure/nested.ts"
  ]);
  assert.equal(
    manifest.scriptDigests.some((item) => item.path.endsWith("/types.ts")),
    false
  );
  assert.doesNotThrow(() => assertCurrentAuthorizedScripts(manifest, [entryPath], root));

  assert.throws(
    () => assertCurrentAuthorizedScripts({
      scriptDigests: manifest.scriptDigests.filter((item) => !item.path.endsWith("/nested.ts"))
    }, [entryPath], root),
    /missing local dependencies: .*nested\.ts/
  );

  const unrelatedPath = resolve(root, "tests/api/project/dependency-closure/unrelated.ts");
  const unrelatedContent = "export const unrelated = true;\n";
  await writeFile(unrelatedPath, unrelatedContent, "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts({
      scriptDigests: [
        ...manifest.scriptDigests,
        {
          path: "tests/api/project/dependency-closure/unrelated.ts",
          digest: createHash("sha256").update(unrelatedContent).digest("hex")
        }
      ]
    }, [entryPath], root),
    /unexpected frozen scripts: .*unrelated\.ts/
  );

  await writeFile(
    helperPath,
    'export { nested as helper } from "./nested.js";\n// byte drift\n',
    "utf8"
  );
  assert.throws(
    () => assertCurrentAuthorizedScripts(manifest, [entryPath], root),
    /Script changed/
  );
});

test("dependency closure rejects unresolved and non-literal local module selection", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-script-closure-invalid-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const entryPath = resolve(root, "tests/api/project/request/example.formal.spec.ts");
  await mkdir(dirname(entryPath), { recursive: true });
  await writeFile(entryPath, 'import "./missing.js";\n', "utf8");
  assert.throws(
    () => resolveLocalScriptDependencyClosure({ workspaceRoot: root, entryPaths: [entryPath] }),
    /does not resolve to a workspace file/
  );

  await writeFile(entryPath, "const moduleName = './helper.js';\nvoid import(moduleName);\n", "utf8");
  assert.throws(
    () => resolveLocalScriptDependencyClosure({ workspaceRoot: root, entryPaths: [entryPath] }),
    /Dynamic import .* literal module specifier/
  );
});

test("formal Runner imports are frozen as leaves while candidate dynamic imports stay literal", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-script-runtime-leaf-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const entryPath = resolve(root, "tests/web/project/request/example.formal.spec.ts");
  const runtimePath = resolve(root, "src/support/formal-execution/formalCase.ts");
  const runtimeTransitivePath = resolve(
    root,
    "src/support/formal-execution/runtimeTransitive.ts"
  );
  await mkdir(dirname(entryPath), { recursive: true });
  await mkdir(dirname(runtimePath), { recursive: true });
  await writeFile(
    entryPath,
    'import { formalCase } from "../../../../src/support/formal-execution/formalCase.js";\nexport { formalCase };\n',
    "utf8"
  );
  await writeFile(
    runtimePath,
    'const runtimeModule = "./runtimeTransitive.js";\nvoid import(runtimeModule);\nexport const formalCase = true;\n',
    "utf8"
  );
  await writeFile(runtimeTransitivePath, "export const transitive = true;\n", "utf8");

  const closure = resolveLocalScriptDependencyClosure({
    workspaceRoot: root,
    entryPaths: [entryPath]
  });
  assert.deepEqual(closure.paths, [
    "src/support/formal-execution/formalCase.ts",
    "tests/web/project/request/example.formal.spec.ts"
  ]);
  assert.deepEqual([...closure.runtimeLeafPaths], [
    "src/support/formal-execution/formalCase.ts"
  ]);
  const frozen = {
    scriptDigests: await Promise.all(closure.paths.map(async (path) => ({
      path,
      digest: createHash("sha256")
        .update(await readFile(resolve(root, path)))
        .digest("hex")
    })))
  };
  assert.doesNotThrow(() => assertCurrentAuthorizedScripts(frozen, [entryPath], root));
  await writeFile(
    runtimePath,
    'const runtimeModule = "./runtimeTransitive.js";\nvoid import(runtimeModule);\nexport const formalCase = false;\n',
    "utf8"
  );
  assert.throws(
    () => assertCurrentAuthorizedScripts(frozen, [entryPath], root),
    /Script changed/
  );

  await writeFile(
    entryPath,
    "const helperModule = './helper.js';\nvoid import(helperModule);\n",
    "utf8"
  );
  assert.throws(
    () => resolveLocalScriptDependencyClosure({ workspaceRoot: root, entryPaths: [entryPath] }),
    /Dynamic import .* literal module specifier/
  );
});
