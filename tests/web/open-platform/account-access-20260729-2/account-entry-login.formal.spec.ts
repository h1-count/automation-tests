import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Browser, Locator, Page, Request } from "@playwright/test";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment.js";
import {
  configureFormalSuite,
  expect,
  formalCase,
  FormalBlockedError,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const forbiddenBusinessMutationPaths = new Set([
  "/company/file-upload",
  "/get/msg/code",
  "/login/msg/verify",
  "/mcode/login",
  "/official/website/application/for/registration",
  "/official/website/send/register/msg"
]);

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-025", "首页账户入口分别进入登录页和注册页", async ({ browser }) => {
  await test.step("独立核对【立即使用】进入登录页", async () => {
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const immediateUse = page.getByRole("button", { name: "立即使用 ⇁", exact: true });
        await requireUniqueVisible(immediateUse, "首页【立即使用】按钮");
        await immediateUse.click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
        const loginTab = page.getByRole("tab", { name: "登录", exact: true });
        await requireUniqueVisible(loginTab, "登录页【登录】页签");
        await expect(loginTab).toHaveAttribute("aria-selected", "true");
      });
    });
  });

  await test.step("独立核对【登录/注册】进入注册页", async () => {
    await withIsolatedPage(browser, undefined, async (page) => {
      await assertNoMutationRequests(page, async () => {
        await page.goto("/");
        const accountEntry = page.getByRole("link", { name: "登录/注册", exact: true });
        await requireUniqueVisible(accountEntry, "首页【登录/注册】入口");
        await accountEntry.click();
        await expect.poll(() => {
          const current = new URL(page.url());
          return `${current.pathname}?tab=${current.searchParams.get("tab") ?? ""}`;
        }).toBe("/login?tab=register");
        const registerTab = page.getByRole("tab", { name: "注册", exact: true });
        await requireUniqueVisible(registerTab, "注册页【注册】页签");
        await expect(registerTab).toHaveAttribute("aria-selected", "true");
      });
    });
  });
});

formalCase("OPEN-LOGIN-001", "受控手机号与密码登录主路径", async ({ browser }) => {
  await withIsolatedPage(browser, undefined, async (page) => {
    await performControlledPasswordLogin(page);
    await expect.poll(() => new URL(page.url()).pathname).not.toBe("/login");
  });
});

formalCase("OPEN-LOGIN-002", "登录验证后默认进入 AIoT 控制台", async ({ browser }) => {
  await withIsolatedPage(browser, undefined, async (page) => {
    await performControlledPasswordLogin(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/console/home");
    await requireUniqueVisible(
      page.getByRole("link", { name: "控制台", exact: true }),
      "AIoT 控制台导航语义"
    );
  });
});

formalCase("OPEN-LOGIN-003", "审核通过账号的资源使用资格", async ({ browser }) => {
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
    await page.goto("/console/home");
    if (new URL(page.url()).pathname === "/login") {
      throw new FormalBlockedError("审核通过账号的受控认证会话已失效，不能形成资源资格结论。");
    }
    const resourceLink = page.getByRole("link", { name: resourceName, exact: true });
    await requireUniqueVisible(resourceLink, `只读平台资源【${resourceName}】`);
    await resourceLink.click();
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
  if (await locator.count() !== 1 || !(await locator.isVisible())) {
    throw new FormalBlockedError(`${label}的稳定语义定位不可用或不唯一，禁止猜测定位。`);
  }
}

async function assertNoMutationRequests(page: Page, body: () => Promise<void>): Promise<void> {
  let mutationCount = 0;
  const observe = (request: Request) => {
    if (
      !safeMethods.has(request.method().toUpperCase())
      && forbiddenBusinessMutationPaths.has(new URL(request.url()).pathname)
    ) {
      mutationCount += 1;
    }
  };
  page.on("request", observe);
  try {
    await body();
    expect(mutationCount, "入口导航不得发起远端写请求").toBe(0);
  } finally {
    page.off("request", observe);
  }
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

async function performControlledPasswordLogin(page: Page): Promise<void> {
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

  await page.goto("/login");
  const accountLogin = page.getByRole("button", { name: "账号登录", exact: true });
  await requireUniqueVisible(accountLogin, "登录页【账号登录】切换按钮");
  await accountLogin.click();

  const phoneInput = page.getByLabel("手机号", { exact: true });
  const passwordInput = page.getByLabel("密码", { exact: true });
  const agreement = page.getByRole("checkbox", {
    name: "我已阅读并已同意",
    exact: true
  });
  const loginButton = page.getByRole("button", { name: "登录", exact: true });
  await requireUniqueVisible(phoneInput, "手机号输入框");
  await requireUniqueVisible(passwordInput, "密码输入框");
  await requireUniqueVisible(agreement, "用户协议勾选框");
  await requireUniqueVisible(loginButton, "登录按钮");

  try {
    await phoneInput.fill(phone);
    await passwordInput.fill(password);
    await agreement.check();
    await loginButton.click();
    await waitForAuthenticatedState(page);
  } finally {
    await phoneInput.fill("").catch(() => {});
    await passwordInput.fill("").catch(() => {});
  }
}
