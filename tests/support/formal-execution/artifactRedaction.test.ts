import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  sanitizeFormalArtifact,
  sanitizeFormalArtifactTrees
} from "../../../src/support/formal-execution/artifactRedaction.js";

test("formal artifact redaction cleans text and removes unsafe binary attachments", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-redaction-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const html = resolve(root, "report.html");
  const trace = resolve(root, "trace.zip");
  await writeFile(
    html,
    "phone=13800138000 password=unsafe Bearer abcdefghijk",
    "utf8"
  );
  await writeFile(trace, Buffer.from("binary-cookie=unsafe-value", "latin1"));
  assert.equal(await sanitizeFormalArtifact(html), true);
  const sanitized = await readFile(html, "utf8");
  assert.equal(sanitized.includes("13800138000"), false);
  assert.equal(sanitized.includes("unsafe"), false);
  assert.equal(sanitized.includes("[REDACTED]"), true);
  const removed = await sanitizeFormalArtifactTrees([trace]);
  assert.deepEqual(removed, [trace]);
  assert.equal(existsSync(trace), false);
});
