import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import {
  digestPlanForExecutionAuthorization
} from "../task-workflow/executionAuthorizationSubject.js";
import { DurableWorkflowManager } from "../task-workflow/workflowManager.js";
import type { SafeJsonValue, WorkflowEvent } from "../task-workflow/types.js";

export const executionOperationKinds = [
  "send_test_otp",
  "upload_synthetic_file",
  "accept_agreement",
  "submit_registration",
  "create_test_resource",
  "query_postcondition",
  "cleanup_test_resource",
  "retain_tracked_residual"
] as const;
export type ExecutionOperationKind = (typeof executionOperationKinds)[number];

export interface ExecutionAuthorizationSnapshot {
  schemaVersion: "execution-authorization-v2";
  requestId: string;
  environment: string;
  planDigest: string;
  scriptDigests: Array<{ path: string; digest: string }>;
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "tracked_residual";
  residualTtlHours: number;
  securityChallengePolicy: "test-channel-first-minimal-human";
  artifactPolicy: "retain-with-sensitive-step-redaction";
  digest: string;
  status: "confirmed";
  createdAt: string;
  confirmedAt: string;
  confirmationId: string;
}

export const EXECUTION_AUTHORIZATION_ARTIFACT = "execution-authorization.json";
export const EXECUTION_AUTHORIZATION_SCHEMA_VERSION = "execution-authorization-v2" as const;

export interface ExecutionAuthorizationManifest {
  schemaVersion: typeof EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  requestId: string;
  environment: string;
  planDigest: string;
  scriptDigests: Array<{ path: string; digest: string }>;
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "tracked_residual";
  residualTtlHours: number;
  securityChallengePolicy: "test-channel-first-minimal-human";
  artifactPolicy: "retain-with-sensitive-step-redaction";
  digest: string;
  callbackId: string;
  createdAt: string;
}

export interface BuildExecutionAuthorizationManifestInput {
  requestId: string;
  environment: string;
  scriptPaths: string[];
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "tracked_residual";
  residualTtlHours?: number;
  planPath?: string;
  workspaceRoot?: string;
  createdAt?: string;
  callbackId?: string;
}

interface ExecutionAuthorizationDigestBase {
  schemaVersion: typeof EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
  requestId: string;
  environment: string;
  planDigest: string;
  scriptDigests: Array<{ path: string; digest: string }>;
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "tracked_residual";
  residualTtlHours: number;
  securityChallengePolicy: "test-channel-first-minimal-human";
  artifactPolicy: "retain-with-sensitive-step-redaction";
}

const digestPattern = /^[a-f0-9]{64}$/;
const requestPattern = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const mutatingOperations = new Set<ExecutionOperationKind>([
  "send_test_otp",
  "upload_synthetic_file",
  "submit_registration",
  "create_test_resource",
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
    workflow.planPath
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
  const planPath = resolve(input.planPath ?? manager.planPath);
  const base = normalizeDigestBase({
    schemaVersion: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    requestId: input.requestId,
    environment: input.environment,
    planDigest: digestPlanForExecutionAuthorization(planPath),
    scriptDigests: input.scriptPaths.map((path) => {
      const safePath = safeWorkspaceRelativePath(workspaceRoot, path, "script path");
      return { path: safePath, digest: digestFile(resolve(workspaceRoot, safePath)) };
    }),
    caseIds: input.caseIds,
    allowedOperations: input.allowedOperations,
    resourceBudgets: input.resourceBudgets,
    dataWritePolicy: input.dataWritePolicy,
    residualTtlHours: input.residualTtlHours ?? 72,
    securityChallengePolicy: "test-channel-first-minimal-human",
    artifactPolicy: "retain-with-sensitive-step-redaction"
  });
  validateDigestBase(base);
  const digest = calculateExecutionAuthorizationDigest(base);
  const callbackId = input.callbackId ?? `execution-authorization-${digest.slice(0, 12)}`;
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
  const normalizedPaths = [...new Set(
    scriptPaths.map((path) => safeWorkspaceRelativePath(root, path, "script path"))
  )];
  const unauthorized = normalizedPaths.filter((path) => !authorized.has(path));
  if (unauthorized.length) {
    throw new Error(`Formal Runner discovered scripts outside the confirmed authorization: ${unauthorized.join(", ")}.`);
  }
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
  if (!activity || activity.definition.kind !== "execution_authorization") {
    throw new Error("Workflow definition is missing the execution-authorization Activity.");
  }
  const events = await workflow.events();
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
    schemaVersion: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
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
    "environment",
    "planDigest",
    "scriptDigests",
    "caseIds",
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
  if (raw.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION) {
    throw new Error("Unsupported execution authorization manifest schema.");
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
  if (!["no_write", "managed_cleanup", "tracked_residual"].includes(String(dataWritePolicy))) {
    throw new Error("Execution authorization manifest has an invalid dataWritePolicy.");
  }
  const base = normalizeDigestBase({
    schemaVersion: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
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
    artifactPolicy: raw.artifactPolicy as ExecutionAuthorizationDigestBase["artifactPolicy"]
  });
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
  return {
    ...value,
    scriptDigests: [...value.scriptDigests]
      .map((item) => ({ path: item.path, digest: item.digest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    caseIds: [...value.caseIds].sort(),
    allowedOperations: [...value.allowedOperations].sort() as ExecutionOperationKind[],
    resourceBudgets: [...value.resourceBudgets]
      .map((item) => ({ resourceType: item.resourceType.trim(), maxCreates: item.maxCreates }))
      .sort((left, right) => left.resourceType.localeCompare(right.resourceType))
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
