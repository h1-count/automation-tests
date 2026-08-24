import assert from "node:assert/strict";
import test from "node:test";
import {
  collectGapContentLines,
  extractRequirementFacts,
  renderFactsReport,
  type RequirementFact
} from "../../src/support/testcase/requirementFacts.ts";

const MAX_VISIBLE_QUOTE = 164; // 160 + 两侧省略号

const sourceLines = [
  "# 集中管理平台", // 1 标题（跳过）
  "", // 2 空行（跳过）
  "### 1 筛选搜索项：申请日期: 年月日", // 3
  "企业名称支持模糊查询。", // 4
  "驳回原因需要输入，字数控制在100字之内。", // 5 required + limit
  "联系电话为 11 位手机号码。", // 6 format
  "每页显示10条，分页展示，显示总审核数。", // 7 listRule
  "注册管理分为待审核、已审核两个列表。", // 8 enum + state
  "列表以更新时间倒序排列（全局）。", // 9 listRule
  "申请时间格式 yyyy-mm-dd hh:mm:ss。", // 10 format
  "| 序号 | 企业名称 |", // 11 表头保留抽取
  "| --- | --- |", // 12 分隔线（跳过）
  "注册状态为待审核。", // 13 state
  "普通句子没有候选关键词。" // 14
];

test("extractRequirementFacts 按类别逐字抽取并跳过标题/空行/分隔线", () => {
  const facts = extractRequirementFacts(sourceLines, [{ start: 1, end: 14 }]);
  const byLineCategory = new Set(facts.map((fact) => `${fact.line}:${fact.category}`));

  assert.ok(byLineCategory.has("5:required"), "行 5 命中必填");
  assert.ok(byLineCategory.has("5:limit"), "行 5 命中上限");
  assert.ok(byLineCategory.has("6:format"), "行 6 命中格式");
  assert.ok(byLineCategory.has("7:listRule"), "行 7 命中分页");
  assert.ok(byLineCategory.has("8:enum"), "行 8 命中枚举");
  assert.ok(byLineCategory.has("8:state"), "行 8 命中状态");
  assert.ok(byLineCategory.has("10:format"), "行 10 命中格式");
  assert.ok(byLineCategory.has("13:state"), "行 13 命中状态");
  assert.ok(!facts.some((fact) => fact.line === 1 || fact.line === 2 || fact.line === 12), "标题/空行/分隔线跳过");
  assert.ok(!facts.some((fact) => fact.line === 14), "无关键词行不抽取");

  const required = facts.find((fact) => fact.line === 5 && fact.category === "required") as RequirementFact;
  assert.equal(required.quote, "驳回原因需要输入");
  const limit = facts.find((fact) => fact.line === 5 && fact.category === "limit") as RequirementFact;
  assert.equal(limit.quote, "字数控制在100字之内");
});

test("extractRequirementFacts 只在给定区间内抽取", () => {
  const facts = extractRequirementFacts(sourceLines, [{ start: 5, end: 5 }]);
  assert.equal(facts.length, 2);
  assert.ok(facts.every((fact) => fact.line === 5));
});

test("超长句截断并标注", () => {
  const longLine = `前缀${"背景说明".repeat(40)}驳回原因字数控制在100字之内。`;
  const facts = extractRequirementFacts([longLine], [{ start: 1, end: 1 }]);
  const limit = facts.find((fact) => fact.category === "limit");
  assert.ok(limit);
  assert.equal(limit!.truncated, true);
  assert.ok(limit!.quote.length <= MAX_VISIBLE_QUOTE);
});

test("collectGapContentLines 收集间隙内实质内容行", () => {
  const gap = collectGapContentLines(sourceLines, [{ start: 1, end: 3 }, { start: 12, end: 14 }]);
  assert.deepEqual(gap.ranges, [{ start: 1, end: 3 }, { start: 12, end: 14 }]);
  // 行 2 空、行 12 分隔线被过滤；行 1/3 标题保留（章节标题是漏覆盖信号）、13、14 保留
  assert.deepEqual(gap.contentLines.map((item) => item.line), [1, 3, 13, 14]);
});

test("renderFactsReport 渲染候选表与覆盖闭包清单", () => {
  const facts = extractRequirementFacts(sourceLines, [{ start: 5, end: 8 }]);
  const report = renderFactsReport({
    srcId: "SRC-DEMO-001",
    label: "示例来源",
    scopeRanges: [{ start: 5, end: 8 }],
    facts,
    gap: collectGapContentLines(sourceLines, [{ start: 13, end: 14 }])
  });
  assert.match(report, /### SRC-DEMO-001 示例来源/);
  assert.match(report, /零推理/);
  assert.match(report, /\| 5 \| 必填\/必传 \| 驳回原因需要输入 \|/);
  assert.match(report, /覆盖闭包/);
  assert.match(report, /行 13：/);
  assert.match(report, /必须.*显式登记/);
});

test("renderFactsReport 无间隙时输出无间隙结论", () => {
  const report = renderFactsReport({
    srcId: "SRC-DEMO-002",
    label: "示例",
    scopeRanges: [{ start: 5, end: 5 }],
    facts: extractRequirementFacts(sourceLines, [{ start: 5, end: 5 }]),
    gap: { ranges: [], contentLines: [] }
  });
  assert.match(report, /无间隙：scope 行区间全部被 RULE 引用覆盖/);
});
