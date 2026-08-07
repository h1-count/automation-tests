import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import {
  activitiesExpandedPayload,
  buildWorkflowDefinition,
  workflowStartedPayload
} from "./definition.js";
import { canonicalJson } from "./canonicalJson.js";
import { GENESIS_DIGEST, WorkflowHistoryStore } from "./historyStore.js";
import { reduceWorkflow } from "./reducer.js";
import {
  RuntimeLeaseStore,
  WorkflowRuntimeConflictError,
  WorkflowRuntimeLeaseError,
  type RuntimeLeaseHandle,
  type WorkflowRuntimeState
} from "./runtimeLeaseStore.js";
import {
  ArtifactPublisher,
  ArtifactReconciliationRequiredError,
  type ArtifactContent,
  type ArtifactPublishPreparedEvent
} from "./artifactPublisher.js";
import { evaluateTestcasePackageFiles } from "./packageCompleteness.js";
import { ReviewInputSnapshotStore } from "./reviewInputSnapshot.js";
import {
  assertFormalDecisionAppendOnly,
  assertFormalUserDecision,
  assertRecordedFormalUserDecision,
  applyCallbackDriftProjection,
  callbackDecisionIsCurrent,
  caseDecisionPlanProjection,
  casePackageDecisionProjection,
  decisionTypeForActivity,
  dependentActivityIds,
  formalUserDecisionResolution,
  formalUserDecisionResolutions,
  isFormalCallbackActivity,
  PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2,
  planDecisionProjection,
  planDecisionProjectionV2,
  planWithoutFormalDecisions
} from "./callbackDecision.js";
import {
  latestReviewerDispatch,
  latestReviewerSubmission,
  prepareReviewLifecycleEvent,
  referencedControlledSources,
  requiredReviewInputs,
  reviewBatchActivityIds,
  reviewBatchCoveredActivityIds,
  reviewBatchInvalidationInputDigest,
  reviewBatchStarted,
  reviewFindingsDigest,
  reviewRevisionDigest,
  REVIEWER_ISOLATION_PROOF_VERSION,
  ReviewInputDriftError,
  reviewerBindingId,
  rotatedReviewBatchId,
  verifyOrRepairReviewSnapshot
} from "./reviewLifecycle.js";
import {
  buildReviewBatchScope,
  buildReviewBatchScopeV2,
  buildReviewBatchScopeV3,
  parseReviewBatchScope,
  reviewBatchScopeDigest,
  type ReusedReviewerEvidence,
  type ReviewBatchScope
} from "./reviewBatchScope.js";
import { assessCaseReviewRisk } from "./caseReviewRisk.js";
import { evaluateReviewReadiness } from "./reviewReadiness.js";
import { projectSimplifiedPhases } from "./simplifiedPhase.js";
import {
  planResumeRecovery,
  reviewerRebindAction
} from "./resumeRecovery.js";
import { CASE_RELATION_PROJECTION_MARKER, projectRelationProjection, validateRuleDesignMatrix } from "../testcase/relationProjection.js";
import {
  assertExecutionAuthorizationInputsCurrent
} from "./executionAuthorizationSubject.js";
import {
  formalReportOutputPaths,
  parseFormalExecutionWorkflowEvidence,
  sameFormalExecutionWorkflowEvidence
} from "./formalCompletionEvidence.js";
import {
  deriveFormalReportCompletion,
  deriveFormalRunCompletion,
  type FormalDeterministicOutcomeAssessment
} from "../formalCompletionService.js";
import type {
  ActivityProjection,
  CallbackResolution,
  FormalExecutionWorkflowEvidence,
  NewWorkflowEvent,
  SafeEventPayload,
  SafeJsonValue,
  TestOutcome,
  WorkflowActorType,
  WorkflowCapability,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowHistoryHead,
  WorkflowProjection
} from "./types.js";

export interface WorkflowGateView extends WorkflowProjection {
  schemaVersion: "workflow-gate-v2";
  checkpoint: {
    safe: boolean;
    reason: string;
  };
}

/** Runtime binding is host-only. Its repair state is observable without
 * changing the durable gate projection. */
export interface ReviewLifecycleView extends WorkflowGateView {
  runtimeBinding: "bound" | "repair_pending";
  reviewBatch?: {
    status: "new_batch_started";
    batchId: string;
    previousBatchId: string;
    reason: string;
  };
}

export function isSafeWorkflowReply(gate: WorkflowGateView): boolean {
  if (!gate.reply.allowed || !gate.checkpoint.safe) return false;
  const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(
    gate.workflowState
  );
  if (gate.reply.kind === "final") {
    return terminal && gate.continuation.kind === "stop";
  }
  if (gate.reply.kind === "action_required") {
    return !terminal && (
      gate.continuation.kind === "wait_user"
      || (
        gate.workflowState === "SUSPENDED"
        && gate.continuation.kind === "stop"
      )
    );
  }
  return false;
}

export interface InitializeWorkflowInput {
  planPath?: string;
  capabilities?: WorkflowCapability[];
  writesData?: boolean;
  casePackages?: string[];
  reviewerRoles?: string[];
  executionIsolation?: {
    contexts: boolean;
    accounts: boolean;
    data: boolean;
    sharedAccount?: boolean;
  };
  sessionId?: string;
  targetThreadId?: string;
}

export interface ActivityStartResult {
  activityId: string;
  claimToken: string;
  fencingToken: number;
  leaseExpiresAt: string;
  projection: WorkflowGateView;
}

export interface ActivitySucceedInput {
  claimToken: string;
  verification: string;
  outputRefs?: string[];
  outputDigests?: Array<{ path: string; digest: string }>;
  testOutcome?: TestOutcome;
  outcome?: string;
}

export interface PublishAndSucceedInput {
  claimToken: string;
  publishId: string;
  verification: string;
  artifacts: Array<{ targetPath: string; content: ArtifactContent }>;
  testOutcome?: TestOutcome;
  outcome?: string;
}

export interface ActivityFailInput {
  claimToken: string;
  summary: string;
  retryable: boolean;
  retryAt?: string;
  maxAttempts?: number;
}

export interface FormalRunCompletionInput {
  claimToken: string;
}

export interface FormalReportCompletionInput {
  claimToken: string;
}

export interface PreparedFormalCompletionClaim {
  claimToken: string;
  acquired: boolean;
  state: ActivityProjection["state"];
}

export interface FormalCompletionResult {
  evidence: FormalExecutionWorkflowEvidence;
  workflow: WorkflowGateView;
}

export type UnsettledDataHygieneStatus = "cleanup_failed" | "manual_required" | "unknown";

interface WorkflowIdentity {
  runId: string;
  requestId: string;
  definitionId: string;
  definitionVersion: string;
}

interface WorkflowEventDraft {
  type: WorkflowEventType;
  actorType: WorkflowActorType;
  payload: SafeEventPayload;
  idempotencyKey: string;
  causationId?: string;
}

const requestPattern = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const digestPattern = /^[a-f0-9]{64}$/;
const PLAN_CONFIRMATION_SUBJECT_SCHEMA_V1 = "plan-confirmation-subject-v1";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireDigest(value: string, label: string): string {
  if (!digestPattern.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

export function formalDataHygieneBlockerId(executionSubjectDigest: string): string {
  return `data-hygiene-${requireDigest(
    executionSubjectDigest,
    "executionSubjectDigest"
  ).slice(0, 24)}`;
}

export function formalDeterministicOutcomeBlockerId(
  executionSubjectDigest: string
): string {
  return `deterministic-outcome-${requireDigest(
    executionSubjectDigest,
    "executionSubjectDigest"
  ).slice(0, 24)}`;
}

function isReservedFormalBlockerId(blockerId: string): boolean {
  return blockerId.startsWith("data-hygiene-")
    || blockerId.startsWith("deterministic-outcome-");
}

function eventIdentity(events: readonly WorkflowEvent[]): WorkflowIdentity {
  const started = events[0];
  if (!started || started.type !== "WorkflowStarted") {
    throw new Error("Workflow history is not initialized.");
  }
  return {
    runId: started.runId,
    requestId: started.requestId,
    definitionId: started.definitionId,
    definitionVersion: started.definitionVersion
  };
}

function parseCapability(requestId: string): WorkflowCapability[] {
  const type = requestId.split("/")[0];
  if (type === "web") return ["web"];
  if (type === "h5") return ["h5"];
  if (type === "app") return ["app"];
  if (type === "api") return ["api"];
  if (type === "mqtt") return ["mqtt"];
  if (type === "iot-chain") return ["iot"];
  throw new Error(`Cannot infer a supported workflow capability from request ${requestId}.`);
}

function parseCasePackages(plan: string): string[] {
  const fromTable = [...plan.matchAll(/^\|\s*`(cases-[a-z0-9][a-z0-9-]*\.md)`\s*\|/gm)]
    .map((match) => match[1]!);
  return [...new Set(fromTable)];
}

function safeRelativePath(workspaceRoot: string, path: string): string {
  const absolute = resolve(workspaceRoot, path);
  const rel = relative(workspaceRoot, absolute).split(sep).join("/");
  if (!rel || rel.startsWith("../") || rel === "..") {
    throw new Error(`Artifact path must stay inside the workspace: ${path}`);
  }
  const rootSegment = rel.split("/", 1)[0] ?? "";
  if (
    rootSegment.startsWith(".")
    || rel.startsWith("node_modules/")
    || rel.startsWith("sources/")
    || rel.startsWith("test-assets/")
    || rel.startsWith("testcases/archive/")
    || /(^|\/)\.env(?:\.|$)/.test(rel)
  ) {
    throw new Error(`Artifact path is private or not a publishable workflow output: ${rel}`);
  }
  return rel;
}

const reviewResolutionOwnedSections = new Set([
  "多角色评审记录",
  "用例集评审与演进"
]);

function reviewResolutionFrozenProjection(value: string): string {
  const headings = [...value.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (!headings.length) return value;
  let projected = value.slice(0, headings[0]!.index ?? 0);
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? value.length;
    const name = heading[1]!.trim();
    projected += reviewResolutionOwnedSections.has(name)
      ? `## ${name}\n\n<review-resolution-owned>\n\n`
      : value.slice(start, end);
  }
  return projected;
}

export class DurableWorkflowManager {
  readonly requestId: string;
  readonly workspaceRoot: string;
  readonly requestRoot: string;
  readonly planPath: string;
  readonly historyPath: string;
  readonly history: WorkflowHistoryStore;
  readonly runtime: RuntimeLeaseStore;
  readonly reviewInputs: ReviewInputSnapshotStore;
  private readonly callbackPublicationHandles = new Map<string, RuntimeLeaseHandle>();

  constructor(requestId: string, workspaceRoot = process.cwd()) {
    if (!requestPattern.test(requestId)) {
      throw new Error("requestId must be a relative slash-separated test request identifier.");
    }
    this.requestId = requestId;
    this.workspaceRoot = resolve(workspaceRoot);
    this.requestRoot = resolve(this.workspaceRoot, "testcases", ...requestId.split("/"));
    this.planPath = resolve(this.requestRoot, "plan.md");
    this.historyPath = resolve(this.requestRoot, "workflow-history.ndjson");
    this.history = new WorkflowHistoryStore(
      this.historyPath,
      resolve(this.workspaceRoot, ".local/workflow-history-locks"),
      (events) => {
        reduceWorkflow(events);
      }
    );
    this.runtime = new RuntimeLeaseStore(requestId, resolve(this.workspaceRoot, ".local/test-task-runtime"));
    this.reviewInputs = new ReviewInputSnapshotStore(requestId, {
      workspaceRoot: this.workspaceRoot,
      runtimeStore: this.runtime
    });
  }

  exists(): boolean {
    return existsSync(this.historyPath);
  }

  async initialize(input: InitializeWorkflowInput = {}): Promise<WorkflowGateView> {
    if (this.exists()) {
      if (input.sessionId) await this.runtime.bindSession(input.sessionId, input.targetThreadId);
      return this.gate();
    }
    const planPath = resolve(input.planPath ?? this.planPath);
    if (!existsSync(planPath)) throw new Error(`Workflow initialization requires plan.md: ${planPath}`);
    const plan = await readFile(planPath, "utf8");
    const planDigest = sha256(plan);
    const definition = buildWorkflowDefinition({
      requestId: this.requestId,
      planDigest,
      planText: plan,
      capabilities: input.capabilities ?? parseCapability(this.requestId),
      writesData: input.writesData ?? /\|\s*(?:managed_cleanup|tracked_residual|必须清理|受控残留)\s*\|/.test(plan),
      casePackages: input.casePackages ?? parseCasePackages(plan),
      reviewerRoles: input.reviewerRoles,
      executionIsolation: input.executionIsolation
    });
    const runId = randomUUID();
    const identity: WorkflowIdentity = {
      runId,
      requestId: this.requestId,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion
    };
    const startedEventId = randomUUID();
    await this.history.appendBatch([
      {
        ...identity,
        eventId: startedEventId,
        type: "WorkflowStarted",
        actorType: "system",
        idempotencyKey: `${runId}/workflow-started`,
        payload: workflowStartedPayload(definition)
      },
      {
        ...identity,
        type: "ActivitiesExpanded",
        actorType: "system",
        idempotencyKey: `${runId}/activities-expanded/${definition.graphDigest}`,
        payload: activitiesExpandedPayload(definition),
        causationId: startedEventId
      }
    ], { seq: 0, digest: GENESIS_DIGEST });
    if (input.sessionId) await this.runtime.bindSession(input.sessionId, input.targetThreadId);
    return this.gate();
  }

  async events(): Promise<WorkflowEvent[]> {
    return this.history.read();
  }

  async projection(): Promise<WorkflowProjection> {
    return reduceWorkflow(await this.events());
  }

  async callbackSubjectDigest(activityId: string): Promise<string> {
    const projection = await this.projection();
    if (activityId === "plan-confirmation") {
      const activity = projection.activities[activityId];
      const schemaVersion = activity?.callbackSubjectSchemaVersion
        ?? (activity?.callbackId
          ? PLAN_CONFIRMATION_SUBJECT_SCHEMA_V1
          : PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2);
      return this.planConfirmationSubjectDigest(
        await readFile(this.planPath, "utf8"),
        schemaVersion
      );
    }
    if (
      activityId === "case-confirmation"
      || activityId === "case-review-conflict-decision"
    ) {
      const packages = Object.values(projection.activities)
        .filter((activity) => activity.definition.kind === "case_generation")
        .map((activity) => {
          const packageName = activity.definition.metadata?.package;
          if (typeof packageName !== "string") {
            throw new Error(`Case activity ${activity.id} has no package binding.`);
          }
          return {
            activityId: activity.id,
            path: safeRelativePath(
              this.workspaceRoot,
              resolve(this.requestRoot, packageName)
            )
          };
        })
        .sort((left, right) => left.path.localeCompare(right.path));
      const plan = caseDecisionPlanProjection(await readFile(this.planPath, "utf8"));
      const cases = await Promise.all(packages.map(async (item) => ({
        ...item,
        digest: sha256(casePackageDecisionProjection(
          await readFile(resolve(this.workspaceRoot, item.path), "utf8")
        ))
      })));
      return sha256(canonicalJson({
        schemaVersion: "case-confirmation-subject-v1",
        activityId,
        planDigest: sha256(plan),
        cases
      }));
    }
    if (activityId === "execution-authorization") {
      return (await this.executionAuthorizationSubject(projection)).digest;
    }
    throw new Error(`Activity ${activityId} has no repository-derived callback subject.`);
  }

  async gate(at = Date.now()): Promise<WorkflowGateView> {
    const events = await this.events();
    const projection = reduceWorkflow(events);
    const runtime = await this.runtime.read();
    const dueRetries = ["SUSPENDED", "BLOCKED"].includes(projection.workflowState)
      ? []
      : Object.values(projection.activities)
        .filter((activity) =>
          activity.state === "RETRY_WAIT"
          && (!activity.retryAt || Date.parse(activity.retryAt) <= at)
        )
        .map((activity) => activity.id);
    if (dueRetries.length) {
      for (const activityId of dueRetries) {
        projection.activities[activityId]!.state = "READY";
        projection.activities[activityId]!.retryAt = undefined;
      }
      const dueRetrySet = new Set(dueRetries);
      projection.waits = projection.waits.filter((wait) =>
        wait.kind !== "retry" || !wait.activityId || !dueRetrySet.has(wait.activityId)
      );
      projection.readyActivities = [...new Set([...projection.readyActivities, ...dueRetries])];
      projection.nextActions = [...new Set([...projection.nextActions, ...dueRetries])];
      if (!["SUCCEEDED", "FAILED", "CANCELLED", "SUSPENDED"].includes(projection.workflowState)) {
        projection.workflowState = "RUNNING";
      }
      projection.continuation = {
        kind: "continue_now",
        referenceId: dueRetries[0],
        reason: "retry_due"
      };
      projection.reply = {
        kind: "none",
        allowed: false,
        reason: "automatic_work_remaining"
      };
    }
    const completionReady = projection.readyActivities.find((activityId) =>
      projection.activities[activityId]?.definition.kind === "complete"
    );
    if (completionReady) {
      projection.nextActions = [
        ...projection.nextActions.filter((action) => action !== completionReady),
        "complete"
      ];
      projection.continuation = {
        kind: "continue_now",
        referenceId: "complete",
        reason: "workflow_completion_ready"
      };
    }
    await this.applyCallbackSubjectDrift(projection);
    this.applyActiveFormalCallbackPublicationWait(projection, runtime, at);
    const rebind = reviewerRebindAction(planResumeRecovery({
      projection,
      events,
      runtime,
      now: at
    }));
    if (
      rebind
      && !["SUSPENDED", "BLOCKED", "WAITING_HUMAN", "SUCCEEDED", "FAILED", "CANCELLED"]
        .includes(projection.workflowState)
    ) {
      const action = `reviewer-rebind:${rebind.batchId}:${rebind.activityId}:${rebind.role}`;
      projection.nextActions = [...new Set([...projection.nextActions, action])];
      if (projection.continuation.kind === "await_event") {
        projection.continuation = {
          kind: "continue_now",
          referenceId: action,
          reason: "reviewer_runtime_rebind_required"
        };
      }
      projection.reply = {
        kind: "none",
        allowed: false,
        reason: "automatic_work_remaining"
      };
    }
    const checkpoint = this.checkpoint(projection, runtime);
    return {
      schemaVersion: "workflow-gate-v2",
      ...projection,
      checkpoint
    };
  }

  async bindSession(sessionId: string, targetThreadId?: string): Promise<void> {
    await this.runtime.bindSession(sessionId, targetThreadId);
  }

  async startActivity(
    activityId: string,
    owner: string,
    leaseMs = 120_000,
    at = Date.now()
  ): Promise<ActivityStartResult> {
    const before = await this.gate(at);
    const activity = before.activities[activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${activityId}`);
    if (activity.definition.kind === "complete") {
      throw new Error("Workflow completion must be recorded with task:manage complete.");
    }
    if (activity.state === "RUNNING") {
      const existing = await this.currentLease(activityId);
      if (existing?.owner === owner) {
        return {
          activityId,
          claimToken: existing.leaseId,
          fencingToken: existing.fencingToken,
          leaseExpiresAt: existing.expiresAt,
          projection: before
        };
      }
      throw new Error(`Activity ${activityId} is already running.`);
    }
    if (!before.readyActivities.includes(activityId)) {
      throw new Error(`Activity ${activityId} is not ready; current state is ${activity.state}.`);
    }
    const handle = await this.runtime.acquire(activityId, owner, leaseMs, at);
    try {
      await this.append("ActivityAttemptStarted", "agent", {
        activityId,
        attempt: activity.attempt + 1
      }, `${before.runId}/${activityId}/attempt-${activity.attempt + 1}/start`, before.head);
    } catch (error) {
      try {
        await this.runtime.release(handle, at);
      } catch {
        // The event append result remains authoritative; a disposable lease may
        // expire if its compensating release races with another worker.
      }
      throw error;
    }
    return {
      activityId,
      claimToken: handle.leaseId,
      fencingToken: handle.fencingToken,
      leaseExpiresAt: handle.expiresAt,
      projection: await this.gate(at)
    };
  }

  async renewActivity(activityId: string, claimToken: string, leaseMs = 120_000): Promise<ActivityStartResult> {
    const handle = await this.handleForClaim(activityId, claimToken);
    const renewed = await this.runtime.renew(handle, leaseMs);
    return {
      activityId,
      claimToken: renewed.leaseId,
      fencingToken: renewed.fencingToken,
      leaseExpiresAt: renewed.expiresAt,
      projection: await this.gate()
    };
  }

  async succeedActivity(activityId: string, input: ActivitySucceedInput): Promise<WorkflowGateView> {
    return this.succeedActivityInternal(activityId, input, false);
  }

  private async succeedActivityInternal(
    activityId: string,
    input: ActivitySucceedInput,
    publicationValidated: boolean,
    formalExecutionEvidence?: FormalExecutionWorkflowEvidence,
    formalBlockerResolution?: { blockerId: string; evidence: string }
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${activityId}`);
    const formalCompletionActivity = ["run", "report"].includes(activity.definition.kind);
    if (formalCompletionActivity && !formalExecutionEvidence) {
      throw new Error(
        `Activity ${activityId} must use the dedicated formal execution completion path.`
      );
    }
    if (!formalCompletionActivity && formalExecutionEvidence) {
      throw new Error(`Activity ${activityId} cannot attach formal execution completion evidence.`);
    }
    if (formalBlockerResolution) {
      const subjectDigest = formalExecutionEvidence?.executionSubjectDigest ?? "";
      const acceptedBlockerIds = subjectDigest
        ? [
            formalDataHygieneBlockerId(subjectDigest),
            formalDeterministicOutcomeBlockerId(subjectDigest)
          ]
        : [];
      if (
        activity.definition.kind !== "run"
        || activity.state !== "BLOCKED"
        || activity.blockerIds.length !== 1
        || activity.blockerIds[0] !== formalBlockerResolution.blockerId
        || !acceptedBlockerIds.includes(formalBlockerResolution.blockerId)
      ) {
        throw new Error(
          "Only the exact formal data hygiene or deterministic outcome blocker can be resolved with run completion."
        );
      }
      requireDigest(formalBlockerResolution.evidence, "formal settlement evidence");
    }
    if (activity.definition.kind === "complete") {
      throw new Error("Workflow completion must be recorded with task:manage complete.");
    }
    if (activity.state === "SUCCEEDED") {
      await this.runtime.finalizeSucceededActivity(activityId);
      return this.gate();
    }
    const handle = await this.handleForClaim(activityId, input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const runtime = await this.runtime.read();
    if (Object.values(runtime?.inFlightOperations ?? {}).some((operation) => operation.activityId === activityId)) {
      throw new Error(`Activity ${activityId} has an unresolved external operation; reconcile it before success.`);
    }
    const verifiedOutputDigests = await this.verifyPublishedOutputs(input.outputDigests ?? []);
    const outputRefs = [...new Set((input.outputRefs ?? [])
      .map((path) => safeRelativePath(this.workspaceRoot, path)))];
    if (activity.definition.publishesArtifacts) {
      if (
        !publicationValidated
        && [
          "review_resolution",
          "relation_sync",
          "automatic_evolution"
        ].includes(activity.definition.kind)
      ) {
        throw new Error(
          `Artifact-producing activity ${activityId} must use the atomic artifact publication path.`
        );
      }
      if (!verifiedOutputDigests.length) {
        throw new Error(`Artifact-producing activity ${activityId} requires verified output digests.`);
      }
      const digestPaths = new Set(verifiedOutputDigests.map((output) => output.path));
      if (outputRefs.some((path) => !digestPaths.has(path))
        || verifiedOutputDigests.some((output) => !outputRefs.includes(output.path))) {
        throw new Error(
          `Artifact-producing activity ${activityId} requires identical outputRefs and outputDigests paths.`
        );
      }
      this.assertArtifactOutputBinding(
        activity.definition.kind,
        activity.definition.metadata,
        verifiedOutputDigests.map((output) => output.path),
        before
      );
      if (activity.definition.kind === "relation_sync") await this.assertRelationProjectionCurrent();
    }
    const completenessEvidence = activity.definition.kind === "completeness_validation"
      ? await this.buildCompletenessEvidence(before)
      : undefined;
    const payload: SafeEventPayload = {
      activityId,
      verification: input.verification,
      outputRefs,
      ...(verifiedOutputDigests.length
        ? { outputDigests: verifiedOutputDigests as unknown as SafeJsonValue }
        : {}),
      ...(completenessEvidence ? { completenessEvidence } : {}),
      ...(formalExecutionEvidence
        ? { formalExecutionEvidence: formalExecutionEvidence as unknown as SafeJsonValue }
        : {}),
      ...(input.testOutcome ? { testOutcome: input.testOutcome } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {})
    };
    const outcomeDigest = sha256(JSON.stringify(payload));
    const successKey = `${before.runId}/${activityId}/attempt-${activity.attempt}/succeeded/${outcomeDigest}`;
    if (formalBlockerResolution) {
      await this.appendSequence([
        {
          type: "BlockerResolved",
          actorType: "system",
          payload: {
            blockerId: formalBlockerResolution.blockerId,
            evidence: formalBlockerResolution.evidence
          },
          idempotencyKey: `${before.runId}/formal/${formalExecutionEvidence!.executionSubjectDigest.slice(0, 24)}/blocker-settled/${sha256(`${formalBlockerResolution.blockerId}:${formalBlockerResolution.evidence}`)}`
        },
        {
          type: "ActivitySucceeded",
          actorType: "agent",
          payload,
          idempotencyKey: successKey
        }
      ], before.head);
    } else if (
      before.definitionVersion === "v5"
      && activity.definition.kind === "report"
      && activity.definition.metadata?.completesWorkflow === true
    ) {
      await this.appendSequence([
        {
          type: "ActivitySucceeded",
          actorType: "agent",
          payload,
          idempotencyKey: successKey
        },
        {
          type: "WorkflowCompleted",
          actorType: "system",
          payload: {
            ...(input.testOutcome ? { testOutcome: input.testOutcome } : {})
          },
          idempotencyKey: `${before.runId}/workflow-completed/${input.testOutcome ?? "none"}`
        }
      ], before.head);
    } else {
      await this.append(
        "ActivitySucceeded",
        "agent",
        payload,
        successKey,
        before.head
      );
    }
    await this.runtime.finalizeSucceededActivity(activityId, handle);
    return this.gate();
  }

  async completeFormalRun(input: FormalRunCompletionInput): Promise<FormalCompletionResult> {
    const initial = await this.gate();
    const subject = await this.executionAuthorizationSubject(initial);
    const prepared = await this.prepareFormalCompletionClaim({
      activityId: "run",
      claimToken: input.claimToken,
      owner: "formal-run-finalize",
      dataHygieneSubjectDigest: subject.digest,
      deterministicOutcomeSubjectDigest: subject.digest
    });
    try {
      const derived = await deriveFormalRunCompletion(this.requestId, this.workspaceRoot);
      const before = await this.gate();
      const evidence = await this.assertFormalCompletionEvidence(
        before,
        "run",
        derived.evidence
      );
      const activity = before.activities.run;
      if (!activity || activity.definition.kind !== "run") {
        throw new Error("Workflow definition is missing the formal run activity.");
      }
      if (activity.state === "SUCCEEDED") {
        await this.assertRecordedFormalCompletion("run", evidence);
        await this.runtime.finalizeSucceededActivity("run");
        return { evidence, workflow: await this.gate() };
      }
      const hygieneBlockerId = formalDataHygieneBlockerId(evidence.executionSubjectDigest);
      const deterministicBlockerId = formalDeterministicOutcomeBlockerId(
        evidence.executionSubjectDigest
      );
      const formalResolutionBlockerId = activity.state === "BLOCKED"
        && activity.blockerIds.length === 1
        && [hygieneBlockerId, deterministicBlockerId].includes(activity.blockerIds[0]!)
        ? activity.blockerIds[0]
        : undefined;
      if (
        activity.state !== "RUNNING"
        && activity.state !== "RECONCILING"
        && !formalResolutionBlockerId
      ) {
        throw new Error(`Formal run cannot complete while it is ${activity.state}.`);
      }
      const workflow = await this.succeedActivityInternal("run", {
        claimToken: prepared.claimToken,
        verification: "formal_execution_completion_seal_verified",
        testOutcome: evidence.testOutcome
      }, false, evidence, formalResolutionBlockerId
        ? { blockerId: formalResolutionBlockerId, evidence: evidence.resultDigest }
        : undefined);
      return { evidence, workflow };
    } catch (error) {
      if (prepared.acquired) {
        await this.releaseFormalCompletionClaim("run", prepared.claimToken);
      }
      throw error;
    }
  }

  async publishFormalReportAndComplete(
    input: FormalReportCompletionInput
  ): Promise<FormalCompletionResult> {
    const prepared = await this.prepareFormalCompletionClaim({
      activityId: "report",
      claimToken: input.claimToken,
      owner: "formal-report-finalize"
    });
    try {
      const derived = await deriveFormalReportCompletion(this.requestId, this.workspaceRoot);
      const before = await this.gate();
      const evidence = await this.assertFormalCompletionEvidence(
        before,
        "report",
        derived.evidence
      );
      const activity = before.activities.report;
      if (!activity || activity.definition.kind !== "report") {
        throw new Error("Workflow definition is missing the formal report activity.");
      }
      if (activity.state === "SUCCEEDED") {
        await this.assertRecordedFormalCompletion("report", evidence);
        await this.runtime.finalizeSucceededActivity("report");
        return { evidence, workflow: await this.gate() };
      }
      if (activity.state !== "RUNNING" && activity.state !== "RECONCILING") {
        throw new Error(`Formal report cannot complete while it is ${activity.state}.`);
      }
      const expectedPaths = formalReportOutputPaths(evidence.executionSubjectDigest).sort();
      const actualPaths = derived.artifacts.map((artifact) =>
        safeRelativePath(this.workspaceRoot, artifact.targetPath)
      ).sort();
      if (
        actualPaths.length !== expectedPaths.length
        || actualPaths.some((path, index) => path !== expectedPaths[index])
      ) {
        throw new Error(`Formal report must publish exactly ${expectedPaths.join(", ")}.`);
      }
      if (activity.state === "RECONCILING") {
        const reconciled = await this.reconcileFormalReportPublication({
          publishId: derived.publishId,
          evidence,
          artifacts: derived.artifacts,
          claimToken: prepared.claimToken
        });
        return { evidence, workflow: reconciled };
      }
      const workflow = await this.publishArtifactsAndSucceedInternal("report", {
        claimToken: prepared.claimToken,
        publishId: derived.publishId,
        verification: "sealed_formal_report_published",
        artifacts: derived.artifacts,
        testOutcome: evidence.testOutcome
      }, evidence);
      return { evidence, workflow };
    } catch (error) {
      if (prepared.acquired) {
        await this.releaseFormalCompletionClaim("report", prepared.claimToken);
      }
      throw error;
    }
  }

  async prepareFormalCompletionClaim(input: {
    activityId: "run" | "report";
    claimToken: string;
    owner: string;
    dataHygieneSubjectDigest?: string;
    deterministicOutcomeSubjectDigest?: string;
  }): Promise<PreparedFormalCompletionClaim> {
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== input.activityId) {
      throw new Error(`Workflow definition is missing formal activity ${input.activityId}.`);
    }
    if (activity.unresolvedExternalOperationIds.length > 0) {
      throw new Error(
        `Formal ${input.activityId} cannot finalize with unresolved durable external operations.`
      );
    }
    const runtime = await this.runtime.read();
    const operations = Object.values(runtime?.inFlightOperations ?? {})
      .filter((operation) => operation.activityId === input.activityId);
    if (operations.length > 0) {
      throw new Error(
        `Formal ${input.activityId} cannot finalize with unresolved external operations.`
      );
    }
    if (activity.state === "SUCCEEDED") {
      return { claimToken: input.claimToken, acquired: false, state: activity.state };
    }
    if (activity.state === "RUNNING") {
      const handle = await this.handleForClaim(input.activityId, input.claimToken);
      await this.runtime.assertCanCommit(handle);
      return { claimToken: input.claimToken, acquired: false, state: activity.state };
    }
    if (activity.state === "BLOCKED") {
      if (
        input.activityId !== "run"
        || (!input.dataHygieneSubjectDigest && !input.deterministicOutcomeSubjectDigest)
      ) {
        throw new Error(`Formal ${input.activityId} cannot finalize while it is BLOCKED.`);
      }
      const expectedBlockerIds = [
        ...(input.dataHygieneSubjectDigest
          ? [formalDataHygieneBlockerId(input.dataHygieneSubjectDigest)]
          : []),
        ...(input.deterministicOutcomeSubjectDigest
          ? [formalDeterministicOutcomeBlockerId(input.deterministicOutcomeSubjectDigest)]
          : [])
      ];
      if (
        activity.blockerIds.length !== 1
        || !expectedBlockerIds.includes(activity.blockerIds[0]!)
      ) {
        throw new Error(
          "Formal run is blocked for a reason other than deterministic outcome or data hygiene settlement."
        );
      }
      const existing = await this.currentLease("run");
      if (existing) {
        if (existing.leaseId !== input.claimToken) {
          throw new WorkflowRuntimeLeaseError("Formal run settlement requires the current claim token.");
        }
        await this.runtime.assertCanCommit(existing);
        return { claimToken: existing.leaseId, acquired: false, state: activity.state };
      }
      const latest = runtime?.leases.run;
      if (latest && (!latest.releasedAt || latest.leaseId !== input.claimToken)) {
        throw new WorkflowRuntimeLeaseError(
          "Formal run settlement requires the latest released claim token."
        );
      }
      const acquired = await this.runtime.acquire("run", input.owner);
      return { claimToken: acquired.leaseId, acquired: true, state: activity.state };
    }
    if (activity.state !== "RECONCILING") {
      throw new Error(`Formal ${input.activityId} cannot finalize while it is ${activity.state}.`);
    }
    const staging = Object.values(runtime?.stagingRefs ?? {})
      .filter((item) => item.activityId === input.activityId);
    if (staging.length > 0) {
      const lease = runtime?.leases[input.activityId];
      if (
        !lease
        || lease.leaseId !== input.claimToken
        || staging.some((item) =>
          item.leaseId !== lease.leaseId
          || item.fencingToken !== lease.fencingToken
        )
      ) {
        throw new WorkflowRuntimeLeaseError(
          `Formal ${input.activityId} reconciliation requires the latest publication claim lineage.`
        );
      }
      return { claimToken: input.claimToken, acquired: false, state: activity.state };
    }
    const existing = await this.currentLease(input.activityId);
    if (existing) {
      if (existing.leaseId !== input.claimToken) {
        throw new WorkflowRuntimeLeaseError(
          `Formal ${input.activityId} reconciliation requires the current claim token.`
        );
      }
      await this.runtime.assertCanCommit(existing);
      return { claimToken: existing.leaseId, acquired: false, state: activity.state };
    }
    const latest = runtime?.leases[input.activityId];
    if (
      latest
      && latest.leaseId !== input.claimToken
    ) {
      throw new WorkflowRuntimeLeaseError(
        `Formal ${input.activityId} reconciliation requires the latest expired or released claim token.`
      );
    }
    if (
      latest
      && !latest.releasedAt
      && Date.parse(latest.expiresAt) > Date.now()
    ) {
      throw new WorkflowRuntimeLeaseError(
        `Formal ${input.activityId} reconciliation cannot replace an active claim.`
      );
    }
    const acquired = await this.runtime.acquire(input.activityId, input.owner);
    return { claimToken: acquired.leaseId, acquired: true, state: activity.state };
  }

  async releaseFormalCompletionClaim(
    activityId: "run" | "report",
    claimToken: string
  ): Promise<void> {
    try {
      const handle = await this.handleForClaim(activityId, claimToken);
      await this.runtime.release(handle);
    } catch (error) {
      if (!(error instanceof WorkflowRuntimeLeaseError)) throw error;
    }
  }

  private async reconcileFormalReportPublication(input: {
    publishId: string;
    evidence: FormalExecutionWorkflowEvidence;
    artifacts: Array<{ targetPath: string; content: ArtifactContent }>;
    claimToken: string;
  }): Promise<WorkflowGateView> {
    const runtime = await this.runtime.read();
    const staging = runtime?.stagingRefs[input.publishId];
    if (staging) {
      if (staging.activityId !== "report") {
        throw new Error(`Prepared publication ${input.publishId} does not belong to report.`);
      }
      const before = await this.gate();
      await this.assertPreparedPublicationPolicy(
        before,
        "report",
        input.publishId,
        staging.manifestPath,
        staging.manifestDigest
      );
      const publisher = new ArtifactPublisher(this.requestId, {
        workspaceRoot: this.workspaceRoot,
        runtimeStore: this.runtime
      });
      const published = await publisher.reconcilePrepared(input.publishId);
      return this.appendReconciledFormalReportSuccess(input.evidence, published.artifacts);
    }

    const preparedEvent = [...await this.events()].reverse().find((event) =>
      event.type === "ArtifactPublishPrepared"
      && event.payload.activityId === "report"
      && event.payload.publishId === input.publishId
    );
    if (preparedEvent) {
      const expected = formalPreparedArtifactDigests(preparedEvent.payload);
      const actual = input.artifacts.map((artifact) => ({
        targetPath: safeRelativePath(this.workspaceRoot, artifact.targetPath),
        digest: sha256(typeof artifact.content === "string"
          ? artifact.content
          : Buffer.from(artifact.content))
      }));
      if (!sameArtifactDigests(expected, actual)) {
        throw new Error("Reconciled formal report bytes differ from its durable publication intent.");
      }
      return this.appendReconciledFormalReportSuccess(input.evidence, actual);
    }

    return this.publishArtifactsAndSucceedInternal("report", {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: "sealed_formal_report_republished",
      artifacts: input.artifacts,
      testOutcome: input.evidence.testOutcome
    }, input.evidence);
  }

  private async appendReconciledFormalReportSuccess(
    evidence: FormalExecutionWorkflowEvidence,
    artifacts: Array<{ targetPath: string; digest: string }>
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (before.activities.report?.state !== "RECONCILING") {
      throw new Error("Formal report reconciliation requires a RECONCILING activity.");
    }
    const verified = await this.verifyPublishedOutputs(
      artifacts.map((artifact) => ({ path: artifact.targetPath, digest: artifact.digest }))
    );
    const outputRefs = verified.map((artifact) => artifact.path);
    this.assertArtifactOutputBinding("report", before.activities.report.definition.metadata, outputRefs, before);
    const payload: SafeEventPayload = {
      activityId: "report",
      verification: "sealed_formal_report_reconciled",
      reconciled: true,
      outputRefs,
      outputDigests: verified as unknown as SafeJsonValue,
      formalExecutionEvidence: evidence as unknown as SafeJsonValue,
      testOutcome: evidence.testOutcome
    };
    await this.appendSequence([{
      type: "ActivitySucceeded",
      actorType: "agent",
      payload,
      idempotencyKey: `${before.runId}/report/reconciled/formal/${evidence.resultDigest}`
    }, {
      type: "WorkflowCompleted",
      actorType: "system",
      payload: { testOutcome: evidence.testOutcome },
      idempotencyKey: `${before.runId}/workflow-completed/${evidence.testOutcome}`
    }], before.head);
    await this.runtime.finalizeSucceededActivity("report");
    return this.gate();
  }

  async failActivity(activityId: string, input: ActivityFailInput): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${activityId}`);
    const handle = await this.handleForClaim(activityId, input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const maxAttempts = input.maxAttempts ?? 3;
    const retryAt = input.retryAt
      ?? new Date(Date.now() + Math.min(120_000, 2 ** activity.attempt * 1_000)).toISOString();
    const failedKey = `${before.runId}/${activityId}/attempt-${activity.attempt}/failed/${sha256(input.summary)}`;
    const drafts: WorkflowEventDraft[] = [{
      type: "ActivityFailed",
      actorType: "agent",
      payload: {
        activityId,
        attempt: activity.attempt,
        retryable: input.retryable,
        summary: input.summary
      },
      idempotencyKey: failedKey
    }];
    if (input.retryable && activity.attempt < maxAttempts) {
      drafts.push({
        type: "RetryScheduled",
        actorType: "system",
        payload: { activityId, attempt: activity.attempt, retryAt },
        idempotencyKey: `${before.runId}/${activityId}/attempt-${activity.attempt}/retry/${retryAt}`
      });
    }
    await this.appendSequence(drafts, before.head);
    await this.releaseBestEffort(handle);
    return this.gate();
  }

  async publishArtifactsAndSucceed(
    activityId: string,
    input: PublishAndSucceedInput
  ): Promise<WorkflowGateView> {
    const activity = (await this.gate()).activities[activityId];
    if (activity && ["run", "report"].includes(activity.definition.kind)) {
      throw new Error(
        `Activity ${activityId} must use the dedicated formal execution completion path.`
      );
    }
    return this.publishArtifactsAndSucceedInternal(activityId, input);
  }

  private async publishArtifactsAndSucceedInternal(
    activityId: string,
    input: PublishAndSucceedInput,
    formalExecutionEvidence?: FormalExecutionWorkflowEvidence
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (!activity?.definition.publishesArtifacts) {
      throw new Error(`Activity ${activityId} is not an artifact-producing activity.`);
    }
    const formalReportReconciliation = activity.state === "RECONCILING"
      && activity.definition.kind === "report"
      && formalExecutionEvidence !== undefined;
    if (activity.state !== "RUNNING" && !formalReportReconciliation) {
      throw new Error(`Artifact-producing activity ${activityId} is not running.`);
    }
    const handle = await this.handleForClaim(activityId, input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const artifacts = input.artifacts.map((artifact) => ({
      ...artifact,
      targetPath: safeRelativePath(this.workspaceRoot, artifact.targetPath)
    }));
    this.assertArtifactOutputBinding(
      activity.definition.kind,
      activity.definition.metadata,
      artifacts.map((artifact) => artifact.targetPath),
      before
    );
    if (activity.definition.kind === "relation_sync") {
      await this.assertStagedRelationProjectionCurrent(artifacts);
    }
    if (
      activity.definition.kind === "relation_sync"
      || activity.definition.kind === "automatic_evolution"
    ) {
      const planTarget = safeRelativePath(this.workspaceRoot, this.planPath);
      const candidate = artifacts.find((artifact) =>
        artifact.targetPath === planTarget
      );
      if (!candidate) {
        throw new Error(`${activity.definition.kind} must publish the request plan.`);
      }
      await this.assertPlanBoundaryPublication(
        before,
        activity.definition.kind,
        (typeof candidate.content === "string"
          ? candidate.content
          : Buffer.from(candidate.content).toString("utf8"))
      );
    }
    if (activity.definition.kind === "review_resolution") {
      await this.assertReviewResolutionOwnership(artifacts);
    }
    const publisher = new ArtifactPublisher(this.requestId, {
      workspaceRoot: this.workspaceRoot,
      runtimeStore: this.runtime
    });
    let published: Awaited<ReturnType<ArtifactPublisher["publish"]>>;
    try {
      published = await publisher.publish(
        {
          publishId: input.publishId,
          activityId,
          lease: handle,
          artifacts
        },
        (prepared) => this.recordArtifactPublishPrepared(prepared).then(() => undefined)
      );
    } catch (error) {
      if (error instanceof ArtifactReconciliationRequiredError) {
        const current = await this.gate();
        if (current.activities[activityId]?.state === "RUNNING") {
          const recovery = error.recovery;
          await this.append(
            "ArtifactDriftDetected",
            "system",
            {
              activityId,
              detail: "Prepared artifact publication did not reach a fully verified final state.",
              recovery: "reconcile_prepared_publication",
              publishId: input.publishId,
              matchedTargetCount: recovery.matchedTargets.length,
              pendingTargetCount: recovery.pendingTargets.length,
              conflictingTargetCount: recovery.conflictingTargets.length
            },
            `${current.runId}/${activityId}/publication/${input.publishId}/reconciliation-required`,
            current.head
          );
        }
      }
      throw error;
    }
    return this.succeedActivityInternal(activityId, {
      claimToken: input.claimToken,
      verification: input.verification,
      outputRefs: published.artifacts.map((artifact) => artifact.targetPath),
      outputDigests: published.artifacts.map((artifact) => ({
        path: artifact.targetPath,
        digest: artifact.digest
      })),
      testOutcome: input.testOutcome,
      outcome: input.outcome
    }, true, formalExecutionEvidence);
  }

  async requestCallback(input: {
    activityId: string;
    callbackId: string;
    subjectDigest: string;
    kind: string;
    actorType?: WorkflowActorType;
  }): Promise<WorkflowGateView> {
    requireDigest(input.subjectDigest, "subjectDigest");
    let before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${input.activityId}`);
    if ([
      "plan-confirmation",
      "case-confirmation",
      "case-review-conflict-decision",
      "execution-authorization"
    ].includes(input.activityId)) {
      const actualSubject = await this.callbackSubjectDigest(input.activityId);
      if (actualSubject !== input.subjectDigest) {
        throw new Error(
          `Callback ${input.activityId} subject digest does not match current repository evidence.`
        );
      }
      if (input.activityId === "execution-authorization") {
        const subject = await this.executionAuthorizationSubject(before);
        if (subject.callbackId !== input.callbackId) {
          throw new Error(
            "Execution authorization callbackId does not match the current repository manifest."
          );
        }
      }
    }
    if (activity.state === "WAITING_CALLBACK") {
      if (activity.callbackId === input.callbackId && activity.callbackSubjectDigest === input.subjectDigest) {
        return before;
      }
      throw new Error(`Activity ${input.activityId} already waits on another callback.`);
    }
    if (activity.state === "READY") {
      const subjectSchemaVersion = input.activityId === "plan-confirmation"
        ? PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
        : undefined;
      await this.appendSequence([
        {
          type: "ActivityAttemptStarted",
          actorType: input.actorType ?? "agent",
          payload: { activityId: input.activityId, attempt: activity.attempt + 1 },
          idempotencyKey: `${before.runId}/${input.activityId}/attempt-${activity.attempt + 1}/callback-start`
        },
        {
          type: "CallbackRequested",
          actorType: input.actorType ?? "agent",
          payload: {
            activityId: input.activityId,
            callbackId: input.callbackId,
            subjectDigest: input.subjectDigest,
            kind: input.kind,
            ...(subjectSchemaVersion ? { subjectSchemaVersion } : {})
          },
          idempotencyKey: `${before.runId}/${input.activityId}/callback/${input.callbackId}/requested/${input.subjectDigest}`
        }
      ], before.head);
      return this.gate();
    }
    if (activity.state !== "RUNNING") {
      throw new Error(`Callback activity ${input.activityId} must be ready or running.`);
    }
    const subjectSchemaVersion = input.activityId === "plan-confirmation"
      ? activity.callbackSubjectSchemaVersion ?? PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
      : undefined;
    await this.append(
      "CallbackRequested",
      input.actorType ?? "agent",
      {
        activityId: input.activityId,
        callbackId: input.callbackId,
        subjectDigest: input.subjectDigest,
        kind: input.kind,
        ...(subjectSchemaVersion ? { subjectSchemaVersion } : {})
      },
      `${before.runId}/${input.activityId}/callback/${input.callbackId}/requested/${input.subjectDigest}`,
      before.head
    );
    return this.gate();
  }

  async resolveCallback(input: {
    callbackId: string;
    activityId: string;
    subjectDigest: string;
    resolution: CallbackResolution;
  }): Promise<WorkflowGateView> {
    return this.resolveCallbackInternal(input, false);
  }

  private async resolveCallbackInternal(input: {
    callbackId: string;
    activityId: string;
    subjectDigest: string;
    resolution: CallbackResolution;
  }, claimlessRecovery: boolean): Promise<WorkflowGateView> {
    requireDigest(input.subjectDigest, "subjectDigest");
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if ([
      "plan-confirmation",
      "case-confirmation",
      "case-review-conflict-decision",
      "execution-authorization"
    ].includes(input.activityId)) {
      const actualSubject = await this.callbackSubjectDigest(input.activityId);
      if (
        actualSubject !== input.subjectDigest
        || actualSubject !== activity?.callbackSubjectDigest
      ) {
        throw new Error(
          `Callback ${input.activityId} repository subject changed while awaiting resolution; reopen it with the current digest.`
        );
      }
    }
    const plan = await readFile(this.planPath, "utf8");
    const priorResolution = [...await this.events()].reverse().find((event) =>
      event.type === "CallbackResolved"
      && event.payload.activityId === input.activityId
      && event.payload.callbackId === input.callbackId
      && event.payload.subjectDigest === input.subjectDigest
      && event.payload.resolution === input.resolution
    );
    if (priorResolution) {
      assertRecordedFormalUserDecision(
        plan,
        input.activityId,
        input.subjectDigest,
        input.resolution
      );
      await this.runtime.finalizeSucceededActivity(input.activityId);
      this.callbackPublicationHandles.delete(input.activityId);
      return this.gate();
    }
    assertFormalUserDecision(
      plan,
      input.activityId,
      input.subjectDigest,
      input.resolution
    );
    const publication = decisionTypeForActivity(input.activityId)
      ? await this.formalCallbackPublicationEvidence(input.activityId)
      : undefined;
    let publicationHandle: RuntimeLeaseHandle | undefined;
    if (publication && !claimlessRecovery) {
      publicationHandle = this.callbackPublicationHandles.get(input.activityId);
      if (!publicationHandle) {
        throw new WorkflowRuntimeLeaseError(
          `Formal callback ${input.activityId} requires its publishing claim token.`
        );
      }
      await this.runtime.assertCanCommit(publicationHandle);
    }
    const callbackDraft: WorkflowEventDraft = {
      type: "CallbackResolved",
      actorType: "user",
      payload: {
        activityId: input.activityId,
        callbackId: input.callbackId,
        subjectDigest: input.subjectDigest,
        resolution: input.resolution,
        ...(activity?.callbackSubjectSchemaVersion
          ? { subjectSchemaVersion: activity.callbackSubjectSchemaVersion }
          : {}),
        ...(publication ?? {})
      },
      idempotencyKey: `${before.runId}/${input.activityId}/callback/${input.callbackId}/resolved/${input.resolution}/${input.subjectDigest}`
    };
    if (input.resolution === "cancelled") {
      if (
        !before.checkpoint.safe
        && !await this.callbackPlanPublicationIsPublished(input.activityId)
      ) {
        throw new Error(
          `Workflow cancellation checkpoint is unsafe: ${before.checkpoint.reason}`
        );
      }
      await this.appendSequence([
        callbackDraft,
        {
          type: "WorkflowCancelled",
          actorType: "user",
          payload: {
            reason: `callback_cancelled:${input.activityId}`,
            callbackId: input.callbackId
          },
          idempotencyKey: `${before.runId}/workflow-cancelled/callback/${input.callbackId}`
        }
      ], before.head);
    } else {
      await this.append(
        callbackDraft.type,
        callbackDraft.actorType,
        callbackDraft.payload,
        callbackDraft.idempotencyKey,
        before.head
      );
    }
    if (publication) {
      await this.runtime.finalizeSucceededActivity(
        input.activityId,
        claimlessRecovery ? undefined : publicationHandle
      );
      this.callbackPublicationHandles.delete(input.activityId);
    }
    return this.gate();
  }

  async publishFormalDecisionPlan(input: {
    callbackId: string;
    activityId: string;
    subjectDigest: string;
    resolution: CallbackResolution;
    planContent: ArtifactContent;
    owner?: string;
    leaseMs?: number;
  }): Promise<WorkflowGateView> {
    requireDigest(input.subjectDigest, "subjectDigest");
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || !decisionTypeForActivity(input.activityId)) {
      throw new Error(`${input.activityId} is not a formal plan-backed callback.`);
    }
    const candidate = Buffer.from(input.planContent).toString("utf8");
    const current = await readFile(this.planPath, "utf8");
    const validatedCurrentDigest = sha256(Buffer.from(current));
    if (
      planWithoutFormalDecisions(candidate)
      !== planWithoutFormalDecisions(current)
    ) {
      throw new Error(
        "callback-resolve plan publication may change only the formal user decision section."
      );
    }
    assertFormalDecisionAppendOnly(current, candidate);
    assertFormalUserDecision(
      candidate,
      input.activityId,
      input.subjectDigest,
      input.resolution
    );
    if (activity.state !== "WAITING_CALLBACK") {
      throw new Error(
        `Callback ${input.activityId} must be waiting before its decision plan is published.`
      );
    }
    const handle = await this.runtime.acquire(
      input.activityId,
      input.owner ?? "callback-plan-publisher",
      input.leaseMs ?? 120_000
    );
    this.callbackPublicationHandles.set(input.activityId, handle);
    const publishId = await this.nextFormalCallbackPublishId(
      input.callbackId,
      sha256(Buffer.from(candidate))
    );
    const publisher = new ArtifactPublisher(this.requestId, {
      workspaceRoot: this.workspaceRoot,
      runtimeStore: this.runtime
    });
    let baselineConflict = false;
    try {
      await publisher.publish({
        publishId,
        activityId: input.activityId,
        lease: handle,
        artifacts: [{
          targetPath: safeRelativePath(this.workspaceRoot, this.planPath),
          content: candidate
        }]
      }, async (event) => {
        if (
          event.payload.artifacts.length !== 1
          || event.payload.artifacts[0]?.expectedPreviousDigest
            !== validatedCurrentDigest
        ) {
          baselineConflict = true;
          throw new Error(
            "plan.md changed after callback decision validation; publication was not recorded."
          );
        }
        await this.recordArtifactPublishPrepared(event);
      });
    } catch (error) {
      if (baselineConflict) {
        await publisher.cleanup(publishId, handle);
        await this.runtime.release(handle);
      }
      if (error instanceof ArtifactReconciliationRequiredError) {
        await this.markArtifactDrift({
          activityId: input.activityId,
          artifactPath: this.planPath,
          detail: error.message
        });
      }
      this.callbackPublicationHandles.delete(input.activityId);
      throw error;
    }
    return this.gate();
  }

  async publishPlanAndResolveCallback(input: {
    callbackId: string;
    activityId: string;
    subjectDigest: string;
    resolution: CallbackResolution;
    planContent: ArtifactContent;
    owner?: string;
    leaseMs?: number;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (before.activities[input.activityId]?.state !== "WAITING_CALLBACK") {
      await this.assertResolvedCallbackPlanReplay(input);
      return this.resolveCallback({
        callbackId: input.callbackId,
        activityId: input.activityId,
        subjectDigest: input.subjectDigest,
        resolution: input.resolution
      });
    }
    try {
      await this.publishFormalDecisionPlan(input);
    } catch (error) {
      if (!(error instanceof WorkflowRuntimeLeaseError)) throw error;
      const resolved = await this.assertResolvedCallbackPlanReplay(input, false);
      if (resolved) return this.resolveCallback(input);
      throw error;
    }
    return this.resolveCallback({
      callbackId: input.callbackId,
      activityId: input.activityId,
      subjectDigest: input.subjectDigest,
      resolution: input.resolution
    });
  }

  async reopenCallback(input: {
    activityId: string;
    callbackId: string;
    subjectDigest: string;
    kind: string;
    reason: string;
  }): Promise<WorkflowGateView> {
    requireDigest(input.subjectDigest, "subjectDigest");
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || !["callback", "execution_authorization"].includes(activity.definition.kind)) {
      throw new Error(`Activity ${input.activityId} is not a callback activity.`);
    }
    if (["PENDING", "READY", "RUNNING"].includes(activity.state)) {
      throw new Error(`Callback ${input.activityId} has no prior decision to reopen.`);
    }
    if (input.activityId === "case-confirmation") {
      const reviewerIds = Object.values(before.activities)
        .filter((candidate) => candidate.definition.kind === "review")
        .map((candidate) => candidate.id);
      if (!reviewerIds.length) throw new Error("Case callback has no review subflow to reopen.");
      return this.invalidateActivities({
        activityIds: reviewerIds,
        reason: input.reason,
        subjectDigest: input.subjectDigest
      });
    }
    await this.invalidateActivities({
      activityIds: [input.activityId],
      reason: input.reason,
      subjectDigest: activity.callbackSubjectDigest
    });
    return this.requestCallback({
      activityId: input.activityId,
      callbackId: input.callbackId,
      subjectDigest: input.subjectDigest,
      kind: input.kind
    });
  }

  async raiseBlocker(input: {
    blockerId: string;
    affectedActivityIds?: string[];
    category: string;
    detail: string;
    resolutionCondition: string;
  }): Promise<WorkflowGateView> {
    if (isReservedFormalBlockerId(input.blockerId)) {
      throw new Error(
        "Reserved formal blockers may be raised only by their dedicated finalize path."
      );
    }
    const before = await this.gate();
    const affected = input.affectedActivityIds ?? [];
    const runningTargets = (affected.length ? affected : before.runningActivities)
      .filter((activityId) => before.activities[activityId]?.state === "RUNNING");
    if (runningTargets.length) {
      throw new Error(
        `Close or reconcile running activities before raising a blocker: ${runningTargets.join(", ")}.`
      );
    }
    await this.append(
      "BlockerRaised",
      "agent",
      {
        blockerId: input.blockerId,
        affectedActivityIds: affected,
        category: input.category,
        detail: input.detail,
        resolutionCondition: input.resolutionCondition
      },
      `${before.runId}/blocker/${input.blockerId}/raised`,
      before.head
    );
    return this.gate();
  }

  async parkRunForExternalTransition(input: {
    activityId: string;
    claimToken: string;
    blockerId: string;
    detail: string;
    resolutionCondition: string;
  }): Promise<WorkflowGateView> {
    if (isReservedFormalBlockerId(input.blockerId)) {
      throw new Error("External transitions cannot use a reserved formal blocker id.");
    }
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== "run" || activity.state !== "RUNNING") {
      throw new Error(`${input.activityId} must be the running v5 run activity.`);
    }
    const handle = await this.handleForClaim(input.activityId, input.claimToken);
    await this.append(
      "BlockerRaised",
      "runner",
      {
        blockerId: input.blockerId,
        affectedActivityIds: [input.activityId],
        category: "external_transition_required",
        detail: input.detail,
        resolutionCondition: input.resolutionCondition
      },
      `${before.runId}/external-transition/${input.blockerId}/parked`,
      before.head
    );
    await this.runtime.release(handle);
    return this.gate();
  }

  async parkRunForDataHygiene(input: {
    claimToken: string;
    executionSubjectDigest: string;
    dataHygieneStatus: UnsettledDataHygieneStatus;
  }): Promise<{ blockerId: string; projection: WorkflowGateView }> {
    const before = await this.gate();
    const activity = before.activities.run;
    if (!activity || activity.definition.kind !== "run" || activity.state !== "RUNNING") {
      throw new Error("Data hygiene can park only the running formal run activity.");
    }
    if (!["cleanup_failed", "manual_required", "unknown"].includes(
      input.dataHygieneStatus
    )) {
      throw new Error("Data hygiene parking requires an unsettled cleanup status.");
    }
    const subjectDigest = requireDigest(
      input.executionSubjectDigest,
      "executionSubjectDigest"
    );
    const handle = await this.handleForClaim("run", input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const blockerId = formalDataHygieneBlockerId(subjectDigest);
    await this.append(
      "BlockerRaised",
      "runner",
      {
        blockerId,
        affectedActivityIds: ["run"],
        category: "data_hygiene_incomplete",
        detail: `Formal execution data hygiene is ${input.dataHygieneStatus}.`,
        resolutionCondition: "The same FormalExecutionStore result must settle as clean, reusable, or retained."
      },
      `${before.runId}/formal-execution/${subjectDigest}/data-hygiene/${blockerId}`,
      before.head
    );
    await this.runtime.release(handle);
    return { blockerId, projection: await this.gate() };
  }

  async parkRunForDeterministicOutcome(input: {
    claimToken: string;
    executionSubjectDigest: string;
    outcomeAssessment: FormalDeterministicOutcomeAssessment;
  }): Promise<{ blockerId: string; projection: WorkflowGateView }> {
    const before = await this.gate();
    const activity = before.activities.run;
    if (!activity || activity.definition.kind !== "run" || activity.state !== "RUNNING") {
      throw new Error("Deterministic outcome parking requires the running formal run activity.");
    }
    if (
      input.outcomeAssessment.status !== "terminal_unknown"
      || input.outcomeAssessment.terminalUnknownCount < 1
    ) {
      throw new Error("Deterministic outcome parking requires a terminal unknown assessment.");
    }
    const subjectDigest = requireDigest(
      input.executionSubjectDigest,
      "executionSubjectDigest"
    );
    const handle = await this.handleForClaim("run", input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const blockerId = formalDeterministicOutcomeBlockerId(subjectDigest);
    await this.append(
      "BlockerRaised",
      "runner",
      {
        blockerId,
        affectedActivityIds: ["run"],
        category: "deterministic_outcome_unknown",
        detail: `Formal execution has ${input.outcomeAssessment.terminalUnknownCount} terminal unknown case outcome(s).`,
        resolutionCondition: "A later trusted attempt must eliminate every terminal unknown and the dedicated formal finalizer must seal the same execution subject."
      },
      `${before.runId}/formal-execution/${subjectDigest}/deterministic-outcome/${blockerId}`,
      before.head
    );
    await this.runtime.release(handle);
    return { blockerId, projection: await this.gate() };
  }

  async replaceDeterministicOutcomeBlockerWithDataHygiene(input: {
    claimToken: string;
    executionSubjectDigest: string;
    outcomeAssessment: FormalDeterministicOutcomeAssessment;
    dataHygieneStatus: UnsettledDataHygieneStatus;
  }): Promise<{ blockerId: string; projection: WorkflowGateView }> {
    if (
      input.outcomeAssessment.status !== "settled"
      || input.outcomeAssessment.pendingUnknownCount !== 0
      || input.outcomeAssessment.terminalUnknownCount !== 0
    ) {
      throw new Error(
        "Deterministic outcome blocker replacement requires a fully settled outcome assessment."
      );
    }
    if (![
      "cleanup_failed",
      "manual_required",
      "unknown"
    ].includes(input.dataHygieneStatus)) {
      throw new Error("Data hygiene blocker replacement requires an unsettled cleanup status.");
    }
    const subjectDigest = requireDigest(
      input.executionSubjectDigest,
      "executionSubjectDigest"
    );
    const deterministicBlockerId = formalDeterministicOutcomeBlockerId(subjectDigest);
    const hygieneBlockerId = formalDataHygieneBlockerId(subjectDigest);
    const before = await this.gate();
    const activity = before.activities.run;
    if (
      !activity
      || activity.definition.kind !== "run"
      || activity.state !== "BLOCKED"
      || activity.blockerIds.length !== 1
      || activity.blockerIds[0] !== deterministicBlockerId
    ) {
      throw new Error(
        "Data hygiene can replace only the active deterministic outcome blocker for the same formal run."
      );
    }
    const handle = await this.handleForClaim("run", input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const outcomeEvidence = sha256([
      "formal-deterministic-outcome-settled-v1",
      subjectDigest,
      input.outcomeAssessment.status,
      input.outcomeAssessment.pendingUnknownCount,
      input.outcomeAssessment.terminalUnknownCount
    ].join(":"));
    await this.appendSequence([
      {
        type: "BlockerResolved",
        actorType: "system",
        payload: {
          blockerId: deterministicBlockerId,
          evidence: outcomeEvidence
        },
        idempotencyKey: `${before.runId}/formal/${subjectDigest.slice(0, 24)}/outcome-to-hygiene/${outcomeEvidence}`
      },
      {
        type: "BlockerRaised",
        actorType: "runner",
        payload: {
          blockerId: hygieneBlockerId,
          affectedActivityIds: ["run"],
          category: "data_hygiene_incomplete",
          detail: `Formal execution data hygiene is ${input.dataHygieneStatus}.`,
          resolutionCondition: "The same FormalExecutionStore result must settle as clean, reusable, or retained."
        },
        idempotencyKey: `${before.runId}/formal/${subjectDigest.slice(0, 24)}/data-hygiene/${hygieneBlockerId}/${input.dataHygieneStatus}`
      }
    ], before.head);
    await this.runtime.release(handle);
    return { blockerId: hygieneBlockerId, projection: await this.gate() };
  }

  async resumeRunAfterExternalTransition(input: {
    activityId: string;
    blockerId: string;
    evidenceDigest: string;
    owner: string;
    leaseMs?: number;
  }): Promise<ActivityStartResult> {
    requireDigest(input.evidenceDigest, "evidenceDigest");
    const before = await this.gate();
    if (isReservedFormalBlockerId(input.blockerId)) {
      throw new Error(
        "Reserved formal blockers may be resolved only by their dedicated formal finalize path."
      );
    }
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== "run") {
      throw new Error(`${input.activityId} is not the v5 run activity.`);
    }
    if (!activity.blockerIds.includes(input.blockerId)) {
      const existing = await this.currentLease(input.activityId);
      if (activity.state === "RUNNING" && existing?.owner === input.owner) {
        return {
          activityId: input.activityId,
          claimToken: existing.leaseId,
          fencingToken: existing.fencingToken,
          leaseExpiresAt: existing.expiresAt,
          projection: before
        };
      }
      throw new Error(`External transition blocker ${input.blockerId} is not active.`);
    }
    const handle = await this.runtime.acquire(
      input.activityId,
      input.owner,
      input.leaseMs ?? 120_000
    );
    try {
      await this.append(
        "BlockerResolved",
        "agent",
        { blockerId: input.blockerId, evidence: input.evidenceDigest },
        `${before.runId}/external-transition/${input.blockerId}/resolved/${input.evidenceDigest}`,
        before.head
      );
    } catch (error) {
      await this.runtime.release(handle).catch(() => undefined);
      throw error;
    }
    const projection = await this.gate();
    if (projection.activities[input.activityId]?.state !== "RUNNING") {
      await this.runtime.release(handle);
      throw new Error(`${input.activityId} remains blocked after resolving ${input.blockerId}.`);
    }
    return {
      activityId: input.activityId,
      claimToken: handle.leaseId,
      fencingToken: handle.fencingToken,
      leaseExpiresAt: handle.expiresAt,
      projection
    };
  }

  async resolveBlocker(blockerId: string, evidence: string): Promise<WorkflowGateView> {
    if (isReservedFormalBlockerId(blockerId)) {
      throw new Error(
        "Reserved formal blockers may be resolved only by their dedicated formal finalize path."
      );
    }
    const before = await this.gate();
    await this.append(
      "BlockerResolved",
      "agent",
      { blockerId, evidence },
      `${before.runId}/blocker/${blockerId}/resolved/${sha256(evidence)}`,
      before.head
    );
    return this.gate();
  }

  async reconcileActivity(
    activityId: string,
    outcome: "confirmed" | "retry",
    evidence: string,
    retryAt?: string,
    outputRefs: string[] = [],
    outputDigests: Array<{ path: string; digest: string }> = []
  ): Promise<WorkflowGateView> {
    const activity = (await this.gate()).activities[activityId];
    if (
      outcome === "confirmed"
      && activity
      && ["run", "report"].includes(activity.definition.kind)
    ) {
      throw new Error(
        `Activity ${activityId} must use the dedicated formal execution completion path.`
      );
    }
    return this.reconcileActivityInternal(
      activityId,
      outcome,
      evidence,
      retryAt,
      outputRefs,
      outputDigests,
      false
    );
  }

  private async reconcileActivityInternal(
    activityId: string,
    outcome: "confirmed" | "retry",
    evidence: string,
    retryAt: string | undefined,
    outputRefs: string[],
    outputDigests: Array<{ path: string; digest: string }>,
    publicationValidated: boolean
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (!activity || activity.state !== "RECONCILING") {
      throw new Error(`Activity ${activityId} is not reconciling.`);
    }
    if (outcome === "confirmed") {
      const safeOutputRefs = [...new Set(
        outputRefs.map((path) => safeRelativePath(this.workspaceRoot, path))
      )];
      const verifiedOutputDigests = await this.verifyPublishedOutputs(outputDigests);
      if (activity.definition.publishesArtifacts) {
        if (
          !publicationValidated
          && [
            "review_resolution",
            "relation_sync",
            "automatic_evolution"
          ].includes(activity.definition.kind)
        ) {
          throw new Error(
            `Artifact-producing activity ${activityId} must reconcile a named prepared publication.`
          );
        }
        if (!verifiedOutputDigests.length) {
          throw new Error(
            `Artifact-producing activity ${activityId} requires verified outputs during reconciliation.`
          );
        }
        this.assertArtifactOutputBinding(
          activity.definition.kind,
          activity.definition.metadata,
          verifiedOutputDigests.map((output) => output.path),
          before
        );
        const digestPaths = new Set(verifiedOutputDigests.map((output) => output.path));
        if (
          safeOutputRefs.some((path) => !digestPaths.has(path))
          || verifiedOutputDigests.some((output) => !safeOutputRefs.includes(output.path))
        ) {
          throw new Error(
            `Artifact reconciliation for ${activityId} requires identical outputRefs and outputDigests paths.`
          );
        }
      }
      const completenessEvidence = activity.definition.kind === "completeness_validation"
        ? await this.buildCompletenessEvidence(before)
        : undefined;
      await this.append(
        "ActivitySucceeded",
        "agent",
        {
          activityId,
          verification: evidence,
          reconciled: true,
          ...(safeOutputRefs.length ? { outputRefs: safeOutputRefs } : {}),
          ...(verifiedOutputDigests.length
            ? { outputDigests: verifiedOutputDigests as unknown as SafeJsonValue }
            : {}),
          ...(completenessEvidence ? { completenessEvidence } : {})
        },
        `${before.runId}/${activityId}/reconciled/confirmed/${sha256(evidence)}`,
        before.head
      );
      await this.runtime.finalizeSucceededActivity(activityId);
      return this.gate();
    }
    const scheduledAt = retryAt ?? new Date().toISOString();
    const runtime = await this.runtime.read();
    const unresolvedOperations = Object.values(runtime?.inFlightOperations ?? {})
      .filter((operation) => operation.activityId === activityId)
      .map((operation) => operation.operationId);
    const unresolvedStaging = Object.values(runtime?.stagingRefs ?? {})
      .filter((staging) => staging.activityId === activityId);
    if (unresolvedOperations.length) {
      throw new Error(
        `Activity ${activityId} cannot retry while external operations remain unresolved: ${unresolvedOperations.join(", ")}.`
      );
    }
    let abandonedUnpublishedStaging = false;
    if (unresolvedStaging.length) {
      if (!activity.definition.publishesArtifacts) {
        throw new Error(
          `Activity ${activityId} cannot retry while artifact staging remains unresolved.`
        );
      }
      const lease = runtime?.leases[activityId];
      if (
        !lease
        || lease.releasedAt
        || Date.parse(lease.expiresAt) > Date.now()
      ) {
        throw new Error(
          `Activity ${activityId} staging can be abandoned only after its worker lease expires.`
        );
      }
      const publisher = new ArtifactPublisher(this.requestId, {
        workspaceRoot: this.workspaceRoot,
        runtimeStore: this.runtime
      });
      for (const staging of unresolvedStaging) {
        const recovery = await publisher.recover(staging.publishId);
        if (recovery.state !== "READY_TO_PUBLISH") {
          throw new Error(
            `Artifact publication ${staging.publishId} is ${recovery.state}; retry is forbidden until final targets are reconciled.`
          );
        }
      }
      await this.runtime.reconcileExpiredActivity({
        activityId,
        operationIds: [],
        stagingPublishIds: unresolvedStaging.map((staging) => staging.publishId),
        resolution: "confirmed_not_applied",
        evidenceDigest: sha256(evidence)
      });
      abandonedUnpublishedStaging = true;
    }
    await this.appendSequence([
      {
        type: "ActivityFailed",
        actorType: "agent",
        payload: {
          activityId,
          attempt: activity.attempt,
          retryable: true,
          summary: evidence,
          reconciled: true
        },
        idempotencyKey: `${before.runId}/${activityId}/reconciled/retry/${sha256(evidence)}`
      },
      {
        type: "RetryScheduled",
        actorType: "system",
        payload: { activityId, attempt: activity.attempt, retryAt: scheduledAt },
        idempotencyKey: `${before.runId}/${activityId}/reconciled/retry-scheduled/${scheduledAt}`
      }
    ], before.head);
    if (!abandonedUnpublishedStaging) {
      await this.runtime.finalizeRetryableActivity(activityId);
    }
    return this.gate();
  }

  async reconcilePreparedPublication(
    activityId: string,
    publishId: string,
    evidence: string
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (activity && ["run", "report"].includes(activity.definition.kind)) {
      throw new Error(
        `Activity ${activityId} must use the dedicated formal execution completion path.`
      );
    }
    if (!activity || activity.state !== "RECONCILING" || !activity.definition.publishesArtifacts) {
      throw new Error(`Activity ${activityId} is not reconciling an artifact publication.`);
    }
    const runtime = await this.runtime.read();
    const staging = runtime?.stagingRefs[publishId];
    if (!staging || staging.activityId !== activityId) {
      throw new Error(`Prepared publication ${publishId} is not owned by ${activityId}.`);
    }
    await this.assertPreparedPublicationPolicy(
      before,
      activityId,
      publishId,
      staging.manifestPath,
      staging.manifestDigest
    );
    const publisher = new ArtifactPublisher(this.requestId, {
      workspaceRoot: this.workspaceRoot,
      runtimeStore: this.runtime
    });
    const published = await publisher.reconcilePrepared(publishId);
    return this.reconcileActivityInternal(
      activityId,
      "confirmed",
      evidence,
      undefined,
      published.artifacts.map((artifact) => artifact.targetPath),
      published.artifacts.map(({ targetPath, digest }) => ({ path: targetPath, digest })),
      true
    );
  }

  async recordArtifactPublishPrepared(
    event: ArtifactPublishPreparedEvent
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activityId = event.payload.activityId;
    if (!["RUNNING", "WAITING_CALLBACK", "RECONCILING"].includes(
      before.activities[activityId]?.state ?? ""
    )) {
      throw new Error(
        `Artifact publication requires running or callback-waiting activity ${activityId}.`
      );
    }
    const activity = before.activities[activityId];
    const formalReportReconciliation = activity?.state === "RECONCILING"
      && activity.definition.kind === "report";
    if (formalReportReconciliation) {
      const subject = await this.executionAuthorizationSubject(before);
      const expectedPaths = formalReportOutputPaths(subject.digest).sort();
      const actualPaths = event.payload.artifacts.map((artifact) => artifact.targetPath).sort();
      if (
        actualPaths.length !== expectedPaths.length
        || actualPaths.some((path, index) => path !== expectedPaths[index])
      ) {
        throw new Error(`Formal report must prepare exactly ${expectedPaths.join(", ")}.`);
      }
    } else if (["WAITING_CALLBACK", "RECONCILING"].includes(
      activity?.state ?? ""
    )) {
      const artifacts = event.payload.artifacts;
      const planPath = safeRelativePath(this.workspaceRoot, this.planPath);
      if (
        !decisionTypeForActivity(activityId)
        || artifacts.length !== 1
        || artifacts[0]?.targetPath !== planPath
      ) {
        throw new Error(
          "Only a formal callback may prepare exactly its request plan while waiting."
        );
      }
    }
    if (before.activities[activityId]?.state === "RUNNING") {
      const runtime = await this.runtime.read();
      const staging = runtime?.stagingRefs[event.payload.publishId];
      if (staging) {
        await this.assertPreparedPublicationPolicy(
          before,
          activityId,
          event.payload.publishId,
          staging.manifestPath,
          staging.manifestDigest
        );
      }
    }
    await this.append(
      "ArtifactPublishPrepared",
      "agent",
      event.payload as unknown as SafeEventPayload,
      `${before.runId}/${event.idempotencyKey}`,
      before.head
    );
    return this.gate();
  }

  async markArtifactDrift(input: {
    activityId: string;
    artifactPath: string;
    expectedDigest?: string;
    actualDigest?: string;
    detail: string;
  }): Promise<WorkflowGateView> {
    if (input.expectedDigest) requireDigest(input.expectedDigest, "expectedDigest");
    if (input.actualDigest) requireDigest(input.actualDigest, "actualDigest");
    const before = await this.gate();
    const payload: SafeEventPayload = {
      activityId: input.activityId,
      artifactPath: safeRelativePath(this.workspaceRoot, input.artifactPath),
      detail: input.detail,
      ...(input.expectedDigest ? { expectedDigest: input.expectedDigest } : {}),
      ...(input.actualDigest ? { actualDigest: input.actualDigest } : {})
    };
    await this.append(
      "ArtifactDriftDetected",
      "agent",
      payload,
      `${before.runId}/${input.activityId}/artifact-drift/${sha256(JSON.stringify(payload))}`,
      before.head
    );
    return this.gate();
  }

  async invalidateActivities(input: {
    activityIds: string[];
    reason: string;
    subjectDigest?: string;
  }): Promise<WorkflowGateView> {
    if (!input.activityIds.length) throw new Error("At least one activity must be invalidated.");
    if (input.subjectDigest) requireDigest(input.subjectDigest, "subjectDigest");
    const before = await this.gate();
    const affected = new Set<string>();
    for (const rootActivityId of input.activityIds) {
      for (const activityId of dependentActivityIds(before, rootActivityId)) {
        affected.add(activityId);
      }
    }
    for (const activityId of affected) {
      const activity = before.activities[activityId];
      if (!activity) throw new Error(`Unknown workflow activity: ${activityId}`);
      if (activity.state === "RUNNING" || activity.unresolvedExternalOperationIds.length) {
        throw new Error(`Cannot invalidate ${activityId} while it has in-flight work.`);
      }
    }
    const payload: SafeEventPayload = {
      activityIds: [...new Set(input.activityIds)],
      reason: input.reason,
      ...(input.subjectDigest ? { subjectDigest: input.subjectDigest } : {})
    };
    await this.append(
      "ActivitiesInvalidated",
      "agent",
      payload,
      `${before.runId}/invalidation/${sha256(JSON.stringify(payload))}`,
      before.head
    );
    return this.gate();
  }

  async reopenExecutionScope(reason: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    const authorization = before.activities["execution-authorization"];
    const readiness = before.activities.readiness;
    const buildReachedExecutionScope = Object.values(before.activities).some((activity) =>
      (activity.definition.kind === "engineering" || activity.definition.kind === "build")
      && !["PENDING", "READY", "CANCELLED"].includes(activity.state)
    );
    const readinessReachedExecutionScope = Boolean(
      readiness && !["PENDING", "READY", "CANCELLED"].includes(readiness.state)
    );
    if (!authorization || (
      ["PENDING", "READY"].includes(authorization.state)
      && !buildReachedExecutionScope
      && !readinessReachedExecutionScope
    )) {
      throw new Error("Execution scope has no pending or accepted callback to reopen.");
    }
    const engineeringRoots = Object.values(before.activities)
      .filter((activity) =>
        activity.definition.kind === "engineering"
        || activity.definition.kind === "build"
      )
      .map((activity) => activity.id);
    if (!engineeringRoots.length) {
      throw new Error("Workflow definition has no engineering root to reopen.");
    }
    return this.invalidateActivities({
      activityIds: engineeringRoots,
      reason,
      subjectDigest: authorization.callbackSubjectDigest
    });
  }

  async suspend(reason: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (before.workflowState === "SUSPENDED") return before;
    await this.append(
      "WorkflowSuspended",
      "system",
      { reason },
      `${before.runId}/workflow-suspended/${sha256(reason)}`,
      before.head
    );
    return this.gate();
  }

  async resume(reason: string, sessionId?: string): Promise<WorkflowGateView> {
    if (sessionId) await this.bindSession(sessionId);
    let before = await this.gate();
    before = await this.recoverCallbackPlanPublications(before);
    before = await this.tryCarryForwardLegacyPlanConfirmation(before);
    if (
      before.continuation.reason === "callback_subject_drift_reconcile"
      && (
        before.continuation.referenceId === "plan-confirmation"
        || before.continuation.referenceId === "case-confirmation"
        || before.continuation.referenceId === "case-review-conflict-decision"
        || before.continuation.referenceId === "execution-authorization"
      )
    ) {
      const affected = dependentActivityIds(
        before,
        before.continuation.referenceId
      );
      const running = [...affected].filter((activityId) =>
        before.activities[activityId]?.state === "RUNNING"
      );
      if (running.length) {
        await this.appendSequence(running.map((activityId) => ({
          type: "ArtifactDriftDetected",
          actorType: "system",
          payload: {
            activityId,
            detail: `Accepted callback subject changed while ${activityId} was in flight.`,
            recovery: "reconcile_before_callback_reopen"
          },
          idempotencyKey: `${before.runId}/${activityId}/callback-subject-drift/attempt-${before.activities[activityId]!.attempt}`
        })), before.head);
        before = await this.gate();
      }
    }
    if (
      before.continuation.reason === "callback_subject_drift"
      && (
        before.continuation.referenceId === "plan-confirmation"
        || before.continuation.referenceId === "case-confirmation"
        || before.continuation.referenceId === "case-review-conflict-decision"
        || before.continuation.referenceId === "execution-authorization"
      )
    ) {
      const activityId = before.continuation.referenceId;
      if (activityId === "execution-authorization") {
        const priorSubject = before.activities[activityId]?.callbackSubjectDigest;
        before = await this.invalidateActivities({
          activityIds: [activityId],
          reason: "repository execution authorization subject changed",
          ...(priorSubject ? { subjectDigest: priorSubject } : {})
        });
      } else {
        const subjectDigest = await this.callbackSubjectDigest(activityId);
        before = await this.reopenCallback({
          activityId,
          callbackId: `callback-${activityId}-${subjectDigest.slice(0, 12)}`,
          subjectDigest,
          kind: activityId === "plan-confirmation"
            ? "plan_confirmation"
            : activityId === "case-confirmation"
              ? "case_confirmation"
              : "business_conflict",
          reason: "repository callback subject digest changed"
        });
      }
    }
    if (before.workflowState === "SUSPENDED") {
      await this.append(
        "WorkflowResumed",
        "agent",
        { reason },
        `${before.runId}/workflow-resumed/${before.head.seq + 1}/${sha256(reason)}`,
        before.head
      );
      before = await this.gate();
    }
    return this.reconcileOrphanedActivities(before);
  }

  async reconcileOrphanedActivities(
    initial?: WorkflowGateView,
    at = Date.now()
  ): Promise<WorkflowGateView> {
    let view = initial ?? await this.gate(at);
    const events = await this.events();
    for (const activityId of view.runningActivities) {
      if (view.activities[activityId]?.definition.kind !== "review") continue;
      const dispatch = latestReviewerDispatch(events, activityId);
      const batchId = typeof dispatch?.payload.batchId === "string"
        ? dispatch.payload.batchId
        : undefined;
      if (!batchId) continue;
      try {
        await this.verifyOrRepairReviewSnapshot(batchId);
      } catch (error) {
        if (error instanceof ReviewInputDriftError) {
          return this.rotateDriftedReviewBatch(batchId, error);
        }
        throw error;
      }
    }
    const actions = planResumeRecovery({
      projection: view,
      events,
      runtime: await this.runtime.read(),
      now: at
    });
    for (const action of actions) {
      if (action.kind === "finalize_succeeded_runtime") {
        await this.runtime.finalizeSucceededActivity(action.activityId);
      } else if (action.kind === "finalize_reconciled_operation") {
        await this.runtime.finalizeReconciledOperation(
          action.activityId,
          action.operationId
        );
      } else if (action.kind === "clear_reviewer_binding") {
        await this.runtime.removeReviewerBinding(action.bindingId);
      } else if (action.kind === "repair_reviewer_binding") {
        await this.runtime.setReviewerBinding({
          bindingId: action.binding.bindingId,
          activityId: action.binding.activityId,
          batchId: action.binding.batchId,
          role: action.binding.role,
          agentTaskId: action.binding.agentTaskId,
          status: "running"
        });
      } else if (action.kind === "invalid_reviewer_dispatch") {
        throw new Error(
          `Running reviewer ${action.activityId} has no valid durable dispatch batch.`
        );
      }
    }
    await this.cleanupSucceededStagingDirectories(view);
    view = await this.gate(at);
    for (const action of actions) {
      if (action.kind !== "mark_activity_reconciling") continue;
      const payload: SafeEventPayload = {
        activityId: action.activityId,
        detail: action.detail,
        recovery: "reconcile_before_retry",
        attempt: action.attempt
      };
      await this.append(
        "ArtifactDriftDetected",
        "system",
        payload,
        `${view.runId}/${action.activityId}/runtime-orphan/attempt-${action.attempt}`,
        view.head
      );
      view = await this.gate(at);
    }
    return this.gate(at);
  }

  async startExternalOperation(input: {
    activityId: string;
    operationId: string;
    operationKind: string;
    inputDigest: string;
    claimToken: string;
  }): Promise<WorkflowGateView> {
    requireDigest(input.inputDigest, "inputDigest");
    const before = await this.gate();
    const handle = await this.handleForClaim(input.activityId, input.claimToken);
    await this.runtime.assertCanCommit(handle);
    const operationKey = `${before.runId}/${input.activityId}/${input.operationKind}/${input.inputDigest}`;
    await this.append(
      "ExternalOperationStarted",
      "runner",
      {
        activityId: input.activityId,
        operationId: input.operationId,
        operationKind: input.operationKind,
        inputDigest: input.inputDigest,
        operationKey
      },
      `${operationKey}/intent`,
      before.head
    );
    await this.runtime.addInFlightOperation({
      operationId: input.operationId,
      activityId: input.activityId,
      kind: input.operationKind,
      idempotencyKey: operationKey
    }, handle);
    return this.gate();
  }

  async reconcileExternalOperation(input: {
    activityId: string;
    operationId: string;
    outcome: "confirmed" | "not_found" | "unknown" | "conflict";
    evidenceDigest: string;
    claimToken?: string;
  }): Promise<WorkflowGateView> {
    requireDigest(input.evidenceDigest, "evidenceDigest");
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${input.activityId}`);
    const existingResolution = (await this.events()).find((event) =>
      event.type === "ExternalOperationReconciled"
      && event.payload.activityId === input.activityId
      && event.payload.operationId === input.operationId
      && event.payload.outcome === input.outcome
      && event.payload.evidenceDigest === input.evidenceDigest
    );
    if (!activity.unresolvedExternalOperationIds.includes(input.operationId)) {
      if (existingResolution) {
        await this.runtime.finalizeReconciledOperation(
          input.activityId,
          input.operationId
        );
        return this.gate();
      }
      throw new Error(
        `External operation ${input.operationId} is not unresolved for ${input.activityId}.`
      );
    }
    let handle: RuntimeLeaseHandle | undefined;
    if (input.claimToken) {
      handle = await this.handleForClaim(input.activityId, input.claimToken);
      // Validate the fence before recording semantic completion. A stale
      // worker must never be able to append a result and fail only during
      // disposable-runtime cleanup.
      await this.runtime.assertCanCommit(handle);
    } else {
      const runtime = await this.runtime.read();
      const lease = runtime?.leases[input.activityId];
      const runtimeOperation = runtime?.inFlightOperations[input.operationId];
      const activeLease = lease
        && !lease.releasedAt
        && Date.parse(lease.expiresAt) > Date.now();
      if (
        activity.state !== "RECONCILING"
        || activeLease
        || (
          runtimeOperation !== undefined
          && runtimeOperation.activityId !== input.activityId
        )
      ) {
        throw new Error(
          `External operation ${input.operationId} requires the current claim token, or explicit expired-runtime reconciliation before semantic recovery.`
        );
      }
    }
    await this.append(
      "ExternalOperationReconciled",
      "runner",
      {
        activityId: input.activityId,
        operationId: input.operationId,
        outcome: input.outcome,
        evidenceDigest: input.evidenceDigest
      },
      `${before.runId}/${input.activityId}/operation/${input.operationId}/reconciled/${input.outcome}/${input.evidenceDigest}`,
      before.head
    );
    await this.runtime.finalizeReconciledOperation(
      input.activityId,
      input.operationId,
      handle
    );
    return this.gate();
  }

  /**
   * Starts a review batch from frozen, allow-listed inputs. New v4 callers
   * must use this API instead of supplying an unaudited digest.
   */
  async startReviewBatch(input: {
    batchId: string;
    /** Additional controlled sources; plan and all declared packages are added by manager. */
    inputPaths?: string[];
    /** Omit for the initial full review; supply only invalidated reviewers for a targeted re-review. */
    activityIds?: string[];
    affectedRefs?: string[];
    excludedRefs?: string[];
    baseBatchId?: string;
    reason?: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const events = await this.events();
    const reviewActivities = Object.values(before.activities)
      .filter((activity) => activity.definition.kind === "review")
      .sort((left, right) => left.id.localeCompare(right.id));
    const allActivityIds = reviewActivities.map((activity) => activity.id);
    const requiredActivityIds = input.activityIds?.length
      ? [...new Set(input.activityIds)]
      : allActivityIds;
    const required = new Set(requiredActivityIds);
    const reusableEvidence: ReusedReviewerEvidence[] = [];
    for (const activity of reviewActivities) {
      if (required.has(activity.id)) continue;
      if (activity.state !== "SUCCEEDED") {
        throw new Error(
          `Targeted review cannot reuse ${activity.id}; its durable state is ${activity.state}.`
        );
      }
      const dispatch = latestReviewerDispatch(events, activity.id);
      if (
        !dispatch
        || typeof dispatch.payload.batchId !== "string"
        || typeof dispatch.payload.inputDigest !== "string"
        || typeof dispatch.payload.role !== "string"
      ) {
        throw new Error(`Targeted review cannot find reusable dispatch evidence for ${activity.id}.`);
      }
      const submission = latestReviewerSubmission(
        events,
        activity.id,
        dispatch.payload.batchId
      );
      if (
        !submission
        || typeof submission.payload.planEvidenceDigest !== "string"
      ) {
        throw new Error(`Targeted review cannot find reusable submission evidence for ${activity.id}.`);
      }
      reusableEvidence.push({
        activityId: activity.id,
        role: dispatch.payload.role,
        batchId: dispatch.payload.batchId,
        inputDigest: dispatch.payload.inputDigest,
        planEvidenceDigest: submission.payload.planEvidenceDigest
      });
    }
    const packagePaths = this.reviewPackagePaths(before);
    const caseRiskAssessment = assessCaseReviewRisk(await Promise.all(
      packagePaths.map((path) => readFile(path, "utf8"))
    ));
    const activityRoles = reviewActivities.map((activity) => {
      const role = activity.definition.metadata?.role;
      if (typeof role !== "string" || !role.trim()) {
        throw new Error(`Review activity ${activity.id} has no role binding.`);
      }
      return { activityId: activity.id, role };
    });
    const inputPaths = await this.requiredReviewInputPaths(input.inputPaths ?? []);
    const currentIdentity = await this.reviewInputs.inspectCurrent(inputPaths);
    const latestPlanConfirmationSubject = [...events].reverse().find((event) =>
      event.type === "CallbackResolved"
      && event.payload.activityId === "plan-confirmation"
      && event.payload.resolution === "accepted"
      && typeof event.payload.subjectDigest === "string"
    )?.payload.subjectDigest;
    const reviewEpochDigest = sha256(canonicalJson({
      schemaVersion: "review-epoch-v1",
      requestId: before.requestId,
      planSubjectDigest: latestPlanConfirmationSubject ?? before.planDigest,
      controlledSources: currentIdentity.artifacts
        .filter((artifact) => artifact.sourcePath.startsWith("sources/"))
        .map(({ sourcePath, digest }) => ({ sourcePath, digest }))
    } as unknown as SafeJsonValue));
    let semanticEvolutionCycle = 0;
    if (input.baseBatchId) {
      const baseEvent = reviewBatchStarted(events, input.baseBatchId);
      const baseScope = baseEvent?.payload.scope === undefined
        ? undefined
        : parseReviewBatchScope(baseEvent.payload.scope);
      if (baseScope?.schemaVersion === "review-batch-scope-v3") {
        const baseSnapshot = await this.reviewInputs.verify(input.baseBatchId);
        const currentAgainstBase = await this.reviewInputs.inspectCurrent(inputPaths, baseScope);
        if (currentAgainstBase.combinedDigest === baseSnapshot.combinedDigest) {
          return before;
        }
        if (baseScope.reviewEpochDigest === reviewEpochDigest) {
          semanticEvolutionCycle = baseScope.semanticEvolutionCycle + 1;
        }
      }
    }
    const maxSemanticCycles = before.reviewPolicy?.schemaVersion === "review-policy-v2"
      ? before.reviewPolicy.maxSemanticEvolutionCycles
      : Number.POSITIVE_INFINITY;
    if (semanticEvolutionCycle > maxSemanticCycles) {
      const blockerId = `review-convergence-failed-${reviewEpochDigest.slice(0, 12)}`;
      await this.append(
        "BlockerRaised",
        "system",
        {
          blockerId,
          affectedActivityIds: requiredActivityIds,
          category: "review_convergence_failed",
          detail: `Review semantic evolution exceeded ${maxSemanticCycles} cycles in one evidence epoch.`,
          resolutionCondition: "Add a new controlled source or formal user decision before starting another review epoch."
        },
        `${before.runId}/review/${reviewEpochDigest}/convergence-failed/${maxSemanticCycles}`,
        before.head
      );
      return this.gate();
    }
    const scope = before.reviewPolicy?.schemaVersion === "review-policy-v2"
      ? buildReviewBatchScopeV3({
          allActivityIds,
          requiredActivityIds,
          affectedRefs: input.affectedRefs,
          excludedRefs: input.excludedRefs,
          reason: input.reason,
          baseBatchId: input.baseBatchId,
          reusableEvidence,
          caseRiskAssessment,
          activityRoles,
          reviewEpochDigest,
          semanticEvolutionCycle
        })
      : buildReviewBatchScopeV2({
      allActivityIds,
      requiredActivityIds,
      affectedRefs: input.affectedRefs,
      excludedRefs: input.excludedRefs,
      reason: input.reason,
      baseBatchId: input.baseBatchId,
      reusableEvidence,
      caseRiskAssessment,
      activityRoles
    });
    const readiness = await this.currentReviewReadiness(before, events);
    const snapshot = await this.reviewInputs.freeze(
      input.batchId,
      inputPaths,
      scope
    );
    return this.appendValidatedReviewLifecycleEvent({
      type: "ReviewBatchStarted",
      batchId: input.batchId,
      inputDigest: snapshot.combinedDigest,
      inputRefs: snapshot.artifacts.map((artifact) => ({
        path: artifact.sourcePath,
        digest: artifact.digest,
        sizeBytes: artifact.sizeBytes,
        ...(artifact.semanticDigest ? { semanticDigest: artifact.semanticDigest } : {}),
        ...(artifact.roleSemanticDigests
          ? { roleSemanticDigests: artifact.roleSemanticDigests }
          : {})
      })),
      scope,
      scopeDigest: reviewBatchScopeDigest(scope),
      roleInputDigests: snapshot.roleInputDigests,
      readinessDigest: readiness.digest,
      readinessWarnings: readiness.warnings
    });
  }

  async dispatchReviewer(input: {
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId: string;
  }): Promise<ReviewLifecycleView> {
    await this.runtime.assertReviewerTaskIsIsolated(input.agentTaskId);
    const events = await this.events();
    this.assertReviewActivityInBatchScope(events, input.batchId, input.activityId);
    let inputDigest: string;
    try {
      inputDigest = await this.verifyOrRepairReviewSnapshot(input.batchId, input.activityId);
    } catch (error) {
      if (error instanceof ReviewInputDriftError) {
        return this.rotateDriftedReviewBatch(input.batchId, error);
      }
      throw error;
    }
    const before = await this.gate();
    const existingDispatch = latestReviewerDispatch(
      events,
      input.activityId
    );
    if (
      existingDispatch?.payload.batchId === input.batchId
      && existingDispatch.payload.role === input.role
      && existingDispatch.payload.inputDigest === inputDigest
      && ["RUNNING", "SUCCEEDED"].includes(
        before.activities[input.activityId]?.state ?? ""
      )
    ) {
      if (before.activities[input.activityId]?.state !== "RUNNING") {
        throw new Error(`Reviewer activity ${input.activityId} is already complete.`);
      }
      try {
        await this.bindReviewerRuntime({
          ...input,
          agentTaskId: input.agentTaskId,
          status: "running"
        });
        return { ...(await this.gate()), runtimeBinding: "bound" };
      } catch (error) {
        if (error instanceof WorkflowRuntimeConflictError) throw error;
        return { ...(await this.gate()), runtimeBinding: "repair_pending" };
      }
    }
    const view = await this.appendValidatedReviewLifecycleEvent({
      type: "ReviewerDispatched",
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      inputDigest
    });
    try {
      // Runtime handles are disposable. A binding failure must not turn a
      // durable dispatch into a false failure; resume will repair it.
      await this.bindReviewerRuntime({
        ...input,
        agentTaskId: input.agentTaskId,
        status: "running"
      });
      return { ...view, runtimeBinding: "bound" };
    } catch (error) {
      if (error instanceof WorkflowRuntimeConflictError) throw error;
      return { ...view, runtimeBinding: "repair_pending" };
    }
  }

  async submitReviewer(input: {
    activityId: string;
    batchId: string;
    role: string;
    planEvidenceRef?: string;
    agentTaskId: string;
  }): Promise<ReviewLifecycleView> {
    const events = await this.events();
    this.assertReviewActivityInBatchScope(events, input.batchId, input.activityId);
    let inputDigest: string;
    try {
      inputDigest = await this.verifyOrRepairReviewSnapshot(input.batchId, input.activityId);
    } catch (error) {
      if (error instanceof ReviewInputDriftError) {
        return this.rotateDriftedReviewBatch(input.batchId, error);
      }
      throw error;
    }
    const evidenceRef = input.planEvidenceRef ?? this.planPath;
    const evidenceDigest = sha256(await readFile(evidenceRef));
    const bindingId = reviewerBindingId(input.activityId, input.role, input.batchId);
    await this.runtime.requireReviewerBinding({
      bindingId,
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      agentTaskId: input.agentTaskId,
      status: "running"
    });
    const view = await this.appendValidatedReviewLifecycleEvent({
      type: "ReviewerSubmitted",
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      inputDigest,
      planEvidenceRef: evidenceRef,
      planEvidenceDigest: evidenceDigest,
      isolationProofVersion: REVIEWER_ISOLATION_PROOF_VERSION
    });
    try {
      await this.bindReviewerRuntime({
        ...input,
        agentTaskId: input.agentTaskId,
        status: "completed"
      });
      return { ...view, runtimeBinding: "bound" };
    } catch {
      return { ...view, runtimeBinding: "repair_pending" };
    }
  }

  private async bindReviewerRuntime(input: {
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId: string;
    status: "running" | "completed";
  }): Promise<void> {
    const view = await this.gate();
    const activity = view.activities[input.activityId];
    if (!activity || activity.definition.kind !== "review") {
      throw new Error(`Reviewer binding requires a review activity: ${input.activityId}.`);
    }
    if (activity.definition.metadata?.role !== input.role) {
      throw new Error(`Reviewer binding role does not match ${input.activityId}.`);
    }
    if (input.status === "running" && activity.state !== "RUNNING") {
      throw new Error(`Reviewer binding requires a running activity: ${input.activityId}.`);
    }
    if (input.status === "completed" && activity.state !== "SUCCEEDED") {
      throw new Error(`Completed reviewer binding requires durable submission: ${input.activityId}.`);
    }
    await this.runtime.setReviewerBinding({
      bindingId: reviewerBindingId(input.activityId, input.role, input.batchId),
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      agentTaskId: input.agentTaskId,
      status: input.status
    });
  }

  private assertReviewActivityInBatchScope(
    events: readonly WorkflowEvent[],
    batchId: string,
    activityId: string
  ): void {
    const batch = reviewBatchStarted(events, batchId);
    if (!batch) throw new Error(`Review batch ${batchId} was never started.`);
    if (batch.payload.scope === undefined) return;
    const scope = parseReviewBatchScope(batch.payload.scope);
    if (!scope.requiredActivityIds.includes(activityId)) {
      throw new Error(
        `Review activity ${activityId} is outside targeted batch ${batchId} scope.`
      );
    }
  }

  private async verifyOrRepairReviewSnapshot(
    batchId: string,
    activityId?: string
  ): Promise<string> {
    return verifyOrRepairReviewSnapshot(
      this.reviewInputs,
      await this.events(),
      batchId,
      activityId
    );
  }

  private async rotateDriftedReviewBatch(
    batchId: string,
    error: ReviewInputDriftError
  ): Promise<ReviewLifecycleView> {
    const before = await this.gate();
    const events = await this.events();
    const batch = reviewBatchStarted(events, batchId);
    if (!batch || typeof batch.payload.inputDigest !== "string") {
      throw new Error(`Review batch ${batchId} was never started.`);
    }
    const scope = batch.payload.scope === undefined
      ? undefined
      : parseReviewBatchScope(batch.payload.scope);
    const nextScope = scope?.schemaVersion === "review-batch-scope-v3"
      ? {
          ...scope,
          semanticEvolutionCycle: scope.semanticEvolutionCycle + 1
        }
      : scope;
    if (
      nextScope?.schemaVersion === "review-batch-scope-v3"
      && nextScope.semanticEvolutionCycle > 2
    ) {
      const blockerId = `review-convergence-failed-${nextScope.reviewEpochDigest.slice(0, 12)}`;
      await this.append(
        "BlockerRaised",
        "system",
        {
          blockerId,
          affectedActivityIds: nextScope.requiredActivityIds,
          category: "review_convergence_failed",
          detail: "Review semantic evolution exceeded 2 cycles in one evidence epoch.",
          resolutionCondition: "Add a new controlled source or formal user decision before starting another review epoch."
        },
        `${before.runId}/review/${nextScope.reviewEpochDigest}/convergence-failed/2`,
        before.head
      );
      return {
        ...(await this.gate()),
        runtimeBinding: "repair_pending"
      };
    }
    const readiness = await this.currentReviewReadiness(before, events);
    const inputPaths = await this.requiredReviewInputPaths([]);
    const current = await this.reviewInputs.inspectCurrent(inputPaths, nextScope);
    const nextBatchId = rotatedReviewBatchId(batchId, current.combinedDigest);
    const snapshot = await this.reviewInputs.freeze(nextBatchId, inputPaths, nextScope);
    const batchOwnedActivities = new Set(reviewBatchActivityIds(events, batchId));
    const activityIds = (
      scope?.requiredActivityIds
      ?? [...batchOwnedActivities]
    )
      .filter((activityId) =>
        batchOwnedActivities.has(activityId)
        && before.activities[activityId]?.definition.kind === "review"
      );
    const inputRefs = snapshot.artifacts.map((artifact) => ({
      path: artifact.sourcePath,
      digest: artifact.digest,
      sizeBytes: artifact.sizeBytes,
      ...(artifact.semanticDigest ? { semanticDigest: artifact.semanticDigest } : {}),
      ...(artifact.roleSemanticDigests
        ? { roleSemanticDigests: artifact.roleSemanticDigests }
        : {})
    }));
    const findingsDigest = reviewFindingsDigest(events, batchId);
    const drafts: WorkflowEventDraft[] = [
      ...(activityIds.length
        ? [{
            type: "ReviewBatchInvalidated" as const,
            actorType: "system" as const,
            payload: {
              batchId,
              activityIds,
              inputDigest: batch.payload.inputDigest,
              revisionDigest: current.combinedDigest,
              findingsDigest,
              reason: "input_drift"
            },
            idempotencyKey: `${before.runId}/review/${batchId}/input-drift/${current.combinedDigest}/${findingsDigest}`
          }]
        : []),
      {
        type: "ReviewBatchStarted",
        actorType: "system",
        payload: {
          batchId: nextBatchId,
          inputDigest: snapshot.combinedDigest,
          inputRefs,
          ...(snapshot.roleInputDigests
            ? { roleInputDigests: snapshot.roleInputDigests }
            : {}),
          ...(nextScope
            ? {
                scope: nextScope as unknown as SafeJsonValue,
                scopeDigest: reviewBatchScopeDigest(nextScope)
              }
            : {}),
          readinessDigest: readiness.digest,
          readinessWarnings: readiness.warnings
        },
        idempotencyKey: `${before.runId}/review/${nextBatchId}/ReviewBatchStarted/${snapshot.combinedDigest}`
      }
    ];
    await this.appendSequence(drafts, before.head);
    const runtime = await this.runtime.read();
    for (const binding of Object.values(runtime?.reviewerBindings ?? {})) {
      if (binding.batchId === batchId) {
        await this.runtime.removeReviewerBinding(binding.bindingId);
      }
    }
    return {
      ...(await this.gate()),
      runtimeBinding: "repair_pending",
      reviewBatch: {
        status: "new_batch_started",
        batchId: nextBatchId,
        previousBatchId: batchId,
        reason: error.message
      }
    };
  }

  /** Inputs are manager-owned: callers may add controlled source material but
   * cannot omit the formal plan or any package declared by this run. */
  private async requiredReviewInputPaths(additional: string[]): Promise<string[]> {
    const view = await this.gate();
    const packages = this.reviewPackagePaths(view);
    const plan = await readFile(this.planPath, "utf8");
    const referencedSources = referencedControlledSources(plan)
      .map((reference) => {
        return resolve(
          reference.startsWith("sources/") ? this.workspaceRoot : dirname(this.planPath),
          reference
        );
      });
    return requiredReviewInputs(this.planPath, packages, referencedSources, additional);
  }

  private reviewPackagePaths(view: WorkflowProjection): string[] {
    return Object.values(view.activities)
      .filter((activity) => activity.definition.kind === "case_generation")
      .map((activity) => {
        const packageName = activity.definition.metadata?.package;
        if (typeof packageName !== "string") throw new Error(`Case activity ${activity.id} has no package binding.`);
        return resolve(this.requestRoot, packageName);
      });
  }

  private async currentReviewReadiness(
    view: WorkflowProjection,
    events: readonly WorkflowEvent[]
  ): Promise<ReturnType<typeof evaluateReviewReadiness>> {
    const packagePaths = this.reviewPackagePaths(view);
    const plan = await readFile(this.planPath, "utf8");
    const packages = Object.fromEntries(await Promise.all(
      packagePaths.map(async (path) => [
        basename(path),
        await readFile(path, "utf8")
      ])
    ));
    const readiness = evaluateReviewReadiness({
      plan,
      packages,
      writesData: events.find((event) => event.type === "ActivitiesExpanded")
        ?.payload.writesData === true
    });
    if (!readiness.complete) {
      throw new Error(
        `Review readiness failed before reviewer dispatch:\n${readiness.issues.join("\n")}`
      );
    }
    return readiness;
  }

  async invalidateReviewBatch(input: {
    batchId: string;
    activityIds: string[];
    revisionDigest?: string;
    findingsDigest?: string;
    reason: string;
  }): Promise<WorkflowGateView> {
    const view = await this.gate();
    const events = await this.events();
    let activityIds = [...new Set(input.activityIds)];
    const batch = reviewBatchStarted(events, input.batchId);
    const scope = batch?.payload.scope === undefined
      ? undefined
      : parseReviewBatchScope(batch.payload.scope);
    if (scope?.schemaVersion === "review-batch-scope-v3") {
      const frozen = await this.reviewInputs.verify(input.batchId);
      const paths = frozen.artifacts.map((artifact) => artifact.sourcePath);
      const current = await this.reviewInputs.inspectCurrent(paths, scope);
      const changedRoles = new Set(scope.roleScopes.flatMap((roleScope) =>
        current.roleInputDigests?.[roleScope.activityId]
          !== frozen.roleInputDigests?.[roleScope.activityId]
          ? [roleScope.activityId]
          : []
      ));
      activityIds = activityIds.filter((activityId) => changedRoles.has(activityId));
      if (!activityIds.length) return view;
    }
    const inputDigest = reviewBatchInvalidationInputDigest({
      events,
      projection: view,
      batchId: input.batchId,
      activityIds
    });
    const revisionDigest = input.revisionDigest ?? reviewRevisionDigest({
      events,
      batchId: input.batchId,
      activityIds
    });
    const findingsDigest = input.findingsDigest
      ?? reviewFindingsDigest(events, input.batchId);
    return this.appendValidatedReviewLifecycleEvent({
      type: "ReviewBatchInvalidated",
      ...input,
      activityIds,
      revisionDigest,
      findingsDigest,
      inputDigest
    });
  }

  private async appendValidatedReviewLifecycleEvent(input: {
    type: Extract<WorkflowEventType, "ReviewBatchStarted" | "ReviewerDispatched" | "ReviewerSubmitted" | "ReviewBatchInvalidated">;
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
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    let normalizedInput = input;
    if (input.type === "ReviewerSubmitted") {
      if (!input.planEvidenceRef || !input.planEvidenceDigest) {
        throw new Error("Reviewer submission requires plan evidence path and digest.");
      }
      const evidenceRef = safeRelativePath(this.workspaceRoot, input.planEvidenceRef);
      const expectedPlanRef = safeRelativePath(this.workspaceRoot, this.planPath);
      if (evidenceRef !== expectedPlanRef) {
        throw new Error(`Reviewer evidence must reference the request plan: ${expectedPlanRef}.`);
      }
      const actualDigest = sha256(await readFile(resolve(this.workspaceRoot, evidenceRef)));
      if (actualDigest !== input.planEvidenceDigest) {
        throw new Error(
          `Reviewer plan evidence digest mismatch; expected ${input.planEvidenceDigest}, read ${actualDigest}.`
        );
      }
      normalizedInput = { ...input, planEvidenceRef: evidenceRef };
    }
    const prepared = prepareReviewLifecycleEvent(before, normalizedInput);
    if (prepared.duplicate) return before;
    const payload = prepared.payload;
    await this.append(
      input.type,
      input.type === "ReviewerSubmitted" ? "reviewer" : "agent",
      payload,
      `${before.runId}/review/${input.batchId}/${input.type}/${input.activityId ?? "batch"}/${sha256(JSON.stringify(payload))}`,
      before.head
    );
    return this.gate();
  }

  async failReviewer(input: {
    activityId: string;
    batchId: string;
    summary: string;
    retryAt?: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== "review" || activity.state !== "RUNNING") {
      throw new Error(`Reviewer activity ${input.activityId} is not running.`);
    }
    const maxAttempts = before.reviewPolicy?.maxAttemptsPerRole ?? 3;
    const failedKey = `${before.runId}/review/${input.batchId}/${input.activityId}/attempt-${activity.attempt}/failed/${sha256(input.summary)}`;
    if (activity.attempt < maxAttempts) {
      const retryAt = input.retryAt
        ?? new Date(Date.now() + Math.min(120_000, 2 ** activity.attempt * 1_000)).toISOString();
      await this.appendSequence([
        {
          type: "ActivityFailed",
          actorType: "reviewer",
          payload: {
            activityId: input.activityId,
            batchId: input.batchId,
            attempt: activity.attempt,
            retryable: true,
            summary: input.summary
          },
          idempotencyKey: failedKey
        },
        {
          type: "RetryScheduled",
          actorType: "system",
          payload: { activityId: input.activityId, attempt: activity.attempt, retryAt },
          idempotencyKey: `${before.runId}/review/${input.batchId}/${input.activityId}/attempt-${activity.attempt}/retry/${retryAt}`
        }
      ], before.head);
      return this.gate();
    }
    await this.appendSequence([
      {
        type: "ActivityFailed",
        actorType: "reviewer",
        payload: {
          activityId: input.activityId,
          batchId: input.batchId,
          attempt: activity.attempt,
          retryable: false,
          summary: input.summary
        },
        idempotencyKey: failedKey
      },
      {
        type: "BlockerRaised",
        actorType: "system",
        payload: {
          blockerId: `reviewer-exhausted-${input.activityId}`,
          affectedActivityIds: [input.activityId],
          category: "reviewer_failure",
          detail: `Reviewer ${input.activityId} exhausted ${maxAttempts} attempts.`,
          resolutionCondition: "Restore a real isolated reviewer and explicitly resolve this blocker."
        },
        idempotencyKey: `${before.runId}/review/${input.activityId}/attempts-exhausted`
      }
    ], before.head);
    return this.gate();
  }

  async complete(testOutcome?: TestOutcome): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (before.workflowState === "SUCCEEDED") return before;
    const completion = Object.values(before.activities)
      .find((activity) => activity.definition.kind === "complete");
    if (completion?.state !== "READY") {
      throw new Error("Workflow completion is not ready.");
    }
    if (!before.checkpoint.safe) {
      throw new Error(`Workflow completion checkpoint is unsafe: ${before.checkpoint.reason}`);
    }
    await this.append(
      "WorkflowCompleted",
      "system",
      { ...(testOutcome ? { testOutcome } : {}) },
      `${before.runId}/workflow-completed/${testOutcome ?? "none"}`,
      before.head
    );
    return this.gate();
  }

  async cancel(reason: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (before.workflowState === "CANCELLED") return before;
    if (!before.checkpoint.safe) {
      throw new Error(`Workflow cancellation checkpoint is unsafe: ${before.checkpoint.reason}`);
    }
    await this.append(
      "WorkflowCancelled",
      "user",
      { reason },
      `${before.runId}/workflow-cancelled/${sha256(reason)}`,
      before.head
    );
    return this.gate();
  }

  async verifyHistory(): Promise<{ head: WorkflowHistoryHead; eventCount: number; projection: WorkflowGateView }> {
    const events = await this.events();
    const projection = await this.gate();
    return { head: projection.head, eventCount: events.length, projection };
  }

  private checkpoint(
    projection: WorkflowProjection,
    runtime: WorkflowRuntimeState | null
  ): WorkflowGateView["checkpoint"] {
    const inFlightActivities = Object.values(projection.activities)
      .filter((activity) =>
        ["RUNNING", "RECONCILING"].includes(activity.state)
        || activity.unresolvedExternalOperationIds.length > 0
      )
      .map((activity) => activity.id);
    if (inFlightActivities.length) {
      return {
        safe: false,
        reason: `activities require closure or reconciliation: ${inFlightActivities.join(", ")}`
      };
    }
    if (Object.keys(runtime?.inFlightOperations ?? {}).length) {
      return { safe: false, reason: "external operation runtime handles require reconciliation" };
    }
    if (Object.keys(runtime?.stagingRefs ?? {}).length) {
      return { safe: false, reason: "artifact staging references require publish or reconciliation" };
    }
    return { safe: true, reason: "all side effects are durable or no activity is in flight" };
  }

  private applyActiveFormalCallbackPublicationWait(
    projection: WorkflowProjection,
    runtime: WorkflowRuntimeState | null,
    at: number
  ): void {
    if (!runtime) return;
    const activePublication = Object.values(runtime.stagingRefs).find((staging) => {
      const activity = projection.activities[staging.activityId];
      const lease = runtime.leases[staging.activityId];
      return Boolean(
        activity?.state === "WAITING_CALLBACK"
        && decisionTypeForActivity(staging.activityId)
        && lease
        && !lease.releasedAt
        && lease.leaseId === staging.leaseId
        && lease.fencingToken === staging.fencingToken
        && Date.parse(lease.expiresAt) > at
      );
    });
    if (!activePublication) return;
    const lease = runtime.leases[activePublication.activityId]!;
    projection.continuation = {
      kind: "wait_until",
      referenceId: activePublication.activityId,
      notBefore: lease.expiresAt,
      reason: "formal_callback_publication_in_flight"
    };
    projection.reply = {
      kind: "none",
      allowed: false,
      reason: "automatic_work_in_flight"
    };
  }

  private async applyCallbackSubjectDrift(
    projection: WorkflowProjection
  ): Promise<void> {
    for (const activityId of Object.keys(projection.activities).filter(isFormalCallbackActivity)) {
      const activity = projection.activities[activityId];
      if (
        activity?.state !== "SUCCEEDED"
        || !activity.callbackSubjectDigest
      ) continue;
      let decisionValid = true;
      const originSubjectDigest = activity.decisionOriginSubjectDigest
        ?? activity.callbackSubjectDigest;
      try {
        assertFormalUserDecision(
          await readFile(this.planPath, "utf8"),
          activityId,
          originSubjectDigest,
          "accepted"
        );
      } catch {
        decisionValid = false;
      }
      let actual = activity.callbackSubjectDigest;
      const conflictDecisionConsumed = activityId === "case-review-conflict-decision"
        && projection.activities["case-review-evolution"]?.state === "SUCCEEDED";
      if (!conflictDecisionConsumed) {
        try {
          actual = await this.callbackSubjectDigest(activityId);
        } catch {
          actual = sha256(`invalid-or-missing-callback-subject:${activityId}`);
        }
      }
      if (callbackDecisionIsCurrent({
        acceptedSubject: activity.callbackSubjectDigest,
        actualSubject: actual,
        formalDecisionValid: decisionValid
      })) continue;
      applyCallbackDriftProjection({
        projection,
        activityId,
        acceptedSubject: activity.callbackSubjectDigest,
        actualSubject: actual,
        formalDecisionValid: decisionValid
      });
      return;
    }
  }

  private async formalCallbackPublicationEvidence(
    activityId: string
  ): Promise<{
    publishId: string;
    manifestDigest: string;
    planPath: string;
    planDigest: string;
  }> {
    const events = await this.events();
    const attempt = [...events].reverse().find((event) =>
      event.type === "ActivityAttemptStarted"
      && event.payload.activityId === activityId
    );
    const prepared = [...events].reverse().find((event) =>
      event.type === "ArtifactPublishPrepared"
      && event.payload.activityId === activityId
      && (!attempt || event.seq > attempt.seq)
    );
    if (!prepared) {
      throw new Error(
        `Formal callback ${activityId} requires a durable plan publication before resolution.`
      );
    }
    const publishId = typeof prepared.payload.publishId === "string"
      ? prepared.payload.publishId
      : "";
    const manifestDigest = requireDigest(
      String(prepared.payload.manifestDigest ?? ""),
      "formal callback manifestDigest"
    );
    const artifacts = prepared.payload.artifacts;
    const planPath = safeRelativePath(this.workspaceRoot, this.planPath);
    if (!Array.isArray(artifacts) || artifacts.length !== 1) {
      throw new Error(`Formal callback ${activityId} must publish exactly plan.md.`);
    }
    const artifact = artifacts[0];
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new Error(`Formal callback ${activityId} has malformed publication evidence.`);
    }
    const record = artifact as Record<string, SafeJsonValue>;
    const recordedPath = typeof record.targetPath === "string"
      ? safeRelativePath(this.workspaceRoot, record.targetPath)
      : "";
    const planDigest = requireDigest(
      String(record.digest ?? ""),
      "formal callback planDigest"
    );
    if (
      !publishId
      || recordedPath !== planPath
      || sha256(await readFile(this.planPath)) !== planDigest
    ) {
      throw new Error(
        `Formal callback ${activityId} final plan does not match its prepared publication.`
      );
    }
    return { publishId, manifestDigest, planPath, planDigest };
  }

  private async nextFormalCallbackPublishId(
    callbackId: string,
    planDigest: string
  ): Promise<string> {
    requireDigest(planDigest, "callback planDigest");
    const prefix = `callback-plan-${sha256(callbackId).slice(0, 16)}-${planDigest.slice(0, 16)}`;
    const used = new Set(
      (await this.events()).flatMap((event) =>
        event.type === "ArtifactPublishPrepared"
        && typeof event.payload.publishId === "string"
          ? [event.payload.publishId]
          : []
      )
    );
    let generation = 1;
    while (used.has(`${prefix}-g${generation}`)) generation += 1;
    return `${prefix}-g${generation}`;
  }

  private async assertResolvedCallbackPlanReplay(
    input: {
      callbackId: string;
      activityId: string;
      subjectDigest: string;
      resolution: CallbackResolution;
      planContent: ArtifactContent;
    },
    required = true
  ): Promise<WorkflowEvent | undefined> {
    const resolved = [...await this.events()].reverse().find((event) =>
      event.type === "CallbackResolved"
      && event.payload.activityId === input.activityId
      && event.payload.callbackId === input.callbackId
      && event.payload.subjectDigest === input.subjectDigest
      && event.payload.resolution === input.resolution
    );
    if (!resolved) {
      if (required) {
        throw new Error(
          `Callback ${input.callbackId} is not waiting and has no matching durable resolution to replay.`
        );
      }
      return undefined;
    }
    const recordedPlanDigest = requireDigest(
      String(resolved.payload.planDigest ?? ""),
      "resolved callback planDigest"
    );
    const candidatePlanDigest = sha256(Buffer.from(input.planContent));
    if (candidatePlanDigest !== recordedPlanDigest) {
      throw new Error(
        `Callback ${input.callbackId} replay planContent conflicts with its durable resolution planDigest.`
      );
    }
    return resolved;
  }

  private async executionAuthorizationSubject(
    projection: WorkflowProjection
  ): Promise<{ digest: string; callbackId: string }> {
    const activity = projection.activities["execution-authorization"];
    const artifact = activity?.definition.metadata?.callbackSubjectArtifact;
    const format = activity?.definition.metadata?.callbackSubjectFormat;
    const schemaVersion = activity?.definition.metadata?.callbackSubjectSchemaVersion;
    const publisherActivityId = activity?.definition.metadata?.publisherActivityId;
    if (
      typeof artifact !== "string"
      || format !== "canonical_json_digest_v1"
      || !["execution-authorization-v2", "execution-authorization-v3", "execution-authorization-v4"].includes(String(schemaVersion))
      || typeof publisherActivityId !== "string"
      || !["script-review", "readiness"].includes(publisherActivityId)
      || artifact.includes("/")
      || artifact.includes("\\")
    ) {
      throw new Error(
        "Execution authorization has no safe repository subject artifact binding."
      );
    }
    const artifactPath = safeRelativePath(
      this.workspaceRoot,
      resolve(this.requestRoot, artifact)
    );
    const artifactBytes = await readFile(resolve(this.workspaceRoot, artifactPath));
    const publisher = projection.activities[publisherActivityId];
    if (publisher?.state !== "SUCCEEDED") {
      throw new Error(
        `Execution authorization subject has not been published by the completed ${publisherActivityId} Activity.`
      );
    }
    const publisherSuccess = [...await this.events()].reverse().find((event) =>
      event.type === "ActivitySucceeded"
      && event.payload.activityId === publisherActivityId
    );
    const publishedOutputs = publisherSuccess?.payload.outputDigests;
    const publishedDigest = Array.isArray(publishedOutputs)
      ? publishedOutputs.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const record = item as Record<string, SafeJsonValue>;
          return record.path === artifactPath && typeof record.digest === "string"
            ? [record.digest]
            : [];
        }).at(-1)
      : undefined;
    if (!publishedDigest || publishedDigest !== sha256(artifactBytes)) {
      throw new Error(
        `Execution authorization subject does not match the latest ${publisherActivityId} publication digest.`
      );
    }
    const raw = JSON.parse(artifactBytes.toString("utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Execution authorization subject must be a JSON object.");
    }
    const record = raw as Record<string, unknown>;
    const allowedKeys = new Set([
      "schemaVersion",
      "requestId",
      "environment",
      "planDigest",
      "scriptDigests",
      "caseIds",
      "targetBuildDigest",
      "runnableCaseIds",
      "deferredCases",
      "capabilityEvidence",
      "selectorEvidenceDigests",
      "scriptReview",
      "caseScopes",
      "resourcePoolBudgets",
      "resourcePoolEvidence",
      "externalTransitions",
      "readinessDigest",
      "allowedOperations",
      "resourceBudgets",
      "dataWritePolicy",
      "residualTtlHours",
      "securityChallengePolicy",
      "artifactPolicy",
      "digest",
      "callbackId",
      "createdAt"
    ]);
    const unexpectedKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length || record.schemaVersion !== schemaVersion) {
      throw new Error("Execution authorization subject does not match its bound schema.");
    }
    if (record.requestId !== this.requestId) {
      throw new Error("Execution authorization subject belongs to another request.");
    }
    assertExecutionAuthorizationInputsCurrent(
      record,
      this.workspaceRoot,
      this.planPath
    );
    const callbackId = String(record.callbackId ?? "");
    if (!callbackId.trim() || callbackId.length > 240) {
      throw new Error("Execution authorization subject has an invalid callbackId.");
    }
    const digest = requireDigest(
      String(record.digest ?? ""),
      "execution authorization digest"
    );
    const {
      digest: _digest,
      callbackId: _callbackId,
      createdAt: _createdAt,
      ...digestBase
    } = record;
    if (sha256(canonicalJson(digestBase as unknown as SafeJsonValue)) !== digest) {
      throw new Error(
        "Execution authorization subject digest does not match its immutable JSON content."
      );
    }
    return { digest, callbackId };
  }

  private async assertFormalCompletionEvidence(
    projection: WorkflowProjection,
    activityId: "run" | "report",
    input: FormalExecutionWorkflowEvidence
  ): Promise<FormalExecutionWorkflowEvidence> {
    const activity = projection.activities[activityId];
    if (!activity || activity.definition.kind !== activityId) {
      throw new Error(`Workflow definition is missing formal activity ${activityId}.`);
    }
    const contract = activity.definition.metadata?.completionContract;
    if (contract !== undefined && contract !== "formal-execution-completion-seal-v1") {
      throw new Error(`Activity ${activityId} has an unsupported completion contract.`);
    }
    const evidence = parseFormalExecutionWorkflowEvidence(
      input as unknown as SafeJsonValue
    );
    const authorization = projection.activities["execution-authorization"];
    if (authorization?.state !== "SUCCEEDED") {
      throw new Error("Formal completion requires an accepted execution authorization.");
    }
    const subject = await this.executionAuthorizationSubject(projection);
    if (
      subject.digest !== evidence.executionSubjectDigest
      || authorization.callbackSubjectDigest !== evidence.executionSubjectDigest
    ) {
      throw new Error(
        "Formal completion evidence differs from the accepted execution subject."
      );
    }
    if (activityId === "report") {
      const events = await this.events();
      const runSuccess = [...events].reverse().find((event) =>
        event.type === "ActivitySucceeded"
        && event.payload.activityId === "run"
      );
      if (!runSuccess?.payload.formalExecutionEvidence) {
        if (contract === "formal-execution-completion-seal-v1") {
          throw new Error("Formal report requires sealed evidence from the succeeded run activity.");
        }
        return evidence;
      }
      const runEvidence = parseFormalExecutionWorkflowEvidence(
        runSuccess.payload.formalExecutionEvidence
      );
      if (!sameFormalExecutionWorkflowEvidence(runEvidence, evidence)) {
        throw new Error("Formal report evidence differs from the succeeded run evidence.");
      }
    }
    return evidence;
  }

  private async assertRecordedFormalCompletion(
    activityId: "run" | "report",
    evidence: FormalExecutionWorkflowEvidence
  ): Promise<void> {
    const succeeded = [...await this.events()].reverse().find((event) =>
      event.type === "ActivitySucceeded"
      && event.payload.activityId === activityId
    );
    if (!succeeded?.payload.formalExecutionEvidence) {
      throw new Error(`Succeeded ${activityId} has no formal completion evidence.`);
    }
    const recorded = parseFormalExecutionWorkflowEvidence(
      succeeded.payload.formalExecutionEvidence
    );
    if (!sameFormalExecutionWorkflowEvidence(recorded, evidence)) {
      throw new Error(`Succeeded ${activityId} is bound to different formal evidence.`);
    }
  }

  private async cleanupSucceededStagingDirectories(
    projection: WorkflowProjection
  ): Promise<void> {
    const stagingRoot = resolve(this.runtime.requestRoot, "staging");
    let entries;
    try {
      entries = await readdir(stagingRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const publicationRoot = resolve(stagingRoot, entry.name);
      try {
        const manifest = JSON.parse(
          await readFile(resolve(publicationRoot, "manifest.json"), "utf8")
        ) as { activityId?: string };
        if (
          manifest.activityId
          && projection.activities[manifest.activityId]?.state === "SUCCEEDED"
        ) {
          await rm(publicationRoot, { recursive: true, force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async callbackPlanPublicationIsPublished(
    activityId: string
  ): Promise<boolean> {
    const runtime = await this.runtime.read();
    const staging = Object.values(runtime?.stagingRefs ?? {})
      .filter((candidate) => candidate.activityId === activityId);
    if (!staging.length) return false;
    const publisher = new ArtifactPublisher(this.requestId, {
      workspaceRoot: this.workspaceRoot,
      runtimeStore: this.runtime
    });
    const states = await Promise.all(
      staging.map((candidate) => publisher.recover(candidate.publishId))
    );
    return states.every((recovery) => recovery.state === "PUBLISHED");
  }

  private async recoverCallbackPlanPublications(
    initial: WorkflowGateView
  ): Promise<WorkflowGateView> {
    let view = initial;
    const runtime = await this.runtime.read();
    const events = await this.events();
    for (const activity of Object.values(view.activities)) {
      if (
        !decisionTypeForActivity(activity.id)
        || !["WAITING_CALLBACK", "RECONCILING"].includes(activity.state)
        || !activity.callbackId
        || !activity.callbackSubjectDigest
      ) continue;
      const attempt = [...events].reverse().find((event) =>
        event.type === "ActivityAttemptStarted"
        && event.payload.activityId === activity.id
      );
      const latestPrepared = [...events].reverse().find((event) =>
        event.type === "ArtifactPublishPrepared"
        && event.payload.activityId === activity.id
        && (!attempt || event.seq > attempt.seq)
      );
      if (!latestPrepared) continue;
      try {
        await this.formalCallbackPublicationEvidence(activity.id);
        const resolution = formalUserDecisionResolution(
          await readFile(this.planPath, "utf8"),
          activity.id,
          activity.callbackSubjectDigest
        );
        if (!resolution) throw new Error("Published plan has no matching formal decision.");
        view = await this.resolveCallbackInternal({
          activityId: activity.id,
          callbackId: activity.callbackId,
          subjectDigest: activity.callbackSubjectDigest,
          resolution
        }, true);
        return view;
      } catch {
        const hasRuntimeStaging = Object.values(runtime?.stagingRefs ?? {})
          .some((staging) => staging.activityId === activity.id);
        if (!hasRuntimeStaging) {
          const preparedArtifacts = latestPrepared.payload.artifacts;
          const planPath = safeRelativePath(this.workspaceRoot, this.planPath);
          const preparedPlan = Array.isArray(preparedArtifacts)
            ? preparedArtifacts.find((item) =>
                item
                && typeof item === "object"
                && !Array.isArray(item)
                && (item as Record<string, SafeJsonValue>).targetPath === planPath
              ) as Record<string, SafeJsonValue> | undefined
            : undefined;
          const expectedPreviousDigest = preparedPlan?.expectedPreviousDigest;
          const actualDigest = sha256(await readFile(this.planPath));
          if (
            typeof expectedPreviousDigest === "string"
            && expectedPreviousDigest === actualDigest
          ) {
            // The prepared plan was never renamed. Disposable staging was
            // lost, but the callback remains safely waiting for a rebuilt
            // publication with a new fence.
            return view;
          }
          if (activity.state !== "RECONCILING") {
            await this.markArtifactDrift({
              activityId: activity.id,
              artifactPath: this.planPath,
              detail: "Prepared formal decision cannot be matched to final plan.md."
            });
          }
          return this.gate();
        }
      }
    }
    const callbackStaging = Object.values(runtime?.stagingRefs ?? {})
      .filter((staging) => {
        const activity = view.activities[staging.activityId];
        return activity
          && decisionTypeForActivity(staging.activityId)
          && ["WAITING_CALLBACK", "RECONCILING"].includes(activity.state);
      });
    if (!callbackStaging.length) return view;
    const publisher = new ArtifactPublisher(this.requestId, {
      workspaceRoot: this.workspaceRoot,
      runtimeStore: this.runtime
    });
    for (const staging of callbackStaging) {
      const activity = view.activities[staging.activityId]!;
      const recovery = await publisher.recover(staging.publishId);
      if (recovery.state === "PUBLISHED") {
        const plan = await readFile(this.planPath, "utf8");
        const resolution = formalUserDecisionResolution(
          plan,
          staging.activityId,
          activity.callbackSubjectDigest ?? ""
        );
        if (!resolution || !activity.callbackId || !activity.callbackSubjectDigest) {
          if (activity.state !== "RECONCILING") {
            await this.markArtifactDrift({
              activityId: staging.activityId,
              artifactPath: this.planPath,
              detail: "Published callback plan has no matching formal decision."
            });
          }
          return this.gate();
        }
        view = await this.resolveCallbackInternal({
          activityId: staging.activityId,
          callbackId: activity.callbackId,
          subjectDigest: activity.callbackSubjectDigest,
          resolution
        }, true);
        return view;
      }
      if (recovery.state === "RECONCILING") {
        try {
          const manifest = JSON.parse(
            await readFile(staging.manifestPath, "utf8")
          ) as {
            artifacts?: Array<{
              targetPath?: string;
              stagedPath?: string;
              expectedPreviousDigest?: string | null;
            }>;
          };
          const planTarget = safeRelativePath(this.workspaceRoot, this.planPath);
          const stagedPlan = manifest.artifacts?.find(
            (artifact) => artifact.targetPath === planTarget
          );
          const currentDigest = sha256(await readFile(this.planPath));
          const lease = runtime?.leases[staging.activityId];
          if (
            stagedPlan
            && typeof stagedPlan.expectedPreviousDigest === "string"
            && currentDigest === stagedPlan.expectedPreviousDigest
            && stagedPlan.stagedPath
            && !existsSync(stagedPlan.stagedPath)
            && lease
            && !lease.releasedAt
          ) {
            if (Date.parse(lease.expiresAt) > Date.now()) return view;
            const allActivityStaging = callbackStaging
              .filter((candidate) => candidate.activityId === staging.activityId)
              .map((candidate) => candidate.publishId);
            await this.runtime.reconcileExpiredActivity({
              activityId: staging.activityId,
              operationIds: [],
              stagingPublishIds: allActivityStaging,
              resolution: "confirmed_not_applied",
              evidenceDigest: currentDigest
            });
            return this.gate();
          }
        } catch {
          // Malformed or missing durable staging metadata is a real conflict.
        }
        if (activity.state !== "RECONCILING") {
          await this.markArtifactDrift({
            activityId: staging.activityId,
            artifactPath: this.planPath,
            detail: recovery.reason
          });
        }
        return this.gate();
      }
      const lease = runtime?.leases[staging.activityId];
      if (lease && !lease.releasedAt && Date.parse(lease.expiresAt) > Date.now()) {
        return view;
      }
      const manifest = JSON.parse(
        await readFile(staging.manifestPath, "utf8")
      ) as {
        artifacts?: Array<{ targetPath?: string; stagedPath?: string }>;
      };
      const planTarget = safeRelativePath(this.workspaceRoot, this.planPath);
      const stagedPlan = manifest.artifacts?.find(
        (artifact) => artifact.targetPath === planTarget
      );
      if (!stagedPlan?.stagedPath) {
        if (activity.state !== "RECONCILING") {
          await this.markArtifactDrift({
            activityId: staging.activityId,
            artifactPath: this.planPath,
            detail: "Prepared callback publication has no staged plan artifact."
          });
        }
        return this.gate();
      }
      const planContent = await readFile(stagedPlan.stagedPath);
      if (activity.state !== "RECONCILING") {
        await this.markArtifactDrift({
          activityId: staging.activityId,
          artifactPath: this.planPath,
          detail: "Prepared callback plan lost its worker before final rename."
        });
        view = await this.gate();
      }
      const allActivityStaging = callbackStaging
        .filter((candidate) => candidate.activityId === staging.activityId)
        .map((candidate) => candidate.publishId);
      await this.runtime.reconcileExpiredActivity({
        activityId: staging.activityId,
        operationIds: [],
        stagingPublishIds: allActivityStaging,
        resolution: "confirmed_not_applied",
        evidenceDigest: sha256(planContent)
      });
      const newHandle = await this.runtime.acquire(
        staging.activityId,
        "callback-plan-recovery"
      );
      const newPublishId = await this.nextFormalCallbackPublishId(
        activity.callbackId ?? staging.activityId,
        sha256(planContent)
      );
      await publisher.publish({
        publishId: newPublishId,
        activityId: staging.activityId,
        lease: newHandle,
        artifacts: [{
          targetPath: planTarget,
          content: planContent
        }]
      }, async (event) => {
        await this.recordArtifactPublishPrepared(event);
      });
      const resolution = formalUserDecisionResolution(
        planContent.toString("utf8"),
        staging.activityId,
        activity.callbackSubjectDigest ?? ""
      );
      if (!resolution || !activity.callbackId || !activity.callbackSubjectDigest) {
        throw new Error("Recovered callback plan has no matching formal decision.");
      }
      view = await this.resolveCallbackInternal({
        activityId: staging.activityId,
        callbackId: activity.callbackId,
        subjectDigest: activity.callbackSubjectDigest,
        resolution
      }, true);
      return view;
    }
    return view;
  }

  private async verifyPublishedOutputs(
    values: Array<{ path: string; digest: string }>
  ): Promise<Array<{ path: string; digest: string }>> {
    const normalized = values.map((item) => ({
      path: safeRelativePath(this.workspaceRoot, item.path),
      digest: requireDigest(item.digest, `digest for ${item.path}`)
    }));
    if (new Set(normalized.map((item) => item.path)).size !== normalized.length) {
      throw new Error("Published output paths must be unique.");
    }
    for (const output of normalized) {
      const actual = sha256(await readFile(resolve(this.workspaceRoot, output.path)));
      if (actual !== output.digest) {
        throw new Error(
          `Published output digest mismatch for ${output.path}; expected ${output.digest}, read ${actual}.`
        );
      }
    }
    return normalized;
  }

  private planConfirmationSubjectDigest(
    plan: string,
    schemaVersion: string
  ): string {
    if (schemaVersion === PLAN_CONFIRMATION_SUBJECT_SCHEMA_V1) {
      return sha256(planDecisionProjection(plan));
    }
    if (schemaVersion !== PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2) {
      throw new Error(
        `Unsupported plan confirmation subject schema ${schemaVersion}.`
      );
    }
    const projection = planDecisionProjectionV2(plan);
    const parsed = JSON.parse(projection) as {
      requestId?: unknown;
      businessScope?: { included?: unknown };
      testTypes?: unknown;
      targetEnvironment?: unknown;
    };
    const expectedType = this.requestId.split("/")[0] === "iot-chain"
      ? "iot_chain"
      : this.requestId.split("/")[0];
    if (
      parsed.requestId !== this.requestId.toLowerCase()
      || !Array.isArray(parsed.businessScope?.included)
      || parsed.businessScope.included.length === 0
      || !Array.isArray(parsed.testTypes)
      || !expectedType
      || !parsed.testTypes.includes(expectedType)
      || typeof parsed.targetEnvironment !== "string"
      || !parsed.targetEnvironment
    ) {
      throw new Error(
        "plan-confirmation-subject-v2 requires requestId, included top-level scope, test type, and target environment."
      );
    }
    return sha256(projection);
  }

  /**
   * Repairs only the known legacy false-positive confirmation drift. Every
   * durable and frozen input is re-verified before the pending callback is
   * superseded; an incomplete proof simply leaves the human wait unchanged.
   */
  private async tryCarryForwardLegacyPlanConfirmation(
    before: WorkflowGateView
  ): Promise<WorkflowGateView> {
    const activity = before.activities["plan-confirmation"];
    if (
      activity?.state !== "WAITING_CALLBACK"
      || !activity.callbackId
      || !activity.callbackSubjectDigest
      || activity.callbackSubjectSchemaVersion !== undefined
      || !before.checkpoint.safe
      || before.runningActivities.length > 0
      || Object.values(before.activities).some((candidate) =>
        candidate.unresolvedExternalOperationIds.length > 0
      )
    ) {
      return before;
    }

    try {
      const events = await this.events();
      const pending = [...events].reverse().find((event) =>
        event.type === "CallbackRequested"
        && event.payload.activityId === "plan-confirmation"
        && event.payload.callbackId === activity.callbackId
        && event.payload.subjectDigest === activity.callbackSubjectDigest
        && event.payload.subjectSchemaVersion === undefined
      );
      if (!pending) return before;

      const origin = [...events].reverse().find((event) =>
        event.seq < pending.seq
        && event.type === "CallbackResolved"
        && event.actorType === "user"
        && event.payload.activityId === "plan-confirmation"
        && event.payload.resolution === "accepted"
        && event.payload.subjectSchemaVersion === undefined
      );
      if (
        !origin
        || typeof origin.payload.callbackId !== "string"
        || typeof origin.payload.subjectDigest !== "string"
        || typeof origin.payload.planDigest !== "string"
      ) {
        return before;
      }
      requireDigest(origin.payload.subjectDigest, "origin subjectDigest");
      requireDigest(origin.payload.planDigest, "origin planDigest");
      const conflictingResolution = events.some((event) =>
        event.seq > origin.seq
        && event.seq < pending.seq
        && event.type === "CallbackResolved"
        && event.actorType === "user"
        && event.payload.activityId === "plan-confirmation"
      );
      if (conflictingResolution) return before;

      const currentPlan = await readFile(this.planPath);
      const currentPlanDigest = sha256(currentPlan);
      const planTarget = safeRelativePath(this.workspaceRoot, this.planPath);
      const evolution = [...events].reverse().find((event) => {
        if (
          event.seq <= origin.seq
          || event.seq >= pending.seq
          || event.type !== "ActivitySucceeded"
          || !["case-review-resolution", "case-review-evolution"]
            .includes(String(event.payload.activityId))
        ) {
          return false;
        }
        const outputs = event.payload.outputDigests;
        return Array.isArray(outputs) && outputs.some((value) =>
          Boolean(
            value
            && typeof value === "object"
            && !Array.isArray(value)
            && (value as Record<string, unknown>).path === planTarget
            && (value as Record<string, unknown>).digest === currentPlanDigest
          )
        );
      });
      if (!evolution) return before;
      const evolutionActivityId = String(evolution.payload.activityId);
      const evolutionDecision = evolutionActivityId === "case-review-resolution"
        ? evolution
        : [...events].reverse().find((event) =>
          event.seq > origin.seq
          && event.seq < evolution.seq
          && event.type === "ActivitySucceeded"
          && event.payload.activityId === "case-review-resolution"
        );
      if (
        !evolutionDecision
        || !["evolve", "plan_revision_required"].includes(
          String(evolutionDecision.payload.outcome)
        )
      ) {
        return before;
      }

      const reviewBatch = [...events].reverse().find((event) =>
        event.seq > origin.seq
        && event.seq < evolution.seq
        && event.type === "ReviewBatchStarted"
        && typeof event.payload.batchId === "string"
        && typeof event.payload.inputDigest === "string"
        && Array.isArray(event.payload.inputRefs)
        && event.payload.inputRefs.some((value) =>
          Boolean(
            value
            && typeof value === "object"
            && !Array.isArray(value)
            && (value as Record<string, unknown>).path === planTarget
            && (value as Record<string, unknown>).digest === origin.payload.planDigest
          )
        )
      );
      if (
        !reviewBatch
        || typeof reviewBatch.payload.batchId !== "string"
        || typeof reviewBatch.payload.inputDigest !== "string"
      ) {
        return before;
      }
      const reviewBatchId = reviewBatch.payload.batchId;
      const reviewInputDigest = requireDigest(
        reviewBatch.payload.inputDigest,
        "review inputDigest"
      );
      if (events.some((event) =>
        event.seq > reviewBatch.seq
        && event.seq < evolution.seq
        && event.type === "ReviewBatchInvalidated"
        && event.payload.batchId === reviewBatchId
      )) {
        return before;
      }
      const reviewIds = Object.values(before.activities)
        .filter((candidate) => candidate.definition.kind === "review")
        .map((candidate) => candidate.id);
      const coveredReviewActivityIds = new Set(
        reviewBatchCoveredActivityIds(events, reviewBatchId)
      );
      if (
        reviewIds.length === 0
        || reviewIds.some((activityId) =>
          !coveredReviewActivityIds.has(activityId)
        )
      ) {
        return before;
      }

      const snapshot = await this.reviewInputs.verify(reviewBatchId);
      if (snapshot.combinedDigest !== reviewInputDigest) return before;
      const frozenPlan = snapshot.artifacts.find((artifact) =>
        artifact.sourcePath === planTarget
      );
      if (!frozenPlan || frozenPlan.digest !== origin.payload.planDigest) {
        return before;
      }
      const originPlan = await readFile(frozenPlan.snapshotPath);
      if (sha256(originPlan) !== origin.payload.planDigest) return before;

      const originPlanText = originPlan.toString("utf8");
      const currentPlanText = currentPlan.toString("utf8");
      if (
        this.planConfirmationSubjectDigest(
          originPlanText,
          PLAN_CONFIRMATION_SUBJECT_SCHEMA_V1
        ) !== origin.payload.subjectDigest
        || this.planConfirmationSubjectDigest(
          currentPlanText,
          PLAN_CONFIRMATION_SUBJECT_SCHEMA_V1
        ) !== activity.callbackSubjectDigest
      ) {
        return before;
      }
      const originV2 = this.planConfirmationSubjectDigest(
        originPlanText,
        PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
      );
      const currentV2 = this.planConfirmationSubjectDigest(
        currentPlanText,
        PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
      );
      if (originV2 !== currentV2) return before;
      assertFormalUserDecision(
        currentPlanText,
        "plan-confirmation",
        origin.payload.subjectDigest,
        "accepted"
      );
      if (
        formalUserDecisionResolutions(
          currentPlanText,
          "plan-confirmation",
          activity.callbackSubjectDigest
        ).length > 0
      ) {
        return before;
      }

      const invalidation = [...events].reverse().find((event) =>
        event.seq > evolution.seq
        && event.seq < pending.seq
        && event.type === "ActivitiesInvalidated"
        && Array.isArray(event.payload.activityIds)
        && event.payload.activityIds.includes("plan-confirmation")
        && event.payload.subjectDigest === origin.payload.subjectDigest
      );
      if (!invalidation) return before;

      await this.append(
        "PlanConfirmationCarriedForward",
        "system",
        {
          activityId: "plan-confirmation",
          originCallbackId: origin.payload.callbackId,
          originSubjectDigest: origin.payload.subjectDigest,
          originSubjectSchemaVersion: PLAN_CONFIRMATION_SUBJECT_SCHEMA_V1,
          originPlanDigest: origin.payload.planDigest,
          supersededCallbackId: activity.callbackId,
          supersededSubjectDigest: activity.callbackSubjectDigest,
          currentPlanDigest,
          effectiveSubjectSchemaVersion: PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2,
          effectiveSubjectDigest: currentV2,
          reviewBatchId,
          reviewInputDigest,
          evolutionActivityId
        },
        `${before.runId}/plan-confirmation/carry-forward/${origin.payload.callbackId}/${activity.callbackId}/${currentV2}`,
        before.head
      );
      return this.gate();
    } catch {
      return before;
    }
  }

  private assertArtifactOutputBinding(
    kind: WorkflowProjection["activities"][string]["definition"]["kind"],
    metadata: WorkflowProjection["activities"][string]["definition"]["metadata"],
    outputPaths: string[],
    projection: WorkflowProjection
  ): void {
    const packagePaths = Object.values(projection.activities)
      .filter((activity) => activity.definition.kind === "case_generation")
      .map((activity) => {
        const packageName = activity.definition.metadata?.package;
        if (typeof packageName !== "string") {
          throw new Error(`Case activity ${activity.id} has no package binding.`);
        }
        return safeRelativePath(
          this.workspaceRoot,
          resolve(this.requestRoot, packageName)
        );
      });
    let expected: string[] | undefined;
    if (kind === "plan_validation" || kind === "review_resolution") {
      expected = [safeRelativePath(this.workspaceRoot, this.planPath)];
    } else if (kind === "case_generation") {
      const packageName = metadata?.package;
      if (typeof packageName !== "string") {
        throw new Error("Case generation is missing its package binding.");
      }
      expected = [
        safeRelativePath(this.workspaceRoot, resolve(this.requestRoot, packageName))
      ];
    } else if (kind === "relation_sync" || kind === "automatic_evolution") {
      expected = [
        safeRelativePath(this.workspaceRoot, this.planPath),
        ...packagePaths
      ];
    } else if (kind === "script_review" || kind === "readiness") {
      const artifact = metadata?.outputArtifact;
      if (typeof artifact !== "string" || artifact.includes("/") || artifact.includes("\\")) {
        throw new Error(`${kind} is missing its execution authorization output binding.`);
      }
      expected = [
        safeRelativePath(this.workspaceRoot, resolve(this.requestRoot, artifact))
      ];
    }
    if (!expected) return;
    const actual = [...outputPaths].sort();
    const required = [...expected].sort();
    if (
      actual.length !== required.length
      || actual.some((path, index) => path !== required[index])
    ) {
      throw new Error(
        `${kind} must publish exactly its owned artifacts: ${required.join(", ")}.`
      );
    }
  }

  private async assertReviewResolutionOwnership(
    artifacts: Array<{ targetPath: string; content: ArtifactContent }>
  ): Promise<void> {
    const planTarget = safeRelativePath(this.workspaceRoot, this.planPath);
    const candidate = artifacts.find((artifact) => artifact.targetPath === planTarget);
    if (!candidate) {
      throw new Error("review_resolution must publish the request plan.");
    }
    const candidateText = typeof candidate.content === "string"
      ? candidate.content
      : Buffer.from(candidate.content).toString("utf8");
    const events = await this.events();
    const batch = [...events].reverse().find((event) =>
      event.type === "ReviewBatchStarted"
      && typeof event.payload.batchId === "string"
      && typeof event.payload.inputDigest === "string"
      && !events.some((candidateEvent) =>
        candidateEvent.seq > event.seq
        && candidateEvent.type === "ReviewBatchInvalidated"
        && candidateEvent.payload.batchId === event.payload.batchId
      )
    );
    if (
      !batch
      || typeof batch.payload.batchId !== "string"
      || typeof batch.payload.inputDigest !== "string"
    ) {
      throw new Error("review_resolution requires an active immutable review batch.");
    }
    const snapshot = await this.reviewInputs.verify(batch.payload.batchId);
    if (snapshot.combinedDigest !== batch.payload.inputDigest) {
      throw new Error("review_resolution review input digest does not match history.");
    }
    const baselineArtifact = snapshot.artifacts.find((artifact) =>
      artifact.sourcePath === planTarget
    );
    if (!baselineArtifact) {
      throw new Error("review_resolution review batch has no frozen request plan.");
    }
    const baseline = await readFile(baselineArtifact.snapshotPath, "utf8");
    if (
      reviewResolutionFrozenProjection(candidateText)
      !== reviewResolutionFrozenProjection(baseline)
    ) {
      throw new Error(
        "review_resolution may change only the multi-role review and testcase review/evolution sections."
      );
    }
  }

  private async assertPlanBoundaryPublication(
    projection: WorkflowGateView,
    kind: "relation_sync" | "automatic_evolution",
    candidatePlan: string
  ): Promise<void> {
    const candidateSubject = this.planConfirmationSubjectDigest(
      candidatePlan,
      PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
    );
    const confirmation = projection.activities["plan-confirmation"];
    const acceptedSubject = confirmation?.callbackSubjectSchemaVersion
      === PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
      ? confirmation.callbackSubjectDigest
      : undefined;
    const baselineSubject = acceptedSubject ?? this.planConfirmationSubjectDigest(
      await readFile(this.planPath, "utf8"),
      PLAN_CONFIRMATION_SUBJECT_SCHEMA_V2
    );
    if (kind === "relation_sync" && candidateSubject !== baselineSubject) {
      throw new Error(
        "relation_sync may update derived relations but cannot change the accepted plan boundary."
      );
    }
    if (kind !== "automatic_evolution") return;
    const outcome = projection.activities["case-review-resolution"]?.outcome;
    const changed = candidateSubject !== baselineSubject;
    if (changed && outcome !== "plan_revision_required") {
      throw new Error(
        "automatic_evolution changed the plan boundary without an explicit plan_revision_required reviewer outcome."
      );
    }
    if (!changed && outcome === "plan_revision_required") {
      throw new Error(
        "plan_revision_required must publish a substantive top-level scope, environment, data-write, permission, or adjudication boundary change."
      );
    }
  }

  private async assertPreparedPublicationPolicy(
    projection: WorkflowGateView,
    activityId: string,
    publishId: string,
    manifestPath: string,
    expectedManifestDigest: string
  ): Promise<void> {
    const kind = projection.activities[activityId]?.definition.kind;
    if (
      kind !== "review_resolution"
      && kind !== "relation_sync"
      && kind !== "automatic_evolution"
    ) {
      return;
    }
    const manifestAbsolute = resolve(manifestPath);
    const runtimeRelative = relative(
      this.runtime.requestRoot,
      manifestAbsolute
    ).split(sep).join("/");
    if (
      !runtimeRelative
      || runtimeRelative === ".."
      || runtimeRelative.startsWith("../")
    ) {
      throw new Error("Prepared publication manifest escapes the request runtime.");
    }
    const manifest = JSON.parse(await readFile(manifestAbsolute, "utf8")) as {
      requestId?: unknown;
      publishId?: unknown;
      activityId?: unknown;
      manifestDigest?: unknown;
      artifacts?: unknown;
    };
    if (
      manifest.requestId !== this.requestId
      || manifest.publishId !== publishId
      || manifest.activityId !== activityId
      || manifest.manifestDigest !== expectedManifestDigest
      || !Array.isArray(manifest.artifacts)
    ) {
      throw new Error("Prepared publication manifest identity does not match runtime.");
    }
    const planTarget = safeRelativePath(this.workspaceRoot, this.planPath);
    const planArtifact = manifest.artifacts.find((value) =>
      Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && (value as Record<string, unknown>).targetPath === planTarget
      )
    ) as Record<string, unknown> | undefined;
    if (
      !planArtifact
      || typeof planArtifact.digest !== "string"
      || typeof planArtifact.stagedPath !== "string"
    ) {
      throw new Error(`${kind} prepared publication has no valid request plan.`);
    }
    const stagedPath = resolve(planArtifact.stagedPath);
    const publicationRelative = relative(
      dirname(manifestAbsolute),
      stagedPath
    ).split(sep).join("/");
    if (
      !publicationRelative
      || publicationRelative === ".."
      || publicationRelative.startsWith("../")
    ) {
      throw new Error("Prepared plan staging path escapes its publication.");
    }
    const candidate = existsSync(stagedPath)
      ? await readFile(stagedPath)
      : await readFile(this.planPath);
    if (sha256(candidate) !== planArtifact.digest) {
      throw new Error("Prepared plan content does not match its manifest digest.");
    }
    const candidateArtifact = [{
      targetPath: planTarget,
      content: candidate
    }];
    if (kind === "review_resolution") {
      await this.assertReviewResolutionOwnership(candidateArtifact);
    } else {
      await this.assertPlanBoundaryPublication(
        projection,
        kind,
        candidate.toString("utf8")
      );
    }
  }

  /** The relation activity may only close after its published request view is
   * already a strict, read-only relation projection. */
  private async assertRelationProjectionCurrent(): Promise<void> {
    const plan = await readFile(this.planPath, "utf8");
    const files = Object.fromEntries(await Promise.all((await readdir(this.requestRoot))
      .filter((name) => /^cases-[a-z0-9][a-z0-9-]*\.md$/.test(name))
      .map(async (name) => [name, await readFile(resolve(this.requestRoot, name), "utf8")] as const)));
    this.assertRelationProjection(plan, files);
  }

  private assertRelationProjection(plan: string, packages: Record<string, string>): void {
    if (!plan.includes(CASE_RELATION_PROJECTION_MARKER)) {
      throw new Error("Relationship synchronization requires CASE_RELATION_PROJECTION_MARKER for v4 requests.");
    }
    const projection = projectRelationProjection(plan, packages);
    const drifted = projection.plan !== plan
      || Object.entries(packages).some(([name, content]) => projection.packages[name] !== content);
    const issues = [...projection.issues, ...validateRuleDesignMatrix(plan)];
    if (drifted || issues.length) {
      throw new Error(
        `Relationship synchronization is not current: ${[...issues.map((issue) => issue.detail), ...(drifted ? ["派生关系视图未同步。"] : [])].join(" ")}`
      );
    }
  }

  /** Validate the exact would-be publication in an isolated staging request.
   * The relation checker remains read-only and no final testcase file is
   * modified until this succeeds. */
  private async assertStagedRelationProjectionCurrent(
    artifacts: Array<{ targetPath: string; content: ArtifactContent }>
  ): Promise<void> {
    const files: Record<string, string> = {};
    let plan: string | undefined;
    for (const artifact of artifacts) {
      const filename = basename(artifact.targetPath);
      const content = Buffer.from(artifact.content).toString("utf8");
      if (filename === "plan.md") plan = content;
      else if (/^cases-[a-z0-9][a-z0-9-]*\.md$/.test(filename)) files[filename] = content;
      else throw new Error(`Relation validation received an unexpected artifact: ${artifact.targetPath}`);
    }
    if (!plan) throw new Error("Relationship synchronization must stage plan.md.");
    this.assertRelationProjection(plan, files);
  }

  private async buildCompletenessEvidence(
    projection: WorkflowProjection
  ): Promise<SafeJsonValue> {
    const events = await this.events();
    const caseActivities = Object.values(projection.activities)
      .filter((activity) => activity.definition.kind === "case_generation");
    if (!caseActivities.length) {
      throw new Error("Completeness validation requires at least one case package.");
    }
    const expectedPackagePaths = new Map<string, string>();
    for (const activity of caseActivities) {
      if (activity.state !== "SUCCEEDED") {
        throw new Error(`Case package activity ${activity.id} is not complete.`);
      }
      const packageName = activity.definition.metadata?.package;
      if (typeof packageName !== "string" || !/^cases-[a-z0-9][a-z0-9-]*\.md$/.test(packageName)) {
        throw new Error(`Case package ${activity.id} has an invalid package filename.`);
      }
      const expectedPath = safeRelativePath(
        this.workspaceRoot,
        resolve(this.requestRoot, packageName)
      );
      expectedPackagePaths.set(activity.id, expectedPath);
      const succeeded = [...events].reverse().find((event) =>
        event.type === "ActivitySucceeded"
        && event.payload.activityId === activity.id
      );
      if (!succeeded) throw new Error(`Case package ${activity.id} has no success evidence.`);
      const rawDigests = succeeded.payload.outputDigests;
      if (!Array.isArray(rawDigests) || rawDigests.length !== 1) {
        throw new Error(`Case package ${activity.id} has no output digest evidence.`);
      }
      const recorded = rawDigests.map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error(`Case package ${activity.id} has malformed output digest evidence.`);
        }
        const record = raw as Record<string, SafeJsonValue>;
        if (typeof record.path !== "string" || typeof record.digest !== "string") {
          throw new Error(`Case package ${activity.id} has malformed output digest evidence.`);
        }
        return {
          path: safeRelativePath(this.workspaceRoot, record.path),
          digest: requireDigest(record.digest, `digest for ${record.path}`)
        };
      });
      if (recorded[0]!.path !== expectedPath) {
        throw new Error(
          `Case package ${activity.id} must publish exactly ${expectedPath}.`
        );
      }
    }
    const relation = projection.activities["relation-sync"];
    if (!relation || relation.state !== "SUCCEEDED") {
      throw new Error("Relationship synchronization must succeed before completeness validation.");
    }
    const relationSuccess = [...events].reverse().find((event) =>
      event.type === "ActivitySucceeded"
      && event.payload.activityId === relation.id
    );
    const relationRawDigests = relationSuccess?.payload.outputDigests;
    if (!Array.isArray(relationRawDigests) || relationRawDigests.length === 0) {
      throw new Error("Relationship synchronization has no artifact digest evidence.");
    }
    const relationOutputs = await this.verifyPublishedOutputs(relationRawDigests.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Relationship synchronization has malformed artifact evidence.");
      }
      const record = raw as Record<string, SafeJsonValue>;
      if (typeof record.path !== "string" || typeof record.digest !== "string") {
        throw new Error("Relationship synchronization has malformed artifact evidence.");
      }
      return { path: record.path, digest: record.digest };
    }));
    const expectedRelationPaths = [
      safeRelativePath(this.workspaceRoot, this.planPath),
      ...expectedPackagePaths.values()
    ].sort();
    const actualRelationPaths = relationOutputs.map((output) => output.path).sort();
    if (
      actualRelationPaths.length !== expectedRelationPaths.length
      || actualRelationPaths.some((path, index) => path !== expectedRelationPaths[index])
    ) {
      throw new Error(
        `Relationship synchronization must publish plan.md and every declared case package: ${expectedRelationPaths.join(", ")}.`
      );
    }
    const currentDigestByPath = new Map(
      relationOutputs.map((output) => [output.path, output.digest])
    );
    const packages: SafeJsonValue[] = [];
    for (const activity of caseActivities) {
      const path = expectedPackagePaths.get(activity.id)!;
      const result = await evaluateTestcasePackageFiles([
        resolve(this.workspaceRoot, path)
      ]);
      if (!result.complete) {
        throw new Error(
          `Case package ${activity.id} is incomplete: ${result.reasons.join(" ")}`
        );
      }
      packages.push({
        activityId: activity.id,
        path,
        digest: currentDigestByPath.get(path)!,
        expectedCount: result.expectedCount,
        actualBodyCount: result.actualBodyCount,
        uniqueCaseIdCount: result.uniqueCaseIdCount,
        complete: true
      });
    }
    return {
      complete: true,
      packages,
      relationOutputs
    };
  }

  private async append(
    type: WorkflowEventType,
    actorType: WorkflowActorType,
    payload: SafeEventPayload,
    idempotencyKey: string,
    expectedHead: WorkflowHistoryHead,
    causationId?: string
  ): Promise<WorkflowEvent> {
    const events = await this.events();
    const identity = eventIdentity(events);
    if (identity.definitionVersion !== "v5") {
      throw new Error("Legacy workflow histories are replay-only and cannot accept new events.");
    }
    const input: NewWorkflowEvent = {
      ...identity,
      type,
      actorType,
      idempotencyKey,
      payload,
      ...(causationId ? { causationId } : {})
    };
    return this.history.append(input, expectedHead);
  }

  private async appendSequence(
    drafts: readonly WorkflowEventDraft[],
    expectedHead: WorkflowHistoryHead
  ): Promise<WorkflowEvent[]> {
    if (!drafts.length) throw new Error("Workflow event sequence must not be empty.");
    const identity = eventIdentity(await this.events());
    if (identity.definitionVersion !== "v5") {
      throw new Error("Legacy workflow histories are replay-only and cannot accept new events.");
    }
    let previousEventId: string | undefined;
    const inputs: NewWorkflowEvent[] = drafts.map((draft) => {
      const eventId = `evt-${sha256(`${identity.runId}/${draft.idempotencyKey}`).slice(0, 40)}`;
      const event: NewWorkflowEvent = {
        ...identity,
        eventId,
        type: draft.type,
        actorType: draft.actorType,
        idempotencyKey: draft.idempotencyKey,
        payload: draft.payload,
        ...(draft.causationId || previousEventId
          ? { causationId: draft.causationId ?? previousEventId }
          : {})
      };
      previousEventId = eventId;
      return event;
    });
    return this.history.appendBatch(inputs, expectedHead);
  }

  private async currentLease(activityId: string): Promise<RuntimeLeaseHandle | null> {
    const runtime = await this.runtime.read();
    const record = runtime?.leases[activityId];
    if (!record || record.releasedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
    return {
      requestId: this.requestId,
      activityId,
      owner: record.owner,
      leaseId: record.leaseId,
      fencingToken: record.fencingToken,
      expiresAt: record.expiresAt
    };
  }

  private async handleForClaim(activityId: string, claimToken: string): Promise<RuntimeLeaseHandle> {
    const runtime = await this.runtime.read();
    const record = runtime?.leases[activityId];
    if (!record || record.leaseId !== claimToken) {
      throw new WorkflowRuntimeLeaseError(`Activity ${activityId} requires the current claim token.`);
    }
    return {
      requestId: this.requestId,
      activityId,
      owner: record.owner,
      leaseId: record.leaseId,
      fencingToken: record.fencingToken,
      expiresAt: record.expiresAt
    };
  }

  private async releaseBestEffort(handle: RuntimeLeaseHandle): Promise<void> {
    try {
      await this.runtime.release(handle);
    } catch (error) {
      if (!(error instanceof WorkflowRuntimeLeaseError)) throw error;
    }
  }

}

function formalPreparedArtifactDigests(
  payload: SafeEventPayload
): Array<{ targetPath: string; digest: string }> {
  if (!Array.isArray(payload.artifacts)) {
    throw new Error("Formal report publication intent has no artifact list.");
  }
  return payload.artifacts.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Formal report publication intent contains an invalid artifact.");
    }
    const artifact = raw as Record<string, SafeJsonValue>;
    if (
      typeof artifact.targetPath !== "string"
      || typeof artifact.digest !== "string"
      || !/^[a-f0-9]{64}$/u.test(artifact.digest)
    ) {
      throw new Error("Formal report publication intent contains an invalid path or digest.");
    }
    return { targetPath: artifact.targetPath, digest: artifact.digest };
  }).sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}

function sameArtifactDigests(
  expected: Array<{ targetPath: string; digest: string }>,
  actual: Array<{ targetPath: string; digest: string }>
): boolean {
  const normalizedActual = [...actual].sort((left, right) =>
    left.targetPath.localeCompare(right.targetPath)
  );
  return expected.length === normalizedActual.length
    && expected.every((item, index) =>
      item.targetPath === normalizedActual[index]?.targetPath
      && item.digest === normalizedActual[index]?.digest
    );
}

export function workflowStatusText(view: WorkflowGateView): string {
  const labels = {
    planning: "计划",
    cases: "用例",
    review: "评审",
    engineering: "脚本",
    execution: "执行",
    reporting: "报告"
  } as const;
  const statuses = {
    not_started: "未开始",
    active: "进行中",
    waiting: "等待",
    succeeded: "完成",
    failed: "失败"
  } as const;
  const phases = projectSimplifiedPhases(view);
  const current = phases.find((phase) =>
    phase.status === "waiting" || phase.status === "active"
  ) ?? [...phases].reverse().find((phase) =>
    phase.status === "failed" || phase.status === "succeeded"
  );
  return [
    `请求：${view.requestId}`,
    `阶段：${phases.map((phase) =>
      `${labels[phase.id]}=${statuses[phase.status]}`
    ).join("、")}`,
    `当前：${current ? `${labels[current.id]} / ${statuses[current.status]}` : "未开始"}`,
    ...(current?.waiting
      ? [
          `等待原因：${current.waiting.reason}`,
          ...(current.waiting.reference
            ? [`等待引用：${current.waiting.reference}`]
            : [])
        ]
      : []),
    `下一步：${view.continuation.kind} / ${view.continuation.reason}`,
    `回复门禁：${view.reply.kind} / ${view.reply.allowed ? "允许" : "不允许"} / ${view.reply.reason}`
  ].join("\n");
}

export function defaultCaseGenerationActivity(view: WorkflowProjection): string | undefined {
  return Object.values(view.activities)
    .find((activity) => activity.definition.kind === "case_generation")?.id;
}

export function packageActivityId(path: string): string {
  const segment = basename(path)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `case-generation-${segment}`;
}
