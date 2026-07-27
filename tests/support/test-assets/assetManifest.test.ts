import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  loadTestAssetManifest,
  resolveAssetPath,
  selectTestAsset,
  sha256,
  validateTestAssetManifest,
  type TestAssetManifest
} from "../../../src/support/test-assets/assetManifest.js";

function createManifest(assets: TestAssetManifest["assets"]): TestAssetManifest {
  return { version: 1, assets };
}

test("selects the unique active lazy-cat Android app package", () => {
  const manifest = loadTestAssetManifest();
  const selection = selectTestAsset(manifest, {
    project: "lazy-cat",
    kind: "app-package",
    platform: "android",
    scope: "login-register"
  });
  assert.equal(selection.status, "selected");
  assert.equal(selection.asset?.assetId, "lazy-cat-android-dev-1-0-1");
  assert.ok(selection.asset && resolveAssetPath(selection.asset));
});

test("does not select inventory-only assets or unmatched projects", () => {
  const manifest = loadTestAssetManifest();
  assert.equal(selectTestAsset(manifest, { project: "unknown-project", kind: "firmware-package" }).status, "not-found");
  assert.equal(selectTestAsset(manifest, { project: "lazy-cat", kind: "firmware-package" }).status, "not-found");
});

test("requires an explicit default when multiple active candidates match", () => {
  const manifest = createManifest([
    {
      assetId: "app-one",
      kind: "app-package",
      path: "one.apk",
      sha256: "a".repeat(64),
      status: "active",
      projects: ["demo"],
      platform: "android",
      version: "1.0.0",
      description: "first"
    },
    {
      assetId: "app-two",
      kind: "app-package",
      path: "two.apk",
      sha256: "b".repeat(64),
      status: "active",
      projects: ["demo"],
      platform: "android",
      version: "1.1.0",
      description: "second"
    }
  ]);
  assert.equal(selectTestAsset(manifest, { project: "demo", kind: "app-package", platform: "android" }).status, "ambiguous");
  manifest.assets[1]!.defaultSelection = true;
  assert.equal(selectTestAsset(manifest, { project: "demo", kind: "app-package", platform: "android" }).asset?.assetId, "app-two");
});

test("validates registration, hash integrity and path containment", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "test-assets-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "app"), { recursive: true });
  const appPath = resolve(root, "app", "demo.apk");
  await writeFile(appPath, "demo-package", "utf8");
  const manifest = createManifest([
    {
      assetId: "demo-app",
      kind: "app-package",
      path: "app/demo.apk",
      sha256: sha256(appPath),
      status: "active",
      projects: ["demo"],
      platform: "android",
      version: "1.0.0",
      defaultSelection: true,
      description: "demo app"
    }
  ]);
  assert.deepEqual(validateTestAssetManifest(manifest, { assetRoot: root }), []);

  const stale = createManifest([{ ...manifest.assets[0]!, sha256: "f".repeat(64) }]);
  assert.match(validateTestAssetManifest(stale, { assetRoot: root }).join("\n"), /SHA-256/);

  const outside = createManifest([{ ...manifest.assets[0]!, path: "../outside.apk" }]);
  assert.match(validateTestAssetManifest(outside, { assetRoot: root }).join("\n"), /test-assets/);

  await writeFile(resolve(root, "unregistered.bin"), "unregistered", "utf8");
  assert.match(validateTestAssetManifest(manifest, { assetRoot: root }).join("\n"), /未登记/);
});
