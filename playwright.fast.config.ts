import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { resolveTestEnvironment } from "./src/env/testEnvironment.js";

// 快速通道配置：唯一目标是「一条命令跑通自动化测试」。
// 不接入正式执行的授权快照、manifest、能力 Provider、波次调度与证据上报。
// 覆盖优先级：FAST_BASE_URL > .env 按 TEST_ENV 解析 > 远程测试环境默认值。
function resolveFastBaseUrl(): string {
  const explicit = process.env.FAST_BASE_URL?.trim();
  if (explicit) return explicit;
  try {
    return resolveTestEnvironment().openPlatformWebBaseUrl;
  } catch {
    return "https://open-platform-test.ikingcity.com/";
  }
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: ["**/*.setup.ts", "**/*.teardown.ts", "**/*.formal.spec.ts", "tests/support/**"],
  outputDir: "artifacts/fast-results",
  fullyParallel: false,
  retries: 0,
  workers: undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/fast-report" }]
  ],
  use: {
    baseURL: resolveFastBaseUrl(),
    headless: true,
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
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
