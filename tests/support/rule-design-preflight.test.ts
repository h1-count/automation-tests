import assert from "node:assert/strict";
import test from "node:test";
import { expandRuleNeighborhood, validateRuleDesignMatrix } from "../../scripts/rule-design-preflight.ts";
import { validateRuleDesignMatrix as validatePureRuleDesignMatrix } from "../../src/support/testcase/relationProjection.ts";

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

const v2Plan = `
> 结构版本：test-design-index-v2 / rule-design-ledger-v2 / case-relation-projection-v2。

## 规则设计台账
| 规则编号 | 需求编号 | 来源定位 | 覆盖域 | 触发条件 | 输入边界 | 可观察预期 | 设计技术 | 数据/执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-101 | REQ-REG-101 | SRC-REG-001；注册 | 输入 | 提交 | 有效邮箱 | 显示注册成功页 | 等价类 | no_write | OPEN-REG-101 | 已覆盖 |
`;

test("严格预检要求每条适用规则的可审查设计结论", () => {
  assert.deepEqual(validateRuleDesignMatrix(plan), []);
});

test("v2 统一规则台账直接通过设计预检", () => {
  assert.deepEqual(validateRuleDesignMatrix(v2Plan), []);
  assert.ok(
    validateRuleDesignMatrix(v2Plan.replace("显示注册成功页", "功能正常"))
      .some((issue) => issue.includes("缺少具体输入或可观察预期"))
  );
  assert.ok(
    validateRuleDesignMatrix(v2Plan.replace("no_write", "待填写"))
      .some((issue) => issue.includes("缺少数据/执行门禁"))
  );
});

test("严格预检拒绝泛化预期和缺失选填声明", () => {
  const invalid = plan.replace("选填 | 留空、合法、格式错误 | 留空不提示必填；格式错误提示", "未知 | 留空、合法、格式错误 | 已定义校验");
  assert.deepEqual(validateRuleDesignMatrix(invalid), ["RULE-REG-002 未声明必填/选填性。", "RULE-REG-002 缺少具体输入或可观察预期。"]);
});

test("规则设计矩阵拒绝与唯一 RULE 台账不同的 caseId", () => {
  const invalid = plan.replace("OPEN-REG-002 | 已覆盖", "OPEN-REG-999 | 已覆盖");
  assert.deepEqual(validateRuleDesignMatrix(invalid), ["RULE-REG-002 的规则设计 caseId 与 RULE 台账不一致。"]);
});

test("RULE 台账已有 caseId 时拒绝规则设计矩阵阶段占位", () => {
  const invalid = plan.replace("OPEN-REG-001 | 已覆盖", "阶段二生成 | 已覆盖");
  assert.deepEqual(validateRuleDesignMatrix(invalid), ["RULE-REG-001 的 RULE 台账已有 caseId，规则设计矩阵不得保留阶段二生成。"]);
});

test("阶段二尚无正文时允许阶段占位，出现 RULE caseId 后纯模型拒绝它", () => {
  const staged = plan.replace(/OPEN-REG-00[1-3]/g, "阶段二生成");
  assert.deepEqual(validatePureRuleDesignMatrix(staged), []);
  const generated = staged.replace(
    "| RULE-REG-001 | REQ-REG-001 | PRD | 输入边界 | 名称 | 提示 | 等价类与边界 | 适用 | 已覆盖 | 阶段二生成 | 无写入 |",
    "| RULE-REG-001 | REQ-REG-001 | PRD | 输入边界 | 名称 | 提示 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-001 | 无写入 |"
  );
  assert.ok(validatePureRuleDesignMatrix(generated).some((issue) => issue.detail.includes("不得保留阶段二生成")));
});

test("规则邻域覆盖同一需求、字段组和前置路径且去重", () => {
  assert.deepEqual(expandRuleNeighborhood(plan, ["RULE-REG-001"]), ["RULE-REG-001", "RULE-REG-002"]);
  assert.deepEqual(expandRuleNeighborhood(plan, ["RULE-REG-001", "RULE-REG-002"]), ["RULE-REG-001", "RULE-REG-002"]);
});
