import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { expect, test } from "../../../../src/fixtures/webAutomationFixture";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment";
import { installExploreMutationGuard } from "../../../../src/support/web/automationMode";

const registrationUrl = new URL("/login?tab=register", resolveTestEnvironment().openPlatformWebBaseUrl).toString();

async function openRegistration(page: Page) {
  await page.goto(registrationUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.locator(".register-form")).toBeVisible({ timeout: 15_000 });
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

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  return error.message
    .split("\n")
    .filter((line) => /^(Locator:|Expected:|Received:|Error:)/.test(line.trim()))
    .join(" ") || error.message.split("\n")[0];
}

async function exploreStep(name: string, failures: string[], action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    failures.push(`${name}: ${errorMessage(error)}`);
    console.info(`[探索继续] ${name} 失败；保留当前页面并继续。`);
  }
}

async function logRegistrationAriaSnapshot(page: Page) {
  const snapshot = await registrationForm(page).ariaSnapshot();
  console.info(`[ARIA 语义树：注册表单]\n${snapshot}`);
}

test.describe("开放平台注册（无写入）", () => {
  test.describe.configure({ timeout: 90_000 });

  test("单页可见探索：失败后保留当前页面并继续收集证据", async () => {
    const cdpEndpoint = process.env.PLAYWRIGHT_EXPLORE_CDP_URL;
    const reuseBrowserSession = Boolean(cdpEndpoint);
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    const failures: string[] = [];

    try {
      browser = reuseBrowserSession
        ? await chromium.connectOverCDP(cdpEndpoint!)
        : await chromium.launch({ headless: false, slowMo: 350 });
      context = reuseBrowserSession ? browser.contexts()[0] : await browser.newContext();
      if (!context) {
        throw new Error("持久探索会话未提供可用的浏览器上下文。请先重启探索会话。");
      }
      await installExploreMutationGuard(context, {
        onBlocked: (attempt) => console.info(`[探索零写入] 已阻止 ${attempt.method} ${attempt.url}`)
      });
      const page = context.pages().find((candidate) => !candidate.isClosed()) ?? (await context.newPage());

      await exploreStep("打开注册页", failures, () => openRegistration(page));
      await exploreStep("读取注册表单 ARIA 语义树", failures, () => logRegistrationAriaSnapshot(page));

      for (const placeholder of [
        "请输入企业名称",
        "请输入企业标识",
        "请输入企业地址",
        "请输入企业邮箱",
        "企业信用代码",
        "请输入您的姓名",
        "请输入联系方式",
        "请输入验证码",
        "请输入企业简介"
      ]) {
        await exploreStep(`${placeholder} 可见`, failures, async () => {
          await expect(formInput(page, placeholder)).toBeVisible();
        });
      }

      await exploreStep("营业执照上传控件可见", failures, async () => {
        await expect(formInput(page, "上传营业执照")).toBeVisible();
      });
      await exploreStep("验证码输入框可见", failures, async () => {
        await expect(formInput(page, "请输入验证码")).toBeVisible();
      });
      await exploreStep("获取验证码入口可见", failures, async () => {
        await expect(registrationForm(page).getByText("获取验证码", { exact: true })).toBeVisible();
      });
      await exploreStep("协议勾选框可见", failures, async () => {
        const agreement = registrationForm(page).locator(".form-agreement .ep-checkbox").filter({
          hasText: "我已阅读并已同意"
        });
        const input = agreement.locator('input[type="checkbox"]');
        await expect(agreement).toBeVisible();
        await agreement.click();
        await expect(input).toBeChecked();
        await agreement.click();
        await expect(input).not.toBeChecked();
      });
      await exploreStep("注册按钮初始禁用", failures, async () => {
        await expect(registrationForm(page).getByRole("button", { name: "同意条款并注册" })).toBeDisabled();
      });
      for (const [placeholder, maxlength] of [
        ["请输入企业名称", "50"],
        ["请输入企业地址", "50"],
        ["请输入企业标识", "6"],
        ["企业信用代码", "18"],
        ["请输入您的姓名", "20"],
        ["请输入企业简介", "100"]
      ]) {
        await exploreStep(`${placeholder} 长度限制`, failures, async () => {
          await expect(formInput(page, placeholder)).toHaveAttribute("maxlength", maxlength);
        });
      }
      await exploreStep("企业标识净化", failures, async () => {
        const identifier = formInput(page, "请输入企业标识");
        await identifier.pressSequentially("a!");
        await expect(identifier).toHaveValue("a");
      });
      await exploreStep("联系方式净化", failures, async () => {
        const phone = formInput(page, "请输入联系方式");
        await phone.pressSequentially("138a0013b8000");
        await expect(phone).toHaveValue("13800138000");
      });

      await exploreStep("有效企业邮箱字段状态", failures, async () => {
        const email = formInput(page, "请输入企业邮箱");
        await email.fill("tester@example.com");
        await email.blur();
        await expect(formItem(page, "请输入企业邮箱")).not.toContainClass("is-error");
      });

      await exploreStep("无效企业邮箱字段状态", failures, async () => {
        const email = formInput(page, "请输入企业邮箱");
        await email.fill("invalid-email");
        await email.blur();
        await expect(formItem(page, "请输入企业邮箱")).toContainClass("is-error");
      });

      expect(failures, `探索已完成，但发现 ${failures.length} 项：\n${failures.join("\n")}`).toEqual([]);
    } finally {
      if (!reuseBrowserSession) {
        await context?.close();
        await browser?.close();
      }
    }
  });

  test.skip("OPEN-REG-001、OPEN-REG-008～OPEN-REG-015、OPEN-REG-020、OPEN-REG-025：必填或内容校验需要提交前的完整表单；当前无写入范围不上传执照、不勾选协议、不点击注册", async () => {});
  test.skip("OPEN-REG-002、OPEN-REG-004、OPEN-REG-005：唯一性需要受控企业 A、validator 与清理动作", async () => {});
  test.skip("OPEN-REG-003、OPEN-REG-006：管理员与同手机号多企业需要认证、验证码和 A/B 数据生命周期", async () => {});
  test.skip("OPEN-REG-007：统一登录落点需要人工初始化的 test 认证会话", async () => {});
});
