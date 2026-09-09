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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

type ProductRecord = { runId: number; productName: string; productModel: string; assignedProductModel?: string };
type FuncTplRecord = { runId: number; productName: string; productModel: string; templateName: string; templateBadge: string; savedAt: string };
type FuncDeleteRecord = { runId: number; productName: string; productModel: string; funcName: string; deletedAt: string };

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

test.describe("开放平台产品功能定义", () => {
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

  /** 从列表进入台账最新产品的指定阶段页（继续开发先落 basic，再切到目标阶段）。 */
  async function gotoLatestPhase(page: Page, latest: ProductRecord, phase: string) {
    await gotoWithRetry(page, `/integration/product/management`);
    await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByText(/继续开发|开发详情/u).click();
    await page.waitForURL(/\/integration\/product\/\d+\/basic/u, { timeout: 30_000 });
    if (!page.url().endsWith(`/${phase}`)) {
      await gotoWithRetry(page, page.url().replace(/\/basic$/, `/${phase}`));
    }
    await page.waitForTimeout(3_000);
  }

  const pageMain = (page: Page) => page.locator("main");

  async function collectNotices(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        const t = (n.textContent ?? "").trim();
        if (t && t.length <= 60 && /成功|失败|请|不能|删除|丢失/u.test(t)) out.push(t);
        n = walker.nextNode();
      }
      return Array.from(new Set(out));
    });
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PFNC-001：功能定义页渲染与空态（no_write）。
    test("OP-PFNC-001 功能定义页渲染与空态", async ({ page }) => {
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

      // 步骤 1：进入功能定义页。
      await gotoLatestPhase(page, latest, "function");
      await expect(page.url()).toContain("/function");
      await expect(pageMain(page)).toContainText(latest.productName);

      // 步骤 2：提示区文案 + 点我查看（target=_blank，探索实证）。
      await expect(pageMain(page)).toContainText("设备开发和高级配置都与产品功能定义有关");
      const docLink = page.getByRole("link", { name: "点我查看" }).first();
      await expect(docLink).toBeVisible();
      await expect(docLink).toHaveAttribute("target", "_blank");

      // 步骤 3：两个步骤标题。
      await expect(pageMain(page)).toContainText("选择产品功能模板");
      await expect(pageMain(page)).toContainText("编辑产品功能");

      // 步骤 4：空态（已选则注解转跳）。
      const emptyVisible = await page.getByText("请选择产品功能模板").isVisible().catch(() => false);
      const selectedVisible = await page.locator(".selected-template").isVisible().catch(() => false);
      test.info().annotations.push({
        type: "探索注解",
        description: `模板选择状态：${selectedVisible ? "已选（历史运行）" : emptyVisible ? "未选择（空态可见）" : "未知"}`
      });
      test.expect(emptyVisible || selectedVisible).toBeTruthy();
      await attachShot(page, "功能定义页");
    });
  });

  test.describe("模板与功能点", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PFNC-002：功能模板卡片区（no_write）。
    test("OP-PFNC-002 功能模板卡片区", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestPhase(page, latest, "function");

      // 若已选（历史运行），点重新选择进入卡片栅格（纯客户端状态）。
      const reselect = page.locator(".template-actions .template-detail");
      if (await reselect.isVisible().catch(() => false)) {
        await reselect.click();
        await page.waitForTimeout(1_000);
      }

      // 步骤 1：卡片 ≥2，自定义第一（探索实证 7 卡片：自定义功能 + 6 标准）。
      const cards = page.locator(".template-card");
      await cards.first().waitFor({ state: "visible", timeout: 15_000 });
      const cardCount = await cards.count();
      expect(cardCount, "模板卡片应 ≥2").toBeGreaterThanOrEqual(2);
      const firstName = (await cards.first().innerText()).replace(/\s+/g, " ");
      test.expect(firstName).toContain("自定义");
      test.expect(firstName).toContain("自定义功能");
      test.info().annotations.push({ type: "探索注解", description: `模板卡片清单（实证）：${await readCardNames(cards, cardCount)}` });

      // 步骤 2：卡片含名称与图片。
      const stdCard = cards.nth(1);
      await expect(stdCard).toContainText("标准");
      expect(await stdCard.locator("img").count()).toBeGreaterThanOrEqual(1);
      await attachShot(page, "模板卡片区");
    });

    // 覆盖 OP-PFNC-003：选择标准模板自动生成功能点（写入台账）。
    test("OP-PFNC-003 选择标准模板自动生成功能点", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestPhase(page, latest, "function");

      // 幂等：若已选模板（历史运行），点重新选择回到卡片栅格（服务端随后会被重新选择覆盖写入）。
      const reselect = page.locator(".template-actions .template-detail");
      if (await reselect.isVisible().catch(() => false)) {
        await reselect.click();
        await page.waitForTimeout(1_000);
      }

      // 步骤 1：点击第一张标准模板卡片（探索实证：第 2 张，名为「灯带恒压驱动器」）。
      const cards = page.locator(".template-card");
      const stdCard = cards.nth(1);
      const tplName = ((await stdCard.innerText()).replace(/\s+/g, " ").replace(/^标准\s*/, "")).trim();
      await stdCard.click();

      // toast 功能模板保存成功（瞬态，点击后立即等文本）。
      await expect(page.getByText("功能模板保存成功", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

      // 步骤 2：选中态 + 三个列表出现数据。
      await expect(page.locator(".selected-template")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".template-actions .template-detail")).toBeVisible();
      await page.waitForTimeout(2_500);
      const funcTitles = page.locator(".func-property-title, [class*='func-title'], .toolbar .func-property-header");
      const listsHaveData = await page.locator(".func-list .ep-table__body:visible tbody tr").count();
      test.info().annotations.push({
        type: "探索注解",
        description: `已选标准模板「${tplName}」；功能列表行数（属性表）=${listsHaveData}`
      });
      expect(listsHaveData, "标准模板应自动加入功能点（属性列表有数据）").toBeGreaterThanOrEqual(1);
      await attachShot(page, "选择标准模板成功");

      // 步骤 3：台账记录。
      const record: FuncTplRecord = {
        runId: Date.now(),
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        templateName: tplName,
        templateBadge: "标准",
        savedAt: new Date().toISOString(),
      };
      const { recordGeneratedProductFuncTpl } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedProductFuncTpl(record);
      test.info().annotations.push({
        type: "写入台账",
        description: `已为 ${latest.productName} 选择标准模板「${tplName}」，记入本包台账 runId=${record.runId}`
      });
    });

    // 覆盖 OP-PFNC-004：三个功能列表结构（no_write）。
    test("OP-PFNC-004 三个功能列表结构", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestPhase(page, latest, "function");

      // 依赖：已选标准模板；若在重新选择栅格（历史运行残留客户端态）则刷新恢复。
      if (!(await page.locator(".selected-template").isVisible().catch(() => false))) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3_000);
      }
      await expect(page.locator(".selected-template")).toBeVisible();

      // 步骤 1：三个列表标题。
      await expect(pageMain(page)).toContainText("属性 / Property");
      await expect(pageMain(page)).toContainText("事件 / Event");
      await expect(pageMain(page)).toContainText("方法 / Action");

      // 步骤 2：属性列表列头（探索实证结构）。
      const header = page.locator(".func-list .ep-table__header:visible").first();
      for (const col of ["功能点名称", "标识符/code", "功能类型", "数据类型", "数据传输类型", "场景权限", "数据定义", "操作"]) {
        await expect(header).toContainText(col);
      }

      // 步骤 3：标准模板下批量添加按钮可见（自定义模板隐藏）；自定义属性按钮可见。
      await expect(page.getByRole("button", { name: "添加属性", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "自定义属性", exact: true })).toBeVisible();
      await attachShot(page, "三个功能列表");
    });

    // 覆盖 OP-PFNC-005：功能点详情查看（no_write）。
    test("OP-PFNC-005 功能点详情查看", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestPhase(page, latest, "function");
      if (!(await page.locator(".selected-template").isVisible().catch(() => false))) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3_000);
      }

      // 步骤 1：属性列表首行「详情」。
      const firstRow = page.locator(".func-list .ep-table__body:visible tbody tr").first();
      await firstRow.waitFor({ state: "visible", timeout: 20_000 });
      const rowName = (await firstRow.innerText()).split("\n")[0];
      await firstRow.getByText("详情", { exact: true }).click();
      // 详情为 DrawerTrigger 抽屉（.drawer-trigger 是常驻 wrapper，开合断言用 .ep-drawer 面板）。
      const drawer = page.locator(".ep-drawer:visible").last();
      await drawer.waitFor({ state: "visible", timeout: 15_000 });
      test.info().annotations.push({ type: "探索注解", description: `已打开功能点「${rowName}」详情抽屉` });
      await attachShot(page, "功能点详情");

      // 步骤 2：关闭详情（抽屉页脚取消按钮）。
      await drawer.getByRole("button", { name: "取消", exact: true }).click();
      await expect(drawer).toBeHidden({ timeout: 10_000 });
    });

    // 覆盖 OP-PFNC-006：删除一个功能点（写入台账）。
    test("OP-PFNC-006 删除一个功能点", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestPhase(page, latest, "function");
      if (!(await page.locator(".selected-template").isVisible().catch(() => false))) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3_000);
      }

      // 步骤 1：属性列表找带「删除」链接的行（non-Required；必选行无删除链接）。
      const propList = page.locator(".func-property-list").first();
      const rows = propList.locator(".ep-table__body:visible tbody tr");
      await rows.first().waitFor({ state: "visible", timeout: 20_000 });
      const rowCountBefore = await rows.count();
      let targetRow = null;
      let targetName = "";
      for (let i = 0; i < rowCountBefore; i += 1) {
        const r = rows.nth(i);
        if (await r.getByText("删除", { exact: true }).isVisible().catch(() => false)) {
          targetRow = r;
          targetName = (await r.innerText()).split("\n")[0];
          break;
        }
      }
      test.expect(targetRow, "应存在可删除（非必选）的功能点行").toBeTruthy();
      test.info().annotations.push({ type: "探索注解", description: `删除目标功能点：「${targetName}」（删除前行数 ${rowCountBefore}）` });
      await targetRow!.getByText("删除", { exact: true }).click();

      // 删除确认弹窗（预检通过=确定要删除该功能吗？；被引用则显示引用警告，注解）。
      const confirmDlg = page.locator(".ep-message-box:visible").last();
      await confirmDlg.waitFor({ state: "visible", timeout: 15_000 });
      const confirmText = await confirmDlg.innerText();
      test.info().annotations.push({ type: "探索注解", description: `删除确认弹窗文案：${confirmText.replace(/\s+/g, " ").slice(0, 120)}` });
      await attachShot(page, "删除功能点确认");

      // 步骤 2：确定删除 → toast + 行消失。
      await confirmDlg.getByRole("button", { name: "确定", exact: true }).click();
      await expect(page.getByText("功能已删除，请及时保存更改。", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2_000);
      const rowCountAfter = await rows.count();
      expect(rowCountAfter, "删除后属性列表行数应减少").toBeLessThan(rowCountBefore);

      // 步骤 3：台账记录。
      const record: FuncDeleteRecord = {
        runId: Date.now(),
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        funcName: targetName,
        deletedAt: new Date().toISOString(),
      };
      const { recordGeneratedProductFuncDelete } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedProductFuncDelete(record);
      test.info().annotations.push({
        type: "写入台账",
        description: `已删除功能点「${targetName}」，记入本包台账 runId=${record.runId}`
      });
    });

    // 覆盖 OP-PFNC-007：未选模板切换页面守卫（no_write，纯客户端状态）。
    test("OP-PFNC-007 未选模板切换页面守卫", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestPhase(page, latest, "function");
      if (!(await page.locator(".selected-template").isVisible().catch(() => false))) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3_000);
      }

      // 步骤 1：重新选择 → 回到卡片栅格（客户端清空选中态，服务端模板保留）。
      await page.locator(".template-actions .template-detail").click();
      await page.waitForTimeout(1_200);
      await expect(page.locator(".template-card").first()).toBeVisible();
      await expect(page.locator(".selected-template")).toBeHidden();

      // 步骤 2：下一步 → 守卫弹窗（源码文案含句尾双句号）。
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      const guardText = page.getByText(/您还没有选择功能点/u).first();
      await expect(guardText).toBeVisible({ timeout: 15_000 });
      const guardBody = await guardText.innerText();
      test.info().annotations.push({ type: "探索注解", description: `守卫弹窗文案（实证）：${guardBody}` });
      await expect(page.getByRole("button", { name: "留在页面" })).toBeVisible();
      await expect(page.getByRole("button", { name: "切换页面" })).toBeVisible();
      await attachShot(page, "未选模板守卫");

      // 步骤 3：留在页面。
      await page.getByRole("button", { name: "留在页面" }).click();
      await page.waitForTimeout(1_000);
      await expect(guardText).toBeHidden();
      await expect(page.url()).toContain("/function");
    });
  });
});

// 辅助：读取卡片名清单（最多 7 张）。
async function readCardNames(cards: ReturnType<Page["locator"]>, count: number): Promise<string> {
  const names: string[] = [];
  for (let i = 0; i < Math.min(count, 7); i += 1) {
    names.push((await cards.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim());
  }
  return names.join(" | ");
}
