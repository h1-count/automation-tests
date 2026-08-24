import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewBatchScope,
  buildReviewBatchScopeV2,
  buildReviewBatchScopeV3,
  parseReviewBatchScope,
  reviewBatchScopeDigest
} from "../../../src/support/task-workflow/reviewBatchScope.js";
import { assessCaseReviewRisk } from "../../../src/support/task-workflow/caseReviewRisk.js";
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

test("full review scope is deterministic and does not reuse submissions", () => {
  const first = buildReviewBatchScope({
    allActivityIds: [...activities].reverse()
  });
  const second = buildReviewBatchScope({
    allActivityIds: activities
  });
  assert.deepEqual(first, second);
  assert.equal(first.mode, "full");
  assert.deepEqual(first.requiredActivityIds, [...activities].sort());
  assert.equal(first.reason, "initial_full_review");
  assert.equal(reviewBatchScopeDigest(first), reviewBatchScopeDigest(second));
});

test("targeted scope binds affected refs and every reused reviewer evidence", () => {
  const scope = buildReviewBatchScope({
    allActivityIds: activities,
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
    () => buildReviewBatchScope({
      allActivityIds: activities,
      requiredActivityIds: ["case-review-design"],
      baseBatchId: "REV-01",
      reason: "changed"
    }),
    /affectedRefs/
  );
  assert.throws(
    () => buildReviewBatchScope({
      allActivityIds: activities,
      requiredActivityIds: ["case-review-design"],
      affectedRefs: ["RULE-REG-007"],
      baseBatchId: "REV-01",
      reason: "changed",
      reusableEvidence: [evidence("case-review-requirements", "requirements")]
    }),
    /case-review-traceability/
  );
});

test("v3 mixed scope excludes light from combined and keeps impact strict-only", () => {
  const v6Document = (caseId: string, strategy: string, risk: string, action: string) => `> 结构版本：testcase-v6-layered。

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
  const plan = `> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。

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
    v6Document("OPEN-REG-001", "no_write", "低", "打开当前页"),
    v6Document("OPEN-REG-002", "managed_cleanup", "高", "发送一次 OTP 并提交申请")
  ], { plan });
  const allActivityIds = ["case-review-combined", "case-review-impact"];
  const scope = buildReviewBatchScopeV3({
    allActivityIds,
    caseRiskAssessment: assessment,
    activityRoles: [
      { activityId: "case-review-combined", role: "combined" },
      { activityId: "case-review-impact", role: "impact" }
    ],
    reviewEpochDigest: "c".repeat(64),
    semanticEvolutionCycle: 1
  });
  assert.equal(scope.schemaVersion, "review-batch-scope-v3");
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

test("v1 review scope parsing and digest stay backward compatible", () => {
  const scope = buildReviewBatchScope({ allActivityIds: activities });
  assert.equal(scope.schemaVersion, "review-batch-scope-v1");
  assert.deepEqual(parseReviewBatchScope(scope), scope);
  assert.equal(reviewBatchScopeDigest(parseReviewBatchScope(scope)), reviewBatchScopeDigest(scope));
});
