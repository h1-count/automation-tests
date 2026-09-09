import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const categoryCodes = ["C01", "C02", "C03", "C04", "C05", "C06", "C07"];
export const categoryNames = {
  C01: "可达性与主流程",
  C02: "字段与输入规则",
  C03: "唯一性与重复操作",
  C04: "成功、异常与边界",
  C05: "权限、状态与导航",
  C06: "验证码、登录态与特殊能力",
  C07: "数据写入与后续处理"
};
export const scopeSchema = "testcase-scope";
/** 组合触发阈值（固定）：有效组合按业务约束过滤后计算，超过 12 条且参数不少于 3 个时必须 pairwise。 */
export const combinationRules = {
  minPairwiseParameters: 3,
  maxDirectEnumerationCombinations: 12
};
const caseIdPattern = /OP-[A-Z]+-\d{3}/g;
const dataIdPattern = /^D\d{2,}$/u;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function caseIdsFromCases(cases) {
  return new Set(cases.match(caseIdPattern) ?? []);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function dataIdsFromCases(cases) {
  return new Set(cases.match(/\bD\d{2,}\b/g) ?? []);
}

function parameterValueCount(parameters) {
  return parameters.reduce((total, parameter) => total * parameter.values.map(text).filter(Boolean).length, 1);
}

function sameParameterModel(designParameters, modelParameters) {
  const entries = Object.entries(modelParameters ?? {});
  if (designParameters.length !== entries.length) return false;
  return designParameters.every((parameter, index) => {
    const [modelName, modelValues] = entries[index] ?? [];
    return parameter.name === modelName
      && JSON.stringify(parameter.values.map(text).filter(Boolean)) === JSON.stringify((modelValues ?? []).map(text).filter(Boolean));
  });
}

function add(problems, category, object, message) {
  problems.push({ category: text(category?.code) || text(category) || "未分类", object: text(object?.id) || "未命名对象", message });
}

/**
 * 校验单个 scope.json。该函数刻意只做结构性完整性校验；对象是否业务合理由 Excel「范围矩阵」审核。
 * 统一 `testcase-scope`：每个对象必须给出 combinationDesign 组合设计结论，缺失或策略错误即失败。
 */
export function validateScope(scope, availableCaseIds) {
  const problems = [];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return { problems: [{ category: "全局", object: "scope.json", message: "scope.json 必须是对象" }], summary: {} };
  }
  if (scope.schema !== scopeSchema) {
    problems.push({ category: "全局", object: "scope.json", message: `schema 必须为 ${scopeSchema}` });
  }
  if (!Array.isArray(scope.categories)) {
    return { problems: [...problems, { category: "全局", object: "categories", message: "categories 必须是数组" }], summary: {} };
  }
  const seenCategories = new Set();
  const seenObjects = new Set();
  const summary = Object.fromEntries(categoryCodes.map((code) => [code, { covered: 0, out_of_scope: 0, pending: 0 }]));
  for (const category of scope.categories) {
    const code = text(category?.code);
    if (!categoryCodes.includes(code)) {
      add(problems, { code: code || "未分类" }, category, "类别必须是 C01 至 C07 之一");
      continue;
    }
    if (seenCategories.has(code)) add(problems, category, category, `类别 ${code} 重复`);
    seenCategories.add(code);
    if (!Array.isArray(category.objects) || category.objects.length === 0) {
      add(problems, category, category, "类别必须至少包含一个范围对象");
      continue;
    }
    for (const object of category.objects) {
      const id = text(object?.id);
      const evidence = Array.isArray(object?.evidence) ? object.evidence.map(text).filter(Boolean) : [];
      const disposition = text(object?.disposition);
      if (!id) add(problems, category, object, "对象 id 不能为空");
      else if (seenObjects.has(id)) add(problems, category, object, `对象 id 重复：${id}`);
      else seenObjects.add(id);
      if (!text(object?.name)) add(problems, category, object, "对象 name 不能为空");
      if (evidence.length === 0) add(problems, category, object, "对象必须提供至少一条源码或资料依据");
      if (!Object.hasOwn(summary, code)) continue;
      if (!Object.hasOwn(summary[code], disposition)) {
        add(problems, category, object, "归宿必须是 covered、out_of_scope 或 pending");
        continue;
      }
      summary[code][disposition] += 1;
      if (disposition === "covered") {
        const ids = Array.isArray(object.caseIds) ? object.caseIds.map(text).filter(Boolean) : [];
        if (ids.length === 0) add(problems, category, object, "covered 对象必须关联至少一个 cases.md 用例 ID");
        for (const caseId of ids) {
          if (!availableCaseIds.has(caseId)) add(problems, category, object, `关联用例 ${caseId} 不存在于 cases.md`);
        }
      }
      if (disposition === "out_of_scope" && !text(object?.reason)) {
        add(problems, category, object, "out_of_scope 对象必须提供范围外理由");
      }
      if (disposition === "pending") add(problems, category, object, "pending 仅可在设计中暂存，审核导出和测试执行前必须清零");
      validateCombinationDesign(problems, category, object, availableCaseIds);
    }
  }
  for (const code of categoryCodes) {
    if (!seenCategories.has(code)) problems.push({ category: code, object: "类别", message: `缺少 ${code}（${categoryNames[code]}）` });
  }
  return { problems, summary };
}

/**
 * 组合设计门禁：触发规则统一为——
 * 无交叉影响 not_applicable；参数 ≤ 2 或约束过滤后有效组合 ≤ 12 direct_enumeration；
 * 参数 ≥ 3 且有效组合 > 12 pairwise（必须提供模型路径、摘要与 D 编号）。
 * 高风险/写入组合必须显式标注人工补充（manualSupplementCaseIds）或范围外理由（manualSupplementReason）。
 */
function validateCombinationDesign(problems, category, object, availableCaseIds) {
  const design = object?.combinationDesign;
  if (!design || typeof design !== "object" || Array.isArray(design)) {
    add(problems, category, object, "对象必须声明 combinationDesign");
    return;
  }
  const strategy = text(design.strategy);
  const parameters = Array.isArray(design.parameters) ? design.parameters : [];
  const hasConstraintsField = Array.isArray(design.constraints);
  const constraints = hasConstraintsField ? design.constraints : [];
  const validCount = design.validCombinationCount;
  if (!text(design.rationale)) add(problems, category, object, "combinationDesign 必须说明策略理由（rationale）");
  if (!Number.isInteger(validCount) || validCount < 0) add(problems, category, object, "validCombinationCount 必须是非负整数（按业务约束过滤后的有效组合数）");
  for (const parameter of parameters) {
    if (!text(parameter?.name) || !Array.isArray(parameter?.values) || parameter.values.map(text).filter(Boolean).length === 0 || !text(parameter?.evidence)) {
      add(problems, category, object, "每个组合参数必须有名称、非空等价类取值和依据");
    }
  }
  if (hasConstraintsField && constraints.some((constraint) => !text(constraint))) {
    add(problems, category, object, "constraints 只能包含非空业务约束说明");
  }
  const manualIds = Array.isArray(design.manualSupplementCaseIds) ? design.manualSupplementCaseIds.map(text).filter(Boolean) : [];
  if (strategy === "not_applicable") {
    if (parameters.length !== 0 || validCount !== 0) add(problems, category, object, "not_applicable 必须无参数且有效组合数为 0");
  } else if (strategy === "direct_enumeration") {
    if (parameters.length === 0 || validCount < 1) add(problems, category, object, "direct_enumeration 必须提供参数和有效组合数");
    if (!hasConstraintsField) add(problems, category, object, "direct_enumeration 必须声明业务约束说明（无约束时为空数组）");
    if (parameters.length >= combinationRules.minPairwiseParameters && validCount > combinationRules.maxDirectEnumerationCombinations) {
      add(problems, category, object, `参数不少于 ${combinationRules.minPairwiseParameters} 个且有效组合超过 ${combinationRules.maxDirectEnumerationCombinations} 条时必须使用 pairwise`);
    }
    if (hasConstraintsField && constraints.length === 0 && parameters.length > 0 && validCount !== parameterValueCount(parameters)) {
      add(problems, category, object, "无业务约束时，validCombinationCount 必须等于各参数等价类取值的笛卡尔积");
    }
  } else if (strategy === "pairwise") {
    if (parameters.length < combinationRules.minPairwiseParameters || validCount <= combinationRules.maxDirectEnumerationCombinations) {
      add(problems, category, object, `pairwise 仅适用于至少 ${combinationRules.minPairwiseParameters} 个参数且有效组合超过 ${combinationRules.maxDirectEnumerationCombinations} 条的对象`);
    }
    if (!hasConstraintsField) add(problems, category, object, "pairwise 必须声明业务约束说明（无约束时为空数组）");
    if (!text(design.modelPath) || !/^[a-f0-9]{64}$/u.test(text(design.modelDigest)) || !Array.isArray(design.dataIds) || design.dataIds.length === 0) {
      add(problems, category, object, "pairwise 必须提供模型路径、模型摘要和生成的 D 编号");
    }
    for (const id of Array.isArray(design.dataIds) ? design.dataIds : []) {
      if (!dataIdPattern.test(text(id))) add(problems, category, object, `pairwise 数据编号格式非法：${text(id) || "(空)"}（应为 D01 式）`);
    }
  } else {
    add(problems, category, object, "combinationDesign.strategy 必须是 not_applicable、direct_enumeration 或 pairwise");
  }
  if (text(category?.code) === "C07" && text(object?.disposition) === "covered") {
    if (manualIds.length === 0) add(problems, category, object, "C07 写入对象必须列出人工补充的高风险用例（manualSupplementCaseIds）");
  } else if (strategy === "pairwise" && manualIds.length === 0 && !text(design.manualSupplementReason)) {
    add(problems, category, object, "pairwise 只覆盖两两交互：必须显式标注人工补充的高风险组合用例，或给出范围外理由（manualSupplementReason）");
  }
  for (const caseId of manualIds) {
    if (!availableCaseIds.has(caseId)) add(problems, category, object, `人工补充用例 ${caseId} 不存在于 cases.md`);
  }
}

function runPairwise(modelPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(rootDirectory, "skills", "testcase-designer", "scripts", "pict-pairwise.mjs"), "--model", modelPath, "--format", "json"], { cwd: rootDirectory });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", (reason) => resolve({ error: reason.message }));
    child.on("exit", (code) => {
      if (code !== 0) resolve({ error: error || `pairwise 生成器退出码 ${code}` });
      else {
        try { resolve({ result: JSON.parse(output) }); } catch { resolve({ error: "pairwise 生成器未输出合法 JSON" }); }
      }
    });
  });
}

async function validatePairwiseModels(scope, packDirectory, cases) {
  const problems = [];
  if (scope?.schema !== scopeSchema) return problems;
  const dataIds = dataIdsFromCases(cases);
  for (const category of scope.categories ?? []) {
    for (const object of category.objects ?? []) {
      const design = object?.combinationDesign;
      if (design?.strategy !== "pairwise") continue;
      const modelPath = path.resolve(packDirectory, design.modelPath);
      let modelText;
      try { modelText = await fs.readFile(modelPath, "utf8"); } catch { add(problems, category, object, `pairwise 模型不存在：${design.modelPath}`); continue; }
      if (sha256(modelText) !== design.modelDigest) add(problems, category, object, "pairwise 模型摘要与 scope.json 不一致");
      const executed = await runPairwise(modelPath);
      if (executed.error) { add(problems, category, object, `pairwise 模型校验失败：${executed.error}`); continue; }
      let model;
      try { model = JSON.parse(modelText); } catch { add(problems, category, object, "pairwise 模型不是合法 JSON"); continue; }
      if (!sameParameterModel(design.parameters, model.parameters)) {
        add(problems, category, object, "pairwise 模型参数或等价类取值与 scope.json 不一致");
      }
      if (executed.result.statistics.validCombos !== design.validCombinationCount) add(problems, category, object, "pairwise 有效组合数与 scope.json 不一致");
      if (executed.result.statistics.uncoveredRemaining !== 0) add(problems, category, object, "pairwise 模型存在未覆盖的可覆盖取值对");
      const expectedIds = executed.result.rows.map((_, index) => `D${String(index + 1).padStart(2, "0")}`);
      if (JSON.stringify(design.dataIds) !== JSON.stringify(expectedIds)) add(problems, category, object, "pairwise D 编号未与生成结果一致");
      for (const id of design.dataIds) if (!dataIds.has(id)) add(problems, category, object, `pairwise 数据编号 ${id} 未落入 cases.md`);
    }
  }
  return problems;
}

export async function auditPack(packDirectory) {
  const resolvedPack = path.resolve(packDirectory);
  const packName = path.relative(rootDirectory, resolvedPack) || resolvedPack;
  const casesPath = path.join(resolvedPack, "cases.md");
  const scopePath = path.join(resolvedPack, "scope.json");
  let cases;
  try {
    cases = await fs.readFile(casesPath, "utf8");
  } catch {
    return { packName, problems: [{ category: "全局", object: "cases.md", message: "缺少 cases.md" }], summary: {} };
  }
  const availableCaseIds = caseIdsFromCases(cases);
  let scope;
  try {
    scope = JSON.parse(await fs.readFile(scopePath, "utf8"));
  } catch (error) {
    return { packName, problems: [{ category: "全局", object: "scope.json", message: `无法读取 scope.json：${error.message}` }], summary: {} };
  }
  const validation = validateScope(scope, availableCaseIds);
  validation.problems.push(...await validatePairwiseModels(scope, resolvedPack, cases));
  return { packName, ...validation, caseCount: availableCaseIds.size, scopePath };
}

async function collectPackDirectories(overrides) {
  if (overrides.length > 0) return overrides.map((entry) => path.resolve(rootDirectory, entry));
  const packs = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (await fs.access(path.join(child, "cases.md")).then(() => true).catch(() => false)) packs.push(child);
      else await walk(child);
    }
  }
  await walk(path.join(rootDirectory, "testpacks"));
  return packs;
}

async function main() {
  const packs = await collectPackDirectories(process.argv.slice(2));
  if (packs.length === 0) throw new Error("未找到含 cases.md 的功能包");
  let failed = false;
  for (const pack of packs.sort()) {
    const result = await auditPack(pack);
    if (result.problems.length === 0) {
      console.log(`[范围完整性] ${result.packName}（用例 ${result.caseCount} 条） ✓ 七类范围契约通过`);
      continue;
    }
    failed = true;
    console.error(`[范围完整性] ${result.packName} ✗ ${result.problems.length} 处缺口：`);
    for (const problem of result.problems) console.error(`  - [${problem.category}] ${problem.object}：${problem.message}`);
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
