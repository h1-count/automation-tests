import fs from "node:fs/promises";
import path from "node:path";

function commonPackPath(rootDirectory, packDirectories) {
  const testpacksDirectory = path.join(rootDirectory, "testpacks");
  if (packDirectories.length === 0) return [];
  const relatives = packDirectories.map((directory) => {
    const relative = path.relative(testpacksDirectory, directory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`功能包必须位于 testpacks/：${directory}`);
    }
    return relative.split(path.sep);
  });
  let common = relatives[0].slice();
  for (const parts of relatives.slice(1)) {
    let index = 0;
    while (index < common.length && index < parts.length && common[index] === parts[index]) index += 1;
    common = common.slice(0, index);
  }
  return common;
}

/** 单包为包自身，多包为功能包路径的共同父目录。 */
export function resolveRequestAssetRoot(rootDirectory, packDirectories) {
  return path.join(rootDirectory, "testpacks", ...commonPackPath(rootDirectory, packDirectories));
}

export function requestArtifactDirectories(rootDirectory, packDirectories, reportId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(reportId ?? "")) {
    throw new Error(`请求报告标识只能包含字母、数字、点、下划线和连字符：${reportId}`);
  }
  const assetRoot = resolveRequestAssetRoot(rootDirectory, packDirectories);
  const currentRootDirectory = path.join(assetRoot, "artifacts", "current");
  // 当前诊断材料按请求标识隔离。这样同一公共功能目录中的两个请求可以并行，
  // 而同一标识的复测仍会只重建自己的当前材料。
  const currentDirectory = path.join(currentRootDirectory, reportId);
  return {
    assetRoot,
    currentRootDirectory,
    currentDirectory,
    resultsDirectory: path.join(currentDirectory, "allure-results"),
    attemptDirectory: path.join(currentDirectory, ".attempt"),
    attemptResultsDirectory: path.join(currentDirectory, ".attempt", "allure-results"),
    aggregateIndexPath: path.join(currentDirectory, "aggregate-index.json"),
    reportDirectory: path.join(currentDirectory, "allure-report"),
    manifestPath: path.join(currentDirectory, "manifest.json"),
    requestPlanPath: path.join(currentDirectory, "request-plan.json"),
    designSummaryPath: path.join(currentDirectory, "design-summary.json"),
    historyPath: path.join(assetRoot, "runtime", "allure-history", `${reportId}.jsonl`),
    runLockPath: path.join(assetRoot, "artifacts", ".locks", `${reportId}.lock`),
    durableReportPath: path.join(assetRoot, "test-reports", `${reportId}.md`)
  };
}

/** 在可提交 Markdown 报告中查找唯一 reportId。 */
export async function findDurableReport(rootDirectory, reportId) {
  const testpacksDirectory = path.join(rootDirectory, "testpacks");
  const matches = [];
  async function walk(directory, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === `${reportId}.md` && path.basename(path.dirname(fullPath)) === "test-reports") {
        matches.push(fullPath);
      } else if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "artifacts") {
        await walk(fullPath, depth + 1);
      }
    }
  }
  await walk(testpacksDirectory, 0);
  if (matches.length > 1) throw new Error(`找到多个同名 Markdown 报告 ${reportId}：${matches.join("、")}`);
  return matches[0] ?? null;
}
