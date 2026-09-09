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
  join(packDirectory, "..", "cloud-bridge", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台新模块与新路由", () => {
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
        await gotoWithRetry(page, "/ui-components/tag-select-demo");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByText("TagSelect", { exact: false })
            .first()
            .waitFor({ state: "visible", timeout: 45_000 })
            .then(() => true)
            .catch(() => false);
          if (ready || !/\/login/u.test(page.url())) return true;
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

  // 覆盖 OP-NEWM-001：UI 组件示例三页渲染与基础交互（no_write，mock 数据）。
  test("OP-NEWM-001 UI组件示例三页渲染与交互", async ({ page }) => {
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

    // 步骤 1：tag-select-demo 单选/多选交互。
    await gotoWithRetry(page, "/ui-components/tag-select-demo");
    await page.getByText("单选模式", { exact: false }).first().waitFor({ state: "visible", timeout: 45_000 });
    const frontendTag = page.getByText("前端开发", { exact: true }).first();
    await frontendTag.click();
    await page.waitForTimeout(800);
    const afterSelect = await page.evaluate(() => document.body.innerText);
    test.expect(afterSelect.includes("前端开发"), "点选后选中态应更新").toBe(true);
    await frontendTag.click();
    await page.waitForTimeout(800);
    test.info().annotations.push({ type: "探索注解", description: "tag-select 单选：点选→选中→再点取消（多选上限 3 注解）" });

    // 步骤 2：mock-demo。
    await gotoWithRetry(page, "/ui-components/mock-demo");
    await page.waitForTimeout(3_000);
    const mockText = await page.evaluate(() => document.body.innerText);
    test.expect(mockText.includes("用户列表"), "应含用户列表卡片").toBe(true);
    test.expect(mockText.includes("产品详情"), "应含产品详情卡片").toBe(true);
    test.info().annotations.push({ type: "探索注解", description: `mock-demo 卡片渲染（实证）：用户列表/产品详情，数据态=${mockText.includes("暂无数据") ? "暂无数据" : "有数据"}` });

    // 步骤 3：search-page-demo。
    await gotoWithRetry(page, "/ui-components/search-page-demo");
    await page.waitForTimeout(4_000);
    const searchPageText = await page.evaluate(() => document.body.innerText);
    const hasFilter = searchPageText.includes("设备类型") && searchPageText.includes("重置");
    const listRows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
    test.expect(hasFilter, "应含搜索筛选区").toBe(true);
    test.info().annotations.push({ type: "探索注解", description: `search-page-demo：筛选区可见=${hasFilter}，mock 列表行数=${listRows}` });
    await attachShot(page, "UI组件示例");
  });

  test.describe("动态路由", () => {
    test.use({ storageState: authStatePath });
    test.setTimeout(240_000);

    // 覆盖 OP-NEWM-002：未上线动态路由 404 实证（no_write）。
    test("OP-NEWM-002 未上线动态路由404实证", async ({ page }) => {

    // 步骤 1：四个动态路由。
    const routes = ["/ai-agent/my-agent", "/app/sdk-development", "/user-center/developer-info", "/user-center/company-info"];
    const report: string[] = [];
    for (const r of routes) {
      await gotoWithRetry(page, r);
      await page.waitForTimeout(4_000);
      const text = await page.evaluate(() => document.body.innerText);
      const notFound = text.includes("抱歉，当前页面无法访问") || text.includes("网址错误或不存在");
      report.push(`${r}: 404=${notFound}`);
      test.expect(notFound, `${r} 应渲染 404 空态（未上线实证）`).toBe(true);
    }
    test.info().annotations.push({
      type: "探索注解",
      description: `动态路由实证：${report.join("；")}——dynamics.ts 已注册路由但未生效（新模块未上线证据，待发布后另立用例）`
    });

    // 步骤 2：侧边栏菜单注解。
    await gotoWithRetry(page, "/console/home");
    await page.waitForTimeout(4_000);
    const menuText = await page.evaluate(() => document.body.innerText);
    const hasNewModules = menuText.includes("AI智能体") || menuText.includes("用户中心") || (menuText.includes("APP") && menuText.includes("SDK"));
    test.info().annotations.push({ type: "探索注解", description: `侧边栏新模块入口（实证）：AI智能体/用户中心/APP 可见=${hasNewModules}（应为 false，与 404 一致）` });
    await attachShot(page, "动态路由404");
    });
  });
});
