import {
  latestReviewerDispatch,
  latestReviewerSubmission,
  reviewerBindingId
} from "./reviewLifecycle.js";
import type {
  RuntimeReviewerBinding,
  WorkflowRuntimeState
} from "./runtimeLeaseStore.js";
import type {
  WorkflowEvent,
  WorkflowProjection
} from "./types.js";

export type ResumeRecoveryAction =
  | { kind: "finalize_succeeded_runtime"; activityId: string }
  | { kind: "finalize_reconciled_operation"; activityId: string; operationId: string }
  | { kind: "clear_reviewer_binding"; bindingId: string }
  | {
      kind: "repair_reviewer_binding";
      binding: RuntimeReviewerBinding;
    }
  | {
      kind: "reviewer_rebind_required";
      activityId: string;
      batchId: string;
      role: string;
      bindingId: string;
      attempt: number;
    }
  | { kind: "invalid_reviewer_dispatch"; activityId: string }
  | {
      kind: "mark_activity_reconciling";
      activityId: string;
      attempt: number;
      detail: string;
    };

function durableCallbackClosed(
  events: readonly WorkflowEvent[],
  activityId: string
): boolean {
  const latestAttempt = [...events].reverse().find((event) =>
    event.type === "ActivityAttemptStarted"
    && event.payload.activityId === activityId
  );
  const latestResolution = [...events].reverse().find((event) =>
    event.type === "CallbackResolved"
    && event.payload.activityId === activityId
  );
  return Boolean(
    latestResolution
    && (!latestAttempt || latestResolution.seq > latestAttempt.seq)
  );
}

function hasRuntimeResidue(
  runtime: WorkflowRuntimeState | null,
  activityId: string
): boolean {
  return Object.values(runtime?.stagingRefs ?? {})
    .some((staging) => staging.activityId === activityId)
    || Object.values(runtime?.inFlightOperations ?? {})
      .some((operation) => operation.activityId === activityId)
    || Boolean(runtime?.leases[activityId] && !runtime.leases[activityId]?.releasedAt);
}

function bindingMatches(
  binding: RuntimeReviewerBinding,
  activityId: string,
  batchId: string,
  role: string
): boolean {
  return binding.bindingId === reviewerBindingId(activityId, role, batchId)
    && binding.activityId === activityId
    && binding.batchId === batchId
    && binding.role === role;
}

export function planResumeRecovery(input: {
  projection: WorkflowProjection;
  events: readonly WorkflowEvent[];
  runtime: WorkflowRuntimeState | null;
  now: number;
}): ResumeRecoveryAction[] {
  const actions: ResumeRecoveryAction[] = [];
  const { projection, events, runtime, now } = input;

  for (const activity of Object.values(projection.activities)) {
    if (
      (activity.state === "SUCCEEDED" || durableCallbackClosed(events, activity.id))
      && hasRuntimeResidue(runtime, activity.id)
    ) {
      actions.push({
        kind: "finalize_succeeded_runtime",
        activityId: activity.id
      });
    }
  }

  for (const event of events) {
    if (
      event.type !== "ExternalOperationReconciled"
      || typeof event.payload.activityId !== "string"
      || typeof event.payload.operationId !== "string"
      || !runtime?.inFlightOperations[event.payload.operationId]
    ) continue;
    actions.push({
      kind: "finalize_reconciled_operation",
      activityId: event.payload.activityId,
      operationId: event.payload.operationId
    });
  }

  const retainedBindingIds = new Set<string>();
  for (const activityId of projection.runningActivities) {
    const activity = projection.activities[activityId]!;
    if (activity.definition.kind !== "review") continue;
    const dispatch = latestReviewerDispatch(events, activityId);
    const batchId = typeof dispatch?.payload.batchId === "string"
      ? dispatch.payload.batchId
      : undefined;
    const role = typeof dispatch?.payload.role === "string"
      ? dispatch.payload.role
      : undefined;
    if (!dispatch || !batchId || !role) {
      actions.push({ kind: "invalid_reviewer_dispatch", activityId });
      continue;
    }
    if (latestReviewerSubmission(events, activityId, batchId)) {
      actions.push({ kind: "invalid_reviewer_dispatch", activityId });
      continue;
    }
    const expectedBindingId = reviewerBindingId(activityId, role, batchId);
    const exact = runtime?.reviewerBindings[expectedBindingId];
    if (exact && bindingMatches(exact, activityId, batchId, role)) {
      retainedBindingIds.add(exact.bindingId);
      if (exact.status !== "running") {
        actions.push({ kind: "repair_reviewer_binding", binding: exact });
      }
      continue;
    }
    actions.push({
      kind: "reviewer_rebind_required",
      activityId,
      batchId,
      role,
      bindingId: expectedBindingId,
      attempt: activity.attempt
    });
  }

  for (const binding of Object.values(runtime?.reviewerBindings ?? {})) {
    if (retainedBindingIds.has(binding.bindingId)) continue;
    actions.push({
      kind: "clear_reviewer_binding",
      bindingId: binding.bindingId
    });
  }

  for (const activityId of projection.runningActivities) {
    const activity = projection.activities[activityId]!;
    if (activity.definition.kind === "review") continue;
    const lease = runtime?.leases[activityId];
    const activeLease = lease
      && !lease.releasedAt
      && Date.parse(lease.expiresAt) > now;
    if (activeLease) continue;
    actions.push({
      kind: "mark_activity_reconciling",
      activityId,
      attempt: activity.attempt,
      detail: "Runtime worker is missing or its lease expired; completion is unknown."
    });
  }

  return actions;
}

export function reviewerRebindAction(
  actions: readonly ResumeRecoveryAction[]
): Extract<ResumeRecoveryAction, { kind: "reviewer_rebind_required" }> | undefined {
  return actions.find((action):
    action is Extract<ResumeRecoveryAction, { kind: "reviewer_rebind_required" }> =>
      action.kind === "reviewer_rebind_required"
  );
}
