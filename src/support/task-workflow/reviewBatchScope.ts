import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import {
  caseReviewRiskDigest,
  type CaseReviewRiskAssessment,
  type CaseReviewRiskLevel
} from "./caseReviewRisk.js";
import type { SafeJsonValue } from "./types.js";

export const REVIEW_BATCH_SCOPE_SCHEMA_VERSION = "review-batch-scope-v1" as const;
export const REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION = "review-batch-scope-v2" as const;
export const REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION = "review-batch-scope-v3" as const;

export interface ReusedReviewerEvidence {
  activityId: string;
  role: string;
  batchId: string;
  inputDigest: string;
  planEvidenceDigest: string;
}

interface ReviewBatchScopeBase {
  mode: "full" | "targeted";
  requiredActivityIds: string[];
  affectedRefs: string[];
  excludedRefs: string[];
  reason: string;
  baseBatchId?: string;
  reusedReviewerEvidence: ReusedReviewerEvidence[];
}

export interface ReviewBatchScopeV1 extends ReviewBatchScopeBase {
  schemaVersion: typeof REVIEW_BATCH_SCOPE_SCHEMA_VERSION;
}

export interface ReviewRoleCaseScope {
  activityId: string;
  role: string;
  caseIds: string[];
  requirementRefs: string[];
  ruleRefs: string[];
}

export interface ReviewBatchRiskSummary {
  schemaVersion: "case-review-risk-v1" | "case-review-risk-v2";
  distribution: "uniform" | "mixed";
  maxLevel: CaseReviewRiskLevel;
  counts: Record<CaseReviewRiskLevel, number>;
  assessmentDigest: string;
}

export interface ReviewBatchScopeV2 extends ReviewBatchScopeBase {
  schemaVersion: typeof REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION;
  riskSummary: ReviewBatchRiskSummary;
  roleScopes: ReviewRoleCaseScope[];
}

export interface ReviewBatchScopeV3 extends ReviewBatchScopeBase {
  schemaVersion: typeof REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION;
  riskSummary: ReviewBatchRiskSummary & { schemaVersion: "case-review-risk-v2" };
  roleScopes: ReviewRoleCaseScope[];
  reviewEpochDigest: string;
  semanticEvolutionCycle: number;
  adaptiveSemanticReview?: true;
}

export type ReviewBatchScope = ReviewBatchScopeV1 | ReviewBatchScopeV2 | ReviewBatchScopeV3;

export interface BuildReviewBatchScopeInput {
  allActivityIds: string[];
  requiredActivityIds?: string[];
  affectedRefs?: string[];
  excludedRefs?: string[];
  reason?: string;
  baseBatchId?: string;
  reusableEvidence?: ReusedReviewerEvidence[];
}

export interface BuildReviewBatchScopeV2Input extends BuildReviewBatchScopeInput {
  caseRiskAssessment: CaseReviewRiskAssessment;
  activityRoles: Array<{ activityId: string; role: string }>;
}

export interface BuildReviewBatchScopeV3Input extends BuildReviewBatchScopeV2Input {
  reviewEpochDigest: string;
  semanticEvolutionCycle: number;
  adaptiveSemanticReview?: boolean;
}

const digestPattern = /^[a-f0-9]{64}$/;
const activityPattern = /^[a-z0-9][a-z0-9-]*$/;
const batchPattern = /^[A-Za-z0-9._-]+$/;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function assertActivityId(value: string): void {
  if (!activityPattern.test(value)) {
    throw new Error(`Review scope activityId is invalid: ${value}`);
  }
}

function assertDigest(value: string, name: string): void {
  if (!digestPattern.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  }
}

function normalizeEvidence(value: ReusedReviewerEvidence): ReusedReviewerEvidence {
  assertActivityId(value.activityId);
  if (!value.role.trim()) throw new Error("Reused reviewer evidence requires a role.");
  if (!batchPattern.test(value.batchId)) {
    throw new Error(`Reused reviewer evidence batchId is invalid: ${value.batchId}`);
  }
  assertDigest(value.inputDigest, "Reused reviewer inputDigest");
  assertDigest(value.planEvidenceDigest, "Reused reviewer planEvidenceDigest");
  return {
    activityId: value.activityId,
    role: value.role.trim(),
    batchId: value.batchId,
    inputDigest: value.inputDigest,
    planEvidenceDigest: value.planEvidenceDigest
  };
}

export function buildReviewBatchScope(
  input: BuildReviewBatchScopeInput
): ReviewBatchScopeV1 {
  const allActivityIds = uniqueSorted(input.allActivityIds);
  if (!allActivityIds.length) throw new Error("Review scope requires review activities.");
  allActivityIds.forEach(assertActivityId);

  const requiredActivityIds = uniqueSorted(
    input.requiredActivityIds?.length ? input.requiredActivityIds : allActivityIds
  );
  requiredActivityIds.forEach(assertActivityId);
  const unknown = requiredActivityIds.filter((activityId) => !allActivityIds.includes(activityId));
  if (unknown.length) {
    throw new Error(`Review scope references unknown activities: ${unknown.join(", ")}.`);
  }

  const mode = requiredActivityIds.length === allActivityIds.length
    && requiredActivityIds.every((activityId) => allActivityIds.includes(activityId))
    ? "full"
    : "targeted";
  const affectedRefs = uniqueSorted(input.affectedRefs ?? []);
  const excludedRefs = uniqueSorted(input.excludedRefs ?? []);
  const reason = input.reason?.trim() || (mode === "full" ? "initial_full_review" : "");
  if (mode === "targeted") {
    if (!affectedRefs.length) {
      throw new Error("Targeted review scope requires affectedRefs.");
    }
    if (!reason) {
      throw new Error("Targeted review scope requires a reason.");
    }
    if (!input.baseBatchId || !batchPattern.test(input.baseBatchId)) {
      throw new Error("Targeted review scope requires a valid baseBatchId.");
    }
  }

  const required = new Set(requiredActivityIds);
  const reusedReviewerEvidence = (input.reusableEvidence ?? [])
    .map(normalizeEvidence)
    .filter((evidence) => !required.has(evidence.activityId))
    .sort((left, right) =>
      left.activityId.localeCompare(right.activityId)
      || left.role.localeCompare(right.role)
      || left.batchId.localeCompare(right.batchId)
    );
  const reusedByActivity = new Map(
    reusedReviewerEvidence.map((evidence) => [evidence.activityId, evidence])
  );
  if (reusedByActivity.size !== reusedReviewerEvidence.length) {
    throw new Error("Review scope may reuse at most one submission per activity.");
  }
  if (mode === "targeted") {
    const missingEvidence = allActivityIds
      .filter((activityId) => !required.has(activityId))
      .filter((activityId) => !reusedByActivity.has(activityId));
    if (missingEvidence.length) {
      throw new Error(
        `Targeted review scope lacks reusable evidence for: ${missingEvidence.join(", ")}.`
      );
    }
  } else if (reusedReviewerEvidence.length) {
    throw new Error("Full review scope cannot reuse prior reviewer submissions.");
  }

  return {
    schemaVersion: REVIEW_BATCH_SCOPE_SCHEMA_VERSION,
    mode,
    requiredActivityIds,
    affectedRefs,
    excludedRefs,
    reason,
    ...(mode === "targeted" ? { baseBatchId: input.baseBatchId! } : {}),
    reusedReviewerEvidence
  };
}

function assessmentSummary(assessment: CaseReviewRiskAssessment): ReviewBatchRiskSummary {
  if (!['case-review-risk-v1', 'case-review-risk-v2'].includes(assessment.schemaVersion)) {
    throw new Error("Review batch scope requires a supported case review risk assessment.");
  }
  const digest = caseReviewRiskDigest(assessment);
  if (assessment.digest !== digest) {
    throw new Error("Review batch scope case risk digest does not match its case assessments.");
  }
  const expectedCounts = {
    light: assessment.cases.filter((item) => item.level === "light").length,
    standard: assessment.cases.filter((item) => item.level === "standard").length,
    strict: assessment.cases.filter((item) => item.level === "strict").length
  };
  if (
    expectedCounts.light !== assessment.counts.light
    || expectedCounts.standard !== assessment.counts.standard
    || expectedCounts.strict !== assessment.counts.strict
  ) {
    throw new Error("Review batch scope case risk counts do not match its case assessments.");
  }
  return {
    schemaVersion: assessment.schemaVersion,
    distribution: assessment.distribution,
    maxLevel: assessment.maxLevel,
    counts: expectedCounts,
    assessmentDigest: digest
  };
}

function roleCaseScope(
  activityId: string,
  role: string,
  assessment: CaseReviewRiskAssessment,
  adaptiveSemanticReview = false,
  affectedRefs: readonly string[] = []
): ReviewRoleCaseScope {
  assertActivityId(activityId);
  const normalizedRole = role.trim();
  if (!normalizedRole) throw new Error("Review role scope requires a role.");
  const baseline = normalizedRole === "impact"
    ? assessment.cases.filter((item) => item.level === "strict")
    : normalizedRole === "combined"
      ? assessment.cases.filter((item) => adaptiveSemanticReview || item.level !== "light")
      : assessment.cases;
  // A scoped revision receives only its REQ -> RULE -> case closure. Empty,
  // global or broad closures intentionally fall back to the baseline scope:
  // narrowing ambiguous security/default-policy changes would hide risk.
  const refs = new Set(affectedRefs.map((value) => value.trim()).filter(Boolean));
  const globalRef = [...refs].some((value) => /请求默认值|数据策略|权限|安全|环境|default|security|permission/iu.test(value));
  const closure = refs.size && !globalRef
    ? assessment.cases.filter((item) =>
      refs.has(item.caseId)
      || item.requirementRefs.some((ref) => refs.has(ref))
      || item.ruleRefs.some((ref) => refs.has(ref))
    )
    : [];
  const selected = closure.length > 0 && closure.length <= 8
    ? baseline.filter((item) => closure.some((target) => target.caseId === item.caseId))
    : baseline;
  if (!selected.length && normalizedRole !== "impact") {
    throw new Error(`Review role ${normalizedRole} has no applicable case scope.`);
  }
  return {
    activityId,
    role: normalizedRole,
    caseIds: uniqueSorted(selected.map((item) => item.caseId)),
    requirementRefs: uniqueSorted(selected.flatMap((item) => item.requirementRefs)),
    ruleRefs: uniqueSorted(selected.flatMap((item) => item.ruleRefs))
  };
}

/**
 * Builds an explicit per-role case scope while retaining the v1 lifecycle
 * fields. Requirements/design reviewers receive the full case set; impact is
 * limited to strict cases and their direct REQ/RULE neighbourhood.
 */
export function buildReviewBatchScopeV2(
  input: BuildReviewBatchScopeV2Input
): ReviewBatchScopeV2 {
  const base = buildReviewBatchScope(input);
  const allActivityIds = uniqueSorted(input.allActivityIds);
  const activityRoles = input.activityRoles.map(({ activityId, role }) => ({
    activityId: activityId.trim(),
    role: role.trim()
  })).sort((left, right) => left.activityId.localeCompare(right.activityId));
  const activityRoleIds = activityRoles.map((item) => item.activityId);
  if (
    activityRoleIds.length !== allActivityIds.length
    || activityRoleIds.some((activityId, index) => activityId !== allActivityIds[index])
  ) {
    throw new Error("Review batch v2 activity roles must cover every review activity exactly once.");
  }
  if (new Set(activityRoleIds).size !== activityRoleIds.length) {
    throw new Error("Review batch v2 activity roles must be unique by activityId.");
  }
  const roleScopes = activityRoles.map(({ activityId, role }) =>
    roleCaseScope(activityId, role, input.caseRiskAssessment)
  );
  return {
    ...base,
    schemaVersion: REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION,
    riskSummary: assessmentSummary(input.caseRiskAssessment),
    roleScopes
  };
}

export function buildReviewBatchScopeV3(
  input: BuildReviewBatchScopeV3Input
): ReviewBatchScopeV3 {
  assertDigest(input.reviewEpochDigest, "reviewEpochDigest");
  if (
    !Number.isInteger(input.semanticEvolutionCycle)
    || input.semanticEvolutionCycle < 0
    || input.semanticEvolutionCycle > 2
  ) {
    throw new Error("Review batch semanticEvolutionCycle must be an integer from 0 to 2.");
  }
  const base = buildReviewBatchScope(input);
  const allActivityIds = uniqueSorted(input.allActivityIds);
  const activityRoles = input.activityRoles.map(({ activityId, role }) => ({
    activityId: activityId.trim(),
    role: role.trim()
  })).sort((left, right) => left.activityId.localeCompare(right.activityId));
  const activityRoleIds = activityRoles.map((item) => item.activityId);
  if (
    activityRoleIds.length !== allActivityIds.length
    || activityRoleIds.some((activityId, index) => activityId !== allActivityIds[index])
    || new Set(activityRoleIds).size !== activityRoleIds.length
  ) {
    throw new Error("Review batch v3 activity roles must cover every review activity exactly once.");
  }
  const riskSummary = assessmentSummary(input.caseRiskAssessment);
  if (riskSummary.schemaVersion !== "case-review-risk-v2") {
    throw new Error("Review batch v3 requires case-review-risk-v2.");
  }
  return {
    ...base,
    schemaVersion: REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION,
    riskSummary: riskSummary as ReviewBatchScopeV3["riskSummary"],
    roleScopes: activityRoles.map(({ activityId, role }) =>
      roleCaseScope(
        activityId,
        role,
        input.caseRiskAssessment,
        input.adaptiveSemanticReview,
        input.affectedRefs
      )
    ),
    reviewEpochDigest: input.reviewEpochDigest,
    semanticEvolutionCycle: input.semanticEvolutionCycle,
    ...(input.adaptiveSemanticReview ? { adaptiveSemanticReview: true as const } : {})
  };
}

export function reviewBatchScopeDigest(scope: ReviewBatchScope): string {
  if (scope.schemaVersion === REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION) {
    const normalized = normalizeV3Scope(scope);
    return createHash("sha256")
      .update(canonicalJson(normalized as unknown as SafeJsonValue), "utf8")
      .digest("hex");
  }
  if (scope.schemaVersion === REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION) {
    const normalized = normalizeV2Scope(scope);
    return createHash("sha256")
      .update(canonicalJson(normalized as unknown as SafeJsonValue), "utf8")
      .digest("hex");
  }
  const normalized = buildReviewBatchScope({
    allActivityIds: [
      ...scope.requiredActivityIds,
      ...scope.reusedReviewerEvidence.map((evidence) => evidence.activityId)
    ],
    requiredActivityIds: scope.requiredActivityIds,
    affectedRefs: scope.affectedRefs,
    excludedRefs: scope.excludedRefs,
    reason: scope.reason,
    baseBatchId: scope.baseBatchId,
    reusableEvidence: scope.reusedReviewerEvidence
  });
  return createHash("sha256")
    .update(canonicalJson(normalized as unknown as SafeJsonValue), "utf8")
    .digest("hex");
}

export function parseReviewBatchScope(value: unknown): ReviewBatchScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review batch scope must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== REVIEW_BATCH_SCOPE_SCHEMA_VERSION
    && record.schemaVersion !== REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION
    && record.schemaVersion !== REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported review batch scope schema.");
  }
  const requiredActivityIds = stringArray(record.requiredActivityIds, "requiredActivityIds");
  const reusedReviewerEvidence = Array.isArray(record.reusedReviewerEvidence)
    ? record.reusedReviewerEvidence.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error("Review batch reused evidence must be an object.");
        }
        const evidence = entry as Record<string, unknown>;
        return {
          activityId: stringValue(evidence.activityId, "activityId"),
          role: stringValue(evidence.role, "role"),
          batchId: stringValue(evidence.batchId, "batchId"),
          inputDigest: stringValue(evidence.inputDigest, "inputDigest"),
          planEvidenceDigest: stringValue(
            evidence.planEvidenceDigest,
            "planEvidenceDigest"
          )
        };
      })
    : (() => {
        throw new Error("Review batch scope requires reusedReviewerEvidence.");
      })();
  const scope = buildReviewBatchScope({
    allActivityIds: [
      ...requiredActivityIds,
      ...reusedReviewerEvidence.map((entry) => entry.activityId)
    ],
    requiredActivityIds,
    affectedRefs: stringArray(record.affectedRefs, "affectedRefs"),
    excludedRefs: stringArray(record.excludedRefs, "excludedRefs"),
    reason: stringValue(record.reason, "reason"),
    ...(record.baseBatchId === undefined
      ? {}
      : { baseBatchId: stringValue(record.baseBatchId, "baseBatchId") }),
    reusableEvidence: reusedReviewerEvidence
  });
  if (record.mode !== scope.mode) {
    throw new Error("Review batch scope mode does not match its activity set.");
  }
  if (record.schemaVersion === REVIEW_BATCH_SCOPE_SCHEMA_VERSION) return scope;
  const richScope = {
    ...scope,
    riskSummary: parseRiskSummary(record.riskSummary),
    roleScopes: parseRoleScopes(record.roleScopes)
  };
  if (record.schemaVersion === REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION) {
    return normalizeV2Scope({
      ...richScope,
      schemaVersion: REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION
    });
  }
  if (richScope.riskSummary.schemaVersion !== "case-review-risk-v2") {
    throw new Error("Review batch scope v3 requires case-review-risk-v2.");
  }
  return normalizeV3Scope({
    ...richScope,
    riskSummary: {
      ...richScope.riskSummary,
      schemaVersion: "case-review-risk-v2"
    },
    schemaVersion: REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION,
    reviewEpochDigest: stringValue(record.reviewEpochDigest, "reviewEpochDigest"),
    semanticEvolutionCycle: nonNegativeInteger(
      record.semanticEvolutionCycle,
      "semanticEvolutionCycle"
    ),
    ...(record.adaptiveSemanticReview === true
      ? { adaptiveSemanticReview: true as const }
      : {})
  });
}

function normalizeV3Scope(scope: ReviewBatchScopeV3): ReviewBatchScopeV3 {
  assertDigest(scope.reviewEpochDigest, "reviewEpochDigest");
  if (scope.semanticEvolutionCycle > 2) {
    throw new Error("Review batch v3 semantic evolution cycle exceeds policy.");
  }
  const normalized = normalizeV2Scope({
    ...scope,
    schemaVersion: REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION
  });
  if (normalized.riskSummary.schemaVersion !== "case-review-risk-v2") {
    throw new Error("Review batch v3 requires case-review-risk-v2.");
  }
  return {
    ...normalized,
    schemaVersion: REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION,
    riskSummary: normalized.riskSummary as ReviewBatchScopeV3["riskSummary"],
    reviewEpochDigest: scope.reviewEpochDigest,
    semanticEvolutionCycle: scope.semanticEvolutionCycle,
    ...(scope.adaptiveSemanticReview ? { adaptiveSemanticReview: true as const } : {})
  };
}

function normalizeV2Scope(scope: ReviewBatchScopeV2): ReviewBatchScopeV2 {
  const base = buildReviewBatchScope({
    allActivityIds: [
      ...scope.requiredActivityIds,
      ...scope.reusedReviewerEvidence.map((evidence) => evidence.activityId)
    ],
    requiredActivityIds: scope.requiredActivityIds,
    affectedRefs: scope.affectedRefs,
    excludedRefs: scope.excludedRefs,
    reason: scope.reason,
    baseBatchId: scope.baseBatchId,
    reusableEvidence: scope.reusedReviewerEvidence
  });
  const allActivityIds = uniqueSorted([
    ...base.requiredActivityIds,
    ...base.reusedReviewerEvidence.map((item) => item.activityId)
  ]);
  const roleScopes = scope.roleScopes.map(normalizeRoleScope)
    .sort((left, right) => left.activityId.localeCompare(right.activityId));
  const scopedActivityIds = roleScopes.map((item) => item.activityId);
  if (
    scopedActivityIds.length !== allActivityIds.length
    || scopedActivityIds.some((activityId, index) => activityId !== allActivityIds[index])
    || new Set(scopedActivityIds).size !== scopedActivityIds.length
  ) {
    throw new Error("Review batch v2 role scopes must cover every review activity exactly once.");
  }
  const riskSummary = parseRiskSummary(scope.riskSummary);
  const caseIds = uniqueSorted(roleScopes.flatMap((item) => item.caseIds));
  const adaptiveSemanticReview = (scope as unknown as { adaptiveSemanticReview?: true })
    .adaptiveSemanticReview === true;
  const excludesLight = riskSummary.schemaVersion === "case-review-risk-v2"
    && roleScopes.some((item) => item.role === "combined")
    && !adaptiveSemanticReview;
  const expectedCount = (excludesLight ? 0 : riskSummary.counts.light)
    + riskSummary.counts.standard
    + riskSummary.counts.strict;
  if (caseIds.length !== expectedCount) {
    throw new Error("Review batch v2 risk counts do not match its role case scope.");
  }
  return {
    ...base,
    schemaVersion: REVIEW_BATCH_SCOPE_V2_SCHEMA_VERSION,
    riskSummary,
    roleScopes
  };
}

function normalizeRoleScope(value: ReviewRoleCaseScope): ReviewRoleCaseScope {
  assertActivityId(value.activityId);
  if (!value.role.trim()) throw new Error("Review role scope requires a role.");
  const caseIds = uniqueSorted(value.caseIds);
  if (!caseIds.length && value.role.trim() !== "impact") {
    throw new Error(`Review role ${value.role} has no applicable case scope.`);
  }
  return {
    activityId: value.activityId,
    role: value.role.trim(),
    caseIds,
    requirementRefs: uniqueSorted(value.requirementRefs),
    ruleRefs: uniqueSorted(value.ruleRefs)
  };
}

function parseRoleScopes(value: unknown): ReviewRoleCaseScope[] {
  if (!Array.isArray(value)) throw new Error("Review batch v2 requires roleScopes.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Review batch role scope must be an object.");
    }
    const record = entry as Record<string, unknown>;
    return normalizeRoleScope({
      activityId: stringValue(record.activityId, "activityId"),
      role: stringValue(record.role, "role"),
      caseIds: stringArray(record.caseIds, "caseIds"),
      requirementRefs: stringArray(record.requirementRefs, "requirementRefs"),
      ruleRefs: stringArray(record.ruleRefs, "ruleRefs")
    });
  });
}

function parseRiskSummary(value: unknown): ReviewBatchRiskSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review batch v2 requires riskSummary.");
  }
  const record = value as Record<string, unknown>;
  const countsValue = record.counts;
  if (!countsValue || typeof countsValue !== "object" || Array.isArray(countsValue)) {
    throw new Error("Review batch v2 riskSummary requires counts.");
  }
  const counts = countsValue as Record<string, unknown>;
  const light = nonNegativeInteger(counts.light, "light");
  const standard = nonNegativeInteger(counts.standard, "standard");
  const strict = nonNegativeInteger(counts.strict, "strict");
  const maxLevel = stringValue(record.maxLevel, "maxLevel");
  const distribution = stringValue(record.distribution, "distribution");
  if (!["light", "standard", "strict"].includes(maxLevel)) {
    throw new Error("Review batch v2 riskSummary has an invalid maxLevel.");
  }
  if (!["uniform", "mixed"].includes(distribution)) {
    throw new Error("Review batch v2 riskSummary has an invalid distribution.");
  }
  if (!['case-review-risk-v1', 'case-review-risk-v2'].includes(String(record.schemaVersion))) {
    throw new Error("Review batch v2 riskSummary has an unsupported schemaVersion.");
  }
  const assessmentDigest = stringValue(record.assessmentDigest, "assessmentDigest");
  assertDigest(assessmentDigest, "Review batch v2 assessmentDigest");
  return {
    schemaVersion: record.schemaVersion as ReviewBatchRiskSummary["schemaVersion"],
    distribution: distribution as "uniform" | "mixed",
    maxLevel: maxLevel as CaseReviewRiskLevel,
    counts: { light, standard, strict },
    assessmentDigest
  };
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`Review batch scope ${name} must be a non-negative integer.`);
  }
  return Number(value);
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Review batch scope ${name} must be a string array.`);
  }
  return value as string[];
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Review batch scope ${name} must be a string.`);
  }
  return value;
}
