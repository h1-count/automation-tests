import "dotenv/config";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { evaluateAppPlanningReadiness } from "../src/env/appPlanningReadiness.js";
import { resolveTestEnvironment, type TestEnvironmentConfig } from "../src/env/testEnvironment";
import { findTestAsset, loadTestAssetManifest, resolveAssetPath, sha256 } from "../src/support/test-assets/assetManifest.js";

type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
}

const results: CheckResult[] = [];
const require = createRequire(import.meta.url);
const argumentsList = process.argv.slice(2);
const planMode = argumentsList.includes("--plan");
const assetArgumentIndex = argumentsList.indexOf("--asset");
const selectedAssetId = assetArgumentIndex >= 0 ? argumentsList[assetArgumentIndex + 1]?.trim() : undefined;
const unsupportedArguments = argumentsList.filter((argument, index) => {
  if (argument === "--plan" || argument === "--asset") {
    return false;
  }
  return argumentsList[index - 1] !== "--asset";
});

if (unsupportedArguments.length > 0 || (assetArgumentIndex >= 0 && !selectedAssetId)) {
  throw new Error(`Unsupported arguments: ${unsupportedArguments.join(", ") || "--asset"}. Supported: --plan [--asset <assetId>].`);
}

function record(status: CheckStatus, name: string, detail: string) {
  results.push({ status, name, detail });
}

function optionalValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function countTestFiles(directory: string): number {
  if (!existsSync(directory)) {
    return 0;
  }

  return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return count + countTestFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? count + 1 : count;
  }, 0);
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20 && major < 25) {
    record("PASS", "Node.js 版本", `检测到 Node.js ${process.versions.node}，符合 package.json 要求。`);
    return;
  }
  record("FAIL", "Node.js 版本", `检测到 Node.js ${process.versions.node}，需要 >=20 且 <25。`);
}

function checkProjectDependencies() {
  try {
    require.resolve("@playwright/test");
    require.resolve("webdriverio");
    record("PASS", "项目依赖", "Playwright 与 WebdriverIO 依赖可解析。`npm install` 已完成。");
  } catch {
    record("FAIL", "项目依赖", "缺少项目依赖。请先在项目根目录执行 npm ci 或 npm install。");
  }
}

function checkPlaywrightBrowser() {
  const executablePath = chromium.executablePath();
  if (executablePath && existsSync(executablePath)) {
    record("PASS", "Playwright Chromium", "Chromium 可执行文件已安装。`npm run test:web` 可以使用默认浏览器。");
    return;
  }
  record("FAIL", "Playwright Chromium", "未检测到 Chromium。请确认后执行 npx playwright install chromium。");
}

function checkEnvironment(requestedEnvironmentOverride?: string): TestEnvironmentConfig | undefined {
  try {
    const environment = resolveTestEnvironment(requestedEnvironmentOverride);
    new URL(environment.openPlatformWebBaseUrl);
    record("PASS", "目标环境", `已解析 ${environment.name} 环境的开放平台 Web 地址。`);
    return environment;
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法解析目标环境。";
    record("FAIL", "目标环境", message);
    return undefined;
  }
}

function checkAuthenticationSession(environment: TestEnvironmentConfig | undefined) {
  if (!environment?.openPlatformAuthStatePath) {
    record("WARN", "已登录会话", "未配置本地认证会话；需要登录的 Web 场景执行前需初始化会话。");
    return;
  }
  if (!existsSync(environment.openPlatformAuthStatePath)) {
    record("WARN", "已登录会话", "认证会话路径已配置，但本地会话文件不存在。需要已登录业务测试时，请先初始化会话。");
    return;
  }

  const mode = statSync(environment.openPlatformAuthStatePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    record("WARN", "已登录会话", "本地会话文件存在，但文件权限过宽；建议仅允许当前用户读取。");
    return;
  }
  record("PASS", "已登录会话", "本地认证会话存在且文件权限符合最小权限要求。");
}

function checkOpenPlatformCredentialReference(environment: TestEnvironmentConfig | undefined) {
  if (!environment) {
    record("SKIP", "开放平台测试账号引用", "目标环境未解析，未检查测试账号引用。");
    return;
  }
  const suffix = environment.name.toUpperCase();
  const username = optionalValue(`OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_${suffix}`);
  const password = optionalValue(`OPEN_PLATFORM_PRODUCT_ADMIN_PASSWORD_${suffix}`);
  if (username && password) {
    record("PASS", "开放平台测试账号引用", "开放平台 Web 测试账号引用已配置；未读取或输出凭据值。");
    return;
  }
  if (username || password) {
    record("WARN", "开放平台测试账号引用", "开放平台 Web 测试账号引用仅部分配置；未读取或输出凭据值。");
    return;
  }
  record("WARN", "开放平台测试账号引用", "未配置开放平台 Web 测试账号引用；登录场景执行前需补齐。");
}

function checkAppConfiguration(options: { planMode?: boolean; selectedStaticAsset?: boolean } = {}) {
  const appPath = optionalValue("APPIUM_APP_PATH");
  const appPackage = optionalValue("APPIUM_APP_PACKAGE");
  const appActivity = optionalValue("APPIUM_APP_ACTIVITY");

  if (options.planMode) {
    const readiness = evaluateAppPlanningReadiness({
      selectedStaticAsset: options.selectedStaticAsset === true,
      appPath,
      appPackage,
      appActivity,
      appPathExists: appPath ? existsSync(appPath) : undefined
    });
    record(
      readiness.status === "ready" ? "PASS" : readiness.status === "engineering-pending" ? "WARN" : "SKIP",
      "Appium 与设备",
      readiness.status === "engineering-pending" ? `${readiness.detail} 不阻塞测试计划或用例生成。` : readiness.detail
    );
    return;
  }

  if (!appPath && !appPackage && !appActivity) {
    record("SKIP", "App 配置", "未配置 App 目标；当前不检查 Appium 与设备。");
    return;
  }
  if (appPath && (appPackage || appActivity)) {
    record("FAIL", "App 配置", "APPIUM_APP_PATH 不能与 APPIUM_APP_PACKAGE / APPIUM_APP_ACTIVITY 同时配置。");
    return;
  }
  if (!appPath && (!appPackage || !appActivity)) {
    record("FAIL", "App 配置", "已开始配置已安装 App，但缺少包名或启动 Activity。");
    return;
  }
  if (appPath && !existsSync(appPath)) {
    record("FAIL", "App 配置", "APPIUM_APP_PATH 指向的安装包不存在。");
    return;
  }
  record("PASS", "App 配置", "App 目标配置完整；Appium Server 与设备连通性应在已确认 App 测试前检查。");
}

function checkPlannedStaticAsset(): boolean {
  if (!selectedAssetId) {
    record("SKIP", "测试资产选择", "未指定静态资产；这不阻塞测试计划或用例生成。需要 App 脚本时再选择并验证安装包。");
    return false;
  }
  try {
    const manifest = loadTestAssetManifest();
    const asset = findTestAsset(manifest, selectedAssetId);
    if (!asset || asset.status !== "active") {
      record("WARN", "测试资产选择", "指定资产不存在或不可自动选择；仅阻塞后续工程设计，不阻塞测试计划或用例生成。");
      return false;
    }
    const path = resolveAssetPath(asset);
    if (!path || !existsSync(path) || sha256(path) !== asset.sha256) {
      record("WARN", "测试资产选择", "指定资产路径或完整性校验失败；仅阻塞后续工程设计，不阻塞测试计划或用例生成。");
      return false;
    }
    record("PASS", "测试资产选择", `已选择 ${asset.assetId}；静态文件存在且 SHA-256 一致。`);
    return true;
  } catch {
    record("WARN", "测试资产选择", "静态资产清单无法读取；仅阻塞后续工程设计，不阻塞测试计划或用例生成。");
    return false;
  }
}

function checkOptionalProtocolConfiguration() {
  const suffix = (process.env.TEST_ENV ?? process.env.DEFAULT_TEST_ENV ?? "test").trim().toUpperCase();
  const apiBaseUrl = optionalValue(`OPEN_PLATFORM_API_BASE_URL_${suffix}`);
  const mqttBrokerUrl = optionalValue(`MQTT_BROKER_URL_${suffix}`);

  record(
    apiBaseUrl ? "PASS" : "SKIP",
    "API 配置",
    apiBaseUrl ? "已配置当前环境 API 地址。" : "未配置当前环境 API 地址；API 测试暂不可执行。"
  );
  record(
    mqttBrokerUrl ? "PASS" : "SKIP",
    "MQTT 配置",
    mqttBrokerUrl ? "已配置当前环境 MQTT Broker 地址。" : "未配置当前环境 MQTT Broker；IoT 链路测试暂不可执行。"
  );
}

function checkTestAssets() {
  const assetDirectories = [
    { name: "Web 测试脚本", directory: "tests/web" },
    { name: "App 测试脚本", directory: "tests/app" },
    { name: "API 测试脚本", directory: "tests/api" },
    { name: "IoT 链路测试脚本", directory: "tests/iot-chain" }
  ];

  for (const asset of assetDirectories) {
    const count = countTestFiles(asset.directory);
    record(
      count > 0 ? "PASS" : "SKIP",
      asset.name,
      count > 0 ? `检测到 ${count} 个 TypeScript 测试文件。` : "尚未创建测试脚本。"
    );
  }
}

function printResults(title: string) {
  console.log(title);
  for (const result of results) {
    console.log(`[${result.status}] ${result.name}：${result.detail}`);
  }

  const summary = results.reduce<Record<CheckStatus, number>>(
    (counts, result) => ({ ...counts, [result.status]: counts[result.status] + 1 }),
    { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 }
  );
  console.log(
    `汇总：通过 ${summary.PASS}，警告 ${summary.WARN}，失败 ${summary.FAIL}，未配置/跳过 ${summary.SKIP}。`
  );
  if (summary.FAIL > 0) {
    process.exitCode = 1;
  }
}

if (planMode) {
  const selectedStaticAsset = checkPlannedStaticAsset();
  const environment = checkEnvironment("test");
  checkOpenPlatformCredentialReference(environment);
  checkAuthenticationSession(environment);
  checkAppConfiguration({ planMode: true, selectedStaticAsset });
  printResults("测试计划预检（未指定环境时默认预检 test；不访问业务服务或输出敏感值）");
} else {
  checkNodeVersion();
  checkProjectDependencies();
  const environment = checkEnvironment();
  checkOpenPlatformCredentialReference(environment);
  checkPlaywrightBrowser();
  checkAuthenticationSession(environment);
  checkAppConfiguration();
  checkOptionalProtocolConfiguration();
  checkTestAssets();
  printResults("自动化测试环境检查（仅本地预检，不访问业务服务）");
}
