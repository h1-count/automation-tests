import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { ExecutionOperationKind } from "./authorization.js";
import { operationEvidenceDefinitionIssues } from "./operationEvidence.js";
import { assertFormalSpecSources } from "./runnerPolicy.js";
import { formalCapabilityId } from "./manifest.js";
import { resolveLocalScriptDependencyClosure } from "./scriptDependencyClosure.js";
import type { FormalCaseDefinition, FormalExecutionManifest } from "./types.js";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import type {
  SafeJsonValue,
  WorkflowCapability
} from "../task-workflow/types.js";

export const SCRIPT_REVIEW_POLICY_VERSION = "script-review-policy-v1" as const;
export const SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION = "script-review-evidence-v1" as const;

export type ScriptReviewLevel = "light" | "standard" | "strict";
export type ScriptReviewRole = "script_quality" | "execution_safety";
export type ScriptReviewDataWritePolicy =
  | "no_write"
  | "ephemeral_cleanup"
  | "reusable_fixture"
  | "tracked_residual";

export interface ScriptReviewCaseRisk {
  caseId: string;
  level: ScriptReviewLevel;
  reasons: string[];
}

export interface ScriptReviewRoleScope {
  caseIds: string[];
  scriptPaths: string[];
}

export interface ScriptReviewAssessmentInput {
  requestId: string;
  workspaceRoot: string;
  planPath: string;
  scriptPaths: string[];
  caseIds: string[];
  environment: string;
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: ScriptReviewDataWritePolicy;
  residualTtlHours: number;
  capabilities: WorkflowCapability[];
  caseRiskAssessments?: ScriptReviewCaseRisk[];
  executionHasCleanupActivity: boolean;
  formalCases?: FormalCaseDefinition[];
  formalManifestSchemaVersion?: FormalExecutionManifest["schemaVersion"];
}

export interface ScriptReviewAssessment {
  schemaVersion: typeof SCRIPT_REVIEW_POLICY_VERSION;
  level: ScriptReviewLevel;
  reasons: string[];
  requiredReviewerRoles: ScriptReviewRole[];
  inputDigest: string;
  reviewerInputDigests: Partial<Record<ScriptReviewRole, string>>;
  reviewerScopes: Partial<Record<ScriptReviewRole, ScriptReviewRoleScope>>;
  caseRiskAssessments: ScriptReviewCaseRisk[];
  staticChecks: string[];
  /** Every independent static gate is run concurrently and reported once. */
  staticCheckResults: ScriptStaticCheckResult[];
  blockingIssues: string[];
  publishable: boolean;
}

export interface ScriptStaticCheckResult {
  check: string;
  durationMilliseconds: number;
  issues: string[];
}

export interface ScriptReviewEvidenceDigest {
  role: ScriptReviewRole;
  digest: string;
}

interface ScriptReviewEvidence {
  schemaVersion: typeof SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION;
  role: ScriptReviewRole;
  inputDigest: string;
  verdict: "approved" | "changes_required" | "blocked";
  findingIds: string[];
}

interface LoadedScript {
  path: string;
  digest: string;
  source: string;
  dependencies: readonly string[];
  runtimeLeaf: boolean;
  caseIds: string[];
  caseSources: Array<{ caseId: string; source: string }>;
  unscopedSource: string;
}

const levelRank: Record<ScriptReviewLevel, number> = {
  light: 0,
  standard: 1,
  strict: 2
};

const mutatingOperations = new Set<ExecutionOperationKind>([
  "send_test_otp",
  "upload_synthetic_file",
  "submit_registration",
  "create_test_resource",
  "update_test_resource",
  "delete_test_resource",
  "change_test_permission",
  "invoke_test_device_action",
  "cleanup_test_resource",
  "retain_tracked_residual"
]);

const resourceCreatingOperations = new Set<ExecutionOperationKind>([
  "upload_synthetic_file",
  "submit_registration",
  "create_test_resource",
  "retain_tracked_residual"
]);

const strictOperations = new Set<ExecutionOperationKind>([
  "send_test_otp",
  "change_test_permission",
  "invoke_test_device_action"
]);

const sensitiveLiteralPatterns = [
  /\b(?:password|passwd|token|secret|cookie|api[_-]?key|authorization)\b\s*(?:=|:)\s*(["'`])(?:(?!\1).){4,}\1/iu,
  /\b(?:phone|mobile|手机号)\b\s*(?:=|:)\s*(["'`])\d{11}\1/iu,
  /\b(?:otp|验证码)\b\s*(?:=|:)\s*(["'`])\d{4,8}\1/iu
] as const;

const strictSourceMarkers = [
  { key: "sensitive_credentials", pattern: /\b(?:PASSWORD|PASSWD|TOKEN|SECRET|COOKIE|API_KEY)\b/u },
  {
    key: "otp",
    pattern: /\bsend_test_otp\b|\b(?:send|request)(?:Test)?(?:Sms|Otp|OTP|Code)\b|发送(?:短信)?验证码/iu
  },
  {
    key: "permission",
    pattern: /\b(?:privileged|permission)\b|特权|(?:管理员|权限).{0,24}(?:创建|修改|删除|授予|变更)/iu
  },
  { key: "security_challenge", pattern: /\bCAPTCHA\b|安全挑战|滑块|图形验证码|人机验证/iu },
  { key: "reconciliation", pattern: /\breconcil(?:e|iation)\b|对账|残留核对/iu }
] as const;

const standardSourceMarkers = [
  { key: "upload", pattern: /\bupload\b|上传/iu },
  { key: "authenticated_state", pattern: /\bAUTH_STATE\b|\bstorageState\b|只读认证状态/iu },
  { key: "external_resource", pattern: /\bexternalResources\b|\brequiredResources\s*:\s*\[(?!\s*\])/u },
  { key: "state_transition", pattern: /\b(?:before|after|redirect|route|status|state|transition)\b/iu },
  { key: "locator_risk", pattern: /\.first\(\)|\.nth\(|xpath=|waitForTimeout\(|getByText\(\s*\//u }
] as const;

const moduleRequire = createRequire(import.meta.url);
const typescriptCompiler = resolve(
  dirname(moduleRequire.resolve("typescript/package.json")),
  "bin/tsc"
);
const execFile = promisify(execFileCallback);

export async function assessScriptReview(
  input: ScriptReviewAssessmentInput
): Promise<ScriptReviewAssessment> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const loadedScripts = await loadScripts(workspaceRoot, input.scriptPaths);
  const scripts = loadedScripts.scripts;
  const planPath = safeWorkspacePath(workspaceRoot, input.planPath, "plan path");
  const planDigest = sha256(await readFile(planPath));
  const capabilities = unique(input.capabilities).sort() as WorkflowCapability[];
  const caseIds = unique(input.caseIds).sort();
  const operations = unique(input.allowedOperations).sort() as ExecutionOperationKind[];
  const budgets = [...input.resourceBudgets]
    .map((budget) => ({
      resourceType: budget.resourceType.trim(),
      maxCreates: budget.maxCreates
    }))
    .sort((left, right) => left.resourceType.localeCompare(right.resourceType));
  const reasons: string[] = [];
  const caseRisks = normalizeCaseRisks(caseIds, input.caseRiskAssessments);
  const caseRiskById = new Map(caseRisks.map((risk) => [risk.caseId, risk]));
  let level = highestLevel(caseRisks.map((risk) => risk.level));

  const promoteStage = (next: ScriptReviewLevel, reason: string): void => {
    reasons.push(reason);
    if (levelRank[next] > levelRank[level]) level = next;
  };

  const promoteCases = (
    targetCaseIds: readonly string[],
    next: ScriptReviewLevel,
    reason: string
  ): void => {
    promoteStage(next, reason);
    for (const caseId of targetCaseIds) {
      const current = caseRiskById.get(caseId);
      if (!current || levelRank[next] <= levelRank[current.level]) continue;
      current.level = next;
      current.reasons = unique([...current.reasons, reason]);
    }
  };

  if (/^prod(?:uction)?$/iu.test(input.environment.trim())) {
    promoteCases(caseIds, "strict", "production_environment");
  }
  if (input.dataWritePolicy !== "no_write") {
    promoteStage("standard", `data_write_policy:${input.dataWritePolicy}`);
  }
  for (const operation of operations) {
    if (strictOperations.has(operation)) {
      promoteStage("strict", `high_risk_operation:${operation}`);
    } else if (mutatingOperations.has(operation)) {
      promoteStage("standard", `test_mutation:${operation}`);
    } else if (operation === "accept_agreement") {
      promoteStage("standard", "stateful_interaction:accept_agreement");
    }
  }
  const executableScriptCount = scripts.filter((script) =>
    !script.runtimeLeaf && !script.path.endsWith("/execution.manifest.ts")
  ).length;
  if (executableScriptCount > 1) {
    promoteStage("standard", `script_count:${executableScriptCount}`);
  }
  if (caseIds.length >= 8) promoteStage("standard", `case_count:${caseIds.length}`);
  if (capabilities.length > 1) {
    promoteStage("standard", `multiple_capabilities:${capabilities.length}`);
  }

  for (const script of scripts) {
    if (script.runtimeLeaf) continue;
    if (script.path.endsWith("/execution.manifest.ts")) continue;
    if (script.caseSources.length) {
      for (const caseSource of script.caseSources) {
        for (const marker of strictSourceMarkers) {
          if (!marker.pattern.test(caseSource.source)) continue;
          promoteCases([caseSource.caseId], "strict", `script_marker:${marker.key}`);
        }
        for (const marker of standardSourceMarkers) {
          if (!marker.pattern.test(caseSource.source)) continue;
          promoteCases([caseSource.caseId], "standard", `script_marker:${marker.key}`);
        }
      }
      for (const marker of strictSourceMarkers) {
        if (marker.pattern.test(script.unscopedSource)) {
          promoteStage("strict", `script_marker:${marker.key}`);
        }
      }
      for (const marker of standardSourceMarkers) {
        if (marker.pattern.test(script.unscopedSource)) {
          promoteStage("standard", `script_marker:${marker.key}`);
        }
      }
      continue;
    }
    for (const marker of strictSourceMarkers) {
      if (marker.pattern.test(script.source)) {
        promoteStage("strict", `script_marker:${marker.key}`);
      }
    }
    for (const marker of standardSourceMarkers) {
      if (marker.pattern.test(script.source)) {
        promoteStage("standard", `script_marker:${marker.key}`);
      }
    }
  }

  const hasStrictGlobalSignal = level === "strict"
    && !caseRisks.some((risk) => risk.level === "strict");
  if (hasStrictGlobalSignal) {
    promoteCases(caseIds, "strict", "unscoped_strict_engineering_signal");
  }
  const hasStandardGlobalSignal = level === "standard"
    && caseRisks.every((risk) => risk.level === "light");
  if (hasStandardGlobalSignal) {
    promoteCases(caseIds, "standard", "unscoped_standard_engineering_signal");
  }

  const staticCheckResults = await runStaticChecksInParallel({
    workspaceRoot,
    requestId: input.requestId,
    scripts,
    caseIds,
    manifestSchemaVersion: input.formalManifestSchemaVersion,
    dependencyIssues: loadedScripts.dependencyIssues,
    environment: input.environment,
    operations,
    budgets,
    dataWritePolicy: input.dataWritePolicy,
    residualTtlHours: input.residualTtlHours,
    executionHasCleanupActivity: input.executionHasCleanupActivity,
    formalCases: input.formalCases
  });
  const blockingIssues = staticCheckResults.flatMap((result) => result.issues);
  const requiredReviewerRoles: ScriptReviewRole[] = level === "light"
    ? []
    : level === "standard"
      ? ["script_quality"]
      : ["script_quality", "execution_safety"];
  const normalizedReasons = unique(reasons);
  for (const risk of caseRisks) risk.reasons = unique(risk.reasons).sort();
  const staticChecks = [
    "project_typescript_compile",
    ...(["web", "h5"].includes(input.requestId.split("/")[0]!) ? ["formal_source_gate"] : []),
    ...(["web", "h5"].includes(input.requestId.split("/")[0]!) ? ["playwright_discovery"] : []),
    "sensitive_literal_scan",
    "operation_outcome_evidence",
    "execution_scope_and_cleanup"
  ];
  const inputDigest = sha256(canonicalJson({
    schemaVersion: SCRIPT_REVIEW_POLICY_VERSION,
    requestId: input.requestId,
    ...(input.formalManifestSchemaVersion
      ? { formalManifestSchemaVersion: input.formalManifestSchemaVersion }
      : {}),
    planDigest,
    scripts: scripts.map(({ path, digest }) => ({ path, digest })),
    caseIds,
    environment: input.environment.trim(),
    allowedOperations: operations,
    resourceBudgets: budgets,
    dataWritePolicy: input.dataWritePolicy,
    residualTtlHours: input.residualTtlHours,
    capabilities,
    caseRiskAssessments: caseRisks,
    level,
    reasons: normalizedReasons,
    requiredReviewerRoles,
    ...(input.formalCases ? {
      operationEvidence: input.formalCases.map((item) => ({
        caseId: item.caseId,
        requiredOperations: item.requiredOperations ?? [],
        operationBudgets: item.operationBudgets ?? [],
        ...(item.dataWritePolicy ? { dataWritePolicy: item.dataWritePolicy } : {}),
        operationEvidence: item.operationEvidence ?? []
      }))
    } : {}),
    staticChecks
  } as unknown as SafeJsonValue));
  const qualityCaseIds = caseRisks
    .filter((risk) => levelRank[risk.level] >= levelRank.standard)
    .map((risk) => risk.caseId);
  const safetyCaseIds = caseRisks
    .filter((risk) => risk.level === "strict")
    .map((risk) => risk.caseId);
  const qualityScripts = selectRoleScripts(scripts, qualityCaseIds, "script_quality");
  const safetyScripts = selectRoleScripts(scripts, safetyCaseIds, "execution_safety");
  const reviewerScopes: Partial<Record<ScriptReviewRole, ScriptReviewRoleScope>> = {};
  const reviewerInputDigests: Partial<Record<ScriptReviewRole, string>> = {};
  if (requiredReviewerRoles.includes("script_quality")) {
    reviewerScopes.script_quality = {
      caseIds: qualityCaseIds,
      scriptPaths: qualityScripts.map((script) => script.path)
    };
    reviewerInputDigests.script_quality = sha256(canonicalJson({
      schemaVersion: SCRIPT_REVIEW_POLICY_VERSION,
      role: "script_quality",
      requestId: input.requestId,
      planDigest,
      scripts: qualityScripts.map(({ path, digest }) => ({ path, digest })),
      caseRisks: caseRisks.filter((risk) => qualityCaseIds.includes(risk.caseId)),
      capabilities,
      staticChecks
    } as unknown as SafeJsonValue));
  }
  if (requiredReviewerRoles.includes("execution_safety")) {
    reviewerScopes.execution_safety = {
      caseIds: safetyCaseIds,
      scriptPaths: safetyScripts.map((script) => script.path)
    };
    reviewerInputDigests.execution_safety = sha256(canonicalJson({
      schemaVersion: SCRIPT_REVIEW_POLICY_VERSION,
      role: "execution_safety",
      requestId: input.requestId,
      environment: input.environment.trim(),
      allowedOperations: operations,
      resourceBudgets: budgets,
      dataWritePolicy: input.dataWritePolicy,
      residualTtlHours: input.residualTtlHours,
      capabilities,
      caseRisks: caseRisks.filter((risk) => safetyCaseIds.includes(risk.caseId)),
      scripts: safetyScripts.map(({ path, digest }) => ({ path, digest }))
    } as unknown as SafeJsonValue));
  }

  return {
    schemaVersion: SCRIPT_REVIEW_POLICY_VERSION,
    level,
    reasons: normalizedReasons,
    requiredReviewerRoles,
    inputDigest,
    reviewerInputDigests,
    reviewerScopes,
    caseRiskAssessments: caseRisks,
    staticChecks,
    staticCheckResults,
    blockingIssues: unique(blockingIssues),
    publishable: blockingIssues.length === 0
  };
}

export async function validateScriptReviewEvidenceFiles(input: {
  assessment: ScriptReviewAssessment;
  evidencePaths: string[];
  workspaceRoot: string;
  runtimeRequestRoot: string;
}): Promise<ScriptReviewEvidenceDigest[]> {
  const expected = input.assessment.requiredReviewerRoles;
  if (!expected.length) {
    if (input.evidencePaths.length) {
      throw new Error("Light script review does not accept reviewer evidence.");
    }
    return [];
  }
  if (input.evidencePaths.length !== expected.length) {
    throw new Error(
      `Script review ${input.assessment.level} requires reviewer evidence for: ${expected.join(", ")}.`
    );
  }

  const evidenceRoot = resolve(input.runtimeRequestRoot, "review-evidence");
  const realEvidenceRoot = await realpath(evidenceRoot).catch(() => {
    throw new Error(`Script review evidence directory does not exist: ${evidenceRoot}`);
  });
  const loaded = await Promise.all(input.evidencePaths.map(async (path) => {
    const candidate = resolve(input.workspaceRoot, path);
    const realCandidate = await realpath(candidate).catch(() => {
      throw new Error(`Script review evidence does not exist: ${path}`);
    });
    const withinRoot = relative(realEvidenceRoot, realCandidate);
    if (
      !withinRoot
      || withinRoot === ".."
      || withinRoot.startsWith(`..${sep}`)
    ) {
      throw new Error("Script review evidence must stay under the current request runtime directory.");
    }
    const bytes = await readFile(realCandidate);
    const evidence = parseEvidence(JSON.parse(bytes.toString("utf8")) as unknown);
    if (evidence.inputDigest !== input.assessment.reviewerInputDigests[evidence.role]) {
      throw new Error(`Script review evidence for ${evidence.role} is stale.`);
    }
    if (evidence.verdict !== "approved") {
      throw new Error(
        `Script review evidence for ${evidence.role} is ${evidence.verdict}; publication is blocked.`
      );
    }
    if (evidence.findingIds.length) {
      throw new Error(`Approved script review evidence for ${evidence.role} must have no open findings.`);
    }
    return {
      role: evidence.role,
      digest: sha256(bytes)
    };
  }));
  const roles = loaded.map((item) => item.role);
  if (new Set(roles).size !== roles.length) {
    throw new Error("Script review evidence roles must be unique.");
  }
  if (JSON.stringify([...roles].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Script review evidence roles must match: ${expected.join(", ")}.`);
  }
  return loaded.sort((left, right) => left.role.localeCompare(right.role));
}

export function scriptReviewVerification(input: {
  assessment: ScriptReviewAssessment;
  evidence: ScriptReviewEvidenceDigest[];
  verification: string;
}): string {
  const evidence = input.evidence.length
    ? input.evidence.map((item) => `${item.role}:${item.digest}`).join(",")
    : "none";
  return [
    `script_review_policy=${input.assessment.schemaVersion}`,
    `level=${input.assessment.level}`,
    `inputDigest=${input.assessment.inputDigest}`,
    `checks=${input.assessment.staticChecks.join(",")}`,
    `evidence=${evidence}`,
    input.verification.trim()
  ].filter(Boolean).join("; ");
}

function parseEvidence(value: unknown): ScriptReviewEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Script review evidence must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schemaVersion",
    "role",
    "inputDigest",
    "verdict",
    "findingIds"
  ]);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw new Error(`Script review evidence contains unsupported fields: ${unexpected.join(", ")}.`);
  }
  if (record.schemaVersion !== SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION) {
    throw new Error("Unsupported script review evidence schema.");
  }
  if (!["script_quality", "execution_safety"].includes(String(record.role))) {
    throw new Error("Script review evidence has an unsupported role.");
  }
  if (typeof record.inputDigest !== "string" || !/^[a-f0-9]{64}$/u.test(record.inputDigest)) {
    throw new Error("Script review evidence requires a lowercase SHA-256 inputDigest.");
  }
  if (!["approved", "changes_required", "blocked"].includes(String(record.verdict))) {
    throw new Error("Script review evidence has an unsupported verdict.");
  }
  if (
    !Array.isArray(record.findingIds)
    || record.findingIds.some((item) => typeof item !== "string" || !item.trim())
    || new Set(record.findingIds).size !== record.findingIds.length
  ) {
    throw new Error("Script review evidence findingIds must be unique non-empty strings.");
  }
  return record as unknown as ScriptReviewEvidence;
}

async function loadScripts(
  workspaceRoot: string,
  scriptPaths: string[]
): Promise<{ scripts: LoadedScript[]; dependencyIssues: string[] }> {
  const closure = resolveLocalScriptDependencyClosure({
    workspaceRoot,
    entryPaths: scriptPaths,
    allowSyntaxErrors: true
  });
  const scripts = await Promise.all(closure.paths.map(async (path) => {
    const source = await readFile(resolve(workspaceRoot, path), "utf8");
    const { caseSources, unscopedSource } = extractFormalCaseSources(source);
    return {
      path,
      source,
      digest: sha256(source),
      dependencies: closure.dependenciesByPath.get(path) ?? [],
      runtimeLeaf: closure.runtimeLeafPaths.has(path),
      caseIds: unique(caseSources.map(({ caseId }) => caseId)).sort(),
      caseSources,
      unscopedSource
    };
  }));
  return { scripts, dependencyIssues: closure.issues };
}

function extractFormalCaseSources(source: string): {
  caseSources: Array<{ caseId: string; source: string }>;
  unscopedSource: string;
} {
  const matches = [...source.matchAll(/\bformalCase\(\s*["']([^"']+)["']/gu)];
  if (!matches.length) return { caseSources: [], unscopedSource: source };
  let suffixStart = source.length;
  const caseSources = matches.map((match, index) => {
    const start = match.index!;
    let end = matches[index + 1]?.index ?? source.length;
    if (index === matches.length - 1) {
      const helper = /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gu;
      helper.lastIndex = start;
      const helperMatch = helper.exec(source);
      if (helperMatch?.index !== undefined) {
        end = Math.min(end, helperMatch.index);
        suffixStart = helperMatch.index;
      }
    }
    return {
      caseId: match[1]!,
      source: source.slice(start, end)
    };
  });
  return {
    caseSources,
    unscopedSource: `${source.slice(0, matches[0]!.index!)}\n${source.slice(suffixStart)}`
  };
}

function normalizeCaseRisks(
  caseIds: string[],
  assessments: ScriptReviewCaseRisk[] | undefined
): ScriptReviewCaseRisk[] {
  if (assessments === undefined) {
    return caseIds.map((caseId) => ({
      caseId,
      level: "light",
      reasons: ["case_risk_not_supplied:light_default"]
    }));
  }
  const known = new Set(caseIds);
  const seen = new Set<string>();
  for (const assessment of assessments) {
    if (!known.has(assessment.caseId)) {
      throw new Error(`Script review case risk references unknown caseId: ${assessment.caseId}.`);
    }
    if (seen.has(assessment.caseId)) {
      throw new Error(`Script review case risks contain duplicate caseId: ${assessment.caseId}.`);
    }
    seen.add(assessment.caseId);
    if (!Object.hasOwn(levelRank, assessment.level)) {
      throw new Error(`Script review case risk has unsupported level for ${assessment.caseId}.`);
    }
    if (
      !Array.isArray(assessment.reasons)
      || assessment.reasons.some((reason) => typeof reason !== "string" || !reason.trim())
    ) {
      throw new Error(`Script review case risk reasons must be non-empty strings for ${assessment.caseId}.`);
    }
  }
  const missing = caseIds.filter((caseId) => !seen.has(caseId));
  if (missing.length) {
    throw new Error(`Script review case risks are missing caseIds: ${missing.join(", ")}.`);
  }
  return assessments
    .map((assessment) => ({
      caseId: assessment.caseId,
      level: assessment.level,
      reasons: unique(assessment.reasons.map((reason) => reason.trim())).sort()
    }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function highestLevel(levels: ScriptReviewLevel[]): ScriptReviewLevel {
  return levels.reduce<ScriptReviewLevel>(
    (highest, level) => levelRank[level] > levelRank[highest] ? level : highest,
    "light"
  );
}

function selectRoleScripts(
  scripts: LoadedScript[],
  caseIds: string[],
  role: ScriptReviewRole
): LoadedScript[] {
  const scopedCases = new Set(caseIds);
  const selected = new Set(scripts
    .filter((script) => script.caseIds.some((caseId) => scopedCases.has(caseId)))
    .map((script) => script.path));
  if (caseIds.length) {
    for (const script of scripts) {
      if (script.path.endsWith("/execution.manifest.ts")) selected.add(script.path);
      if (
        role === "execution_safety"
        && script.caseIds.length === 0
        && strictSourceMarkers.some((marker) => marker.pattern.test(script.source))
      ) {
        selected.add(script.path);
      }
    }
  }

  const scriptByPath = new Map(scripts.map((script) => [script.path, script]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const path of [...selected]) {
      const script = scriptByPath.get(path);
      if (!script) continue;
      for (const dependency of localScriptDependencies(script, scriptByPath)) {
        if (selected.has(dependency)) continue;
        selected.add(dependency);
        changed = true;
      }
    }
  }
  return [...selected]
    .map((path) => scriptByPath.get(path)!)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function localScriptDependencies(
  script: LoadedScript,
  scriptByPath: Map<string, LoadedScript>
): string[] {
  return script.dependencies.filter((dependency) => scriptByPath.has(dependency));
}

async function runStaticChecksInParallel(input: {
  workspaceRoot: string;
  requestId: string;
  scripts: LoadedScript[];
  caseIds: string[];
  manifestSchemaVersion?: FormalExecutionManifest["schemaVersion"];
  dependencyIssues: string[];
  environment: string;
  operations: ExecutionOperationKind[];
  budgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: ScriptReviewDataWritePolicy;
  residualTtlHours: number;
  executionHasCleanupActivity: boolean;
  formalCases?: FormalCaseDefinition[];
}): Promise<ScriptStaticCheckResult[]> {
  const checks: Array<{ check: string; run: () => Promise<string[]> }> = [
    { check: "local_dependency_closure", run: async () => input.dependencyIssues },
    { check: "project_typescript_compile", run: () => compileIssues(input.workspaceRoot, input.scripts) },
    {
      check: "formal_source_gate",
      run: async () => formalSourceIssues(
        input.requestId,
        input.scripts,
        input.caseIds,
        input.manifestSchemaVersion
      )
    },
    { check: "playwright_discovery", run: () => playwrightDiscoveryIssues(input.workspaceRoot, input.requestId, input.caseIds) },
    {
      check: "sensitive_literal_scan",
      run: async () => sensitiveLiteralIssues(input.scripts.filter((script) => !script.runtimeLeaf))
    },
    {
      check: "operation_outcome_evidence",
      run: async () => executionSafetyIssues({
        environment: input.environment,
        operations: input.operations,
        budgets: input.budgets,
        dataWritePolicy: input.dataWritePolicy,
        residualTtlHours: input.residualTtlHours,
        executionHasCleanupActivity: input.executionHasCleanupActivity,
        formalCases: input.formalCases
      })
    }
  ];
  return Promise.all(checks.map(async ({ check, run }) => {
    const startedAt = Date.now();
    try {
      return { check, durationMilliseconds: Date.now() - startedAt, issues: await run() };
    } catch (error) {
      return {
        check,
        durationMilliseconds: Date.now() - startedAt,
        issues: [`${check} failed: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }));
}

async function compileIssues(workspaceRoot: string, scripts: LoadedScript[]): Promise<string[]> {
  const typedScripts = scripts
    .map((script) => script.path)
    .filter((path) => /\.[cm]?tsx?$/u.test(path));
  if (!typedScripts.length) return [];
  const projectConfig = resolve(workspaceRoot, "tsconfig.json");
  const compilerArgs = existsSync(projectConfig)
    ? [typescriptCompiler, "--project", projectConfig, "--pretty", "false"]
    : [
        typescriptCompiler,
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "es2022",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        ...typedScripts
      ];
  try {
    await execFile(process.execPath, compilerArgs, { cwd: workspaceRoot });
    return [];
  } catch {
    return [`TypeScript compile failed for: ${typedScripts.join(", ")}.`];
  }
}

async function playwrightDiscoveryIssues(
  workspaceRoot: string,
  requestId: string,
  expectedCaseIds: string[]
): Promise<string[]> {
  if (!["web", "h5"].includes(requestId.split("/")[0]!)) return [];
  const configPath = resolve(workspaceRoot, "playwright.config.ts");
  const executable = resolve(workspaceRoot, "node_modules/.bin/playwright");
  if (!existsSync(configPath) || !existsSync(executable)) return [];
  let output: string;
  try {
    const result = await execFile(executable, ["test", "--list", "--config=playwright.config.ts"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        AUTOMATION_REQUEST_ID: requestId,
        PLAYWRIGHT_FORMAL_SCRIPT_SCOPE: `.local/test-runs/${requestId}/candidate-scripts`,
        PLAYWRIGHT_AUTHORIZED_CASE_IDS: expectedCaseIds.join(","),
        PLAYWRIGHT_FORMAL_WORKERS: "1"
      }
    });
    output = `${result.stdout}\n${result.stderr}`;
  } catch {
    return ["Playwright discovery failed for the frozen formal script scope."];
  }
  const missing = expectedCaseIds.filter((caseId) => !output.includes(`${caseId}：`));
  return missing.length > 0
    ? [`Playwright discovery omitted caseIds: ${missing.join(", ")}.`]
    : [];
}

function formalSourceIssues(
  requestId: string,
  scripts: LoadedScript[],
  expectedCaseIds: string[],
  manifestSchemaVersion?: FormalExecutionManifest["schemaVersion"]
): string[] {
  if (!["web", "h5"].includes(requestId.split("/")[0]!)) return [];
  const formalSpecs = scripts.filter((script) => script.path.endsWith(".formal.spec.ts"));
  try {
    assertFormalSpecSources(
      formalSpecs.map(({ path, source }) => ({ path, source })),
      expectedCaseIds,
      { manifestSchemaVersion }
    );
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function sensitiveLiteralIssues(scripts: LoadedScript[]): string[] {
  return scripts.flatMap((script) =>
    sensitiveLiteralPatterns.some((pattern) => pattern.test(script.source))
      ? [`${script.path}: contains a sensitive-looking literal assignment.`]
      : []
  );
}

function executionSafetyIssues(input: {
  environment: string;
  operations: ExecutionOperationKind[];
  budgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: ScriptReviewDataWritePolicy;
  residualTtlHours: number;
  executionHasCleanupActivity: boolean;
  formalCases?: FormalCaseDefinition[];
}): string[] {
  const issues: string[] = [];
  const operationSet = new Set(input.operations);
  const hasMutation = input.operations.some((operation) => mutatingOperations.has(operation));
  const createsResource = input.operations.some((operation) => resourceCreatingOperations.has(operation));
  if (/^prod(?:uction)?$/iu.test(input.environment.trim())) {
    issues.push("Production execution authorization is forbidden.");
  }
  if (!Number.isInteger(input.residualTtlHours) || input.residualTtlHours <= 0) {
    issues.push("Residual TTL must be a positive integer.");
  }
  if (input.dataWritePolicy === "no_write" && hasMutation) {
    issues.push("no_write cannot authorize mutating operations.");
  }
  if (input.dataWritePolicy === "ephemeral_cleanup" && hasMutation) {
    if (!operationSet.has("cleanup_test_resource")) {
      issues.push("ephemeral_cleanup mutations require cleanup_test_resource.");
    }
  }
  for (const formalCase of input.formalCases ?? []) {
    const budgeted = new Map(
      (formalCase.operationBudgets ?? []).map((budget) => [budget.operation, budget.maxExecutions])
    );
    for (const operation of formalCase.requiredOperations ?? []) {
      if (resourceCreatingOperations.has(operation)
        && operation !== "retain_tracked_residual"
        && (!Number.isInteger(budgeted.get(operation)) || budgeted.get(operation)! <= 0)) {
        issues.push(`${formalCase.caseId}: ${operation} requires a positive per-case operation budget.`);
      }
    }
    for (const issue of operationEvidenceDefinitionIssues({
      requiredOperations: formalCase.requiredOperations ?? [],
      requiredCapabilities: formalCase.requiredCapabilities.map(formalCapabilityId),
      definitions: formalCase.operationEvidence,
      dataWritePolicy: formalCase.dataWritePolicy
    })) {
      issues.push(`${formalCase.caseId}: ${issue}`);
    }
  }
  if (
    createsResource
    && !input.budgets.some((budget) =>
      budget.resourceType && Number.isInteger(budget.maxCreates) && budget.maxCreates > 0
    )
  ) {
    issues.push("Resource-creating operations require a positive resource budget.");
  }
  return issues;
}

function safeWorkspacePath(workspaceRoot: string, path: string, label: string): string {
  const absolute = resolve(workspaceRoot, path);
  const withinRoot = relative(workspaceRoot, absolute);
  if (
    !withinRoot
    || withinRoot === ".."
    || withinRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`${label} must stay inside the workspace.`);
  }
  return absolute;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
