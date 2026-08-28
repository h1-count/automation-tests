import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompleteReviewBatchScope,
  parseReviewBatchScope,
  reviewBatchScopeDigest
} from "../../../src/support/task-workflow/reviewBatchScope.js";
import { assessCaseReviewRisk, caseReviewRiskDigest } from "../../../src/support/task-workflow/caseReviewRisk.js";
import { routeSemanticReview } from "../../../src/support/task-workflow/reviewSemanticRouting.js";

const activities = [
  "case-review-requirements",
  "case-review-design",
  "case-review-traceability"
];

function evidence(activityId: string, role: string) {
  return {
    activityId,
    role,
    batchId: "REV-01",
    inputDigest: "a".repeat(64),
    planEvidenceDigest: "b".repeat(64)
  };
}

function scriptReviewAssessment() {
  const cases = [
    {
      caseId: "OPEN-REG-001",
      level: "standard" as const,
      requirementRefs: ["REQ-REG-001"],
      ruleRefs: ["RULE-REG-001"],
      reasons: []
    }
  ];
  return {
    schemaVersion: "case-review-risk-v1" as const,
    distribution: "uniform" as const,
    maxLevel: "standard" as const,
    counts: { light: 0, standard: 1, strict: 0 },
    cases,
    digest: caseReviewRiskDigest({ cases })
  };
}

test("full review scope is deterministic and does not reuse submissions", () => {
  const assessment = scriptReviewAssessment();
  const input = {
    allActivityIds: activities,
    caseRiskAssessment: assessment,
    activityRoles: activities.map((activityId) => ({ activityId, role: "requirements" })),
    reviewEpochDigest: "a".repeat(64),
    semanticEvolutionCycle: 0
  };
  const first = buildCompleteReviewBatchScope({ ...input, allActivityIds: [...activities].reverse(), activityRoles: [...input.activityRoles].reverse() });
  const second = buildCompleteReviewBatchScope(input);
  assert.deepEqual(first, second);
  assert.equal(first.mode, "full");
  assert.deepEqual(first.requiredActivityIds, [...activities].sort());
  assert.equal(first.reason, "initial_full_review");
  assert.equal(reviewBatchScopeDigest(first), reviewBatchScopeDigest(second));
});

test("targeted scope binds affected refs and every reused reviewer evidence", () => {
  const scope = buildCompleteReviewBatchScope({
    allActivityIds: activities,
    caseRiskAssessment: scriptReviewAssessment(),
    activityRoles: activities.map((activityId) => ({ activityId, role: "requirements" })),
    reviewEpochDigest: "a".repeat(64),
    semanticEvolutionCycle: 0,
    requiredActivityIds: ["case-review-design"],
    affectedRefs: ["RULE-REG-007", "OPEN-REG-007", "RULE-REG-007"],
    excludedRefs: ["cases-account-login.md"],
    baseBatchId: "REV-01",
    reason: "boundary case changed",
    reusableEvidence: [
      evidence("case-review-requirements", "requirements"),
      evidence("case-review-traceability", "traceability")
    ]
  });
  assert.equal(scope.mode, "targeted");
  assert.deepEqual(scope.requiredActivityIds, ["case-review-design"]);
  assert.deepEqual(scope.affectedRefs, ["OPEN-REG-007", "RULE-REG-007"]);
  assert.equal(scope.reusedReviewerEvidence.length, 2);
  assert.match(reviewBatchScopeDigest(scope), /^[a-f0-9]{64}$/);
});

test("targeted scope fails closed without impact refs or reusable evidence", () => {
  assert.throws(
    () => buildCompleteReviewBatchScope({
      allActivityIds: activities,
      caseRiskAssessment: scriptReviewAssessment(),
      activityRoles: activities.map((activityId) => ({ activityId, role: "requirements" })),
      reviewEpochDigest: "a".repeat(64),
      semanticEvolutionCycle: 0,
      requiredActivityIds: ["case-review-design"],
      baseBatchId: "REV-01",
      reason: "changed"
    }),
    /affectedRefs/
  );
  assert.throws(
    () => buildCompleteReviewBatchScope({
      allActivityIds: activities,
      caseRiskAssessment: scriptReviewAssessment(),
      activityRoles: activities.map((activityId) => ({ activityId, role: "requirements" })),
      reviewEpochDigest: "a".repeat(64),
      semanticEvolutionCycle: 0,
      requiredActivityIds: ["case-review-design"],
      affectedRefs: ["RULE-REG-007"],
      baseBatchId: "REV-01",
      reason: "changed",
      reusableEvidence: [evidence("case-review-requirements", "requirements")]
    }),
    /case-review-traceability/
  );
});

test("current mixed scope excludes light from combined and keeps impact strict-only", () => {
  const testcaseDocument = (caseId: string, strategy: string, risk: string, action: string) => `> 结构版本：testcase-v1-layered。

# 用例集：注册演示

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：${strategy}
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。

## 模块：注册

<details open>
<summary>${caseId}｜验证注册行为｜P1｜${risk}风险</summary>

> 规则：RULE-${caseId.replace(/^OPEN-/u, "")}

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | ${action} | 合成数据 | 可观察结果 |

</details>
`;
  const plan = `> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-REG-001 | SRC-REG-001 | 注册页面可读 | 适用 |
| REQ-REG-002 | SRC-REG-002 | 提交受控 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | REQ-REG-001 | SRC-REG-001 | 打开页面 | 页面可读 | 场景法 | OPEN-REG-001 | no_write | 已覆盖 |
| RULE-REG-002 | REQ-REG-002 | SRC-REG-002 | 提交申请 | 提交结果受控 | 场景法 | OPEN-REG-002 | 受控执行 | 已覆盖 |
`;
  const assessment = assessCaseReviewRisk([
    testcaseDocument("OPEN-REG-001", "no_write", "低", "打开当前页"),
    testcaseDocument("OPEN-REG-002", "ephemeral_cleanup", "高", "发送一次 OTP 并提交申请")
  ], { plan });
  const allActivityIds = ["case-review-combined", "case-review-impact"];
  const scope = buildCompleteReviewBatchScope({
    allActivityIds,
    caseRiskAssessment: assessment,
    activityRoles: [
      { activityId: "case-review-combined", role: "combined" },
      { activityId: "case-review-impact", role: "impact" }
    ],
    reviewEpochDigest: "c".repeat(64),
    semanticEvolutionCycle: 1
  });
  assert.equal(scope.schemaVersion, "review-batch-scope-v1");
  assert.deepEqual(scope.riskSummary.counts, { light: 1, standard: 0, strict: 1 });
  assert.deepEqual(
    scope.roleScopes.find((item) => item.role === "combined")?.caseIds,
    ["OPEN-REG-002"]
  );
  assert.deepEqual(scope.roleScopes.find((item) => item.role === "impact"), {
    activityId: "case-review-impact",
    role: "impact",
    caseIds: ["OPEN-REG-002"],
    requirementRefs: ["REQ-REG-002"],
    ruleRefs: ["RULE-REG-002"]
  });
  assert.deepEqual(parseReviewBatchScope(scope), scope);
  assert.match(reviewBatchScopeDigest(scope), /^[a-f0-9]{64}$/u);
  assert.deepEqual(routeSemanticReview({
    scope,
    allActivityIds,
    baselineRoleInputDigests: {
      "case-review-combined": "a".repeat(64),
      "case-review-impact": "b".repeat(64)
    },
    currentRoleInputDigests: {
      "case-review-combined": "c".repeat(64),
      "case-review-impact": "b".repeat(64)
    }
  }), {
    requiredActivityIds: ["case-review-combined"],
    affectedRefs: ["OPEN-REG-002", "REQ-REG-002", "RULE-REG-002"]
  });
});

test("script review roles are risk-scoped instead of silently receiving every case", () => {
  const cases = [
    { caseId: "OPEN-REG-001", level: "light" as const, requirementRefs: ["REQ-REG-001"], ruleRefs: ["RULE-REG-001"], reasons: [] },
    { caseId: "OPEN-REG-002", level: "standard" as const, requirementRefs: ["REQ-REG-002"], ruleRefs: ["RULE-REG-002"], reasons: [] },
    { caseId: "OPEN-REG-003", level: "strict" as const, requirementRefs: ["REQ-REG-003"], ruleRefs: ["RULE-REG-003"], reasons: [] }
  ];
  const assessment = {
    schemaVersion: "case-review-risk-v1" as const,
    distribution: "mixed" as const,
    maxLevel: "strict" as const,
    counts: { light: 1, standard: 1, strict: 1 },
    cases,
    digest: caseReviewRiskDigest({ cases })
  };
  const scope = buildCompleteReviewBatchScope({
    allActivityIds: ["script-review-quality", "script-review-safety"],
    caseRiskAssessment: assessment,
    activityRoles: [
      { activityId: "script-review-quality", role: "script_quality" },
      { activityId: "script-review-safety", role: "execution_safety" }
    ],
    reviewEpochDigest: "a".repeat(64),
    semanticEvolutionCycle: 0
  });
  assert.deepEqual(scope.roleScopes.find((item) => item.role === "script_quality")?.caseIds, ["OPEN-REG-002", "OPEN-REG-003"]);
  assert.deepEqual(scope.roleScopes.find((item) => item.role === "execution_safety")?.caseIds, ["OPEN-REG-003"]);
});

test("script review freezes the assessment's exact per-role case scope", () => {
  const cases = [
    { caseId: "OPEN-REG-001", level: "light" as const, requirementRefs: ["REQ-REG-001"], ruleRefs: ["RULE-REG-001"], reasons: [] },
    { caseId: "OPEN-REG-002", level: "standard" as const, requirementRefs: ["REQ-REG-002"], ruleRefs: ["RULE-REG-002"], reasons: [] },
    { caseId: "OPEN-REG-003", level: "strict" as const, requirementRefs: ["REQ-REG-003"], ruleRefs: ["RULE-REG-003"], reasons: [] }
  ];
  const assessment = {
    schemaVersion: "case-review-risk-v1" as const,
    distribution: "mixed" as const,
    maxLevel: "strict" as const,
    counts: { light: 1, standard: 1, strict: 1 },
    cases,
    digest: caseReviewRiskDigest({ cases })
  };
  const scope = buildCompleteReviewBatchScope({
    allActivityIds: ["script-review-quality", "script-review-safety"],
    caseRiskAssessment: assessment,
    activityRoles: [
      { activityId: "script-review-quality", role: "script_quality" },
      { activityId: "script-review-safety", role: "execution_safety" }
    ],
    roleCaseIdsByActivity: {
      "script-review-quality": ["OPEN-REG-001", "OPEN-REG-003"],
      "script-review-safety": ["OPEN-REG-003"]
    },
    reviewEpochDigest: "a".repeat(64),
    semanticEvolutionCycle: 0
  });
  assert.deepEqual(scope.roleScopes.find((item) => item.role === "script_quality")?.caseIds, ["OPEN-REG-001", "OPEN-REG-003"]);
  assert.deepEqual(scope.roleScopes.find((item) => item.role === "execution_safety")?.caseIds, ["OPEN-REG-003"]);
});

test("current review scope parsing and digest remain deterministic", () => {
  const scope = buildCompleteReviewBatchScope({
    allActivityIds: activities,
    caseRiskAssessment: scriptReviewAssessment(),
    activityRoles: activities.map((activityId) => ({ activityId, role: "requirements" })),
    reviewEpochDigest: "a".repeat(64),
    semanticEvolutionCycle: 0
  });
  assert.equal(scope.schemaVersion, "review-batch-scope-v1");
  assert.deepEqual(parseReviewBatchScope(scope), scope);
  assert.equal(reviewBatchScopeDigest(parseReviewBatchScope(scope)), reviewBatchScopeDigest(scope));
});

test("current scoped revision slices the REQ/RULE/case closure and fails closed for global or broad refs", () => {
  const assessment = {
    schemaVersion: "case-review-risk-v1" as const,
    cases: Array.from({ length: 9 }, (_, index) => ({
      caseId: `OPEN-REG-${String(index + 1).padStart(3, "0")}`,
      level: "standard" as const,
      reasons: ["semantic_change"],
      requirementRefs: [`REQ-REG-${String(index + 1).padStart(3, "0")}`],
      ruleRefs: [`RULE-REG-${String(index + 1).padStart(3, "0")}`]
    })),
    counts: { light: 0, standard: 9, strict: 0 },
    distribution: "uniform" as const,
    maxLevel: "standard" as const,
    digest: ""
  };
  // Use the production assessor digest contract rather than an arbitrary test hash.
  assessment.digest = caseReviewRiskDigest(assessment);
  const input = {
    allActivityIds: ["case-review-combined"],
    caseRiskAssessment: assessment,
    activityRoles: [{ activityId: "case-review-combined", role: "combined" }],
    reviewEpochDigest: "d".repeat(64),
    semanticEvolutionCycle: 1
  };
  assert.deepEqual(buildCompleteReviewBatchScope({ ...input, affectedRefs: ["RULE-REG-001"] })
    .roleScopes[0]?.caseIds, ["OPEN-REG-001"]);
  assert.equal(buildCompleteReviewBatchScope({ ...input, affectedRefs: ["请求默认值"] })
    .roleScopes[0]?.caseIds.length, 9);
  assert.equal(buildCompleteReviewBatchScope({ ...input, affectedRefs: assessment.cases.map((item) => item.caseId) })
    .roleScopes[0]?.caseIds.length, 9);
});
