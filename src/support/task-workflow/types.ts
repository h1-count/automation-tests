export const workflowEventTypes = [
  "WorkflowStarted",
  "ActivitiesExpanded",
  "ActivityAttemptStarted",
  "ActivitySucceeded",
  "ActivityFailed",
  "ArtifactPublishPrepared",
  "ArtifactDriftDetected",
  "RetryScheduled",
  "CallbackRequested",
  "CallbackResolved",
  "PlanConfirmationCarriedForward",
  "BlockerRaised",
  "BlockerResolved",
  "ExternalOperationStarted",
  "ExternalOperationReconciled",
  "ReviewBatchStarted",
  "ReviewerDispatched",
  "ReviewerSubmitted",
  "ReviewerWaived",
  "ReviewBatchInvalidated",
  "ActivitiesInvalidated",
  "WorkflowSuspended",
  "WorkflowResumed",
  "WorkflowCompleted",
  "WorkflowCancelled",
  "LegacyStateImported"
] as const;

export type WorkflowEventType = (typeof workflowEventTypes)[number];
export type WorkflowActorType = "user" | "agent" | "reviewer" | "runner" | "system";
export type JsonPrimitive = string | number | boolean | null;
export type SafeJsonValue = JsonPrimitive | SafeJsonValue[] | { [key: string]: SafeJsonValue };
export type SafeEventPayload = Record<string, SafeJsonValue>;

export interface WorkflowEvent {
  schemaVersion: "test-workflow-event-v1";
  eventId: string;
  seq: number;
  runId: string;
  requestId: string;
  definitionId: string;
  definitionVersion: string;
  type: WorkflowEventType;
  occurredAt: string;
  actorType: WorkflowActorType;
  causationId?: string;
  correlationId?: string;
  idempotencyKey: string;
  payload: SafeEventPayload;
  prevDigest: string;
  digest: string;
}

export interface NewWorkflowEvent {
  runId: string;
  requestId: string;
  definitionId: string;
  definitionVersion: string;
  type: WorkflowEventType;
  actorType: WorkflowActorType;
  idempotencyKey: string;
  payload?: SafeEventPayload;
  occurredAt?: string;
  eventId?: string;
  causationId?: string;
  correlationId?: string;
}

export interface WorkflowHistoryHead {
  seq: number;
  digest: string;
}

export const workflowCapabilities = ["web", "h5", "webview", "app", "api", "mqtt", "iot"] as const;
export type WorkflowCapability = (typeof workflowCapabilities)[number];

export const workflowDeliveryTargets = ["testcase_only", "script_only", "full_run"] as const;
export type WorkflowDeliveryTarget = (typeof workflowDeliveryTargets)[number];

export const workflowPhases = [
  "reuse_assessment",
  "planning",
  "plan_confirmation",
  "case_generation",
  "case_validation",
  "case_review",
  "initial_review",
  "review_resolution",
  "final_review",
  "case_confirmation",
  "engineering",
  "script_review",
  "execution_authorization",
  "execution",
  "reporting",
  "completion"
] as const;
export type WorkflowPhase = (typeof workflowPhases)[number];

export type ActivityKind =
  | "reuse_assessment"
  | "suite_validation"
  | "impact_location"
  | "policy_authorization"
  | "source_selection"
  | "candidate_generation"
  | "candidate_gate"
  | "plan_validation"
  | "callback"
  | "case_generation"
  | "relation_sync"
  | "completeness_validation"
  | "review"
  | "review_resolution"
  | "automatic_evolution"
  | "engineering"
  | "script_generation"
  | "script_review"
  | "execution_authorization"
  | "data_setup"
  | "execute"
  | "verify"
  | "cleanup"
  | "report"
  | "complete"
  | "build"
  | "readiness"
  | "run";

export interface WorkflowActivityDefinition {
  id: string;
  kind: ActivityKind;
  phase: WorkflowPhase;
  dependencies: string[];
  required: boolean;
  /**
   * The activity mutates reviewable workspace artifacts. Its successful event
   * must close a prepared publication from the same attempt with matching
   * read-back path digests.
   */
  publishesArtifacts?: boolean;
  /**
   * The activity performs a business write. At least one durable external
   * operation intent must be reconciled before the activity can succeed.
   */
  requiresExternalOperation?: boolean;
  capability?: WorkflowCapability;
  concurrencyGroup?: "reviewer" | "artifact_publish" | "business_write";
  concurrencyLimit?: number;
  /** Activates a conditional branch only after the referenced decision
   * activity succeeds with one of the listed outcomes. A non-matching branch
   * is deterministically projected as CANCELLED rather than persisted. */
  activation?: {
    activityId: string;
    outcomes: string[];
  };
  /**
   * Dependencies that may be skipped because their conditional branch did not
   * activate. New definitions must declare this explicitly; a cancelled branch
   * never satisfies an ordinary dependency.
   */
  optionalDependencies?: string[];
  metadata?: Record<string, SafeJsonValue>;
}

export interface WorkflowDefinition {
  schemaVersion: "test-workflow-definition-v1";
  definitionId: string;
  definitionVersion: string;
  requestId: string;
  planDigest: string;
  graphDigest: string;
  capabilities: WorkflowCapability[];
  writesData: boolean;
  /**
   * v7 runs pin the user-selected delivery endpoint before initialization.
   * Historical definitions omit it and are interpreted by their stored graph.
   */
  deliveryTarget?: WorkflowDeliveryTarget;
  /**
   * New v4+ runs pin their review policy with the graph. Older event histories
   * omit this field and remain replayable from their expanded activities.
   */
  reviewPolicy?: ReviewPolicy;
  activities: WorkflowActivityDefinition[];
}

export type ReviewRole =
  | "requirements"
  | "design"
  | "traceability"
  | "interaction"
  | "impact"
  | (string & {});

interface ReviewPolicyBase {
  requiredRoles: ReviewRole[];
  riskProfile?: "light" | "standard" | "strict";
  selectionReasons?: string[];
  maxAttemptsPerRole: number;
  maxUnchangedRevisionCycles: number;
}

export interface LegacyReviewPolicy extends ReviewPolicyBase {
  schemaVersion: "review-policy-v1";
  maxConcurrentReviewers: 3;
}

export interface TieredReviewPolicy extends ReviewPolicyBase {
  schemaVersion: "review-policy-v2";
  mode: "deterministic_only" | "combined" | "combined_with_impact";
  requiredRoles: [] | ["combined"] | ["combined", "impact"];
  maxConcurrentReviewers: 2;
  maxAttemptsPerRole: 3;
  maxUnchangedRevisionCycles: 2;
  maxSemanticEvolutionCycles: 2;
}

export interface AdaptiveReviewPolicy extends ReviewPolicyBase {
  schemaVersion: "review-policy-v3";
  mode: "risk_adaptive";
  requiredRoles: ["combined", "impact"];
  maxConcurrentReviewers: 2;
  maxAttemptsPerRole: 2;
  maxUnchangedRevisionCycles: 1;
  maxSemanticEvolutionCycles: 1;
}

export type ReviewPolicy = LegacyReviewPolicy | TieredReviewPolicy | AdaptiveReviewPolicy;

export interface BuildWorkflowDefinitionInput {
  requestId: string;
  planDigest: string;
  /**
   * New workflow creation may supply the current plan so reviewer roles are
   * selected from durable risk markers. Historical/direct callers that omit
   * it retain the legacy pinned reviewer policy.
   */
  planText?: string;
  capabilities: WorkflowCapability[];
  writesData?: boolean;
  deliveryTarget?: WorkflowDeliveryTarget;
  casePackages?: string[];
  reviewerRoles?: ReviewRole[];
  reviewPolicy?: {
    riskProfile?: "light" | "standard" | "strict";
    selectionReasons?: string[];
    maxAttemptsPerRole?: number;
    maxUnchangedRevisionCycles?: number;
    maxSemanticEvolutionCycles?: number;
  };
  executionIsolation?: {
    contexts: boolean;
    accounts: boolean;
    data: boolean;
    sharedAccount?: boolean;
  };
  definitionId?: string;
}

export interface ReusableWorkflowDefinitionInput extends BuildWorkflowDefinitionInput {
  reuseAssessment: {
    schemaVersion: "test-suite-reuse-assessment-v1";
    suiteId: string;
    suiteVersion?: string;
    assessmentDigest: string;
    decision: "direct_execute" | "affected_rebuild" | "full_replan";
    requestedProfile: "full_feature" | "smoke" | "affected" | "failed_or_blocked";
    effectiveProfile: "full_feature" | "smoke" | "affected" | "failed_or_blocked";
    selectedCaseIds: string[];
    affectedCaseIds: string[];
  };
}

export const activityStates = [
  "PENDING",
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "RETRY_WAIT",
  "WAITING_CALLBACK",
  "RECONCILING",
  "BLOCKED",
  "FAILED",
  "CANCELLED"
] as const;
export type ActivityState = (typeof activityStates)[number];

export const workflowStates = [
  "RUNNING",
  "WAITING_HUMAN",
  "WAITING_EXTERNAL",
  "RETRY_WAIT",
  "RECONCILING",
  "BLOCKED",
  "SUSPENDED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
] as const;
export type WorkflowState = (typeof workflowStates)[number];
export type TestOutcome = "passed" | "failed" | "mixed" | "inconclusive";

export interface FormalExecutionWorkflowEvidence {
  schemaVersion: "formal-execution-workflow-evidence-v1";
  executionSubjectDigest: string;
  manifestDigest: string;
  resultDigest: string;
  caseCounts: {
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    unknown: number;
    deferred: number;
  };
  scopeStatus: "complete" | "partial";
  dataHygieneStatus: "clean" | "reusable" | "retained";
  testOutcome: TestOutcome;
}

export type CallbackResolution = "accepted" | "rejected" | "revision_requested" | "cancelled";

export interface ActivityProjection {
  id: string;
  definition: WorkflowActivityDefinition;
  state: ActivityState;
  attempt: number;
  lastEventSeq?: number;
  retryAt?: string;
  callbackId?: string;
  callbackSubjectDigest?: string;
  callbackSubjectSchemaVersion?: string;
  decisionOriginCallbackId?: string;
  decisionOriginSubjectDigest?: string;
  decisionOriginSubjectSchemaVersion?: string;
  outcome?: string;
  blockerIds: string[];
  unresolvedExternalOperationIds: string[];
  reviewerExpectedRoles?: string[];
  reviewerDispatchedRoles?: string[];
  reviewerSubmittedRoles?: string[];
}

export interface WorkflowWait {
  kind: "human" | "external" | "retry" | "blocker" | "reconciliation";
  activityId?: string;
  referenceId?: string;
  detail?: string;
}

export interface WorkflowProjection {
  runId?: string;
  requestId: string;
  definitionId: string;
  definitionVersion: string;
  graphDigest: string;
  planDigest: string;
  deliveryTarget?: WorkflowDeliveryTarget;
  reviewPolicy?: ReviewPolicy;
  head: WorkflowHistoryHead;
  workflowState: WorkflowState;
  phase: WorkflowPhase;
  activities: Record<string, ActivityProjection>;
  readyActivities: string[];
  runningActivities: string[];
  waits: WorkflowWait[];
  nextActions: string[];
  testOutcome?: TestOutcome;
  continuation: {
    kind: "continue_now" | "await_event" | "wait_until" | "wait_user" | "stop";
    referenceId?: string;
    notBefore?: string;
    reason: string;
  };
  reply: {
    kind: "none" | "action_required" | "final";
    allowed: boolean;
    reason: string;
  };
}

export class WorkflowHistoryConflictError extends Error {}
export class WorkflowHistoryIntegrityError extends Error {}
export class WorkflowTransitionError extends Error {}
