import { prepareOpenPlatformRegistrationUploadAssets } from "../src/support/test-assets/generatedUploadAssets.js";

const args = process.argv.slice(2);
const requestIndex = args.indexOf("--request");
const dryRun = args.includes("--dry-run");
const unsupported = args.filter((argument, index) => argument !== "--dry-run" && argument !== "--request" && index !== requestIndex + 1);

if (requestIndex < 0 || !args[requestIndex + 1] || unsupported.length > 0) {
  throw new Error("Usage: npm run test-assets:prepare-registration-upload -- --request <type/project/request> [--dry-run]");
}

const result = prepareOpenPlatformRegistrationUploadAssets({
  workspaceRoot: process.cwd(),
  requestId: args[requestIndex + 1]!,
  dryRun
});

console.log(`${result.written ? "[PASS]" : "[DRY-RUN]"} ${result.manifest.assets.length} 个合成上传边界资产${result.written ? "已原子生成" : "将生成"}：${result.root}`);
console.log(`生成器摘要：${result.manifest.generator.digest}`);
for (const asset of result.manifest.assets) console.log(`- ${asset.assetId}: ${asset.byteLength} bytes, ${asset.boundary}`);
