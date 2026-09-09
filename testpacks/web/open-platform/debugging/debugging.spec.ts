import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能包。");
}
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
const sharedAuthPaths = [
  join(packDirectory, "runtime", "auth-state.json"),
  join(packDirectory, "..", "console-home", "runtime", "auth-state.json"),
  join(packDirectory, "..", "enterprise-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "account-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "create-product", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-management", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-basic", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-function", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-develop", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-advanced", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-testing", "runtime", "auth-state.json"),
  join(packDirectory, "..", "procurement", "runtime", "auth-state.json"),
  join(packDirectory, "..", "authcode", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台设备调试", () => {
  async function attachShot(page: Page, name: string) {
    try {
      await test.info().attach(name, { body: await page.screenshot({ timeout: 10_000 }), contentType: "image/png" });
    } catch {
      await page.waitForTimeout(2_000).catch(() => {});
      try {
        await test.info().attach(name, { body: await page.screenshot({ timeout: 15_000 }), contentType: "image/png" });
      } catch {
        console.log(`[截图跳过] ${name}（两次截图均超时，不阻塞用例断言）`);
      }
    }
  }

  async function gotoWithRetry(page: Page, path: string) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      console.log(`[重试] ${path} 导航 20s 未完成（疑似 dev server 卡顿窗口），重载一次`);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
  }

  async function restoreSession(page: Page): Promise<boolean> {
    for (const candidate of sharedAuthPaths) {
      if (!existsSync(candidate)) continue;
      try {
        const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
        if (!state.cookies?.length) continue;
        await page.context().addCookies(state.cookies);
        await gotoWithRetry(page, "/integration/authcode");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByRole("button", { name: "新增授权码", exact: true })
            .first()
            .waitFor({ state: "visible", timeout: 45_000 })
            .then(() => true)
            .catch(() => false);
          if (ready) return true;
        }
      } catch {
        // 尝试下一个候选
      }
    }
    return false;
  }

  async function waitForSmsCountdownOrReject(page: Page) {
    const outcome = await page.waitForFunction(
      () => {
        if (/秒后重新获取|s后重新获取/u.test(document.body.innerText)) return "sent";
        const alert = document.querySelector('[role="alert"]');
        return alert && /频繁|超限/.test(alert.textContent ?? "") ? "rejected" : false;
      },
      null,
      { timeout: 240_000, polling: 1000 }
    );
    if ((await (await outcome).jsonValue()) === "rejected") {
      throw new Error("验证码发送被后端拒绝（疑似短信频控），请等待频控窗口后重跑该用例");
    }
    console.log("[自动捕获] 短信发送成功（倒计时已出现）");
  }

  async function smsLogin(page: Page) {
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute("aria-selected", "true");
    await loginPanel.getByRole("textbox", { name: "短信登录手机号" }).fill(testPhone);
    const sendCodeButton = loginPanel.getByRole("button", { name: "获取登录短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await loginPanel.getByRole("textbox", { name: "登录短信验证码" }).fill(testVerificationCode);
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const smsSubmit = loginPanel.getByRole("button", { name: "短信验证码登录", exact: true });
    await expect(smsSubmit).toBeEnabled();
    await smsSubmit.click();
    await expect(page).toHaveURL(/\/console\/home/u, { timeout: 30_000 });
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-DBG-001：设备调试入口缺失与直达拦截实证（no_write）。
    test("OP-DBG-001 设备调试入口缺失与直达拦截实证", async ({ page }) => {
      test.setTimeout(360_000);
      if (await restoreSession(page)) {
        test.info().annotations.push({
          type: "登录态复用",
          description: "检测到本地有效会话，跳过短信登录（不发送短信、无需人工点选验证码）"
        });
        await page.context().storageState({ path: authStatePath });
      } else {
        await smsLogin(page);
        await page.context().storageState({ path: authStatePath });
        console.log("[登录态] 短信登录成功，会话已保存到本包 runtime/auth-state.json");
      }

      // 步骤 1：侧边栏无「设备调试」入口。
      await gotoWithRetry(page, "/integration/authcode");
      await page.getByRole("button", { name: "新增授权码", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(1_000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      test.expect(bodyText.includes("设备调试"), "侧边栏不应有「设备调试」入口").toBe(false);
      const hasAuthcodeMenu = bodyText.includes("授权码管理");
      test.info().annotations.push({
        type: "探索注解",
        description: `菜单实证：设备调试入口缺失=${!bodyText.includes("设备调试")}，授权码管理在列=${hasAuthcodeMenu}`
      });

      // 步骤 2：直达 /integration/debugging → 权限拦截空态。
      await gotoWithRetry(page, "/integration/debugging");
      await page.waitForTimeout(4_000);
      await expect(page.getByText("您未被授权访问此页面")).toBeVisible();
      const debugText = await page.evaluate(() => document.body.innerText);
      test.expect(debugText.includes("接口调试"), "面包屑/i18n 名应含「接口调试」").toBe(true);
      test.expect(page.url(), "不应跳转登录页").toContain("/integration/debugging");
      test.info().annotations.push({ type: "探索注解", description: "直达被权限拦截（路由存在但权限未配置，菜单已注释下线）" });
      await attachShot(page, "调试直达拦截");
    });
  });

  test.describe("同组件路由权限差异核对", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-DBG-002：同组件路由权限差异核对（no_write，查重）。
    test("OP-DBG-002 同组件路由权限差异核对", async ({ page }) => {
      test.setTimeout(180_000);

      // 步骤 1：授权码页正常渲染（同组件已授权路由）。
      await gotoWithRetry(page, "/integration/authcode");
      await page.getByRole("button", { name: "新增授权码", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await expect(page.getByText("授权码总览", { exact: true }).first()).toBeVisible();

      // 步骤 2：debugging 同组件被拦截。
      await gotoWithRetry(page, "/integration/debugging");
      await page.waitForTimeout(4_000);
      await expect(page.getByText("您未被授权访问此页面")).toBeVisible();
      test.info().annotations.push({
        type: "探索注解",
        description: "查重结论：debugging 路由复用 authcode/AuthCode.vue，授权码页正常渲染而本路由被权限拦截——页面功能覆盖以 authcode 包为准"
      });
      await attachShot(page, "同组件差异");
    });
  });
});
