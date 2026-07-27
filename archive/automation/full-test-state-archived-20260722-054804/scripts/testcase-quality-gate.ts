export const RULE_COVERAGE_MARKER = "结构版本：rule-coverage-v1";

type CaseRecord = { caseId: string; ruleIds: string[]; source: string };
type RuleRecord = {
  ruleId: string;
  type: string;
  designEvidence: string;
  applicability: string;
  coverageStatus: string;
  caseIds: string[];
  basis: string;
};
export type RuleCoverageIssue = { name: string; detail: string };

function cells(line: string): string[] {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

export function parseRuleRecords(plan: string): RuleRecord[] {
  const section = plan.split("## 规则覆盖台账")[1]?.split("## ")[0] ?? "";
  return section
    .split("\n")
    .filter((line) => /^\|\s*RULE-/.test(line))
    .map((line) => {
      const row = cells(line);
      return {
        ruleId: row[0] ?? "",
        type: row[3] ?? "",
        designEvidence: row[6] ?? "",
        applicability: row[7] ?? "",
        coverageStatus: row[8] ?? "",
        caseIds: (row[9] ?? "").match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g) ?? [],
        basis: row[10] ?? ""
      };
    });
}

export function summarizeRuleCoverage(plan: string): string {
  const rules = parseRuleRecords(plan);
  const applicable = rules.filter((rule) => ["适用", "受控执行"].includes(rule.applicability));
  const covered = applicable.filter((rule) => rule.caseIds.length > 0 && ["已覆盖", "受控执行"].includes(rule.coverageStatus));
  return `适用规则 ${applicable.length}；已覆盖 ${covered.length}；规则总数 ${rules.length}。`;
}

export function validateRuleCoverage(plan: string, cases: CaseRecord[]): RuleCoverageIssue[] {
  if (!plan.includes(RULE_COVERAGE_MARKER)) {
    return [{ name: "规则覆盖台账", detail: "历史请求未标记 rule-coverage-v1，保持兼容警告。" }];
  }
  const rules = parseRuleRecords(plan);
  const issues: RuleCoverageIssue[] = [];
  const caseRuleIds = new Map(cases.map((item) => [item.caseId, new Set(item.ruleIds)]));
  for (const rule of rules) {
    const needsCase = ["适用", "受控执行"].includes(rule.applicability);
    if (needsCase && rule.caseIds.length === 0) issues.push({ name: "适用规则关联", detail: `${rule.ruleId} 缺少关联 caseId。` });
    if (["不适用", "待补充", "待用户裁决", "受控执行"].includes(rule.applicability) && !rule.basis.trim().match(/[^无]/)) {
      issues.push({ name: "规则适用性依据", detail: `${rule.ruleId} 缺少适用性或执行门禁依据。` });
    }
    if (rule.type === "输入边界" && !/等价类|边界/.test(rule.designEvidence)) {
      issues.push({ name: "规则设计证据", detail: `${rule.ruleId} 的输入边界缺少等价类或边界证据。` });
    }
    for (const caseId of rule.caseIds) {
      if (!caseRuleIds.get(caseId)?.has(rule.ruleId)) {
        issues.push({ name: "RULE ↔ caseId 双向追溯", detail: `${rule.ruleId} 与 ${caseId} 未双向关联。` });
      }
    }
  }
  for (const item of cases) {
    for (const ruleId of item.ruleIds) {
      if (!rules.some((rule) => rule.ruleId === ruleId && rule.caseIds.includes(item.caseId))) {
        issues.push({ name: "RULE ↔ caseId 双向追溯", detail: `${item.caseId} 引用的 ${ruleId} 未在台账反向关联。` });
      }
    }
  }
  return issues;
}
