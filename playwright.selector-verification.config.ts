import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config.js";

/**
 * Headless, zero-write verification for selector candidates derived from source.
 * Verification specs must import the guarded web automation fixture.
 */
export default defineConfig({
  ...baseConfig,
  metadata: {
    automationMode: "explore",
    selectorEvidenceMode: "headless_runtime"
  },
  testDir: "./tests",
  testMatch: "**/*.selector-verify.spec.ts",
  workers: 1,
  retries: 0,
  preserveOutput: "never",
  outputDir: ".local/playwright-selector-verification",
  reporter: [["list"]],
  projects: [{
    name: "selector-verification-chromium",
    testMatch: "**/*.selector-verify.spec.ts",
    testIgnore: ["**/*.formal.spec.ts"],
    use: { ...devices["Desktop Chrome"] }
  }],
  use: {
    ...baseConfig.use,
    headless: true,
    launchOptions: undefined,
    trace: "off",
    screenshot: "off",
    video: "off"
  }
});
