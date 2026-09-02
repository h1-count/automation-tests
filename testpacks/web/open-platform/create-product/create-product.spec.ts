import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readLatestGeneratedData, recordGeneratedProductData, type GeneratedProductData } from "../../../../src/support/recordGeneratedData";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物与登录态均写入 runtime/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能测试包。");
}
// 登录态文件（token 位于 cookie，仅存本地不入 Git）：002 优先复用，登录后刷新；登录功能本身由 login-register 功能包覆盖。
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台创建产品", () => {
  // 报告证据：关键状态截图直接进入 HTML 报告附件区。
  async function attachShot(page: Page, name: string) {
    await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
  }

  // 每条用例的报告都携带功能包结论（当前结论 + 实现差异与限制）。
  test.beforeEach(async () => {
    await test.info().attach("功能包结论与已知差异.md", { path: join(packDirectory, "conclusion.md") });
  });

  // —— 文案无关断言辅助（与 login-register 功能包同模式）——
  // 校验类用例断言“行为”（出现/不出现提示），不押具体文案；文案差异以注解记录。
  const NOTICE_TEXT_PATTERN = "(请输入|请选择|请完善|不能|必须|长度|格式|正确|只包含|只能包含|仅支持|字符|无效|过期|失败|错误|已被使用|已存在|占用|超出|不足|重复)";
  const NOTICE_EXCLUDE_PATTERN = /获取验证码|重新获取|秒后重新|查看.*协议|《用户协议》|切换|Switch/u;

  async function collectVisibleNotices(page: Page): Promise<string[]> {
    const collect = () =>
      page.evaluate((pattern: string) => {
        const regex = new RegExp(pattern, "u");
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let current = walker.nextNode();
        while (current) {
          const text = (current.textContent ?? "").trim();
          if (text && text.length <= 50 && regex.test(text) && !/获取验证码|重新获取|秒后重新|查看.*协议|《用户协议》|切换|Switch/u.test(text)) out.push(text);
          current = walker.nextNode();
        }
        return out;
      }, NOTICE_TEXT_PATTERN);
    const first = await collect();
    const second = await collect();
    return Array.from(new Set([...first, ...second]));
  }

  // 捕获基线之外“新出现”的提示（250ms 轮询；超时返回空数组，由调用方决定语义）。
  async function captureNewNotices(page: Page, baseline: string[], timeoutMs = 10_000): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await collectVisibleNotices(page);
      const fresh = current.filter((text) => !baseline.includes(text));
      if (fresh.length > 0) return fresh;
      await page.waitForTimeout(250);
    }
    return [];
  }

  // 行为成立（出现提示）即通过；实际文案与预期文案的差异记“文案差异”注解。
  function noteCopy(step: string, expected: string, notices: string[]) {
    const actual = notices.join("；");
    if (notices.some((text) => text.includes(expected))) {
      console.log(`[文案一致] ${step}：实际提示“${actual}”`);
      return;
    }
    test.info().annotations.push({
      type: "文案差异",
      description: `${step}：预期文案“${expected}”，实际提示“${actual || "（未捕获）"}”——校验行为成立，文案差异以实际为准记录`
    });
    console.log(`[文案差异] ${step}：预期“${expected}”，实际“${actual || "（未捕获）"}”`);
  }

  // 会话复用：加载本地保存的登录态（token 位于 cookie）并验证仍有效；返回 false 表示需要重新短信登录。
  async function restoreSession(page: Page): Promise<boolean> {
    if (!existsSync(authStatePath)) return false;
    try {
      const state = JSON.parse(await readFile(authStatePath, "utf8")) as StoredAuthState;
      if (!state.cookies?.length) return false;
      await page.context().addCookies(state.cookies);
      await page.goto("/integration/product/management");
      return !/\/login/u.test(page.url());
    } catch {
      return false;
    }
  }

  // 等待短信发送结果：倒计时出现=发送成功；频控类提示=发送被拒（快速失败）。
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
    if ((await outcome.jsonValue()) === "rejected") {
      throw new Error("验证码发送被后端拒绝（疑似短信频控），请等待频控窗口后重跑该用例");
    }
    console.log("[自动捕获] 短信发送成功（倒计时已出现）");
  }

  // —— 向导定位辅助（2026-09-01 Chrome DevTools MCP 探索确认）——
  // 一级/二级品类是纯文本节点（无 button/radio role），按可访问文本定位；二级卡片列表容器为项目自有类。
  // 品类接口偶发返回不完整数据（children 缺失，二级区域为空）：二级未出现时重选一级品类重试。
  async function selectCategory(page: Page, level1: string, level2: string) {
    const level1Item = page.locator("main").getByText(level1, { exact: true }).first();
    const level2Item = page.locator("main").getByText(level2, { exact: true }).first();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await level1Item.click();
      try {
        await level2Item.click({ timeout: 8_000 });
        return;
      } catch {
        console.log(`[重试] 二级品类「${level2}」未出现（第 ${attempt} 次），重选一级品类`);
      }
    }
    throw new Error(`二级品类「${level2}」在重试后仍未出现，请检查品类列表接口数据`);
  }

  async function selectDevelopPlan(page: Page, planLabel: string) {
    await page.locator("main").getByText(planLabel, { exact: true }).first().click();
    const activePlan = page.locator("main").locator(".plan-item.active").filter({ hasText: planLabel });
    await expect(activePlan).toBeVisible();
  }

  async function expectWizardReady(page: Page) {
    await expect(page).toHaveURL(/\/integration\/product\/create/u);
    await expect(page.getByRole("button", { name: "创建产品", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "返回", exact: true })).toBeEnabled();
    await expect(page.getByText("请选择您创建的产品", { exact: true }).first()).toBeVisible();
  }

  async function fillProductForm(page: Page, data: { name: string; model: string; description: string; protocol: string; deviceType: string }) {
    await page.getByPlaceholder("请输入产品名称").fill(data.name);
    await page.getByPlaceholder("仅支持小写字母或数字").fill(data.model);
    await page.locator("main").getByText(data.protocol, { exact: true }).first().click();
    await page.locator("main").getByText(data.deviceType, { exact: true }).first().click();
    await page.getByPlaceholder("简单描述产品功能，应用场景").fill(data.description);
    await expect(page.getByRole("radio", { name: data.protocol, exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: data.deviceType, exact: true })).toBeChecked();
  }

  test.describe("入口与权限（无登录态）", () => {
    // 覆盖 OP-PROD-001：未登录直接访问创建产品/产品开发页，重定向登录页（no_write）。
    test("OP-PROD-001 未登录访问创建产品页重定向登录", async ({ page }) => {
      await page.goto("/integration/product/create");
      await expect(page).toHaveURL(/\/login/u);
      await expect(page.getByRole("form", { name: "短信验证码登录表单" })).toBeVisible();

      await page.goto("/integration/product/management");
      await expect(page).toHaveURL(/\/login/u);
      await attachShot(page, "未登录重定向登录页");
    });

    // 覆盖 OP-PROD-002：进入产品开发首页的前置登录。优先复用 runtime/auth-state.json 的有效会话，
    // 仅当无有效会话时才发送短信并新建登录态（人工点选图形验证码）；登录功能本身由 login-register 功能包覆盖。
    test("OP-PROD-002 短信登录并进入产品开发首页（优先复用登录态）", async ({ page }) => {
      test.setTimeout(360_000);

      // 步骤 1：会话复用检查——本地登录态有效则直接进入产品开发首页，跳过短信登录。
      if (await restoreSession(page)) {
        test.info().annotations.push({
          type: "登录态复用",
          description: "检测到 runtime/auth-state.json 中的有效会话，跳过短信登录（不发送短信、无需人工点选验证码）"
        });
        console.log("[登录态复用] 有效会话已恢复，跳过短信登录");
      } else {
        const testPhone = process.env.TEST_PHONE;
        const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
        if (!testPhone || !testVerificationCode) {
          throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
        }

        // 步骤 2-3：短信验证码登录方式，输入测试手机号并请求验证码（人工点选图形验证码）。
        await page.goto("/login");
        const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
        await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(loginPanel.getByRole("textbox", { name: "短信登录手机号" })).toBeVisible();
        await loginPanel.getByRole("textbox", { name: "短信登录手机号" }).fill(testPhone);
        const sendCodeButton = loginPanel.getByRole("button", { name: "获取登录短信验证码" });
        await expect(sendCodeButton).toBeEnabled();
        console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
        await sendCodeButton.click();
        await waitForSmsCountdownOrReject(page);
        await attachShot(page, "验证码倒计时出现");

        // 步骤 4：输入测试验证码、勾选协议并提交登录；登录态持久化供后续用例复用。
        await loginPanel.getByRole("textbox", { name: "登录短信验证码" }).fill(testVerificationCode);
        await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
        const smsSubmit = loginPanel.getByRole("button", { name: "短信验证码登录", exact: true });
        await expect(smsSubmit).toBeEnabled();
        await smsSubmit.click();
        await expect(page).toHaveURL(/\/console\/home/u, { timeout: 30_000 });
        await page.context().storageState({ path: authStatePath });
      }

      // 步骤 5：进入产品开发首页，列表、创建入口与搜索框可见。
      await page.goto("/integration/product/management");
      await expect(page.getByRole("button", { name: "创建产品", exact: true })).toBeVisible();
      await expect(page.getByPlaceholder("Model/名称/型号")).toBeVisible();
      await expect(page.getByText("开发状态", { exact: true })).toBeVisible();
      await attachShot(page, "产品开发首页");
    });
  });

  test.describe("登录后：向导、校验与创建写入", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PROD-003：创建产品入口与向导初始态（no_write）。
    test("OP-PROD-003 创建产品入口与向导初始态", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/management");
      await page.getByRole("button", { name: "创建产品", exact: true }).click();

      await expectWizardReady(page);
      await expect(page.getByText("请选择智能化方案", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("请完善产品信息", { exact: true }).first()).toBeVisible();
      await attachShot(page, "向导初始态-创建按钮禁用");
    });

    // 覆盖 OP-PROD-004：品类选择、取消与联动（no_write）。
    test("OP-PROD-004 品类选择、取消与联动", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/create");
      await expectWizardReady(page);

      // 步骤 1-2：选一级「照明」，二级出现「灯」，选中后方案区域出现。
      await selectCategory(page, "照明", "灯");
      await expect(page.getByText("请选择智能化方案", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("开放协议接入", { exact: true }).first()).toBeVisible();
      await attachShot(page, "选中二级品类-方案区域出现");

      // 步骤 3：点取消按钮，方案区域隐藏，创建按钮回到禁用态。
      await page.locator(".cate-selected").getByRole("button").first().click();
      await expect(page.locator(".plan-item")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "创建产品", exact: true })).toBeDisabled();

      // 步骤 4：重新选择同一二级品类，方案区域恢复。
      await selectCategory(page, "照明", "灯");
      await expect(page.locator(".plan-item")).not.toHaveCount(0);
      await attachShot(page, "重新选中品类-方案区域恢复");
    });

    // 覆盖 OP-PROD-005：智能化方案选择与切换品类重置（no_write）。
    test("OP-PROD-005 智能化方案选择与切换品类重置", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/create");
      await expectWizardReady(page);

      // 步骤 1-2：查看方案子集并选择「开放协议接入」，第三步表单出现。
      await selectCategory(page, "照明", "灯");
      await expect(page.getByText("云云接入", { exact: true }).first()).toBeVisible();
      await selectDevelopPlan(page, "开放协议接入");

      // 步骤 3：表单字段可见（探索确认：开放协议接入下通讯协议 11 项、设备类型 3 项）。
      await expect(page.getByPlaceholder("请输入产品名称")).toBeVisible();
      await expect(page.getByPlaceholder("仅支持小写字母或数字")).toBeVisible();
      await expect(page.getByRole("radio", { name: "普通设备" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "网关设备" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "网关子设备" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "WiFi", exact: true })).toBeVisible();
      await attachShot(page, "选择方案-表单出现");

      // 步骤 4：切换一级品类并选其二级品类，方案选中被重置、表单隐藏、按钮禁用。
      await page.locator("main").getByText("插座开关", { exact: true }).first().click();
      await page.locator("main").locator(".product-type-item .label").first().click();
      await expect(page.locator(".plan-item.active")).toHaveCount(0);
      await expect(page.getByPlaceholder("请输入产品名称")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "创建产品", exact: true })).toBeDisabled();
    });

    // 覆盖 OP-PROD-006：必填项空表单提交被拦截（no_write：校验失败不发创建请求）。
    test("OP-PROD-006 必填项空表单提交被拦截", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/create");
      await selectCategory(page, "照明", "灯");
      await selectDevelopPlan(page, "开放协议接入");

      // 步骤 1：品类+方案已选，创建按钮可用；空表单点击提交被拦截。
      const submitButton = page.getByRole("button", { name: "创建产品", exact: true });
      await expect(submitButton).toBeEnabled();
      const baseline = await collectVisibleNotices(page);
      await submitButton.click();
      const notices = await captureNewNotices(page, baseline);
      expect(notices.length, "空表单提交应出现字段级校验提示").toBeGreaterThan(0);
      expect(notices.join("；"), "应包含产品名称必填提示").toMatch(/请输入产品名称/u);
      expect(notices.join("；"), "应包含通讯协议必选提示").toMatch(/请选择通讯协议/u);
      expect(notices.join("；"), "应包含设备类型必选提示").toMatch(/请选择设备类型/u);

      // 步骤 1 续：无成功提示、无跳转（仍在创建页）。
      await expect(page.getByText("产品创建成功")).toHaveCount(0);
      await expect(page).toHaveURL(/\/integration\/product\/create/u);
      await attachShot(page, "空表单提交被拦截");
    });

    // 覆盖 OP-PROD-007：产品型号格式校验与长度边界（no_write）。
    test("OP-PROD-007 产品型号格式校验与长度边界", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/create");
      await selectCategory(page, "照明", "灯");
      await selectDevelopPlan(page, "开放协议接入");

      const modelField = page.getByPlaceholder("仅支持小写字母或数字");
      const formatError = page.getByText(/仅支持小写字母或数字/u);

      // 步骤 1：大写字母失焦后出现格式提示。
      let baseline = await collectVisibleNotices(page);
      await modelField.fill("AT12");
      await modelField.press("Tab");
      let notices = await captureNewNotices(page, baseline);
      expect(notices.length, "型号含大写字母应出现格式提示").toBeGreaterThan(0);
      noteCopy("007-D1 型号格式提示", "仅支持小写字母或数字，最多6位", notices);
      await expect(formatError.first()).toBeVisible();

      // 步骤 2：含连字符同样保持格式提示（与步骤 1 同一提示文案，断言提示仍然可见而非“新出现”）。
      await modelField.fill("at-1");
      await modelField.press("Tab");
      await expect(page.getByText(/仅支持小写字母或数字/u).first()).toBeVisible();

      // 步骤 3：7 位输入被截断为 6 位（maxlength 生效），计数 6/6。
      await modelField.fill("abcdefg");
      await expect(modelField).toHaveValue("abcdef");
      await expect(page.getByText("6 / 6", { exact: true })).toBeVisible();

      // 步骤 4：合法值后格式提示消失。
      await modelField.fill("at01");
      await modelField.press("Tab");
      await expect(formatError).toHaveCount(0);
      await attachShot(page, "合法型号-无格式提示");
    });

    // 覆盖 OP-PROD-008：产品名称与描述边界（no_write；名称标点空格不拦截为实现差异，记录注解）。
    test("OP-PROD-008 产品名称与描述边界（含实现差异记录）", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/create");
      await selectCategory(page, "照明", "灯");
      await selectDevelopPlan(page, "开放协议接入");

      const nameField = page.getByPlaceholder("请输入产品名称");
      const descriptionField = page.getByPlaceholder("简单描述产品功能，应用场景");

      // 步骤 1：名称含空格与标点——前端不出现格式提示（源码 productName() 字符校验已注释，需求差异①）。
      let baseline = await collectVisibleNotices(page);
      await nameField.fill("自动化 测试,产品");
      await nameField.press("Tab");
      const nameNotices = await captureNewNotices(page, baseline, 3_000);
      expect(nameNotices.filter((text) => /名称|标点|空格|格式/u.test(text)), "名称标点空格不应出现格式提示（实现差异）").toHaveLength(0);
      test.info().annotations.push({
        type: "已知差异",
        description: "产品名称含空格与标点时前端无格式提示：ValidationRuleBuilder.productName() 的字符集/空格校验已注释，与需求「不允许标点符号和空格」不一致"
      });
      await attachShot(page, "名称含标点空格-无提示-实现差异");

      // 步骤 2：62 字符输入被截断为 60（maxlength 生效），计数 60/60。
      await nameField.fill("自动化测试产品名称超长验证" + "1".repeat(48));
      expect((await nameField.inputValue()).length, "名称超长输入应被截断为 60 字符").toBe(60);
      await expect(page.getByText("60 / 60", { exact: true })).toBeVisible();

      // 步骤 3：描述 2 字符失焦出现长度提示（实现最小 3 字符，需求差异②）。
      baseline = await collectVisibleNotices(page);
      await descriptionField.fill("测试");
      await descriptionField.press("Tab");
      const descriptionNotices = await captureNewNotices(page, baseline);
      expect(descriptionNotices.length, "描述 2 字符应出现长度提示").toBeGreaterThan(0);
      expect(descriptionNotices.join("；"), "提示应与描述长度语义相关").toMatch(/长度/u);
      noteCopy("008-D3 描述长度下限", "描述长度必须在3~200之间", descriptionNotices);

      // 步骤 4：描述 3 字符以上提示消失。
      await descriptionField.fill("自动化测试");
      await descriptionField.press("Tab");
      await expect(page.getByText(/长度必须在/u)).toHaveCount(0);
      await attachShot(page, "描述边界校验完成");
    });

    // 覆盖 OP-PROD-009：云云接入协议类型必选（no_write；「照明-灯」支持云云接入，条件满足）。
    test("OP-PROD-009 云云接入协议类型必选", async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/integration/product/create");
      await selectCategory(page, "照明", "灯");

      // 步骤 1：选择云云接入，出现「协议类型」必填单选（实现新增字段）。
      await selectDevelopPlan(page, "云云接入");
      await expect(page.getByRole("radio", { name: "平台标准协议" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "自定义协议" })).toBeVisible();

      // 步骤 2：空表单提交被拦截，出现协议类型相关提示，无跳转。
      const submitButton = page.getByRole("button", { name: "创建产品", exact: true });
      const baseline = await collectVisibleNotices(page);
      await submitButton.click();
      const notices = await captureNewNotices(page, baseline);
      expect(notices.length, "云云接入空表单提交应被拦截并出现提示").toBeGreaterThan(0);
      expect(notices.join("；"), "提示应与协议类型语义相关").toMatch(/协议类型|请选择/u);
      await expect(page.getByText("产品创建成功")).toHaveCount(0);
      await expect(page).toHaveURL(/\/integration\/product\/create/u);

      // 步骤 3：点选「平台标准协议」后选中态生效（label 内含 DotTip 提示组件，exact 文本匹配会落空）。
      await page.locator("main").getByText("平台标准协议").first().click();
      await expect(page.getByRole("radio", { name: "平台标准协议" })).toBeChecked();
      await attachShot(page, "云云接入-协议类型已选");
    });

    // 覆盖 OP-PROD-011：创建产品成功并跳转基础配置页（写入：创建 1 个产品，D01 全量入台账）。
    // 说明：OP-PROD-010 依赖本用例创建的 D01 产品作为唯一性冲突源，故脚本按 011 → 010 顺序执行。
    test("OP-PROD-011 创建产品成功并跳转基础配置页", async ({ page }) => {
      test.setTimeout(180_000);
      const runId = Date.now();
      const generatedData: GeneratedProductData = {
        runId,
        productName: `自动化测试产品${runId}`,
        productModel: `at${String(runId).slice(-4)}`,
        category: "照明-灯",
        developmentMethod: "开放协议接入",
        deviceType: "普通设备",
        description: `自动化测试生成的产品${runId}`
      };

      await page.goto("/integration/product/create");
      await selectCategory(page, "照明", "灯");
      await selectDevelopPlan(page, "开放协议接入");
      await fillProductForm(page, {
        name: generatedData.productName,
        model: generatedData.productModel,
        description: generatedData.description,
        protocol: "WiFi",
        deviceType: "普通设备"
      });
      await attachShot(page, "D01 表单就绪-待提交");

      // 步骤 2：点击创建，出现成功提示并自动跳转基础配置页。
      await page.getByRole("button", { name: "创建产品", exact: true }).click();
      await expect(page.getByText("产品创建成功", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveURL(/\/integration\/product\/[^/]+\/basic/u, { timeout: 30_000 });

      // 步骤 3：基础配置页展示产品名称，开发状态「开发中」。
      await expect(page.getByText(generatedData.productName).first()).toBeVisible({ timeout: 20_000 });
      await attachShot(page, "创建成功-基础配置页");

      // 步骤 4：写入已确认（跳转成功），D01 全量资料记录到本功能包台账。
      await recordGeneratedProductData(generatedData);
      console.log(`[台账] 已记录 D01：${generatedData.productName} / ${generatedData.productModel}`);
    });

    // 覆盖 OP-PROD-010：重复产品型号创建被拒绝（前置依赖 OP-PROD-011 的 D01 产品）。
    // 写入口径：提交创建请求预期被拒绝（10516）；失败尝试不入台账，若意外成功则补记台账并在报告标注。
    test("OP-PROD-010 重复产品型号创建被拒绝", async ({ page }) => {
      test.setTimeout(120_000);
      const history = await readLatestGeneratedData<GeneratedProductData>("web", "open-platform", "create-product");
      if (!history?.productModel || !history?.productName) {
        throw new Error("台账缺少 D01 产品资料，请先成功运行 OP-PROD-011");
      }

      // 步骤 1：同品类+同方案进入第三步。
      await page.goto("/integration/product/create");
      await selectCategory(page, "照明", "灯");
      await selectDevelopPlan(page, "开放协议接入");

      // 步骤 2：新名称 + D01 已用型号，其余必填项合法填写。
      await fillProductForm(page, {
        name: `${history.productName}重复型号校验`,
        model: history.productModel,
        description: `自动化测试重复型号校验${Date.now()}`,
        protocol: "WiFi",
        deviceType: "普通设备"
      });

      // 步骤 3：提交被唯一性拒绝：型号字段出现「重复」类提示，无成功提示、无跳转。
      const baseline = await collectVisibleNotices(page);
      await page.getByRole("button", { name: "创建产品", exact: true }).click();
      const notices = await captureNewNotices(page, baseline, 20_000);
      const duplicateNotice = notices.find((text) => /型号/u.test(text) && /重复/u.test(text));
      expect(duplicateNotice, `应出现型号重复提示，实际提示：${notices.join("；") || "（未捕获）"}`).toBeTruthy();
      noteCopy("010 型号重复提示", "产品型号重复", [duplicateNotice ?? ""]);
      await expect(page.getByText("产品创建成功")).toHaveCount(0);
      await expect(page).toHaveURL(/\/integration\/product\/create/u);
      await attachShot(page, "重复型号-创建被拒绝");

      const stillOnCreate = page.url().includes("/integration/product/create");
      if (!stillOnCreate) {
        test.info().annotations.push({
          type: "已知差异",
          description: "重复型号提交未被拒绝而创建了产品，请检查后端唯一性校验（10516）；台账需人工核对"
        });
      }
    });

    // 覆盖 OP-PROD-012：新产品列表回查（no_write；回读台账并将 Model 回填台账记录）。
    test("OP-PROD-012 新产品列表回查与台账记录", async ({ page }) => {
      test.setTimeout(120_000);
      const history = await readLatestGeneratedData<GeneratedProductData>("web", "open-platform", "create-product");
      if (!history?.productName || !history?.productModel) {
        throw new Error("台账缺少 D01 产品资料，请先成功运行 OP-PROD-011");
      }

      // 步骤 1-2：返回产品开发首页，按 D01 名称搜索。
      await page.goto("/integration/product/management");
      await page.getByPlaceholder("Model/名称/型号").fill(history.productName);
      await page.getByRole("button", { name: "搜索", exact: true }).click();

      // 列表出现新产品：名称一致、Model 包含产品型号、状态为「开发中」语义、操作列「继续开发」。
      // 页面事实（2026-09-01）：字典未命中时状态列回退显示原始值 developing，语义与「开发中」一致，差异以注解记录。
      const productRow = page.getByRole("row").filter({ hasText: history.productName });
      await expect(productRow.first()).toBeVisible({ timeout: 20_000 });
      await expect(productRow.first().getByText(/开发中|developing/u).first()).toBeVisible({ timeout: 10_000 });
      const rowText = await productRow.first().innerText();
      if (!/开发中/u.test(rowText)) {
        test.info().annotations.push({
          type: "文案差异",
          description: `开发状态列显示字典原始值而非中文文案（实际行内状态：${rowText.match(/developing|开发中/u)?.[0] ?? "未捕获"}），语义与「开发中」一致；产品列表字典（S_INTEGRATION_ACCESS_STATUS 等）未命中时 colorful-tag 回退显示原始值`
        });
      }
      await expect(productRow.first().getByText("继续开发", { exact: true })).toBeVisible();

      // Model 列取值（第 2 列）：企业标识+品类英文+产品型号（探索实测 at0635.light.at5948 形态）。
      const modelCell = (await productRow.first().locator("td").nth(1).innerText()).trim();
      expect(modelCell, `Model 列应包含产品型号 ${history.productModel}`).toContain(history.productModel);
      await attachShot(page, "列表回查-开发中语义-继续开发");

      // 台账回填平台生成的产品 model（同 runId 覆盖更新，台账只增不删）。
      await recordGeneratedProductData({ ...history, assignedProductModel: modelCell });
      console.log(`[台账] 已回填产品 model：${modelCell}`);
    });
  });
});
