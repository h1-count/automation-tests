import type {
  ExecutionAuthorizationSnapshot,
  ExecutionDeferredCase,
  ExecutionOperationKind
} from "./authorization.js";
import type { TestDataManager } from "../test-data/testDataManager.js";
import type {
  DataWritePolicy,
  ResourceValidator,
  ResourceLeaseMode,
  ResourceRetirementPolicy,
  TestResourceRecord,
  TestResourceType
} from "../test-data/types.js";

export type FormalCaseStatus = "passed" | "failed" | "blocked" | "skipped" | "unknown";
export type FormalDataWritePolicy = DataWritePolicy;
export type FormalPermissionProfile = "read_only" | "test_write" | "privileged_test";

export interface FormalConsumedResourceContract {
  name: string;
  resourceType: TestResourceType;
  baselineContractId: string;
  leaseMode: ResourceLeaseMode;
}

export interface FormalProducedResourceContract {
  name: string;
  resourceType: TestResourceType;
  disposition: Exclude<FormalDataWritePolicy, "no_write" | "managed_cleanup">;
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
  /** New v2 manifests declare cross-request fixture dependencies here. */
  consumesResources?: FormalConsumedResourceContract[];
  /** Git-managed static assets are frozen build inputs, never runtime capabilities. */
  requiredTestAssetIds?: string[];
  timeoutMs?: number;
  evidencePolicy?: "standard" | "sensitive";
  /** Required for newly generated v5 scripts; omitted legacy manifests remain replayable. */
  requiredOperations?: ExecutionOperationKind[];
  /** Per-case immutable ceilings for externally observable operations. */
  operationBudgets?: Array<{
    operation: ExecutionOperationKind;
    maxExecutions: number;
  }>;
  /** Required for newly generated v5 scripts; omitted legacy manifests remain replayable. */
  dataWritePolicy?: FormalDataWritePolicy;
  permissionProfile?: FormalPermissionProfile;
  /** Separates candidate implementation completeness from runtime readiness. */
  implementation?: FormalCaseImplementation;
  /** Required for effectful operations in newly generated v5 scripts. */
  operationEvidence?: FormalOperationEvidenceDefinition[];
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
  /** Actual Git asset bytes digest; required only for test_asset evidence. */
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
  schemaVersion: "formal-execution-manifest-v1" | "formal-execution-manifest-v2";
  requestId: string;
  projectId: string;
  environment: string;
  cases: FormalCaseDefinition[];
  capabilities: FormalCapabilityDefinition[];
  buildEvidence?: FormalBuildEvidenceDefinition[];
  /** Optional for legacy manifests; when present every case must have exactly one session policy. */
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
  startedAt: string;
  endedAt?: string;
  reason?: string;
  evidenceRefs?: string[];
  assertions?: string[];
  durationMs?: number;
  failureClassification?: string;
  operationEvidence?: FormalOperationEvidenceRecord[];
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
  schemaVersion: "formal-execution-record-v1" | "formal-execution-record-v2";
  requestId: string;
  projectId: string;
  environment: string;
  authorizationDigest: string;
  manifestDigest: string;
  targetBuildDigest?: string;
  testDataRunId: string;
  startedAt: string;
  updatedAt: string;
  cases: Record<string, FormalCaseResult>;
  capabilities: Record<string, FormalCapabilityResult>;
  resources: Record<string, FormalNamedResource>;
  /** Present on v2 records; v1 records remain readable and resumable without stages. */
  stageProgress?: Record<string, FormalCaseStageProgress>;
  deferredCases?: ExecutionDeferredCase[];
  caseEvidencePolicies?: Record<string, "standard" | "sensitive">;
  cleanup?: {
    status: "passed" | "failed" | "not_required" | "unknown";
    completedAt?: string;
    reason?: string;
  };
  dataEvidence?: Record<string, FormalCaseDataEvidence>;
  /** Local, authorization-bound idempotency keys; never copied to history or reports. */
  operationReservations?: Record<string, Record<string, {
    operation: ExecutionOperationKind;
    reservedAt: string;
  }>>;
}

export interface FormalExecutionSummary {
  requestId: string;
  projectId: string;
  environment: string;
  authorizationDigest: string;
  manifestDigest: string;
  targetBuildDigest?: string;
  complete: boolean;
  counts: Record<FormalCaseStatus, number>;
  cases: Array<{
    caseId: string;
    status: FormalCaseStatus;
    reason?: string;
    attempts: number;
    evidenceRefs: string[];
    failureClassification?: string;
    dataEvidence?: FormalCaseDataEvidence;
    operationEvidence?: FormalOperationEvidenceRecord[];
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
  };
}

export interface FormalCaseRuntime {
  snapshot: ExecutionAuthorizationSnapshot;
  manager: TestDataManager;
  runId: string;
  confirmResource(name: string, evidence: string): Promise<void>;
  publishResource(name: string, ledgerResourceId: string, evidence: string): Promise<void>;
  consumeResource(name: string): Promise<FormalResourceHandle>;
  resourceAvailable(name: string): Promise<boolean>;
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
  classifyFailure(classification: string): void;
  stageCompleted(stageId: string): Promise<boolean>;
  completeStage(stageId: string, evidenceRefs?: string[]): Promise<void>;
  transitionOutcome(transitionId: string): Promise<string | undefined>;
  transitionRecord(transitionId: string): Promise<FormalExternalTransitionRecord | undefined>;
  awaitExternalTransition(transitionId: string): Promise<never>;
}
