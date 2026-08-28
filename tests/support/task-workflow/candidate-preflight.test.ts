import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateBaselineCoverageIssues,
  candidateRepairChecklist,
  evaluateCandidatePlanPreflight,
  extractCandidateSourceFacts
} from "../../../src/support/task-workflow/candidatePreflight.ts";

const sha = "a".repeat(64);
const sourceUnits = ["通讯协议选项有 wifi、bluetooth；登录成功后跳转首页。", "产品名称最多 60 个字符。", "当开发方式不同时，设备类型可选项有普通、网关。"];

function sourceDocuments() {
  return new Map([["SRC-LOGIN-001", { kind: "line" as const, units: sourceUnits }]]);
}

function plan(extra = ""): string {
  return `# 测试计划

> 用例格式：testcase-v1-layered。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/demo/login |
| 测试类型 | Web |
| 目标环境 | test |

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

### 包含

- 登录。

## 请求内来源

| 来源 ID | 路径 | SHA-256 | 事实范围 |
| --- | --- | --- | --- |
| SRC-LOGIN-001 | [需求](../../../../sources/demo.txt) | ${sha} | L1-L3 |

## 需求索引

| REQ | 摘要 | 来源 |
| --- | --- | --- |
| REQ-LOGIN-001 | 登录 | SRC-LOGIN-001 |

## 规则设计台账

rule-design-ledger-v1

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-LOGIN-001 | REQ-LOGIN-001 | SRC-LOGIN-001 | 条件 | 预期 | 枚举 | OPEN-LOGIN-001 | no_write | 已覆盖 |

## 显式事实覆盖

| 事实引用 | 处置 | RULE | 理由 |
| --- | --- | --- | --- |
| SRC-LOGIN-001#L1:enum | modeled | RULE-LOGIN-001 | 覆盖通讯协议集合 |
| SRC-LOGIN-001#L2:limit | modeled | RULE-LOGIN-001 | 覆盖名称长度 |
| SRC-LOGIN-001#L3:conditional_enum | modeled | RULE-LOGIN-001 | 覆盖开发方式联动 |

## 编译子约束分解

| 子约束 | RULE | caseId | 来源范围 | 显式事实引用 | 摘要 |
| --- | --- | --- | --- | --- |
| CLAUSE-LOGIN-001 | RULE-LOGIN-001 | OPEN-LOGIN-001 | SRC-LOGIN-001#L1-L3 | SRC-LOGIN-001#L1:enum、SRC-LOGIN-001#L2:limit、SRC-LOGIN-001#L3:conditional_enum | 覆盖字段集合与边界 |

## 需求歧义与未定义预期

无。

## 缺口与风险

无。

## 评审与正式决定

待评审。

${extra}`;
}

function evaluate(value: string, sourceTexts = new Map([["SRC-LOGIN-001", [sourceUnits.join("\n")]]])) {
  return evaluateCandidatePlanPreflight({ plan: value, sourceTexts, sourceDocuments: sourceDocuments() });
}

test("candidate preflight accepts complete explicit fact coverage and exact quotes", () => {
  const report = evaluate(plan("原文：SRC-LOGIN-001「登录成功后跳转首页」"));
  assert.equal(report.complete, true);
  assert.equal(report.sourceFactCount, 3);
  assert.deepEqual(report.factCoverage, { modeled: 3, excluded: 0, ambiguous: 0 });
});

test("candidate preflight blocks an unregistered structured fact", () => {
  const report = evaluate(plan().replace("| SRC-LOGIN-001#L3:conditional_enum | modeled | RULE-LOGIN-001 | 覆盖开发方式联动 |\n", ""));
  assert.equal(report.complete, false);
  assert.ok(report.issues.some((issue) => issue.includes("L3:conditional_enum 未登记")));
  assert.ok(report.repairCategories.includes("rule_ledger"));
});

test("candidate preflight permits only documented excluded or ambiguous facts", () => {
  const excluded = evaluate(plan().replace(
    "| SRC-LOGIN-001#L2:limit | modeled | RULE-LOGIN-001 | 覆盖名称长度 |",
    "| SRC-LOGIN-001#L2:limit | excluded | — | 本轮范围不含名称输入 |"
  ));
  assert.equal(excluded.complete, true);
  const missingReason = evaluate(plan().replace(
    "| SRC-LOGIN-001#L2:limit | modeled | RULE-LOGIN-001 | 覆盖名称长度 |",
    "| SRC-LOGIN-001#L2:limit | excluded | — | — |"
  ));
  assert.equal(missingReason.complete, false);
  assert.ok(missingReason.issues.some((issue) => issue.includes("必须填写可审计理由")));
});

test("candidate preflight rejects illegal fact ranges, unknown facts, cross-source rules, and empty case bindings", () => {
  const illegalRange = evaluate(plan().replace("L1-L3", "P1-P3"));
  assert.ok(illegalRange.issues.some((issue) => issue.includes("非法事实范围")));
  const unknownFact = evaluate(plan().replace("SRC-LOGIN-001#L1:enum", "SRC-LOGIN-001#L9:enum"));
  assert.ok(unknownFact.issues.some((issue) => issue.includes("未知事实")));
  const crossSource = evaluate(plan().replace("SRC-LOGIN-001 | 条件", "SRC-OTHER-001 | 条件"));
  assert.ok(crossSource.issues.some((issue) => issue.includes("跨来源 RULE")));
  const noCase = evaluate(plan().replace("OPEN-LOGIN-001", "—"));
  assert.ok(noCase.issues.some((issue) => issue.includes("缺少冻结 caseId")));
});

test("candidate preflight extracts paragraph-addressed DOCX facts without scanning normal prose", () => {
  const facts = extractCandidateSourceFacts({
    sourceId: "SRC-API-001", kind: "paragraph",
    units: ["普通页面说明。", "ProtocolEnum 包含 wifi、bluetooth。", "当开发方式不同时，设备类型可选项有普通、网关。"],
    ranges: [{ start: 1, end: 3 }]
  });
  assert.deepEqual(facts.map((fact) => fact.reference), ["SRC-API-001#P2:enum", "SRC-API-001#P3:conditional_enum"]);
});

test("candidate preflight addresses extracted PDF facts by page", () => {
  const facts = extractCandidateSourceFacts({
    sourceId: "SRC-HELP-001", kind: "page",
    units: ["普通说明。", "营业执照格式为 PNG、JPEG 或 JPG，文件大小不超过 10MB。"],
    ranges: [{ start: 1, end: 2 }]
  });
  assert.deepEqual(facts.map((fact) => fact.reference), ["SRC-HELP-001#P2:limit"]);
});

test("candidate preflight retains baseline coverage and quote behavior", () => {
  const baseline = `## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-CP-001 | REQ-CP-001 | SRC-CP-001 | 条件 | 预期 | 场景法 | OPEN-WIZ-001 | no_write | 已覆盖 |
| RULE-CP-002 | REQ-CP-002 | SRC-CP-001 | 条件 | 预期 | 场景法 | OPEN-CAT-001、OPEN-CAT-002 | no_write | 已覆盖 |`;
  assert.deepEqual(candidateBaselineCoverageIssues(baseline.replace("OPEN-CAT-001、OPEN-CAT-002", "OPEN-CAT-001"), baseline), ["完整重建规则 RULE-CP-002 不得遗漏稳定用例 OPEN-CAT-002。"]);
  const drift = evaluate(plan("原文：SRC-LOGIN-001「错误文本」"));
  assert.ok(drift.issues.some((issue) => issue.includes("未包含逐字引文")));
});

test("candidate preflight returns the smallest repair checklist", () => {
  assert.deepEqual(candidateRepairChecklist(["SRC-LOGIN-001 未包含逐字引文「错字」。", "RULE-LOGIN-001 缺少 sourceRef。", "plan.md 缺少 ## 测试范围。"]), [
    { category: "plan_structure", issues: ["plan.md 缺少 ## 测试范围。"] },
    { category: "rule_ledger", issues: ["RULE-LOGIN-001 缺少 sourceRef。"] },
    { category: "source_quote", issues: ["SRC-LOGIN-001 未包含逐字引文「错字」。"] }
  ]);
});

test("candidate preflight rejects missing, duplicate, cross-source, and invalid clause allocation", () => {
  const missing = evaluate(plan().replace(/^\| CLAUSE-LOGIN-001[^\n]+\n/mu, ""));
  assert.ok(missing.issues.some((issue) => issue.includes("未覆盖冻结关系 RULE-LOGIN-001 → OPEN-LOGIN-001")));
  const duplicate = evaluate(plan().replace("| CLAUSE-LOGIN-001 |", "| CLAUSE-LOGIN-001 |\n| CLAUSE-LOGIN-001 |"));
  assert.ok(duplicate.issues.some((issue) => issue.includes("必须唯一")));
  const crossSource = evaluate(plan().replace("SRC-LOGIN-001#L1-L3", "SRC-OTHER-001#L1"));
  assert.ok(crossSource.issues.some((issue) => issue.includes("不得跨来源")));
  const invalidCase = evaluate(plan().replace("OPEN-LOGIN-001 | SRC-LOGIN-001#L1-L3", "OPEN-LOGIN-999 | SRC-LOGIN-001#L1-L3"));
  assert.ok(invalidCase.issues.some((issue) => issue.includes("caseId 必须属于冻结")));
});
