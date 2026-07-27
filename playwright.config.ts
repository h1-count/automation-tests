import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { resolveTestEnvironment } from "./src/env/testEnvironment";

process.env.ALLURE_RESULTS_DIR ??= "artifacts/allure-results";
const testEnvironment = resolveTestEnvironment();
const visibleLocalRun = !process.env.CI;
const formalLifecycleEnabled = Boolean(process.env.AUTOMATION_REQUEST_ID?.trim());
const formalRequestMatch = process.env.AUTOMATION_REQUEST_ID?.trim().replace(/^web\//, "");

export default defineConfig({
  metadata: { automationMode: "execute" },
  // Web/H5 正式 Runner 只发现 Playwright 用例；App 用例由 WebdriverIO 单独执行。
  testDir: "./tests/web",
  testMatch: "**/*.spec.ts",
  outputDir: "artifacts/test-results/playwright",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: formalLifecycleEnabled ? 1 : process.env.CI ? 1 : undefined,
  maxFailures: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/playwright-report" }],
    ["junit", { outputFile: "artifacts/test-results/junit.xml" }],
    ["allure-playwright", { resultsDir: "artifacts/allure-results" }]
  ],
  use: {
    baseURL: testEnvironment.openPlatformWebBaseUrl,
    headless: !visibleLocalRun,
    launchOptions: visibleLocalRun ? { slowMo: 350 } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: formalLifecycleEnabled ? [
    {
      name: "formal-setup",
      testMatch: "**/*.setup.ts",
      teardown: "formal-teardown",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium",
      dependencies: ["formal-setup"],
      testMatch: formalRequestMatch ? `${formalRequestMatch}/*.formal.spec.ts` : "**/*.formal.spec.ts",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "formal-teardown",
      testMatch: "**/*.teardown.ts",
      use: { ...devices["Desktop Chrome"] }
    }
  ] : [{
    name: "chromium",
    testIgnore: ["**/*.setup.ts", "**/*.teardown.ts", "**/*.formal.spec.ts"],
    use: { ...devices["Desktop Chrome"] }
  }]
});
