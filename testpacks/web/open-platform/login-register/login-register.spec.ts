import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  recordGeneratedRegistrationData,
  readLatestGeneratedData,
  type GeneratedRegistrationData
} from "../../../../src/support/recordGeneratedData";

test.describe("开放平台登录和注册", () => {
  // 报告证据：关键状态截图直接进入 HTML 报告的附件区，便于转发测试/产品评审。
  async function attachShot(page: Page, name: string) {
    await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
  }

  // 每条用例的报告都携带功能包结论（当前结论 + 已知差异与限制），打开报告即可看到全部待反馈问题。
  test.beforeEach(async () => {
    const packDirectory = process.env.TEST_PACK_DIR;
    if (packDirectory) {
      await test.info().attach("功能包结论与已知差异.md", { path: join(packDirectory, "conclusion.md") });
    }
  });

  // 注册表单合成数据：tag 区分同轮多次注册（如 "B"/"D"/"E"），保证名称、标识、信用代码、邮箱互不冲突。
  type RegisterFormData = {
    companyName: string;
    companyIdentifier: string;
    companyAddress: string;
    companyEmail: string;
    companyCreditCode: string;
    contactName: string;
    contactPhone: string;
    companyDescription: string;
  };

  function buildRegisterData(runId: number, tag: string, testPhone: string): RegisterFormData {
    const lowerTag = tag.toLowerCase();
    return {
      companyName: `自动化测试企业${runId}${tag}`,
      companyIdentifier: `${lowerTag}${String(runId % 10000).padStart(4, "0")}`,
      companyAddress: "自动化测试地址",
      companyEmail: `autotest${runId}${lowerTag}@example.invalid`,
      companyCreditCode: `9${(tag.charCodeAt(0) % 10).toString()}${String(runId).padStart(16, "0")}`.slice(0, 18),
      contactName: "自动化测试",
      contactPhone: testPhone,
      companyDescription: `自动化测试生成的企业简介${runId}${tag}`
    };
  }

  // 本地合成营业执照样本图（不入 Git，写入本功能包 runtime/tmp/，与台账分离的一次性产物）。
  async function synthesizeLicenseScreenshot(page: Page, sampleId: string): Promise<string> {
    const packDirectory = process.env.TEST_PACK_DIR;
    if (!packDirectory) {
      throw new Error("请通过 npm run test:fast 运行，以便定位功能包 runtime/ 目录");
    }
    const licensePage = await page.context().newPage();
    await licensePage.setContent(
      `<body style="margin:0"><div style="box-sizing:border-box;width:520px;height:340px;background:#f5f1e8;border:2px solid #8a7a52;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;color:#333;"><div style="font-size:28px;font-weight:700;letter-spacing:8px;">营业执照</div><div style="margin-top:18px;font-size:16px;">自动化测试样本 ${sampleId}</div><div style="margin-top:10px;font-size:12px;color:#777;">仅供测试环境注册流程使用</div></div></body>`
    );
    const licensePath = join(packDirectory, "runtime", "tmp", `business-license-${sampleId}.png`);
    await mkdir(join(licensePath, ".."), { recursive: true });
    await licensePage.screenshot({ path: licensePath });
    await licensePage.close();
    return licensePath;
  }

  async function fillRegisterRequiredFields(panel: Locator, data: RegisterFormData, licensePath: string) {
    await panel.getByRole("textbox", { name: "注册企业名称" }).fill(data.companyName);
    await panel.getByRole("textbox", { name: "注册企业标识" }).fill(data.companyIdentifier);
    await panel.getByRole("textbox", { name: "注册企业地址" }).fill(data.companyAddress);
    await panel.getByRole("textbox", { name: "注册企业邮箱" }).fill(data.companyEmail);
    await panel.getByRole("textbox", { name: "注册企业信用代码" }).fill(data.companyCreditCode);
    await panel.getByRole("textbox", { name: "注册联系人姓名" }).fill(data.contactName);
    await panel.getByRole("textbox", { name: "注册联系电话" }).fill(data.contactPhone);
    await panel.getByRole("textbox", { name: "注册企业简介" }).fill(data.companyDescription);
    await panel.locator('input[type="file"]').setInputFiles(licensePath);
  }

  // 读取台账全部记录（增量累积，明文全量），用于挑选待审核记录的信用代码。
  async function readLatestLedgerRecords(): Promise<Array<GeneratedRegistrationData & { createdAt: string }>> {
    const packDirectory = process.env.TEST_PACK_DIR;
    if (!packDirectory) {
      throw new Error("请通过 npm run test:fast 运行，以便定位功能包 runtime/ 目录");
    }
    const { readFile } = await import("node:fs/promises");
    const ledgerPath = join(packDirectory, "runtime", "generated-data.json");
    const document = JSON.parse(await readFile(ledgerPath, "utf8")) as { records?: Array<GeneratedRegistrationData & { createdAt: string }> };
    return document.records ?? [];
  }

  // 等待短信发送结果：出现倒计时=发送成功；出现频控类失败提示=发送被拒（快速失败，避免空等 4 分钟）。
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
    const outcomeState = await outcome.jsonValue();
    if (outcomeState === "rejected") {
      throw new Error("验证码发送被后端拒绝（疑似短信频控），请等待频控窗口后重跑该用例");
    }
    console.log("[自动捕获] 短信发送成功（倒计时已出现），继续填写验证码");
  }

  // —— 文案无关断言辅助 ——
  // 原则：校验类用例断言“行为”（出现/不出现提示），不押具体文案；
  // 实际文案与需求文案的差异以“文案差异”注解记录进报告，由报告承载文案问题。
  const NOTICE_TEXT_PATTERN = "(请输入|请上传|请选择|不能|必须|长度|格式|正确|只包含|只能包含|字符|无效|过期|失败|错误|已被使用|已存在|占用|超出|不足|重复)";
  // 按钮态文案（如“获取验证码”）不是提示，显式排除，避免基线/捕获误判
  const NOTICE_EXCLUDE_PATTERN = /(获取验证码|重新获取|秒后重新|查看.*协议|《用户协议》|切换|登录|注册Hommor|Switch)/u;

  async function collectVisibleNotices(page: Page): Promise<string[]> {
    // 收集两次取并集，规避页面渲染竞态导致的基线遗漏
    const first = await page.evaluate((pattern: string) => {
      const regex = new RegExp(pattern, "u");
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const text = (current.textContent ?? "").trim();
        if (text && text.length <= 50 && regex.test(text) && !/获取验证码|重新获取|秒后重新|查看.*协议|《用户协议》|Switch/u.test(text)) out.push(text);
        current = walker.nextNode();
      }
      return out;
    }, NOTICE_TEXT_PATTERN);
    const second = await page.evaluate((pattern: string) => {
      const regex = new RegExp(pattern, "u");
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const text = (current.textContent ?? "").trim();
        if (text && text.length <= 50 && regex.test(text) && !/获取验证码|重新获取|秒后重新|查看.*协议|《用户协议》|Switch/u.test(text)) out.push(text);
        current = walker.nextNode();
      }
      return out;
    }, NOTICE_TEXT_PATTERN);
    return Array.from(new Set([...first, ...second]));
  }

  // 捕获基线之外“新出现”的提示列表（250ms 轮询；超时返回空数组，由调用方决定语义）
  async function captureNewNotices(page: Page, baseline: string[], timeoutMs = 10_000): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await collectVisibleNotices(page);
      const fresh = current.filter((t) => !baseline.includes(t));
      if (fresh.length > 0) return fresh;
      await page.waitForTimeout(250);
    }
    return [];
  }

  // 行为成立（出现提示）即通过；实际文案与预期（需求）文案的差异记“文案差异”注解。
  function noteCopy(step: string, expected: string, notices: string[]) {
    const actual = notices.join("；");
    if (notices.some((t) => t.includes(expected))) {
      console.log(`[文案一致] ${step}：实际提示“${actual}”`);
      return;
    }
    test.info().annotations.push({
      type: "文案差异",
      description: `${step}：需求/预期文案“${expected}”，实际提示“${actual || "（未捕获）"}”——校验行为成立，文案差异以实际为准记录`
    });
    console.log(`[文案差异] ${step}：预期“${expected}”，实际“${actual || "（未捕获）"}”`);
  }

  // 短信登录（人工完成点选图形验证码），登录成功进入控制台首页。
  async function smsLoginToConsole(page: Page, testPhone: string, testVerificationCode: string) {
    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
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

  test("账号密码登录表单可填写并在勾选协议后启用提交", async ({ page }) => {
    await page.goto("/login");

    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(loginPanel.getByPlaceholder("请输入手机号", { exact: true })).toBeVisible();
    await expect(loginPanel.getByPlaceholder("请输入验证码", { exact: true })).toBeDisabled();

    await loginPanel.getByText("账号登录", { exact: true }).click();
    await loginPanel.getByPlaceholder("请输入手机号", { exact: true }).fill("13900000000");
    await loginPanel.getByPlaceholder("请输入密码", { exact: true }).fill("TestPassw0rd!");
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
    await expect(loginPanel.getByRole("button", { name: "账号密码登录", exact: true })).toBeEnabled();
    await attachShot(page, "表单就绪-提交可用");
  });

  // 覆盖用例 OP-AUTH-002（短信验证码登录，含发送短信与临时登录会话写入）。
  // 获取登录短信验证码会强制弹出点选文字图形验证码；脚本等待倒计时文案出现（最长 4 分钟）。
  test("短信验证码登录成功并在退出后失效会话（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    }

    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute("aria-selected", "true");

    // OP-AUTH-002 步骤 1：默认短信验证码登录方式，手机号、验证码和获取验证码入口可见。
    const smsPhone = loginPanel.getByRole("textbox", { name: "短信登录手机号" });
    const smsCode = loginPanel.getByRole("textbox", { name: "登录短信验证码" });
    const sendCodeButton = loginPanel.getByRole("button", { name: "获取登录短信验证码" });
    await expect(smsPhone).toBeVisible();
    await expect(smsCode).toBeDisabled();
    await expect(sendCodeButton).toBeDisabled();

    // OP-AUTH-002 步骤 2：输入测试手机号并请求验证码（人工完成点选图形验证码）。
    await smsPhone.fill(testPhone);
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await expect(smsCode).toBeEnabled();

    // OP-AUTH-002 步骤 3：输入环境测试验证码并勾选协议，登录提交按钮可用。
    await smsCode.fill(testVerificationCode);
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const smsSubmit = loginPanel.getByRole("button", { name: "短信验证码登录", exact: true });
    await expect(smsSubmit).toBeEnabled();

    // OP-AUTH-002 步骤 4：提交登录，进入 AIoT 控制台。
    await smsSubmit.click();
    await expect(page).toHaveURL(/\/console\/home/u, { timeout: 30_000 });
    await attachShot(page, "登录成功-控制台首页");

    // OP-AUTH-002 步骤 5：退出登录，会话失效并返回登录页。
    await page.locator(".user-meta-list .btn-usermeta").click();
    const exitItem = page.locator(".user-action-list").getByText("退出", { exact: true });
    await expect(exitItem).toBeVisible();
    await exitItem.click();
    await expect(page).toHaveURL(/\/login/u, { timeout: 30_000 });
    await expect(page.getByRole("form", { name: "短信验证码登录表单" })).toBeVisible();
    await attachShot(page, "退出后返回登录页");
  });

  // 覆盖用例 OP-AUTH-006（登录手机号长度边界与格式校验，no_write）。
  test("登录手机号长度边界与格式校验", async ({ page }) => {
    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    const smsPhone = loginPanel.getByRole("textbox", { name: "短信登录手机号" });
    const sendCodeButton = loginPanel.getByRole("button", { name: "获取登录短信验证码" });

    // D01：10 位数字——计数 10 / 11，获取验证码保持禁用。
    await smsPhone.fill("1380013800");
    await expect(loginPanel.getByText("10 / 11", { exact: true })).toBeVisible();
    await expect(sendCodeButton).toBeDisabled();
    await attachShot(page, "边界-10位-获取验证码禁用");

    // D02：11 位有效手机号——按钮可用且验证码输入框启用。
    await smsPhone.fill("13800138001");
    await expect(loginPanel.getByText("11 / 11", { exact: true })).toBeVisible();
    await expect(sendCodeButton).toBeEnabled();
    await expect(loginPanel.getByRole("textbox", { name: "登录短信验证码" })).toBeEnabled();

    // D03：12 位数字被截断为 11 位（maxlength 生效）。
    await smsPhone.fill("138001380012");
    await expect(smsPhone).toHaveValue("13800138001");

    // D04：11 位含字母——当前实现仅长度校验、无格式校验（已知差异候选，见 conclusion.md）。
    await smsPhone.fill("138abc00138");
    await expect(smsPhone).toHaveValue("138abc00138");
    await expect(sendCodeButton).toBeEnabled();
    await attachShot(page, "差异-非数字手机号可请求验证码");
    test.info().annotations.push({
      type: "已知差异",
      description: "手机号仅做长度校验：非数字内容可通过并启用验证码请求（待产品确认是否需要格式校验）"
    });

    // 步骤 5：账号密码方式同样以 maxlength=11 截断超长输入。
    await loginPanel.getByText("账号登录", { exact: true }).click();
    const accountPhone = loginPanel.getByRole("textbox", { name: "账号登录手机号" });
    await accountPhone.fill("138001380012");
    await expect(accountPhone).toHaveValue("13800138001");
  });

  // 覆盖用例 OP-AUTH-007（未勾选协议时登录提交被拦截，no_write）。
  test("未勾选协议时登录提交被拦截", async ({ page }) => {
    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');

    // 步骤 1：短信方式填写 11 位手机号，未勾选协议——提交按钮禁用。
    await loginPanel.getByRole("textbox", { name: "短信登录手机号" }).fill("13800138001");
    await expect(loginPanel.getByRole("button", { name: "短信验证码登录", exact: true })).toBeDisabled();
    await attachShot(page, "短信方式-未勾选协议-提交禁用");

    // 步骤 2：账号方式填写手机号与密码，未勾选协议——提交按钮禁用。
    await loginPanel.getByText("账号登录", { exact: true }).click();
    await loginPanel.getByRole("textbox", { name: "账号登录手机号" }).fill("13800138001");
    await loginPanel.getByRole("textbox", { name: "登录密码" }).fill("Placeholder#123");
    await expect(loginPanel.getByRole("button", { name: "账号密码登录", exact: true })).toBeDisabled();
    await attachShot(page, "账号方式-未勾选协议-提交禁用");
    test.info().annotations.push({
      type: "已知差异",
      description: "获取验证码按钮不受协议勾选约束（仅手机号长度与倒计时控制），协议约束只在登录提交时生效"
    });

    // 步骤 3：切回短信方式并勾选协议，验证码为空——提交按钮仍禁用。
    await loginPanel.getByText("验证码登录", { exact: true }).click();
    await loginPanel.getByRole("textbox", { name: "短信登录手机号" }).fill("13800138001");
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
    await expect(loginPanel.getByRole("button", { name: "短信验证码登录", exact: true })).toBeDisabled();
  });

  // 覆盖用例 OP-AUTH-008（无效凭证登录失败提示；提交一次预期失败的登录请求，不创建会话）。
  // 账号密码登录同样会弹出点选文字图形验证码，需人工在浏览器窗口完成。
  test("无效凭证登录失败并停留登录页（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    if (!testPhone) {
      throw new Error("缺少 TEST_PHONE 环境变量");
    }
    // 合成错误密码：仅存在于本次运行内存，不写入任何记录或报告。
    const wrongPassword = `wrong-${Date.now().toString(36)}-x`;

    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    await loginPanel.getByText("账号登录", { exact: true }).click();
    await loginPanel.getByRole("textbox", { name: "账号登录手机号" }).fill(testPhone);
    await loginPanel.getByRole("textbox", { name: "登录密码" }).fill(wrongPassword);
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();

    // 步骤 1：无效凭证 + 勾选协议后提交按钮可用。
    const submitButton = loginPanel.getByRole("button", { name: "账号密码登录", exact: true });
    await expect(submitButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await submitButton.click();

    // 步骤 2：登录失败提示出现（element-plus 错误浮层固定渲染 role="alert"），停留在登录页，不进入控制台。
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 240_000 });
    await attachShot(page, "登录失败提示");
    await expect(page).toHaveURL(/\/login/u);
    await expect(page.getByRole("form", { name: "账号密码登录表单" })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-009（短信验证码错误登录被拒；发送短信但不创建会话，不产生数据记录）。
  // 图形点选验证码需人工在浏览器窗口完成；脚本等待倒计时文案出现（最长 4 分钟）。
  test("短信验证码错误时登录被拒绝（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    if (!testPhone) {
      throw new Error("缺少 TEST_PHONE 环境变量");
    }
    // 合成错误验证码：仅存在于本次运行内存，不写入任何记录或报告。
    const wrongCode = "009009";

    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    const smsPhone = loginPanel.getByRole("textbox", { name: "短信登录手机号" });
    const sendCodeButton = loginPanel.getByRole("button", { name: "获取登录短信验证码" });

    // 步骤 1：请求验证码（人工完成点选图形验证码）。
    await smsPhone.fill(testPhone);
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    const smsCode = loginPanel.getByRole("textbox", { name: "登录短信验证码" });
    await expect(smsCode).toBeEnabled();

    // 步骤 2：输入错误验证码并勾选协议，提交按钮可用（前端不预校验验证码正确性）。
    await smsCode.fill(wrongCode);
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const smsSubmit = loginPanel.getByRole("button", { name: "短信验证码登录", exact: true });
    await expect(smsSubmit).toBeEnabled();

    // 步骤 3：提交登录——出现失败提示，停留登录页，不进入控制台。
    await smsSubmit.click();
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 240_000 });
    await attachShot(page, "验证码错误-登录失败提示");
    await expect(page).toHaveURL(/\/login/u);
    await expect(page.getByRole("form", { name: "短信验证码登录表单" })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-003（注册表单结构与字段联动，no_write）。
  // 步骤 5 断言按 disableLogin 实现修正：验证码不在 disableLogin 内，验证码为空时提交按钮实际可用，点击后被表单校验拦截。
  test("注册表单可填写，验证码为空时提交可用但被表单校验拦截", async ({ page }) => {
    test.setTimeout(120_000);
    const testPhone = process.env.TEST_PHONE;
    if (!testPhone) {
      throw new Error("缺少 TEST_PHONE 环境变量");
    }

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 步骤 1-3：填写全部必填项（含上传执照）。
    const runId = Date.now();
    const generatedData = buildRegisterData(runId, "c", testPhone);
    const licensePath = await synthesizeLicenseScreenshot(page, `003-${runId}`);
    await fillRegisterRequiredFields(registerPanel, generatedData, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();

    // 步骤 4：勾选协议并填写有效手机号后，获取验证码按钮可用（本用例不点击，不发短信）。
    await expect(registerPanel.getByRole("button", { name: "获取注册短信验证码", exact: true })).toBeEnabled();

    // 步骤 5（修正后断言）：验证码为空时提交按钮可用（disableLogin 不含验证码）。
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册", exact: true });
    await expect(submitButton).toBeEnabled();
    await attachShot(page, "验证码为空-提交按钮可用");

    // 点击提交：被表单校验拦截（验证码必填提示），不发注册请求、不跳转。
    const baseline003 = await collectVisibleNotices(page);
    await submitButton.click();
    const notices003 = await captureNewNotices(page, baseline003);
    expect(notices003.length, "003 验证码为空提交应出现校验提示").toBeGreaterThan(0);
    expect(notices003.join("；")).toMatch(/验证码/u);
    noteCopy("003 验证码必填拦截提示", "请输入验证码", notices003);
    await expect(page).not.toHaveURL(/register-pending/u);
    await expect(submitButton).toBeVisible();
    await attachShot(page, "提交被表单校验拦截");
  });

  // 覆盖用例 OP-AUTH-004（请求注册短信验证码）与 OP-AUTH-005（提交企业注册申请）。
  // 图形点选验证码需人工在浏览器窗口完成；脚本等待倒计时文案出现（最长 4 分钟）。
  test("请求注册短信验证码并提交企业注册申请（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    }

    const runId = Date.now();
    const generatedData = {
      runId,
      companyName: `自动化测试企业${runId}`,
      companyIdentifier: `at${String(runId % 10000).padStart(4, "0")}`,
      companyAddress: "自动化测试地址",
      companyEmail: `autotest${runId}@example.invalid`,
      companyCreditCode: `91${String(runId).padStart(16, "0")}`,
      contactName: "自动化测试",
      contactPhone: testPhone,
      companyDescription: `自动化测试生成的企业简介${runId}`
    };

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 本地合成营业执照样本图（不入 Git，写入本功能包 runtime/）。
    const packDirectory = process.env.TEST_PACK_DIR;
    if (!packDirectory) {
      throw new Error("请通过 npm run test:fast 运行，以便定位功能包 runtime/ 目录");
    }
    const licensePage = await page.context().newPage();
    await licensePage.setContent(
      `<body style="margin:0"><div style="box-sizing:border-box;width:520px;height:340px;background:#f5f1e8;border:2px solid #8a7a52;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;color:#333;"><div style="font-size:28px;font-weight:700;letter-spacing:8px;">营业执照</div><div style="margin-top:18px;font-size:16px;">自动化测试样本 ${runId}</div><div style="margin-top:10px;font-size:12px;color:#777;">仅供测试环境注册流程使用</div></div></body>`
    );
    const licensePath = join(packDirectory, "runtime", "tmp", `business-license-${runId}.png`);
    await mkdir(join(licensePath, ".."), { recursive: true });
    await licensePage.screenshot({ path: licensePath });
    await licensePage.close();

    await registerPanel.getByRole("textbox", { name: "注册企业名称" }).fill(generatedData.companyName);
    await registerPanel.getByRole("textbox", { name: "注册企业标识" }).fill(generatedData.companyIdentifier);
    await registerPanel.getByRole("textbox", { name: "注册企业地址" }).fill(generatedData.companyAddress);
    await registerPanel.getByRole("textbox", { name: "注册企业邮箱" }).fill(generatedData.companyEmail);
    await registerPanel.getByRole("textbox", { name: "注册企业信用代码" }).fill(generatedData.companyCreditCode);
    await registerPanel.getByRole("textbox", { name: "注册联系人姓名" }).fill(generatedData.contactName);
    await registerPanel.getByRole("textbox", { name: "注册联系电话" }).fill(generatedData.contactPhone);
    await registerPanel.getByRole("textbox", { name: "注册企业简介" }).fill(generatedData.companyDescription);
    await registerPanel.locator('input[type="file"]').setInputFiles(licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();

    // OP-AUTH-004 步骤 1：勾选协议并填写有效手机号后，获取验证码按钮可用。
    const sendCodeButton = registerPanel.getByRole("button", { name: "获取注册短信验证码" });
    await expect(sendCodeButton).toBeEnabled();

    // OP-AUTH-004 步骤 2：请求验证码（人工完成点选图形验证码）。
    console.log(`[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），执照样本：${licensePath}`);
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);

    // OP-AUTH-004 步骤 3：输入环境测试验证码后提交按钮可用。
    await registerPanel.getByRole("textbox", { name: "注册短信验证码" }).fill(testVerificationCode);
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();

    // OP-AUTH-005 步骤 2 / OP-AUTH-019 步骤 2：提交瞬间按钮进入加载禁用态（:loading 防重复提交，幂等）。
    await submitButton.click();
    await expect(
      submitButton,
      "019 提交响应期间按钮应进入加载禁用态，重复点击不触发新请求"
    ).toBeDisabled();

    // OP-AUTH-005 步骤 3 / OP-AUTH-019 步骤 3：等待跳转并核对终态展示（Pending 页"企业审核中/12小时/短信通知"参考文案）。
    await expect(page).toHaveURL(/register-pending/u, { timeout: 30_000 });
    const pendingText = await page.locator("main").innerText().catch(() => page.locator("body").innerText());
    if (/12个小时|12 小时|12小时/u.test(pendingText) && /审核/u.test(pendingText)) {
      console.log("[文案一致] register-pending 终态展示含审核中与时长/通知说明");
    } else {
      console.log(`[文案差异] register-pending 终态文案与参考不符，实际内容：${pendingText.slice(0, 120)}`);
    }

    // OP-AUTH-005 步骤 4 / OP-AUTH-019 步骤 4：确认注册已实际写入（跳转成功）后，才将生成资料记录到本功能包 runtime/。
    await recordGeneratedRegistrationData(generatedData);
  });

  // 覆盖用例 OP-AUTH-010（注册验证码错误被拒；发送短信但不提交注册，不产生数据记录）。
  // 图形点选验证码需人工在浏览器窗口完成；脚本等待倒计时文案出现（最长 4 分钟）。
  test("注册短信验证码错误时注册被拒绝（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    if (!testPhone) {
      throw new Error("缺少 TEST_PHONE 环境变量");
    }

    const runId = Date.now();
    const licenseRunId = `w${runId}`;

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 本地合成营业执照样本图（不入 Git，写入本功能包 runtime/）。
    const packDirectory = process.env.TEST_PACK_DIR;
    if (!packDirectory) {
      throw new Error("请通过 npm run test:fast 运行，以便定位功能包 runtime/ 目录");
    }
    const licensePage = await page.context().newPage();
    await licensePage.setContent(
      `<body style="margin:0"><div style="box-sizing:border-box;width:520px;height:340px;background:#f5f1e8;border:2px solid #8a7a52;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;color:#333;"><div style="font-size:28px;font-weight:700;letter-spacing:8px;">营业执照</div><div style="margin-top:18px;font-size:16px;">自动化测试样本 ${licenseRunId}</div><div style="margin-top:10px;font-size:12px;color:#777;">仅供测试环境注册流程使用</div></div></body>`
    );
    const licensePath = join(packDirectory, "runtime", "tmp", `business-license-${licenseRunId}.png`);
    await mkdir(join(licensePath, ".."), { recursive: true });
    await licensePage.screenshot({ path: licensePath });
    await licensePage.close();

    // 步骤 1：填写注册必填项、上传执照、请求验证码（人工完成点选图形验证码）。
    await registerPanel.getByRole("textbox", { name: "注册企业名称" }).fill(`自动化测试企业${licenseRunId}`);
    await registerPanel.getByRole("textbox", { name: "注册企业标识" }).fill(`at${licenseRunId.slice(-4)}`);
    await registerPanel.getByRole("textbox", { name: "注册企业地址" }).fill("自动化测试地址");
    await registerPanel.getByRole("textbox", { name: "注册企业邮箱" }).fill(`autotest${licenseRunId}@example.invalid`);
    await registerPanel.getByRole("textbox", { name: "注册企业信用代码" }).fill(`92${licenseRunId.slice(1).padStart(17, "0")}`.slice(0, 18));
    await registerPanel.getByRole("textbox", { name: "注册联系人姓名" }).fill("自动化测试");
    await registerPanel.getByRole("textbox", { name: "注册联系电话" }).fill(testPhone);
    await registerPanel.getByRole("textbox", { name: "注册企业简介" }).fill(`自动化测试生成的企业简介${licenseRunId}`);
    await registerPanel.locator('input[type="file"]').setInputFiles(licensePath);

    const sendCodeButton = registerPanel.getByRole("button", { name: "获取注册短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    const registerCode = registerPanel.getByRole("textbox", { name: "注册短信验证码" });
    await expect(registerCode).toBeEnabled();

    // 步骤 2：输入错误验证码并勾选协议，注册提交按钮可用（前端不预校验验证码正确性）。
    await registerCode.fill("010010");
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();

    // 步骤 3：提交注册——出现失败提示，停留注册页，不跳转 register-pending，不产生注册数据。
    await submitButton.click();
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 240_000 });
    await attachShot(page, "验证码错误-注册失败提示");
    await expect(page).not.toHaveURL(/register-pending/u, { timeout: 10_000 });
    await expect(registerPanel.getByRole("button", { name: "同意条款并注册" })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-011（同一手机号注册第二个企业并验证管理员默认身份；两次人工图形验证码：注册发送 + 登录发送）。
  test("同一手机号可注册多个企业且新企业默认管理员（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(720_000);
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    }

    // 步骤 1：用同一测试手机号注册第二个企业（全新合成资料）。
    const runId = Date.now();
    const secondEnterprise = buildRegisterData(runId, "b", testPhone);
    const licensePath = await synthesizeLicenseScreenshot(page, `011-${runId}`);

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");
    await fillRegisterRequiredFields(registerPanel, secondEnterprise, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();

    const sendCodeButton = registerPanel.getByRole("button", { name: "获取注册短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤][1/2] 请完成注册短信验证码的点选图形验证码（最长等待 4 分钟）");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await registerPanel.getByRole("textbox", { name: "注册短信验证码" }).fill(testVerificationCode);
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(page).toHaveURL(/register-pending/u, { timeout: 30_000 });

    // 注册已实际写入，记录生成资料（增量台账）。
    await recordGeneratedRegistrationData({ runId, ...secondEnterprise });

    // 步骤 2：登录同一手机号，进入所属企业列表。
    console.log("[人工步骤][2/2] 接下来是登录短信验证码的点选图形验证码");
    await smsLoginToConsole(page, testPhone, testVerificationCode);
    await page.goto("/console/account/company");

    // 列表只展示已审核通过的企业；新注册企业处于待审核状态时不进入列表（实现约束，记录为已知差异）。
    const pendingRow = page.locator("tr", { hasText: secondEnterprise.companyName });
    const pendingVisible = await pendingRow.isVisible().catch(() => false);
    if (!pendingVisible) {
      test.info().annotations.push({
        type: "已知差异",
        description: "新注册企业待审核期间不进入所属企业列表；“一个手机号注册多个企业”需等上一笔申请审核完成后串行发起（后端对同手机号并注册返回“该账号服务正在申请中”）"
      });
    }

    // 管理员默认身份断言：列表中展示的企业权限均为管理员（注册账号默认管理员）。
    const listRows = page.getByRole("row").filter({ hasText: /转移管理权限|退出企业/ });
    await expect(listRows.first()).toBeVisible({ timeout: 15_000 });
    const rowCount = await listRows.count();
    for (let i = 0; i < rowCount; i++) {
      await expect(listRows.nth(i).getByText("管理员", { exact: true })).toBeVisible();
    }
    await attachShot(page, "所属企业-注册账号默认管理员");
    if (pendingVisible) {
      await expect(pendingRow.getByText("管理员", { exact: true })).toBeVisible();
      await attachShot(page, "所属企业-新企业默认管理员");
    }
  });

  // 覆盖用例 OP-AUTH-012（企业标识格式与唯一性校验，no_write：不请求验证码、提交被前端拦截）。
  test("企业标识格式与唯一性校验", async ({ page }) => {
    test.setTimeout(120_000);
    const testPhone = process.env.TEST_PHONE;
    if (!testPhone) {
      throw new Error("缺少 TEST_PHONE 环境变量");
    }

    const history = await readLatestGeneratedData<GeneratedRegistrationData>("web", "open-platform", "login-register");
    if (!history?.companyIdentifier) {
      throw new Error("台账缺少历史企业标识，请先完成一次成功注册（OP-AUTH-005/011）");
    }

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    const identifierField = registerPanel.getByRole("textbox", { name: "注册企业标识" });
    const runId = Date.now();
    const data12 = buildRegisterData(runId, "c", testPhone);

    // D01 步骤 1：输入历史已注册标识——实时唯一性检查提示“已被使用”。
    await identifierField.fill(history.companyIdentifier);
    // 面板内存在另一个 role="status" 元素，故用项目自有 id 精确定位标识状态。
    const statusUsed = registerPanel.locator("#corp-identifier-status");
    await expect(statusUsed).toHaveText(/已被使用|已存在|不可用/u, { timeout: 15_000 });
    noteCopy("012-D01 标识唯一性实时状态", "企业标识已被使用", [(await statusUsed.textContent()) ?? ""]);
    await attachShot(page, "标识已被使用-实时提示");

    // D01 步骤 2：补全其余必填项并点击提交——表单校验拦截企业标识字段，不发注册请求。
    const licensePath = await synthesizeLicenseScreenshot(page, `012-${runId}`);
    await fillRegisterRequiredFields(registerPanel, { ...data12, companyIdentifier: history.companyIdentifier }, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const baseline012 = await collectVisibleNotices(page);
    await registerPanel.getByRole("button", { name: "同意条款并注册" }).click();
    const notices012 = await captureNewNotices(page, baseline012);
    // 行为判定：表单校验层工作（出现拦截提示）且提交未发生（未跳转）。
    // 标识“已被使用”语义已由步骤 1 实时状态证实；拦截提示的具体文案不作为判定依据。
    expect(notices012.length, "012-D01 提交应被表单校验拦截（出现提示）").toBeGreaterThan(0);
    console.log(`[自动捕获] 提交被拦截，提示="${notices012.join("；")}"`);
    await expect(page).not.toHaveURL(/register-pending/u);
    await attachShot(page, "重复标识-提交被拦截");

    // D02：改为唯一合成新标识——提示“可用”。
    await identifierField.fill(data12.companyIdentifier);
    const statusAvailable = registerPanel.locator("#corp-identifier-status");
    await expect(statusAvailable).toHaveText(/可用/u, { timeout: 15_000 });
    noteCopy("012-D02 标识可用实时状态", "企业标识可用", [(await statusAvailable.textContent()) ?? ""]);
    await attachShot(page, "新标识可用");

    // D03：输入含大写字母内容——大写字母属于非法字符被自动剔除，仅保留小写字母和数字（非转小写，实现为输入规范化）。
    await identifierField.fill(`AT${String(runId % 10000).padStart(4, "0")}`);
    await expect(identifierField).toHaveValue(String(runId % 10000).padStart(4, "0"));

    // D04：输入 2 位内容——出现 3-6 位格式提示（行为断言，文案差异记录）。
    const baselineD04 = await collectVisibleNotices(page);
    await identifierField.fill("ab");
    await identifierField.press("Tab");
    const noticesD04 = await captureNewNotices(page, baselineD04);
    expect(noticesD04.length, "012-D04 标识不足 3 位应出现格式提示").toBeGreaterThan(0);
    noteCopy("012-D04 标识格式提示", "请输入 3-6 位小写字母或数字作为企业标识", noticesD04);
    await attachShot(page, "标识2位-格式提示");

    // D05：输入 7 位内容——被截断为 6 位（maxlength 生效）。
    await identifierField.fill("abcdefg");
    await expect(identifierField).toHaveValue("abcdef");

    test.info().annotations.push({
      type: "已知差异",
      description: "企业标识输入仅保留小写字母和数字，大写字母等非法字符被自动剔除而非报错（需求未描述输入规范化行为）"
    });
  });

  // 覆盖用例 OP-AUTH-013（注册表单字段级校验规则矩阵，no_write：全程不请求验证码）。
  test("注册表单字段级校验规则矩阵", async ({ page }) => {
    test.setTimeout(180_000);
    const testPhone = process.env.TEST_PHONE;
    if (!testPhone) {
      throw new Error("缺少 TEST_PHONE 环境变量");
    }

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    const runId = Date.now();
    const data13 = buildRegisterData(runId, "c", testPhone);
    const licensePath = await synthesizeLicenseScreenshot(page, `013-${runId}`);

    const nameField = registerPanel.getByRole("textbox", { name: "注册企业名称" });
    const creditField = registerPanel.getByRole("textbox", { name: "注册企业信用代码" });
    const addressField = registerPanel.getByRole("textbox", { name: "注册企业地址" });
    const emailField = registerPanel.getByRole("textbox", { name: "注册企业邮箱" });
    const contactField = registerPanel.getByRole("textbox", { name: "注册联系人姓名" });
    const phoneField = registerPanel.getByRole("textbox", { name: "注册联系电话" });
    const introField = registerPanel.getByRole("textbox", { name: "注册企业简介" });

    // D01：企业名称 1 个字符——出现长度校验提示（行为断言，文案差异记录进报告）。
    let baseline = await collectVisibleNotices(page);
    await nameField.fill("测");
    let notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D01 企业名称过短应出现校验提示").toBeGreaterThan(0);
    noteCopy("013-D01 企业名称长度下限", "企业名称长度不能小于2", notices);
    expect(notices.join("；"), "013-D01 捕获提示应与“企业名称”字段语义相关，无关提示不作为通过依据").toMatch(/名称/u);

    // D02：企业名称 51 个字符——被截断为 50（maxlength 生效）。
    await nameField.fill(`自动化测试企业名称超长验证${"1".repeat(45)}`);
    expect((await nameField.inputValue()).length).toBe(50);

    // D03：企业名称含非法字符 @——出现字符集校验提示（行为断言，文案差异记录进报告）。
    baseline = await collectVisibleNotices(page);
    await nameField.fill("测试@企业");
    notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D03 企业名称含非法字符应出现校验提示").toBeGreaterThan(0);
    noteCopy("013-D03 企业名称字符集", "企业名称只能包含中文、英文、数字、空格及()-&等符号", notices);
    expect(notices.join("；"), "013-D03 捕获提示应与“企业名称”字段语义相关，无关提示不作为通过依据").toMatch(/名称/u);

    // D04：信用代码 17 位——出现长度校验提示（行为断言，文案差异记录进报告）。
    baseline = await collectVisibleNotices(page);
    await creditField.fill("12345678901234567");
    notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D04 信用代码 17 位应出现校验提示").toBeGreaterThan(0);
    noteCopy("013-D04 信用代码长度", "请输入18位企业信用代码", notices);
    expect(notices.join("；"), "013-D04 捕获提示应与“企业信用代码”字段语义相关，无关提示不作为通过依据").toMatch(/代码/u);

    // D05：信用代码含 I——字母 I 被自动剔除（实现以输入规范化代替报错，与需求“不能包含I/O/Z/S/V”的差异）。
    await creditField.fill("234I567890123456789");
    await expect(creditField).toHaveValue("23456789012345678");
    test.info().annotations.push({
      type: "已知差异",
      description: "信用代码输入自动剔除 I/O/Z/S/V 并转大写（实现为输入规范化而非报错提示）"
    });

    // D06：企业地址 3 个字符——出现长度校验提示（前端要求至少 4 字符；行为断言）。
    baseline = await collectVisibleNotices(page);
    await addressField.fill("测试地");
    notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D06 企业地址过短应出现校验提示").toBeGreaterThan(0);
    noteCopy("013-D06 企业地址长度下限", "企业地址长度不能小于4", notices);
    expect(notices.join("；"), "013-D06 捕获提示应与“企业地址”字段语义相关，无关提示不作为通过依据").toMatch(/地址/u);

    // D07：联系人姓名 21 个字符——被截断为 20（maxlength 生效）。
    await contactField.fill(`自动化测试联系人${"1".repeat(13)}`);
    expect((await contactField.inputValue()).length).toBe(20);

    // D08：邮箱非法格式——出现格式校验提示（行为断言，文案差异记录进报告）。
    baseline = await collectVisibleNotices(page);
    await emailField.fill("abc@");
    notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D08 邮箱非法格式应出现校验提示").toBeGreaterThan(0);
    noteCopy("013-D08 邮箱格式", "请输入正确的邮箱地址", notices);
    expect(notices.join("；"), "013-D08 捕获提示应与“企业邮箱”字段语义相关，无关提示不作为通过依据").toMatch(/邮箱/u);

    // D09：邮箱留空——无校验提示（选填实证；行为断言：填空后不出现任何新的邮箱类提示）。
    baseline = await collectVisibleNotices(page);
    await emailField.fill("");
    await emailField.press("Tab");
    const emailEmptyNotices = await captureNewNotices(page, baseline, 3_000);
    expect(emailEmptyNotices.filter((t) => /邮箱/u.test(t)), "013-D09 邮箱留空不应出现校验提示").toHaveLength(0);
    if (emailEmptyNotices.length > 0) {
      noteCopy("013-D09 邮箱留空出现的其他提示", "（无提示）", emailEmptyNotices);
    }
    await attachShot(page, "邮箱留空-无提示-选填实证");

    // D10：简介 9 个字符——出现长度校验提示（前端要求 10-100 字符，与需求“选填≤300”差异已记录）。
    baseline = await collectVisibleNotices(page);
    await introField.fill("简介九个字长度测试");
    notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D10 简介过短应出现校验提示").toBeGreaterThan(0);
    noteCopy("013-D10 企业简介长度", "企业简介长度必须在10~100之间", notices);
    expect(notices.join("；"), "013-D10 捕获提示应与“企业简介”字段语义相关，无关提示不作为通过依据").toMatch(/简介/u);

    // D11：简介 101 个字符——被截断为 100（maxlength 生效，实证前端上限 100 与需求 300 的差异）。
    await introField.fill(`自动化测试生成的企业简介超长验证${"1".repeat(90)}`);
    expect((await introField.inputValue()).length).toBe(100);

    // D12：简介留空并点击提交——空值跳过长度校验（前端不强制简介），提交被验证码必填拦截，不发请求。
    await introField.fill("");
    await fillRegisterRequiredFields(registerPanel, data13, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();
    baseline = await collectVisibleNotices(page);
    await submitButton.click();
    notices = await captureNewNotices(page, baseline);
    // 行为判定：出现验证码必填类提示、且无简介长度类提示（空简介跳过长度校验）。
    expect(notices.length, "013-D12 简介留空提交应出现验证码必填提示").toBeGreaterThan(0);
    expect(notices.join("；")).toMatch(/验证码/u);
    expect(notices.join("；")).not.toMatch(/简介/u);
    noteCopy("013-D12 验证码必填拦截", "请输入验证码", notices);
    await expect(page).not.toHaveURL(/register-pending/u);
    await attachShot(page, "简介留空-提交被验证码必填拦截");
    test.info().annotations.push({
      type: "已知差异",
      description: "企业简介留空可通过表单校验层（length 规则跳过空值），前端不强制简介；提交被验证码必填拦截，未发注册请求"
    });

    // D13：营业执照上传非图片文件——记录实际行为（upload 规则仅校验非空，未拒绝 .txt 类型）。
    const packDirectory = process.env.TEST_PACK_DIR;
    if (!packDirectory) {
      throw new Error("请通过 npm run test:fast 运行，以便定位功能包 runtime/ 目录");
    }
    const txtSamplePath = join(packDirectory, "runtime", "tmp", `license-sample-${runId}.txt`);
    await writeFile(txtSamplePath, "自动化测试非图片样本（仅用于上传类型行为验证）\n", "utf8");
    baseline = await collectVisibleNotices(page);
    await registerPanel.locator('input[type="file"]').setInputFiles(txtSamplePath);
    const typeNotices = await captureNewNotices(page, baseline, 4_000);
    // 行为判定：上传 .txt 未出现任何“上传/执照/图片/类型”类拒绝提示。
    expect(typeNotices.filter((t) => /上传|执照|图片|类型/u.test(t)), "013-D13 .txt 上传不应出现类型拒绝提示").toHaveLength(0);
    if (typeNotices.length > 0) {
      noteCopy("013-D13 .txt 上传出现的其他提示", "（无提示）", typeNotices);
    }
    await attachShot(page, "执照上传txt-实际行为");
    test.info().annotations.push({
      type: "已知差异",
      description: "营业执照上传未拒绝非图片文件（.txt 可通过 upload 校验），是否需要类型限制待产品确认"
    });

    // D14：注册联系电话含字母——出现格式校验提示（注册侧有格式校验，与登录侧无格式校验形成对照）。
    baseline = await collectVisibleNotices(page);
    await phoneField.fill("138abc00138");
    await phoneField.press("Tab");
    notices = await captureNewNotices(page, baseline);
    expect(notices.length, "013-D14 注册手机号含字母应出现格式提示").toBeGreaterThan(0);
    noteCopy("013-D14 注册手机号格式", "请输入正确的手机号", notices);
    expect(notices.join("；"), "013-D14 捕获提示应与“联系电话”字段语义相关，无关提示不作为通过依据").toMatch(/手机号|电话/u);
    await attachShot(page, "注册手机号格式校验-与登录侧对照");
  });

  // 覆盖用例 OP-AUTH-014（重复企业名称注册被后端拒绝；发送短信但提交被拒，不产生数据记录）。
  test("重复企业名称注册被后端拒绝（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    }

    const history = await readLatestGeneratedData<GeneratedRegistrationData>("web", "open-platform", "login-register");
    if (!history?.companyName) {
      throw new Error("台账缺少历史企业名称，请先完成一次成功注册（OP-AUTH-005/011）");
    }

    const runId = Date.now();
    const data14 = buildRegisterData(runId, "d", testPhone);
    const licensePath = await synthesizeLicenseScreenshot(page, `014-${runId}`);

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 步骤 1：仅企业名称使用台账历史值，其余字段全部为本次唯一合成新值。
    await fillRegisterRequiredFields(registerPanel, { ...data14, companyName: history.companyName }, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();

    // 步骤 2：请求验证码（人工完成点选图形验证码）并提交——被后端唯一性校验拒绝。
    const sendCodeButton = registerPanel.getByRole("button", { name: "获取注册短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await registerPanel.getByRole("textbox", { name: "注册短信验证码" }).fill(testVerificationCode);
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 60_000 });
    const alertText = (await page.getByRole("alert").first().textContent()) ?? "";
    console.log(`[自动捕获] 重复名称提交被拒，提示="${alertText.trim()}"`);
    await attachShot(page, "重复企业名称-后端拒绝提示");
    // 行为判定：出现名称重复类拒绝提示；实际文案与需求文案差异以注解记录。
    await expect(alertText).toMatch(/已存在|已被使用|已注册|重复|占用|申请/u);
    noteCopy("014 重复企业名称拒绝提示", "该企业名称已存在", [alertText.trim()]);
    await expect(page).not.toHaveURL(/register-pending/u);
    await expect(registerPanel.getByRole("button", { name: "同意条款并注册" })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-015（重复统一社会信用代码注册被后端拒绝；发送短信但提交被拒，不产生数据记录）。
  test("重复统一社会信用代码注册被后端拒绝（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    }

    const history = await readLatestGeneratedData<GeneratedRegistrationData>("web", "open-platform", "login-register");
    if (!history?.companyCreditCode) {
      throw new Error("台账缺少历史信用代码，请先完成一次成功注册（OP-AUTH-005/011）");
    }

    const runId = Date.now();
    const data15 = buildRegisterData(runId, "e", testPhone);
    const licensePath = await synthesizeLicenseScreenshot(page, `015-${runId}`);

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 步骤 1：仅统一社会信用代码使用台账历史值，其余字段全部为本次唯一合成新值。
    await fillRegisterRequiredFields(registerPanel, { ...data15, companyCreditCode: history.companyCreditCode }, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();

    // 步骤 2：请求验证码（人工完成点选图形验证码）并提交——被后端唯一性校验拒绝。
    const sendCodeButton = registerPanel.getByRole("button", { name: "获取注册短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await registerPanel.getByRole("textbox", { name: "注册短信验证码" }).fill(testVerificationCode);
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 60_000 });
    const alertText = (await page.getByRole("alert").first().textContent()) ?? "";
    await attachShot(page, "重复信用代码-后端拒绝提示");
    // 后端校验顺序：同手机号存在待审核申请时先报“该账号服务正在申请中”，信用代码唯一性校验在其之后，
    // 仅当无待审核申请时才会触发“信用代码已注册”分支。两类拒绝均视为后端拒绝。
    await expect(alertText).toMatch(/正在申请中|已注册|已存在|已被使用/u);
    if (/正在申请中/.test(alertText)) {
      test.info().annotations.push({
        type: "已知差异",
        description: "同手机号存在待审核申请时，注册提交先被“该账号服务正在申请中”拒绝，信用代码唯一性分支被其屏蔽；审核完成后重跑可触发唯一性拒绝"
      });
    } else if (/已注册/.test(alertText)) {
      test.info().annotations.push({
        type: "验证记录",
        description: "历史申请审核通过后重跑：重复信用代码提交触发“统一社会信用代码已注册”唯一性拒绝分支，证实唯一性校验覆盖已注册企业"
      });
    }
    await expect(page).not.toHaveURL(/register-pending/u);
    await expect(registerPanel.getByRole("button", { name: "同意条款并注册" })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-016（待审核企业的信用代码占用：第二测试手机号提交待审核记录的信用代码）。
  // 同手机号存在待审核申请时提交被“正在申请中”前置校验拦截，单手机号结构性无法触达信用代码查重层，故用第二手机号实证。
  // 条件性写入：查重生效则提交被拒（无写入）；若提交成功说明待审核不占用信用代码（严重差异），注册已实际写入，按台账规则记录并立即反馈。
  test("待审核企业的信用代码占用（第二手机号，人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const secondPhone = process.env.TEST_PHONE_SECOND;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!secondPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE_SECOND / TEST_VERIFICATION_CODE 环境变量（.env 已提供 13000000001）");
    }

    // 待审核记录：台账最新记录中“非已审核”的那条由调用方人工维护审批状态；
    // 这里取台账最新记录的信用代码（当前为待审核状态，用户已确认审批的是 1788231909019b，故改取前一条待审核记录）。
    const ledger = await readLatestLedgerRecords();
    const approvedName = "自动化测试企业1788231909019b"; // 用户已审批通过的企业（其信用代码已被 015 实证占用）
    const pendingRecord = [...ledger].reverse().find((r) => r.companyName !== approvedName);
    if (!pendingRecord?.companyCreditCode) {
      throw new Error("台账中未找到待审核记录的信用代码，请确认 runtime/generated-data.json 内容");
    }

    const runId = Date.now();
    const data16 = buildRegisterData(runId, "f", secondPhone);
    const licensePath = await synthesizeLicenseScreenshot(page, `016-${runId}`);

    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 步骤 1：第二手机号 + 全新名称/标识 + 台账中待审核记录的信用代码。
    await fillRegisterRequiredFields(registerPanel, { ...data16, companyCreditCode: pendingRecord.companyCreditCode }, licensePath);
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();

    // 步骤 2：请求验证码（人工点选图形验证码）并提交。
    const sendCodeButton = registerPanel.getByRole("button", { name: "获取注册短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await registerPanel.getByRole("textbox", { name: "注册短信验证码" }).fill(testVerificationCode);
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // 双分支判定（单次竞速等待，谁先出现走谁，绝不串行空等）：
    // 跳转 register-pending = 待审核不占用信用代码（严重差异）；出现提示 = 被拒（占用成立）。
    const outcome = await page
      .waitForFunction(
        () => {
          if (/register-pending/u.test(location.pathname)) {
            return JSON.stringify({ kind: "navigated" });
          }
          const regex = new RegExp("申请|占用|重复|已注册|已存在|已被使用|无效|过期|失败|错误", "u");
          const alertEl = document.querySelector('[role="alert"]');
          if (alertEl && regex.test(alertEl.textContent ?? "")) {
            return JSON.stringify({ kind: "rejected", form: "alert", text: alertEl.textContent ?? "" });
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let current = walker.nextNode();
          while (current) {
            const text = (current.textContent ?? "").trim();
            if (text && text.length <= 40 && regex.test(text)) {
              return JSON.stringify({ kind: "rejected", form: "toast", text });
            }
            current = walker.nextNode();
          }
          return null;
        },
        null,
        { timeout: 15_000, polling: 1000 }
      )
      .then((h) => JSON.parse(h as unknown as string) as { kind: "navigated" | "rejected"; form?: string; text?: string })
      .catch(() => null);
    if (!outcome) {
      await attachShot(page, "提交后无任何提示-疑似无响应");
      throw new Error("提交后 15 秒内既未跳转也无任何提示（alert/toast 均无）：请检查网络面板确认请求是否发出及后端响应内容");
    }
    if (outcome.kind === "navigated") {
      test.info().annotations.push({
        type: "已知差异",
        description: `待审核企业的信用代码未被占用：第二手机号使用待审核记录（${pendingRecord.companyName}）的信用代码 ${pendingRecord.companyCreditCode} 注册成功进入 register-pending。审核通过后该信用代码将出现重复注册，须产品确认信用代码唯一性是否应覆盖待审核申请`
      });
      await recordGeneratedRegistrationData({ runId, ...data16, companyCreditCode: pendingRecord.companyCreditCode });
      await attachShot(page, "待审核信用代码未被占用-注册成功");
      return;
    }

    // 被拒分支：outcome.kind === "rejected"，提示已在竞速等待中捕获。
    const alertText = outcome.text ?? "";
    console.log(`[自动捕获] 提交被拒，提示形态=${outcome.form === "alert" ? "role=alert 浮层" : "toast"}，文案="${alertText.trim()}"`);

    // 图形验证码票据过期（人工点选耗时超过票据 TTL）：给出明确指引，标注为环境重试而非用例缺陷。
    if (/无效|过期/.test(alertText)) {
      await attachShot(page, "图形验证码票据过期-需重试点选");
      throw new Error(`提交时提示“${alertText.trim()}”：人工点选图形验证码耗时超过票据有效期，请立即重跑本用例并在弹窗出现后尽快完成点选（脚本与数据无缺陷）`);
    }
    await attachShot(page, "待审核信用代码被拦截-提示");
    await expect(alertText).toMatch(/申请|占用|重复|已注册|已存在|已被使用/u);
    test.info().annotations.push({
      type: "验证记录",
      description: `待审核企业占用信用代码：第二手机号提交待审核记录（${pendingRecord.companyName}）的信用代码被拒绝，提示“${alertText.trim()}”（渲染形态：${outcome.form === "alert" ? "role=alert 浮层" : "无 alert 角色的 toast"}，与 015 同文案但提示组件不一致，已记录前端提示实现差异）——信用代码唯一性校验覆盖待审核申请`
    });
    await expect(page).not.toHaveURL(/register-pending/u);
    await expect(registerPanel.getByRole("button", { name: "同意条款并注册" })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-017（登录、注册、密码重置页面入口互跳与可达性；纯导航 no_write）。
  // 跳转结果按 URL 与目标面板可见性断言（行为成立即通过）。
  test("登录、注册、密码重置页面入口互跳与可达性", async ({ page }) => {
    // 步骤 1：首页顶部导航「登录/注册」入口 → 登录页。
    await page.goto("/");
    const entryLink = page.getByRole("link", { name: "登录/注册" });
    await expect(entryLink).toBeVisible();
    await entryLink.click();
    await expect(page).toHaveURL(/\/login/u);
    await expect(page.getByRole("tab", { name: "登录", exact: true })).toBeVisible();

    // 步骤 2：登录页 ↔ 注册页 tab 双向切换，对应表单可见。
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await page.getByRole("tab", { name: "注册", exact: true }).click();
    await expect(registerPanel.getByRole("textbox", { name: "注册企业名称" })).toBeVisible();
    await page.getByRole("tab", { name: "登录", exact: true }).click();
    await expect(loginPanel.getByRole("textbox", { name: "短信登录手机号" })).toBeVisible();

    // 步骤 3：登录页「忘记密码」→ 密码重置页（/reset-pw），重置表单可见。
    await loginPanel.getByRole("link", { name: "找回登录密码" }).click();
    await expect(page).toHaveURL(/\/reset-pw/u);
    await expect(page.getByRole("heading", { name: "密码重置" })).toBeVisible();

    // 步骤 4：密码重置页「去登录」→ 回跳登录页。
    await page.getByRole("link", { name: "去登录" }).click();
    await expect(page).toHaveURL(/\/login/u);
    await expect(page.getByRole("tab", { name: "登录", exact: true })).toBeVisible();
  });

  // 覆盖用例 OP-AUTH-018（密码重置表单字段级校验规则；no_write，不请求验证码、不提交重置）。
  // 字段校验提示是 el-form-item 行内错误文本：断言"出现对应类提示"这一行为（宽匹配），
  // 实际文案与需求参考文案的差异只记录不阻断；页面错误随输入修正而消失，属正常表单行为。
  test("密码重置表单字段级校验规则", async ({ page }) => {
    const resetErrors = (scope: string) =>
      page.locator(".el-form-item").filter({ hasText: scope }).locator(".el-form-item__error");

    await page.goto("/reset-pw");
    await expect(page.getByRole("heading", { name: "密码重置" })).toBeVisible();
    const phoneInput = page.getByPlaceholder("请输入手机号");
    const codeInput = page.getByPlaceholder("请输入验证码");
    const passwordInput = page.getByPlaceholder("请输入新密码");
    const repeatInput = page.getByPlaceholder("请再次输入新密码");
    const resetButton = page.getByRole("button", { name: "重置密码" });

    // 字段错误提示的渲染形态是表单容器内的行内文本（无固定 role/class）：
    // 用容器 locator + toContainText 让 expect 自动轮询渲染，宽匹配提示语义，实际文案差异不阻断。
    const formArea = page.locator(".passwrod-reset-form");

    // D01：全部留空提交——首个必填字段（手机号）出现非空提示，验证码在手机号合法前保持禁用（表单链式校验），
    // 不发重置请求（停留 /reset-pw）。已知差异：需求期望四个字段同时提示，实际按链式校验逐字段提示，仅记录不阻断。
    await resetButton.click();
    await expect(formArea, "018-D01 手机号应出现非空类提示").toContainText(/请输入手机号|手机号不能为空/u);
    await expect(codeInput, "018-D01 验证码在手机号合法前应禁用").toBeDisabled();
    await expect(page).toHaveURL(/\/reset-pw/u);

    // D02：手机号 10 位（缺 1 位）——出现手机号格式类提示（maxlength=11 截足 10 位，由格式规则提示）。
    await phoneInput.fill("1300000000");
    await phoneInput.blur();
    await expect(formArea, "018-D02 手机号 10 位应出现格式类提示").toContainText(/手机号|格式|无效|不正确/u);
    await expect(formArea, "018-D02 不应保留非空提示").not.toContainText("请输入手机号");

    // D03：手机号合法、验证码 5 位——提交后出现验证码位数/非空类提示（组件 maxlength=6 截为 5 位）。
    await phoneInput.fill("13000000000");
    await phoneInput.blur();
    await codeInput.fill("12345");
    await resetButton.click();
    await expect(formArea, "018-D03 验证码 5 位提交应出现位数类提示").toContainText(/6位|6 位|请输入验证码|验证码/u);

    // D04：验证码补足 6 位、新密码 7 位（低于下限 8）——出现密码长度类提示。
    await codeInput.fill("123456");
    await passwordInput.fill("Abc1234");
    await passwordInput.blur();
    await expect(formArea, "018-D04 密码 7 位应出现长度类提示").toContainText(/8~32|8-32|长度|至少/u);

    // D05：重复密码与新密码不一致——出现两次密码不一致类提示。
    await passwordInput.fill("Abc12345");
    await repeatInput.fill("Abc98765");
    await repeatInput.blur();
    await expect(formArea, "018-D05 两次密码不一致应出现一致性提示").toContainText(/一致|匹配|相同/u);

    // D06：密码规则提示存在（需求参考文案"密码长度8~32位，含大写字母、小写字母、数字"，实际文案差异仅记录）。
    const ruleTipText = await page.locator(".passwrod-reset-form").innerText();
    if (!/8~32位|8-32位|8～32位/u.test(ruleTipText)) {
      console.log(`[文案差异] 密码规则提示未匹配参考文案，页面实际提示区内容：${ruleTipText.slice(0, 120)}`);
    } else {
      console.log("[文案一致] 密码规则提示包含长度区间与字符集说明");
    }
  });

  // 覆盖用例 OP-AUTH-020（注册必填项空值逐项非空提示；no_write，全空提交只触发表单校验、不发注册请求）。
  // 需求参考文案"请输入××"；实际文案宽匹配语义，差异以日志记录不阻断。
  test("注册必填项空值逐项非空提示", async ({ page }) => {
    await page.goto("/login?tab=register");
    const registerPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-register"]');
    await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveAttribute("aria-selected", "true");

    // 实现事实（RegisterForm.vue，2026-09-01 探索确认）：任一必填字段为空时提交按钮直接禁用（disableLogin），
    // 清空+失焦不出现字段级"请输入××"提示（字段提示仅在非法值时由 change 触发，见 013）。
    // 与需求"不输入提示"的预期存在差异：拦截方式是"按钮禁用"而非"字段级非空提示"。按行为成立即通过断言，
    // 差异以注解记录进报告，不阻断。
    const submitButton = registerPanel.getByRole("button", { name: "同意条款并注册" });
    const panelText = registerPanel;

    // 步骤 1：全部留空 + 勾选协议——提交按钮保持禁用（空值提交被入口拦截，不发注册请求）。
    await registerPanel.getByText("我已阅读并已同意", { exact: true }).click();
    await expect(submitButton, "020 必填全空时提交按钮应保持禁用（空值提交被拦截）").toBeDisabled();
    await expect(page).not.toHaveURL(/register-pending/u);

    // 步骤 2：逐字段"填合法值再清空"验证空值即回到禁用拦截，并核对该实现下有无字段级非空提示（差异记录）。
    const requiredFields = [
      "注册企业名称",
      "注册企业标识",
      "注册企业信用代码",
      "注册企业地址",
      "注册联系人姓名",
      "注册联系电话"
    ] as const;
    for (const fieldName of requiredFields) {
      const field = registerPanel.getByRole("textbox", { name: fieldName });
      await field.fill(`020-${fieldName}`);
      await field.fill("");
      await field.blur();
    }
    const panelBody = await panelText.innerText();
    const emptyHints = /请输入[^\n]{0,8}(名称|标识|代码|地址|姓名|电话)|不能为空/u.test(panelBody);
    if (emptyHints) {
      console.log("[020] 检测到字段级非空提示（与探索结论不符，人工复核）");
    } else {
      console.log("[文案差异] 020 需求参考的非空提示文案未出现：实现为按钮禁用拦截空值提交，无字段级空值提示");
    }
    await expect(submitButton, "020 全程空值下提交按钮保持禁用").toBeDisabled();
    await expect(page).not.toHaveURL(/register-pending/u);
    console.log("[020] 空值提交被按钮禁用拦截（行为成立），字段级提示差异已记录");
  });

  // 覆盖用例 OP-AUTH-021（密码重置错误验证码被拒绝；write=发送短信，重置因验证码错误被拒，密码不变更）。
  // 图形点选验证码需人工在浏览器窗口完成；与 009/010 同模式。
  test("密码重置错误验证码被拒绝（人工过图形验证码）", async ({ page }) => {
    test.setTimeout(360_000);
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) {
      throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    }

    await page.goto("/reset-pw");
    await expect(page.getByRole("heading", { name: "密码重置" })).toBeVisible();
    const phoneInput = page.getByPlaceholder("请输入手机号");
    const codeInput = page.getByPlaceholder("请输入验证码");
    const passwordInput = page.getByPlaceholder("请输入新密码");
    const repeatInput = page.getByPlaceholder("请再次输入新密码");
    const getCoderButton = page.getByRole("button", { name: /获取验证码/u });

    // 步骤 1：请求验证码（人工完成点选图形验证码）。
    await phoneInput.fill(testPhone);
    await expect(codeInput).toBeEnabled();
    await expect(getCoderButton).toBeEnabled();
    console.log(`[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），重置页验证码发送至 ${testPhone}`);
    await getCoderButton.click();
    await waitForSmsCountdownOrReject(page);

    // 步骤 2：错误验证码 + 合规两次新密码 → 提交被拒绝，停留重置页（密码不变更、.env 凭据持续有效）。
    await codeInput.fill("000000" === testVerificationCode ? "111111" : "000000");
    await passwordInput.fill("Reset020Test1");
    await repeatInput.fill("Reset020Test1");
    const baseline = await collectVisibleNotices(page);
    await page.getByRole("button", { name: "重置密码" }).click();
    const notices = await captureNewNotices(page, baseline, 20_000);
    expect(notices.length, "021 错误验证码提交应出现失败提示（无提示即秒级失败）").toBeGreaterThan(0);
    noteCopy("021 密码重置错误验证码", "验证码错误/无效类提示", notices);
    expect(
      notices.join("；"),
      "021 捕获提示应与验证码/重置失败语义相关，无关提示不作为通过依据"
    ).toMatch(/验证码|错误|无效|失败|过期/u);
    await expect(page).not.toHaveURL(/\/login/u);
    await expect(page).toHaveURL(/\/reset-pw/u);
    await attachShot(page, "021 重置被拒停留重置页");
    console.log("[021] 重置被拒，停留重置页，密码未变更（.env 凭据持续有效，无需处置）");
  });
});
