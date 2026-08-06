import "dotenv/config";
import {
  defineConfig,
  devices,
  type ReporterDescription
} from "@playwright/test";
import { resolveTestEnvironment } from "./src/env/testEnvironment.js";
import { parseFormalWorkerCount } from "./src/support/formal-execution/runnerPolicy.js";

const testEnvironment = resolveTestEnvironment();
const formalLifecycleEnabled = Boolean(process.env.AUTOMATION_REQUEST_ID?.trim());
const formalRequestMatch = process.env.AUTOMATION_REQUEST_ID?.trim();
const formalWorkers = formalLifecycleEnabled
  ? parseFormalWorkerCount(process.env.PLAYWRIGHT_FORMAL_WORKERS)
  : 1;
const containsSensitiveEvidenceCase = process.env.PLAYWRIGHT_HAS_SENSITIVE_CASES === "1";
const executionWave = process.env.PLAYWRIGHT_EXECUTION_WAVE?.trim();
if (executionWave && !/^\d+$/.test(executionWave)) {
  throw new Error("PLAYWRIGHT_EXECUTION_WAVE must be a non-negative integer.");
}
const waveSuffix = executionWave ? `/wave-${executionWave}` : "";
const reportProfile = process.env.AUTOMATION_REPORT_PROFILE?.trim()
  || (process.env.CI ? "ci" : "local");
if (!["local", "ci", "trend"].includes(reportProfile)) {
  throw new Error("AUTOMATION_REPORT_PROFILE must be local, ci or trend.");
}
if (!process.env.CI && reportProfile !== "local") {
  throw new Error("JUnit and Allure report profiles are available only in CI.");
}
const authorizedCaseIds = (process.env.PLAYWRIGHT_AUTHORIZED_CASE_IDS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const authorizedCasePattern = authorizedCaseIds.length
  ? new RegExp(`(?:${authorizedCaseIds.map(escapeRegex).join("|")})：`)
  : undefined;
const reporters: ReporterDescription[] = reportProfile === "trend"
  ? [
      ["list"],
      ["html", { open: "never", outputFolder: `artifacts/playwright-report${waveSuffix}` }],
      ["junit", { outputFile: `artifacts/test-results${waveSuffix}/junit.xml` }],
      ["allure-playwright", { resultsDir: `artifacts/allure-results${waveSuffix}` }]
    ]
  : reportProfile === "ci"
    ? [
        ["list"],
      ["html", { open: "never", outputFolder: `artifacts/playwright-report${waveSuffix}` }],
      ["junit", { outputFile: `artifacts/test-results${waveSuffix}/junit.xml` }]
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: `artifacts/playwright-report${waveSuffix}` }]
      ];
if (formalLifecycleEnabled) {
  reporters.push(["./src/support/formal-execution/playwrightEvidenceReporter.ts"]);
}

export default defineConfig({
  metadata: { automationMode: "execute" },
  // Web/H5 正式 Runner 只发现 Playwright 用例；App 用例由 WebdriverIO 单独执行。
  testDir: formalLifecycleEnabled ? "./tests" : "./tests/web",
  testMatch: "**/*.spec.ts",
  outputDir: `artifacts/test-results/playwright${waveSuffix}`,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Sensitive authentication/OTP cases must never replay a credential or one-time action.
  retries: containsSensitiveEvidenceCase ? 0 : process.env.CI ? 2 : 0,
  workers: formalLifecycleEnabled ? formalWorkers : process.env.CI ? 1 : undefined,
  maxFailures: 0,
  reporter: reporters,
  use: {
    baseURL: testEnvironment.openPlatformWebBaseUrl,
    headless: true,
    trace: containsSensitiveEvidenceCase ? "off" : "on-first-retry",
    screenshot: containsSensitiveEvidenceCase ? "off" : "only-on-failure",
    video: "off"
  },
  projects: formalLifecycleEnabled ? [
    {
      name: "chromium",
      testMatch: formalRequestMatch ? `${formalRequestMatch}/*.formal.spec.ts` : "**/*.formal.spec.ts",
      ...(authorizedCasePattern ? { grep: authorizedCasePattern } : {}),
      use: { ...devices["Desktop Chrome"] }
    }
  ] : [{
    name: "chromium",
    testIgnore: ["**/*.setup.ts", "**/*.teardown.ts", "**/*.formal.spec.ts"],
    use: { ...devices["Desktop Chrome"] }
  }]
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
