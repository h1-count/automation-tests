import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const CASE_RELATION_PROJECTION_MARKER = "结构版本：case-relation-projection-v1";
const caseIdPattern = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g;
const ruleIdPattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const reqIdPattern = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;

export type ProjectionIssue = { name: string; detail: string };
export type SyncResult = { changedFiles: string[]; issues: ProjectionIssue[]; strict: boolean };

type Rule = { id: string; reqId: string; type: string; caseIds: string[] };
type AtomicCase = { id: string; packageFile: string; content: string };

function ids(value: string, pattern: RegExp): string[] {
  return [...new Set(value.match(pattern) ?? [])].sort();
}

function section(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const end = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, end < 0 ? undefined : end);
}

function tableRows(content: string): Array<{ line: number; cells: string[] }> {
  return content.split("\n").flatMap((line, lineIndex) => {
    if (!line.trim().startsWith("|") || /^\|\s*-{3,}/.test(line.trim())) return [];
    return [{ line: lineIndex, cells: line.split("|").slice(1, -1).map((cell) => cell.trim()) }];
  });
}

function parseRules(plan: string): Rule[] {
  return tableRows(section(plan, "## 规则覆盖台账"))
    .filter(({ cells }) => /^RULE-/.test(cells[0] ?? ""))
    .map(({ cells }) => ({
      id: ids(cells[0] ?? "", ruleIdPattern)[0] ?? "",
      reqId: ids(cells[1] ?? "", reqIdPattern)[0] ?? "",
      type: cells[3] ?? "",
      caseIds: ids(cells[9] ?? "", caseIdPattern)
    }));
}

function readCases(requestDirectory: string): AtomicCase[] {
  return readdirSync(requestDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^cases-[a-z0-9][a-z0-9-]*\.md$/.test(entry.name))
    .flatMap((entry) => {
      const content = readFileSync(join(requestDirectory, entry.name), "utf8");
      return content.split(/^## 测试用例：/m).slice(1).flatMap((block) => {
        const match = block.match(/^\s*\|\s*用例编号\s*\|\s*(.*?)\s*\|\s*$/m);
        const id = ids(match?.[1] ?? "", caseIdPattern)[0];
        return id ? [{ id, packageFile: entry.name, content: block }] : [];
      });
    });
}

function renderCells(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function domainForRule(type: string): string[] {
  if (["业务规则", "分支/决策"].includes(type)) return ["业务功能与规则"];
  if (type === "输入边界") return ["输入与数据校验"];
  if (type === "异常与恢复") return ["异常、容错与恢复"];
  if (type === "状态流转") return ["状态与生命周期"];
  if (type === "页面交互") return ["交互、视觉与无障碍"];
  if (type === "权限/身份") return ["权限、身份与审计"];
  if (type === "集成与数据一致性") return ["数据完整性与一致性", "接口、集成与契约"];
  return [];
}

function rewriteTableColumn(content: string, heading: string, column: string, derive: (cells: string[]) => string): string {
  const start = content.indexOf(heading);
  if (start < 0) return content;
  const end = content.indexOf("\n## ", start + heading.length);
  const before = content.slice(0, start);
  const body = content.slice(start, end < 0 ? undefined : end);
  const after = end < 0 ? "" : content.slice(end);
  const lines = body.split("\n");
  const headerIndex = lines.findIndex((line) => line.includes(`| ${column} |`));
  if (headerIndex < 0) return content;
  const headers = lines[headerIndex].split("|").slice(1, -1).map((cell) => cell.trim());
  const target = headers.indexOf(column);
  if (target < 0) return content;
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith("|")) break;
    const cells = lines[index].split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== headers.length) continue;
    cells[target] = derive(cells);
    lines[index] = renderCells(cells);
  }
  return before + lines.join("\n") + after;
}

function rewriteCaseRuleFields(content: string, rulesByCase: Map<string, string[]>): string {
  const caseMatch = content.match(/\|\s*用例编号\s*\|\s*(.*?)\s*\|\s*$/m);
  const caseId = ids(caseMatch?.[1] ?? "", caseIdPattern)[0];
  if (!caseId) return content;
  return content.replace(/(\|\s*规则覆盖编号\s*\|\s*)(.*?)(\s*\|\s*$)/gm, (_line, prefix, _value, suffix) => `${prefix}${rulesByCase.get(caseId)?.join("、") ?? "无"}${suffix}`);
}

function rewritePackage(content: string, rulesByCase: Map<string, string[]>): string {
  return content.replace(/(## 测试用例：[\s\S]*?)(?=\n## 测试用例：|$)/g, (block) => rewriteCaseRuleFields(block, rulesByCase));
}

export function synchronizeRequest(requestDirectory: string, options: { check?: boolean } = {}): SyncResult {
  const directory = resolve(requestDirectory);
  const planPath = join(directory, "plan.md");
  const originalPlan = readFileSync(planPath, "utf8");
  const strict = originalPlan.includes(CASE_RELATION_PROJECTION_MARKER);
  if (!strict) return { changedFiles: [], strict: false, issues: [{ name: "历史请求兼容", detail: `${directory} 未标记 case-relation-projection-v1，未同步。` }] };

  const rules = parseRules(originalPlan);
  const cases = readCases(directory);
  const caseSet = new Set(cases.map((item) => item.id));
  const reqSet = new Set(tableRows(section(originalPlan, "## 需求追溯矩阵")).flatMap(({ cells }) => ids(cells[0] ?? "", reqIdPattern)));
  const issues: ProjectionIssue[] = [];
  const duplicateCases = cases.filter((item, index) => cases.findIndex((candidate) => candidate.id === item.id) !== index).map((item) => item.id);
  if (duplicateCases.length) issues.push({ name: "caseId 唯一性", detail: `重复 caseId：${[...new Set(duplicateCases)].join("、")}` });
  for (const rule of rules) {
    if (!reqSet.has(rule.reqId)) issues.push({ name: "RULE 关系源", detail: `${rule.id} 关联的 ${rule.reqId || "REQ"} 不存在。` });
    for (const caseId of rule.caseIds) if (!caseSet.has(caseId)) issues.push({ name: "RULE 关系源", detail: `${rule.id} → ${caseId} 不存在。` });
  }
  const mappedCaseIds = new Set(rules.flatMap((rule) => rule.caseIds));
  for (const item of cases) if (!mappedCaseIds.has(item.id)) issues.push({ name: "RULE 关系源", detail: `${item.id} 没有任何 RULE → caseId 关系。` });
  if (issues.length) return { changedFiles: [], strict, issues };

  const rulesByReq = new Map<string, string[]>();
  const rulesByCase = new Map<string, string[]>();
  const casesByDomain = new Map<string, string[]>();
  for (const rule of rules) {
    rulesByReq.set(rule.reqId, [...new Set([...(rulesByReq.get(rule.reqId) ?? []), ...rule.caseIds])].sort());
    for (const caseId of rule.caseIds) rulesByCase.set(caseId, [...new Set([...(rulesByCase.get(caseId) ?? []), rule.id])].sort());
    for (const domain of domainForRule(rule.type)) casesByDomain.set(domain, [...new Set([...(casesByDomain.get(domain) ?? []), ...rule.caseIds])].sort());
  }
  const packagesByName = new Map<string, string[]>();
  for (const item of cases) packagesByName.set(item.packageFile, [...(packagesByName.get(item.packageFile) ?? []), item.id].sort());

  let projectedPlan = originalPlan;
  projectedPlan = rewriteTableColumn(projectedPlan, "## 需求追溯矩阵", "派生 caseId", (cells) => (rulesByReq.get(ids(cells[0] ?? "", reqIdPattern)[0] ?? "") ?? []).join("、") || "无");
  projectedPlan = rewriteTableColumn(projectedPlan, "## 覆盖矩阵", "派生 caseId", (cells) => (casesByDomain.get(cells[0] ?? "") ?? []).join("、") || "无");
  projectedPlan = rewriteTableColumn(projectedPlan, "## 用例包目录", "实际原子用例编号", (cells) => (packagesByName.get((cells[0] ?? "").replace(/`/g, "")) ?? []).join("、") || "待阶段二生成");
  for (const heading of ["### 基准资料与模块映射", "### 拆分清单", "### 测试设计技术与依据"]) {
    projectedPlan = rewriteTableColumn(projectedPlan, heading, "派生 caseId", (cells) => ids(cells.join(" | "), ruleIdPattern).flatMap((ruleId) => rules.find((rule) => rule.id === ruleId)?.caseIds ?? []).filter((id, index, all) => all.indexOf(id) === index).sort().join("、") || "无");
  }

  const projectedFiles = new Map<string, string>();
  for (const fileName of packagesByName.keys()) {
    const path = join(directory, fileName);
    projectedFiles.set(path, rewritePackage(readFileSync(path, "utf8"), rulesByCase));
  }
  const changedFiles = [planPath, ...[...projectedFiles.keys()]].filter((path) => (path === planPath ? projectedPlan : projectedFiles.get(path)) !== readFileSync(path, "utf8"));
  if (options.check && changedFiles.length) {
    return { changedFiles: [], strict, issues: changedFiles.map((path) => ({ name: "派生视图未同步", detail: `${basename(path)} 与 RULE → caseId 关系源不一致；运行 testcases:sync-relations 修复。` })) };
  }
  if (!options.check) {
    if (projectedPlan !== originalPlan) writeFileSync(planPath, projectedPlan, "utf8");
    for (const [path, content] of projectedFiles) if (content !== readFileSync(path, "utf8")) writeFileSync(path, content, "utf8");
  }
  return { changedFiles, strict, issues: [] };
}
