import type { ExecutionAuthorizationSnapshot } from "../task-state/types.js";
import type { TestDataManager } from "../test-data/testDataManager.js";

export type FormalCaseStatus = "passed" | "failed" | "blocked" | "skipped" | "unknown";

export interface FormalCaseDefinition {
  caseId: string;
  title: string;
  requiredCapabilities: string[];
  requiredResources: string[];
  producesResources: string[];
  timeoutMs?: number;
}

export interface FormalCapabilityDefinition {
  id: string;
  requiredForCaseIds: string[];
  source: {
    kind: "environment";
    variable: string;
    pattern?: string;
  };
  unavailableReason: string;
  unblockCondition: string;
}

export interface FormalExecutionManifest {
  schemaVersion: "formal-execution-manifest-v1";
  requestId: string;
  projectId: string;
  environment: string;
  cases: FormalCaseDefinition[];
  capabilities: FormalCapabilityDefinition[];
  externalResources?: string[];
}

export interface FormalCapabilityResult {
  capabilityId: string;
  available: boolean;
  affectedCaseIds: string[];
  reason?: string;
  unblockCondition?: string;
  checkedAt: string;
}

export interface FormalCaseAttempt {
  attempt: number;
  status: FormalCaseStatus;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  evidenceRefs?: string[];
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
}

export interface FormalExecutionRecord {
  schemaVersion: "formal-execution-record-v1";
  requestId: string;
  projectId: string;
  environment: string;
  authorizationDigest: string;
  manifestDigest: string;
  testDataRunId: string;
  startedAt: string;
  updatedAt: string;
  cases: Record<string, FormalCaseResult>;
  capabilities: Record<string, FormalCapabilityResult>;
  resources: Record<string, FormalNamedResource>;
}

export interface FormalExecutionSummary {
  requestId: string;
  authorizationDigest: string;
  complete: boolean;
  counts: Record<FormalCaseStatus, number>;
  cases: Array<{
    caseId: string;
    status: FormalCaseStatus;
    reason?: string;
  }>;
  capabilities: FormalCapabilityResult[];
  resources: FormalNamedResource[];
}

export interface FormalCaseRuntime {
  snapshot: ExecutionAuthorizationSnapshot;
  manager: TestDataManager;
  runId: string;
  confirmResource(name: string, evidence: string): Promise<void>;
  resourceAvailable(name: string): Promise<boolean>;
}
