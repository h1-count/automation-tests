import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewBatchScope,
  reviewBatchScopeDigest
} from "../../../src/support/task-workflow/reviewBatchScope.js";

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
