import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve(process.cwd(), "scripts/reset-full-test-state.ts");

test("full reset only exposes explicit local-cache cleanup", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /--clear-local-cache/u);
  assert.match(source, /--dry-run/u);
  assert.doesNotMatch(source, /purge-obsolete-workflow-state|purge-archived-evidence/u);
});

test("full reset does not scan or mutate engineering assets and run archives", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.doesNotMatch(source, /collectRequestArchives|collectOrphanTestRequests|archiveRequestPath/u);
  assert.doesNotMatch(source, /testcases\/archive|resolve\(root, "testcases"\)|resolve\(root, "tests"\)/u);
  assert.match(source, /\.local\/test-task-runtime/u);
  assert.match(source, /\.local\/test-runs-archive/u);
  for (const cacheDirectory of [
    ".local/test-review-cache",
    ".local/playwright-explore-profile",
    ".local/playwright-selector-verification",
    ".local/preview-style-test"
  ]) {
    assert.ok(source.includes(cacheDirectory));
  }
  for (const protectedDirectory of [
    ".local/test-runs",
    ".local/test-ledger",
    ".local/repositories",
    ".local/upload-inbox"
  ]) {
    assert.ok(!source.includes(`\"${protectedDirectory}\"`));
  }
});
