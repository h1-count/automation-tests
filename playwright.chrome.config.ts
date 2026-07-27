import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { resolveTestEnvironment } from "./src/env/testEnvironment";

process.env.ALLURE_RESULTS_DIR ??= "artifacts/allure-results/chrome";
const testEnvironment = resolveTestEnvironment();
const visibleLocalRun = !process.env.CI;

/**
 * Uses the installed Google Chrome channel with an isolated Playwright profile.
 * It is a browser-compatibility runner and never attaches to a user's Chrome profile.
 */
export default defineConfig({
  // Chrome 兼容性 Runner 与默认 Web Runner 使用相同的 Playwright 用例范围。
  testDir: "./tests/web",
  testMatch: "**/*.spec.ts",
  outputDir: "artifacts/test-results/playwright-chrome",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/playwright-report-chrome" }],
    ["junit", { outputFile: "artifacts/test-results/junit-chrome.xml" }],
    ["allure-playwright"]
  ],
  use: {
    baseURL: testEnvironment.openPlatformWebBaseUrl,
    headless: !visibleLocalRun,
    launchOptions: visibleLocalRun ? { slowMo: 350 } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome"
      }
    }
  ]
});
