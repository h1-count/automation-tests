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

if (!testPackDirectory) {
  throw new Error("请通过 npm run test:fast 运行测试，以便将产物写入对应功能测试包。");
}

export default defineConfig({
  testDir: "./testpacks",
  testMatch: "**/*.spec.ts",
  testIgnore: ["**/*.setup.ts", "**/*.teardown.ts"],
  outputDir: join(testPackDirectory, "artifacts", "results"),
  fullyParallel: false,
  retries: 0,
  workers: undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: join(testPackDirectory, "artifacts", "report") }]
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
