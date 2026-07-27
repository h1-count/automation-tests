import "dotenv/config";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { resolveTestEnvironment } from "../src/env/testEnvironment";

const environment = resolveTestEnvironment();
const storageStatePath = environment.openPlatformAuthStatePath;
const suffix = environment.name.toUpperCase();
const username = process.env[`OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_${suffix}`];
const password = process.env[`OPEN_PLATFORM_PRODUCT_ADMIN_PASSWORD_${suffix}`];

if (!storageStatePath) {
  throw new Error(
    `缺少 OPEN_PLATFORM_AUTH_STATE_PATH_${environment.name.toUpperCase()} 配置。`
  );
}
if (!username || !password) {
  throw new Error(`缺少测试身份配置：OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_${suffix} 或密码。`);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

const waitUntil = async (
  condition: () => Promise<boolean>,
  timeout: number,
  errorMessage: string
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(errorMessage);
};

try {
  await page.goto(new URL("/login", environment.openPlatformWebBaseUrl).toString(), {
    waitUntil: "domcontentloaded"
  });

  const loginPanel = page.getByRole("tabpanel", { name: "登录" });
  await loginPanel.getByRole("link", { name: "账号登录", exact: true }).click();

  const phoneInput = loginPanel.getByPlaceholder("请输入手机号");
  const passwordInput = loginPanel.getByPlaceholder("请输入密码");
  const agreementText = loginPanel.getByText("我已阅读并已同意", { exact: true });
  const agreementCheckbox = loginPanel.getByRole("checkbox");
  const loginButton = loginPanel.getByRole("button", { name: "登录", exact: true });
  const sliderChallenge = page.getByText("拖动滑块完成拼图", { exact: true });

  await phoneInput.fill(username);
  await passwordInput.fill(password);
  await agreementText.click();
  if (!(await agreementCheckbox.isChecked())) {
    throw new Error("用户协议未成功勾选，未提交登录。");
  }
  await loginButton.click();

  const isAuthenticated = async () =>
    new URL(page.url()).pathname !== "/login" || !(await loginPanel.isVisible());

  const getLoginOutcome = async (): Promise<"authenticated" | "slider" | "pending"> => {
    if (await isAuthenticated()) {
      return "authenticated";
    }
    if (await sliderChallenge.isVisible()) {
      return "slider";
    }
    return "pending";
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let outcome = await getLoginOutcome();
    const initialDeadline = Date.now() + 15_000;
    while (outcome === "pending" && Date.now() < initialDeadline) {
      await page.waitForTimeout(500);
      outcome = await getLoginOutcome();
    }
    if (outcome === "authenticated") {
      break;
    }

    if (outcome === "slider") {
      console.log(`检测到滑块人机验证（第 ${attempt} 次）。请只完成当前安全验证；脚本会自动继续后续登录步骤。`);
    } else {
      console.log(`登录仍在等待页面安全挑战或确认（第 ${attempt} 次）。请只处理页面实际要求的安全操作；脚本会在页面恢复后自动继续。`);
    }

    await waitUntil(
      async () => {
        if (await isAuthenticated()) {
          return true;
        }
        return (await loginButton.isEnabled()) && !(await sliderChallenge.isVisible());
      },
      300_000,
      "等待人工完成安全挑战超时，未保存认证会话。"
    );

    if (await isAuthenticated()) {
      break;
    }

    await loginButton.click();
  }

  if (!(await isAuthenticated())) {
    throw new Error("登录未完成或出现未识别的人机验证，未保存认证会话。");
  }

  console.log("检测到登录成功，正在保存本地会话。");

  await mkdir(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  await chmod(storageStatePath, 0o600);
  console.log("本地认证会话已保存。该文件仅供本机测试使用，不得提交或分享。");
} finally {
  await browser.close();
}
