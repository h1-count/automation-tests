import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const resetScript = readFileSync(resolve(root, "scripts/reset-full-test-state.ts"), "utf8");

test("full reset archives request-specific test directories even when no active testcase remains", () => {
  assert.match(resetScript, /collectRequestTestFiles\(\)/);
  assert.match(resetScript, /type\.name === "support"/);
  assert.match(resetScript, /project\.name\.startsWith\("_"\)/);
  assert.match(resetScript, /request\.name\.startsWith\("_"\)/);
  assert.match(resetScript, /collectFiles\(resolve\(projectPath, request\.name\), new Set\(\)\)/);
});

test("full reset does not collect shared capability roots as archive candidates", () => {
  assert.doesNotMatch(resetScript, /testImplementationFiles|customScriptFiles/);
  assert.doesNotMatch(resetScript, /collectFiles\(resolve\(projectRoot, "scripts"\)/);
  assert.doesNotMatch(resetScript, /collectFiles\(resolve\(projectRoot, "src"/);
  assert.match(resetScript, /保留共享基础能力/);
});
