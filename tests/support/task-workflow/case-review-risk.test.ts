import assert from "node:assert/strict";
import test from "node:test";
import { assessCaseReviewRisk } from "../../../src/support/task-workflow/caseReviewRisk.js";

function plan(caseId = "DEMO-CASE-001", ruleId = "RULE-DEMO-001"): string {
  return `> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。

## 规则设计台账
| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${ruleId} | REQ-DEMO-001 | SRC-DEMO-001 | 执行操作 | 结果可见 | 场景法 | ${caseId} | no_write | 已覆盖 |
`;
}

function testcase(options: {
  caseId?: string;
  ruleId?: string;
  action?: string;
  data?: string;
  expected?: string;
  strategy?: string;
  risk?: "低" | "中" | "高";
  parameterized?: boolean;
} = {}): string {
  const caseId = options.caseId ?? "DEMO-CASE-001";
  const ruleId = options.ruleId ?? "RULE-DEMO-001";
  const risk = options.risk ?? "低";
  const rows = options.parameterized
    ? `| D01 | 1 | ${options.action ?? "检查页面"} | 普通输入 | ${options.expected ?? "结果可见"} |
| D02 | 1 | ${options.action ?? "检查页面"} | OTP 安全挑战 | 不得自动处理 |`
    : `| — | 1 | ${options.action ?? "检查页面"} | ${options.data ?? "无"} | ${options.expected ?? "结果可见"} |`;
  return `> 结构版本：testcase-v6-layered。

# 用例集：Demo

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：${options.strategy ?? "no_write"}
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 0 条 ｜ 高风险 ${risk === "高" ? 1 : 0} 条 ｜ 参数化 ${options.parameterized ? 1 : 0} 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 页面 | ${caseId} | 验证页面行为 | P1 | ${risk} |

## 模块：页面

<details open>
<summary>${caseId}｜验证页面行为｜P1｜${risk}风险</summary>

> 规则：${ruleId}
> 前置条件：页面可访问

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
${rows}

</details>
`;
}

test("current v6 risk reads only executable actions, data and expectations", () => {
  const assessment = assessCaseReviewRisk(testcase(), { plan: plan() });
  assert.equal(assessment.maxLevel, "light");
  assert.deepEqual(assessment.cases[0]?.ruleRefs, ["RULE-DEMO-001"]);
  assert.deepEqual(assessment.cases[0]?.requirementRefs, ["REQ-DEMO-001"]);
});

test("ordinary upload is standard while actual OTP or password submission is strict", () => {
  assert.equal(assessCaseReviewRisk(testcase({ action: "上传合成附件" }), { plan: plan() }).maxLevel, "standard");
  assert.equal(assessCaseReviewRisk(testcase({ action: "输入 OTP 并提交登录" }), { plan: plan() }).maxLevel, "strict");
  assert.equal(assessCaseReviewRisk(testcase({ action: "输入密码并提交登录" }), { plan: plan() }).maxLevel, "strict");
});

test("parameter data and expectations participate in risk classification", () => {
  const assessment = assessCaseReviewRisk(testcase({ parameterized: true }), { plan: plan() });
  assert.equal(assessment.maxLevel, "strict");
});

test("archived testcase formats are refused instead of silently parsed", () => {
  assert.throws(
    () => assessCaseReviewRisk(testcase().replace("testcase-v6-layered", "testcase-v4"), { plan: plan() }),
    /only accepts testcase-v6-layered/u
  );
});

test("risk digest is deterministic across package order", () => {
  const secondCase = "DEMO-CASE-002";
  const secondRule = "RULE-DEMO-002";
  const first = testcase();
  const second = testcase({ caseId: secondCase, ruleId: secondRule, action: "上传合成附件" });
  const fullPlan = `${plan()}\n${plan(secondCase, secondRule).split("## 规则设计台账\n")[1]}`;
  const left = assessCaseReviewRisk([first, second], { plan: fullPlan });
  const right = assessCaseReviewRisk([second, first], { plan: fullPlan });
  assert.equal(left.digest, right.digest);
});
