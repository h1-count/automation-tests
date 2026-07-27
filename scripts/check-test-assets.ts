import { loadTestAssetManifest, validateTestAssetManifest } from "../src/support/test-assets/assetManifest.js";

try {
  const errors = validateTestAssetManifest(loadTestAssetManifest());
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[FAIL] ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("[PASS] test-assets/manifest.yaml 与全部静态测试资产一致。");
  }
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : "无法校验静态测试资产。"}`);
  process.exitCode = 1;
}
