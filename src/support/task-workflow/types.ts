export const workflowEventTypes = [
  "WorkflowStarted",
  "ActivitiesExpanded",
  "RunIntentDerived",
  "ImpactClosureBuilt",
  "DesignDeltaPrepared",
  "CandidateGraphExpanded",
  "ActivityAttemptStarted",
  "CandidateGenerationStarted",
  "ActivitySucceeded",
  "ActivityFailed",
  "ArtifactPublishPrepared",
  "ArtifactDriftDetected",
  "RetryScheduled",
  "CallbackRequested",
  "CallbackResolved",
  "TestcaseReviewWorkbookPublished",
  "BlockerRaised",
  "BlockerResolved",
  "ExternalOperationStarted",
  "ExternalOperationReconciled",
  "ReviewBatchStarted",
  "ReviewerDispatched",
  "ReviewerModelCallStarted",
  "ReviewerModelCallCompleted",
  "ReviewerSubmitted",
  "ReviewerWaived",
  "ReviewBatchInvalidated",
  "ActivitiesInvalidated",
  "WorkflowSuspended",
  "WorkflowResumed",
  "WorkflowCompleted",
  "WorkflowCancelled"
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
  | "run_intent_derive"
  | "suite_validation"
  | "design_revalidation"
  | "impact_location"
  | "impact_closure"
  | "delta_preflight"
  | "delta_skeleton"
  | "delta_assembly"
  | "policy_authorization"
  | "source_selection"
  | "candidate_preflight"
  | "candidate_compiler"
  | "candidate_skeleton"
  | "candidate_fragment"
  | "candidate_assembly"
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
  | "readiness_preflight"
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
  concurrencyGroup?: "reviewer" | "artifact_publish" | "business_write" | "candidate_generation";
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
  /** Immutable request-level routing policy for the only writable baseline. */
  requestPolicy: RequestPolicy;
  deliveryTarget: WorkflowDeliveryTarget;
  reviewPolicy: ReviewPolicy;
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

export interface ReviewPolicy extends ReviewPolicyBase {
  schemaVersion: "review-policy-v1";
  mode: "deterministic_only" | "combined" | "combined_with_impact" | "risk_adaptive";
  maxConcurrentReviewers: 2;
  maxSemanticEvolutionCycles: number;
}
/** mode expresses business routing, not version compatibility. */
export function isDeterministicReviewMode(policy: ReviewPolicy): boolean {
  return policy.mode === "deterministic_only"
      || policy.mode === "combined"
      || policy.mode === "combined_with_impact";
}

export function isRiskAdaptiveReviewMode(policy: ReviewPolicy): boolean {
  return policy.mode === "risk_adaptive";
}

export interface RequestPolicy {
  schemaVersion: "request-policy-v1";
  reuseDecision: "direct_execute" | "design_reconfirm" | "affected_rebuild" | "full_replan";
  deliveryTarget: WorkflowDeliveryTarget;
  reviewSpeed: "fast" | "balanced" | "strict";
  reviewMode: "deterministic_only" | "combined" | "combined_with_impact" | "risk_adaptive";
  riskProfile: "light" | "standard" | "strict";
  writesData: boolean;
  selectedCaseIds: string[];
}

export interface BuildWorkflowDefinitionInput {
  requestId: string;
  planDigest: string;
  /**
   * New workflow creation may supply the current plan so reviewer roles are
   * selected from durable risk markers. Historical/direct callers that omit
   * it retain the caller-pinned reviewer policy.
   */
  planText?: string;
  capabilities: WorkflowCapability[];
  writesData?: boolean;
  deliveryTarget?: WorkflowDeliveryTarget;
  requestPolicy?: Omit<RequestPolicy, "reviewMode" | "riskProfile"> & Partial<Pick<RequestPolicy, "reviewMode" | "riskProfile">>;
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
  /** Candidate generation is opt-in for direct engine tests; public initialization
   * derives the current route from the frozen request policy. */
  fragmented?: boolean;
}

export interface ReusableWorkflowDefinitionInput extends BuildWorkflowDefinitionInput {
  /** The current request protocol is the only supported reusable route. */
  reuseProtocol?: typeof CURRENT_WORKFLOW_VERSION;
  reuseAssessment: {
    schemaVersion: "test-suite-reuse-assessment-v1";
    suiteId: string;
    suiteVersion?: string;
    assessmentDigest: string;
    decision: "direct_execute" | "design_reconfirm" | "affected_rebuild" | "full_replan";
    requestedProfile: "full_feature" | "smoke" | "affected" | "failed_or_blocked";
    effectiveProfile: "full_feature" | "smoke" | "affected" | "failed_or_blocked";
    selectedCaseIds: string[];
    affectedCaseIds: string[];
    /** Frozen routing reasons; used only to skip a duplicate review of reviewed scripts. */
    reasons?: string[];
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
  kind: "human" | "external" | "retry" | "recovery" | "blocker" | "reconciliation";
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
  requestPolicy: RequestPolicy;
  runIntent?: {
    decision: string;
    suiteId: string;
    suiteVersion?: string;
    digest: string;
    environment?: string;
    deliveryTarget?: WorkflowDeliveryTarget;
    selectedCaseIds?: string[];
    affectedCaseIds?: string[];
    sourceDigest?: string;
    boundaryDigest?: string;
  };
  reviewWorkbook?: {
    activityId: string;
    subjectDigest: string;
    contentDigest: string;
    bindingDigest: string;
    workbookDigest: string;
    receiptDigest: string;
    path: string;
    cacheStatus: "hit" | "miss" | "rebuild";
    renderMilliseconds: number;
  };
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
import { CURRENT_WORKFLOW_VERSION } from "./currentVersion.js";
