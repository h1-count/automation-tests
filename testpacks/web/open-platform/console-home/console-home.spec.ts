import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能测试包。");
}
// 本包登录态文件（token 位于 cookie，仅存本地不入 Git）。
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
// 跨包登录态复用（skills/testcase-designer 约定）：优先复用 create-product 包维护的有效会话，失效时本包自愈。
const sharedAuthStatePath = join(packDirectory, "..", "create-product", "runtime", "auth-state.json");
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台控制台首页", () => {
  // 报告证据：关键状态截图进入 HTML 报告附件区；截图限时 + 一次退避重试（不要用
  // page.evaluate(document.fonts.ready) 预热——无超时上限，dev server 字体挂起会拖死用例）。
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

  // 每条用例的报告都携带功能包结论（当前结论 + 实现差异与限制）。
  test.beforeEach(async () => {
    await test.info().attach("功能包结论与已知差异.md", { path: join(packDirectory, "conclusion.md") });
  });

  // SPA 导航辅助（沿用 create-product 模式）：domcontentloaded 即路由可交互；卡顿窗口 20s 快速失败 + 重载自愈。
  async function gotoWithRetry(page: Page, path: string) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      console.log(`[重试] ${path} 导航 20s 未完成（疑似 dev server 卡顿窗口），重载一次`);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
  }

  // 等待控制台首页就绪：系统入口列表渲染完成（Vite 动态 import 字典/路由 chunk 冷启动可达约 9s，以渲染信号硬等）。
  async function expectHomeReady(page: Page) {
    await expect(page).toHaveURL(/\/console\/home/u, { timeout: 20_000 });
    await page.locator(".console-home").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator(".system-item").first().waitFor({ state: "visible", timeout: 30_000 });
  }

  // 会话复用：优先本包登录态，其次 create-product 共享登录态；注入 cookie 后直达控制台首页验证有效性。
  async function restoreSession(page: Page): Promise<boolean> {
    for (const candidate of [authStatePath, sharedAuthStatePath]) {
      if (!existsSync(candidate)) continue;
      try {
        const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
        if (!state.cookies?.length) continue;
        await page.context().addCookies(state.cookies);
        await gotoWithRetry(page, "/console/home");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .locator(".system-item")
            .first()
            .waitFor({ state: "visible", timeout: 30_000 })
            .then(() => true)
            .catch(() => false);
          if (ready) {
            if (candidate === sharedAuthStatePath) {
              console.log("[登录态复用] 命中 create-product 共享会话");
            }
            return true;
          }
        }
      } catch {
        // 尝试下一个候选
      }
    }
    return false;
  }

  // 等待短信发送结果：倒计时出现=发送成功；频控类提示=发送被拒（快速失败）。
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

  test.describe("登录态就绪", () => {
    // 覆盖 OP-CONS-001：已登录直达控制台首页渲染完整（no_write）。
    // 登录态优先复用本地 auth-state（本包 → create-product 共享），仅当均失效时才短信登录
    //（人工点选图形验证码）；登录功能本身由 login-register 功能包覆盖。
    test("OP-CONS-001 已登录直达控制台首页渲染完整", async ({ page }) => {
      test.setTimeout(360_000);

      // 前置：会话复用检查——有效登录态则直达首页，跳过短信登录。
      if (await restoreSession(page)) {
        test.info().annotations.push({
          type: "登录态复用",
          description: "检测到本地有效会话，跳过短信登录（不发送短信、无需人工点选验证码）"
        });
        // 落盘到本包 runtime/auth-state.json：后续用例经 test.use({ storageState }) 读取该文件。
        await page.context().storageState({ path: authStatePath });
      } else {
        const testPhone = process.env.TEST_PHONE;
        const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
        if (!testPhone || !testVerificationCode) {
          throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
        }
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
        await page.context().storageState({ path: authStatePath });
        console.log("[登录态] 短信登录成功，会话已保存到本包 runtime/auth-state.json");
      }

      // 步骤 1：已登录态直达 /console/home（会话恢复后已在该页，仍显式导航保证入口一致）。
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 步骤 2：用户信息卡——姓名非空、「管理员」标签、所属企业名称。
      const card = page.locator(".user-info").first();
      await expect(card).toBeVisible();
      await expect(card.locator(".user-info-name")).toHaveText(/\S+/u);
      await expect(card.locator(".user-info-authority")).toHaveText(/管理员|成员/u);
      await expect(card.locator(".user-info-company")).toHaveText(/\S+/u);
      await attachShot(page, "控制台首页-用户信息卡");

      // 步骤 3：系统入口列表至少 1 项，每项含名称与描述。
      const items = page.locator(".system-item");
      await expect(items.first()).toBeVisible();
      const count = await items.count();
      expect(count, "系统入口应至少 1 项").toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        await expect(items.nth(i).locator(".system-item-title")).toHaveText(/\S+/u);
        await expect(items.nth(i).locator(".system-item-description")).toHaveText(/\S+/u);
      }
      await attachShot(page, "控制台首页-系统入口列表");
    });
  });

  test.describe("登录后：渲染、入口与头部导航", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-CONS-002：头部「控制台」入口进入控制台首页（no_write）。
    test("OP-CONS-002 头部控制台入口进入控制台首页", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/");

      // 步骤 1：官网首页头部显示「控制台」链接（已登录态；AIoT控制台/控制台文案均可）。
      const consoleLink = page.getByRole("link", { name: /控制台/u }).first();
      await expect(consoleLink).toBeVisible({ timeout: 20_000 });

      // 步骤 2：点击进入控制台首页。
      await consoleLink.click();
      await expectHomeReady(page);

      // 步骤 3：用户信息卡与 OP-CONS-001 结构一致。
      await expect(page.locator(".user-info").first()).toBeVisible();
      await expect(page.locator(".user-info-name").first()).toHaveText(/\S+/u);
      await attachShot(page, "控制台入口进入首页");
    });

    // 覆盖 OP-CONS-003：控制台首页无侧边菜单与面包屑（no_write；路由 meta sideNav/breadcrumb 关闭）。
    test("OP-CONS-003 控制台首页无侧边菜单与面包屑", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 步骤 1：侧边导航区域不存在/不可见。
      await expect(page.locator(".app-sidenav")).toHaveCount(0);

      // 步骤 2：面包屑区域不存在/不可见。
      await expect(page.locator(".app-breadcrum")).toHaveCount(0);
      await attachShot(page, "首页无侧边菜单与面包屑");
    });

    // 覆盖 OP-CONS-004：系统入口列表与权限一致（no_write；完整权限企业显示三系统）。
    test("OP-CONS-004 系统入口列表与权限一致", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 步骤 1：恰好显示三个系统入口（探索实证 2026-09-03）。
      const titles = await page.locator(".system-item-title").allInnerTexts();
      expect(titles.map((t) => t.trim()), "应恰好为三个系统入口").toEqual(["产品接入系统", "产品运营系统", "产品服务系统"]);

      // 步骤 2：每项描述非空（sys-data 固定文案）。
      const descriptions = await page.locator(".system-item-description").allInnerTexts();
      for (const text of descriptions) {
        expect(text.trim().length, "每项描述应非空").toBeGreaterThan(0);
      }
      await attachShot(page, "三系统入口与权限一致");
    });

    // 覆盖 OP-CONS-005：产品接入系统入口跳转产品开发（no_write；落点经路由重定向）。
    test("OP-CONS-005 产品接入系统入口跳转产品开发", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 步骤 1：点击入口，跳转 /integration/product（重定向后落点 /integration/product/management）。
      await page.locator(".system-item-wrapper", { hasText: "产品接入系统" }).first().click();
      await expect(page).toHaveURL(/\/integration\/product\/management/u, { timeout: 30_000 });

      // 步骤 2：目标页核心区域渲染完成（创建产品按钮与搜索框为产品开发首页稳定锚点）。
      await expect(page.getByRole("button", { name: "创建产品", exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByPlaceholder("Model/名称/型号")).toBeVisible();
      await attachShot(page, "产品接入入口-产品开发首页");
    });

    // 覆盖 OP-CONS-006：产品运营系统入口跳转设备管理（no_write）。
    test("OP-CONS-006 产品运营系统入口跳转设备管理", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      await page.locator(".system-item-wrapper", { hasText: "产品运营系统" }).first().click();
      await expect(page).toHaveURL(/\/device\/management/u, { timeout: 30_000 });
      await expect(page.locator("main").first()).toBeVisible();
      await attachShot(page, "产品运营入口-设备管理");
    });

    // 覆盖 OP-CONS-007：产品服务系统入口跳转服务开发（no_write）。
    test("OP-CONS-007 产品服务系统入口跳转服务开发", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      await page.locator(".system-item-wrapper", { hasText: "产品服务系统" }).first().click();
      await expect(page).toHaveURL(/\/service\/aiot-develop/u, { timeout: 30_000 });
      await expect(page.locator("main").first()).toBeVisible();
      await attachShot(page, "产品服务入口-服务开发");
    });

    // 覆盖 OP-CONS-008：服务支持下拉含三项并可进入文档中心（no_write；namespace=ep，ARIA 定位）。
    test("OP-CONS-008 服务支持下拉含三项并可进入文档中心", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 步骤 1：点击头部「服务支持」展开下拉面板。
      await page.locator(".console-header").getByText("服务支持", { exact: true }).click();

      // 步骤 2：面板含文档中心/技术工单/常见问题三个链接。
      const menu = page.locator(".service-menu");
      await expect(menu).toBeVisible();
      const docLink = menu.getByRole("link", { name: "文档中心" });
      const ticketLink = menu.getByRole("link", { name: "技术工单" });
      const faqLink = menu.getByRole("link", { name: "常见问题" });
      await expect(docLink).toBeVisible();
      await expect(ticketLink).toBeVisible();
      await expect(faqLink).toBeVisible();
      await attachShot(page, "服务支持下拉三项");

      // 步骤 3：点击文档中心跳转 /service-support/home，面板关闭。
      await docLink.click();
      await expect(page).toHaveURL(/\/service-support\/home/u, { timeout: 30_000 });
      await expect(menu).not.toBeVisible();
      await attachShot(page, "文档中心跳转成功");
    });

    // 覆盖 OP-CONS-009：头部企业切换与用户下拉组成（no_write）。
    test("OP-CONS-009 头部企业切换与用户下拉组成", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 步骤 1：企业切换下拉显示当前激活企业名称（与用户信息卡企业一致）。
      const companySwitch = page.locator(".company-switch");
      await expect(companySwitch).toBeVisible();
      const cardCompany = (await page.locator(".user-info-company").first().innerText()).trim();
      expect((await companySwitch.innerText()).trim(), "企业切换当前值应与激活企业一致").toBe(cardCompany);

      // 步骤 2：用户昵称下拉展开含「账号中心」与「退出」。
      await page.locator(".btn-usermeta").click();
      const menuItem = page.getByText("账号中心", { exact: true }).first();
      await expect(menuItem).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("退出", { exact: true }).first()).toBeVisible();
      await attachShot(page, "用户下拉菜单");

      // 步骤 3：点击账号中心跳转账号资料页。
      await menuItem.click();
      await expect(page).toHaveURL(/\/console\/account\/info/u, { timeout: 30_000 });
      await attachShot(page, "账号中心跳转成功");
    });

    // 覆盖用例 OP-CONS-010：无系统权限账号显示空态提示（no_write）。
    // 待确认：需「无 aiot 权限」或「未加入企业」账号——当前两家测试企业均含产品接入权限，无法实证；
    // 以 fixme 保留覆盖意图（源码静态发现空态文案疑似错别字「没还有获得系统使用仅限」，待实证）。
    test.fixme("OP-CONS-010 无系统权限账号显示空态提示", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/home");
      await expect(page.locator(".ep-empty, .el-empty").first()).toBeVisible();
    });

    // 覆盖 OP-CONS-011：切换受限企业后系统入口随权限收窄（no_write；会话上下文切换，结束恢复原企业）。
    test("OP-CONS-011 切换受限企业后系统入口随权限收窄", async ({ page }) => {
      test.setTimeout(120_000);
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);

      // 前置核对：当前为完整权限企业（3 个入口）。
      const companySwitch = page.locator(".company-switch");
      const originalCompany = (await companySwitch.innerText()).trim();
      await expect(page.locator(".system-item")).toHaveCount(3);

      // 步骤 1：在头部企业切换下拉中选择另一家企业（受限企业）。
      await companySwitch.click();
      const option = page.getByRole("option");
      await option.first().waitFor({ state: "visible", timeout: 10_000 });
      const optionTexts = (await option.allInnerTexts()).map((t) => t.trim());
      const target = optionTexts.find((t) => t && t !== originalCompany);
      expect(target, "企业下拉应存在另一家企业").toBeTruthy();
      await page.getByRole("option", { name: target }).first().click();
      console.log(`[企业切换] ${originalCompany} → ${target}`);

      // 步骤 2：系统入口仅显示「产品接入系统」（会话/权限刷新需要时间，以渲染信号等待）。
      await page.locator(".system-item").first().waitFor({ state: "visible", timeout: 30_000 });
      await expect(page.locator(".system-item-title")).toHaveText(["产品接入系统"], { timeout: 20_000 });

      // 步骤 3：用户信息卡企业名称更新为受限企业。
      await expect(page.locator(".user-info-company").first()).toHaveText(target!, { timeout: 20_000 });
      await attachShot(page, "受限企业-仅产品接入入口");

      // 步骤 4：受限企业下点击「产品接入系统」入口，仍可进入产品开发（productDevelop 为其启用子权限）。
      await page.locator(".system-item-wrapper", { hasText: "产品接入系统" }).first().click();
      await expect(page).toHaveURL(/\/integration\/product\/management/u, { timeout: 30_000 });
      await attachShot(page, "受限企业-产品开发可达");

      // 收尾：切回原企业，恢复会话上下文（避免影响 create-product 等其他功能包的执行前提）。
      await gotoWithRetry(page, "/console/home");
      await expectHomeReady(page);
      await companySwitch.click();
      await page.getByRole("option").first().waitFor({ state: "visible", timeout: 10_000 });
      await page.getByRole("option", { name: originalCompany }).first().click();
      await page.locator(".system-item").first().waitFor({ state: "visible", timeout: 30_000 });
      await expect(page.locator(".system-item")).toHaveCount(3, { timeout: 20_000 });
      test.info().annotations.push({
        type: "会话恢复",
        description: `用例结束时已切回原激活企业「${originalCompany}」（3 个系统入口恢复），不影响其他功能包执行`
      });
      await attachShot(page, "切回原企业-入口恢复");
    });
  });
});
