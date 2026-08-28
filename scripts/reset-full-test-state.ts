import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const clearLocalCache = args.includes("--clear-local-cache");
if (!clearLocalCache || args.some((arg) => arg !== "--dry-run" && arg !== "--clear-local-cache")) {
  throw new Error("Use --dry-run --clear-local-cache, then rerun --clear-local-cache after reviewing the scope.");
}

const roots = ["artifacts", ".auth", ".local/test-task-runtime", ".local/test-review-cache", ".local/playwright-explore-profile", ".local/playwright-selector-verification", ".local/preview-style-test", ".local/test-data", ".local/test-task-state", ".local/test-runs-archive", ".local/workflow-migration-staging", ".local/staging", ".local/univer-preview", ".local/workflow-history-locks", ".local/workflow-publication-locks"]
  .map((path) => resolve(root, path))
  .filter(existsSync);

for (const path of roots) {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to clear symbolic link: ${path}`);
  console.log(`${dryRun ? "将清理" : "清理"}本机缓存：${path}`);
}
if (dryRun) process.exit(0);
for (const path of roots) {
  if (path.endsWith("/artifacts") || path.startsWith(resolve(root, ".local"))) {
    for (const entry of readdirSync(path)) if (!["README.md", ".gitkeep"].includes(entry)) rmSync(resolve(path, entry), { recursive: true, force: true });
  } else rmSync(path, { recursive: true, force: true });
}
console.log("本机缓存已清理；未读取或修改 sources、testcases、tests、test-assets、archive、运行档案和本机台账。");
