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
  const assetRoot = resolveRequestAssetRoot(rootDirectory, packDirectories);
  const currentDirectory = path.join(assetRoot, "artifacts", "current");
  return {
    assetRoot,
    currentDirectory,
    resultsDirectory: path.join(currentDirectory, "allure-results"),
    reportDirectory: path.join(currentDirectory, "allure-report"),
    manifestPath: path.join(currentDirectory, "manifest.json"),
    requestPlanPath: path.join(currentDirectory, "request-plan.json"),
    designSummaryPath: path.join(currentDirectory, "design-summary.json"),
    historyPath: path.join(assetRoot, "runtime", "allure-history.jsonl"),
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
