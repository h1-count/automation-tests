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
  join(packDirectory, "..", "debugging", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台数据统计", () => {
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
        await gotoWithRetry(page, "/statistics/overview");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByText("数据概览", { exact: true })
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
    // 覆盖 OP-STAT-001：数据概览页渲染（no_write）。
    test("OP-STAT-001 数据概览页渲染", async ({ page }) => {
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

      // 步骤 1：标题与描述（数据更新于每日 02:00）。
      await gotoWithRetry(page, "/statistics/overview");
      await page.getByText("数据概览", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(2_000);
      await expect(page.getByText(/数据更新于/u).first()).toBeVisible();

      // 步骤 2：4 统计卡。
      const statText = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".data-sticky")).map((e) => (e.textContent ?? "").replace(/\s+/g, "").slice(0, 20))
      );
      const joined = statText.join(" ");
      for (const card of ["设备激活总数", "设备日活跃数", "设备在线数", "设备离线数"]) {
        test.expect(joined, `统计卡应含 ${card}`).toContain(card);
      }
      test.info().annotations.push({ type: "探索注解", description: `统计卡（实证）：${joined.slice(0, 120)}` });

      // 步骤 3：图表区。
      await expect(page.getByText("设备新增激活数").first()).toBeVisible();
      await expect(page.getByText("设备活跃数").first()).toBeVisible();
      const canvasCount = await page.locator("canvas").count();
      test.info().annotations.push({ type: "探索注解", description: `图表区标题可见；canvas 数=${canvasCount}（空数据态注解）` });

      // 步骤 4：双排行表。
      const headers = page.locator(".ep-table__header:visible");
      const headerCount = await headers.count();
      test.expect(headerCount, "应有两个排行表").toBeGreaterThanOrEqual(2);
      const h1 = (await headers.nth(0).innerText()).replace(/\n/g, " ");
      const h2 = (await headers.nth(1).innerText()).replace(/\n/g, " ");
      test.expect(h1).toContain("排名");
      test.expect(h1).toContain("总数");
      test.expect(h2).toContain("排名");
      test.expect(h2).toContain("新增数");
      test.info().annotations.push({ type: "探索注解", description: `排行表头（实证）①：${h1}；②：${h2}` });
      await attachShot(page, "数据概览");
    });
  });

  test.describe("排行切换与子页", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-STAT-002：排行表时间范围切换（no_write）。
    test("OP-STAT-002 排行表时间范围切换", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoWithRetry(page, "/statistics/overview");
      await page.getByText("数据概览", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(2_000);

      // 步骤 1：设备激活新增排行 近7日→全部。
      const selects = page.locator(".search-form .ep-select");
      const selectCount = await selects.count();
      test.info().annotations.push({ type: "探索注解", description: `概览页 search-form 下拉数=${selectCount}（排行时间范围控件实证）` });
      const usageSelect = selects.nth(selectCount - 1); // 最后一个下拉 = 设备激活新增排行范围
      await usageSelect.click();
      await page.waitForTimeout(900);
      const opts = page.locator(".ep-select-dropdown:visible .ep-select-dropdown__item");
      const optTexts = await opts.allInnerTexts();
      test.info().annotations.push({ type: "探索注解", description: `范围选项（实证）：${optTexts.join("/")}` });
      const allOpt = opts.filter({ hasText: "全部" }).first();
      if (await allOpt.isVisible().catch(() => false)) {
        await allOpt.click();
        await page.waitForTimeout(1_500);
        const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
        test.info().annotations.push({ type: "探索注解", description: `切「全部」后排行行数=${rows}（查询无报错）` });
      } else {
        await page.keyboard.press("Escape");
        test.info().annotations.push({ type: "探索注解", description: "未找到「全部」选项，切换跳过（选项注解为准）" });
      }
      await attachShot(page, "排行切换");
    });

    // 覆盖 OP-STAT-003：地域分析页渲染（no_write）。
    test("OP-STAT-003 地域分析页渲染", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoWithRetry(page, "/statistics/region-analysis");
      await page.getByText("地域分析", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(3_000);

      // 步骤 1：标题与筛选区。
      await expect(page.getByText("地域分析", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("全部产品").first()).toBeVisible();

      // 步骤 2：地域分布图（中国地图 canvas）。
      await expect(page.getByText("地域分布图").first()).toBeVisible();
      const canvasCount = await page.locator("canvas").count();
      test.info().annotations.push({ type: "探索注解", description: `地域分布图区块可见；canvas 数=${canvasCount}（空数据态注解）` });

      // 步骤 3：省份表。
      const header = page.locator(".ep-table__header:visible").last();
      const headerText = (await header.innerText()).replace(/\n/g, " ");
      test.expect(headerText).toContain("省份");
      test.expect(headerText).toContain("设备激活总数");
      test.expect(headerText).toContain("设备新增激活数");
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `省份表头（实证）：${headerText}；行数=${rows}` });
      await attachShot(page, "地域分析");
    });

    // 覆盖 OP-STAT-004：使用分析下线与直达拦截实证（no_write）。
    test("OP-STAT-004 使用分析下线与直达拦截实证", async ({ page }) => {
      test.setTimeout(180_000);

      // 步骤 1：数据统计侧边栏无「使用分析」。
      await gotoWithRetry(page, "/statistics/overview");
      await page.getByText("数据概览", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(1_000);
      const asideText = await page.evaluate(() => {
        const aside = document.querySelector("aside, [class*=side]");
        return aside ? (aside as HTMLElement).innerText : "";
      });
      test.expect(asideText.includes("使用分析"), "侧边栏不应有「使用分析」入口").toBe(false);
      test.expect(asideText).toContain("数据概览");
      test.expect(asideText).toContain("地域分析");
      test.info().annotations.push({ type: "探索注解", description: `数据统计侧边栏（实证）：${asideText.replace(/\n+/g, " / ")}` });

      // 步骤 2：直达 usage-analysis → 权限拦截。
      await gotoWithRetry(page, "/statistics/usage-analysis");
      await page.waitForTimeout(4_000);
      await expect(page.getByText("您未被授权访问此页面")).toBeVisible();
      const bodyText = await page.evaluate(() => document.body.innerText);
      test.expect(bodyText.includes("使用分析"), "面包屑/i18n 名应含「使用分析」").toBe(true);
      test.info().annotations.push({
        type: "探索注解",
        description: "直达被权限拦截（路由存在但菜单已注释 + 权限未配置）——与 debugging 包同款下线模式，待产品确认是否废弃"
      });
      await attachShot(page, "使用分析拦截");
    });
  });
});
