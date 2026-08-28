import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  parseRuleCaseRecords,
  parseRuleDesignDetails,
  RULE_DESIGN_LEDGER_MARKER_V1,
  validateRuleDesignMatrix as validateRuleDesignMatrixIssues
} from "../src/support/testcase/relationProjection.ts";

export { RULE_DESIGN_LEDGER_MARKER_V1 };

type RuleRecord = {
  ruleId: string;
  requirementIds: string[];
  applicability: string;
};

function parseRules(plan: string): RuleRecord[] {
  return parseRuleCaseRecords(plan).map((rule) => ({ ruleId: rule.id, requirementIds: rule.reqIds, applicability: rule.applicability }));
}

export function expandRuleNeighborhood(plan: string, triggerRuleIds: string[]): string[] {
  const rules = parseRules(plan);
  const designs = new Map(parseRuleDesignDetails(plan).map((record) => [record.id, record]));
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
  return validateRuleDesignMatrixIssues(plan).map((issue) => issue.detail);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: rule-design-preflight.ts <plan.md>");
  const issues = validateRuleDesignMatrix(readFileSync(resolve(path), "utf8"));
  if (issues.length > 0) throw new Error(issues.join("\n"));
  process.stdout.write("规则设计预检通过。\n");
}
