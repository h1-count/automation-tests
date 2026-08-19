import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import {
  digestPlanForExecutionAuthorization
} from "../task-workflow/executionAuthorizationSubject.js";
import { DurableWorkflowManager } from "../task-workflow/workflowManager.js";
import type { SafeJsonValue, WorkflowEvent } from "../task-workflow/types.js";
import {
  assertExactLocalScriptDependencyClosure,
  resolveLocalScriptDependencyClosure
} from "./scriptDependencyClosure.js";

export const executionOperationKinds = [
  "authenticate_test_account",
  "send_test_otp",
  "upload_synthetic_file",
  "accept_agreement",
  "submit_registration",
  "create_test_resource",
  "update_test_resource",
  "delete_test_resource",
  "change_test_permission",
  "invoke_test_device_action",
  "query_postcondition",
  "cleanup_test_resource",
  "retain_tracked_residual"
] as const;
export type ExecutionOperationKind = (typeof executionOperationKinds)[number];

export interface ExecutionReadinessBlocker {
  code: string;
  source: string;
  unblockCondition: string;
}

export interface ExecutionDeferredCase {
  caseId: string;
  blockers: ExecutionReadinessBlocker[];
}

export interface ExecutionCapabilityEvidence {
  capabilityId: string;
  available: boolean;
  evidenceDigest: string;
  checkedAt: string;
  expiresAt?: string;
}

export interface ExecutionScriptReviewSummary {
  level: "light" | "standard" | "strict";
  evidenceDigests: string[];
}

export interface ExecutionCaseResourceRequirement {
  name: string;
  resourceType: string;
  baselineContractId: string;
  leaseMode: "shared_read" | "exclusive";
}

export interface ExecutionCaseProducedResource {
  name: string;
  resourceType: string;
  disposition: "ephemeral_cleanup" | "reusable_fixture" | "tracked_residual";
  baselineContractId?: string;
  baselineVersion?: string;
  leaseMode?: "shared_read" | "exclusive";
  maxPoolSize?: number;
  retirementPolicy?: "validate_quarantine_replace";
}

export interface ExecutionCaseScope {
  caseId: string;
  permissionProfile: "read_only" | "test_write" | "privileged_test";
  requiredOperations: ExecutionOperationKind[];
  operationBudgets?: Array<{
    operation: ExecutionOperationKind;
    maxExecutions: number;
  }>;
  dataWritePolicy: "no_write" | "ephemeral_cleanup" | "reusable_fixture" | "tracked_residual";
  consumesResources: ExecutionCaseResourceRequirement[];
  producesResources: ExecutionCaseProducedResource[];
}

export interface ExecutionResourcePoolBudget {
  resourceType: string;
  baselineContractId: string;
  maxAvailable: number;
  replacementBudget: number;
  ttlHours: number;
  retirementPolicy: "validate_quarantine_replace";
}

export interface ExecutionResourcePoolEvidence {
  resourceType: string;
  baselineContractId: string;
  availableCount: number;
  evidenceDigest: string;
  checkedAt: string;
}

export interface ExecutionExternalTransitionSummary {
  caseId: string;
  stageId: string;
  transitionId: string;
  actionSummary: string;
  allowedOutcomes: string[];
  requiredAttestationKeys: string[];
}

export interface ExecutionCarriedCase {
  caseId: string;
  sourceAuthorizationDigest: string;
  sourceCaseResultDigest: string;
  sourceEvidenceBundleDigest: string;
}

export interface ExecutionSelectorRepairContext {
  schemaVersion: "selector-repair-context-v1";
  priorAuthorizationDigest: string;
  incidentDigests: string[];
  affectedCaseIds: string[];
  retryCaseIds: string[];
  carriedCases: ExecutionCarriedCase[];
}

interface ExecutionAuthorizationCommon {
  requestId: string;
  environment: string;
  planDigest: string;
  scriptDigests: Array<{ path: string; digest: string }>;
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "ephemeral_cleanup" | "reusable_fixture" | "tracked_residual";
  residualTtlHours: number;
  securityChallengePolicy: "test-channel-first-minimal-human";
  artifactPolicy: "retain-with-sensitive-step-redaction";
}

export interface ExecutionAuthorizationSnapshot extends ExecutionAuthorizationCommon {
  schemaVersion: "execution-authorization-v2" | "execution-authorization-v3" | "execution-authorization-v4" | "execution-authorization-v5";
  targetBuildDigest?: string;
  runnableCaseIds?: string[];
  deferredCases?: ExecutionDeferredCase[];
  capabilityEvidence?: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests?: string[];
  scriptReview?: ExecutionScriptReviewSummary;
  readinessDigest?: string;
  caseScopes?: ExecutionCaseScope[];
  resourcePoolBudgets?: ExecutionResourcePoolBudget[];
  resourcePoolEvidence?: ExecutionResourcePoolEvidence[];
  externalTransitions?: ExecutionExternalTransitionSummary[];
  runRequestId?: string;
  suiteId?: string;
  suiteVersion?: string;
  suiteManifestPath?: string;
  suiteManifestDigest?: string;
  suitePlanPath?: string;
  formalManifestPath?: string;
  entryScriptPaths?: string[];
  authorizationMode?: "policy_auto_no_write" | "user_confirmed";
  repairContext?: ExecutionSelectorRepairContext;
  digest: string;
  status: "confirmed";
  createdAt: string;
  confirmedAt: string;
  confirmationId: string;
}

export const EXECUTION_AUTHORIZATION_ARTIFACT = "execution-authorization.json";
export const EXECUTION_AUTHORIZATION_SCHEMA_VERSION = "execution-authorization-v4" as const;
export const STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION = "execution-authorization-v5" as const;
export const READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION = "execution-authorization-v3" as const;
export const LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION = "execution-authorization-v2" as const;

export interface ExecutionAuthorizationManifestV2 extends ExecutionAuthorizationCommon {
  schemaVersion: typeof LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  digest: string;
  callbackId: string;
  createdAt: string;
}

export interface ExecutionAuthorizationManifestV3 extends ExecutionAuthorizationCommon {
  schemaVersion: typeof READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  readinessDigest: string;
  digest: string;
  callbackId: string;
  createdAt: string;
}

export interface ExecutionAuthorizationManifestV4 extends ExecutionAuthorizationCommon {
  schemaVersion: typeof EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  caseScopes: ExecutionCaseScope[];
  resourcePoolBudgets: ExecutionResourcePoolBudget[];
  resourcePoolEvidence: ExecutionResourcePoolEvidence[];
  externalTransitions?: ExecutionExternalTransitionSummary[];
  repairContext?: ExecutionSelectorRepairContext;
  readinessDigest: string;
  digest: string;
  callbackId: string;
  createdAt: string;
}

export interface ExecutionAuthorizationManifestV5 extends ExecutionAuthorizationCommon {
  schemaVersion: typeof STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  runRequestId: string;
  suiteId: string;
  suiteVersion: string;
  suiteManifestPath: string;
  suiteManifestDigest: string;
  suitePlanPath: string;
  formalManifestPath: string;
  entryScriptPaths: string[];
  authorizationMode: "policy_auto_no_write" | "user_confirmed";
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  caseScopes: ExecutionCaseScope[];
  resourcePoolBudgets: ExecutionResourcePoolBudget[];
  resourcePoolEvidence: ExecutionResourcePoolEvidence[];
  externalTransitions?: ExecutionExternalTransitionSummary[];
  readinessDigest: string;
  digest: string;
  callbackId: string;
  createdAt: string;
}

export type ExecutionAuthorizationManifest =
  | ExecutionAuthorizationManifestV2
  | ExecutionAuthorizationManifestV3
  | ExecutionAuthorizationManifestV4
  | ExecutionAuthorizationManifestV5;

export interface BuildExecutionAuthorizationManifestInput {
  requestId: string;
  environment: string;
  scriptPaths: string[];
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "ephemeral_cleanup" | "reusable_fixture" | "tracked_residual";
  residualTtlHours?: number;
  planPath?: string;
  workspaceRoot?: string;
  createdAt?: string;
  callbackId?: string;
  schemaVersion?: "execution-authorization-v2" | "execution-authorization-v3" | "execution-authorization-v4" | "execution-authorization-v5";
  targetBuildDigest?: string;
  runnableCaseIds?: string[];
  deferredCases?: ExecutionDeferredCase[];
  capabilityEvidence?: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests?: string[];
  scriptReview?: ExecutionScriptReviewSummary;
  caseScopes?: ExecutionCaseScope[];
  resourcePoolBudgets?: ExecutionResourcePoolBudget[];
  resourcePoolEvidence?: ExecutionResourcePoolEvidence[];
  externalTransitions?: ExecutionExternalTransitionSummary[];
  repairContext?: ExecutionSelectorRepairContext;
  suiteRef?: {
    suiteId: string;
    suiteVersion: string;
    suiteManifestPath: string;
    suiteManifestDigest: string;
    suitePlanPath: string;
    formalManifestPath: string;
    entryScriptPaths: string[];
    authorizationMode: "policy_auto_no_write" | "user_confirmed";
  };
}

type ExecutionAuthorizationDigestBaseV2 = ExecutionAuthorizationCommon & {
  schemaVersion: typeof LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
};

type ExecutionAuthorizationDigestBaseV3 = ExecutionAuthorizationCommon & {
  schemaVersion: typeof READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  readinessDigest: string;
};

type ExecutionAuthorizationDigestBaseV4 = ExecutionAuthorizationCommon & {
  schemaVersion: typeof EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  caseScopes: ExecutionCaseScope[];
  resourcePoolBudgets: ExecutionResourcePoolBudget[];
  resourcePoolEvidence: ExecutionResourcePoolEvidence[];
  externalTransitions?: ExecutionExternalTransitionSummary[];
  repairContext?: ExecutionSelectorRepairContext;
  readinessDigest: string;
};

type ExecutionAuthorizationDigestBaseV5 = ExecutionAuthorizationCommon & {
  schemaVersion: typeof STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  runRequestId: string;
  suiteId: string;
  suiteVersion: string;
  suiteManifestPath: string;
  suiteManifestDigest: string;
  suitePlanPath: string;
  formalManifestPath: string;
  entryScriptPaths: string[];
  authorizationMode: "policy_auto_no_write" | "user_confirmed";
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  caseScopes: ExecutionCaseScope[];
  resourcePoolBudgets: ExecutionResourcePoolBudget[];
  resourcePoolEvidence: ExecutionResourcePoolEvidence[];
  externalTransitions?: ExecutionExternalTransitionSummary[];
  readinessDigest: string;
};

type ExecutionAuthorizationDigestBase =
  | ExecutionAuthorizationDigestBaseV2
  | ExecutionAuthorizationDigestBaseV3
  | ExecutionAuthorizationDigestBaseV4
  | ExecutionAuthorizationDigestBaseV5;

const digestPattern = /^[a-f0-9]{64}$/;
const requestPattern = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const suitePattern = /^(?:web|h5|app|api|mqtt|iot|iot-chain)\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u;
const mutatingOperations = new Set<ExecutionOperationKind>([
  "send_test_otp",
  "upload_synthetic_file",
  "submit_registration",
  "create_test_resource",
  "update_test_resource",
  "delete_test_resource",
  "change_test_permission",
  "invoke_test_device_action",
  "retain_tracked_residual"
]);

/**
 * Loads the sole execution authorization accepted by formal Runners.
 *
 * Confirmation is derived only from workflow history. The tracked manifest is
 * the immutable callback subject; v11 state is never consulted.
 */
export async function loadConfirmedExecutionAuthorization(
  requestId: string,
  expectedEnvironment?: string,
  requiredOperations: ExecutionOperationKind[] = [],
  workspaceRoot = process.cwd()
): Promise<ExecutionAuthorizationSnapshot> {
  const root = resolve(workspaceRoot);
  const workflow = new DurableWorkflowManager(requestId, root);
  if (!workflow.exists()) {
    throw new Error(
      "Formal execution requires workflow-history.ndjson and an accepted execution-authorization callback."
    );
  }
  return loadV3ConfirmedAuthorization(
    workflow,
    expectedEnvironment,
    requiredOperations
  );
}

export function loadExecutionAuthorizationManifest(
  requestId: string,
  expectedEnvironment?: string,
  requiredOperations: ExecutionOperationKind[] = [],
  workspaceRoot = process.cwd()
): ExecutionAuthorizationManifest {
  const workflow = new DurableWorkflowManager(requestId, resolve(workspaceRoot));
  const artifactPath = resolve(workflow.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT);
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Execution authorization manifest is missing at ${relative(workflow.workspaceRoot, artifactPath)}.`
    );
  }
  const manifest = parseExecutionAuthorizationManifest(
    JSON.parse(readFileSync(artifactPath, "utf8")) as unknown,
    requestId,
    workflow.workspaceRoot
  );
  assertRequestedExecutionScope(
    manifest,
    expectedEnvironment,
    requiredOperations,
    workflow.workspaceRoot,
    manifest.schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
      ? resolve(workflow.workspaceRoot, manifest.suitePlanPath)
      : workflow.planPath
  );
  return manifest;
}

/**
 * Builds a deterministic manifest for staging and atomic publication. This
 * helper never writes the artifact or requests the callback.
 */
export function buildExecutionAuthorizationManifest(
  input: BuildExecutionAuthorizationManifestInput
): ExecutionAuthorizationManifest {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  assertRequestId(input.requestId);
  const manager = new DurableWorkflowManager(input.requestId, workspaceRoot);
  const planPath = resolve(
    workspaceRoot,
    input.planPath ?? input.suiteRef?.suitePlanPath ?? manager.planPath
  );
  const schemaVersion = input.schemaVersion
    ?? LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  if (input.repairContext && schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION) {
    throw new Error("Selector repair context is supported only by execution-authorization-v4.");
  }
  const scriptPaths = resolveLocalScriptDependencyClosure({
    workspaceRoot,
    entryPaths: input.scriptPaths
  }).paths;
  const common: ExecutionAuthorizationCommon = {
    requestId: input.requestId,
    environment: input.environment,
    planDigest: digestPlanForExecutionAuthorization(planPath),
    scriptDigests: scriptPaths.map((path) => {
      const safePath = safeWorkspaceRelativePath(workspaceRoot, path, "script path");
      return { path: safePath, digest: digestFile(resolve(workspaceRoot, safePath)) };
    }),
    caseIds: isReadinessAuthorizationSchema(schemaVersion)
      ? input.runnableCaseIds ?? input.caseIds
      : input.caseIds,
    allowedOperations: input.allowedOperations,
    resourceBudgets: input.resourceBudgets,
    dataWritePolicy: input.dataWritePolicy,
    residualTtlHours: input.residualTtlHours ?? 72,
    securityChallengePolicy: "test-channel-first-minimal-human",
    artifactPolicy: "retain-with-sensitive-step-redaction"
  };
  const readinessBase = {
        ...common,
        schemaVersion,
        targetBuildDigest: requireDigest(input.targetBuildDigest, "targetBuildDigest"),
        runnableCaseIds: [...new Set(input.runnableCaseIds ?? input.caseIds)].sort(),
        deferredCases: normalizeDeferredCases(input.deferredCases ?? []),
        capabilityEvidence: normalizeCapabilityEvidence(input.capabilityEvidence ?? []),
        selectorEvidenceDigests: [...new Set(input.selectorEvidenceDigests ?? [])].sort(),
        scriptReview: normalizeScriptReview(input.scriptReview),
        readinessDigest: calculateReadinessDigest({
          targetBuildDigest: requireDigest(input.targetBuildDigest, "targetBuildDigest"),
          runnableCaseIds: input.runnableCaseIds ?? input.caseIds,
          deferredCases: input.deferredCases ?? [],
          capabilityEvidence: input.capabilityEvidence ?? [],
          selectorEvidenceDigests: input.selectorEvidenceDigests ?? [],
          scriptReview: normalizeScriptReview(input.scriptReview),
          ...(schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
            || schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
            ? {
                resourcePoolEvidence: normalizeResourcePoolEvidence(input.resourcePoolEvidence ?? []),
                caseScopes: normalizeCaseScopes(input.caseScopes ?? [])
              }
            : {})
        })
      };
  const scopedReadiness = {
        ...readinessBase,
        caseScopes: normalizeCaseScopes(input.caseScopes ?? []),
        resourcePoolBudgets: normalizeResourcePoolBudgets(input.resourcePoolBudgets ?? []),
        resourcePoolEvidence: normalizeResourcePoolEvidence(input.resourcePoolEvidence ?? []),
        ...(input.externalTransitions?.length
          ? { externalTransitions: normalizeExternalTransitions(input.externalTransitions) }
          : {}),
        ...(schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION && input.repairContext
          ? { repairContext: normalizeRepairContext(input.repairContext) }
          : {})
      };
  const base = normalizeDigestBase(schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    ? {
        ...scopedReadiness,
        schemaVersion,
        runRequestId: input.requestId,
        suiteId: requireSuiteRef(input.suiteRef).suiteId,
        suiteVersion: requireDigest(requireSuiteRef(input.suiteRef).suiteVersion, "suiteVersion"),
        suiteManifestPath: safeWorkspaceRelativePath(workspaceRoot, requireSuiteRef(input.suiteRef).suiteManifestPath, "suite manifest path"),
        suiteManifestDigest: requireDigest(requireSuiteRef(input.suiteRef).suiteManifestDigest, "suiteManifestDigest"),
        suitePlanPath: safeWorkspaceRelativePath(workspaceRoot, requireSuiteRef(input.suiteRef).suitePlanPath, "suite plan path"),
        formalManifestPath: safeWorkspaceRelativePath(workspaceRoot, requireSuiteRef(input.suiteRef).formalManifestPath, "formal manifest path"),
        entryScriptPaths: requireSuiteRef(input.suiteRef).entryScriptPaths.map((path) =>
          safeWorkspaceRelativePath(workspaceRoot, path, "entry script path")
        ).sort(),
        authorizationMode: requireSuiteRef(input.suiteRef).authorizationMode
      }
    : schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    ? {
        ...scopedReadiness,
        schemaVersion,
      }
    : schemaVersion === READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
      ? {
          ...readinessBase,
          schemaVersion
        }
      : {
        ...common,
        schemaVersion
      });
  validateDigestBase(base);
  const digest = calculateExecutionAuthorizationDigest(base);
  const callbackId = input.callbackId ?? (schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    && input.suiteRef?.authorizationMode === "policy_auto_no_write"
    ? `policy-auto-${digest.slice(0, 12)}`
    : `execution-authorization-${digest.slice(0, 12)}`);
  assertSafeIdentifier(callbackId, "callbackId");
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Execution authorization createdAt is invalid.");
  return { ...base, digest, callbackId, createdAt };
}

export function calculateExecutionAuthorizationDigest(
  value: ExecutionAuthorizationDigestBase
): string {
  const normalized = normalizeDigestBase(value);
  validateDigestBase(normalized);
  return createHash("sha256")
    .update(canonicalJson(normalized as unknown as SafeJsonValue), "utf8")
    .digest("hex");
}

export { digestPlanForExecutionAuthorization };

/**
 * Verifies the exact executable files selected by a Runner against the
 * immutable authorization snapshot. This closes the gap between authorizing a
 * list of digests and the Runner's later test discovery.
 */
export function assertCurrentAuthorizedScripts(
  snapshot: Pick<ExecutionAuthorizationSnapshot, "scriptDigests">,
  scriptPaths: string[],
  workspaceRoot = process.cwd()
): void {
  const root = resolve(workspaceRoot);
  const authorized = new Map(snapshot.scriptDigests.map((item) => [item.path, item.digest]));
  const normalizedPaths = assertExactLocalScriptDependencyClosure({
    workspaceRoot: root,
    entryPaths: scriptPaths,
    frozenPaths: snapshot.scriptDigests.map((item) => item.path)
  });
  for (const path of normalizedPaths) {
    if (digestFile(resolve(root, path)) !== authorized.get(path)) {
      throw new Error(`Script changed after execution authorization: ${path}`);
    }
  }
}

async function loadV3ConfirmedAuthorization(
  workflow: DurableWorkflowManager,
  expectedEnvironment: string | undefined,
  requiredOperations: ExecutionOperationKind[]
): Promise<ExecutionAuthorizationSnapshot> {
  const manifest = loadExecutionAuthorizationManifest(
    workflow.requestId,
    expectedEnvironment,
    requiredOperations,
    workflow.workspaceRoot
  );
  const projection = await workflow.gate();
  const activity = projection.activities["execution-authorization"];
  if (!activity || !["execution_authorization", "policy_authorization"].includes(activity.definition.kind)) {
    throw new Error("Workflow definition is missing the execution-authorization Activity.");
  }
  const events = await workflow.events();
  if (manifest.schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    && manifest.authorizationMode === "policy_auto_no_write") {
    const succeeded = [...events].reverse().find((event) =>
      event.type === "ActivitySucceeded"
      && event.payload.activityId === "execution-authorization"
      && event.payload.executionSubjectDigest === manifest.digest
    );
    if (activity.definition.kind !== "policy_authorization"
      || activity.state !== "SUCCEEDED"
      || !succeeded) {
      throw new Error("Formal execution requires a deterministic policy_auto_no_write authorization event.");
    }
    const { callbackId, ...snapshot } = manifest;
    return {
      ...snapshot,
      confirmationId: callbackId,
      status: "confirmed",
      confirmedAt: succeeded.occurredAt
    };
  }
  if (manifest.schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    && activity.definition.kind === "execution_authorization"
    && activity.definition.metadata?.decisionMode === "risk_adaptive") {
    const succeeded = [...events].reverse().find((event) =>
      event.type === "ActivitySucceeded"
      && event.payload.activityId === "execution-authorization"
      && event.payload.executionSubjectDigest === manifest.digest
    );
    if (activity.state === "SUCCEEDED" && succeeded) {
      const { callbackId, ...snapshot } = manifest;
      return {
        ...snapshot,
        confirmationId: callbackId,
        status: "confirmed",
        confirmedAt: succeeded.occurredAt
      };
    }
  }
  const callback = acceptedAuthorizationCallback(events);
  if (
    activity.state !== "SUCCEEDED"
    || activity.callbackId !== manifest.callbackId
    || activity.callbackSubjectDigest !== manifest.digest
    || !callback
    || callback.callbackId !== manifest.callbackId
    || callback.subjectDigest !== manifest.digest
  ) {
    throw new Error(
      "Formal execution requires an accepted execution-authorization callback bound to the current manifest digest."
    );
  }
  const { callbackId, ...snapshot } = manifest;
  return {
    ...snapshot,
    schemaVersion: manifest.schemaVersion,
    confirmationId: callbackId,
    status: "confirmed",
    confirmedAt: callback.occurredAt
  };
}

function parseExecutionAuthorizationManifest(
  value: unknown,
  requestId: string,
  workspaceRoot: string
): ExecutionAuthorizationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Execution authorization manifest must be a JSON object.");
  }
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "requestId",
    "runRequestId",
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
  const unknownKeys = Object.keys(raw).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new Error(`Execution authorization manifest has unsupported fields: ${unknownKeys.join(", ")}.`);
  }
  if (
    raw.schemaVersion !== STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    && raw.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    && raw.schemaVersion !== READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    && raw.schemaVersion !== LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported execution authorization manifest schema.");
  }
  if (
    raw.repairContext !== undefined
    && raw.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION
  ) {
    throw new Error("Selector repair context is supported only by execution-authorization-v4.");
  }
  if (raw.requestId !== requestId) {
    throw new Error("Execution authorization manifest belongs to another request.");
  }
  const scriptDigests = parsePathDigests(raw.scriptDigests, workspaceRoot);
  const caseIds = parseStringArray(raw.caseIds, "caseIds");
  const allowedOperations = parseStringArray(raw.allowedOperations, "allowedOperations");
  if (allowedOperations.some((operation) =>
    !executionOperationKinds.includes(operation as ExecutionOperationKind)
  )) {
    throw new Error("Execution authorization manifest contains an unsupported operation.");
  }
  const resourceBudgets = parseResourceBudgets(raw.resourceBudgets);
  const dataWritePolicy = raw.dataWritePolicy;
  if (!["no_write", "managed_cleanup", "ephemeral_cleanup", "reusable_fixture", "tracked_residual"].includes(String(dataWritePolicy))) {
    throw new Error("Execution authorization manifest has an invalid dataWritePolicy.");
  }
  const common: ExecutionAuthorizationCommon = {
    requestId,
    environment: requireString(raw.environment, "environment"),
    planDigest: requireDigest(raw.planDigest, "planDigest"),
    scriptDigests,
    caseIds,
    allowedOperations: allowedOperations as ExecutionOperationKind[],
    resourceBudgets,
    dataWritePolicy: dataWritePolicy as ExecutionAuthorizationDigestBase["dataWritePolicy"],
    residualTtlHours: requirePositiveInteger(raw.residualTtlHours, "residualTtlHours"),
    securityChallengePolicy: raw.securityChallengePolicy as ExecutionAuthorizationDigestBase["securityChallengePolicy"],
    artifactPolicy: raw.artifactPolicy as ExecutionAuthorizationCommon["artifactPolicy"]
  };
  const readinessBase = {
          ...common,
          targetBuildDigest: requireDigest(raw.targetBuildDigest, "targetBuildDigest"),
          runnableCaseIds: parseStringArray(raw.runnableCaseIds, "runnableCaseIds"),
          deferredCases: parseDeferredCases(raw.deferredCases),
          capabilityEvidence: parseCapabilityEvidence(raw.capabilityEvidence),
          selectorEvidenceDigests: parseStringArray(
            raw.selectorEvidenceDigests,
            "selectorEvidenceDigests"
          ).map((digest) => requireDigest(digest, "selectorEvidenceDigest")),
          scriptReview: parseScriptReview(raw.scriptReview),
          readinessDigest: requireDigest(raw.readinessDigest, "readinessDigest")
        };
  const scopedReadiness = {
          ...readinessBase,
          caseScopes: parseCaseScopes(raw.caseScopes),
          resourcePoolBudgets: parseResourcePoolBudgets(raw.resourcePoolBudgets),
          resourcePoolEvidence: parseResourcePoolEvidence(raw.resourcePoolEvidence),
          ...(raw.externalTransitions === undefined
            ? {}
            : { externalTransitions: parseExternalTransitions(raw.externalTransitions) }),
          ...(raw.schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
            && raw.repairContext !== undefined
            ? { repairContext: parseRepairContext(raw.repairContext) }
            : {})
        };
  const base = normalizeDigestBase(
    raw.schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
      ? {
          ...scopedReadiness,
          schemaVersion: STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
          runRequestId: requireString(raw.runRequestId, "runRequestId"),
          suiteId: requireString(raw.suiteId, "suiteId"),
          suiteVersion: requireDigest(raw.suiteVersion, "suiteVersion"),
          suiteManifestPath: safeWorkspaceRelativePath(workspaceRoot, requireString(raw.suiteManifestPath, "suiteManifestPath"), "suite manifest path"),
          suiteManifestDigest: requireDigest(raw.suiteManifestDigest, "suiteManifestDigest"),
          suitePlanPath: safeWorkspaceRelativePath(workspaceRoot, requireString(raw.suitePlanPath, "suitePlanPath"), "suite plan path"),
          formalManifestPath: safeWorkspaceRelativePath(workspaceRoot, requireString(raw.formalManifestPath, "formalManifestPath"), "formal manifest path"),
          entryScriptPaths: parseStringArray(raw.entryScriptPaths, "entryScriptPaths").map((path) =>
            safeWorkspaceRelativePath(workspaceRoot, path, "entry script path")
          ),
          authorizationMode: parseAuthorizationMode(raw.authorizationMode)
        }
      : raw.schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
      ? {
          ...scopedReadiness,
          schemaVersion: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
        }
      : raw.schemaVersion === READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
        ? {
            ...readinessBase,
            schemaVersion: READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
          }
        : {
          ...common,
          schemaVersion: LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
        }
  );
  validateDigestBase(base);
  const digest = requireDigest(raw.digest, "digest");
  if (calculateExecutionAuthorizationDigest(base) !== digest) {
    throw new Error("Execution authorization manifest digest does not match its immutable scope.");
  }
  const callbackId = requireString(raw.callbackId, "callbackId");
  assertSafeIdentifier(callbackId, "callbackId");
  const createdAt = requireString(raw.createdAt, "createdAt");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Execution authorization createdAt is invalid.");
  return { ...base, digest, callbackId, createdAt };
}

function acceptedAuthorizationCallback(events: readonly WorkflowEvent[]): {
  callbackId: string;
  subjectDigest: string;
  occurredAt: string;
} | undefined {
  const requested = [...events].reverse().find((event) =>
    event.type === "CallbackRequested"
    && event.payload.activityId === "execution-authorization"
  );
  if (!requested) return undefined;
  const callbackId = typeof requested.payload.callbackId === "string"
    ? requested.payload.callbackId
    : "";
  const subjectDigest = typeof requested.payload.subjectDigest === "string"
    ? requested.payload.subjectDigest
    : "";
  const resolved = [...events].reverse().find((event) =>
    event.seq > requested.seq
    && event.type === "CallbackResolved"
    && event.payload.activityId === "execution-authorization"
    && event.payload.callbackId === callbackId
    && event.payload.subjectDigest === subjectDigest
  );
  if (!resolved || resolved.payload.resolution !== "accepted") return undefined;
  return { callbackId, subjectDigest, occurredAt: resolved.occurredAt };
}

function assertRequestedExecutionScope(
  manifest: ExecutionAuthorizationManifest,
  expectedEnvironment: string | undefined,
  requiredOperations: ExecutionOperationKind[],
  workspaceRoot: string,
  planPath: string
): void {
  assertEnvironmentAndOperations(manifest, expectedEnvironment, requiredOperations);
  if (digestPlanForExecutionAuthorization(planPath) !== manifest.planDigest) {
    throw new Error("plan.md changed after execution authorization; reopen engineering design and review.");
  }
  if (isReadinessAuthorizationSchema(manifest.schemaVersion)) {
    const frozenPaths = manifest.scriptDigests.map((script) => script.path);
    const entryPaths = frozenPaths.filter((path) =>
      /(?:^|\/)execution\.manifest\.ts$/u.test(path) || /\.formal\.spec\.[cm]?[jt]sx?$/u.test(path)
    );
    if (entryPaths.length) {
      assertExactLocalScriptDependencyClosure({
        workspaceRoot,
        entryPaths,
        frozenPaths
      });
    }
  }
  if (manifest.schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION) {
    if (digestFile(resolve(workspaceRoot, manifest.suiteManifestPath)) !== manifest.suiteManifestDigest) {
      throw new Error("Stable suite manifest changed after execution authorization.");
    }
    if (JSON.stringify([...manifest.entryScriptPaths].sort()) !== JSON.stringify(
      manifest.scriptDigests.map((item) => item.path)
        .filter((path) => /(?:^|\/)execution\.manifest\.ts$/u.test(path) || /\.formal\.spec\.[cm]?[jt]sx?$/u.test(path))
        .sort()
    )) {
      throw new Error("Stable suite entry scripts differ from the authorized dependency closure roots.");
    }
  }
  for (const script of manifest.scriptDigests) {
    if (digestFile(resolve(workspaceRoot, script.path)) !== script.digest) {
      throw new Error(`Script changed after execution authorization: ${script.path}`);
    }
  }
}

function assertEnvironmentAndOperations(
  snapshot: Pick<ExecutionAuthorizationSnapshot, "environment" | "allowedOperations">,
  expectedEnvironment: string | undefined,
  requiredOperations: ExecutionOperationKind[]
): void {
  if (expectedEnvironment && snapshot.environment !== expectedEnvironment) {
    throw new Error("Execution environment differs from the confirmed authorization.");
  }
  if (requiredOperations.some((operation) => !snapshot.allowedOperations.includes(operation))) {
    throw new Error("The formal script requests an operation outside the confirmed authorization.");
  }
}

function normalizeDigestBase(
  value: ExecutionAuthorizationDigestBase
): ExecutionAuthorizationDigestBase {
  const common = {
    schemaVersion: value.schemaVersion,
    requestId: value.requestId,
    environment: value.environment,
    planDigest: value.planDigest,
    scriptDigests: [...value.scriptDigests]
      .map((item) => ({ path: item.path, digest: item.digest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    caseIds: [...value.caseIds].sort(),
    allowedOperations: [...value.allowedOperations].sort() as ExecutionOperationKind[],
    resourceBudgets: [...value.resourceBudgets]
      .map((item) => ({ resourceType: item.resourceType.trim(), maxCreates: item.maxCreates }))
      .sort((left, right) => left.resourceType.localeCompare(right.resourceType)),
    dataWritePolicy: value.dataWritePolicy,
    residualTtlHours: value.residualTtlHours,
    securityChallengePolicy: value.securityChallengePolicy,
    artifactPolicy: value.artifactPolicy
  };
  if (isReadinessDigestBase(value)) {
    const readiness = {
      ...common,
      targetBuildDigest: value.targetBuildDigest,
      runnableCaseIds: [...value.runnableCaseIds].sort(),
      deferredCases: normalizeDeferredCases(value.deferredCases),
      capabilityEvidence: normalizeCapabilityEvidence(value.capabilityEvidence),
      selectorEvidenceDigests: [...new Set(value.selectorEvidenceDigests)].sort(),
      scriptReview: normalizeScriptReview(value.scriptReview),
      readinessDigest: value.readinessDigest
    };
    if (isV5DigestBase(value)) {
      return {
        ...readiness,
        schemaVersion: STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
        runRequestId: value.runRequestId,
        suiteId: value.suiteId,
        suiteVersion: value.suiteVersion,
        suiteManifestPath: value.suiteManifestPath,
        suiteManifestDigest: value.suiteManifestDigest,
        suitePlanPath: value.suitePlanPath,
        formalManifestPath: value.formalManifestPath,
        entryScriptPaths: [...new Set(value.entryScriptPaths)].sort(),
        authorizationMode: value.authorizationMode,
        caseScopes: normalizeCaseScopes(value.caseScopes),
        resourcePoolBudgets: normalizeResourcePoolBudgets(value.resourcePoolBudgets),
        resourcePoolEvidence: normalizeResourcePoolEvidence(value.resourcePoolEvidence),
        ...(value.externalTransitions?.length
          ? { externalTransitions: normalizeExternalTransitions(value.externalTransitions) }
          : {})
      };
    }
    if (isV4DigestBase(value)) {
      return {
        ...readiness,
        schemaVersion: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
        caseScopes: normalizeCaseScopes(value.caseScopes),
        resourcePoolBudgets: normalizeResourcePoolBudgets(value.resourcePoolBudgets),
        resourcePoolEvidence: normalizeResourcePoolEvidence(value.resourcePoolEvidence),
        ...(value.externalTransitions?.length
          ? { externalTransitions: normalizeExternalTransitions(value.externalTransitions) }
          : {}),
        ...(value.repairContext
          ? { repairContext: normalizeRepairContext(value.repairContext) }
          : {})
      };
    }
    return {
      ...readiness,
      schemaVersion: READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    };
  }
  return {
    ...common,
    schemaVersion: LEGACY_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
  };
}

function validateDigestBase(value: ExecutionAuthorizationDigestBase): void {
  assertRequestId(value.requestId);
  if (!value.environment.trim() || /^prod(?:uction)?$/i.test(value.environment)) {
    throw new Error("Execution authorization must target a non-production environment.");
  }
  requireDigest(value.planDigest, "planDigest");
  if (!value.scriptDigests.length || !value.caseIds.length || !value.allowedOperations.length) {
    throw new Error("Execution authorization requires scripts, caseIds, and allowed operations.");
  }
  assertUnique(value.scriptDigests.map((item) => item.path), "script path");
  assertUnique(value.caseIds, "caseId");
  assertUnique(value.allowedOperations, "allowed operation");
  assertUnique(value.resourceBudgets.map((item) => item.resourceType), "resource budget");
  for (const script of value.scriptDigests) requireDigest(script.digest, `digest for ${script.path}`);
  if (value.caseIds.some((caseId) => !caseId.trim())) throw new Error("Execution authorization contains an empty caseId.");
  if (value.allowedOperations.some((operation) => !executionOperationKinds.includes(operation))) {
    throw new Error("Execution authorization contains an unsupported operation.");
  }
  if (value.resourceBudgets.some((budget) =>
    !budget.resourceType || !Number.isInteger(budget.maxCreates) || budget.maxCreates < 0
  )) {
    throw new Error("Execution resource budgets require non-negative integer limits.");
  }
  if (!Number.isInteger(value.residualTtlHours) || value.residualTtlHours <= 0) {
    throw new Error("Execution authorization residualTtlHours must be a positive integer.");
  }
  if (value.securityChallengePolicy !== "test-channel-first-minimal-human"
    || value.artifactPolicy !== "retain-with-sensitive-step-redaction") {
    throw new Error("Execution authorization security or artifact policy is unsupported.");
  }
  if (value.dataWritePolicy === "tracked_residual" && value.environment !== "test") {
    throw new Error("tracked_residual is allowed only in the test environment.");
  }
  if (value.dataWritePolicy === "no_write"
    && value.allowedOperations.some((operation) => mutatingOperations.has(operation))) {
    throw new Error("A no_write authorization cannot include business mutation operations.");
  }
  if (isReadinessDigestBase(value)) {
    requireDigest(value.targetBuildDigest, "targetBuildDigest");
    requireDigest(value.readinessDigest, "readinessDigest");
    assertUnique(value.runnableCaseIds, "runnable caseId");
    assertUnique(value.deferredCases.map((item) => item.caseId), "deferred caseId");
    if (JSON.stringify(value.caseIds) !== JSON.stringify(value.runnableCaseIds)) {
      throw new Error(`${value.schemaVersion} caseIds must equal runnableCaseIds.`);
    }
    const runnable = new Set(value.runnableCaseIds);
    if (value.deferredCases.some((item) => runnable.has(item.caseId))) {
      throw new Error("A case cannot be both runnable and deferred.");
    }
    if (value.deferredCases.some((item) =>
      !item.caseId.trim()
      || item.blockers.length === 0
      || item.blockers.some((blocker) =>
        !blocker.code.trim()
        || !blocker.source.trim()
        || !blocker.unblockCondition.trim()
      )
    )) {
      throw new Error("Every deferred case requires a caseId and actionable blockers.");
    }
    assertUnique(
      value.capabilityEvidence.map((item) => item.capabilityId),
      "capability evidence"
    );
    for (const item of value.capabilityEvidence) {
      requireDigest(item.evidenceDigest, `evidenceDigest for ${item.capabilityId}`);
      if (!Number.isFinite(Date.parse(item.checkedAt))
        || (item.expiresAt !== undefined && !Number.isFinite(Date.parse(item.expiresAt)))) {
        throw new Error(`Capability evidence ${item.capabilityId} has an invalid time.`);
      }
    }
    value.selectorEvidenceDigests.forEach((digest) =>
      requireDigest(digest, "selectorEvidenceDigest")
    );
    value.scriptReview.evidenceDigests.forEach((digest) =>
      requireDigest(digest, "script review evidenceDigest")
    );
    const expectedReadinessDigest = calculateReadinessDigest({
      targetBuildDigest: value.targetBuildDigest,
      runnableCaseIds: value.runnableCaseIds,
      deferredCases: value.deferredCases,
      capabilityEvidence: value.capabilityEvidence,
      selectorEvidenceDigests: value.selectorEvidenceDigests,
      scriptReview: value.scriptReview,
      ...(isV4DigestBase(value) || isV5DigestBase(value)
        ? {
            resourcePoolEvidence: value.resourcePoolEvidence,
            caseScopes: value.caseScopes
          }
        : {})
    });
    if (expectedReadinessDigest !== value.readinessDigest) {
      throw new Error("Execution readiness digest does not match its immutable evidence.");
    }
    if (isV4DigestBase(value)) {
      validateV4Scope(value);
      if (value.repairContext) validateRepairContext(value.repairContext, value.caseIds);
    }
    if (isV5DigestBase(value)) {
      validateV4Scope(value);
      assertRequestId(value.runRequestId);
      if (value.requestId !== value.runRequestId) {
        throw new Error("execution-authorization-v5 requestId must equal runRequestId.");
      }
      if (!suitePattern.test(value.suiteId)) {
        throw new Error("execution-authorization-v5 contains an invalid suiteId.");
      }
      requireDigest(value.suiteVersion, "suiteVersion");
      requireDigest(value.suiteManifestDigest, "suiteManifestDigest");
      if (!value.suiteManifestPath.trim()
        || !value.suitePlanPath.trim()
        || !value.formalManifestPath.trim()
        || !value.entryScriptPaths.length) {
        throw new Error("execution-authorization-v5 requires immutable suite asset paths.");
      }
      assertUnique(value.entryScriptPaths, "entry script path");
      if (!value.entryScriptPaths.includes(value.formalManifestPath)) {
        throw new Error("execution-authorization-v5 formal manifest must be an entry script.");
      }
      if (value.authorizationMode === "policy_auto_no_write"
        && (value.dataWritePolicy !== "no_write"
          || value.caseScopes.some((scope) => scope.dataWritePolicy !== "no_write"))) {
        throw new Error("policy_auto_no_write requires an entirely no_write execution scope.");
      }
    }
  }
}

export function calculateReadinessDigest(input: {
  targetBuildDigest: string;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  selectorEvidenceDigests: string[];
  scriptReview: ExecutionScriptReviewSummary;
  resourcePoolEvidence?: ExecutionResourcePoolEvidence[];
  caseScopes?: ExecutionCaseScope[];
}): string {
  const normalized = {
    schemaVersion: "execution-readiness-v1",
    targetBuildDigest: requireDigest(input.targetBuildDigest, "targetBuildDigest"),
    runnableCaseIds: [...new Set(input.runnableCaseIds)].sort(),
    deferredCases: normalizeDeferredCases(input.deferredCases),
    capabilityEvidence: normalizeCapabilityEvidence(input.capabilityEvidence),
    selectorEvidenceDigests: [...new Set(input.selectorEvidenceDigests)]
      .map((digest) => requireDigest(digest, "selectorEvidenceDigest"))
      .sort(),
    scriptReview: normalizeScriptReview(input.scriptReview),
    ...(input.resourcePoolEvidence || input.caseScopes
      ? {
          resourcePoolEvidence: normalizeResourcePoolEvidence(input.resourcePoolEvidence ?? []),
          caseScopes: normalizeCaseScopes(input.caseScopes ?? [])
        }
      : {})
  };
  return createHash("sha256")
    .update(canonicalJson(normalized as unknown as SafeJsonValue), "utf8")
    .digest("hex");
}

function validateV4Scope(value: ExecutionAuthorizationDigestBaseV4 | ExecutionAuthorizationDigestBaseV5): void {
  assertUnique(value.caseScopes.map((scope) => scope.caseId), "execution case scope");
  if (JSON.stringify(value.caseScopes.map((scope) => scope.caseId).sort())
    !== JSON.stringify([...value.runnableCaseIds].sort())) {
    throw new Error("execution-authorization-v4 requires one case scope for every runnable case.");
  }
  for (const scope of value.caseScopes) {
    if (scope.permissionProfile === "read_only" && scope.dataWritePolicy !== "no_write") {
      throw new Error(`${scope.caseId} read_only scope must use no_write.`);
    }
    if (scope.requiredOperations.some((operation) => !value.allowedOperations.includes(operation))) {
      throw new Error(`${scope.caseId} requests an operation outside the authorization.`);
    }
    assertUnique((scope.operationBudgets ?? []).map((budget) => budget.operation), `${scope.caseId} operation budget`);
    for (const budget of scope.operationBudgets ?? []) {
      if (!scope.requiredOperations.includes(budget.operation)
        || !Number.isInteger(budget.maxExecutions)
        || budget.maxExecutions <= 0) {
        throw new Error(`${scope.caseId} contains an invalid per-case operation budget.`);
      }
    }
    if (scope.permissionProfile !== "read_only"
      && scope.consumesResources.some((resource) => resource.leaseMode !== "exclusive")) {
      throw new Error(`${scope.caseId} write-capable consumers require exclusive fixture leases.`);
    }
  }
  assertUnique(
    value.resourcePoolBudgets.map((budget) => `${budget.resourceType}:${budget.baselineContractId}`),
    "resource pool budget"
  );
  for (const budget of value.resourcePoolBudgets) {
    if (
      !budget.resourceType.trim()
      || !budget.baselineContractId.trim()
      || !Number.isInteger(budget.maxAvailable)
      || budget.maxAvailable <= 0
      || !Number.isInteger(budget.replacementBudget)
      || budget.replacementBudget < 0
      || !Number.isInteger(budget.ttlHours)
      || budget.ttlHours <= 0
      || budget.retirementPolicy !== "validate_quarantine_replace"
    ) {
      throw new Error("execution-authorization-v4 contains an invalid resource pool budget.");
    }
  }
  assertUnique(
    value.resourcePoolEvidence.map((item) => `${item.resourceType}:${item.baselineContractId}`),
    "resource pool evidence"
  );
  for (const evidence of value.resourcePoolEvidence) {
    requireDigest(evidence.evidenceDigest, "resource pool evidenceDigest");
    if (!Number.isInteger(evidence.availableCount) || evidence.availableCount < 0
      || !Number.isFinite(Date.parse(evidence.checkedAt))) {
      throw new Error("execution-authorization-v4 contains invalid resource pool evidence.");
    }
  }
  const transitions = value.externalTransitions ?? [];
  assertUnique(transitions.map((item) => item.transitionId), "external transition");
  for (const transition of transitions) {
    if (
      !value.runnableCaseIds.includes(transition.caseId)
      || !transition.stageId.trim()
      || !transition.transitionId.trim()
      || !transition.actionSummary.trim()
      || transition.allowedOutcomes.length === 0
      || transition.allowedOutcomes.some((outcome) => !outcome.trim())
      || transition.requiredAttestationKeys.some((key) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key))
    ) {
      throw new Error("execution-authorization-v4 contains an invalid external transition summary.");
    }
    assertUnique(transition.allowedOutcomes, `${transition.transitionId} outcome`);
    assertUnique(transition.requiredAttestationKeys, `${transition.transitionId} attestation key`);
  }
}

function normalizeCaseScopes(values: ExecutionCaseScope[]): ExecutionCaseScope[] {
  return values.map((scope) => ({
    caseId: scope.caseId.trim(),
    permissionProfile: scope.permissionProfile,
    requiredOperations: [...new Set(scope.requiredOperations)].sort() as ExecutionOperationKind[],
    operationBudgets: (scope.operationBudgets ?? []).map((budget) => ({
      operation: budget.operation,
      maxExecutions: budget.maxExecutions
    })).sort((left, right) => left.operation.localeCompare(right.operation)),
    dataWritePolicy: scope.dataWritePolicy,
    consumesResources: scope.consumesResources.map((resource) => ({
      name: resource.name.trim(),
      resourceType: resource.resourceType.trim(),
      baselineContractId: resource.baselineContractId.trim(),
      leaseMode: resource.leaseMode
    })).sort((left, right) => left.name.localeCompare(right.name)),
    producesResources: scope.producesResources.map((resource) => ({
      name: resource.name.trim(),
      resourceType: resource.resourceType.trim(),
      disposition: resource.disposition,
      ...(resource.baselineContractId ? { baselineContractId: resource.baselineContractId.trim() } : {}),
      ...(resource.baselineVersion ? { baselineVersion: resource.baselineVersion.trim() } : {}),
      ...(resource.leaseMode ? { leaseMode: resource.leaseMode } : {}),
      ...(resource.maxPoolSize !== undefined ? { maxPoolSize: resource.maxPoolSize } : {}),
      ...(resource.retirementPolicy ? { retirementPolicy: resource.retirementPolicy } : {})
    })).sort((left, right) => left.name.localeCompare(right.name))
  })).sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function normalizeResourcePoolBudgets(
  values: ExecutionResourcePoolBudget[]
): ExecutionResourcePoolBudget[] {
  return values.map((budget) => ({
    resourceType: budget.resourceType.trim(),
    baselineContractId: budget.baselineContractId.trim(),
    maxAvailable: budget.maxAvailable,
    replacementBudget: budget.replacementBudget,
    ttlHours: budget.ttlHours,
    retirementPolicy: budget.retirementPolicy
  })).sort((left, right) =>
    `${left.resourceType}:${left.baselineContractId}`.localeCompare(
      `${right.resourceType}:${right.baselineContractId}`
    )
  );
}

function normalizeResourcePoolEvidence(
  values: ExecutionResourcePoolEvidence[]
): ExecutionResourcePoolEvidence[] {
  return values.map((evidence) => ({
    resourceType: evidence.resourceType.trim(),
    baselineContractId: evidence.baselineContractId.trim(),
    availableCount: evidence.availableCount,
    evidenceDigest: evidence.evidenceDigest,
    checkedAt: evidence.checkedAt
  })).sort((left, right) =>
    `${left.resourceType}:${left.baselineContractId}`.localeCompare(
      `${right.resourceType}:${right.baselineContractId}`
    )
  );
}

function parseCaseScopes(value: unknown): ExecutionCaseScope[] {
  if (!Array.isArray(value)) throw new Error("execution-authorization-v4 caseScopes must be an array.");
  return normalizeCaseScopes(value as ExecutionCaseScope[]);
}

function parseResourcePoolBudgets(value: unknown): ExecutionResourcePoolBudget[] {
  if (!Array.isArray(value)) throw new Error("execution-authorization-v4 resourcePoolBudgets must be an array.");
  return normalizeResourcePoolBudgets(value as ExecutionResourcePoolBudget[]);
}

function parseResourcePoolEvidence(value: unknown): ExecutionResourcePoolEvidence[] {
  if (!Array.isArray(value)) throw new Error("execution-authorization-v4 resourcePoolEvidence must be an array.");
  return normalizeResourcePoolEvidence(value as ExecutionResourcePoolEvidence[]);
}

function normalizeExternalTransitions(
  values: ExecutionExternalTransitionSummary[]
): ExecutionExternalTransitionSummary[] {
  return values.map((item) => ({
    caseId: item.caseId.trim(),
    stageId: item.stageId.trim(),
    transitionId: item.transitionId.trim(),
    actionSummary: item.actionSummary.trim(),
    allowedOutcomes: [...new Set(item.allowedOutcomes.map((outcome) => outcome.trim()))].sort(),
    requiredAttestationKeys: [
      ...new Set(item.requiredAttestationKeys.map((key) => key.trim()))
    ].sort()
  })).sort((left, right) => left.transitionId.localeCompare(right.transitionId));
}

function parseExternalTransitions(value: unknown): ExecutionExternalTransitionSummary[] {
  if (!Array.isArray(value)) {
    throw new Error("execution-authorization-v4 externalTransitions must be an array.");
  }
  return normalizeExternalTransitions(value as ExecutionExternalTransitionSummary[]);
}

function normalizeRepairContext(
  value: ExecutionSelectorRepairContext
): ExecutionSelectorRepairContext {
  return {
    schemaVersion: "selector-repair-context-v1",
    priorAuthorizationDigest: value.priorAuthorizationDigest,
    incidentDigests: [...new Set(value.incidentDigests)].sort(),
    affectedCaseIds: [...new Set(value.affectedCaseIds)].sort(),
    retryCaseIds: [...new Set(value.retryCaseIds)].sort(),
    carriedCases: value.carriedCases.map((item) => ({
      caseId: item.caseId.trim(),
      sourceAuthorizationDigest: item.sourceAuthorizationDigest,
      sourceCaseResultDigest: item.sourceCaseResultDigest,
      sourceEvidenceBundleDigest: item.sourceEvidenceBundleDigest
    })).sort((left, right) => left.caseId.localeCompare(right.caseId))
  };
}

function parseRepairContext(value: unknown): ExecutionSelectorRepairContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("execution-authorization-v4 repairContext must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== "selector-repair-context-v1") {
    throw new Error("Execution selector repair context has an unsupported schema.");
  }
  if (!Array.isArray(raw.carriedCases)) {
    throw new Error("Execution selector repair context carriedCases must be an array.");
  }
  return normalizeRepairContext({
    schemaVersion: "selector-repair-context-v1",
    priorAuthorizationDigest: requireDigest(
      raw.priorAuthorizationDigest,
      "repairContext.priorAuthorizationDigest"
    ),
    incidentDigests: parseStringArray(
      raw.incidentDigests,
      "repairContext.incidentDigests"
    ).map((digest) => requireDigest(digest, "repairContext.incidentDigest")),
    affectedCaseIds: parseStringArray(
      raw.affectedCaseIds,
      "repairContext.affectedCaseIds"
    ),
    retryCaseIds: parseStringArray(raw.retryCaseIds, "repairContext.retryCaseIds"),
    carriedCases: raw.carriedCases.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Execution selector repair context contains an invalid carried case.");
      }
      const carried = item as Record<string, unknown>;
      return {
        caseId: requireString(carried.caseId, "repairContext.carriedCase.caseId"),
        sourceAuthorizationDigest: requireDigest(
          carried.sourceAuthorizationDigest,
          "repairContext.carriedCase.sourceAuthorizationDigest"
        ),
        sourceCaseResultDigest: requireDigest(
          carried.sourceCaseResultDigest,
          "repairContext.carriedCase.sourceCaseResultDigest"
        ),
        sourceEvidenceBundleDigest: requireDigest(
          carried.sourceEvidenceBundleDigest,
          "repairContext.carriedCase.sourceEvidenceBundleDigest"
        )
      };
    })
  });
}

function validateRepairContext(
  value: ExecutionSelectorRepairContext,
  authorizedCaseIds: string[]
): void {
  if (value.schemaVersion !== "selector-repair-context-v1") {
    throw new Error("Execution selector repair context has an unsupported schema.");
  }
  requireDigest(value.priorAuthorizationDigest, "repairContext.priorAuthorizationDigest");
  if (!value.incidentDigests.length || !value.affectedCaseIds.length || !value.retryCaseIds.length) {
    throw new Error("Execution selector repair context requires incidents, affected cases, and retry cases.");
  }
  value.incidentDigests.forEach((digest) => requireDigest(digest, "repairContext.incidentDigest"));
  assertUnique(value.affectedCaseIds, "repairContext affected caseId");
  assertUnique(value.retryCaseIds, "repairContext retry caseId");
  assertUnique(value.carriedCases.map((item) => item.caseId), "repairContext carried caseId");
  const authorized = new Set(authorizedCaseIds);
  const retry = new Set(value.retryCaseIds);
  const carried = new Set(value.carriedCases.map((item) => item.caseId));
  if (value.affectedCaseIds.some((caseId) => !retry.has(caseId))) {
    throw new Error("Every affected selector repair case must be retried.");
  }
  if ([...retry, ...carried].some((caseId) => !authorized.has(caseId))) {
    throw new Error("Execution selector repair context references a case outside authorization.");
  }
  if ([...retry].some((caseId) => carried.has(caseId))) {
    throw new Error("A selector repair case cannot be both retried and carried.");
  }
  if (authorizedCaseIds.some((caseId) => !retry.has(caseId) && !carried.has(caseId))) {
    throw new Error("Execution selector repair context must classify every authorized case.");
  }
  for (const item of value.carriedCases) {
    requireDigest(item.sourceAuthorizationDigest, "carried sourceAuthorizationDigest");
    requireDigest(item.sourceCaseResultDigest, "carried sourceCaseResultDigest");
    requireDigest(item.sourceEvidenceBundleDigest, "carried sourceEvidenceBundleDigest");
    if (item.sourceAuthorizationDigest !== value.priorAuthorizationDigest) {
      throw new Error("Carried selector repair cases must come from the prior authorization.");
    }
  }
}

function isReadinessAuthorizationSchema(value: string): value is
  | typeof READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
  | typeof EXECUTION_AUTHORIZATION_SCHEMA_VERSION
  | typeof STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION {
  return value === READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    || value === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
    || value === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
}

function isReadinessDigestBase(
  value: ExecutionAuthorizationDigestBase
): value is ExecutionAuthorizationDigestBaseV3 | ExecutionAuthorizationDigestBaseV4 | ExecutionAuthorizationDigestBaseV5 {
  return isReadinessAuthorizationSchema(value.schemaVersion);
}

function isV4DigestBase(
  value: ExecutionAuthorizationDigestBase
): value is ExecutionAuthorizationDigestBaseV4 {
  return value.schemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
}

function isV5DigestBase(
  value: ExecutionAuthorizationDigestBase
): value is ExecutionAuthorizationDigestBaseV5 {
  return value.schemaVersion === STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
}

function normalizeDeferredCases(
  values: ExecutionDeferredCase[]
): ExecutionDeferredCase[] {
  return values.map((item) => ({
    caseId: item.caseId.trim(),
    blockers: item.blockers.map((blocker) => ({
      code: blocker.code.trim(),
      source: blocker.source.trim(),
      unblockCondition: blocker.unblockCondition.trim()
    })).sort((left, right) =>
      `${left.code}:${left.source}`.localeCompare(`${right.code}:${right.source}`)
    )
  })).sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function normalizeCapabilityEvidence(
  values: ExecutionCapabilityEvidence[]
): ExecutionCapabilityEvidence[] {
  return values.map((item) => ({
    capabilityId: item.capabilityId.trim(),
    available: item.available,
    evidenceDigest: item.evidenceDigest,
    checkedAt: item.checkedAt,
    ...(item.expiresAt ? { expiresAt: item.expiresAt } : {})
  })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

function normalizeScriptReview(
  value: ExecutionScriptReviewSummary | undefined
): ExecutionScriptReviewSummary {
  const normalized = value ?? { level: "light" as const, evidenceDigests: [] };
  if (!["light", "standard", "strict"].includes(normalized.level)) {
    throw new Error("Execution script review level is invalid.");
  }
  return {
    level: normalized.level,
    evidenceDigests: [...new Set(normalized.evidenceDigests)].sort()
  };
}

function parseDeferredCases(value: unknown): ExecutionDeferredCase[] {
  if (!Array.isArray(value)) {
    throw new Error("Execution authorization deferredCases must be an array.");
  }
  return normalizeDeferredCases(value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Execution authorization deferredCases contains an invalid entry.");
    }
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.blockers)) {
      throw new Error("Every deferred case requires blockers.");
    }
    return {
      caseId: requireString(record.caseId, "deferred caseId"),
      blockers: record.blockers.map((blocker) => {
        if (!blocker || typeof blocker !== "object" || Array.isArray(blocker)) {
          throw new Error("Execution authorization contains an invalid readiness blocker.");
        }
        const parsed = blocker as Record<string, unknown>;
        return {
          code: requireString(parsed.code, "blocker code"),
          source: requireString(parsed.source, "blocker source"),
          unblockCondition: requireString(
            parsed.unblockCondition,
            "blocker unblockCondition"
          )
        };
      })
    };
  }));
}

function parseCapabilityEvidence(value: unknown): ExecutionCapabilityEvidence[] {
  if (!Array.isArray(value)) {
    throw new Error("Execution authorization capabilityEvidence must be an array.");
  }
  return normalizeCapabilityEvidence(value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Execution authorization capabilityEvidence contains an invalid entry.");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.available !== "boolean") {
      throw new Error("Capability evidence available must be boolean.");
    }
    return {
      capabilityId: requireString(record.capabilityId, "capabilityId"),
      available: record.available,
      evidenceDigest: requireDigest(record.evidenceDigest, "capability evidenceDigest"),
      checkedAt: requireString(record.checkedAt, "capability checkedAt"),
      ...(record.expiresAt === undefined
        ? {}
        : { expiresAt: requireString(record.expiresAt, "capability expiresAt") })
    };
  }));
}

function parseScriptReview(value: unknown): ExecutionScriptReviewSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Execution authorization scriptReview must be an object.");
  }
  const record = value as Record<string, unknown>;
  const level = requireString(record.level, "script review level");
  if (!["light", "standard", "strict"].includes(level)) {
    throw new Error("Execution authorization script review level is invalid.");
  }
  return normalizeScriptReview({
    level: level as ExecutionScriptReviewSummary["level"],
    evidenceDigests: parseStringArray(
      record.evidenceDigests,
      "scriptReview.evidenceDigests"
    ).map((digest) => requireDigest(digest, "script review evidenceDigest"))
  });
}

function parsePathDigests(
  value: unknown,
  workspaceRoot: string
): Array<{ path: string; digest: string }> {
  if (!Array.isArray(value)) throw new Error("Execution authorization scriptDigests must be an array.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Execution authorization scriptDigests contains an invalid entry.");
    }
    const record = item as Record<string, unknown>;
    const path = safeWorkspaceRelativePath(
      workspaceRoot,
      requireString(record.path, "script path"),
      "script path"
    );
    return { path, digest: requireDigest(record.digest, `digest for ${path}`) };
  });
}

function parseResourceBudgets(
  value: unknown
): Array<{ resourceType: string; maxCreates: number }> {
  if (!Array.isArray(value)) throw new Error("Execution authorization resourceBudgets must be an array.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Execution authorization resourceBudgets contains an invalid entry.");
    }
    const record = item as Record<string, unknown>;
    const resourceType = requireString(record.resourceType, "resourceType").trim();
    const maxCreates = record.maxCreates;
    if (!Number.isInteger(maxCreates) || (maxCreates as number) < 0) {
      throw new Error("Execution resource maxCreates must be a non-negative integer.");
    }
    return { resourceType, maxCreates: maxCreates as number };
  });
}

function parseStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Execution authorization ${name} must be a string array.`);
  }
  return value as string[];
}

function parseAuthorizationMode(
  value: unknown
): "policy_auto_no_write" | "user_confirmed" {
  if (value !== "policy_auto_no_write" && value !== "user_confirmed") {
    throw new Error("execution-authorization-v5 has an invalid authorizationMode.");
  }
  return value;
}

function requireSuiteRef(
  value: BuildExecutionAuthorizationManifestInput["suiteRef"]
): NonNullable<BuildExecutionAuthorizationManifestInput["suiteRef"]> {
  if (!value) throw new Error("execution-authorization-v5 requires a derived suiteRef.");
  return value;
}

function safeWorkspaceRelativePath(
  workspaceRoot: string,
  path: string,
  label: string
): string {
  const absolute = resolve(workspaceRoot, path);
  const rel = relative(workspaceRoot, absolute).split(sep).join("/");
  if (!rel || rel === ".." || rel.startsWith("../")) {
    throw new Error(`Execution authorization ${label} must stay inside the workspace.`);
  }
  if (
    rel.startsWith(".local/")
    || rel.startsWith(".auth/")
    || rel.startsWith("sources/")
    || rel.startsWith("test-assets/")
    || /(^|\/)\.env(?:\.|$)/.test(rel)
  ) {
    throw new Error(`Execution authorization ${label} is private or not executable: ${rel}`);
  }
  return rel;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Execution authorization requires ${name}.`);
  }
  return value;
}

function requireDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`Execution authorization ${name} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Execution authorization ${name} must be a positive integer.`);
  }
  return value as number;
}

function assertRequestId(requestId: string): void {
  if (!requestPattern.test(requestId)) {
    throw new Error("requestId must be a relative slash-separated test request identifier.");
  }
}

function assertSafeIdentifier(value: string, name: string): void {
  if (!value.trim() || value.length > 240 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`Execution authorization ${name} must be a safe identifier.`);
  }
}

function assertUnique(values: string[], name: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) {
    throw new Error(`Duplicate execution authorization ${name}: ${[...new Set(duplicates)].join(", ")}.`);
  }
}

function digestFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
