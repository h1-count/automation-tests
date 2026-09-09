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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

/** 监听采购提交请求（POST /product/module/purchase，结尾锚定以排除 list 查询），返回读取函数。 */
function watchPurchaseSubmit(page: Page) {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/product\/module\/purchase(\?.*)?$/.test(r.url())) {
      hits.push(r.url());
    }
  });
  return () => hits.length;
}

test.describe("开放平台采购管理", () => {
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
        await gotoWithRetry(page, "/integration/procurement");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByRole("button", { name: "新增采购", exact: true })
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

  async function gotoProcurement(page: Page) {
    await gotoWithRetry(page, "/integration/procurement");
    await page.getByRole("button", { name: "新增采购", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_500);
  }

  async function openApplyDialog(page: Page) {
    await page.getByRole("button", { name: "新增采购", exact: true }).first().click();
    const dlg = page.locator(".dialog-triger-modal:visible").last();
    await dlg.waitFor({ state: "visible", timeout: 20_000 });
    await dlg.getByText("模组采购申请").first().waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(1_000);
    return dlg;
  }

  /** 表单字段错误提示（.ep-form-item__error 文本集合）。 */
  async function fieldErrors(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll(".ep-form-item__error"))
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => (e.textContent ?? "").trim())
    );
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PROC-001：采购管理页渲染（no_write）。
    test("OP-PROC-001 采购管理页渲染", async ({ page }) => {
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

      // 步骤 1：进入采购管理页。
      await gotoProcurement(page);
      await expect(page.url()).toContain("/procurement");

      // 步骤 2：搜索区。
      const main = page.locator("main");
      await expect(main.getByPlaceholder("产品名称/Model")).toBeVisible();

      // 步骤 3：列表表头 + 空态/数据。
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["采购类型", "Model", "开发方式", "模组类型", "模组型号", "模组套数", "申请时间", "采购状态", "申请人", "快递单号", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      const empty = await page.getByText("暂无数据").isVisible().catch(() => false);
      test.info().annotations.push({ type: "探索注解", description: `采购列表行数=${rows}，空态可见=${empty}` });
      await attachShot(page, "采购管理页");
    });
  });

  test.describe("采购列表与申请", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PROC-002：搜索筛选交互（no_write）。
    test("OP-PROC-002 搜索筛选交互", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoProcurement(page);

      // 步骤 1：采购类型下拉。
      const searchForm = page.locator(".search-form, form").first();
      const selects = page.locator("main .ep-select");
      const selCount = await selects.count();
      test.expect(selCount, "搜索区应有 2 个下拉").toBeGreaterThanOrEqual(2);
      await selects.nth(0).click();
      await page.waitForTimeout(1_000);
      const typeOpts = await page.locator(".ep-select-dropdown:visible .ep-select-dropdown__item").allInnerTexts();
      test.info().annotations.push({ type: "探索注解", description: `采购类型选项（实证）：${typeOpts.join(" | ")}` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // 步骤 2：采购状态下拉。
      await selects.nth(1).click();
      await page.waitForTimeout(1_000);
      const statusOpts = await page.locator(".ep-select-dropdown:visible .ep-select-dropdown__item").allInnerTexts();
      test.info().annotations.push({ type: "探索注解", description: `采购状态选项（实证）：${statusOpts.join(" | ")}` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // 步骤 3：输入 Model 筛选。
      const searchInput = page.getByPlaceholder("产品名称/Model");
      await searchInput.fill("at0635.light.at8438");
      await page.waitForTimeout(1_500);
      const rowsAfter = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `筛选后行数=${rowsAfter}（空列表无报错）` });
      await attachShot(page, "搜索筛选");
    });

    // 覆盖 OP-PROC-003：弹窗结构与预填核对（no_write）。
    test("OP-PROC-003 弹窗结构与预填核对", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoProcurement(page);

      // 步骤 1：打开弹窗核对结构与预填。
      const dlg = await openApplyDialog(page);
      await expect(dlg).toContainText("模组采购申请");
      await expect(dlg).toContainText("申请企业");
      const proposer = await dlg.getByRole("textbox", { name: "申请人" }).inputValue().catch(() => "");
      const mobile = await dlg.getByRole("textbox", { name: "手机号" }).inputValue().catch(() => "");
      test.expect((proposer || "").length, "申请人应预填").toBeGreaterThan(0);
      test.expect((mobile || "").length, "手机号应预填").toBeGreaterThan(0);
      await expect(dlg).toContainText("采购类型");
      const numValue = await dlg.locator(".ep-input-number input").inputValue().catch(() => "");
      test.expect(numValue, "采购套数默认 1").toBe("1");
      await attachShot(page, "采购弹窗预填");

      // 步骤 2：取消关闭。
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForTimeout(1_000);
      await expect(dlg).toBeHidden();
    });

    // 覆盖 OP-PROC-004：空表单提交拦截（no_write，客户端校验）。
    test("OP-PROC-004 空表单提交拦截", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoProcurement(page);
      const submitted = watchPurchaseSubmit(page);

      // 步骤 1：清空预填。
      const dlg = await openApplyDialog(page);
      await dlg.getByRole("textbox", { name: "申请人" }).fill("");
      await dlg.getByRole("textbox", { name: "手机号" }).fill("");

      // 步骤 2：直接确定 → 拦截。
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      await expect(dlg).toBeVisible();
      const errs = await fieldErrors(page);
      test.expect(errs.length, "应出现多条字段级提示").toBeGreaterThanOrEqual(3);
      test.info().annotations.push({ type: "探索注解", description: `空表单提交字段提示（实证）：${errs.join(" | ").slice(0, 150)}` });
      test.expect(submitted(), "不应发出采购提交请求").toBe(0);
      await attachShot(page, "空表单拦截");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });

    // 覆盖 OP-PROC-005：逐字段非法值校验（no_write）。
    test("OP-PROC-005 逐字段非法值校验", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoProcurement(page);
      const dlg = await openApplyDialog(page);
      const proposer = dlg.getByRole("textbox", { name: "申请人" });
      const mobile = dlg.getByRole("textbox", { name: "手机号" });
      const email = dlg.getByRole("textbox", { name: "邮箱" });
      const address = dlg.getByRole("textbox", { name: "收货地址" });
      const notes = dlg.locator("textarea");

      const blur = async (loc: ReturnType<Page["locator"]>) => {
        await loc.press("Tab").catch(async () => {
          await dlg.getByText("申请企业").click();
        });
        await page.waitForTimeout(900);
      };
      // 字段级作用域取错误（其他字段的旧错误文本可能含相同关键字，如邮箱地址⊃地址，全局过滤会误匹配）。
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
      const noErrInField = async (label: string) => {
        const item = dlg.locator(".ep-form-item").filter({ hasText: label }).first();
        await page.waitForTimeout(900);
        return await item.locator(".ep-form-item__error").count();
      };

      // D01 申请人 1 字（实证：无长度校验，应无提示——疑似缺陷注解）。
      await proposer.fill("测");
      await blur(proposer);
      await page.waitForTimeout(400);
      const d01Err = (await fieldErrors(page)).filter((e) => e.includes("申请人"));
      test.expect(d01Err.length, "申请人 1 字不应有长度提示（无长度校验）").toBe(0);
      test.info().annotations.push({ type: "探索注解", description: "D01 实证：申请人填 1 字无提示——前端无长度校验（realname 仅字符集），疑似缺陷" });
      // D02 申请人 33 字（maxlength=32 对脚本直写不截断，注解实际行为）。
      await proposer.fill("测".repeat(33));
      await blur(proposer);
      const d02 = await proposer.inputValue();
      test.expect(d02.length, "maxlength=32 应截断为 32 字").toBe(32);
      // D03 申请人非法字符。
      await proposer.fill("test_user!@#");
      await blur(proposer);
      test.expect(await errInField("申请人")).toContain("申请人");
      // D04 手机号 10 位 / 12 位（先把申请人恢复合法，避免残留错误干扰 errFor 匹配——errFor 已按关键字过滤，此处仅规整表单）。
      await mobile.fill("1300000000");
      await blur(mobile);
      test.expect(await errInField("手机号")).toContain("手机");
      await mobile.fill("130000000000");
      const d04b = await mobile.inputValue();
      test.expect(d04b.length, "maxlength=11 应截断 12 位输入").toBe(11);
      test.info().annotations.push({ type: "探索注解", description: `D04 12 位被截断为 ${d04b.length} 位（若截断后合法则无提示）` });
      // D05 邮箱非法格式。
      await email.fill("abc@");
      await blur(email);
      test.expect(await errInField("邮箱")).toContain("邮箱");
      // D06 收货地址 8 字合法（正例：无提示；地址仅字符集校验无长度校验）。
      await address.fill("地址地址地址地址");
      await blur(address);
      await page.waitForTimeout(400);
      test.expect(await noErrInField("收货地址"), "8 字合法地址不应有提示").toBe(0);
      // D07 收货地址含不支持字符。
      await address.fill("地址!@#$%");
      await blur(address);
      test.expect(await errInField("收货地址")).toContain("地址");
      // D08 备注 4 字。
      await notes.fill("备注备注");
      await blur(notes);
      test.expect(await errInField("备注")).toContain("备注");
      // 提交按钮不点击（表单非法，无网络写入）。
      test.info().annotations.push({ type: "探索注解", description: "OP-PROC-005 全程未点击提交（表单前置校验模式）" });
      await attachShot(page, "字段校验");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });

    // 覆盖 OP-PROC-006：采购套数边界值（no_write）。
    test("OP-PROC-006 采购套数边界值", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoProcurement(page);
      const dlg = await openApplyDialog(page);
      const numInput = dlg.locator(".ep-input-number input");

      // D01 输入 0 → 钳制回 1。
      await numInput.fill("0");
      await numInput.press("Tab").catch(() => {});
      await page.waitForTimeout(600);
      const v1 = await numInput.inputValue();
      test.info().annotations.push({ type: "探索注解", description: `输入 0 后实际值=${v1}（应钳制回 1）` });
      test.expect(Number(v1)).toBeGreaterThanOrEqual(1);
      // D02 上边界 999999。
      await numInput.fill("999999");
      await numInput.press("Tab").catch(() => {});
      await page.waitForTimeout(600);
      test.expect(Number(await numInput.inputValue())).toBe(999999);
      // D03 超界 1000000。
      await numInput.fill("1000000");
      await numInput.press("Tab").catch(() => {});
      await page.waitForTimeout(600);
      const v3 = await numInput.inputValue();
      test.info().annotations.push({ type: "探索注解", description: `输入 1000000 后实际值=${v3}（应钳制回 999999）` });
      test.expect(Number(v3)).toBeLessThanOrEqual(999999);
      // D04 步进按钮。
      await numInput.fill("1");
      await page.waitForTimeout(300);
      const dec = dlg.locator(".ep-input-number__decrease");
      await dec.click();
      await page.waitForTimeout(400);
      test.expect(Number(await numInput.inputValue()), "下界 1 以下不再减").toBe(1);
      await numInput.fill("999999");
      await page.waitForTimeout(300);
      const inc = dlg.locator(".ep-input-number__increase");
      await inc.click();
      await page.waitForTimeout(400);
      test.expect(Number(await numInput.inputValue()), "上界 999999 以上不再加").toBe(999999);
      await attachShot(page, "套数边界");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });

    // 覆盖 OP-PROC-007：direct 产品模组缺失提交拦截（no_write）。
    test("OP-PROC-007 direct 产品模组缺失提交拦截", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoProcurement(page);
      const submitted = watchPurchaseSubmit(page);
      const dlg = await openApplyDialog(page);

      // 步骤 1：选台账 direct 产品。
      const prodGroup = dlg.locator(".ep-form-item").filter({ hasText: "产品" }).first();
      await prodGroup.locator(".ep-select__placeholder").click();
      await page.waitForTimeout(1_200);
      const opts = page.locator(".ep-select-dropdown:visible .ep-select-dropdown__item");
      const optCount = await opts.count();
      let pick = -1;
      for (let i = 0; i < optCount; i += 1) {
        if ((await opts.nth(i).innerText()).includes("自动化测试产品1788420748438")) pick = i;
      }
      test.expect(pick, "产品下拉应含台账产品").toBeGreaterThanOrEqual(0);
      await opts.nth(pick).click();
      await page.waitForTimeout(2_500);
      await expect(dlg).toContainText("未查询到可用的模组信息");

      // 步骤 2：填合法值后确定 → 模组必选拦截。
      await dlg.getByRole("textbox", { name: "收货地址" }).fill("江苏省无锡市自动化测试收货地址");
      const typeGroup = dlg.locator(".ep-form-item").filter({ hasText: "采购类型" }).first();
      await typeGroup.locator(".ep-radio").first().click();
      await page.waitForTimeout(400);
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      await expect(dlg).toBeVisible();
      const errs = await fieldErrors(page);
      const moduleErr = errs.filter((e) => /模组/.test(e));
      test.expect(moduleErr.length, "模组类型/型号应出现必选提示").toBeGreaterThanOrEqual(1);
      test.info().annotations.push({ type: "探索注解", description: `模组缺失拦截提示（实证）：${moduleErr.join(" | ")}` });
      test.expect(submitted(), "不应发出采购提交请求").toBe(0);
      await attachShot(page, "direct模组拦截");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });
  });
});
