import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { resolveTestEnvironment } from "./src/env/testEnvironment.js";

const localOpenPlatformRoot = join(
  homedir(),
  "Documents/ikingcity/workspace/front-end/web-open-platform"
);

// 唯一运行配置：FAST_BASE_URL > .env 按 TEST_ENV 解析 > 测试环境默认值。
function resolveFastBaseUrl(): string {
  const explicit = process.env.FAST_BASE_URL?.trim();
  if (explicit) return explicit;
  try {
    return resolveTestEnvironment().openPlatformWebBaseUrl;
  } catch {
    return "https://open-platform-test.ikingcity.com/";
  }
}

const baseURL = resolveFastBaseUrl();
const usesLocalOpenPlatform = new URL(baseURL).hostname === "127.0.0.1";
const testPackDirectory = process.env.TEST_PACK_DIR;
const requestReportDirectory = process.env.TEST_REQUEST_REPORT_DIR;

if (!testPackDirectory) {
  throw new Error("请通过 npm run test:fast 运行测试，以便将产物写入对应功能测试包。");
}
if (!requestReportDirectory) {
  throw new Error("请通过 npm run test:fast 运行测试，以便归档请求级报告。");
}

export default defineConfig({
  testDir: "./testpacks",
  testMatch: "**/*.spec.ts",
  testIgnore: ["**/*.setup.ts", "**/*.teardown.ts"],
  outputDir: join(requestReportDirectory, "playwright-results", process.env.TEST_PACK_SLUG ?? "unknown-pack"),
  fullyParallel: false,
  retries: 0,
  workers: undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: join(requestReportDirectory, "playwright-report") }],
    ["allure-playwright", { resultsDir: join(requestReportDirectory, "allure-results") }]
  ],
  ...(usesLocalOpenPlatform
    ? {
        webServer: {
          command: "npm run dev -- --mode test --host 127.0.0.1",
          cwd: localOpenPlatformRoot,
          url: baseURL,
          timeout: 60_000,
          reuseExistingServer: true
        }
      }
    : {}),
  use: {
    baseURL,
    headless: false,
    // 产物语义（2026-09-02 降载）：失败诊断完整（失败截图 + 录屏 + trace）；通过用例不再逐条拍
    // 结束截图、存视频——关键业务节点截图由用例内 attachShot 显式提供。原 screenshot/video 常开时，
    // 每条收尾都要等 fonts.ready 拍截图、刷视频文件，dev server 卡顿窗口下单条收尾被拖到分钟级。
    // 注意 video 无"仅失败才录"模式：retain-on-failure 仍全程录制，仅通过后删除，编码开销不变、磁盘与报告体积下降。
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
