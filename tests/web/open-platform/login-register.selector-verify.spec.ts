import { expect, test } from "../../../src/fixtures/webAutomationFixture.js";

// login-register-20260828 无头零写入定位验证：只覆盖未登录可达状态。
// 控制台右上角账号入口（OPEN-LOGIN-004）需要已登录会话，未在本脚本验证范围，
// 其定位来自源码契约（ConsoleHeader.vue 的 el-dropdown 触发器 role=button），
// 留待正式执行以 runtime_validation_pending 方式确认。

test("OPEN-NAV-001/002 verify the homepage navigation entries reachable without login", async ({
  page,
  automationGuard
}) => {
  await page.goto("/");

  const immediateUse = page.getByRole("button", { name: "立即使用 ⇁", exact: true });
  const accountEntry = page.getByRole("link", { name: "登录/注册", exact: true });
  await expect(immediateUse).toHaveCount(1);
  await expect(immediateUse).toBeVisible();
  await expect(immediateUse).toHaveAccessibleName("立即使用 ⇁");
  await immediateUse.click({ trial: true });
  await expect(accountEntry).toHaveCount(1);
  await expect(accountEntry).toBeVisible();
  await expect(accountEntry).toHaveAccessibleName("登录/注册");
  await accountEntry.click({ trial: true });

  expect(automationGuard.blockedAttempts).toEqual([]);
  console.info(`[selector-verification] ${JSON.stringify({
    caseId: "OPEN-NAV-001",
    route: "/",
    selectorType: "role_name",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "首页立即使用与登录/注册入口；顶部控制台、注册、登录独立入口未渲染（与需求五入口结构差异，留待正式执行按用例断言）"
  })}`);
});

test("OPEN-LOGIN-001/002 verify the login panel structure and mode switch entries", async ({
  page,
  automationGuard
}) => {
  await page.goto("/login");

  const region = page.getByRole("region", { name: "开放平台账号访问", exact: true });
  const loginTab = page.getByRole("tab", { name: "登录", exact: true });
  const registerTab = page.getByRole("tab", { name: "注册", exact: true });
  await expect(region).toHaveCount(1);
  await expect(loginTab).toHaveAttribute("aria-selected", "true");
  await expect(registerTab).toHaveCount(1);

  // 默认短信验证码登录表单
  const smsPhone = region.getByLabel("短信登录手机号", { exact: true });
  const smsCode = region.getByLabel("登录短信验证码", { exact: true });
  const getSmsCode = region.getByRole("button", { name: "获取登录短信验证码", exact: true });
  const forgot = region.getByRole("link", { name: "找回登录密码", exact: true });
  // 登录/注册双表单同时挂载：协议文本按登录表单 ARIA 名称作用域，避免双匹配。
  const loginForm = page.getByRole("form", { name: "短信验证码登录表单", exact: true });
  const agreement = loginForm.getByRole("checkbox", { name: "同意登录用户协议", exact: true });
  const agreementLabel = loginForm.getByText("我已阅读并已同意", { exact: true });
  const smsSubmit = region.getByRole("button", { name: "短信验证码登录", exact: true });
  const toPassword = region.getByRole("button", { name: "切换为账号密码登录", exact: true });
  for (const locator of [smsPhone, smsCode, getSmsCode, forgot, smsSubmit, toPassword, agreementLabel]) {
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
  }
  // Element Plus 原生复选框视觉隐藏：以可访问名称解析唯一性，以可见标签承载交互。
  await expect(agreement).toHaveCount(1);
  await expect(agreement).toBeAttached();

  // 切换到账号密码登录表单（只切换，不提交）
  await toPassword.click();
  const phone = region.getByLabel("账号登录手机号", { exact: true });
  const password = region.getByLabel("登录密码", { exact: true });
  const pwSubmit = region.getByRole("button", { name: "账号密码登录", exact: true });
  const toSms = region.getByRole("button", { name: "切换为短信验证码登录", exact: true });
  const passwordForm = page.getByRole("form", { name: "账号密码登录表单", exact: true });
  for (const locator of [phone, password, pwSubmit, toSms, forgot]) {
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
  }
  await expect(passwordForm.getByText("我已阅读并已同意", { exact: true })).toHaveCount(1);
  await expect(passwordForm.getByText("我已阅读并已同意", { exact: true })).toBeVisible();
  // 提交按钮在空表单/未勾选协议时为禁用态，只断言存在与可见，不做试点击。
  await expect(pwSubmit).toBeDisabled();
  await toSms.click();
  await expect(smsPhone).toBeVisible();

  // 登录/注册面板切换
  await registerTab.click();
  const registerForm = page.getByRole("form", { name: "企业注册申请表单", exact: true });
  await expect(registerForm).toBeVisible();
  await loginTab.click();
  await expect(smsPhone).toBeVisible();

  expect(automationGuard.blockedAttempts).toEqual([]);
  console.info(`[selector-verification] ${JSON.stringify({
    caseId: "OPEN-LOGIN-001",
    route: "/login",
    selectorType: "role_label_and_explicit_aria",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "登录/注册双 tab、短信与账号密码双登录方式切换、忘记密码、协议勾选与提交入口；未提交任何登录"
  })}`);
});

test("OPEN-REG-001..014/018 verify the registration form ARIA contract", async ({
  page,
  automationGuard
}) => {
  await page.goto("/login?tab=register");

  const registerTab = page.getByRole("tab", { name: "注册", exact: true });
  const form = page.getByRole("form", { name: "企业注册申请表单", exact: true });
  const upload = form.locator('button[aria-label="上传注册营业执照"]');
  const fieldNames = [
    "注册企业名称",
    "注册企业标识",
    "注册企业地址",
    "注册企业邮箱",
    "注册企业信用代码",
    "注册联系人姓名",
    "注册联系电话",
    "注册短信验证码",
    "注册企业简介"
  ];

  await expect(registerTab).toHaveAttribute("aria-selected", "true");
  await expect(form).toHaveCount(1);
  await expect(form).toBeVisible();
  for (const name of fieldNames) {
    const field = form.getByLabel(name, { exact: true });
    await expect(field).toHaveCount(1);
    await expect(field).toBeVisible();
  }
  await expect(upload).toHaveCount(1);
  await expect(upload).toBeVisible();
  await expect(upload).toHaveAccessibleName("上传注册营业执照");
  await upload.click({ trial: true });
  const requestCode = form.getByRole("button", { name: "获取注册短信验证码", exact: true });
  const submit = form.getByRole("button", { name: "同意条款并注册", exact: true });
  const agreement = form.getByRole("checkbox", { name: "同意注册用户协议", exact: true });
  const agreementLabel = form.getByText("我已阅读并已同意", { exact: true });
  for (const locator of [requestCode, submit, agreementLabel]) {
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
  }
  await expect(agreement).toHaveCount(1);
  await expect(agreement).toBeAttached();
  await expect(submit).toBeDisabled();

  expect(automationGuard.blockedAttempts).toEqual([]);
  console.info(`[selector-verification] ${JSON.stringify({
    caseId: "OPEN-REG-001",
    route: "/login?tab=register",
    selectorType: "role_label_and_explicit_aria",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "注册表单九个字段、营业执照上传入口、验证码获取入口、协议勾选与提交入口；未发送验证码、未上传、未提交"
  })}`);
});
