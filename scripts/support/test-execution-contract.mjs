import fs from "node:fs/promises";
import path from "node:path";

export const executionSchema = "test-execution-contract";
export const caseIdPattern = /OP-[A-Z]+-\d{3}/g;

export function idsIn(value) {
  return [...new Set(String(value ?? "").match(caseIdPattern) ?? [])];
}

export function titlesInSpec(source) {
  const result = new Map();
  for (const match of source.matchAll(/\btest(?:\.fixme)?\(\s*["']([^"']+)["']/gu)) {
    for (const id of idsIn(match[1])) result.set(id, match[1]);
  }
  return result;
}

export async function loadExecutionContract(rootDirectory, packDirectory) {
  const casesPath = path.join(packDirectory, "cases.md");
  const executionPath = path.join(packDirectory, "execution.json");
  const specFiles = (await fs.readdir(packDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
    .map((entry) => path.join(packDirectory, entry.name));
  const expectedIds = idsIn(await fs.readFile(casesPath, "utf8"));
  const contract = JSON.parse(await fs.readFile(executionPath, "utf8"));
  const titleByCaseId = new Map();
  for (const specPath of specFiles) {
    for (const [id, title] of titlesInSpec(await fs.readFile(specPath, "utf8"))) titleByCaseId.set(id, title);
  }
  const problems = [];
  if (contract.schema !== executionSchema || !contract.cases || Array.isArray(contract.cases) || typeof contract.cases !== "object") {
    problems.push(`execution.json 必须是 schema=${executionSchema} 且包含 cases 对象`);
  }
  const declared = Object.keys(contract.cases ?? {});
  for (const id of expectedIds) {
    if (!Object.hasOwn(contract.cases ?? {}, id)) problems.push(`用例 ${id} 未在 execution.json 声明`);
    if (!titleByCaseId.has(id)) problems.push(`用例 ${id} 未出现在可选择的 test() 标题`);
  }
  for (const id of declared) {
    if (!expectedIds.includes(id)) problems.push(`execution.json 声明了 cases.md 不存在的用例 ${id}`);
    const item = contract.cases[id];
    if (!item || typeof item !== "object" || Array.isArray(item) || !Array.isArray(item.dependsOn)) {
      problems.push(`用例 ${id} 必须声明 dependsOn 数组`);
      continue;
    }
    for (const dependency of item.dependsOn) {
      if (typeof dependency !== "string" || !expectedIds.includes(dependency)) problems.push(`用例 ${id} 的前置 ${dependency} 不存在或跨包`);
    }
  }
  const visit = (id, active = new Set(), done = new Set()) => {
    if (done.has(id)) return;
    if (active.has(id)) { problems.push(`execution.json 存在循环依赖：${[...active, id].join(" → ")}`); return; }
    active.add(id);
    for (const dependency of contract.cases?.[id]?.dependsOn ?? []) visit(dependency, active, done);
    active.delete(id);
    done.add(id);
  };
  for (const id of declared) visit(id);
  if (problems.length) throw new Error(`${path.relative(rootDirectory, packDirectory)}：${[...new Set(problems)].join("；")}`);
  return {
    packPath: path.relative(path.join(rootDirectory, "testpacks"), packDirectory).replaceAll(path.sep, "/"),
    caseIds: expectedIds.sort(),
    dependsOn: Object.fromEntries(expectedIds.map((id) => [id, contract.cases[id].dependsOn])),
    titleByCaseId
  };
}

export function expandPrerequisites(contract, caseIds) {
  const selected = new Set(caseIds);
  const visit = (id) => {
    for (const dependency of contract.dependsOn[id] ?? []) {
      if (!selected.has(dependency)) { selected.add(dependency); visit(dependency); }
    }
  };
  for (const id of [...selected]) visit(id);
  return [...selected].sort();
}
