/**
 * 修订分层 CLI：对照「已被接受的冻结快照」对当前用例集做 diff 分级，
 * 输出 tier 决定与（structural 档）确定性评审发现文件。
 *
 * 用法：
 *   npm run testcases:revision-tier -- \
 *     --baseline-cases <snapshot/cases.md> --baseline-plan <snapshot/plan.md> \
 *     --current-cases <cases.md> --current-plan <plan.md> \
 *     [--findings-out <review-findings-deterministic.md>]
 *
 * 退出码：0 正常分级；2 参数或解析失败。
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyRevisionDiff, REVISION_TIER_SCHEMA_VERSION } from "../src/support/task-workflow/revisionTiers.ts";
import { createHash } from "node:crypto";

function required(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) {
    console.error(`缺少参数 ${name}`);
    process.exit(2);
  }
  return args[index + 1]!;
}

const args = process.argv.slice(2);
const read = async (path: string): Promise<string> => readFile(resolve(path), "utf8");

const baselineCasesPath = required(args, "--baseline-cases");
const baselineCases = await read(baselineCasesPath);
const currentCases = await read(required(args, "--current-cases"));
const baselinePlanPath = required(args, "--baseline-plan");
const baselinePlan = await read(baselinePlanPath);
const currentPlan = await read(required(args, "--current-plan"));

const result = classifyRevisionDiff(baselineCases, currentCases, baselinePlan, currentPlan);
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const classifierDigest = digest(
  JSON.stringify({
    schemaVersion: REVISION_TIER_SCHEMA_VERSION,
    baselineCases: digest(baselineCases),
    currentCases: digest(currentCases),
    baselinePlan: digest(baselinePlan),
    currentPlan: digest(currentPlan),
    tier: result.tier,
    changedCaseIds: result.changedCaseIds,
    semanticCaseIds: result.semanticCaseIds,
    ledgerChanged: result.ledgerChanged
  })
);

const findingsOutIndex = args.indexOf("--findings-out");
if (result.tier === "structural" && findingsOutIndex >= 0 && args[findingsOutIndex + 1]) {
  const body = [
    "# Deterministic Reviewer Findings（修订分层 structural 档）",
    "",
    `- 分级器：${REVISION_TIER_SCHEMA_VERSION}`,
    `- classifierDigest：${classifierDigest}`,
    `- 基线：cases=${digest(baselineCases).slice(0, 16)}… plan=${digest(baselinePlan).slice(0, 16)}…`,
    `- 结论依据：${result.reasons.length ? result.reasons.join("；") : "无任何内容级差异"}`,
    "",
    "## 结论",
    "",
    "converged",
    "",
    "## 发现项",
    "",
    "| 编号 | 类别 | 位置 | 发现 | 处置建议 |",
    "| --- | --- | --- | --- | --- |",
    "| 无 | — | — | 无 | — |",
    ""
  ].join("\n");
  await writeFile(resolve(args[findingsOutIndex + 1]!), body, "utf8");
}

console.log(JSON.stringify({ ...result, classifierDigest }, null, 2));
