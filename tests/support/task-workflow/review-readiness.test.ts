import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReviewReadiness } from "../../../src/support/task-workflow/reviewReadiness.js";

const sha = "a".repeat(64);

const plan = `
## 输入资料

| 资料 | manifest id / sectionId |
| --- | --- |
| source | demo / main |

## 覆盖基准与拆分清单

- demo

## 需求追溯矩阵

| 需求追溯编号 | 派生 caseId |
| --- | --- |
| REQ-DEMO-001 | DEMO-MAIN-001 |

## 规则覆盖台账

| RULE | REQ | 来源 | 类型 | 输入 | 预期 | 技术 | 适用性 | 结论 | caseId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | source | 业务规则 | valid | visible result | 场景法 | 适用 | 已覆盖 | DEMO-MAIN-001 |

结构版本：rule-design-matrix-v1

## 规则设计矩阵

| RULE | 字段或状态 | 必填性 | 输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | demo | 必填 | valid | visible result | isolated | no_write | DEMO-MAIN-001 | 已覆盖 |
`;

const testcase = `
## 用例目录

| 用例编号 | 标题 |
| --- | --- |
| DEMO-MAIN-001 | demo |

## 测试用例：demo

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | DEMO-MAIN-001 |

## 来源

| 资料 | 说明 |
| --- | --- |
| source | manifest \`demo\`；sectionId \`main\`；SHA-256 \`${sha}\` |

## 前置条件

- isolated

## 操作步骤

1. act

## 预期结果

- visible

## 覆盖关联

- RULE-DEMO-001

## 合理推断

- 无

## 待补充信息

- 无

## 评审与演进回链

- 未评审
`;

test("review readiness closes structural, design, relation, and source identity checks", () => {
  const report = evaluateReviewReadiness({
    plan,
    packages: { "cases-main.md": testcase },
    writesData: false
  });
  assert.equal(report.complete, true, report.issues.join("\n"));
  assert.deepEqual(report.counts, {
    requirements: 1,
    rules: 1,
    cases: 1,
    packages: 1
  });
  assert.match(report.digest, /^[a-f0-9]{64}$/);
});

test("review readiness fails before reviewer dispatch on obvious draft gaps", () => {
  const report = evaluateReviewReadiness({
    plan: plan.replace("结构版本：rule-design-matrix-v1", ""),
    packages: {
      "cases-main.md": testcase
        .replace("sectionId `main`；", "")
        .replace("## 预期结果", "## 缺失预期")
    },
    writesData: false
  });
  assert.equal(report.complete, false);
  assert.ok(report.issues.some((issue) => issue.includes("rule-design-matrix-v1")));
  assert.ok(report.issues.some((issue) => issue.includes("sectionId")));
  assert.ok(report.issues.some((issue) => issue.includes("missing required sections")));
});

test("write readiness reports safety gaps together instead of one reviewer round at a time", () => {
  const report = evaluateReviewReadiness({
    plan,
    packages: {
      "cases-main.md": testcase.replace(
        "| 用例编号 | DEMO-MAIN-001 |",
        "| 用例编号 | DEMO-MAIN-001 |\n| 数据策略 | managed_cleanup |"
      )
    },
    writesData: true
  });
  assert.equal(report.warnings.length, 3);
  assert.ok(report.warnings.some((warning) => warning.includes("执行清单")));
  assert.ok(report.warnings.some((warning) => warning.includes("cleanup")));
  assert.ok(report.warnings.some((warning) => warning.includes("核对")));
});
