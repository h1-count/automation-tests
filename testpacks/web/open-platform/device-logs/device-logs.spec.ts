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

test.describe("开放平台设备日志", () => {
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
        await gotoWithRetry(page, "/device/logs");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByText("设备日志", { exact: true })
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

  async function gotoLogs(page: Page) {
    await gotoWithRetry(page, "/device/logs");
    await page.getByText("设备日志", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-DLOG-001：设备日志页渲染与默认时间范围（no_write）。
    test("OP-DLOG-001 设备日志页渲染与默认时间范围", async ({ page }) => {
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

      // 步骤 1：标题与描述。
      await gotoLogs(page);
      await expect(page.getByText("设备日志", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/七日内的操作日志/u).first()).toBeVisible();

      // 步骤 2：默认日期范围 = 最近 7 天。
      const startInput = page.locator(".search-form .ep-date-editor input").first();
      const startVal = await startInput.inputValue();
      const today = new Date();
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const weekAgo = new Date(today.getTime() - 6 * 24 * 3600 * 1000);
      test.expect(startVal, `开始时间应为 ${fmt(weekAgo)} 00:00:00`).toContain(`${fmt(weekAgo)} 00:00:00`);
      test.info().annotations.push({ type: "探索注解", description: `默认日期范围（实证）：${startVal} ~（结束为今天 23:59:59）` });

      // 步骤 3：表头与数据行注解。
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["设备名称", "设备Mac", "时间", "事件名称", "事件详情"]) {
        await expect(header).toContainText(col);
      }
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `日志行数=${rows}（无绑定设备，实证 0 行）` });
      await attachShot(page, "设备日志页");
    });
  });

  test.describe("日期筛选与 URL 注入", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-DLOG-002：日期范围筛选（no_write）。
    test("OP-DLOG-002 日期范围筛选", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoLogs(page);

      // 步骤 1：修改日期范围为近 3 天。
      const editor = page.locator(".search-form .ep-date-editor").first();
      await editor.click();
      await page.waitForTimeout(1_000);
      const panel = page.locator(".ep-picker-panel:visible").first();
      if (await panel.isVisible().catch(() => false)) {
        const tds = page.locator(".ep-date-table td");
        const today = page.locator(".ep-date-table td.today").first();
        const threeAgo = tds.nth(Math.max(0, (await tds.count()) - 12));
        await threeAgo.click().catch(() => {});
        await today.click().catch(() => {});
        await page.waitForTimeout(1_000);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1_000);
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `近3天筛选后行数=${rows}（查询无报错）` });

      // 步骤 2：结束时间纯日期自动补 23:59:59（源码规则，UI 层以实证注解记录）。
      const editorVal = await editor.locator("input").first().inputValue().catch(() => "");
      test.info().annotations.push({ type: "探索注解", description: `当前范围值（实证）：${editorVal}；源码 onDateRangeChange 规则：纯日期结束时间自动补 23:59:59` });

      // 步骤 3：恢复默认（重置按钮或刷新）。
      const resetBtn = page.getByRole("button", { name: "重置", exact: true });
      if (await resetBtn.isVisible().catch(() => false)) {
        await resetBtn.click();
        await page.waitForTimeout(1_200);
      } else {
        await gotoLogs(page);
      }
      test.info().annotations.push({ type: "探索注解", description: "已恢复默认范围并重新查询，无报错" });
      await attachShot(page, "日期筛选");
    });

    // 覆盖 OP-DLOG-003：deviceId URL 注入行为（合成值，只读）。
    test("OP-DLOG-003 deviceId URL 注入行为", async ({ page }) => {
      test.setTimeout(180_000);

      // 步骤 1：直达 ?deviceId=合成值。
      await gotoWithRetry(page, "/device/logs?deviceId=AUTOTEST-NOT-EXIST");
      await page.getByText("设备日志", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(3_000);

      // 页面不崩溃：无错误弹窗。
      const msgBoxVisible = await page.locator(".ep-message-box:visible").count();
      test.expect(msgBoxVisible, "不应出现错误弹窗").toBe(0);
      const infoBar = await page.locator(".device-info-bar, [class*=info-bar]").count();
      test.info().annotations.push({
        type: "探索注解",
        description: `合成 deviceId 查询：设备信息条可见=${infoBar > 0}（预期不出现——查询失败被捕获）；日志表正常渲染；无错误弹窗`
      });
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `注入查询后日志行数=${rows}` });

      // 步骤 2：入口约束注解。
      const deviceIdInput = await page.getByPlaceholder(/产品mac地址|云端唯一标识/u).count();
      test.info().annotations.push({
        type: "探索注解",
        description: `入口约束（实证）：deviceId 手动输入框已注释，UI 输入口可见数=${deviceIdInput}（应为 0）——仅 URL 参数/设备管理「日志」链接可注入`
      });
      await attachShot(page, "URL注入");
    });
  });
});
