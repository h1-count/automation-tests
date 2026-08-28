import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRuleRecords,
  summarizeRuleCoverage,
  validateRuleCoverage
} from "../../scripts/testcase-quality-gate.ts";

const currentPlan = `> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。

## 规则设计台账
| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-AUTH-001 | REQ-AUTH-001 | SRC-AUTH-001 | 输入有效账号 | 进入首页 | 场景法 | AUTH-LOGIN-001 | no_write | 已覆盖 |
| RULE-AUTH-002 | REQ-AUTH-001 | SRC-AUTH-001 | 未勾选协议 | 登录按钮禁用 | 交互断言 | AUTH-LOGIN-001 | no_write | 已覆盖 |
`;

const currentCases = [{
  caseId: "AUTH-LOGIN-001",
  ruleIds: ["RULE-AUTH-001", "RULE-AUTH-002"],
  source: "cases.md"
}];

test("当前规则台账可解析、统计并完成双向校验", () => {
  const rules = parseRuleRecords(currentPlan);
  assert.equal(rules.length, 2);
  assert.match(summarizeRuleCoverage(currentPlan), /适用规则 2；已覆盖 2/u);
  assert.deepEqual(validateRuleCoverage(currentPlan, currentCases), []);
});

test("缺少用例关系或反向关系时失败", () => {
  const withoutLink = currentPlan.replace("AUTH-LOGIN-001 | no_write | 已覆盖", "无 | no_write | 已覆盖");
  const issues = validateRuleCoverage(withoutLink, currentCases);
  assert.ok(issues.some((issue) => issue.name === "适用规则关联"));
  assert.ok(issues.some((issue) => issue.name === "RULE ↔ caseId 双向追溯"));
});

test("非当前规则台账和拼错 marker 均硬失败", () => {
  for (const marker of ["unsupported-version", "rule-design-ledger-v1-beta"]) {
    const issues = validateRuleCoverage(currentPlan.replace("rule-design-ledger-v1", marker), []);
    assert.equal(issues[0]?.name, "规则台账契约");
    assert.match(issues[0]?.detail ?? "", /rule-design-ledger-v1/u);
  }
});

test("缺少当前规则台账 marker 时硬失败", () => {
  const issues = validateRuleCoverage("## 规则设计台账\n", []);
  assert.equal(issues[0]?.name, "规则台账契约");
  assert.match(issues[0]?.detail ?? "", /缺少 rule-design-ledger-v1/u);
});
