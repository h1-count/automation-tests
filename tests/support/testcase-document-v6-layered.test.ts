import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_TESTCASE_DOCUMENT_VERSION,
  isCurrentTestcaseDocumentVersion,
  isStructuredTestcaseDocumentVersion,
  parseTestcaseDocument,
  projectTestcaseV6DerivedView,
  projectTestcaseV6Rules,
  testcaseV6LayeredSemanticProjection,
  validateTestcaseV6Layered
} from "../../src/support/testcase/testcaseDocument.js";
import { buildTestcaseReviewModel } from "../../src/support/testcase/testcaseReviewModel.js";

const digest = "a".repeat(64);

function layeredCases(): string {
  return `> 结构版本：testcase-v6-layered。

# 用例集：开放平台创建产品

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 2 条 ｜ P0 2 条 ｜ 高风险 1 条 ｜ 参数化 1 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 产品创建 | OPEN-PRODUCT-001 | 验证创建入口 | P0 | 低 |
| 产品创建 | OPEN-PRODUCT-002 | 验证名称拒绝非法值 | P0 | 高 |

## 模块：产品创建

<details open>
<summary>OPEN-PRODUCT-001｜验证创建入口｜P0｜低风险</summary>

> 规则：RULE-PRODUCT-001
> 前置条件：已进入产品开发首页

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 点击“创建产品” | 无 | 进入创建流程 |

</details>

<details>
<summary>OPEN-PRODUCT-002｜验证名称拒绝非法值｜P0｜高风险</summary>

> 规则：RULE-PRODUCT-002
> 前置条件：已进入完善信息页
> 差异：环境=pre；数据策略=ephemeral_cleanup；来源=SRC-PRODUCT-003

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| D01 | 1 | 输入名称并触发校验 | 空值 | 提示必填 |
| D02 | 1 | 输入名称并触发校验 | 61 个合法字符 | 提示长度超限 |

</details>
`;
}

function plan(): string {
  return `## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-PRODUCT-001 | REQ-PRODUCT-001 | SRC-PRODUCT-001；入口 | 点击入口 | 进入流程 | 场景法 | OPEN-PRODUCT-001 | no_write | 已覆盖 |
| RULE-PRODUCT-002 | REQ-PRODUCT-002 | SRC-PRODUCT-002；校验 | 输入名称 | 显示校验 | 边界值 | OPEN-PRODUCT-002 | ephemeral_cleanup | 已覆盖 |
`;
}

test("only testcase-v6-layered is parseable while archived formats are unsupported", () => {
  assert.equal(CURRENT_TESTCASE_DOCUMENT_VERSION, "testcase-v6-layered");
  assert.equal(isCurrentTestcaseDocumentVersion("testcase-v6-layered"), true);
  assert.equal(parseTestcaseDocument("> 结构版本：testcase-v4。").version, "unsupported");
  assert.equal(parseTestcaseDocument("> 结构版本：testcase-v5-flat。").version, "unsupported");
  assert.equal(isStructuredTestcaseDocumentVersion("unsupported"), false);
});

test("testcase-v6-layered parses index, details, parameter data, and effective governance", () => {
  const document = parseTestcaseDocument(layeredCases());
  assert.equal(document.version, "testcase-v6-layered");
  assert.deepEqual(document.defaults, {
    testType: "Web",
    environment: "test",
    dataStrategy: "no_write"
  });
  assert.equal(document.reviewIndex.length, 2);
  assert.equal(document.cases.length, 2);
  assert.equal(document.cases[1]?.dataInstances.length, 2);
  assert.deepEqual(document.cases[1]?.overrides, {
    environment: "pre",
    dataStrategy: "ephemeral_cleanup",
    sourceRefs: ["SRC-PRODUCT-003"],
    risk: "高"
  });
  assert.deepEqual(validateTestcaseV6Layered(layeredCases()), []);
});

test("testcase-v6-layered rejects inconsistent views and invalid execution contracts", () => {
  const invalid = layeredCases()
    .replace("| 产品创建 | OPEN-PRODUCT-001 | 验证创建入口 | P0 | 低 |", "")
    .replace("| D02 | 1 | 输入名称并触发校验 | 61 个合法字符 | 提示长度超限 |", "| D02 | 2 | 创建产品，然后查询结果 |  |  |")
    .replace("环境=pre", "风险=高");
  const issues = validateTestcaseV6Layered(invalid);
  assert.ok(issues.some((issue) => issue.includes("快速索引与折叠用例详情不一致")));
  assert.ok(issues.some((issue) => issue.includes("差异字段无效")));
  assert.ok(issues.some((issue) => issue.includes("步骤集合")));
  assert.ok(issues.some((issue) => issue.includes("聚合了多个业务动作")));
  assert.ok(issues.some((issue) => issue.includes("缺少测试数据")));
  assert.ok(issues.some((issue) => issue.includes("缺少预期结果")));
});

test("v6 derived view and RULE projection are deterministic and excluded from semantic digest", () => {
  const source = layeredCases();
  const inconsistent = source.replace("| 产品创建 | OPEN-PRODUCT-001 | 验证创建入口 | P0 | 低 |", "");
  assert.equal(projectTestcaseV6DerivedView(inconsistent), source);
  const projected = projectTestcaseV6Rules(source, new Map([
    ["OPEN-PRODUCT-001", ["RULE-PRODUCT-101"]],
    ["OPEN-PRODUCT-002", ["RULE-PRODUCT-102"]]
  ]));
  assert.deepEqual(parseTestcaseDocument(projected).cases.map((item) => item.ruleIds), [
    ["RULE-PRODUCT-101"],
    ["RULE-PRODUCT-102"]
  ]);
  assert.equal(
    testcaseV6LayeredSemanticProjection(inconsistent),
    testcaseV6LayeredSemanticProjection(source)
  );
  assert.notEqual(
    testcaseV6LayeredSemanticProjection(source.replace("提示长度超限", "允许通过")),
    testcaseV6LayeredSemanticProjection(source)
  );
});

test("review model resolves RULE sources once per parent testcase", () => {
  const model = buildTestcaseReviewModel({
    requestId: "web/open-platform/product-create",
    plan: plan(),
    cases: layeredCases(),
    callbackSubjectDigest: digest
  });
  assert.equal(model.schema, "testcase-review-model-v1");
  assert.equal(model.statistics.caseCount, 2);
  assert.equal(model.statistics.parameterizedCount, 1);
  assert.deepEqual(model.modules[0]?.cases[0]?.sourceRefs, ["SRC-PRODUCT-001"]);
  assert.deepEqual(model.modules[0]?.cases[1]?.sourceRefs, ["SRC-PRODUCT-002", "SRC-PRODUCT-003"]);
  assert.equal(model.callbackSubjectDigest, digest);
  assert.match(model.semanticDigest, /^[a-f0-9]{64}$/u);
});

test("review model refuses stale or malformed callback digests", () => {
  assert.throws(() => buildTestcaseReviewModel({
    requestId: "web/open-platform/product-create",
    plan: plan(),
    cases: layeredCases(),
    callbackSubjectDigest: "stale"
  }), /callbackSubjectDigest/u);
});
