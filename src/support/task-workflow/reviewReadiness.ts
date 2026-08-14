import { createHash } from "node:crypto";
import { evaluateTestcasePackage } from "./packageCompleteness.js";
import { canonicalJson } from "./canonicalJson.js";
import {
  parseRuleCaseRecords,
  validateRelationProjection,
  validateRuleDesignMatrix
} from "../testcase/relationProjection.js";

export const REVIEW_READINESS_SCHEMA_VERSION = "review-readiness-v1" as const;

export interface ReviewReadinessReport {
  schemaVersion: typeof REVIEW_READINESS_SCHEMA_VERSION;
  complete: boolean;
  digest: string;
  counts: {
    requirements: number;
    rules: number;
    cases: number;
    packages: number;
  };
  issues: string[];
  warnings: string[];
}

export interface ReviewReadinessInput {
  plan: string;
  packages: Record<string, string>;
  writesData: boolean;
}

const requiredPlanMarkers: Array<{ label: string; alternatives: string[] }> = [
  { label: "## 输入资料", alternatives: ["## 输入资料"] },
  {
    label: "覆盖基准",
    alternatives: [
      "## 覆盖基准与拆分清单",
      "## 测试设计技术与依据",
      "## 覆盖矩阵"
    ]
  },
  { label: "## 需求追溯矩阵", alternatives: ["## 需求追溯矩阵"] },
  { label: "## 规则覆盖台账", alternatives: ["## 规则覆盖台账"] },
  {
    label: "结构版本：rule-design-matrix-v1",
    alternatives: ["结构版本：rule-design-matrix-v1"]
  }
];

const requiredV2PlanMarkers: Array<{ label: string; alternatives: string[] }> = [
  { label: "## 资料来源", alternatives: ["## 资料来源"] },
  { label: "## 测试范围", alternatives: ["## 测试范围"] },
  {
    label: "## 环境、静态资产与数据安全边界",
    alternatives: ["## 环境、静态资产与数据安全边界"]
  },
  { label: "## 需求索引", alternatives: ["## 需求索引"] },
  { label: "## 规则设计台账", alternatives: ["## 规则设计台账"] },
  { label: "rule-design-ledger-v2", alternatives: ["rule-design-ledger-v2"] },
  { label: "## 用例包目录", alternatives: ["## 用例包目录"] },
  { label: "## 假设、缺口与风险", alternatives: ["## 假设、缺口与风险"] },
  { label: "## 评审记录", alternatives: ["## 评审记录"] }
];

function uniqueMatches(value: string, pattern: RegExp): string[] {
  return [...new Set(value.match(pattern) ?? [])].sort();
}

function testcaseBodies(source: string): string[] {
  return source
    .split(/^## 测试用例[：:]/m)
    .slice(1)
    .map((body) => body.trim())
    .filter(Boolean);
}

function testcaseId(body: string): string {
  return body.match(/^\|\s*用例编号\s*\|\s*([^|]+?)\s*\|/m)?.[1]?.trim() ?? "unknown-case";
}

function markdownSection(body: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${heading}[^\\n]*$`, "m");
  const match = pattern.exec(body);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  return rest.slice(0, next?.index).trim();
}

function sourceIdentityIssues(packages: Record<string, string>): string[] {
  const issues: string[] = [];
  for (const [name, source] of Object.entries(packages)) {
    const v2 = /结构版本[：:]\s*testcase-v2\b/u.test(source);
    for (const body of testcaseBodies(source)) {
      const caseId = testcaseId(body);
      const section = markdownSection(body, "来源");
      if (v2) {
        if (!/\bSRC-[A-Z0-9][A-Z0-9-]*\b/.test(section)) {
          issues.push(`${name}:${caseId} 来源缺少稳定来源 ID。`);
        }
        if (!/\[[^\]]+\]\([^)]+\)|(?:章节|页面|字段)/.test(section)) {
          issues.push(`${name}:${caseId} 来源缺少可点击链接或精确定位。`);
        }
        continue;
      }
      if (!/\bmanifest\b/i.test(section)) {
        issues.push(`${name}:${caseId} 来源缺少 manifest id。`);
      }
      if (!/\bsectionId\b/i.test(section)) {
        issues.push(`${name}:${caseId} 来源缺少 sectionId。`);
      }
      if (!/\b[a-f0-9]{64}\b/.test(section)) {
        issues.push(`${name}:${caseId} 来源缺少 SHA-256。`);
      }
    }
  }
  return issues;
}

function writeSafetyWarnings(packages: Record<string, string>): string[] {
  const warnings: string[] = [];
  for (const [name, source] of Object.entries(packages)) {
    for (const body of testcaseBodies(source)) {
      if (!/\|\s*数据策略\s*\|\s*(?:managed_cleanup|tracked_residual)\s*\|/.test(body)) {
        continue;
      }
      const caseId = testcaseId(body);
      const safetyEvidence = body.replace(
        /^\|\s*数据策略\s*\|\s*(?:managed_cleanup|tracked_residual)\s*\|.*$/gm,
        ""
      );
      if (!/执行清单/.test(safetyEvidence)) {
        warnings.push(`${name}:${caseId} 未显式引用不可变执行清单。`);
      }
      if (!/(?:cleanup|清理|残留)/i.test(safetyEvidence)) {
        warnings.push(`${name}:${caseId} 未显式说明 cleanup 或残留处置。`);
      }
      if (!/(?:reconcil|核对|后置查询)/i.test(safetyEvidence)) {
        warnings.push(`${name}:${caseId} 未显式说明未知结果核对。`);
      }
    }
  }
  return warnings;
}

export function evaluateReviewReadiness(
  input: ReviewReadinessInput
): ReviewReadinessReport {
  const issues: string[] = [];
  const v2 = input.plan.includes("rule-design-ledger-v2");
  for (const marker of v2 ? requiredV2PlanMarkers : requiredPlanMarkers) {
    if (!marker.alternatives.some((value) => input.plan.includes(value))) {
      issues.push(`plan.md 缺少 ${marker.label}。`);
    }
  }

  for (const [name, source] of Object.entries(input.packages)) {
    const completeness = evaluateTestcasePackage(source);
    if (!completeness.complete) {
      issues.push(`${name} 不完整：${completeness.reasons.join(" ")}`);
    }
  }
  issues.push(
    ...validateRuleDesignMatrix(input.plan).map((issue) => issue.detail),
    ...validateRelationProjection(input.plan, input.packages).map((issue) => issue.detail),
    ...sourceIdentityIssues(input.packages)
  );

  const warnings = input.writesData ? writeSafetyWarnings(input.packages) : [];
  const requirements = uniqueMatches(input.plan, /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g);
  const rules = parseRuleCaseRecords(input.plan).map((rule) => rule.id);
  const cases = uniqueMatches(
    Object.values(input.packages).join("\n"),
    /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g
  ).filter((value) => !/^(?:REQ|RULE)-/.test(value));
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
    digest: createHash("sha256")
      .update(canonicalJson(normalized), "utf8")
      .digest("hex")
  };
}
