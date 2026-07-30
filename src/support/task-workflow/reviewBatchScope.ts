import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";

export const REVIEW_BATCH_SCOPE_SCHEMA_VERSION = "review-batch-scope-v1" as const;

export interface ReusedReviewerEvidence {
  activityId: string;
  role: string;
  batchId: string;
  inputDigest: string;
  planEvidenceDigest: string;
}

export interface ReviewBatchScope {
  schemaVersion: typeof REVIEW_BATCH_SCOPE_SCHEMA_VERSION;
  mode: "full" | "targeted";
  requiredActivityIds: string[];
  affectedRefs: string[];
  excludedRefs: string[];
  reason: string;
  baseBatchId?: string;
  reusedReviewerEvidence: ReusedReviewerEvidence[];
}

export interface BuildReviewBatchScopeInput {
  allActivityIds: string[];
  requiredActivityIds?: string[];
  affectedRefs?: string[];
  excludedRefs?: string[];
  reason?: string;
  baseBatchId?: string;
  reusableEvidence?: ReusedReviewerEvidence[];
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
): ReviewBatchScope {
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

export function reviewBatchScopeDigest(scope: ReviewBatchScope): string {
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
    .update(canonicalJson(normalized), "utf8")
    .digest("hex");
}

export function parseReviewBatchScope(value: unknown): ReviewBatchScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review batch scope must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REVIEW_BATCH_SCOPE_SCHEMA_VERSION) {
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
  return scope;
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
