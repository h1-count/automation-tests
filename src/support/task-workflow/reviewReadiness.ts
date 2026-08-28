import { createHash } from "node:crypto";
import { evaluateTestcasePackage } from "./packageCompleteness.js";
import { canonicalJson } from "./canonicalJson.js";
import {
  parseRuleCaseRecords,
  validateRelationProjection,
  validateRuleDesignMatrix
} from "../testcase/relationProjection.js";
import { parseTestcaseDocument } from "../testcase/testcaseDocument.js";
import {
  relationProjectionContractIssues,
  ruleLedgerContractIssues
} from "../testcase/relationContract.js";

export const REVIEW_READINESS_SCHEMA_VERSION = "review-readiness-v1" as const;

export interface ReviewReadinessReport {
  schemaVersion: typeof REVIEW_READINESS_SCHEMA_VERSION;
  complete: boolean;
  digest: string;
  counts: { requirements: number; rules: number; cases: number; packages: number };
  issues: string[];
  warnings: string[];
}

export interface ReviewReadinessInput {
  plan: string;
  packages: Record<string, string>;
  writesData: boolean;
}

const requiredPlanMarkers: Array<{ label: string; alternatives: string[] }> = [
  { label: "## 请求默认值", alternatives: ["## 请求默认值"] },
  { label: "## 测试范围", alternatives: ["## 测试范围"] },
  { label: "## 请求内来源", alternatives: ["## 请求内来源"] },
  { label: "## 需求索引", alternatives: ["## 需求索引"] },
  { label: "## 规则设计台账", alternatives: ["## 规则设计台账"] },
  { label: "rule-design-ledger-v1", alternatives: ["rule-design-ledger-v1"] },
  { label: "## 缺口与风险", alternatives: ["## 缺口与风险"] }
];

function uniqueMatches(value: string, pattern: RegExp): string[] {
  return [...new Set(value.match(pattern) ?? [])].sort();
}

function writeSafetyWarnings(packages: Record<string, string>): string[] {
  const warnings: string[] = [];
  for (const [name, source] of Object.entries(packages)) {
    const document = parseTestcaseDocument(source);
    for (const testcase of document.cases) {
      const strategy = testcase.overrides.dataStrategy ?? document.defaults.dataStrategy;
      if (!strategy || strategy === "no_write") continue;
      if (!/执行清单/u.test(testcase.rawBody)) warnings.push(`${name}:${testcase.caseId} 未显式引用不可变执行清单。`);
      if (!/(?:cleanup|清理|残留)/iu.test(testcase.rawBody)) warnings.push(`${name}:${testcase.caseId} 未显式说明 cleanup 或残留处置。`);
      if (!/(?:reconcil|核对|后置查询)/iu.test(testcase.rawBody)) warnings.push(`${name}:${testcase.caseId} 未显式说明未知结果核对。`);
    }
  }
  return warnings;
}

export function evaluateReviewReadiness(input: ReviewReadinessInput): ReviewReadinessReport {
  const issues = [
    ...ruleLedgerContractIssues(input.plan),
    ...relationProjectionContractIssues(input.plan)
  ];
  for (const marker of requiredPlanMarkers) {
    if (!marker.alternatives.some((value) => input.plan.includes(value))) {
      issues.push(`plan.md 缺少 ${marker.label}。`);
    }
  }
  for (const [name, source] of Object.entries(input.packages)) {
    const completeness = evaluateTestcasePackage(source);
    if (!completeness.complete) issues.push(`${name} 不完整：${completeness.reasons.join(" ")}`);
  }
  issues.push(
    ...validateRuleDesignMatrix(input.plan).map((issue) => issue.detail),
    ...validateRelationProjection(input.plan, input.packages).map((issue) => issue.detail)
  );
  const warnings = input.writesData ? writeSafetyWarnings(input.packages) : [];
  const requirements = uniqueMatches(input.plan, /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g);
  const rules = parseRuleCaseRecords(input.plan).map((rule) => rule.id);
  const cases = uniqueMatches(
    Object.values(input.packages).join("\n"),
    /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g
  ).filter((value) => !/^(?:REQ|RULE)-/u.test(value));
  const normalized = {
    schemaVersion: REVIEW_READINESS_SCHEMA_VERSION,
    complete: issues.length === 0,
    counts: {
      requirements: requirements.length,
      rules: rules.length,
      cases: cases.length,
      packages: Object.keys(input.packages).length
    },
    issues: [...new Set(issues)].sort(),
    warnings: [...new Set(warnings)].sort()
  };
  return {
    ...normalized,
    digest: createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex")
  };
}
