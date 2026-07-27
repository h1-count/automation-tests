import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveRequiredReviewRoles } from "../../../src/support/task-state/reviewRoleResolver.js";

test("derives interaction and change-impact reviewers from request assets", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "review-role-resolver-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const planPath = resolve(root, "plan.md");
  await writeFile(planPath, `# plan

## 规则覆盖台账

| 规则编号 | 规则类型 | 适用性 |
| --- | --- | --- |
| RULE-AUTH-001 | 页面交互 | 适用 |
| RULE-AUTH-002 | 状态流转 | 受控执行 |

## 变更影响分析

| 变更编号 | 状态 |
| --- | --- |
| CHG-001 | 草案 |
`, "utf8");
  await writeFile(resolve(root, "cases-login.md"), "| 风险等级 | 高 |\n", "utf8");
  assert.deepEqual(resolveRequiredReviewRoles(planPath), [
    "需求一致性评审",
    "测试设计评审",
    "追溯审计",
    "交互与状态专项评审",
    "变更影响评审"
  ]);
});
