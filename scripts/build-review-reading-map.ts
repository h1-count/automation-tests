/**
 * reviewer 定向读取图 CLI：从套件 design.md 生成必读区间、交叉对照配对与覆盖预警。
 *
 * 用法：
 *   npx tsx scripts/build-review-reading-map.ts --design <套件 design.md>
 *     [--only-rules RULE-A,RULE-B]（定向复审批次只读入选 RULE）
 *     [--out <path>]（缺省输出到 stdout）
 *
 * 退出码：0 成功；2 参数/解析失败。产物是读取指导，不改变评审快照契约。
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildReadingMap,
  parseReqSourceRefs,
  parseRuleSourceRefs,
  parseSourceRegistrations,
  renderReadingMapMd
} from "../src/support/testcase/reviewReadingMap.ts";

function required(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) {
    console.error(`缺少参数 ${name}`);
    process.exit(2);
  }
  return args[index + 1]!;
}

const args = process.argv.slice(2);
const designPath = required(args, "--design");
const designMd = await readFile(resolve(designPath), "utf8");

const sources = parseSourceRegistrations(designMd);
const rules = parseRuleSourceRefs(designMd);
const reqs = parseReqSourceRefs(designMd);
if (sources.length === 0) {
  console.error("design.md 未解析到任何来源登记行（SRC-*）");
  process.exit(2);
}
if (rules.length === 0) {
  console.error("design.md 未解析到任何规则台账行（RULE-*）");
  process.exit(2);
}

const onlyRuleIds = args.includes("--only-rules")
  ? required(args, "--only-rules").split(",").map((item) => item.trim()).filter(Boolean)
  : undefined;
if (onlyRuleIds) {
  const known = new Set(rules.map((rule) => rule.ruleId));
  const unknown = onlyRuleIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.error(`未知 RULE：${unknown.join("、")}`);
    process.exit(2);
  }
}

const map = buildReadingMap({ sources, rules, reqs, onlyRuleIds });
const markdown = renderReadingMapMd(map);

if (args.includes("--out")) {
  const outPath = required(args, "--out");
  await writeFile(resolve(outPath), markdown, "utf8");
  console.log(JSON.stringify({
    sources: map.sources.length,
    rules: onlyRuleIds?.length ?? rules.length,
    crossCheckPairs: map.crossCheckPairs.length,
    uncoveredReqWarnings: map.uncoveredReqWarnings.length,
    out: outPath
  }, null, 2));
} else {
  process.stdout.write(markdown);
}
