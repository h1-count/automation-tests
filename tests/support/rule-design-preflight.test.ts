import assert from "node:assert/strict";
import test from "node:test";
import { expandRuleNeighborhood, validateRuleDesignMatrix } from "../../scripts/rule-design-preflight.ts";

const plan = `
## 规则覆盖台账
> 结构版本：rule-coverage-v1
| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | REQ-REG-001 | PRD | 输入边界 | 名称 | 提示 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-001 | 无写入 |
| RULE-REG-002 | REQ-REG-001 | PRD | 输入边界 | 邮箱 | 提示 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-002 | 无写入 |
| RULE-REG-003 | REQ-REG-002 | PRD | 分支/决策 | 重名 | 提示 | 决策表 | 受控执行 | 受控执行 | OPEN-REG-003 | 写入授权 |

## 规则设计矩阵
> 结构版本：rule-design-matrix-v1
| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | 注册字段组 | 必填 | 空、合法、边界 | 显示名称必填或长度反馈 | 无写入表单 | 不提交 | OPEN-REG-001 | 已覆盖 |
| RULE-REG-002 | 注册字段组 | 选填 | 留空、合法、格式错误 | 留空不提示必填；格式错误提示 | 无写入表单 | 不提交 | OPEN-REG-002 | 已覆盖 |
| RULE-REG-003 | 唯一性提交路径 | 不适用 | 重复名称 | 显示资料定义重复名称提示 | 已有重复名称 | 写入授权 | OPEN-REG-003 | 受控执行 |
`;

test("严格预检要求每条适用规则的可审查设计结论", () => {
  assert.deepEqual(validateRuleDesignMatrix(plan), []);
});

test("严格预检拒绝泛化预期和缺失选填声明", () => {
  const invalid = plan.replace("选填 | 留空、合法、格式错误 | 留空不提示必填；格式错误提示", "未知 | 留空、合法、格式错误 | 已定义校验");
  assert.deepEqual(validateRuleDesignMatrix(invalid), ["RULE-REG-002 未声明必填/选填性。", "RULE-REG-002 缺少具体输入或可观察预期。"]);
});

test("规则邻域覆盖同一需求、字段组和前置路径且去重", () => {
  assert.deepEqual(expandRuleNeighborhood(plan, ["RULE-REG-001"]), ["RULE-REG-001", "RULE-REG-002"]);
  assert.deepEqual(expandRuleNeighborhood(plan, ["RULE-REG-001", "RULE-REG-002"]), ["RULE-REG-001", "RULE-REG-002"]);
});
