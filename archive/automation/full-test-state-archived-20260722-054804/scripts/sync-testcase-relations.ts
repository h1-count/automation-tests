import { synchronizeRequest } from "./testcase-relation-projections.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const requestDirectory = args.find((arg) => arg !== "--check");

if (!requestDirectory) {
  console.error("用法：npm run testcases:sync-relations -- <testcases/<type>/<project>/<request>> [--check]");
  process.exitCode = 1;
} else {
  const result = synchronizeRequest(requestDirectory, { check });
  for (const issue of result.issues) console.error(`[FAIL] ${issue.name}：${issue.detail}`);
  if (result.issues.length > 0) {
    process.exitCode = 1;
  } else if (!result.strict) {
    console.warn("[WARN] 历史请求未启用 case-relation-projection-v1，未修改资产。");
  } else if (check) {
    console.log("[PASS] 所有 caseId 派生视图均与 RULE → caseId 关系源一致。");
  } else {
    console.log(result.changedFiles.length === 0 ? "[PASS] 派生视图已是最新。" : `[PASS] 已同步 ${result.changedFiles.length} 个文件：${result.changedFiles.join("、")}`);
  }
}
