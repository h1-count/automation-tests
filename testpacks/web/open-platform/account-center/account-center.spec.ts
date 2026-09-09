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
// 跨包登录态复用：优先本包，其次 console-home / create-product 维护的有效会话，失效时短信登录自愈。
const sharedAuthPaths = [
  join(packDirectory, "runtime", "auth-state.json"),
  join(packDirectory, "..", "console-home", "runtime", "auth-state.json"),
  join(packDirectory, "..", "create-product", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台账号中心", () => {
  // 报告证据：关键状态截图进入 HTML 报告附件区；截图限时 + 一次退避重试。
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

  test.beforeEach(async () => {
    await test.info().attach("功能包结论与已知差异.md", { path: join(packDirectory, "conclusion.md") });
  });

  async function gotoWithRetry(page: Page, path: string) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      console.log(`[重试] ${path} 导航 20s 未完成（疑似 dev server 卡顿窗口），重载一次`);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
  }

  // DialogTrigger 弹窗容器锚点（项目自有类，探索实证）；关闭一律点「取消」再等遮罩消失。
  const dialog = (page: Page) => page.locator(".dialog-triger-modal");
  async function closeDialog(page: Page) {
    const cancel = dialog(page).getByRole("button", { name: "取消", exact: true }).first();
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await dialog(page).waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
  }

  // 提示捕获（行为成立即通过 + 文案注解口径）：动作后收集页面上的校验/提示文本。
  async function collectNotices(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        const t = (n.textContent ?? "").trim();
        if (t && t.length <= 50 && /请输入|请选择|长度|不一致|必须|格式|不能|为空/u.test(t)) out.push(t);
        n = walker.nextNode();
      }
      return Array.from(new Set(out));
    });
  }
  function noteCopy(step: string, expectedList: string[], notices: string[]) {
    const hit = expectedList.filter((e) => notices.some((t) => t.includes(e)));
    if (hit.length === expectedList.length && expectedList.length > 0) {
      console.log(`[文案一致] ${step}：${notices.join("；")}`);
      return;
    }
    test.info().annotations.push({
      type: "文案差异",
      description: `${step}：预期提示「${expectedList.join("、")}」，实际页面提示「${notices.join("；") || "（未捕获）"}」`
    });
  }

  // 会话复用：按候选顺序注入 cookie 并直达账号管理页验证有效性。
  async function restoreSession(page: Page): Promise<boolean> {
    for (const candidate of sharedAuthPaths) {
      if (!existsSync(candidate)) continue;
      try {
        const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
        if (!state.cookies?.length) continue;
        await page.context().addCookies(state.cookies);
        await gotoWithRetry(page, "/console/account/info");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .locator(".account-content-right-form")
            .first()
            .waitFor({ state: "visible", timeout: 30_000 })
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

  test.describe("登录态就绪", () => {
    // 覆盖 OP-ACCT-001：账号管理页渲染与信息回显（no_write）。
    test("OP-ACCT-001 账号管理页渲染与信息回显", async ({ page }) => {
      test.setTimeout(360_000);

      // 前置：会话复用（本包 → console-home → create-product），失效时短信登录自愈。
      if (await restoreSession(page)) {
        test.info().annotations.push({
          type: "登录态复用",
          description: "检测到本地有效会话，跳过短信登录（不发送短信、无需人工点选验证码）"
        });
        await page.context().storageState({ path: authStatePath });
      } else {
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
        await gotoWithRetry(page, "/console/account/info");
        await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });
        await page.context().storageState({ path: authStatePath });
        console.log("[登录态] 短信登录成功，会话已保存到本包 runtime/auth-state.json");
      }

      // 步骤 1：页面标题「账号管理」，URL 正确。
      await expect(page).toHaveURL(/\/console\/account\/info/u);
      await expect(page.getByText("账号管理", { exact: true }).first()).toBeVisible();

      // 步骤 2+3：用户ID/姓名/手机号回显非空、禁用；手机号与 .env TEST_PHONE 一致。
      const inputs = page.locator(".account-content-right-form input");
      await expect(inputs.nth(0)).toBeDisabled();
      await expect(inputs.nth(0)).not.toHaveValue("");
      await expect(inputs.nth(1)).toBeDisabled();
      await expect(inputs.nth(1)).not.toHaveValue("");
      const testPhone = process.env.TEST_PHONE ?? "";
      await expect(inputs.nth(2)).toBeDisabled();
      if (testPhone) {
        await expect(inputs.nth(2)).toHaveValue(testPhone);
      } else {
        await expect(inputs.nth(2)).not.toHaveValue("");
      }

      // 步骤 4：账号密码字段非明文（掩码「********」）且禁用（探索实证 2026-09-03）。
      await expect(inputs.nth(3)).toBeDisabled();
      await expect(inputs.nth(3)).toHaveValue(/\*{2,}|^$/u);

      // 步骤 5：「更换手机」「更改密码」入口可见。
      await expect(page.getByRole("button", { name: "更换手机", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "更改密码", exact: true })).toBeVisible();
      await attachShot(page, "账号管理页回显");
    });
  });

  test.describe("账号管理页弹窗与所属企业", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-ACCT-002：更改密码弹窗打开与空提交拦截（no_write）。
    test("OP-ACCT-002 更改密码弹窗打开与空提交拦截", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/account/info");
      await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });

      // 步骤 1：打开弹窗（确认按钮文案「确定」——confirm-text=重置 未生效，实现差异候选）。
      await page.getByRole("button", { name: "更改密码", exact: true }).click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
      await expect(dialog(page).getByText("密码长度8~32位，含大写字母、小写字母、数字")).toBeVisible();
      await attachShot(page, "更改密码弹窗");

      // 步骤 2：手机号字段禁用且预填当前手机号。
      const phoneInput = dialog(page).locator("input").first();
      await expect(phoneInput).toBeDisabled();
      const testPhone = process.env.TEST_PHONE ?? "";
      if (testPhone) await expect(phoneInput).toHaveValue(testPhone);

      // 步骤 3：空提交出现必填类提示，弹窗不关闭。
      await dialog(page).getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      const notices = await collectNotices(page);
      expect(notices.some((t) => /请输入验证码/u.test(t)), "应出现验证码必填提示").toBeTruthy();
      expect(notices.some((t) => /请输入密码/u.test(t)), "应出现密码必填提示").toBeTruthy();
      noteCopy("空提交提示", ["请输入验证码", "请输入密码", "请输入重复密码"], notices);
      await expect(dialog(page)).toBeVisible();
      await attachShot(page, "更改密码弹窗空提交拦截");
      await closeDialog(page);
    });

    // 覆盖 OP-ACCT-003：新密码两次不一致与长度边界校验（no_write）。
    test("OP-ACCT-003 新密码两次不一致与长度边界校验", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/account/info");
      await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("button", { name: "更改密码", exact: true }).click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
      const pwInputs = dialog(page).locator("input[type='password']");
      await expect(pwInputs).toHaveCount(2);

      // 步骤 1：两次不一致 → 不一致提示。
      await pwInputs.nth(0).fill("Aa123456");
      await pwInputs.nth(0).press("Tab");
      await pwInputs.nth(1).fill("Aa1234567");
      await pwInputs.nth(1).press("Tab");
      await page.waitForTimeout(800);
      const mismatch = await collectNotices(page);
      expect(mismatch.some((t) => /不一致/u.test(t)), "应出现两次密码不一致提示").toBeTruthy();

      // 步骤 2：新密码 7 位 → 长度不足提示。
      await pwInputs.nth(0).fill("Aa12345");
      await pwInputs.nth(0).press("Tab");
      await page.waitForTimeout(800);
      const shortNotices = await collectNotices(page);
      expect(shortNotices.some((t) => /不能小于8|长度/u.test(t)), "应出现长度不足提示").toBeTruthy();

      // 步骤 3：两处填相同 8 位合法值 → 长度与一致性提示消失。
      await pwInputs.nth(0).fill("Aa123456");
      await pwInputs.nth(0).press("Tab");
      await pwInputs.nth(1).fill("Aa123456");
      await pwInputs.nth(1).press("Tab");
      await page.waitForTimeout(800);
      const validNotices = await collectNotices(page);
      expect(validNotices.some((t) => /不一致/u.test(t)), "一致后不应再出现不一致提示").toBeFalsy();
      expect(validNotices.some((t) => /小于8/u.test(t)), "合法长度后不应再出现长度提示").toBeFalsy();

      // 步骤 4：33 位输入被截断为 32 位。
      await pwInputs.nth(0).fill("Aa1234567890Aa1234567890Aa1234567890");
      expect((await pwInputs.nth(0).inputValue()).length, "超长输入应截断为 32 位").toBe(32);
      await attachShot(page, "新密码边界校验");
      await closeDialog(page);
    });

    // 覆盖 OP-ACCT-004：更换手机弹窗空提交拦截与手机号长度截断（no_write；不点击获取验证码）。
    test("OP-ACCT-004 更换手机弹窗空提交拦截与手机号长度截断", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/account/info");
      await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });

      // 步骤 1：打开弹窗。
      await page.getByRole("button", { name: "更换手机", exact: true }).click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });

      // 步骤 2：空提交拦截（实测为 API 前置校验文案「手机号和密码不能都为空」，实现差异候选）。
      await dialog(page).getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_200);
      const notices = await collectNotices(page);
      expect(notices.some((t) => /不能都为空|请输入手机号|请输入验证码/u.test(t)), "应出现空值拦截提示").toBeTruthy();
      noteCopy("换手机空提交提示", ["手机号和密码不能都为空"], notices);
      await expect(dialog(page)).toBeVisible();
      await attachShot(page, "更换手机弹窗空提交拦截");

      // 步骤 3：新手机号 13 位输入截断为 11 位。
      const phoneInput = dialog(page).locator("input").first();
      await phoneInput.fill("13000000000123");
      expect((await phoneInput.inputValue()).length, "新手机号应截断为 11 位").toBe(11);
      await attachShot(page, "新手机号11位截断");
      await closeDialog(page);
    });

    // 覆盖 OP-ACCT-005：更改密码成功路径（幂等重设为 .env 当前 TEST_PASSWORD；写入用例，人工协助点选验证码）。
    test("OP-ACCT-005 更改密码成功路径（幂等重设）", async ({ page }) => {
      test.setTimeout(360_000);
      const testPhone = process.env.TEST_PHONE;
      const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
      const testPassword = process.env.TEST_PASSWORD;
      if (!testPhone || !testVerificationCode || !testPassword) {
        throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE / TEST_PASSWORD 环境变量");
      }

      await gotoWithRetry(page, "/console/account/info");
      await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });

      // 步骤 1：打开更改密码弹窗（手机号已预填当前手机号）。
      await page.getByRole("button", { name: "更改密码", exact: true }).click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
      const phoneInput = dialog(page).locator("input").first();
      await expect(phoneInput).toBeDisabled();
      await expect(phoneInput).toHaveValue(testPhone);

      // 步骤 2：请求验证码（人工点选图形验证码；倒计时出现=发送成功）。
      const sendBtn = dialog(page).getByRole("button", { name: "获取验证码", exact: true }).first();
      await expect(sendBtn).toBeEnabled();
      console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
      await sendBtn.click();
      await waitForSmsCountdownOrReject(page);

      // 步骤 3：填写固定测试验证码。
      const codeInput = dialog(page).getByPlaceholder("请输入验证码");
      await codeInput.fill(testVerificationCode);

      // 步骤 4：填写新密码与重复新密码（合成值 = .env 当前 TEST_PASSWORD，幂等）。
      const pwInputs = dialog(page).locator("input[type='password']");
      await pwInputs.nth(0).fill(testPassword);
      await pwInputs.nth(1).fill(testPassword);
      await attachShot(page, "更改密码表单已填写");

      // 步骤 5：提交 → 成功提示（实际文案以行为断言 + 注解记录），弹窗关闭。
      await dialog(page).getByRole("button", { name: "确定", exact: true }).click();
      await expect(page.locator('[role="alert"], .ep-message, .el-message').first()).toBeVisible({ timeout: 20_000 });
      const successText = (await page.locator('[role="alert"], .ep-message, .el-message').first().innerText().catch(() => "")).trim();
      if (/重置成功/u.test(successText)) {
        console.log(`[文案一致] 密码重置成功提示：${successText}`);
      } else {
        test.info().annotations.push({
          type: "文案差异",
          description: `预期「密码重置成功」，实际提示「${successText || "（未捕获）"}」`
        });
      }
      await attachShot(page, "密码重置成功提示");

      // 步骤 6：刷新页面，登录态未失效（改密码成功不强制登出）。
      await gotoWithRetry(page, "/console/account/info");
      await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });
      await expect(page).toHaveURL(/\/console\/account\/info/u);
      await attachShot(page, "改密码后登录态仍有效");
      test.info().annotations.push({
        type: "写入台账说明",
        description: "本用例写入为幂等重设：账号密码变更为 .env 当前 TEST_PASSWORD 值（合成值，仅本地），不改变 TEST_PHONE 凭据链与既有登录态"
      });
    });

    // 覆盖 OP-ACCT-006：所属企业列表回显与管理员行操作列（no_write）。
    test("OP-ACCT-006 所属企业列表回显与管理员行操作列", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/account/company");
      const rows = page.locator("table").nth(1).getByRole("row");
      await rows.first().waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(1_000);

      // 步骤 1：页面标题「所属企业」。
      await expect(page.getByText("所属企业", { exact: true }).first()).toBeVisible();

      // 步骤 2：2 行企业数据（探索实证 2026-09-03：两家企业）。
      const dataRows = page.locator("table").nth(1).locator("tbody tr");
      await expect(dataRows).toHaveCount(2);

      // 步骤 3：企业权限列显示「管理员」。
      const firstRow = dataRows.first();
      await expect(firstRow).toContainText("管理员");

      // 步骤 4：管理员行操作列仅「转移管理权限」，无「退出企业」链接。
      await expect(page.getByText("转移管理权限", { exact: true })).toHaveCount(2);
      await expect(page.getByText("退出企业", { exact: true })).toHaveCount(0);
      await attachShot(page, "所属企业列表-管理员行");
    });

    // 覆盖 OP-ACCT-007：转移管理权限弹窗空目标拦截（no_write；不执行真实转移）。
    test("OP-ACCT-007 转移管理权限弹窗空目标拦截", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/account/company");
      const rows = page.locator("table").nth(1).locator("tbody tr");
      await rows.first().waitFor({ state: "visible", timeout: 30_000 });

      // 步骤 1：点击首行「转移管理权限」（ep-link 文本链接，无 link role，按文本定位）。
      await page.getByText("转移管理权限", { exact: true }).first().click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
      await expect(dialog(page).getByText("转移给")).toBeVisible();
      await attachShot(page, "转移管理权限弹窗");

      // 步骤 2：展开下拉无可选成员（单人企业，目标查询仅成员角色；探索实证 0 项）。
      await dialog(page).locator(".ep-select, .el-select").first().click();
      await page.waitForTimeout(1_200);
      expect(await page.getByRole("option").count(), "转移目标下拉应无可选成员").toBe(0);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // 步骤 3：空目标确认 → 必填拦截（字段提示 + 错误浮层双形态），无转移成功提示。
      await dialog(page).getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      const notices = await collectNotices(page);
      expect(notices.some((t) => /请选择转移接收成员|请选择接收成员/u.test(t)), "应出现转移目标必填拦截提示").toBeTruthy();
      await attachShot(page, "转移空目标拦截");

      // 步骤 4：关闭弹窗，列表不变（仍 2 行、入口仍在）。
      await closeDialog(page);
      await expect(page.locator("table").nth(1).locator("tbody tr")).toHaveCount(2);
      await expect(page.getByText("转移管理权限", { exact: true })).toHaveCount(2);
    });

    // 覆盖用例 OP-ACCT-008：成员行退出企业入口与二次确认（no_write）。
    // 待确认：需「成员」角色的测试账号——用户指示通过成员管理添加成员构造（enterprise-center 包写入用例）；
    // 该成员账号就绪后本用例转正执行；当前以 fixme 保留覆盖意图。
    test.fixme("OP-ACCT-008 成员行退出企业入口与二次确认", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/account/company");
      const rows = page.locator("table").nth(1).locator("tbody tr");
      await rows.first().waitFor({ state: "visible", timeout: 30_000 });

      // 步骤 1：成员行操作列显示「退出企业」、无转移入口。
      const memberRow = rows.filter({ hasText: "成员" }).first();
      await expect(memberRow).toBeVisible();
      await expect(memberRow.getByText("退出企业", { exact: true })).toBeVisible();
      await expect(memberRow.getByText("转移管理权限", { exact: true })).toHaveCount(0);

      // 步骤 2：点击「退出企业」出现二次确认弹窗。
      await memberRow.getByText("退出企业", { exact: true }).click();
      await expect(page.getByText("退出后将不再拥有该企业的相关权限，是否继续？")).toBeVisible({ timeout: 10_000 });
      await attachShot(page, "退出企业二次确认");

      // 步骤 3：取消确认，弹窗关闭，未退出。
      await page.getByRole("button", { name: "取消", exact: true }).first().click();
      await expect(page.getByText("退出后将不再拥有该企业的相关权限，是否继续？")).not.toBeVisible();
    });

    // 覆盖 OP-ACCT-009：账号中心页侧边菜单组过滤（no_write）。
    test("OP-ACCT-009 账号中心页侧边菜单组过滤", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/account/info");
      await page.locator(".account-content-right-form").first().waitFor({ state: "visible", timeout: 30_000 });

      // 步骤 1：侧边仅显示账号管理组菜单（账号信息/所属企业），不出现企业中心组/控制台根菜单。
      const sideNav = page.locator(".app-sidenav");
      await expect(sideNav).toBeVisible();
      await expect(sideNav.getByText("账号信息", { exact: true })).toBeVisible();
      await expect(sideNav.getByText("所属企业", { exact: true })).toBeVisible();
      // 探索实证：开发演示菜单组「UI组件示例<开发>」与账号管理组并列展示（缺陷候选，2026-09-03 注解记录）。
      const devMenuVisible = await sideNav.getByText("UI组件示例<开发>", { exact: true }).isVisible().catch(() => false);
      if (devMenuVisible) {
        test.info().annotations.push({
          type: "缺陷候选",
          description: "侧边导航出现开发演示菜单组「UI组件示例<开发>」（列表查询示例/标签选择组件演示/Mock服务示例/Apifox 文档渲染），建议确认测试环境导航是否应展示开发示例菜单"
        });
      }
      await attachShot(page, "账号页侧边菜单");

      // 步骤 2：进入所属企业页，账号管理组保持、当前页高亮。
      await sideNav.getByText("所属企业", { exact: true }).click();
      await expect(page).toHaveURL(/\/console\/account\/company/u, { timeout: 20_000 });
      await expect(page.locator(".app-sidenav").getByText("所属企业", { exact: true })).toBeVisible();
      await attachShot(page, "所属企业页菜单保持");
    });
  });
});
