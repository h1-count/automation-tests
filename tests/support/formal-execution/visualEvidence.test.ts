import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import type { Locator, TestInfo } from "@playwright/test";
import { captureVisualReviewRequest } from "../../../src/support/formal-execution/visualEvidence.js";

test("visual review capture creates a digest-bound local request without a provider", async (context) => {
  const root = resolve(tmpdir(), `visual-evidence-${process.pid}-${Date.now()}`);
  context.after(() => rm(root, { recursive: true, force: true }));
  const png = Buffer.from("safe-local-png-placeholder", "utf8");
  const locator = {
    screenshot: async ({ path }: { path?: string }) => {
      assert.ok(path);
      await writeFile(path!, png);
      return png;
    }
  } as unknown as Locator;
  const testInfo = {
    outputPath: (...segments: string[]) => resolve(root, ...segments)
  } as unknown as TestInfo;

  const captured = await captureVisualReviewRequest({
    locator,
    testInfo,
    caseId: "WEB-VISUAL-001",
    rubricId: "company-card-layout",
    rubric: ["标题与状态标识无遮挡"]
  });
  assert.equal(captured.request.schemaVersion, "visual-review-request-v1");
  assert.match(captured.request.screenshotDigest, /^[a-f0-9]{64}$/u);
  assert.equal(captured.request.screenshotFile, "company-card-layout.png");
  assert.equal(JSON.parse(await readFile(captured.requestPath, "utf8")).caseId, "WEB-VISUAL-001");
  assert.equal(JSON.stringify(captured.request).includes(root), false);
});

test("visual review refuses screenshots for sensitive cases", async () => {
  await assert.rejects(
    captureVisualReviewRequest({
      locator: {} as Locator,
      testInfo: {} as TestInfo,
      caseId: "WEB-VISUAL-002",
      rubricId: "secret-form",
      rubric: ["表单布局完整"],
      evidencePolicy: "sensitive"
    }),
    /Sensitive cases cannot capture/
  );
});
