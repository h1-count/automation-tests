import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRuleRecords } from "./testcase-quality-gate.ts";

export const RULE_DESIGN_MATRIX_MARKER = "结构版本：rule-design-matrix-v1";
function section(content: string, heading: string) { const start = content.indexOf(heading); const end = content.indexOf("\n## ", start + heading.length); return start < 0 ? "" : content.slice(start, end < 0 ? undefined : end); }
export type RuleDesignMatrixRow = { ruleId: string; object: string; optionality: string; inputs: string; expectation: string; precondition: string; gate: string; caseIds: string; conclusion: string };
function rows(content: string): RuleDesignMatrixRow[] { return content.split("\n").filter((line) => /^\|\s*RULE-/.test(line)).map((line) => { const row = line.split("|").slice(1, -1).map((cell) => cell.trim()); return { ruleId: row[0] ?? "", object: row[1] ?? "", optionality: row[2] ?? "", inputs: row[3] ?? "", expectation: row[4] ?? "", precondition: row[5] ?? "", gate: row[6] ?? "", caseIds: row[7] ?? "", conclusion: row[8] ?? "" }; }); }
export function readRuleDesignMatrix(plan: string): RuleDesignMatrixRow[] { return rows(section(plan, "## 规则设计矩阵")); }
export function expandRuleNeighborhood(plan: string, triggerRuleIds: string[]): string[] {
  const rules = parseRuleRecords(plan);
  const matrix = new Map(readRuleDesignMatrix(plan).map((row) => [row.ruleId, row]));
  const selected = rules.filter((rule) => triggerRuleIds.includes(rule.ruleId));
  const requirementIds = new Set(selected.map((rule) => rule.requirementId));
  const relatedObjects = new Set(selected.map((rule) => matrix.get(rule.ruleId)?.object).filter(Boolean));
  const relatedPreconditions = new Set(selected.map((rule) => matrix.get(rule.ruleId)?.precondition).filter(Boolean));
  return rules.filter((rule) => requirementIds.has(rule.requirementId) || relatedObjects.has(matrix.get(rule.ruleId)?.object) || relatedPreconditions.has(matrix.get(rule.ruleId)?.precondition)).map((rule) => rule.ruleId).sort();
}
export function validateRuleDesignMatrix(plan: string): string[] {
  if (!plan.includes(RULE_DESIGN_MATRIX_MARKER)) return ["缺少 rule-design-matrix-v1 规则设计矩阵。"];
  const byRule = new Map(readRuleDesignMatrix(plan).map((row) => [row.ruleId, row]));
  const issues: string[] = [];
  for (const rule of parseRuleRecords(plan).filter((item) => ["适用", "受控执行"].includes(item.applicability))) {
    const row = byRule.get(rule.ruleId);
    if (!row) { issues.push(`${rule.ruleId} 缺少完整规则设计矩阵行。`); continue; }
    if (!/必填|选填|不适用/.test(row.optionality)) issues.push(`${rule.ruleId} 未声明必填/选填性。`);
    if (!row.inputs || !row.expectation || /已定义校验/.test(row.expectation)) issues.push(`${rule.ruleId} 缺少具体输入或可观察预期。`);
    if (!row.precondition || !row.gate || !row.caseIds.match(/[A-Z]+-[A-Z0-9-]+/)) issues.push(`${rule.ruleId} 缺少前置、门禁或 caseId。`);
    if (!["已覆盖", "受控执行", "用户裁决", "不适用"].includes(row.conclusion)) issues.push(`${rule.ruleId} 缺少可审查结论。`);
  }
  return issues;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const path = process.argv[2]; if (!path) throw new Error("Usage: rule-design-preflight.ts <plan.md>"); const issues = validateRuleDesignMatrix(readFileSync(resolve(path), "utf8")); if (issues.length) throw new Error(issues.join("\n")); process.stdout.write("规则设计预检通过。\n"); }
