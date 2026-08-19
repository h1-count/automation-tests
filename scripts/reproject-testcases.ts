import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseTestcaseDocument,
  projectTestcaseV6DerivedView,
  validateTestcaseV6Layered
} from "../src/support/testcase/testcaseDocument.js";

/**
 * 结构修复重投影（确定性、可审查）：
 * 1. 派生区（统计行 + 快速索引）由 projectTestcaseV6DerivedView 从用例体重derive；
 * 2. 折叠用例块按快速索引声明的模块归属归位（r2 实测 R3-F-02 类错位）；
 * 3. 产物必须通过 validateTestcaseV6Layered（含派生视图漂移检查）才落盘。
 * 用法：npx tsx scripts/reproject-testcases.ts <cases.md 路径> [--dry-run]
 */

const detailsBlock = /<details(?:\s+open)?>[\s\S]*?<\/details>/gu;
const summaryCaseId = /<summary>\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)/u;
const moduleHeader = /^##\s+模块[：:]\s*(.+)$/mu;

function option(args: string[], name: string): boolean {
  return args.includes(name);
}

function reproject(value: string): {
  result: string;
  relocated: string[];
  countsRefreshed: boolean;
} {
  // 模块归属的声明意图只存在于「原始快速索引」（reviewIndex）：解析器为正文块
  // 赋 module 时依据的是所在段头，先投影会用正文所在段重derive 索引、销毁意图。
  // 因此以原始索引行做归位依据，最后再重投影派生区。
  const originalDocument = parseTestcaseDocument(value);
  const indexModuleByCase = new Map(
    originalDocument.reviewIndex.map((row) => [row.caseId, row.module])
  );
  const indexOrder = new Map(
    originalDocument.reviewIndex.map((row, index) => [row.caseId, index])
  );
  const projected = projectTestcaseV6DerivedView(value);
  const countsRefreshed = projected !== value;
  const modulesRegionStart = projected.search(/^##\s+模块[：:]/mu);
  if (modulesRegionStart < 0) {
    return { result: projected, relocated: [], countsRefreshed };
  }
  const head = projected.slice(0, modulesRegionStart);
  const modulesRegion = projected.slice(modulesRegionStart);

  const sectionMatches = [...modulesRegion.matchAll(/^##\s+模块[：:]\s*(.+)$/gmu)];
  const sections = sectionMatches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < sectionMatches.length
      ? sectionMatches[index + 1]?.index ?? modulesRegion.length
      : modulesRegion.length;
    const header = match[0];
    const moduleName = (match[1] ?? "").trim();
    const body = modulesRegion.slice(start + header.length, end);
    const blocks: string[] = body.match(detailsBlock) ?? [];
    const remainder = blocks.reduce((acc, block) => acc.replace(block, ""), body).trim();
    return { header, moduleName, remainder, blocks };
  });

  const relocated: string[] = [];
  const blockByCase = new Map<string, string>();
  for (const section of sections) {
    for (const block of section.blocks) {
      const caseId = summaryCaseId.exec(block)?.[1];
      if (caseId) blockByCase.set(caseId, block);
    }
  }
  for (const section of sections) {
    const remaining: string[] = [];
    for (const block of section.blocks) {
      const caseId = summaryCaseId.exec(block)?.[1];
      const expected = caseId ? indexModuleByCase.get(caseId) : undefined;
      if (expected && expected !== section.moduleName) {
        relocated.push(caseId ?? "unknown");
      } else {
        remaining.push(block);
      }
    }
    section.blocks = remaining;
  }
  for (const [caseId, block] of blockByCase) {
    const expected = indexModuleByCase.get(caseId);
    const section = sections.find((item) => item.moduleName === expected);
    if (section && !section.blocks.includes(block)) {
      section.blocks.push(block);
    }
  }
  for (const section of sections) {
    section.blocks.sort((left, right) =>
      (indexOrder.get(summaryCaseId.exec(left)?.[1] ?? "") ?? Number.MAX_SAFE_INTEGER)
      - (indexOrder.get(summaryCaseId.exec(right)?.[1] ?? "") ?? Number.MAX_SAFE_INTEGER)
    );
  }

  const result = `${head}${sections.map((section) =>
    `${section.header}${section.remainder ? `\n${section.remainder}\n` : ""}\n\n${section.blocks.join("\n\n")}\n\n`
  ).join("")}`.replace(/\n{3,}$/u, "\n");
  return {
    result: projectTestcaseV6DerivedView(result),
    relocated: [...new Set(relocated)],
    countsRefreshed
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const target = resolve(args[0] ?? "");
  if (!target.endsWith("cases.md")) {
    throw new Error("用法：tsx scripts/reproject-testcases.ts <cases.md 路径> [--dry-run]");
  }
  const original = await readFile(target, "utf8");
  const { result, relocated, countsRefreshed } = reproject(original);
  if (result === original) {
    process.stdout.write("无结构漂移：派生区与模块归属均已一致。\n");
    return;
  }
  const issues = validateTestcaseV6Layered(result);
  if (issues.length) {
    throw new Error(`重投影后仍未通过结构校验：${issues.join(" ")}`);
  }
  if (dryRun) {
    process.stdout.write(`[dry-run] 将修复：${countsRefreshed ? "派生区（统计行/快速索引）" : ""}${relocated.length ? `${countsRefreshed ? "；" : ""}模块归属归位 ${relocated.join("、")}` : ""}\n`);
    return;
  }
  await writeFile(target, result, "utf8");
  process.stdout.write(
    `已重投影：${countsRefreshed ? "派生区已刷新" : "派生区无变化"}${relocated.length ? `；模块归属归位 ${relocated.join("、")}` : ""}；结构校验通过。\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
