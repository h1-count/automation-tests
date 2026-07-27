import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTestEnvironment } from "../src/env/testEnvironment";

type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
}

const environment = resolveTestEnvironment();
const results: CheckResult[] = [];

function value(name: string): string | undefined {
  const configured = process.env[name]?.trim();
  return configured || undefined;
}

function record(status: CheckStatus, name: string, detail: string) {
  results.push({ status, name, detail });
}

function checkConfigured(name: string, description: string) {
  record(
    value(name) ? "PASS" : "WARN",
    description,
    value(name) ? "已配置。" : `未配置 ${name}；关联脚本将跳过。`
  );
}

function checkPackagePath(name: string, description: string) {
  const packagePath = value(name);
  if (!packagePath) {
    record("WARN", description, `未配置 ${name}；不运行需要该测试资产的用例。`);
    return;
  }

  record(
    existsSync(resolve(packagePath)) ? "PASS" : "FAIL",
    description,
    existsSync(resolve(packagePath)) ? "受控测试包文件存在。" : "配置的测试包文件不存在。"
  );
}

record("PASS", "目标环境", `已解析 ${environment.name} 环境。`);
checkConfigured("FIRMWARE_TEST_PRODUCT_ID", "本次测试产品");
checkPackagePath("FIRMWARE_PRODUCTION_PACKAGE_PATH", "生产固件测试包");
checkPackagePath("FIRMWARE_TEST_PACKAGE_PATH", "测试固件测试包");
checkConfigured("FIRMWARE_PRODUCTION_VERSION", "生产固件版本");
checkConfigured("FIRMWARE_TEST_OTA_VERSION", "测试 OTA 固件版本");

const uploadEnabled = process.env.ALLOW_OPEN_PLATFORM_FIRMWARE_UPLOAD === "true";
record(
  uploadEnabled ? "PASS" : "SKIP",
  "云端固件上传门禁",
  uploadEnabled
    ? "运行时已启用受控测试固件上传。"
    : "默认未启用上传；只读与阻断用例不受影响。"
);

for (const result of results) {
  console.log(`[${result.status}] ${result.name}：${result.detail}`);
}

const failed = results.filter((result) => result.status === "FAIL").length;
if (failed > 0) {
  process.exitCode = 1;
}
