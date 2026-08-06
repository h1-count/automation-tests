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
import type {
  FormalCaseDefinition,
  FormalCaseRuntime
} from "../../../../src/support/formal-execution/types.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath,
  sha256
} from "../../../../src/support/test-assets/assetManifest.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const registrationPath = "/login?tab=register";
const syntheticLicenseAssetId = "open-platform-synthetic-business-license";
const uploadResponsePath = "/company/file-upload";

interface UploadVariant {
  key: string;
  name: string;
  mimeType: string;
  expectedAccepted: boolean;
  buildBuffer(page: Page): Promise<Buffer>;
}

interface UploadRuntimeContract {
  cleanupActionId: string;
}

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-007", "营业执照内容、格式与大小限制", async ({ browser }, runtime) => {
  requireManifestCapabilities("OPEN-REG-007", [
    "registration-page-selector-contract",
    "synthetic-business-license-asset",
    "registration-license-upload",
    "registration-upload-response-contract",
    "registration-upload-cleanup"
  ]);
  requireAuthorizedUploadRuntime(runtime, "OPEN-REG-007", false);
  const pngBuffer = loadSyntheticLicenseBuffer();
  const contract = requireUploadRuntimeContract(runtime, "OPEN-REG-007");

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
    }
  ];

  await test.step("缺失营业执照不满足文件条件", async () => {
    await withIsolatedRegistrationPage(browser, async (_context, _page, panel) => {
      const trigger = panel.getByPlaceholder("上传营业执照", { exact: true });
      await requireUniqueVisible(trigger, "营业执照上传入口");
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveValue("");
    });
  });

  for (const variant of variants) {
    await test.step(`独立核对 ${variant.key}`, async () => {
      await executeUploadVariant(browser, runtime, contract.cleanupActionId, variant);
    });
  }

  const selectionHint = await test.step("记录文件选择器格式提示工程证据", async () => {
    return readFormatSelectionHint(browser);
  });

  throw new FormalBlockedError(
    `OPEN-REG-007：PNG/JPEG/JPG 已形成独立可清理上传路径；文件选择器 accept 提示为 `
    + `${selectionHint.join(", ") || "空"}，但该提示可被覆盖，不能证明非允许格式会被拒绝。`
    + "当前既无确定性的本地拒绝信号契约，也无安全服务端验证入口，因此非允许格式保持 blocked。"
    + "冻结资料同时未定义 10MB 的二进制/十进制计量口径，本版不构造 =10MB 或最小超界参数；"
    + "上述两个分支均不形成通过/失败结论，补齐受控契约或最小业务裁决后须重新生成并授权脚本。"
  );
});

formalCase("OPEN-REG-016", "企业名称和信用代码与营业执照一致性", async (_fixtures, runtime) => {
  requireManifestCapabilities("OPEN-REG-016", [
    "registration-page-selector-contract",
    "synthetic-business-license-asset",
    "registration-license-upload",
    "registration-license-authoritative-verification",
    "registration-upload-cleanup"
  ]);
  requireAuthorizedUploadRuntime(runtime, "OPEN-REG-016", true);
  loadSyntheticLicenseBuffer();

  const verifierId = process.env.OPEN_PLATFORM_REGISTRATION_LICENSE_VERIFIER_TEST?.trim();
  if (!verifierId) {
    throw new FormalBlockedError(
      "OPEN-REG-016：缺少权威证照基线与一致性核验适配器，不能从页面文案或资产说明反推企业名称/信用代码一致性。"
    );
  }

  throw new FormalBlockedError(
    "OPEN-REG-016：manifest 能力标志不能替代经审查的 verifier 实现；当前仓库尚无可调用的权威核验客户端及三组合安全结果契约，未执行上传或形成 verdict。"
  );
});

async function executeUploadVariant(
  browser: Browser,
  runtime: FormalCaseRuntime,
  cleanupActionId: string,
  variant: UploadVariant
): Promise<void> {
  const intent = await reserveUploadIntent(runtime, "OPEN-REG-007", cleanupActionId, variant);
  if (intent.status !== "planned") {
    throw new FormalBlockedError(
      `OPEN-REG-007：上传 intent ${variant.key} 已处于 ${intent.status}，必须先完成精确 reconciliation，禁止重复上传。`
    );
  }
  await runtime.manager.markIntentCreating(intent.intentId);
  let intentSettled = false;
  try {
      await withIsolatedRegistrationPage(browser, async (_context, page, panel) => {
        const uploadTrigger = panel.getByPlaceholder("上传营业执照", { exact: true });
        await requireUniqueVisible(uploadTrigger, "营业执照上传入口");
        const buffer = await variant.buildBuffer(page);
        const responsePromise = page.waitForResponse((candidate) => {
          if (candidate.request().method().toUpperCase() !== "POST") {
            return false;
          }
          return new URL(candidate.url()).pathname === uploadResponsePath;
        }, { timeout: 60_000 }).catch(() => undefined);
        const chooserPromise = page.waitForEvent("filechooser");
        await uploadTrigger.click();
        const chooser = await chooserPromise;
        await chooser.setFiles({
          name: variant.name,
          mimeType: variant.mimeType,
          buffer
        });
        const response = await responsePromise;
        if (!response) {
          await runtime.manager.markCreationUnknown(
            intent.intentId,
            "Expected upload response was not observable."
          );
          intentSettled = true;
          throw new FormalBlockedError(
            `OPEN-REG-007：${variant.key} 未观察到受控上传响应，已冻结重传并要求精确 reconciliation。`
          );
        }
        const outcome = await readSafeUploadOutcome(response);
        if (!outcome.accepted) {
          await runtime.manager.markCreationFailed(
            intent.intentId,
            "Synthetic file was rejected before a remote upload resource was confirmed."
          );
          intentSettled = true;
          expect(
            outcome.accepted,
            `${variant.key} 未按已确认的允许格式进入后续文件校验`
          ).toBe(true);
          return;
        }

        if (!outcome.safeResourceId) {
          await runtime.manager.markCreationUnknown(
            intent.intentId,
            "Upload succeeded but no non-sensitive stable resource ID was available."
          );
          intentSettled = true;
          throw new FormalBlockedError(
            `OPEN-REG-007：${variant.key} 返回结果缺少可安全登记的稳定资源 ID，禁止猜测并要求 reconciliation。`
          );
        }

        const resource = await runtime.manager.confirmCreatedResource({
          intentId: intent.intentId,
          resourceId: `open-platform-upload-${outcome.safeResourceId}`,
          reusable: false,
          metadata: {
            variant: variant.key,
            contentType: variant.mimeType
          },
          evidence: [{
            type: "web",
            summary: "Synthetic upload produced a non-sensitive stable resource identity."
          }]
        });
        intentSettled = true;

        try {
          await expect.poll(async () => (await uploadTrigger.inputValue()).length > 0, {
            message: `${variant.key} 上传成功后应进入后续文件校验`
          }).toBe(true);
          expect(
            variant.expectedAccepted,
            `${variant.key} 被平台接受，但该参数预期不满足文件条件`
          ).toBe(true);
        } finally {
          await runtime.manager.markCleanupPending(resource.resourceId);
          const summary = await runtime.manager.cleanupRun(runtime.runId);
          const cleaned = summary.resources.find((item) => item.resourceId === resource.resourceId);
          if (cleaned?.state !== "cleaned") {
            throw new FormalBlockedError(
              `OPEN-REG-007：${variant.key} 的合成上传对象未完成幂等清理，停止后续上传。`
            );
          }
        }
      });
  } catch (error) {
    if (!intentSettled) {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        "Synthetic upload result was not observable; exact reconciliation is required."
      );
      throw new FormalBlockedError(
        `OPEN-REG-007：${variant.key} 的上传结果未知，已冻结重传并进入 reconciliation。`
      );
    }
    throw error;
  }
}

async function reserveUploadIntent(
  runtime: FormalCaseRuntime,
  caseId: string,
  cleanupActionId: string,
  variant: UploadVariant
) {
  try {
    return await runtime.manager.reserveCreateIntent({
      runId: runtime.runId,
      projectId: formalExecutionManifest.projectId,
      envId: runtime.snapshot.environment,
      caseId,
      resourceType: "custom",
      syntheticKey: `${caseId}-${variant.key}`,
      expectedOutcome: variant.expectedAccepted ? "create" : "reject",
      cleanupActionId,
      evidence: [{
        type: "web",
        summary: `Authorized one-shot synthetic upload intent for ${variant.key}.`
      }]
    });
  } catch {
    throw new FormalBlockedError(
      `${caseId}：${variant.key} 缺少可恢复的上传 intent、数量预算或幂等 cleanup 绑定。`
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

async function readFormatSelectionHint(browser: Browser): Promise<string[]> {
  return withIsolatedRegistrationPage(browser, async (_context, page, panel) => {
    const uploadTrigger = panel.getByPlaceholder("上传营业执照", { exact: true });
    await requireUniqueVisible(uploadTrigger, "营业执照上传入口");
    const chooserPromise = page.waitForEvent("filechooser");
    await uploadTrigger.click();
    const chooser = await chooserPromise;
    const accept = await chooser.element().getAttribute("accept");
    return (accept ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .sort();
  });
}

async function requireUniqueVisible(locator: Locator, label: string): Promise<void> {
  if (await locator.count() !== 1 || !(await locator.isVisible())) {
    throw new FormalBlockedError(`${label}的稳定语义定位不可用或不唯一，禁止猜测定位。`);
  }
}

function requireAuthorizedUploadRuntime(
  runtime: FormalCaseRuntime,
  caseId: string,
  requiresQuery: boolean
): void {
  const requiredOperations: ExecutionOperationKind[] = [
    "upload_synthetic_file",
    "cleanup_test_resource"
  ];
  if (requiresQuery) {
    requiredOperations.push("query_postcondition");
  }
  const missing = requiredOperations.filter(
    (operation) => !runtime.snapshot.allowedOperations.includes(operation)
  );
  if (missing.length > 0) {
    throw new FormalBlockedError(
      `${caseId} 未获不可变执行清单授权：${missing.join("、")}。`
    );
  }
  if (runtime.snapshot.dataWritePolicy !== "managed_cleanup") {
    throw new FormalBlockedError(`${caseId} 仅允许 managed_cleanup 正式执行策略。`);
  }
}

function requireUploadRuntimeContract(
  runtime: FormalCaseRuntime,
  caseId: string
): UploadRuntimeContract {
  const definition = formalExecutionManifest.cases.find(
    (item: FormalCaseDefinition) => item.caseId === caseId
  );
  const responseContractDeclared = definition?.requiredCapabilities.includes(
    "registration-upload-response-contract"
  );
  const responseSchema = process.env.OPEN_PLATFORM_REGISTRATION_UPLOAD_RESPONSE_SCHEMA_TEST?.trim();
  const cleanupActionId =
    process.env.OPEN_PLATFORM_REGISTRATION_UPLOAD_CLEANUP_ADAPTER_TEST?.trim();
  const cleanupAction = runtime.manager.registry.get(cleanupActionId, "custom");
  const blockers: string[] = [];

  if (!responseContractDeclared || responseSchema !== "safe-resource-id-v1") {
    blockers.push("上传响应的安全资源 ID 协议尚未形成受控工程契约");
  }
  if (!cleanupActionId || !cleanupAction?.idempotent) {
    blockers.push("上传对象没有在当前 TestDataManager 注册幂等 cleanup action");
  }
  if (blockers.length > 0) {
    throw new FormalBlockedError(`${caseId}：${blockers.join("；")}，未执行任何上传。`);
  }
  if (!cleanupActionId) {
    throw new FormalBlockedError(`${caseId}：幂等 cleanup action ID 不可用，未执行任何上传。`);
  }
  return {
    cleanupActionId
  };
}

function loadSyntheticLicenseBuffer(): Buffer {
  const configuredAssetId =
    process.env.OPEN_PLATFORM_REGISTRATION_LICENSE_ASSET_ID_TEST?.trim();
  if (configuredAssetId !== syntheticLicenseAssetId) {
    throw new FormalBlockedError("合成营业执照资产未按 manifest capability 绑定到正式 assetId。");
  }
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
  accepted: boolean;
  safeResourceId?: string;
}> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { accepted: false };
  }
  if (!response.ok() || !payload || typeof payload !== "object") {
    return { accepted: false };
  }
  const record = payload as Record<string, unknown>;
  if (record.code !== 200 || typeof record.data !== "string") {
    return { accepted: false };
  }
  const url = new URL(record.data, "https://synthetic.invalid");
  const safeResourceId = url.pathname.split("/").filter(Boolean).at(-1);
  if (!safeResourceId || !/^[A-Za-z0-9._-]{1,128}$/.test(safeResourceId)) {
    return { accepted: true };
  }
  return { accepted: true, safeResourceId };
}

function requireManifestCapabilities(caseId: string, capabilityIds: string[]): void {
  const definition = formalExecutionManifest.cases.find(
    (item: FormalCaseDefinition) => item.caseId === caseId
  );
  const missing = capabilityIds.filter((id) => !definition?.requiredCapabilities.includes(id));
  if (missing.length > 0) {
    throw new FormalBlockedError(
      `${caseId} 的 formal manifest 未声明必要能力：${missing.join("、")}。`
    );
  }
}
