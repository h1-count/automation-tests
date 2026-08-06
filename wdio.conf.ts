import "dotenv/config";
import type { Capabilities, Options } from "@wdio/types";
import { resolveTestEnvironment } from "./src/env/testEnvironment.js";

const appPath = optionalEnvironmentValue("APPIUM_APP_PATH");
const appPackage = optionalEnvironmentValue("APPIUM_APP_PACKAGE");
const appActivity = optionalEnvironmentValue("APPIUM_APP_ACTIVITY");
const udid = optionalEnvironmentValue("APPIUM_UDID");
const testEnvironment = resolveTestEnvironment();

if (appPath && (appPackage || appActivity)) {
  throw new Error(
    "Configure either APPIUM_APP_PATH or APPIUM_APP_PACKAGE with APPIUM_APP_ACTIVITY, not both."
  );
}

if (!appPath && (!appPackage || !appActivity)) {
  throw new Error(
    "Missing App target. Configure APPIUM_APP_PATH, or configure both APPIUM_APP_PACKAGE and APPIUM_APP_ACTIVITY."
  );
}

export const config: Options.Testrunner & Capabilities.WithRequestedTestrunnerCapabilities = {
  runner: "local",
  specs: ["./tests/app/**/*.spec.ts"],
  maxInstances: 1,
  logLevel: "info",
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  hostname: optionalEnvironmentValue("APPIUM_HOST") ?? "127.0.0.1",
  port: Number(optionalEnvironmentValue("APPIUM_PORT") ?? 4723),
  path: "/",
  protocol: "http",
  baseUrl: testEnvironment.openPlatformWebBaseUrl,
  capabilities: [
    {
      platformName: optionalEnvironmentValue("APPIUM_PLATFORM_NAME") ?? "Android",
      "appium:automationName":
        optionalEnvironmentValue("APPIUM_AUTOMATION_NAME") ?? "UiAutomator2",
      "appium:deviceName": optionalEnvironmentValue("APPIUM_DEVICE_NAME") ?? "Android Emulator",
      ...(udid ? { "appium:udid": udid } : {}),
      ...(appPath ? { "appium:app": appPath } : {}),
      ...(appPackage ? { "appium:appPackage": appPackage } : {}),
      ...(appActivity ? { "appium:appActivity": appActivity } : {})
    }
  ],
  framework: "mocha",
  reporters: [
    "spec",
    [
      "allure",
      {
        outputDir: "artifacts/allure-results",
        disableWebdriverStepsReporting: false,
        disableWebdriverScreenshotsReporting: false
      }
    ]
  ],
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000
  }
};

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
