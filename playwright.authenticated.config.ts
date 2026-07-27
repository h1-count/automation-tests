import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";
import { resolveTestEnvironment } from "./src/env/testEnvironment";

const environment = resolveTestEnvironment();
const storageState = environment.openPlatformAuthStatePath;

if (!storageState || !existsSync(storageState)) {
  throw new Error(
    "缺少本地认证会话。请先运行 npm run auth:open-platform:initialize，完成一次人工登录后再执行已登录测试。"
  );
}

export default defineConfig(baseConfig, {
  testMatch: "**/*.authenticated.spec.ts",
  use: {
    storageState,
    trace: "off",
    screenshot: "off",
    video: "off"
  }
});
