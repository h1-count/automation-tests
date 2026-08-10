import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Locator, Page, Response } from "@playwright/test";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment.js";
import {
  configureFormalSuite,
  expect,
  formalCase,
  FormalBlockedError,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import type { ExecutionOperationKind } from "../../../../src/support/formal-execution/authorization.js";
import type { FormalCaseDefinition, FormalCaseRuntime } from "../../../../src/support/formal-execution/types.js";
import type { CreateIntentRecord } from "../../../../src/support/test-data/types.js";
import { captureWebOperationOutcome } from "../../../../src/support/formal-execution/operationEvidence.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath,
  sha256
} from "../../../../src/support/test-assets/assetManifest.js";
import { createDeterministicOversizedPng } from "../../../../src/support/test-assets/png.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const caseId = "OPEN-REG-20260807-009";
const registrationPath = "/login?tab=register";
const syntheticLicenseAssetId = "open-platform-synthetic-business-license";
const uploadResponsePath = "/company/file-upload";
const clearlyUnderBothTenMbConventions = 10_000_000;
const clearlyOversizedBytes = 11 * 1024 * 1024;

interface UploadVariant {
  key: string;
  name: string;
  mimeType: string;
  expectedAccepted: boolean;
  buildBuffer(page: Page): Promise<Buffer>;
}

interface UploadRuntimeContract {
  cleanupActionId?: string;
}

configureFormalSuite(formalExecutionManifest);

formalCase(caseId, "营业执照格式与明确大小区间", async ({ browser }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  requireAuthorizedUploadRuntime(runtime, caseId);
  const pngBuffer = loadSyntheticLicenseBuffer();
  expect(
    pngBuffer.length,
    "正向合成证照必须明显低于十进制和二进制两种 10MB 口径"
  ).toBeLessThan(clearlyUnderBothTenMbConventions);
  const contract = requireUploadRuntimeContract(runtime, caseId);
  const unsupported = {
    key: "unsupported-format" as const,
    name: "synthetic-business-license.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic unsupported license fixture", "utf8")
  };
  expect(unsupported.buffer.length, "非允许格式 fixture 必须非空").toBeGreaterThan(0);
  expect(["image/png", "image/jpeg"], "非允许格式不得伪装为允许 MIME").not.toContain(unsupported.mimeType);
  const sizeClearlyOverLimit = {
    key: "size-clearly-over-limit" as const,
    name: "synthetic-license-over-limit.png",
    mimeType: "image/png",
    buffer: createDeterministicOversizedPng(pngBuffer, clearlyOversizedBytes)
  };
  expect(
    sizeClearlyOverLimit.buffer.length,
    "超界 fixture 必须至少为 11MiB，确保高于两种合理的 10MB 口径"
  ).toBeGreaterThanOrEqual(clearlyOversizedBytes);

  const variants: UploadVariant[] = [
    {
      key: "png-under-limit",
      name: "synthetic-business-license.png",
      mimeType: "image/png",
      expectedAccepted: true,
      buildBuffer: async () => pngBuffer
    },
    {
      key: "jpeg-under-limit",
      name: "synthetic-business-license.jpeg",
      mimeType: "image/jpeg",
      expectedAccepted: true,
      buildBuffer: async (page) => convertPngToJpegInMemory(page, pngBuffer)
    },
    {
      key: "jpg-under-limit",
      name: "synthetic-business-license.jpg",
      mimeType: "image/jpeg",
      expectedAccepted: true,
      buildBuffer: async (page) => convertPngToJpegInMemory(page, pngBuffer)
    },
    {
      key: unsupported.key,
      name: unsupported.name,
      mimeType: unsupported.mimeType,
      expectedAccepted: false,
      buildBuffer: async () => unsupported.buffer
    },
    {
      key: sizeClearlyOverLimit.key,
      name: sizeClearlyOverLimit.name,
      mimeType: sizeClearlyOverLimit.mimeType,
      expectedAccepted: false,
      buildBuffer: async () => sizeClearlyOverLimit.buffer
    }
  ];
  const expectedVariantKeys = new Set<string>([
    "png-under-limit",
    "jpeg-under-limit",
    "jpg-under-limit",
    "unsupported-format",
    "size-clearly-over-limit"
  ]);
  expect(new Set(variants.map((variant) => variant.key))).toEqual(expectedVariantKeys);

  for (const variant of variants) {
    await test.step(`独立核对 ${variant.key}`, async () => {
      const stageId = `upload-variant-${variant.key}-completed`;
      if (await runtime.stageCompleted(stageId)) {
        runtime.addAssertion(`${variant.key} restored from its durable parameter checkpoint`);
        return;
      }
      await executeUploadVariant(browser, runtime, contract.cleanupActionId, variant);
      await runtime.completeStage(stageId);
    });
  }

  runtime.addAssertion(
    "PNG/JPEG/JPG, unsupported format, and clearly-under/clearly-over size representatives were independently verified; exact 10MB equality was not asserted because the unit convention is undefined; uploads remained ephemeral and were not persisted as business entities"
  );
});

async function executeUploadVariant(
  browser: Browser,
  runtime: FormalCaseRuntime,
  cleanupActionId: string | undefined,
  variant: UploadVariant
): Promise<void> {
  const intent = await reserveUploadIntent(runtime, caseId, cleanupActionId, variant);
  const disposition = await prepareIntentOperation(
    runtime,
    intent,
    "upload_synthetic_file",
    `${caseId}-${variant.key}`,
    `${caseId}：${variant.key} 上传`
  );
  if (disposition === "settled") {
    throw new FormalBlockedError(
      `${caseId}：${variant.key} 的远端上传结果已定案，但 UI 消费断言尚无持久化 checkpoint；禁止仅凭资源台账判定该参数通过。`
    );
  }
  let intentSettled = false;
  try {
    runtime.classifyFailure("SCRIPT");
    await withIsolatedRegistrationPage(browser, async (_context, page, panel) => {
      const uploadTrigger = panel.locator('button[aria-label="上传注册营业执照"]');
      await requireUniqueVisible(uploadTrigger, "营业执照上传入口");
      const buffer = await variant.buildBuffer(page);
      if (variant.mimeType.startsWith("image/")) {
        await assertDecodableImage(page, buffer, variant.mimeType, variant.key);
      }
      runtime.classifyFailure("UNKNOWN");
      const captured = await captureWebOperationOutcome({
        page,
        operation: "upload_synthetic_file",
        method: "POST",
        path: uploadResponsePath,
        contractId: "open-platform-upload-response-v1",
        timeoutMs: 60_000,
        trigger: async () => {
          const chooserPromise = page.waitForEvent("filechooser");
          await uploadTrigger.click();
          const chooser = await chooserPromise;
          await chooser.setFiles({
            name: variant.name,
            mimeType: variant.mimeType,
            buffer
          });
        },
        ...(!variant.expectedAccepted
          ? {
              uiRejection: {
                contractId: "open-platform-upload-client-rejection-v1",
                detect: async () => {
                  const message = page.getByRole("alert").filter({
                    hasText: /(?:上传|文件|图片|格式|大小)/u
                  }).first();
                  return message.waitFor({ state: "visible", timeout: 3_000 })
                    .then(() => true)
                    .catch(() => false);
                }
              }
            }
          : {}),
        parse: readSafeUploadOutcome
      });
      runtime.addOperationEvidence(captured.evidence);
      if (!captured.parsed) {
        await runtime.manager.markCreationUnknown(
          intent.intentId,
          "Expected upload response was missing, duplicated, or outside the reviewed contract."
        );
        intentSettled = true;
        throw new FormalBlockedError(
          `${caseId}：${variant.key} 未观察到受控上传响应，已冻结重传并要求精确 reconciliation。`
        );
      }
      const outcome = captured.parsed;
      runtime.classifyFailure("PRODUCT");
      if (outcome.outcome === "rejected") {
        await runtime.manager.markCreationFailed(
          intent.intentId,
          "Synthetic file was rejected before a remote upload resource was confirmed."
        );
        intentSettled = true;
        expect(variant.expectedAccepted, `${variant.key} 应为受控拒绝变体`).toBe(false);
        runtime.addAssertion(`${variant.key} was deterministically rejected without a retained resource`);
        return;
      }

      // ephemeral_cleanup 允许上传：接受的产物登记为当前 run 可用资源，但不持久化为
      // tracked_residual 业务实体。stableIdentityRequired=false，因此即便响应缺少可登记
      // 的稳定标识也可定案；有稳定标识时记入 metadata 供审计。
      const stableResourceId = outcome.stableResourceId;
      const resourceId = stableResourceId
        ? `open-platform-upload-ephemeral-${stableResourceId}`
        : `open-platform-upload-ephemeral-${variant.key}-${runtime.snapshot.digest.slice(0, 8)}`;

      const resource = await runtime.manager.confirmCreatedResource({
        intentId: intent.intentId,
        resourceId,
        reusable: false,
        metadata: {
          variant: variant.key,
          contentType: variant.mimeType,
          ...(stableResourceId ? { stableResourceId } : {})
        },
        evidence: [{
          type: "web",
          summary: "Ephemeral synthetic upload accepted; the attachment is not persisted as a business entity."
        }]
      });
      intentSettled = true;

      runtime.classifyFailure("PRODUCT");
      if (!outcome.runtimeUiValue) {
        throw new FormalBlockedError(
          `${caseId}：${variant.key} 缺少仅用于本回合 UI 消费断言的响应值。`
        );
      }
      await expect(uploadTrigger).toHaveAttribute("aria-busy", "false");
      await expect(uploadTrigger).toHaveText(outcome.runtimeUiValue);
      expect(
        variant.expectedAccepted,
        `${variant.key} 被平台接受，但该参数预期不满足文件条件`
      ).toBe(true);
      expect(
        resource.state,
        "ephemeral_cleanup 上传产物登记为当前 run 可用且不持久化为 tracked_residual"
      ).toBe("available");
      runtime.addAssertion(`${variant.key} upload was accepted as an ephemeral attachment without a persisted business entity`);
    });
  } catch (error) {
    if (!intentSettled) {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        "Synthetic upload result was not observable; exact reconciliation is required."
      );
      throw new FormalBlockedError(
        `${caseId}：${variant.key} 的上传结果未知，已冻结重传并进入 reconciliation。`
      );
    }
    throw error;
  }
}

async function prepareIntentOperation(
  runtime: FormalCaseRuntime,
  intent: CreateIntentRecord,
  operation: ExecutionOperationKind,
  operationKey: string,
  label: string
): Promise<"execute" | "settled"> {
  if (intent.status === "planned") {
    await runtime.manager.markIntentCreating(intent.intentId);
    let reservation: "reserved" | "existing";
    try {
      reservation = await runtime.reserveOperation(operation, operationKey);
    } catch (error) {
      await runtime.manager.markCreationFailed(
        intent.intentId,
        `${label} did not start because its immutable operation budget was unavailable.`
      );
      throw error;
    }
    if (reservation === "existing") {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        `${label} found a prior reservation without a durable remote-start checkpoint.`
      );
      throw new FormalBlockedError(`${label} 存在旧 reservation，已冻结并要求只读 reconciliation。`);
    }
    return "execute";
  }
  if (intent.status === "creating") {
    await runtime.manager.markCreationUnknown(
      intent.intentId,
      `${label} was interrupted after remote execution started.`
    );
    throw new FormalBlockedError(`${label} 结果未知，已冻结重放并要求精确 reconciliation。`);
  }
  if (intent.status === "creation_unknown") {
    throw new FormalBlockedError(`${label} 结果未知，必须先完成精确 reconciliation。`);
  }
  return "settled";
}

async function reserveUploadIntent(
  runtime: FormalCaseRuntime,
  targetCaseId: string,
  cleanupActionId: string | undefined,
  variant: UploadVariant
) {
  try {
    return await runtime.manager.reserveCreateIntent({
      runId: runtime.runId,
      projectId: formalExecutionManifest.projectId,
      envId: runtime.snapshot.environment,
      caseId: targetCaseId,
      resourceType: "custom",
      syntheticKey: `${targetCaseId}-${variant.key}`,
      expectedOutcome: variant.expectedAccepted ? "create" : "reject",
      cleanupActionId,
      evidence: [{
        type: "web",
        summary: `Authorized one-shot synthetic upload intent for ${variant.key}.`
      }]
    });
  } catch {
    throw new FormalBlockedError(
      `${targetCaseId}：${variant.key} 缺少可恢复的上传 intent、数量预算或 ephemeral-cleanup 绑定。`
    );
  }
}

async function withIsolatedRegistrationPage<T>(
  browser: Browser,
  body: (context: BrowserContext, page: Page, panel: Locator) => Promise<T>
): Promise<T> {
  const environment = resolveTestEnvironment();
  const context = await browser.newContext({ baseURL: environment.openPlatformWebBaseUrl });
  try {
    const page = await context.newPage();
    await page.goto(registrationPath);
    const registrationTab = page.getByRole("tab", { name: "注册", exact: true });
    await requireUniqueVisible(registrationTab, "注册页签");
    await expect(registrationTab).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel", { name: "注册", exact: true });
    await requireUniqueVisible(panel, "注册表单面板");
    return await body(context, page, panel);
  } finally {
    await context.close();
  }
}

async function requireUniqueVisible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}的稳定语义定位应在客户端渲染完成后唯一`).toHaveCount(1);
  await expect(locator, `${label}应在客户端渲染完成后可见`).toBeVisible();
}

function requireAuthorizedUploadRuntime(runtime: FormalCaseRuntime, targetCaseId: string): void {
  const requiredOperations: ExecutionOperationKind[] = ["upload_synthetic_file"];
  const missing = requiredOperations.filter(
    (operation) => !runtime.snapshot.allowedOperations.includes(operation)
  );
  if (missing.length > 0) {
    throw new FormalBlockedError(
      `${targetCaseId} 未获不可变执行清单授权：${missing.join("、")}。`
    );
  }
  const definition = formalExecutionManifest.cases.find((item) => item.caseId === targetCaseId);
  const authorizedPolicy = runtime.snapshot.caseScopes
    ?.find((scope) => scope.caseId === targetCaseId)?.dataWritePolicy
    ?? definition?.dataWritePolicy
    ?? runtime.snapshot.dataWritePolicy;
  if (authorizedPolicy !== "ephemeral_cleanup") {
    throw new FormalBlockedError(`${targetCaseId} 仅允许 test 环境 ephemeral_cleanup 正式执行策略。`);
  }
}

function requireUploadRuntimeContract(
  runtime: FormalCaseRuntime,
  targetCaseId: string
): UploadRuntimeContract {
  const definition = formalExecutionManifest.cases.find(
    (item: FormalCaseDefinition) => item.caseId === targetCaseId
  );
  const responseContractDeclared = definition?.operationEvidence?.some((item) =>
    item.operation === "upload_synthetic_file"
    && item.responseContractId === "open-platform-upload-response-v1"
  );
  const cleanupActionId =
    process.env.OPEN_PLATFORM_REGISTRATION_UPLOAD_CLEANUP_ADAPTER_TEST?.trim();
  const cleanupAction = runtime.manager.registry.get(cleanupActionId, "custom");
  const blockers: string[] = [];

  if (!responseContractDeclared) {
    blockers.push("上传响应协议未冻结到 formal manifest");
  }
  if (blockers.length > 0) {
    throw new FormalBlockedError(`${targetCaseId}：${blockers.join("；")}，未执行任何上传。`);
  }
  return cleanupAction?.idempotent && cleanupActionId
    ? { cleanupActionId }
    : {};
}

function loadSyntheticLicenseBuffer(): Buffer {
  const asset = findTestAsset(loadTestAssetManifest(), syntheticLicenseAssetId);
  const path = asset ? resolveAssetPath(asset) : undefined;
  if (!asset || asset.status !== "active" || !path || sha256(path) !== asset.sha256) {
    throw new FormalBlockedError("合成营业执照资产缺失、非 active 或完整性校验失败。");
  }
  const encoded = readFileSync(path, "utf8").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new FormalBlockedError("合成营业执照资产不是受控 base64 文本。");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0 || !buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  )) {
    throw new FormalBlockedError("合成营业执照资产未解码为有效 PNG 头。");
  }
  return buffer;
}

async function assertDecodableImage(
  page: Page,
  buffer: Buffer,
  mimeType: string,
  variantKey: string
): Promise<void> {
  const decodable = await page.evaluate(async ({ base64, type }) => {
    try {
      const response = await fetch(`data:${type};base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      return valid;
    } catch {
      return false;
    }
  }, { base64: buffer.toString("base64"), type: mimeType });
  if (!decodable) {
    throw new FormalBlockedError(`${variantKey} 无法在浏览器中解码为有效图片，禁止归因于格式或大小规则。`);
  }
}

async function convertPngToJpegInMemory(page: Page, png: Buffer): Promise<Buffer> {
  const jpegBase64 = await page.evaluate(async (pngBase64) => {
    const source = await fetch(`data:image/png;base64,${pngBase64}`);
    const bitmap = await createImageBitmap(await source.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("JPEG conversion failed.")),
        "image/jpeg",
        0.92
      );
    });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("JPEG buffer serialization failed."));
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.readAsDataURL(jpeg);
    });
  }, png.toString("base64"));
  const jpeg = Buffer.from(jpegBase64, "base64");
  if (jpeg.length === 0) {
    throw new FormalBlockedError("内存 JPEG/JPG 合成失败，未选择文件。");
  }
  return jpeg;
}

async function readSafeUploadOutcome(response: Response): Promise<{
  outcome: "succeeded" | "rejected";
  finality: "final";
  stableResourceId?: string;
  runtimeUiValue?: string;
}> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FormalBlockedError("上传响应不是经评审 JSON 契约，禁止将传输故障当作业务拒绝。");
  }
  if (!payload || typeof payload !== "object") {
    throw new FormalBlockedError("上传响应结构与经评审契约不一致。");
  }
  const record = payload as Record<string, unknown>;
  if (response.ok() && record.code === 200 && typeof record.data === "string") {
    const url = new URL(record.data, "https://synthetic.invalid");
    const safeResourceId = url.pathname.split("/").filter(Boolean).at(-1);
    if (!safeResourceId || !/^[A-Za-z0-9._-]{1,128}$/.test(safeResourceId)) {
      return { outcome: "succeeded", finality: "final" };
    }
    return {
      outcome: "succeeded",
      finality: "final",
      stableResourceId: safeResourceId,
      runtimeUiValue: record.data
    };
  }
  if (
    response.status() === 422
    && record.code === 422
    && record.data === null
  ) {
    return { outcome: "rejected", finality: "final" };
  }
  throw new FormalBlockedError("上传响应未匹配经评审的成功或业务拒绝契约。");
}
