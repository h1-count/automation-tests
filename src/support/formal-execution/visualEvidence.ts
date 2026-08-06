import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Locator, TestInfo } from "@playwright/test";

export interface VisualReviewRequest {
  schemaVersion: "visual-review-request-v1";
  caseId: string;
  rubricId: string;
  rubric: string[];
  captureScope: "element";
  screenshotFile: string;
  screenshotDigest: string;
}

/**
 * Produces a minimal, local-only screenshot request for host-model review.
 * It deliberately does not call a Capability Provider or claim a model verdict.
 */
export async function captureVisualReviewRequest(input: {
  locator: Locator;
  testInfo: TestInfo;
  caseId: string;
  rubricId: string;
  rubric: string[];
  evidencePolicy?: "standard" | "sensitive";
}): Promise<{ request: VisualReviewRequest; requestPath: string }> {
  if (input.evidencePolicy === "sensitive") {
    throw new Error("Sensitive cases cannot capture screenshots for model review.");
  }
  if (!/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}$/u.test(input.caseId)) {
    throw new Error("Visual review requires a safe formal caseId.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/u.test(input.rubricId)) {
    throw new Error("Visual review requires a safe rubricId.");
  }
  const rubric = input.rubric.map((item) => item.trim()).filter(Boolean);
  if (rubric.length === 0 || rubric.some((item) => item.length > 200)) {
    throw new Error("Visual review requires concise, non-empty rubric statements.");
  }

  const screenshotFile = `${input.rubricId}.png`;
  const screenshotPath = input.testInfo.outputPath("visual-review", screenshotFile);
  await mkdir(dirname(screenshotPath), { recursive: true });
  const screenshot = await input.locator.screenshot({
    path: screenshotPath,
    animations: "disabled",
    caret: "hide"
  });
  const request: VisualReviewRequest = {
    schemaVersion: "visual-review-request-v1",
    caseId: input.caseId,
    rubricId: input.rubricId,
    rubric,
    captureScope: "element",
    screenshotFile,
    screenshotDigest: createHash("sha256").update(screenshot).digest("hex")
  };
  const requestPath = input.testInfo.outputPath(
    "visual-review",
    `${input.rubricId}.request.json`
  );
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return { request, requestPath };
}
