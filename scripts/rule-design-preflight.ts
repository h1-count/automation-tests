import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { splitMarkdownTableRow } from "./markdown-format.ts";

export const RULE_DESIGN_MATRIX_MARKER = "结构版本：rule-design-matrix-v1";

type RuleRecord = {
  ruleId: string;
  requirementIds: string[];
  applicability: string;
};

type DesignRecord = {
  ruleId: string;
  fieldOrState: string;
  requiredness: string;
  inputs: string;
  observableExpectation: string;
  dataPrecondition: string;
  executionGate: string;
  caseIds: string;
  conclusion: string;
};

const ruleIdPattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const requirementIdPattern = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;

function section(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const end = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, end < 0 ? undefined : end);
}

function tableRows(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*:?-{3,}/.test(line.trim()))
    .map(splitMarkdownTableRow);
}

function parseRules(plan: string): RuleRecord[] {
  return tableRows(section(plan, "## 规则覆盖台账"))
    .filter((row) => /^RULE-/.test(row[0] ?? ""))
    .map((row) => ({
      ruleId: (row[0]?.match(ruleIdPattern) ?? [])[0] ?? "",
      requirementIds: row[1]?.match(requirementIdPattern) ?? [],
      applicability: row[7] ?? ""
    }));
}

function parseDesignRecords(plan: string): DesignRecord[] {
  return tableRows(section(plan, "## 规则设计矩阵"))
    .filter((row) => /^RULE-/.test(row[0] ?? ""))
    .map((row) => ({
      ruleId: (row[0]?.match(ruleIdPattern) ?? [])[0] ?? "",
      fieldOrState: row[1] ?? "",
      requiredness: row[2] ?? "",
      inputs: row[3] ?? "",
      observableExpectation: row[4] ?? "",
      dataPrecondition: row[5] ?? "",
      executionGate: row[6] ?? "",
      caseIds: row[7] ?? "",
      conclusion: row[8] ?? ""
    }));
}

function isConcrete(value: string): boolean {
  const normalized = value.replace(/`/g, "").trim();
  return normalized.length > 0
    && !["无", "待填写", "待补充", "未知", "已定义校验", "符合预期", "功能正常"].includes(normalized);
}

export function expandRuleNeighborhood(plan: string, triggerRuleIds: string[]): string[] {
  const rules = parseRules(plan);
  const designs = new Map(parseDesignRecords(plan).map((record) => [record.ruleId, record]));
  const selected = new Set(triggerRuleIds.filter((ruleId) => rules.some((rule) => rule.ruleId === ruleId)));

  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of rules) {
      if (selected.has(candidate.ruleId)) continue;
      const candidateDesign = designs.get(candidate.ruleId);
      const related = [...selected].some((ruleId) => {
        const trigger = rules.find((rule) => rule.ruleId === ruleId);
        const triggerDesign = designs.get(ruleId);
        return Boolean(
          trigger
          && (
            trigger.requirementIds.some((requirementId) => candidate.requirementIds.includes(requirementId))
            || (candidateDesign?.fieldOrState && candidateDesign.fieldOrState === triggerDesign?.fieldOrState)
            || (candidateDesign?.dataPrecondition && candidateDesign.dataPrecondition === triggerDesign?.dataPrecondition)
          )
        );
      });
      if (related) {
        selected.add(candidate.ruleId);
        changed = true;
      }
    }
  }

  return [...selected].sort();
}

export function validateRuleDesignMatrix(plan: string): string[] {
  if (!plan.includes(RULE_DESIGN_MATRIX_MARKER)) {
    return ["缺少 rule-design-matrix-v1 规则设计矩阵。"];
  }

  const designs = new Map(parseDesignRecords(plan).map((record) => [record.ruleId, record]));
  const issues: string[] = [];
  for (const rule of parseRules(plan).filter((record) => ["适用", "受控执行"].includes(record.applicability))) {
    const design = designs.get(rule.ruleId);
    if (!design) {
      issues.push(`${rule.ruleId} 缺少规则设计矩阵记录。`);
      continue;
    }
    if (!/必填|选填|不适用/.test(design.requiredness)) {
      issues.push(`${rule.ruleId} 未声明必填/选填性。`);
    }
    if (!isConcrete(design.inputs) || !isConcrete(design.observableExpectation)) {
      issues.push(`${rule.ruleId} 缺少具体输入或可观察预期。`);
    }
    if (!isConcrete(design.dataPrecondition)) {
      issues.push(`${rule.ruleId} 缺少数据前置。`);
    }
    if (!isConcrete(design.executionGate)) {
      issues.push(`${rule.ruleId} 缺少执行门禁。`);
    }
    if (!isConcrete(design.caseIds)) {
      issues.push(`${rule.ruleId} 缺少关联 caseId 或阶段状态。`);
    }
    if (!["已覆盖", "受控执行", "用户裁决", "不适用"].includes(design.conclusion)) {
      issues.push(`${rule.ruleId} 缺少有效设计结论。`);
    }
  }
  return issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: rule-design-preflight.ts <plan.md>");
  const issues = validateRuleDesignMatrix(readFileSync(resolve(path), "utf8"));
  if (issues.length > 0) throw new Error(issues.join("\n"));
  process.stdout.write("规则设计预检通过。\n");
}
