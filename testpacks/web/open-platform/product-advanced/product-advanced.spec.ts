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
    // 2026-09-14 平台产品数增长突破单页 10 条（共 19 条）：台账最新产品可能落在第 2 页。
    // 第 1 页未命中时用列表搜索（只读动作）定位，不改变用例断言语义。
    let row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByPlaceholder(/Model\/名称\/型号/u).fill(latest.productName);
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page.waitForTimeout(3_000);
      row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    }
    await expect(row, `台账最新产品 ${latest.productName} 应经列表（必要时搜索）可见`).toBeVisible({ timeout: 20_000 });
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

  /** 子页页脚「返回上一级」按钮（AdvancedConfigContainer footer；role 优先、文本兜底，源码未做 DOM 实证）。 */
  function footerBackButton(page: Page) {
    return page
      .getByRole("button", { name: "返回上一级", exact: true })
      .or(page.locator("main").getByText("返回上一级", { exact: true }));
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PADV-001：卡片列表与文档链接（no_write）。
    // 标题内嵌 create-product OP-PROD-001 为跨包划界锚点（cases.md 范围外声明：未登录直达 /advanced 及子页的
    // 守卫重定向已由 create-product 包 OP-PROD-001 实证，本包不重复执行未登录路径；锚点仅供审计与人工追溯，
    // 不作为可运行用例。写法参照 product-basic 包先例）。
    test("OP-PADV-001 卡片列表与文档链接（登录态复用；未登录直达守卫重定向划界 create-product OP-PROD-001）", async ({ page }) => {
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

      // 步骤 1：进入高级配置页，URL 含 /advanced 且面包屑「高级配置」可见。
      await gotoAdvanced(page, latest);
      await expect(page.url()).toContain("/advanced");
      const bread = page.locator(".advanced-bread");
      await expect(bread).toBeVisible();
      await expect(bread).toContainText("高级配置");

      // 步骤 2：文档提示 + 点我查看（实证：el-link @click 无 href，a11y 树中为文本节点，用文本定位）。
      const main = page.locator("main");
      await expect(main).toContainText("设备开发和高级配置都与产品功能定义有关");
      const docLink = page.getByText("点我查看", { exact: true }).first();
      await expect(docLink).toBeVisible();

      // 步骤 3：点击「点我查看」→ 新标签打开文档中心（window.open _blank，路由 auth:false 只读页）。
      // 断言 URL 含 /service-support/home 且带 product-development 功能定义文档查询参数；原页不受影响；关闭新标签返回。
      const docPagePromise = page.context().waitForEvent("page", { timeout: 15_000 });
      await docLink.click();
      const docPage = await docPagePromise;
      await docPage.waitForURL(/\/service-support\/home/u, { timeout: 30_000 });
      await expect(docPage.url()).toContain("/service-support/home");
      await expect(docPage.url()).toContain("product-development");
      await expect(page.url()).toContain("/advanced");
      await expect(page.locator(".advanced-card-list")).toBeVisible();
      await attachShot(page, "文档中心新窗口");
      await docPage.close();
      test.info().annotations.push({
        type: "探索注解",
        description: "文档中心页 auth:false 免授权只读，仅断言 URL 与关闭返回，无任何写操作"
      });

      // 步骤 4：两张卡片（标题/描述/「可选」徽标/入口箭头）。
      const cardList = page.locator(".advanced-card-list");
      await expect(cardList).toContainText("场景联动配置");
      await expect(cardList).toContainText("消息推送配置");
      await expect(cardList).toContainText("配置产品可支持自动化触发条件和执行条件，请用户搭建智能场景。");
      await expect(cardList).toContainText("配置产品触发特定事件，为用户推送的设备消息。");
      await expect(cardList).toContainText("可选");
      // 卡片入口箭头（AdvancedItemCard footer 渲染为图标；svg/arrow 类元素宽松匹配，每张卡片至少一处）。
      const arrowCount = await cardList.locator("svg, [class*='arrow' i]").count();
      test.expect(arrowCount).toBeGreaterThanOrEqual(2);
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

      // 步骤 1：进入场景联动配置（openCard 内等待描述文案就绪）+ 面包屑。
      await openCard(page, "场景联动配置", "触发条件设置");
      const main = page.locator("main");
      const bread = page.locator(".advanced-bread");
      await expect(bread).toContainText("高级配置");
      await expect(bread).toContainText("场景联动配置");
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

      // 步骤 3：列表状态注解（空态或数据行均可；行级规则为源码注解，样本依赖环境数据）。
      const triggerRows = await page.locator(".trigger-options .ep-table__body:visible tbody tr").count().catch(() => 0);
      const actionRows = await page.locator(".action-options .ep-table__body:visible tbody tr").count().catch(() => 0);
      test.info().annotations.push({
        type: "探索注解",
        description: `触发条件表行数=${triggerRows}，执行动作表行数=${actionRows}（源码规则：「删除」仅对 开发中且自定义 行开放；validFlag=0 失败行红底+警示图标「该场景配置已失败，请立即删除。」，如出现将随截图留档）`
      });

      // 步骤 4：图例区（标题 + 图例图片 + 说明文案；三步说明无源码文案正本，运行时采样注解留档）。
      await expect(main).toContainText("金云智居App自动化场景图例");
      await expect(page.locator("main img").first()).toBeVisible({ timeout: 20_000 });
      const mainText = (await main.innerText().catch(() => "")).replace(/\s+/g, " ");
      const legendIdx = mainText.indexOf("金云智居App自动化场景图例");
      if (legendIdx >= 0) {
        test.info().annotations.push({ type: "探索注解", description: `图例区文案采样：${mainText.slice(legendIdx, legendIdx + 160)}` });
      }
      await attachShot(page, "场景联动页");

      // 步骤 5：页脚按钮组（「返回上一级」+「申请上线」；申请上线不点击，提交流程范围外）。
      const onlineButton = page
        .getByRole("button", { name: "申请上线", exact: true })
        .or(page.locator("main").getByText("申请上线", { exact: true }));
      await expect(footerBackButton(page).first()).toBeVisible();
      await expect(onlineButton.first()).toBeVisible();
      test.info().annotations.push({ type: "探索注解", description: "「申请上线」仅断言在位且不点击（doAction online 提交影响产品生命周期，范围外）" });

      // 步骤 6：点击页脚「返回上一级」回到卡片列表（router.back()，只读导航）。
      await footerBackButton(page).first().click();
      await page.locator(".advanced-card-list").waitFor({ state: "visible", timeout: 20_000 });
      await expect(page.locator(".advanced-card-list")).toContainText("场景联动配置");
      await expect(page.locator(".advanced-card-list")).toContainText("消息推送配置");

      // 步骤 7：再次进入场景联动页并点面包屑「高级配置」逐级返回。
      await openCard(page, "场景联动配置", "触发条件设置");
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

      // 步骤 1：进入消息推送配置（openCard 内等待页头按钮就绪）+ 面包屑。
      await openCard(page, "消息推送配置", "套用模板");
      const main = page.locator("main");
      const bread = page.locator(".advanced-bread");
      await expect(bread).toContainText("高级配置");
      await expect(bread).toContainText("消息推送配置");
      await expect(main).toContainText("配置产品触发特定事件，为用户推送的设备消息。");

      // 步骤 2：操作区按钮可见可点。
      await expect(page.getByRole("button", { name: "套用模板", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "新建推送", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "套用模板", exact: true }).first()).toBeEnabled();
      await expect(page.getByRole("button", { name: "新建推送", exact: true }).first()).toBeEnabled();

      // 步骤 3：表头 + 行级状态注解。
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["消息推送标题", "消息推送内容", "触发条件", "推送方式", "审核状态", "推送间隔", "推送状态", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({
        type: "探索注解",
        description: `消息推送列表行数=${rows}；行内 查看/编辑/删除 与推送状态开关可用性随审核状态变化（源码规则：开关仅审核成功 approveStatus=2 可开、审核中行编辑禁用；行级样本待环境审核状态数据）`
      });
      await attachShot(page, "消息推送页");

      // 步骤 4：点击页脚「返回上一级」回到卡片列表（只读导航）。
      await footerBackButton(page).first().click();
      await page.locator(".advanced-card-list").waitFor({ state: "visible", timeout: 20_000 });
      await expect(page.locator(".advanced-card-list")).toContainText("场景联动配置");
      await expect(page.locator(".advanced-card-list")).toContainText("消息推送配置");

      // 步骤 5：再次进入消息推送页并点面包屑「高级配置」逐级返回。
      await openCard(page, "消息推送配置", "套用模板");
      await backToCards(page);
      await expect(page.locator(".advanced-card-list")).toContainText("场景联动配置");
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
      // 请求期确定按钮 loading 禁用（DialogTrigger 防重复提交）；请求过快时可能已恢复，观察记录不判失败。
      const confirmBtn = dlg.getByRole("button", { name: "确定", exact: true });
      const loadingObserved = await confirmBtn.isDisabled({ timeout: 1_500 }).catch(() => false);
      test.info().annotations.push({
        type: "探索注解",
        description: `确定按钮请求期 loading 禁用观察=${loadingObserved ? "已捕获（禁用态）" : "未捕获（请求过快已恢复，防重实现以 DialogTrigger 源码为准）"}`
      });

      // toast 新增成功 + 列表出现该模板行。
      await expect(page.getByText("新增成功", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2_500);
      const msgTable = page.locator(".ep-table__body:visible").last();
      const targetRow = msgTable.locator("tbody tr").filter({ hasText: firstTplTitle }).first();
      await expect(targetRow).toBeVisible({ timeout: 15_000 });
      const rowsBeforeDelete = await msgTable.locator("tbody tr").count();

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

      // 步骤 3：删除确认弹窗「取消」分支（无写入：弹窗关闭、行保留、无「删除成功」提示、行数不变）。
      await targetRow.getByText("删除", { exact: true }).click();
      const cancelDialog = page.locator(".ep-message-box:visible").last();
      await cancelDialog.waitFor({ state: "visible", timeout: 15_000 });
      await expect(cancelDialog).toContainText("确认删除模板消息");
      await expect(cancelDialog).toContainText(firstTplTitle);
      await attachShot(page, "删除模板确认");
      await cancelDialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(cancelDialog).toBeHidden({ timeout: 10_000 });
      await expect(targetRow).toBeVisible();
      const rowsAfterCancel = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.expect(rowsAfterCancel).toBe(rowsBeforeDelete);
      await expect(page.getByText("删除成功", { exact: true })).toHaveCount(0);
      test.info().annotations.push({ type: "探索注解", description: "删除确认弹窗取消分支：行保留、列表行数不变、无「删除成功」提示（无写入）" });

      // 步骤 4：再次点击该行「删除」并确定（弹窗关闭、行消失、toast「删除成功」）。
      await targetRow.getByText("删除", { exact: true }).click();
      const confirmDialog = page.locator(".ep-message-box:visible").last();
      await confirmDialog.waitFor({ state: "visible", timeout: 15_000 });
      await confirmDialog.getByRole("button", { name: "确定", exact: true }).click();
      await expect(confirmDialog).toBeHidden({ timeout: 15_000 });
      await expect(targetRow).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText("删除成功", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

      // 步骤 5：台账记录（删除）。
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

    // 覆盖 OP-PADV-005：套用模板弹窗结构与空选拦截（no_write）。
    test("OP-PADV-005 套用模板弹窗结构与空选拦截", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoAdvanced(page, latest);
      await openCard(page, "消息推送配置", "套用模板");

      // 记录操作前行数。
      const rowsBefore = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();

      // 步骤 1：打开「套用模板」弹窗观察结构（标题/提示/表头；列表为空时为空态，不阻塞结构断言）。
      await page.getByRole("button", { name: "套用模板", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg).toContainText("套用消息推送模板");
      await expect(dlg).toContainText("选用标准消息");
      await expect(dlg).toContainText("根据功能定义已自动匹配以下标准消息");
      const dlgHeader = dlg.locator(".ep-table__header:visible").first();
      await dlgHeader.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["消息文案", "触发条件", "推送规则"]) {
        await expect(dlgHeader).toContainText(col);
      }
      await attachShot(page, "套用模板弹窗结构");

      // 步骤 2（D02 空勾选集合）：不勾选直接确定 → 拦截提示 + 弹窗不关闭。
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      await expect(page.getByText("请选择至少一个模板", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(dlg).toBeVisible();

      // 步骤 3：取消关闭，列表无变化。
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

    // 覆盖 OP-PADV-006：子页 URL 直达与面包屑（no_write）。
    // 直达 /advanced/scene、/advanced/message（子路由独立注册 + watchEffect 按路径第 5 段激活卡片，直达同样渲染面包屑）。
    test("OP-PADV-006 子页 URL 直达与面包屑", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];

      // 步骤 1：从列表进入台账最新产品基础配置页，读取产品 id。
      // 2026-09-14 分页口径：第 1 页未命中时用列表搜索（只读动作）定位。
      await gotoWithRetry(page, "/integration/product/management");
      await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(2_000);
      let row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
      if (!(await row.isVisible().catch(() => false))) {
        await page.getByPlaceholder(/Model\/名称\/型号/u).fill(latest.productName);
        await page.getByRole("button", { name: "搜索", exact: true }).click();
        await page.waitForTimeout(3_000);
        row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
      }
      await expect(row, `台账最新产品 ${latest.productName} 应经列表（必要时搜索）可见`).toBeVisible({ timeout: 20_000 });
      await row.getByText(/继续开发|开发详情/u).click();
      await page.waitForURL(/\/integration\/product\/\d+\/basic/u, { timeout: 30_000 });
      const productId = page.url().match(/\/integration\/product\/(\d+)\//u)?.[1];
      test.expect(productId, "从 /basic URL 读取台账最新产品 id").toBeTruthy();

      // 先进入高级配置容器（不点卡片），作为页脚「返回上一级」的落点。
      await gotoWithRetry(page, `/integration/product/${productId}/advanced`);
      await page.locator(".advanced-config").waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(2_000);

      // 步骤 2：地址栏直达 /advanced/scene（不经卡片点击）→ 面包屑 + 触发条件区 + 页脚返回。
      await gotoWithRetry(page, `/integration/product/${productId}/advanced/scene`);
      await page.getByText("触发条件设置").first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(1_500);
      const sceneBread = page.locator(".advanced-bread");
      await expect(sceneBread).toContainText("高级配置");
      await expect(sceneBread).toContainText("场景联动配置");
      await expect(page.getByText("触发条件设置").first()).toBeVisible();
      await expect(footerBackButton(page).first()).toBeVisible();
      await attachShot(page, "直达场景联动页");
      // 页脚「返回上一级」为只读导航（router.back()），允许点击 → 回到高级配置卡片容器。
      await footerBackButton(page).first().click();
      await page.locator(".advanced-card-list").waitFor({ state: "visible", timeout: 20_000 });
      await expect(page.locator(".advanced-card-list")).toContainText("场景联动配置");
      await expect(page.locator(".advanced-card-list")).toContainText("消息推送配置");

      // 步骤 3：地址栏直达 /advanced/message（不经卡片点击）→ 面包屑 + 套用模板按钮。
      await gotoWithRetry(page, `/integration/product/${productId}/advanced/message`);
      await page.getByRole("button", { name: "套用模板", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(1_500);
      const messageBread = page.locator(".advanced-bread");
      await expect(messageBread).toContainText("高级配置");
      await expect(messageBread).toContainText("消息推送配置");
      await expect(page.getByRole("button", { name: "套用模板", exact: true }).first()).toBeVisible();
      await attachShot(page, "直达消息推送页");
    });
  });
});
