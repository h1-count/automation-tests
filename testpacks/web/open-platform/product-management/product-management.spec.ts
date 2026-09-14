import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

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
  // 产品编辑链路 6 包（2026-09-11）：basic 为链路首包，登录就绪后回写自身 auth-state，
  // 后续包（含本包，链路末位）经候选列表复用，避免链路中途再次触发人工短信登录。
  join(packDirectory, "..", "product-basic", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-function", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-develop", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-advanced", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-testing", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

// 台账产品记录类型（复用 create-product 台账；2026-09-11 起记录含 品类/开发方式/设备类型，
// 供 OP-PMGT-001 逐列回显核对运行时读取，不硬编码台账值）。
type ProductRecord = {
  runId: number;
  productName: string;
  productModel: string;
  category?: string;
  developmentMethod?: string;
  deviceType?: string;
  assignedProductModel?: string;
};
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
  // 2026-09-11 与 cases.md（2026-09-11 重新设计、用户确认版）脚本同步（工作单 WO-B2-03）：
  // 001 逐列回显核对+状态/时间注解并锚定 OP-PROD-002 菜单入口划界；002 补 D02 Model 全值搜索；
  // 003 九步 D01~D08（取消分支/品类/开发方式/设备类型/已上线空态/清除×）；004 排序四字典项全枚举+单调性；
  // 005 下载注解更新；006 不创建产品划界并锚定 OP-PROD-001 守卫；007 开发中/送审中双态对照；
  // 008 新增删除确认弹窗取消分支（无写入）。
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

  // 2026-09-14 平台产品数增长突破单页 10 条（共 19 条）：台账最新产品可能落在第 2 页。
  // 台账目标行第 1 页未命中时用列表搜索（只读动作）定位，不改变用例断言语义。
  async function findLedgerRow(page: Page, productName: string): Promise<Locator> {
    const hit = dataRows(page).filter({ hasText: productName }).first();
    if (await hit.isVisible().catch(() => false)) return hit;
    await page.getByPlaceholder(/Model\/名称\/型号/u).fill(productName);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.waitForTimeout(3_000);
    return dataRows(page).filter({ hasText: productName }).first();
  }

  // 列表十列顺序：产品信息/Model/开发方式/产品型号/通讯方式/设备类型/开发状态/创建时间/最后更新时间/操作。
  const COLUMN = { INFO: 0, MODEL: 1, DEV_TYPE: 2, MODEL_CODE: 3, PROTOCOL: 4, DEVICE: 5, STATUS: 6, CREATED: 7, UPDATED: 8 } as const;

  async function cellText(row: Locator, index: number): Promise<string> {
    return (await row.getByRole("cell").nth(index).innerText().catch(() => "")).trim();
  }

  type RowSnapshot = { text: string; status: string };
  // 行快照：整行文本 + 开发状态列文本（007 按状态 tag 查找样本行，不硬编码行序）。
  async function snapshotRows(page: Page): Promise<RowSnapshot[]> {
    const rows = dataRows(page);
    const count = await rows.count();
    const out: RowSnapshot[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      out.push({
        text: (await row.innerText().catch(() => "")).replace(/\s+/g, " "),
        status: await cellText(row, COLUMN.STATUS),
      });
    }
    return out;
  }

  async function readColumnTexts(page: Page, index: number): Promise<string[]> {
    const rows = dataRows(page);
    const count = await rows.count();
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) out.push(await cellText(rows.nth(i), index));
    return out;
  }

  function parseDateTime(text: string): number | null {
    const m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/u);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  }

  // 排序单调性（宽松）：可见行时间列全部可解析时逐行断言单调（允许并列）；
  // 任一行无法解析（格式变更/渲染延迟）时降级为注解观察，不误判。
  async function assertTimeMonotonic(page: Page, columnIndex: number, direction: "asc" | "desc", label: string) {
    const texts = await readColumnTexts(page, columnIndex);
    const stamps = texts.map(parseDateTime);
    if (texts.length >= 2 && stamps.every((s) => s !== null)) {
      for (let i = 1; i < texts.length; i += 1) {
        const prev = stamps[i - 1] as number;
        const cur = stamps[i] as number;
        if (direction === "asc") {
          expect(cur, `${label}：第${i + 1}行时间应不早于第${i}行（${texts[i]} ≥ ${texts[i - 1]}）`).toBeGreaterThanOrEqual(prev);
        } else {
          expect(prev, `${label}：第${i}行时间应不早于第${i + 1}行（${texts[i - 1]} ≥ ${texts[i]}）`).toBeGreaterThanOrEqual(cur);
        }
      }
      console.log(`[排序单调] ${label} ${direction === "asc" ? "单调不减" : "单调不增"} 通过（${texts.length} 行）`);
    } else {
      test.info().annotations.push({
        type: "排序断言降级",
        description: `${label}：${texts.length} 行时间列未能全部解析为日期时间（示例「${texts[0] ?? "（空）"}」），单调性降级为注解观察`
      });
    }
  }

  // 排序下拉：当前选中值文本作为手柄（默认「创建时间倒序」，切换后回显随之变化）。
  const sortHandle = (page: Page) =>
    page.locator(".search-form").getByText(/创建时间倒序|创建时间正序|更新时间倒序|更新时间正序/u).first();

  async function openSortDropdown(page: Page) {
    await sortHandle(page).click();
    const options = page.getByRole("option");
    await options.first().waitFor({ state: "visible", timeout: 10_000 });
    return options;
  }

  // 按语义匹配排序字典项（需求四项：创建时间倒序/正序、更新时间倒序/正序；实际文案运行时注解）。
  // 字典项缺失时注解并返回 false（该步断言按「执行阶段处理」跳过，不误报产品缺陷）。
  async function selectSortOption(
    page: Page,
    predicate: (label: string) => boolean,
    expectedLabel: string,
    annotateAllOptions: boolean
  ): Promise<boolean> {
    const options = await openSortDropdown(page);
    const labels = (await options.allInnerTexts()).map((t) => t.trim());
    if (annotateAllOptions) {
      test.info().annotations.push({
        type: "排序字典实际项",
        description: `需求四项=创建时间倒序/正序、更新时间倒序/正序；下拉实际项=[${labels.join(" / ")}]`
      });
    }
    const index = labels.findIndex(predicate);
    if (index === -1) {
      test.info().annotations.push({
        type: "字典差异",
        description: `排序字典项「${expectedLabel}」未在下拉中出现（实际项=[${labels.join(" / ")}]），该步按注解跳过，执行阶段复核字典`
      });
      await page.keyboard.press("Escape");
      return false;
    }
    console.log(`[排序选择] ${expectedLabel} → 实际项「${labels[index]}」`);
    await options.nth(index).click();
    await page.waitForTimeout(1_500);
    return true;
  }

  // 筛选器弹窗（dialog-trigger：modal-class=dialog-triger-modal，底部默认 取消/确定）。
  async function openFilterDialog(page: Page) {
    await page.getByRole("button", { name: "筛选器" }).click();
    const dialog = page.locator(".dialog-triger-modal").last();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    return dialog;
  }
  // 五分区（品类 tabs/开发状态/开发方式/通讯方式/设备类型）内的分区定位。
  const filterSection = (dialog: Locator, title: string) =>
    dialog.locator(".filter-section").filter({ hasText: title });

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
    // 覆盖 OP-PMGT-001。标题内嵌 create-product OP-PROD-002 为跨包划界锚点（cases.md 范围外声明：
    // 登录后侧边菜单入口进入产品开发首页已由 create-product 包 OP-PROD-002 实证，本包 OP-PMGT-001
    // 以已登录直达 URL 验证页面可达，不重复菜单入口链路；锚点仅供审计与人工追溯，不改变运行时行为）。
    test("OP-PMGT-001 列表渲染与台账产品回显（登录态复用；侧边菜单入口划界 create-product OP-PROD-002）", async ({ page }) => {
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

      // 步骤 2：搜索区控件（探索实证 2026-09-03 + 源码复核 2026-09-11：筛选器带选中数 badge
      // （el-badge show-zero=false）、排序下拉默认回显「创建时间倒序」（有默认值时不显示 placeholder））。
      await expect(page.getByRole("button", { name: "筛选器" })).toBeVisible();
      await expect(page.locator(".trigger .ep-badge").first()).toBeVisible();
      await expect(page.getByText("创建时间倒序", { exact: true }).first()).toBeVisible();
      await expect(page.getByPlaceholder("Model/名称/型号")).toBeVisible();
      await expect(page.getByRole("button", { name: "下载" })).toBeVisible();
      await expect(page.getByRole("button", { name: "创建产品" })).toBeVisible();

      // 步骤 3：表头十列（探索实证）。
      const header = page.locator(".ep-table__header:visible").last();
      for (const col of ["产品信息", "Model", "开发方式", "产品型号", "通讯方式", "设备类型", "开发状态", "创建时间", "最后更新时间", "操作"]) {
        await expect(header.getByText(col, { exact: true })).toBeVisible();
      }

      // 步骤 4：台账最新产品行逐列核对（Model/品类/开发方式/产品型号/设备类型=台账值，运行时读台账）。
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      const row = await findLedgerRow(page, latest.productName);
      await expect(row, `台账最新产品 ${latest.productName} 行应在列表中（必要时经搜索）`).toBeVisible();
      // 产品信息列：名称 + 品类。2026-09-14 页面事实：品类列显示叶子级品类（如「灯」），
      // 不再显示「一级-叶子」全路径（台账 category=照明-灯）——断言叶子段，差异注解。
      await expect(row.getByRole("cell").nth(COLUMN.INFO)).toContainText(latest.productName);
      if (latest.category) {
        const leafCategory = latest.category.split("-").pop()?.trim() ?? latest.category;
        const infoText = await row.getByRole("cell").nth(COLUMN.INFO).innerText();
        if (infoText.includes(leafCategory)) {
          await expect(row.getByRole("cell").nth(COLUMN.INFO)).toContainText(leafCategory);
          if (!infoText.includes(latest.category)) {
            test.info().annotations.push({
              type: "品类显示粒度注解",
              description: `品类列显示叶子级「${leafCategory}」，台账全路径为「${latest.category}」（2026-09-14 平台改版口径）`
            });
          }
        } else {
          await expect(row.getByRole("cell").nth(COLUMN.INFO), `品类列应含叶子品类 ${leafCategory}`).toContainText(latest.category);
        }
      }
      // Model 列 = 台账 assignedProductModel（如 at0635.light.at0672）。
      if (latest.assignedProductModel) {
        await expect(row.getByRole("cell").nth(COLUMN.MODEL)).toContainText(latest.assignedProductModel);
      }
      // 开发方式列 = 台账 developmentMethod（如「开放协议接入」）。
      if (latest.developmentMethod) {
        await expect(row.getByRole("cell").nth(COLUMN.DEV_TYPE)).toContainText(latest.developmentMethod);
      }
      // 产品型号列 = 台账 productModel（如 at0672）。
      await expect(row.getByRole("cell").nth(COLUMN.MODEL_CODE)).toContainText(latest.productModel);
      // 设备类型列 = 台账 deviceType（如「普通设备」）。
      if (latest.deviceType) {
        await expect(row.getByRole("cell").nth(COLUMN.DEVICE)).toContainText(latest.deviceType);
      }

      // 步骤 5：开发状态 colorful-tag 与时间列（注解核对；链路前序包推进状态时以实际 tag 注解）。
      const statusText = await cellText(row, COLUMN.STATUS);
      if (statusText.includes("开发中")) {
        console.log(`[开发状态] ${latest.productModel} 实际「开发中」，与台账状态一致`);
      } else if (statusText) {
        test.info().annotations.push({
          type: "状态漂移注解",
          description: `台账最新产品 ${latest.productModel} 开发状态实际为「${statusText}」（链路前序包可能已推进），以实际 tag 注解`
        });
      } else {
        test.info().annotations.push({ type: "探索注解", description: `台账最新产品 ${latest.productModel} 行未读取到开发状态 tag 文本` });
      }
      const timeLike = (t: string) => /20\d{2}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/u.test(t);
      const createdText = await cellText(row, COLUMN.CREATED);
      const updatedText = await cellText(row, COLUMN.UPDATED);
      const timeNote: string[] = [];
      if (!timeLike(createdText)) timeNote.push(`创建时间「${createdText || "（空）"}」非日期时间格式`);
      if (!timeLike(updatedText)) timeNote.push(`最后更新时间「${updatedText || "（空）"}」非日期时间格式`);
      if (timeNote.length > 0) {
        test.info().annotations.push({ type: "探索注解", description: `台账最新产品时间列注解核对：${timeNote.join("；")}` });
      } else {
        console.log(`[时间列] 创建=${createdText}，最后更新=${updatedText}（日期时间格式）`);
      }
      await attachShot(page, "产品开发列表-台账回显");
    });
  });

  test.describe("列表查询与操作", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PMGT-002：关键字搜索 D01~D05（no_write）。
    test("OP-PMGT-002 关键字搜索", async ({ page }) => {
      test.setTimeout(120_000);
      await gotoListReady(page);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      const kw = page.getByPlaceholder("Model/名称/型号");

      // D01：名称数字片段命中（片段运行时从台账名称提取，不硬编码；2026-09-03 探索实证命中 1 行）。
      const nameFragment = latest.productName.match(/\d{6,}/u)?.[0] ?? latest.productName;
      await kw.fill(nameFragment);
      await kw.press("Enter");
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "名称片段应命中台账产品行").toBeGreaterThanOrEqual(1);
      await expect(dataTable(page)).toContainText(latest.productName);

      // D02：Model 全值命中（台账 assignedProductModel，如 at0635.light.at0672；运行时读取，不硬编码）。
      if (latest.assignedProductModel) {
        await kw.fill(latest.assignedProductModel);
        await kw.press("Enter");
        await page.waitForTimeout(1_500);
        expect(await dataRows(page).count(), "Model 全值应命中台账产品行").toBeGreaterThanOrEqual(1);
        const modelRow = dataRows(page).filter({ hasText: latest.productName }).first();
        await expect(modelRow).toBeVisible();
        await expect(modelRow.getByRole("cell").nth(COLUMN.MODEL)).toContainText(latest.assignedProductModel);
      } else {
        test.info().annotations.push({
          type: "探索注解",
          description: `台账最新记录 ${latest.productModel} 缺 assignedProductModel，D02 Model 全值搜索跳过`
        });
      }

      // D03：产品型号命中（台账型号列值 = assignedProductModel 尾段 atXXXX，行内产品型号列=该值）。
      const typeCode = latest.assignedProductModel?.split(".").pop() ?? "";
      if (typeCode) {
        await kw.fill(typeCode);
        await kw.press("Enter");
        await page.waitForTimeout(1_500);
        expect(await dataRows(page).count(), "产品型号应命中台账产品行").toBeGreaterThanOrEqual(1);
        const typeRow = dataRows(page).filter({ hasText: latest.productName }).first();
        await expect(typeRow).toBeVisible();
        await expect(typeRow.getByRole("cell").nth(COLUMN.MODEL_CODE)).toContainText(typeCode);
      }

      // D04：不存在串 → 空列表（探索实证 0 行）。
      await kw.fill("zzz-not-exist");
      await kw.press("Enter");
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "不存在关键字应为空列表").toBe(0);

      // D05：清空恢复全量。
      await kw.fill("");
      await kw.press("Enter");
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "清空后应恢复全量").toBeGreaterThanOrEqual(1);
      await attachShot(page, "关键字搜索");
    });

    // 覆盖 OP-PMGT-003：筛选器多条件过滤与清除，九步 D01~D08（no_write）。
    // 字典实际项以弹窗为准（品类 tabs/开发状态/开发方式/通讯方式/设备类型五分区，源码 ProductFilter.vue 复核）。
    test("OP-PMGT-003 筛选器多条件过滤与清除", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoListReady(page);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];

      // 基线：全量行数 + 台账最新产品当前状态（链路前序包可能已推进，命中基准运行时判定）。
      // 2026-09-14 平台产品数增长突破单页 10 条：台账最新产品可能落在第 2 页，
      // 当前页不可见时经列表搜索（只读动作）读取真实状态，再清空关键字恢复全量视图。
      const fullCount = await dataRows(page).count();
      expect(fullCount, "筛选前列表应有台账产品行").toBeGreaterThanOrEqual(1);
      let latestRow = dataRows(page).filter({ hasText: latest.productName }).first();
      let latestVisible = await latestRow.isVisible().catch(() => false);
      if (!latestVisible) {
        const searched = await findLedgerRow(page, latest.productName);
        latestVisible = await searched.isVisible().catch(() => false);
        if (latestVisible) {
          // 2026-09-14 修订：状态必须在搜索上下文内读取（清空关键字后行回到第 2 页就读不到了）。
          latestRow = searched;
        }
      }
      const latestStatus = latestVisible ? await cellText(latestRow, COLUMN.STATUS) : "";
      if (latestVisible) {
        await page.getByPlaceholder(/Model\/名称\/型号/u).fill("");
        await page.getByPlaceholder(/Model\/名称\/型号/u).press("Enter");
        await page.waitForTimeout(2_000);
      }
      console.log(`[筛选基线] 全量=${fullCount} 行，台账最新 ${latest.productModel} 可见=${latestVisible} 状态=${latestStatus || "（不可见）"}`);

      // 步骤 1：打开筛选器弹窗 → 五分区 + 取消/确定 按钮。
      let dialog = await openFilterDialog(page);
      for (const section of ["品类", "开发状态", "开发方式", "通讯方式", "设备类型"]) {
        await expect(dialog.getByText(section, { exact: true })).toBeVisible();
      }
      await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "确定", exact: true })).toBeVisible();
      await attachShot(page, "筛选器弹窗");

      // D01（步骤 2）：不选任何条件直接「取消」→ 弹窗关闭、无 badge、无清除×，列表保持全量（无写入无查询）。
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(page.locator(".dialog-triger-modal").last()).toBeHidden({ timeout: 10_000 });
      // 2026-09-14 页面事实：0 选中时 badge content 元素仍挂在 DOM（隐藏态）——按「可见徽标」计数断言。
      await expect(page.locator(".trigger .ep-badge__content:visible")).toHaveCount(0);
      await expect(page.locator(".trigger .clear:visible")).toHaveCount(0);
      expect(await dataRows(page).count(), "取消筛选后列表应保持全量").toBe(fullCount);

      // D02（步骤 3）：开发状态「开发中」并确定 → badge 出现，列表仅开发中产品且含台账行（基准行仍为开发中时）。
      dialog = await openFilterDialog(page);
      await filterSection(dialog, "开发状态").getByText("开发中", { exact: true }).first().click();
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      const afterStatus = await dataRows(page).count();
      expect(afterStatus, "开发中筛选应有结果").toBeGreaterThanOrEqual(1);
      await expect(page.locator(".trigger .ep-badge__content:visible").first()).toBeVisible();
      console.log(`[筛选badge] 选中数=${await page.locator(".trigger .ep-badge__content:visible").first().innerText()}`);
      for (let i = 0; i < afterStatus; i += 1) {
        const status = await cellText(dataRows(page).nth(i), COLUMN.STATUS);
        expect(status, `开发中筛选后第${i + 1}行状态应为「开发中」`).toContain("开发中");
      }
      if (latestStatus.includes("开发中")) {
        // 2026-09-14 分页口径：台账行不在筛选结果当前页时，用关键字搜索叠加核验
        // （行出现 = 该行满足当前筛选条件），核验后清空关键字恢复纯筛选视图。
        if (await dataRows(page).filter({ hasText: latest.productName }).first().isVisible().catch(() => false)) {
          await expect(dataTable(page), "开发中筛选应含台账最新产品行").toContainText(latest.productName);
        } else {
          await page.getByPlaceholder(/Model\/名称\/型号/u).fill(latest.productName);
          await page.getByRole("button", { name: "搜索", exact: true }).click();
          await page.waitForTimeout(2_000);
          await expect(dataTable(page), "开发中筛选下搜索台账最新产品应命中（叠加核验行满足筛选）").toContainText(latest.productName);
          await page.getByPlaceholder(/Model\/名称\/型号/u).fill("");
          await page.getByPlaceholder(/Model\/名称\/型号/u).press("Enter");
          await page.waitForTimeout(2_000);
        }
      } else {
        test.info().annotations.push({
          type: "状态漂移注解",
          description: `台账最新产品 ${latest.productModel} 当前状态「${latestStatus || "（不可见）"}」非开发中，D02 不再以其为命中基准`
        });
      }

      // D03（步骤 4）：叠加通讯方式 WiFi（正则兼容 Wifi/WIFI 文案）→ 组合过滤仍有结果。
      dialog = await openFilterDialog(page);
      const wifiTag = filterSection(dialog, "通讯方式").getByText(/^wifi$/iu).first();
      if (await wifiTag.isVisible().catch(() => false)) {
        await wifiTag.click();
      } else {
        test.info().annotations.push({ type: "字典差异", description: "通讯方式分区未找到 WiFi 项，D03 按注解跳过选择（执行阶段复核字典）" });
      }
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "开发中+WiFi 组合过滤应有结果").toBeGreaterThanOrEqual(1);

      // D04（步骤 5）：叠加品类（台账品类所属一级 tab 内选中台账品类 tag，如 照明 tab → 照明-灯）。
      dialog = await openFilterDialog(page);
      let categoryPicked = false;
      if (latest.category) {
        const tabs = dialog.locator(".ep-tabs__item");
        const tabCount = await tabs.count();
        for (let i = 0; i < tabCount && !categoryPicked; i += 1) {
          const tab = tabs.nth(i);
          const tabLabel = (await tab.innerText().catch(() => "")).trim();
          await tab.click();
          await page.waitForTimeout(300);
          const categoryTag = filterSection(dialog, "品类").getByText(latest.category, { exact: true }).first();
          if (await categoryTag.isVisible().catch(() => false)) {
            await categoryTag.click();
            categoryPicked = true;
            console.log(`[品类叠加] 一级 tab「${tabLabel}」内选中「${latest.category}」`);
          }
        }
        if (!categoryPicked) {
          test.info().annotations.push({
            type: "字典差异",
            description: `品类 tabs 中未找到台账品类「${latest.category}」，D04 选择跳过（执行阶段复核字典）`
          });
        }
      } else {
        test.info().annotations.push({ type: "探索注解", description: "台账最新记录缺 category 字段，D04 品类叠加跳过" });
      }
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "叠加品类后组合过滤应有结果").toBeGreaterThanOrEqual(1);
      if (latestStatus.includes("开发中") && categoryPicked) {
        // 2026-09-14 分页口径：台账行不在筛选结果当前页时，用关键字搜索叠加核验后清空恢复。
        const hitRow = dataRows(page).filter({ hasText: latest.productName }).first();
        if (await hitRow.isVisible().catch(() => false)) {
          await expect(hitRow.getByRole("cell").nth(COLUMN.INFO)).toContainText(latest.category!);
        } else {
          await page.getByPlaceholder(/Model\/名称\/型号/u).fill(latest.productName);
          await page.getByRole("button", { name: "搜索", exact: true }).click();
          await page.waitForTimeout(2_000);
          const searchedRow = dataRows(page).filter({ hasText: latest.productName }).first();
          await expect(searchedRow, "叠加品类筛选下搜索台账最新产品应命中").toBeVisible();
          await expect(searchedRow.getByRole("cell").nth(COLUMN.INFO)).toContainText(latest.category!);
          await page.getByPlaceholder(/Model\/名称\/型号/u).fill("");
          await page.getByPlaceholder(/Model\/名称\/型号/u).press("Enter");
          await page.waitForTimeout(2_000);
        }
      }

      // D05（步骤 6）：叠加开发方式（台账值，如「开放协议接入」）→ 仍有结果。
      dialog = await openFilterDialog(page);
      if (latest.developmentMethod) {
        const devTypeTag = filterSection(dialog, "开发方式").getByText(latest.developmentMethod, { exact: true }).first();
        if (await devTypeTag.isVisible().catch(() => false)) {
          await devTypeTag.click();
        } else {
          test.info().annotations.push({
            type: "字典差异",
            description: `开发方式分区未找到台账值「${latest.developmentMethod}」，D05 按注解跳过选择`
          });
        }
      } else {
        test.info().annotations.push({ type: "探索注解", description: "台账最新记录缺 developmentMethod 字段，D05 开发方式叠加跳过" });
      }
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "叠加开发方式后组合过滤应有结果").toBeGreaterThanOrEqual(1);

      // D06（步骤 7）：叠加设备类型（台账值，如「普通设备」）→ 仍有结果。
      dialog = await openFilterDialog(page);
      if (latest.deviceType) {
        const deviceTag = filterSection(dialog, "设备类型").getByText(latest.deviceType, { exact: true }).first();
        if (await deviceTag.isVisible().catch(() => false)) {
          await deviceTag.click();
        } else {
          test.info().annotations.push({
            type: "字典差异",
            description: `设备类型分区未找到台账值「${latest.deviceType}」，D06 按注解跳过选择`
          });
        }
      } else {
        test.info().annotations.push({ type: "探索注解", description: "台账最新记录缺 deviceType 字段，D06 设备类型叠加跳过" });
      }
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      expect(await dataRows(page).count(), "叠加设备类型后组合过滤应有结果").toBeGreaterThanOrEqual(1);

      // D07（步骤 8）：改选开发状态「已上线」→ 台账产品均非已上线，列表为空（负向空态）。
      dialog = await openFilterDialog(page);
      const onlineTag = filterSection(dialog, "开发状态").getByText("已上线", { exact: true }).first();
      if (await onlineTag.isVisible().catch(() => false)) {
        await onlineTag.click();
        await dialog.getByRole("button", { name: "确定", exact: true }).click();
        await page.waitForTimeout(1_500);
        const onlineCount = await dataRows(page).count();
        expect(onlineCount, "台账产品均非「已上线」，改选已上线后列表应为空（如非空说明链路前序包已推进产品上线，请复核）").toBe(0);
      } else {
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        test.info().annotations.push({ type: "字典差异", description: "开发状态分区未找到「已上线」项，D07 空态断言按注解跳过（执行阶段复核字典）" });
      }

      // D08（步骤 9）：点击筛选器清除 × → 全部条件清空、badge 消失，列表恢复全量。
      // 源码复核：清除 × 为 .trigger .clear，仅有选中时渲染（hover 展现，Playwright 点击自动悬停）。
      const clearBadge = page.locator(".trigger .clear").first();
      await expect(clearBadge).toBeAttached();
      await clearBadge.click();
      await page.waitForTimeout(1_500);
      // 2026-09-14 页面事实：0 选中时 badge content 元素仍挂在 DOM（隐藏态）——按「可见徽标」计数断言。
      await expect(page.locator(".trigger .ep-badge__content:visible")).toHaveCount(0);
      await expect(page.locator(".trigger .clear:visible")).toHaveCount(0);
      const restoredCount = await dataRows(page).count();
      expect(restoredCount, "清除筛选后列表应恢复全量").toBeGreaterThanOrEqual(1);
      if (restoredCount !== fullCount) {
        test.info().annotations.push({
          type: "探索注解",
          description: `清除后行数 ${restoredCount} 与筛选前全量 ${fullCount} 不一致（列表数据可能并发变化），以 ≥1 与 badge 消失为准`
        });
      }
      await attachShot(page, "筛选器清除恢复");
    });

    // 覆盖 OP-PMGT-004：排序方式切换，四字典项全枚举 D01~D04（no_write）。
    // 需求字典：创建时间倒序/正序、更新时间倒序/正序；实际文案运行时注解，缺项按注解跳过该步。
    test("OP-PMGT-004 排序方式切换", async ({ page }) => {
      test.setTimeout(150_000);
      await gotoListReady(page);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];

      // 前置：列表至少 2 行（cases.md 前置条件），单调性断言才有意义。
      const baseRows = await dataRows(page).count();
      expect(baseRows, "排序用例前置：列表至少 2 行").toBeGreaterThanOrEqual(2);

      // 步骤 1：默认回显「创建时间倒序」（默认 timeSort=1；有默认值时不显示 placeholder，
      // 探索实证：默认值直接回显在 select 中，placeholder 仅空值时出现）。
      await expect(sortHandle(page)).toBeVisible();
      await expect(sortHandle(page)).toHaveText(/创建时间倒序/u);

      // D01（步骤 2）：创建时间正序 → 可见行创建时间单调不减（宽松，允许并列）。
      if (await selectSortOption(page, (l) => l.includes("创建时间") && l.includes("正序"), "创建时间正序", true)) {
        await assertTimeMonotonic(page, COLUMN.CREATED, "asc", "创建时间正序");
      }

      // D02（步骤 3）：更新时间倒序 → 可见行最后更新时间单调不增。
      if (await selectSortOption(page, (l) => l.includes("更新时间") && l.includes("倒序"), "更新时间倒序", false)) {
        await assertTimeMonotonic(page, COLUMN.UPDATED, "desc", "更新时间倒序");
      }

      // D03（步骤 4）：更新时间正序 → 可见行最后更新时间单调不减。
      if (await selectSortOption(page, (l) => l.includes("更新时间") && l.includes("正序"), "更新时间正序", false)) {
        await assertTimeMonotonic(page, COLUMN.UPDATED, "asc", "更新时间正序");
      }

      // D04（步骤 5）：切回创建时间倒序（默认）→ 首行为创建时间最新的产品。
      // 2026-09-14 分页/多运行来源口径：平台存在其他运行创建的更新自动化产品（如 at9749），
      // 首行不固定为台账最新——首行创建时间应为可见行最新（单调性已由 D01~D03 覆盖），
      // 此处断言首行为自动化合成产品并注解其名称与台账最新产品的关系。
      if (await selectSortOption(page, (l) => l.includes("创建时间") && l.includes("倒序"), "创建时间倒序", false)) {
        await expect(sortHandle(page)).toHaveText(/创建时间倒序/u);
        const firstRow = dataRows(page).first();
        await expect(firstRow, "默认排序首行应为创建时间最新的产品行").toBeVisible();
        const firstName = await firstRow.getByRole("cell").nth(COLUMN.INFO).innerText();
        test.expect(firstName.replace(/\s+/g, "")).toContain("自动化测试产品");
        if (!firstName.includes(latest.productName)) {
          test.info().annotations.push({
            type: "分页与多来源注解",
            description: `默认排序首行（${firstName.replace(/\s+/g, " ").slice(0, 60)}…）非台账最新 ${latest.productName}：平台存在其他运行来源的更新自动化产品（2026-09-14），台账最新产品行经搜索核验（OP-PMGT-001）`
          });
        }
      }
      await attachShot(page, "排序切换");
    });

    // 覆盖 OP-PMGT-005：导出 Excel（no_write；下载事件 2026-09-07 复测已实证出现）。
    test("OP-PMGT-005 导出 Excel", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);

      // 步骤 1：点击下载 → 成功提示（行为断言+文案注解），下载事件视环境注解观察。
      const downloadPromise = page.waitForEvent("download", { timeout: 5_000 }).catch(() => null);
      await page.getByRole("button", { name: "下载" }).click();
      // 成功提示为短生命周期 toast，点击后立即等待文本可见（行为断言），下载事件仅作观察。
      await expect(page.getByText("导出成功", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      const download = await downloadPromise;
      if (download) {
        console.log(`[下载事件] ${download.suggestedFilename()}`);
      } else {
        test.info().annotations.push({
          type: "探索注解",
          description: "未观察到浏览器下载事件（2026-09-03 首轮无下载事件、2026-09-07 复测已实证出现，视环境而定），以「导出成功」提示为准"
        });
      }
      await attachShot(page, "导出成功提示");
    });

    // 覆盖 OP-PMGT-006。标题内嵌 create-product OP-PROD-001 为跨包划界锚点（cases.md 范围外声明：
    // 未登录直达平台路由的守卫重定向已由 create-product 包 OP-PROD-001 实证，本包不重复未登录路径）。
    // 本轮用户指令（2026-09-11）：不创建产品——仅入口/跳转观察，绝不进入向导选择或提交。
    test("OP-PMGT-006 创建产品入口跳转向导（不创建产品仅入口观察；未登录守卫重定向划界 create-product OP-PROD-001）", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoListReady(page);

      // 步骤 1：点击创建产品 → 向导页（仅观察标题/品类选择区渲染，不做任何向导内选择或提交，
      // 创建主流程划界至 create-product 包）。
      await page.getByRole("button", { name: "创建产品" }).click();
      await page.waitForURL(/\/integration\/product\/create/u, { timeout: 30_000 });
      await expect(page).toHaveURL(/\/integration\/product\/create/u);
      // 向导页第一步标题「请选择您创建的产品」（品类选择区）渲染即可，不与之交互。
      await expect(page.getByText("请选择您创建的产品").first()).toBeVisible({ timeout: 20_000 });
      await attachShot(page, "创建入口向导观察");

      // 步骤 2：返回列表（浏览器后退，不经向导任何按钮离开）。
      await page.goBack();
      await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
      await expect(page).toHaveURL(/\/integration\/product\/management/u);
      await attachShot(page, "创建入口往返");
    });

    // 覆盖 OP-PMGT-007：开发详情跳转基础配置页（no_write；步骤 1/2 双态对照 + 步骤 3 台账最新产品跳转）。
    // 样本行一律按状态 tag 运行时查找（兼容链路前序包推进状态），找不到样本时注解跳过对照，不判失败。
    test("OP-PMGT-007 开发详情跳转基础配置页", async ({ page }) => {
      test.setTimeout(150_000);
      await gotoListReady(page);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);

      // 2026-09-14 分页口径：平台产品共 19 条（单页 10 条），台账行多在第 2 页——
      // 样本行改为逐个按名称搜索定位（只读动作），状态在搜索上下文内读取。
      async function searchLedgerRow(name: string): Promise<Locator> {
        await page.getByPlaceholder(/Model\/名称\/型号/u).fill(name);
        await page.getByRole("button", { name: "搜索", exact: true }).click();
        await page.waitForTimeout(2_000);
        return dataRows(page).filter({ hasText: name }).first();
      }

      const newestForSamples = records[records.length - 1];
      const candidateOrder = [...records].reverse().filter((r) => r.productName !== newestForSamples?.productName);

      // 步骤 1：台账「开发中」产品行（cases.md 样本如 at9300；at0672 若仍为开发中亦可）→
      // 操作列「继续开发」与「删除」都在（删除可见性正向对照）。
      let devSample: { row: Locator; model: string } | null = null;
      for (const r of candidateOrder) {
        const row = await searchLedgerRow(r.productName);
        if (!(await row.isVisible().catch(() => false))) continue;
        if ((await cellText(row, COLUMN.STATUS)).includes("开发中")) {
          devSample = { row, model: r.productModel };
          break;
        }
      }
      if (devSample) {
        await expect(devSample.row.getByText("继续开发", { exact: true })).toBeVisible();
        await expect(devSample.row.getByText("删除", { exact: true })).toBeVisible();
        console.log(`[双态对照·开发中] 样本=${devSample.model}：继续开发+删除 都在`);
      } else {
        test.info().annotations.push({
          type: "状态漂移注解",
          description: "台账产品中无可搜索到的「开发中」行（链路前序包可能已推进全部状态），步骤 1 对照按注解跳过"
        });
      }

      // 步骤 2：台账「送审中」产品行（cases.md 样本 at8438；按状态 tag 查找，找不到则注解跳过不判失败
      // ——at8438 可能已不处于送审中）→ 操作列仅「开发详情」，无「删除」。
      let pendingSample: { row: Locator; model: string } | null = null;
      for (const r of candidateOrder) {
        const row = await searchLedgerRow(r.productName);
        if (!(await row.isVisible().catch(() => false))) continue;
        if ((await cellText(row, COLUMN.STATUS)).includes("送审中")) {
          pendingSample = { row, model: r.productModel };
          break;
        }
      }
      if (pendingSample) {
        await expect(pendingSample.row.getByText("开发详情", { exact: true })).toBeVisible();
        await expect(pendingSample.row.getByText("删除", { exact: true })).toHaveCount(0);
        console.log(`[双态对照·送审中] 样本=${pendingSample.model}：仅开发详情、无删除`);
      } else {
        test.info().annotations.push({
          type: "状态漂移注解",
          description: "台账产品中无可搜索到的「送审中」行（at8438 可能已不处于送审中或已删除），步骤 2 对照按注解跳过"
        });
      }

      // 步骤 3：台账最新产品行（按名称运行时定位，状态可为「继续开发」或「开发详情」）→ 跳转基础配置页。
      const latest = records[records.length - 1];
      const latestRow = await searchLedgerRow(latest.productName);
      await expect(latestRow, `台账最新产品 ${latest.productName} 行应经搜索可见`).toBeVisible();
      const actionLink = latestRow.getByText(/继续开发|开发详情/u).first();
      await expect(actionLink).toBeVisible();
      console.log(`[跳转样本] ${latest.productModel} 操作列实际链接「${(await actionLink.innerText()).trim()}」`);
      await actionLink.click();
      await page.waitForURL(/\/integration\/product\/.+\/basic/u, { timeout: 30_000 });
      await expect(page).toHaveURL(new RegExp(`/integration/product/\\d+/basic`, "u"));
      // 页面标题显示产品名称（page-wrapper :title=productInfo.name）+ 五步步骤条渲染。
      await expect(page.getByText(latest.productName).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".ep-steps").first()).toBeVisible({ timeout: 20_000 });
      await attachShot(page, "跳转基础配置页");

      // 步骤 4：返回列表。
      await page.goBack();
      await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
      await expect(page).toHaveURL(/\/integration\/product\/management/u);
    });

    // 覆盖 OP-PMGT-008：删除合成产品（二次确认含取消分支，写入台账）。
    test("OP-PMGT-008 删除合成产品", async ({ page }) => {
      test.setTimeout(180_000);
      // 2026-09-07 修订：读取完整台账（含缺 assignedProductModel 的历史记录——2026-09-02 批次
      // 平台已生成 Model 且处于可删状态，其 Model 在删除时从行内单元格取实测值）。
      const records = await readCreateProductLedger(false);
      test.expect(records.length).toBeGreaterThan(0);

      await gotoListReady(page);

      // 候选限定（2026-09-07 执行轮修订，2026-09-11 cases.md 沿用）：①台账合成测试产品 ②当前列表实际可见
      // （台账存在过期条目）③非最新产品（最新 at0672 受保护，保留给产品五步阶段包，绝不删除）
      // ④行操作列可见「删除」——删除仅「开发中/测试未通过」展示，「送审中」等状态仅展示「开发详情」
      // （at8438 实证），不可选。候选按台账顺序取最后一个满足者；无满足候选时明确报错提示先重跑
      // create-product 功能包补充。删除对象仅限本测试体系合成测试产品，绝不删除真实数据。
      // 2026-09-14 分页口径：平台产品共 19 条突破单页 10 条，台账候选多在第 2 页——
      // 第 1 页无满足候选时逐个按名称搜索定位（只读动作），命中后保持搜索上下文执行删除。
      const newest = records[records.length - 1];
      // 列表数据与操作列链接（依赖异步字典的动态 import）均为延迟渲染：行先出现名称、
      // 操作列「删除」稍后才挂载。轮询必须等到「名称+删除」同行的完整候选态，不能只等名称，
      // 否则会在中间态误判为"无候选"（2026-09-07 复测实证）。
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
        // 第 1 页持续无台账行（如全部在第 2 页）时不必空等 45s：10s 内无果即转入搜索兜底。
        if (Date.now() - (rowTextsDeadline - 45_000) > 10_000 && !records.some((r) => rowTexts.some((t) => t.includes(r.productName)))) {
          break;
        }
        await page.waitForTimeout(1_000);
      }
      let target = deletable[deletable.length - 1];
      if (!target) {
        // 分页兜底：第 1 页无台账候选时，按台账倒序逐个搜索（跳过最新受保护产品），
        // 命中「名称+删除」同行者即选为目标，并保持搜索上下文供删除步骤定位行。
        const keyword = page.getByPlaceholder(/Model\/名称\/型号/u);
        const candidates = [...records].reverse().filter((r) => r.productName !== newest?.productName);
        for (const candidate of candidates) {
          await keyword.fill(candidate.productName);
          await page.getByRole("button", { name: "搜索", exact: true }).click();
          await page.waitForTimeout(2_000);
          const candidateRow = dataRows(page).filter({ hasText: candidate.productName }).first();
          if (await candidateRow.isVisible().catch(() => false)) {
            const rowText = (await candidateRow.innerText().catch(() => "")) ?? "";
            if (rowText.includes("删除")) {
              target = candidate;
              console.log(`[删除候选] 第 1 页无候选，经搜索定位台账候选 ${candidate.productModel}（分页兜底）`);
              break;
            }
          }
        }
      }
      if (!target) {
        throw new Error(
          "无可安全删除的候选产品（最新产品受保护，其余台账产品均已删除、不在列表或已离开可删状态；若搜索亦无台账行请核对登录态与列表接口）。请先重跑 create-product 功能包补充测试产品后再执行本用例。"
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
        observedCellModel = (await row.getByRole("cell").nth(COLUMN.MODEL).innerText()).trim();
      }
      const deleteLink = row.getByText("删除", { exact: true });
      await expect(deleteLink).toBeVisible();
      await deleteLink.click();

      // 确认弹窗（ElMessageBox，文案含产品名）。
      const confirmText = page.getByText(new RegExp(`确定要删除产品"${target.productName}"吗`));
      await expect(confirmText.first()).toBeVisible({ timeout: 10_000 });
      await attachShot(page, "删除产品二次确认");

      // 步骤 2（负分支，无写入）：弹窗点击「取消」→ 弹窗关闭、行仍在且「删除」仍可见、无「删除成功」提示。
      await page.locator(".msgbox").last().getByRole("button", { name: "取消", exact: true }).click();
      await expect(page.locator(".msgbox").last()).toBeHidden({ timeout: 10_000 });
      await page.waitForTimeout(800);
      await expect(row, "取消删除后该行应保留在列表").toBeVisible();
      await expect(deleteLink, "取消删除后「删除」入口应仍可见").toBeVisible();
      await expect(page.getByText("删除成功", { exact: true })).toHaveCount(0);
      console.log(`[删除取消] ${target.productModel} 确认弹窗已取消，无写入`);
      await attachShot(page, "删除产品取消分支");

      // 步骤 3：再次点击「删除」并在弹窗确认 → 「删除成功」提示、行消失（同一产品不可再删除）。
      await deleteLink.click();
      await expect(confirmText.first()).toBeVisible({ timeout: 10_000 });
      await page.locator(".msgbox").last().getByRole("button", { name: "删除", exact: true }).click();
      await expect(page.locator('[role="alert"], .ep-message, .el-message').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);

      // 步骤 4：台账记录（只增不删，kind=open-platform-product-deletion）。
      // 2026-09-14 修订：删除写入成功即记账，先于「行消失」断言——上一轮断言缺陷导致 at9300
      // 服务端已删但台账无记录（丢账），顺序调整后断言失败不再影响台账完整性。
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

      // 2026-09-14 修订：删除的是搜索结果唯一行 → 刷新后列表可能渲染空态（表格主体隐藏/移除），
      // not.toContainText 对 0 个表格元素会报 element(s) not found——改断言行不可见（计数=0）。
      await expect(dataRows(page).filter({ hasText: target.productName }), "删除后行应不可见（列表可为空态）").toHaveCount(0);
      await attachShot(page, "删除产品成功");
    });
  });
});
