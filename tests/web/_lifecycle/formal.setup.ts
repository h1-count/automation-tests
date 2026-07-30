import { expect, test } from "../../../src/fixtures/formalWebFixture.js";
import { resolveTestEnvironment } from "../../../src/env/testEnvironment.js";
import { loadConfirmedExecutionAuthorization } from "../../../src/support/formal-execution/authorization.js";
import { loadFormalExecutionManifest } from "../../../src/support/formal-execution/manifest.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath,
  sha256
} from "../../../src/support/test-assets/assetManifest.js";

test("正式执行 setup：校验环境与不可变执行清单", async () => {
  const requestId = process.env.AUTOMATION_REQUEST_ID?.trim();
  expect(requestId, "Formal project dependencies require AUTOMATION_REQUEST_ID.").toBeTruthy();
  const environment = resolveTestEnvironment();
  const snapshot = await loadConfirmedExecutionAuthorization(requestId!, environment.name);
  const manifest = await loadFormalExecutionManifest(requestId!);
  expect(snapshot.caseIds.length).toBeGreaterThan(0);
  expect(manifest.cases.map((item) => item.caseId).sort()).toEqual([...snapshot.caseIds].sort());
  const license = findTestAsset(loadTestAssetManifest(), "open-platform-synthetic-business-license");
  expect(license?.status).toBe("active");
  const licensePath = license ? resolveAssetPath(license) : undefined;
  expect(licensePath).toBeTruthy();
  expect(sha256(licensePath!)).toBe(license!.sha256);
});
