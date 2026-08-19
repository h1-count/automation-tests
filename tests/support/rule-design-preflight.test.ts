import assert from "node:assert/strict";
import test from "node:test";
import {
  expandRuleNeighborhood,
  validateRuleDesignMatrix
} from "../../scripts/rule-design-preflight.ts";

const plan = `> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。

## 规则设计台账
| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | REQ-REG-001 | SRC-REG-001 | 注册字段组：名称为空或边界 | 显示名称必填或长度反馈 | 等价类与边界 | OPEN-REG-001 | no_write | 已覆盖 |
| RULE-REG-002 | REQ-REG-001 | SRC-REG-001 | 注册字段组：邮箱留空或格式错误 | 留空不提示必填；格式错误提示 | 等价类与边界 | OPEN-REG-002 | no_write | 已覆盖 |
| RULE-REG-003 | REQ-REG-002 | SRC-REG-001 | 唯一性提交路径：重复名称 | 显示资料定义重复名称提示 | 决策表 | OPEN-REG-003 | 写入授权 | 受控执行 |
`;

test("当前 v3 规则台账通过设计预检", () => {
  assert.deepEqual(validateRuleDesignMatrix(plan), []);
});

test("预检拒绝泛化预期和缺失执行门禁", () => {
  assert.ok(validateRuleDesignMatrix(plan.replace("显示名称必填或长度反馈", "功能正常"))
    .some((issue) => issue.includes("缺少具体输入或可观察预期")));
  assert.ok(validateRuleDesignMatrix(plan.replace("no_write", "待填写"))
    .some((issue) => issue.includes("缺少风险或执行门禁")));
});

test("旧规则台账被当作不受支持契约拒绝", () => {
  const issues = validateRuleDesignMatrix(plan.replace("rule-design-ledger-v3", "rule-design-ledger-v2"));
  assert.ok(issues.some((issue) => issue.includes("rule-design-ledger-v2")));
});

test("规则邻域覆盖同一需求和条件对象且去重", () => {
  assert.deepEqual(expandRuleNeighborhood(plan, ["RULE-REG-001"]), ["RULE-REG-001", "RULE-REG-002"]);
  assert.deepEqual(expandRuleNeighborhood(plan, ["RULE-REG-001", "RULE-REG-002"]), ["RULE-REG-001", "RULE-REG-002"]);
});
