import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能测试包。");
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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

type ProductRecord = { runId: number; productName: string; productModel: string; assignedProductModel?: string };
type TestingBookingRecord = {
  runId: number; productName: string; productModel: string;
  testType: string; proposer: string; reservationTime: string; createdAt: string;
};

async function readCreateProductLedger(): Promise<ProductRecord[]> {
  // packDirectory 已在模块顶层校验非空（函数声明不继承顶层收窄，此处显式断言）。
  const ledgerPath = join(packDirectory!, "..", "create-product", "runtime", "generated-data.json");
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as { records?: ProductRecord[] };
    return (parsed.records ?? []).filter((r) => r.productName && r.assignedProductModel);
  } catch {
    return [];
  }
}

test.describe("开放平台产品测试", () => {
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
        await gotoWithRetry(page, "/integration/product/management");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .locator(".product-center")
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

  /** 从列表进入台账最新产品的 /testing 页（继续开发先落 basic；子页 chunk 首访有冷编译）。 */
  async function gotoTesting(page: Page, latest: ProductRecord) {
    await gotoWithRetry(page, `/integration/product/management`);
    await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByText(/继续开发|开发详情/u).click();
    await page.waitForURL(/\/integration\/product\/\d+\/basic/u, { timeout: 30_000 });
    if (!page.url().endsWith("/testing")) {
      await gotoWithRetry(page, page.url().replace(/\/basic$/, "/testing"));
    }
    await page.getByText("自测与实验室预约").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_500);
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PTST-001：自测与实验室预约页渲染（no_write）。
    test("OP-PTST-001 自测与实验室预约页渲染", async ({ page }) => {
      test.setTimeout(360_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];

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

      // 步骤 1：进入测试页。
      await gotoTesting(page, latest);
      await expect(page.url()).toContain("/testing");
      const main = page.locator("main");
      await expect(main).toContainText("为确保您的产品顺利上线，请按照以下步骤完成产品测试。");

      // 步骤 2：下载资料自测步骤。
      await expect(main).toContainText("下载资料自测");
      await expect(main).toContainText("支持 Android 和 iOS");
      const qr = page.locator(".product-phase-testing img").first();
      await expect(qr).toBeVisible();

      // 步骤 3：实验室测试步骤。
      await expect(main).toContainText("实验室测试");
      await expect(main).toContainText("金云官方测试实验室");
      await expect(main).toContainText("金云实验室");
      await expect(main).toContainText("0510-68109900");
      await expect(main).toContainText("测试服务说明");
      await expect(main).toContainText("测试结果说明");
      await attachShot(page, "产品测试页");
    });
  });

  test.describe("预约申请与列表", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PTST-002：预约申请弹窗结构与预填（no_write）。
    test("OP-PTST-002 预约申请弹窗结构与预填", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoTesting(page, latest);

      // 步骤 1：打开弹窗检查结构后取消。
      await page.getByRole("button", { name: "预约申请", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      await expect(dlg).toContainText("预约申请");
      // Model 与企业名称回显。
      await expect(dlg).toContainText(latest.assignedProductModel ?? "");
      // 关联固件版本（direct 显示；选项含已建固件）。
      const fwLabel = dlg.getByText("关联固件版本", { exact: false }).first();
      await expect(fwLabel).toBeVisible();
      await dlg.locator(".ep-select").first().click().catch(() => {});
      await page.waitForTimeout(800);
      const fwOptionVisible = await page.locator(".ep-select-dropdown:visible").getByText(/自动化测试固件/u).first().isVisible().catch(() => false);
      test.info().annotations.push({ type: "探索注解", description: `关联固件下拉含已建固件选项=${fwOptionVisible}` });
      await page.keyboard.press("Escape");
      // 预约测试类型选项。
      await expect(dlg).toContainText("预约测试类型");
      // 日期默认值（非空）。
      const dateInputs = dlg.locator(".ep-input__inner[placeholder]");
      const dateCount = await dateInputs.count();
      test.expect(dateCount, "两个日期选择器应存在").toBeGreaterThanOrEqual(2);
      // 联系人预填。
      const proposerValue = await dlg.getByRole("textbox", { name: "联系人" }).inputValue().catch(() => "");
      test.expect((proposerValue || "").length, "联系人应有预填值").toBeGreaterThan(0);
      await attachShot(page, "预约申请弹窗");
      // 取消关闭。
      const cancelBtn = dlg.getByRole("button", { name: "取消", exact: true });
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(1_000);
    });

    // 覆盖 OP-PTST-003：预约表单字段校验（no_write，表单前置校验模式）。
    test("OP-PTST-003 预约表单字段校验", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoTesting(page, latest);

      await page.getByRole("button", { name: "预约申请", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_500);

      // 字段级作用域取错误（其他字段错误文本可能含相同关键字）。
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

      const proposer = dlg.getByRole("textbox", { name: "联系人" });
      const mobile = dlg.getByRole("textbox", { name: "联系电话" });
      const email = dlg.getByRole("textbox", { name: "邮箱" });

      // D01 清空联系人 → 必填提示。
      await proposer.fill("");
      await proposer.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("联系人")).toContain("联系人");
      // D02 联系人非法字符。
      await proposer.fill("test_user!@#");
      await proposer.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("联系人")).toContain("联系人");
      // D03 联系电话 10 位。
      await mobile.fill("1300000000");
      await mobile.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("联系电话")).toContain("手机");
      // D04 邮箱非法格式。
      await email.fill("abc@");
      await email.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("邮箱")).toContain("邮箱");
      // D05 日期选择器：早于今日禁选（disabled-date，翻页核对注解）。
      const datePicker = dlg.locator(".ep-date-editor").first();
      await datePicker.click();
      await page.waitForTimeout(1_000);
      const prevDisabled = await dlg
        .locator(".ep-date-picker__prev-btn, .ep-picker-panel__icon-btn.prev-month")
        .first()
        .getAttribute("disabled")
        .catch(() => null);
      test.info().annotations.push({ type: "探索注解", description: `日期面板 prev-btn disabled 属性=${prevDisabled}（disabled-date 规则：不可早于今日，实证注解）` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      // D06 恢复合法值 → 字段错误清空（不提交）。
      await proposer.fill("自动化测试");
      await proposer.press("Tab");
      await mobile.fill("13000000000");
      await mobile.press("Tab");
      await email.fill("test@example.com");
      await email.press("Tab");
      await page.waitForTimeout(1_200);
      const restErrs = await dlg.locator(".ep-form-item__error").count();
      test.expect(restErrs, "恢复合法值后字段错误应清空").toBe(0);
      test.info().annotations.push({ type: "探索注解", description: "OP-PTST-003 全程未点击提交（表单前置校验模式）" });
      await attachShot(page, "预约表单校验");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });

    // 覆盖 OP-PTST-004：预约列表结构（no_write）。
    test("OP-PTST-004 预约列表结构", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoTesting(page, latest);

      // 步骤 1：申请测试区 + 列表表头。
      const main = page.locator("main");
      await expect(main).toContainText("申请测试");
      await expect(main).toContainText("提交申请后，预计2个工作日内给予回复。");
      await expect(page.getByRole("button", { name: "预约申请", exact: true }).first()).toBeVisible();
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["实验室名称", "测试类型", "申请人", "预约申请时间", "申请状态", "计划完成时间", "测试结果", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `预约列表行数=${rows}` });
      await attachShot(page, "预约列表");
    });

    // 覆盖 OP-PTST-005：提交预约申请（写入台账，幂等）。
    test("OP-PTST-005 提交预约申请", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoTesting(page, latest);

      const listBody = page.locator(".ep-table__body:visible").last();
      const pendingRow = listBody.locator("tbody tr").filter({ hasText: "金云官方测试实验室" }).first();
      const hasPending = await pendingRow.isVisible().catch(() => false);

      // 幂等：已有预约（待回复）→ 核验行存在 + 注解跳过。
      if (hasPending) {
        await expect(pendingRow).toContainText("测试上线");
        test.info().annotations.push({
          type: "探索注解",
          description: "已存在实验室预约（无 UI 删除路径），本列为幂等核验轮：断言行存在，不重复提交"
        });
        await attachShot(page, "预约已存在核验");
        return;
      }

      // 步骤 1：提交预约（类型=测试上线，其余用默认/预填）。
      await page.getByRole("button", { name: "预约申请", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      // el-select 的 placeholder span 拦截指针：点击 placeholder 文本「请选择」而非 combobox input
      //（先点固件下拉，再点类型下拉；每个下拉用可见 placeholder 文本定位）。
      const fwGroup = dlg.locator(".ep-form-item").filter({ hasText: "关联固件版本" }).first();
      await fwGroup.locator(".ep-select__placeholder").click();
      await page.waitForTimeout(1_000);
      await page.locator(".ep-select-dropdown:visible .ep-select-dropdown__item").first().click();
      await page.waitForTimeout(500);
      const typeGroup = dlg.locator(".ep-form-item").filter({ hasText: "预约测试类型" }).first();
      await typeGroup.locator(".ep-select__placeholder").click();
      await page.waitForTimeout(1_000);
      await page.locator(".ep-select-dropdown:visible").getByText("测试上线", { exact: true }).first().click();
      await page.waitForTimeout(500);
      await attachShot(page, "预约填写");
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      await expect(page.getByText("预约申请提交成功", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2_500);

      // 列表出现预约行。
      const newRow = listBody.locator("tbody tr").filter({ hasText: "金云官方测试实验室" }).first();
      await expect(newRow).toBeVisible({ timeout: 15_000 });
      await expect(newRow).toContainText("测试上线");
      await attachShot(page, "预约提交成功");

      // 步骤 2：台账记录。
      const record: TestingBookingRecord = {
        runId: Date.now(),
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        testType: "测试上线",
        proposer: (await dlg.getByRole("textbox", { name: "联系人" }).inputValue().catch(() => "")) || "（会话预填）",
        reservationTime: "（默认+3天）",
        createdAt: new Date().toISOString(),
      };
      const { recordGeneratedTestingBooking } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedTestingBooking(record);
      test.info().annotations.push({
        type: "写入台账",
        description: `已提交实验室预约（测试上线），记入本包台账 runId=${record.runId}（预约无 UI 删除路径）`
      });
    });

    // 覆盖 OP-PTST-006：预约详情查看（no_write）。
    test("OP-PTST-006 预约详情查看", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoTesting(page, latest);

      // 依赖：列表有预约行。
      const listBody = page.locator(".ep-table__body:visible").last();
      const row = listBody.locator("tbody tr").filter({ hasText: "金云官方测试实验室" }).first();
      const hasRow = await row.isVisible().catch(() => false);
      if (!hasRow) {
        test.info().annotations.push({ type: "探索注解", description: "预约列表无数据（004 未执行），跳过详情查看（转跳）" });
        test.skip();
      }

      // 步骤 1：点击「查看」。
      await row.getByText("查看", { exact: true }).click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg).toContainText("预约申请");
      await attachShot(page, "预约详情");

      // 步骤 2：关闭。
      const closeBtn = dlg.getByRole("button", { name: /取消|关闭/ }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(1_000);
    });
  });
});
