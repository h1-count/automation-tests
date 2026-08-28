export const localAutomationOwner = "local-automation-test" as const;

export type DataWritePolicy =
  | "no_write"
  | "ephemeral_cleanup"
  | "reusable_fixture"
  | "tracked_residual";

export type CanonicalDataWritePolicy = DataWritePolicy;
export type ResourceLeaseMode = "shared_read" | "exclusive";
export type ResourceRetirementPolicy = "validate_quarantine_replace";

export type TestResourceType =
  | "account"
  | "tenant"
  | "product"
  | "device"
  | "alarmRule"
  | "telemetry"
  | "binding"
  | "command"
  | "custom";

export type TestResourceState =
  | "registered"
  | "available"
  | "leased"
  | "used"
  | "dirty"
  | "cleanup_pending"
  | "cleaning"
  | "cleaned"
  | "cleanup_failed"
  | "manual_required"
  | "retained"
  | "quarantined"
  | "retired"
  | "expired";

export type TestRunStatus = "running" | "passed" | "failed" | "interrupted" | "recovered";
export type FunctionalStatus = "passed" | "failed" | "blocked" | "interrupted";
export type DataHygieneStatus =
  | "clean"
  | "reusable"
  | "retained"
  | "cleanup_failed"
  | "manual_required";

export type CreateIntentStatus =
  | "planned"
  | "creating"
  | "created"
  | "failed"
  | "creation_unknown"
  | "reconciled";

export interface TestDataEvidence {
  type: "api" | "mqtt" | "web" | "app" | "log" | "manual";
  summary: string;
  path?: string;
}

export interface ResourceStateEvent {
  state: TestResourceState;
  at: string;
  message?: string;
}

export interface TestResourceRecord {
  resourceId: string;
  resourceType: TestResourceType;
  owner: typeof localAutomationOwner;
  projectId: string;
  envId: string;
  machineId: string;
  runId: string;
  caseId?: string;
  createIntentId?: string;
  dataWritePolicy?: DataWritePolicy;
  state: TestResourceState;
  reusable: boolean;
  dirty: boolean;
  cleanupActionId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  sensitiveFields?: string[];
  evidence?: TestDataEvidence[];
  lastValidation?: {
    status: "passed" | "failed";
    checkedAt: string;
    message?: string;
  };
  pool?: {
    baselineContractId: string;
    baselineVersion: string;
    syntheticKey: string;
    producerRequestId: string;
    producerCaseId: string;
    leaseMode: ResourceLeaseMode;
    maxPoolSize: number;
    retirementPolicy: ResourceRetirementPolicy;
    revision: number;
    promotedAt: string;
  };
  leases: Array<{
    runId: string;
    caseId?: string;
    mode: ResourceLeaseMode;
    acquiredAt: string;
  }>;
  reuseCount: number;
  stateHistory: ResourceStateEvent[];
}

export interface TestDataSummary {
  runId: string;
  totalResources: number;
  created: number;
  reused: number;
  cleaned: number;
  cleanupFailed: number;
  manualRequired: number;
  retained: number;
  reusableAvailable: number;
  quarantined: number;
  retired: number;
  expiredResidual: number;
  dirty: number;
  functionalStatus?: FunctionalStatus;
  dataHygieneStatus: DataHygieneStatus;
  resources: Array<{
    resourceId: string;
    resourceType: string;
    state: TestResourceState;
    reusable: boolean;
    cleanupActionId?: string;
    message?: string;
  }>;
}

export interface TestDataReportSummary extends Omit<TestDataSummary, "resources"> {
  resources: Array<{
    resourceType: string;
    state: TestResourceState;
    reusable: boolean;
    cleanupActionId?: string;
    message?: string;
  }>;
  hasResidualRisk: boolean;
}

export interface TestRunRecord {
  runId: string;
  projectId: string;
  envId: string;
  machineId: string;
  suiteId?: string;
  caseIds: string[];
  startedAt: string;
  endedAt?: string;
  status: TestRunStatus;
  functionalStatus?: FunctionalStatus;
  dataHygieneStatus?: DataHygieneStatus;
  dataWritePolicy: DataWritePolicy;
  caseWritePolicies?: Record<string, DataWritePolicy>;
  caseAllowedWritePolicies?: Record<string, DataWritePolicy[]>;
  authorizationDigest?: string;
  writeBudget: Partial<Record<TestResourceType, number>>;
  residualTtlHours: number;
  resources: string[];
  createIntents: string[];
  summary?: TestDataSummary;
}

export interface CreateIntentRecord {
  intentId: string;
  owner: typeof localAutomationOwner;
  projectId: string;
  envId: string;
  machineId: string;
  runId: string;
  caseId: string;
  resourceType: TestResourceType;
  syntheticKey: string;
  expectedOutcome: "create" | "reject";
  dataWritePolicy: DataWritePolicy;
  cleanupActionId?: string;
  authorizationDigest?: string;
  status: CreateIntentStatus;
  plannedAt: string;
  updatedAt: string;
  expiresAt?: string;
  resourceId?: string;
  message?: string;
  evidence?: TestDataEvidence[];
}

export interface CleanupResult {
  status: "cleaned" | "already_cleaned" | "failed" | "manual_required";
  message?: string;
  evidence?: string[];
}

export interface CleanupAction {
  id: string;
  resourceType: TestResourceType;
  risk: "low" | "medium" | "high";
  idempotent: boolean;
  cleanup(record: TestResourceRecord): Promise<CleanupResult>;
  validateCleaned?(record: TestResourceRecord): Promise<{ status: "passed" | "failed"; message?: string }>;
}

export interface StartRunInput {
  projectId: string;
  envId: string;
  suiteId?: string;
  caseIds?: string[];
  dataWritePolicy?: DataWritePolicy;
  caseWritePolicies?: Record<string, DataWritePolicy>;
  caseAllowedWritePolicies?: Record<string, DataWritePolicy[]>;
  authorizationDigest?: string;
  writeBudget?: Partial<Record<TestResourceType, number>>;
  residualTtlHours?: number;
}

export interface AcquireResourceRequest {
  runId: string;
  resourceType: TestResourceType;
  envId: string;
  projectId: string;
  caseId?: string;
  baselineContractId?: string;
  leaseMode?: ResourceLeaseMode;
  reusable?: boolean;
  createIfMissing?: boolean;
  metadata?: Record<string, unknown>;
  cleanupActionId?: string;
  expiresAt?: string;
}

export interface PromoteReusableResourceInput {
  resourceId: string;
  requestId: string;
  caseId: string;
  syntheticKey: string;
  baselineContractId: string;
  baselineVersion: string;
  leaseMode: ResourceLeaseMode;
  maxPoolSize: number;
  retirementPolicy?: ResourceRetirementPolicy;
}

export interface ReleaseReusableResourceInput {
  resourceId: string;
  runId: string;
  baselineRestored: boolean;
  reason?: string;
}

export interface RegisterCreatedResourceInput {
  resourceId: string;
  resourceType: TestResourceType;
  envId: string;
  projectId: string;
  runId: string;
  caseId?: string;
  reusable: boolean;
  cleanupActionId?: string;
  metadata?: Record<string, unknown>;
  sensitiveFields?: string[];
  expiresAt?: string;
  evidence?: TestDataEvidence[];
}

export interface ReserveCreateIntentInput {
  runId: string;
  projectId: string;
  envId: string;
  caseId: string;
  resourceType: TestResourceType;
  syntheticKey: string;
  expectedOutcome?: "create" | "reject";
  dataWritePolicy?: DataWritePolicy;
  cleanupActionId?: string;
  expiresAt?: string;
  evidence?: TestDataEvidence[];
}

export interface ConfirmCreatedResourceInput {
  intentId: string;
  resourceId: string;
  reusable?: boolean;
  metadata?: Record<string, unknown>;
  sensitiveFields?: string[];
  evidence?: TestDataEvidence[];
}

export interface ReconcileCreateIntentInput extends ConfirmCreatedResourceInput {
  resolution: "created" | "not_created";
  message?: string;
}

export type ResourceValidator = (record: TestResourceRecord) => Promise<{ status: "passed" | "failed"; message?: string }>;
