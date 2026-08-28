import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import {
  assertExactFormalWebCoverage,
  assertFormalWebCoveragePlan,
  coverageEntryById,
  isCoverageId,
  type FormalWebCoveragePlan
} from "./webScriptCoverage.js";
import type { ExecutionOperationKind } from "./authorization.js";
import { executionOperationKinds } from "./authorization.js";
import { defineFormalExecutionManifest } from "./manifest.js";
import { operationEvidenceDefinitionIssues } from "./operationEvidence.js";
import { inspectFormalSpecSource } from "./sourceGate.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath
} from "../test-assets/assetManifest.js";
import {
  findGeneratedUploadAsset,
  readGeneratedUploadAssetManifest
} from "../test-assets/generatedUploadAssets.js";
import type {
  FormalBusinessOracleAuthority,
  FormalBusinessOracleObservationKind,
  FormalProducedResourceContract,
  FormalDataWritePolicy,
  FormalExecutionManifest,
  FormalOperationEvidenceDefinition,
  FormalPermissionProfile
} from "./types.js";

/**
 * A deliberately small, declarative input for Web candidate scripts. The host
 * may describe reviewed user-visible actions, but it never submits TypeScript,
 * a manifest, or an independently chosen case range.
 */
export const FORMAL_WEB_SCRIPT_SPEC_SCHEMA_VERSION = "formal-web-script-spec-v1" as const;
export const FORMAL_WEB_SCRIPT_COMPILER_VERSION = "formal-web-script-compiler-v1" as const;

export type FormalWebAction =
  | { kind: "goto"; path: string }
  | { kind: "expect_role_visible"; role: string; name: string }
  | { kind: "expect_role_text"; role: string; name: string; text: string }
  | { kind: "expect_role_value"; role: string; name: string; value: WebValueRef }
  | { kind: "expect_validation_message"; role?: string; name?: string; text: string }
  | { kind: "expect_url"; path: string }
  | { kind: "fill_role"; role: string; name: string; value: WebValueRef }
  | { kind: "clear_role"; role: string; name: string }
  | { kind: "blur_role"; role: string; name: string }
  | { kind: "select_role_option"; role: string; name: string; value: WebValueRef }
  | { kind: "check_role"; role: string; name: string }
  | { kind: "uncheck_role"; role: string; name: string }
  | {
      kind: "set_files_label";
      label: string;
      asset: FormalWebFileAsset;
      operation: "upload_synthetic_file";
      response: { method: string; path: string; contractId: string; successStatusCodes: number[] };
    }
  | { kind: "trial_click_role"; role: string; name: string }
  | { kind: "click_read_only_role"; role: string; name: string }
  | { kind: "click_read_only_text"; text: string; exact?: boolean }
  | {
      kind: "click_role";
      role: string;
      name: string;
      operation: ExecutionOperationKind;
      response: { method: string; path: string; contractId: string; successStatusCodes: number[] };
    }
  /** Reserve a local, authorized test-data creation intent before the UI submit. */
  | {
      kind: "begin_synthetic_create";
      intentKey: string;
      resourceType: string;
      syntheticKey: string;
      expectedOutcome?: "create" | "reject";
      dataWritePolicy: Exclude<FormalDataWritePolicy, "no_write">;
    }
  /** Bind a successfully created UI resource to an immutable named manifest resource. */
  | {
      kind: "confirm_synthetic_resource";
      intentKey: string;
      publishName: string;
      identity: { role: string; name: string };
    }
  /** Execute and verify the UI deletion of a current-run ephemeral test resource. */
  | {
      kind: "cleanup_role";
      resourceName: string;
      role: string;
      name: string;
      response: { method: string; path: string; contractId: string; successStatusCodes: number[] };
    };

/** A file input can only use a Git-registered sample or this request's generated boundary file. */
export type FormalWebFileAsset =
  | {
      kind: "registered_test_asset";
      assetId: string;
      assetPath: string;
      assetSha256: string;
    }
  | {
      kind: "generated_upload_asset";
      assetId: string;
      assetPath: string;
      assetSha256: string;
      manifestPath: string;
      generatorDigest: string;
    };

export type WebValueRef =
  | { kind: "frozen_data"; dataId: string; value: string }
  | { kind: "environment"; variable: string }
  /** Runtime-only value from the current authorization's local test-data ledger. */
  | { kind: "resource_metadata"; resourceName: string; key: string };

export interface FormalWebOracleCheck {
  kind: "role_visible" | "role_hidden" | "role_text" | "role_value" | "validation_message" | "validation_message_absent" | "url" | "response_status";
  role?: string;
  name?: string;
  text?: string;
  value?: WebValueRef;
  path?: string;
  contractId?: string;
  successStatusCodes?: number[];
}

export interface FormalWebScriptSpecStep {
  /** Immutable row identity from formal-web-coverage-plan-v1. */
  coverageId: string;
  /** Stable within one formal case and normally matches the testcase data row. */
  stepId: string;
  title: string;
  oracle: {
    oracleId: string;
    observationKind: FormalBusinessOracleObservationKind;
    contractId?: string;
    authorities: FormalBusinessOracleAuthority[];
    checks: FormalWebOracleCheck[];
  };
  actions: FormalWebAction[];
}

export interface FormalWebScriptSpecCase {
  caseId: string;
  title: string;
  route: string;
  ruleRef: string;
  permissionProfile: FormalPermissionProfile;
  dataWritePolicy: FormalDataWritePolicy;
  requiredOperations: ExecutionOperationKind[];
  /** Named resources available when this case starts; they determine DAG ordering. */
  requiredResources?: string[];
  /** Current-run test resources produced by this case. */
  producesResources?: FormalProducedResourceContract[];
  operationEvidence?: FormalOperationEvidenceDefinition[];
  noWriteNetworkPolicy?: {
    reviewedReadOnlyRequests: Array<{ contractId: string; method: string; path: string }>;
    forbiddenMutationPaths: string[];
  };
  steps: FormalWebScriptSpecStep[];
}

export interface FormalWebScriptSpec {
  schemaVersion: typeof FORMAL_WEB_SCRIPT_SPEC_SCHEMA_VERSION;
  requestId: string;
  suiteId: string;
  projectId: string;
  environment: string;
  /** This preserves the user-confirmed order; it must match cases exactly. */
  selectedCaseIds: string[];
  sourceContract: { targetBuildDigest: string };
  /** Digest of the exact confirmed execution rows this candidate implements. */
  coveragePlanDigest: string;
  /** Frozen review-time capacity for operations that create controlled resources. */
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  /**
   * 全部用例共同依赖的真实运行环境能力（如已登录会话态文件）。
   * 编译为 manifest 的 environment 能力声明，由 readiness 在执行前核实。
   */
  environmentCapabilities?: Array<{
    id: string;
    variable: string;
    pattern?: string;
    unavailableReason: string;
    unblockCondition: string;
  }>;
  cases: FormalWebScriptSpecCase[];
}

export interface RenderedFormalWebBundle {
  spec: FormalWebScriptSpec;
  formalSpecSource: string;
  manifestSource: string;
  sourceContract: string;
  artifacts: Array<{ targetPath: string; content: string }>;
  staticCaseIds: string[];
  coveragePlan?: FormalWebCoveragePlan;
  repairReport?: FormalWebScriptRepairReport;
}

export interface FormalWebScriptRepairReport {
  schemaVersion: "formal-web-script-repair-report-v1";
  coveragePlanDigest: string;
  repairedCoverageIds: string[];
  unresolved: Array<{ coverageId: string; reason: string }>;
}

/**
 * The host may propose only missing, already-frozen coverage rows.  This is
 * intentionally not a TypeScript escape hatch: scope, data policy, sources
 * and operations remain the original compiler specification's responsibility.
 */
export interface FormalWebScriptRepairProposal {
  schemaVersion: "formal-web-script-repair-proposal-v1";
  coveragePlanDigest: string;
  steps: Array<{ caseId: string; step: FormalWebScriptSpecStep }>;
}

export function parseFormalWebScriptSpec(value: unknown): FormalWebScriptSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("formal-web-script-spec-v1 must be a JSON object.");
  }
  const spec = value as Partial<FormalWebScriptSpec>;
  if (spec.schemaVersion !== FORMAL_WEB_SCRIPT_SPEC_SCHEMA_VERSION) {
    throw new Error(`Web build requires ${FORMAL_WEB_SCRIPT_SPEC_SCHEMA_VERSION}.`);
  }
  if (!isNonEmptyString(spec.requestId) || !isNonEmptyString(spec.suiteId)
    || !isNonEmptyString(spec.projectId) || !isNonEmptyString(spec.environment)) {
    throw new Error("formal-web-script-spec-v1 requires requestId, suiteId, projectId and environment.");
  }
  if (!Array.isArray(spec.selectedCaseIds) || !spec.selectedCaseIds.length
    || spec.selectedCaseIds.some((caseId) => !isCaseId(caseId))
    || new Set(spec.selectedCaseIds).size !== spec.selectedCaseIds.length) {
    throw new Error("formal-web-script-spec-v1 selectedCaseIds must be a non-empty unique caseId list.");
  }
  if (!spec.sourceContract || !isSha256(spec.sourceContract.targetBuildDigest)) {
    throw new Error("formal-web-script-spec-v1 requires sourceContract.targetBuildDigest SHA-256.");
  }
  if (!isSha256(spec.coveragePlanDigest)) {
    throw new Error("formal-web-script-spec-v1 requires coveragePlanDigest SHA-256.");
  }
  if (!Array.isArray(spec.resourceBudgets)
    || spec.resourceBudgets.some((budget) => !isSafeResourceBudget(budget))) {
    throw new Error("formal-web-script-spec-v1 resourceBudgets must contain safe resourceType and non-negative maxCreates.");
  }
  const environmentCapabilities = spec.environmentCapabilities ?? [];
  if (!Array.isArray(environmentCapabilities)
    || environmentCapabilities.some((capability) =>
      !isNonEmptyString(capability?.id)
      || !/^[a-z][a-z0-9-]{1,127}$/u.test(capability.id)
      || !/^TEST_[A-Z0-9_]{2,80}$/u.test(String(capability?.variable ?? ""))
      || (capability.pattern !== undefined && !isNonEmptyString(capability.pattern))
      || !isNonEmptyString(capability?.unavailableReason)
      || !isNonEmptyString(capability?.unblockCondition)
    ) || new Set(environmentCapabilities.map((capability) => capability.id)).size !== environmentCapabilities.length) {
    throw new Error("formal-web-script-spec-v1 environmentCapabilities must be unique ids with TEST_* variables and explicit reasons.");
  }
  if (!Array.isArray(spec.cases) || spec.cases.length !== spec.selectedCaseIds.length) {
    throw new Error("formal-web-script-spec-v1 must provide exactly one case entry for every selected caseId.");
  }
  const seen = new Set<string>();
  for (const entry of spec.cases) validateCase(entry, seen);
  validateSyntheticResourceLifecycle(spec as FormalWebScriptSpec);
  if (spec.cases.some((entry) => entry.requiredOperations.some((operation) =>
    ["upload_synthetic_file", "submit_registration", "create_test_resource", "retain_tracked_residual"].includes(operation)
  )) && !spec.resourceBudgets.some((budget) => budget.maxCreates > 0)) {
    throw new Error("formal-web-script-spec-v1 resource-creating operations require a positive frozen resource budget.");
  }
  const actual = spec.cases.map((entry) => entry.caseId);
  if (JSON.stringify(actual) !== JSON.stringify(spec.selectedCaseIds)) {
    throw new Error("formal-web-script-spec-v1 case entries must match selectedCaseIds in the frozen order.");
  }
  return spec as FormalWebScriptSpec;
}

export function assertFormalWebSpecMatchesFrozenScope(
  spec: FormalWebScriptSpec,
  input: { requestId: string; suiteId?: string; selectedCaseIds: string[]; environment?: string }
): void {
  if (spec.requestId !== input.requestId) throw new Error("scope_mismatch: Web spec requestId differs from this request.");
  if (input.suiteId && spec.suiteId !== input.suiteId) {
    throw new Error("scope_mismatch: Web spec suiteId differs from the frozen suite binding.");
  }
  if (input.environment && spec.environment !== input.environment) {
    throw new Error("scope_mismatch: Web spec environment differs from the frozen run intent.");
  }
  if (JSON.stringify(spec.selectedCaseIds) !== JSON.stringify(input.selectedCaseIds)) {
    throw new Error("scope_mismatch: Web spec selectedCaseIds differ from the frozen confirmation scope.");
  }
}

export function applyFormalWebScriptRepairProposal(input: {
  spec: FormalWebScriptSpec;
  coveragePlan: FormalWebCoveragePlan;
  proposal: FormalWebScriptRepairProposal;
}): { spec: FormalWebScriptSpec; report: FormalWebScriptRepairReport } {
  const spec = parseFormalWebScriptSpec(input.spec);
  assertFormalWebCoveragePlan(input.coveragePlan);
  const proposal = input.proposal;
  if (proposal.schemaVersion !== "formal-web-script-repair-proposal-v1"
    || proposal.coveragePlanDigest !== input.coveragePlan.digest
    || !Array.isArray(proposal.steps)) {
    throw new Error("formal-web-script-repair-proposal-v1 does not match the frozen coverage plan.");
  }
  const planEntries = new Map(input.coveragePlan.entries.map((entry) => [entry.coverageId, entry]));
  const existing = new Set(spec.cases.flatMap((entry) => entry.steps.map((step) => step.coverageId)));
  const missing = new Set(input.coveragePlan.entries.map((entry) => entry.coverageId).filter((id) => !existing.has(id)));
  const repaired = new Set<string>();
  const next = structuredClone(spec);
  for (const item of proposal.steps) {
    const coverage = planEntries.get(item.step?.coverageId);
    const target = next.cases.find((entry) => entry.caseId === item.caseId);
    if (!coverage || !target || coverage.caseId !== item.caseId
      || !missing.has(coverage.coverageId) || repaired.has(coverage.coverageId)) {
      throw new Error("formal-web-script-repair-proposal-v1 may only add each missing frozen coverage row once.");
    }
    target.steps.push(item.step);
    repaired.add(coverage.coverageId);
  }
  const parsed = parseFormalWebScriptSpec(next);
  const unresolved = [...missing].filter((id) => !repaired.has(id)).sort().map((coverageId) => ({
    coverageId,
    reason: "no_verified_repair_step"
  }));
  return {
    spec: parsed,
    report: {
      schemaVersion: "formal-web-script-repair-report-v1",
      coveragePlanDigest: input.coveragePlan.digest,
      repairedCoverageIds: [...repaired].sort(),
      unresolved
    }
  };
}

export function renderFormalWebScriptBundle(input: {
  workspaceRoot: string;
  requestId: string;
  spec: FormalWebScriptSpec;
  coveragePlan?: FormalWebCoveragePlan;
}): RenderedFormalWebBundle {
  const spec = parseFormalWebScriptSpec(input.spec);
  if (input.coveragePlan) {
    assertFormalWebCoveragePlan(input.coveragePlan);
    assertExactFormalWebCoverage({
      plan: input.coveragePlan,
      coveragePlanDigest: spec.coveragePlanDigest,
      steps: spec.cases.flatMap((entry) => entry.steps.map((step) => ({
        caseId: entry.caseId,
        coverageId: step.coverageId
      })))
    });
  }
  const environmentCapabilities = spec.environmentCapabilities ?? [];
  validateReferencedAssets(spec, input.workspaceRoot);
  if (spec.requestId !== input.requestId) throw new Error("scope_mismatch: Web spec requestId differs from render request.");
  const candidateRoot = resolve(input.workspaceRoot, ".local", "test-runs", ...input.requestId.split("/"), "candidate-scripts");
  const formalSpecPath = resolve(candidateRoot, "web.formal.spec.ts");
  const manifestPath = resolve(candidateRoot, "execution.manifest.ts");
  const contractPath = resolve(candidateRoot, "contracts", "formal-source-contract.json");
  // source-contract-evidence-v1 契约条目与 registered_source 权威使用解析器要求的精确键集；
  // 渲染时同时校验具名源文件的存在性与字节摘要，保证构建产物与登记材料一致。
  assertAuthoritySourceFiles(spec, input.workspaceRoot);
  const sourceContract = `${JSON.stringify({
    schemaVersion: "source-contract-evidence-v1",
    requestId: spec.requestId,
    projectId: spec.projectId,
    targetBuildDigest: spec.sourceContract.targetBuildDigest,
    contracts: spec.cases.flatMap((entry) => entry.steps.map((step) => ({
      caseId: entry.caseId,
      oracleId: step.oracle.oracleId,
      ruleRef: entry.ruleRef,
      observationKind: step.oracle.observationKind,
      ...(step.oracle.contractId ? { contractId: step.oracle.contractId } : {}),
      authorities: step.oracle.authorities.map((authority) =>
        authority.kind === "registered_source"
          ? {
              kind: authority.kind,
              materialId: authority.materialId,
              sectionId: authority.sectionId,
              sourceSha256: authority.sourceSha256,
              sourceFiles: authority.sourceFiles
            }
          : {
              kind: authority.kind,
              decisionType: authority.decisionType,
              subjectDigest: authority.subjectDigest
            })
    })))
  }, null, 2)}\n`;
  const sourceContractDigest = sha256(sourceContract);
  const formalImport = relative(dirname(formalSpecPath), resolve(input.workspaceRoot, "src/support/formal-execution/formalCase.js"))
    .split(sep).join("/");
  const noWriteGuardImport = relative(dirname(formalSpecPath), resolve(input.workspaceRoot, "src/support/web/networkOperationGuard.js"))
    .split(sep).join("/");
  const operationEvidenceImport = relative(dirname(formalSpecPath), resolve(input.workspaceRoot, "src/support/formal-execution/operationEvidence.js"))
    .split(sep).join("/");
  const manifestImport = relative(dirname(formalSpecPath), manifestPath).split(sep).join("/");
  const manifestRuntimeImport = relative(dirname(manifestPath), resolve(input.workspaceRoot, "src/support/formal-execution/manifest.js"))
    .split(sep).join("/");
  const formalSpecSource = [
    `import { configureFormalSuite, expect, formalCase, formalSuite as test } from ${quote(relativeImport(formalImport))};`,
    `import { assertNoUnauthorizedWriteRequests } from ${quote(relativeImport(noWriteGuardImport))};`,
    `import { captureWebOperationOutcome } from ${quote(relativeImport(operationEvidenceImport))};`,
    `import { formalExecutionManifest } from ${quote(relativeImport(manifestImport))};`,
    "",
    "function requiredEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }",
    "",
    "configureFormalSuite(formalExecutionManifest);",
    "",
    ...spec.cases.flatMap((entry) => renderFormalCase(entry)),
    ""
  ].join("\n");
  const manifest = defineFormalExecutionManifest({
    schemaVersion: "formal-execution-manifest-v1",
    scope: "request",
    requestId: spec.requestId,
    projectId: spec.projectId,
    environment: spec.environment,
    buildEvidence: [{
      kind: "source_contract",
      path: relative(input.workspaceRoot, contractPath).split(sep).join("/"),
      sha256: sourceContractDigest
    }],
    capabilities: environmentCapabilities.map((capability) => ({
      id: capability.id,
      requiredForCaseIds: [...spec.selectedCaseIds],
      source: {
        kind: "environment" as const,
        variable: capability.variable,
        ...(capability.pattern ? { pattern: capability.pattern } : {})
      },
      unavailableReason: capability.unavailableReason,
      unblockCondition: capability.unblockCondition
    })),
    cases: spec.cases.map((entry) => ({
      caseId: entry.caseId,
      title: entry.title,
      requiredCapabilities: environmentCapabilities.map((capability) => capability.id),
      requiredResources: entry.requiredResources ?? [],
      producesResources: entry.producesResources ?? [],
      permissionProfile: entry.permissionProfile,
      requiredOperations: entry.requiredOperations,
      ...(entry.requiredOperations.length
        ? {
            operationBudgets: entry.requiredOperations.map((operation) => ({
              operation,
              maxExecutions: Math.max(1, entry.steps.reduce(
                (count, step) => count + step.actions.filter((action) =>
                  (action.kind === "click_role" && action.operation === operation)
                  || (action.kind === "set_files_label" && action.operation === operation)
                ).length,
                0
              ))
            }))
          }
        : {}),
      ...(entry.operationEvidence ? { operationEvidence: entry.operationEvidence } : {}),
      dataWritePolicy: entry.dataWritePolicy,
      implementation: { status: "source_complete" },
      businessOracles: entry.steps.map((step) => ({
        oracleId: step.oracle.oracleId,
        ruleRef: entry.ruleRef,
        observationKind: step.oracle.observationKind,
        ...(step.oracle.contractId ? { contractId: step.oracle.contractId } : {}),
        // manifest 权威不携带 sourceFiles（具名源文件只进 source-contract 契约与构建校验）。
        authorities: step.oracle.authorities.map((authority) =>
          authority.kind === "registered_source"
            ? {
                kind: authority.kind,
                materialId: authority.materialId,
                sectionId: authority.sectionId,
                sourceSha256: authority.sourceSha256
              }
            : {
                kind: authority.kind,
                decisionType: authority.decisionType,
                subjectDigest: authority.subjectDigest
              })
      }))
    })),
    pageSessionGroups: spec.cases.map((entry) => ({
      sessionGroupId: `session-${entry.caseId.toLowerCase()}`,
      targetRoute: entry.route,
      caseIds: [entry.caseId],
      resetStrategy: "new_context_per_case",
      isolationReason: "每条冻结正式用例使用独立浏览器上下文。",
      executionOrder: [entry.caseId]
    }))
  });
  const manifestSource = [
    `import { defineFormalExecutionManifest } from ${quote(relativeImport(manifestRuntimeImport))};`,
    "",
    `export const formalExecutionManifest = defineFormalExecutionManifest(${JSON.stringify(manifest, null, 2)});`,
    ""
  ].join("\n");
  const artifacts = [
    { targetPath: relative(input.workspaceRoot, resolve(candidateRoot, "formal-web-script-spec.json")).split(sep).join("/"), content: `${JSON.stringify(spec, null, 2)}\n` },
    { targetPath: relative(input.workspaceRoot, formalSpecPath).split(sep).join("/"), content: formalSpecSource },
    { targetPath: relative(input.workspaceRoot, manifestPath).split(sep).join("/"), content: manifestSource },
    { targetPath: relative(input.workspaceRoot, contractPath).split(sep).join("/"), content: sourceContract }
  ];
  if (input.coveragePlan) {
    artifacts.push({
      targetPath: relative(input.workspaceRoot, resolve(candidateRoot, "web-script-coverage-plan.json")).split(sep).join("/"),
      content: `${JSON.stringify(input.coveragePlan, null, 2)}\n`
    });
  }
  const bundle = {
    spec,
    formalSpecSource,
    manifestSource,
    sourceContract,
    artifacts,
    staticCaseIds: [...spec.selectedCaseIds],
    ...(input.coveragePlan ? { coveragePlan: input.coveragePlan } : {})
  };
  assertRenderedFormalWebBundle(bundle, input.workspaceRoot);
  return bundle;
}

/** Build-time static gate. It rejects the constructs that caused r2 before any artifact is published. */
export function assertRenderedFormalWebBundle(
  bundle: Pick<RenderedFormalWebBundle, "spec" | "formalSpecSource" | "manifestSource" | "artifacts" | "staticCaseIds">,
  workspaceRoot: string
): void {
  const dynamic = /\b(?:for|while|do)\s*\(|\.\s*(?:map|forEach)\s*\(/u;
  if (dynamic.test(bundle.formalSpecSource)) {
    throw new Error("dynamic_registration: formalCase registration must not use loops, map(), or forEach().");
  }
  if (dynamic.test(bundle.manifestSource)) {
    throw new Error("dynamic_manifest: formal execution manifest cases must be literal entries.");
  }
  const inspection = inspectFormalSpecSource(bundle.formalSpecSource, bundle.spec.selectedCaseIds, {
    manifestSchemaVersion: "formal-execution-manifest-v1"
  });
  if (inspection.issues.length) {
    throw new Error(`static_source_gate: ${inspection.issues.join(" ")}`);
  }
  if (JSON.stringify([...inspection.caseIds].sort()) !== JSON.stringify([...bundle.spec.selectedCaseIds].sort())) {
    throw new Error("scope_mismatch: static discovery caseIds differ from the frozen scope.");
  }
  const candidatePrefix = `.local/test-runs/${bundle.spec.requestId}/candidate-scripts/`;
  if (bundle.artifacts.some((artifact) => !artifact.targetPath.startsWith(candidatePrefix))) {
    throw new Error("candidate_path_escape: Web candidate artifacts must remain under this request's candidate-scripts directory.");
  }
  if (/\btests\/[\w/-]*\d{8}/u.test(bundle.formalSpecSource)
    || /\btests\/[\w/-]*\d{8}/u.test(bundle.manifestSource)) {
    throw new Error("candidate_path_escape: Web candidate build must not reference tests/<request> paths.");
  }
  const specArtifact = bundle.artifacts.find((artifact) => artifact.targetPath.endsWith("/formal-web-script-spec.json"));
  if (!specArtifact || !specArtifact.targetPath.startsWith(candidatePrefix)) {
    throw new Error("candidate_path_escape: formal-web-script-spec-v1 must be published inside this candidate directory.");
  }
  // Force this function to keep a workspace-root parameter: it documents that
  // all paths above are repository-relative facts, never host-local arbitrary paths.
  if (!resolve(workspaceRoot).trim()) throw new Error("workspaceRoot is required.");
}

function renderFormalCase(entry: FormalWebScriptSpecCase): string[] {
  const body = [
    "const observedResponseStatuses = new Map<string, number | undefined>();",
    "const syntheticCreateIntents = new Map<string, { intentId: string; resourceType: string }>();",
    `await test.step(${quote("打开已冻结页面路径")}, async () => {`,
    `  await page.goto(${quote(entry.route)});`,
    "});",
    ...entry.steps.flatMap((step) => renderFormalStep(step))
  ];
  const guardedBody = entry.dataWritePolicy === "no_write"
    ? [
        `await assertNoUnauthorizedWriteRequests(page, ${JSON.stringify(entry.noWriteNetworkPolicy)}, async () => {`,
        ...body.map((line) => `  ${line}`),
        "});"
      ]
    : body;
  return [
    `formalCase(${quote(entry.caseId)}, ${quote(entry.title)}, async ({ page }, runtime) => {`,
    ...guardedBody.map((line) => `  ${line}`),
    "});",
    ""
  ];
}

function renderFormalStep(step: FormalWebScriptSpecStep): string[] {
  return [
    `await test.step(${quote(step.title)}, async () => {`,
    ...step.actions.map((action) => `  ${renderAction(action)}`),
    `  await runtime.verifyBusinessOracle(${quote(step.oracle.oracleId)}, async () => {`,
    ...step.oracle.checks.map((check) => `    ${renderOracleCheck(check)}`),
    "  });",
    "});"
  ];
}

function renderAction(action: FormalWebAction): string {
  switch (action.kind) {
    case "goto":
      return `await page.goto(${quote(action.path)});`;
    case "expect_role_visible":
      return `await expect(page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} })).toBeVisible();`;
    case "expect_role_text":
      return `await expect(page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} })).toHaveText(${quote(action.text)});`;
    case "expect_role_value":
      return `await expect(page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} })).toHaveValue(${renderValue(action.value)});`;
    case "expect_validation_message":
      return action.role && action.name
        ? `await expect(page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} })).toHaveText(${quote(action.text)});`
        : `await expect(page.getByText(${quote(action.text)}, { exact: false })).toBeVisible();`;
    case "expect_url":
      return `await expect(page).toHaveURL(new RegExp(${quote(escapeRegex(action.path) + "(?:\\\\?.*)?$")}));`;
    case "fill_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).fill(${renderValue(action.value)});`;
    case "clear_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).fill("");`;
    case "blur_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).blur();`;
    case "select_role_option":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).selectOption(${renderValue(action.value)});`;
    case "check_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).check();`;
    case "uncheck_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).uncheck();`;
    case "set_files_label":
      return [
        `await runtime.reserveOperation("upload_synthetic_file", "upload_synthetic_file:declared-action");`,
        `const operationOutcome = await captureWebOperationOutcome({ page, operation: "upload_synthetic_file", method: ${quote(action.response.method)}, path: ${quote(action.response.path)}, contractId: ${quote(action.response.contractId)}, timeoutMs: 10_000,`,
        `  trigger: async () => page.getByLabel(${quote(action.label)}).setInputFiles(${quote(action.asset.assetPath)}),`,
        `  parse: async (response) => ({ outcome: ${JSON.stringify(action.response.successStatusCodes)}.includes(response.status()) ? "succeeded" : "rejected", finality: "final" })`,
        `}); observedResponseStatuses.set(${quote(action.response.contractId)}, operationOutcome.response?.status()); runtime.addOperationEvidence(operationOutcome.evidence);`
      ].join(" ");
    case "trial_click_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).click({ trial: true });`;
    case "click_read_only_role":
      return `await page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).click();`;
    case "click_read_only_text":
      // 受限兜底：目标交互元素（品类/开发方式卡片等）无 ARIA 角色与名称，
      // 按定位规范以唯一文本定位；exact 默认 true，合并文本节点（卡片名+描述）可声明 exact:false；
      // 多处匹配时由 Playwright 严格模式拒绝。
      return `await page.getByText(${quote(action.text)}, { exact: ${action.exact === false ? "false" : "true"} }).click();`;
    case "click_role":
      return [
        `await runtime.reserveOperation(${quote(action.operation)}, ${quote(`${action.operation}:declared-action`)});`,
        `const operationOutcome = await captureWebOperationOutcome({ page, operation: ${quote(action.operation)}, method: ${quote(action.response.method)}, path: ${quote(action.response.path)}, contractId: ${quote(action.response.contractId)}, timeoutMs: 10_000,`,
        `  trigger: async () => page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).click(),`,
        `  parse: async (response) => ({ outcome: ${JSON.stringify(action.response.successStatusCodes)}.includes(response.status()) ? "succeeded" : "rejected", finality: "final" })`,
        `}); observedResponseStatuses.set(${quote(action.response.contractId)}, operationOutcome.response?.status()); runtime.addOperationEvidence(operationOutcome.evidence);`
      ].join(" ");
    case "begin_synthetic_create":
      return [
        `const ${action.intentKey}Intent = await runtime.beginSyntheticCreate({ resourceType: ${quote(action.resourceType)}, syntheticKey: ${quote(action.syntheticKey)}, expectedOutcome: ${quote(action.expectedOutcome ?? "create")}, dataWritePolicy: ${quote(action.dataWritePolicy)} });`,
        `await runtime.markSyntheticCreating(${action.intentKey}Intent.intentId);`,
        `syntheticCreateIntents.set(${quote(action.intentKey)}, { intentId: ${action.intentKey}Intent.intentId, resourceType: ${quote(action.resourceType)} });`
      ].join(" ");
    case "confirm_synthetic_resource":
      return [
        `const ${action.intentKey} = syntheticCreateIntents.get(${quote(action.intentKey)});`,
        `if (!${action.intentKey}) throw new Error(${quote(`Missing synthetic create intent ${action.intentKey}.`)});`,
        `const ${action.intentKey}Identity = (await page.getByRole(${quote(action.identity.role)}, { name: ${quote(action.identity.name)} }).textContent())?.trim();`,
        `if (!${action.intentKey}Identity) throw new Error(${quote(`Missing UI identity for ${action.publishName}.`)});`,
        `await runtime.confirmSyntheticResource({ intentId: ${action.intentKey}.intentId, resourceId: ${action.intentKey}.resourceType + "-" + ${action.intentKey}.intentId, publishName: ${quote(action.publishName)}, metadata: { externalIdentity: ${action.intentKey}Identity }, evidenceSummary: ${quote(`UI created ${action.publishName}.`)} });`
      ].join(" ");
    case "cleanup_role":
      return [
        `await runtime.reserveOperation("cleanup_test_resource", ${quote(`cleanup_test_resource:${action.resourceName}`)});`,
        `const cleanupOutcome = await captureWebOperationOutcome({ page, operation: "cleanup_test_resource", method: ${quote(action.response.method)}, path: ${quote(action.response.path)}, contractId: ${quote(action.response.contractId)}, timeoutMs: 10_000,`,
        `  trigger: async () => page.getByRole(${quote(action.role)}, { name: ${quote(action.name)} }).click(),`,
        `  parse: async (response) => ({ outcome: ${JSON.stringify(action.response.successStatusCodes)}.includes(response.status()) ? "succeeded" : "rejected", finality: "final" })`,
        `}); observedResponseStatuses.set(${quote(action.response.contractId)}, cleanupOutcome.response?.status()); runtime.addOperationEvidence(cleanupOutcome.evidence); if (cleanupOutcome.evidence.outcome !== "succeeded") { await runtime.markResourceDirty(${quote(action.resourceName)}, ${quote(`UI cleanup was not confirmed for ${action.resourceName}.`)}); throw new Error(${quote(`UI cleanup was not confirmed for ${action.resourceName}.`)}); } await runtime.restoreSyntheticResource(${quote(action.resourceName)}, ${quote(`UI cleanup verified for ${action.resourceName}.`)});`
      ].join(" ");
  }
}

function renderOracleCheck(check: FormalWebOracleCheck): string {
  switch (check.kind) {
    case "role_visible": return `await expect(page.getByRole(${quote(check.role!)}, { name: ${quote(check.name!)} })).toBeVisible();`;
    case "role_hidden": return `await expect(page.getByRole(${quote(check.role!)}, { name: ${quote(check.name!)} })).toBeHidden();`;
    case "role_text": return `await expect(page.getByRole(${quote(check.role!)}, { name: ${quote(check.name!)} })).toHaveText(${quote(check.text!)});`;
    case "validation_message": return check.role && check.name
      ? `await expect(page.getByRole(${quote(check.role)}, { name: ${quote(check.name)} })).toHaveText(${quote(check.text!)});`
      : `await expect(page.getByText(${quote(check.text!)}, { exact: false })).toBeVisible();`;
    case "validation_message_absent": return check.role && check.name
      ? `await expect(page.getByRole(${quote(check.role)}, { name: ${quote(check.name)} })).toBeHidden();`
      : `await expect(page.getByText(${quote(check.text!)}, { exact: false })).toBeHidden();`;
    case "role_value": return `await expect(page.getByRole(${quote(check.role!)}, { name: ${quote(check.name!)} })).toHaveValue(${renderValue(check.value!)});`;
    case "url": return `await expect(page).toHaveURL(new RegExp(${quote(escapeRegex(check.path!) + "(?:\\\\?.*)?$")}));`;
    case "response_status": return `await expect(observedResponseStatuses.get(${quote(check.contractId!)}), ${quote(`missing response for ${check.contractId}`)}).toBeDefined(); await expect(${JSON.stringify(check.successStatusCodes!)}).toContain(observedResponseStatuses.get(${quote(check.contractId!)}));`;
  }
}

function renderValue(value: WebValueRef): string {
  if (value.kind === "frozen_data") return quote(value.value);
  if (value.kind === "environment") return `requiredEnv(${quote(value.variable)})`;
  return `await runtime.resourceMetadata(${quote(value.resourceName)}, ${quote(value.key)})`;
}

function validateCase(entry: unknown, seen: Set<string>): asserts entry is FormalWebScriptSpecCase {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("formal-web-script-spec-v1 contains an invalid case entry.");
  const value = entry as Partial<FormalWebScriptSpecCase>;
  if (!isCaseId(value.caseId) || seen.has(value.caseId)) throw new Error("formal-web-script-spec-v1 caseId is missing or duplicate.");
  seen.add(value.caseId);
  if (!isNonEmptyString(value.title) || !isSafeRoute(value.route) || !isNonEmptyString(value.ruleRef)) {
    throw new Error(`${value.caseId} requires title, safe route and ruleRef.`);
  }
  if (!['read_only', 'test_write', 'privileged_test'].includes(value.permissionProfile ?? "")
    || !["no_write", "ephemeral_cleanup", "reusable_fixture", "tracked_residual"].includes(value.dataWritePolicy ?? "")) {
    throw new Error(`${value.caseId} contains an unsupported permission or data-write policy.`);
  }
  if (!Array.isArray(value.requiredOperations)
    || value.requiredOperations.some((operation) => !executionOperationKinds.includes(operation))) {
    throw new Error(`${value.caseId} contains an unsupported required operation.`);
  }
  const requiredResources = value.requiredResources ?? [];
  if (!Array.isArray(requiredResources) || requiredResources.some((name) => !isSafeIdentifier(name))
    || new Set(requiredResources).size !== requiredResources.length) {
    throw new Error(`${value.caseId} requiredResources must be unique safe names.`);
  }
  const producedResources = value.producesResources ?? [];
  if (!Array.isArray(producedResources)
    || producedResources.some((resource) => !isValidProducedResource(resource))
    || new Set(producedResources.map((resource) => resource.name)).size !== producedResources.length) {
    throw new Error(`${value.caseId} producesResources must be unique current v1 resource contracts.`);
  }
  if (value.dataWritePolicy === "no_write" && producedResources.length > 0) {
    throw new Error(`${value.caseId} no_write cannot produce test resources.`);
  }
  if (producedResources.some((resource) => resource.disposition !== value.dataWritePolicy)) {
    throw new Error(`${value.caseId} produced resource disposition must match its dataWritePolicy.`);
  }
  if (value.dataWritePolicy !== "no_write" && value.permissionProfile === "read_only") {
    throw new Error(`${value.caseId} writable test data requires a writable permission profile.`);
  }
  if (value.operationEvidence !== undefined && !Array.isArray(value.operationEvidence)) {
    throw new Error(`${value.caseId} operationEvidence must be an array when present.`);
  }
  const evidenceIssues = operationEvidenceDefinitionIssues({
    requiredOperations: value.requiredOperations,
    requiredCapabilities: [],
    definitions: value.operationEvidence,
    dataWritePolicy: value.dataWritePolicy
  });
  if (evidenceIssues.length) {
    throw new Error(`${value.caseId} ${evidenceIssues.join(" ")}`);
  }
  const controlledOperations = value.requiredOperations.filter((operation) =>
    ["send_test_otp", "upload_synthetic_file", "submit_registration", "create_test_resource", "update_test_resource", "delete_test_resource", "change_test_permission", "invoke_test_device_action", "cleanup_test_resource"].includes(operation)
  );
  if (controlledOperations.length) {
    const evidence = value.operationEvidence ?? [];
    if (controlledOperations.some((operation) => !evidence.some((item) =>
      item.operation === operation && (
        (item.strategy === "ui_state" && item.uiContractId)
        || (item.strategy === "response_contract" && item.responseContractId)
      )
    ))) {
      throw new Error(`${value.caseId} controlled operations require a reviewed UI or response operationEvidence contract.`);
    }
  }
  if (value.permissionProfile === "read_only" && value.dataWritePolicy !== "no_write") {
    throw new Error(`${value.caseId} read_only must declare no_write.`);
  }
  if (value.dataWritePolicy === "no_write" && value.requiredOperations.some((operation) =>
    ["send_test_otp", "upload_synthetic_file", "submit_registration", "create_test_resource", "update_test_resource", "delete_test_resource", "change_test_permission", "invoke_test_device_action", "cleanup_test_resource", "retain_tracked_residual"].includes(operation)
  )) {
    throw new Error(`${value.caseId} no_write cannot declare a mutating operation.`);
  }
  if (value.dataWritePolicy === "no_write" && !isNoWriteNetworkPolicy(value.noWriteNetworkPolicy)) {
    throw new Error(`${value.caseId} no_write requires a frozen default-deny network policy.`);
  }
  if (value.dataWritePolicy !== "no_write" && value.noWriteNetworkPolicy !== undefined) {
    throw new Error(`${value.caseId} only no_write may declare a network policy.`);
  }
  if (!Array.isArray(value.steps) || !value.steps.length) {
    throw new Error(`${value.caseId} must contain one or more structured execution steps.`);
  }
  const seenStepIds = new Set<string>();
  const seenOracleIds = new Set<string>();
  for (const step of value.steps) {
    validateStep(value.caseId, step, seenStepIds, seenOracleIds, value.requiredOperations, value.operationEvidence ?? []);
  }
  const actions = value.steps.flatMap((step) => step.actions);
  const producedNames = new Set(producedResources.map((resource) => resource.name));
  const confirmedNames = actions
    .filter((action): action is Extract<FormalWebAction, { kind: "confirm_synthetic_resource" }> => action.kind === "confirm_synthetic_resource")
    .map((action) => action.publishName);
  if (producedNames.size !== confirmedNames.length || confirmedNames.some((name) => !producedNames.has(name))
    || new Set(confirmedNames).size !== confirmedNames.length) {
    throw new Error(`${value.caseId} must confirm every produced test resource exactly once through UI.`);
  }
  const intentKeys = new Set(actions
    .filter((action): action is Extract<FormalWebAction, { kind: "begin_synthetic_create" }> => action.kind === "begin_synthetic_create")
    .map((action) => action.intentKey));
  if (actions.filter((action): action is Extract<FormalWebAction, { kind: "confirm_synthetic_resource" }> => action.kind === "confirm_synthetic_resource")
    .some((action) => !intentKeys.has(action.intentKey))) {
    throw new Error(`${value.caseId} confirms a test resource without a preceding creation intent.`);
  }
  if (value.steps.some((step) => step.actions.some((action) => action.kind === "set_files_label"))
    && (value.dataWritePolicy === "no_write" || !value.requiredOperations.includes("upload_synthetic_file"))) {
    throw new Error(`${value.caseId} file upload must use a non-no_write policy with frozen upload evidence.`);
  }
}

function validateStep(
  caseId: string,
  step: unknown,
  seenStepIds: Set<string>,
  seenOracleIds: Set<string>,
  operations: ExecutionOperationKind[],
  evidence: FormalOperationEvidenceDefinition[]
): asserts step is FormalWebScriptSpecStep {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error(`${caseId} contains an invalid structured execution step.`);
  }
  const value = step as Partial<FormalWebScriptSpecStep>;
  if (!isSafeIdentifier(value.stepId) || seenStepIds.has(value.stepId)
    || !isCoverageId(value.coverageId) || !isNonEmptyString(value.title)) {
    throw new Error(`${caseId} stepId, coverageId and title must be valid and unique.`);
  }
  seenStepIds.add(value.stepId);
  if (!value.oracle || !isNonEmptyString(value.oracle.oracleId)
    || seenOracleIds.has(value.oracle.oracleId)
    || !["dom", "browser_response", "postcondition_query", "runtime_state"].includes(value.oracle.observationKind)
    || !Array.isArray(value.oracle.authorities) || !value.oracle.authorities.length
    || !Array.isArray(value.oracle.checks) || !value.oracle.checks.length) {
    throw new Error(`${caseId}/${value.stepId} requires a complete structured oracle.`);
  }
  seenOracleIds.add(value.oracle.oracleId);
  validateOracleAuthorities(caseId, value.oracle.authorities);
  for (const check of value.oracle.checks) validateOracleCheck(caseId, check);
  if (!Array.isArray(value.actions) || !value.actions.length) {
    throw new Error(`${caseId}/${value.stepId} must contain declarative actions.`);
  }
  for (const action of value.actions) validateAction(caseId, action, operations, evidence);
  validateOracleObservation(caseId, value as FormalWebScriptSpecStep);
}

function validateAction(
  caseId: string,
  action: unknown,
  operations: ExecutionOperationKind[],
  evidence: FormalOperationEvidenceDefinition[]
): void {
  if (!action || typeof action !== "object" || Array.isArray(action) || typeof (action as { kind?: unknown }).kind !== "string") {
    throw new Error(`${caseId} contains an invalid declarative action.`);
  }
  const value = action as Partial<FormalWebAction> & Record<string, unknown>;
  if (value.kind === "goto" && isSafeRoute(value.path)) return;
  if (["expect_role_visible", "trial_click_role", "click_read_only_role", "clear_role", "blur_role", "check_role", "uncheck_role"].includes(value.kind ?? "")
    && isNonEmptyString(value.role) && isNonEmptyString(value.name)) return;
  if (value.kind === "click_read_only_text" && isNonEmptyString(value.text)
    && (value.exact === undefined || typeof value.exact === "boolean")
    && !containsSensitiveLiteral(value.text)) return;
  if (value.kind === "expect_role_text"
    && isNonEmptyString(value.role) && isNonEmptyString(value.name) && isNonEmptyString(value.text)) return;
  if (value.kind === "expect_validation_message" && isNonEmptyString(value.text)
    && ((value.role === undefined && value.name === undefined)
      || (isNonEmptyString(value.role) && isNonEmptyString(value.name)))) return;
  if (["expect_role_value", "fill_role", "select_role_option"].includes(value.kind ?? "")
    && isNonEmptyString(value.role) && isNonEmptyString(value.name) && isWebValueRef(value.value)) return;
  if (value.kind === "expect_url" && isSafeRoute(value.path)) return;
  if (value.kind === "set_files_label" && isNonEmptyString(value.label)
    && isFormalWebFileAsset(value.asset)
    && value.operation === "upload_synthetic_file" && operations.includes(value.operation)
    && isResponseContract(value.response)) {
    const response = value.response;
    if (evidence.some((item) => item.operation === value.operation
      && item.responseContractId === response.contractId)) return;
  }
  if (value.kind === "click_role" && isNonEmptyString(value.role) && isNonEmptyString(value.name)
    && typeof value.operation === "string" && operations.includes(value.operation as ExecutionOperationKind)) {
    const response = value.response;
    if (isResponseContract(response) && evidence.some((item) => item.operation === value.operation
      && item.responseContractId === response.contractId)) return;
  }
  if (value.kind === "begin_synthetic_create"
    && isSafeIdentifier(value.intentKey)
    && isSafeResourceType(value.resourceType)
    && isSafeIdentifier(value.syntheticKey)
    && ["ephemeral_cleanup", "reusable_fixture", "tracked_residual"].includes(String(value.dataWritePolicy))
    && (value.expectedOutcome === undefined || ["create", "reject"].includes(String(value.expectedOutcome)))) return;
  if (value.kind === "confirm_synthetic_resource"
    && isSafeIdentifier(value.intentKey)
    && isSafeIdentifier(value.publishName)
    && isRoleIdentity(value.identity)) return;
  if (value.kind === "cleanup_role"
    && isSafeIdentifier(value.resourceName)
    && isNonEmptyString(value.role) && isNonEmptyString(value.name)
    && operations.includes("cleanup_test_resource")) {
    const response = value.response;
    if (isResponseContract(response) && evidence.some((item) => item.operation === "cleanup_test_resource"
      && item.responseContractId === response.contractId)) return;
  }
  throw new Error(`${caseId} contains an invalid or unauthorized ${String(value.kind)} action.`);
}

function validateSyntheticResourceLifecycle(spec: FormalWebScriptSpec): void {
  const produced = new Map<string, FormalProducedResourceContract>();
  for (const entry of spec.cases) {
    for (const resource of entry.producesResources ?? []) produced.set(resource.name, resource);
  }
  for (const entry of spec.cases) {
    for (const action of entry.steps.flatMap((step) => step.actions)) {
      if (action.kind !== "cleanup_role") continue;
      const resource = produced.get(action.resourceName);
      if (!resource || resource.disposition !== "ephemeral_cleanup"
        || !(entry.requiredResources ?? []).includes(action.resourceName)) {
        throw new Error(`${entry.caseId} cleanup_role must consume a declared ephemeral current-run resource.`);
      }
    }
  }
  for (const resource of produced.values()) {
    if (resource.disposition !== "ephemeral_cleanup") continue;
    const hasCleanup = spec.cases.some((entry) => entry.steps.some((step) => step.actions.some((action) =>
      action.kind === "cleanup_role" && action.resourceName === resource.name
    )));
    if (!hasCleanup) throw new Error(`Ephemeral test resource ${resource.name} has no declared UI cleanup action.`);
  }
}

function isValidProducedResource(value: unknown): value is FormalProducedResourceContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const resource = value as Partial<FormalProducedResourceContract>;
  if (!isSafeIdentifier(resource.name) || !isSafeResourceType(resource.resourceType)
    || !["ephemeral_cleanup", "reusable_fixture", "tracked_residual"].includes(String(resource.disposition))) return false;
  if (resource.disposition !== "reusable_fixture") return true;
  return isNonEmptyString(resource.baselineContractId)
    && isNonEmptyString(resource.baselineVersion)
    && ["shared_read", "exclusive"].includes(String(resource.leaseMode))
    && Number.isInteger(resource.maxPoolSize) && resource.maxPoolSize! > 0
    && resource.retirementPolicy === "validate_quarantine_replace";
}

function isSafeResourceType(value: unknown): value is FormalProducedResourceContract["resourceType"] {
  return ["account", "tenant", "product", "device", "alarmRule", "telemetry", "binding", "command", "custom"].includes(String(value));
}

function isRoleIdentity(value: unknown): value is { role: string; name: string } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && isNonEmptyString((value as { role?: unknown }).role)
    && isNonEmptyString((value as { name?: unknown }).name));
}

function validateOracleCheck(caseId: string, check: unknown): void {
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    throw new Error(`${caseId} contains an invalid oracle check.`);
  }
  const value = check as Partial<FormalWebOracleCheck>;
  if (value.kind === "url" && isSafeRoute(value.path)) return;
  if (["role_visible", "role_hidden"].includes(value.kind ?? "")
    && isNonEmptyString(value.role) && isNonEmptyString(value.name)) return;
  if (value.kind === "role_text"
    && isNonEmptyString(value.role) && isNonEmptyString(value.name) && isNonEmptyString(value.text)) return;
  if (value.kind === "validation_message" && isNonEmptyString(value.text)
    && ((value.role === undefined && value.name === undefined)
      || (isNonEmptyString(value.role) && isNonEmptyString(value.name)))) return;
  if (value.kind === "validation_message_absent" && isNonEmptyString(value.text)
    && ((value.role === undefined && value.name === undefined)
      || (isNonEmptyString(value.role) && isNonEmptyString(value.name)))) return;
  if (value.kind === "role_value" && isNonEmptyString(value.role) && isNonEmptyString(value.name)
    && isWebValueRef(value.value)) return;
  if (value.kind === "response_status" && isResponseStatusCheck(value)) return;
  throw new Error(`${caseId} contains an invalid oracle check.`);
}

function validateOracleAuthorities(
  caseId: string,
  authorities: FormalBusinessOracleAuthority[]
): void {
  const keys = new Set<string>();
  for (const authority of authorities) {
    if (authority.kind === "registered_source") {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(authority.materialId)
        || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(authority.sectionId)
        || !/^[a-f0-9]{64}$/u.test(authority.sourceSha256)
        || !Array.isArray(authority.sourceFiles) || !authority.sourceFiles.length
        || authority.sourceFiles.some((file) =>
          !isSafeSourceFilePath(file?.path) || !/^[a-f0-9]{64}$/u.test(String(file?.sha256 ?? ""))
        )) {
        throw new Error(`${caseId} contains an invalid registered source authority.`);
      }
      keys.add(`registered_source:${authority.materialId}:${authority.sectionId}:${authority.sourceSha256}`);
    } else if (authority.kind === "formal_user_decision") {
      if (!isNonEmptyString(authority.decisionType) || !/^[a-f0-9]{64}$/u.test(authority.subjectDigest)) {
        throw new Error(`${caseId} contains an invalid formal user decision authority.`);
      }
      keys.add(`formal_user_decision:${authority.decisionType}:${authority.subjectDigest}`);
    } else {
      throw new Error(`${caseId} contains an unsupported oracle authority kind.`);
    }
  }
}

function isSafeSourceFilePath(value: unknown): value is string {
  // 登记材料路径可能含 CJK 目录名；约束在 sources/ 下、相对路径且不允许穿越。
  return typeof value === "string" && value.startsWith("sources/")
    && value.length > "sources/".length
    && !value.includes("..") && !value.startsWith("/") && !value.includes("\\");
}

function assertAuthoritySourceFiles(spec: FormalWebScriptSpec, workspaceRoot: string): void {
  const verified = new Map<string, true>();
  for (const entry of spec.cases) {
    for (const step of entry.steps) {
      for (const authority of step.oracle.authorities) {
        if (authority.kind !== "registered_source") continue;
        for (const file of authority.sourceFiles ?? []) {
          const cacheKey = `${file.path}:${file.sha256}`;
          if (verified.has(cacheKey)) continue;
          const absolute = resolve(workspaceRoot, file.path);
          let bytes: Buffer;
          try {
            bytes = readFileSync(absolute);
          } catch {
            throw new Error(`${entry.caseId} authority source file is missing: ${file.path}`);
          }
          if (sha256(bytes) !== file.sha256) {
            throw new Error(`${entry.caseId} authority source file bytes differ from declared digest: ${file.path}`);
          }
          verified.set(cacheKey, true);
        }
      }
    }
  }
}

function validateOracleObservation(caseId: string, step: FormalWebScriptSpecStep): void {  const responseChecks = step.oracle.checks.filter((check) => check.kind === "response_status");
  if (step.oracle.observationKind === "browser_response") {
    if (!step.oracle.contractId || !responseChecks.length) {
      throw new Error(`${caseId} browser_response oracle requires its frozen response contract and status check.`);
    }
    if (responseChecks.some((check) => check.contractId !== step.oracle.contractId)
      || !step.actions.some((action) => (action.kind === "click_role" || action.kind === "set_files_label")
        && action.response.contractId === step.oracle.contractId)) {
      throw new Error(`${caseId} browser_response oracle must observe the matching declared action response.`);
    }
  } else if (responseChecks.length) {
    throw new Error(`${caseId} response_status checks require a browser_response oracle.`);
  }
}

function isResponseStatusCheck(value: Partial<FormalWebOracleCheck>): boolean {
  return typeof value.contractId === "string" && /^[A-Z][A-Z0-9._:-]{2,127}$/u.test(value.contractId)
    && Array.isArray(value.successStatusCodes) && value.successStatusCodes.length > 0
    && value.successStatusCodes.every((status) => Number.isInteger(status) && status >= 200 && status <= 299);
}

function isWebValueRef(value: unknown): value is WebValueRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Partial<WebValueRef>;
  if (ref.kind === "environment") return typeof ref.variable === "string" && /^TEST_[A-Z0-9_]{2,80}$/u.test(ref.variable);
  if (ref.kind === "resource_metadata") {
    return isSafeIdentifier(ref.resourceName) && /^[a-z][a-zA-Z0-9_]{0,63}$/u.test(String(ref.key ?? ""));
  }
  return ref.kind === "frozen_data" && typeof ref.dataId === "string" && /^D\d{2}$/u.test(ref.dataId)
    && typeof ref.value === "string" && ref.value.length <= 512 && !containsSensitiveLiteral(ref.value);
}

function isResponseContract(value: unknown): value is { method: string; path: string; contractId: string; successStatusCodes: number[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contract = value as { method?: unknown; path?: unknown; contractId?: unknown; successStatusCodes?: unknown };
  return typeof contract.method === "string" && /^[A-Z]{3,7}$/u.test(contract.method)
    && isSafeRoute(contract.path) && typeof contract.contractId === "string" && /^[A-Z][A-Z0-9._:-]{2,127}$/u.test(contract.contractId)
    && Array.isArray(contract.successStatusCodes) && contract.successStatusCodes.length > 0
    && contract.successStatusCodes.every((status) => Number.isInteger(status) && status >= 200 && status <= 299);
}

function isNoWriteNetworkPolicy(value: unknown): value is NonNullable<FormalWebScriptSpecCase["noWriteNetworkPolicy"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as { reviewedReadOnlyRequests?: unknown; forbiddenMutationPaths?: unknown };
  return Array.isArray(policy.reviewedReadOnlyRequests) && Array.isArray(policy.forbiddenMutationPaths)
    && policy.reviewedReadOnlyRequests.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const contract = item as { contractId?: unknown; method?: unknown; path?: unknown };
      return typeof contract.contractId === "string" && /^[A-Z][A-Z0-9._:-]{2,127}$/u.test(contract.contractId)
        && typeof contract.method === "string" && /^[A-Z]{3,7}$/u.test(contract.method)
        && isSafeRoute(contract.path);
    }) && policy.forbiddenMutationPaths.every(isSafeRoute);
}

function validateReferencedAssets(spec: FormalWebScriptSpec, workspaceRoot: string): void {
  const testAssetRoot = resolve(workspaceRoot, "test-assets");
  const manifest = spec.cases.some((entry) => entry.steps.some((step) =>
    step.actions.some((action) => action.kind === "set_files_label" && action.asset.kind === "registered_test_asset")
  ))
    ? loadTestAssetManifest({ assetRoot: testAssetRoot })
    : undefined;
  for (const action of spec.cases.flatMap((entry) => entry.steps.flatMap((step) => step.actions))) {
    if (action.kind !== "set_files_label") continue;
    if (action.asset.kind === "registered_test_asset") {
      const path = resolve(workspaceRoot, action.asset.assetPath);
      const asset = findTestAsset(manifest!, action.asset.assetId);
      const registeredPath = asset && resolveAssetPath(asset, { assetRoot: testAssetRoot });
      if (!asset || asset.status !== "active"
        || !asset.projects?.includes(spec.projectId)
        || asset.platform !== "web"
        || registeredPath !== path
        || `test-assets/${asset.path}` !== action.asset.assetPath
        || asset.sha256 !== action.asset.assetSha256
        || !path.startsWith(testAssetRoot + sep)
        || sha256(readFileSync(path)) !== action.asset.assetSha256) {
        throw new Error(`asset_drift: ${action.asset.assetId} / ${action.asset.assetPath} is not an active registered frozen Web test asset.`);
      }
      continue;
    }
    const generatedRoot = resolve(workspaceRoot, ".local", "test-runs", ...spec.requestId.split("/"), "generated-test-assets");
    const manifestPath = resolve(workspaceRoot, action.asset.manifestPath);
    const assetPath = resolve(workspaceRoot, action.asset.assetPath);
    if (!isWithin(generatedRoot, manifestPath) || !isWithin(generatedRoot, assetPath)) {
      throw new Error(`generated_asset_path_escape: ${action.asset.assetId} must remain under this request's generated-test-assets directory.`);
    }
    const generated = readGeneratedUploadAssetManifest({
      workspaceRoot,
      requestId: spec.requestId,
      manifestPath: action.asset.manifestPath
    });
    const asset = findGeneratedUploadAsset(generated, action.asset.assetId);
    if (!asset || asset.path !== action.asset.assetPath || asset.sha256 !== action.asset.assetSha256
      || generated.generator.digest !== action.asset.generatorDigest
      || sha256(readFileSync(assetPath)) !== action.asset.assetSha256) {
      throw new Error(`generated_asset_drift: ${action.asset.assetId} does not match this request's generated upload asset manifest.`);
    }
  }
}

function relativeImport(path: string): string {
  return path.startsWith(".") ? path : `./${path}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCaseId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}$/u.test(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9._:-]{2,127}$/u.test(value);
}

function isSafeRoute(value: unknown): value is string {
  return typeof value === "string" && /^\/[A-Za-z0-9._~/?=&%-]*$/u.test(value);
}

function isTestAssetPath(value: unknown): value is string {
  return typeof value === "string" && /^test-assets\/[A-Za-z0-9._/-]+$/u.test(value) && !value.includes("..");
}

function isFormalWebFileAsset(value: unknown): value is FormalWebFileAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as Partial<FormalWebFileAsset>;
  if (asset.kind === "registered_test_asset") {
    return isTestAssetId(asset.assetId) && isTestAssetPath(asset.assetPath) && isSha256(asset.assetSha256);
  }
  return asset.kind === "generated_upload_asset"
    && isTestAssetId(asset.assetId)
    && isGeneratedUploadAssetPath(asset.assetPath)
    && isGeneratedUploadManifestPath(asset.manifestPath)
    && isSha256(asset.assetSha256)
    && isSha256(asset.generatorDigest);
}

function isGeneratedUploadAssetPath(value: unknown): value is string {
  return typeof value === "string"
    && /^\.local\/test-runs\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/generated-test-assets\/[A-Za-z0-9._-]+$/u.test(value)
    && !value.includes("..");
}

function isGeneratedUploadManifestPath(value: unknown): value is string {
  return typeof value === "string"
    && /^\.local\/test-runs\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/generated-test-assets\/manifest\.json$/u.test(value)
    && !value.includes("..");
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.includes(`${sep}..${sep}`));
}

function isTestAssetId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,127}$/u.test(value);
}

function containsSensitiveLiteral(value: string): boolean {
  return /(?:password|passwd|token|secret|cookie|authorization|credential|验证码|手机号|手机号码)/iu.test(value)
    || /(?:^|\D)1[3-9]\d{9}(?:\D|$)/u.test(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isSafeResourceBudget(value: unknown): value is { resourceType: string; maxCreates: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const budget = value as { resourceType?: unknown; maxCreates?: unknown };
  return typeof budget.resourceType === "string"
    && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(budget.resourceType)
    && Number.isInteger(budget.maxCreates)
    && (budget.maxCreates as number) >= 0;
}
