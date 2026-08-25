import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRepairChecklist,
  evaluateCandidatePlanPreflight
} from "../../../src/support/task-workflow/candidatePreflight.ts";

const sha = "a".repeat(64);

function plan(extra = ""): string {
  return `# 测试计划

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

登录。

## 请求内来源

| 来源 ID | 路径 | SHA-256 |
| --- | --- | --- |
| SRC-LOGIN-001 | [需求](../../../../sources/demo.txt) | ${sha} |

## 需求索引

| ID | 来源 |
| --- | --- |
| REQ-LOGIN-001 | SRC-LOGIN-001 |

## 规则设计台账

rule-design-ledger-v3

| ID | 描述 | sourceRef |
| --- | --- | --- |
| RULE-LOGIN-001 | 登录成功 | SRC-LOGIN-001 |

## 需求歧义与未定义预期

无。

## 缺口与风险

无。

## 评审与正式决定

待评审。

${extra}`;
}

test("candidate preflight accepts a complete plan and exact explicit source quote", () => {
  const report = evaluateCandidatePlanPreflight({
    plan: plan("原文：SRC-LOGIN-001「登录成功后跳转首页」"),
    sourceTexts: new Map([["SRC-LOGIN-001", ["用户登录成功后跳转首页。"]]])
  });
  assert.equal(report.complete, true);
  assert.equal(report.explicitQuotes.length, 1);
});

test("candidate preflight blocks defaults, source registration and ledger drift", () => {
  const report = evaluateCandidatePlanPreflight({
    plan: plan().replace("| 数据策略 | no_write |", "| 数据策略 | write_everywhere |")
      .replace(sha, "abc")
      .replace("SRC-LOGIN-001 |\n\n## 需求歧义", "SRC-MISSING |\n\n## 需求歧义")
      .replace("rule-design-ledger-v3", "rule-design-ledger-v2"),
    sourceTexts: new Map()
  });
  assert.equal(report.complete, false);
  assert.ok(report.issues.some((issue) => issue.includes("数据策略不受支持")));
  assert.ok(report.issues.some((issue) => issue.includes("SHA-256")));
  assert.ok(report.issues.some((issue) => issue.includes("未登记来源")));
  assert.ok(report.issues.some((issue) => issue.includes("不支持规则台账契约")));
  assert.deepEqual(report.repairCategories, ["plan_structure", "rule_ledger", "source_registration"]);
});

test("candidate preflight only returns the smallest categorized repair checklist", () => {
  assert.deepEqual(candidateRepairChecklist([
    "SRC-LOGIN-001 未包含逐字引文「错字」。",
    "RULE-LOGIN-001 缺少 sourceRef。",
    "plan.md 缺少 ## 测试范围。"
  ]), [
    { category: "plan_structure", issues: ["plan.md 缺少 ## 测试范围。"] },
    { category: "rule_ledger", issues: ["RULE-LOGIN-001 缺少 sourceRef。"] },
    { category: "source_quote", issues: ["SRC-LOGIN-001 未包含逐字引文「错字」。"] }
  ]);
});

test("candidate preflight only scans 原文：SRC-ID「逐字文本」 markers", () => {
  const ordinary = evaluateCandidatePlanPreflight({
    plan: plan("页面文案「登录成功后跳转首页」不属于逐字引文。"),
    sourceTexts: new Map()
  });
  assert.equal(ordinary.complete, true);
  const drift = evaluateCandidatePlanPreflight({
    plan: plan("原文：SRC-LOGIN-001「登录失败后跳转首页」"),
    sourceTexts: new Map([["SRC-LOGIN-001", ["用户登录成功后跳转首页。"]]])
  });
  assert.equal(drift.complete, false);
  assert.ok(drift.issues.some((issue) => issue.includes("未包含逐字引文")));
  const unreadable = evaluateCandidatePlanPreflight({
    plan: plan("原文：SRC-LOGIN-001「登录成功后跳转首页」"),
    sourceTexts: new Map()
  });
  assert.equal(unreadable.complete, false);
  assert.ok(unreadable.issues.some((issue) => issue.includes("没有可校验")));
});
