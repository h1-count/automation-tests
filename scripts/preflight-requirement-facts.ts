/**
 * 需求事实预提取 CLI：对受控来源做确定性候选事实抽取 + 行覆盖闭包审计。
 *
 * 用法（design 模式，推荐——自动解析来源登记与 RULE 引用）：
 *   npx tsx scripts/preflight-requirement-facts.ts --design <套件 design.md>
 *     [--categories limit,required,format,listRule,enum,state]
 *     [--out <path>]（缺省 stdout）
 *
 * 用法（source 模式，无 design 台账时直接抽区间）：
 *   npx tsx scripts/preflight-requirement-facts.ts --source <file.md> --lines 54-173 [--out <path>]
 *
 * 退出码：0 成功；2 参数/解析失败。产物为零推理候选表与审计清单，进入骨架阶段校对。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildReadingMap,
  formatRanges,
  parseReqSourceRefs,
  parseRuleSourceRefs,
  parseSourceRegistrations
} from "../src/support/testcase/reviewReadingMap.ts";
import {
  collectGapContentLines,
  extractRequirementFacts,
  renderFactsReport,
  type FactCategory
} from "../src/support/testcase/requirementFacts.ts";

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const designPath = argValue(args, "--design");
const sourcePath = argValue(args, "--source");
if (!designPath && !sourcePath) {
  console.error("需要 --design <design.md> 或 --source <file.md> --lines <a-b,c-d>");
  process.exit(2);
}

const VALID_CATEGORIES: FactCategory[] = ["limit", "required", "format", "listRule", "enum", "state"];
const categoryArg = argValue(args, "--categories")?.split(",").map((item) => item.trim()).filter(Boolean);
let categories: FactCategory[] | undefined;
if (categoryArg) {
  const invalid = categoryArg.filter((item) => !VALID_CATEGORIES.includes(item as FactCategory));
  if (invalid.length > 0) {
    console.error(`未知类别：${invalid.join("、")}（可选：${VALID_CATEGORIES.join(",")}）`);
    process.exit(2);
  }
  categories = categoryArg as FactCategory[];
}

const sections: string[] = [];
let summary: Record<string, unknown>;

if (designPath) {
  const designMd = await readFile(resolve(designPath), "utf8");
  const sources = parseSourceRegistrations(designMd);
  const rules = parseRuleSourceRefs(designMd);
  const reqs = parseReqSourceRefs(designMd);
  if (sources.length === 0 || rules.length === 0) {
    console.error("design.md 未解析出来源登记或规则台账行");
    process.exit(2);
  }
  const map = buildReadingMap({ sources, rules, reqs });
  const baseDir = dirname(resolve(designPath));
  let totalFacts = 0;
  let gapContentLines = 0;
  for (const source of map.sources) {
    const absolutePath = resolve(baseDir, source.relativePath);
    let lines: string[] = [];
    try {
      lines = (await readFile(absolutePath, "utf8")).split("\n");
    } catch {
      sections.push(`### ${source.srcId} ${source.label}`, "", `- 来源文件不可读：${source.relativePath}，跳过事实抽取。`, "");
      continue;
    }
    const scopeRanges = source.scopeRanges.length > 0 ? source.scopeRanges : [{ start: 1, end: lines.length }];
    const facts = extractRequirementFacts(lines, scopeRanges);
    const gap = collectGapContentLines(lines, source.optionalGapRanges);
    totalFacts += facts.length;
    gapContentLines += gap.contentLines.length;
    sections.push(renderFactsReport({
      srcId: source.srcId,
      label: source.label,
      scopeRanges,
      facts,
      gap,
      categories
    }));
  }
  for (const warning of map.uncoveredReqWarnings) {
    sections.push(`- 覆盖预警：${warning}`, "");
  }
  summary = {
    mode: "design",
    design: designPath,
    sources: map.sources.length,
    crossCheckPairs: map.crossCheckPairs.length,
    totalFacts,
    gapContentLines,
    uncoveredReqWarnings: map.uncoveredReqWarnings.length
  };
} else {
  const lines = (await readFile(resolve(sourcePath!), "utf8")).split("\n");
  const rangeArg = argValue(args, "--lines") ?? `1-${lines.length}`;
  const ranges = rangeArg.split(/[，,]/).map((part) => {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return null;
    return { start: Number(match[1]), end: match[2] === undefined ? Number(match[1]) : Number(match[2]) };
  }).filter((range): range is { start: number; end: number } => range !== null);
  if (ranges.length === 0) {
    console.error(`--lines 格式非法：${rangeArg}`);
    process.exit(2);
  }
  const facts = extractRequirementFacts(lines, ranges);
  sections.push(renderFactsReport({
    srcId: "SOURCE",
    label: sourcePath!,
    scopeRanges: ranges,
    facts,
    gap: { ranges: [], contentLines: [] },
    categories
  }));
  summary = { mode: "source", source: sourcePath, lines: formatRanges(ranges), facts: facts.length };
}

const report = [`# 需求事实预提取与覆盖闭包审计`, "", ...sections].join("\n");
if (args.includes("--out")) {
  const outPath = argValue(args, "--out")!;
  await writeFile(resolve(outPath), report, "utf8");
  console.log(JSON.stringify({ ...summary, out: outPath }, null, 2));
} else {
  process.stdout.write(report);
  process.stderr.write(`${JSON.stringify(summary)}\n`);
}
