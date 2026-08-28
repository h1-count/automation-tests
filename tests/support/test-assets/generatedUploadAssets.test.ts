import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS,
  UPLOAD_LIMIT_BYTES,
  prepareOpenPlatformRegistrationUploadAssets,
  readGeneratedUploadAssetManifest
} from "../../../src/support/test-assets/generatedUploadAssets.js";

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "generated-upload-assets-"));
  const seedPath = resolve(root, "test-assets/documents/open-platform/synthetic-business-license.png.b64");
  await mkdir(resolve(root, "test-assets/documents/open-platform"), { recursive: true });
  await writeFile(seedPath, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=\n", "utf8");
  return root;
}

test("generates deterministic local upload boundaries without committing the large files", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/open-platform/local-upload-boundary";
  const dryRun = prepareOpenPlatformRegistrationUploadAssets({ workspaceRoot: root, requestId, dryRun: true });
  assert.equal(dryRun.written, false);
  assert.equal(existsSync(dryRun.root), false);

  const generated = prepareOpenPlatformRegistrationUploadAssets({ workspaceRoot: root, requestId });
  assert.equal(generated.written, true);
  assert.deepEqual(generated.manifest.assets.map((asset) => asset.assetId), [...OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS]);
  assert.equal(generated.manifest.assets.find((asset) => asset.assetId === "license-exact-limit-png")?.byteLength, UPLOAD_LIMIT_BYTES);
  assert.equal(generated.manifest.assets.find((asset) => asset.assetId === "license-over-limit-png")?.byteLength, UPLOAD_LIMIT_BYTES + 1);
  assert.ok(generated.manifest.assets.every((asset) => asset.path.startsWith(".local/test-runs/web/open-platform/local-upload-boundary/")));
  assert.ok(readFileSync(generated.manifestPath, "utf8").includes("generated-upload-asset-manifest-v1"));
  assert.deepEqual(readGeneratedUploadAssetManifest({ workspaceRoot: root, requestId }), generated.manifest);

  const regenerated = prepareOpenPlatformRegistrationUploadAssets({ workspaceRoot: root, requestId });
  assert.equal(regenerated.manifest.generator.digest, generated.manifest.generator.digest);
  assert.deepEqual(regenerated.manifest.assets.map((asset) => asset.sha256), generated.manifest.assets.map((asset) => asset.sha256));
});

test("rejects generated asset drift and paths from another request", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/open-platform/local-upload-drift";
  const generated = prepareOpenPlatformRegistrationUploadAssets({ workspaceRoot: root, requestId });
  await writeFile(resolve(root, generated.manifest.assets[0]!.path), "drift", "utf8");
  assert.throws(() => readGeneratedUploadAssetManifest({ workspaceRoot: root, requestId }), /generated_asset_drift/);
});

test("rejects a manifest whose generator identity no longer matches the deterministic implementation", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/open-platform/local-upload-generator-drift";
  const generated = prepareOpenPlatformRegistrationUploadAssets({ workspaceRoot: root, requestId });
  const raw = JSON.parse(readFileSync(generated.manifestPath, "utf8")) as { generator: { digest: string } };
  raw.generator.digest = "f".repeat(64);
  await writeFile(generated.manifestPath, `${JSON.stringify(raw)}\n`, "utf8");
  assert.throws(() => readGeneratedUploadAssetManifest({ workspaceRoot: root, requestId }), /generated_asset_generator_drift/);
});
