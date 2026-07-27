import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { inspectMarkdownFormat, repairMarkdownSeparators } from "./markdown-format.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const fix = args.includes("--fix");
const paths = args.filter((argument) => argument !== "--fix");

if (paths.length === 0) {
  throw new Error("请提供至少一个仓库内 Markdown 路径，例如：npm run check:markdown -- testcases/app/<project>/<request>/plan.md");
}

let hasFailure = false;
for (const path of paths) {
  const absolutePath = resolve(projectRoot, path);
  const projectRelativePath = relative(projectRoot, absolutePath);
  if (projectRelativePath.startsWith("..") || !absolutePath.endsWith(".md") || !existsSync(absolutePath)) {
    throw new Error(`无效的仓库内 Markdown 路径：${path}`);
  }
  const original = readFileSync(absolutePath, "utf8");
  const result = fix ? repairMarkdownSeparators(original) : { content: original, repairedLines: [], issues: inspectMarkdownFormat(original) };
  if (fix && result.repairedLines.length > 0) {
    writeFileSync(absolutePath, result.content, "utf8");
    console.log(`${projectRelativePath}：已规范化分隔行 ${result.repairedLines.map((line) => `第 ${line} 行`).join("、")}。`);
  }
  if (result.issues.length === 0) {
    console.log(`${projectRelativePath}：Markdown 格式通过。`);
    continue;
  }
  hasFailure = true;
  for (const issue of result.issues) {
    console.error(`${projectRelativePath}${issue.line > 0 ? `：第 ${issue.line} 行` : ""}：${issue.detail}${issue.repairable ? "（可用 --fix 修复）" : "（需修订正文）"}`);
  }
}

if (hasFailure) process.exitCode = 1;
