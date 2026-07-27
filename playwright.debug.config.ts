import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

/**
 * Local visual debugging only: runs one test at a time in a visible browser.
 * It intentionally does not retain trace, screenshot, or video artifacts,
 * because a debugging run can display sensitive authentication input.
 */
export default defineConfig({
  ...baseConfig,
  metadata: { automationMode: "explore" },
  workers: 1,
  retries: 0,
  outputDir: "artifacts/test-results/playwright-debug",
  reporter: [["list"]],
  projects: [{
    name: "explore-chromium",
    testIgnore: ["**/*.setup.ts", "**/*.teardown.ts", "**/*.formal.spec.ts"]
  }],
  use: {
    ...baseConfig.use,
    headless: false,
    launchOptions: { slowMo: 350 },
    trace: "off",
    screenshot: "off",
    video: "off"
  }
});
