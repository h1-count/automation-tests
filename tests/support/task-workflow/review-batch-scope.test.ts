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
  const markdown = (caseId: string, strategy: string, req: string, rule: string) => `
## 测试用例：${caseId}
## 基本信息
| 项目 | 内容 |
| --- | --- |
| 用例编号 | ${caseId} |
| 需求追溯编号 | ${req} |
| 规则覆盖编号 | ${rule} |
| 数据策略 | ${strategy} |
| 风险等级 | ${strategy === "no_write" ? "低" : "高"} |
## 前置条件
- test 环境。
## 操作步骤
| 序号 | 操作 | 输入 | 预期 |
| --- | --- | --- | --- |
| 1 | ${strategy === "no_write" ? "打开当前页" : "发送一次 OTP 并提交申请"} | 合成数据 | 可观察 |
`;
  const assessment = assessCaseReviewRisk([
    markdown("OPEN-REG-001", "no_write", "REQ-REG-001", "RULE-REG-001"),
    markdown("OPEN-REG-002", "managed_cleanup", "REQ-REG-002", "RULE-REG-002")
  ]);
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
});

test("v1 review scope parsing and digest stay backward compatible", () => {
  const scope = buildReviewBatchScope({ allActivityIds: activities });
  assert.equal(scope.schemaVersion, "review-batch-scope-v1");
  assert.deepEqual(parseReviewBatchScope(scope), scope);
  assert.equal(reviewBatchScopeDigest(parseReviewBatchScope(scope)), reviewBatchScopeDigest(scope));
});
