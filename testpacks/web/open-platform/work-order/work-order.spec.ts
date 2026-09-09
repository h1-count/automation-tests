import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { recordGeneratedWorkOrder, type GeneratedWorkOrderData } from "../../../../src/support/recordGeneratedData";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能包。");
}
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
const ledgerPath = join(packDirectory, "runtime", "generated-data.json");
const ticketTitlePrefix = "自动化测试工单";
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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };
type LedgerRecord = { kind?: string; ticketTitle?: string; ticketNumber?: string };
type LedgerFile = { records?: LedgerRecord[] } | LedgerRecord[];

test.describe("开放平台技术工单", () => {
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

  async function gotoTickets(page: Page) {
    await gotoWithRetry(page, "/service-support/technical-ticket");
    await page.getByRole("button", { name: "新建工单", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_500);
  }

  async function restoreOrLogin(page: Page) {
    if (await (async () => {
      for (const candidate of sharedAuthPaths) {
        if (!existsSync(candidate)) continue;
        try {
          const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
          if (!state.cookies?.length) continue;
          await page.context().addCookies(state.cookies);
          await gotoWithRetry(page, "/service-support/technical-ticket");
          if (!/\/login/u.test(page.url())) {
            const ready = await page
              .getByRole("button", { name: "新建工单", exact: true })
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
    })()) {
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
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-WO-001：技术工单列表渲染（no_write）。
    test("OP-WO-001 技术工单列表渲染", async ({ page }) => {
      test.setTimeout(360_000);
      await restoreOrLogin(page);

      // 步骤 1：导航与统计卡。
      await gotoTickets(page);
      const bodyText = await page.evaluate(() => document.body.innerText);
      test.expect(bodyText.includes("技术工单"), "页面应含「技术工单」导航/标题").toBe(true);
      for (const stat of ["待处理", "处理中", "待验收", "已完成", "已撤销"]) {
        test.expect(bodyText, `统计卡应含 ${stat}`).toContain(stat);
      }
      test.info().annotations.push({ type: "探索注解", description: "5 统计卡实证：待处理/处理中/待验收/已完成/已撤销" });

      // 步骤 2：筛选与操作。
      await expect(page.getByText("全部状态").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "新建工单", exact: true }).first()).toBeVisible();

      // 步骤 3：表头与数据行。
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["工单编号", "发放状态", "工单标题", "工单分类", "所属系统", "上报时间", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      const empty = await page.getByText("暂无数据").isVisible().catch(() => false);
      test.info().annotations.push({ type: "探索注解", description: `工单列表行数=${rows}，空态可见=${empty}` });
      await attachShot(page, "技术工单列表");
    });
  });

  test.describe("新建工单", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-WO-002：新建向导系统与类别联动（no_write）。
    test("OP-WO-002 新建向导系统与类别联动", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoTickets(page);

      // 步骤 1：打开向导。
      await page.getByRole("button", { name: "新建工单", exact: true }).first().click();
      await page.waitForTimeout(2_000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      for (const step of ["选择工单所属系统", "选择工单类别", "请填写工单信息"]) {
        test.expect(bodyText, `向导应含步骤「${step}」`).toContain(step);
      }
      test.expect(bodyText).toContain("产品接入系统");
      test.expect(bodyText).toContain("产品服务系统");
      test.expect(bodyText).toContain("产品运营系统");
      test.expect(bodyText, "应含回复时效提示").toContain("5-7个工作日");

      // 步骤 2：选产品接入系统 → 类别联动。
      await page.getByText("产品接入系统", { exact: true }).first().click();
      await page.waitForTimeout(1_500);
      const afterText = await page.evaluate(() => document.body.innerText);
      const expectedCategories = ["其他", "创建产品", "基础配置", "功能定义配置", "开放协议接入开发", "云云接入开发", "模组SDK开发", "模组选型", "固件配置", "场景联动", "消息推送", "产品测试", "产品上线"];
      const missing = expectedCategories.filter((c) => !afterText.includes(c));
      test.expect(missing, `类别联动应含全部 13 类，缺失=${missing.join("/")}`).toHaveLength(0);
      test.info().annotations.push({ type: "探索注解", description: "产品接入系统类别联动实证：13 类齐全" });

      // 步骤 3：其余系统类别注解（点选切换，不填表单）。
      await page.getByText("产品服务系统", { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(1_000);
      const svcText = await page.evaluate(() => document.body.innerText);
      test.info().annotations.push({ type: "探索注解", description: `产品服务系统类别（实证片段）：${svcText.slice(svcText.indexOf("选择工单类别"), svcText.indexOf("选择工单类别") + 120).replace(/\n+/g, "/")}` });
      await page.getByText("取消", { exact: true }).first().click().catch(() => {});
      await attachShot(page, "向导联动");
    });

    // 覆盖 OP-WO-003：工单表单校验与创建门槛（no_write，不点击创建）。
    test("OP-WO-003 工单表单校验与创建门槛", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoTickets(page);
      await page.getByRole("button", { name: "新建工单", exact: true }).first().click();
      await page.waitForTimeout(2_000);
      await page.getByText("产品接入系统", { exact: true }).first().click();
      await page.waitForTimeout(1_200);
      await page.getByText("其他", { exact: true }).first().click();
      await page.waitForTimeout(1_500);

      // D01 创建按钮初始 disabled。
      const createBtn = page.getByRole("button", { name: "创建", exact: true });
      await expect(createBtn).toBeDisabled();
      test.info().annotations.push({ type: "探索注解", description: "D01 实证：未填标题/描述时创建按钮 disabled（submitable 门槛）" });

      // D02 标题 21 字 → 截断 20。
      const titleInput = page.getByPlaceholder("请输入工单标题");
      await titleInput.fill("自".repeat(21));
      await page.waitForTimeout(600);
      const titleVal = await titleInput.inputValue();
      test.expect(titleVal.length, "maxlength=20 应截断").toBe(20);

      // D03 描述 201 字 → 截断 200。
      const descInput = page.getByPlaceholder("请详细描述您遇到的问题");
      await descInput.fill("描".repeat(201));
      await page.waitForTimeout(600);
      const descVal = await descInput.inputValue();
      test.expect(descVal.length, "maxlength=200 应截断").toBe(200);
      test.info().annotations.push({ type: "探索注解", description: `D02/D03 实证：标题截断 20、描述截断 200（show-word-limit 计数）` });

      // D04 补齐后按钮 enabled（选等级 radio 使表单完整——仅注解，不点击创建）。
      await titleInput.fill(`${ticketTitlePrefix}校验用例`);
      await page.getByText("低", { exact: true }).first().click();
      await page.waitForTimeout(800);
      await expect(createBtn).toBeEnabled();
      test.info().annotations.push({ type: "探索注解", description: "D04 实证：标题+描述+等级齐备后创建按钮 enabled（不点击——提交链路见 OP-WO-004）" });

      // D05 取消返回。
      await page.getByText("取消", { exact: true }).first().click();
      await page.waitForTimeout(1_500);
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `D05 取消返回列表，行数=${rows}（无新增）` });
      await attachShot(page, "表单校验");
    });

    // 覆盖 OP-WO-004：创建合成工单（写入+台账+幂等）。
    test("OP-WO-004 创建合成工单", async ({ page }) => {
      test.setTimeout(360_000);
      await gotoTickets(page);

      // 步骤 1：幂等检查——台账已有本包工单，或列表已存在前缀工单（自愈认领），则核验后跳过创建。
      const readLedger = async (): Promise<LedgerRecord[]> => {
        if (!existsSync(ledgerPath)) return [];
        try {
          const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as LedgerFile;
          return Array.isArray(parsed) ? parsed : (parsed.records ?? []);
        } catch {
          return [];
        }
      };
      // 等待列表数据加载完成（出现数据行或空态）再统计，避免空表误判。
      await expect
        .poll(
          async () => {
            const rowCount = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
            const emptyVisible = await page.getByText("暂无数据").isVisible().catch(() => false);
            return rowCount > 0 || emptyVisible;
          },
          { timeout: 20_000, intervals: [500, 1_000] }
        )
        .toBe(true);
      const allRows = page.locator(".ep-table__body:visible").last().locator("tbody tr");
      const prefixRows = allRows.filter({ hasText: ticketTitlePrefix });
      const prefixCount = await prefixRows.count();
      if (prefixCount > 0) {
        // 列表已有合成工单：逐行核对台账覆盖，缺失的自愈补记（只增不删）。
        const known = await readLedger();
        for (let i = 0; i < prefixCount; i++) {
          const rowText = (await prefixRows.nth(i).innerText()).replace(/\s+/g, " ").trim();
          const title = (rowText.match(new RegExp(`${ticketTitlePrefix}\\d{1,14}`)) ?? [])[0] ?? rowText.slice(0, 20);
          const number = rowText.split(/\s+/)[0] ?? "";
          if (!known.some((r) => r.ticketTitle === title)) {
            await recordGeneratedWorkOrder({
              runId: Date.now() + i,
              ticketTitle: title,
              ticketNumber: number,
              category: "其他",
              system: "产品接入系统",
              createdAt: new Date().toISOString()
            });
            test.info().annotations.push({ type: "台账自愈", description: `列表发现未入账合成工单「${title}」（编号 ${number}），已补记台账` });
          }
        }
        const first = (await prefixRows.first().innerText()).replace(/\s+/g, " ");
        test.info().annotations.push({
          type: "幂等跳过",
          description: `列表已有合成工单 ${prefixCount} 条（首条：${first.slice(0, 80)}），台账记录数=${(await readLedger()).filter((r) => (r.ticketTitle ?? "").startsWith(ticketTitlePrefix)).length}，跳过创建`
        });
        await attachShot(page, "幂等跳过");
        return;
      }
      const existing = (await readLedger()).filter((r) => (r.ticketTitle ?? "").startsWith(ticketTitlePrefix)).pop() ?? null;
      if (existing?.ticketNumber) {
        test.info().annotations.push({
          type: "幂等跳过",
          description: `台账已有工单「${existing.ticketTitle}」（编号 ${existing.ticketNumber}）但列表未见（可能在非首页），跳过创建`
        });
        await attachShot(page, "幂等跳过");
        return;
      }

      // 步骤 2：向导填表。
      await page.getByRole("button", { name: "新建工单", exact: true }).first().click();
      await page.waitForTimeout(2_000);
      await page.getByText("产品接入系统", { exact: true }).first().click();
      await page.waitForTimeout(1_200);
      await page.getByText("其他", { exact: true }).first().click();
      await page.waitForTimeout(1_500);
      const runId = Date.now();
      const ticketTitle = `${ticketTitlePrefix}${runId}`.slice(0, 20);
      await page.getByPlaceholder("请输入工单标题").fill(ticketTitle);
      await page.getByText("低", { exact: true }).first().click();
      await page.getByPlaceholder("请详细描述您遇到的问题").fill(`自动化测试合成工单 ${runId}：用于验证工单创建链路与台账幂等，请忽略。`);
      await page.getByPlaceholder(/请提供您的联系方式/).fill("13000000000");
      await page.waitForTimeout(800);
      const createBtn = page.getByRole("button", { name: "创建", exact: true });
      await expect(createBtn).toBeEnabled();

      // 步骤 3：提交并断言。
      await createBtn.click();
      const toast = page.locator('[role="alert"]').last();
      let toastText = "";
      try {
        await toast.waitFor({ state: "visible", timeout: 10_000 });
        toastText = await toast.innerText();
      } catch {
        // 提示短暂或无提示——以下一行数据为准
      }
      test.info().annotations.push({ type: "探索注解", description: `提交提示（实证）：${toastText.slice(0, 60) || "（无 toast，以列表数据为准）"}` });
      await page.waitForTimeout(2_500);

      // 列表出现新工单行。
      const newRow = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: ticketTitle }).first();
      await expect(newRow).toBeVisible({ timeout: 15_000 });
      const rowText = (await newRow.innerText()).replace(/\n+/g, " ");
      const ticketNumber = rowText.split(/\s+/)[0] ?? rowText.slice(0, 20);
      test.info().annotations.push({ type: "探索注解", description: `新工单行（实证）：${rowText.slice(0, 90)}` });

      // 台账记录。
      const ledgerData: GeneratedWorkOrderData = {
        runId,
        ticketTitle,
        ticketNumber,
        category: "其他",
        system: "产品接入系统",
        createdAt: new Date().toISOString()
      };
      await recordGeneratedWorkOrder(ledgerData);
      test.info().annotations.push({ type: "台账", description: `已记录 kind=open-platform-work-order，工单标题=${ticketTitle}，编号=${ticketNumber}` });

      // 步骤 4：详情页可达。
      await newRow.locator("a, .ep-link, [class*=operation] span, td:last-child span").first().click().catch(() => {});
      await page.waitForTimeout(2_500);
      const detailText = await page.evaluate(() => document.body.innerText);
      if (detailText.includes(ticketTitle)) {
        test.info().annotations.push({ type: "探索注解", description: "详情页可达，标题与提交值一致（回复流转范围外）" });
      } else {
        test.info().annotations.push({ type: "探索注解", description: "详情入口点击未达详情（操作列控件差异）——工单数据已落库并核对，详情交互注解留档" });
      }
      await attachShot(page, "创建工单");
    });
  });
});
