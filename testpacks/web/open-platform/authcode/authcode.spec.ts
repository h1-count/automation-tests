import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { recordGeneratedAuthCodeApply } from "../../../../src/support/recordGeneratedData";

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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台授权码", () => {
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

  async function gotoAuthcode(page: Page) {
    await gotoWithRetry(page, "/integration/authcode");
    await page.getByRole("button", { name: "新增授权码", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_500);
  }

  /** 统计卡数值：定位零子元素文本恰好为 label 的节点，向上回溯最多 4 层取第一个数字。 */
  async function statValue(page: Page, label: string): Promise<number | null> {
    const raw = await page.evaluate((lbl) => {
      const els = Array.from(document.querySelectorAll("*")).filter(
        (e) => e.childElementCount === 0 && (e.textContent ?? "").trim() === lbl
      );
      for (const el of els) {
        let cur: HTMLElement | null = el as HTMLElement;
        for (let i = 0; i < 4 && cur; i += 1) {
          cur = cur.parentElement;
          if (!cur) break;
          const m = (cur.innerText ?? "").replace(lbl, "").match(/\d+/);
          if (m) return m[0];
        }
      }
      return null;
    }, label);
    return raw === null ? null : Number(raw);
  }

  /** 切换到指定 tab（设备接入授权码 / 授权码申请进程；实现为 el-radio-button，原生 input 隐藏需点可见 label）。 */
  async function switchTab(page: Page, name: string) {
    const btn = page.locator(".ep-radio-button").filter({ hasText: name }).first();
    await btn.click();
    await page.waitForTimeout(1_500);
  }

  async function tableHeaderTexts(page: Page): Promise<string> {
    const header = page.locator(".ep-table__header:visible").last();
    await header.waitFor({ state: "visible", timeout: 20_000 });
    return header.innerText();
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-AUTH-001：授权码总览页渲染与统计卡（no_write）。
    test("OP-AUTH-001 授权码总览页渲染与统计卡", async ({ page }) => {
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
      await gotoAuthcode(page);
      await expect(page.getByText("授权码总览", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/协议直连接入、云云接入/u).first()).toBeVisible();

      // 步骤 2：三张统计卡。
      for (const label of ["授权码总量", "已使用授权码", "未分配授权码"]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
        const v = await statValue(page, label);
        test.expect(v, `${label} 应为数值`).not.toBeNull();
        test.info().annotations.push({ type: "探索注解", description: `${label}=${v}` });
      }

      // 步骤 3：工具栏。
      await expect(page.locator(".ep-radio-button").filter({ hasText: "设备接入授权码" }).first()).toBeVisible();
      await expect(page.locator(".ep-radio-button").filter({ hasText: "授权码申请进程" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "新增授权码", exact: true }).first()).toBeVisible();
      await attachShot(page, "授权码总览");
    });
  });

  test.describe("授权码表与申请", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-AUTH-002：双 tab 切换与表结构（no_write）。
    test("OP-AUTH-002 双 tab 切换与表结构", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoAuthcode(page);

      // 步骤 1：默认 tab（设备接入授权码）。
      const h1 = await tableHeaderTexts(page);
      for (const col of ["产品名称", "Model", "已分配数量"]) {
        test.expect(h1, `默认 tab 表头应含 ${col}`).toContain(col);
      }
      const rows1 = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `设备接入授权码行数=${rows1}（台账产品预计无分配记录）` });

      // 步骤 2：切换授权码申请进程。
      await switchTab(page, "授权码申请进程");
      const h2 = await tableHeaderTexts(page);
      for (const col of ["授权码数量", "申请人", "联系方式", "申请时间", "发放状态", "发放时间"]) {
        test.expect(h2, `申请进程表头应含 ${col}`).toContain(col);
      }
      const processRows = page.locator(".ep-table__body:visible").last().locator("tbody tr");
      const rows2 = await processRows.count();
      const issued = await page.locator(".ep-tag--success").count();
      const pending = await page.locator(".ep-tag--warning").count();
      test.info().annotations.push({ type: "探索注解", description: `申请进程行数=${rows2}，已发放 tag=${issued}，未发放 tag=${pending}` });

      // 步骤 3：切回。
      await switchTab(page, "设备接入授权码");
      const h3 = await tableHeaderTexts(page);
      test.expect(h3, "切回后表头恢复").toContain("产品名称");
      await attachShot(page, "双tab表结构");
    });

    // 覆盖 OP-AUTH-003：申请弹窗结构与预填核对（no_write）。
    test("OP-AUTH-003 申请弹窗结构与预填核对", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoAuthcode(page);
      const before = await statValue(page, "授权码总量");

      // 步骤 1：打开弹窗核对结构与预填。
      await page.getByRole("button", { name: "新增授权码", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_200);
      await expect(dlg).toContainText("企业名称");
      const proposer = await dlg.getByRole("textbox", { name: "申请人" }).inputValue().catch(() => "");
      const mobile = await dlg.getByRole("textbox", { name: "联系方式" }).inputValue().catch(() => "");
      test.expect((proposer || "").length, "申请人应预填").toBeGreaterThan(0);
      test.expect((mobile || "").replace(/\D/g, "").length, "联系方式应预填 11 位").toBe(11);
      const numValue = await dlg.locator(".ep-input-number input").inputValue().catch(() => "");
      test.expect(numValue, "数量默认 10").toBe("10");
      await attachShot(page, "授权码弹窗预填");

      // 步骤 2：取消关闭，统计不变。
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForTimeout(1_000);
      await expect(dlg).toBeHidden();
      const after = await statValue(page, "授权码总量");
      test.expect(after, "统计卡数值不变").toBe(before);
    });

    // 覆盖 OP-AUTH-004：申请表单字段校验（no_write，表单前置校验模式）。
    test("OP-AUTH-004 申请表单字段校验", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoAuthcode(page);
      await page.getByRole("button", { name: "新增授权码", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_200);

      // 字段级作用域取错误（与采购包同源规则；校验异步出现，轮询等待）。
      const errInField = async (label: string) => {
        const item = dlg.locator(".ep-form-item").filter({ hasText: label }).first();
        let found = "";
        await test.expect
          .poll(
            async () => {
              found = await item
                .locator(".ep-form-item__error")
                .first()
                .innerText()
                .catch(() => "");
              return found ? "y" : "n";
            },
            { timeout: 5_000, message: `字段错误(${label})应出现` }
          )
          .toBe("y");
        return found;
      };
      const proposer = dlg.getByRole("textbox", { name: "申请人" });
      const mobile = dlg.getByRole("textbox", { name: "联系方式" });
      const numInput = dlg.locator(".ep-input-number input");

      // D01 清空申请人 → 必填。
      await proposer.fill("");
      await proposer.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("申请人")).toContain("申请人");
      // D02 申请人非法字符。
      await proposer.fill("test_user!@#");
      await proposer.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("申请人")).toContain("申请人");
      // D03 联系方式 10 位。
      await mobile.fill("1300000000");
      await mobile.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("联系方式")).toContain("手机");
      // D04 联系方式 12 位 → maxlength=11 截断。
      await mobile.fill("130000000000");
      const d04 = await mobile.inputValue();
      test.expect(d04.replace(/\D/g, "").length, "maxlength=11 应截断 12 位输入").toBe(11);
      test.info().annotations.push({ type: "探索注解", description: `D04 12 位被截断为 ${d04.length} 位（截断后合法则无提示）` });
      // D05 数量 0 → 钳制回 1。
      await numInput.fill("0");
      await numInput.press("Tab").catch(() => {});
      await page.waitForTimeout(600);
      const v5 = await numInput.inputValue();
      test.info().annotations.push({ type: "探索注解", description: `数量输入 0 后实际值=${v5}（应钳制回 1）` });
      test.expect(Number(v5)).toBeGreaterThanOrEqual(1);
      // D06 恢复合法值 → 错误清空（不提交）。
      await proposer.fill("自动化测试");
      await proposer.press("Tab");
      await mobile.fill("13000000000");
      await mobile.press("Tab");
      await numInput.fill("10");
      await numInput.press("Tab").catch(() => {});
      await page.waitForTimeout(1_200);
      const restErrs = await dlg.locator(".ep-form-item__error").count();
      test.expect(restErrs, "恢复合法值后字段错误应清空").toBe(0);
      test.info().annotations.push({ type: "探索注解", description: "OP-AUTH-004 全程未点击提交（表单前置校验模式）" });
      await attachShot(page, "授权码表单校验");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });

    // 覆盖 OP-AUTH-005：提交授权码申请（写入台账，幂等）。
    test("OP-AUTH-005 提交授权码申请", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoAuthcode(page);
      const runId = Date.now();

      // 步骤 1：基线（统计卡 + 申请进程现状）。
      const baselineTotal = await statValue(page, "授权码总量");
      const baselineUnassigned = await statValue(page, "未分配授权码");
      await switchTab(page, "授权码申请进程");
      const body = page.locator(".ep-table__body:visible").last();
      const processRows = body.locator("tbody tr");
      const rowsBefore = await processRows.count();
      const pendingBefore = await body.locator(".ep-tag--warning").count();
      test.info().annotations.push({
        type: "探索注解",
        description: `基线：总量=${baselineTotal}，未分配=${baselineUnassigned}，申请行=${rowsBefore}，未发放=${pendingBefore}`
      });

      // 幂等：已存在「数量=1 且 未发放」记录 → 只验证不重复提交。
      let existingPendingRow = null;
      for (let i = 0; i < rowsBefore; i += 1) {
        const row = processRows.nth(i);
        const txt = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
        if (/^1 /.test(txt.trim()) && txt.includes("未发放")) {
          existingPendingRow = txt;
          break;
        }
      }

      if (existingPendingRow) {
        test.info().annotations.push({
          type: "幂等跳过",
          description: `已存在数量=1 且未发放的申请行，不重复提交；行内容（实证）=${existingPendingRow.slice(0, 120)}`
        });
        await expect(processRows.first()).toBeVisible();
        return;
      }

      // 步骤 2：数量=1 提交。
      await switchTab(page, "设备接入授权码");
      await page.getByRole("button", { name: "新增授权码", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_200);
      const applicant = await dlg.getByRole("textbox", { name: "申请人" }).inputValue();
      const contactMobile = await dlg.getByRole("textbox", { name: "联系方式" }).inputValue();
      const numInput = dlg.locator(".ep-input-number input");
      await numInput.fill("1");
      await numInput.press("Tab").catch(() => {});
      await page.waitForTimeout(400);
      await dlg.getByRole("button", { name: "确定", exact: true }).click();

      // alert 对话框（alert util：ElMessageBox 风格）。
      const msgBox = page.locator(".ep-message-box:visible");
      await msgBox.waitFor({ state: "visible", timeout: 15_000 });
      await expect(msgBox).toContainText("授权码申请已成功提交");
      await msgBox.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      await expect(dlg).toBeHidden();

      // 台账记录（只增不删）。
      await recordGeneratedAuthCodeApply({
        runId,
        applicant,
        contactMobile,
        quantity: 1,
        appliedAt: new Date().toISOString()
      });
      test.info().annotations.push({ type: "写入台账", description: `open-platform-authcode-apply runId=${runId} 数量=1 申请人=${applicant}` });

      // 步骤 3：申请进程新行。
      await switchTab(page, "授权码申请进程");
      const bodyAfter = page.locator(".ep-table__body:visible").last();
      await expect(bodyAfter).toBeVisible();
      const rowsAfter = await bodyAfter.locator("tbody tr").count();
      test.expect(rowsAfter, "申请进程应新增一行").toBe(rowsBefore + 1);
      const pendingAfter = await bodyAfter.locator(".ep-tag--warning").count();
      test.expect(pendingAfter, "未发放数量 +1").toBe(pendingBefore + 1);

      // 步骤 4：统计卡刷新（差值实证注解）。
      const afterTotal = await statValue(page, "授权码总量");
      const afterUnassigned = await statValue(page, "未分配授权码");
      test.info().annotations.push({
        type: "探索注解",
        description: `提交后：总量 ${baselineTotal}→${afterTotal}，未分配 ${baselineUnassigned}→${afterUnassigned}（申请未发放时统计是否变化以实证为准）`
      });
      await attachShot(page, "授权码申请提交后");
    });
  });
});
