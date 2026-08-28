import type {
  ExecutionAuthorizationSnapshot,
  ExecutionDeferredCase,
  ExecutionOperationKind,
  ExecutionSelectorRepairContext
} from "./authorization.js";
import type { TestDataManager } from "../test-data/testDataManager.js";
import type {
  CreateIntentRecord,
  DataHygieneStatus,
  DataWritePolicy,
  ResourceValidator,
  ResourceLeaseMode,
  ResourceRetirementPolicy,
  TestResourceRecord,
  TestResourceType
} from "../test-data/types.js";

export type FormalCaseStatus = "passed" | "failed" | "blocked" | "skipped" | "unknown";
export type FormalAttemptFinality = "pending" | "terminal";
export type FormalBusinessOracleOutcome = "satisfied" | "violated" | "indeterminate";
export type FormalBusinessOracleEvaluationBasis =
  | "normal_return"
  | "assertion_violation"
  | "explicit_indeterminate"
  | "evaluator_error";
export type FormalFailureClassification =
  | { code: "product"; basis: "business_oracle_violated" }
  | {
      code: "script";
      basis: "missing_business_oracle" | "runtime_error" | "oracle_evaluator_error";
    }
  | {
      code: "environment";
      basis: "authorization_scope" | "capability_unavailable" | "external_transition";
    }
  | { code: "test_data"; basis: "required_resource_unavailable" }
  | { code: "infrastructure"; basis: "worker_interrupted" }
  | { code: "unknown"; basis: "business_oracle_indeterminate" };
export type FormalStoredFailureClassification = FormalFailureClassification;
export type FormalDataWritePolicy = DataWritePolicy;
export type FormalPermissionProfile = "read_only" | "test_write" | "privileged_test";
export type FormalExecutionScopeStatus = "complete" | "partial";
export type FormalExecutionTestOutcome = "passed" | "failed" | "mixed" | "inconclusive";
export type FormalExecutionDataHygieneStatus = DataHygieneStatus | "unknown";

export interface FormalSelectorRepairSafetyProof {
  safe: boolean;
  completedStageCount: number;
  transitionCount: number;
  dataIntentCount: number;
  dataResourceCount: number;
  operationReservationCount: number;
  producedResourceCount: number;
}

export interface FormalSelectorRepairIncidentReference {
  schemaVersion: "formal-selector-repair-reference-v1";
  incidentId: string;
  digest: string;
  path: string;
  eligibility: "eligible" | "rejected";
}

export interface FormalCarriedCaseOrigin {
  schemaVersion: "formal-carried-case-origin-v1";
  sourceAuthorizationDigest: string;
  sourceCaseResultDigest: string;
  sourceEvidenceBundleDigest: string;
}

export interface FormalExecutionCompletionSeal {
  schemaVersion: "formal-execution-completion-seal-v1";
  resultDigest: string;
  sealedAt: string;
}

export interface FormalExecutionSealInput {
  authorizationDigest: string;
  requestId: string;
  environment: string;
  manifestDigest: string;
  targetBuildDigest?: string;
  runnableCaseIds: string[];
  deferredCaseIds: string[];
}

export interface FormalExecutionReportArtifact {
  path: string;
  digest: string;
}

export interface FormalConsumedResourceContract {
  name: string;
  resourceType: TestResourceType;
  baselineContractId: string;
  leaseMode: ResourceLeaseMode;
}

export interface FormalProducedResourceContract {
  name: string;
  resourceType: TestResourceType;
  disposition: Exclude<FormalDataWritePolicy, "no_write">;
  baselineContractId?: string;
  baselineVersion?: string;
  leaseMode?: ResourceLeaseMode;
  maxPoolSize?: number;
  retirementPolicy?: ResourceRetirementPolicy;
}
export type FormalOperationEvidenceStrategy =
  | "ui_state"
  | "response_contract"
  | "response_or_ui_rejection"
  | "response_with_query_fallback"
  | "response_then_query"
  | "query_only";

export interface FormalOperationEvidenceDefinition {
  operation: ExecutionOperationKind;
  strategy: FormalOperationEvidenceStrategy;
  responseContractId?: string;
  uiContractId?: string;
  queryCapabilityId?: string;
  finality: "accepted" | "final";
  stableIdentityRequired: boolean;
}

export interface FormalOperationEvidenceRecord {
  operation: ExecutionOperationKind;
  source: "ui_state" | "browser_response" | "postcondition_query" | "response_and_query";
  contractId: string;
  outcome: "succeeded" | "rejected" | "unknown";
  finality: "accepted" | "final";
  method?: string;
  path?: string;
  statusCode?: number;
  stableIdentity: "observed" | "not_required" | "missing";
  fallbackUsed: boolean;
  reconciliation: "not_required" | "completed" | "pending";
}

export interface FormalCaseImplementation {
  status: "source_complete" | "runtime_validation_pending";
  reachableBoundary?: string;
  pendingCapabilityIds?: string[];
}

export type FormalBusinessOracleObservationKind =
  | "dom"
  | "browser_response"
  | "postcondition_query"
  | "runtime_state";

export type FormalBusinessOracleAuthority =
  | {
      kind: "registered_source";
      materialId: string;
      sectionId: string;
      sourceSha256: string;
      /**
       * 登记材料的具名源文件；正式 spec 层必填并由构建校验字节摘要，
       * manifest 侧权威与比较语义不携带该字段。
       */
      sourceFiles?: Array<{ path: string; sha256: string }>;
    }
  | {
      kind: "formal_user_decision";
      decisionType: string;
      subjectDigest: string;
    };

export interface FormalBusinessOracleDefinition {
  oracleId: string;
  ruleRef: string;
  observationKind: FormalBusinessOracleObservationKind;
  /** Required only when the observation is bound to a browser response or
   * postcondition query contract. DOM and runtime-state evaluators do not need
   * to invent an external contract identity. */
  contractId?: string;
  authorities: FormalBusinessOracleAuthority[];
}

export interface FormalBusinessOracleIndeterminate {
  kind: "indeterminate";
  reason: string;
}

export type FormalBusinessOracleEvaluator = () =>
  | void
  | FormalBusinessOracleIndeterminate
  | Promise<void | FormalBusinessOracleIndeterminate>;

export interface FormalBusinessOracleResult {
  oracleId: string;
  ruleRef: string;
  observationKind: FormalBusinessOracleObservationKind;
  contractId?: string;
  authorityDigest: string;
  outcome: FormalBusinessOracleOutcome;
  evaluationBasis: FormalBusinessOracleEvaluationBasis;
  evidenceRefs: string[];
  reason?: string;
}

export type FormalBlockEvidence =
  | { cause: "capability_unavailable"; capabilityId: string }
  | { cause: "external_transition"; transitionId: string }
  | { cause: "required_resource_unavailable"; resourceName: string };

export interface FormalCapabilityRequirement {
  capabilityId: string;
  /** The capability is checked only after this external transition resolves. */
  checkAfterTransitionId: string;
}

export interface FormalExternalTransitionDefinition {
  transitionId: string;
  kind: "human_attestation";
  actionSummary: string;
  allowedOutcomes: string[];
  requiredAttestationKeys?: string[];
}

export interface FormalCaseExecutionStage {
  stageId: string;
  title: string;
  dependsOnStageIds?: string[];
  requiredResources?: string[];
  producesResources?: string[];
  externalTransition?: FormalExternalTransitionDefinition;
}

export type FormalCapabilityRequirementInput = string | FormalCapabilityRequirement;

export interface FormalCaseDefinition {
  caseId: string;
  title: string;
  requiredCapabilities: FormalCapabilityRequirementInput[];
  requiredResources: string[];
  producesResources: Array<string | FormalProducedResourceContract>;
  consumesResources?: FormalConsumedResourceContract[];
  /** Git-managed static assets are frozen build inputs, never runtime capabilities. */
  requiredTestAssetIds?: string[];
  timeoutMs?: number;
  evidencePolicy?: "standard" | "sensitive";
  requiredOperations?: ExecutionOperationKind[];
  /** Per-case immutable ceilings for externally observable operations. */
  operationBudgets?: Array<{
    operation: ExecutionOperationKind;
    maxExecutions: number;
  }>;
  dataWritePolicy?: FormalDataWritePolicy;
  permissionProfile?: FormalPermissionProfile;
  /** Separates candidate implementation completeness from runtime readiness. */
  implementation?: FormalCaseImplementation;
  operationEvidence?: FormalOperationEvidenceDefinition[];
  /** Required and non-empty for every formal-execution-manifest-v1 case. */
  businessOracles?: FormalBusinessOracleDefinition[];
  /** Optional durable stage graph for cases that cross a real external state transition. */
  executionStages?: FormalCaseExecutionStage[];
}

export interface FormalCapabilityDefinition {
  id: string;
  requiredForCaseIds: string[];
  source:
    | {
        kind: "environment";
        variable: string;
        pattern?: string;
      }
    | {
        kind: "provider";
        providerId: string;
        configuration?: Record<string, string | number | boolean>;
      };
  unavailableReason: string;
  unblockCondition: string;
}

export interface FormalBuildEvidenceDefinition {
  kind: "source_contract" | "selector_contract" | "browser_response_contract" | "test_asset";
  path: string;
  /** Required only for test_asset evidence. */
  assetId?: string;
  sha256?: string;
  /** Optional project-specific asset scope that must match test-assets/manifest.yaml. */
  scope?: string;
}

export interface FormalPageSessionGroupDefinition {
  sessionGroupId: string;
  targetRoute: string;
  caseIds: string[];
  resetStrategy: "preserve_unrelated_fields" | "reload_route" | "new_context_per_case";
  isolationReason: string;
  executionOrder: string[];
}

export interface FormalExecutionManifest {
  schemaVersion: "formal-execution-manifest-v1";
  scope: "request" | "stable_suite";
  requestId: string;
  suiteId?: string;
  sourceRequestId?: string;
  projectId: string;
  environment: string;
  /**
   * 会话认证策略：`anonymous` 要求 Runner 以未登录会话运行全部用例（登录/注册链路），
   * 不得注入已捕获登录态；缺省按既有 Runner 行为（声明了存储态则注入）。
   */
  sessionAuthentication?: "anonymous" | "default";
  cases: FormalCaseDefinition[];
  capabilities: FormalCapabilityDefinition[];
  buildEvidence?: FormalBuildEvidenceDefinition[];
  pageSessionGroups?: FormalPageSessionGroupDefinition[];
  externalResources?: string[];
}

export interface FormalCapabilityResult {
  capabilityId: string;
  available: boolean;
  affectedCaseIds: string[];
  /** Manifest/configuration defects are invalid build input, not recoverable environment deferrals. */
  configurationError?: "provider_not_registered";
  reason?: string;
  unblockCondition?: string;
  checkedAt: string;
  evidenceDigest?: string;
  expiresAt?: string;
}

export interface FormalCaseAttempt {
  attempt: number;
  status: FormalCaseStatus;
  finality?: FormalAttemptFinality;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  evidenceRefs?: string[];
  assertions?: string[];
  durationMs?: number;
  failureClassification?: FormalStoredFailureClassification;
  /** Persisted non-business fact required for every blocked result. */
  blockEvidence?: FormalBlockEvidence;
  operationEvidence?: FormalOperationEvidenceRecord[];
  oracleResults?: FormalBusinessOracleResult[];
  selectorRepairIncident?: FormalSelectorRepairIncidentReference;
}

export interface FormalStageCheckpoint {
  stageId: string;
  completedAt: string;
  evidenceRefs: string[];
}

export interface FormalExternalTransitionRecord {
  transitionId: string;
  caseId: string;
  status: "waiting" | "resolved";
  allowedOutcomes: string[];
  requiredAttestationKeys: string[];
  checkpointDigest: string;
  requestedAt: string;
  outcome?: string;
  attestationDigest?: string;
  resolvedAt?: string;
  resumeCount: number;
}

export interface FormalCaseStageProgress {
  completedStages: FormalStageCheckpoint[];
  transitions: Record<string, FormalExternalTransitionRecord>;
}

export interface FormalCaseResult {
  caseId: string;
  status: FormalCaseStatus;
  attempts: FormalCaseAttempt[];
  reason?: string;
  updatedAt: string;
  carriedFrom?: FormalCarriedCaseOrigin;
}

export interface FormalNamedResource {
  name: string;
  available: boolean;
  producerCaseId?: string;
  confirmedAt?: string;
  evidence?: string;
  /** Local ledger linkage only; summaries and workflow history must omit it. */
  ledgerResourceId?: string;
}

export interface FormalResourceHandle {
  resourceId: string;
  resourceType: TestResourceType;
  /** Local ledger metadata only; never write credentials or session material here. */
  metadata: Record<string, unknown>;
}

export interface FormalCaseDataEvidence {
  intents: Array<{
    resourceType: string;
    expectedOutcome: "create" | "reject";
    status: string;
  }>;
  resources: Array<{
    resourceType: string;
    state: string;
    reusable: boolean;
  }>;
}

export interface FormalExecutionRecord {
  schemaVersion: "formal-execution-record-v1";
  requestId: string;
  suiteId?: string;
  suiteVersion?: string;
  projectId: string;
  environment: string;
  authorizationDigest: string;
  manifestDigest: string;
  /** Immutable digest derived from the selected case oracle definitions. */
  businessOracleContractDigest: string;
  targetBuildDigest?: string;
  repairContext?: ExecutionSelectorRepairContext;
  testDataRunId: string;
  startedAt: string;
  updatedAt: string;
  cases: Record<string, FormalCaseResult>;
  capabilities: Record<string, FormalCapabilityResult>;
  resources: Record<string, FormalNamedResource>;
  stageProgress: Record<string, FormalCaseStageProgress>;
  deferredCases?: ExecutionDeferredCase[];
  caseEvidencePolicies?: Record<string, "standard" | "sensitive">;
  caseBusinessOracles: Record<string, FormalBusinessOracleDefinition[]>;
  caseBlockContracts: Record<string, {
    capabilityIds: string[];
    resourceNames: string[];
  }>;
  cleanup?: {
    status: "passed" | "failed" | "not_required" | "unknown";
    completedAt?: string;
    reason?: string;
    dataHygieneStatus?: DataHygieneStatus;
  };
  dataEvidence?: Record<string, FormalCaseDataEvidence>;
  /** Local, authorization-bound idempotency keys; never copied to history or reports. */
  operationReservations?: Record<string, Record<string, {
    operation: ExecutionOperationKind;
    reservedAt: string;
  }>>;
  completionSeal?: FormalExecutionCompletionSeal;
}

export interface FormalExecutionSummary {
  requestId: string;
  suiteId?: string;
  suiteVersion?: string;
  projectId: string;
  environment: string;
  authorizationDigest: string;
  manifestDigest: string;
  businessOracleContractDigest?: string;
  targetBuildDigest?: string;
  repairContext?: ExecutionSelectorRepairContext;
  scopeStatus: FormalExecutionScopeStatus;
  testOutcome: FormalExecutionTestOutcome;
  dataHygieneStatus: FormalExecutionDataHygieneStatus;
  complete: boolean;
  counts: Record<FormalCaseStatus, number>;
  cases: Array<{
    caseId: string;
    status: FormalCaseStatus;
    reason?: string;
    attempts: number;
    attemptFinality: FormalAttemptFinality | "not_started";
    evidenceRefs: string[];
    failureClassification?: FormalStoredFailureClassification;
    dataEvidence?: FormalCaseDataEvidence;
    operationEvidence?: FormalOperationEvidenceRecord[];
    oracleResults?: FormalBusinessOracleResult[];
    selectorRepairIncident?: FormalSelectorRepairIncidentReference;
    carriedFrom?: FormalCarriedCaseOrigin;
  }>;
  capabilities: FormalCapabilityResult[];
  resources: FormalNamedResource[];
  stageProgress: Array<{
    caseId: string;
    completedStageIds: string[];
    waitingTransitionIds: string[];
    resolvedTransitionIds: string[];
  }>;
  pendingTransitions: FormalExternalTransitionRecord[];
  deferredCases: ExecutionDeferredCase[];
  cleanup: {
    status: "passed" | "failed" | "not_required" | "unknown";
    completedAt?: string;
    reason?: string;
    dataHygieneStatus: FormalExecutionDataHygieneStatus;
  };
}

export interface FormalExecutionSealResult {
  seal: FormalExecutionCompletionSeal;
  summary: FormalExecutionSummary;
}

export interface FormalExecutionSealedReport {
  summary: FormalExecutionSummary;
  artifacts: FormalExecutionReportArtifact[];
}

/**
 * 用例内合成资源台账登记输入。resourceType 为授权快照 resourceBudgets 中的
 * 自由预算键（如 open_platform_product），引擎内部映射到台账资源类型。
 */
export interface FormalSyntheticCreateIntentInput {
  resourceType: string;
  syntheticKey: string;
  expectedOutcome?: "create" | "reject";
  dataWritePolicy?: DataWritePolicy;
  evidenceSummary?: string;
}

export interface FormalSyntheticConfirmInput {
  intentId: string;
  /** 由响应体解析出的稳定外部标识（如 productId）拼装的安全台账资源 ID。 */
  resourceId: string;
  /** 需要同时向清单命名资源发布的资源名（须与 producesResources 声明一致）。 */
  publishName?: string;
  metadata?: Record<string, unknown>;
  evidenceSummary?: string;
}

export interface FormalCaseRuntime {
  snapshot: ExecutionAuthorizationSnapshot;
  manager: TestDataManager;
  runId: string;
  attempt: number;
  confirmResource(name: string, evidence: string): Promise<void>;
  publishResource(name: string, ledgerResourceId: string, evidence: string): Promise<void>;
  consumeResource(name: string): Promise<FormalResourceHandle>;
  /** Reads one non-sensitive value from a current-run named test resource. */
  resourceMetadata(name: string, key: string): Promise<string>;
  /** Freeze later writes of the same resource type after a failed UI cleanup. */
  markResourceDirty(name: string, reason: string): Promise<void>;
  resourceAvailable(name: string): Promise<boolean>;
  /** 登记一次合成资源创建意图（expectedOutcome=reject 不占用创建预算）。 */
  beginSyntheticCreate(input: FormalSyntheticCreateIntentInput): Promise<CreateIntentRecord>;
  markSyntheticCreating(intentId: string): Promise<CreateIntentRecord>;
  /** 确认合成资源已创建；publishName 非空时同步发布为清单命名资源。 */
  confirmSyntheticResource(input: FormalSyntheticConfirmInput): Promise<TestResourceRecord>;
  /** 服务端拒绝的创建尝试（如重复名称/型号）按意图闭环，不产生台账资源。 */
  markSyntheticRejected(intentId: string, message: string): Promise<CreateIntentRecord>;
  /** 消费命名资源并把台账记录登记为已恢复基线（UI 删除验证后调用）。 */
  restoreSyntheticResource(name: string, message: string): Promise<void>;
  leaseResource(name: string, validator: ResourceValidator): Promise<TestResourceRecord | null>;
  releaseResource(resourceId: string, baselineRestored: boolean, reason?: string): Promise<void>;
  useCapability<T = unknown>(capabilityId: string): Promise<T>;
  reserveOperation(
    operation: ExecutionOperationKind,
    operationKey: string
  ): Promise<"reserved" | "existing">;
  addEvidence(reference: string): void;
  addAssertion(description: string): void;
  addOperationEvidence(evidence: FormalOperationEvidenceRecord): void;
  verifyBusinessOracle(
    oracleId: string,
    evaluator: FormalBusinessOracleEvaluator
  ): Promise<FormalBusinessOracleOutcome>;
  classifyFailure(classification: string): void;
  stageCompleted(stageId: string): Promise<boolean>;
  completeStage(stageId: string, evidenceRefs?: string[]): Promise<void>;
  transitionOutcome(transitionId: string): Promise<string | undefined>;
  transitionRecord(transitionId: string): Promise<FormalExternalTransitionRecord | undefined>;
  awaitExternalTransition(transitionId: string): Promise<never>;
  selectorRepairSafety(): Promise<FormalSelectorRepairSafetyProof>;
  selectorRepairDependentCaseIds(): string[];
}
