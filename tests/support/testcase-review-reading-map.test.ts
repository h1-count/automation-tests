import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadingMap,
  formatRanges,
  normalizeRanges,
  parseLineRefs,
  parseRuleSourceRefs,
  parseSourceRegistrations,
  rangesCrossCheck,
  renderReadingMapMd,
  subtractRanges
} from "../../src/support/testcase/reviewReadingMap.ts";

const designMd = [
  "# 套件设计台账：示例",
  "",
  "## 请求内来源",
  "",
  "| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |",
  "| --- | --- | --- | --- |",
  "| SRC-RR-001 | [需求主文档](../../sources/demo/需求主文档.md)「统一说明」（行 54-65）「注册审核」（行 66-173） | v1 / `abc` | 唯一业务需求主源 |",
  "| SRC-RR-002 | [导航文档](../../sources/demo/导航.md) 导航结构（行 45-51） | unknown / `def` | 菜单定位 |",
  "",
  "## 需求索引",
  "",
  "| REQ | sourceRef | 可验证需求 | 适用性 |",
  "| --- | --- | --- | --- |",
  "| REQ-OV-001 | SRC-RR-001；行 70-72 | 概览展示 | 适用 |",
  "| REQ-ZZ-001 | SRC-RR-001；行 300-310 | 未覆盖段 | 适用 |",
  "",
  "## 规则设计台账",
  "",
  "| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| RULE-OV-001 | REQ-OV-001 | SRC-RR-001；行 70-72 | 查看概览 | 三统计项展示 | 场景法 | DEMO-LST-001 | no_write | 已覆盖 |",
  "| RULE-LST-004 | REQ-LST-004 | SRC-RR-001；行 60、104-107 | 翻页 | 每页 10 条 | 边界值 | DEMO-LST-006 | no_write | 已覆盖 |",
  "| RULE-PND-001 | REQ-PND-001 | SRC-RR-001；行 82-107 | 查看列表 | 表头字段 | 场景法 | DEMO-PND-001 | no_write | 已覆盖 |",
  "| RULE-NAV-001 | REQ-NAV-001 | SRC-RR-002；行 45-51 | 导航定位 | 菜单可达 | 场景法 | DEMO-LST-002 | no_write | 已覆盖 |",
  ""
].join("\n");

test("parseLineRefs 解析混合行引用并归一化", () => {
  assert.deepEqual(parseLineRefs("行 60、104-107 与 行 12"), [
    { start: 12, end: 12 },
    { start: 60, end: 60 },
    { start: 104, end: 107 }
  ]);
  assert.deepEqual(parseLineRefs("无引用"), []);
});

test("normalizeRanges 合并相邻与重叠区间", () => {
  assert.deepEqual(
    normalizeRanges([{ start: 5, end: 7 }, { start: 8, end: 10 }, { start: 2, end: 3 }]),
    [{ start: 2, end: 3 }, { start: 5, end: 10 }]
  );
});

test("subtractRanges 求差集并保留间隙", () => {
  assert.deepEqual(
    subtractRanges([{ start: 54, end: 173 }], [{ start: 60, end: 72 }, { start: 100, end: 110 }]),
    [{ start: 54, end: 59 }, { start: 73, end: 99 }, { start: 111, end: 173 }]
  );
});

test("rangesCrossCheck 判定重叠与邻近", () => {
  assert.equal(rangesCrossCheck({ start: 58, end: 58 }, { start: 58, end: 58 }), true);
  assert.equal(rangesCrossCheck({ start: 60, end: 60 }, { start: 63, end: 63 }), true, "端点距离 3 视为相邻");
  assert.equal(rangesCrossCheck({ start: 60, end: 60 }, { start: 70, end: 70 }), false);
});

test("parseSourceRegistrations 提取来源与 scope 区间", () => {
  const sources = parseSourceRegistrations(designMd);
  assert.equal(sources.length, 2);
  assert.equal(sources[0]!.srcId, "SRC-RR-001");
  assert.equal(sources[0]!.relativePath, "../../sources/demo/需求主文档.md");
  assert.deepEqual(sources[0]!.scopeRanges, [{ start: 54, end: 173 }], "相邻区间 54-65/66-173 归一化合并为 54-173");
});

test("parseRuleSourceRefs 提取 RULE 行引用", () => {
  const rules = parseRuleSourceRefs(designMd);
  assert.equal(rules.length, 4);
  const lst = rules.find((rule) => rule.ruleId === "RULE-LST-004");
  assert.ok(lst);
  assert.deepEqual(lst.refs[0]!.ranges, [{ start: 60, end: 60 }, { start: 104, end: 107 }]);
});

test("buildReadingMap 派生必读/可选/交叉对照与覆盖预警", () => {
  const map = buildReadingMap({
    sources: parseSourceRegistrations(designMd),
    rules: parseRuleSourceRefs(designMd),
    reqs: [
      { reqId: "REQ-OV-001", refs: [{ srcId: "SRC-RR-001", ranges: [{ start: 70, end: 72 }] }] },
      { reqId: "REQ-ZZ-001", refs: [{ srcId: "SRC-RR-001", ranges: [{ start: 300, end: 310 }] }] }
    ]
  });
  const main = map.sources.find((source) => source.srcId === "SRC-RR-001")!;
  // 必读 = 60、70-72、82-107 的并集 → 60 + 70-72 + 82-107
  assert.deepEqual(main.mustReadRanges, [{ start: 60, end: 60 }, { start: 70, end: 72 }, { start: 82, end: 107 }]);
  // scope 54-173 减必读 → 54-59、61-69、73-81、108-173
  assert.deepEqual(main.optionalGapRanges, [
    { start: 54, end: 59 },
    { start: 61, end: 69 },
    { start: 73, end: 81 },
    { start: 108, end: 173 }
  ]);
  // LST-004(104-107) 与 PND-001(82-107) 重叠 → 交叉对照配对
  const pair = map.crossCheckPairs.find((item) =>
    (item.left === "RULE-LST-004" && item.right === "RULE-PND-001")
      || (item.left === "RULE-PND-001" && item.right === "RULE-LST-004"));
  assert.ok(pair, "LST-004 与 PND-001 引用重叠必须配对");
  assert.equal(formatRanges(pair.ranges), "行 60、行 82-107", "对照区间取两侧引用并集（60 与 104-107 是 LST-004 的全部引用）");
  // REQ-ZZ-001（行 300-310）无 RULE 覆盖 → 预警
  assert.equal(map.uncoveredReqWarnings.length, 1);
  assert.match(map.uncoveredReqWarnings[0]!, /REQ-ZZ-001/);
});

test("buildReadingMap 定向模式只统计入选 RULE", () => {
  const map = buildReadingMap({
    sources: parseSourceRegistrations(designMd),
    rules: parseRuleSourceRefs(designMd),
    onlyRuleIds: ["RULE-LST-004"]
  });
  const main = map.sources.find((source) => source.srcId === "SRC-RR-001")!;
  assert.deepEqual(main.mustReadRanges, [{ start: 60, end: 60 }, { start: 104, end: 107 }]);
  assert.equal(map.crossCheckPairs.length, 0);
});

test("renderReadingMapMd 渲染各节且含回退声明", () => {
  const map = buildReadingMap({
    sources: parseSourceRegistrations(designMd),
    rules: parseRuleSourceRefs(designMd)
  });
  const markdown = renderReadingMapMd(map);
  assert.match(markdown, /# reviewer 定向读取图/);
  assert.match(markdown, /必须回退读取来源全文/);
  assert.match(markdown, /SRC-RR-001 \| 需求主文档 \|/);
  assert.match(markdown, /交叉对照配对/);
});
