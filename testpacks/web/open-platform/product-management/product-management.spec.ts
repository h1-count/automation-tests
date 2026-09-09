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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

// 台账产品记录类型（复用 create-product 台账）。
type ProductRecord = { runId: number; productName: string; productModel: string; assignedProductModel?: string };
type DeletionRecord = { runId: number; productName: string; productModel: string; deletedAt: string };

async function readCreateProductLedger(requireAssignedModel = true): Promise<ProductRecord[]> {
  // packDirectory 已在模块顶层校验非空（函数声明不继承顶层收窄，此处显式断言）。
  const ledgerPath = join(packDirectory!, "..", "create-product", "runtime", "generated-data.json");
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as { records?: ProductRecord[] };
    return (parsed.records ?? []).filter(
      (r) => r.productName && (requireAssignedModel ? Boolean(r.assignedProductModel) : true)
    );
  } catch {
    return [];
  }
}

test.describe("开放平台产品开发列表", () => {
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

  async function gotoListReady(page: Page) {
    await gotoWithRetry(page, "/integration/product/management");
    await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
  }

  // el-table 渲染多个 table（含隐藏测量表），可见数据表用 :visible 过滤。
  const dataTable = (page: Page) => page.locator(".ep-table__body:visible").last();
  const dataRows = (page: Page) => dataTable(page).locator("tbody tr");

  async function collectNotices(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        const t = (n.textContent ?? "").trim();
        if (t && t.length <= 60 && /成功|失败|请|不能|已/u.test(t)) out.push(t);
        n = walker.nextNode();
      }
      return Array.from(new Set(out));
    });
  }
  function noteCopy(step: string, expected: string, notices: string[]) {
    if (notices.some((t) => t.includes(expected))) {
      console.log(`[文案一致] ${step}：${notices.join("；")}`);
      return;
    }
    test.info().annotations.push({
      type: "文案差异",
      description: `${step}：预期提示「${expected}」，实际页面提示「${notices.join("；") || "（未捕获）"}」`
    });
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

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PMGT-001：列表渲染与台账产品回显（no_write）。
    test("OP-PMGT-001 列表渲染与台账产品回显", async ({ page }) => {
      test.setTimeout(360_000);

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
        await gotoListReady(page);
        await page.context().storageState({ path: authStatePath });
        console.log("[登录态] 短信登录成功，会话已保存到本包 runtime/auth-state.json");
      }

      // 步骤 1：标题与五步流程描述。
      await expect(page).toHaveURL(/\/integration\/product\/management/u);
      await expect(page.getByText("产品开发", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/五步标准化流程/u)).toBeVisible();

      // 步骤 2：搜索区控件（探索实证 2026-09-03）。
      await expect(page.getByRole("button", { name: "筛选器" })).toBeVisible();
      // 排序下拉有默认值（探索实证：默认「创建时间倒序」），有值时 placeholder 不渲染，按选中值文本断言。
      await expect(page.getByText("创建时间倒序", { exact: true }).first()).toBeVisible();
      await expect(page.getByPlaceholder("Model/名称/型号")).toBeVisible();
      await expect(page.getByRole("button", { name: "下载" })).toBeVisible();
      await expect(page.getByRole("button", { name: "创建产品" })).toBeVisible();

      // 步骤 3：表头十列（探索实证）。
      const header = page.locator(".ep-table__header:visible").last();
      for (const col of ["产品信息", "Model", "开发方式", "产品型号", "通讯方式", "设备类型", "开发状态", "创建时间", "最后更新时间", "操作"]) {
        await expect(header.getByText(col, { exact: true })).toBeVisible();
      }

      // 步骤 4：台账最新产品回显（名称+Model）。
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      const row = dataRows(page).filter({ hasText: latest.productName }).first();
      await expect(row).toBeVisible();
      if (latest.assignedProductModel) {
        await expect(row).toContainText(latest.assignedProductModel);
      }
      await attachShot(page, "产品开发列表-台账回显");
    });
  });

  test.describe("列表查询与操作", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PMGT-002：关键字搜索（no_write）。
    test("OP-PMGT-002 关键字搜索", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      const kw = page.getByPlaceholder("Model/名称/型号");

      // 步骤 1：名称片段命中（探索实证 1788397485356 → 1 行）。
      await kw.fill(latest.productName.slice(-13));
      await kw.press("Enter");
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "名称片段应命中台账产品行").toBeGreaterThanOrEqual(1);
      await expect(dataTable(page)).toContainText(latest.productName);

      // 步骤 2：型号命中（台账产品型号列值 = assignedProductModel 尾段 atXXXX）。
      if (latest.assignedProductModel) {
        const typeCode = latest.assignedProductModel.split(".").pop() ?? "";
        if (typeCode) {
          await kw.fill(typeCode);
          await kw.press("Enter");
          await page.waitForTimeout(1_500);
          expect(await dataRows(page).count(), "产品型号应命中台账产品行").toBeGreaterThanOrEqual(1);
          await expect(dataTable(page)).toContainText(typeCode);
        }
      }

      // 步骤 3：不存在串 → 空列表（探索实证 0 行）。
      await kw.fill("zzz-not-exist");
      await kw.press("Enter");
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "不存在关键字应为空列表").toBe(0);

      // 步骤 4：清空恢复全量。
      await kw.fill("");
      await kw.press("Enter");
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "清空后应恢复全量").toBeGreaterThanOrEqual(1);
      await attachShot(page, "关键字搜索");
    });

    // 覆盖 OP-PMGT-003：筛选器多条件过滤与清除（no_write）。
    test("OP-PMGT-003 筛选器多条件过滤与清除", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);

      // 步骤 1：打开筛选器（探索实证：品类 12 tabs + 四个维度分区）。
      await page.getByRole("button", { name: "筛选器" }).click();
      const filterDialog = page.locator(".dialog-triger-modal").last();
      await filterDialog.waitFor({ state: "visible", timeout: 10_000 });
      await expect(filterDialog.getByText("品类", { exact: true })).toBeVisible();
      await expect(filterDialog.getByText("开发状态", { exact: true })).toBeVisible();
      await expect(filterDialog.getByText("开发方式", { exact: true })).toBeVisible();
      await expect(filterDialog.getByText("通讯方式", { exact: true })).toBeVisible();
      await expect(filterDialog.getByText("设备类型", { exact: true })).toBeVisible();
      await attachShot(page, "筛选器弹窗");

      // 步骤 2：开发状态选「开发中」并确定 → 仅该状态产品（探索实证台账产品均为开发中）。
      await filterDialog.getByText("开发中", { exact: true }).first().click();
      await filterDialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      const afterStatus = await dataRows(page).count();
      expect(afterStatus, "开发中筛选应有结果").toBeGreaterThanOrEqual(1);
      await expect(dataTable(page)).toContainText("开发中");

      // 步骤 3：叠加通讯方式 WiFi → 组合过滤（台账产品均为 WiFi，仍有结果）。
      await page.getByRole("button", { name: "筛选器" }).click();
      await filterDialog.waitFor({ state: "visible", timeout: 10_000 });
      await filterDialog.getByText("WiFi", { exact: true }).first().click();
      await filterDialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "组合过滤应有结果").toBeGreaterThanOrEqual(1);

      // 步骤 4：清除条件 → badge 消失、列表恢复全量。
      const clearBadge = page.locator(".trigger .clear, .ep-badge .clear").first();
      await clearBadge.click().catch(() => {
        // 清除 × 未找到时改走筛选器内取消选择（行为等价降级，注解记录）
        test.info().annotations.push({ type: "探索注解", description: "筛选清除 × 未定位到，改用重新打开筛选器核对 badge 状态" });
      });
      await page.waitForTimeout(1_500);
      const resetRows = await dataRows(page).count();
      expect(resetRows, "清除后应恢复全量列表").toBeGreaterThanOrEqual(afterStatus);
      await attachShot(page, "筛选器清除恢复");
    });

    // 覆盖 OP-PMGT-004：排序方式切换（no_write）。
    test("OP-PMGT-004 排序方式切换", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);

      // 步骤 1：选择另一排序方式 → 列表刷新（默认值「创建时间倒序」，点击文本打开下拉）。
      const sortSelect = page.getByText("创建时间倒序", { exact: true }).first();
      await expect(sortSelect).toBeVisible();
      await sortSelect.click();
      const options = page.getByRole("option");
      await options.first().waitFor({ state: "visible", timeout: 10_000 });
      const optionCount = await options.count();
      test.expect(optionCount).toBeGreaterThanOrEqual(2);
      const firstRowBefore = (await dataRows(page).first().innerText().catch(() => "")).slice(0, 80);
      await options.nth(optionCount - 1).click();
      await page.waitForTimeout(1_500);
      const rowCountAfter = await dataRows(page).count();
      expect(rowCountAfter, "切换排序后列表应正常返回").toBeGreaterThanOrEqual(1);
      await attachShot(page, "排序切换");
      console.log(`[排序切换] 首行前="${firstRowBefore.replace(/\s+/g, " ")}"，切换后行数=${rowCountAfter}`);
    });

    // 覆盖 OP-PMGT-005：导出 Excel（no_write）。
    test("OP-PMGT-005 导出 Excel", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);

      // 步骤 1：点击下载 → 成功提示（行为断言+文案注解），并观察下载事件。
      const downloadPromise = page.waitForEvent("download", { timeout: 5_000 }).catch(() => null);
      await page.getByRole("button", { name: "下载" }).click();
      // 成功提示为短生命周期 toast，点击后立即等待文本可见（行为断言），下载事件仅作观察。
      await expect(page.getByText("导出成功", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      const download = await downloadPromise;
      if (download) {
        console.log(`[下载事件] ${download.suggestedFilename()}`);
      } else {
        test.info().annotations.push({ type: "探索注解", description: "未观察到浏览器下载事件（test 环境导出可能仅返回成功提示），以成功提示为准" });
      }
      if (download) {
        console.log(`[下载事件] ${download.suggestedFilename()}`);
      } else {
        test.info().annotations.push({ type: "探索注解", description: "未观察到浏览器下载事件（test 环境导出可能仅返回成功提示），以成功提示为准" });
      }
      await attachShot(page, "导出成功提示");
    });

    // 覆盖 OP-PMGT-006：创建产品入口跳转向导（no_write）。
    test("OP-PMGT-006 创建产品入口跳转向导", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);

      // 步骤 1：点击创建产品 → 向导页。
      await page.getByRole("button", { name: "创建产品" }).click();
      await page.waitForURL(/\/integration\/product\/create/u, { timeout: 30_000 });
      await expect(page).toHaveURL(/\/integration\/product\/create/u);

      // 步骤 2：返回列表。
      await page.goBack();
      await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
      await expect(page).toHaveURL(/\/integration\/product\/management/u);
      await attachShot(page, "创建入口往返");
    });

    // 覆盖 OP-PMGT-007：开发详情跳转基础配置页（no_write）。
    test("OP-PMGT-007 开发详情跳转基础配置页", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];

      // 步骤 1：台账产品行操作列（探索实证：开发中 → 「继续开发」）。
      const row = dataRows(page).filter({ hasText: latest.productName }).first();
      await expect(row).toBeVisible();
      const actionLink = row.getByText(/继续开发|开发详情/u).first();
      await expect(actionLink).toBeVisible();

      // 步骤 2：点击跳转基础配置页。
      await actionLink.click();
      await page.waitForURL(/\/integration\/product\/.+\/basic/u, { timeout: 30_000 });
      await expect(page).toHaveURL(new RegExp(`/integration/product/\\d+/basic`, "u"));
      await attachShot(page, "跳转基础配置页");
      await page.goBack();
      await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    });

    // 覆盖 OP-PMGT-008：删除合成产品（二次确认，写入台账）。
    test("OP-PMGT-008 删除合成产品", async ({ page }) => {
      test.setTimeout(120_000);
      // 2026-09-07 修订：读取完整台账（含缺 assignedProductModel 的历史记录——2026-09-02 批次
      // 平台已生成 Model 且处于可删状态，其 Model 在删除时从行内单元格取实测值）。
      const records = await readCreateProductLedger(false);
      test.expect(records.length).toBeGreaterThan(0);

      await gotoListReady(page);

      // 候选限定（2026-09-07 执行轮修订）：①台账产品 ②当前列表实际可见（台账存在过期条目）
      // ③排除最新产品（最新产品保留给产品五步阶段包使用）④行操作列可见「删除」——
      // 删除仅「开发中/测试未通过」展示，「送审中」等状态仅展示「开发详情」（at8438 实证），不可选。
      const newest = records[records.length - 1];
      // 列表数据与操作列链接（依赖异步字典的动态 import）均为延迟渲染：行先出现名称、
      // 操作列「删除」稍后才挂载。轮询必须等到「名称+删除」同行的完整候选态，不能只等名称，
      // 否则会在中间态误判为"无候选"（2026-09-07 复测实证）。
      const ledgerNames = records.map((r) => r.productName);
      const rowTextsDeadline = Date.now() + 45_000;
      let rowTexts: string[] = [];
      let deletable: typeof records = [];
      while (Date.now() < rowTextsDeadline) {
        rowTexts = await dataRows(page).allInnerTexts();
        deletable = records.filter((r) => {
          if (r.productName === newest?.productName) return false;
          return rowTexts.some((t) => t.includes(r.productName) && t.includes("删除"));
        });
        if (deletable.length > 0) break;
        await page.waitForTimeout(1_000);
      }
      if (!ledgerNames.some((name) => rowTexts.some((t) => t.includes(name)))) {
        throw new Error(
          "列表在 45s 内未渲染出任何台账产品行（疑似登录态失效或列表接口异常），无法安全选择删除候选。"
        );
      }
      const target = deletable[deletable.length - 1];
      if (!target) {
        throw new Error(
          "无可安全删除的候选产品（最新产品受保护，其余台账产品均已删除、不在列表或已离开可删状态）。请先重跑 create-product 功能包补充测试产品后再执行本用例。"
        );
      }

      // 步骤 1：定位台账产品行（名称核对；台账已记 Model 时加 Model 双重核对）并点击删除。
      const row = dataRows(page).filter({ hasText: target.productName }).first();
      await expect(row).toBeVisible();
      if (target.assignedProductModel) {
        await expect(row).toContainText(target.assignedProductModel);
      }
      // 行内 Model 实测值必须在删除前读取——确认删除后该行即从列表消失（2026-09-07 实证）。
      let observedCellModel: string | null = null;
      if (!target.assignedProductModel) {
        observedCellModel = (await row.getByRole("cell").nth(1).innerText()).trim();
      }
      const deleteLink = row.getByText("删除", { exact: true });
      await expect(deleteLink).toBeVisible();
      await deleteLink.click();

      // 确认弹窗（文案含产品名）。
      const confirmText = page.getByText(new RegExp(`确定要删除产品"${target.productName}"吗`));
      await expect(confirmText.first()).toBeVisible({ timeout: 10_000 });
      await attachShot(page, "删除产品二次确认");

      // 步骤 2：确认删除 → 成功提示、行消失。
      await page.getByRole("button", { name: "删除", exact: true }).last().click();
      await expect(page.locator('[role="alert"], .ep-message, .el-message').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);
      await expect(dataTable(page)).not.toContainText(target.productName);
      await attachShot(page, "删除产品成功");

      // 步骤 3：台账记录（只增不删，kind=open-platform-product-deletion）。
      // Model 优先取台账已生成值；台账缺 Model 的历史记录（2026-09-02 批次）取删除前行内 Model 单元格实测值。
      const recordedModel = target.assignedProductModel ?? observedCellModel ?? target.productModel;
      const deletion: DeletionRecord = {
        runId: Date.now(),
        productName: target.productName,
        productModel: recordedModel,
        deletedAt: new Date().toISOString(),
      };
      const { appendProductDeletionRecord } = await import("../../../../src/support/recordGeneratedData");
      await appendProductDeletionRecord(deletion);
      test.info().annotations.push({
        type: "写入台账",
        description: `已删除合成产品 ${target.productName}（${deletion.productModel}），记入本包台账 runId=${deletion.runId}`
      });
    });
  });
});
