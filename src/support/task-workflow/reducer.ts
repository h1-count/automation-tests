import { extname, isAbsolute, sep } from "node:path";
import {
  WorkflowTransitionError,
  workflowEventTypes,
  workflowPhases,
  type ActivityProjection,
  type ActivityState,
  type CallbackResolution,
  type FormalExecutionWorkflowEvidence,
  type RequestPolicy,
  type ReviewPolicy,
  type SafeEventPayload,
  type SafeJsonValue,
  type TestOutcome,
  type WorkflowActivityDefinition,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowPhase,
  type WorkflowProjection,
  type WorkflowState,
  type WorkflowWait
} from "./types.js";
import {
  formalReportOutputPaths,
  parseFormalExecutionWorkflowEvidence,
  sameFormalExecutionWorkflowEvidence
} from "./formalCompletionEvidence.js";
import {
  reviewInputDigest,
  reviewRoleInputDigests,
  semanticReviewInputDigest
} from "./reviewInputSnapshot.js";
import {
  parseReviewBatchScope,
  reviewBatchScopeDigest,
  hasCompleteReviewBatchScope
} from "./reviewBatchScope.js";
import { GENESIS_DIGEST } from "./historyStore.js";
import {
  addCurrentReadinessPreflight,
  buildCandidateExtension,
  validateWorkflowDefinition,
  workflowGraphDigest
} from "./definition.js";
import {
  candidateFragmentManifestDigest,
  parseCandidateFragmentManifest
} from "./candidateFragments.js";
import { canonicalJson } from "./canonicalJson.js";

interface ReducerRuntime {
  suspended: boolean;
  terminal?: "SUCCEEDED" | "CANCELLED";
  testOutcome?: TestOutcome;
  globalBlockers: Map<string, string>;
  blockerDetails: Map<string, string>;
  resolvedCallbacks: Set<string>;
  resolvedCallbackDetails: Map<string, {
    activityId: string;
    subjectDigest: string;
    subjectSchemaVersion?: string;
    planDigest?: string;
    resolution: CallbackResolution;
  }>;
  succeededActivityDetails: Map<string, {
    kind: WorkflowActivityDefinition["kind"];
    outcome?: string;
    outputDigests: Map<string, string>;
    formalExecutionEvidence?: FormalExecutionWorkflowEvidence;
  }>;
  blockedPreviousStates: Map<string, ActivityState>;
  reviewerJoinRequirements: Map<string, string[]>;
  reviewerDispatches: Map<string, Set<string>>;
  reviewerSubmissions: Map<string, Set<string>>;
  reviewBatches: Map<string, string | undefined>;
  reviewBatchRoleDigests: Map<string, Map<string, string>>;
  reviewBatchActivities: Map<string, Set<string>>;
  reviewerBatchByActivity: Map<string, string>;
  preparedArtifacts: Map<string, {
    attempt: number;
    publications: Map<string, {
      manifestDigest: string;
      artifactDigests: Map<string, string>;
    }>;
  }>;
  externalOperationsStarted: Map<string, Set<string>>;
  externalOperationsReconciled: Map<string, Set<string>>;
  candidateGenerationStartedAttempts: Map<string, Set<number>>;
  reviewerModelCalls: Map<string, { batchId: string; attempt: number; startedAt: string; completedAt?: string; supplemental: boolean }[]>;
  reviewerBudgetedBatches: Set<string>;
  reviewPolicy?: ReviewPolicy;
  lastReviewRevisionSignature?: string;
  unchangedReviewRevisionCycles: number;
  reviewWorkbook?: WorkflowProjection["reviewWorkbook"];
}

const sha256Pattern = /^[a-f0-9]{64}$/;

function stringField(payload: SafeEventPayload, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim()) throw new WorkflowTransitionError(`Event payload requires ${field}.`);
  return value;
}

function stringArray(payload: SafeEventPayload, field: string): string[] {
  const value = payload[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new WorkflowTransitionError(`Event payload requires string array ${field}.`);
  }
  return value as string[];
}

function requireDigest(value: string, field: string): string {
  if (!sha256Pattern.test(value)) {
    throw new WorkflowTransitionError(`Event payload requires lowercase SHA-256 ${field}.`);
  }
  return value;
}

function preparedArtifactDigests(payload: SafeEventPayload): Map<string, string> {
  const value = payload.artifacts;
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkflowTransitionError("ArtifactPublishPrepared requires a non-empty artifacts array.");
  }
  const digests = new Map<string, string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new WorkflowTransitionError("ArtifactPublishPrepared contains an invalid artifact.");
    }
    const artifact = raw as Record<string, SafeEventPayload[string]>;
    const targetPath = artifact.targetPath;
    const digest = artifact.digest;
    if (typeof targetPath !== "string" || !targetPath.trim() || typeof digest !== "string") {
      throw new WorkflowTransitionError(
        "ArtifactPublishPrepared artifacts require targetPath and digest."
      );
    }
    if (digests.has(targetPath)) {
      throw new WorkflowTransitionError(
        `ArtifactPublishPrepared contains duplicate target ${targetPath}.`
      );
    }
    digests.set(targetPath, requireDigest(digest, `artifact digest for ${targetPath}`));
  }
  return digests;
}

function succeededOutputDigests(payload: SafeEventPayload): Map<string, string> {
  const value = payload.outputDigests;
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkflowTransitionError(
      "Artifact-producing ActivitySucceeded requires non-empty outputDigests."
    );
  }
  const digests = new Map<string, string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new WorkflowTransitionError("ActivitySucceeded contains an invalid output digest.");
    }
    const output = raw as Record<string, SafeEventPayload[string]>;
    const path = output.path;
    const digest = output.digest;
    if (typeof path !== "string" || !path.trim() || typeof digest !== "string") {
      throw new WorkflowTransitionError("ActivitySucceeded outputDigests require path and digest.");
    }
    if (digests.has(path)) {
      throw new WorkflowTransitionError(`ActivitySucceeded contains duplicate output ${path}.`);
    }
    digests.set(path, requireDigest(digest, `output digest for ${path}`));
  }
  return digests;
}

function verifyArtifactPublicationEvidence(
  event: WorkflowEvent,
  activity: ActivityProjection,
  runtime: ReducerRuntime
): void {
  if (!activity.definition.publishesArtifacts) return;
  const trustedLegacyImport = event.actorType === "system"
    && event.payload.imported === true;
  if (trustedLegacyImport) return;

  const prepared = runtime.preparedArtifacts.get(activity.id);
  if (!prepared || prepared.attempt !== activity.attempt || prepared.publications.size === 0) {
    throw new WorkflowTransitionError(
      `Activity ${activity.id} declares artifact publication but has no prepared publication for attempt ${activity.attempt}.`
    );
  }
  const actual = succeededOutputDigests(event.payload);
  const matchingPublication = [...prepared.publications.values()].find(
    ({ artifactDigests }) =>
      actual.size === artifactDigests.size
      && [...artifactDigests].every(([path, digest]) => actual.get(path) === digest)
  );
  if (!matchingPublication) {
    throw new WorkflowTransitionError(
      `Activity ${activity.id} outputDigests do not match its prepared publication.`
    );
  }
  const outputRefs = new Set(stringArray(event.payload, "outputRefs"));
  if ([...matchingPublication.artifactDigests.keys()].some((path) => !outputRefs.has(path))) {
    throw new WorkflowTransitionError(
      `Activity ${activity.id} outputRefs do not cover its prepared publication.`
    );
  }
}

function activityFor(
  activities: Record<string, ActivityProjection>,
  payload: SafeEventPayload
): ActivityProjection {
  const activityId = stringField(payload, "activityId");
  const activity = activities[activityId];
  if (!activity) throw new WorkflowTransitionError(`Event references unknown activity ${activityId}.`);
  return activity;
}

function requireState(activity: ActivityProjection, allowed: ActivityState[], event: WorkflowEvent): void {
  if (!allowed.includes(activity.state)) {
    throw new WorkflowTransitionError(
      `${event.type} cannot apply to ${activity.id} while it is ${activity.state}; expected ${allowed.join(" or ")}.`
    );
  }
}

function usesCallbackSemantics(activity: ActivityProjection): boolean {
  return [
    "callback",
    "execution_authorization"
  ].includes(activity.definition.kind);
}

function applyTestOutcome(payload: SafeEventPayload, runtime: ReducerRuntime): void {
  const outcome = payload.testOutcome;
  if (outcome === undefined) return;
  if (typeof outcome !== "string" || !["passed", "failed", "mixed", "inconclusive"].includes(outcome)) {
    throw new WorkflowTransitionError(`Unsupported test outcome ${String(outcome)}.`);
  }
  runtime.testOutcome = outcome as TestOutcome;
}

function formalCompletionEvidenceForEvent(
  activity: ActivityProjection,
  payload: SafeEventPayload,
  runtime: ReducerRuntime
): FormalExecutionWorkflowEvidence | undefined {
  const contract = activity.definition.metadata?.completionContract;
  const requiresEvidence = contract === "formal-execution-completion-seal-v1";
  if (contract !== undefined && !requiresEvidence) {
    throw new WorkflowTransitionError(
      `Activity ${activity.id} declares an unsupported completion contract.`
    );
  }
  if (!requiresEvidence && payload.formalExecutionEvidence === undefined) return undefined;
  if (!["run", "report"].includes(activity.definition.kind)) {
    throw new WorkflowTransitionError(
      `Activity ${activity.id} cannot contain formal execution workflow evidence.`
    );
  }
  let evidence: FormalExecutionWorkflowEvidence;
  try {
    evidence = parseFormalExecutionWorkflowEvidence(payload.formalExecutionEvidence);
  } catch (error) {
    throw new WorkflowTransitionError(
      error instanceof Error ? error.message : "Formal execution workflow evidence is invalid."
    );
  }
  if (payload.testOutcome !== evidence.testOutcome) {
    throw new WorkflowTransitionError(
      `Activity ${activity.id} testOutcome differs from its formal execution evidence.`
    );
  }
  if (activity.definition.kind === "report") {
    const runEvidence = runtime.succeededActivityDetails.get("run")?.formalExecutionEvidence;
    if (requiresEvidence && !runEvidence) {
      throw new WorkflowTransitionError(
        "Formal report completion requires evidence from the succeeded run activity."
      );
    }
    if (runEvidence && !sameFormalExecutionWorkflowEvidence(runEvidence, evidence)) {
      throw new WorkflowTransitionError(
        "Formal report evidence differs from the succeeded run evidence."
      );
    }
    const expectedPaths = formalReportOutputPaths(evidence.executionSubjectDigest).sort();
    const actualPaths = [...succeededOutputDigests(payload).keys()].sort();
    if (
      actualPaths.length !== expectedPaths.length
      || actualPaths.some((path, index) => path !== expectedPaths[index])
    ) {
      throw new WorkflowTransitionError(
        `Formal report must publish exactly ${expectedPaths.join(", ")}.`
      );
    }
  }
  return evidence;
}

function requireConcurrencyCapacity(
  activity: ActivityProjection,
  activities: Record<string, ActivityProjection>,
  runtime: ReducerRuntime
): void {
  const group = activity.definition.concurrencyGroup;
  const limit = activity.definition.concurrencyLimit;
  if (!group || limit === undefined) return;
  const runningCount = Object.values(activities)
    .filter((candidate) =>
      candidate.state === "RUNNING"
      && candidate.definition.concurrencyGroup === group
    )
    .reduce((count, candidate) => {
      if (group !== "reviewer") return count + 1;
      const joinRoles = runtime.reviewerJoinRequirements.get(candidate.id);
      if (!joinRoles) return count + 1;
      const dispatched = runtime.reviewerDispatches.get(candidate.id);
      const submitted = runtime.reviewerSubmissions.get(candidate.id);
      if (!dispatched?.size) return count;
      return count + [...dispatched].filter((role) => !submitted?.has(role)).length;
    }, 0);
  if (runningCount >= limit) {
    throw new WorkflowTransitionError(
      `Concurrency group ${group} is full (${limit}); ${activity.id} cannot start.`
    );
  }
}

function materializeReady(
  activities: Record<string, ActivityProjection>,
  definitionVersion: string
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const activity of Object.values(activities)) {
      if (activity.state !== "PENDING") continue;
      const activation = activity.definition.activation;
      if (activation) {
        const decision = activities[activation.activityId];
        if (!decision) throw new WorkflowTransitionError(`Activity ${activity.id} has an unknown activation source.`);
        if (decision.state === "SUCCEEDED" && decision.outcome !== undefined
          && !activation.outcomes.includes(decision.outcome)) {
          activity.state = "CANCELLED";
          changed = true;
          continue;
        }
        if (decision.state !== "SUCCEEDED" || decision.outcome === undefined) continue;
      }
      if (activity.definition.dependencies.every((id) => {
        const dependency = activities[id];
        return dependency?.state === "SUCCEEDED"
          || (
            dependency?.state === "CANCELLED"
            && dependency.definition.activation !== undefined
            && (
              definitionVersion !== "v1"
              || activity.definition.optionalDependencies?.includes(id) === true
            )
          );
      })) {
        activity.state = "READY";
        changed = true;
      }
    }
  }
}

function definitionsFromExpanded(event: WorkflowEvent): WorkflowActivityDefinition[] {
  const raw = event.payload.activities;
  if (!Array.isArray(raw)) throw new WorkflowTransitionError("ActivitiesExpanded requires activities.");
  return raw as unknown as WorkflowActivityDefinition[];
}

function initializeActivities(definitions: WorkflowActivityDefinition[]): Record<string, ActivityProjection> {
  return Object.fromEntries(definitions.map((definition) => [
    definition.id,
    {
      id: definition.id,
      definition,
      state: "PENDING",
      attempt: 0,
      blockerIds: [],
      unresolvedExternalOperationIds: []
    }
  ]));
}

function phaseOf(activities: Record<string, ActivityProjection>): WorkflowPhase {
  for (const phase of workflowPhases) {
    if (Object.values(activities).some((activity) =>
      activity.definition.phase === phase && !["SUCCEEDED", "CANCELLED"].includes(activity.state)
    )) return phase;
  }
  return "completion";
}

function deriveWaits(
  activities: Record<string, ActivityProjection>,
  runtime: ReducerRuntime
): WorkflowWait[] {
  const waits: WorkflowWait[] = [];
  for (const activity of Object.values(activities)) {
    if (activity.state === "WAITING_CALLBACK") {
      waits.push({ kind: "human", activityId: activity.id, referenceId: activity.callbackId });
    }
    if (activity.state === "RETRY_WAIT") {
      waits.push({ kind: "retry", activityId: activity.id, detail: activity.retryAt });
    }
    if (activity.state === "FAILED") {
      waits.push({
        kind: "recovery",
        activityId: activity.id,
        referenceId: activity.id,
        detail: `Activity ${activity.id} failed and awaits explicit recovery.`
      });
    }
    if (activity.state === "RECONCILING") {
      waits.push({ kind: "reconciliation", activityId: activity.id });
    }
    for (const blockerId of activity.blockerIds) {
      waits.push({
        kind: "blocker",
        activityId: activity.id,
        referenceId: blockerId,
        detail: runtime.blockerDetails.get(blockerId)
      });
    }
    for (const operationId of activity.unresolvedExternalOperationIds) {
      waits.push({ kind: "external", activityId: activity.id, referenceId: operationId });
    }
  }
  for (const [blockerId, detail] of runtime.globalBlockers) {
    waits.push({ kind: "blocker", referenceId: blockerId, detail });
  }
  return waits;
}

function deriveWorkflowState(
  activities: Record<string, ActivityProjection>,
  runtime: ReducerRuntime,
  ready: string[],
  running: string[]
): WorkflowState {
  if (runtime.terminal) return runtime.terminal;
  if (runtime.suspended) return "SUSPENDED";
  if (runtime.globalBlockers.size) return "BLOCKED";
  if (ready.length) return "RUNNING";
  if (running.some((id) => activities[id]!.unresolvedExternalOperationIds.length > 0)) return "WAITING_EXTERNAL";
  if (running.length) return "RUNNING";
  const values = Object.values(activities);
  if (values.some((activity) => activity.state === "WAITING_CALLBACK")) return "WAITING_HUMAN";
  if (values.some((activity) => activity.state === "RECONCILING")) return "RECONCILING";
  if (values.some((activity) => activity.state === "RETRY_WAIT")) return "RETRY_WAIT";
  if (values.some((activity) => activity.state === "BLOCKED") || runtime.globalBlockers.size) return "BLOCKED";
  if (values.some((activity) =>
    activity.definition.required
    && activity.definition.activation === undefined
    && activity.state === "CANCELLED"
  )) return "CANCELLED";
  if (values.some((activity) => activity.definition.required && activity.state === "FAILED")) return "BLOCKED";
  return "RUNNING";
}

function applyActivityEvent(
  event: WorkflowEvent,
  activities: Record<string, ActivityProjection>,
  runtime: ReducerRuntime
): void {
  const payload = event.payload;
  switch (event.type) {
    case "ActivityAttemptStarted": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["READY", "RETRY_WAIT"], event);
      if (activity.definition.kind === "review") {
        throw new WorkflowTransitionError(
          `Review activity ${activity.id} must start with ReviewerDispatched.`
        );
      }
      if (activity.unresolvedExternalOperationIds.length) {
        throw new WorkflowTransitionError(
          `Activity ${activity.id} cannot start a new attempt with unresolved external operations.`
        );
      }
      requireConcurrencyCapacity(activity, activities, runtime);
      activity.state = "RUNNING";
      activity.attempt += 1;
      activity.retryAt = undefined;
      runtime.preparedArtifacts.delete(activity.id);
      runtime.externalOperationsStarted.set(activity.id, new Set());
      runtime.externalOperationsReconciled.set(activity.id, new Set());
      activity.lastEventSeq = event.seq;
      return;
    }
    case "CandidateGenerationStarted": {
      const activity = activityFor(activities, payload);
      const attempt = payload.attempt;
      const timed = activity.definition.kind === "candidate_compiler"
        || (activity.definition.kind === "candidate_fragment" && activity.definition.metadata?.generationMode !== "deterministic")
        || activity.definition.kind === "candidate_skeleton";
      if (event.definitionVersion !== "v1"
        || !timed
        || activity.definition.metadata?.generationPolicyVersion !== "candidate-generation-policy-v1") {
        throw new WorkflowTransitionError("CandidateGenerationStarted is only valid for timed candidate generation activities.");
      }
      if (activity.state !== "RUNNING" || !Number.isInteger(attempt) || attempt !== activity.attempt) {
        throw new WorkflowTransitionError("CandidateGenerationStarted must belong to the current running attempt.");
      }
      const attempts = runtime.candidateGenerationStartedAttempts.get(activity.id) ?? new Set<number>();
      if (attempts.has(attempt)) {
        throw new WorkflowTransitionError(`CandidateGenerationStarted already exists for ${activity.id} attempt ${attempt}.`);
      }
      attempts.add(attempt);
      runtime.candidateGenerationStartedAttempts.set(activity.id, attempts);
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ActivitySucceeded": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING", "RECONCILING"], event);
      const adaptivePolicySuccess = activity.definition.kind === "execution_authorization"
        && activity.definition.metadata?.decisionMode === "risk_adaptive"
        && typeof payload.executionSubjectDigest === "string";
      if (usesCallbackSemantics(activity) && !adaptivePolicySuccess) {
        throw new WorkflowTransitionError(
          `Callback activity ${activity.id} must complete with CallbackResolved.`
        );
      }
      if (activity.definition.kind === "review") {
        throw new WorkflowTransitionError(
          `Review activity ${activity.id} must complete with ReviewerSubmitted.`
        );
      }
      if (activity.definition.kind === "completeness_validation") {
        const evidence = payload.completenessEvidence;
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
          throw new WorkflowTransitionError(
            "Completeness validation requires structured package evidence."
          );
        }
        const record = evidence as Record<string, SafeEventPayload[string]>;
        if (record.complete !== true || !Array.isArray(record.packages) || record.packages.length === 0) {
          throw new WorkflowTransitionError(
            "Completeness validation cannot succeed without complete package evidence."
          );
        }
      }
      if (activity.unresolvedExternalOperationIds.length) {
        throw new WorkflowTransitionError(`Activity ${activity.id} has unresolved external operations.`);
      }
      if (activity.definition.requiresExternalOperation) {
        const started = runtime.externalOperationsStarted.get(activity.id);
        const reconciled = runtime.externalOperationsReconciled.get(activity.id);
        if (!started?.size || !reconciled || [...started].some((id) => !reconciled.has(id))) {
          throw new WorkflowTransitionError(
            `Activity ${activity.id} requires a reconciled external operation in attempt ${activity.attempt}.`
          );
        }
      }
      const formalExecutionEvidence = formalCompletionEvidenceForEvent(
        activity,
        payload,
        runtime
      );
      verifyArtifactPublicationEvidence(event, activity, runtime);
      if (activity.definition.kind === "review_resolution") {
        const outcome = typeof payload.outcome === "string" ? payload.outcome : "";
        if (![
          "converged",
          "evolve",
          "human_conflict",
          "plan_revision_required"
        ].includes(outcome)) {
          throw new WorkflowTransitionError(
            "Review resolution requires outcome converged, evolve, human_conflict, or plan_revision_required."
          );
        }
        activity.outcome = outcome;
      } else if (typeof payload.outcome === "string") {
        activity.outcome = payload.outcome;
      }
      runtime.succeededActivityDetails.set(activity.id, {
        kind: activity.definition.kind,
        ...(activity.outcome ? { outcome: activity.outcome } : {}),
        outputDigests: Array.isArray(payload.outputDigests)
          ? succeededOutputDigests(payload)
          : new Map(),
        ...(formalExecutionEvidence ? { formalExecutionEvidence } : {})
      });
      applyTestOutcome(payload, runtime);
      activity.state = "SUCCEEDED";
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ActivityFailed": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING", "RECONCILING"], event);
      if (activity.unresolvedExternalOperationIds.length) {
        throw new WorkflowTransitionError(
          `Activity ${activity.id} must reconcile external operations before failure or retry.`
        );
      }
      activity.state = "FAILED";
      activity.lastEventSeq = event.seq;
      return;
    }
    case "RetryScheduled": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["FAILED"], event);
      if (activity.definition.kind === "review") {
        runtime.reviewerDispatches.delete(activity.id);
        runtime.reviewerSubmissions.delete(activity.id);
        runtime.reviewerBatchByActivity.delete(activity.id);
        activity.reviewerDispatchedRoles = [];
        activity.reviewerSubmittedRoles = [];
      }
      activity.state = "RETRY_WAIT";
      activity.retryAt = typeof payload.retryAt === "string" ? payload.retryAt : undefined;
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ArtifactPublishPrepared": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING", "WAITING_CALLBACK", "RECONCILING"], event);
      const publishId = stringField(payload, "publishId");
      requireDigest(stringField(payload, "manifestDigest"), "manifestDigest");
      const artifactDigests = preparedArtifactDigests(payload);
      const prepared = runtime.preparedArtifacts.get(activity.id) ?? {
        attempt: activity.attempt,
        publications: new Map<string, {
          manifestDigest: string;
          artifactDigests: Map<string, string>;
        }>()
      };
      if (prepared.attempt !== activity.attempt) {
        throw new WorkflowTransitionError(
          `Artifact publication ${publishId} belongs to a stale attempt of ${activity.id}.`
        );
      }
      if (prepared.publications.has(publishId)) {
        throw new WorkflowTransitionError(
          `Artifact publication ${publishId} was already prepared for ${activity.id}.`
        );
      }
      prepared.publications.set(
        publishId,
        {
          manifestDigest: requireDigest(
            stringField(payload, "manifestDigest"),
            "manifestDigest"
          ),
          artifactDigests
        }
      );
      runtime.preparedArtifacts.set(activity.id, prepared);
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ArtifactDriftDetected": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING", "WAITING_CALLBACK", "FAILED"], event);
      activity.state = "RECONCILING";
      if (usesCallbackSemantics(activity)) {
        runtime.preparedArtifacts.delete(activity.id);
      }
      activity.lastEventSeq = event.seq;
      return;
    }
    case "CallbackRequested": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING"], event);
      if (!usesCallbackSemantics(activity)) {
        throw new WorkflowTransitionError(
          `CallbackRequested requires a callback activity; ${activity.id} is ${activity.definition.kind}.`
        );
      }
      activity.callbackId = stringField(payload, "callbackId");
      activity.callbackSubjectDigest = stringField(payload, "subjectDigest");
      if (event.definitionVersion === "v1" && activity.id === "case-confirmation") {
        if (!runtime.reviewWorkbook || runtime.reviewWorkbook.subjectDigest !== activity.callbackSubjectDigest) {
          throw new WorkflowTransitionError("Current case-confirmation requires a workbook published for the current subject.");
        }
      }
      if (payload.subjectSchemaVersion !== undefined) {
        activity.callbackSubjectSchemaVersion = stringField(
          payload,
          "subjectSchemaVersion"
        );
      } else {
        activity.callbackSubjectSchemaVersion = undefined;
      }
      activity.decisionOriginCallbackId = undefined;
      activity.decisionOriginSubjectDigest = undefined;
      activity.decisionOriginSubjectSchemaVersion = undefined;
      activity.state = "WAITING_CALLBACK";
      activity.lastEventSeq = event.seq;
      return;
    }
    case "CallbackResolved": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["WAITING_CALLBACK", "RECONCILING"], event);
      if (!usesCallbackSemantics(activity)) {
        throw new WorkflowTransitionError(
          `CallbackResolved requires a callback activity; ${activity.id} is ${activity.definition.kind}.`
        );
      }
      const callbackId = stringField(payload, "callbackId");
      const subjectDigest = stringField(payload, "subjectDigest");
      const subjectSchemaVersion = payload.subjectSchemaVersion === undefined
        ? undefined
        : stringField(payload, "subjectSchemaVersion");
      if (runtime.resolvedCallbacks.has(callbackId)) {
        throw new WorkflowTransitionError(`Callback ${callbackId} was already resolved.`);
      }
      if (
        callbackId !== activity.callbackId
        || subjectDigest !== activity.callbackSubjectDigest
        || subjectSchemaVersion !== activity.callbackSubjectSchemaVersion
      ) {
        throw new WorkflowTransitionError(`Callback ${callbackId} does not match the pending subject digest.`);
      }
      if (event.definitionVersion === "v1" && activity.id === "case-confirmation"
        && (!runtime.reviewWorkbook || runtime.reviewWorkbook.subjectDigest !== subjectDigest)) {
        throw new WorkflowTransitionError("Current case-confirmation resolution requires the current published workbook.");
      }
      // A design-reconfirmation confirmation is bound to the frozen stable
      // suite and RunIntentDerived evidence.  It deliberately has no request
      // plan.md to publish.  Keep every plan-backed callback on the existing
      // prepared-publication proof path.
      const runIntentCaseConfirmation = event.definitionVersion === "v1"
        && activity.id === "case-confirmation"
        && activity.definition.metadata?.reuseProtocol === "run-intent-v1";
      let planDigest: string | undefined;
      if (!runIntentCaseConfirmation && activity.definition.kind !== "execution_authorization") {
        const publishId = stringField(payload, "publishId");
        const manifestDigest = requireDigest(
          stringField(payload, "manifestDigest"),
          "manifestDigest"
        );
        const planPath = stringField(payload, "planPath");
        planDigest = requireDigest(stringField(payload, "planDigest"), "planDigest");
        const prepared = runtime.preparedArtifacts.get(activity.id);
        const publication = prepared?.publications.get(publishId);
        if (
          !prepared
          || prepared.attempt !== activity.attempt
          || !publication
          || publication.manifestDigest !== manifestDigest
          || publication.artifactDigests.size !== 1
          || publication.artifactDigests.get(planPath) !== planDigest
        ) {
          throw new WorkflowTransitionError(
            `Formal callback ${activity.id} resolution does not match its single prepared plan publication.`
          );
        }
      }
      const resolution = stringField(payload, "resolution") as CallbackResolution;
      if (!["accepted", "rejected", "revision_requested", "cancelled"].includes(resolution)) {
        throw new WorkflowTransitionError(`Unsupported callback resolution ${resolution}.`);
      }
      runtime.resolvedCallbacks.add(callbackId);
      runtime.resolvedCallbackDetails.set(callbackId, {
        activityId: activity.id,
        subjectDigest,
        ...(subjectSchemaVersion ? { subjectSchemaVersion } : {}),
        ...(planDigest ? { planDigest } : {}),
        resolution
      });
      runtime.preparedArtifacts.delete(activity.id);
      activity.state = resolution === "accepted"
        ? "SUCCEEDED"
        : resolution === "cancelled" ? "CANCELLED" : "BLOCKED";
      if (resolution === "accepted") {
        activity.decisionOriginCallbackId = callbackId;
        activity.decisionOriginSubjectDigest = subjectDigest;
        activity.decisionOriginSubjectSchemaVersion = subjectSchemaVersion;
      }
      activity.lastEventSeq = event.seq;
      return;
    }
    case "TestcaseReviewWorkbookPublished": {
      if (event.definitionVersion !== "v1") {
        throw new WorkflowTransitionError("TestcaseReviewWorkbookPublished is only valid for the v1 workflow.");
      }
      const activity = activityFor(activities, payload);
      if (activity.id !== "case-confirmation" || !["READY", "WAITING_CALLBACK"].includes(activity.state)) {
        throw new WorkflowTransitionError("Review workbook publication requires a ready or waiting case-confirmation activity.");
      }
      const cacheStatus = stringField(payload, "cacheStatus");
      const renderMilliseconds = payload.renderMilliseconds;
      if ((cacheStatus !== "hit" && cacheStatus !== "miss" && cacheStatus !== "rebuild")
        || typeof renderMilliseconds !== "number" || !Number.isInteger(renderMilliseconds) || renderMilliseconds < 0) {
        throw new WorkflowTransitionError("Review workbook publication has invalid cache or render metadata.");
      }
      const path = stringField(payload, "path");
      if (path !== "cases-review.xlsx") throw new WorkflowTransitionError("Review workbook must be published as cases-review.xlsx.");
      runtime.reviewWorkbook = {
        activityId: activity.id,
        subjectDigest: requireDigest(stringField(payload, "subjectDigest"), "subjectDigest"),
        contentDigest: requireDigest(stringField(payload, "contentDigest"), "contentDigest"),
        bindingDigest: requireDigest(stringField(payload, "bindingDigest"), "bindingDigest"),
        workbookDigest: requireDigest(stringField(payload, "workbookDigest"), "workbookDigest"),
        receiptDigest: requireDigest(stringField(payload, "receiptDigest"), "receiptDigest"),
        path,
        cacheStatus,
        renderMilliseconds
      };
      activity.lastEventSeq = event.seq;
      return;
    }
    case "BlockerRaised": {
      const blockerId = stringField(payload, "blockerId");
      const category = stringField(payload, "category");
      const detail = stringField(payload, "detail");
      const resolutionCondition = stringField(payload, "resolutionCondition");
      const projectedDetail = `原因：${detail}；分类：${category}；解除条件：${resolutionCondition}`;
      const affected = payload.affectedActivityIds === undefined ? [] : stringArray(payload, "affectedActivityIds");
      if (blockerId.startsWith("deterministic-outcome-") && (
        event.actorType !== "runner"
        || category !== "deterministic_outcome_unknown"
        || affected.length !== 1
        || affected[0] !== "run"
      )) {
        throw new WorkflowTransitionError(
          "Deterministic outcome blockers require the dedicated formal run parking event."
        );
      }
      if (blockerId.startsWith("data-hygiene-") && (
        event.actorType !== "runner"
        || category !== "data_hygiene_incomplete"
        || affected.length !== 1
        || affected[0] !== "run"
      )) {
        throw new WorkflowTransitionError(
          "Data hygiene blockers require the dedicated formal run parking event."
        );
      }
      runtime.blockerDetails.set(blockerId, projectedDetail);
      if (!affected.length) runtime.globalBlockers.set(blockerId, projectedDetail);
      for (const activityId of affected) {
        const activity = activities[activityId];
        if (!activity) throw new WorkflowTransitionError(`Blocker ${blockerId} references unknown activity ${activityId}.`);
        if (["SUCCEEDED", "CANCELLED"].includes(activity.state)) {
          throw new WorkflowTransitionError(`Blocker ${blockerId} cannot target terminal activity ${activityId}.`);
        }
        if (!runtime.blockedPreviousStates.has(activityId)) {
          runtime.blockedPreviousStates.set(activityId, activity.state);
        }
        if (!activity.blockerIds.includes(blockerId)) activity.blockerIds.push(blockerId);
        activity.state = "BLOCKED";
      }
      return;
    }
    case "BlockerResolved": {
      const blockerId = stringField(payload, "blockerId");
      if (
        (blockerId.startsWith("deterministic-outcome-")
          || blockerId.startsWith("data-hygiene-"))
        && event.actorType !== "system"
      ) {
        throw new WorkflowTransitionError(
          "Reserved formal blockers require system resolution from dedicated finalize."
        );
      }
      runtime.globalBlockers.delete(blockerId);
      runtime.blockerDetails.delete(blockerId);
      for (const activity of Object.values(activities)) {
        const hadBlocker = activity.blockerIds.includes(blockerId);
        activity.blockerIds = activity.blockerIds.filter((id) => id !== blockerId);
        if (hadBlocker && activity.state === "BLOCKED" && !activity.blockerIds.length) {
          activity.state = runtime.blockedPreviousStates.get(activity.id) ?? "PENDING";
          runtime.blockedPreviousStates.delete(activity.id);
        }
      }
      return;
    }
    case "ExternalOperationStarted": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING"], event);
      const operationId = stringField(payload, "operationId");
      const started = runtime.externalOperationsStarted.get(activity.id) ?? new Set<string>();
      if (started.has(operationId)) {
        throw new WorkflowTransitionError(
          `External operation ${operationId} was already started in this attempt.`
        );
      }
      started.add(operationId);
      runtime.externalOperationsStarted.set(activity.id, started);
      activity.unresolvedExternalOperationIds.push(operationId);
      return;
    }
    case "ExternalOperationReconciled": {
      const activity = activityFor(activities, payload);
      requireState(activity, ["RUNNING", "RECONCILING"], event);
      const operationId = stringField(payload, "operationId");
      if (!activity.unresolvedExternalOperationIds.includes(operationId)) {
        throw new WorkflowTransitionError(`External operation ${operationId} is not in flight.`);
      }
      const outcome = stringField(payload, "outcome");
      if (outcome === "unknown" || outcome === "conflict") {
        activity.state = "RECONCILING";
      } else if (outcome === "confirmed" || outcome === "not_found") {
        activity.unresolvedExternalOperationIds = activity.unresolvedExternalOperationIds
          .filter((id) => id !== operationId);
        const reconciled = runtime.externalOperationsReconciled.get(activity.id) ?? new Set<string>();
        reconciled.add(operationId);
        runtime.externalOperationsReconciled.set(activity.id, reconciled);
      } else {
        throw new WorkflowTransitionError(`Unsupported reconciliation outcome ${outcome}.`);
      }
      return;
    }
    case "ReviewBatchStarted": {
      const batchId = stringField(payload, "batchId");
      if (runtime.reviewBatches.has(batchId)) {
        throw new WorkflowTransitionError(`Review batch ${batchId} was already started.`);
      }
      const inputDigest = payload.inputDigest;
      if (inputDigest !== undefined && typeof inputDigest !== "string") {
        throw new WorkflowTransitionError(`Review batch ${batchId} has an invalid inputDigest.`);
      }
      if (inputDigest === undefined) {
        throw new WorkflowTransitionError(
          `Review batch ${batchId} requires an immutable inputDigest.`
        );
      }
      if (event.definitionVersion === "v1") {
        if (!Array.isArray(payload.inputRefs) || !payload.inputRefs.length) {
          throw new WorkflowTransitionError(`Review batch ${batchId} requires non-empty inputRefs.`);
        }
        const refs = payload.inputRefs.map((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new WorkflowTransitionError(`Review batch ${batchId} has malformed inputRef.`);
          }
          const ref = value as Record<string, unknown>;
          const allowedExternalExtensions = new Set([
            ".docx", ".pdf", ".md", ".txt", ".yaml", ".yml", ".json",
            ".png", ".jpg", ".jpeg", ".webp"
          ]);
          const externalPath = typeof ref.path === "string"
            && isAbsolute(ref.path)
            && !ref.path.split(sep).filter(Boolean).some((segment) => segment.startsWith("."))
            && allowedExternalExtensions.has(extname(ref.path).toLowerCase());
          const controlledPath = typeof ref.path === "string"
            && !ref.path.startsWith("/")
            && !ref.path.includes("..");
          if ((!controlledPath && !externalPath)
            || typeof ref.digest !== "string" || !/^[a-f0-9]{64}$/.test(ref.digest)
            || !Number.isInteger(ref.sizeBytes) || Number(ref.sizeBytes) < 0) {
            throw new WorkflowTransitionError(`Review batch ${batchId} has malformed inputRef.`);
          }
          if (
            ref.semanticDigest !== undefined
            && (typeof ref.semanticDigest !== "string" || !sha256Pattern.test(ref.semanticDigest))
          ) {
            throw new WorkflowTransitionError(
              `Review batch ${batchId} has malformed inputRef semanticDigest.`
            );
          }
          if (
            ref.roleSemanticDigests !== undefined
            && (
              !ref.roleSemanticDigests
              || typeof ref.roleSemanticDigests !== "object"
              || Array.isArray(ref.roleSemanticDigests)
              || Object.values(ref.roleSemanticDigests).some(
                (digest) => typeof digest !== "string" || !sha256Pattern.test(digest)
              )
            )
          ) {
            throw new WorkflowTransitionError(
              `Review batch ${batchId} has malformed inputRef roleSemanticDigests.`
            );
          }
          return {
            sourcePath: String(ref.path),
            digest: ref.digest,
            sizeBytes: Number(ref.sizeBytes),
            ...(typeof ref.semanticDigest === "string"
              ? { semanticDigest: ref.semanticDigest }
              : {}),
            ...(ref.roleSemanticDigests && typeof ref.roleSemanticDigests === "object"
              ? { roleSemanticDigests: ref.roleSemanticDigests as Record<string, string> }
              : {})
          };
        });
        let scopeDigest: string | undefined;
        let scope: ReturnType<typeof parseReviewBatchScope> | undefined;
        if (payload.scope !== undefined || payload.scopeDigest !== undefined) {
          try {
            scope = parseReviewBatchScope(payload.scope);
            scopeDigest = requireDigest(
              stringField(payload, "scopeDigest"),
              "scopeDigest"
            );
            if (reviewBatchScopeDigest(scope) !== scopeDigest) {
              throw new WorkflowTransitionError(
                `Review batch ${batchId} scope does not match scopeDigest.`
              );
            }
            runtime.reviewBatchActivities.set(
              batchId,
              new Set(scope.requiredActivityIds)
            );
          } catch (error) {
            if (error instanceof WorkflowTransitionError) throw error;
            throw new WorkflowTransitionError(
              `Review batch ${batchId} has malformed scope: ${String(error)}`
            );
          }
        }
        if (payload.readinessDigest !== undefined) {
          requireDigest(
            stringField(payload, "readinessDigest"),
            "readinessDigest"
          );
        }
        if (
          payload.readinessWarnings !== undefined
          && (
            !Array.isArray(payload.readinessWarnings)
            || payload.readinessWarnings.some((value) => typeof value !== "string")
          )
        ) {
          throw new WorkflowTransitionError(
            `Review batch ${batchId} has malformed readinessWarnings.`
          );
        }
        const semanticScope = scope !== undefined && hasCompleteReviewBatchScope(scope)
          ? scope
          : undefined;
        const isSemanticSnapshot = semanticScope !== undefined;
        if (isSemanticSnapshot && refs.some((ref) => ref.semanticDigest === undefined)) {
          throw new WorkflowTransitionError(
            `Review batch ${batchId} current scope requires semanticDigest for every inputRef.`
          );
        }
        const algorithm = payload.inputDigestAlgorithm;
        if (algorithm !== undefined && algorithm !== "review-input-digest-v1") {
          throw new WorkflowTransitionError(`Review batch ${batchId} has unsupported inputDigestAlgorithm.`);
        }
        const computedInputDigest = isSemanticSnapshot
          ? semanticReviewInputDigest(event.requestId, refs, scopeDigest)
          : reviewInputDigest(event.requestId, refs, scopeDigest);
        if (computedInputDigest !== inputDigest) {
            throw new WorkflowTransitionError(`Review batch ${batchId} inputRefs do not match inputDigest.`);
          }
        if (isSemanticSnapshot) {
          const rawRoleDigests = payload.roleInputDigests;
          if (!rawRoleDigests || typeof rawRoleDigests !== "object" || Array.isArray(rawRoleDigests)) {
            throw new WorkflowTransitionError(
              `Review batch ${batchId} current scope requires roleInputDigests.`
            );
          }
          const actual = Object.fromEntries(Object.entries(rawRoleDigests).map(([activityId, digest]) => {
            if (typeof digest !== "string") {
              throw new WorkflowTransitionError(
                `Review batch ${batchId} has malformed roleInputDigest for ${activityId}.`
              );
            }
            return [activityId, requireDigest(digest, `roleInputDigest for ${activityId}`)];
          }));
          const expected = reviewRoleInputDigests(event.requestId, refs, scopeDigest, semanticScope);
          if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected).sort())) {
            throw new WorkflowTransitionError(
              `Review batch ${batchId} roleInputDigests do not match its role scopes.`
            );
          }
          runtime.reviewBatchRoleDigests.set(batchId, new Map(Object.entries(actual)));
          if (payload.rolePackets !== undefined) {
            if (!Array.isArray(payload.rolePackets)) {
              throw new WorkflowTransitionError(`Review batch ${batchId} has malformed rolePackets.`);
            }
            const expectedActivities = semanticScope.roleScopes.map((roleScope) => roleScope.activityId).sort();
            const packets = payload.rolePackets.map((value) => {
              if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new WorkflowTransitionError(`Review batch ${batchId} has malformed rolePacket.`);
              }
              const packet = value as Record<string, unknown>;
              if (
                typeof packet.activityId !== "string"
                || typeof packet.role !== "string"
                || typeof packet.path !== "string"
                || packet.path.startsWith("/")
                || packet.path.includes("..")
                || typeof packet.digest !== "string"
                || !sha256Pattern.test(packet.digest)
                || !Number.isInteger(packet.packetBytes)
                || Number(packet.packetBytes) < 0
                || !Number.isInteger(packet.originalBytes)
                || Number(packet.originalBytes) < 0
              ) {
                throw new WorkflowTransitionError(`Review batch ${batchId} has malformed rolePacket.`);
              }
              return packet;
            });
            if (
              JSON.stringify(packets.map((packet) => String(packet.activityId)).sort())
              !== JSON.stringify(expectedActivities)
              || packets.some((packet) => semanticScope.roleScopes.find((roleScope) =>
                roleScope.activityId === packet.activityId && roleScope.role === packet.role
              ) === undefined)
            ) {
              throw new WorkflowTransitionError(`Review batch ${batchId} rolePackets do not match its role scopes.`);
            }
          }
        }
      }
      runtime.reviewBatches.set(
        batchId,
        inputDigest === undefined ? undefined : requireDigest(inputDigest, "inputDigest")
      );
      if (payload.reviewerExecutionPolicy === "reviewer-execution-policy-v1") {
        runtime.reviewerBudgetedBatches.add(batchId);
      }
      return;
    }
    case "ReviewerDispatched": {
      const activity = activityFor(activities, payload);
      if (activity.definition.kind !== "review") {
        throw new WorkflowTransitionError(
          `ReviewerDispatched requires a review activity; ${activity.id} is ${activity.definition.kind}.`
        );
      }
      const batchId = stringField(payload, "batchId");
      if (!runtime.reviewBatches.has(batchId) && event.definitionVersion !== "vnext-1") {
        throw new WorkflowTransitionError(
          `Reviewer dispatch requires started review batch ${batchId}.`
        );
      }
      const scopedActivities = runtime.reviewBatchActivities.get(batchId);
      if (scopedActivities && !scopedActivities.has(activity.id)) {
        throw new WorkflowTransitionError(
          `Reviewer dispatch ${activity.id} is outside batch ${batchId} scope.`
        );
      }
      const eventInputDigest = payload.inputDigest;
      const batchInputDigest = runtime.reviewBatchRoleDigests.get(batchId)?.get(activity.id)
        ?? runtime.reviewBatches.get(batchId);
      if (eventInputDigest !== undefined && typeof eventInputDigest !== "string") {
        throw new WorkflowTransitionError(`Reviewer dispatch ${activity.id} has an invalid inputDigest.`);
      }
      if (batchInputDigest === undefined && typeof eventInputDigest === "string") {
        runtime.reviewBatches.set(batchId, requireDigest(eventInputDigest, "inputDigest"));
      } else if (
        batchInputDigest !== undefined
        && (
          typeof eventInputDigest !== "string"
          || requireDigest(eventInputDigest, "inputDigest") !== batchInputDigest
        )
      ) {
        throw new WorkflowTransitionError(
          `Reviewer dispatch ${activity.id} does not match batch ${batchId} inputDigest.`
        );
      }
      if (eventInputDigest === undefined) {
        throw new WorkflowTransitionError(
          `Reviewer dispatch ${activity.id} requires the immutable batch inputDigest.`
        );
      }
      const joinRoles = runtime.reviewerJoinRequirements.get(activity.id);
      requireState(activity, joinRoles ? ["READY", "RUNNING", "RETRY_WAIT"] : ["READY", "RETRY_WAIT"], event);
      const role = joinRoles || event.definitionVersion === "v1"
        ? stringField(payload, "role")
        : undefined;
      if (joinRoles && !joinRoles.includes(role!)) {
        throw new WorkflowTransitionError(
          `Reviewer role ${role} is not part of the current review batch ${activity.id}.`
        );
      }
      if (event.definitionVersion === "v1") {
        const expectedRole = activity.definition.metadata?.role;
        if (typeof expectedRole !== "string" || role !== expectedRole) {
          throw new WorkflowTransitionError(
            `Reviewer role ${role} does not match ${activity.id} role ${String(expectedRole)}.`
          );
        }
        const attempt = payload.attempt;
        if (!Number.isInteger(attempt) || attempt !== activity.attempt + 1) {
          throw new WorkflowTransitionError(
            `Reviewer dispatch ${activity.id} requires attempt ${activity.attempt + 1}.`
          );
        }
      }
      const dispatched = runtime.reviewerDispatches.get(activity.id) ?? new Set<string>();
      if (role && dispatched.has(role)) {
        throw new WorkflowTransitionError(
          `Reviewer role ${role} was already dispatched for ${activity.id}.`
        );
      }
      requireConcurrencyCapacity(activity, activities, runtime);
      if (activity.state === "READY" || activity.state === "RETRY_WAIT") {
        activity.state = "RUNNING";
        activity.attempt += 1;
        activity.retryAt = undefined;
      }
      runtime.reviewerBatchByActivity.set(activity.id, batchId);
      if (role) {
        dispatched.add(role);
        runtime.reviewerDispatches.set(activity.id, dispatched);
        activity.reviewerDispatchedRoles = [...dispatched];
      }
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ReviewerModelCallStarted": {
      const activity = activityFor(activities, payload);
      if (event.definitionVersion !== "v1" || activity.definition.kind !== "review"
        || !runtime.reviewerBudgetedBatches.has(stringField(payload, "batchId"))) {
        throw new WorkflowTransitionError("ReviewerModelCallStarted is only valid for budgeted current review activities.");
      }
      requireState(activity, ["RUNNING"], event);
      const attempt = payload.attempt;
      const batchId = stringField(payload, "batchId");
      if (!Number.isInteger(attempt) || attempt !== activity.attempt
        || runtime.reviewerBatchByActivity.get(activity.id) !== batchId) {
        throw new WorkflowTransitionError("ReviewerModelCallStarted must belong to the current dispatched reviewer attempt.");
      }
      const supplemental = payload.supplemental === true;
      const calls = runtime.reviewerModelCalls.get(activity.id) ?? [];
      const current = calls.filter((call) => call.batchId === batchId && call.attempt === attempt);
      if (current.some((call) => !call.completedAt) || current.length >= (supplemental ? 2 : 1)
        || (supplemental && (current.length !== 1 || payload.priorResponseInvalid !== true
          || !sha256Pattern.test(stringField(payload, "invalidResponseDigest"))))) {
        throw new WorkflowTransitionError("Reviewer model call exceeds its frozen call budget.");
      }
      calls.push({ batchId, attempt, startedAt: event.occurredAt, supplemental });
      runtime.reviewerModelCalls.set(activity.id, calls);
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ReviewerModelCallCompleted": {
      const activity = activityFor(activities, payload);
      if (event.definitionVersion !== "v1" || activity.definition.kind !== "review"
        || !runtime.reviewerBudgetedBatches.has(runtime.reviewerBatchByActivity.get(activity.id) ?? "")) {
        throw new WorkflowTransitionError("ReviewerModelCallCompleted is only valid for budgeted current review activities.");
      }
      const attempt = payload.attempt;
      const batchId = stringField(payload, "batchId");
      if (!Number.isInteger(attempt) || attempt !== activity.attempt
        || runtime.reviewerBatchByActivity.get(activity.id) !== batchId) {
        throw new WorkflowTransitionError("ReviewerModelCallCompleted must belong to the current reviewer attempt.");
      }
      const calls = runtime.reviewerModelCalls.get(activity.id) ?? [];
      const current = [...calls].reverse().find((call) =>
        call.batchId === batchId && call.attempt === attempt && !call.completedAt
      );
      if (!current) throw new WorkflowTransitionError("Reviewer model call completion has no open call.");
      requireDigest(stringField(payload, "resultDigest"), "resultDigest");
      current.completedAt = event.occurredAt;
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ReviewerSubmitted": {
      const activity = activityFor(activities, payload);
      if (activity.definition.kind !== "review") {
        throw new WorkflowTransitionError(
          `ReviewerSubmitted requires a review activity; ${activity.id} is ${activity.definition.kind}.`
        );
      }
      requireState(activity, ["RUNNING"], event);
      const currentBatchId = runtime.reviewerBatchByActivity.get(activity.id) ?? "";
      const budgetedReview = runtime.reviewerBudgetedBatches.has(currentBatchId);
      if (budgetedReview && payload.deterministic !== undefined) {
        const calls = runtime.reviewerModelCalls.get(activity.id)?.filter((call) =>
          call.batchId === currentBatchId && call.attempt === activity.attempt
        ) ?? [];
        if (calls.length > 0) throw new WorkflowTransitionError("Deterministic reviewer must not record model calls.");
      }
      if (budgetedReview && payload.deterministic === undefined) {
        const calls = runtime.reviewerModelCalls.get(activity.id)?.filter((call) =>
          call.batchId === currentBatchId && call.attempt === activity.attempt
        ) ?? [];
        if (!calls.length || calls.some((call) => !call.completedAt)) {
          throw new WorkflowTransitionError("Reviewer submission requires one completed model call for the current attempt.");
        }
        const elapsed = Date.parse(event.occurredAt) - Date.parse(calls[0]!.startedAt);
        if (Number.isFinite(elapsed) && elapsed > 10 * 60_000) {
          throw new WorkflowTransitionError("Reviewer submission exceeded the 10 minute execution budget.");
        }
      }
      const batchId = stringField(payload, "batchId");
      if (runtime.reviewerBatchByActivity.get(activity.id) !== batchId) {
        throw new WorkflowTransitionError(
          `Reviewer submission ${activity.id} does not match its dispatched batch ${batchId}.`
        );
      }
      const batchInputDigest = runtime.reviewBatchRoleDigests.get(batchId)?.get(activity.id)
        ?? runtime.reviewBatches.get(batchId);
      const eventInputDigest = payload.inputDigest;
      if (
        batchInputDigest !== undefined
        && eventInputDigest !== undefined
        && (
          typeof eventInputDigest !== "string"
          || requireDigest(eventInputDigest, "inputDigest") !== batchInputDigest
        )
      ) {
        throw new WorkflowTransitionError(
          `Reviewer submission ${activity.id} does not match batch ${batchId} inputDigest.`
        );
      }
      if (event.definitionVersion === "v1") {
        if (typeof eventInputDigest !== "string") {
          throw new WorkflowTransitionError(
            `Reviewer submission ${activity.id} requires the immutable batch inputDigest.`
          );
        }
        stringField(payload, "planEvidenceRef");
        requireDigest(stringField(payload, "planEvidenceDigest"), "planEvidenceDigest");
      }
      const joinRoles = runtime.reviewerJoinRequirements.get(activity.id);
      const submittedRole = joinRoles || event.definitionVersion === "v1"
        ? stringField(payload, "role")
        : undefined;
      if (event.definitionVersion === "v1") {
        const expectedRole = activity.definition.metadata?.role;
        if (typeof expectedRole !== "string" || submittedRole !== expectedRole) {
          throw new WorkflowTransitionError(
            `Reviewer role ${submittedRole} does not match ${activity.id} role ${String(expectedRole)}.`
          );
        }
        const attempt = payload.attempt;
        if (!Number.isInteger(attempt) || attempt !== activity.attempt) {
          throw new WorkflowTransitionError(
            `Reviewer submission ${activity.id} requires current attempt ${activity.attempt}.`
          );
        }
        const dispatched = runtime.reviewerDispatches.get(activity.id);
        if (!dispatched?.has(submittedRole!)) {
          throw new WorkflowTransitionError(
            `Reviewer role ${submittedRole} was not dispatched for ${activity.id}.`
          );
        }
      }
      if (joinRoles) {
        const role = submittedRole!;
        if (!joinRoles.includes(role)) {
          throw new WorkflowTransitionError(
            `Reviewer role ${role} is not part of the current review batch ${activity.id}.`
          );
        }
        const dispatched = runtime.reviewerDispatches.get(activity.id) ?? new Set<string>();
        if (!dispatched.has(role)) {
          throw new WorkflowTransitionError(
            `Reviewer role ${role} was not dispatched for ${activity.id}.`
          );
        }
        const submitted = runtime.reviewerSubmissions.get(activity.id) ?? new Set<string>();
        if (submitted.has(role)) {
          throw new WorkflowTransitionError(
            `Reviewer role ${role} was already submitted for ${activity.id}.`
          );
        }
        submitted.add(role);
        runtime.reviewerSubmissions.set(activity.id, submitted);
        activity.reviewerSubmittedRoles = [...submitted];
        if (joinRoles.every((expectedRole) => submitted.has(expectedRole))) {
          activity.state = "SUCCEEDED";
        }
      } else {
        if (submittedRole) {
          const submitted = runtime.reviewerSubmissions.get(activity.id) ?? new Set<string>();
          submitted.add(submittedRole);
          runtime.reviewerSubmissions.set(activity.id, submitted);
          activity.reviewerSubmittedRoles = [...submitted];
        }
        activity.state = "SUCCEEDED";
      }
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ReviewerWaived": {
      const activity = activityFor(activities, payload);
      if (event.definitionVersion !== "v1"
        || activity.definition.kind !== "review"
        || activity.definition.metadata?.failurePolicy !== "lean_warning_strict_block") {
        throw new WorkflowTransitionError(
          `ReviewerWaived is not supported by review activity ${activity.id}.`
        );
      }
      requireState(activity, ["FAILED"], event);
      if (payload.profile !== "lean") {
        throw new WorkflowTransitionError("ReviewerWaived requires the lean candidate profile.");
      }
      stringField(payload, "batchId");
      stringField(payload, "warning");
      runtime.reviewerDispatches.delete(activity.id);
      runtime.reviewerSubmissions.delete(activity.id);
      runtime.reviewerBatchByActivity.delete(activity.id);
      activity.reviewerDispatchedRoles = [];
      activity.reviewerSubmittedRoles = [];
      activity.state = "CANCELLED";
      activity.outcome = "waived_with_warning";
      activity.lastEventSeq = event.seq;
      return;
    }
    case "ActivitiesInvalidated": {
      const invalidated = new Set(stringArray(payload, "activityIds"));
      if (!invalidated.size) {
        throw new WorkflowTransitionError("ActivitiesInvalidated requires at least one activity.");
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of Object.values(activities)) {
          if (!invalidated.has(candidate.id)
            && candidate.definition.dependencies.some((dependency) => invalidated.has(dependency))) {
            invalidated.add(candidate.id);
            changed = true;
          }
        }
      }
      const inFlight = [...invalidated].filter((activityId) => {
        const activity = activities[activityId];
        if (!activity) throw new WorkflowTransitionError(`Invalidation references unknown activity ${activityId}.`);
        return activity.state === "RUNNING" || activity.unresolvedExternalOperationIds.length > 0;
      });
      if (inFlight.length) {
        throw new WorkflowTransitionError(
          `Activity invalidation cannot reset in-flight activities: ${inFlight.join(", ")}.`
        );
      }
      for (const activityId of invalidated) {
        const activity = activities[activityId]!;
        activity.state = "PENDING";
        activity.outcome = undefined;
        activity.retryAt = undefined;
        activity.callbackId = undefined;
        activity.callbackSubjectDigest = undefined;
        activity.callbackSubjectSchemaVersion = undefined;
        activity.decisionOriginCallbackId = undefined;
        activity.decisionOriginSubjectDigest = undefined;
        activity.decisionOriginSubjectSchemaVersion = undefined;
        activity.blockerIds = [];
        activity.unresolvedExternalOperationIds = [];
        if (activity.definition.kind === "review") {
          activity.attempt = 0;
          activity.reviewerDispatchedRoles = [];
          activity.reviewerSubmittedRoles = [];
          runtime.reviewerDispatches.delete(activityId);
          runtime.reviewerSubmissions.delete(activityId);
          runtime.reviewerBatchByActivity.delete(activityId);
          runtime.reviewerModelCalls.delete(activityId);
        }
        activity.lastEventSeq = event.seq;
        runtime.preparedArtifacts.delete(activityId);
        runtime.externalOperationsStarted.delete(activityId);
        runtime.externalOperationsReconciled.delete(activityId);
        runtime.blockedPreviousStates.delete(activityId);
      }
      return;
    }
    case "ReviewBatchInvalidated": {
      const invalidated = new Set(stringArray(payload, "activityIds"));
      const directlyInvalidated = new Set(invalidated);
      const batchId = stringField(payload, "batchId");
      const inputDrift = payload.reason === "input_drift";
      const invalidatesReview = invalidated.size > 0 && [...invalidated].every((activityId) =>
        activities[activityId]?.definition.kind === "review"
        && runtime.reviewerBatchByActivity.get(activityId) === batchId
      );
      if (!invalidatesReview || !runtime.reviewBatches.has(batchId)) {
        throw new WorkflowTransitionError("ReviewBatchInvalidated requires started batch-owned review activities only.");
      }
      if (event.definitionVersion === "v1") {
        const inputDigest = requireDigest(stringField(payload, "inputDigest"), "inputDigest");
        if (runtime.reviewBatches.get(batchId) !== inputDigest) {
          throw new WorkflowTransitionError(`Review batch ${batchId} inputDigest does not match its started batch.`);
        }
      }
      if (event.definitionVersion === "v1") {
        const revisionDigest = requireDigest(stringField(payload, "revisionDigest"), "revisionDigest");
        const findingsDigest = requireDigest(stringField(payload, "findingsDigest"), "findingsDigest");
        const signature = `${revisionDigest}:${findingsDigest}`;
        runtime.unchangedReviewRevisionCycles = signature === runtime.lastReviewRevisionSignature
          ? runtime.unchangedReviewRevisionCycles + 1
          : 0;
        runtime.lastReviewRevisionSignature = signature;
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of Object.values(activities)) {
          if (!invalidated.has(candidate.id)
            && candidate.definition.dependencies.some((dependency) => invalidated.has(dependency))) {
            invalidated.add(candidate.id);
            changed = true;
          }
        }
      }
      const inFlight = [...invalidated].filter((activityId) => {
        const activity = activities[activityId];
        if (!activity) {
          throw new WorkflowTransitionError(
            `Review invalidation references unknown activity ${activityId}.`
          );
        }
        if (activity.unresolvedExternalOperationIds.length > 0) return true;
        if (activity.state !== "RUNNING") return false;
        return !(
          inputDrift
          && directlyInvalidated.has(activityId)
          && activity.definition.kind === "review"
        );
      });
      if (inFlight.length) {
        throw new WorkflowTransitionError(
          `Review invalidation cannot reset in-flight activities: ${inFlight.join(", ")}.`
        );
      }
      for (const activityId of invalidated) {
        const activity = activities[activityId];
        activity.state = "PENDING";
        if (activity.definition.kind === "review") activity.attempt = 0;
        activity.outcome = undefined;
        activity.retryAt = undefined;
        activity.callbackId = undefined;
        activity.callbackSubjectDigest = undefined;
        activity.callbackSubjectSchemaVersion = undefined;
        activity.decisionOriginCallbackId = undefined;
        activity.decisionOriginSubjectDigest = undefined;
        activity.decisionOriginSubjectSchemaVersion = undefined;
        activity.blockerIds = [];
        activity.unresolvedExternalOperationIds = [];
        activity.reviewerDispatchedRoles = [];
        activity.reviewerSubmittedRoles = [];
        runtime.reviewerDispatches.delete(activityId);
        runtime.reviewerSubmissions.delete(activityId);
        runtime.reviewerBatchByActivity.delete(activityId);
        runtime.preparedArtifacts.delete(activityId);
        runtime.externalOperationsStarted.delete(activityId);
        runtime.externalOperationsReconciled.delete(activityId);
        runtime.blockedPreviousStates.delete(activityId);
        activity.lastEventSeq = event.seq;
      }
      if (
        invalidatesReview
        && runtime.reviewPolicy
        && runtime.unchangedReviewRevisionCycles >= runtime.reviewPolicy.maxUnchangedRevisionCycles
      ) {
        const blockerId = `review-no-progress-${event.payload.batchId ?? event.seq}`;
        const detail = "Review evolution produced the same revision and findings digest repeatedly.";
        runtime.blockerDetails.set(blockerId, detail);
        for (const activityId of invalidated) {
          const activity = activities[activityId]!;
          if (activity.definition.phase !== "case_review") continue;
          runtime.blockedPreviousStates.set(activityId, activity.state);
          activity.blockerIds = [...new Set([...activity.blockerIds, blockerId])];
          activity.state = "BLOCKED";
        }
      }
      return;
    }
  }
}

export function reduceWorkflow(
  events: readonly WorkflowEvent[],
  pinnedDefinition?: WorkflowDefinition
): WorkflowProjection {
  if (!events.length) throw new WorkflowTransitionError("Workflow history is empty.");
  if (pinnedDefinition) validateWorkflowDefinition(pinnedDefinition);
  const started = events[0]!;
  if (started.type !== "WorkflowStarted") throw new WorkflowTransitionError("WorkflowStarted must be the first event.");
  const expanded = events.find((event) => event.type === "ActivitiesExpanded");
  if (!expanded) throw new WorkflowTransitionError("Workflow history is missing ActivitiesExpanded.");
  const planDigest = stringField(started.payload, "planDigest");
  const graphDigest = stringField(started.payload, "graphDigest");
  const requestPolicy = expanded.payload.requestPolicy as unknown as RequestPolicy;
  if (!requestPolicy || requestPolicy.schemaVersion !== "request-policy-v1") {
    throw new WorkflowTransitionError("ActivitiesExpanded requires the frozen request-policy-v1.");
  }
  if (pinnedDefinition
    && (pinnedDefinition.planDigest !== planDigest || pinnedDefinition.graphDigest !== graphDigest)) {
    throw new WorkflowTransitionError("Pinned workflow definition digest does not match WorkflowStarted.");
  }
  if (stringField(expanded.payload, "planDigest") !== planDigest
    || stringField(expanded.payload, "graphDigest") !== graphDigest) {
    throw new WorkflowTransitionError("ActivitiesExpanded does not match the pinned workflow digests.");
  }
  let definitions = pinnedDefinition?.activities ?? definitionsFromExpanded(expanded);
  let expandedDefinition: WorkflowDefinition = {
    schemaVersion: "test-workflow-definition-v1",
    definitionId: started.definitionId,
    definitionVersion: started.definitionVersion,
    requestId: started.requestId,
    planDigest,
    graphDigest,
    capabilities: Array.isArray(expanded.payload.capabilities)
      ? expanded.payload.capabilities as WorkflowDefinition["capabilities"]
      : [],
    writesData: expanded.payload.writesData === true,
    requestPolicy,
    deliveryTarget: expanded.payload.deliveryTarget as WorkflowDefinition["deliveryTarget"],
    reviewPolicy: expanded.payload.reviewPolicy as unknown as ReviewPolicy,
    activities: definitionsFromExpanded(expanded)
  };
  validateWorkflowDefinition(expandedDefinition);
  if (pinnedDefinition && pinnedDefinition.graphDigest !== expandedDefinition.graphDigest) {
    throw new WorkflowTransitionError("Expanded workflow definition differs from the pinned graph.");
  }
  const activities = initializeActivities(definitions);
  let effectiveGraphDigest = graphDigest;
  const identity = {
    runId: started.runId,
    requestId: started.requestId,
    definitionId: started.definitionId,
    definitionVersion: started.definitionVersion
  };
  const runtime: ReducerRuntime = {
    suspended: false,
    globalBlockers: new Map(),
    blockerDetails: new Map(),
    resolvedCallbacks: new Set(),
    resolvedCallbackDetails: new Map(),
    succeededActivityDetails: new Map(),
    blockedPreviousStates: new Map(),
    reviewerJoinRequirements: new Map(),
    reviewerDispatches: new Map(),
    reviewerSubmissions: new Map(),
    reviewBatches: new Map(),
    reviewBatchRoleDigests: new Map(),
    reviewBatchActivities: new Map(),
    reviewerBatchByActivity: new Map(),
    preparedArtifacts: new Map(),
    externalOperationsStarted: new Map(),
    externalOperationsReconciled: new Map(),
    candidateGenerationStartedAttempts: new Map(),
    reviewerModelCalls: new Map(),
    reviewerBudgetedBatches: new Set(),
    reviewPolicy: pinnedDefinition?.reviewPolicy ?? expandedDefinition.reviewPolicy,
    unchangedReviewRevisionCycles: 0
  };
  if (identity.definitionVersion === "vnext-1" && expandedDefinition.writesData) {
    for (const activity of Object.values(activities)) {
      if (
        activity.definition.kind === "review"
        && activity.definition.metadata?.role === "traceability"
      ) {
        const roles = ["traceability", "impact"];
        runtime.reviewerJoinRequirements.set(activity.id, roles);
        activity.reviewerExpectedRoles = roles;
        activity.reviewerDispatchedRoles = [];
        activity.reviewerSubmittedRoles = [];
      }
    }
  }
  let sawExpanded = false;
  let sawCandidateGraph = false;
  let sawRunIntent = false;
  let sawImpactClosure = false;
  let sawDesignDelta = false;
  let runIntent: WorkflowProjection["runIntent"];

  for (const event of events) {
    if (!(workflowEventTypes as readonly string[]).includes(event.type)) {
      throw new WorkflowTransitionError(`Unsupported workflow event type ${String(event.type)}.`);
    }
    if (event.runId !== identity.runId
      || event.requestId !== identity.requestId
      || event.definitionId !== identity.definitionId
      || event.definitionVersion !== identity.definitionVersion) {
      throw new WorkflowTransitionError(`Event ${event.seq} belongs to a different pinned workflow run.`);
    }
    if (runtime.terminal) {
      throw new WorkflowTransitionError(`Event ${event.seq} appears after terminal workflow state.`);
    }
    if (event.type === "WorkflowStarted") {
      if (event.seq !== started.seq) throw new WorkflowTransitionError("WorkflowStarted may occur only once.");
      continue;
    }
    if (event.type === "ActivitiesExpanded") {
      if (sawExpanded) throw new WorkflowTransitionError("ActivitiesExpanded may occur only once.");
      sawExpanded = true;
      materializeReady(activities, identity.definitionVersion);
      continue;
    }
    if (event.type === "CandidateGraphExpanded") {
      if (identity.definitionVersion !== "v1") {
        throw new WorkflowTransitionError("CandidateGraphExpanded is only valid for v1 workflows.");
      }
      if (sawCandidateGraph) {
        throw new WorkflowTransitionError("CandidateGraphExpanded may occur only once.");
      }
      const rootActivityId = typeof event.payload.rootActivityId === "string"
        ? event.payload.rootActivityId
        : "candidate-skeleton";
      const rootActivity = activities[rootActivityId];
      const validRoot = rootActivity?.definition.kind === "candidate_compiler";
      if (!rootActivity || !validRoot
        || !runtime.succeededActivityDetails.has(rootActivityId)) {
        throw new WorkflowTransitionError("CandidateGraphExpanded requires its frozen compiler root to succeed first.");
      }
      if (stringField(event.payload, "parentGraphDigest") !== effectiveGraphDigest) {
        throw new WorkflowTransitionError("CandidateGraphExpanded parentGraphDigest does not match the active graph.");
      }
      requireDigest(stringField(event.payload, "skeletonDigest"), "skeletonDigest");
      const scope = stringField(event.payload, "scope");
      if (scope !== "full" && scope !== "affected") {
        throw new WorkflowTransitionError("CandidateGraphExpanded scope must be full or affected.");
      }
      let manifest;
      try {
        manifest = parseCandidateFragmentManifest(JSON.stringify({
          schemaVersion: "candidate-fragment-manifest-v1",
          scope,
          modules: event.payload.modules
        }));
      } catch (error) {
        throw new WorkflowTransitionError(
          `CandidateGraphExpanded modules are not a valid frozen skeleton: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (candidateFragmentManifestDigest(manifest) !== stringField(event.payload, "skeletonDigest")) {
        throw new WorkflowTransitionError("CandidateGraphExpanded skeletonDigest does not match its frozen modules.");
      }
      requireDigest(stringField(event.payload, "compilerSpecDigest"), "compilerSpecDigest");
      const additions = definitionsFromExpanded(event);
      if (!additions.length || additions.some((activity) => activities[activity.id])) {
        throw new WorkflowTransitionError("CandidateGraphExpanded contains no activities or duplicates an existing activity.");
      }
      const expectedAdditions = buildCandidateExtension({
        modules: manifest.modules,
        scope,
        capabilities: expandedDefinition.capabilities,
        writesData: expandedDefinition.writesData,
        deliveryTarget: expandedDefinition.deliveryTarget ?? "full_run",
        reviewPolicy: expandedDefinition.reviewPolicy!,
        generationPolicyVersion: rootActivity.definition
          ?.metadata?.generationPolicyVersion as "candidate-generation-policy-v1" | undefined
        ,rootActivityId
        ,...(rootActivity.definition.metadata?.candidateNamespace === "delta"
          ? { candidateNamespace: "delta" as const }
          : {})
      });
      addCurrentReadinessPreflight(expectedAdditions);
      if (
        canonicalJson(additions as unknown as SafeJsonValue)
        !== canonicalJson(expectedAdditions as unknown as SafeJsonValue)
      ) {
        throw new WorkflowTransitionError("CandidateGraphExpanded activities do not match the frozen skeleton extension.");
      }
      const candidate: WorkflowDefinition = {
        ...expandedDefinition,
        activities: [...definitions, ...additions],
        graphDigest: stringField(event.payload, "graphDigest")
      };
      if (workflowGraphDigest({
        schemaVersion: candidate.schemaVersion,
        definitionId: candidate.definitionId,
        definitionVersion: candidate.definitionVersion,
        requestId: candidate.requestId,
        planDigest: candidate.planDigest,
        capabilities: candidate.capabilities,
        writesData: candidate.writesData,
        requestPolicy: candidate.requestPolicy,
        deliveryTarget: candidate.deliveryTarget,
        reviewPolicy: candidate.reviewPolicy,
        activities: candidate.activities
      }) !== candidate.graphDigest) {
        throw new WorkflowTransitionError("CandidateGraphExpanded graphDigest does not match its appended activities.");
      }
      validateWorkflowDefinition(candidate);
      definitions = candidate.activities;
      expandedDefinition = candidate;
      for (const addition of additions) {
        activities[addition.id] = {
          id: addition.id,
          definition: addition,
          state: "PENDING",
          attempt: 0,
          blockerIds: [],
          unresolvedExternalOperationIds: []
        };
      }
      effectiveGraphDigest = candidate.graphDigest;
      sawCandidateGraph = true;
      materializeReady(activities, identity.definitionVersion);
      continue;
    }
    if (event.type === "RunIntentDerived") {
      if (identity.definitionVersion !== "v1") {
        throw new WorkflowTransitionError("RunIntentDerived is only valid for v1 workflows.");
      }
      if (sawRunIntent) throw new WorkflowTransitionError("RunIntentDerived may occur only once.");
      const activity = activityFor(activities, event.payload);
      if (activity.id !== "run-intent-derive" || activity.state !== "RUNNING") {
        throw new WorkflowTransitionError("RunIntentDerived requires the current run-intent-derive attempt.");
      }
      if (event.payload.attempt !== activity.attempt
        || event.payload.schemaVersion !== "run-intent-v1") {
        throw new WorkflowTransitionError("RunIntentDerived attempt or schema does not match the active run intent.");
      }
      requireDigest(stringField(event.payload, "digest"), "runIntent digest");
      const path = stringField(event.payload, "path");
      if (!path.startsWith(".local/test-runs/") || path.includes("..")) {
        throw new WorkflowTransitionError("RunIntentDerived path must be a safe local run archive path.");
      }
      const decision = stringField(event.payload, "decision");
      if (decision !== activity.definition.metadata?.decision) {
        throw new WorkflowTransitionError("RunIntentDerived decision differs from the frozen reuse assessment.");
      }
      runIntent = {
        decision,
        suiteId: stringField(event.payload, "suiteId"),
        digest: stringField(event.payload, "digest"),
        ...(typeof event.payload.suiteVersion === "string" ? { suiteVersion: event.payload.suiteVersion } : {}),
        ...(typeof event.payload.environment === "string" ? { environment: event.payload.environment } : {}),
        ...(event.payload.deliveryTarget === "testcase_only" || event.payload.deliveryTarget === "script_only" || event.payload.deliveryTarget === "full_run"
          ? { deliveryTarget: event.payload.deliveryTarget }
          : {}),
        ...(Array.isArray(event.payload.selectedCaseIds) ? { selectedCaseIds: event.payload.selectedCaseIds.filter((value): value is string => typeof value === "string") } : {}),
        ...(Array.isArray(event.payload.affectedCaseIds) ? { affectedCaseIds: event.payload.affectedCaseIds.filter((value): value is string => typeof value === "string") } : {}),
        ...(typeof event.payload.sourceDigest === "string" ? { sourceDigest: event.payload.sourceDigest } : {}),
        ...(typeof event.payload.boundaryDigest === "string" ? { boundaryDigest: event.payload.boundaryDigest } : {})
      };
      sawRunIntent = true;
      continue;
    }
    if (event.type === "ImpactClosureBuilt") {
      if (identity.definitionVersion !== "v1" || sawImpactClosure) {
        throw new WorkflowTransitionError("ImpactClosureBuilt is valid once for a v1 workflow only.");
      }
      const activity = activityFor(activities, event.payload);
      if (activity.id !== "impact-closure-build" || activity.state !== "RUNNING"
        || event.payload.attempt !== activity.attempt
        || event.payload.schemaVersion !== "impact-closure-v1") {
        throw new WorkflowTransitionError("ImpactClosureBuilt does not match the active closure attempt.");
      }
      requireDigest(stringField(event.payload, "digest"), "impact closure digest");
      requireDigest(stringField(event.payload, "baselineVersion"), "impact closure baselineVersion");
      if (!Array.isArray(event.payload.caseIds) || !event.payload.caseIds.length || event.payload.caseIds.length > 8) {
        throw new WorkflowTransitionError("ImpactClosureBuilt must freeze 1 to 8 semantic cases.");
      }
      sawImpactClosure = true;
      continue;
    }
    if (event.type === "DesignDeltaPrepared") {
      if (identity.definitionVersion !== "v1" || sawDesignDelta || !sawImpactClosure) {
        throw new WorkflowTransitionError("DesignDeltaPrepared requires one prior v1 impact closure.");
      }
      const activity = activityFor(activities, event.payload);
      if (activity.id !== "delta-preflight" || activity.state !== "RUNNING"
        || event.payload.attempt !== activity.attempt
        || event.payload.schemaVersion !== "design-delta-v1") {
        throw new WorkflowTransitionError("DesignDeltaPrepared does not match the active delta preflight attempt.");
      }
      requireDigest(stringField(event.payload, "digest"), "design delta digest");
      requireDigest(stringField(event.payload, "baselineVersion"), "design delta baselineVersion");
      if (!Array.isArray(event.payload.caseIds) || !event.payload.caseIds.length
        || !Array.isArray(event.payload.ruleIds) || !event.payload.ruleIds.length
        || !Array.isArray(event.payload.moduleIds) || !event.payload.moduleIds.length) {
        throw new WorkflowTransitionError("DesignDeltaPrepared must bind a non-empty case scope and explicit RULE scope.");
      }
      sawDesignDelta = true;
      continue;
    }
    if (!sawExpanded) {
      throw new WorkflowTransitionError(`${event.type} appears before ActivitiesExpanded.`);
    }
    if (event.type === "WorkflowSuspended") {
      runtime.suspended = true;
    } else if (event.type === "WorkflowResumed") {
      if (!runtime.suspended) throw new WorkflowTransitionError("WorkflowResumed requires a suspended workflow.");
      runtime.suspended = false;
    } else if (event.type === "WorkflowCancelled") {
      const inFlight = Object.values(activities).filter((activity) =>
        ["RUNNING", "RECONCILING"].includes(activity.state)
        || activity.unresolvedExternalOperationIds.length > 0
      );
      const prepared = [...runtime.preparedArtifacts.keys()].filter((activityId) =>
        activities[activityId]?.state !== "SUCCEEDED"
      );
      if (inFlight.length || prepared.length) {
        throw new WorkflowTransitionError(
          `WorkflowCancelled requires all in-flight work to be reconciled: ${[
            ...inFlight.map((activity) => activity.id),
            ...prepared
          ].join(", ")}.`
        );
      }
      runtime.terminal = "CANCELLED";
      for (const activity of Object.values(activities)) {
        if (!["SUCCEEDED", "FAILED"].includes(activity.state)) activity.state = "CANCELLED";
      }
    } else if (event.type === "WorkflowCompleted") {
      if (runtime.suspended || runtime.globalBlockers.size) {
        throw new WorkflowTransitionError("WorkflowCompleted cannot close a suspended or blocked workflow.");
      }
      const incomplete = Object.values(activities).filter((activity) =>
        activity.definition.required
        && activity.definition.kind !== "complete"
        && activity.state !== "SUCCEEDED"
        && !(activity.state === "CANCELLED" && activity.definition.activation !== undefined)
      );
      if (incomplete.length) {
        throw new WorkflowTransitionError(`WorkflowCompleted has incomplete activities: ${incomplete.map((item) => item.id).join(", ")}.`);
      }
      const formalReport = Object.values(activities).find((activity) =>
        activity.definition.kind === "report"
        && activity.definition.metadata?.completionContract
          === "formal-execution-completion-seal-v1"
      );
      if (formalReport) {
        const evidence = runtime.succeededActivityDetails.get(formalReport.id)
          ?.formalExecutionEvidence;
        if (!evidence || event.payload.testOutcome !== evidence.testOutcome) {
          throw new WorkflowTransitionError(
            "WorkflowCompleted must retain the sealed formal report test outcome."
          );
        }
      }
      const completion = Object.values(activities).find((activity) => activity.definition.kind === "complete");
      if (completion) completion.state = "SUCCEEDED";
      runtime.terminal = "SUCCEEDED";
      applyTestOutcome(event.payload, runtime);
    } else {
      applyActivityEvent(event, activities, runtime);
    }
    materializeReady(activities, identity.definitionVersion);
  }

  const readyActivities = Object.values(activities).filter((activity) => activity.state === "READY").map((activity) => activity.id);
  const runningActivities = Object.values(activities).filter((activity) => activity.state === "RUNNING").map((activity) => activity.id);
  const workflowState = deriveWorkflowState(activities, runtime, readyActivities, runningActivities);
  const waits = deriveWaits(activities, runtime);
  const terminal = ["SUCCEEDED", "CANCELLED"].includes(workflowState);
  const needsAction = ["WAITING_HUMAN", "BLOCKED", "SUSPENDED"].includes(workflowState);
  const firstWait = waits[0];
  const retryTimes = waits
    .filter((wait) => wait.kind === "retry" && wait.detail)
    .map((wait) => wait.detail!)
    .sort();
  const reconcilingActivities = Object.values(activities)
    .filter((activity) => activity.state === "RECONCILING")
    .map((activity) => activity.id);
  const nextActions = [...new Set([...readyActivities, ...reconcilingActivities])];
  const continuation: WorkflowProjection["continuation"] = terminal
    ? { kind: "stop", reason: "workflow_terminal" }
    : workflowState === "SUSPENDED"
      ? { kind: "stop", reason: "workflow_suspended" }
      : workflowState === "WAITING_HUMAN" || workflowState === "BLOCKED"
        ? {
            kind: "wait_user",
            ...(firstWait?.referenceId ? { referenceId: firstWait.referenceId } : {}),
            reason: workflowState.toLowerCase()
          }
        : readyActivities.length
          ? {
              kind: "continue_now",
              referenceId: readyActivities[0],
              reason: "ready_activity_available"
            }
          : workflowState === "RETRY_WAIT"
            ? {
                kind: "wait_until",
                ...(firstWait?.activityId ? { referenceId: firstWait.activityId } : {}),
                ...(retryTimes[0] ? { notBefore: retryTimes[0] } : {}),
                reason: "retry_not_due"
              }
            : workflowState === "RECONCILING"
              ? {
                  kind: "continue_now",
                  ...(reconcilingActivities[0]
                    ? { referenceId: reconcilingActivities[0] }
                    : {}),
                  reason: "reconciliation_required"
                }
              : {
                kind: "await_event",
                ...(firstWait?.referenceId || firstWait?.activityId
                  ? { referenceId: firstWait.referenceId ?? firstWait.activityId }
                  : runningActivities[0]
                    ? { referenceId: runningActivities[0] }
                    : {}),
                reason: workflowState === "WAITING_EXTERNAL"
                    ? "external_result_pending"
                    : "activity_in_flight"
              };
  const last = events.at(-1)!;
  return {
    runId: identity.runId,
    requestId: identity.requestId,
    definitionId: identity.definitionId,
    definitionVersion: identity.definitionVersion,
    graphDigest: effectiveGraphDigest,
    planDigest,
    requestPolicy: expandedDefinition.requestPolicy,
    ...(runIntent ? { runIntent } : {}),
    ...(runtime.reviewWorkbook ? { reviewWorkbook: runtime.reviewWorkbook } : {}),
    ...(expandedDefinition.deliveryTarget
      ? { deliveryTarget: expandedDefinition.deliveryTarget }
      : {}),
    ...(runtime.reviewPolicy ? { reviewPolicy: runtime.reviewPolicy } : {}),
    head: { seq: last.seq, digest: last.digest || GENESIS_DIGEST },
    workflowState,
    phase: phaseOf(activities),
    activities,
    readyActivities,
    runningActivities,
    waits,
    nextActions,
    testOutcome: runtime.testOutcome,
    continuation,
    reply: terminal
      ? { kind: "final", allowed: true, reason: "workflow_terminal" }
      : needsAction
        ? { kind: "action_required", allowed: true, reason: workflowState.toLowerCase() }
        : { kind: "none", allowed: false, reason: "automatic_work_remaining" }
  };
}
