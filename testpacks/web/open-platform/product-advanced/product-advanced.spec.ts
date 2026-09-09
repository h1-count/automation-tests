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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

type ProductRecord = { runId: number; productName: string; productModel: string; assignedProductModel?: string };
type MsgTplRecord = { runId: number; productName: string; productModel: string; tplTitle: string; tplContent: string; appliedAt: string };
type MsgTplDeleteRecord = { runId: number; productName: string; productModel: string; tplTitle: string; deletedAt: string };

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

test.describe("开放平台高级配置", () => {
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

  /** 从列表进入台账最新产品的 /advanced 卡片首页（继续开发先落 basic）。 */
  async function gotoAdvanced(page: Page, latest: ProductRecord) {
    await gotoWithRetry(page, `/integration/product/management`);
    await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByText(/继续开发|开发详情/u).click();
    await page.waitForURL(/\/integration\/product\/\d+\/basic/u, { timeout: 30_000 });
    if (!page.url().endsWith("/advanced")) {
      await gotoWithRetry(page, page.url().replace(/\/basic$/, "/advanced"));
    }
    await page.locator(".advanced-config").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000);
  }

  /** 从高级配置卡片首页进入指定子卡片（子页 chunk 首访有 dev 冷编译，等待就绪文本而非固定睡眠）。 */
  async function openCard(page: Page, title: string, readyText: string) {
    await page.locator(".advanced-card-list").waitFor({ state: "visible", timeout: 20_000 });
    await page.locator(".advanced-card-list").getByText(title, { exact: true }).first().click();
    await page.getByText(readyText).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_500);
  }

  /** 返回高级配置卡片首页（面包屑）。 */
  async function backToCards(page: Page) {
    await page.locator(".advanced-bread").getByText("高级配置", { exact: true }).click();
    await page.locator(".advanced-card-list").waitFor({ state: "visible", timeout: 20_000 });
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PADV-001：卡片列表与文档链接（no_write）。
    test("OP-PADV-001 卡片列表与文档链接", async ({ page }) => {
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

      // 步骤 1：进入高级配置页。
      await gotoAdvanced(page, latest);
      await expect(page.url()).toContain("/advanced");

      // 步骤 2：文档提示 + 点我查看（实证：el-link @click 无 href，a11y 树中为文本节点，用文本定位）。
      const main = page.locator("main");
      await expect(main).toContainText("设备开发和高级配置都与产品功能定义有关");
      const docLink = page.getByText("点我查看", { exact: true }).first();
      await expect(docLink).toBeVisible();

      // 步骤 3：两张卡片。
      const cardList = page.locator(".advanced-card-list");
      await expect(cardList).toContainText("场景联动配置");
      await expect(cardList).toContainText("消息推送配置");
      await expect(cardList).toContainText("配置产品可支持自动化触发条件和执行条件，请用户搭建智能场景。");
      await expect(cardList).toContainText("配置产品触发特定事件，为用户推送的设备消息。");
      await expect(cardList).toContainText("可选");
      await attachShot(page, "高级配置卡片");
    });
  });

  test.describe("高级配置子页", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PADV-002：场景联动页结构（no_write）。
    test("OP-PADV-002 场景联动页结构", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoAdvanced(page, latest);

      // 步骤 1：进入场景联动配置（openCard 内等待描述文案就绪）。
      await openCard(page, "场景联动配置", "触发条件设置");
      const main = page.locator("main");
      await expect(main).toContainText("配置产品可支持自动化触发条件和执行条件，请用户搭建智能场景。");

      // 步骤 2：触发/执行两区 + 新建自动化 + 列头。
      await expect(main).toContainText("触发条件设置");
      await expect(main).toContainText("执行动作设置");
      await expect(page.getByRole("button", { name: "新建自动化", exact: true }).first()).toBeVisible();
      for (const col of ["自动化名称", "样式类型", "自动化类型", "状态", "操作"]) {
        await expect(page.locator(".ep-table__header:visible").first()).toContainText(col);
      }
      await expect(main).toContainText("触发范围");
      await expect(main).toContainText("执行范围");

      // 步骤 3：列表行数注解。
      const triggerRows = await page.locator(".trigger-options .ep-table__body:visible tbody tr").count().catch(() => 0);
      const actionRows = await page.locator(".action-options .ep-table__body:visible tbody tr").count().catch(() => 0);
      test.info().annotations.push({ type: "探索注解", description: `触发条件表行数=${triggerRows}，执行动作表行数=${actionRows}（开发中自定义行才有删除链接）` });

      // 步骤 4：图例区。
      await expect(main).toContainText("金云智居App自动化场景图例");
      await attachShot(page, "场景联动页");

      // 步骤 5：面包屑返回。
      await backToCards(page);
      await expect(page.locator(".advanced-card-list")).toContainText("消息推送配置");
    });

    // 覆盖 OP-PADV-003：消息推送页结构（no_write）。
    test("OP-PADV-003 消息推送页结构", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoAdvanced(page, latest);

      // 步骤 1：进入消息推送配置（openCard 内等待页头按钮就绪）。
      await openCard(page, "消息推送配置", "套用模板");
      const main = page.locator("main");
      await expect(main).toContainText("配置产品触发特定事件，为用户推送的设备消息。");

      // 步骤 2：操作区按钮。
      await expect(page.getByRole("button", { name: "套用模板", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "新建推送", exact: true }).first()).toBeVisible();

      // 步骤 3：表头 + 行数注解。
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["消息推送标题", "消息推送内容", "触发条件", "推送方式", "审核状态", "推送间隔", "推送状态", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `消息推送列表行数=${rows}` });
      await attachShot(page, "消息推送页");
    });

    // 覆盖 OP-PADV-004：套用模板与删除（写入台账）。
    test("OP-PADV-004 套用模板与删除", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoAdvanced(page, latest);
      await openCard(page, "消息推送配置", "套用模板");

      // 步骤 1：套用模板 → 勾选首行 → 确定。
      await page.getByRole("button", { name: "套用模板", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg).toContainText("选用标准消息");
      const tplRows = dlg.locator(".ep-table__body:visible tbody tr");
      const hasTpl = await tplRows
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!hasTpl) {
        // 2026-09-03 实证：test 环境灯品类在线标准消息模板列表为空（/product/message/tpl/list totalCount=0），
        // 属环境数据缺失而非页面缺陷；按用例表约定注解转跳，不判失败。
        await attachShot(page, "模板列表为空");
        test.info().annotations.push({
          type: "探索注解",
          description: "环境无在线标准消息模板（接口返回 totalCount=0），套用模板写入用例转跳；待环境补充模板后重跑"
        });
        const cancelBtn = dlg.getByRole("button", { name: "取消", exact: true });
        if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click();
        test.skip();
      }
      const tplRowCount = await tplRows.count();
      const firstTplTitle = ((await tplRows.first().innerText()) || "").split("\n")[0].trim();
      await tplRows.first().locator(".ep-checkbox").first().click();
      await page.waitForTimeout(500);
      await attachShot(page, "套用模板勾选");
      await dlg.getByRole("button", { name: "确定", exact: true }).click();

      // toast 新增成功 + 列表出现该模板行。
      await expect(page.getByText("新增成功", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2_500);
      const msgTable = page.locator(".ep-table__body:visible").last();
      const targetRow = msgTable.locator("tbody tr").filter({ hasText: firstTplTitle }).first();
      await expect(targetRow).toBeVisible({ timeout: 15_000 });

      // 步骤 2：台账记录（新增）。
      const runId = Date.now();
      const record: MsgTplRecord = {
        runId,
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        tplTitle: firstTplTitle,
        tplContent: "（标准模板内容，套用后即删）",
        appliedAt: new Date().toISOString(),
      };
      const { recordGeneratedMessageTpl } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedMessageTpl(record);
      test.info().annotations.push({ type: "写入台账", description: `已套用标准模板「${firstTplTitle}」，记入本包台账 runId=${runId}` });

      // 步骤 3：删除该模板行。
      await targetRow.getByText("删除", { exact: true }).click();
      const confirmDlg = page.locator(".ep-message-box:visible").last();
      await confirmDlg.waitFor({ state: "visible", timeout: 15_000 });
      const confirmText = (await confirmDlg.innerText()).replace(/\s+/g, " ");
      test.info().annotations.push({ type: "探索注解", description: `删除确认弹窗：${confirmText.slice(0, 100)}` });
      await attachShot(page, "删除模板确认");
      await confirmDlg.getByRole("button", { name: "确定", exact: true }).click();
      await expect(targetRow).toBeHidden({ timeout: 15_000 });

      // 步骤 4：台账记录（删除）。
      const delRecord: MsgTplDeleteRecord = {
        runId: Date.now(),
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        tplTitle: firstTplTitle,
        deletedAt: new Date().toISOString(),
      };
      const { recordGeneratedMessageTplDelete } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedMessageTplDelete(delRecord);
      test.info().annotations.push({ type: "写入台账", description: `已删除模板「${firstTplTitle}」，记入本包台账 runId=${delRecord.runId}` });
      await attachShot(page, "删除模板完成");
    });

    // 覆盖 OP-PADV-005：套用模板弹窗空选拦截（no_write）。
    test("OP-PADV-005 套用模板弹窗空选拦截", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoAdvanced(page, latest);
      await openCard(page, "消息推送配置", "套用模板");

      // 记录操作前行数。
      const rowsBefore = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();

      // 步骤 1：不勾选直接确定。
      await page.getByRole("button", { name: "套用模板", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      await expect(page.getByText("请选择至少一个模板", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(dlg).toBeVisible();

      // 步骤 2：取消关闭，列表无变化。
      const cancelBtn = dlg.getByRole("button", { name: "取消", exact: true });
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(1_500);
      const rowsAfter = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.expect(rowsAfter).toBe(rowsBefore);
      await attachShot(page, "空选拦截");
    });
  });
});
