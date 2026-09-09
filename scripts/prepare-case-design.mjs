import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPack, categoryCodes, categoryNames, combinationRules, scopeSchema } from "./audit-case-completeness.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const packArgument = argumentValue("--pack");
if (!packArgument) throw new Error("用法：node scripts/prepare-case-design.mjs --pack testpacks/web/<project>/<feature>");
const packDirectory = path.resolve(rootDirectory, packArgument);
const relativePack = path.relative(path.join(rootDirectory, "testpacks"), packDirectory);
if (relativePack.startsWith("..") || path.isAbsolute(relativePack)) throw new Error("--pack 必须位于 testpacks/ 下");

const cases = await fs.readFile(path.join(packDirectory, "cases.md"), "utf8");
const contextLines = cases.split("\n").filter((line) => /^>\s*(上下文|资料|来源)/u.test(line.trim())).slice(0, 12);
const result = await auditPack(packDirectory);
const problemByCategory = new Map();
for (const problem of result.problems) {
  const items = problemByCategory.get(problem.category) ?? [];
  items.push(`${problem.object}：${problem.message}`);
  problemByCategory.set(problem.category, items);
}
const statusLines = categoryCodes.map((code) => {
  const summary = result.summary[code] ?? { covered: 0, out_of_scope: 0, pending: 0 };
  const problems = problemByCategory.get(code) ?? [];
  const status = problems.length === 0 ? "通过" : `待处理 ${problems.length} 项`;
  return `| ${code} | ${categoryNames[code]} | 覆盖 ${summary.covered} / 范围外 ${summary.out_of_scope} / 待定 ${summary.pending} | ${status} |`;
});

const strategyLabels = { not_applicable: "不适用", direct_enumeration: "直接枚举", pairwise: "Pairwise" };
let scopeObjects = [];
try {
  const scope = JSON.parse(await fs.readFile(path.join(packDirectory, "scope.json"), "utf8"));
  scopeObjects = (scope.categories ?? []).flatMap((category) => (category.objects ?? []).map((object) => ({ category, object })));
} catch {
  scopeObjects = [];
}
const designRows = scopeObjects.map(({ category, object }) => {
  const design = object.combinationDesign;
  const strategy = design ? (strategyLabels[design.strategy] ?? `${design.strategy}（非法）`) : "待判定";
  const parameterCount = Array.isArray(design?.parameters) ? String(design.parameters.length) : "—";
  const validCount = Number.isInteger(design?.validCombinationCount) ? String(design.validCombinationCount) : "—";
  const model = design?.strategy === "pairwise" && design.modelPath ? design.modelPath : "—";
  return `| ${category.code} / ${object.id} | ${object.disposition} | ${strategy} | ${parameterCount} | ${validCount} | ${model} |`;
});
const pendingDesignObjects = designRows.filter((row) => row.includes("待判定") || row.includes("（非法）"));
const combinationSection = [
  "## 组合设计判定",
  "",
  `触发规则：无交叉影响 \`not_applicable\`；参数 ≤ 2 或约束过滤后有效组合 ≤ ${combinationRules.maxDirectEnumerationCombinations} 条 \`direct_enumeration\`；参数 ≥ ${combinationRules.minPairwiseParameters} 且有效组合 > ${combinationRules.maxDirectEnumerationCombinations} 条 \`pairwise\`（建模生成 D01…，路径与摘要登记进 scope.json）。`,
  "",
  ...(designRows.length
    ? ["| 对象 | 归宿 | 策略 | 参数数 | 有效组合数 | 组合模型 |", "| --- | --- | --- | --- | --- | --- |", ...designRows]
    : ["无法读取 scope.json：请先创建该包范围契约。"]),
  "",
  ...(pendingDesignObjects.length
    ? [`**待判定组合对象 ${pendingDesignObjects.length} 个**：生成或修改用例前必须先补齐策略理由（rationale）、参数取值依据、业务约束与有效组合数。`]
    : []),
  "",
];

const output = [
  `# 用例设计卡：${relativePack}`,
  "",
  `生成时间：${new Date().toISOString()}`,
  "",
  "## 上下文来源",
  "",
  ...(contextLines.length ? contextLines : ["> 未从 cases.md 头部识别到上下文来源；续接前请补齐真实资料与页面/源码依据。"]),
  "",
  "## 七类范围状态",
  "",
  "| 类别 | 范围 | 当前归宿 | 状态 |",
  "| --- | --- | --- | --- |",
  ...statusLines,
  "",
  ...combinationSection,
  "## 当前缺口",
  "",
  ...(result.problems.length ? result.problems.map((item) => `- [${item.category}] ${item.object}：${item.message}`) : ["- 无结构性缺口。仍需在 Excel「范围矩阵」中审核对象与依据是否符合业务。"]),
  "",
  "## 下一步",
  "",
  `1. 维护 \`${path.relative(rootDirectory, path.join(packDirectory, "scope.json"))}\`（${scopeSchema}），清空 pending、补齐依据与每对象 combinationDesign。`,
  `2. 运行 \`node scripts/audit-case-completeness.mjs ${path.relative(rootDirectory, packDirectory)}\`。`,
  "3. 通过后更新 cases.md，并用 build-testcase-review-workbook 导出带「范围矩阵 + 组合策略摘要」的 Excel 审核。",
  "4. 审核确认后再生成/更新脚本并执行 npm run test:fast。",
  ""
].join("\n");
const runtimeDirectory = path.join(packDirectory, "runtime");
await fs.mkdir(runtimeDirectory, { recursive: true });
const outputPath = path.join(runtimeDirectory, "design-card.md");
await fs.writeFile(outputPath, output, "utf8");
console.log(output);
console.log(`设计卡已写入：${path.relative(rootDirectory, outputPath)}`);
