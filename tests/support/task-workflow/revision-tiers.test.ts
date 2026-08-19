import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
  classifyRevisionDiff,
  MAX_SCOPED_CHANGED_CASES,
  REVISION_TIER_SCHEMA_VERSION
} from "../../../src/support/task-workflow/revisionTiers.ts";

const BASE_CASES = [
  "> 共 2 条 ｜ P0 1 条 ｜ 高风险 1 条 ｜ 参数化 1 条",
  "",
  "## 快速索引",
  "",
  "| 模块 | 编号 | 标题 | 优先级 | 风险 |",
  "| --- | --- | --- | --- | --- |",
  "| 产品信息 | OPEN-NAME-001 | 验证名称长度 | P0 | 中 |",
  "| 产品信息 | OPEN-NAME-002 | 验证名称字符 | P1 | 中 |",
  "",
  "## 模块：产品信息",
  "",
  "<details>",
  "<summary>OPEN-NAME-001｜验证名称长度｜P0｜中风险</summary>",
  "",
  "> 规则：RULE-001",
  "> 前置条件：登录态就绪",
  "> 差异：数据策略=no_write；来源=SRC-001",
  "",
  "| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |",
  "| --- | --- | --- | --- | --- |",
  "| D01 | 1 | 输入名称触发校验 | 1 字符 | 校验通过 |",
  "| D02 | 1 | 输入名称触发校验 | 60 字符 | 校验通过 |",
  "",
  "</details>",
  "",
  "<details>",
  "<summary>OPEN-NAME-002｜验证名称字符｜P1｜中风险</summary>",
  "",
  "> 规则：RULE-001",
  "> 前置条件：登录态就绪",
  "> 差异：数据策略=no_write；来源=SRC-001",
  "",
  "| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |",
  "| --- | --- | --- | --- | --- |",
  "| — | 1 | 输入标点触发校验 | 逗号 | 校验拒绝 |",
  "",
  "</details>",
  ""
].join("\n");

const BASE_PLAN = [
  "# 运行意图：示例",
  "",
  "## 需求索引",
  "",
  "| 需求编号 | 描述 | 来源 |",
  "| --- | --- | --- |",
  "| REQ-001 | 名称规则 | SRC-001 |",
  "",
  "## 规则设计台账",
  "",
  "| 规则 | 需求 | 输入 | 预期 | 方法 | caseIds | 门禁 | 状态 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| RULE-001 | REQ-001 | 边界 | 通过/拒绝 | 边界值 | OPEN-NAME-001、OPEN-NAME-002 | no_write | 已覆盖 |",
  "",
  "## 缺口与风险",
  "",
  "| 风险 | 说明 |",
  "| --- | --- |",
  "| 写入风险 | 无 |",
  "",
  "## 正式用户决定",
  "",
  "| 决定类型 | subjectDigest | 正式决定 | 说明 |",
  "| --- | --- | --- | --- |",
  ""
].join("\n");

test("纯格式变化（计数行、空行）分级为 structural", () => {
  const currentCases = BASE_CASES
    .replace("> 共 2 条 ｜ P0 1 条", "> 共 3 条 ｜ P0 1 条")
    .replace("</details>\n\n<details>\n<summary>OPEN-NAME-002", "</details>\n<details>\n<summary>OPEN-NAME-002");
  const result = classifyRevisionDiff(BASE_CASES, currentCases, BASE_PLAN, BASE_PLAN);
  equal(result.schemaVersion, REVISION_TIER_SCHEMA_VERSION);
  equal(result.tier, "structural");
  equal(result.semanticCaseIds.length, 0);
  equal(result.ledgerChanged, false);
});

test("单个用例块语义行变化分级为 scoped", () => {
  const currentCases = BASE_CASES.replace("| D01 | 1 | 输入名称触发校验 | 1 字符 | 校验通过 |",
    "| D01 | 1 | 输入名称触发校验 | 1 字符 | 校验通过并提示可用 |");
  const result = classifyRevisionDiff(BASE_CASES, currentCases, BASE_PLAN, BASE_PLAN);
  equal(result.tier, "scoped");
  equal(result.semanticCaseIds.join(), "OPEN-NAME-001");
});

test("数据策略行变化即使单用例也升级 substantive", () => {
  const currentCases = BASE_CASES.replace(
    "> 差异：数据策略=no_write；来源=SRC-001\n\n| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |\n| --- | --- | --- | --- | --- |\n| — | 1 | 输入标点触发校验",
    "> 差异：数据策略=ephemeral_cleanup；来源=SRC-001\n\n| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |\n| --- | --- | --- | --- | --- |\n| — | 1 | 输入标点触发校验"
  );
  const result = classifyRevisionDiff(BASE_CASES, currentCases, BASE_PLAN, BASE_PLAN);
  equal(result.semanticCaseIds.includes("OPEN-NAME-002"), true);
});

test("规则台账语义列变化且无用户决定覆盖升级 substantive", () => {
  const currentPlan = BASE_PLAN.replace("| RULE-001 | REQ-001 | 边界 | 通过/拒绝 |",
    "| RULE-001 | REQ-001 | 边界与空值 | 通过/拒绝/必填 |");
  const result = classifyRevisionDiff(BASE_CASES, BASE_CASES, BASE_PLAN, currentPlan);
  equal(result.tier, "substantive");
  equal(result.ledgerChanged, true);
});

test("台账变化被新增/替换的正式用户决定覆盖时降为 scoped", () => {
  const currentPlan = BASE_PLAN.replace("| RULE-001 | REQ-001 | 边界 | 通过/拒绝 |",
    "| RULE-001 | REQ-001 | 边界与空值 | 通过/拒绝/必填 |")
    + "| 用例确认 | abc123 | revision_requested | 用户裁决：名称规则按文档字面 |\n";
  const result = classifyRevisionDiff(BASE_CASES, BASE_CASES, BASE_PLAN, currentPlan);
  equal(result.tier, "scoped");
});

test("caseIds 列同步变化不阻断 structural", () => {
  const currentCases = BASE_CASES
    .replace(">| 产品信息 | OPEN-NAME-002 | 验证名称字符 | P1 | 中 |", "")
    .replace(/\n## 模块：产品信息[\s\S]*$/, "\n## 模块：产品信息\n");
  const currentPlan = BASE_PLAN.replace("OPEN-NAME-001、OPEN-NAME-002", "OPEN-NAME-001");
  const result = classifyRevisionDiff(BASE_CASES, currentCases, BASE_PLAN, currentPlan);
  equal(result.ledgerChanged, false);
});

test("超过 scoped 上限的语义用例块数升级 substantive", () => {
  // 构造 MAX+1 个语义变化的用例块：直接对每个 summary 行打标（标题属语义行）。
  const blocks: string[] = [];
  const planRows: string[] = [];
  for (let i = 1; i <= MAX_SCOPED_CHANGED_CASES + 1; i += 1) {
    const id = `OPEN-X-${String(i).padStart(3, "0")}`;
    blocks.push(`<details>\n<summary>${id}｜用例${i}｜P2｜低风险</summary>\n\n> 规则：RULE-001\n> 前置条件：登录态就绪\n> 差异：数据策略=no_write；来源=SRC-001\n\n</details>\n`);
    planRows.push(`| ${id} | 标题${i} | P2 | 低 |`);
  }
  const joiner = (arr: string[]): string => arr.join("\n");
  const casesOf = (revised: boolean): string => joiner([
    `> 共 ${blocks.length} 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 0 条`,
    "", "## 快速索引", "", "| 模块 | 编号 | 标题 | 优先级 | 风险 |", "| --- | --- | --- | --- | --- |",
    ...planRows, "", "## 模块：批量", "",
    ...blocks.map((block) => revised
      ? block.replace(`> 前置条件：登录态就绪`, `> 前置条件：登录态就绪（修订）`)
      : block)
  ]);
  const baseline = casesOf(false);
  const current = casesOf(true);
  // 每个块都相对基线改了前置条件 → MAX+1 个语义块。
  const result = classifyRevisionDiff(baseline, current, BASE_PLAN, BASE_PLAN);
  equal(result.tier, "substantive");
});

test("正式用户决定替换旧行也视为有覆盖", () => {
  const baselinePlanWithDecision = BASE_PLAN.replace(
    "| 决定类型 | subjectDigest | 正式决定 | 说明 |\n| --- | --- | --- | --- |\n",
    "| 决定类型 | subjectDigest | 正式决定 | 说明 |\n| --- | --- | --- | --- |\n| 用例确认 | old-subject | accepted | 旧决定 |\n"
  );
  const currentPlan = BASE_PLAN.replace("| RULE-001 | REQ-001 | 边界 | 通过/拒绝 |",
    "| RULE-001 | REQ-001 | 边界与空值 | 通过/拒绝/必填 |")
    .replace(
      "| 决定类型 | subjectDigest | 正式决定 | 说明 |\n| --- | --- | --- | --- |\n",
      "| 决定类型 | subjectDigest | 正式决定 | 说明 |\n| --- | --- | --- | --- |\n| 用例确认 | new-subject | revision_requested | 用户裁决替换旧决定 |\n"
    );
  const result = classifyRevisionDiff(BASE_CASES, BASE_CASES, baselinePlanWithDecision, currentPlan);
  equal(result.tier, "scoped");
});
