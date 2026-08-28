import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  activitiesExpandedPayload,
  addCurrentReadinessPreflight,
  buildReusableWorkflowDefinition,
  buildCandidateExtension,
  buildWorkflowDefinition,
  workflowGraphDigest,
  workflowStartedPayload
} from "./definition.js";
import { CURRENT_WORKFLOW_VERSION, isCurrentWorkflowVersion } from "./currentVersion.js";
import {
  assembleCandidateDelta,
  assembleCandidateFragments,
  candidateFragmentManifestDigest,
  parseCandidateFragmentManifest,
  validateCandidateFragmentContent
} from "./candidateFragments.js";
import {
  candidateCompilerManifest,
  candidateCompilerSpecDigest,
  mergeCandidateCompilerFragment,
  parseCandidateCompilerSpec,
  renderDeterministicCandidateFragment,
  validateCandidateCompilerSpecAgainstPlan
} from "./candidateCompiler.js";
import { canonicalJson } from "./canonicalJson.js";
import { ActivityLeaseKeepalive } from "./activityLeaseKeepalive.js";
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
  isCasesPackageName,
  candidateScriptsDirectoryPath,
  readSuiteBinding,
  resolveRunRoot,
  RunRootMode,
  suiteDirectoryPath,
  writeSuiteBinding
} from "./runRoots.js";
import {
  RUN_INTENT_SCHEMA_VERSION,
  readRunIntent,
  runIntentDigest,
  runIntentPath,
  writeRunIntent,
  type RunIntent
} from "./runIntent.js";
import {
  buildImpactClosure,
  designDeltaDigest,
  impactClosureDigest,
  parseDesignDelta,
  type ImpactClosure
} from "./impactClosure.js";
import { atomicWriteText } from "../test-data/ledgerStore.js";
import {
  buildTestcaseReviewExport,
  buildTestcaseReviewModel,
  type TestcaseReviewExport
} from "../testcase/testcaseReviewModel.js";
import { resolveReviewSpeed, type ReviewSpeed } from "./speedProfile.js";
import {
  assertFormalDecisionAppendOnly,
  assertFormalUserDecision,
  assertRecordedFormalUserDecision,
  applyCallbackDriftProjection,
  callbackDecisionIsCurrent,
  CASE_CONFIRMATION_SUBJECT_SCHEMA_VERSION,
  caseConfirmationPlanProjection,
  caseConfirmationSemanticCases,
  selectCaseConfirmationSemanticCases,
  caseDecisionPlanProjection,
  casePackageDecisionProjection,
  decisionTypeForActivity,
  dependentActivityIds,
  formalUserDecisionResolution,
  formalUserDecisionResolutions,
  isFormalCallbackActivity,
  PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION,
  planDecisionProjection,
  planConfirmationSubjectProjection,
  planWithoutFormalDecisions
} from "./callbackDecision.js";
import {
  latestReviewerDispatch,
  latestReviewerSubmission,
  prepareReviewLifecycleEvent,
  referencedControlledSources,
  referencedRequestLocalSources,
  reviewBatchActivityIds,
  reviewBatchCoveredActivityIds,
  reviewBatchInvalidationInputDigest,
  reviewBatchStarted,
  reviewFindingsDigest,
  reviewRevisionDigest,
  REVIEWER_ISOLATION_PROOF_VERSION,
  ReviewInputDriftError,
  assertReviewerFindingsShape,
  reviewerBindingId,
  deterministicReviewerTaskId,
  rotatedReviewBatchId,
  verifyOrRepairReviewSnapshot,
  type ReviewerConclusion
} from "./reviewLifecycle.js";
import {
  buildCompleteReviewBatchScope,
  parseReviewBatchScope,
  reviewBatchScopeDigest,
  type ReusedReviewerEvidence,
  type ReviewBatchScope,
  hasCompleteReviewBatchScope
} from "./reviewBatchScope.js";
import { assessCaseReviewRisk } from "./caseReviewRisk.js";
import { routeSemanticReview } from "./reviewSemanticRouting.js";
import { evaluateReviewReadiness } from "./reviewReadiness.js";
import {
  evaluateCandidateGate,
  type CandidateGateReport
} from "./candidateGate.js";
import {
  evaluateCandidatePlanPreflight,
  candidateRepairChecklist,
  parseCandidatePlanSourceLinks,
  type CandidateSourceDocument,
  type CandidatePlanPreflightReport
} from "./candidatePreflight.js";
import { projectCurrentUserPhases, projectSimplifiedPhases } from "./simplifiedPhase.js";
import {
  planResumeRecovery,
  reviewerIdleRebindAction,
  reviewerRebindAction
} from "./resumeRecovery.js";
import {
  CASE_RELATION_PROJECTION_MARKER_V1,
  markdownSection,
  markdownTableRows,
  projectRelationProjection,
  validateRuleDesignMatrix
} from "../testcase/relationProjection.js";
import { CURRENT_RULE_LEDGER_MARKER } from "../testcase/relationContract.js";
import {
  isCurrentTestcaseDocumentVersion,
  parseTestcaseDocument,
  validateTestcaseV6Layered
} from "../testcase/testcaseDocument.js";
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
  WorkflowDeliveryTarget,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowHistoryHead,
  WorkflowProjection
} from "./types.js";
import { isDeterministicReviewMode, isRiskAdaptiveReviewMode } from "./types.js";
import {
  assessStableTestSuite,
  loadStableTestSuite,
  materializeAffectedSuiteWorkspace,
  type StableTestSuiteProfile,
  type TestSuiteReuseAssessment
} from "../test-suite/stableSuite.js";
import {
  loadStableDesignSuite,
  materializeAffectedDesignSuiteWorkspace,
  parseRuleLedger,
  readStableSuiteTier,
  type StableDesignSuiteManifest
} from "../test-suite/designSuite.js";

const execFile = promisify(execFileCallback);

const policyAutoNoWriteOperations = new Set([
  "authenticate_test_account",
  "query_postcondition"
]);

export function isPolicyAutoNoWriteSubject(
  raw: Record<string, unknown>,
  adaptive: boolean
): boolean {
  if (!adaptive) {
    return raw.schemaVersion === "execution-authorization-v1"
      && raw.mode === "stable_suite"
      && raw.authorizationMode === "policy_auto_no_write"
      && raw.dataWritePolicy === "no_write"
      && Array.isArray(raw.caseScopes)
      && raw.caseScopes.every((scope) =>
        scope !== null
        && typeof scope === "object"
        && (scope as Record<string, unknown>).dataWritePolicy === "no_write"
      );
  }
  if (raw.schemaVersion !== "execution-authorization-v1"
    || raw.mode !== "request"
    || !["test", "pre"].includes(String(raw.environment).toLowerCase())
    || raw.dataWritePolicy !== "no_write"
    || !Array.isArray(raw.allowedOperations)
    || raw.allowedOperations.length === 0
    || raw.allowedOperations.some((operation) =>
      typeof operation !== "string" || !policyAutoNoWriteOperations.has(operation)
    )
    || !Array.isArray(raw.caseScopes)
    || raw.caseScopes.length === 0
    || !Array.isArray(raw.deferredCases)
    || raw.deferredCases.length > 0
    || !Array.isArray(raw.capabilityEvidence)
    || raw.capabilityEvidence.some((item) =>
      !item || typeof item !== "object" || (item as Record<string, unknown>).available !== true
    )
    || (Array.isArray(raw.externalTransitions) && raw.externalTransitions.length > 0)
    || !Array.isArray(raw.resourceBudgets)
    || raw.resourceBudgets.some((item) =>
      !item || typeof item !== "object" || (item as Record<string, unknown>).maxCreates !== 0
    )) {
    return false;
  }
  return raw.caseScopes.every((scope) => {
    if (!scope || typeof scope !== "object") return false;
    const record = scope as Record<string, unknown>;
    return record.dataWritePolicy === "no_write"
      && record.permissionProfile === "read_only"
      && Array.isArray(record.requiredOperations)
      && record.requiredOperations.every((operation) =>
        typeof operation === "string" && policyAutoNoWriteOperations.has(operation)
      )
      && Array.isArray(record.producesResources)
      && record.producesResources.length === 0;
  });
}

export interface WorkflowGateView extends WorkflowProjection {
  schemaVersion: "workflow-gate-v1";
  selectorRepairSubstate?:
    | "incident_recorded"
    | "script_repair"
    | "reauthorization_required";
  checkpoint: {
    safe: boolean;
    reason: string;
  };
  reviewerEpoch?: {
    batchId: string;
    semanticEvolutionCycle: number;
    remainingSemanticRereviews: number;
    reusedRoles: string[];
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
  const terminal = ["SUCCEEDED", "CANCELLED"].includes(
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
  deliveryTarget?: WorkflowDeliveryTarget;
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
  suiteId?: string;
  reuse?: "auto";
  environment?: string;
  profile?: StableTestSuiteProfile;
  /** New, controlled requirement sources for a reuse assessment. */
  additionalSourcePaths?: string[];
  /** Review speed cap persisted on WorkflowStarted; default: testcase_only + no writes → fast. */
  speed?: ReviewSpeed;
  fragmented?: boolean;
}

export interface DurableWorkflowManagerOptions {
  /** Per-run state belongs to the local request archive. */
  runRootMode?: RunRootMode;
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

export interface CandidatePreflightResult {
  report: CandidatePlanPreflightReport;
  projection: WorkflowGateView;
}

export interface ActivityFailInput {
  claimToken: string;
  summary: string;
  /** Explicitly schedule a safe automatic retry. Public CLI defaults to false. */
  scheduleRetry?: boolean;
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
  if (plan.includes("rule-design-ledger-v1")) return ["cases.md"];
  const fromTable = [...plan.matchAll(/^\|\s*`(cases-[a-z0-9][a-z0-9-]*\.md)`\s*\|/gm)]
    .map((match) => match[1]!);
  return [...new Set(fromTable)];
}

function reusableDefinitionAssessment(assessment: TestSuiteReuseAssessment) {
  return {
    schemaVersion: assessment.schemaVersion,
    suiteId: assessment.suiteId,
    ...(assessment.suiteVersion ? { suiteVersion: assessment.suiteVersion } : {}),
    assessmentDigest: assessment.assessmentDigest,
    decision: assessment.decision,
    requestedProfile: assessment.requestedProfile,
    effectiveProfile: assessment.effectiveProfile,
    selectedCaseIds: assessment.selectedCaseIds,
    affectedCaseIds: assessment.affectedCaseIds,
    reasons: assessment.reasons
  };
}

function safeRelativePath(workspaceRoot: string, path: string): string {
  const absolute = resolve(workspaceRoot, path);
  const rel = relative(workspaceRoot, absolute).split(sep).join("/");
  if (!rel || rel.startsWith("../") || rel === "..") {
    throw new Error(`Artifact path must stay inside the workspace: ${path}`);
  }
  const rootSegment = rel.split("/", 1)[0] ?? "";
  if (
    (
      rootSegment.startsWith(".")
      // The local run archive is a legitimate workflow output target for
      // run-scoped plan.md publications under the suite model.
      && !rel.startsWith(".local/test-runs/")
    )
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

/** Runtime packet locations are durable audit references, not publishable
 * artifacts. Keep the exception narrow so history cannot point elsewhere. */
function safeRuntimePacketReference(workspaceRoot: string, path: string): string {
  const absolute = resolve(workspaceRoot, path);
  const rel = relative(workspaceRoot, absolute).split(sep).join("/");
  if (!rel.startsWith(".local/test-task-runtime/") || rel.includes("../")) {
    throw new Error(`Reviewer packet path must stay in disposable runtime: ${path}`);
  }
  return rel;
}

const reviewResolutionOwnedSections = new Set([
  "评审记录",
  "多角色评审记录",
  "评审与正式决定",
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
  readonly runRootMode: RunRootMode;
  private suiteRootValue: string | undefined;
  readonly planPath: string;
  readonly historyPath: string;
  readonly history: WorkflowHistoryStore;
  readonly runtime: RuntimeLeaseStore;
  readonly reviewInputs: ReviewInputSnapshotStore;
  private readonly callbackPublicationHandles = new Map<string, RuntimeLeaseHandle>();

  get suiteRoot(): string | undefined {
    return this.suiteRootValue;
  }

  constructor(
    requestId: string,
    workspaceRoot = process.cwd(),
    options: DurableWorkflowManagerOptions = {}
  ) {
    if (!requestPattern.test(requestId)) {
      throw new Error("requestId must be a relative slash-separated test request identifier.");
    }
    this.requestId = requestId;
    this.workspaceRoot = resolve(workspaceRoot);
    const runRoot = resolveRunRoot(
      this.workspaceRoot,
      requestId,
      options.runRootMode
    );
    this.requestRoot = runRoot.root;
    this.runRootMode = runRoot.mode;
    const binding = readSuiteBinding(this.requestRoot);
    this.suiteRootValue = binding
      ? suiteDirectoryPath(this.workspaceRoot, binding.suiteId)
      : undefined;
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
      runtimeStore: this.runtime,
      runRoot: this.requestRoot,
      suiteRoot: this.suiteRoot
    });
  }

  /** Design assets bound to a suite live in the suite directory; request-scoped packages live in the run root. */
  designAssetPath(packageName: string): string {
    if (this.suiteRoot && isCasesPackageName(packageName)) {
      return resolve(this.suiteRoot, packageName);
    }
    return resolve(this.requestRoot, packageName);
  }

  /**
   * Reuse runs deliberately do not materialize a request plan. Their stable
   * design remains the review subject, while run-intent.json binds the
   * resulting review receipt to this particular request.
   */
  reviewEvidencePath(): string {
    return existsSync(this.planPath) ? this.planPath : runIntentPath(this.requestRoot);
  }

  private reviewDesignPath(): string {
    return existsSync(this.planPath)
      ? this.planPath
      : this.suiteRoot
        ? resolve(this.suiteRoot, "design.md")
        : this.planPath;
  }

  exists(): boolean {
    return existsSync(this.historyPath);
  }

  /** Review speed is frozen in request-policy-v1 with the workflow graph. */
  async reviewSpeed(): Promise<ReviewSpeed> {
    const value = (await this.gate()).requestPolicy.reviewSpeed;
    return value === "fast" || value === "balanced" ? value : "strict";
  }

  private async deriveRunIntent(input: {
    assessment: ReturnType<typeof reusableDefinitionAssessment>;
    environment: string;
    deliveryTarget: WorkflowDeliveryTarget;
    stableSuite?: Awaited<ReturnType<typeof loadStableTestSuite>>;
    designSuite?: StableDesignSuiteManifest;
    writesData: boolean;
  }): Promise<RunIntent> {
    const suiteRefs = input.stableSuite
      ? [
          input.stableSuite.plan.path,
          ...input.stableSuite.casePackages.map((item) => item.path),
          ...input.stableSuite.buildContracts.map((item) => item.path)
        ]
      : input.designSuite
        ? [
            input.designSuite.designLedger.path,
            ...input.designSuite.casePackages.map((item) => item.path),
            ...input.designSuite.sourceRegistry.flatMap((item) => item.sourcePaths)
          ]
        : [];
    const safeRefs = [...new Set(suiteRefs.map((path) => {
      const safe = relative(this.workspaceRoot, resolve(this.workspaceRoot, path));
      if (!safe || safe.startsWith(`..${sep}`) || safe === ".." || safe.includes("\0")) {
        throw new Error("Run intent references must stay inside the workspace.");
      }
      return safe.split(sep).join("/");
    }))]
      .sort();
    const sourceDigest = sha256(canonicalJson({
      suiteVersion: input.assessment.suiteVersion ?? "",
      refs: safeRefs,
      ...(input.designSuite ? { sourceRegistry: input.designSuite.sourceRegistry.map((item) => ({ id: item.sourceId, digest: item.digest })) } : {})
    }));
    const boundaryDigest = sha256(canonicalJson({
      environment: input.environment,
      deliveryTarget: input.deliveryTarget,
      writesData: input.writesData,
      allowedEnvironments: input.stableSuite?.allowedEnvironments ?? input.designSuite?.allowedEnvironments ?? []
    }));
    return {
      schemaVersion: RUN_INTENT_SCHEMA_VERSION,
      suiteId: input.assessment.suiteId,
      ...(input.assessment.suiteVersion ? { suiteVersion: input.assessment.suiteVersion } : {}),
      reuseDecision: input.assessment.decision,
      assessmentDigest: input.assessment.assessmentDigest,
      environment: input.environment,
      deliveryTarget: input.deliveryTarget,
      selectedCaseIds: [...input.assessment.selectedCaseIds].sort(),
      affectedCaseIds: [...input.assessment.affectedCaseIds].sort(),
      sourceDigest,
      boundaryDigest,
      safeRefs
    };
  }

  private async designSuiteWritesData(
    suite: StableDesignSuiteManifest,
    selectedCaseIds: string[]
  ): Promise<boolean> {
    const selected = new Set(selectedCaseIds);
    if (!selected.size) return true;
    const found = new Set<string>();
    for (const identity of suite.casePackages) {
      const document = parseTestcaseDocument(await readFile(resolve(this.workspaceRoot, identity.path), "utf8"));
      if (!isCurrentTestcaseDocumentVersion(document.version)) return true;
      for (const testcase of document.cases) {
        if (!selected.has(testcase.caseId)) continue;
        found.add(testcase.caseId);
        const policy = testcase.overrides.dataStrategy ?? document.defaults.dataStrategy;
        if (policy !== "no_write") return true;
      }
    }
    return found.size !== selected.size;
  }

  async initialize(input: InitializeWorkflowInput = {}): Promise<WorkflowGateView> {
    if (this.exists()) {
      if (input.sessionId) await this.runtime.bindSession(input.sessionId, input.targetThreadId);
      return this.gate();
    }
    const reuseAssessment = input.reuse === "auto" && input.suiteId
      ? await assessStableTestSuite({
          suiteId: input.suiteId,
          environment: input.environment ?? "test",
          profile: input.profile,
          additionalSourcePaths: input.additionalSourcePaths,
          workspaceRoot: this.workspaceRoot
        })
      : undefined;
    // Tier-aware suite loading: execution-tier manifests feed direct and
    // affected chains. A design-tier source drift takes the same targeted
    // branch, but first copies its case packages into the request archive so
    // the stable Git asset remains read-only until an explicit promotion.
    // A design-tier suite remains the baseline for a full rebuild even when
    // it has no executable script version yet.  The reuse assessment omits a
    // suiteVersion for that case, but losing the design suite here leaves the
    // reusable workflow without its declared cases.md package.
    const reuseActive = input.reuse === "auto"
      && Boolean(input.suiteId)
      && Boolean(reuseAssessment);
    const suiteTier = reuseActive && input.suiteId
      ? readStableSuiteTier(input.suiteId, this.workspaceRoot)
      : undefined;
    const stableSuite = reuseActive && suiteTier !== "design"
      ? await loadStableTestSuite(input.suiteId!, this.workspaceRoot)
      : undefined;
    let designSuite: StableDesignSuiteManifest | undefined;
    let designAffectedWorkspace: { casePackagePaths: string[] } | undefined;
    if (reuseActive && suiteTier === "design") {
      designSuite = await loadStableDesignSuite(input.suiteId!, this.workspaceRoot);
      if (reuseAssessment!.decision === "affected_rebuild") {
        designAffectedWorkspace = await materializeAffectedDesignSuiteWorkspace({
          suiteId: designSuite.suiteId,
          runRequestId: this.requestId,
          workspaceRoot: this.workspaceRoot
        });
      }
    }
    const affectedWorkspace = stableSuite && reuseAssessment?.decision === "affected_rebuild"
      ? await materializeAffectedSuiteWorkspace({
          suiteId: stableSuite.suiteId,
          runRequestId: this.requestId,
          workspaceRoot: this.workspaceRoot
        })
      : undefined;
    const zeroModelReuse = reuseAssessment !== undefined
      && ["direct_execute", "design_reconfirm"].includes(reuseAssessment.decision);
    const reusableRoute = reuseAssessment !== undefined
      && ["direct_execute", "design_reconfirm", "affected_rebuild", "full_replan"].includes(reuseAssessment.decision);
    const inheritedCasePackages = input.casePackages
      ?? (stableSuite
        ? stableSuite.casePackages.map((item) => basename(item.path))
        : designSuite
          ? designSuite.casePackages.map((item) => basename(item.path))
          : undefined);
    const fullReplan = reuseAssessment?.decision === "full_replan";
    const generatedStagingPlanPath = resolve(this.requestRoot, "staging", "candidate-plan.md");
    if (fullReplan && !input.planPath && !existsSync(generatedStagingPlanPath)) {
      const sourcePaths = input.additionalSourcePaths?.length
        ? input.additionalSourcePaths
        : designSuite?.sourceRegistry.flatMap((source) => source.sourcePaths) ?? [];
      await atomicWriteText(generatedStagingPlanPath, [
        "# Candidate plan staging",
        "",
        "schemaVersion: candidate-plan-staging-v1",
        `requestId: ${this.requestId}`,
        `suiteId: ${input.suiteId ?? "unbound"}`,
        `environment: ${input.environment ?? "test"}`,
        `casePackages: ${(inheritedCasePackages ?? ["cases.md"]).join(", ")}`,
        `sourcePaths: ${sourcePaths.join(", ") || "none"}`,
        "",
        "This bootstrap file contains no business facts and cannot be published as plan.md."
      ].join("\n") + "\n");
    }
    const planPath = zeroModelReuse
      ? undefined
      : resolve(input.planPath
      ?? (reuseAssessment?.decision === "direct_execute" && stableSuite
        ? resolve(this.workspaceRoot, stableSuite.plan.path)
        : affectedWorkspace
          ? resolve(this.workspaceRoot, affectedWorkspace.planPath)
          : fullReplan && !input.planPath
            ? generatedStagingPlanPath
          : this.planPath));
    if (planPath && !existsSync(planPath) && reuseAssessment?.decision !== "affected_rebuild") {
      throw new Error(`Workflow initialization requires plan.md: ${planPath}`);
    }
    if (input.suiteId && !designAffectedWorkspace) {
      // Persist the run→suite binding before any workflow event exists so
      // every direct/reconfirm command resolves design assets from the suite
      // directory. Affected design rebuilds use their request-local copy.
      const boundSuiteRoot = suiteDirectoryPath(this.workspaceRoot, input.suiteId);
      if (this.runRootMode === "local-test-runs") {
        writeSuiteBinding(this.requestRoot, input.suiteId);
        this.suiteRootValue = boundSuiteRoot;
      }
    }
    const plan = planPath && existsSync(planPath) ? await readFile(planPath, "utf8") : undefined;
    const writesData = input.writesData
      ?? (stableSuite
        ? stableSuite.dataWritePolicy !== "no_write"
        : designSuite
          ? await this.designSuiteWritesData(designSuite, reuseAssessment?.selectedCaseIds ?? [])
          : /\|\s*(?:ephemeral_cleanup|reusable_fixture|tracked_residual|必须清理|受控残留)\s*\|/.test(plan ?? ""));
    const runIntent: RunIntent | undefined = reusableRoute && reuseAssessment
      ? await this.deriveRunIntent({
          assessment: reusableDefinitionAssessment(reuseAssessment),
          environment: input.environment ?? "test",
          deliveryTarget: input.deliveryTarget ?? "full_run",
          stableSuite,
          designSuite,
          writesData
        })
      : undefined;
    if (runIntent) await writeRunIntent(runIntentPath(this.requestRoot), runIntent);
    const planDigest = runIntent ? runIntentDigest(runIntent) : sha256(plan!);
    const definitionInput: import("./types.js").BuildWorkflowDefinitionInput = {
      requestId: this.requestId,
      planDigest,
      planText: plan,
      capabilities: input.capabilities ?? parseCapability(this.requestId),
      writesData,
      deliveryTarget: input.deliveryTarget ?? "full_run",
      requestPolicy: {
        schemaVersion: "request-policy-v1" as const,
        reuseDecision: reuseAssessment?.decision ?? "full_replan",
        deliveryTarget: input.deliveryTarget ?? "full_run",
        reviewSpeed: input.speed ?? "strict",
        writesData,
        selectedCaseIds: reuseAssessment?.selectedCaseIds ?? []
      },
      casePackages: inheritedCasePackages
        ?? (fullReplan ? ["cases.md"] : parseCasePackages(plan ?? "")),
      reviewerRoles: input.reviewerRoles,
      executionIsolation: input.executionIsolation,
      // The public task CLI always opts into the current candidate protocol. Direct engine callers retain
      // their explicit caller choice so test harnesses do not silently alter a
      // caller-owned definition.
      fragmented: input.fragmented ?? false
    };
    const definition = reuseAssessment
      ? buildReusableWorkflowDefinition({
          ...definitionInput,
          reuseAssessment: reusableDefinitionAssessment(reuseAssessment),
          ...(reusableRoute ? { reuseProtocol: CURRENT_WORKFLOW_VERSION } : {})
        })
      : buildWorkflowDefinition(definitionInput);
    const runId = randomUUID();
    const identity: WorkflowIdentity = {
      runId,
      requestId: this.requestId,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion
    };
    const startedEventId = randomUUID();
    const initialEvents: NewWorkflowEvent[] = [
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
    ];
    if (reuseAssessment) {
      const assessmentStartId = randomUUID();
      initialEvents.push(
        {
          ...identity,
          eventId: assessmentStartId,
          type: "ActivityAttemptStarted",
          actorType: "system",
          idempotencyKey: `${runId}/reuse-assessment/attempt-1/started`,
          payload: { activityId: "reuse-assessment", attempt: 1 },
          causationId: startedEventId
        },
        {
          ...identity,
          type: "ActivitySucceeded",
          actorType: "system",
          idempotencyKey: `${runId}/reuse-assessment/${reuseAssessment.assessmentDigest}`,
          payload: {
            activityId: "reuse-assessment",
            attempt: 1,
            verification: `deterministic:${reuseAssessment.assessmentDigest}`,
            outcome: reuseAssessment.decision,
            assessmentDigest: reuseAssessment.assessmentDigest
          },
          causationId: assessmentStartId
        }
      );
      if (reuseAssessment.decision === "direct_execute") {
        if (runIntent) {
          const intentStartId = randomUUID();
          initialEvents.push(
            {
              ...identity,
              eventId: intentStartId,
              type: "ActivityAttemptStarted",
              actorType: "system",
              idempotencyKey: `${runId}/run-intent-derive/attempt-1/started`,
              payload: { activityId: "run-intent-derive", attempt: 1 }
            },
            {
              ...identity,
              type: "RunIntentDerived",
              actorType: "system",
              idempotencyKey: `${runId}/run-intent/${runIntentDigest(runIntent)}`,
              payload: {
                activityId: "run-intent-derive",
                attempt: 1,
                schemaVersion: RUN_INTENT_SCHEMA_VERSION,
                path: safeRelativePath(this.workspaceRoot, runIntentPath(this.requestRoot)),
                digest: runIntentDigest(runIntent),
                decision: runIntent.reuseDecision,
                suiteId: runIntent.suiteId,
                ...(runIntent.suiteVersion ? { suiteVersion: runIntent.suiteVersion } : {})
                ,environment: runIntent.environment,
                deliveryTarget: runIntent.deliveryTarget,
                selectedCaseIds: runIntent.selectedCaseIds,
                affectedCaseIds: runIntent.affectedCaseIds,
                assessmentDigest: runIntent.assessmentDigest,
                sourceDigest: runIntent.sourceDigest,
                boundaryDigest: runIntent.boundaryDigest,
                safeRefs: runIntent.safeRefs
              },
              causationId: intentStartId
            },
            {
              ...identity,
              type: "ActivitySucceeded",
              actorType: "system",
              idempotencyKey: `${runId}/run-intent-derive/${runIntentDigest(runIntent)}/succeeded`,
              payload: { activityId: "run-intent-derive", attempt: 1, verification: `run-intent:${runIntentDigest(runIntent)}`, outcome: "derived" },
              causationId: intentStartId
            }
          );
        }
        const validationStartId = randomUUID();
        initialEvents.push(
          {
            ...identity,
            eventId: validationStartId,
            type: "ActivityAttemptStarted",
            actorType: "system",
            idempotencyKey: `${runId}/suite-validation/attempt-1/started`,
            payload: { activityId: "suite-validation", attempt: 1 }
          },
          {
            ...identity,
            type: "ActivitySucceeded",
            actorType: "system",
            idempotencyKey: `${runId}/suite-validation/${reuseAssessment.suiteVersion}`,
            payload: {
              activityId: "suite-validation",
              attempt: 1,
              verification: `suite:${reuseAssessment.suiteVersion}`,
              outcome: "validated"
            },
            causationId: validationStartId
          }
        );
      }
      if (reuseAssessment.decision === "design_reconfirm") {
        if (runIntent) {
          const intentStartId = randomUUID();
          initialEvents.push(
            {
              ...identity, eventId: intentStartId, type: "ActivityAttemptStarted", actorType: "system",
              idempotencyKey: `${runId}/run-intent-derive/attempt-1/started`,
              payload: { activityId: "run-intent-derive", attempt: 1 }
            },
            {
              ...identity, type: "RunIntentDerived", actorType: "system",
              idempotencyKey: `${runId}/run-intent/${runIntentDigest(runIntent)}`,
              payload: { activityId: "run-intent-derive", attempt: 1, schemaVersion: RUN_INTENT_SCHEMA_VERSION,
                path: safeRelativePath(this.workspaceRoot, runIntentPath(this.requestRoot)), digest: runIntentDigest(runIntent),
                decision: runIntent.reuseDecision, suiteId: runIntent.suiteId,
                ...(runIntent.suiteVersion ? { suiteVersion: runIntent.suiteVersion } : {}),
                environment: runIntent.environment, deliveryTarget: runIntent.deliveryTarget,
                selectedCaseIds: runIntent.selectedCaseIds, affectedCaseIds: runIntent.affectedCaseIds,
                assessmentDigest: runIntent.assessmentDigest,
                sourceDigest: runIntent.sourceDigest, boundaryDigest: runIntent.boundaryDigest, safeRefs: runIntent.safeRefs },
              causationId: intentStartId
            },
            {
              ...identity, type: "ActivitySucceeded", actorType: "system",
              idempotencyKey: `${runId}/run-intent-derive/${runIntentDigest(runIntent)}/succeeded`,
              payload: { activityId: "run-intent-derive", attempt: 1, verification: `run-intent:${runIntentDigest(runIntent)}`, outcome: "derived" },
              causationId: intentStartId
            }
          );
        }
        const revalidationStartId = randomUUID();
        initialEvents.push(
          {
            ...identity,
            eventId: revalidationStartId,
            type: "ActivityAttemptStarted",
            actorType: "system",
            idempotencyKey: `${runId}/design-revalidation/attempt-1/started`,
            payload: { activityId: "design-revalidation", attempt: 1 }
          },
          {
            ...identity,
            type: "ActivitySucceeded",
            actorType: "system",
            idempotencyKey: `${runId}/design-revalidation/${reuseAssessment.assessmentDigest}`,
            payload: {
              activityId: "design-revalidation",
              attempt: 1,
              verification: `design:${reuseAssessment.suiteVersion ?? reuseAssessment.assessmentDigest}`,
              outcome: "zero_drift_reconfirmed"
            },
            causationId: revalidationStartId
          }
        );
      }
    }
    await this.history.appendBatch(initialEvents, { seq: 0, digest: GENESIS_DIGEST });
    if (input.sessionId) await this.runtime.bindSession(input.sessionId, input.targetThreadId);
    return this.gate();
  }

  async events(): Promise<WorkflowEvent[]> {
    return this.history.read();
  }

  async projection(): Promise<WorkflowProjection> {
    return reduceWorkflow(await this.events());
  }

  async caseConfirmationReviewScope(): Promise<{ scope: "full" | "affected"; caseIds: string[] }> {
    const projection = await this.projection();
    const activity = projection.activities["case-confirmation"];
    if (!activity) throw new Error("case-confirmation is not defined for this request.");
    const scope = activity.definition.metadata?.scope === "affected" ? "affected" as const : "full" as const;
    const affectedCaseIds = Array.isArray(activity.definition.metadata?.affectedCaseIds)
      ? activity.definition.metadata.affectedCaseIds.filter((value): value is string => typeof value === "string")
      : [];
    const cases = caseConfirmationSemanticCases(await readFile(this.designAssetPath("cases.md"), "utf8"));
    return {
      scope,
      caseIds: selectCaseConfirmationSemanticCases({ cases, scope, affectedCaseIds }).map((testcase) => testcase.caseId)
    };
  }

  /** Re-derive the current review payload from the callback scope and frozen assets. */
  async currentTestcaseReviewExport(): Promise<TestcaseReviewExport> {
    const view = await this.gate();
    if (!isCurrentWorkflowVersion(view.definitionVersion)) {
      throw new Error(`Testcase review exports require the current ${CURRENT_WORKFLOW_VERSION} workflow.`);
    }
    const reviewDesignPath = existsSync(this.planPath)
      ? this.planPath
      : this.suiteRoot
        ? resolve(this.suiteRoot, "design.md")
        : this.planPath;
    const callbackSubjectDigest = await this.callbackSubjectDigest("case-confirmation");
    return buildTestcaseReviewExport(buildTestcaseReviewModel({
      requestId: this.requestId,
      plan: await readFile(reviewDesignPath, "utf8"),
      cases: await readFile(this.designAssetPath("cases.md"), "utf8"),
      callbackSubjectDigest,
      selectedCaseIds: (await this.caseConfirmationReviewScope()).caseIds
    }));
  }

  async completeReadinessPreflight(claimToken: string, report: {
    schemaVersion: "readiness-preflight-v1";
    complete: boolean;
    digest: string;
  }): Promise<void> {
    const before = await this.gate();
    const activity = before.activities["readiness-preflight"];
    if (!activity || activity.definition.kind !== "readiness_preflight" || activity.state !== "RUNNING") {
      throw new Error("readiness-preflight must be running before completion.");
    }
    if (!report.complete) throw new Error("readiness-preflight cannot complete an incompatible input report.");
    requireDigest(report.digest, "readiness-preflight digest");
    await this.succeedActivity("readiness-preflight", {
      claimToken,
      verification: `${report.schemaVersion}:${report.digest}`,
      outcome: "compatible"
    });
  }

  async callbackSubjectDigest(activityId: string): Promise<string> {
    const projection = await this.projection();
    if (activityId === "plan-confirmation") {
      const activity = projection.activities[activityId];
      const schemaVersion = activity?.callbackSubjectSchemaVersion
        ?? PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION;
      return this.planConfirmationSubjectDigest(
        await readFile(this.planPath, "utf8"),
        schemaVersion
      );
    }
    if (
      activityId === "case-confirmation"
      || activityId === "case-review-conflict-decision"
    ) {
      const activity = projection.activities[activityId];
      const generatedPackages = Object.values(projection.activities)
        .filter((activity) => ["case_generation", "candidate_generation"].includes(activity.definition.kind))
        .map((activity) => {
          const packageName = activity.definition.metadata?.package;
          if (typeof packageName !== "string") {
            throw new Error(`Case activity ${activity.id} has no package binding.`);
          }
          return {
            activityId: activity.id,
            path: safeRelativePath(
              this.workspaceRoot,
              resolve(this.designAssetPath(packageName))
            )
          };
        });
      const declaredPackages = Array.isArray(activity?.definition.metadata?.casePackages)
        ? activity.definition.metadata.casePackages
          .filter((value): value is string => typeof value === "string")
          .map((packageName) => ({
            activityId,
            path: safeRelativePath(
              this.workspaceRoot,
              resolve(this.designAssetPath(packageName))
            )
          }))
        : [];
      const packages = [...new Map(
        [...generatedPackages, ...declaredPackages].map((item) => [item.path, item])
      ).values()]
        .sort((left, right) => left.path.localeCompare(right.path));
      if (!packages.length) {
        throw new Error(`Callback ${activityId} has no testcase package binding.`);
      }
      if (isCurrentWorkflowVersion(projection.definitionVersion) && activityId === "case-confirmation") {
        const packageSources = await Promise.all(packages.map(async (item) => ({
          ...item,
          source: await readFile(resolve(this.workspaceRoot, item.path), "utf8")
        })));
        const semanticCases = packageSources.flatMap((item) =>
          caseConfirmationSemanticCases(item.source).map((testcase) => ({
            ...testcase,
            path: item.path
          }))
        );
        const scope = activity.definition.metadata?.scope === "affected"
          ? "affected" as const
          : "full" as const;
        const affectedCaseIds = scope === "affected"
          ? (Array.isArray(activity.definition.metadata?.affectedCaseIds)
              ? activity.definition.metadata.affectedCaseIds
                .filter((value): value is string => typeof value === "string")
              : [])
          : undefined;
        const selected = selectCaseConfirmationSemanticCases({
          cases: semanticCases,
          scope,
          affectedCaseIds
        });
        const refs = [...new Set(selected.flatMap((testcase) => testcase.refs))].sort();
        const plan = canonicalJson({
          schemaVersion: RUN_INTENT_SCHEMA_VERSION,
          digest: runIntentDigest(await readRunIntent(runIntentPath(this.requestRoot))),
          scope,
          caseIds: selected.map((testcase) => testcase.caseId),
          refs
        });
        const cases = selected.map((testcase) => ({
          caseId: testcase.caseId,
          path: testcase.path,
          semanticDigest: sha256(testcase.semanticSummary),
          semanticSummary: testcase.semanticSummary
        }));
        const suiteVersion = typeof activity.definition.metadata?.suiteVersion === "string"
          ? activity.definition.metadata.suiteVersion
          : sha256(canonicalJson({ plan, cases }));
        return sha256(canonicalJson({
          schemaVersion: CASE_CONFIRMATION_SUBJECT_SCHEMA_VERSION,
          requestId: projection.requestId,
          scope,
          suiteId: typeof activity.definition.metadata?.suiteId === "string"
            ? activity.definition.metadata.suiteId
            : projection.requestId,
          suiteVersion,
          caseIds: selected.map((testcase) => testcase.caseId),
          refs,
          planDigest: sha256(plan),
          cases
        }));
      }
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

  async recordTestcaseReviewWorkbookPublication(input: {
    subjectDigest: string;
    contentDigest: string;
    bindingDigest: string;
    workbookDigest: string;
    receiptDigest: string;
    cacheStatus: "hit" | "miss" | "rebuild";
    renderMilliseconds: number;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (!isCurrentWorkflowVersion(before.definitionVersion)) {
      throw new Error(`Review workbook publication requires the current ${CURRENT_WORKFLOW_VERSION} workflow.`);
    }
    const activity = before.activities["case-confirmation"];
    if (!activity || !["READY", "WAITING_CALLBACK"].includes(activity.state)) {
      throw new Error("case-confirmation must be ready before publishing its review workbook.");
    }
    const actualSubject = await this.callbackSubjectDigest("case-confirmation");
    if (actualSubject !== input.subjectDigest) {
      throw new Error("Review workbook subject digest is stale.");
    }
    for (const [label, value] of Object.entries(input)) {
      if (label.endsWith("Digest") && (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
      }
    }
    if (!(["hit", "miss", "rebuild"] as const).includes(input.cacheStatus)) {
      throw new Error("Invalid review workbook cache status.");
    }
    if (!Number.isInteger(input.renderMilliseconds) || input.renderMilliseconds < 0) {
      throw new Error("Review workbook render milliseconds must be a non-negative integer.");
    }
    const workbook = await readFile(resolve(this.requestRoot, "cases-review.xlsx"));
    if (sha256(workbook) !== input.workbookDigest) throw new Error("Published review workbook digest drifted.");
    const current = await this.currentTestcaseReviewExport();
    if (input.contentDigest !== current.contentDigest || input.bindingDigest !== current.bindingDigest) {
      throw new Error("Review workbook content or binding digest is stale.");
    }
    await this.append(
      "TestcaseReviewWorkbookPublished",
      "agent",
      {
        activityId: "case-confirmation",
        subjectDigest: input.subjectDigest,
        contentDigest: input.contentDigest,
        bindingDigest: input.bindingDigest,
        workbookDigest: input.workbookDigest,
        receiptDigest: input.receiptDigest,
        path: "cases-review.xlsx",
        cacheStatus: input.cacheStatus,
        renderMilliseconds: input.renderMilliseconds
      },
      `${before.runId}/case-confirmation/review-workbook/${input.bindingDigest}`,
      before.head
    );
    return this.gate();
  }

  private async assertCurrentReviewWorkbook(view: WorkflowGateView, subjectDigest: string): Promise<void> {
    if (!isCurrentWorkflowVersion(view.definitionVersion)) return;
    const publication = view.reviewWorkbook;
    if (!publication || publication.subjectDigest !== subjectDigest) {
      throw new Error("Current case-confirmation requires a workbook published for the current subject.");
    }
    let workbook: Buffer;
    try {
      workbook = await readFile(resolve(this.requestRoot, publication.path));
    } catch {
      throw new Error("Published cases-review.xlsx is missing; run testcase-review-render-publish again.");
    }
    if (sha256(workbook) !== publication.workbookDigest) {
      throw new Error("Published cases-review.xlsx drifted; run testcase-review-render-publish again.");
    }
    const current = await this.currentTestcaseReviewExport();
    if (
      current.callbackSubjectDigest !== subjectDigest
      || current.contentDigest !== publication.contentDigest
      || current.bindingDigest !== publication.bindingDigest
    ) {
      throw new Error("Review workbook content, binding, or subject drifted; run testcase-review-render-publish again.");
    }
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
      if (!["SUCCEEDED", "CANCELLED", "SUSPENDED"].includes(projection.workflowState)) {
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
    const recoveryActions = planResumeRecovery({
      projection,
      events,
      runtime,
      now: at
    });
    const rebind = reviewerRebindAction(recoveryActions)
      ?? reviewerIdleRebindAction(recoveryActions);
    if (
      rebind
      && !["SUSPENDED", "BLOCKED", "WAITING_HUMAN", "SUCCEEDED", "CANCELLED"]
        .includes(projection.workflowState)
    ) {
      const action = `reviewer-rebind:${rebind.batchId}:${rebind.activityId}:${rebind.role}`;
      projection.nextActions = [...new Set([...projection.nextActions, action])];
      if (projection.continuation.kind === "await_event") {
        projection.continuation = {
          kind: "continue_now",
          referenceId: action,
          reason: rebind.kind === "reviewer_idle_rebind"
            ? "reviewer_idle_rebind_suggested"
            : "reviewer_runtime_rebind_required"
        };
      }
      projection.reply = {
        kind: "none",
        allowed: false,
        reason: "automatic_work_remaining"
      };
    }
    if (
      isCurrentWorkflowVersion(projection.definitionVersion)
      && projection.activities["case-review-resolution"]?.outcome === "evolve"
      && projection.activities["case-review-evolution"]?.state === "SUCCEEDED"
    ) {
      const latestBatch = [...events].reverse().find((event) => {
        if (event.type !== "ReviewBatchStarted" || event.payload.scope === undefined) return false;
        try {
          return parseReviewBatchScope(event.payload.scope).schemaVersion === "review-batch-scope-v1";
        } catch {
          return false;
        }
      });
      if (latestBatch && typeof latestBatch.payload.batchId === "string") {
        const scope = parseReviewBatchScope(latestBatch.payload.scope);
        const hasChild = events.some((event) => event.type === "ReviewBatchStarted"
          && event.seq > latestBatch.seq
          && event.payload.scope !== undefined
          && (() => {
            try {
              return parseReviewBatchScope(event.payload.scope).baseBatchId === latestBatch.payload.batchId;
            } catch {
              return false;
            }
          })());
        if (hasCompleteReviewBatchScope(scope)
          && scope.semanticEvolutionCycle === 0 && !hasChild) {
          const action = `review-rereview-start:${latestBatch.payload.batchId}`;
          projection.nextActions = [...new Set([...projection.nextActions, action])];
          if (projection.continuation.kind === "await_event") {
            projection.continuation = {
              kind: "continue_now",
              referenceId: action,
            reason: "semantic_rereview_ready"
            };
          }
        }
      }
    }
    const checkpoint = this.checkpoint(projection, runtime);
    const selectorRepairSubstate = deriveSelectorRepairSubstate(projection, events);
    const reviewerEpoch = isCurrentWorkflowVersion(projection.definitionVersion)
      ? deriveV10ReviewerEpoch(events)
      : undefined;
    return {
      schemaVersion: "workflow-gate-v1",
      ...projection,
      ...(selectorRepairSubstate ? { selectorRepairSubstate } : {}),
      ...(reviewerEpoch ? { reviewerEpoch } : {}),
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
    return this.startActivityInternal(activityId, owner, leaseMs, at, false);
  }

  /** Starts a current candidate model call. The attempt start and timing marker
   * are appended together, so a later publish can never silently report model
   * time as zero. */
  async startCandidateGeneration(
    activityId: string,
    owner: string,
    leaseMs = 120_000,
    at = Date.now()
  ): Promise<ActivityStartResult> {
    return this.startActivityInternal(activityId, owner, leaseMs, at, true);
  }

  /** Record the safe run-intent identity after the deterministic reuse/impact
   * step. The file itself is local recovery input; history contains only its
   * digest, safe path and frozen decision. */
  async deriveCurrentRunIntent(claimToken: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities["run-intent-derive"];
    if (!activity || activity.definition.kind !== "run_intent_derive" || activity.state !== "RUNNING") {
      throw new Error("run-intent-derive must be running before its intent can be recorded.");
    }
    await this.handleForClaim("run-intent-derive", claimToken);
    const intent = await readRunIntent(runIntentPath(this.requestRoot));
    if (intent.reuseDecision !== activity.definition.metadata?.decision
      || intent.suiteId !== activity.definition.metadata?.suiteId) {
      throw new Error("run-intent.json does not match the frozen reuse decision.");
    }
    await this.append(
      "RunIntentDerived",
      "agent",
      {
        activityId: activity.id,
        attempt: activity.attempt,
        schemaVersion: RUN_INTENT_SCHEMA_VERSION,
        path: safeRelativePath(this.workspaceRoot, runIntentPath(this.requestRoot)),
        digest: runIntentDigest(intent),
        decision: intent.reuseDecision,
        suiteId: intent.suiteId,
        ...(intent.suiteVersion ? { suiteVersion: intent.suiteVersion } : {}),
        environment: intent.environment,
        deliveryTarget: intent.deliveryTarget,
        selectedCaseIds: intent.selectedCaseIds,
        affectedCaseIds: intent.affectedCaseIds,
        assessmentDigest: intent.assessmentDigest,
        sourceDigest: intent.sourceDigest,
        boundaryDigest: intent.boundaryDigest,
        safeRefs: intent.safeRefs
      },
      `${before.runId}/run-intent/${runIntentDigest(intent)}`,
      before.head
    );
    return this.succeedActivity("run-intent-derive", {
      claimToken,
      verification: `run-intent:${runIntentDigest(intent)}`,
      outcome: "derived"
    });
  }

  /** Rebuild the disposable local intent file from the durable safe summary.
   * It intentionally appends no history: the prior RunIntentDerived event is
   * still the fact, while the stable suite verifies the referenced version. */
  async recoverRunIntent(): Promise<RunIntent> {
    const path = runIntentPath(this.requestRoot);
    if (existsSync(path)) return readRunIntent(path);
    const events = await this.events();
    const event = [...events].reverse().find((candidate) => candidate.type === "RunIntentDerived");
    if (!event) throw new Error("Run intent cannot be recovered because history has no RunIntentDerived event.");
    const payload = event.payload;
    const selectedCaseIds = Array.isArray(payload.selectedCaseIds)
      ? payload.selectedCaseIds.filter((value): value is string => typeof value === "string").sort()
      : [];
    const affectedCaseIds = Array.isArray(payload.affectedCaseIds)
      ? payload.affectedCaseIds.filter((value): value is string => typeof value === "string").sort()
      : [];
    const safeRefs = Array.isArray(payload.safeRefs)
      ? payload.safeRefs.filter((value): value is string => typeof value === "string").sort()
      : [];
    if (typeof payload.suiteId !== "string" || typeof payload.decision !== "string"
      || typeof payload.environment !== "string" || typeof payload.sourceDigest !== "string"
      || typeof payload.boundaryDigest !== "string" || !safeRefs.length
      || !["direct_execute", "design_reconfirm", "affected_rebuild", "full_replan"].includes(payload.decision)
      || !["testcase_only", "script_only", "full_run"].includes(String(payload.deliveryTarget))) {
      throw new Error("Run intent history predates recoverable run-intent-v1 fields.");
    }
    if (typeof payload.suiteVersion === "string") {
      const design = await loadStableDesignSuite(payload.suiteId, this.workspaceRoot).catch(() => undefined);
      const execution = design ? undefined : await loadStableTestSuite(payload.suiteId, this.workspaceRoot).catch(() => undefined);
      const version = design?.suiteVersion ?? execution?.suiteVersion;
      if (version !== payload.suiteVersion) throw new Error("Run intent baseline version no longer matches the stable suite.");
    }
    const intent: RunIntent = {
      schemaVersion: RUN_INTENT_SCHEMA_VERSION,
      suiteId: payload.suiteId,
      ...(typeof payload.suiteVersion === "string" ? { suiteVersion: payload.suiteVersion } : {}),
      reuseDecision: payload.decision as RunIntent["reuseDecision"],
      assessmentDigest: typeof payload.assessmentDigest === "string" ? payload.assessmentDigest : "",
      environment: payload.environment,
      deliveryTarget: payload.deliveryTarget as RunIntent["deliveryTarget"],
      selectedCaseIds,
      affectedCaseIds,
      sourceDigest: payload.sourceDigest,
      boundaryDigest: payload.boundaryDigest,
      safeRefs
    };
    if (runIntentDigest(intent) !== payload.digest) throw new Error("Recovered run intent digest differs from durable history.");
    await writeRunIntent(path, intent);
    return intent;
  }

  /** Build the deterministic affected-case closure. An incomplete mapping is
   * not a failed request: it deterministically selects the predeclared full
   * candidate branch in this same request. */
  async buildImpactClosure(claimToken: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities["impact-closure-build"];
    if (!activity || activity.definition.kind !== "impact_closure" || activity.state !== "RUNNING") {
      throw new Error("impact-closure-build must be running before closure construction.");
    }
    await this.handleForClaim(activity.id, claimToken);
    const metadata = activity.definition.metadata ?? {};
    const intent = await this.recoverRunIntent();
    const affectedCaseIds = Array.isArray(metadata.affectedCaseIds)
      ? metadata.affectedCaseIds.filter((value): value is string => typeof value === "string")
      : [];
    const designSuite = await loadStableDesignSuite(intent.suiteId, this.workspaceRoot).catch(() => undefined);
    let closure: ImpactClosure;
    try {
      if (!designSuite) throw new Error("stable design ledger is unavailable");
      const baselinePath = resolve(this.workspaceRoot, designSuite.casePackages[0]?.path ?? "");
      if (!baselinePath || !existsSync(baselinePath)) throw new Error("stable testcase baseline is unavailable");
      const baseline = parseTestcaseDocument(await readFile(baselinePath, "utf8"));
      const byCase = new Map(baseline.cases.map((testcase) => [testcase.caseId, testcase]));
      if (affectedCaseIds.some((caseId) => !byCase.has(caseId))) {
        throw new Error("affected case is absent from the stable testcase baseline");
      }
      const rules = parseRuleLedger(await readFile(resolve(this.workspaceRoot, designSuite.designLedger.path), "utf8"))
        .filter((rule) => rule.caseIds.some((caseId) => affectedCaseIds.includes(caseId)));
      const ruleIds = rules.map((rule) => rule.ruleId);
      if (!rules.length || rules.some((rule) => !rule.caseIds.some((caseId) => affectedCaseIds.includes(caseId)))) {
        throw new Error("affected cases do not have a complete RULE ledger mapping");
      }
      const moduleIds = affectedCaseIds.map((caseId) => byCase.get(caseId)!.module);
      closure = buildImpactClosure({
        suiteId: String(metadata.suiteId ?? ""),
        baselineVersion: typeof metadata.suiteVersion === "string" ? metadata.suiteVersion : undefined,
        caseIds: affectedCaseIds,
        ruleIds,
        sourceRefs: rules.flatMap((rule) => rule.sourceRefs),
        moduleIds
      });
    } catch (error) {
      return this.succeedActivity(activity.id, {
        claimToken,
        verification: `full-replan-fallback:${sha256(error instanceof Error ? error.message : String(error))}`,
        outcome: "full_replan"
      });
    }
    const path = resolve(this.requestRoot, "impact-closure.json");
    await atomicWriteText(path, `${JSON.stringify(closure, null, 2)}\n`);
    const digest = impactClosureDigest(closure);
    await this.append(
      "ImpactClosureBuilt",
      "agent",
      {
        activityId: activity.id,
        attempt: activity.attempt,
        schemaVersion: closure.schemaVersion,
        path: safeRelativePath(this.workspaceRoot, path),
        digest,
        baselineVersion: closure.baselineVersion,
        caseIds: closure.caseIds
      },
      `${before.runId}/impact-closure/${digest}`,
      before.head
    );
    return this.succeedActivity(activity.id, {
      claimToken,
      verification: `${closure.schemaVersion}:${digest}`,
      outcome: "bounded"
    });
  }

  async preflightDesignDelta(claimToken: string, stagedDelta: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities["delta-preflight"];
    if (!activity || activity.definition.kind !== "delta_preflight" || activity.state !== "RUNNING") {
      throw new Error("delta-preflight must be running before its design delta can be validated.");
    }
    await this.handleForClaim(activity.id, claimToken);
    const closure = JSON.parse(await readFile(resolve(this.requestRoot, "impact-closure.json"), "utf8")) as ImpactClosure;
    const delta = parseDesignDelta(stagedDelta, closure);
    const digest = designDeltaDigest(delta);
    const path = resolve(this.requestRoot, "design-delta.json");
    await atomicWriteText(path, `${JSON.stringify(delta, null, 2)}\n`);
    await this.append(
      "DesignDeltaPrepared",
      "agent",
      {
        activityId: activity.id,
        attempt: activity.attempt,
        schemaVersion: delta.schemaVersion,
        path: safeRelativePath(this.workspaceRoot, path),
        digest,
        baselineVersion: delta.baselineVersion,
        caseIds: delta.caseIds,
        ruleIds: delta.ruleIds,
        moduleIds: delta.moduleIds
      },
      `${before.runId}/design-delta/${digest}`,
      before.head
    );
    return this.succeedActivity(activity.id, {
      claimToken,
      verification: `${delta.schemaVersion}:${digest}`,
      outcome: "validated"
    });
  }

  private async startActivityInternal(
    activityId: string,
    owner: string,
    leaseMs: number,
    at: number,
    captureCandidateGeneration: boolean
  ): Promise<ActivityStartResult> {
    const before = await this.gate(at);
    const activity = before.activities[activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${activityId}`);
    if (activity.definition.kind === "complete") {
      throw new Error("Workflow completion must be recorded with task:manage complete.");
    }
    const candidateGeneration = this.isTimedCandidateGeneration(activity);
    if (candidateGeneration && !captureCandidateGeneration) {
      throw new Error(`${activityId} must start through candidate-generation-start so model timing is captured.`);
    }
    if (!candidateGeneration && captureCandidateGeneration) {
      throw new Error(`${activityId} is not a timed candidate generation activity.`);
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
      const attempt = activity.attempt + 1;
      const drafts: WorkflowEventDraft[] = [{
        type: "ActivityAttemptStarted",
        actorType: "agent",
        payload: { activityId, attempt },
        idempotencyKey: `${before.runId}/${activityId}/attempt-${attempt}/start`
      }];
      if (captureCandidateGeneration) {
        drafts.push({
          type: "CandidateGenerationStarted",
          actorType: "agent",
          payload: { activityId, attempt },
          idempotencyKey: `${before.runId}/${activityId}/attempt-${attempt}/generation-started`
        });
      }
      await this.appendSequence(drafts, before.head);
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

  /** Validates a staged candidate plan and atomically publishes it only on success.
   * A failed preflight records a normal retryable ActivityFailed event; source
   * text itself stays out of durable history. */
  async preflightCandidatePlan(input: {
    claimToken: string;
    publishId: string;
    verification: string;
    plan: string;
  }): Promise<CandidatePreflightResult> {
    const before = await this.gate();
    const activity = Object.values(before.activities).find((candidate) =>
      candidate.definition.kind === "candidate_preflight" && candidate.state === "RUNNING"
    );
    if (!activity || activity.definition.kind !== "candidate_preflight" || activity.state !== "RUNNING") {
      throw new Error("candidate-preflight must be running before its staged plan can be validated.");
    }
    const sources = await this.candidatePreflightSourceTexts(input.plan);
    const baselinePlanPath = before.runIntent?.decision === "full_replan" && this.suiteRoot
      ? resolve(this.suiteRoot, "design.md")
      : undefined;
    const report = evaluateCandidatePlanPreflight({
      plan: input.plan,
      sourceTexts: sources.texts,
      sourceDocuments: sources.documents,
      sourceDiagnostics: sources.diagnostics,
      ...(baselinePlanPath && existsSync(baselinePlanPath)
        ? { baselinePlan: await readFile(baselinePlanPath, "utf8") }
        : {})
    });
    if (!report.complete) {
      const projection = await this.failActivity(activity.id, {
        claimToken: input.claimToken,
        scheduleRetry: true,
        summary: `candidate-preflight: ${candidateRepairChecklist(report.issues).map((item) => `${item.category}: ${item.issues.join(" ")}`).join(" | ")}`
      });
      return { report, projection };
    }
    const projection = await this.publishArtifactsAndSucceed(activity.id, {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: input.verification,
      artifacts: [{ targetPath: this.planPath, content: input.plan }]
    });
    return { report, projection };
  }

  /** Publishes the model's bounded classification and a tool-derived current
   * manifest. The proposal never gets to choose artifact paths or expand a
   * graph directly. */
  async publishCandidateCompiler(input: {
    claimToken: string;
    publishId: string;
    verification: string;
    spec: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = Object.values(before.activities).find((candidate) =>
      candidate.definition.kind === "candidate_compiler" && candidate.state === "RUNNING"
    );
    if (!activity) throw new Error("candidate-compiler must be running before its staged spec can be published.");
    const spec = parseCandidateCompilerSpec(input.spec);
    const expectedScope = activity.definition.metadata?.scope;
    if (spec.scope !== expectedScope) throw new Error("Candidate compiler spec scope differs from the frozen activity.");
    const frozenPlan = await readFile(this.planPath, "utf8");
    validateCandidateCompilerSpecAgainstPlan(spec, frozenPlan);
    const namespace = activity.definition.metadata?.candidateNamespace === "delta" ? "delta-" : "";
    if (spec.scope === "affected") {
      const closure = JSON.parse(await readFile(resolve(this.requestRoot, "impact-closure.json"), "utf8")) as ImpactClosure;
      const delta = parseDesignDelta(await readFile(resolve(this.requestRoot, "design-delta.json"), "utf8"), closure);
      if (spec.impactClosureDigest !== impactClosureDigest(closure)
        || spec.designDeltaDigest !== designDeltaDigest(delta)
        || spec.baselineVersion !== closure.baselineVersion
      ) {
        throw new Error("Affected compiler spec differs from the frozen closure or delta.");
      }
    }
    const plan = frozenPlan;
    const manifest = candidateCompilerManifest(spec, plan);
    const specPath = `${namespace}candidate-compiler/spec.json`;
    const manifestPath = `${namespace}candidate-fragments/manifest.json`;
    if (activity.definition.metadata?.specPath !== specPath || activity.definition.metadata?.manifestPath !== manifestPath) {
      throw new Error("Candidate compiler artifact paths differ from the frozen activity.");
    }
    const canonicalSpec = `${canonicalJson(spec as unknown as SafeJsonValue)}\n`;
    const canonicalManifest = `${canonicalJson(manifest as unknown as SafeJsonValue)}\n`;
    return this.publishArtifactsAndSucceed(activity.id, {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: `${input.verification}; compilerSpec=${candidateCompilerSpecDigest(spec)}`,
      artifacts: [
        { targetPath: resolve(this.requestRoot, specPath), content: canonicalSpec },
        { targetPath: resolve(this.requestRoot, manifestPath), content: canonicalManifest }
      ]
    });
  }

  /** Deterministically materializes one fully compilable module without a
   * provider call. It still uses the ordinary claim/fencing publication path. */
  async compileCandidateFragment(input: {
    activityId: string;
    owner: string;
    leaseMs?: number;
    publishId: string;
    verification: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const definition = before.activities[input.activityId];
    if (!definition || definition.definition.kind !== "candidate_fragment" || definition.definition.metadata?.generationMode !== "deterministic") {
      throw new Error("candidate-fragment-compile is only available for deterministic compiler fragments.");
    }
    const started = await this.startActivity(input.activityId, input.owner, input.leaseMs ?? 120_000);
    const activity = (await this.gate()).activities[input.activityId]!;
    const moduleId = activity.definition.metadata?.moduleId;
    const specPath = resolve(this.requestRoot, activity.definition.metadata?.candidateNamespace === "delta"
      ? "delta-candidate-compiler/spec.json" : "candidate-compiler/spec.json");
    if (typeof moduleId !== "string") throw new Error("Deterministic candidate fragment lacks moduleId.");
    const fragmentPath = activity.definition.metadata?.fragmentPath;
    if (typeof fragmentPath !== "string") throw new Error("Deterministic candidate fragment lacks fragmentPath.");
    const manifestPath = resolve(this.requestRoot, activity.definition.metadata?.candidateNamespace === "delta"
      ? "delta-candidate-fragments/manifest.json" : "candidate-fragments/manifest.json");
    const manifest = parseCandidateFragmentManifest(await readFile(manifestPath, "utf8"));
    const content = renderDeterministicCandidateFragment(
      parseCandidateCompilerSpec(await readFile(specPath, "utf8")), manifest, moduleId
    );
    return this.publishArtifactsAndSucceed(input.activityId, {
      claimToken: started.claimToken,
      publishId: input.publishId,
      verification: input.verification,
      artifacts: [{ targetPath: resolve(this.requestRoot, fragmentPath), content }]
    });
  }

  /** Merges a staged model-only detail body into the immutable compiled block
   * set for a mixed v10 fragment. */
  async publishMixedCandidateFragment(input: {
    activityId: string;
    claimToken: string;
    publishId: string;
    verification: string;
    modelContent: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== "candidate_fragment" || activity.state !== "RUNNING"
      || activity.definition.metadata?.generationMode !== "mixed") {
      throw new Error("candidate-fragment-merge is only available for a running mixed compiler fragment.");
    }
    const moduleId = activity.definition.metadata?.moduleId;
    const fragmentPath = activity.definition.metadata?.fragmentPath;
    const specPath = resolve(this.requestRoot, activity.definition.metadata?.candidateNamespace === "delta"
      ? "delta-candidate-compiler/spec.json" : "candidate-compiler/spec.json");
    if (typeof moduleId !== "string" || typeof fragmentPath !== "string") throw new Error("Mixed candidate fragment has incomplete compiler metadata.");
    const manifestPath = resolve(this.requestRoot, activity.definition.metadata?.candidateNamespace === "delta"
      ? "delta-candidate-fragments/manifest.json" : "candidate-fragments/manifest.json");
    const manifest = parseCandidateFragmentManifest(await readFile(manifestPath, "utf8"));
    const content = mergeCandidateCompilerFragment(
      parseCandidateCompilerSpec(await readFile(specPath, "utf8")), manifest, moduleId, input.modelContent
    );
    return this.publishArtifactsAndSucceed(input.activityId, {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: input.verification,
      artifacts: [{ targetPath: resolve(this.requestRoot, fragmentPath), content }]
    });
  }

  /** Publishes a model-only fragment through a dedicated entry point. This
   * keeps ordinary artifact publication from bypassing frozen compiler scope. */
  async publishModelCandidateFragment(input: {
    activityId: string;
    claimToken: string;
    publishId: string;
    verification: string;
    content: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== "candidate_fragment" || activity.state !== "RUNNING"
      || activity.definition.metadata?.generationMode !== "model") {
      throw new Error("candidate-fragment-publish is only available for a running model compiler fragment.");
    }
    const fragmentPath = activity.definition.metadata?.fragmentPath;
    if (typeof fragmentPath !== "string") throw new Error("Model candidate fragment lacks fragmentPath.");
    return this.publishArtifactsAndSucceed(input.activityId, {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: input.verification,
      artifacts: [{ targetPath: resolve(this.requestRoot, fragmentPath), content: input.content }]
    });
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

  /**
   * Hosts generating a candidate compiler, skeleton, or fragment may keep the foreground
   * call alive with this helper. It has no model/provider dependency and does
   * not execute work in the background; the host must call assertHealthy()
   * immediately before publishing and stop() in its finally block.
   */
  createCandidateGenerationLeaseKeepalive(
    activityId: string,
    claimToken: string,
    leaseMs = 120_000
  ): ActivityLeaseKeepalive {
    if (!/^(?:delta-)?candidate-(?:compiler|skeleton|fragment-[a-z0-9][a-z0-9-]*)$/u.test(activityId)) {
      throw new Error("Lease keepalive is only available for timed candidate generation activities.");
    }
    return new ActivityLeaseKeepalive(
      leaseMs,
      () => this.renewActivity(activityId, claimToken, leaseMs)
    );
  }

  /** Keeps a foreground engineering host alive; it never starts background work. */
  createHostActivityLeaseKeepalive(
    activityId: "build" | "readiness" | "script-review",
    claimToken: string,
    leaseMs = 120_000
  ): ActivityLeaseKeepalive {
    if (!(["build", "readiness", "script-review"] as const).includes(activityId)) {
      throw new Error("Host lease keepalive is only available for timed engineering activities.");
    }
    return new ActivityLeaseKeepalive(
      leaseMs,
      () => this.renewActivity(activityId, claimToken, leaseMs)
    );
  }

  /** Freeze the validated compiler manifest into one immutable module graph.
   * The manifest itself must already have been atomically published by
   * candidate-skeleton; this method only records safe identities and activity
   * definitions in durable history. */
  async expandCandidateGraph(): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (!isCurrentWorkflowVersion(before.definitionVersion)) {
      throw new Error(`Candidate graph expansion requires the current ${CURRENT_WORKFLOW_VERSION} workflow.`);
    }
    if ((await this.events()).some((event) => event.type === "CandidateGraphExpanded")) {
      throw new Error("Candidate graph has already expanded from its frozen skeleton.");
    }
    const skeleton = Object.values(before.activities).find((activity) =>
      ["candidate_skeleton", "candidate_compiler"].includes(activity.definition.kind) && activity.state === "SUCCEEDED"
    );
    if (!skeleton || skeleton.state !== "SUCCEEDED") {
      throw new Error("A candidate compiler must succeed before candidate graph expansion.");
    }
    const manifestRelative = typeof skeleton.definition.metadata?.manifestPath === "string"
      ? skeleton.definition.metadata.manifestPath
      : "candidate-fragments/manifest.json";
    const manifestPath = resolve(this.requestRoot, manifestRelative);
    if (!existsSync(manifestPath)) {
      throw new Error("candidate compiler must publish its frozen manifest first.");
    }
    const content = await readFile(manifestPath, "utf8");
    const manifest = parseCandidateFragmentManifest(content);
    const deltaNamespace = skeleton.definition.metadata?.candidateNamespace === "delta";
    if (deltaNamespace) {
      const closurePath = resolve(this.requestRoot, "impact-closure.json");
      if (!existsSync(closurePath)) {
        throw new Error("Affected candidate expansion requires a frozen impact-closure.json.");
      }
      const closure = JSON.parse(await readFile(closurePath, "utf8")) as { ruleIds?: unknown };
      if (!Array.isArray(closure.ruleIds) || !closure.ruleIds.length) {
        throw new Error("Affected candidate expansion requires full_replan when RULE closure is incomplete.");
      }
      const allowedRules = new Set(closure.ruleIds.filter((value): value is string => typeof value === "string"));
      if (manifest.modules.some((module) => module.ruleIds.some((ruleId) => !allowedRules.has(ruleId)))) {
        throw new Error("Affected candidate fragments may only contain RULEs in the frozen impact closure.");
      }
      const deltaPath = resolve(this.requestRoot, "design-delta.json");
      if (!existsSync(deltaPath)) {
        throw new Error("Affected candidate expansion requires a validated design-delta.json.");
      }
      const delta = JSON.parse(await readFile(deltaPath, "utf8")) as { ruleIds?: unknown };
      const deltaRules = new Set(Array.isArray(delta.ruleIds)
        ? delta.ruleIds.filter((value): value is string => typeof value === "string")
        : []);
      const manifestRules = new Set(manifest.modules.flatMap((module) => module.ruleIds));
      if (!deltaRules.size || manifestRules.size !== deltaRules.size
        || [...manifestRules].some((ruleId) => !deltaRules.has(ruleId))) {
        throw new Error("Affected candidate manifest must exactly match the validated design delta RULE scope.");
      }
    }
    const skeletonDigest = candidateFragmentManifestDigest(manifest);
    const manifestRelativePath = safeRelativePath(this.workspaceRoot, manifestPath);
    const events = await this.events();
    const skeletonSuccess = [...events].reverse().find((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === skeleton.id
    );
    const publishedDigest = Array.isArray(skeletonSuccess?.payload.outputDigests)
      ? skeletonSuccess!.payload.outputDigests.find((item) =>
        item && typeof item === "object"
        && !Array.isArray(item)
        && (item as Record<string, unknown>).path === manifestRelativePath
      ) as Record<string, unknown> | undefined
      : undefined;
    if (publishedDigest?.digest !== sha256(content)) {
      throw new Error("Candidate skeleton manifest digest does not match its published output.");
    }
    const expectedScope = skeleton.definition.metadata?.scope;
    if (expectedScope !== manifest.scope) {
      throw new Error("Candidate skeleton manifest scope does not match the bootstrap activity.");
    }
    const expanded = events.find((event) => event.type === "ActivitiesExpanded");
    const capabilities = Array.isArray(expanded?.payload.capabilities)
      ? expanded!.payload.capabilities.filter((value): value is WorkflowCapability =>
        typeof value === "string"
      ) as WorkflowCapability[]
      : [];
    if (!capabilities.length || !before.reviewPolicy || !before.deliveryTarget) {
      throw new Error("Candidate graph expansion is missing pinned workflow inputs.");
    }
    const extension = buildCandidateExtension({
      modules: manifest.modules,
      scope: manifest.scope,
      capabilities,
      writesData: expanded?.payload.writesData === true,
      deliveryTarget: before.deliveryTarget,
      reviewPolicy: before.reviewPolicy,
      generationPolicyVersion: skeleton.definition.metadata?.generationPolicyVersion === "candidate-generation-policy-v1"
        ? "candidate-generation-policy-v1"
        : "candidate-generation-policy-v1",
      rootActivityId: skeleton.id,
      ...(deltaNamespace ? { candidateNamespace: "delta" as const } : {})
    });
    addCurrentReadinessPreflight(extension);
    const definitions = Object.values(before.activities).map((activity) => activity.definition);
    const effectiveDefinition = {
      schemaVersion: "test-workflow-definition-v1" as const,
      definitionId: before.definitionId,
      definitionVersion: before.definitionVersion,
      requestId: before.requestId,
      planDigest: before.planDigest,
      capabilities,
      writesData: expanded?.payload.writesData === true,
      requestPolicy: before.requestPolicy,
      deliveryTarget: before.deliveryTarget,
      reviewPolicy: before.reviewPolicy,
      activities: [...definitions, ...extension]
    };
    const graphDigest = workflowGraphDigest(effectiveDefinition);
    await this.append(
      "CandidateGraphExpanded",
      "system",
      {
        parentGraphDigest: before.graphDigest,
        graphDigest,
        skeletonDigest,
        rootActivityId: skeleton.id,
        scope: manifest.scope,
        ...(skeleton.definition.kind === "candidate_compiler"
          ? { compilerSpecDigest: candidateCompilerSpecDigest(parseCandidateCompilerSpec(await readFile(
            resolve(this.requestRoot, typeof skeleton.definition.metadata?.specPath === "string"
              ? skeleton.definition.metadata.specPath
              : "candidate-compiler/spec.json"),
            "utf8"
          ))) }
          : {}),
        modules: manifest.modules as unknown as SafeJsonValue,
        activities: extension as unknown as SafeJsonValue
      },
      `${before.runId}/candidate-graph-expanded/${skeleton.id}/${skeletonDigest}/${graphDigest}`,
      before.head
    );
    return this.gate();
  }

  /** Deterministically publish the final candidate package from frozen,
   * independently verified fragments. No provider/model call is made here. */
  async assembleCandidateFragments(input: {
    claimToken: string;
    publishId: string;
    verification: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const assembly = Object.values(before.activities).find((activity) =>
      activity.definition.kind === "candidate_assembly" && activity.state === "RUNNING"
    );
    if (!assembly) {
      throw new Error("candidate-assemble must be running before deterministic assembly.");
    }
    await this.assertCandidateAssemblyInputs(before);
    const deltaNamespace = assembly.definition.metadata?.candidateNamespace === "delta";
    const fragmentRoot = deltaNamespace ? "delta-candidate-fragments" : "candidate-fragments";
    const manifest = parseCandidateFragmentManifest(await readFile(resolve(this.requestRoot, fragmentRoot, "manifest.json"), "utf8"));
    const fragments = new Map(await Promise.all(manifest.modules.map(async (module) => [
      module.id,
      await readFile(resolve(this.requestRoot, fragmentRoot, `${module.id}.md`), "utf8")
    ] as const)));
    const defaults = new Map(
      markdownTableRows(markdownSection(await readFile(this.planPath, "utf8"), "## 请求默认值"))
        .filter((row) => row.length >= 2 && row[0] !== "项目")
        .map((row) => [row[0]!.trim(), row[1]!.replace(/`/gu, "").trim()] as const)
    );
    const cases = deltaNamespace
      ? await this.assembleAffectedCandidateDelta(manifest, fragments)
      : assembleCandidateFragments({
      manifest,
      fragments,
      defaults: {
        testType: defaults.get("测试类型") ?? "",
        environment: defaults.get("目标环境") ?? "",
        dataStrategy: defaults.get("数据策略") ?? ""
      }
    });
    return this.publishArtifactsAndSucceed(assembly.id, {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: input.verification,
      artifacts: [{ targetPath: deltaNamespace ? resolve(this.requestRoot, "cases.md") : this.designAssetPath("cases.md"), content: cases }]
    });
  }

  async succeedActivity(activityId: string, input: ActivitySucceedInput): Promise<WorkflowGateView> {
    return this.succeedActivityInternal(activityId, input, false);
  }

  async succeedCandidateGate(claimToken: string): Promise<{
    report: CandidateGateReport;
    projection: WorkflowGateView;
  }> {
    const before = await this.gate();
    const activity = before.activities["candidate-gate"];
    if (!activity || activity.definition.kind !== "candidate_gate") {
      throw new Error("The current workflow has no candidate-gate-v1 activity.");
    }
    if (activity.state !== "RUNNING") {
      throw new Error("candidate-gate must be running before evaluation.");
    }
    const report = evaluateCandidateGate({
      plan: await readFile(this.planPath, "utf8"),
      cases: await readFile(
        before.requestPolicy.reuseDecision === "affected_rebuild" && before.activities["impact-closure-build"]?.outcome === "bounded"
          ? resolve(this.requestRoot, "cases.md")
          : this.designAssetPath("cases.md"),
        "utf8"
      ),
      speed: await this.reviewSpeed()
    });
    if (report.issues.length > 0) {
      throw new Error(`Candidate gate failed:\n${candidateRepairChecklist(report.issues)
        .map((item) => `[${item.category}] ${item.issues.join("；")}`).join("\n")}`);
    }
    const projection = await this.succeedActivityInternal("candidate-gate", {
      claimToken,
      verification: `${report.schemaVersion}:${report.digest}:${report.profile}`,
      outcome: report.reviewMode
    }, false);
    return { report, projection };
  }

  /**
   * Closes a deterministic review-resolution that the candidate gate has already proved
   * needs no model reviewer.  This is deliberately a separate atomic path:
   * the host cannot turn a skipped review into an ordinary activity success
   * and thereby bypass the plan-artifact/fencing checks.
   */
  async completeDeterministicReviewResolution(input: {
    claimToken: string;
    publishId: string;
    verification: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities["case-review-resolution"];
    if (!activity || activity.definition.kind !== "review_resolution") {
      throw new Error("The current workflow has no case-review-resolution activity.");
    }
    if (!isCurrentWorkflowVersion(before.definitionVersion)) {
      throw new Error(`review-resolution-complete requires the current ${CURRENT_WORKFLOW_VERSION} workflow.`);
    }
    if (activity.state !== "RUNNING") {
      throw new Error("case-review-resolution must be running before deterministic closure.");
    }
    if (before.activities["candidate-gate"]?.outcome !== "deterministic_only") {
      throw new Error("Deterministic review closure requires candidate-gate outcome deterministic_only.");
    }
    const plan = await readFile(this.planPath, "utf8");
    return this.publishArtifactsAndSucceedInternal("case-review-resolution", {
      claimToken: input.claimToken,
      publishId: input.publishId,
      verification: `${input.verification}; candidateGate=deterministic_only`,
      outcome: "converged",
      artifacts: [{ targetPath: this.planPath, content: plan }]
    });
  }

  private async succeedActivityInternal(
    activityId: string,
    input: ActivitySucceedInput,
    publicationValidated: boolean,
    formalExecutionEvidence?: FormalExecutionWorkflowEvidence,
    formalBlockerResolution?: { blockerId: string; evidence: string },
    policyAuthorizationDigest?: string
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (!activity) throw new Error(`Unknown workflow activity: ${activityId}`);
    await this.assertV10ReviewResolutionOutcome(before, input.outcome);
    if (activity.definition.kind === "policy_authorization" && !policyAuthorizationDigest) {
      throw new Error("policy_auto_no_write must use the dedicated deterministic authorization path.");
    }
    const adaptiveAuthorization = activity.definition.kind === "execution_authorization"
      && activity.definition.metadata?.decisionMode === "risk_adaptive";
    if (activity.definition.kind !== "policy_authorization"
      && !adaptiveAuthorization
      && policyAuthorizationDigest) {
      throw new Error(`Activity ${activityId} cannot attach a policy authorization digest.`);
    }
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
      await this.assertV7DesignArtifactStructure(
        activity.definition.kind,
        activity.definition.metadata
      );
      if (activity.definition.kind === "relation_sync") await this.assertRelationProjectionCurrent();
    }
    const completenessEvidence = activity.definition.kind === "completeness_validation"
      ? await this.buildCompletenessEvidence(before)
      : undefined;
    const payload: SafeEventPayload = {
      activityId,
      attempt: activity.attempt,
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
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(policyAuthorizationDigest ? { executionSubjectDigest: policyAuthorizationDigest } : {})
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
      before.definitionVersion === CURRENT_WORKFLOW_VERSION
      && activity.definition.metadata?.completesWorkflow === true
      && (
        activity.definition.kind === "report"
        || (
          before.definitionVersion === CURRENT_WORKFLOW_VERSION
          && activity.definition.metadata.deliveryTarget !== undefined
        )
      )
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
            ...(input.testOutcome ? { testOutcome: input.testOutcome } : {}),
            ...(before.deliveryTarget ? { deliveryTarget: before.deliveryTarget } : {})
          },
          idempotencyKey: `${before.runId}/workflow-completed/${before.deliveryTarget ?? input.testOutcome ?? "none"}`
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
    const next = await this.gate();
    await this.discardTerminalRuntime(next);
    return next;
  }

  async finalizePolicyNoWriteAuthorization(): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities["execution-authorization"];
    const stablePolicy = activity?.definition.kind === "policy_authorization";
    const adaptivePolicy = activity?.definition.kind === "execution_authorization"
      && activity.definition.metadata?.decisionMode === "risk_adaptive";
    if (!activity || (!stablePolicy && !adaptivePolicy)) {
      throw new Error("Workflow does not use policy_auto_no_write authorization.");
    }
    if (activity.state === "SUCCEEDED") return before;
    if (activity.state !== "READY") {
      throw new Error(`policy_auto_no_write is not ready; current state is ${activity.state}.`);
    }
    const subject = await this.executionAuthorizationSubject(before);
    const artifactPath = resolve(this.requestRoot, "execution-authorization.json");
    const raw = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
    if (!isPolicyAutoNoWriteSubject(raw, adaptivePolicy)) {
      throw new Error("policy_auto_no_write subject contains a write-capable scope.");
    }
    const started = await this.startActivity(
      "execution-authorization",
      "policy-auto-no-write"
    );
    return this.succeedActivityInternal(
      "execution-authorization",
      {
        claimToken: started.claimToken,
        verification: `${adaptivePolicy ? "policy_auto_no_write_v1" : "policy_auto_no_write"}:${subject.digest}`,
        outcome: "accepted"
      },
      false,
      undefined,
      undefined,
      subject.digest
    );
  }

  async autoFinalizePolicyNoWriteAuthorizationIfEligible(): Promise<{
    authorized: boolean;
    workflow: WorkflowGateView;
  }> {
    const before = await this.gate();
    const activity = before.activities["execution-authorization"];
    if (activity?.definition.kind !== "execution_authorization"
      || activity.definition.metadata?.decisionMode !== "risk_adaptive"
      || activity.state !== "READY") {
      return { authorized: false, workflow: before };
    }
    const raw = JSON.parse(
      await readFile(resolve(this.requestRoot, "execution-authorization.json"), "utf8")
    ) as Record<string, unknown>;
    if (!isPolicyAutoNoWriteSubject(raw, true)) {
      return { authorized: false, workflow: before };
    }
    return {
      authorized: true,
      workflow: await this.finalizePolicyNoWriteAuthorization()
    };
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
    const next = await this.gate();
    await this.discardTerminalRuntime(next);
    return next;
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
        summary: input.summary
      },
      idempotencyKey: failedKey
    }];
    if (input.scheduleRetry === true && activity.attempt < maxAttempts) {
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

  /**
   * Starts a new attempt after a failed activity's local preconditions have
   * been repaired. The prior failure remains immutable workflow evidence.
   */
  async retryActivity(activityId: string, reason: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[activityId];
    if (!activity || activity.state !== "FAILED") {
      throw new Error(`Activity ${activityId} is not awaiting recovery.`);
    }
    if (["run", "report"].includes(activity.definition.kind)) {
      throw new Error(
        `Activity ${activityId} has execution side effects; use its dedicated reconciliation or scope-reopen recovery path.`
      );
    }
    if (activity.unresolvedExternalOperationIds.length) {
      throw new Error(
        `Activity ${activityId} has unresolved external operations; reconcile them before retrying.`
      );
    }
    if (activity.blockerIds.length) {
      throw new Error(`Activity ${activityId} has active blockers; resolve them before retrying.`);
    }
    const runtime = await this.runtime.read();
    const lease = runtime?.leases[activityId];
    if (lease && !lease.releasedAt && Date.parse(lease.expiresAt) > Date.now()) {
      throw new Error(`Activity ${activityId} still has an active lease; wait for it to expire or reconcile it first.`);
    }
    const unresolvedRuntime = [
      ...Object.values(runtime?.inFlightOperations ?? {})
        .filter((operation) => operation.activityId === activityId)
        .map((operation) => operation.operationId),
      ...Object.values(runtime?.stagingRefs ?? {})
        .filter((staging) => staging.activityId === activityId)
        .map((staging) => staging.publishId)
    ];
    if (unresolvedRuntime.length) {
      throw new Error(
        `Activity ${activityId} has unresolved runtime work: ${unresolvedRuntime.join(", ")}; reconcile it before retrying.`
      );
    }
    const retryAt = new Date().toISOString();
    await this.append(
      "RetryScheduled",
      "agent",
      { activityId, attempt: activity.attempt, retryAt, reason },
      `${before.runId}/${activityId}/attempt-${activity.attempt}/manual-retry/${sha256(reason)}`,
      before.head
    );
    await this.runtime.finalizeRetryableActivity(activityId);
    return this.gate();
  }

  async publishArtifactsAndSucceed(
    activityId: string,
    input: PublishAndSucceedInput
  ): Promise<WorkflowGateView> {
    const projection = await this.gate();
    const activity = projection.activities[activityId];
    if (activity && ["run", "report"].includes(activity.definition.kind)) {
      throw new Error(
        `Activity ${activityId} must use the dedicated formal execution completion path.`
      );
    }
    if (activity?.definition.kind === "review_resolution"
      && projection.definitionVersion === CURRENT_WORKFLOW_VERSION
      && projection.activities["candidate-gate"]?.outcome === "deterministic_only") {
      throw new Error(
        "v10 deterministic review_resolution must use review-resolution-complete."
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
    await this.assertV10ReviewResolutionOutcome(before, input.outcome);
    const handle = await this.handleForClaim(activityId, input.claimToken);
    await this.runtime.assertCanCommit(handle);
    this.assertCandidateGenerationTimingRecorded(activity, await this.events());
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
    if (activity.definition.kind === "build") {
      const prefix = `${safeRelativePath(
        this.workspaceRoot,
        candidateScriptsDirectoryPath(this.workspaceRoot, this.requestId)
      )}/`;
      if (artifacts.length === 0
        || artifacts.some((artifact) => !artifact.targetPath.startsWith(prefix))
        || !artifacts.some((artifact) => artifact.targetPath === `${prefix}execution.manifest.ts`)) {
        throw new Error(
          "Build must publish its candidate scripts, including execution.manifest.ts, only under this request's candidate-scripts directory."
        );
      }
    }
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
    if (activity.definition.kind === "candidate_fragment") {
      const moduleId = activity.definition.metadata?.moduleId;
      const moduleTitle = activity.definition.metadata?.moduleTitle;
      const ruleIds = activity.definition.metadata?.ruleIds;
      const casePrefix = activity.definition.metadata?.casePrefix;
      const caseIds = activity.definition.metadata?.caseIds;
      const ruleCaseIds = activity.definition.metadata?.ruleCaseIds;
      const sourceRefs = activity.definition.metadata?.sourceRefs;
      if (typeof moduleId !== "string" || typeof moduleTitle !== "string" || typeof casePrefix !== "string"
        || !Array.isArray(ruleIds) || !Array.isArray(caseIds) || !Array.isArray(ruleCaseIds) || !Array.isArray(sourceRefs)
        || ruleIds.some((value) => typeof value !== "string")
        || caseIds.some((value) => typeof value !== "string")
        || ruleCaseIds.some((value) => {
          const entry = value as { ruleId?: unknown; caseIds?: unknown };
          return !value || typeof value !== "object" || Array.isArray(value)
            || typeof entry.ruleId !== "string" || !Array.isArray(entry.caseIds)
            || !entry.caseIds.every((caseId: unknown) => typeof caseId === "string");
        })
        || sourceRefs.some((value) => typeof value !== "string")) {
        throw new Error(`Candidate fragment ${activityId} has incomplete frozen module metadata.`);
      }
      const fragment = artifacts[0];
      if (!fragment) throw new Error(`Candidate fragment ${activityId} has no artifact.`);
      validateCandidateFragmentContent(
        typeof fragment.content === "string" ? fragment.content : Buffer.from(fragment.content).toString("utf8"),
        {
          id: moduleId,
          title: moduleTitle,
          ruleIds: ruleIds as string[],
          caseIds: caseIds as string[],
          ruleCaseIds: ruleCaseIds as Array<{ ruleId: string; caseIds: string[] }>,
          casePrefix,
          sourceRefs: sourceRefs as string[],
          generationMode: activity.definition.metadata?.generationMode === "deterministic"
            ? "deterministic"
            : activity.definition.metadata?.generationMode === "mixed"
              ? "mixed"
              : "model",
          deterministicRuleIds: Array.isArray(activity.definition.metadata?.deterministicRuleIds)
            ? activity.definition.metadata!.deterministicRuleIds.filter((value): value is string => typeof value === "string")
            : [],
          modelRuleIds: Array.isArray(activity.definition.metadata?.modelRuleIds)
            ? activity.definition.metadata!.modelRuleIds.filter((value): value is string => typeof value === "string")
            : ruleIds as string[]
        }
      );
    }
    if (activity.definition.kind === "candidate_assembly") {
      await this.assertCandidateAssemblyInputs(before);
    }
    // 发布边界校验：任何活动把 cases.md 用例包发布进工作区前，其内容必须通过
    // 当前 testcase-v1-layered 结构校验（含派生视图漂移检查）。生成时的
    // candidate-gate 只跑一次；评审演进等修订发布若无此边界，漂移会绕过门禁
    // 直接进入后续评审轮（r2 实测：计数漂移与模块归属错位由此漏出）。
    await this.assertCasePackageStructurallyValid(artifacts);
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

  /** A second semantic change cannot reopen the reviewer loop. The
   * resolution record remains auditable, but must route to formal human
   * adjudication instead of publishing another automatic evolution. */
  private async assertV10ReviewResolutionOutcome(
    view: WorkflowGateView,
    outcome: string | undefined
  ): Promise<void> {
    if (view.definitionVersion !== CURRENT_WORKFLOW_VERSION
      || view.activities["case-review-resolution"]?.definition.kind !== "review_resolution"
      || outcome !== "evolve") return;
    const latest = [...await this.events()].reverse().find((event) => {
      if (event.type !== "ReviewBatchStarted" || event.payload.scope === undefined) return false;
      try {
        return parseReviewBatchScope(event.payload.scope).schemaVersion === "review-batch-scope-v1";
      } catch {
        return false;
      }
    });
    if (!latest?.payload.scope) return;
    const scope = parseReviewBatchScope(latest.payload.scope);
    if (hasCompleteReviewBatchScope(scope) && scope.semanticEvolutionCycle >= 1) {
      throw new Error(
        "v1 permits one semantic rereview only; resolve the remaining finding as human_conflict."
      );
    }
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
    if (before.definitionVersion === CURRENT_WORKFLOW_VERSION && input.activityId === "case-confirmation"
      && before.reviewWorkbook?.subjectDigest !== input.subjectDigest) {
      throw new Error("v1 case-confirmation requires the current cases-review.xlsx to be published first.");
    }
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
      if (input.activityId === "case-confirmation") {
        await this.assertCurrentReviewWorkbook(before, input.subjectDigest);
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
        ? PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION
        : before.definitionVersion === CURRENT_WORKFLOW_VERSION && input.activityId === "case-confirmation"
          ? CASE_CONFIRMATION_SUBJECT_SCHEMA_VERSION
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
      ? activity.callbackSubjectSchemaVersion ?? PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION
      : before.definitionVersion === CURRENT_WORKFLOW_VERSION && input.activityId === "case-confirmation"
        ? activity.callbackSubjectSchemaVersion ?? CASE_CONFIRMATION_SUBJECT_SCHEMA_VERSION
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
    if (before.definitionVersion === CURRENT_WORKFLOW_VERSION && input.activityId === "case-confirmation"
      && before.reviewWorkbook?.subjectDigest !== input.subjectDigest) {
      throw new Error("v1 case-confirmation resolution requires the current cases-review.xlsx.");
    }
    const historyOnlyExecutionAuthorization = false;
    const runIntentCaseConfirmation = before.definitionVersion === CURRENT_WORKFLOW_VERSION
      && input.activityId === "case-confirmation"
      && !existsSync(this.planPath);
    if (
      before.definitionVersion === CURRENT_WORKFLOW_VERSION
      && input.activityId === "case-confirmation"
      && input.resolution === "rejected"
    ) {
      throw new Error(
        "v1 case confirmation supports accepted, revision_requested, or cancelled; rejected is unavailable."
      );
    }
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
      if (input.activityId === "case-confirmation" && input.resolution !== "cancelled") {
        await this.assertCurrentReviewWorkbook(before, input.subjectDigest);
      }
    }
    const plan = historyOnlyExecutionAuthorization || runIntentCaseConfirmation
      ? undefined
      : await readFile(this.planPath, "utf8");
    const priorResolution = [...await this.events()].reverse().find((event) =>
      event.type === "CallbackResolved"
      && event.payload.activityId === input.activityId
      && event.payload.callbackId === input.callbackId
      && event.payload.subjectDigest === input.subjectDigest
      && event.payload.resolution === input.resolution
    );
    if (priorResolution) {
      if (plan !== undefined) {
        assertRecordedFormalUserDecision(
          plan,
          input.activityId,
          input.subjectDigest,
          input.resolution
        );
      }
      await this.runtime.finalizeSucceededActivity(input.activityId);
      this.callbackPublicationHandles.delete(input.activityId);
      return this.restartCaseRevisionIfNeeded(await this.gate(), input);
    }
    if (plan !== undefined) {
      assertFormalUserDecision(
        plan,
        input.activityId,
        input.subjectDigest,
        input.resolution
      );
    }
    const publication = decisionTypeForActivity(input.activityId) && !runIntentCaseConfirmation
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
    } else if (
      before.definitionVersion === CURRENT_WORKFLOW_VERSION
      && input.resolution === "accepted"
      && activity?.definition.metadata?.completesWorkflow === true
      && activity.definition.metadata.deliveryTarget === "testcase_only"
    ) {
      await this.appendSequence([
        callbackDraft,
        {
          type: "WorkflowCompleted",
          actorType: "system",
          payload: { deliveryTarget: "testcase_only" },
          idempotencyKey: `${before.runId}/workflow-completed/testcase_only`
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
    const next = await this.gate();
    await this.discardTerminalRuntime(next);
    return this.restartCaseRevisionIfNeeded(next, input);
  }

  private async restartCaseRevisionIfNeeded(
    view: WorkflowGateView,
    input: {
      activityId: string;
      subjectDigest: string;
      resolution: CallbackResolution;
    }
  ): Promise<WorkflowGateView> {
    if (
      view.definitionVersion !== CURRENT_WORKFLOW_VERSION
      || input.activityId !== "case-confirmation"
      || input.resolution !== "revision_requested"
    ) return view;
    const roots = view.activities["impact-location"]
      ? ["impact-location"]
      : view.activities["plan-validation"]
        ? ["plan-validation"]
        : view.activities["source-selection"]
          ? ["source-selection"]
        : [];
    if (!roots.length) {
      throw new Error("Current case revision has no design-generation root to invalidate.");
    }
    return this.invalidateActivities({
      activityIds: roots,
      reason: "case_confirmation_revision_requested",
      subjectDigest: input.subjectDigest
    });
  }

  private async recoverCaseRevisionInvalidation(
    view: WorkflowGateView
  ): Promise<WorkflowGateView> {
    if (view.definitionVersion !== CURRENT_WORKFLOW_VERSION) return view;
    const events = await this.events();
    const resolution = [...events].reverse().find((event) =>
      event.type === "CallbackResolved"
      && event.payload.activityId === "case-confirmation"
    );
    if (
      !resolution
      || resolution.payload.resolution !== "revision_requested"
      || typeof resolution.payload.subjectDigest !== "string"
    ) return view;
    const alreadyInvalidated = events.some((event) =>
      event.seq > resolution.seq
      && event.type === "ActivitiesInvalidated"
      && event.payload.reason === "case_confirmation_revision_requested"
    );
    return alreadyInvalidated
      ? view
      : this.restartCaseRevisionIfNeeded(view, {
          activityId: "case-confirmation",
          subjectDigest: resolution.payload.subjectDigest,
          resolution: "revision_requested"
        });
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
        .filter((candidate) => candidate.definition.kind === "review" && candidate.definition.phase === "case_review")
        .map((candidate) => candidate.id);
      // A stable-design reuse branch has no case-review Activities. Its changed
      // confirmation subject must invalidate the callback itself (and its
      // dependants), not future script-review Activities that happen to share
      // the generic review kind.
      return this.invalidateActivities({
        activityIds: reviewerIds.length ? reviewerIds : [input.activityId],
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
      throw new Error(`${input.activityId} must be the running formal run activity.`);
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
    const repairable = input.outcomeAssessment.allTerminalUnknownsRepairable;
    await this.append(
      "BlockerRaised",
      "runner",
      {
        blockerId,
        affectedActivityIds: ["run"],
        category: "deterministic_outcome_unknown",
        detail: repairable
          ? `Formal execution has ${input.outcomeAssessment.terminalUnknownCount} terminal unknown selector-drift outcome(s), all eligible for controlled repair.`
          : `Formal execution has ${input.outcomeAssessment.terminalUnknownCount} terminal unknown case outcome(s).`,
        resolutionCondition: repairable
          ? "task:resume must reopen engineering, apply the frozen selector repair, and obtain a new execution authorization."
          : "A later trusted attempt must eliminate every terminal unknown and the dedicated formal finalizer must seal the same execution subject."
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
      throw new Error(`${input.activityId} is not the formal run activity.`);
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
    publicationValidated: boolean,
    reconciledOutcome?: string
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
          ...(reconciledOutcome ? { outcome: reconciledOutcome } : {}),
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
      // 正式决定计划发布（callback 类活动）与声明 publishesArtifacts 的活动一样
      // 会通过 ArtifactPublisher 产生暂存；两者都允许在租约过期后丢弃。
      const canAbandonStaging = activity.definition.publishesArtifacts
        || activity.definition.kind === "callback"
        || activity.definition.kind === "execution_authorization";
      if (!canAbandonStaging) {
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
        // 正式决定计划暂存只含请求 plan.md；RECONCILING 且目标冲突意味着
        // 更新的 plan 已随后续发布存在，陈旧候选必须丢弃而不是发布。
        const discardable = recovery.state === "READY_TO_PUBLISH"
          || (recovery.state === "RECONCILING"
            && canAbandonStaging
            && recovery.conflictingTargets.length > 0);
        if (!discardable) {
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
      true,
      activityId === "build" && published.artifacts.some((artifact) =>
        artifact.targetPath.endsWith("/candidate-scripts/formal-web-script-spec.json")
      )
        ? "static_compiled"
        : undefined
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
    selectorRepair?: SafeJsonValue;
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
      ...(input.subjectDigest ? { subjectDigest: input.subjectDigest } : {}),
      ...(input.selectorRepair ? { selectorRepair: input.selectorRepair } : {})
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

  async reopenExecutionScope(
    reason: string,
    selectorRepair?: SafeJsonValue
  ): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (selectorRepair) {
      if (before.definitionVersion !== CURRENT_WORKFLOW_VERSION) {
        throw new Error("Selector repair execution reopen is supported only by v1 workflows.");
      }
      const reuseDecision = before.activities["reuse-assessment"]?.definition.metadata?.decision;
      if (reuseDecision === "direct_execute") {
        throw new Error(
          "direct_execute has no mutable build scope; create a successor affected_rebuild request."
        );
      }
      const run = before.activities.run;
      if (
        !run
        || run.state !== "BLOCKED"
        || run.blockerIds.length !== 1
        || !run.blockerIds[0]?.startsWith("deterministic-outcome-")
      ) {
        throw new Error(
          "Selector repair can reopen only a v1 run blocked by a deterministic unknown outcome."
        );
      }
    }
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
      subjectDigest: authorization.callbackSubjectDigest,
      ...(selectorRepair ? { selectorRepair } : {})
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
    before = await this.recoverCaseRevisionInvalidation(before);
    before = await this.activateEvolvedReviewBatch(before);
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
   * Starts a review batch from frozen, allow-listed inputs.
   */
  async startReviewBatch(input: {
    batchId: string;
    /** Case review is the default; script review is a distinct, frozen subflow. */
    subflow?: "case-review" | "script-review";
    /** Additional controlled sources; plan and all declared packages are added by manager. */
    inputPaths?: string[];
    /** Omit for the initial full review; supply only invalidated reviewers for a targeted re-review. */
    activityIds?: string[];
    affectedRefs?: string[];
    excludedRefs?: string[];
    baseBatchId?: string;
    reason?: string;
    /** Internal current-only path; public callers must use startReviewerRereview. */
    controlledRereview?: boolean;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const reuseMetadata = before.activities["reuse-assessment"]?.definition.metadata;
    const boundedAffected = before.definitionVersion === CURRENT_WORKFLOW_VERSION
      && before.activities["impact-closure-build"]?.outcome === "bounded";
    if (boundedAffected
      && reuseMetadata?.decision === "affected_rebuild") {
      const expectedRefs = Array.isArray(reuseMetadata.affectedCaseIds)
        ? reuseMetadata.affectedCaseIds
          .filter((item): item is string => typeof item === "string")
          .sort()
        : [];
      const requestedRefs = input.affectedRefs ?? expectedRefs;
      if (canonicalJson([...requestedRefs].sort())
        !== canonicalJson(expectedRefs)) {
        throw new Error(
          "Affected rebuild review scope must equal the deterministic affected caseIds."
        );
      }
    }
    const events = await this.events();
    const reviewSubflow = input.subflow ?? "case-review";
    const existingReviewBatches = before.definitionVersion === CURRENT_WORKFLOW_VERSION
      ? events.filter((event) => {
        if (event.type !== "ReviewBatchStarted" || event.payload.scope === undefined) return false;
        try {
          return parseReviewBatchScope(event.payload.scope).requiredActivityIds.some((activityId) =>
            String(before.activities[activityId]?.definition.metadata?.subflow ?? "case-review")
              === reviewSubflow
          );
        } catch {
          return false;
        }
      })
      : [];
    const activeReviewBatches = existingReviewBatches.filter((batch) => {
      const scope = parseReviewBatchScope(batch.payload.scope);
      return !scope.requiredActivityIds.every((activityId) => events.some((event) =>
        event.seq > batch.seq
        && (event.type === "ReviewBatchInvalidated" || event.type === "ActivitiesInvalidated")
        && Array.isArray(event.payload.activityIds)
        && event.payload.activityIds.includes(activityId)
      ));
    });
    if (before.definitionVersion === CURRENT_WORKFLOW_VERSION) {
      if (!activeReviewBatches.length && input.controlledRereview) {
        throw new Error("v1 initial review must use review-batch-start without a parent batch.");
      }
      if (activeReviewBatches.length && !input.controlledRereview) {
        throw new Error("v1 subsequent review must use review-rereview-start --from-batch <id>.");
      }
      if (input.controlledRereview && (!input.baseBatchId
        || input.activityIds?.length || input.affectedRefs?.length
        || input.excludedRefs?.length || input.inputPaths?.length || input.reason)) {
        throw new Error("v1 review-rereview-start derives parent, scope, inputs, and reason; do not override them.");
      }
    }
    const reviewActivities = Object.values(before.activities)
      .filter((activity) =>
        activity.definition.kind === "review"
        && activity.state !== "CANCELLED"
        && String(activity.definition.metadata?.subflow ?? "case-review")
          === reviewSubflow
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const allActivityIds = reviewActivities.map((activity) => activity.id);
    let requiredActivityIds = input.activityIds?.length
      ? [...new Set(input.activityIds)]
      : allActivityIds;
    let affectedRefs = input.affectedRefs ?? (boundedAffected
      ? (Array.isArray(reuseMetadata?.affectedCaseIds)
          ? reuseMetadata.affectedCaseIds.filter((item): item is string => typeof item === "string")
          : [])
      : undefined);
    let reason = input.reason;
    const packagePaths = this.reviewPackagePaths(before);
    const caseRiskAssessment = assessCaseReviewRisk(await Promise.all(
      packagePaths.map((path) => readFile(path, "utf8"))
    ), {
      plan: await readFile(this.reviewDesignPath(), "utf8")
    });
    const activityRoles = reviewActivities.map((activity) => {
      const role = activity.definition.metadata?.role;
      if (typeof role !== "string" || !role.trim()) {
        throw new Error(`Review activity ${activity.id} has no role binding.`);
      }
      return { activityId: activity.id, role };
    });
    const roleCaseIdsByActivity = reviewSubflow === "script-review"
      ? await this.scriptReviewRoleCaseIds(activityRoles)
      : undefined;
    const scriptReviewInputs = reviewSubflow === "script-review"
      ? await this.scriptReviewInputPaths()
      : [];
    const inputPaths = await this.requiredReviewInputPaths([
      ...scriptReviewInputs,
      ...(input.inputPaths ?? [])
    ]);
    const currentIdentity = await this.reviewInputs.inspectCurrent(inputPaths);
    // 评审纪元随正式回调决定刷新：CallbackResolved 事件（非
    // execution_authorization 的正式 callback）携带发布后 plan 的 digest，
    // 使「新增正式用户决定」兑现 blocker resolutionCondition 声明的纪元刷新
    // 语义；无正式决定时回退 WorkflowStarted 冻结的 planDigest。
    const latestFormalDecisionPlanDigest = [...events].reverse().find((event) =>
      event.type === "CallbackResolved"
      && (
        event.payload.activityId === "plan-confirmation"
        || event.payload.activityId === "case-confirmation"
        || event.payload.activityId === "case-review-conflict-decision"
      )
      && typeof event.payload.planDigest === "string"
    )?.payload.planDigest;
    const reviewEpochDigest = sha256(canonicalJson({
      schemaVersion: "review-epoch-v1",
      requestId: before.requestId,
      planSubjectDigest: latestFormalDecisionPlanDigest ?? before.planDigest,
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
      if (baseScope !== undefined && hasCompleteReviewBatchScope(baseScope)) {
        const baseSnapshot = await this.reviewInputs.verify(input.baseBatchId);
        const currentAgainstBase = await this.reviewInputs.inspectCurrent(inputPaths, baseScope);
        if (currentAgainstBase.combinedDigest === baseSnapshot.combinedDigest) {
          return before;
        }
        if (baseScope.reviewEpochDigest === reviewEpochDigest) {
          semanticEvolutionCycle = baseScope.semanticEvolutionCycle + 1;
        }
        // A caller that supplies a predecessor but no manual reviewer scope
        // opts into deterministic role routing. Compare role semantic digests
        // against the frozen predecessor: unchanged roles keep their durable
        // evidence, while only roles whose visible scope changed are reopened.
        if (!input.activityIds?.length && !input.affectedRefs?.length) {
          const route = routeSemanticReview({
            scope: baseScope,
            allActivityIds,
            baselineRoleInputDigests: baseSnapshot.roleInputDigests ?? {},
            currentRoleInputDigests: currentAgainstBase.roleInputDigests ?? {}
          });
          if (!route) return before;
          requiredActivityIds = route.requiredActivityIds;
          affectedRefs = route.affectedRefs;
          reason = "semantic_role_diff";
        }
      }
    }
    const maxSemanticCycles = before.reviewPolicy !== undefined
      && (isDeterministicReviewMode(before.reviewPolicy)
        || isRiskAdaptiveReviewMode(before.reviewPolicy))
      ? before.reviewPolicy.maxSemanticEvolutionCycles
      : Number.POSITIVE_INFINITY;
    if (semanticEvolutionCycle > maxSemanticCycles) {
      const blockerId = `review-convergence-failed-${reviewEpochDigest.slice(0, 12)}`;
      const priorRaise = [...events].reverse().find((event) =>
        event.type === "BlockerRaised" && event.payload.blockerId === blockerId
      );
      if (priorRaise) {
        const resolvedAfter = events.some((event) =>
          event.type === "BlockerResolved"
          && event.payload.blockerId === blockerId
          && event.seq > priorRaise.seq
        );
        // 同 identity 的 BlockerRaised 已存在时，append 会按幂等键静默去重并
        // 让调用方误以为批次已开始；必须显式失败。
        throw new Error(
          resolvedAfter
            ? `Review epoch ${reviewEpochDigest.slice(0, 12)} 已再次超出语义演进上限 ${maxSemanticCycles}；该纪元的收敛断路器只解除一次，请先刷新评审纪元（新增正式用户决定或受控来源）再开启定向批次。`
            : `Blocker ${blockerId} 生效中：本评审纪元的语义演进超过 ${maxSemanticCycles} 轮，请先以正式决定解除该 blocker。`
        );
      }
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
      const submission = latestReviewerSubmission(events, activity.id, dispatch.payload.batchId);
      if (!submission || typeof submission.payload.planEvidenceDigest !== "string") {
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
    const scope = buildCompleteReviewBatchScope({
          allActivityIds,
          requiredActivityIds,
          affectedRefs,
          excludedRefs: input.excludedRefs,
          reason,
          baseBatchId: input.baseBatchId,
          reusableEvidence,
          caseRiskAssessment,
          activityRoles,
          roleCaseIdsByActivity,
          reviewEpochDigest,
          semanticEvolutionCycle,
          // Candidate review always freezes the complete combined scope;
          // impact remains strict-only for safe evidence reuse.
          adaptiveSemanticReview: true
        });
    const readiness = await this.currentReviewReadiness(before, events);
    const snapshot = await this.reviewInputs.freeze(
      input.batchId,
      inputPaths,
      scope
    );
    await this.appendValidatedReviewLifecycleEvent({
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
      ...(before.definitionVersion === CURRENT_WORKFLOW_VERSION
        ? {
          inputDigestAlgorithm: "review-input-digest-v1" as const,
          reviewerExecutionPolicy: "reviewer-execution-policy-v1" as const
        }
        : {}),
      rolePackets: snapshot.rolePackets?.map((packet) => ({
        activityId: packet.activityId,
        role: packet.role,
        path: safeRuntimePacketReference(this.workspaceRoot, packet.packetPath),
        digest: packet.digest,
        packetBytes: packet.packetBytes,
        originalBytes: packet.originalBytes
      })),
      readinessDigest: readiness.digest,
      readinessWarnings: readiness.warnings
    });
    return this.activateEvolvedReviewBatch(await this.gate());
  }

  /** v1 has one deterministic rereview edge. It is intentionally not exposed
   * through startReviewBatch, which remains the initial-batch control plane. */
  async startReviewerRereview(fromBatchId: string): Promise<WorkflowGateView> {
    const before = await this.gate();
    if (before.definitionVersion !== CURRENT_WORKFLOW_VERSION) {
      throw new Error("review-rereview-start is available only for v1 requests.");
    }
    if (before.activities["case-review-resolution"]?.outcome !== "evolve"
      || before.activities["case-review-evolution"]?.state !== "SUCCEEDED") {
      throw new Error("review-rereview-start requires a completed semantic evolution.");
    }
    const events = await this.events();
    const parent = reviewBatchStarted(events, fromBatchId);
    const parentScope = parent?.payload.scope === undefined
      ? undefined
      : parseReviewBatchScope(parent.payload.scope);
    if (!parent || parentScope === undefined || !hasCompleteReviewBatchScope(parentScope)) {
      throw new Error(`v1 rereview parent ${fromBatchId} must be a semantic review batch.`);
    }
    if (parentScope.semanticEvolutionCycle >= 1) {
      throw new Error("v1 semantic rereview budget is exhausted; resolve as human_conflict instead.");
    }
    const inputPaths = await this.requiredReviewInputPaths([]);
    const current = await this.reviewInputs.inspectCurrent(inputPaths, parentScope);
    const frozen = await this.reviewInputs.verify(fromBatchId);
    if (current.combinedDigest === frozen.combinedDigest) return before;
    const batchId = `review-rereview-${sha256(`${fromBatchId}:${current.combinedDigest}`).slice(0, 20)}`;
    if (reviewBatchStarted(events, batchId)) {
      return this.activateEvolvedReviewBatch(await this.gate());
    }
    return this.startReviewBatch({
      batchId,
      baseBatchId: fromBatchId,
      controlledRereview: true
    });
  }

  /**
   * A reviewer-derived evolution can be published before its targeted next
   * batch is frozen. If the process stops between those two durable facts, the
   * old reviewer activities remain SUCCEEDED even though the new batch has
   * valid, undispatched inputs. Reopen only the reviewers explicitly owned by
   * that new batch; reused reviewer evidence and the predecessor batch stay
   * immutable.
   */
  private async activateEvolvedReviewBatch(
    view: WorkflowGateView
  ): Promise<WorkflowGateView> {
    if (
      view.definitionVersion !== CURRENT_WORKFLOW_VERSION
      || view.activities["case-review-resolution"]?.outcome !== "evolve"
      || view.activities["case-review-evolution"]?.state !== "SUCCEEDED"
    ) {
      return view;
    }
    const events = await this.events();
    const batch = [...events].reverse().find((event) => {
      if (event.type !== "ReviewBatchStarted" || event.payload.scope === undefined) {
        return false;
      }
      try {
        const scope = parseReviewBatchScope(event.payload.scope);
        return scope.schemaVersion === "review-batch-scope-v1";
      } catch {
        return false;
      }
    });
    if (
      !batch
      || typeof batch.payload.batchId !== "string"
      || typeof batch.payload.inputDigest !== "string"
    ) {
      return view;
    }
    const scope = parseReviewBatchScope(batch.payload.scope);
    if (scope.schemaVersion !== "review-batch-scope-v1") {
      return view;
    }
    const alreadyActivated = events.some((event) =>
      event.seq > batch.seq
      && (
        (
          ["ReviewerDispatched", "ReviewerSubmitted", "ReviewBatchInvalidated"]
            .includes(event.type)
          && event.payload.batchId === batch.payload.batchId
        )
        || (
          event.type === "ActivitiesInvalidated"
          && Array.isArray(event.payload.activityIds)
          && scope.requiredActivityIds.some((activityId) =>
            (event.payload.activityIds as SafeJsonValue[]).includes(activityId)
          )
        )
      )
    );
    if (alreadyActivated) return view;

    // 比较基准：targeted 批次用 baseBatchId；单 review 活动的 full 批次
    // （requiredActivityIds=全部 review 活动，scope 无 baseBatchId）用本批次
    // 之前最近的 v1 批次。输入无变化时 startReviewBatch 已短路，这里同样不激活。
    const baseInputDigest = scope.baseBatchId
      ? reviewBatchStarted(events, scope.baseBatchId)?.payload.inputDigest
      : (() => {
          const previous = [...events]
            .filter((event) => event.type === "ReviewBatchStarted" && event.seq < batch.seq)
            .reverse()
            .find((event) => {
              if (event.payload.scope === undefined) return false;
              try {
                return parseReviewBatchScope(event.payload.scope).schemaVersion
                  === "review-batch-scope-v1";
              } catch {
                return false;
              }
            });
          return typeof previous?.payload.inputDigest === "string"
            ? previous.payload.inputDigest
            : undefined;
        })();
    if (
      typeof baseInputDigest !== "string"
      || baseInputDigest === batch.payload.inputDigest
    ) {
      return view;
    }
    const succeededReviewers = scope.requiredActivityIds.filter((activityId) =>
      view.activities[activityId]?.definition.kind === "review"
      && view.activities[activityId]?.state === "SUCCEEDED"
    );
    if (!succeededReviewers.length) return view;
    if (scope.requiredActivityIds.some((activityId) => {
      const activity = view.activities[activityId];
      return !activity
        || activity.definition.kind !== "review"
        || !["PENDING", "READY", "SUCCEEDED"].includes(activity.state);
    })) {
      return view;
    }
    const currentInputDigest = await this.verifyOrRepairReviewSnapshot(
      batch.payload.batchId
    );
    if (currentInputDigest !== batch.payload.inputDigest) return view;

    return this.invalidateActivities({
      activityIds: succeededReviewers,
      reason: "activate_evolved_review_batch",
      subjectDigest: batch.payload.inputDigest
    });
  }

  async dispatchReviewer(input: {
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId?: string;
    /** 修订分层 structural 档：确定性分级器替代隔离评审员。 */
    deterministic?: { classifierDigest: string };
  }): Promise<ReviewLifecycleView> {
    const agentTaskId = input.deterministic
      ? deterministicReviewerTaskId(input.activityId, input.batchId)
      : input.agentTaskId ?? "";
    await this.runtime.assertReviewerTaskIsIsolated(agentTaskId);
    const events = await this.events();
    this.assertReviewActivityInBatchScope(events, input.batchId, input.activityId);
    let inputDigest: string;
    try {
      const beforeDispatch = await this.gate();
      if (this.isScriptReviewActivity(beforeDispatch, input.activityId)
        && !await this.hasFrozenScriptReviewInputs(input.batchId)) {
        return this.rotateDriftedReviewBatch(
          input.batchId,
          new ReviewInputDriftError(
            input.batchId,
            "Script-review snapshot omitted the frozen assessment or candidate scripts."
          )
        );
      }
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
          agentTaskId,
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
      inputDigest,
      ...(input.deterministic
        ? { deterministic: { classifierDigest: input.deterministic.classifierDigest } }
        : {})
    });
    try {
      // Runtime handles are disposable. A binding failure must not turn a
      // durable dispatch into a false failure; resume will repair it.
      await this.bindReviewerRuntime({
        ...input,
        agentTaskId,
        status: "running"
      });
      return { ...view, runtimeBinding: "bound" };
    } catch (error) {
      if (error instanceof WorkflowRuntimeConflictError) throw error;
      return { ...view, runtimeBinding: "repair_pending" };
    }
  }

  /** The caller receives this immutable projection after successful dispatch;
   * it must not load the full frozen originals unless auditing is required. */
  async reviewerInputPacket(batchId: string, activityId: string) {
    return this.reviewInputs.readRolePacket(batchId, activityId);
  }

  /** Durable boundary around one host-owned reviewer model request. */
  async startReviewerModelCall(input: {
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId: string;
    supplemental?: boolean;
    invalidResponseDigest?: string;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    const batch = reviewBatchStarted(await this.events(), input.batchId);
    if (!activity || activity.definition.kind !== "review" || activity.state !== "RUNNING") {
      throw new Error(`Reviewer model call requires a running review activity: ${input.activityId}.`);
    }
    if (activity.definition.metadata?.role !== input.role) {
      throw new Error(`Reviewer model call role does not match ${input.activityId}.`);
    }
    if (before.definitionVersion !== CURRENT_WORKFLOW_VERSION || batch?.payload.reviewerExecutionPolicy !== "reviewer-execution-policy-v1") {
      throw new Error("Reviewer model-call budget only applies to isolated reviewer batches.");
    }
    if (input.supplemental && !input.invalidResponseDigest) {
      throw new Error("Supplemental reviewer model call requires --invalid-response-digest.");
    }
    if (input.invalidResponseDigest && !/^[a-f0-9]{64}$/.test(input.invalidResponseDigest)) {
      throw new Error("invalidResponseDigest must be a lowercase SHA-256 digest.");
    }
    await this.runtime.requireReviewerBinding({
      bindingId: reviewerBindingId(input.activityId, input.role, input.batchId),
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      agentTaskId: input.agentTaskId,
      status: "running"
    });
    await this.append(
      "ReviewerModelCallStarted",
      "agent",
      {
        activityId: input.activityId,
        batchId: input.batchId,
        attempt: activity.attempt,
        supplemental: input.supplemental === true,
        ...(input.supplemental ? { priorResponseInvalid: true, invalidResponseDigest: input.invalidResponseDigest! } : {})
      },
      `${before.runId}/review/${input.batchId}/${input.activityId}/attempt-${activity.attempt}/model-call-${input.supplemental ? "supplemental" : "primary"}`,
      before.head
    );
    return this.gate();
  }

  async completeReviewerModelCall(input: {
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId: string;
    resultDigest: string;
  }): Promise<WorkflowGateView> {
    if (!/^[a-f0-9]{64}$/.test(input.resultDigest)) {
      throw new Error("resultDigest must be a lowercase SHA-256 digest.");
    }
    const before = await this.gate();
    const activity = before.activities[input.activityId];
    if (!activity || activity.definition.kind !== "review" || activity.state !== "RUNNING") {
      throw new Error(`Reviewer model call completion requires a running review activity: ${input.activityId}.`);
    }
    if (activity.definition.metadata?.role !== input.role) {
      throw new Error(`Reviewer model call role does not match ${input.activityId}.`);
    }
    await this.runtime.requireReviewerBinding({
      bindingId: reviewerBindingId(input.activityId, input.role, input.batchId),
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      agentTaskId: input.agentTaskId,
      status: "running"
    });
    await this.append(
      "ReviewerModelCallCompleted",
      "agent",
      { activityId: input.activityId, batchId: input.batchId, attempt: activity.attempt, resultDigest: input.resultDigest },
      `${before.runId}/review/${input.batchId}/${input.activityId}/attempt-${activity.attempt}/model-call-completed/${input.resultDigest}`,
      before.head
    );
    return this.gate();
  }

  async submitReviewer(input: {
    activityId: string;
    batchId: string;
    role: string;
    planEvidenceRef?: string;
    agentTaskId?: string;
    /** 修订分层 structural 档：须提供 converged 发现文件与分级器摘要。 */
    deterministic?: { classifierDigest: string; findingsPath: string };
    /** LLM 评审员必须提交发现文件（review-findings-evidence-v1 骨架契约）。 */
    findingsPath?: string;
  }): Promise<ReviewLifecycleView> {
    let conclusion: ReviewerConclusion | undefined;
    let findingsDigest: string | undefined;
    if (input.deterministic) {
      const findingsText = await readFile(input.deterministic.findingsPath, "utf8");
      conclusion = assertReviewerFindingsShape(findingsText, { requireConverged: true });
      findingsDigest = sha256(findingsText);
    } else if (input.findingsPath) {
      const findingsText = await readFile(input.findingsPath, "utf8");
      conclusion = assertReviewerFindingsShape(findingsText);
      findingsDigest = sha256(findingsText);
    } else {
      throw new Error(
        "Isolated reviewer submission requires --findings（发现文件缺失或未提交，评审轮不可收口）。"
      );
    }
    const agentTaskId = input.deterministic
      ? deterministicReviewerTaskId(input.activityId, input.batchId)
      : input.agentTaskId ?? "";
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
    const evidenceRef = input.planEvidenceRef ?? this.reviewEvidencePath();
    const evidenceDigest = sha256(await readFile(evidenceRef));
    const bindingId = reviewerBindingId(input.activityId, input.role, input.batchId);
    await this.runtime.requireReviewerBinding({
      bindingId,
      activityId: input.activityId,
      batchId: input.batchId,
      role: input.role,
      agentTaskId,
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
      ...(input.deterministic
        ? {
          deterministic: { classifierDigest: input.deterministic.classifierDigest },
          findingsDigest,
          conclusion
        }
        : { findingsDigest, conclusion }),
      isolationProofVersion: REVIEWER_ISOLATION_PROOF_VERSION
    });
    try {
      await this.bindReviewerRuntime({
        ...input,
        agentTaskId,
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
    if (!scope || !hasCompleteReviewBatchScope(scope)) {
      throw new Error("Review input recovery requires the complete review-batch-scope-v1.");
    }
    const scriptReview = scope?.requiredActivityIds.some((activityId) =>
      this.isScriptReviewActivity(before, activityId)
    ) ?? false;
    const nextScope = !scriptReview
      ? {
          ...scope,
          semanticEvolutionCycle: scope.semanticEvolutionCycle + 1
        }
      : scope;
    if (
      nextScope !== undefined && hasCompleteReviewBatchScope(nextScope)
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
    const inputPaths = await this.requiredReviewInputPaths(scriptReview
      ? await this.scriptReviewInputPaths()
      : []);
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
          ...(before.definitionVersion === CURRENT_WORKFLOW_VERSION
            ? {
              inputDigestAlgorithm: "review-input-digest-v1",
              reviewerExecutionPolicy: "reviewer-execution-policy-v1"
            }
            : {}),
          ...(snapshot.roleInputDigests
            ? { roleInputDigests: snapshot.roleInputDigests }
            : {}),
          ...(snapshot.rolePackets
            ? {
                rolePackets: snapshot.rolePackets.map((packet) => ({
                  activityId: packet.activityId,
                  role: packet.role,
                  path: safeRuntimePacketReference(this.workspaceRoot, packet.packetPath),
                  digest: packet.digest,
                  packetBytes: packet.packetBytes,
                  originalBytes: packet.originalBytes
                }))
              }
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
    const designPath = this.reviewDesignPath();
    const evidencePath = this.reviewEvidencePath();
    const plan = await readFile(designPath, "utf8");
    const referencedSources = referencedControlledSources(plan)
      .map((reference) => {
        return resolve(
          reference.startsWith("sources/") ? this.workspaceRoot : dirname(designPath),
          reference
        );
      });
    const requestLocalSources = referencedRequestLocalSources(plan).map((reference) =>
      resolve(dirname(designPath), reference)
    );
    return [...new Set([
      evidencePath,
      designPath,
      ...packages,
      ...referencedSources,
      ...requestLocalSources,
      ...additional
    ])];
  }

  private reviewPackagePaths(view: WorkflowProjection): string[] {
    const packageNames = new Set<string>();
    for (const activity of Object.values(view.activities)) {
      if (["case_generation", "candidate_generation", "candidate_assembly"].includes(activity.definition.kind)) {
        const packageName = activity.definition.metadata?.package;
        if (typeof packageName !== "string") {
          throw new Error(`Case activity ${activity.id} has no package binding.`);
        }
        packageNames.add(packageName);
      }
      if (Array.isArray(activity.definition.metadata?.casePackages)) {
        for (const packageName of activity.definition.metadata.casePackages) {
          if (typeof packageName === "string" && isCasesPackageName(packageName)) {
            packageNames.add(packageName);
          }
        }
      }
    }
    const deltaAssembly = Object.values(view.activities).some((activity) =>
      activity.definition.kind === "candidate_assembly"
      && activity.definition.metadata?.candidateNamespace === "delta"
    );
    return [...packageNames]
      .sort()
      .map((packageName) => deltaAssembly
        ? resolve(this.requestRoot, packageName)
        : resolve(this.designAssetPath(packageName)));
  }

  /** Script reviewers must receive the exact assessment and candidate files
   * that the static gate assessed; callers cannot accidentally omit them. */
  private async scriptReviewInputPaths(): Promise<string[]> {
    const assessmentPath = resolve(this.requestRoot, "script-review-assessment.json");
    if (!existsSync(assessmentPath)) {
      throw new Error("Script review requires the frozen script-review-assessment.json.");
    }
    const assessment = JSON.parse(await readFile(assessmentPath, "utf8")) as {
      reviewerScopes?: unknown;
    };
    if (!assessment.reviewerScopes || typeof assessment.reviewerScopes !== "object"
      || Array.isArray(assessment.reviewerScopes)) {
      throw new Error("Frozen script-review assessment has no reviewer script scope.");
    }
    const paths = Object.values(assessment.reviewerScopes).flatMap((scope) => {
      if (!scope || typeof scope !== "object" || Array.isArray(scope)) return [];
      const scriptPaths = (scope as { scriptPaths?: unknown }).scriptPaths;
      return Array.isArray(scriptPaths)
        ? scriptPaths.filter((path): path is string => typeof path === "string")
        : [];
    });
    if (!paths.length) {
      throw new Error("Frozen script-review assessment has an empty reviewer script scope.");
    }
    return [assessmentPath, ...paths];
  }

  /** The script-review assessment is the authority for risk-routed reviewer
   * scope. Convert its role names to workflow activity ids before freezing the
   * review batch so packets cannot silently widen to every case. */
  private async scriptReviewRoleCaseIds(
    activityRoles: Array<{ activityId: string; role: string }>
  ): Promise<Record<string, string[]>> {
    const assessmentPath = resolve(this.requestRoot, "script-review-assessment.json");
    const assessment = JSON.parse(await readFile(assessmentPath, "utf8")) as {
      reviewerScopes?: unknown;
    };
    if (!assessment.reviewerScopes || typeof assessment.reviewerScopes !== "object"
      || Array.isArray(assessment.reviewerScopes)) {
      throw new Error("Frozen script-review assessment has no reviewer case scope.");
    }
    const scopes = assessment.reviewerScopes as Record<string, unknown>;
    const resolved: Record<string, string[]> = {};
    for (const { activityId, role } of activityRoles) {
      const scope = scopes[role];
      if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
        throw new Error(`Frozen script-review assessment has no ${role} scope.`);
      }
      const caseIds = (scope as { caseIds?: unknown }).caseIds;
      if (!Array.isArray(caseIds)
        || !caseIds.every((caseId) => typeof caseId === "string" && caseId.trim())) {
        throw new Error(`Frozen script-review assessment has an invalid ${role} case scope.`);
      }
      const normalized = [...new Set(caseIds.map((caseId) => caseId.trim()))].sort();
      if (!normalized.length && role !== "execution_safety") {
        throw new Error(`Frozen script-review assessment has an empty ${role} case scope.`);
      }
      resolved[activityId] = normalized;
    }
    return resolved;
  }

  private isScriptReviewActivity(view: WorkflowProjection, activityId: string): boolean {
    return view.activities[activityId]?.definition.metadata?.subflow === "script-review";
  }

  private async hasFrozenScriptReviewInputs(batchId: string): Promise<boolean> {
    const frozen = await this.reviewInputs.verify(batchId);
    const frozenPaths = new Set(frozen.artifacts.map((artifact) =>
      resolve(this.workspaceRoot, artifact.sourcePath)
    ));
    return (await this.scriptReviewInputPaths()).every((path) =>
      frozenPaths.has(resolve(this.workspaceRoot, path))
    );
  }

  private async currentReviewReadiness(
    view: WorkflowProjection,
    events: readonly WorkflowEvent[]
  ): Promise<ReturnType<typeof evaluateReviewReadiness>> {
    const packagePaths = this.reviewPackagePaths(view);
    const plan = await readFile(this.reviewDesignPath(), "utf8");
    const packages = Object.fromEntries(await Promise.all(
      packagePaths.map(async (path) => [
        basename(path),
        await readFile(path, "utf8")
      ])
    ));
    if (view.definitionVersion === CURRENT_WORKFLOW_VERSION) {
      this.assertCurrentDesignText(plan, packages);
    }
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

  private async assertV7DesignArtifactStructure(
    kind: WorkflowProjection["activities"][string]["definition"]["kind"],
    metadata: WorkflowProjection["activities"][string]["definition"]["metadata"]
  ): Promise<void> {
    if (kind === "candidate_generation") {
      const packageName = metadata?.package;
      if (packageName !== "cases.md") {
        throw new Error("Version-7 candidate generation must bind cases.md.");
      }
      this.assertCurrentDesignText(
        await readFile(this.planPath, "utf8"),
        { [packageName]: await readFile(resolve(this.designAssetPath(packageName)), "utf8") }
      );
      return;
    }
    if (kind === "plan_validation") {
      this.assertCurrentDesignText(await readFile(this.planPath, "utf8"));
      return;
    }
    if (kind !== "case_generation") return;
    const packageName = metadata?.package;
    if (typeof packageName !== "string") {
      throw new Error("Version-7 case generation has no package binding.");
    }
    this.assertCurrentDesignText(undefined, {
      [packageName]: await readFile(resolve(this.designAssetPath(packageName)), "utf8")
    });
  }

  private assertCurrentDesignText(
    plan?: string,
    packages: Record<string, string> = {}
  ): void {
    if (plan !== undefined) {
      for (const marker of ["test-design-index-v1", "rule-design-ledger-v1", "case-relation-projection-v1"]) {
        if (!plan.includes(marker)) {
          throw new Error(`Current plan.md must use ${marker}.`);
        }
      }
    }
    for (const [name, content] of Object.entries(packages)) {
      const expectedVersion = "testcase-v1-layered";
      if (plan !== undefined && !plan.includes(expectedVersion)) {
        throw new Error(`Version-7 candidate-generation plan.md must declare ${expectedVersion}.`);
      }
      if (!new RegExp(`结构版本[：:]\\s*${expectedVersion}\\b`, "u").test(content)) {
        throw new Error(`Version-7 case package ${name} must use ${expectedVersion}.`);
      }
    }
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
    if (scope !== undefined && hasCompleteReviewBatchScope(scope)) {
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
    inputDigestAlgorithm?: "review-input-digest-v1";
    reviewerExecutionPolicy?: "reviewer-execution-policy-v1";
    rolePackets?: SafeJsonValue;
    isolationProofVersion?: typeof REVIEWER_ISOLATION_PROOF_VERSION;
  }): Promise<WorkflowGateView> {
    const before = await this.gate();
    let normalizedInput = input;
    if (input.type === "ReviewerSubmitted") {
      if (!input.planEvidenceRef || !input.planEvidenceDigest) {
        throw new Error("Reviewer submission requires plan evidence path and digest.");
      }
      const evidenceRef = safeRelativePath(this.workspaceRoot, input.planEvidenceRef);
      const expectedPlanRef = safeRelativePath(this.workspaceRoot, this.reviewEvidencePath());
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
    const events = await this.events();
    const adaptiveProfile = [...events].reverse().find((event) =>
      event.type === "ActivitySucceeded"
      && event.payload.activityId === "candidate-gate"
      && typeof event.payload.verification === "string"
    )?.payload.verification;
    const leanAdaptiveReview = before.reviewPolicy !== undefined && isRiskAdaptiveReviewMode(before.reviewPolicy)
      && typeof adaptiveProfile === "string"
      && adaptiveProfile.endsWith(":lean")
      && activity.definition.metadata?.failurePolicy === "lean_warning_strict_block";
    const maxAttempts = before.reviewPolicy?.maxAttemptsPerRole ?? 3;
    const failedKey = `${before.runId}/review/${input.batchId}/${input.activityId}/attempt-${activity.attempt}/failed/${sha256(input.summary)}`;
    if (leanAdaptiveReview) {
      await this.appendSequence([
        {
          type: "ActivityFailed",
          actorType: "reviewer",
          payload: {
            activityId: input.activityId,
            batchId: input.batchId,
            attempt: activity.attempt,
            summary: input.summary
          },
          idempotencyKey: failedKey
        },
        {
          type: "ReviewerWaived",
          actorType: "system",
          payload: {
            activityId: input.activityId,
            batchId: input.batchId,
            profile: "lean",
            warning: input.summary
          },
          idempotencyKey: `${before.runId}/review/${input.batchId}/${input.activityId}/waived/${sha256(input.summary)}`
        }
      ], before.head);
      return this.gate();
    }
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
    const next = await this.gate();
    await this.discardTerminalRuntime(next);
    return next;
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
    const next = await this.gate();
    await this.discardTerminalRuntime(next);
    return next;
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
      const runIntentCaseConfirmation = projection.definitionVersion === CURRENT_WORKFLOW_VERSION
        && activityId === "case-confirmation"
        && activity.definition.metadata?.reuseProtocol === "run-intent-v1";
      if (!runIntentCaseConfirmation) {
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
      || schemaVersion !== "execution-authorization-v1"
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
      "mode",
      "sourceRequestId",
      "suiteId",
      "suiteVersion",
      "suiteManifestPath",
      "suiteManifestDigest",
      "suitePlanPath",
      "formalManifestPath",
      "entryScriptPaths",
      "authorizationMode",
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
      "repairContext",
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
    if (record.mode !== "request" && record.mode !== "stable_suite") {
      throw new Error("Execution authorization subject has an invalid mode.");
    }
    const suiteFields = [
      "sourceRequestId", "suiteId", "suiteVersion", "suiteManifestPath",
      "suiteManifestDigest", "suitePlanPath", "formalManifestPath",
      "entryScriptPaths", "authorizationMode"
    ];
    if (record.mode === "request" && suiteFields.some((field) => record[field] !== undefined)) {
      throw new Error("Request execution authorization cannot contain stable suite fields.");
    }
    if (record.mode === "stable_suite"
      && (record.repairContext !== undefined || suiteFields.some((field) => record[field] === undefined))) {
      throw new Error("Stable suite execution authorization has incomplete or conflicting mode fields.");
    }
    assertExecutionAuthorizationInputsCurrent(
      record,
      this.workspaceRoot,
      record.mode === "stable_suite"
        ? resolve(this.workspaceRoot, String(record.suitePlanPath ?? ""))
        : this.planPath
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
    const acceptedAuthorizationDigest = authorization.callbackSubjectDigest
      ?? [...await this.events()].reverse().find((event) =>
        event.type === "ActivitySucceeded"
        && event.payload.activityId === "execution-authorization"
      )?.payload.executionSubjectDigest;
    if (
      subject.digest !== evidence.executionSubjectDigest
      || acceptedAuthorizationDigest !== evidence.executionSubjectDigest
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
    if (schemaVersion !== PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported plan confirmation subject schema ${schemaVersion}.`
      );
    }
    const projection = planConfirmationSubjectProjection(plan);
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
        "plan-confirmation-subject-v1 requires requestId, included top-level scope, test type, and target environment."
      );
    }
    return sha256(projection);
  }

  private isTimedCandidateGeneration(activity: ActivityProjection): boolean {
    if (activity.definition.metadata?.generationPolicyVersion !== "candidate-generation-policy-v1") return false;
    if (activity.definition.kind === "candidate_compiler") return true;
    return activity.definition.kind === "candidate_fragment"
      && activity.definition.metadata?.generationMode !== "deterministic";
  }

  private async candidatePreflightSourceTexts(plan: string): Promise<{
    texts: Map<string, string[]>;
    documents: Map<string, CandidateSourceDocument>;
    diagnostics: Map<string, string>;
  }> {
    const texts = new Map<string, string[]>();
    const documents = new Map<string, CandidateSourceDocument>();
    const diagnostics = new Map<string, string>();
    for (const source of parseCandidatePlanSourceLinks(plan)) {
      const path = resolve(this.requestRoot, source.path);
      const workspaceRelative = relative(this.workspaceRoot, path).split(sep).join("/");
      if (workspaceRelative.startsWith("../") || workspaceRelative === ".." || !workspaceRelative.startsWith("sources/")) {
        diagnostics.set(source.sourceId, `${source.sourceId} 相对 request 根目录路径错误，无法核验逐字引文。`);
        continue;
      }
      try {
        const document = await this.readCandidatePreflightSourceDocument(path);
        if (!document) {
          const extension = path.toLowerCase().split(".").at(-1) ?? "";
          diagnostics.set(source.sourceId, extension === "docx"
            ? `${source.sourceId} 的 DOCX 无正文，无法核验逐字引文。`
            : extension === "pdf"
              ? `${source.sourceId} 的 PDF 无可提取正文，无法核验页码事实范围。`
              : `${source.sourceId} 没有可校验的受控文本来源，无法核验逐字引文。`);
          continue;
        }
        const text = document.units.join("\n");
        const existing = texts.get(source.sourceId) ?? [];
        existing.push(text);
        texts.set(source.sourceId, existing);
        if (documents.has(source.sourceId)) {
          diagnostics.set(source.sourceId, `${source.sourceId} 登记了多个来源正文，无法确定唯一事实范围。`);
          continue;
        }
        documents.set(source.sourceId, document);
      } catch {
        const extension = path.toLowerCase().split(".").at(-1) ?? "";
        diagnostics.set(source.sourceId, extension === "docx"
          ? `${source.sourceId} 的 DOCX 无正文，无法核验逐字引文。`
          : extension === "pdf"
            ? `${source.sourceId} 的 PDF 无可提取正文，无法核验页码事实范围。`
            : `${source.sourceId} 没有可校验的受控文本来源，无法核验逐字引文。`);
      }
    }
    return { texts, documents, diagnostics };
  }

  private async readCandidatePreflightSourceDocument(path: string): Promise<CandidateSourceDocument | undefined> {
    const extension = path.toLowerCase().split(".").at(-1) ?? "";
    if (["md", "txt", "html", "htm", "json", "yaml", "yml", "csv"].includes(extension)) {
      return { kind: "line", units: (await readFile(path, "utf8")).split(/\r?\n/gu) };
    }
    if (extension === "pdf") {
      const { stdout } = await execFile("pdftotext", ["-layout", path, "-"], {
        maxBuffer: 8 * 1024 * 1024
      });
      const pages = stdout.toString().split("\f");
      if (pages.at(-1)?.trim() === "") pages.pop();
      const units = pages.map((page) => page.trim());
      return units.some(Boolean) ? { kind: "page", units } : undefined;
    }
    if (extension !== "docx") return undefined;
    const { stdout } = await execFile("unzip", ["-p", path, "word/document.xml"], {
      maxBuffer: 8 * 1024 * 1024
    });
    const xml = stdout.toString();
    const decode = (value: string) => value
      .replace(/&amp;/gu, "&")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&quot;/gu, "\"")
      .replace(/&apos;/gu, "'");
    const units = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gu)]
      .map((paragraph) => [...paragraph[1]!.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
        .map((match) => decode(match[1]!)).join("").trim());
    return units.some(Boolean) ? { kind: "paragraph", units } : undefined;
  }

  private assertCandidateGenerationTimingRecorded(
    activity: ActivityProjection,
    events: WorkflowEvent[]
  ): void {
    if (!this.isTimedCandidateGeneration(activity)) return;
    const found = events.some((event) => event.type === "CandidateGenerationStarted"
      && event.payload.activityId === activity.id
      && event.payload.attempt === activity.attempt);
    if (!found) {
      throw new Error(`${activity.id} cannot publish before CandidateGenerationStarted is recorded for its current attempt.`);
    }
  }

  private assertArtifactOutputBinding(
    kind: WorkflowProjection["activities"][string]["definition"]["kind"],
    metadata: WorkflowProjection["activities"][string]["definition"]["metadata"],
    outputPaths: string[],
    projection: WorkflowProjection
  ): void {
    const packagePaths = Object.values(projection.activities)
      .filter((activity) => ["case_generation", "candidate_generation", "candidate_assembly"].includes(activity.definition.kind))
      .map((activity) => {
        const packageName = activity.definition.metadata?.package;
        if (typeof packageName !== "string") {
          throw new Error(`Case activity ${activity.id} has no package binding.`);
        }
        return safeRelativePath(
          this.workspaceRoot,
          resolve(this.designAssetPath(packageName))
        );
      });
    let expected: string[] | undefined;
    if (kind === "plan_validation" || kind === "review_resolution" || kind === "candidate_preflight") {
      expected = [safeRelativePath(this.workspaceRoot, this.planPath)];
    } else if (kind === "candidate_generation") {
      const packageName = metadata?.package;
      if (packageName !== "cases.md") {
        throw new Error("Candidate generation must publish the single cases.md artifact.");
      }
      expected = [
        safeRelativePath(this.workspaceRoot, this.planPath),
        safeRelativePath(this.workspaceRoot, resolve(this.designAssetPath(packageName)))
      ];
    } else if (kind === "case_generation") {
      const packageName = metadata?.package;
      if (typeof packageName !== "string") {
        throw new Error("Case generation is missing its package binding.");
      }
      expected = [
        safeRelativePath(this.workspaceRoot, resolve(this.designAssetPath(packageName)))
      ];
    } else if (kind === "candidate_skeleton") {
      const manifestPath = typeof metadata?.manifestPath === "string"
        ? metadata.manifestPath
        : "candidate-fragments/manifest.json";
      expected = [safeRelativePath(
        this.workspaceRoot,
        resolve(this.requestRoot, manifestPath)
      )];
    } else if (kind === "candidate_compiler") {
      const specPath = typeof metadata?.specPath === "string" ? metadata.specPath : "candidate-compiler/spec.json";
      const manifestPath = typeof metadata?.manifestPath === "string" ? metadata.manifestPath : "candidate-fragments/manifest.json";
      expected = [
        safeRelativePath(this.workspaceRoot, resolve(this.requestRoot, specPath)),
        safeRelativePath(this.workspaceRoot, resolve(this.requestRoot, manifestPath))
      ];
    } else if (kind === "candidate_fragment") {
      const fragmentPath = metadata?.fragmentPath;
      if (typeof fragmentPath !== "string" || !/^(?:delta-)?candidate-fragments\/[a-z0-9][a-z0-9-]*\.md$/u.test(fragmentPath)) {
        throw new Error("Candidate fragment is missing its controlled fragmentPath binding.");
      }
      expected = [safeRelativePath(this.workspaceRoot, resolve(this.requestRoot, fragmentPath))];
    } else if (kind === "candidate_assembly") {
      const packageName = metadata?.package;
      if (packageName !== "cases.md") {
        throw new Error("Candidate assembly must publish the single cases.md package.");
      }
      const requestLocal = metadata?.candidateNamespace === "delta";
      expected = [safeRelativePath(this.workspaceRoot, requestLocal
        ? resolve(this.requestRoot, packageName)
        : resolve(this.designAssetPath(packageName)))];
    } else if (
      kind === "relation_sync"
      || kind === "automatic_evolution"
      || (kind === "engineering" && metadata?.scope === "affected_only")
    ) {
      const declaredPackages = kind === "engineering" && Array.isArray(metadata?.casePackages)
        ? metadata.casePackages
          .filter((value): value is string => typeof value === "string")
          .map((packageName) => safeRelativePath(
            this.workspaceRoot,
            resolve(this.designAssetPath(packageName))
          ))
        : packagePaths;
      expected = [
        safeRelativePath(this.workspaceRoot, this.planPath),
        ...declaredPackages
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

  private async assertCandidateAssemblyInputs(view: WorkflowGateView): Promise<void> {
    const assembly = Object.values(view.activities).find((activity) =>
      activity.definition.kind === "candidate_assembly" && activity.state === "RUNNING"
    );
    if (!assembly) throw new Error("Candidate assembly is not running.");
    const deltaNamespace = assembly.definition.metadata?.candidateNamespace === "delta";
    const prefix = deltaNamespace ? "delta-" : "";
    const fragmentRoot = `${prefix}candidate-fragments`;
    const manifestPath = resolve(this.requestRoot, fragmentRoot, "manifest.json");
    const manifest = parseCandidateFragmentManifest(await readFile(manifestPath, "utf8"));
    const events = await this.events();
    for (const module of manifest.modules) {
      const activityId = `${prefix}candidate-fragment-${module.id}`;
      if (view.activities[activityId]?.state !== "SUCCEEDED") {
        throw new Error(`Candidate assembly requires completed fragment ${module.id}.`);
      }
      const path = resolve(this.requestRoot, fragmentRoot, `${module.id}.md`);
      const content = await readFile(path, "utf8");
      validateCandidateFragmentContent(content, module);
      const relativePath = safeRelativePath(this.workspaceRoot, path);
      const success = [...events].reverse().find((event) =>
        event.type === "ActivitySucceeded" && event.payload.activityId === activityId
      );
      const output = Array.isArray(success?.payload.outputDigests)
        ? success!.payload.outputDigests.find((item) =>
          item && typeof item === "object" && !Array.isArray(item)
          && (item as Record<string, unknown>).path === relativePath
        ) as Record<string, unknown> | undefined
        : undefined;
      if (output?.digest !== sha256(content)) {
        throw new Error(`Candidate fragment ${module.id} differs from its published digest.`);
      }
    }
  }

  private async assembleAffectedCandidateDelta(
    manifest: ReturnType<typeof parseCandidateFragmentManifest>,
    fragments: ReadonlyMap<string, string>
  ): Promise<string> {
    const closure = JSON.parse(await readFile(resolve(this.requestRoot, "impact-closure.json"), "utf8")) as ImpactClosure;
    const delta = parseDesignDelta(await readFile(resolve(this.requestRoot, "design-delta.json"), "utf8"), closure);
    const suite = await loadStableDesignSuite(closure.suiteId, this.workspaceRoot);
    const baselinePath = resolve(this.workspaceRoot, suite.casePackages[0]?.path ?? "");
    if (!baselinePath || !existsSync(baselinePath)) throw new Error("Affected delta assembly requires its stable cases.md baseline.");
    const baseline = await readFile(baselinePath, "utf8");
    const baselineDocument = parseTestcaseDocument(baseline);
    const manifestRules = [...new Set(manifest.modules.flatMap((module) => module.ruleIds))].sort();
    if (manifest.scope !== "affected" || manifestRules.length !== delta.ruleIds.length
      || manifestRules.some((ruleId) => !delta.ruleIds.includes(ruleId))) {
      throw new Error("Affected candidate fragments must exactly match the frozen design delta RULE scope.");
    }
    const affectedCaseIds = new Set(delta.caseIds);
    return assembleCandidateDelta({
      baseline,
      manifest,
      fragments,
      affectedRuleIds: delta.ruleIds,
      unaffectedCaseIds: baselineDocument.cases
        .map((testcase) => testcase.caseId)
        .filter((caseId) => !affectedCaseIds.has(caseId))
    });
  }

  /**
   * 发布边界校验：任何用例包（解析为当前 testcase-v1-layered 版本的文档）
   * 发布进工作区前必须通过结构校验（含派生视图漂移检查）。按内容探测而非
   * 文件名，覆盖 cases.md / cases-<feature>.md 等包名；历史版本文档仅允许
   * 作为归档证据回放，不拦截。生成时的 candidate-gate 只跑一次，评审演进
   * 等修订发布若无此边界，漂移会绕过门禁进入后续评审轮。
   */
  private async assertCasePackageStructurallyValid(
    artifacts: Array<{ targetPath: string; content: ArtifactContent }>
  ): Promise<void> {
    for (const artifact of artifacts) {
      const text = typeof artifact.content === "string"
        ? artifact.content
        : Buffer.from(artifact.content).toString("utf8");
      const parsed = (() => {
        try {
          return parseTestcaseDocument(text);
        } catch {
          return undefined;
        }
      })();
      if (!parsed || !isCurrentTestcaseDocumentVersion(parsed.version)) continue;
      const issues = validateTestcaseV6Layered(text);
      if (issues.length) {
        throw new Error(
          `Refusing to publish structurally invalid case package (${artifact.targetPath}): ${issues.join(" ")}`
        );
      }
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
    const view = await this.gate();
    const deterministicOnly = view.activities["candidate-gate"]?.outcome === "deterministic_only";
    if (deterministicOnly) {
      // candidate-gate has already checked the current plan/cases pair before
      // recording deterministic_only.
      const baseline = await readFile(this.planPath, "utf8");
      if (
        reviewResolutionFrozenProjection(candidateText)
        !== reviewResolutionFrozenProjection(baseline)
      ) {
        throw new Error(
          "deterministic review_resolution may change only the review record section."
        );
      }
      return;
    }
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
    kind: "relation_sync" | "automatic_evolution" | "engineering",
    candidatePlan: string
  ): Promise<void> {
    const candidateSubject = this.planConfirmationSubjectDigest(
      candidatePlan,
      PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION
    );
    const confirmation = projection.activities["plan-confirmation"];
    const acceptedSubject = confirmation?.callbackSubjectSchemaVersion
      === PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION
      ? confirmation.callbackSubjectDigest
      : undefined;
    const baselineSubject = acceptedSubject ?? this.planConfirmationSubjectDigest(
      await readFile(this.planPath, "utf8"),
      PLAN_CONFIRMATION_SUBJECT_SCHEMA_VERSION
    );
    if (kind === "engineering") {
      if (candidateSubject !== baselineSubject) {
        throw new Error(
          "affected_rebuild cannot change global scope, environment, data, permission, or safety boundaries; use full_replan."
        );
      }
      return;
    }
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
      && !(kind === "engineering"
        && projection.activities[activityId]?.definition.metadata?.scope === "affected_only")
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
        kind as "relation_sync" | "automatic_evolution" | "engineering",
        candidate.toString("utf8")
      );
    }
  }

  /** The relation activity may only close after its published request view is
   * already a strict, read-only relation projection. */
  private async assertRelationProjectionCurrent(): Promise<void> {
    const plan = await readFile(this.planPath, "utf8");
    const caseRoots = this.suiteRoot
      ? [this.requestRoot, this.suiteRoot]
      : [this.requestRoot];
    const files: Record<string, string> = {};
    for (const root of caseRoots) {
      const entries = await readdir(root).catch(() => [] as string[]);
      for (const name of entries.filter((entry) => isCasesPackageName(entry))) {
        if (files[name] === undefined) {
          files[name] = await readFile(resolve(root, name), "utf8");
        }
      }
    }
    this.assertRelationProjection(plan, files);
  }

  private assertRelationProjection(plan: string, packages: Record<string, string>): void {
    if (!plan.includes(CASE_RELATION_PROJECTION_MARKER_V1)) {
      throw new Error("Relationship synchronization requires case-relation-projection-v1.");
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
      else if (filename === "cases.md" || /^cases-[a-z0-9][a-z0-9-]*\.md$/.test(filename)) files[filename] = content;
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
      if (typeof packageName !== "string" || !isCasesPackageName(packageName)) {
        throw new Error(`Case package ${activity.id} has an invalid package filename.`);
      }
      const expectedPath = safeRelativePath(
        this.workspaceRoot,
        resolve(this.designAssetPath(packageName))
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
    if (identity.definitionVersion !== CURRENT_WORKFLOW_VERSION) {
      throw new Error("Only the current v1 baseline accepts workflow events.");
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

  private async discardTerminalRuntime(view: WorkflowGateView): Promise<void> {
    if (!["SUCCEEDED", "CANCELLED"].includes(view.workflowState)) return;
    await this.runtime.discardTerminalRuntime();
  }

  private async appendSequence(
    drafts: readonly WorkflowEventDraft[],
    expectedHead: WorkflowHistoryHead
  ): Promise<WorkflowEvent[]> {
    if (!drafts.length) throw new Error("Workflow event sequence must not be empty.");
    const identity = eventIdentity(await this.events());
    if (identity.definitionVersion !== CURRENT_WORKFLOW_VERSION) {
      throw new Error("Only the current v1 baseline accepts workflow events.");
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
  const statuses = {
    not_started: "未开始",
    active: "进行中",
    waiting: "等待",
    succeeded: "完成",
    failed: "失败"
  } as const;
  const phases = view.definitionVersion === CURRENT_WORKFLOW_VERSION
    ? projectCurrentUserPhases(view)
    : projectSimplifiedPhases(view);
  const labels: Record<string, string> = view.definitionVersion === CURRENT_WORKFLOW_VERSION
    ? {
        design: "用例设计",
        engineering: "脚本",
        execution: "执行",
        reporting: "报告"
      }
    : {
        planning: "计划",
        cases: "用例",
        review: "评审",
        engineering: "脚本",
        execution: "执行",
        reporting: "报告"
      };
  const current = phases.find((phase) =>
    phase.status === "waiting" || phase.status === "active"
  ) ?? [...phases].reverse().find((phase) =>
    phase.status === "failed" || phase.status === "succeeded"
  );
  const selectorRepairLabels = {
    incident_recorded: "incident 已记录，待安全回退",
    script_repair: "脚本修复中",
    reauthorization_required: "等待新执行清单确认"
  } as const;
  const deliveryTargetLabels = {
    testcase_only: "用例交付",
    script_only: "脚本交付",
    full_run: "完整执行"
  } as const;
  const compiler = Object.values(view.activities).find((activity) => activity.definition.kind === "candidate_compiler");
  const fragments = Object.values(view.activities).filter((activity) => activity.definition.kind === "candidate_fragment");
  const deterministic = fragments.filter((activity) => activity.definition.metadata?.generationMode === "deterministic").length;
  const model = fragments.length - deterministic;
  const deterministicRules = fragments.flatMap((activity) => Array.isArray(activity.definition.metadata?.deterministicRuleIds)
    ? activity.definition.metadata!.deterministicRuleIds : []).filter((ruleId): ruleId is string => typeof ruleId === "string").length;
  const modelRules = fragments.flatMap((activity) => Array.isArray(activity.definition.metadata?.modelRuleIds)
    ? activity.definition.metadata!.modelRuleIds : []).filter((ruleId): ruleId is string => typeof ruleId === "string").length;
  const runningFragments = fragments.filter((activity) => activity.state === "RUNNING").length;
  const readyFragments = fragments.filter((activity) => activity.state === "READY").length;
  const completedFragments = fragments.filter((activity) => activity.state === "SUCCEEDED").length;
  const readinessPreflight = view.activities["readiness-preflight"];
  const reuseReasons = view.activities["reuse-assessment"]?.definition.metadata?.reasons;
  const scriptReuseReason = Array.isArray(reuseReasons)
    ? reuseReasons.find((reason): reason is string =>
      typeof reason === "string" && reason.startsWith("stable_scripts_"))
    : undefined;
  const scriptAssetStatus = view.requestPolicy.reuseDecision === "direct_execute"
    ? "稳定 verified 脚本已绑定，可直接回归"
    : scriptReuseReason?.startsWith("stable_scripts_reviewed_not_verified:")
      ? "稳定 reviewed 脚本已绑定；完成本轮执行封印后才可直跑"
      : view.activities.build
        ? "本轮 candidate-scripts 工作区构建；未晋升前不可跨请求复用"
        : "本轮不构建脚本";
  const webStaticBuild = view.activities.build?.outcome === "static_compiled";
  return [
    `请求：${view.requestId}`,
    ...(view.runIntent ? [`运行意图：${view.runIntent.decision} / ${view.runIntent.suiteId}${view.runIntent.decision === "design_reconfirm" && view.deliveryTarget !== "testcase_only" ? "（稳定设计复用→工程构建；设计侧 LLM：0）" : ["direct_execute", "design_reconfirm"].includes(view.runIntent.decision) ? "（设计侧 LLM：0）" : ""}`] : []),
    ...(view.deliveryTarget
      ? [`交付目标：${deliveryTargetLabels[view.deliveryTarget]}`]
      : []),
    ...(view.definitionVersion === CURRENT_WORKFLOW_VERSION
      ? [`脚本资产：${scriptAssetStatus}`]
      : []),
    ...(webStaticBuild
      ? [`Web 静态编译：通过；冻结 ${view.requestPolicy.selectedCaseIds.length} 条，manifest 与静态发现范围一致`]
      : view.activities.build && view.requestId.split("/")[0] === "web"
        ? ["Web 静态编译：未通过或尚未发布；不得进入 script-review"]
        : []),
    ...(view.definitionVersion === CURRENT_WORKFLOW_VERSION
      ? [view.reviewWorkbook
        ? `Excel 评审版：已发布（${view.reviewWorkbook.cacheStatus === "hit" ? "复用主体" : view.reviewWorkbook.cacheStatus === "rebuild" ? "缓存损坏回退重渲染" : "完整渲染"}，${view.reviewWorkbook.path}）`
        : "Excel 评审版：未发布；case-confirmation 已阻断"]
      : []),
    ...(readinessPreflight
      ? [`Readiness 预检：${readinessPreflight.state === "SUCCEEDED" ? "通过" : readinessPreflight.state === "FAILED" ? "不可变输入阻断" : readinessPreflight.state}`]
      : []),
    ...(compiler ? [`规则编译：${compiler.state}；分片=${fragments.length}（确定性 ${deterministic} / 模型或混合 ${model}；确定性 RULE ${deterministicRules} / 模型 RULE ${modelRules}；完成 ${completedFragments}）`] : []),
    ...(fragments.length ? [`执行器：无后台执行器；在途 ${runningFragments}；READY ${readyFragments}`] : []),
    ...(view.reviewerEpoch
      ? [`评审纪元：${view.reviewerEpoch.batchId}；语义复审已用 ${view.reviewerEpoch.semanticEvolutionCycle}/1；剩余 ${view.reviewerEpoch.remainingSemanticRereviews}；复用角色 ${view.reviewerEpoch.reusedRoles.join("、") || "无"}`]
      : []),
    `阶段：${phases.map((phase) =>
      `${labels[phase.id]}=${statuses[phase.status]}`
    ).join("、")}`,
    `当前：${current ? `${labels[current.id]} / ${statuses[current.status]}` : "未开始"}`,
    ...(view.selectorRepairSubstate
      ? [`定位修复：${selectorRepairLabels[view.selectorRepairSubstate]}`]
      : []),
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

function deriveSelectorRepairSubstate(
  projection: WorkflowProjection,
  events: readonly WorkflowEvent[]
): WorkflowGateView["selectorRepairSubstate"] {
  if (projection.definitionVersion !== CURRENT_WORKFLOW_VERSION) return undefined;
  const invalidation = [...events].reverse().find((event) =>
    event.type === "ActivitiesInvalidated"
    && event.payload.selectorRepair !== undefined
  );
  if (invalidation) {
    const reauthorized = events.some((event) =>
      event.seq > invalidation.seq
      && event.type === "CallbackResolved"
      && event.payload.activityId === "execution-authorization"
      && event.payload.resolution === "accepted"
    );
    if (reauthorized) return undefined;
    return projection.activities.build?.state === "SUCCEEDED"
      ? "reauthorization_required"
      : "script_repair";
  }
  const run = projection.activities.run;
  const selectorWait = projection.waits.some((wait) =>
    wait.activityId === "run"
    && /selector-drift/u.test(wait.detail ?? "")
  );
  return run?.state === "BLOCKED" && selectorWait
    ? "incident_recorded"
    : undefined;
}

function deriveV10ReviewerEpoch(
  events: readonly WorkflowEvent[]
): WorkflowGateView["reviewerEpoch"] {
  const latest = [...events].reverse().find((event) => {
    if (event.type !== "ReviewBatchStarted" || event.payload.scope === undefined) return false;
    try {
      return parseReviewBatchScope(event.payload.scope).schemaVersion === "review-batch-scope-v1";
    } catch {
      return false;
    }
  });
  if (!latest || typeof latest.payload.batchId !== "string" || latest.payload.scope === undefined) {
    return undefined;
  }
  const scope = parseReviewBatchScope(latest.payload.scope);
  if (!hasCompleteReviewBatchScope(scope)) return undefined;
  return {
    batchId: latest.payload.batchId,
    semanticEvolutionCycle: scope.semanticEvolutionCycle,
    remainingSemanticRereviews: Math.max(0, 1 - scope.semanticEvolutionCycle),
    reusedRoles: scope.reusedReviewerEvidence.map((evidence) => evidence.role).sort()
  };
}

export function defaultCaseGenerationActivity(view: WorkflowProjection): string | undefined {
  return Object.values(view.activities)
    .find((activity) => ["case_generation", "candidate_generation"].includes(activity.definition.kind))?.id;
}

export function packageActivityId(path: string): string {
  const segment = basename(path)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `case-generation-${segment}`;
}
