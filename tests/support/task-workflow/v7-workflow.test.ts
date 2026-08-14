import assert from "node:assert/strict";
import test from "node:test";
import {
  caseConfirmationPlanProjectionV2,
  caseConfirmationSemanticCases
} from "../../../src/support/task-workflow/callbackDecision.js";
import {
  buildReusableWorkflowDefinition,
  buildWorkflowDefinition
} from "../../../src/support/task-workflow/definition.js";
import {
  evaluateTestcasePackage
} from "../../../src/support/task-workflow/packageCompleteness.js";
import { v7UserPhaseIds } from "../../../src/support/task-workflow/simplifiedPhase.js";
import type { ReusableWorkflowDefinitionInput } from "../../../src/support/task-workflow/types.js";

const digest = (character: string) => character.repeat(64);

function baseDefinitionInput() {
  return {
    requestId: "web/demo/request-001",
    planDigest: digest("a"),
    capabilities: ["web" as const],
    writesData: false,
    casePackages: ["cases-main.md"]
  };
}

function reusableInput(
  decision: ReusableWorkflowDefinitionInput["reuseAssessment"]["decision"]
): ReusableWorkflowDefinitionInput {
  return {
    ...baseDefinitionInput(),
    reuseAssessment: {
      schemaVersion: "test-suite-reuse-assessment-v1",
      suiteId: "web/demo/feature",
      suiteVersion: digest("b"),
      assessmentDigest: digest("c"),
      decision,
      requestedProfile: decision === "affected_rebuild" ? "affected" : "full_feature",
      effectiveProfile: decision === "affected_rebuild" ? "affected" : "full_feature",
      selectedCaseIds: ["DEMO-CASE-001", "DEMO-CASE-002"],
      affectedCaseIds: decision === "affected_rebuild" ? ["DEMO-CASE-001"] : []
    }
  };
}

test("v7 full replan has one case confirmation and no plan/conflict callback", () => {
  const definition = buildWorkflowDefinition(baseDefinitionInput());
  const callbacks = definition.activities.filter((activity) => activity.kind === "callback");
  assert.equal(definition.definitionVersion, "v7");
  assert.deepEqual(callbacks.map((activity) => activity.id), ["case-confirmation"]);
  assert.equal(definition.activities.some((activity) => activity.id === "plan-confirmation"), false);
  assert.equal(
    definition.activities.some((activity) => activity.id === "case-review-conflict-decision"),
    false
  );
  assert.deepEqual(
    definition.activities.find((activity) => activity.kind === "case_generation")?.dependencies,
    ["plan-validation"]
  );
  assert.deepEqual(
    definition.activities.find((activity) => activity.id === "build")?.dependencies,
    ["case-confirmation"]
  );
});

test("v7 reuse branches confirm only the design that was rebuilt", () => {
  const direct = buildReusableWorkflowDefinition(reusableInput("direct_execute"));
  const affected = buildReusableWorkflowDefinition(reusableInput("affected_rebuild"));
  const full = buildReusableWorkflowDefinition(reusableInput("full_replan"));

  assert.equal(direct.activities.some((activity) => activity.id === "case-confirmation"), false);
  assert.deepEqual(
    affected.activities.filter((activity) => activity.kind === "callback").map((activity) => activity.id),
    ["case-confirmation"]
  );
  assert.equal(
    affected.activities.find((activity) => activity.id === "case-confirmation")
      ?.metadata?.subjectSchemaVersion,
    "case-confirmation-subject-v2"
  );
  assert.deepEqual(
    full.activities.filter((activity) => activity.kind === "callback").map((activity) => activity.id),
    ["case-confirmation"]
  );
});

const plan = `# 测试设计索引：示例

> 结构版本：test-design-index-v2 / rule-design-ledger-v2 / case-relation-projection-v2。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/demo/request-001 |
| 测试类型 | Web |
| 目标环境 | test |

## 测试范围

### 包含

- 注册

### 不包含

- 生产执行

## 资料来源

| 来源 ID / sectionId | 可点击链接与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-DEMO-001 | 需求；注册章节 | ${digest("1")} | REQ-DEMO-001 |
| SRC-DEMO-002 | 需求；登录章节 | ${digest("2")} | REQ-DEMO-002 |

## 环境、静态资产与数据安全边界

| 类别 | 已确定边界 | 未决项或门禁 |
| --- | --- | --- |
| 环境 | test；禁止生产 | 无 |
| 数据 | no_write | 无 |
| 权限与安全 | 禁止设备动作 | 无 |

## 需求索引

| 需求编号 | 来源定位 | 优先级 | 可验证需求 | 适用性与依据 |
| --- | --- | --- | --- | --- |
| REQ-DEMO-001 | SRC-DEMO-001 | P0 | 注册成功 | 适用 |
| REQ-DEMO-002 | SRC-DEMO-002 | P1 | 登录成功 | 适用 |

## 规则设计台账

| 规则编号 | 需求编号 | 来源定位 | 覆盖域 | 触发条件 | 输入边界 | 可观察预期 | 设计技术 | 数据/执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001 | 注册 | 提交 | 有效 | 显示成功页 | 场景法 | 无 | DEMO-CASE-001 | 已覆盖 |
| RULE-DEMO-002 | REQ-DEMO-002 | SRC-DEMO-002 | 登录 | 提交 | 有效 | 显示首页 | 场景法 | 无 | DEMO-CASE-002 | 已覆盖 |

## 假设、缺口与风险

- RISK-DEMO-001：RULE-DEMO-001 的邮件到达只作执行风险。
- RISK-DEMO-002：RULE-DEMO-002 无额外风险。

## 评审记录

- REV-DEMO-001：RULE-DEMO-001 与 DEMO-CASE-001 可提交确认。
- REV-DEMO-002：RULE-DEMO-002 与 DEMO-CASE-002 可提交确认。

## 正式用户决定

| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |
| --- | --- | --- | --- | --- |
| 用例确认 | ${digest("d")} | accepted | DEMO-CASE-001 | 进入脚本 |

## 确认后的工程映射

| caseId | 代码/图谱定位 | 自动化能力与脚本 | 定位及断言证据 | 数据/环境前置 | 风险或差异 |
| --- | --- | --- | --- | --- | --- |
| DEMO-CASE-001 | src/register.ts | tests/register.spec.ts | runtime_verified | test | 无 |

## 运行状态

- Activity 已完成。
`;

test("v2 confirmation projection includes design changes but excludes decisions and engineering", () => {
  const subject = caseConfirmationPlanProjectionV2({
    plan,
    scope: "full",
    caseIds: ["DEMO-CASE-001", "DEMO-CASE-002"],
    refs: ["REQ-DEMO-001", "REQ-DEMO-002", "RULE-DEMO-001", "RULE-DEMO-002"]
  });
  assert.notEqual(
    subject,
    caseConfirmationPlanProjectionV2({
      plan: plan.replace("显示成功页", "显示已注册首页"),
      scope: "full",
      caseIds: ["DEMO-CASE-001", "DEMO-CASE-002"],
      refs: ["REQ-DEMO-001", "REQ-DEMO-002", "RULE-DEMO-001", "RULE-DEMO-002"]
    })
  );
  assert.notEqual(
    subject,
    caseConfirmationPlanProjectionV2({
      plan: plan.replace("可提交确认", "存在待确认项"),
      scope: "full",
      caseIds: ["DEMO-CASE-001", "DEMO-CASE-002"],
      refs: ["REQ-DEMO-001", "REQ-DEMO-002", "RULE-DEMO-001", "RULE-DEMO-002"]
    })
  );
  assert.equal(
    subject,
    caseConfirmationPlanProjectionV2({
      plan: plan
        .replace("进入脚本", "重新记录决定")
        .replace("src/register.ts", "src/register-v2.ts")
        .replace("Activity 已完成", "Activity 正在恢复"),
      scope: "full",
      caseIds: ["DEMO-CASE-001", "DEMO-CASE-002"],
      refs: ["REQ-DEMO-001", "REQ-DEMO-002", "RULE-DEMO-001", "RULE-DEMO-002"]
    })
  );
});

test("affected projection ignores unrelated design but remains bound to global boundaries", () => {
  const input = {
    scope: "affected" as const,
    caseIds: ["DEMO-CASE-001"],
    refs: ["SRC-DEMO-001", "REQ-DEMO-001", "RULE-DEMO-001"]
  };
  const subject = caseConfirmationPlanProjectionV2({ plan, ...input });
  assert.equal(
    subject,
    caseConfirmationPlanProjectionV2({
      plan: plan.replace("显示首页", "显示新的登录首页"),
      ...input
    })
  );
  assert.notEqual(
    subject,
    caseConfirmationPlanProjectionV2({
      plan: plan.replace("| 目标环境 | test |", "| 目标环境 | pre |"),
      ...input
    })
  );
});

const testcasePackage = `> 结构版本：testcase-v2。

## 测试用例：注册成功

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | DEMO-CASE-001 |
| 需求编号 | REQ-DEMO-001 |
| 规则编号 | RULE-DEMO-001 |

## 来源

| manifest id / sectionId | 可点击链接与精确定位 | 来源 SHA-256 | 支持的步骤或预期 |
| --- | --- | --- | --- |
| SRC-DEMO-001 | 需求；注册章节 | ${digest("1")} | 提交结果 |

## 前置条件

- 注册页可用。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 提交注册 | 有效数据 |

## 预期结果

- RULE-DEMO-001：显示注册成功页。

## 假设与待确认项

- 无。
`;

test("testcase-v2 completeness uses the compact body and semantic changes invalidate it", () => {
  assert.equal(
    evaluateTestcasePackage(testcasePackage, {
      expectedCount: 1,
      expectedCaseIds: ["DEMO-CASE-001"]
    }).complete,
    true
  );
  assert.equal(
    evaluateTestcasePackage(testcasePackage.replace("## 步骤", "## 过程"), {
      expectedCount: 1,
      expectedCaseIds: ["DEMO-CASE-001"]
    }).complete,
    false
  );
  const before = caseConfirmationSemanticCases(testcasePackage);
  const after = caseConfirmationSemanticCases(
    testcasePackage.replace("显示注册成功页", "显示注册完成页")
  );
  assert.deepEqual(before.map((item) => item.caseId), ["DEMO-CASE-001"]);
  assert.notEqual(before[0]?.semanticSummary, after[0]?.semanticSummary);
});

test("v7 user status has exactly four phases", () => {
  assert.deepEqual(v7UserPhaseIds, ["design", "engineering", "execution", "reporting"]);
});
