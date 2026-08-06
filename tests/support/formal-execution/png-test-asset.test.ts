import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicOversizedPng } from "../../../src/support/test-assets/png.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("deterministic oversized PNG keeps its image chunks and reaches an invariant size", () => {
  const target = 11 * 1024 * 1024;
  const first = createDeterministicOversizedPng(onePixelPng, target);
  const second = createDeterministicOversizedPng(onePixelPng, target);
  assert.equal(first.length, target);
  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(first.subarray(-8, -4).toString("ascii"), "IEND");
});

test("oversized PNG generation rejects a non-PNG source and non-growing target", () => {
  assert.throws(() => createDeterministicOversizedPng(Buffer.from("not png"), 1024), /PNG signature/);
  assert.throws(() => createDeterministicOversizedPng(onePixelPng, onePixelPng.length), /larger/);
});
