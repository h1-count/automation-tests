import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReviewReadiness } from "../../../src/support/task-workflow/reviewReadiness.js";

const sha = "a".repeat(64);

function plan(): string {
  return `> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。
> 用例格式：testcase-v1-layered。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/demo/request |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

- 页面展示。

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-DEMO-001 | [需求](/tmp/demo.pdf)；第 1 页 | ${sha} | 页面规则 |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-DEMO-001 | SRC-DEMO-001 | 展示欢迎信息 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001 | 打开页面 | 展示欢迎信息 | 场景法 | DEMO-MAIN-001 | no_write | 已覆盖 |

## 需求歧义与未定义预期

- 无。

## 缺口与风险

- 无。

## 评审与正式决定

| 类型 | subjectDigest / 输入摘要 | 结论或决定 | 说明 |
| --- | --- | --- | --- |
`;
}

function cases(strategy = "no_write", details = ""): string {
  return `> 结构版本：testcase-v1-layered。

# 用例集：Demo

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：${strategy}
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 1 条 ｜ 高风险 0 条 ｜ 参数化 0 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 页面 | DEMO-MAIN-001 | 验证欢迎信息 | P0 | 低 |

## 模块：页面

<details open>
<summary>DEMO-MAIN-001｜验证欢迎信息｜P0｜低风险</summary>

> 规则：RULE-DEMO-001
> 前置条件：页面可访问

${details}
| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 打开页面 | 无 | 展示欢迎信息 |

</details>
`;
}

test("review readiness closes current structure, relation and completeness checks", () => {
  const report = evaluateReviewReadiness({
    plan: plan(),
    packages: { "cases.md": cases() },
    writesData: false
  });
  assert.equal(report.complete, true, report.issues.join("\n"));
  assert.deepEqual(report.counts, { requirements: 1, rules: 1, cases: 1, packages: 1 });
  assert.match(report.digest, /^[a-f0-9]{64}$/u);
});

test("review readiness accepts a stable suite design without request-local review records", () => {
  const stableDesign = plan().replace(/\n## 评审与正式决定[\s\S]*?\n\| --- \| --- \| --- \| --- \|\n$/u, "\n");
  const report = evaluateReviewReadiness({
    plan: stableDesign,
    packages: { "cases.md": cases() },
    writesData: false
  });
  assert.equal(report.complete, true, report.issues.join("\n"));
});

test("review readiness hard-fails unsupported testcase and rule formats", () => {
  const report = evaluateReviewReadiness({
    plan: plan().replace("rule-design-ledger-v1", "unsupported-version"),
    packages: { "cases.md": cases().replace("testcase-v1-layered", "testcase-v1") },
    writesData: false
  });
  assert.equal(report.complete, false);
  assert.ok(report.issues.some((issue) => issue.includes("rule-design-ledger-v1")));
  assert.ok(report.issues.some((issue) => issue.includes("unsupported formats")));
});

test("write readiness reports all safety warnings together", () => {
  const report = evaluateReviewReadiness({
    plan: plan(),
    packages: { "cases.md": cases("ephemeral_cleanup") },
    writesData: true
  });
  assert.equal(report.warnings.length, 3);
  assert.ok(report.warnings.some((warning) => warning.includes("执行清单")));
  assert.ok(report.warnings.some((warning) => warning.includes("cleanup")));
  assert.ok(report.warnings.some((warning) => warning.includes("核对")));
});
