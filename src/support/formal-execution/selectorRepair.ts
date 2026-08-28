import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";
import { sha256Canonical } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import {
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  type ExecutionAuthorizationSnapshot,
  type ExecutionSelectorRepairContext
} from "./authorization.js";
import { buildExecutionDependencyPlan } from "./dependencyPlan.js";
import type {
  FormalCaseResult,
  FormalExecutionManifest,
  FormalExecutionRecord,
  FormalSelectorRepairIncidentReference,
  FormalSelectorRepairSafetyProof
} from "./types.js";

export const SELECTOR_REPAIR_INCIDENT_SCHEMA_VERSION = "selector-repair-incident-v1" as const;

export type SelectorRepairFailureCode =
  | "selector_not_found"
  | "selector_not_unique"
  | "selector_not_actionable"
  | "accessible_name_drift";

export interface SelectorRepairDescriptor {
  strategy: "role_name";
  role: string;
  value: string;
  scopeId: string;
  stateId: string;
  action: "click";
}

export interface SelectorRepairIncident {
  schemaVersion: typeof SELECTOR_REPAIR_INCIDENT_SCHEMA_VERSION;
  incidentId: string;
  recordedAt: string;
  requestId: string;
  authorizationDigest: string;
  targetBuildDigest: string;
  caseId: string;
  attempt: number;
  source: {
    scriptPath: string;
    scriptDigest: string;
    patchedScriptDigest: string;
    selectorId: string;
    sourceSpanDigest: string;
  };
  expected: SelectorRepairDescriptor;
  candidate?: SelectorRepairDescriptor;
  observedCandidateCount: number;
  failureCode: SelectorRepairFailureCode;
  businessAssertion: false;
  sideEffectProof: FormalSelectorRepairSafetyProof;
  affectedCaseIds: string[];
  dependentCaseIds: string[];
  evidenceRefs: string[];
  eligibility: {
    status: "eligible" | "rejected";
    reasons: string[];
  };
  digest: string;
}

export interface RecordSelectorRepairIncidentInput {
  snapshot: ExecutionAuthorizationSnapshot;
  caseId: string;
  attempt: number;
  sourcePath: string;
  selectorId: string;
  candidateName?: string;
  observedCandidateCount: number;
  candidateActionable: boolean;
  failureCode: SelectorRepairFailureCode;
  sideEffectProof: FormalSelectorRepairSafetyProof;
  dependentCaseIds?: string[];
  workspaceRoot?: string;
  recordedAt?: string;
}

export interface SelectorRepairRecoveryAssessment {
  status: "eligible" | "not_applicable" | "rejected";
  reason?: string;
  incidents: SelectorRepairIncident[];
  incidentPaths: string[];
  context?: ExecutionSelectorRepairContext;
}

interface GuardedSelectorBinding {
  caseId: string;
  selectorId: string;
  sourcePath: string;
  role: string;
  name: string;
  scopeId: string;
  stateId: string;
  action: "click";
  businessAssertion: false;
  nameStart: number;
  nameEnd: number;
  sourceSpanDigest: string;
}

export async function recordSelectorRepairIncident(
  input: RecordSelectorRepairIncidentInput
): Promise<{ incident: SelectorRepairIncident; reference: FormalSelectorRepairIncidentReference }> {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  if (input.snapshot.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION) {
    throw new Error(
      input.snapshot.mode === "stable_suite"
        ? "Stable-suite direct_execute cannot repair a selector in place; create an affected_rebuild request."
        : "Selector repair incidents require request execution authorization."
    );
  }
  if (!input.snapshot.targetBuildDigest) {
    throw new Error("Selector repair requires a frozen target build digest.");
  }
  const scriptPath = safeWorkspacePath(workspaceRoot, input.sourcePath);
  const authorizedScript = input.snapshot.scriptDigests.find((item) => item.path === scriptPath);
  if (!authorizedScript) {
    throw new Error(`Selector repair source is outside the authorized script closure: ${scriptPath}.`);
  }
  const source = await readFile(resolve(workspaceRoot, scriptPath), "utf8");
  const scriptDigest = sha256Text(source);
  if (scriptDigest !== authorizedScript.digest) {
    throw new Error("Selector repair source changed after execution authorization.");
  }
  const binding = guardedSelectorBinding(source, input.selectorId);
  if (
    binding.caseId !== input.caseId
    || binding.sourcePath !== scriptPath
    || !input.snapshot.caseIds.includes(input.caseId)
  ) {
    throw new Error("Selector repair binding differs from the authorized case or source.");
  }
  const candidateValue = input.candidateName === undefined
    ? undefined
    : safeSelectorValue(input.candidateName, "candidate accessible name");
  const expectedValue = safeSelectorValue(binding.name, "expected accessible name");
  const candidate = candidateValue === undefined
    ? undefined
    : descriptor(binding, candidateValue);
  const patchedScriptDigest = candidateValue === undefined
    ? scriptDigest
    : sha256Text(replaceSelectorName(source, binding, candidateValue));
  const reasons: string[] = [];
  if (!input.sideEffectProof.safe) reasons.push("side_effect_boundary_crossed");
  if (input.observedCandidateCount !== 1) reasons.push("candidate_not_unique");
  if (!input.candidateActionable) reasons.push("candidate_not_actionable");
  if (!candidate || !selectorValuesRelated(expectedValue, candidate.value)) {
    reasons.push("candidate_value_not_deterministically_related");
  }
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(recordedAt))) {
    throw new Error("Selector repair recordedAt is invalid.");
  }
  const identity = sha256Canonical({
    schemaVersion: SELECTOR_REPAIR_INCIDENT_SCHEMA_VERSION,
    requestId: input.snapshot.requestId,
    authorizationDigest: input.snapshot.digest,
    caseId: input.caseId,
    attempt: input.attempt,
    sourceSpanDigest: binding.sourceSpanDigest,
    expected: expectedValue,
    candidate: candidateValue ?? null
  });
  const incidentId = `selector-repair-${identity.slice(0, 24)}`;
  const withoutDigest = {
    schemaVersion: SELECTOR_REPAIR_INCIDENT_SCHEMA_VERSION,
    incidentId,
    recordedAt,
    requestId: input.snapshot.requestId,
    authorizationDigest: input.snapshot.digest,
    targetBuildDigest: input.snapshot.targetBuildDigest,
    caseId: input.caseId,
    attempt: input.attempt,
    source: {
      scriptPath,
      scriptDigest,
      patchedScriptDigest,
      selectorId: binding.selectorId,
      sourceSpanDigest: binding.sourceSpanDigest
    },
    expected: descriptor(binding, expectedValue),
    ...(candidate ? { candidate } : {}),
    observedCandidateCount: input.observedCandidateCount,
    failureCode: input.failureCode,
    businessAssertion: false as const,
    sideEffectProof: normalizeSafetyProof(input.sideEffectProof),
    affectedCaseIds: [input.caseId],
    dependentCaseIds: [...new Set(input.dependentCaseIds ?? [])]
      .filter((caseId) => caseId !== input.caseId)
      .sort(),
    evidenceRefs: [],
    eligibility: {
      status: reasons.length ? "rejected" as const : "eligible" as const,
      reasons: [...new Set(reasons)].sort()
    }
  };
  const digest = sha256Canonical(withoutDigest as unknown as SafeJsonValue);
  const incident: SelectorRepairIncident = { ...withoutDigest, digest };
  const referencePath = `artifacts/test-results/formal/${input.snapshot.digest.slice(0, 12)}/selector-repair/${incidentId}.json`;
  const path = resolve(workspaceRoot, referencePath);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteText(path, `${JSON.stringify(incident, null, 2)}\n`);
  return {
    incident,
    reference: {
      schemaVersion: "formal-selector-repair-reference-v1",
      incidentId,
      digest,
      path: referencePath,
      eligibility: incident.eligibility.status
    }
  };
}

export async function loadSelectorRepairIncident(
  path: string,
  workspaceRoot = process.cwd()
): Promise<SelectorRepairIncident> {
  const root = resolve(workspaceRoot);
  const relativePath = safeWorkspacePath(root, path);
  if (!relativePath.startsWith("artifacts/test-results/formal/")) {
    throw new Error("Selector repair incident must be stored under formal execution artifacts.");
  }
  const parsed = JSON.parse(await readFile(resolve(root, relativePath), "utf8")) as unknown;
  const incident = parseIncident(parsed);
  const { digest, ...withoutDigest } = incident;
  if (sha256Canonical(withoutDigest as unknown as SafeJsonValue) !== digest) {
    throw new Error("Selector repair incident digest does not match its immutable content.");
  }
  return incident;
}

export async function applySelectorRepairIncident(
  incident: SelectorRepairIncident,
  workspaceRoot = process.cwd()
): Promise<"applied" | "already_applied"> {
  if (incident.eligibility.status !== "eligible" || !incident.candidate) {
    throw new Error("Only an eligible selector repair incident can modify a script.");
  }
  const root = resolve(workspaceRoot);
  const path = resolve(root, safeWorkspacePath(root, incident.source.scriptPath));
  const source = await readFile(path, "utf8");
  const currentDigest = sha256Text(source);
  const binding = guardedSelectorBinding(source, incident.source.selectorId);
  if (currentDigest === incident.source.patchedScriptDigest) {
    assertBindingMatchesIncident(binding, incident, false);
    if (binding.name !== incident.candidate.value) {
      throw new Error("Selector repair patched digest does not contain the recorded candidate.");
    }
    return "already_applied";
  }
  if (currentDigest !== incident.source.scriptDigest) {
    throw new Error("Selector repair source drifted after the incident was recorded.");
  }
  assertBindingMatchesIncident(binding, incident, true);
  const updated = replaceSelectorName(source, binding, incident.candidate.value);
  if (sha256Text(updated) !== incident.source.patchedScriptDigest) {
    throw new Error("Selector repair candidate no longer produces the recorded patched digest.");
  }
  await atomicWriteText(path, updated);
  return "applied";
}

export async function validateSelectorRepairIncidentSource(
  incident: SelectorRepairIncident,
  workspaceRoot = process.cwd()
): Promise<"original" | "applied"> {
  if (incident.eligibility.status !== "eligible" || !incident.candidate) {
    throw new Error("Only an eligible selector repair incident has a repairable source state.");
  }
  const root = resolve(workspaceRoot);
  const source = await readFile(
    resolve(root, safeWorkspacePath(root, incident.source.scriptPath)),
    "utf8"
  );
  const currentDigest = sha256Text(source);
  const binding = guardedSelectorBinding(source, incident.source.selectorId);
  if (currentDigest === incident.source.scriptDigest) {
    assertBindingMatchesIncident(binding, incident, true);
    return "original";
  }
  if (currentDigest === incident.source.patchedScriptDigest) {
    assertBindingMatchesIncident(binding, incident, false);
    if (binding.name === incident.candidate.value) return "applied";
  }
  throw new Error("Selector repair source drifted after the incident was recorded.");
}

export async function assessSelectorRepairRecovery(input: {
  requestId: string;
  snapshot: ExecutionAuthorizationSnapshot;
  record: FormalExecutionRecord;
  manifest: FormalExecutionManifest;
  workspaceRoot?: string;
  incidentPaths?: string[];
}): Promise<SelectorRepairRecoveryAssessment> {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  if (input.snapshot.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION) {
    return {
      status: input.snapshot.mode === "stable_suite" ? "rejected" : "not_applicable",
      reason: input.snapshot.mode === "stable_suite"
        ? "direct_execute requires a successor affected_rebuild request"
        : "selector repair requires request execution authorization",
      incidents: [],
      incidentPaths: []
    };
  }
  if (input.record.authorizationDigest !== input.snapshot.digest) {
    throw new Error("Selector repair record differs from the accepted authorization.");
  }
  const terminalUnknowns = Object.values(input.record.cases).filter((result) =>
    result.status === "unknown" && result.attempts.at(-1)?.finality === "terminal"
  );
  if (!terminalUnknowns.length) {
    return { status: "not_applicable", incidents: [], incidentPaths: [] };
  }
  if (!cleanupAccepted(input.record)) {
    return {
      status: "rejected",
      reason: "formal data hygiene is not accepted",
      incidents: [],
      incidentPaths: []
    };
  }
  const paths = input.incidentPaths?.length
    ? [...new Set(input.incidentPaths)].sort()
    : [...new Set(terminalUnknowns.flatMap((result) =>
        result.attempts.at(-1)?.selectorRepairIncident?.path ?? []
      ))].sort();
  const incidents = await Promise.all(paths.map((path) =>
    loadSelectorRepairIncident(path, workspaceRoot)
  ));
  if (
    incidents.length !== terminalUnknowns.length
    || new Set(incidents.map((incident) => incident.caseId)).size !== incidents.length
  ) {
    return {
      status: "rejected",
      reason: "terminal selector incidents must map one-to-one to terminal unknown cases",
      incidents,
      incidentPaths: paths
    };
  }
  const byCase = new Map(incidents.map((incident) => [incident.caseId, incident]));
  if (terminalUnknowns.some((result) =>
    byCase.get(result.caseId)?.eligibility.status !== "eligible"
  )) {
    return {
      status: "rejected",
      reason: "not every terminal unknown has one eligible selector repair incident",
      incidents,
      incidentPaths: paths
    };
  }
  for (const result of terminalUnknowns) {
    const incident = byCase.get(result.caseId)!;
    const latest = result.attempts.at(-1)!;
    if (
      incident.requestId !== input.requestId
      || incident.authorizationDigest !== input.snapshot.digest
      || incident.targetBuildDigest !== input.snapshot.targetBuildDigest
      || incident.attempt !== latest.attempt
      || latest.selectorRepairIncident?.digest !== incident.digest
      || !incident.sideEffectProof.safe
    ) {
      throw new Error(`Selector repair incident ${incident.incidentId} drifted from its formal result.`);
    }
    const sourceState = await validateSelectorRepairIncidentSource(incident, workspaceRoot);
    if (sourceState !== "original") {
      throw new Error(`Selector repair incident ${incident.incidentId} was already applied before scope reopen.`);
    }
  }
  const retryCaseIds = selectorRepairRetryCaseIds(
    input.manifest,
    input.snapshot.caseIds,
    incidents.map((incident) => incident.caseId)
  );
  const nonConclusive = Object.values(input.record.cases).filter((result) =>
    !["passed", "failed"].includes(result.status) && !retryCaseIds.includes(result.caseId)
  );
  if (nonConclusive.length) {
    return {
      status: "rejected",
      reason: `unrelated non-conclusive cases remain: ${nonConclusive.map((item) => item.caseId).sort().join(", ")}`,
      incidents,
      incidentPaths: paths
    };
  }
  const carriedCases = await Promise.all(Object.values(input.record.cases)
    .filter((result) => !retryCaseIds.includes(result.caseId))
    .sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map(async (result) => carriedCaseReference({
      result,
      record: input.record,
      workspaceRoot
    })));
  return {
    status: "eligible",
    incidents,
    incidentPaths: paths,
    context: {
      schemaVersion: "selector-repair-context-v1",
      priorAuthorizationDigest: input.snapshot.digest,
      incidentDigests: incidents.map((incident) => incident.digest).sort(),
      affectedCaseIds: incidents.map((incident) => incident.caseId).sort(),
      retryCaseIds,
      carriedCases
    }
  };
}

export function selectorRepairEventContext(
  assessment: SelectorRepairRecoveryAssessment
): SafeJsonValue {
  if (assessment.status !== "eligible" || !assessment.context) {
    throw new Error("Only an eligible selector repair assessment can reopen execution scope.");
  }
  return {
    schemaVersion: "selector-repair-reopen-v1",
    incidentPaths: assessment.incidentPaths,
    priorExecutionDigest: assessment.context.priorAuthorizationDigest,
    incidentDigests: assessment.context.incidentDigests,
    affectedCaseIds: assessment.context.affectedCaseIds,
    retryCaseIds: assessment.context.retryCaseIds,
    carriedCases: assessment.context.carriedCases.map((item) => ({
      caseId: item.caseId,
      sourceExecutionDigest: item.sourceAuthorizationDigest,
      sourceCaseResultDigest: item.sourceCaseResultDigest,
      sourceEvidenceBundleDigest: item.sourceEvidenceBundleDigest
    }))
  };
}

export function repairContextFromEvent(value: unknown): ExecutionSelectorRepairContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== "selector-repair-reopen-v1") return undefined;
  const priorAuthorizationDigest = requireDigest(
    raw.priorExecutionDigest,
    "priorExecutionDigest"
  );
  const incidentDigests = stringArray(raw.incidentDigests, "incidentDigests")
    .map((digest) => requireDigest(digest, "incidentDigest"));
  const affectedCaseIds = stringArray(raw.affectedCaseIds, "affectedCaseIds");
  const retryCaseIds = stringArray(raw.retryCaseIds, "retryCaseIds");
  if (!Array.isArray(raw.carriedCases)) {
    throw new Error("Selector repair reopen event carriedCases must be an array.");
  }
  return {
    schemaVersion: "selector-repair-context-v1",
    priorAuthorizationDigest,
    incidentDigests,
    affectedCaseIds,
    retryCaseIds,
    carriedCases: raw.carriedCases.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Selector repair reopen event contains an invalid carried case.");
      }
      const carried = value as Record<string, unknown>;
      if (typeof carried.caseId !== "string" || !carried.caseId.trim()) {
        throw new Error("Selector repair reopen event carried caseId is invalid.");
      }
      return {
        caseId: carried.caseId,
        sourceAuthorizationDigest: requireDigest(
          carried.sourceExecutionDigest,
          "sourceExecutionDigest"
        ),
        sourceCaseResultDigest: requireDigest(
          carried.sourceCaseResultDigest,
          "sourceCaseResultDigest"
        ),
        sourceEvidenceBundleDigest: requireDigest(
          carried.sourceEvidenceBundleDigest,
          "sourceEvidenceBundleDigest"
        )
      };
    })
  };
}

export function selectorRepairIncidentPathsFromEvent(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== "selector-repair-reopen-v1") return [];
  return stringArray(raw.incidentPaths, "incidentPaths");
}

function guardedSelectorBinding(source: string, selectorId: string): GuardedSelectorBinding {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "importAttributes"]
  }) as unknown as AstNode;
  const matches: GuardedSelectorBinding[] = [];
  visitAst(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as AstNode | undefined;
    if (callee?.type !== "Identifier" || callee.name !== "guardedRoleLocator") return;
    const object = (node.arguments as AstNode[] | undefined)?.[0];
    if (object?.type !== "ObjectExpression") return;
    const values = objectLiteralValues(object);
    if (values.selectorId?.value !== selectorId) return;
    const name = values.name;
    if (!name || typeof name.value !== "string" || name.start === undefined || name.end === undefined) {
      throw new Error(`Guarded selector ${selectorId} must use a string literal name.`);
    }
    if (
      typeof values.caseId?.value !== "string"
      || typeof values.sourcePath?.value !== "string"
      || typeof values.role?.value !== "string"
      || typeof values.scopeId?.value !== "string"
      || typeof values.stateId?.value !== "string"
      || values.action?.value !== "click"
      || values.businessAssertion?.value !== false
    ) {
      throw new Error(`Guarded selector ${selectorId} has a non-literal or unsupported repair contract.`);
    }
    const span = source.slice(name.start, name.end);
    matches.push({
      caseId: values.caseId.value,
      selectorId,
      sourcePath: values.sourcePath.value,
      role: values.role.value,
      name: name.value,
      scopeId: values.scopeId.value,
      stateId: values.stateId.value,
      action: "click",
      businessAssertion: false,
      nameStart: name.start,
      nameEnd: name.end,
      sourceSpanDigest: sha256Canonical({
        selectorId,
        start: name.start,
        end: name.end,
        span
      })
    });
  });
  if (matches.length !== 1) {
    throw new Error(`Selector repair requires exactly one guarded selectorId ${selectorId}; found ${matches.length}.`);
  }
  return matches[0]!;
}

function objectLiteralValues(object: AstNode): Record<string, {
  value: string | boolean;
  start?: number;
  end?: number;
}> {
  const result: Record<string, { value: string | boolean; start?: number; end?: number }> = {};
  for (const property of object.properties as AstNode[] ?? []) {
    if (property.type !== "ObjectProperty") continue;
    const key = property.key as AstNode | undefined;
    const value = property.value as AstNode | undefined;
    const name = key?.type === "Identifier" || key?.type === "StringLiteral"
      ? String(key.name ?? key.value)
      : undefined;
    if (!name || !value) continue;
    if (value.type === "StringLiteral" && typeof value.value === "string") {
      result[name] = { value: value.value, start: value.start, end: value.end };
    } else if (value.type === "BooleanLiteral" && typeof value.value === "boolean") {
      result[name] = { value: value.value, start: value.start, end: value.end };
    }
  }
  return result;
}

interface AstNode {
  type?: string;
  name?: string;
  value?: unknown;
  start?: number;
  end?: number;
  callee?: unknown;
  arguments?: unknown;
  properties?: unknown;
  key?: unknown;
  [key: string]: unknown;
}

function visitAst(value: unknown, visitor: (node: AstNode) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitAst(item, visitor));
    return;
  }
  const node = value as AstNode;
  if (typeof node.type === "string") visitor(node);
  for (const [key, child] of Object.entries(node)) {
    if (["loc", "start", "end", "extra", "errors", "comments", "tokens"].includes(key)) continue;
    visitAst(child, visitor);
  }
}

function descriptor(binding: GuardedSelectorBinding, value: string): SelectorRepairDescriptor {
  return {
    strategy: "role_name",
    role: binding.role,
    value,
    scopeId: binding.scopeId,
    stateId: binding.stateId,
    action: binding.action
  };
}

function parseIncident(value: unknown): SelectorRepairIncident {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Selector repair incident must be a JSON object.");
  }
  const incident = value as SelectorRepairIncident;
  if (
    incident.schemaVersion !== SELECTOR_REPAIR_INCIDENT_SCHEMA_VERSION
    || !/^selector-repair-[a-f0-9]{24}$/u.test(incident.incidentId)
    || !Number.isFinite(Date.parse(incident.recordedAt))
    || !isNonEmptyString(incident.requestId)
    || !isNonEmptyString(incident.caseId)
    || !Number.isInteger(incident.attempt)
    || incident.attempt < 1
    || !Number.isInteger(incident.observedCandidateCount)
    || incident.observedCandidateCount < 0
    || ![
      "selector_not_found",
      "selector_not_unique",
      "selector_not_actionable",
      "accessible_name_drift"
    ].includes(incident.failureCode)
    || incident.businessAssertion !== false
    || !["eligible", "rejected"].includes(incident.eligibility?.status)
  ) {
    throw new Error("Selector repair incident has an invalid immutable contract.");
  }
  requireDigest(incident.authorizationDigest, "authorizationDigest");
  requireDigest(incident.targetBuildDigest, "targetBuildDigest");
  requireDigest(incident.source?.scriptDigest, "scriptDigest");
  requireDigest(incident.source?.patchedScriptDigest, "patchedScriptDigest");
  requireDigest(incident.source?.sourceSpanDigest, "sourceSpanDigest");
  requireDigest(incident.digest, "incident digest");
  if (
    !isNonEmptyString(incident.source?.scriptPath)
    || !isNonEmptyString(incident.source?.selectorId)
    || !isStringArray(incident.affectedCaseIds)
    || incident.affectedCaseIds.length !== 1
    || incident.affectedCaseIds[0] !== incident.caseId
    || !isStringArray(incident.dependentCaseIds)
    || incident.dependentCaseIds.includes(incident.caseId)
    || !isStringArray(incident.evidenceRefs)
    || !isStringArray(incident.eligibility.reasons)
    || !isSortedUnique(incident.dependentCaseIds)
    || !isSortedUnique(incident.eligibility.reasons)
  ) {
    throw new Error("Selector repair incident has invalid scope or evidence references.");
  }
  safeSelectorValue(incident.expected?.value, "expected accessible name");
  if (incident.candidate) safeSelectorValue(incident.candidate.value, "candidate accessible name");
  if (
    incident.expected?.strategy !== "role_name"
    || incident.expected.action !== "click"
    || !incident.expected.role
    || !incident.expected.scopeId
    || !incident.expected.stateId
    || (incident.candidate && (
      incident.candidate.strategy !== incident.expected.strategy
      || incident.candidate.role !== incident.expected.role
      || incident.candidate.scopeId !== incident.expected.scopeId
      || incident.candidate.stateId !== incident.expected.stateId
      || incident.candidate.action !== incident.expected.action
    ))
  ) {
    throw new Error("Selector repair incident changes selector strategy or semantic boundaries.");
  }
  const safetyProof = normalizeSafetyProof(incident.sideEffectProof);
  if (incident.eligibility.status === "eligible" && (
    !incident.candidate
    || incident.observedCandidateCount !== 1
    || incident.failureCode !== "accessible_name_drift"
    || !safetyProof.safe
    || incident.eligibility.reasons.length !== 0
    || !selectorValuesRelated(incident.expected.value, incident.candidate.value)
  )) {
    throw new Error("Eligible selector repair incident violates the fail-closed repair boundary.");
  }
  if (incident.eligibility.status === "rejected" && incident.eligibility.reasons.length === 0) {
    throw new Error("Rejected selector repair incident must retain its rejection reasons.");
  }
  const expectedIncidentId = `selector-repair-${sha256Canonical({
    schemaVersion: SELECTOR_REPAIR_INCIDENT_SCHEMA_VERSION,
    requestId: incident.requestId,
    authorizationDigest: incident.authorizationDigest,
    caseId: incident.caseId,
    attempt: incident.attempt,
    sourceSpanDigest: incident.source.sourceSpanDigest,
    expected: incident.expected.value,
    candidate: incident.candidate?.value ?? null
  }).slice(0, 24)}`;
  if (incident.incidentId !== expectedIncidentId) {
    throw new Error("Selector repair incident identity does not match its immutable inputs.");
  }
  return incident;
}

function assertBindingMatchesIncident(
  binding: GuardedSelectorBinding,
  incident: SelectorRepairIncident,
  requireOriginalName: boolean
): void {
  if (
    binding.caseId !== incident.caseId
    || binding.sourcePath !== incident.source.scriptPath
    || binding.selectorId !== incident.source.selectorId
    || binding.role !== incident.expected.role
    || binding.scopeId !== incident.expected.scopeId
    || binding.stateId !== incident.expected.stateId
    || binding.action !== incident.expected.action
    || binding.businessAssertion !== false
    || (requireOriginalName && (
      binding.name !== incident.expected.value
      || binding.sourceSpanDigest !== incident.source.sourceSpanDigest
    ))
  ) {
    throw new Error("Selector repair AST binding drifted from the recorded incident.");
  }
}

export function selectorRepairRetryCaseIds(
  manifest: FormalExecutionManifest,
  selectedCaseIds: string[],
  affectedCaseIds: string[]
): string[] {
  const plan = buildExecutionDependencyPlan(manifest, selectedCaseIds);
  const retry = new Set(affectedCaseIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of plan.edges) {
      if (retry.has(edge.producerCaseId) || retry.has(edge.consumerCaseId)) {
        for (const caseId of [edge.producerCaseId, edge.consumerCaseId]) {
          if (!retry.has(caseId)) {
            retry.add(caseId);
            changed = true;
          }
        }
      }
    }
  }
  return [...retry].sort();
}

async function carriedCaseReference(input: {
  result: FormalCaseResult;
  record: FormalExecutionRecord;
  workspaceRoot: string;
}) {
  const latest = input.result.attempts.at(-1);
  if (
    !latest
    || latest.finality !== "terminal"
    || !["passed", "failed"].includes(input.result.status)
  ) {
    throw new Error(`Case ${input.result.caseId} is not eligible for carry-forward.`);
  }
  const evidencePath = resolve(
    input.workspaceRoot,
    "artifacts/test-results/formal",
    input.record.authorizationDigest.slice(0, 12),
    "case-evidence",
    `${input.result.caseId}.json`
  );
  if (!existsSync(evidencePath)) {
    throw new Error(`Case ${input.result.caseId} has no redacted evidence bundle to carry.`);
  }
  return {
    caseId: input.result.caseId,
    sourceAuthorizationDigest: input.record.authorizationDigest,
    sourceCaseResultDigest: caseResultDigest(input.result),
    sourceEvidenceBundleDigest: sha256Text(await readFile(evidencePath, "utf8"))
  };
}

export function caseResultDigest(result: FormalCaseResult): string {
  return sha256Canonical({
    schemaVersion: "formal-carried-case-result-v1",
    result: JSON.parse(JSON.stringify(result)) as SafeJsonValue
  });
}

function cleanupAccepted(record: FormalExecutionRecord): boolean {
  return record.cleanup?.status !== "failed"
    && ["clean", "reusable", "retained"].includes(record.cleanup?.dataHygieneStatus ?? "");
}

function normalizeSafetyProof(value: FormalSelectorRepairSafetyProof): FormalSelectorRepairSafetyProof {
  const counts = [
    value.completedStageCount,
    value.transitionCount,
    value.dataIntentCount,
    value.dataResourceCount,
    value.operationReservationCount,
    value.producedResourceCount
  ];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error("Selector repair side-effect proof contains an invalid count.");
  }
  const safe = counts.every((count) => count === 0);
  if (value.safe !== safe) {
    throw new Error("Selector repair side-effect proof conflicts with its durable counts.");
  }
  return { ...value, safe };
}

export function selectorValuesRelated(expected: string, candidate: string): boolean {
  const left = normalizeSelectorValue(expected);
  const right = normalizeSelectorValue(candidate);
  return left.length >= 2
    && right.length >= 2
    && left !== right
    && (left.includes(right) || right.includes(left));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1_024;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isSortedUnique(value: string[]): boolean {
  return JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}

function normalizeSelectorValue(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function replaceSelectorName(
  source: string,
  binding: GuardedSelectorBinding,
  candidate: string
): string {
  const replacement = JSON.stringify(candidate);
  return `${source.slice(0, binding.nameStart)}${replacement}${source.slice(binding.nameEnd)}`;
}

function safeSelectorValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Selector repair ${label} must be a string.`);
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    !normalized
    || normalized.length > 120
    || /\bBearer\s+|\b(password|passwd|passcode|otp|token|cookie|authorization)\b\s*[:=]/iu.test(normalized)
    || /\b1[3-9]\d{9}\b/u.test(normalized)
  ) {
    throw new Error(`Selector repair ${label} is unsafe or unbounded.`);
  }
  return normalized;
}

function safeWorkspacePath(workspaceRoot: string, path: string): string {
  const absolute = resolve(workspaceRoot, path);
  const candidate = relative(workspaceRoot, absolute).split(sep).join("/");
  if (!candidate || candidate === ".." || candidate.startsWith("../")) {
    throw new Error("Selector repair path escapes the workspace.");
  }
  return candidate;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Selector repair ${label} must be a non-empty string array.`);
  }
  return [...new Set(value)].sort();
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Selector repair ${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function atomicWriteText(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}
