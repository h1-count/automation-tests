import type {
  LegacyReviewPolicy,
  ReviewPolicy,
  ReviewRole,
  TieredReviewPolicy,
  WorkflowCapability
} from "./types.js";

export const defaultReviewRoles: readonly ReviewRole[] = [
  "requirements",
  "design",
  "traceability"
];

export type ReviewRiskProfile = "light" | "standard" | "strict";

export interface ReviewRiskSelectionInput {
  planText: string;
  writesData: boolean;
  capabilities: readonly WorkflowCapability[];
  casePackages: readonly string[];
}

export interface ReviewRiskSelection {
  profile: ReviewRiskProfile;
  recommendedRoles: ReviewRole[];
  reasons: string[];
}

export interface BuildReviewPolicyInput {
  reviewerRoles?: readonly ReviewRole[];
  writesData: boolean;
  maxAttemptsPerRole?: number;
  maxUnchangedRevisionCycles?: number;
  maxSemanticEvolutionCycles?: number;
  /**
   * The risk context is optional so historical callers keep their pinned
   * three-role default. New workflow creation should provide all three fields.
   */
  planText?: string;
  capabilities?: readonly WorkflowCapability[];
  casePackages?: readonly string[];
}

const standardComplexityLimits = {
  requirements: 6,
  rules: 6,
  cases: 8
} as const;

const strictPlanMarkers = [
  {
    key: "otp",
    pattern: /\bOTP\b|短信验证码|手机验证码|手机号验证|发送验证码|获取验证码/iu
  },
  {
    key: "permission",
    pattern: /权限|特权操作/iu
  },
  {
    key: "device",
    pattern: /设备|控制硬件|刷固件|断网|MQTT/iu
  },
  {
    key: "security_challenge",
    pattern: /安全挑战|滑块|图形验证码|人机验证|\bCAPTCHA\b/iu
  },
  {
    key: "sensitive_credential",
    pattern: /敏感凭据|密码凭据|口令|密钥|\btoken\b/iu
  },
  {
    key: "unknown_result",
    pattern: /结果未知|无法判定|\breconciliation\b/iu
  }
] as const;

const standardPlanMarkers = [
  {
    key: "data_write",
    pattern: /\b(?:managed_cleanup|ephemeral_cleanup|reusable_fixture|tracked_residual)\b|(?<!无)(?<!不)(?<!禁止)写入|外部副作用|提交申请/iu
  },
  {
    key: "upload",
    pattern: /上传/iu
  }
] as const;

const strictCasePackageMarkers = [
  "otp",
  "captcha",
  "permission",
  "device",
  "firmware",
  "mqtt",
  "security"
] as const;

const standardCasePackageMarkers = ["upload", "create", "update", "delete"] as const;

function uniqueNormalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueMatches(planText: string, pattern: RegExp): number {
  return new Set([...planText.matchAll(pattern)].map((match) => match[0])).size;
}

function structuredPlanText(planText: string): string {
  const selected: string[] = [];
  const headings = new Map<number, string>();
  let excludedAtLevel: number | undefined;

  for (const sourceLine of planText.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      for (const existingLevel of [...headings.keys()]) {
        if (existingLevel >= level) headings.delete(existingLevel);
      }
      headings.set(level, heading[2]!.trim());
      if (excludedAtLevel !== undefined && level <= excludedAtLevel) {
        excludedAtLevel = undefined;
      }
      if (/^(?:不包含|排除|非目标|Out of Scope)/iu.test(heading[2]!.trim())) {
        excludedAtLevel = level;
      }
      continue;
    }
    if (!line || excludedAtLevel !== undefined) continue;

    const activeSection = [...headings.values()].join("/");
    const isTableRow = line.startsWith("|");
    const isExplicitMarker = /(?:review-risk|风险标记)\s*[:：=]/iu.test(line);
    const isRiskSectionEntry = /^[-*]\s+/u.test(line)
      && /测试范围|安全|数据|副作用|权限|风险|执行|门禁/iu.test(activeSection);
    if (isTableRow || isExplicitMarker || isRiskSectionEntry) {
      selected.push(line);
    }
  }
  return selected.join("\n");
}

function caseIdCount(planText: string): number {
  const matches = [...planText.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d{3}\b/gu)]
    .map((match) => match[0]!)
    .filter((value) => !/^(?:REQ|RULE|REV|MRR|EVO)-/u.test(value));
  return new Set(matches).size;
}

/**
 * Selects the smallest reviewer set that still covers the plan's durable risk
 * markers. Reasons are stable machine-readable facts suitable for audit logs.
 */
export function deriveReviewRiskSelection(
  input: ReviewRiskSelectionInput
): ReviewRiskSelection {
  const capabilities = uniqueNormalized(input.capabilities).sort();
  const casePackages = uniqueNormalized(input.casePackages).sort();
  const structuredPlan = structuredPlanText(input.planText);
  const requirementCount = uniqueMatches(input.planText, /\bREQ-[A-Z0-9-]+\b/gu);
  const ruleCount = uniqueMatches(input.planText, /\bRULE-[A-Z0-9-]+\b/gu);
  const cases = caseIdCount(input.planText);
  const strictReasons: string[] = [];
  const standardReasons: string[] = [];

  if (input.writesData) standardReasons.push("writes_data");
  for (const capability of capabilities) {
    if (capability === "iot" || capability === "mqtt") {
      strictReasons.push(`device_capability:${capability}`);
    }
  }
  for (const marker of strictPlanMarkers) {
    if (marker.pattern.test(structuredPlan)) {
      strictReasons.push(`plan_marker:${marker.key}`);
    }
  }
  for (const marker of standardPlanMarkers) {
    if (marker.pattern.test(structuredPlan)) {
      standardReasons.push(`plan_marker:${marker.key}`);
    }
  }
  for (const casePackage of casePackages) {
    const normalized = casePackage.toLowerCase();
    for (const marker of strictCasePackageMarkers) {
      if (new RegExp(`(?:^|-)${marker}(?:-|\\.)`, "u").test(normalized)) {
        strictReasons.push(`case_package_marker:${marker}`);
      }
    }
    for (const marker of standardCasePackageMarkers) {
      if (new RegExp(`(?:^|-)${marker}(?:-|\.)`, "u").test(normalized)) {
        standardReasons.push(`case_package_marker:${marker}`);
      }
    }
  }

  if (capabilities.length > 1) {
    standardReasons.push(`multiple_capabilities:${capabilities.length}`);
  }
  if (casePackages.length > 1) {
    standardReasons.push(`multiple_case_packages:${casePackages.length}`);
  }
  if (requirementCount >= standardComplexityLimits.requirements) {
    standardReasons.push(`requirement_count:${requirementCount}`);
  }
  if (ruleCount >= standardComplexityLimits.rules) {
    standardReasons.push(`rule_count:${ruleCount}`);
  }
  if (cases >= standardComplexityLimits.cases) {
    standardReasons.push(`case_count:${cases}`);
  }

  if (strictReasons.length) {
    return {
      profile: "strict",
      recommendedRoles: ["combined", "impact"],
      reasons: uniqueNormalized([...strictReasons, ...standardReasons])
    };
  }
  if (standardReasons.length) {
    return {
      profile: "standard",
      recommendedRoles: ["combined"],
      reasons: uniqueNormalized(standardReasons)
    };
  }
  return {
    profile: "light",
    recommendedRoles: [],
    reasons: [
      `bounded_structure:req=${requirementCount};rule=${ruleCount};case=${cases};capabilities=${capabilities.length};packages=${casePackages.length}`
    ]
  };
}

export function buildReviewPolicy(input: BuildReviewPolicyInput): ReviewPolicy {
  const explicitlySelected = uniqueNormalized(input.reviewerRoles ?? []) as ReviewRole[];
  const hasRiskContext = input.planText !== undefined
    || input.capabilities !== undefined
    || input.casePackages !== undefined;
  const riskSelection = hasRiskContext
    ? deriveReviewRiskSelection({
        planText: input.planText ?? "",
        writesData: input.writesData,
        capabilities: input.capabilities ?? [],
        casePackages: input.casePackages ?? []
      })
    : undefined;
  const automaticallySelected = riskSelection?.recommendedRoles ?? [
        ...defaultReviewRoles,
        ...(input.writesData ? ["impact" as const] : [])
      ];
  const selectedRoles = explicitlySelected.length
    ? explicitlySelected
    : automaticallySelected;
  const requiredRoles = uniqueNormalized([
    ...selectedRoles,
    ...(input.writesData ? ["impact" as const] : [])
  ]) as ReviewRole[];
  if (!riskSelection || explicitlySelected.length) {
    const policy: LegacyReviewPolicy = {
      schemaVersion: "review-policy-v1",
      requiredRoles,
      ...(riskSelection
        ? {
            riskProfile: riskSelection.profile,
            selectionReasons: [
              ...riskSelection.reasons,
              ...(explicitlySelected.length ? ["explicit_roles"] : [])
            ]
          }
        : {}),
      maxConcurrentReviewers: 3,
      maxAttemptsPerRole: input.maxAttemptsPerRole ?? 3,
      maxUnchangedRevisionCycles: input.maxUnchangedRevisionCycles ?? 2
    };
    validateReviewPolicy(policy);
    return policy;
  }
  const tieredRoles = riskSelection.recommendedRoles as TieredReviewPolicy["requiredRoles"];
  const mode: TieredReviewPolicy["mode"] = riskSelection.profile === "light"
    ? "deterministic_only"
    : riskSelection.profile === "standard"
      ? "combined"
      : "combined_with_impact";
  if (
    input.maxSemanticEvolutionCycles !== undefined
    && input.maxSemanticEvolutionCycles !== 2
  ) {
    throw new Error("review-policy-v2 requires maxSemanticEvolutionCycles = 2.");
  }
  if (input.maxAttemptsPerRole !== undefined && input.maxAttemptsPerRole !== 3) {
    throw new Error("review-policy-v2 requires maxAttemptsPerRole = 3.");
  }
  if (
    input.maxUnchangedRevisionCycles !== undefined
    && input.maxUnchangedRevisionCycles !== 2
  ) {
    throw new Error("review-policy-v2 requires maxUnchangedRevisionCycles = 2.");
  }
  const policy: TieredReviewPolicy = {
    schemaVersion: "review-policy-v2",
    mode,
    requiredRoles: tieredRoles,
    riskProfile: riskSelection.profile,
    selectionReasons: riskSelection.reasons,
    maxConcurrentReviewers: 2,
    maxAttemptsPerRole: 3,
    maxUnchangedRevisionCycles: 2,
    maxSemanticEvolutionCycles: 2
  };
  validateReviewPolicy(policy);
  return policy;
}

export function validateReviewPolicy(policy: ReviewPolicy): void {
  if (!["review-policy-v1", "review-policy-v2"].includes(policy.schemaVersion)) {
    throw new Error("Unsupported review policy schema.");
  }
  if (policy.requiredRoles.some((role) => !role.trim())) {
    throw new Error("Review policy reviewer roles must be non-empty.");
  }
  if (new Set(policy.requiredRoles).size !== policy.requiredRoles.length) {
    throw new Error("Review policy reviewer roles must be unique.");
  }
  if ((policy.riskProfile === undefined) !== (policy.selectionReasons === undefined)) {
    throw new Error("Review policy risk profile and selection reasons must be recorded together.");
  }
  if (
    policy.riskProfile !== undefined
    && !["light", "standard", "strict"].includes(policy.riskProfile)
  ) {
    throw new Error("Review policy has an unsupported risk profile.");
  }
  if (
    policy.selectionReasons !== undefined
    && (
      !policy.selectionReasons.length
      || policy.selectionReasons.some((reason) => !reason.trim())
      || new Set(policy.selectionReasons).size !== policy.selectionReasons.length
    )
  ) {
    throw new Error("Review policy selection reasons must be non-empty and unique.");
  }
  if (policy.schemaVersion === "review-policy-v1" && policy.maxConcurrentReviewers !== 3) {
    throw new Error("Legacy review policy maxConcurrentReviewers must be 3.");
  }
  if (policy.schemaVersion === "review-policy-v2") {
    const expectedRoles = policy.mode === "deterministic_only"
      ? []
      : policy.mode === "combined"
        ? ["combined"]
        : ["combined", "impact"];
    if (
      policy.maxConcurrentReviewers !== 2
      || policy.maxAttemptsPerRole !== 3
      || policy.maxUnchangedRevisionCycles !== 2
      || policy.requiredRoles.length !== expectedRoles.length
      || policy.requiredRoles.some((role, index) => role !== expectedRoles[index])
    ) {
      throw new Error("Tiered review policy mode, roles and fixed limits must agree.");
    }
    if (policy.maxSemanticEvolutionCycles !== 2) {
      throw new Error("Tiered review policy maxSemanticEvolutionCycles must be 2.");
    }
  }
  if (!Number.isInteger(policy.maxAttemptsPerRole) || policy.maxAttemptsPerRole < 1) {
    throw new Error("Review policy maxAttemptsPerRole must be a positive integer.");
  }
  if (!Number.isInteger(policy.maxUnchangedRevisionCycles) || policy.maxUnchangedRevisionCycles < 1) {
    throw new Error("Review policy maxUnchangedRevisionCycles must be a positive integer.");
  }
}
