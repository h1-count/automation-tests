import assert from "node:assert/strict";
import test from "node:test";
import { validateKnowledgeDecisionRows } from "../../src/support/testcase/knowledgeDecision.ts";

test("资料明确的缺口必须回链为需求事实或通用规则", () => {
  const issues = validateKnowledgeDecisionRows(
    [{ id: "MRR-REQ-001", category: "需求覆盖缺口" }],
    [{ findingId: "MRR-REQ-001", scope: "需求事实", target: "REQ-AUTH-001 → RULE-AUTH-001 → AUTH-LOGIN-001", evidenceStatus: "资料已确认", disposition: "已回链" }]
  );
  assert.deepEqual(issues, []);
});

test("质量建议只能作为非断言风险登记", () => {
  const issues = validateKnowledgeDecisionRows(
    [{ id: "MRR-DES-001", category: "质量建议" }],
    [{ findingId: "MRR-DES-001", scope: "未验证推断", target: "当前 plan.md 风险登记", evidenceStatus: "待验证", disposition: "风险登记（非本次验收阻塞）" }]
  );
  assert.deepEqual(issues, []);

  const invalid = validateKnowledgeDecisionRows(
    [{ id: "MRR-DES-001", category: "质量建议" }],
    [{ findingId: "MRR-DES-001", scope: "需求事实", target: "REQ-AUTH-001 → RULE-AUTH-001", evidenceStatus: "资料已确认", disposition: "已回链" }]
  );
  assert.ok(invalid.some((issue) => issue.includes("质量建议")));
});

test("资料冲突只保留为受影响场景的用户裁决", () => {
  const issues = validateKnowledgeDecisionRows(
    [{ id: "MRR-REQ-002", category: "业务裁决/资料冲突" }],
    [{ findingId: "MRR-REQ-002", scope: "未验证推断", target: "当前 plan.md 用户裁决", evidenceStatus: "资料冲突", disposition: "待用户裁决" }]
  );
  assert.deepEqual(issues, []);
});

test("未验证候选只引用本地候选编号，已验证经验可直接引用经验库", () => {
  const valid = validateKnowledgeDecisionRows(
    [],
    [{ findingId: "EXP-CAND-001", scope: "项目经验候选", target: "CAND-1234ABCDEF", evidenceStatus: "待受控探索或正式执行验证", disposition: "待验证" }]
  );
  assert.deepEqual(valid, []);

  const invalid = validateKnowledgeDecisionRows(
    [],
    [{ findingId: "EXP-CAND-001", scope: "项目经验候选", target: "docs/testing/knowledge/lazy-cat-testing-knowledge.md", evidenceStatus: "待受控探索或正式执行验证", disposition: "待验证" }]
  );
  assert.ok(invalid.some((issue) => issue.includes("项目经验候选")));

  const promoted = validateKnowledgeDecisionRows(
    [],
    [{ findingId: "EXP-CAND-002", scope: "项目经验", target: "docs/testing/knowledge/lazy-cat-testing-knowledge.md#定位", evidenceStatus: "受控探索已验证", disposition: "已提升" }]
  );
  assert.deepEqual(promoted, []);
});

test("无发现项且无候选时必须显式声明无", () => {
  assert.deepEqual(
    validateKnowledgeDecisionRows([], [{ findingId: "无", scope: "无", target: "无", evidenceStatus: "无", disposition: "无" }]),
    []
  );
});
