import { expect, test } from "../../../../src/fixtures/webAutomationFixture.js";

test("OPEN-REG-20260803-025 verifies the source-backed homepage entries", async ({
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
    caseId: "OPEN-REG-20260803-025",
    route: "/",
    selectorType: "role_name",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "首页立即使用与登录/注册入口；顶部控制台、注册、登录入口仍未渲染"
  })}`);
});

test("OPEN-REG-20260803-001 verifies the registration ARIA contract", async ({
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

  await expect(registerTab).toHaveCount(1);
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
  await expect(form.getByRole("button", {
    name: "获取注册短信验证码",
    exact: true
  })).toHaveCount(1);
  await expect(form.getByRole("button", {
    name: "同意条款并注册",
    exact: true
  })).toHaveCount(1);

  expect(automationGuard.blockedAttempts).toEqual([]);
  console.info(`[selector-verification] ${JSON.stringify({
    caseId: "OPEN-REG-20260803-001",
    route: "/login?tab=register",
    selectorType: "role_label_and_explicit_aria",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "注册表单字段、上传触发器、验证码入口与提交入口；未执行真实动作"
  })}`);
});

test("OPEN-LOGIN-20260803-001 verifies the password-login ARIA contract", async ({
  page,
  automationGuard
}) => {
  await page.goto("/login");

  const accountLogin = page.getByRole("button", {
    name: "切换为账号密码登录",
    exact: true
  });
  await expect(accountLogin).toHaveCount(1);
  await accountLogin.click();
  await expect(page.getByLabel("账号登录手机号", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("登录密码", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("checkbox", {
    name: "同意登录用户协议",
    exact: true
  })).toHaveCount(1);
  await expect(page.getByRole("button", {
    name: "账号密码登录",
    exact: true
  })).toHaveCount(1);

  expect(automationGuard.blockedAttempts).toEqual([]);
  console.info(`[selector-verification] ${JSON.stringify({
    caseId: "OPEN-LOGIN-20260803-001",
    route: "/login",
    selectorType: "role_and_label",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "账号密码登录字段、协议与提交入口；未填充凭据、未提交"
  })}`);
});
