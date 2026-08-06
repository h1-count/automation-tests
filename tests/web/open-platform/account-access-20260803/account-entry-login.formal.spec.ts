import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Browser, Locator, Page } from "@playwright/test";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment.js";
import {
  configureFormalSuite,
  expect,
  formalCase,
  FormalBlockedError,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import type { FormalCaseRuntime } from "../../../../src/support/formal-execution/types.js";
import { assertNoUnauthorizedWriteRequests } from "../../../../src/support/web/networkOperationGuard.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const noWriteNetworkPolicy = {
  forbiddenMutationPaths: [
    "/company/file-upload",
    "/get/msg/code",
    "/login/msg/verify",
    "/mcode/login",
    "/official/website/application/for/registration",
    "/official/website/send/register/msg"
  ]
};

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-20260803-025", "首页及顶部五个账户入口", async ({ browser }, runtime) => {
  runtime.classifyFailure("SCRIPT");
  await test.step("独立核对【立即使用】进入登录页", async () => {
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const immediateUse = page.getByRole("button", { name: "立即使用 ⇁", exact: true });
        runtime.classifyFailure("PRODUCT");
        await expectRequiredEntry(immediateUse, "首页【立即使用】按钮");
        await immediateUse.click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
        const loginTab = page.getByRole("tab", { name: "登录", exact: true });
        await requireUniqueVisible(loginTab, "登录页【登录】页签");
        await expect(loginTab).toHaveAttribute("aria-selected", "true");
      });
    });
  });

  await test.step("独立核对【登录/注册】进入登录页", async () => {
    runtime.classifyFailure("SCRIPT");
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const accountEntry = page.getByRole("link", { name: "登录/注册", exact: true });
        runtime.classifyFailure("PRODUCT");
        await expectRequiredEntry(accountEntry, "首页【登录/注册】入口");
        await accountEntry.click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
        const loginTab = page.getByRole("tab", { name: "登录", exact: true });
        await requireUniqueVisible(loginTab, "登录页【登录】页签");
        await expect(loginTab).toHaveAttribute("aria-selected", "true");
      });
    });
  });

  await test.step("独立核对顶部【AIoT 控制台】进入统一登录页", async () => {
    runtime.classifyFailure("SCRIPT");
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const consoleEntry = page.getByRole("link", { name: "控制台", exact: true });
        runtime.classifyFailure("PRODUCT");
        await expectRequiredEntry(consoleEntry, "顶部【AIoT 控制台】入口");
        await consoleEntry.click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
        const loginTab = page.getByRole("tab", { name: "登录", exact: true });
        await requireUniqueVisible(loginTab, "统一登录页【登录】页签");
        await expect(loginTab).toHaveAttribute("aria-selected", "true");
      });
    });
  });

  await test.step("独立核对顶部【注册】入口可见且可操作", async () => {
    runtime.classifyFailure("SCRIPT");
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const registerEntry = page.getByRole("link", { name: "注册", exact: true });
        runtime.classifyFailure("PRODUCT");
        await expectRequiredEntry(registerEntry, "顶部【注册】入口");
        await registerEntry.click({ trial: true });
      });
    });
  });

  await test.step("独立核对顶部【登录】入口可见且可操作", async () => {
    runtime.classifyFailure("SCRIPT");
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const loginEntry = page.getByRole("link", { name: "登录", exact: true });
        runtime.classifyFailure("PRODUCT");
        await expectRequiredEntry(loginEntry, "顶部【登录】入口");
        await loginEntry.click({ trial: true });
      });
    });
  });
});

formalCase("OPEN-LOGIN-20260803-001", "受控手机号与密码登录主路径", async ({ browser }, runtime) => {
  const approvedEnterprise = await runtime.consumeResource(
    "approved-enterprise-OPEN-REG-20260803-009"
  );
  const recoveryState = await runtime.stageCompleted("password-login-intent-recorded")
    ? requireApprovedStorageState()
    : undefined;
  await withIsolatedPage(browser, recoveryState, async (page) => {
    await performControlledPasswordLogin(page, runtime, "OPEN-LOGIN-20260803-001");
    runtime.classifyFailure("PRODUCT");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/console/home");
    await requireUniqueVisible(
      page.getByRole("link", { name: "控制台", exact: true }),
      "登录成功后的 AIoT 控制台语义"
    );
  });
  await promoteApprovedEnterpriseFixture(runtime, approvedEnterprise.resourceId);
});

formalCase("OPEN-LOGIN-20260803-002", "登录验证后默认进入 AIoT 控制台", async ({ browser }, runtime) => {
  await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const recoveryState = await runtime.stageCompleted("password-login-intent-recorded")
    ? requireApprovedStorageState()
    : undefined;
  await withIsolatedPage(browser, recoveryState, async (page) => {
    await performControlledPasswordLogin(page, runtime, "OPEN-LOGIN-20260803-002");
    runtime.classifyFailure("PRODUCT");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/console/home");
    await requireUniqueVisible(
      page.getByRole("link", { name: "控制台", exact: true }),
      "AIoT 控制台导航语义"
    );
  });
});

formalCase("OPEN-LOGIN-20260803-003", "审核通过账号的资源使用资格", async ({ browser }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const storageState = requireApprovedStorageState();
  const resourceName = requireRuntimeValue(
    "OPEN_PLATFORM_APPROVED_RESOURCE_NAME_TEST",
    /^(?:产品接入系统|产品运营系统|产品服务系统)$/,
    "审核通过账号的只读资源精确名称"
  );
  const resourcePath = requireRuntimeValue(
    "OPEN_PLATFORM_APPROVED_RESOURCE_PATH_TEST",
    /^\/(?:integration|device|service)(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/,
    "审核通过账号的只读资源精确路径"
  );
  const resourceMarker = requireRuntimeValue(
    "OPEN_PLATFORM_APPROVED_RESOURCE_MARKER_TEST",
    /^[\p{L}\p{N}][\p{L}\p{N}\s（）()·._-]{0,79}$/u,
    "审核通过账号的只读资源精确页面语义"
  );
  await withIsolatedPage(browser, storageState, async (page) => {
    runtime.classifyFailure("SCRIPT");
    await page.goto("/console/home");
    const resourceLink = page.getByRole("link", { name: resourceName, exact: true });
    await requireAuthenticatedLanding(
      page,
      resourceLink,
      "审核通过账号的受控认证会话已失效，不能形成资源资格结论。"
    );
    await requireUniqueVisible(resourceLink, `只读平台资源【${resourceName}】`);
    await resourceLink.click();
    runtime.classifyFailure("PRODUCT");
    await expect.poll(() => new URL(page.url()).pathname).toBe(resourcePath);
    await requireUniqueVisible(
      page.getByText(resourceMarker, { exact: true }),
      `只读资源页面语义【${resourceMarker}】`
    );
  });
});

async function withIsolatedPage(
  browser: Browser,
  storageState: string | undefined,
  body: (page: Page) => Promise<void>
): Promise<void> {
  const environment = resolveTestEnvironment();
  const context = await browser.newContext({
    baseURL: environment.openPlatformWebBaseUrl,
    ...(storageState ? { storageState } : {})
  });
  const page = await context.newPage();
  try {
    await body(page);
  } finally {
    await context.close();
  }
}

async function requireUniqueVisible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}的稳定语义定位应唯一`).toHaveCount(1);
  await expect(locator, `${label}应在客户端渲染完成后可见`).toBeVisible();
}

async function checkVisibleElementPlusCheckbox(
  checkbox: Locator,
  label: string
): Promise<void> {
  await expect(checkbox, `${label}的 ARIA 契约应唯一`).toHaveCount(1);
  const visibleControl = checkbox.locator("xpath=ancestor::label[1]");
  await requireUniqueVisible(visibleControl, `${label}的可见交互容器`);
  await visibleControl.click();
  await expect(checkbox, `${label}点击后应进入已勾选状态`).toBeChecked();
}

async function requireAuthenticatedLanding(
  page: Page,
  authenticatedSurface: Locator,
  blockedMessage: string
): Promise<void> {
  await expect.poll(async () => {
    if (new URL(page.url()).pathname === "/login") return "login";
    if (await authenticatedSurface.count() !== 1) return "pending";
    return await authenticatedSurface.isVisible() ? "authenticated" : "pending";
  }, {
    message: "等待认证后页面完成客户端路由守卫和语义渲染"
  }).toMatch(/^(?:authenticated|login)$/u);
  if (new URL(page.url()).pathname === "/login") {
    throw new FormalBlockedError(blockedMessage);
  }
}

async function expectRequiredEntry(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}应在目标构建中唯一存在`).toHaveCount(1);
  await expect(locator, `${label}应对用户可见`).toBeVisible();
}

async function assertNoMutationRequests(page: Page, body: () => Promise<void>): Promise<void> {
  await assertNoUnauthorizedWriteRequests(page, noWriteNetworkPolicy, body);
}

function requireSensitiveRuntimeValue(
  name: string,
  pattern: RegExp,
  purpose: string,
  trim = true
): string {
  const rawValue = process.env[name];
  const value = trim ? rawValue?.trim() : rawValue;
  if (!value || !pattern.test(value)) {
    throw new FormalBlockedError(`${purpose}不可用或不符合受控格式；未读取任何本地凭据文件。`);
  }
  return value;
}

function requireRuntimeValue(name: string, pattern: RegExp, purpose: string): string {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) {
    throw new FormalBlockedError(`${purpose}未形成受控工程契约。`);
  }
  return value;
}

function requireApprovedStorageState(): string {
  const environment = resolveTestEnvironment();
  const storageState = environment.openPlatformAuthStatePath;
  if (!storageState || !existsSync(storageState)) {
    throw new FormalBlockedError("已审批账号的本地认证会话文件不可用；不得伪造认证或资源资格。");
  }
  const expectedDigest = process.env.OPEN_PLATFORM_APPROVED_AUTH_STATE_SHA256_TEST?.trim();
  const actualDigest = createHash("sha256").update(readFileSync(storageState)).digest("hex");
  if (!expectedDigest || actualDigest !== expectedDigest) {
    throw new FormalBlockedError(
      "本地认证会话与经审查的审核通过账号会话摘要不一致；不得仅凭文件存在性形成资格结论。"
    );
  }
  return storageState;
}

async function waitForAuthenticatedState(page: Page): Promise<void> {
  const deadline = Date.now() + 300_000;
  const shortDeadline = Date.now() + 30_000;
  let challengeObserved = false;
  while (Date.now() < deadline) {
    if (new URL(page.url()).pathname !== "/login") return;
    const sliderVisible = await page
      .getByText("拖动滑块完成拼图", { exact: true })
      .isVisible()
      .catch(() => false);
    const secondaryVerificationVisible = await page
      .getByText("帐号首次登录设备，需要进行二次验证", { exact: true })
      .isVisible()
      .catch(() => false);
    challengeObserved ||= sliderVisible || secondaryVerificationVisible;
    if (!challengeObserved && Date.now() >= shortDeadline) {
      throw new Error("受控手机号与密码提交后未建立认证状态。");
    }
    await page.waitForTimeout(500);
  }
  if (challengeObserved) {
    throw new FormalBlockedError("人工安全挑战未在正式用例时限内完成；脚本未绕过或伪造挑战。");
  }
  throw new Error("受控手机号与密码提交后未建立认证状态。");
}

async function performControlledPasswordLogin(
  page: Page,
  runtime: FormalCaseRuntime,
  caseId: "OPEN-LOGIN-20260803-001" | "OPEN-LOGIN-20260803-002"
): Promise<void> {
  const review = await runtime.transitionRecord("open-platform-registration-approved");
  if (review?.outcome !== "approved" || !review.attestationDigest?.match(/^[a-f0-9]{64}$/u)) {
    throw new FormalBlockedError("当前账号未与已确认的审核通过资源交接证据绑定。");
  }
  if (await runtime.stageCompleted("password-login-intent-recorded")) {
    runtime.classifyFailure("PRODUCT");
    await page.goto("/console/home");
    await requireAuthenticatedLanding(
      page,
      page.getByRole("link", { name: "控制台", exact: true }),
      `${caseId} 已冻结登录 intent，但受控认证会话未能证明上次结果；禁止自动重提交。`
    );
    runtime.addOperationEvidence({
      operation: "authenticate_test_account",
      source: "ui_state",
      contractId: "open-platform-authenticated-route-v1",
      outcome: "succeeded",
      finality: "final",
      stableIdentity: "not_required",
      fallbackUsed: false,
      reconciliation: "completed"
    });
    await runtime.completeStage("password-login-outcome-observed");
    runtime.addAssertion("the frozen login intent was reconciled through the reviewed authenticated route without resubmission");
    return;
  }
  runtime.classifyFailure("TEST_DATA");
  const environment = resolveTestEnvironment();
  const suffix = environment.name.toUpperCase();
  const phone = requireSensitiveRuntimeValue(
    `OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_${suffix}`,
    /^1[0-9]{10}$/,
    "受控登录手机号"
  );
  const password = requireSensitiveRuntimeValue(
    `OPEN_PLATFORM_PRODUCT_ADMIN_PASSWORD_${suffix}`,
    /[\s\S]+/,
    "受控登录密码",
    false
  );
  runtime.classifyFailure("SCRIPT");
  await page.goto("/login");
  const accountLogin = page.getByRole("button", { name: "切换为账号密码登录", exact: true });
  await requireUniqueVisible(accountLogin, "登录页【账号登录】切换按钮");
  await accountLogin.click();

  const phoneInput = page.getByLabel("账号登录手机号", { exact: true });
  const passwordInput = page.getByLabel("登录密码", { exact: true });
  const agreement = page.getByRole("checkbox", {
    name: "同意登录用户协议",
    exact: true
  });
  const loginButton = page.getByRole("button", { name: "账号密码登录", exact: true });
  await requireUniqueVisible(phoneInput, "手机号输入框");
  await requireUniqueVisible(passwordInput, "密码输入框");
  await requireUniqueVisible(loginButton, "登录按钮");

  try {
    await phoneInput.fill(phone);
    await passwordInput.fill(password);
    await checkVisibleElementPlusCheckbox(agreement, "登录用户协议勾选框");
    await runtime.completeStage("password-login-intent-recorded");
    const reservation = await runtime.reserveOperation(
      "authenticate_test_account",
      `${caseId}-password-login`
    );
    if (reservation === "existing") {
      runtime.classifyFailure("PRODUCT");
      await page.goto("/console/home");
      await requireAuthenticatedLanding(
        page,
        page.getByRole("link", { name: "控制台", exact: true }),
        `${caseId} 存在旧登录 reservation，但只读认证态 reconciliation 未通过；禁止自动重提交。`
      );
      runtime.addOperationEvidence({
        operation: "authenticate_test_account",
        source: "ui_state",
        contractId: "open-platform-authenticated-route-v1",
        outcome: "succeeded",
        finality: "final",
        stableIdentity: "not_required",
        fallbackUsed: false,
        reconciliation: "completed"
      });
      await runtime.completeStage("password-login-outcome-observed");
      runtime.addAssertion("the prior login reservation was reconciled without resubmission");
      return;
    }
    runtime.classifyFailure("UNKNOWN");
    await loginButton.click();
    await waitForAuthenticatedState(page);
    runtime.classifyFailure("PRODUCT");
    runtime.addOperationEvidence({
      operation: "authenticate_test_account",
      source: "ui_state",
      contractId: "open-platform-authenticated-route-v1",
      outcome: "succeeded",
      finality: "final",
      stableIdentity: "not_required",
      fallbackUsed: false,
      reconciliation: "not_required"
    });
    await runtime.completeStage("password-login-outcome-observed");
    runtime.addAssertion("password authentication submitted once and reached a user-visible authenticated route");
  } finally {
    await phoneInput.fill("").catch(() => {});
    await passwordInput.fill("").catch(() => {});
  }
}

async function promoteApprovedEnterpriseFixture(
  runtime: FormalCaseRuntime,
  resourceId: string
): Promise<void> {
  const resource = await runtime.manager.store.readResource(resourceId);
  const syntheticKey = typeof resource?.metadata.syntheticKey === "string"
    ? resource.metadata.syntheticKey
    : undefined;
  if (!resource || !syntheticKey) {
    throw new FormalBlockedError("审核通过企业缺少本地合成资源基线，不能晋升跨请求资源池。");
  }
  runtime.manager.registerResourceValidator("approved-enterprise-v1", async (candidate) => ({
    status: candidate.resourceId === resourceId
      && candidate.metadata.syntheticKey === syntheticKey
      ? "passed"
      : "failed",
    message: "账号登录与控制台落点已验证；本地合成企业身份和来源保持一致。"
  }));
  const promoted = await runtime.manager.promoteReusableResource({
    resourceId,
    requestId: formalExecutionManifest.requestId,
    caseId: "OPEN-REG-20260803-009",
    syntheticKey,
    baselineContractId: "approved-enterprise-v1",
    baselineVersion: "1",
    leaseMode: "exclusive",
    maxPoolSize: 5,
    retirementPolicy: "validate_quarantine_replace"
  });
  if (promoted.state !== "available" || !promoted.reusable) {
    throw new FormalBlockedError("审核通过企业未能通过资源池基线校验，已隔离且不会被后续请求复用。");
  }
  runtime.addAssertion("审核通过企业经真实登录和控制台落点验证后晋升本地可复用资源池");
}
