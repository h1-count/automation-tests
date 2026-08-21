import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stringify, parse } from "yaml";
import { runScan } from "../../../src/support/sources-ingest/ingest.js";
import { applyPendingItem, slugifyMaterialId, type GitRunner } from "../../../src/support/sources-ingest/apply.js";
import { computeSourceHash, fileSha256, loadSourcesManifest } from "../../../src/support/sources-ingest/sourcesManifest.js";

interface Fixture {
  root: string;
  sourcesRoot: string;
  stagingRoot: string;
  inboxDir: string;
  manifestPaths: { sourcesRoot: string };
  options: { stagingRoots: string[]; inboxDir: string; manifestPaths: { sourcesRoot: string } };
  cleanup: () => Promise<void>;
}

function fakeGitRunner(failOnCommit = false): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (failOnCommit && args[0] === "commit") {
      return { status: 1, stdout: "", stderr: "commit refused (fixture)" };
    }
    if (args[0] === "rev-parse") {
      return { status: 0, stdout: "abc1234\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return Object.assign(runner, { calls });
}

async function createFixture(materials: Array<{ id: string; path: string; content: string }>): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "sources-apply-"));
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
  const manifest = {
    version: 4,
    knowledge_indexes: [
      { id: "demo-index", project: "demo", path: "indexes/demo.yaml", status: "reviewed", covered_material_ids: ["bt-protocol"] }
    ],
    materials: materials.map((material) => ({
      id: material.id,
      type: "device-protocol",
      path: material.path,
      sha256: fileSha256(resolve(sourcesRoot, material.path)),
      source: "repository-catalog",
      source_version: "20241202",
      applicable_projects: ["demo"],
      reference_scopes: ["bluetooth"],
      status: "active",
      notes: "fixture"
    }))
  };
  await writeFile(resolve(sourcesRoot, "manifest.yaml"), stringify(manifest, { lineWidth: 0 }));
  return {
    root,
    sourcesRoot,
    stagingRoot,
    inboxDir,
    manifestPaths: { sourcesRoot },
    options: { stagingRoots: [stagingRoot], inboxDir, manifestPaths: { sourcesRoot } },
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

test("register-new copies the file, appends a complete manifest entry and commits once", async () => {
  const fixture = await createFixture([]);
  try {
    await writeFile(resolve(fixture.stagingRoot, "apartment-lock-guide.txt"), "new protocol guide");
    const scan = runScan(fixture.options);
    assert.equal(scan.pending.length, 1);
    const git = fakeGitRunner();
    const result = applyPendingItem({
      ...fixture.options,
      itemId: scan.pending[0].itemId,
      mode: "register",
      materialId: "apartment-lock-guide",
      targetType: "device-protocol",
      targetDir: "knowledge-base/device-protocol",
      projects: ["demo"],
      scopes: ["device-access"],
      gitRunner: git
    });
    assert.equal(result.status, "applied");
    assert.equal(result.commit, "abc1234");
    const copied = resolve(fixture.sourcesRoot, "knowledge-base/device-protocol/apartment-lock-guide.txt");
    assert.ok(existsSync(copied));
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const entry = manifest.materials.find((material) => material.id === "apartment-lock-guide");
    assert.ok(entry);
    assert.equal(entry.path, "knowledge-base/device-protocol/apartment-lock-guide.txt");
    assert.equal(entry.sha256, fileSha256(copied));
    assert.equal(entry.status, "active");
    assert.equal(entry.sourceVersion, "unknown");
    const commits = git.calls.filter((args) => args[0] === "commit");
    assert.equal(commits.length, 1);
    assert.match(commits[0].join(" "), /test\(demo\): 登记新资料 apartment-lock-guide/);
    const after = runScan(fixture.options);
    assert.equal(after.pending.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("register-new rolls back manifest and copied file when the git commit fails", async () => {
  const fixture = await createFixture([]);
  const manifestBefore = readFileSync(resolve(fixture.sourcesRoot, "manifest.yaml"), "utf8");
  try {
    await writeFile(resolve(fixture.stagingRoot, "rollback-guide.txt"), "content");
    const scan = runScan(fixture.options);
    const git = fakeGitRunner(true);
    assert.throws(
      () =>
        applyPendingItem({
          ...fixture.options,
          itemId: scan.pending[0].itemId,
          mode: "register",
          materialId: "rollback-guide",
          gitRunner: git
        }),
      /登记失败已回滚/
    );
    assert.equal(readFileSync(resolve(fixture.sourcesRoot, "manifest.yaml"), "utf8"), manifestBefore);
    assert.equal(loadSourcesManifest(fixture.manifestPaths).materials.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("version replacement sinks the old version into version_history, marks stale indexes and removes the old file", async () => {
  const fixture = await createFixture([{ id: "bt-protocol", path: "knowledge-base/蓝牙通讯协议20241202.docx", content: "v1-content" }]);
  try {
    await writeFile(resolve(fixture.stagingRoot, "蓝牙通讯协议20250301.docx"), "v2-content");
    const scan = runScan(fixture.options);
    assert.equal(scan.pending[0].classification, "new-version-candidate");
    const git = fakeGitRunner();
    const result = applyPendingItem({
      ...fixture.options,
      itemId: scan.pending[0].itemId,
      mode: "register",
      supersedes: "bt-protocol",
      sourceVersion: "20250301",
      gitRunner: git
    });
    assert.equal(result.status, "applied");
    assert.deepEqual(result.staleIndexes, ["demo-index"]);
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const entry = manifest.materials.find((material) => material.id === "bt-protocol");
    assert.ok(entry);
    assert.equal(entry.path, "knowledge-base/蓝牙通讯协议20250301.docx");
    assert.equal(entry.sourceVersion, "20250301");
    assert.equal(entry.sha256, fileSha256(resolve(fixture.sourcesRoot, entry.path)));
    assert.ok(existsSync(resolve(fixture.sourcesRoot, entry.path)));
    assert.equal(existsSync(resolve(fixture.sourcesRoot, "knowledge-base/蓝牙通讯协议20241202.docx")), false);
    const history = entry.raw.version_history as Array<Record<string, unknown>>;
    assert.equal(history.length, 1);
    assert.equal(history[0].version, "20241202");
    assert.equal(history[0].path, "knowledge-base/蓝牙通讯协议20241202.docx");
    assert.equal(history[0].superseded_in_commit, "abc1234");
    const indexEntry = (loadSourcesManifest(fixture.manifestPaths).raw.knowledge_indexes as Array<Record<string, unknown>>)[0];
    assert.equal(indexEntry.status, "stale");
    const commitMessage = git.calls.filter((args) => args[0] === "commit")[0].join(" ");
    assert.match(commitMessage, /test\(demo\): 更新资料 bt-protocol 至新版本/);
  } finally {
    await fixture.cleanup();
  }
});

test("same-name replacement overwrites the single current path instead of keeping two files", async () => {
  const fixture = await createFixture([{ id: "guide", path: "api-docs/guide.txt", content: "old" }]);
  try {
    await writeFile(resolve(fixture.stagingRoot, "guide.txt"), "new");
    const scan = runScan(fixture.options);
    assert.equal(scan.pending[0].classification, "new-version-candidate");
    const result = applyPendingItem({
      ...fixture.options,
      itemId: scan.pending[0].itemId,
      mode: "register",
      supersedes: "guide",
      gitRunner: fakeGitRunner()
    });
    assert.equal(result.status, "applied");
    const target = resolve(fixture.sourcesRoot, "api-docs/guide.txt");
    assert.equal(readFileSync(target, "utf8"), "new");
    const manifest = loadSourcesManifest(fixture.manifestPaths);
    const entry = manifest.materials.find((material) => material.id === "guide");
    assert.equal(entry?.path, "api-docs/guide.txt");
    assert.equal((entry?.raw.version_history as Array<Record<string, unknown>>).length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("apply refuses execution when the staged file hash drifted since the scan", async () => {
  const fixture = await createFixture([]);
  try {
    const stagedPath = resolve(fixture.stagingRoot, "drift.txt");
    await writeFile(stagedPath, "first");
    const scan = runScan(fixture.options);
    await writeFile(stagedPath, "tampered");
    assert.throws(
      () => applyPendingItem({ ...fixture.options, itemId: scan.pending[0].itemId, mode: "register", materialId: "drift", gitRunner: fakeGitRunner() }),
      /内容与扫描时不一致/
    );
  } finally {
    await fixture.cleanup();
  }
});

test("suspect files are rejected from registration", async () => {
  const fixture = await createFixture([]);
  try {
    await writeFile(resolve(fixture.stagingRoot, "leaky.txt"), "password = S3cretTokenValue12345678");
    const scan = runScan(fixture.options);
    const result = applyPendingItem({ ...fixture.options, itemId: scan.pending[0].itemId, mode: "register", gitRunner: fakeGitRunner() });
    assert.equal(result.status, "rejected");
    assert.match(result.warnings[0], /suspect/);
  } finally {
    await fixture.cleanup();
  }
});

test("ambiguous items require explicit disambiguation", async () => {
  const fixture = await createFixture([
    { id: "lock-a", path: "knowledge-base/门锁协议20240101.docx", content: "a" },
    { id: "lock-b", path: "knowledge-base/门锁协议20240201.docx", content: "b" }
  ]);
  try {
    await writeFile(resolve(fixture.stagingRoot, "门锁协议20250101.docx"), "c");
    const scan = runScan(fixture.options);
    assert.equal(scan.pending[0].classification, "ambiguous");
    assert.throws(
      () => applyPendingItem({ ...fixture.options, itemId: scan.pending[0].itemId, mode: "register", gitRunner: fakeGitRunner() }),
      /必须由用户指认/
    );
  } finally {
    await fixture.cleanup();
  }
});

test("request-scoped mode records a decision without touching sources or git", async () => {
  const fixture = await createFixture([]);
  const manifestBefore = readFileSync(resolve(fixture.sourcesRoot, "manifest.yaml"), "utf8");
  try {
    await writeFile(resolve(fixture.stagingRoot, "one-off.txt"), "one-off attachment");
    const scan = runScan(fixture.options);
    const git = fakeGitRunner();
    const result = applyPendingItem({ ...fixture.options, itemId: scan.pending[0].itemId, mode: "request-scoped", gitRunner: git });
    assert.equal(result.status, "applied");
    assert.equal(git.calls.length, 0);
    assert.equal(readFileSync(resolve(fixture.sourcesRoot, "manifest.yaml"), "utf8"), manifestBefore);
    const after = runScan(fixture.options);
    assert.equal(after.pending.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("slugify keeps ascii slugs and falls back for chinese-only names", () => {
  assert.equal(slugifyMaterialId("Cloud Bridge Guide.pdf"), "cloud-bridge-guide");
  assert.equal(slugifyMaterialId("蓝牙通讯协议20241202.doc"), "");
});

async function makeZip(zipPath: string, files: Array<{ path: string; content: string | Buffer }>): Promise<void> {
  const staging = `${zipPath}.src`;
  await rm(staging, { recursive: true, force: true });
  for (const file of files) {
    const target = resolve(staging, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  await mkdir(dirname(zipPath), { recursive: true });
  const result = spawnSync("zip", ["-q", "-r", zipPath, "."], { cwd: staging, encoding: "utf8" });
  await rm(staging, { recursive: true, force: true });
  assert.equal(result.status, 0, `zip 打包失败：${result.stderr}`);
}

test("DSH-prefixed upload names still match their material for version detection", async () => {
  const fixture = await createFixture([{ id: "bt-protocol", path: "knowledge-base/蓝牙通讯协议20241202.docx", content: "v1" }]);
  try {
    await writeFile(resolve(fixture.stagingRoot, "abc123def456-蓝牙通讯协议20250301.docx"), "v2");
    const scan = runScan(fixture.options);
    assert.equal(scan.pending[0].classification, "new-version-candidate");
    assert.deepEqual(scan.pending[0].matchedMaterialIds, ["bt-protocol"]);
  } finally {
    await fixture.cleanup();
  }
});

test("zip package supersedes an old pdf: extracted directory, junk filtered, dir hash in manifest", async () => {
  const fixture = await createFixture([{ id: "bridge-guide", path: "平台文档/云云bridge指南.pdf", content: "old pdf" }]);
  try {
    const zipPath = resolve(fixture.stagingRoot, "abc123def456-云云bridge指南.zip");
    await makeZip(zipPath, [
      { path: "云云bridge指南/__MACOSX/junk", content: "junk" },
      { path: "云云bridge指南/.DS_Store", content: "junk" },
      { path: "云云bridge指南/云云bridge指南.md", content: "# 指南\n正文\n" },
      { path: "云云bridge指南/图片和附件/image 1.png", content: Buffer.from([137, 80, 78, 71]) }
    ]);
    const scan = runScan(fixture.options);
    assert.equal(scan.pending[0].classification, "new-version-candidate");
    const result = applyPendingItem({
      ...fixture.options,
      itemId: scan.pending[0].itemId,
      mode: "register",
      supersedes: "bridge-guide",
      sourceVersion: "20251127",
      gitRunner: fakeGitRunner()
    });
    assert.equal(result.status, "applied");
    const packageDir = resolve(fixture.sourcesRoot, "平台文档/云云bridge指南");
    assert.ok(existsSync(packageDir));
    const entries = readdirSync(packageDir);
    assert.ok(entries.includes("云云bridge指南.md"));
    assert.ok(entries.includes("图片和附件"));
    assert.equal(entries.includes("__MACOSX"), false);
    assert.equal(entries.includes(".DS_Store"), false);
    assert.equal(existsSync(resolve(fixture.sourcesRoot, "平台文档/云云bridge指南.pdf")), false);
    const entry = loadSourcesManifest(fixture.manifestPaths).materials.find((material) => material.id === "bridge-guide");
    assert.equal(entry?.path, "平台文档/云云bridge指南");
    assert.equal(entry?.sha256, computeSourceHash(packageDir));
    const history = entry?.raw.version_history as Array<Record<string, unknown>>;
    assert.equal(history[0].path, "平台文档/云云bridge指南.pdf");
  } finally {
    await fixture.cleanup();
  }
});

test("zip package registers as a new material directory", async () => {
  const fixture = await createFixture([]);
  try {
    const zipPath = resolve(fixture.stagingRoot, "def789abc012-门锁需求包.zip");
    await makeZip(zipPath, [
      { path: "门锁需求包/门锁需求.md", content: "# 需求\n规则\n" },
      { path: "门锁需求包/图片和附件/pic.png", content: Buffer.from([1, 2, 3]) }
    ]);
    const scan = runScan(fixture.options);
    const result = applyPendingItem({
      ...fixture.options,
      itemId: scan.pending[0].itemId,
      mode: "register",
      materialId: "smart-lock-requirement-package",
      targetType: "requirement",
      targetDir: "open-platform/需求",
      projects: ["open-platform"],
      gitRunner: fakeGitRunner()
    });
    assert.equal(result.status, "applied");
    const packageDir = resolve(fixture.sourcesRoot, "open-platform/需求/门锁需求包");
    assert.ok(existsSync(resolve(packageDir, "门锁需求.md")));
    const entry = loadSourcesManifest(fixture.manifestPaths).materials.find((material) => material.id === "smart-lock-requirement-package");
    assert.equal(entry?.path, "open-platform/需求/门锁需求包");
    assert.equal(entry?.sha256, computeSourceHash(packageDir));
  } finally {
    await fixture.cleanup();
  }
});

test("manifest round-trip stays byte-identical for the real sources manifest shape", async () => {
  const fixture = await createFixture([{ id: "bt-protocol", path: "knowledge-base/bt.docx", content: "v1" }]);
  try {
    const raw = readFileSync(resolve(fixture.sourcesRoot, "manifest.yaml"), "utf8");
    assert.equal(stringify(parse(raw), { lineWidth: 0 }), raw);
  } finally {
    await fixture.cleanup();
  }
});
