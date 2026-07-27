import { loadTestAssetManifest, resolveAssetPath, selectTestAsset, type TestAssetKind } from "../src/support/test-assets/assetManifest.js";

const validKinds = new Set<TestAssetKind>(["app-package", "firmware-package", "visual-baseline"]);
const argumentsList = process.argv.slice(2);

function readArgument(name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  const value = index >= 0 ? argumentsList[index + 1]?.trim() : undefined;
  return value || undefined;
}

const project = readArgument("--project");
const kind = readArgument("--kind");
const platform = readArgument("--platform");
const scope = readArgument("--scope");
const knownArguments = new Set(["--project", "--kind", "--platform", "--scope"]);
const invalidArguments = argumentsList.filter((argument, index) => !knownArguments.has(argument) && !knownArguments.has(argumentsList[index - 1] ?? ""));

if (!project || !kind || !validKinds.has(kind as TestAssetKind) || invalidArguments.length > 0) {
  console.error("用法：npm run test-assets:select -- --project <项目> --kind <app-package|firmware-package|visual-baseline> [--platform <平台>] [--scope <范围>]。");
  process.exitCode = 1;
} else {
  const selection = selectTestAsset(loadTestAssetManifest(), { project, kind: kind as TestAssetKind, platform, scope });
  if (selection.status === "selected" && selection.asset) {
    const path = resolveAssetPath(selection.asset);
    console.log(`已选择：${selection.asset.assetId}`);
    console.log(`类型：${selection.asset.kind}`);
    console.log(`路径：${path}`);
    console.log(`说明：${selection.asset.description}`);
  } else if (selection.status === "not-found") {
    console.log("待选择：未找到符合项目、类型、平台和范围的 active 静态资产。");
  } else {
    console.log(`待选择：存在 ${selection.candidates.length} 个同等候选，未按文件名或时间猜测。`);
    for (const candidate of selection.candidates) {
      console.log(`- ${candidate.assetId}：${candidate.path}`);
    }
  }
}
