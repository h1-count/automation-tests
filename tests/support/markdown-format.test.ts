import assert from "node:assert/strict";
import test from "node:test";
import { inspectMarkdownFormat, repairMarkdownSeparators } from "../../scripts/markdown-format.ts";

test("表头与分隔行列数不一致会失败，并可确定性修复分隔行", () => {
  const malformed = ["| A | B | C |", "| --- | --- |", "| 1 | 2 | 3 |"].join("\n");
  const issues = inspectMarkdownFormat(malformed);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.repairable, true);
  const repaired = repairMarkdownSeparators(malformed);
  assert.deepEqual(repaired.repairedLines, [2]);
  assert.equal(repaired.issues.length, 0);
  assert.match(repaired.content, /^\| --- \| --- \| --- \|$/m);
});

test("数据行列数不一致只报告，不擅自改写业务内容", () => {
  const malformed = ["| A | B |", "| --- | --- |", "| 1 | 2 | 3 |"].join("\n");
  const repaired = repairMarkdownSeparators(malformed);
  assert.equal(repaired.repairedLines.length, 0);
  assert.equal(repaired.issues.length, 1);
  assert.equal(repaired.issues[0]?.repairable, false);
});
