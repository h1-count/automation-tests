import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewPolicy, validateReviewPolicy } from "../../../src/support/task-workflow/reviewPolicy.js";

const planText = `> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001 | 打开页面 | 显示结果 | 场景法 | DEMO-001 | no_write | 已覆盖 |
`;

test("review policy creates one current v1 policy for a no-write request", () => {
  const policy = buildReviewPolicy({
    planText,
    capabilities: ["web"],
    casePackages: ["cases.md"],
    writesData: false
  });

  assert.equal(policy.schemaVersion, "review-policy-v1");
  assert.equal(policy.mode, "deterministic_only");
  assert.deepEqual(policy.requiredRoles, []);
  assert.equal(policy.maxConcurrentScouts, 3);
  assert.equal(policy.maxSemanticReviewBatchesPerRole, 2);
  assert.equal(policy.maxRecoveryRedispatchesPerBatch, 1);
  assert.equal(policy.maxAttemptsPerRole, 2);
  validateReviewPolicy(policy);
});

test("review policy requires current risk inputs and adds impact review for writes", () => {
  assert.throws(() => buildReviewPolicy({ writesData: false }), /review-policy-v1 requires/u);

  const policy = buildReviewPolicy({
    planText,
    capabilities: ["web"],
    casePackages: ["cases.md"],
    writesData: true,
    reviewerRoles: ["combined"]
  });
  assert.equal(policy.schemaVersion, "review-policy-v1");
  assert.equal(policy.mode, "combined_with_impact");
  assert.deepEqual(policy.requiredRoles, ["combined", "impact"]);
  validateReviewPolicy(policy);
});
