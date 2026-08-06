import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import type {
  SafeEventPayload,
  SafeJsonValue,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowProjection
} from "./types.js";
import { ReviewInputSnapshotStore } from "./reviewInputSnapshot.js";
import {
  parseReviewBatchScope,
  type ReviewBatchScope
} from "./reviewBatchScope.js";

export const REVIEWER_ISOLATION_PROOF_VERSION = "reviewer-isolation-proof-v1" as const;

export class ReviewInputDriftError extends Error {
  constructor(readonly batchId: string, readonly detail: string) {
    super(`Review batch ${batchId} input drifted; start a new batch. ${detail}`);
  }
}

export async function verifyOrRepairReviewSnapshot(
  store: ReviewInputSnapshotStore,
  events: WorkflowEvent[],
  batchId: string,
  activityId?: string
): Promise<string> {
  try {
    const snapshot = await store.verifyCurrentSources(batchId, activityId);
    return activityId
      ? snapshot.roleInputDigests?.[activityId] ?? snapshot.combinedDigest
      : snapshot.combinedDigest;
  } catch (error) {
    if (String(error).includes("input drifted")) {
      throw new ReviewInputDriftError(batchId, String(error));
    }
    const batch = events.find((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === batchId
    );
    const inputPaths = Array.isArray(batch?.payload.inputRefs)
      ? batch!.payload.inputRefs.flatMap((reference) =>
        reference && typeof reference === "object" && !Array.isArray(reference)
          && typeof (reference as Record<string, unknown>).path === "string"
          ? [(reference as Record<string, string>).path]
          : []
      )
      : [];
    if (!batch || !inputPaths.length || typeof batch.payload.inputDigest !== "string") {
      throw new Error(`Review batch ${batchId} has no repairable frozen input snapshot.`);
    }
    const scope = batch.payload.scope === undefined
      ? undefined
      : parseReviewBatchScope(batch.payload.scope);
    const repaired = await store.repair(batchId, inputPaths, scope);
    if (repaired.combinedDigest !== batch.payload.inputDigest) {
      throw new ReviewInputDriftError(batchId, "The recovered source digest differs from durable batch input.");
    }
    await store.verifyCurrentSources(batchId, activityId);
    return activityId
      ? repaired.roleInputDigests?.[activityId] ?? repaired.combinedDigest
      : repaired.combinedDigest;
  }
}

export function reviewerBindingId(activityId: string, role: string, batchId: string): string {
  return `${batchId}:${activityId}:${role}`;
}

export function reviewBatchStarted(
  events: readonly WorkflowEvent[],
  batchId: string
): WorkflowEvent | undefined {
  return events.find((event) =>
    event.type === "ReviewBatchStarted"
    && event.payload.batchId === batchId
  );
}

export function reviewBatchActivityIds(
  events: readonly WorkflowEvent[],
  batchId: string
): string[] {
  return [...new Set(events.flatMap((event) =>
    event.type === "ReviewerDispatched"
    && event.payload.batchId === batchId
    && typeof event.payload.activityId === "string"
      ? [event.payload.activityId]
      : []
  ))];
}

export function reviewBatchCoveredActivityIds(
  events: readonly WorkflowEvent[],
  batchId: string
): string[] {
  const batch = reviewBatchStarted(events, batchId);
  if (!batch || typeof batch.payload.inputDigest !== "string") return [];
  const reused = batch.payload.scope === undefined
    ? []
    : parseReviewBatchScope(batch.payload.scope).reusedReviewerEvidence
      .map((evidence) => evidence.activityId);
  const roleInputDigests = batch.payload.roleInputDigests;
  const submitted = events.flatMap((event) =>
    event.type === "ReviewerSubmitted"
    && event.payload.batchId === batchId
    && typeof event.payload.activityId === "string"
    && event.payload.inputDigest === (
      roleInputDigests
      && typeof roleInputDigests === "object"
      && !Array.isArray(roleInputDigests)
      && typeof (roleInputDigests as Record<string, unknown>)[event.payload.activityId] === "string"
        ? (roleInputDigests as Record<string, string>)[event.payload.activityId]
        : batch.payload.inputDigest
    )
      ? [event.payload.activityId]
      : []
  );
  return [...new Set([...reused, ...submitted])].sort();
}

export function latestReviewerDispatch(
  events: readonly WorkflowEvent[],
  activityId: string
): WorkflowEvent | undefined {
  const latestInvalidationSeq = [...events].reverse().find((event) =>
    (event.type === "ReviewBatchInvalidated" || event.type === "ActivitiesInvalidated")
    && Array.isArray(event.payload.activityIds)
    && event.payload.activityIds.includes(activityId)
  )?.seq ?? 0;
  return [...events].reverse().find((event) =>
    event.seq > latestInvalidationSeq
    && event.type === "ReviewerDispatched"
    && event.payload.activityId === activityId
  );
}

export function latestReviewerSubmission(
  events: readonly WorkflowEvent[],
  activityId: string,
  batchId: string
): WorkflowEvent | undefined {
  const dispatch = latestReviewerDispatch(events, activityId);
  if (!dispatch || dispatch.payload.batchId !== batchId) return undefined;
  return [...events].reverse().find((event) =>
    event.seq > dispatch.seq
    && event.type === "ReviewerSubmitted"
    && event.payload.activityId === activityId
    && event.payload.batchId === batchId
  );
}

/** A real digest of the durable reviewer evidence already submitted for this
 * batch. An empty batch hashes the canonical empty evidence set. */
export function reviewFindingsDigest(
  events: readonly WorkflowEvent[],
  batchId: string
): string {
  const submitted = events.flatMap((event) =>
    event.type === "ReviewerSubmitted"
    && event.payload.batchId === batchId
    && typeof event.payload.activityId === "string"
    && typeof event.payload.role === "string"
    && typeof event.payload.planEvidenceDigest === "string"
      ? [{
          activityId: event.payload.activityId,
          role: event.payload.role,
          evidenceDigest: event.payload.planEvidenceDigest
        }]
      : []
  );
  const batch = reviewBatchStarted(events, batchId);
  const reused = batch?.payload.scope === undefined
    ? []
    : parseReviewBatchScope(batch.payload.scope).reusedReviewerEvidence.map(
        (evidence) => ({
          activityId: evidence.activityId,
          role: evidence.role,
          evidenceDigest: evidence.planEvidenceDigest
        })
      );
  const findings = [...submitted, ...reused].sort((left, right) =>
    left.activityId.localeCompare(right.activityId)
    || left.role.localeCompare(right.role)
    || left.evidenceDigest.localeCompare(right.evidenceDigest)
  );
  return createHash("sha256").update(canonicalJson({
    schemaVersion: "review-findings-evidence-v1",
    findings
  }), "utf8").digest("hex");
}

export function reviewRevisionDigest(input: {
  events: readonly WorkflowEvent[];
  batchId: string;
  activityIds: string[];
}): string {
  const batch = reviewBatchStarted(input.events, input.batchId);
  if (!batch || typeof batch.payload.inputDigest !== "string") {
    throw new Error(`Review batch ${input.batchId} was never started.`);
  }
  return createHash("sha256").update(canonicalJson({
    schemaVersion: "review-revision-evidence-v1",
    inputDigest: batch.payload.inputDigest,
    activityIds: [...new Set(input.activityIds)].sort(),
    findingsDigest: reviewFindingsDigest(input.events, input.batchId)
  }), "utf8").digest("hex");
}

export function rotatedReviewBatchId(batchId: string, revisionDigest: string): string {
  if (!/^[a-f0-9]{64}$/.test(revisionDigest)) {
    throw new Error("revisionDigest must be a lowercase SHA-256 digest.");
  }
  const stableBase = batchId.replace(/(?:-r[a-f0-9]{12})+$/, "");
  return `${stableBase}-r${revisionDigest.slice(0, 12)}`;
}

export interface ReviewLifecycleEventInput {
  type: Extract<
    WorkflowEventType,
    "ReviewBatchStarted" | "ReviewerDispatched" | "ReviewerSubmitted" | "ReviewBatchInvalidated"
  >;
  activityId?: string;
  batchId: string;
  role?: string;
  inputDigest?: string;
  planEvidenceRef?: string;
  planEvidenceDigest?: string;
  activityIds?: string[];
  revisionDigest?: string;
  findingsDigest?: string;
  reason?: string;
  inputRefs?: SafeJsonValue;
  scope?: ReviewBatchScope;
  scopeDigest?: string;
  readinessDigest?: string;
  readinessWarnings?: string[];
  roleInputDigests?: Record<string, string>;
  isolationProofVersion?: typeof REVIEWER_ISOLATION_PROOF_VERSION;
}

function assertDigest(value: string | undefined, name: string): void {
  if (value !== undefined && !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  }
}

export function prepareReviewLifecycleEvent(
  projection: WorkflowProjection,
  input: ReviewLifecycleEventInput
): { payload: SafeEventPayload; duplicate: boolean } {
  assertDigest(input.inputDigest, "inputDigest");
  assertDigest(input.planEvidenceDigest, "planEvidenceDigest");
  assertDigest(input.revisionDigest, "revisionDigest");
  assertDigest(input.findingsDigest, "findingsDigest");
  assertDigest(input.scopeDigest, "scopeDigest");
  assertDigest(input.readinessDigest, "readinessDigest");
  if (input.roleInputDigests) {
    for (const [activityId, digest] of Object.entries(input.roleInputDigests)) {
      if (!activityId.trim()) throw new Error("roleInputDigests requires activity IDs.");
      assertDigest(digest, `roleInputDigests.${activityId}`);
    }
  }
  const reviewerActivity = input.activityId
    ? projection.activities[input.activityId]
    : undefined;
  if (
    (input.type === "ReviewerDispatched" || input.type === "ReviewerSubmitted")
    && (!reviewerActivity || reviewerActivity.definition.kind !== "review")
  ) {
    throw new Error(`Review event requires a valid review activity: ${input.activityId ?? "missing"}.`);
  }
  const expectedJoinRoles = reviewerActivity?.reviewerExpectedRoles;
  if (
    (input.type === "ReviewerDispatched" || input.type === "ReviewerSubmitted")
    && reviewerActivity
    && expectedJoinRoles?.length
  ) {
    if (!input.role || !expectedJoinRoles.includes(input.role)) {
      throw new Error(
        `Compatibility reviewer join ${input.activityId} requires role ${expectedJoinRoles.join(" or ")}.`
      );
    }
    if (
      input.type === "ReviewerDispatched"
      && reviewerActivity.reviewerDispatchedRoles?.includes(input.role)
    ) {
      return { payload: {}, duplicate: true };
    }
    if (input.type === "ReviewerSubmitted") {
      if (!reviewerActivity.reviewerDispatchedRoles?.includes(input.role)) {
        throw new Error(
          `Compatibility reviewer role ${input.role} must be dispatched before submission.`
        );
      }
      if (reviewerActivity.reviewerSubmittedRoles?.includes(input.role)) {
        return { payload: {}, duplicate: true };
      }
    }
  }
  if (input.type === "ReviewerDispatched") {
    const maxAttempts = projection.reviewPolicy?.maxAttemptsPerRole ?? 3;
    if (reviewerActivity && reviewerActivity.attempt >= maxAttempts) {
      throw new Error(
        `Reviewer ${reviewerActivity.id} exhausted its ${maxAttempts} allowed attempts.`
      );
    }
    const activeReviewerSlots = projection.runningActivities
      .map((id) => projection.activities[id])
      .filter((activity) => activity?.definition.concurrencyGroup === "reviewer")
      .reduce((count, activity) => {
        const dispatched = activity?.reviewerDispatchedRoles;
        if (!dispatched?.length) return count + 1;
        const submitted = new Set(activity.reviewerSubmittedRoles ?? []);
        return count + dispatched.filter((role) => !submitted.has(role)).length;
      }, 0);
    const capacity = projection.reviewPolicy?.maxConcurrentReviewers ?? 3;
    if (activeReviewerSlots >= capacity) {
      throw new Error(`Reviewer concurrency capacity is full (${capacity}).`);
    }
  }
  const payload: SafeEventPayload = {
    batchId: input.batchId,
    ...(input.activityId ? { activityId: input.activityId } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.inputDigest ? { inputDigest: input.inputDigest } : {}),
    ...(input.planEvidenceRef ? { planEvidenceRef: input.planEvidenceRef } : {}),
    ...(input.planEvidenceDigest ? { planEvidenceDigest: input.planEvidenceDigest } : {}),
    ...(input.activityIds ? { activityIds: input.activityIds } : {}),
    ...(input.revisionDigest ? { revisionDigest: input.revisionDigest } : {}),
    ...(input.findingsDigest ? { findingsDigest: input.findingsDigest } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.inputRefs ? { inputRefs: input.inputRefs } : {}),
    ...(input.scope
      ? { scope: input.scope as unknown as SafeJsonValue }
      : {}),
    ...(input.scopeDigest ? { scopeDigest: input.scopeDigest } : {}),
    ...(input.readinessDigest ? { readinessDigest: input.readinessDigest } : {}),
    ...(input.readinessWarnings
      ? { readinessWarnings: input.readinessWarnings }
      : {}),
    ...(input.roleInputDigests ? { roleInputDigests: input.roleInputDigests } : {}),
    ...(input.isolationProofVersion
      ? { isolationProofVersion: input.isolationProofVersion }
      : {})
  };
  if (input.type === "ReviewerDispatched") {
    payload.attempt = (reviewerActivity?.attempt ?? 0) + 1;
  }
  if (input.type === "ReviewerSubmitted") {
    payload.attempt = reviewerActivity?.attempt ?? 0;
    const expectedRole = reviewerActivity?.definition.metadata?.role;
    if (typeof expectedRole !== "string" || input.role !== expectedRole) {
      throw new Error(
        `Reviewer submission role ${input.role ?? "missing"} does not match ${String(expectedRole)}.`
      );
    }
    if (!input.planEvidenceRef || !input.planEvidenceDigest) {
      throw new Error("Reviewer submission requires plan evidence path and digest.");
    }
    if (input.isolationProofVersion !== REVIEWER_ISOLATION_PROOF_VERSION) {
      throw new Error(
        `Reviewer submission requires ${REVIEWER_ISOLATION_PROOF_VERSION}.`
      );
    }
  }
  return { payload, duplicate: false };
}

export function reviewBatchInvalidationInputDigest(input: {
  events: readonly WorkflowEvent[];
  projection: WorkflowProjection;
  batchId: string;
  activityIds: string[];
}): string {
  const batch = reviewBatchStarted(input.events, input.batchId);
  if (!batch || typeof batch.payload.inputDigest !== "string") {
    throw new Error(`Review batch ${input.batchId} was never started.`);
  }
  if (!input.activityIds.length || input.activityIds.some((activityId) =>
    input.projection.activities[activityId]?.definition.kind !== "review"
  )) {
    throw new Error("Review batch invalidation may only target review activities.");
  }
  return batch.payload.inputDigest;
}

/** Purely extracts controlled source references from formal Markdown. IO and
 * allowlist enforcement remain with the facade/snapshot store. */
export function referencedControlledSources(plan: string): string[] {
  const pattern = /(?:\]\(|`|\b)((?:\.\.\/)*(?:sources\/(?:manifest\.yaml|indexes\/[a-z0-9][a-z0-9-]*\.ya?ml|(?:requirements|prototypes|knowledge-base)\/[^\s)`]+)))/g;
  return [...plan.matchAll(pattern)].map((match) => match[1]!);
}

export function requiredReviewInputs(
  planPath: string,
  packagePaths: string[],
  sourcePaths: string[],
  additional: string[]
): string[] {
  return [...new Set([planPath, ...packagePaths, ...sourcePaths, ...additional])];
}
