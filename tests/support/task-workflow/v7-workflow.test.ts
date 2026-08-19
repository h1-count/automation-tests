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

test("v7 full replan automatically converges a complete candidate before one confirmation", () => {
  const definition = buildWorkflowDefinition(baseDefinitionInput());
  const callbacks = definition.activities.filter((activity) => activity.kind === "callback");
  const confirmationIndex = definition.activities.findIndex(
    (activity) => activity.id === "case-confirmation"
  );
  assert.equal(definition.definitionVersion, "v7");
  assert.deepEqual(callbacks.map((activity) => activity.id), ["case-confirmation"]);
  assert.equal(confirmationIndex > 0, true);
  assert.equal(
    definition.activities.slice(0, confirmationIndex)
      .some((activity) => activity.kind === "callback"),
    false
  );
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
    definition.activities.find((activity) => activity.id === "relation-sync")?.dependencies,
    ["case-generation-cases-main-md"]
  );
  const reviewActivityIds = definition.activities
    .filter((activity) => activity.kind === "review")
    .map((activity) => activity.id);
  assert.equal(reviewActivityIds.length > 0, true);
  assert.deepEqual(
    definition.activities.find((activity) => activity.id === "case-review-resolution")?.dependencies,
    reviewActivityIds
  );
  assert.deepEqual(
    definition.activities.find((activity) => activity.id === "case-confirmation")?.dependencies,
    ["case-review-resolution", "case-review-evolution"]
  );
  assert.deepEqual(
    definition.activities.find((activity) => activity.id === "build")?.dependencies,
    ["case-confirmation"]
  );
});

test("v3 lean workflow merges generation gates and defers authorization policy until readiness", () => {
  const definition = buildWorkflowDefinition({
    ...baseDefinitionInput(),
    casePackages: ["cases.md"],
    planText: [
      "test-design-index-v3",
      "rule-design-ledger-v3",
      ...Array.from({ length: 40 }, (_, index) => `REQ-DEMO-${String(index + 1).padStart(3, "0")}`)
    ].join("\n")
  });
  assert.equal(definition.reviewPolicy?.schemaVersion, "review-policy-v3");
  assert.equal(definition.reviewPolicy?.maxAttemptsPerRole, 2);
  assert.equal(definition.reviewPolicy?.maxSemanticEvolutionCycles, 1);
  assert.deepEqual(
    definition.activities.slice(0, 3).map((activity) => activity.id),
    ["source-selection", "candidate-generation", "candidate-gate"]
  );
  assert.equal(
    definition.activities.some((activity) =>
      ["plan-validation", "relation-sync", "completeness-validation"].includes(activity.id)
    ),
    false
  );
  assert.deepEqual(
    definition.activities.filter((activity) => activity.kind === "review").map((activity) => activity.id),
    ["case-review-combined", "case-review-impact"]
  );
  assert.equal(
    definition.activities.find((activity) => activity.id === "execution-authorization")
      ?.metadata?.decisionMode,
    "risk_adaptive"
  );
  assert.equal(
    definition.activities.find((activity) => activity.id === "execution-authorization")
      ?.metadata?.policyVersion,
    "policy_auto_no_write_v2"
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

test("v7 delivery target pins a real terminal graph before initialization", () => {
  const testcaseOnly = buildWorkflowDefinition({
    ...baseDefinitionInput(),
    deliveryTarget: "testcase_only"
  });
  const scriptOnly = buildWorkflowDefinition({
    ...baseDefinitionInput(),
    deliveryTarget: "script_only"
  });
  const fullRun = buildWorkflowDefinition({
    ...baseDefinitionInput(),
    deliveryTarget: "full_run"
  });

  assert.equal(testcaseOnly.deliveryTarget, "testcase_only");
  assert.equal(
    testcaseOnly.activities.find((activity) => activity.id === "case-confirmation")
      ?.metadata?.completesWorkflow,
    true
  );
  assert.equal(testcaseOnly.activities.some((activity) => activity.id === "build"), false);
  assert.equal(
    scriptOnly.activities.find((activity) => activity.id === "build")
      ?.metadata?.completesWorkflow,
    true
  );
  assert.equal(scriptOnly.activities.some((activity) => activity.id === "readiness"), false);
  assert.equal(fullRun.activities.some((activity) => activity.id === "report"), true);
  assert.notEqual(testcaseOnly.graphDigest, scriptOnly.graphDigest);
  assert.notEqual(scriptOnly.graphDigest, fullRun.graphDigest);
});

test("v7 reusable branches stop at the selected delivery endpoint", () => {
  const direct = buildReusableWorkflowDefinition({
    ...reusableInput("direct_execute"),
    deliveryTarget: "testcase_only"
  });
  const affected = buildReusableWorkflowDefinition({
    ...reusableInput("affected_rebuild"),
    deliveryTarget: "testcase_only"
  });
  const full = buildReusableWorkflowDefinition({
    ...reusableInput("full_replan"),
    deliveryTarget: "script_only"
  });

  assert.equal(
    direct.activities.find((activity) => activity.id === "suite-validation")
      ?.metadata?.completesWorkflow,
    true
  );
  assert.equal(direct.activities.some((activity) => activity.id === "readiness"), false);
  assert.equal(
    affected.activities.find((activity) => activity.id === "case-confirmation")
      ?.metadata?.completesWorkflow,
    true
  );
  assert.equal(affected.activities.some((activity) => activity.id === "build"), false);
  assert.equal(full.activities.find((activity) => activity.id === "build")
    ?.metadata?.completesWorkflow, true);
  assert.equal(full.activities.some((activity) => activity.id === "readiness"), false);
});

const plan = `# 测试设计索引：示例

> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/demo/request-001 |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

### 包含

- 注册

### 不包含

- 生产执行

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
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

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-DEMO-001 | SRC-DEMO-001 | 注册成功 | 适用 |
| REQ-DEMO-002 | SRC-DEMO-002 | 登录成功 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001 | 注册；提交有效输入 | 显示成功页 | 场景法 | DEMO-CASE-001 | 无 | 已覆盖 |
| RULE-DEMO-002 | REQ-DEMO-002 | SRC-DEMO-002 | 登录；提交有效输入 | 显示首页 | 场景法 | DEMO-CASE-002 | 无 | 已覆盖 |

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
| 模块 | 注册 |
| 优先级 | P0 |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |

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

test("archived testcase-v2 cannot enter completeness or confirmation runtime", () => {
  const completeness = evaluateTestcasePackage(testcasePackage, {
    expectedCount: 1,
    expectedCaseIds: ["DEMO-CASE-001"]
  });
  assert.equal(completeness.complete, false);
  assert.ok(completeness.reasons.some((reason) => reason.includes("archived formats")));
  assert.throws(() => caseConfirmationSemanticCases(testcasePackage), /only accepts testcase-v6-layered/u);
});

test("v7 user status has exactly four phases", () => {
  assert.deepEqual(v7UserPhaseIds, ["design", "engineering", "execution", "reporting"]);
});
