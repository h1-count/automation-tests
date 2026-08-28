import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  digestStableScriptClosure,
  scriptAssetCoverage,
  validateStableScriptAssets,
  type StableScriptAssets
} from "../../../src/support/test-suite/scriptAssets.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test("reviewed scripts are reusable but cannot enter direct_execute", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "stable-script-assets-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = "tests/web/demo/suites/login/execution.manifest.ts";
  const specPath = "tests/web/demo/suites/login/login.formal.spec.ts";
  await mkdir(resolve(root, "tests/web/demo/suites/login"), { recursive: true });
  await writeFile(resolve(root, manifestPath), "export const manifest = true;\n");
  await writeFile(resolve(root, specPath), "export const spec = true;\n");
  const closure = [manifestPath, specPath].map((path) => ({
    path,
    digest: digest(path === manifestPath ? "export const manifest = true;\n" : "export const spec = true;\n")
  }));
  const assets: StableScriptAssets = {
    schemaVersion: "stable-script-assets-v1" as const,
    formalManifest: closure[0]!,
    scriptClosure: closure,
    caseBindings: [{
      caseId: "CASE-001",
      entryScript: closure[1]!,
      closureDigest: digestStableScriptClosure(closure),
      reviewDigest: digest("review"),
      coveragePlanDigest: digest("coverage"),
      compilerVersion: "formal-web-script-compiler-v1",
      level: "reviewed" as const
    }]
  };
  validateStableScriptAssets(assets, ["CASE-001"], root);
  assert.deepEqual(scriptAssetCoverage(assets, ["CASE-001"]), {
    reusable: true,
    directlyExecutable: false,
    reason: "stable_scripts_reviewed_not_verified:CASE-001"
  });
  assets.caseBindings[0] = {
    ...assets.caseBindings[0]!,
    level: "verified",
    verificationDigest: digest("sealed-run")
  };
  assert.deepEqual(scriptAssetCoverage(assets, ["CASE-001"]), {
    reusable: true,
    directlyExecutable: true
  });
});
