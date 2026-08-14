import {
  configureFormalSuite,
  expect,
  formalCase,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import { formalExecutionManifest } from "./execution.manifest.js";

configureFormalSuite(formalExecutionManifest);

// 凭据仅从 .env 读取，不入产物、不回显；sensitive 用例（001/004）由 manifest 关闭 Trace/截图采集。
const PHONE = process.env.OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST ?? "";
const PASSWORD = process.env.OPEN_PLATFORM_PRODUCT_ADMIN_PASSWORD_TEST ?? "";
type Page = import("@playwright/test").Page;

const loginSubmit = (page: Page) =>
  page.getByRole("button").filter({ hasText: /^\s*登录\s*$/ });

async function openAccountLogin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button").filter({ hasText: "账号登录" }).first().click();
  await expect(page.getByRole("textbox", { name: "登录密码" })).toBeVisible();
}

// OPEN-PLATFORM-LOGIN-001：正向登录成功（ephemeral_cleanup，敏感产物关闭）
formalCase(
  "OPEN-PLATFORM-LOGIN-001",
  "账号登录正向成功进入控制台",
  async ({ page }, runtime) => {
    await test.step("打开登录页并切换账号登录", async () => {
      await openAccountLogin(page);
    });
    await test.step("填写已确认可用的测试凭据并提交", async () => {
      await page.getByRole("textbox", { name: "账号登录手机号" }).fill(PHONE);
      await page.getByRole("textbox", { name: "登录密码" }).fill(PASSWORD);
      const reservation = await runtime.reserveOperation(
        "authenticate_test_account",
        "OPEN-PLATFORM-LOGIN-001-password-login"
      );
      if (reservation === "existing") {
        throw new Error("001 登录操作已有 reservation，禁止自动重提交");
      }
      await loginSubmit(page).click();
    });
    await test.step("验证登录成功进入登录后页面", async () => {
      // 本地 dev 预期无滑块；若真实出现安全挑战，run 阶段在 --headed 模式人工接管后继续。
      await runtime.verifyBusinessOracle("login-success-console", async () => {
        await expect(page).toHaveURL((url) => !url.pathname.endsWith("/login"), {
          timeout: 30_000
        });
      });
      runtime.addOperationEvidence({
        operation: "authenticate_test_account",
        source: "ui_state",
        contractId: "login-result-ui",
        outcome: "succeeded",
        finality: "final",
        stableIdentity: "not_required",
        fallbackUsed: false,
        reconciliation: "not_required"
      });
    });
  }
);

// OPEN-PLATFORM-LOGIN-002：空手机号阻止登录（no_write）
formalCase(
  "OPEN-PLATFORM-LOGIN-002",
  "账号登录空手机号阻止登录",
  async ({ page }, runtime) => {
    await test.step("账号登录模式，手机号留空", async () => {
      await openAccountLogin(page);
      await page.getByRole("textbox", { name: "登录密码" }).fill("placeholder-pwd");
    });
    await test.step("提交并验证被阻止", async () => {
      await loginSubmit(page).click();
      await page.waitForTimeout(1200);
      await runtime.verifyBusinessOracle("empty-phone-blocked", async () => {
        await expect(page).toHaveURL(/\/login/);
      });
    });
  }
);

// OPEN-PLATFORM-LOGIN-003：空密码阻止登录（no_write）
formalCase(
  "OPEN-PLATFORM-LOGIN-003",
  "账号登录空密码阻止登录",
  async ({ page }, runtime) => {
    await test.step("账号登录模式，密码留空", async () => {
      await openAccountLogin(page);
      await page.getByRole("textbox", { name: "账号登录手机号" }).fill("13800000000");
    });
    await test.step("提交并验证被阻止", async () => {
      await loginSubmit(page).click();
      await page.waitForTimeout(1200);
      await runtime.verifyBusinessOracle("empty-password-blocked", async () => {
        await expect(page).toHaveURL(/\/login/);
      });
    });
  }
);

// OPEN-PLATFORM-LOGIN-004：错误密码登录失败（ephemeral_cleanup，敏感产物关闭）
formalCase(
  "OPEN-PLATFORM-LOGIN-004",
  "账号登录错误密码登录失败",
  async ({ page }, runtime) => {
    await test.step("正确手机号 + 错误密码提交", async () => {
      await openAccountLogin(page);
      await page.getByRole("textbox", { name: "账号登录手机号" }).fill(PHONE);
      // 独立错误常量，不与真实口令派生耦合（MRR-IMP-004 + ES-003）。
      await page
        .getByRole("textbox", { name: "登录密码" })
        .fill("definitely-wrong-password");
      const reservation = await runtime.reserveOperation(
        "authenticate_test_account",
        "OPEN-PLATFORM-LOGIN-004-wrong-password"
      );
      if (reservation === "existing") {
        throw new Error("004 错误密码操作已有 reservation，禁止自动重提交");
      }
      await loginSubmit(page).click();
    });
    await test.step("验证登录失败停留登录页", async () => {
      // 单次受控尝试（MRR-IMP-004：错误密码可能产生服务端锁定计数/审计，no_write 仅指不创建测试会话）。
      await page.waitForTimeout(1500);
      await runtime.verifyBusinessOracle("wrong-password-failed", async () => {
        await expect(page).toHaveURL(/\/login/);
      });
      runtime.addOperationEvidence({
        operation: "authenticate_test_account",
        source: "ui_state",
        contractId: "login-result-ui",
        outcome: "rejected",
        finality: "final",
        stableIdentity: "not_required",
        fallbackUsed: false,
        reconciliation: "not_required"
      });
    });
  }
);

// OPEN-PLATFORM-LOGIN-005：非11位手机号格式阻止登录（no_write）
formalCase(
  "OPEN-PLATFORM-LOGIN-005",
  "账号登录非11位手机号阻止登录",
  async ({ page }, runtime) => {
    await test.step("填写非11位手机号并提交", async () => {
      await openAccountLogin(page);
      await page.getByRole("textbox", { name: "账号登录手机号" }).fill("123");
      await page.getByRole("textbox", { name: "登录密码" }).fill("placeholder-pwd");
      await loginSubmit(page).click();
    });
    await test.step("验证格式校验阻止登录", async () => {
      await page.waitForTimeout(1200);
      await runtime.verifyBusinessOracle("invalid-phone-format-blocked", async () => {
        await expect(page).toHaveURL(/\/login/);
      });
    });
  }
);

// OPEN-PLATFORM-LOGIN-006：账号登录 ↔ 验证码登录模式切换（no_write）
formalCase(
  "OPEN-PLATFORM-LOGIN-006",
  "账号登录与验证码登录模式切换",
  async ({ page }, runtime) => {
    await test.step("默认验证码模式 → 账号登录", async () => {
      await page.goto("/login");
      await page.getByRole("button").filter({ hasText: "账号登录" }).first().click();
      await expect(page.getByRole("textbox", { name: "账号登录手机号" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "登录密码" })).toBeVisible();
    });
    await test.step("账号登录 → 验证码登录并验证", async () => {
      await page.getByRole("button").filter({ hasText: "验证码登录" }).first().click();
      await runtime.verifyBusinessOracle("mode-switch-stable", async () => {
        await expect(page.getByRole("textbox", { name: "短信登录手机号" })).toBeVisible();
      });
    });
  }
);

// OPEN-PLATFORM-LOGIN-007：登录 ↔ 注册 tab 切换（no_write）
formalCase(
  "OPEN-PLATFORM-LOGIN-007",
  "登录与注册 tab 切换",
  async ({ page }, runtime) => {
    await test.step("登录 → 注册 → 登录 tab 切换", async () => {
      await page.goto("/login");
      await page.getByRole("tab", { name: "注册" }).click();
      await page.getByRole("tab", { name: "登录" }).click();
      await runtime.verifyBusinessOracle("tab-switch-stable", async () => {
        await expect(page.getByRole("tab", { name: "登录" })).toHaveAttribute(
          "aria-selected",
          "true"
        );
      });
    });
  }
);
