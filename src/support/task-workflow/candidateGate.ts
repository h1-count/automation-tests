import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import { evaluateReviewReadiness } from "./reviewReadiness.js";
import { assessCaseReviewRisk } from "./caseReviewRisk.js";
import {
  markdownSection,
  markdownTableRows,
  parseRuleCaseRecords
} from "../testcase/relationProjection.js";
import {
  isCurrentTestcaseDocumentVersion,
  parseTestcaseDocument,
  TESTCASE_V6_LAYERED_MARKER,
  testcaseV6LayeredSemanticProjection,
  validateTestcaseV6Layered
} from "../testcase/testcaseDocument.js";

export const CANDIDATE_GATE_SCHEMA_VERSION = "candidate-gate-v1" as const;

export type CandidateGenerationProfile = "lean" | "strict";
export type CandidateReviewMode =
  | "deterministic_only"
  | "combined"
  | "combined_with_impact";

export interface CandidateGateReport {
  schemaVersion: typeof CANDIDATE_GATE_SCHEMA_VERSION;
  profile: CandidateGenerationProfile;
  reviewMode: CandidateReviewMode;
  effectiveWritesData: boolean;
  effectiveDataStrategies: string[];
  issues: string[];
  warnings: string[];
  digest: string;
}

export interface CandidateGateInput {
  plan: string;
  cases: string;
}

export interface CandidateSourceImpact {
  changedSourceIds: string[];
  affectedRuleIds: string[];
  affectedCaseIds: string[];
  fullReplanRequired: boolean;
}

const dataStrategies = [
  "no_write",
  "ephemeral_cleanup",
  "reusable_fixture",
  "tracked_residual"
] as const;

const strictRisk = /(?:\bprod(?:uction)?\b|生产环境|真实数据|归属未知|批量|不可逆|权限提升|安全挑战|滑块|图形验证码|人机验证|\bOTP\b|设备动作|控制硬件|刷固件|断网|结果未知|无法判定|来源冲突|未定义验收)/iu;
const impactRisk = /(?:ephemeral_cleanup|reusable_fixture|tracked_residual|写入|新增|创建|修改|更新|删除|上传|提交|权限|安全挑战|验证码|\bOTP\b|设备|\bMQTT\b|结果未知|无法判定)/iu;
const combinedRisk = /(?:来源冲突|未定义验收|待确认|决策表|状态迁移|状态流转|角色差异|多条件)/iu;
const secretLiteral = /(?:password|passwd|token|secret|cookie|authorization|验证码|口令)\s*(?:=|:|\|)\s*(?!<|\$\{|\*{3,}|\[?REDACTED\]?)["'`]?[^\s|"'`]{6,}/iu;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function metadata(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of markdownTableRows(markdownSection(body, "## 基本信息"))) {
    if (row.length >= 2 && row[0] && row[0] !== "项目") result.set(row[0], row[1] ?? "");
  }
  return result;
}

function caseBodies(cases: string): string[] {
  return cases
    .split(/^## 测试用例[：:]/mu)
    .slice(1)
    .map((body) => body.trim())
    .filter(Boolean);
}

function requestDefaults(plan: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of markdownTableRows(markdownSection(plan, "## 请求默认值"))) {
    if (row.length >= 2 && row[0] && row[0] !== "项目") result.set(row[0], row[1] ?? "");
  }
  return result;
}

function sourceIssues(plan: string): string[] {
  const sourceRows = markdownTableRows(markdownSection(plan, "## 请求内来源"))
    .filter((row) => /^SRC-[A-Z0-9-]+$/u.test(row[0] ?? ""));
  const sourceIds = new Set(sourceRows.map((row) => row[0]!));
  const issues: string[] = [];
  if (!sourceRows.length) issues.push("请求内来源至少需要一条实际读取的来源。");
  for (const row of sourceRows) {
    if (!/\b[a-f0-9]{64}\b/u.test(row[2] ?? "")) {
      issues.push(`${row[0]} 缺少 SHA-256。`);
    }
    if (!row[1]?.trim() || /<[^>]+>|待填写|待补充/u.test(row[1])) {
      issues.push(`${row[0]} 缺少可点击路径或精确定位。`);
    }
  }
  const ruleRows = markdownTableRows(markdownSection(plan, "## 规则设计台账"))
    .filter((row) => /^RULE-[A-Z0-9-]+$/u.test(row[0] ?? ""));
  for (const row of ruleRows) {
    const refs = unique((row[2] ?? "").match(/\bSRC-[A-Z0-9-]+\b/gu) ?? []);
    if (!refs.length) issues.push(`${row[0]} 缺少 sourceRef。`);
    for (const ref of refs) {
      if (!sourceIds.has(ref)) issues.push(`${row[0]} 引用未登记来源 ${ref}。`);
    }
  }
  return issues;
}

function strictCaseIssues(plan: string, cases: string): string[] {
  const document = parseTestcaseDocument(cases);
  if (document.version === TESTCASE_V6_LAYERED_MARKER) {
    const riskRank = new Map([
      ["低", 0], ["low", 0], ["light", 0],
      ["中", 1], ["medium", 1], ["standard", 1],
      ["高", 2], ["high", 2], ["strict", 2]
    ]);
    let derivedRiskByCase = new Map<string, string>();
    let riskAssessmentIssue = "";
    try {
      derivedRiskByCase = new Map(
        assessCaseReviewRisk(cases, { plan }).cases.map((item) => [item.caseId, item.level])
      );
    } catch (error) {
      riskAssessmentIssue = error instanceof Error ? error.message : String(error);
    }
    const sourcesByRule = new Map(
      markdownTableRows(markdownSection(plan, "## 规则设计台账"))
        .filter((row) => /^RULE-[A-Z0-9-]+$/u.test(row[0] ?? ""))
        .map((row) => [
          row[0]!,
          unique((row[2] ?? "").match(/\bSRC-[A-Z0-9-]+\b/gu) ?? [])
        ])
    );
    return document.cases.flatMap((testcase) => {
      const issues: string[] = [];
      if (riskAssessmentIssue) {
        issues.push(`${document.version} 无法派生有效风险：${riskAssessmentIssue}`);
      }
      if (!(testcase.overrides.environment ?? document.defaults.environment)?.trim()) {
        issues.push(`${testcase.caseId} strict 模式缺少有效目标环境。`);
      }
      if (!(testcase.overrides.dataStrategy ?? document.defaults.dataStrategy)?.trim()) {
        issues.push(`${testcase.caseId} strict 模式缺少有效数据策略。`);
      }
      const sourceRefs = unique([
        ...testcase.ruleIds.flatMap((ruleId) => sourcesByRule.get(ruleId) ?? []),
        ...testcase.overrides.sourceRefs
      ]);
      if (!sourceRefs.length) issues.push(`${testcase.caseId} strict 模式缺少有效来源链。`);
      const derivedRisk = derivedRiskByCase.get(testcase.caseId) ?? "standard";
      const explicitRisk = testcase.overrides.risk?.trim().toLowerCase();
      if (explicitRisk && (riskRank.get(explicitRisk) ?? -1) < (riskRank.get(derivedRisk) ?? 1)) {
        issues.push(`${testcase.caseId} 显式风险不得低于系统派生风险 ${derivedRisk}。`);
      }
      return issues;
    });
  }
  return [`candidate-gate-v1 只接受 ${TESTCASE_V6_LAYERED_MARKER}，实际为 ${document.version}。`];
}

export function evaluateCandidateGate(input: CandidateGateInput): CandidateGateReport {
  const defaults = requestDefaults(input.plan);
  const defaultStrategy = defaults.get("数据策略")?.replace(/`/gu, "").trim() ?? "";
  const document = parseTestcaseDocument(input.cases);
  const bodies = caseBodies(input.cases);
  const strategies = unique(isCurrentTestcaseDocumentVersion(document.version)
    ? document.cases.map((testcase) =>
      testcase.overrides.dataStrategy?.replace(/`/gu, "").trim() || defaultStrategy
    )
    : bodies.map((body) => {
      const values = metadata(body);
      return (
        values.get("数据策略覆盖")
        ?? values.get("数据策略")
        ?? defaultStrategy
      ).replace(/`/gu, "").trim();
    }));
  const issues = [
    ...(!isCurrentTestcaseDocumentVersion(document.version)
      ? [`新候选用例必须使用 ${TESTCASE_V6_LAYERED_MARKER}，${document.version} 仅允许历史回放。`]
      : []),
    ...evaluateReviewReadiness({
      plan: input.plan,
      packages: { "cases.md": input.cases },
      writesData: strategies.some((strategy) => strategy !== "no_write")
    }).issues,
    ...sourceIssues(input.plan),
    ...(document.version === TESTCASE_V6_LAYERED_MARKER ? validateTestcaseV6Layered(input.cases) : [])
  ];
  if (isCurrentTestcaseDocumentVersion(document.version)) {
    for (const [label, caseValue, planValue] of [
      ["测试类型", document.defaults.testType, defaults.get("测试类型")],
      ["目标环境", document.defaults.environment, defaults.get("目标环境")],
      ["数据策略", document.defaults.dataStrategy, defaults.get("数据策略")]
    ] as const) {
      if (caseValue?.replace(/`/gu, "").trim() !== planValue?.replace(/`/gu, "").trim()) {
        issues.push(`用例集默认${label}与 plan.md 请求默认值不一致。`);
      }
    }
  }
  if (!dataStrategies.includes(defaultStrategy as typeof dataStrategies[number])) {
    issues.push(`请求默认数据策略无效：${defaultStrategy || "未填写"}。`);
  }
  for (const strategy of strategies) {
    if (!dataStrategies.includes(strategy as typeof dataStrategies[number])) {
      issues.push(`用例数据策略无效：${strategy || "未填写"}。`);
    }
  }
  const riskCases = isCurrentTestcaseDocumentVersion(document.version)
    ? testcaseV6LayeredSemanticProjection(input.cases)
    : input.cases;
  const fullText = `${input.plan}\n${riskCases}`;
  if (secretLiteral.test(fullText)) issues.push("候选用例集疑似包含敏感值字面量。");

  const profile: CandidateGenerationProfile = strictRisk.test(fullText) ? "strict" : "lean";
  if (profile === "strict") issues.push(...strictCaseIssues(input.plan, input.cases));
  const effectiveWritesData = strategies.some((strategy) => strategy !== "no_write");
  const hasImpactRisk = profile === "strict" || effectiveWritesData || impactRisk.test(fullText);
  const hasCombinedRisk = combinedRisk.test(fullText);
  const reviewMode: CandidateReviewMode = hasImpactRisk
    ? "combined_with_impact"
    : hasCombinedRisk
      ? "combined"
      : "deterministic_only";
  const warnings = unique([
    ...(hasCombinedRisk ? ["候选集包含需要 reviewer 或用户确认的语义风险。"] : []),
    ...(profile === "lean" && hasImpactRisk
      ? ["普通写入保持 lean 结构，但必须经过 impact reviewer 和独立执行确认。"]
      : [])
  ]);
  const normalized = {
    schemaVersion: CANDIDATE_GATE_SCHEMA_VERSION,
    profile,
    reviewMode,
    effectiveWritesData,
    effectiveDataStrategies: strategies,
    issues: unique(issues),
    warnings
  };
  return {
    ...normalized,
    digest: createHash("sha256")
      .update(canonicalJson(normalized), "utf8")
      .digest("hex")
  };
}

export function candidateReviewRoles(report: CandidateGateReport): string[] {
  if (report.reviewMode === "deterministic_only") return [];
  if (report.reviewMode === "combined") return ["combined"];
  return ["combined", "impact"];
}

export function candidateCaseIds(input: CandidateGateInput): string[] {
  return unique(parseRuleCaseRecords(input.plan).flatMap((rule) => rule.caseIds));
}

function sourceDigests(plan: string): Map<string, string> {
  return new Map(markdownTableRows(markdownSection(plan, "## 请求内来源"))
    .filter((row) => /^SRC-[A-Z0-9-]+$/u.test(row[0] ?? ""))
    .map((row) => [
      row[0]!,
      row[2]?.match(/\b[a-f0-9]{64}\b/u)?.[0] ?? ""
    ]));
}

function sourceRuleCases(plan: string): Array<{
  ruleId: string;
  sourceIds: string[];
  caseIds: string[];
}> {
  return markdownTableRows(markdownSection(plan, "## 规则设计台账"))
    .filter((row) => /^RULE-[A-Z0-9-]+$/u.test(row[0] ?? ""))
    .map((row) => ({
      ruleId: row[0]!,
      sourceIds: unique((row[2] ?? "").match(/\bSRC-[A-Z0-9-]+\b/gu) ?? []),
      caseIds: unique(parseRuleCaseRecords(plan)
        .find((rule) => rule.id === row[0])?.caseIds ?? [])
    }));
}

/** Computes local invalidation for request sources without changing history. */
export function candidateSourceImpact(
  previousPlan: string,
  currentPlan: string
): CandidateSourceImpact {
  const previous = sourceDigests(previousPlan);
  const current = sourceDigests(currentPlan);
  const changedSourceIds = unique([...previous.keys(), ...current.keys()].filter((sourceId) =>
    previous.get(sourceId) !== current.get(sourceId)
  ));
  const changed = new Set(changedSourceIds);
  const relatedRules = [...sourceRuleCases(previousPlan), ...sourceRuleCases(currentPlan)]
    .filter((rule) => rule.sourceIds.some((sourceId) => changed.has(sourceId)));
  const affectedRuleIds = unique(relatedRules.map((rule) => rule.ruleId));
  const affectedCaseIds = unique(relatedRules.flatMap((rule) => rule.caseIds));
  return {
    changedSourceIds,
    affectedRuleIds,
    affectedCaseIds,
    fullReplanRequired: relatedRules.some((rule) => rule.caseIds.length === 0)
  };
}
