import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { classifyStagedFile, runScan, scanSensitivity, type StagedFile } from "../../../src/support/sources-ingest/ingest.js";
import { backfillManifestSha256, computeSourceHash, fileSha256, loadSourcesManifest } from "../../../src/support/sources-ingest/sourcesManifest.js";

interface Fixture {
  root: string;
  sourcesRoot: string;
  stagingRoot: string;
  inboxDir: string;
  manifestPaths: { sourcesRoot: string };
  cleanup: () => Promise<void>;
}

async function createFixture(materials: Array<{ id: string; path: string; content: string }>): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "sources-ingest-"));
  const sourcesRoot = resolve(root, "sources");
  const stagingRoot = resolve(root, "staging");
  const inboxDir = resolve(root, "inbox");
  await mkdir(sourcesRoot, { recursive: true });
  for (const material of materials) {
    const target = resolve(sourcesRoot, material.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, material.content);
  }
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(inboxDir, { recursive: true });
  return { root, sourcesRoot, stagingRoot, inboxDir, manifestPaths: { sourcesRoot }, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function writeManifest(fixture: Fixture, materials: Array<{ id: string; path: string; sha256?: string }>): Promise<void> {
  const loaded = {
    version: 4,
    knowledge_indexes: [
      { id: "demo-index", project: "demo", path: "indexes/demo.yaml", status: "reviewed", covered_material_ids: ["bt-protocol"] }
    ],
    materials: materials.map((material) => ({
      id: material.id,
      type: "device-protocol",
      path: material.path,
      ...(material.sha256 ? { sha256: material.sha256 } : {}),
      source: "repository-catalog",
      source_version: "20241202",
      applicable_projects: ["demo"],
      reference_scopes: ["bluetooth"],
      status: "active",
      notes: "fixture"
    }))
  };
  const { stringify } = await import("yaml");
  await writeFile(resolve(fixture.sourcesRoot, "manifest.yaml"), stringify(loaded, { lineWidth: 0 }));
}

async function stageFile(fixture: Fixture, name: string, content: string): Promise<void> {
  await writeFile(resolve(fixture.stagingRoot, name), content);
}

function staged(name: string, content: string): StagedFile {
  return {
    absolutePath: `/tmp/staging/${name}`,
    displayPath: `/tmp/staging/${name}`,
    fileName: name,
    sizeBytes: content.length,
    sha256: "0".repeat(64)
  };
}

test("duplicate: hash equality with an active material is a no-op classification", async () => {
  const fixture = await createFixture([{ id: "bt-protocol", path: "knowledge-base/bt.docx", content: "protocol-v1" }]);
  try {
    const hash = fileSha256(resolve(fixture.sourcesRoot, "knowledge-base/bt.docx"));
    await writeManifest(fixture, [{ id: "bt-protocol", path: "knowledge-base/bt.docx", sha256: hash }]);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const outcome = classifyStagedFile({ ...staged("bt.docx", "protocol-v1"), sha256: hash }, manifest);
    assert.equal(outcome.classification, "duplicate");
    assert.deepEqual(outcome.matchedMaterialIds, ["bt-protocol"]);
  } finally {
    await fixture.cleanup();
  }
});

test("new-version: same normalized base name with a different hash proposes a confirmed replacement", async () => {
  const fixture = await createFixture([{ id: "bt-protocol", path: "knowledge-base/蓝牙通讯协议20241202.docx", content: "v1" }]);
  try {
    await writeManifest(fixture, [{ id: "bt-protocol", path: "knowledge-base/蓝牙通讯协议20241202.docx" }]);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const outcome = classifyStagedFile(staged("蓝牙通讯协议20250301.docx", "v2"), manifest);
    assert.equal(outcome.classification, "new-version-candidate");
    assert.deepEqual(outcome.matchedMaterialIds, ["bt-protocol"]);
    assert.equal(outcome.suggestedMode, "confirm");
  } finally {
    await fixture.cleanup();
  }
});

test("ambiguous: normalized collision across multiple materials requires user disambiguation", async () => {
  const fixture = await createFixture([
    { id: "lock-a", path: "knowledge-base/门锁协议20240101.docx", content: "a" },
    { id: "lock-b", path: "knowledge-base/门锁协议20240201.docx", content: "b" }
  ]);
  try {
    await writeManifest(fixture, [
      { id: "lock-a", path: "knowledge-base/门锁协议20240101.docx" },
      { id: "lock-b", path: "knowledge-base/门锁协议20240201.docx" }
    ]);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const outcome = classifyStagedFile(staged("门锁协议20250101.docx", "c"), manifest);
    assert.equal(outcome.classification, "ambiguous");
    assert.equal(outcome.matchedMaterialIds.length, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("not-source-candidate: review workbook naming never enters the sources manifest", async () => {
  const fixture = await createFixture([]);
  try {
    await writeManifest(fixture, []);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const outcome = classifyStagedFile(staged("f69de5d98b06-cases-review.xlsx", "workbook"), manifest);
    assert.equal(outcome.classification, "not-source-candidate");
    assert.equal(outcome.suggestedMode, "ignore");
  } finally {
    await fixture.cleanup();
  }
});

test("belongs-to-test-assets: firmware binaries route to the test-assets manifest", async () => {
  const fixture = await createFixture([]);
  try {
    await writeManifest(fixture, []);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const outcome = classifyStagedFile(staged("door-lock-firmware.bin", "binary"), manifest);
    assert.equal(outcome.classification, "belongs-to-test-assets");
    assert.equal(outcome.suggestedMode, "test-assets");
  } finally {
    await fixture.cleanup();
  }
});

test("new-material: unmatched files default to request-scoped with unknown metadata", async () => {
  const fixture = await createFixture([]);
  try {
    await writeManifest(fixture, []);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const outcome = classifyStagedFile(staged("智能门锁新需求说明.docx", "new"), manifest);
    assert.equal(outcome.classification, "new-material-candidate");
    assert.equal(outcome.suggestedMode, "request-scoped");
    assert.equal(outcome.suggestedType, "requirement");
  } finally {
    await fixture.cleanup();
  }
});

test("sensitive scan flags secrets in text files and defers binaries to manual review", async () => {
  const fixture = await createFixture([]);
  try {
    await stageFile(fixture, "plain.txt", "just documentation");
    await stageFile(fixture, "leaky.txt", "password = S3cretTokenValue12345678");
    await stageFile(fixture, "doc.docx", "binary-ish");
    assert.equal(scanSensitivity(resolve(fixture.stagingRoot, "plain.txt")), "clean");
    assert.equal(scanSensitivity(resolve(fixture.stagingRoot, "leaky.txt")), "suspect");
    assert.equal(scanSensitivity(resolve(fixture.stagingRoot, "doc.docx")), "manual-review");
  } finally {
    await fixture.cleanup();
  }
});

test("scan is idempotent and re-reporting stops after a handled decision", async () => {
  const fixture = await createFixture([{ id: "bt-protocol", path: "knowledge-base/bt.docx", content: "v1" }]);
  try {
    await writeManifest(fixture, [{ id: "bt-protocol", path: "knowledge-base/bt.docx" }]);
    await stageFile(fixture, "全新门锁需求.docx", "brand new");
    const options = { stagingRoots: [fixture.stagingRoot], inboxDir: fixture.inboxDir, manifestPaths: fixture.manifestPaths };
    const first = runScan(options);
    assert.equal(first.pending.length, 1);
    const second = runScan(options);
    assert.equal(second.pending.length, 1);
    assert.equal(second.pending[0].itemId, first.pending[0].itemId);
    const { recordHandledDecision } = await import("../../../src/support/sources-ingest/ingest.js");
    recordHandledDecision({ sha256: first.pending[0].file.sha256, fileName: "全新门锁需求.docx", decision: "ignore" }, options);
    const third = runScan(options);
    assert.equal(third.pending.length, 0);
    assert.equal(third.alreadyHandled, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("backfill adds material hashes idempotently and matches computed hashes", async () => {
  const fixture = await createFixture([
    { id: "bt-protocol", path: "knowledge-base/bt.docx", content: "v1" },
    { id: "guide", path: "knowledge-base/guide.txt", content: "guide" }
  ]);
  try {
    await writeManifest(fixture, [
      { id: "bt-protocol", path: "knowledge-base/bt.docx" },
      { id: "guide", path: "knowledge-base/guide.txt" }
    ]);
    const first = backfillManifestSha256(fixture.manifestPaths);
    assert.equal(first.updatedMaterialIds.length, 2);
    const second = backfillManifestSha256(fixture.manifestPaths);
    assert.equal(second.updatedMaterialIds.length, 0);
    assert.equal(second.alreadyHashedCount, 2);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    for (const material of manifest.materials) {
      assert.equal(material.sha256, computeSourceHash(resolve(fixture.sourcesRoot, material.path)));
    }
  } finally {
    await fixture.cleanup();
  }
});
