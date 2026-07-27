import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Browser, Locator, Page, Response } from "@playwright/test";
import {
  configureFormalSuite,
  expect,
  FormalBlockedError,
  formalCase,
  formalSuite
} from "../../../../src/support/formal-execution/formalCase.js";
import type { FormalCaseRuntime } from "../../../../src/support/formal-execution/types.js";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath
} from "../../../../src/support/test-assets/assetManifest.js";
import type { CreateIntentRecord } from "../../../../src/support/test-data/types.js";
import { formalExecutionManifest } from "./execution.manifest.js";

type CompanyInput = {
  key: "A" | "B" | "NEG-NAME" | "NEG-IDENTIFIER" | "NEG-CODE";
  name: string;
  identifier: string;
  creditCode: string;
};

type UploadReplay = {
  status: number;
  contentType?: string;
  bodyBase64: string;
};

const environment = resolveTestEnvironment();
const registrationUrl = new URL("/login?tab=register", environment.openPlatformWebBaseUrl).toString();
const licenseAsset = findTestAsset(loadTestAssetManifest(), "open-platform-synthetic-business-license");
const licenseAssetPath = licenseAsset ? resolveAssetPath(licenseAsset) : undefined;
if (!licenseAssetPath) throw new Error("The registered synthetic business-license asset is unavailable.");

configureFormalSuite(formalExecutionManifest);
formalSuite.use({ trace: "off", screenshot: "off", video: "off" });

formalCase("OPEN-REG-001", "企业名称必填校验", async ({ page }) => {
  await openRegistration(page);
  await assertFieldError(page, "请输入企业名称", "", "请输入集团名称");
});

// The producer runs before its resource consumers. A product assertion may
// fail after resources are confirmed without blocking safe downstream cases.
formalCase("OPEN-REG-003", "注册账号默认管理员", async ({ page, browser }, runtime) => {
  const companyA = company("A", runtime.runId);
  const intent = await ensureCreatedCompany(page, runtime, companyA, "OPEN-REG-003");
  const account = await openAuthenticatedCompanyPage(browser, runtime);
  try {
    const row = account.page.getByRole("row").filter({ hasText: companyA.name });
    await expect(row).toBeVisible();
    await reconcileCompany(runtime, intent, companyA);
    await runtime.confirmResource("company-a", "Authenticated company page confirmed synthetic company A.");
    await runtime.confirmResource("registration-auth", "Authenticated console session is available locally.");
    await runtime.confirmResource("synthetic-upload", "The single synthetic upload is confirmed and locally replayable.");
    await expect(row).toContainText("管理员");
  } finally {
    await account.close();
  }
});

formalCase("OPEN-REG-002", "重复企业名称提示", async ({ page }, runtime) => {
  const companyA = company("A", runtime.runId);
  await submitExpectedRejection(
    page,
    runtime,
    { ...company("NEG-NAME", runtime.runId), name: companyA.name },
    "OPEN-REG-002",
    "该企业名称已存在，请确认是否已注册或更换其他名称"
  );
});

formalCase("OPEN-REG-004", "重复企业标识提示", async ({ page }, runtime) => {
  const companyA = company("A", runtime.runId);
  await submitExpectedRejection(
    page,
    runtime,
    { ...company("NEG-IDENTIFIER", runtime.runId), identifier: companyA.identifier },
    "OPEN-REG-004",
    "该企业标识已存在，请更改为其他标识"
  );
});

formalCase("OPEN-REG-005", "重复信用代码提示", async ({ page }, runtime) => {
  const companyA = company("A", runtime.runId);
  await submitExpectedRejection(
    page,
    runtime,
    { ...company("NEG-CODE", runtime.runId), creditCode: companyA.creditCode },
    "OPEN-REG-005",
    "该统一社会信用代码已注册，请确认是否已提交过申请"
  );
});

formalCase("OPEN-REG-006", "同手机号注册多个企业", async ({ page, browser }, runtime) => {
  const companyA = company("A", runtime.runId);
  const companyB = company("B", runtime.runId);
  const intent = await ensureCreatedCompany(page, runtime, companyB, "OPEN-REG-006");
  const account = await openAuthenticatedCompanyPage(browser, runtime);
  try {
    const rowA = account.page.getByRole("row").filter({ hasText: companyA.name });
    const rowB = account.page.getByRole("row").filter({ hasText: companyB.name });
    await expect.soft(rowA).toBeVisible();
    await expect.soft(rowB).toBeVisible();
    await expect(rowB).toBeVisible();
    await reconcileCompany(runtime, intent, companyB);
    await runtime.confirmResource("company-b", "Authenticated company page confirmed synthetic company B.");
  } finally {
    await account.close();
  }
});

formalCase("OPEN-REG-007", "控制台统一登录后默认进入 AIoT 控制台", async ({ browser }, runtime) => {
  const account = await openAuthenticatedCompanyPage(browser, runtime, false);
  try {
    await account.page.goto(new URL("/login", environment.openPlatformWebBaseUrl).toString(), {
      waitUntil: "domcontentloaded"
    });
    await expect(account.page).toHaveURL(/\/console\/home(?:[/?#]|$)/);
  } finally {
    await account.close();
  }
});

formalCase("OPEN-REG-008", "企业地址必填校验", async ({ page }) => {
  await openRegistration(page);
  await assertFieldError(page, "请输入企业地址", "", "请输入企业地址");
});

formalCase("OPEN-REG-009", "企业标识必填校验", async ({ page }) => {
  await openRegistration(page);
  await assertFieldError(page, "请输入企业标识", "");
});

formalCase("OPEN-REG-010", "申请人必填校验", async ({ page }) => {
  await openRegistration(page);
  await assertFieldError(page, "请输入您的姓名", "", "请输入联系人名称");
});

formalCase("OPEN-REG-011", "手机号必填校验", async ({ page }) => {
  await openRegistration(page);
  await assertFieldError(page, "请输入联系方式", "");
});

formalCase("OPEN-REG-012", "企业简介选填空值", async ({ page }) => {
  await openRegistration(page);
  await assertFieldAccepted(page, "请输入企业简介", "");
});

formalCase("OPEN-REG-013", "企业邮箱选填空值", async ({ page }) => {
  await openRegistration(page);
  await assertFieldAccepted(page, "请输入企业邮箱", "");
});

formalCase("OPEN-REG-014", "统一社会信用代码必填校验", async ({ page }) => {
  await openRegistration(page);
  await triggerSafeRequiredValidation(page);
  await expect(formItem(page, "企业信用代码")).toContainClass("is-error");
});

formalCase("OPEN-REG-015", "营业执照必填校验", async ({ page }) => {
  await openRegistration(page);
  await triggerSafeRequiredValidation(page);
  await expect(formItem(page, "上传营业执照")).toContainClass("is-error");
});

formalCase("OPEN-REG-016", "验证码输入与获取入口可见", async ({ page }) => {
  await openRegistration(page);
  await expect(formInput(page, "请输入验证码")).toBeVisible();
  await expect(registrationForm(page).getByText("获取验证码", { exact: true })).toBeVisible();
});

formalCase("OPEN-REG-017", "用户协议确认控件可见", async ({ page }) => {
  await openRegistration(page);
  await expect(agreementControl(page)).toBeVisible();
});

formalCase("OPEN-REG-018", "注册提交入口可见", async ({ page }) => {
  await openRegistration(page);
  await expect(registrationForm(page).getByRole("button", { name: "同意条款并注册" })).toBeVisible();
});

formalCase("OPEN-REG-019", "企业名称长度边界", async ({ page }) => {
  await openRegistration(page);
  await expect.soft(formInput(page, "请输入企业名称")).toHaveAttribute("maxlength", "50");
  await assertFieldErrorSoft(page, "请输入企业名称", "一");
  await assertFieldAcceptedSoft(page, "请输入企业名称", "企业");
  await assertFieldAcceptedSoft(page, "请输入企业名称", "企".repeat(50));
  await assertFieldErrorSoft(page, "请输入企业名称", "企".repeat(51));
});

formalCase("OPEN-REG-020", "企业名称内容规则", async ({ page }) => {
  await openRegistration(page);
  await assertFieldAcceptedSoft(page, "请输入企业名称", "企业Company2026");
  await assertFieldErrorSoft(page, "请输入企业名称", "企业😀");
});

formalCase("OPEN-REG-021", "企业地址长度边界", async ({ page }) => {
  await openRegistration(page);
  await expect.soft(formInput(page, "请输入企业地址")).toHaveAttribute("maxlength", "50");
  await assertFieldAcceptedSoft(page, "请输入企业地址", "地".repeat(50));
  await assertFieldErrorSoft(page, "请输入企业地址", "地".repeat(51));
});

formalCase("OPEN-REG-022", "企业标识长度边界", async ({ page }) => {
  await openRegistration(page);
  await expect.soft(formInput(page, "请输入企业标识")).toHaveAttribute("maxlength", "6");
  await assertFieldErrorSoft(page, "请输入企业标识", "ab");
  await assertFieldAcceptedSoft(page, "请输入企业标识", "abc");
  await assertFieldAcceptedSoft(page, "请输入企业标识", "abc123");
  await assertFieldErrorSoft(page, "请输入企业标识", "abc1234");
});

formalCase("OPEN-REG-023", "企业标识内容规则", async ({ page }) => {
  await openRegistration(page);
  await assertFieldAcceptedSoft(page, "请输入企业标识", "abc123");
  const identifier = formInput(page, "请输入企业标识");
  await identifier.fill("A!");
  await expect.soft(identifier).toHaveValue("");
  await expect.soft(formItem(page, "请输入企业标识")).toContainText("请输入 3-6 位小写字母或数字作为企业标识");
});

formalCase("OPEN-REG-024", "申请人长度边界", async ({ page }) => {
  await openRegistration(page);
  await expect.soft(formInput(page, "请输入您的姓名")).toHaveAttribute("maxlength", "20");
  await assertFieldAcceptedSoft(page, "请输入您的姓名", "测".repeat(20));
  await assertFieldErrorSoft(page, "请输入您的姓名", "测".repeat(21));
});

formalCase("OPEN-REG-025", "申请人内容规则", async ({ page }) => {
  await openRegistration(page);
  await assertFieldAcceptedSoft(page, "请输入您的姓名", "测试人员");
  await assertFieldAcceptedSoft(page, "请输入您的姓名", "TestUser");
});

formalCase("OPEN-REG-026", "手机号格式校验", async ({ page }) => {
  await openRegistration(page);
  await assertFieldErrorSoft(page, "请输入联系方式", "1380013800");
  await assertFieldAcceptedSoft(page, "请输入联系方式", "13800138000");
  await assertFieldErrorSoft(page, "请输入联系方式", "138001380000");
  const phone = formInput(page, "请输入联系方式");
  await phone.fill("138a0013b8000");
  await expect.soft(phone).toHaveValue("13800138000");
  await phone.blur();
  await expect.soft(formItem(page, "请输入联系方式")).not.toContainClass("is-error");
});

formalCase("OPEN-REG-027", "企业简介长度边界", async ({ page }) => {
  await openRegistration(page);
  const introduction = formInput(page, "请输入企业简介");
  await expect.soft(introduction).toHaveAttribute("maxlength", "300");
  await assertFieldAcceptedSoft(page, "请输入企业简介", "介".repeat(300));
  await assertFieldErrorSoft(page, "请输入企业简介", "介".repeat(301));
});

formalCase("OPEN-REG-028", "企业邮箱常用格式有效输入", async ({ page }) => {
  await openRegistration(page);
  await assertFieldAccepted(page, "请输入企业邮箱", "contact+sales@example.com");
});

formalCase("OPEN-REG-029", "企业邮箱常用格式无效输入", async ({ page }) => {
  await openRegistration(page);
  for (const invalidEmail of ["contact.example.com", "contact@", "contact@@example.com"]) {
    await assertFieldErrorSoft(page, "请输入企业邮箱", invalidEmail);
  }
});

async function ensureCreatedCompany(
  page: Page,
  runtime: FormalCaseRuntime,
  input: CompanyInput,
  caseId: "OPEN-REG-003" | "OPEN-REG-006"
): Promise<CreateIntentRecord> {
  const intent = await runtime.manager.reserveCreateIntent({
    runId: runtime.runId,
    projectId: "open-platform",
    envId: environment.name,
    caseId,
    resourceType: "tenant",
    syntheticKey: input.identifier,
    expectedOutcome: "create"
  });
  if (intent.status === "creating") {
    return runtime.manager.markCreationUnknown(
      intent.intentId,
      "Worker interruption occurred after the create boundary; exact reconciliation is required."
    );
  }
  if (intent.status === "creation_unknown") return intent;
  if (["created", "reconciled"].includes(intent.status)) return intent;
  await fillValidRegistration(page, runtime, input);
  await runtime.manager.markIntentCreating(intent.intentId);
  try {
    await registrationForm(page).getByRole("button", { name: "同意条款并注册" }).click();
    return await runtime.manager.markCreationUnknown(
      intent.intentId,
      "Registration was submitted; exact tenant identity will be reconciled from the authenticated company page."
    );
  } catch (error) {
    const current = await runtime.manager.store.readIntent(intent.intentId);
    if (current?.status === "creating") {
      await runtime.manager.markCreationUnknown(intent.intentId, "Registration outcome requires exact reconciliation.");
    }
    throw error;
  }
}

async function submitExpectedRejection(
  page: Page,
  runtime: FormalCaseRuntime,
  input: CompanyInput,
  caseId: "OPEN-REG-002" | "OPEN-REG-004" | "OPEN-REG-005",
  expectedMessage: string
): Promise<void> {
  const intent = await runtime.manager.reserveCreateIntent({
    runId: runtime.runId,
    projectId: "open-platform",
    envId: environment.name,
    caseId,
    resourceType: "tenant",
    syntheticKey: `${input.identifier}-${caseId.toLowerCase()}`,
    expectedOutcome: "reject"
  });
  if (intent.status === "failed") return;
  if (intent.status === "creating") {
    await runtime.manager.markCreationUnknown(
      intent.intentId,
      `${caseId} was interrupted after the submission boundary; exact reconciliation is required.`
    );
    throw new FormalBlockedError(`${caseId} has an unresolved prior submission; exact reconciliation is required.`);
  }
  if (intent.status === "creation_unknown") {
    throw new FormalBlockedError(`${caseId} has an unresolved prior submission; exact reconciliation is required.`);
  }
  await fillValidRegistration(page, runtime, input);
  await runtime.manager.markIntentCreating(intent.intentId);
  try {
    await registrationForm(page).getByRole("button", { name: "同意条款并注册" }).click();
    await expect(registrationForm(page)).toContainText(expectedMessage, { timeout: 30_000 });
    await runtime.manager.markCreationFailed(intent.intentId, `Expected business rejection observed for ${caseId}.`);
  } catch (error) {
    const current = await runtime.manager.store.readIntent(intent.intentId);
    if (current?.status === "creating") {
      await runtime.manager.markCreationUnknown(intent.intentId, `Negative submission ${caseId} requires exact reconciliation.`);
    }
    throw error;
  }
}

async function fillValidRegistration(page: Page, runtime: FormalCaseRuntime, input: CompanyInput): Promise<void> {
  await openRegistration(page);
  await formInput(page, "请输入企业名称").fill(input.name);
  await formInput(page, "请输入企业标识").fill(input.identifier);
  await expect(formItem(page, "请输入企业标识")).not.toContainText("企业标识已被使用");
  await formInput(page, "请输入企业地址").fill("自动化测试园区 1 号");
  await formInput(page, "请输入企业邮箱").fill("registration.qa@example.com");
  await formInput(page, "企业信用代码").fill(input.creditCode);
  await formInput(page, "请输入您的姓名").fill("测试人员");
  await formInput(page, "请输入联系方式").fill(requiredTestPhone());
  await formInput(page, "请输入企业简介").fill("仅用于开放平台注册自动化测试");
  await uploadSyntheticLicense(page, runtime);
  await completeTestOtp(page);
  await agreementControl(page).click();
  await expect(agreementInput(page)).toBeChecked();
  await expect(registrationForm(page).getByRole("button", { name: "同意条款并注册" })).toBeEnabled();
}

async function uploadSyntheticLicense(page: Page, runtime: FormalCaseRuntime): Promise<void> {
  const uploadPattern = /\/company\/file-upload(?:[?#]|$)/;
  const cachePath = uploadReplayPath(runtime);
  const intent = await runtime.manager.reserveCreateIntent({
    runId: runtime.runId,
    projectId: "open-platform",
    envId: environment.name,
    caseId: "OPEN-REG-003",
    resourceType: "custom",
    syntheticKey: `synthetic-license-${runtime.runId}`,
    expectedOutcome: "create"
  });
  let responsePromise: Promise<Response> | undefined;
  const replay = await readUploadReplay(cachePath);
  if (replay) {
    await page.route(uploadPattern, (route) => route.fulfill({
      status: replay.status,
      headers: replay.contentType ? { "content-type": replay.contentType } : undefined,
      body: Buffer.from(replay.bodyBase64, "base64")
    }), { times: 1 });
  } else {
    if (intent.status === "creating") {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        "Worker interruption occurred after the upload boundary; exact reconciliation is required."
      );
      throw new FormalBlockedError("The prior synthetic upload cannot be replayed; reconcile it without uploading again.");
    }
    if (["creation_unknown", "created", "reconciled"].includes(intent.status)) {
      throw new FormalBlockedError("The prior synthetic upload cannot be replayed; reconcile it without uploading again.");
    }
    await runtime.manager.markIntentCreating(intent.intentId);
    responsePromise = page.waitForResponse((response) => uploadPattern.test(response.url()));
  }

  const buffer = Buffer.from(readFileSync(licenseAssetPath!, "utf8").trim(), "base64");
  await registrationForm(page).locator('input[type="file"]').setInputFiles({
    name: "synthetic-business-license.png",
    mimeType: "image/png",
    buffer
  });
  if (responsePromise) {
    const response = await responsePromise;
    const responseBody = await response.body();
    if (!response.ok()) {
      await runtime.manager.markCreationUnknown(intent.intentId, "Synthetic license upload returned a non-success response.");
      throw new Error(`Synthetic business-license upload failed with HTTP ${response.status()}.`);
    }
    await writeUploadReplay(cachePath, {
      status: response.status(),
      contentType: response.headers()["content-type"],
      bodyBase64: responseBody.toString("base64")
    });
    await runtime.manager.confirmCreatedResource({
      intentId: intent.intentId,
      resourceId: `upload:${intent.intentId}`,
      metadata: { alias: "synthetic-business-license" },
      evidence: [{ type: "web", summary: "Synthetic PNG upload completed once for this authorization." }]
    });
  }
  await expect(formInput(page, "上传营业执照")).not.toHaveValue("", { timeout: 30_000 });
}

async function completeTestOtp(page: Page): Promise<void> {
  const codeInput = formInput(page, "请输入验证码");
  await registrationForm(page).getByText("获取验证码", { exact: true }).click();
  const fixedCode = process.env.OPEN_PLATFORM_REGISTRATION_FIXED_OTP_TEST?.trim();
  if (fixedCode) {
    await codeInput.fill(fixedCode);
    return;
  }
  console.info("[安全挑战] 请仅在当前可见浏览器完成图形挑战并输入专用测试验证码；脚本将在同一用例自动恢复。");
  await expect(codeInput).toHaveValue(/^\d{4,8}$/, { timeout: 300_000 });
}

async function openAuthenticatedCompanyPage(
  browser: Browser,
  runtime: FormalCaseRuntime,
  navigateToCompany = true
): Promise<{ page: Page; close(): Promise<void> }> {
  const configuredState = process.env.OPEN_PLATFORM_REGISTRATION_AUTH_STATE_PATH_TEST?.trim();
  const localState = resolve(process.cwd(), ".auth/formal", runtime.snapshot.digest, "registration.json");
  const storageState = configuredState || (existsSync(localState) ? localState : undefined);
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();
  if (!storageState) {
    await page.goto(new URL("/login", environment.openPlatformWebBaseUrl).toString(), { waitUntil: "domcontentloaded" });
    console.info("[安全挑战] 请在当前可见浏览器完成合成账号登录；脚本将在同一用例自动恢复。");
    await expect(page).toHaveURL(/\/console\/home(?:[/?#]|$)/, { timeout: 300_000 });
    await mkdir(dirname(localState), { recursive: true });
    await context.storageState({ path: localState });
  } else {
    await page.goto(new URL("/console", environment.openPlatformWebBaseUrl).toString(), { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/console\/home(?:[/?#]|$)/);
  }
  if (navigateToCompany) {
    await page.goto(new URL("/console/account/company", environment.openPlatformWebBaseUrl).toString(), {
      waitUntil: "domcontentloaded"
    });
  }
  return { page, close: () => context.close() };
}

async function reconcileCompany(
  runtime: FormalCaseRuntime,
  intent: CreateIntentRecord,
  input: CompanyInput
): Promise<void> {
  const current = await runtime.manager.store.readIntent(intent.intentId);
  if (!current) throw new Error("The company CreateIntent disappeared from the local ledger.");
  if (["created", "reconciled"].includes(current.status)) return;
  if (current.status !== "creation_unknown") {
    throw new FormalBlockedError(`Company ${input.key} is not ready for exact reconciliation.`);
  }
  await runtime.manager.reconcileCreateIntent({
    intentId: current.intentId,
    resolution: "created",
    resourceId: `tenant:${input.identifier}`,
    metadata: { alias: `synthetic-company-${input.key.toLowerCase()}` },
    evidence: [{ type: "web", summary: `Authenticated company page confirmed synthetic company ${input.key}.` }]
  });
}

async function triggerSafeRequiredValidation(page: Page): Promise<void> {
  const form = registrationForm(page);
  await agreementControl(page).click();
  await expect(agreementInput(page)).toBeChecked();
  await form.getByRole("button", { name: "同意条款并注册" }).click();
  await agreementControl(page).click();
  await expect(agreementInput(page)).not.toBeChecked();
}

async function openRegistration(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => undefined);
  await page.goto(registrationUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // The formal runner owns a dedicated headed Chrome session. Keep its one
  // shared page in the foreground so a required human security handoff lands
  // in the page the worker is actually observing.
  await page.bringToFront();
  await expect(registrationForm(page)).toBeVisible({ timeout: 15_000 });
}

function registrationForm(page: Page): Locator {
  return page.locator(".register-form");
}

function formInput(page: Page, placeholder: string): Locator {
  return registrationForm(page).getByPlaceholder(placeholder);
}

function formItem(page: Page, placeholder: string): Locator {
  return formInput(page, placeholder).locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ep-form-item ')][1]"
  );
}

function agreementControl(page: Page): Locator {
  return registrationForm(page).locator(".form-agreement .ep-checkbox").filter({
    hasText: "我已阅读并已同意"
  });
}

function agreementInput(page: Page): Locator {
  return agreementControl(page).locator('input[type="checkbox"]');
}

async function assertFieldError(page: Page, placeholder: string, value: string, expectedMessage?: string): Promise<void> {
  const input = formInput(page, placeholder);
  await input.fill(value);
  await input.blur();
  await expect(formItem(page, placeholder)).toContainClass("is-error");
  if (expectedMessage) await expect(formItem(page, placeholder)).toContainText(expectedMessage);
}

async function assertFieldAccepted(page: Page, placeholder: string, value: string): Promise<void> {
  const input = formInput(page, placeholder);
  await input.fill(value);
  await input.blur();
  await expect(formItem(page, placeholder)).not.toContainClass("is-error");
}

async function assertFieldErrorSoft(page: Page, placeholder: string, value: string): Promise<void> {
  const input = formInput(page, placeholder);
  await input.fill(value);
  await input.blur();
  await expect.soft(formItem(page, placeholder), `${placeholder} should reject ${value.length} characters`).toContainClass("is-error");
}

async function assertFieldAcceptedSoft(page: Page, placeholder: string, value: string): Promise<void> {
  const input = formInput(page, placeholder);
  await input.fill(value);
  await input.blur();
  await expect.soft(formItem(page, placeholder), `${placeholder} should accept ${value.length} characters`).not.toContainClass("is-error");
}

function company(key: CompanyInput["key"], seed: string): CompanyInput {
  const digest = createHash("sha256").update(`${key}:${seed}`).digest("hex");
  return {
    key,
    name: `自动化测试企业${digest.slice(0, 8)}`,
    identifier: `t${digest.slice(0, 5)}`,
    creditCode: `9${digest.slice(0, 17)}`.toUpperCase()
  };
}

function requiredTestPhone(): string {
  const phone = process.env.OPEN_PLATFORM_REGISTRATION_PHONE_TEST?.trim();
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    throw new FormalBlockedError("A dedicated test phone is required for registration write cases.");
  }
  return phone;
}

function uploadReplayPath(runtime: FormalCaseRuntime): string {
  return resolve(process.cwd(), ".auth/formal", runtime.snapshot.digest, "synthetic-upload-response.json");
}

async function readUploadReplay(path: string): Promise<UploadReplay | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as UploadReplay;
}

async function writeUploadReplay(path: string, replay: UploadReplay): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(replay)}\n`, { encoding: "utf8", mode: 0o600 });
}
