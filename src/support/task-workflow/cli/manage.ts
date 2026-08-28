import "dotenv/config";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  buildExecutionAuthorizationManifest,
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  executionOperationKinds,
  loadConfirmedExecutionAuthorization,
  loadExecutionAuthorizationManifest,
  type ExecutionCaseScope,
  type ExecutionExternalTransitionSummary,
  type ExecutionOperationKind,
  type ExecutionResourcePoolBudget,
  type ExecutionSelectorRepairContext
} from "../../formal-execution/authorization.js";
import {
  evaluateCapabilitiesWithProviders,
  loadFormalExecutionManifest,
  loadFormalExecutionManifestFromPath
} from "../../formal-execution/manifest.js";
import { createDefaultCapabilityProviderRegistry } from "../../formal-execution/capabilityProvider.js";
import { FormalExecutionStore } from "../../formal-execution/formalExecutionStore.js";
import { parseReviewSpeed, resolveReviewSpeed } from "../speedProfile.js";
import {
  finalizeFormalReportWorkflow,
  finalizeFormalRunWorkflow
} from "../../formal-execution/workflowCompletion.js";
import { resolveSelectorBuildIdentity } from "../../formal-execution/selectorBuildIdentity.js";
import { resolveFormalRunnerAdapter } from "../../formal-execution/runnerAdapters.js";
import { assessExecutionReadiness } from "../../formal-execution/readiness.js";
import { assessReadinessPreflight } from "../../formal-execution/readinessPreflight.js";
import { TestDataManager } from "../../test-data/testDataManager.js";
import type { FormalExecutionManifest } from "../../formal-execution/types.js";
import {
  applySelectorRepairIncident,
  assessSelectorRepairRecovery,
  loadSelectorRepairIncident,
  repairContextFromEvent,
  selectorRepairEventContext,
  selectorRepairIncidentPathsFromEvent
} from "../../formal-execution/selectorRepair.js";
import {
  assessStableTestSuite,
  loadStableTestSuite,
  promoteStableTestSuite,
  stableSuiteEntryScriptsForCases,
  stableSuiteManifestPath,
  validateStableTestSuite
} from "../../test-suite/stableSuite.js";
import { promoteReviewedDesignScripts } from "../../test-suite/designSuite.js";
import { ReviewInputSnapshotStore } from "../reviewInputSnapshot.js";
import {
  SCRIPT_REVIEW_POLICY_VERSION,
  assessScriptReview,
  scriptReviewVerification,
  type ScriptReviewAssessment,
  type ScriptReviewCaseRisk,
  type ScriptReviewDataWritePolicy
} from "../../formal-execution/scriptReviewPolicy.js";
import {
  DurableWorkflowManager,
  workflowStatusText,
  type WorkflowGateView
} from "../workflowManager.js";
import { assertTestcaseReviewExportReady } from "../testcaseReviewGate.js";
import { candidateRepairChecklist } from "../candidatePreflight.js";
import { runIntentDigest } from "../runIntent.js";
import { candidateScriptManifestPath } from "../runRoots.js";
import {
  applyFormalWebScriptRepairProposal,
  assertFormalWebSpecMatchesFrozenScope,
  parseFormalWebScriptSpec,
  renderFormalWebScriptBundle,
  type FormalWebScriptRepairProposal,
  type FormalWebScriptSpec
} from "../../formal-execution/webScriptCompiler.js";
import {
  assertExactFormalWebCoverage,
  assertFormalWebCoveragePlan,
  deriveFormalWebCoveragePlan
} from "../../formal-execution/webScriptCoverage.js";
import {
  assessWebScriptCoverageGate,
  assertWebScriptCoverageGate
} from "../../formal-execution/webScriptCoverageGate.js";
import type {
  StableTestSuiteManifest,
  StableTestSuiteProfile
} from "../../test-suite/stableSuite.js";
import type {
  ActivityProjection,
  CallbackResolution,
  ReviewRole,
  TestOutcome,
  WorkflowCapability,
  WorkflowDeliveryTarget
} from "../types.js";
import {
  assertTestcaseReviewExportCurrent,
  buildTestcaseReviewExport,
  buildTestcaseReviewModel,
  parseTestcaseReviewExport,
  testcaseReviewWorkbookBodyProjectionDigest,
  validateTestcaseReviewWorkbookReceipt,
  type TestcaseReviewExport
} from "../../testcase/testcaseReviewModel.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1]!] : []
  );
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function rejectOptions(args: string[], names: string[], command: string): void {
  const rejected = names.filter((name) => args.includes(name));
  if (rejected.length > 0) {
    throw new Error(`${command} does not accept ${rejected.join(", ")}; formal evidence is derived from the sealed execution record.`);
  }
}

function parseBoolean(value: string, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parsePositiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseCapabilities(values: string[]): WorkflowCapability[] | undefined {
  if (!values.length) return undefined;
  const supported = new Set<WorkflowCapability>(["web", "h5", "webview", "app", "api", "mqtt", "iot"]);
  const parsed = values.flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = parsed.find((value) => !supported.has(value as WorkflowCapability));
  if (invalid) throw new Error(`Unsupported workflow capability: ${invalid}`);
  return [...new Set(parsed)] as WorkflowCapability[];
}

function parseDeliveryTarget(value: string | undefined): WorkflowDeliveryTarget {
  if (!value) {
    throw new Error(
      "Missing --delivery-target; ask the user before initialization and choose testcase_only, script_only, or full_run."
    );
  }
  if (!["testcase_only", "script_only", "full_run"].includes(value)) {
    throw new Error("--delivery-target must be testcase_only, script_only, or full_run.");
  }
  return value as WorkflowDeliveryTarget;
}

function parseCallbackResolution(value: string): CallbackResolution {
  const aliases: Record<string, CallbackResolution> = {
    accepted: "accepted",
    confirmed: "accepted",
    "已确认": "accepted",
    "确认": "accepted",
    rejected: "rejected",
    "拒绝": "rejected",
    revision_requested: "revision_requested",
    "需修订": "revision_requested",
    "请求修订": "revision_requested",
    cancelled: "cancelled",
    canceled: "cancelled",
    "取消": "cancelled"
  };
  const resolution = aliases[value];
  if (!resolution) {
    throw new Error(
      `Unsupported callback resolution ${value}; expected accepted, rejected, revision_requested, or cancelled.`
    );
  }
  return resolution;
}

function parseTestOutcome(value: string | undefined): TestOutcome | undefined {
  if (!value) return undefined;
  if (!["passed", "failed", "mixed", "inconclusive"].includes(value)) {
    throw new Error(`Unsupported test outcome: ${value}`);
  }
  return value as TestOutcome;
}

function parseExecutionOperations(values: string[]): ExecutionOperationKind[] {
  return values.map((value) => {
    if (!executionOperationKinds.includes(value as ExecutionOperationKind)) {
      throw new Error(`Unsupported execution operation: ${value}`);
    }
    return value as ExecutionOperationKind;
  });
}

function parseDataWritePolicy(value: string): ScriptReviewDataWritePolicy {
  if (!["no_write", "ephemeral_cleanup", "reusable_fixture", "tracked_residual"].includes(value)) {
    throw new Error(
      "--data-write-policy must be no_write, ephemeral_cleanup, reusable_fixture, or tracked_residual."
    );
  }
  return value as ScriptReviewDataWritePolicy;
}

function parseScriptCaseRisks(values: string[]): ScriptReviewCaseRisk[] | undefined {
  if (!values.length) return undefined;
  return values.map((value) => {
    const separator = value.lastIndexOf(":");
    const caseId = separator > 0 ? value.slice(0, separator).trim() : "";
    const level = separator > 0 ? value.slice(separator + 1).trim() : "";
    if (!caseId || !["light", "standard", "strict"].includes(level)) {
      throw new Error(`Invalid --case-risk "${value}"; expected <caseId>:<light|standard|strict>.`);
    }
    return {
      caseId,
      level: level as ScriptReviewCaseRisk["level"],
      reasons: ["case_review_risk_assessment"]
    };
  });
}

function parseResourceBudgets(
  values: string[]
): Array<{ resourceType: string; maxCreates: number }> {
  return values.map((value) => {
    const separator = value.lastIndexOf(":");
    const resourceType = separator > 0 ? value.slice(0, separator).trim() : "";
    const maxCreates = Number(separator > 0 ? value.slice(separator + 1) : "");
    if (!resourceType || !Number.isInteger(maxCreates) || maxCreates < 0) {
      throw new Error(`Invalid --budget "${value}"; expected <resource-type>:<non-negative-integer>.`);
    }
    return { resourceType, maxCreates };
  });
}

function parseResourcePoolBudgets(values: string[]): ExecutionResourcePoolBudget[] {
  return values.map((value) => {
    const [resourceType, baselineContractId, maxAvailableText, replacementBudgetText, ttlHoursText] = value.split(":");
    const maxAvailable = Number(maxAvailableText);
    const replacementBudget = Number(replacementBudgetText);
    const ttlHours = Number(ttlHoursText);
    if (
      !resourceType?.trim()
      || !baselineContractId?.trim()
      || !Number.isInteger(maxAvailable)
      || maxAvailable <= 0
      || !Number.isInteger(replacementBudget)
      || replacementBudget < 0
      || !Number.isInteger(ttlHours)
      || ttlHours <= 0
    ) {
      throw new Error(
        `Invalid --pool-budget "${value}"; expected <resource-type>:<baseline-contract>:<max>:<replacement-budget>:<ttl-hours>.`
      );
    }
    return {
      resourceType: resourceType.trim(),
      baselineContractId: baselineContractId.trim(),
      maxAvailable,
      replacementBudget,
      ttlHours,
      retirementPolicy: "validate_quarantine_replace"
    };
  });
}

function parseTransitionAttestations(values: string[]): Record<string, boolean> {
  return Object.fromEntries(values.map((value) => {
    const separator = value.lastIndexOf("=");
    const key = separator > 0 ? value.slice(0, separator).trim() : "";
    const flag = separator > 0 ? value.slice(separator + 1).trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) || flag !== "true") {
      throw new Error(`Invalid --attestation "${value}"; expected <safe-key>=true.`);
    }
    return [key, true] as const;
  }));
}

function caseScopesFromManifest(
  manifest: FormalExecutionManifest,
  caseIds: string[]
): ExecutionCaseScope[] {
  const selected = new Set(caseIds);
  return manifest.cases.filter((definition) => selected.has(definition.caseId)).map((definition) => {
    if (
      manifest.schemaVersion !== "formal-execution-manifest-v1"
      || !definition.permissionProfile
      || !definition.requiredOperations
      || !definition.dataWritePolicy
    ) {
      throw new Error(`${definition.caseId} must use formal-execution-manifest-v1 before publishing v1 authorization.`);
    }
    return {
      caseId: definition.caseId,
      permissionProfile: definition.permissionProfile,
      requiredOperations: definition.requiredOperations,
      operationBudgets: definition.operationBudgets ?? [],
      dataWritePolicy: definition.dataWritePolicy,
      consumesResources: definition.consumesResources ?? [],
      producesResources: definition.producesResources.map((resource) => {
        if (typeof resource === "string") {
          throw new Error(`${definition.caseId} v1 authorization requires produced resource contracts.`);
        }
        return resource;
      })
    };
  });
}

function stableResourceBudgets(
  suite: StableTestSuiteManifest,
  manifest: FormalExecutionManifest,
  caseIds: string[]
): Array<{ resourceType: string; maxCreates: number }> {
  const selected = new Set(caseIds);
  const resourceTypes = new Set<string>();
  for (const definition of manifest.cases.filter((item) => selected.has(item.caseId))) {
    for (const resource of definition.producesResources) {
      if (typeof resource === "string") continue;
      resourceTypes.add(resource.resourceType);
    }
  }
  return suite.resourceBudgets.filter((item) => resourceTypes.has(item.resourceType));
}

function stableResourcePoolBudgets(
  suite: StableTestSuiteManifest,
  manifest: FormalExecutionManifest,
  caseIds: string[]
): ExecutionResourcePoolBudget[] {
  const selected = new Set(caseIds);
  const selectedKeys = new Set<string>();
  for (const definition of manifest.cases.filter((item) => selected.has(item.caseId))) {
    for (const resource of definition.consumesResources ?? []) {
      selectedKeys.add(`${resource.resourceType}:${resource.baselineContractId}`);
    }
    for (const resource of definition.producesResources) {
      if (typeof resource === "string"
        || resource.disposition !== "reusable_fixture"
        || !resource.baselineContractId) continue;
      selectedKeys.add(`${resource.resourceType}:${resource.baselineContractId}`);
    }
  }
  return suite.resourcePoolBudgets.filter((item) =>
    selectedKeys.has(`${item.resourceType}:${item.baselineContractId}`)
  );
}

function externalTransitionsFromManifest(
  manifest: FormalExecutionManifest,
  caseIds: string[]
): ExecutionExternalTransitionSummary[] {
  const selected = new Set(caseIds);
  return manifest.cases.flatMap((definition) =>
    selected.has(definition.caseId)
      ? (definition.executionStages ?? []).flatMap((stage) =>
          stage.externalTransition
            ? [{
                caseId: definition.caseId,
                stageId: stage.stageId,
                transitionId: stage.externalTransition.transitionId,
                actionSummary: stage.externalTransition.actionSummary,
                allowedOutcomes: stage.externalTransition.allowedOutcomes,
                requiredAttestationKeys: stage.externalTransition.requiredAttestationKeys ?? []
              }]
            : []
        )
      : []
  );
}

function parseOutputDigests(values: string[]): Array<{ path: string; digest: string }> {
  return values.map((value) => {
    const separator = value.lastIndexOf(":");
    if (separator <= 0) {
      throw new Error(`Invalid --output-digest "${value}"; expected <path>:<sha256>.`);
    }
    const path = value.slice(0, separator);
    const digest = value.slice(separator + 1);
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Invalid SHA-256 digest for ${path}.`);
    }
    return { path, digest };
  });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const execFile = promisify(execFileCallback);

function pathInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function currentTestcaseReviewExport(
  manager: DurableWorkflowManager
): Promise<TestcaseReviewExport> {
  const view = await manager.gate();
  if (view.definitionVersion === "v1") return manager.currentTestcaseReviewExport();
  const callbackSubjectDigest = await manager.callbackSubjectDigest("case-confirmation");
  assertTestcaseReviewExportReady(view, callbackSubjectDigest);
  const reviewDesignPath = existsSync(manager.planPath)
    ? manager.planPath
    : view.definitionVersion === "v1" && manager.suiteRoot
      ? resolve(manager.suiteRoot, "design.md")
      : manager.planPath;
  const model = buildTestcaseReviewModel({
    requestId: manager.requestId,
    plan: await readFile(reviewDesignPath, "utf8"),
    cases: await readFile(manager.designAssetPath("cases.md"), "utf8"),
    callbackSubjectDigest,
    selectedCaseIds: (await manager.caseConfirmationReviewScope()).caseIds
  });
  return buildTestcaseReviewExport(model);
}

async function publishTestcaseReviewWorkbook(input: {
  manager: DurableWorkflowManager;
  modelPath: string;
  workbookPath: string;
  receiptPath: string;
  outputPath: string;
  cacheStatus?: "hit" | "miss" | "rebuild";
  renderMilliseconds?: number;
}): Promise<{
  outputPath: string;
  workbookSha256: string;
  modelDigest: string;
  callbackSubjectDigest: string;
}> {
  const exported = parseTestcaseReviewExport(JSON.parse(await readFile(input.modelPath, "utf8")));
  const current = await currentTestcaseReviewExport(input.manager);
  assertTestcaseReviewExportCurrent(exported, current);
  const workbook = await readFile(input.workbookPath);
  const workbookSha256 = sha256(workbook);
  const receipt = validateTestcaseReviewWorkbookReceipt({
    receipt: JSON.parse(await readFile(input.receiptPath, "utf8")),
    exported,
    workbookSha256
  });
  for (const preview of receipt.previews) {
    const previewPath = resolve(dirname(input.receiptPath), preview.path);
    if (sha256(await readFile(previewPath)) !== preview.sha256) {
      throw new Error(`Workbook preview digest does not match for ${preview.sheet}.`);
    }
  }
  const outputPath = resolve(input.outputPath);
  if (basename(outputPath) !== "cases-review.xlsx") {
    throw new Error("Published testcase review workbook must be named cases-review.xlsx.");
  }
  if (outputPath !== resolve(input.manager.requestRoot, "cases-review.xlsx")) {
    throw new Error("Review workbook must be published to this request's .local run archive.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await copyFile(input.workbookPath, temporary);
  await rename(temporary, outputPath);
  if ((await input.manager.gate()).definitionVersion === "v1") {
    await input.manager.recordTestcaseReviewWorkbookPublication({
      subjectDigest: exported.callbackSubjectDigest,
      contentDigest: exported.contentDigest,
      bindingDigest: exported.bindingDigest,
      workbookDigest: workbookSha256,
      receiptDigest: sha256(await readFile(input.receiptPath)),
      cacheStatus: input.cacheStatus ?? "miss",
      renderMilliseconds: input.renderMilliseconds ?? 0
    });
  }
  return {
    outputPath,
    workbookSha256,
    modelDigest: exported.modelDigest,
    callbackSubjectDigest: exported.callbackSubjectDigest
  };
}

async function renderAndPublishTestcaseReviewWorkbook(manager: DurableWorkflowManager): Promise<{
  outputPath: string;
  cacheStatus: "hit" | "miss" | "rebuild";
  renderMilliseconds: number;
  contentDigest: string;
  bindingDigest: string;
}> {
  const exported = await currentTestcaseReviewExport(manager);
  const cacheRoot = resolve(manager.workspaceRoot, ".local/test-review-cache", exported.contentDigest);
  const cachedWorkbook = resolve(cacheRoot, "body.xlsx");
  const cacheMetadataPath = resolve(cacheRoot, "cache.json");
  let cacheStatus: "hit" | "miss" | "rebuild" = "miss";
  if (existsSync(cachedWorkbook) && existsSync(cacheMetadataPath)) {
    try {
      const metadata = JSON.parse(await readFile(cacheMetadataPath, "utf8")) as Record<string, unknown>;
      if (metadata.schema === "testcase-review-cache-v1"
        && metadata.rendererVersion === "testcase-review-renderer-v1"
        && metadata.contentDigest === exported.contentDigest
        && metadata.bodyProjectionDigest === testcaseReviewWorkbookBodyProjectionDigest(exported.model)
        && metadata.workbookSha256 === sha256(await readFile(cachedWorkbook))) {
        cacheStatus = "hit";
      }
    } catch {
      cacheStatus = "rebuild";
    }
  }
  const stageRoot = resolve(manager.requestRoot, `.review-workbook-stage-${process.pid}`);
  const modelPath = resolve(stageRoot, "model.json");
  const workbookPath = resolve(stageRoot, "cases-review.xlsx");
  const receiptPath = resolve(stageRoot, "receipt.json");
  const previewDir = resolve(stageRoot, "previews");
  const startedAt = Date.now();
  try {
    await writeJsonAtomic(modelPath, exported);
    const args = [
      resolve(manager.workspaceRoot, "scripts/build-testcase-review-workbook.mjs"),
      "--model", modelPath,
      "--output", workbookPath,
      "--preview-dir", previewDir,
      "--receipt", receiptPath,
      ...(cacheStatus === "hit" ? ["--reuse-workbook", cachedWorkbook] : [])
    ];
    try {
      await execFile(process.execPath, args, { cwd: manager.workspaceRoot });
    } catch (error) {
      if (cacheStatus !== "hit") throw error;
      cacheStatus = "miss";
      const freshArgs = args.filter((value, index, values) =>
        value !== "--reuse-workbook" && values[index - 1] !== "--reuse-workbook"
      );
      await execFile(process.execPath, freshArgs, { cwd: manager.workspaceRoot });
    }
    if (cacheStatus !== "hit") {
      await mkdir(cacheRoot, { recursive: true });
      const temporary = `${cachedWorkbook}.${process.pid}.tmp`;
      await copyFile(workbookPath, temporary);
      await rename(temporary, cachedWorkbook);
      await writeJsonAtomic(cacheMetadataPath, {
        schema: "testcase-review-cache-v1",
        rendererVersion: "testcase-review-renderer-v1",
        contentDigest: exported.contentDigest,
        bodyProjectionDigest: testcaseReviewWorkbookBodyProjectionDigest(exported.model),
        workbookSha256: sha256(await readFile(cachedWorkbook)),
        lastUsedAt: new Date().toISOString()
      });
    } else {
      const metadata = JSON.parse(await readFile(cacheMetadataPath, "utf8")) as Record<string, unknown>;
      await writeJsonAtomic(cacheMetadataPath, { ...metadata, lastUsedAt: new Date().toISOString() });
    }
    const result = await publishTestcaseReviewWorkbook({
      manager,
      modelPath,
      workbookPath,
      receiptPath,
      outputPath: resolve(manager.requestRoot, "cases-review.xlsx"),
      cacheStatus,
      renderMilliseconds: Date.now() - startedAt
    });
    return { ...result, cacheStatus, renderMilliseconds: Date.now() - startedAt, contentDigest: exported.contentDigest, bindingDigest: exported.bindingDigest };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

function resolveActivityId(view: WorkflowGateView, value: string): string {
  if (!view.activities[value]) throw new Error(`Unknown workflow activity: ${value}`);
  return value;
}

function callbackFromProjection(
  view: WorkflowGateView,
  callbackId: string
): { activityId: string; subjectDigest: string } {
  const activity = Object.values(view.activities).find((candidate) =>
    candidate.callbackId === callbackId
  );
  if (!activity?.callbackSubjectDigest) {
    throw new Error(`No pending callback exists for ${callbackId}.`);
  }
  return { activityId: activity.id, subjectDigest: activity.callbackSubjectDigest };
}

function reviewerActivity(
  view: WorkflowGateView,
  args: string[],
  preferredStates: ActivityProjection["state"][]
): string {
  const explicit = option(args, "--activity");
  if (explicit) return resolveActivityId(view, explicit);
  const role = option(args, "--role");
  const candidates = Object.values(view.activities)
    .filter((activity) =>
      activity.definition.kind === "review"
      && (!role || activity.definition.metadata?.role === role)
    );
  for (const state of preferredStates) {
    const match = candidates.find((activity) => activity.state === state);
    if (match) return match.id;
  }
  throw new Error("No matching reviewer activity exists; pass --activity explicitly.");
}

function output(args: string[], value: unknown, text: string): void {
  process.stdout.write(`${args.includes("--json") ? JSON.stringify(value, null, 2) : text}\n`);
}

function candidateManifestPath(manager: DurableWorkflowManager): string {
  return relative(
    manager.workspaceRoot,
    candidateScriptManifestPath(manager.workspaceRoot, manager.requestId)
  ).split(sep).join("/");
}

interface FrozenWebBuildInput {
  spec: FormalWebScriptSpec;
  scripts: string[];
  caseIds: string[];
  operations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: ScriptReviewDataWritePolicy;
}

/** Web execution scope is a build fact, not a caller-selected CLI subset. */
async function frozenWebBuildInput(
  manager: DurableWorkflowManager,
  view: WorkflowGateView
): Promise<FrozenWebBuildInput | undefined> {
  if (manager.requestId.split("/")[0] !== "web") return undefined;
  const specPath = resolve(
    manager.workspaceRoot,
    ".local/test-runs",
    ...manager.requestId.split("/"),
    "candidate-scripts/formal-web-script-spec.json"
  );
  if (!existsSync(specPath)) return undefined;
  const spec = parseFormalWebScriptSpec(JSON.parse(await readFile(specPath, "utf8")));
  const intent = await manager.recoverRunIntent();
  assertFormalWebSpecMatchesFrozenScope(spec, {
    requestId: manager.requestId,
    suiteId: intent.suiteId,
    environment: intent.environment,
    selectedCaseIds: (await manager.caseConfirmationReviewScope()).caseIds
  });
  const coveragePath = resolve(dirname(specPath), "web-script-coverage-plan.json");
  if (!existsSync(coveragePath)) {
    throw new Error("coverage_gap: frozen Web build is missing web-script-coverage-plan.json.");
  }
  const coveragePlan = JSON.parse(await readFile(coveragePath, "utf8")) as unknown;
  assertFormalWebCoveragePlan(coveragePlan);
  assertExactFormalWebCoverage({
    plan: coveragePlan,
    coveragePlanDigest: spec.coveragePlanDigest,
    steps: spec.cases.flatMap((entry) => entry.steps.map((step) => ({
      caseId: entry.caseId,
      coverageId: step.coverageId
    })))
  });
  const coverageReportPath = resolve(dirname(specPath), "web-script-coverage-gate.json");
  if (!existsSync(coverageReportPath)) {
    throw new Error("coverage_gap: frozen Web build is missing web-script-coverage-gate.json.");
  }
  const coverageReport = assessWebScriptCoverageGate({ spec, coveragePlan });
  assertWebScriptCoverageGate(coverageReport);
  const manifest = await loadFormalExecutionManifestFromPath(candidateManifestPath(manager), {
    workspaceRoot: manager.workspaceRoot,
    expectedRequestId: manager.requestId
  });
  const caseIds = [...spec.selectedCaseIds];
  if (JSON.stringify(manifest.cases.map((item) => item.caseId)) !== JSON.stringify(caseIds)) {
    throw new Error("scope_mismatch: frozen Web spec and formal manifest case order differ.");
  }
  const operations = [...new Set(manifest.cases.flatMap((item) => item.requiredOperations ?? []))];
  const policies = new Set(manifest.cases.map((item) => item.dataWritePolicy));
  const dataWritePolicy: ScriptReviewDataWritePolicy = policies.has("tracked_residual")
    ? "tracked_residual"
    : policies.has("reusable_fixture")
      ? "reusable_fixture"
      : policies.has("ephemeral_cleanup")
        ? "ephemeral_cleanup"
        : "no_write";
  const candidateRoot = `.local/test-runs/${manager.requestId}/candidate-scripts`;
  return {
    spec,
    scripts: [`${candidateRoot}/web.formal.spec.ts`, `${candidateRoot}/execution.manifest.ts`],
    caseIds,
    operations,
    resourceBudgets: spec.resourceBudgets,
    dataWritePolicy
  };
}

function assertExactFrozenWebOption(
  name: string,
  supplied: string[],
  expected: string[]
): void {
  if (!supplied.length) return;
  if (JSON.stringify([...new Set(supplied)].sort()) !== JSON.stringify([...new Set(expected)].sort())) {
    throw new Error(`scope_mismatch: ${name} must exactly match the frozen Web build scope.`);
  }
}

function assertExactFrozenWebBudgets(
  supplied: Array<{ resourceType: string; maxCreates: number }>,
  expected: Array<{ resourceType: string; maxCreates: number }>
): void {
  if (!supplied.length) return;
  const normalize = (budgets: Array<{ resourceType: string; maxCreates: number }>) =>
    [...budgets]
      .map((budget) => `${budget.resourceType}:${budget.maxCreates}`)
      .sort();
  if (JSON.stringify(normalize(supplied)) !== JSON.stringify(normalize(expected))) {
    throw new Error("scope_mismatch: --budget must exactly match the frozen Web build scope.");
  }
}

async function currentSelectorRepairAssessment(
  manager: DurableWorkflowManager,
  incidentPaths?: string[]
) {
  const snapshot = await loadConfirmedExecutionAuthorization(
    manager.requestId,
    undefined,
    [],
    manager.workspaceRoot
  );
  const manifest = await loadFormalExecutionManifestFromPath(
    candidateManifestPath(manager),
    {
      workspaceRoot: manager.workspaceRoot,
      expectedRequestId: manager.requestId
    }
  );
  const store = new FormalExecutionStore(
    resolve(manager.workspaceRoot, ".local/test-ledger"),
    resolve(manager.workspaceRoot, "artifacts/test-results/formal")
  );
  const record = await store.read(snapshot.digest);
  if (!record) throw new Error("Selector repair requires the current formal execution record.");
  return assessSelectorRepairRecovery({
    requestId: manager.requestId,
    snapshot,
    record,
    manifest,
    workspaceRoot: manager.workspaceRoot,
    ...(incidentPaths?.length ? { incidentPaths } : {})
  });
}

async function latestActiveSelectorRepair(manager: DurableWorkflowManager): Promise<{
  context: ExecutionSelectorRepairContext;
  incidentPaths: string[];
} | undefined> {
  const events = await manager.events();
  const invalidation = [...events].reverse().find((event) =>
    event.type === "ActivitiesInvalidated" && event.payload.selectorRepair !== undefined
  );
  if (!invalidation) return undefined;
  const republished = events.some((event) =>
    event.seq > invalidation.seq
    && event.type === "ActivitySucceeded"
    && event.payload.activityId === "readiness"
  );
  if (republished) return undefined;
  const context = repairContextFromEvent(invalidation.payload.selectorRepair);
  if (!context) return undefined;
  return {
    context,
    incidentPaths: selectorRepairIncidentPathsFromEvent(
      invalidation.payload.selectorRepair
    )
  };
}

async function applyPendingSelectorRepair(manager: DurableWorkflowManager): Promise<void> {
  const pending = await latestActiveSelectorRepair(manager);
  if (!pending) return;
  for (const path of pending.incidentPaths) {
    await applySelectorRepairIncident(
      await loadSelectorRepairIncident(path, manager.workspaceRoot),
      manager.workspaceRoot
    );
  }
}

async function scriptReviewAssessment(
  manager: DurableWorkflowManager,
  view: WorkflowGateView,
  input: {
    scripts: string[];
    caseIds: string[];
    operations: ExecutionOperationKind[];
    environment: string;
    resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
    dataWritePolicy: ScriptReviewDataWritePolicy;
    residualTtlHours: number;
    caseRiskAssessments?: ScriptReviewCaseRisk[];
  }
): Promise<ScriptReviewAssessment> {
  const formalManifest = await loadFormalExecutionManifest(manager.requestId);
  const requestedCaseIds = new Set(input.caseIds);
  const buildContracts = view.activities.build?.definition.metadata?.capabilityContracts;
  const capabilities = Object.values(view.activities)
    .filter((activity) => activity.definition.kind === "engineering")
    .flatMap((activity) =>
      activity.definition.capability ? [activity.definition.capability] : []
    )
    .concat(
      buildContracts && typeof buildContracts === "object" && !Array.isArray(buildContracts)
        ? Object.keys(buildContracts) as WorkflowCapability[]
        : []
    );
  return assessScriptReview({
    requestId: manager.requestId,
    workspaceRoot: manager.workspaceRoot,
    planPath: existsSync(manager.planPath)
      ? manager.planPath
      : manager.suiteRoot
        ? resolve(manager.suiteRoot, "design.md")
        : manager.planPath,
    scriptPaths: input.scripts,
    caseIds: input.caseIds,
    environment: input.environment,
    allowedOperations: input.operations,
    resourceBudgets: input.resourceBudgets,
    dataWritePolicy: input.dataWritePolicy,
    residualTtlHours: input.residualTtlHours,
    capabilities,
    caseRiskAssessments: input.caseRiskAssessments,
    formalCases: formalManifest.cases.filter((item) => requestedCaseIds.has(item.caseId)),
    formalManifestSchemaVersion: formalManifest.schemaVersion,
    executionHasCleanupActivity: Boolean(
      view.activities.cleanup
      || view.activities.run?.definition.metadata?.transaction
    )
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let command = args[0];
  const staticPreflightOnly = command === "script-static-preflight";
  if (staticPreflightOnly) command = "script-review-assess";
  if (!command || command === "--help" || args.includes("--help")) {
    process.stdout.write([
      "Usage: task:manage <command> --request <type/project/request> ...",
      "Reuse: init --delivery-target <testcase_only|script_only|full_run> --suite <type/project/feature> --reuse auto --environment <test|pre> [--profile <profile>] [--source <sources/...> --plan <candidate-plan.md>], suite-promote --suite <type/project/feature> [--level <reviewed|verified>]",
      "Core: init, resume, activity-start, activity-renew, activity-retry, run-intent-derive, run-intent-recover, impact-closure-build, delta-preflight, readiness-preflight, readiness-diagnose, candidate-generation-start, candidate-compiler-publish, candidate-fragment-compile, candidate-fragment-publish, candidate-fragment-merge, candidate-preflight, candidate-graph-expand, candidate-assemble, candidate-gate, review-resolution-complete, web-script-build-publish, activity-succeed, artifact-publish-succeed, activity-invalidate, activity-fail",
      "  candidate-generation-start --activity <candidate-compiler|candidate-fragment-*> [--owner <name>] [--lease-ms <ms>]  # atomically starts the model timer",
      "  candidate-compiler-publish --claim <lease> --source <staged-spec.json> --publish <id> --verified <evidence>",
      "  candidate-fragment-compile --activity <candidate-fragment-*> --publish <id> --verified <evidence> [--owner <name>]",
      "  candidate-fragment-merge --activity <candidate-fragment-*> --claim <lease> --source <model-detail.md> --publish <id> --verified <evidence>",
      "  candidate-fragment-publish --activity <candidate-fragment-*> --claim <lease> --source <model-fragment.md> --publish <id> --verified <evidence>",
      "  candidate-preflight --claim <lease> --source <staged-plan.md> --publish <id> --verified <evidence>  # strict plan/source/quote/explicit-fact coverage validation",
      "  web-script-build-publish --claim <lease> --source <formal-web-script-spec-v1.json> [--repair-source <formal-web-script-repair-proposal-v1.json>] --publish <id> --verified <evidence>  # Web only: freezes row coverage, validates/repairs the structured spec, then renders static formalCase declarations and the manifest",
      "  review-resolution-complete --claim <lease> --publish <id> --verified <evidence>  # current deterministic_only candidate gate only",
      "Waits: callback-request, callback-resolve, callback-reopen, block, resolve, reconcile, suspend",
      "  callback-resolve --callback <id> --resolution <accepted|rejected|revision_requested|cancelled> [--plan-source <updated-plan.md>]  # design_reconfirm case-confirmation omits plan-source",
      "Review: review-batch-start, review-rereview-start, reviewer-dispatch, reviewer-model-call-start/complete, reviewer-submit/fail, review-batch-invalidate",
      "  review-batch-start --batch <id> [--subflow <case-review|script-review> --activity <review-id> --affected-ref <REQ|RULE|case|section> --excluded-ref <ref> --base-batch <id> --reason <text>]",
      "  review-rereview-start --from-batch <id>（v1；确定性派生下一批次与角色范围）",
      "  reviewer-dispatch --batch <id> --activity <review-id> --agent-task <host-task-id>",
      "  reviewer-model-call-start --batch <id> --activity <review-id> --agent-task <host-task-id> [--supplemental --invalid-response-digest <sha256>]",
      "  reviewer-model-call-complete --batch <id> --activity <review-id> --agent-task <host-task-id> --result-digest <sha256>",
      "  reviewer-submit --batch <id> --activity <review-id> --agent-task <host-task-id> [--plan-evidence <plan.md>]",
      "  review-batch-invalidate --batch <id> --reason <text> [--activity <review-id> --revision-digest <sha256> --findings-digest <sha256>]",
      "Testcase review: testcase-review-render-publish  # v1 renders or reuses a local workbook body, then publishes this request's cases-review.xlsx",
      "  testcase-review-prepare --output <model.json>, testcase-review-publish --model <model.json> --workbook <staged.xlsx> --receipt <receipt.json> --output <cases-review.xlsx>",
      "Execution: script-static-preflight, script-review-assess/finalize, execution-readiness-publish, execution-authorization-request/verify, execution-scope-reopen, execution-run-finalize, execution-report-finalize, execution-transition-park/resolve, external-operation-start/reconcile",
      "  suite-promote --level reviewed --suite <suite> --case-script <caseId>:.local/test-runs/<request>/candidate-scripts/<spec>.formal.spec.ts  # writes reviewed scripts to the stable suite without auto-commit",
      "  readiness-preflight [--owner <name>]  # v1 immutable execution input validation before readiness",
      "  readiness-diagnose  # v1 immutable execution input diagnosis",
      "  script-static-preflight --environment <name> --script <path> --case-id <id> --operation <kind> [--budget <type:max>] --data-write-policy <policy>  # concurrent, read-only static gate aggregation; never publishes or starts reviewers",
      "  script-review-assess --claim <lease> --environment <name> --script <path> --case-id <id> [--case-risk <id:level>] --operation <kind> [--budget <type:max>] --data-write-policy <no_write|ephemeral_cleanup|reusable_fixture|tracked_residual>",
      "  script-review-finalize --claim <lease> --verified <evidence>  # aggregates only converged isolated reviewer receipts",
      "  execution-readiness-publish --claim <lease> --environment <name> [--target-build-digest <sha256>] --script <path> --case-id <id> [--case-risk <id:level>] --operation <kind> [--selector-evidence-digest <sha256>] --verified <evidence>",
      "  execution-scope-reopen --selector-repair <incident-path> [--selector-repair <incident-path> ...] [--reason <text>]",
      "  execution-run-finalize --claim <lease>",
      "  execution-report-finalize --claim <lease>",
      "  execution-transition-resolve --transition <id> --outcome <safe-token> [--attestation <key=true>] [--owner <name>]",
      "Lifecycle: history-verify, complete, cancel"
    ].join("\n") + "\n");
    return;
  }

  const requestId = required(args, "--request");
  const manager = new DurableWorkflowManager(requestId);
  const sessionId = option(args, "--session")
    ?? process.env.TEST_WORKFLOW_HOST_SESSION_ID;
  const targetThreadId = option(args, "--thread")
    ?? process.env.TEST_WORKFLOW_HOST_CONTEXT_ID
    ?? sessionId;

  if (command === "init") {
    const casePackages = options(args, "--case-package");
    const reviewerRoles = options(args, "--reviewer-role") as ReviewRole[];
    const isolationOptionsPresent = [
      "--contexts-isolated",
      "--accounts-isolated",
      "--data-isolated",
      "--shared-account"
    ].some((name) => option(args, name) !== undefined);
    const reuse = option(args, "--reuse");
    const additionalSourcePaths = options(args, "--source");
    if (reuse !== undefined && reuse !== "auto") {
      throw new Error("--reuse only accepts auto; the CLI derives the reuse decision.");
    }
    if (reuse === "auto") {
      if (!option(args, "--suite")) throw new Error("--reuse auto requires --suite.");
      const environment = option(args, "--environment");
      if (environment !== "test" && environment !== "pre") {
        throw new Error("--reuse auto requires --environment test or --environment pre.");
      }
      if (additionalSourcePaths.length && !option(args, "--plan")) {
        throw new Error("--source with --reuse auto requires --plan <candidate-plan.md>; new sources always use full_replan.");
      }
      const forbidden = [
        "--case-package",
        "--reviewer-role",
        "--writes-data",
        "--case-id",
        "--script",
        "--digest",
        "--suite-version"
      ].filter((name) => args.includes(name));
      if (forbidden.length) {
        throw new Error(`--reuse auto derives stable design inputs and does not accept ${forbidden.join(", ")}.`);
      }
    } else if (additionalSourcePaths.length) {
      throw new Error("--source is only valid with --reuse auto.");
    }
    const profile = option(args, "--profile");
    if (profile !== undefined
      && !["full_feature", "smoke", "affected", "failed_or_blocked"].includes(profile)) {
      throw new Error("--profile must be full_feature, smoke, affected, or failed_or_blocked.");
    }
    const view = await manager.initialize({
      planPath: option(args, "--plan"),
      capabilities: parseCapabilities(options(args, "--capability")),
      writesData: option(args, "--writes-data")
        ? parseBoolean(required(args, "--writes-data"), "--writes-data")
        : undefined,
      deliveryTarget: parseDeliveryTarget(option(args, "--delivery-target")),
      casePackages: casePackages.length ? casePackages : undefined,
      reviewerRoles: reviewerRoles.length ? reviewerRoles : undefined,
      executionIsolation: isolationOptionsPresent
        ? {
            contexts: parseBoolean(option(args, "--contexts-isolated") ?? "false", "--contexts-isolated"),
            accounts: parseBoolean(option(args, "--accounts-isolated") ?? "false", "--accounts-isolated"),
            data: parseBoolean(option(args, "--data-isolated") ?? "false", "--data-isolated"),
            sharedAccount: parseBoolean(option(args, "--shared-account") ?? "false", "--shared-account")
          }
        : undefined,
      sessionId,
      targetThreadId,
      suiteId: option(args, "--suite"),
      reuse: reuse as "auto" | undefined,
      environment: option(args, "--environment"),
      speed: resolveReviewSpeed({
        requested: parseReviewSpeed(option(args, "--speed")),
        deliveryTarget: parseDeliveryTarget(option(args, "--delivery-target")),
        writesData: option(args, "--writes-data")
          ? parseBoolean(required(args, "--writes-data"), "--writes-data")
          : false
      }),
      profile: profile as StableTestSuiteProfile | undefined,
      additionalSourcePaths: additionalSourcePaths.length ? additionalSourcePaths : undefined,
      fragmented: true
    });
    output(args, view, workflowStatusText(view));
    return;
  }

  if (!manager.exists()) {
    throw new Error(
      `No workflow history exists for ${requestId}; run task:initialize for a new request.`
    );
  }

  if (command === "resume") {
    if (sessionId) await manager.bindSession(sessionId, targetThreadId);
    await applyPendingSelectorRepair(manager);
    let view = await manager.resume(option(args, "--reason") ?? "explicit_cli_resume");
    if (
      view.definitionVersion === "v1"
      && view.activities.run?.state === "BLOCKED"
      && view.activities.run.blockerIds.some((id) => id.startsWith("deterministic-outcome-"))
    ) {
      const assessment = await currentSelectorRepairAssessment(manager);
      if (assessment.status === "eligible") {
        view = await manager.reopenExecutionScope(
          "eligible_selector_drift_repair",
          selectorRepairEventContext(assessment)
        );
        await applyPendingSelectorRepair(manager);
      }
    }
    output(args, view, workflowStatusText(view));
    return;
  }

  if (command === "testcase-review-prepare") {
    const outputPath = resolve(required(args, "--output"));
    if (
      pathInside(manager.workspaceRoot, outputPath)
      && !pathInside(resolve(manager.workspaceRoot, ".local"), outputPath)
    ) {
      throw new Error("Review model output inside the repository must be stored under .local/.");
    }
    const exported = await currentTestcaseReviewExport(manager);
    await writeJsonAtomic(outputPath, exported);
    output(args, {
      outputPath,
      modelDigest: exported.modelDigest,
      callbackSubjectDigest: exported.callbackSubjectDigest,
      semanticDigest: exported.semanticDigest,
      statistics: exported.model.statistics
    }, `用例评审模型已生成：${outputPath}`);
    return;
  }

  if (command === "testcase-review-publish") {
    const result = await publishTestcaseReviewWorkbook({
      manager,
      modelPath: required(args, "--model"),
      workbookPath: required(args, "--workbook"),
      receiptPath: required(args, "--receipt"),
      outputPath: required(args, "--output")
    });
    output(args, result, `用例评审工作簿已发布：${result.outputPath}`);
    return;
  }

  if (command === "testcase-review-render-publish") {
    const result = await renderAndPublishTestcaseReviewWorkbook(manager);
    output(args, result, `用例评审工作簿已发布（${result.cacheStatus === "hit" ? "复用主体" : result.cacheStatus === "rebuild" ? "缓存损坏回退重渲染" : "完整渲染"}）：${result.outputPath}`);
    return;
  }

  if (command === "activity-start") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const result = await manager.startActivity(
      activityId,
      option(args, "--owner") ?? "task-cli",
      parsePositiveInteger(option(args, "--lease-ms"), "--lease-ms", 120_000)
    );
    output(args, result, `Activity ${activityId} 已开始；claim=${result.claimToken}`);
    return;
  }

  if (command === "candidate-generation-start") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const result = await manager.startCandidateGeneration(
      activityId,
      option(args, "--owner") ?? "task-cli",
      parsePositiveInteger(option(args, "--lease-ms"), "--lease-ms", 120_000)
    );
    output(args, result, `候选生成 ${activityId} 已开始并登记模型计时；claim=${result.claimToken}`);
    return;
  }

  if (command === "readiness-preflight") {
    const before = await manager.gate();
    const activity = before.activities["readiness-preflight"];
    if (!activity || activity.state !== "READY") {
      throw new Error("readiness-preflight must be READY before validation.");
    }
    const started = await manager.startActivity("readiness-preflight", option(args, "--owner") ?? "task-cli");
    const report = await assessReadinessPreflight({
      workspaceRoot: manager.workspaceRoot,
      requestId: manager.requestId,
      requestRoot: manager.requestRoot,
      runRootMode: manager.runRootMode,
      suiteRoot: manager.suiteRoot,
      definitionVersion: before.definitionVersion
    });
    if (!report.complete) {
      const workflow = await manager.failActivity("readiness-preflight", {
        claimToken: started.claimToken,
        summary: `${report.category}: ${report.issues.join("；")}`
      });
      output(args, { report, workflow }, `readiness 预检阻断：${report.issues.join("；")}`);
      process.exitCode = 2;
      return;
    }
    await manager.completeReadinessPreflight(started.claimToken, report);
    output(args, report, "readiness 预检通过，可以领取 readiness。");
    return;
  }

  if (command === "readiness-diagnose") {
    const view = await manager.gate();
    if (view.definitionVersion !== "v1") {
      output(args, {
        requestId,
        definitionVersion: view.definitionVersion,
        category: "immutable_input_incompatible",
        issues: ["该 request 不属于当前 v1 调试基线。"],
        checklist: ["新建 v1 request 后重新 build/readiness。"]
      }, "非 v1 request 不提供兼容诊断。");
      return;
    }
    const report = await assessReadinessPreflight({
      workspaceRoot: manager.workspaceRoot,
      requestId: manager.requestId,
      requestRoot: manager.requestRoot,
      runRootMode: manager.runRootMode,
      suiteRoot: manager.suiteRoot,
      definitionVersion: view.definitionVersion
    });
    output(args, report, report.complete ? "readiness 输入兼容。" : `readiness 输入不兼容：${report.issues.join("；")}`);
    if (!report.complete) process.exitCode = 2;
    return;
  }

  if (command === "candidate-compiler-publish") {
    const view = await manager.publishCandidateCompiler({
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified"),
      spec: await readFile(required(args, "--source"), "utf8")
    });
    output(args, view, "候选规则编译提议已校验并发布冻结 spec 与分片清单。");
    return;
  }

  if (command === "candidate-fragment-compile") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.compileCandidateFragment({
      activityId,
      owner: option(args, "--owner") ?? "task-cli",
      leaseMs: parsePositiveInteger(option(args, "--lease-ms"), "--lease-ms", 120_000),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified")
    });
    output(args, view, "确定性候选分片已编译并发布，未调用模型。");
    return;
  }

  if (command === "candidate-fragment-merge") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.publishMixedCandidateFragment({
      activityId,
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified"),
      modelContent: await readFile(required(args, "--source"), "utf8")
    });
    output(args, view, "模型未知规则片段已与确定性区合并并发布。");
    return;
  }

  if (command === "candidate-fragment-publish") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.publishModelCandidateFragment({
      activityId,
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified"),
      content: await readFile(required(args, "--source"), "utf8")
    });
    output(args, view, "模型候选分片已按冻结关系校验并发布。");
    return;
  }

  if (command === "run-intent-derive") {
    const view = await manager.deriveCurrentRunIntent(required(args, "--claim"));
    output(args, view, "运行意图已登记；未创建完整 plan.md。");
    return;
  }

  if (command === "run-intent-recover") {
    const intent = await manager.recoverRunIntent();
    output(args, { digest: runIntentDigest(intent), suiteId: intent.suiteId, decision: intent.reuseDecision }, "运行意图已从 history 与稳定套件恢复；未追加事件。");
    return;
  }

  if (command === "impact-closure-build") {
    const view = await manager.buildImpactClosure(required(args, "--claim"));
    output(args, view, "影响闭包已冻结；可继续受影响设计增量预检。");
    return;
  }

  if (command === "delta-preflight") {
    const view = await manager.preflightDesignDelta(
      required(args, "--claim"),
      await readFile(required(args, "--source"), "utf8")
    );
    output(args, view, "设计增量已校验并冻结；可生成受影响模块骨架。");
    return;
  }

  if (command === "candidate-preflight") {
    const result = await manager.preflightCandidatePlan({
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified"),
      plan: await readFile(required(args, "--source"), "utf8")
    });
    output(
      args,
      result,
      result.report.complete
        ? "候选计划预检通过，plan.md 已原子发布。"
        : `候选计划预检未通过，已安排重试：${candidateRepairChecklist(result.report.issues).map((item) => `[${item.category}] ${item.issues.join("；")}`).join(" ")}`
    );
    return;
  }

  if (command === "activity-renew") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const result = await manager.renewActivity(
      activityId,
      required(args, "--claim"),
      parsePositiveInteger(option(args, "--lease-ms"), "--lease-ms", 120_000)
    );
    output(args, result, `Activity ${activityId} 租约已续期至 ${result.leaseExpiresAt}。`);
    return;
  }

  if (command === "activity-succeed") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.succeedActivity(activityId, {
      claimToken: required(args, "--claim"),
      verification: required(args, "--verified"),
      outputRefs: options(args, "--file"),
      outputDigests: parseOutputDigests(options(args, "--output-digest")),
      testOutcome: parseTestOutcome(option(args, "--test-outcome")),
      outcome: option(args, "--outcome")
    });
    output(args, view, `Activity ${activityId} 已提交；工作流状态：${view.workflowState}`);
    return;
  }

  if (command === "candidate-gate") {
    const result = await manager.succeedCandidateGate(required(args, "--claim"));
    output(
      args,
      result,
      `Candidate gate 已通过；profile=${result.report.profile}；review=${result.report.reviewMode}。`
    );
    return;
  }

  if (command === "review-resolution-complete") {
    const view = await manager.completeDeterministicReviewResolution({
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified")
    });
    output(args, view, "确定性候选已完成零模型复审收口，等待一次性用例确认。");
    return;
  }

  if (command === "candidate-graph-expand") {
    const view = await manager.expandCandidateGraph();
    output(args, view, `候选分片子图已冻结；就绪活动：${view.readyActivities.join("、") || "无"}。`);
    return;
  }

  if (command === "candidate-assemble") {
    const view = await manager.assembleCandidateFragments({
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified")
    });
    output(args, view, "候选分片已确定性汇总并原子发布 cases.md。");
    return;
  }

  if (command === "artifact-publish-succeed") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    if (activityId === "build" && requestId.split("/")[0] === "web") {
      throw new Error(
        "Web build must use web-script-build-publish; raw TypeScript and hand-written manifests are not accepted."
      );
    }
    const sources = options(args, "--source");
    const targets = options(args, "--target");
    if (!sources.length || sources.length !== targets.length) {
      throw new Error(
        "artifact-publish-succeed requires matching --source and --target values."
      );
    }
    const artifacts = await Promise.all(sources.map(async (sourcePath, index) => ({
      targetPath: targets[index]!,
      content: await readFile(sourcePath)
    })));
    const view = await manager.publishArtifactsAndSucceed(activityId, {
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: required(args, "--verified"),
      artifacts,
      testOutcome: parseTestOutcome(option(args, "--test-outcome")),
      outcome: option(args, "--outcome")
    });
    output(args, view, `Activity ${activityId} 产物已原子发布并提交成功。`);
    return;
  }

  if (command === "web-script-build-publish") {
    const before = await manager.gate();
    const build = before.activities.build;
    if (requestId.split("/")[0] !== "web" || !build || build.state !== "RUNNING") {
      throw new Error("web-script-build-publish requires a running Web build activity.");
    }
    let spec = parseFormalWebScriptSpec(JSON.parse(await readFile(required(args, "--source"), "utf8")));
    const intent = await manager.recoverRunIntent();
    const reviewScope = await manager.caseConfirmationReviewScope();
    assertFormalWebSpecMatchesFrozenScope(spec, {
      requestId,
      suiteId: intent.suiteId,
      environment: intent.environment,
      selectedCaseIds: reviewScope.caseIds
    });
    const coveragePlan = deriveFormalWebCoveragePlan({
      cases: await readFile(manager.designAssetPath("cases.md"), "utf8"),
      selectedCaseIds: reviewScope.caseIds
    });
    if (spec.coveragePlanDigest !== coveragePlan.digest) {
      throw new Error("scope_mismatch: Web spec coveragePlanDigest differs from the frozen confirmed execution rows.");
    }
    const repairSource = option(args, "--repair-source");
    let repairReport;
    if (repairSource) {
      const repaired = applyFormalWebScriptRepairProposal({
        spec,
        coveragePlan,
        proposal: JSON.parse(await readFile(repairSource, "utf8")) as FormalWebScriptRepairProposal
      });
      spec = repaired.spec;
      repairReport = repaired.report;
      if (repairReport.unresolved.length) {
        throw new Error(`web_script_repair_unresolved: ${repairReport.unresolved.map((item) => item.coverageId).join(",")}`);
      }
    }
    const coverageGate = assessWebScriptCoverageGate({ spec, coveragePlan });
    assertWebScriptCoverageGate(coverageGate);
    const bundle = renderFormalWebScriptBundle({
      workspaceRoot: manager.workspaceRoot,
      requestId,
      spec,
      coveragePlan
    });
    const artifacts = [
      ...bundle.artifacts,
      {
        targetPath: ".local/test-runs/" + requestId + "/candidate-scripts/web-script-coverage-gate.json",
        content: `${JSON.stringify(coverageGate, null, 2)}\n`
      },
      ...(repairReport ? [{
        targetPath: ".local/test-runs/" + requestId + "/candidate-scripts/web-script-repair-report.json",
        content: `${JSON.stringify(repairReport, null, 2)}\n`
      }] : [])
    ];
    const view = await manager.publishArtifactsAndSucceed("build", {
      claimToken: required(args, "--claim"),
      publishId: required(args, "--publish"),
      verification: `formal-web-static-compile:${sha256(bundle.formalSpecSource)}:${required(args, "--verified")}`,
      outcome: "static_compiled",
      artifacts
    });
    output(
      args,
      {
        workflow: view,
        staticCompilation: "passed",
        frozenCaseCount: spec.selectedCaseIds.length,
        staticDiscoveryCount: bundle.staticCaseIds.length,
        manifestCaseCount: spec.selectedCaseIds.length,
        coverageCount: coveragePlan.entries.length,
        coverageGate: "passed",
        ...(repairReport ? { repairedCoverageIds: repairReport.repairedCoverageIds } : {})
      },
      `Web 候选脚本已静态编译并发布：冻结 ${spec.selectedCaseIds.length} 条、静态发现 ${bundle.staticCaseIds.length} 条。`
    );
    return;
  }

  if (command === "activity-invalidate") {
    const activityIds = options(args, "--activity");
    if (!activityIds.length) {
      throw new Error("activity-invalidate requires at least one --activity <id>.");
    }
    const view = await manager.invalidateActivities({
      activityIds,
      reason: required(args, "--reason")
    });
    output(args, view, `已失效活动：${activityIds.join("、")}；工作流状态：${view.workflowState}`);
    return;
  }

  if (command === "activity-fail") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.failActivity(activityId, {
      claimToken: required(args, "--claim"),
      summary: required(args, "--reason")
    });
    output(args, view, `Activity ${activityId} 已记录失败，等待修复后使用 activity-retry 继续；工作流状态：${view.workflowState}`);
    return;
  }

  if (command === "activity-retry") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.retryActivity(activityId, required(args, "--reason"));
    output(args, view, `Activity ${activityId} 已登记新的重试 attempt；工作流状态：${view.workflowState}`);
    return;
  }

  if (command === "callback-request") {
    const before = await manager.gate();
    const activityId = resolveActivityId(before, required(args, "--activity"));
    if (activityId === "execution-authorization") {
      throw new Error(
        "Use execution-authorization-request so the immutable manifest schema and scope are validated."
      );
    }
    const subjectDigest = option(args, "--subject-digest")
      ?? (
        [
          "plan-confirmation",
          "case-confirmation",
          "execution-authorization"
        ].includes(activityId)
          ? await manager.callbackSubjectDigest(activityId)
          : required(args, "--subject-digest")
      );
    const callbackId = option(args, "--callback") ?? `callback-${activityId}-${subjectDigest.slice(0, 12)}`;
    const view = await manager.requestCallback({
      activityId,
      callbackId,
      subjectDigest,
      kind: option(args, "--kind") ?? "human_confirmation"
    });
    output(args, view, `已请求 callback ${callbackId}；等待用户明确决定。`);
    return;
  }

  if (command === "callback-resolve") {
    const before = await manager.gate();
    const callbackId = required(args, "--callback");
    const pending = callbackFromProjection(before, callbackId);
    const activityId = option(args, "--activity")
      ? resolveActivityId(before, required(args, "--activity"))
      : pending.activityId;
    const subjectDigest = option(args, "--subject-digest") ?? pending.subjectDigest;
    const resolution = parseCallbackResolution(required(args, "--resolution"));
    const formalCallbacks = new Set([
      "plan-confirmation",
      "case-confirmation",
      "case-review-conflict-decision",
      "execution-authorization"
    ]);
    const historyOnlyExecutionAuthorization = false;
    const runIntentCaseConfirmation = before.definitionVersion === "v1"
      && activityId === "case-confirmation"
      && !existsSync(manager.planPath);
    const view = formalCallbacks.has(activityId)
      && !historyOnlyExecutionAuthorization
      && !runIntentCaseConfirmation
      ? await manager.publishPlanAndResolveCallback({
          callbackId,
          activityId,
          subjectDigest,
          resolution,
          planContent: await readFile(required(args, "--plan-source")),
          owner: option(args, "--owner") ?? "task-manage-callback-resolve"
        })
      : await manager.resolveCallback({
          callbackId,
          activityId,
          subjectDigest,
          resolution
        });
    output(args, view, `Callback ${callbackId} 已记录。`);
    return;
  }

  if (command === "callback-reopen") {
    const before = await manager.gate();
    const activityId = resolveActivityId(before, required(args, "--activity"));
    const subjectDigest = required(args, "--subject-digest");
    const callbackId = option(args, "--callback")
      ?? `callback-${activityId}-${subjectDigest.slice(0, 12)}`;
    const view = await manager.reopenCallback({
      activityId,
      callbackId,
      subjectDigest,
      kind: option(args, "--kind") ?? "human_confirmation",
      reason: required(args, "--reason")
    });
    output(
      args,
      view,
      view.activities[activityId]?.state === "WAITING_CALLBACK"
        ? `旧 callback 已失效；正在等待新 callback ${callbackId}。`
        : "旧用例确认已失效；已返回 case-review 子流程。"
    );
    return;
  }

  if (command === "block") {
    const before = await manager.gate();
    const affectedActivityIds = options(args, "--activity")
      .map((activityId) => resolveActivityId(before, activityId));
    const view = await manager.raiseBlocker({
      blockerId: required(args, "--blocker"),
      affectedActivityIds,
      category: option(args, "--category") ?? "workflow",
      detail: required(args, "--reason"),
      resolutionCondition: required(args, "--resolution-condition")
    });
    output(args, view, `Blocker ${required(args, "--blocker")} 已登记。`);
    return;
  }

  if (command === "resolve") {
    const blockerId = required(args, "--blocker");
    const view = await manager.resolveBlocker(blockerId, required(args, "--evidence"));
    output(args, view, `Blocker ${blockerId} 已解除。`);
    return;
  }

  if (command === "reconcile") {
    const before = await manager.gate();
    const activityId = resolveActivityId(before, required(args, "--activity"));
    const publishId = option(args, "--publish");
    if (publishId) {
      const view = await manager.reconcilePreparedPublication(
        activityId,
        publishId,
        required(args, "--evidence")
      );
      output(args, view, `Prepared publication ${publishId} 已核对、补齐并完成活动收口。`);
      return;
    }
    const operationId = option(args, "--operation");
    if (operationId) {
      const outcome = required(args, "--outcome");
      if (!["confirmed", "not_found", "unknown", "conflict"].includes(outcome)) {
        throw new Error("External reconciliation outcome must be confirmed, not_found, unknown, or conflict.");
      }
      const view = await manager.reconcileExternalOperation({
        activityId,
        operationId,
        outcome: outcome as "confirmed" | "not_found" | "unknown" | "conflict",
        evidenceDigest: required(args, "--evidence-digest"),
        claimToken: option(args, "--claim")
      });
      output(args, view, `外部操作 ${operationId} 已核对为 ${outcome}。`);
      return;
    }
    const outcome = required(args, "--outcome");
    if (outcome !== "confirmed" && outcome !== "retry") {
      throw new Error("Activity reconciliation outcome must be confirmed or retry.");
    }
    const view = await manager.reconcileActivity(
      activityId,
      outcome,
      required(args, "--evidence"),
      option(args, "--retry-at"),
      options(args, "--file"),
      parseOutputDigests(options(args, "--output-digest"))
    );
    output(args, view, `Activity ${activityId} reconciliation 已记录为 ${outcome}。`);
    return;
  }

  if (command === "suspend") {
    const view = await manager.suspend(required(args, "--reason"));
    output(args, view, "工作流已显式挂起。");
    return;
  }

  if (command === "execution-authorization-request") {
    const manifest = loadExecutionAuthorizationManifest(
      requestId,
      option(args, "--environment"),
      parseExecutionOperations(options(args, "--operation")),
      manager.workspaceRoot
    );
    const before = await manager.gate();
    const activity = before.activities["execution-authorization"];
    if (!activity) throw new Error("Workflow definition is missing execution-authorization.");
    if (
      activity.state === "WAITING_CALLBACK"
      && activity.callbackId === manifest.callbackId
      && activity.callbackSubjectDigest === manifest.digest
    ) {
      output(args, before, `执行授权 callback ${manifest.callbackId} 已在等待决定。`);
      return;
    }
    if (activity.state === "SUCCEEDED" || activity.state === "BLOCKED") {
      throw new Error("Reopen the execution scope before requesting a changed authorization.");
    }
    const view = await manager.requestCallback({
      activityId: "execution-authorization",
      callbackId: manifest.callbackId,
      subjectDigest: manifest.digest,
      kind: "execution_authorization"
    });
    output(args, view, `已请求执行授权 callback ${manifest.callbackId}。`);
    return;
  }

  if (command === "script-review-assess") {
    const suppliedScripts = options(args, "--script");
    const currentView = await manager.gate();
    const frozenWeb = await frozenWebBuildInput(manager, currentView);
    const suppliedCaseIds = options(args, "--case-id");
    const suppliedOperations = parseExecutionOperations(options(args, "--operation"));
    const suppliedBudgets = parseResourceBudgets(options(args, "--budget"));
    const scripts = frozenWeb?.scripts ?? (() => {
      const requestManifest = candidateManifestPath(manager);
      return currentView.activities.readiness && existsSync(resolve(manager.workspaceRoot, requestManifest))
        ? [...new Set([...suppliedScripts, requestManifest])]
        : suppliedScripts;
    })();
    const caseIds = frozenWeb?.caseIds ?? suppliedCaseIds;
    const operations = frozenWeb?.operations ?? suppliedOperations;
    if (frozenWeb) {
      assertExactFrozenWebOption("--script", suppliedScripts, frozenWeb.scripts);
      assertExactFrozenWebOption("--case-id", suppliedCaseIds, frozenWeb.caseIds);
      assertExactFrozenWebOption("--operation", suppliedOperations, frozenWeb.operations);
      assertExactFrozenWebBudgets(suppliedBudgets, frozenWeb.resourceBudgets);
      const suppliedPolicy = option(args, "--data-write-policy");
      if (suppliedPolicy && suppliedPolicy !== frozenWeb.dataWritePolicy) {
        throw new Error("scope_mismatch: --data-write-policy must match the frozen Web manifest.");
      }
    }
    if ((!frozenWeb && (!suppliedScripts.length || !caseIds.length || !operations.length))) {
      throw new Error(
        "script-review-assess requires --script, --case-id, and --operation."
      );
    }
    const view = currentView;
    const scriptReview = view.activities["script-review-assessment"]
      ?? view.activities["script-review"]
      ?? view.activities.readiness;
    if (!scriptReview) {
      throw new Error("Workflow definition is missing script-review/readiness.");
    }
    const assessment = await scriptReviewAssessment(manager, view, {
      scripts,
      caseIds,
      operations,
      environment: required(args, "--environment"),
      resourceBudgets: frozenWeb?.resourceBudgets ?? suppliedBudgets,
      dataWritePolicy: frozenWeb?.dataWritePolicy
        ?? parseDataWritePolicy(required(args, "--data-write-policy")),
      caseRiskAssessments: parseScriptCaseRisks(options(args, "--case-risk")),
      residualTtlHours: parsePositiveInteger(
        option(args, "--residual-ttl-hours"),
        "--residual-ttl-hours",
        72
      )
    });
    const enforced = scriptReview.definition.metadata?.scriptReviewPolicyVersion
      === SCRIPT_REVIEW_POLICY_VERSION
      || scriptReview.definition.metadata?.readinessPolicyVersion
        === "execution-readiness-v1";
    if (staticPreflightOnly) {
      const coverageScope = frozenWeb?.spec.cases.flatMap((entry) => entry.steps.map((step) => ({
        coverageId: step.coverageId,
        caseId: entry.caseId
      })));
      output(
        args,
        {
          assessment,
          staticCheckResults: assessment.staticCheckResults,
          ...(coverageScope ? { coverageScope } : {}),
          enforced
        },
        `脚本静态预检已并行完成：${assessment.staticCheckResults.length} 项检查，${assessment.blockingIssues.length} 项阻断${coverageScope ? `，覆盖 ${coverageScope.length} 条冻结 coverageId` : ""}；未发布产物、未启动 reviewer。`
      );
      if (!assessment.publishable) process.exitCode = 2;
      return;
    }
    if (scriptReview.id === "script-review-assessment") {
      if (!assessment.publishable) {
        throw new Error(`Script review static gate failed: ${assessment.blockingIssues.join(" ")}`);
      }
      if (scriptReview.state !== "RUNNING") {
        output(
          args,
          { ...assessment, enforced },
          `脚本评审等级：${assessment.level}；所需 reviewer：${assessment.requiredReviewerRoles.join(", ") || "无"}。`
        );
        return;
      }
      const claimToken = required(args, "--claim");
      const published = await manager.publishArtifactsAndSucceed("script-review-assessment", {
        claimToken,
        publishId: option(args, "--publish")
          ?? `script-review-assessment-${assessment.inputDigest.slice(0, 16)}`,
        verification: `script-review-static:${assessment.inputDigest}`,
        outcome: assessment.level,
        artifacts: [{
          targetPath: `${manager.requestRoot}/script-review-assessment.json`,
          content: `${JSON.stringify(assessment, null, 2)}\n`
        }]
      });
      output(args, { assessment, workflow: published }, `脚本评审输入已冻结为 ${assessment.level}；可派发 ${assessment.requiredReviewerRoles.join("、") || "无需"} reviewer。`);
      return;
    }
    output(
      args,
      { ...assessment, enforced },
      `脚本评审等级：${assessment.level}；所需 reviewer：${
        assessment.requiredReviewerRoles.join(", ") || "无"
      }；静态门禁：${assessment.publishable ? "通过" : "阻断"}；策略${
        enforced ? "已启用" : "仅供旧 run 参考"
      }。`
    );
    if (!assessment.publishable) process.exitCode = 2;
    return;
  }

  if (command === "execution-readiness-publish") {
    await applyPendingSelectorRepair(manager);
    const activeSelectorRepair = await latestActiveSelectorRepair(manager);
    const suppliedScripts = options(args, "--script");
    const before = await manager.gate();
    const frozenWeb = await frozenWebBuildInput(manager, before);
    const suppliedCaseIds = options(args, "--case-id");
    const suppliedOperations = parseExecutionOperations(options(args, "--operation"));
    const suppliedBudgets = parseResourceBudgets(options(args, "--budget"));
    const formalManifestScript = candidateManifestPath(manager);
    const scripts = frozenWeb?.scripts ?? [...new Set([...suppliedScripts, formalManifestScript])];
    const caseIds = frozenWeb?.caseIds ?? suppliedCaseIds;
    const operations = frozenWeb?.operations ?? suppliedOperations;
    if (frozenWeb) {
      assertExactFrozenWebOption("--script", suppliedScripts, frozenWeb.scripts);
      assertExactFrozenWebOption("--case-id", suppliedCaseIds, frozenWeb.caseIds);
      assertExactFrozenWebOption("--operation", suppliedOperations, frozenWeb.operations);
      assertExactFrozenWebBudgets(suppliedBudgets, frozenWeb.resourceBudgets);
      const suppliedPolicy = option(args, "--data-write-policy");
      if (suppliedPolicy && suppliedPolicy !== frozenWeb.dataWritePolicy) {
        throw new Error("scope_mismatch: --data-write-policy must match the frozen Web manifest.");
      }
    }
    if (!frozenWeb && (!suppliedScripts.length || !caseIds.length || !operations.length)) {
      throw new Error(
        "execution-readiness-publish requires --script, --case-id, and --operation."
      );
    }
    const readinessActivity = before.activities.readiness;
    if (readinessActivity?.state !== "RUNNING") {
      throw new Error(
        "Start readiness before publishing execution-authorization-v1."
      );
    }
    const reuseMetadata = before.activities["reuse-assessment"]?.definition.metadata;
    if (before.definitionVersion === "v1"
      && reuseMetadata?.decision === "affected_rebuild") {
      const expectedCaseIds = Array.isArray(reuseMetadata.selectedCaseIds)
        ? reuseMetadata.selectedCaseIds.filter((item): item is string => typeof item === "string").sort()
        : [];
      if (JSON.stringify([...caseIds].sort()) !== JSON.stringify(expectedCaseIds)) {
        throw new Error(
          "Affected rebuild readiness must use exactly the caseIds from the deterministic impact assessment."
        );
      }
    }
    const attemptStarted = [...await manager.events()].reverse().find((event) =>
      event.type === "ActivityAttemptStarted"
      && event.payload.activityId === "readiness"
      && event.payload.attempt === readinessActivity.attempt
    );
    if (!attemptStarted) {
      throw new Error("readiness has no durable ActivityAttemptStarted timestamp.");
    }
    const claimToken = required(args, "--claim");
    const environment = required(args, "--environment");
    const suppliedTargetBuildDigest = option(args, "--target-build-digest");
    const suppliedSelectorEvidenceDigests = options(args, "--selector-evidence-digest");
    const resourceBudgets = frozenWeb?.resourceBudgets ?? suppliedBudgets;
    const resourcePoolBudgets = parseResourcePoolBudgets(options(args, "--pool-budget"));
    const dataWritePolicy = frozenWeb?.dataWritePolicy
      ?? parseDataWritePolicy(required(args, "--data-write-policy"));
    const residualTtlHours = parsePositiveInteger(
      option(args, "--residual-ttl-hours"),
      "--residual-ttl-hours",
      72
    );
    const scriptAssessment = await scriptReviewAssessment(manager, before, {
      scripts,
      caseIds,
      operations,
      environment,
      resourceBudgets,
      dataWritePolicy,
      caseRiskAssessments: parseScriptCaseRisks(options(args, "--case-risk")),
      residualTtlHours
    });
    if (!scriptAssessment.publishable) {
      throw new Error(
        `Execution readiness static gate failed: ${scriptAssessment.blockingIssues.join(" ")}`
      );
    }
    const formalManifest = await loadFormalExecutionManifest(requestId);
    if (formalManifest.environment !== environment) {
      throw new Error("Formal manifest environment differs from readiness input.");
    }
    const selectorBuildIdentity = await resolveSelectorBuildIdentity({
      manifest: formalManifest,
      workspaceRoot: manager.workspaceRoot,
      suppliedTargetBuildDigest,
      suppliedEvidenceDigests: suppliedSelectorEvidenceDigests
    });
    const { targetBuildDigest } = selectorBuildIdentity;
    const selectorEvidenceDigests = selectorBuildIdentity.evidenceDigests;
    const capabilityResults = await evaluateCapabilitiesWithProviders(
      formalManifest.capabilities,
      {
        requestId,
        environment,
        targetBuildDigest
      },
      createDefaultCapabilityProviderRegistry()
    );
    const poolKeys = [...new Map(
      formalManifest.cases.flatMap((definition) =>
        (definition.consumesResources ?? []).map((resource) => [
          `${resource.resourceType}:${resource.baselineContractId}`,
          { resourceType: resource.resourceType, baselineContractId: resource.baselineContractId }
        ] as const)
      )
    ).values()];
    const resourcePoolEvidence = await new TestDataManager({
      projectId: formalManifest.projectId,
      envId: environment
    }).inspectReusablePools(poolKeys);
    const readiness = assessExecutionReadiness({
      manifest: formalManifest,
      requestedCaseIds: caseIds,
      capabilityResults,
      allowedOperations: operations,
      dataWritePolicy,
      resourcePoolBudgets,
      resourcePoolEvidence,
      ...(!resolveFormalRunnerAdapter(requestId).implemented
        ? {
            globalBlockers: [{
              code: "runner_adapter_unavailable",
              source: requestId.split("/")[0]!,
              unblockCondition: `Implement and verify the ${requestId.split("/")[0]} formal runner adapter.`
            }]
          }
        : {})
    });
    if (readiness.invalidCount > 0) {
      throw new Error(
        `Execution readiness contains invalid cases: ${
          readiness.invalidCases.map((item) => item.caseId).join(", ")
        }.`
      );
    }
    if (readiness.runnableCount === 0) {
      const summary = `No runnable cases; ${readiness.deferredCount} case(s) are deferred by checked capabilities.`;
      await manager.failActivity("readiness", {
        claimToken,
        scheduleRetry: true,
        summary,
        maxAttempts: 99,
        retryAt: new Date(Date.now() + 86_400_000).toISOString()
      });
      const blocked = await manager.raiseBlocker({
        blockerId: `readiness-zero-runnable-${targetBuildDigest.slice(0, 12)}`,
        affectedActivityIds: ["readiness"],
        category: "execution_readiness",
        detail: summary,
        resolutionCondition: "Provide at least one checked runnable case and rerun readiness."
      });
      output(args, { readiness, workflow: blocked }, summary);
      process.exitCode = 2;
      return;
    }
    if (activeSelectorRepair?.context) {
      const expectedCaseIds = [...new Set([
        ...activeSelectorRepair.context.retryCaseIds,
        ...activeSelectorRepair.context.carriedCases.map((item) => item.caseId)
      ])].sort();
      if (JSON.stringify(readiness.runnableCaseIds) !== JSON.stringify(expectedCaseIds)) {
        throw new Error(
          "Selector repair readiness must preserve the complete prior execution case scope."
        );
      }
    }
    if (before.definitionVersion !== "v1") {
      throw new Error("Only a v1 request may publish execution readiness.");
    }
    const reviewReceipt = JSON.parse(await readFile(
      resolve(manager.requestRoot, "script-review-receipt.json"),
      "utf8"
    )) as { schemaVersion?: unknown; assessmentInputDigest?: unknown; reviewerReceipts?: unknown };
    if (reviewReceipt.schemaVersion !== "script-review-receipt-v1"
      || reviewReceipt.assessmentInputDigest !== scriptAssessment.inputDigest
      || !Array.isArray(reviewReceipt.reviewerReceipts)) {
      throw new Error("Readiness requires the completed script-review receipt for this frozen script input.");
    }
    const reviewerReceipts = reviewReceipt.reviewerReceipts as unknown[];
    const reviewEvidence = scriptAssessment.requiredReviewerRoles.map((role) => {
      const receipt = reviewerReceipts.find((item) =>
        item && typeof item === "object"
        && (item as { role?: unknown }).role === role
        && typeof (item as { findingsDigest?: unknown }).findingsDigest === "string"
      ) as { findingsDigest: string } | undefined;
      if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.findingsDigest)) {
        throw new Error(`Readiness requires an approved ${role} script-review receipt.`);
      }
      return { role, digest: receipt.findingsDigest };
    });
    const manifest = buildExecutionAuthorizationManifest({
      mode: "request",
      requestId,
      environment,
      scriptPaths: scripts,
      caseIds: readiness.runnableCaseIds,
      runnableCaseIds: readiness.runnableCaseIds,
      deferredCases: readiness.deferredCases,
      capabilityEvidence: readiness.capabilityEvidence,
      targetBuildDigest,
      selectorEvidenceDigests,
      ...(activeSelectorRepair?.context
        ? { repairContext: activeSelectorRepair.context }
        : {}),
      scriptReview: {
        level: scriptAssessment.level,
        evidenceDigests: reviewEvidence.map((item) => item.digest)
      },
      caseScopes: caseScopesFromManifest(formalManifest, readiness.runnableCaseIds),
      resourcePoolBudgets,
      resourcePoolEvidence,
      externalTransitions: externalTransitionsFromManifest(
        formalManifest,
        readiness.runnableCaseIds
      ),
      allowedOperations: operations,
      resourceBudgets,
      dataWritePolicy,
      residualTtlHours,
      workspaceRoot: manager.workspaceRoot,
      callbackId: option(args, "--callback"),
      createdAt: attemptStarted.occurredAt
    });
    if (manifest.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION || manifest.mode !== "request") {
      throw new Error("Readiness must publish request execution-authorization-v1.");
    }
    const targetPath = `${manager.requestRoot}/execution-authorization.json`;
    const readinessView = await manager.publishArtifactsAndSucceed("readiness", {
      claimToken,
      publishId: option(args, "--publish")
        ?? `execution-readiness-${(manifest.readinessDigest ?? manifest.digest).slice(0, 12)}-${sha256(claimToken).slice(0, 12)}`,
      verification: scriptReviewVerification({
        assessment: scriptAssessment,
        evidence: reviewEvidence,
        verification: required(args, "--verified")
      }),
      artifacts: [{
        targetPath,
        content: `${JSON.stringify(manifest, null, 2)}\n`
      }]
    });
    const authorization = await manager.autoFinalizePolicyNoWriteAuthorizationIfEligible();
    const view = authorization.authorized ? authorization.workflow : readinessView;
    output(
      args,
      {
        readiness,
        manifest,
        authorizationMode: authorization.authorized
          ? "policy_auto_no_write_v1"
          : "user_confirmed",
        targetBuildDigestSource: selectorBuildIdentity.sources,
        workflow: view
      },
      `readiness 已从 ${selectorBuildIdentity.sources.join(", ")} 读取 targetBuildDigest=${targetBuildDigest}，发布 ${readiness.runnableCount} 个执行链用例（首波 ${readiness.initialRunnableCaseIds.length}，后续 ${readiness.scheduledCaseIds.length}，共 ${readiness.executionWaves.length} 波，graph=${readiness.dependencyPlan.graphDigest.slice(0, 12)}），${readiness.deferredCount} 个真实延期用例；${authorization.authorized ? "已按 policy_auto_no_write_v1 自动授权" : "执行清单等待用户确认"}。`
    );
    return;
  }

  if (command === "suite-readiness-publish") {
    rejectOptions(args, [
      "--script",
      "--case-id",
      "--operation",
      "--data-write-policy",
      "--verified",
      "--review-evidence",
      "--selector-evidence-digest",
      "--target-build-digest",
      "--digest",
      "--suite-version"
    ], command);
    const before = await manager.gate();
    if (before.definitionVersion !== "v1") {
      throw new Error("suite-readiness-publish requires a v1 stable-suite workflow.");
    }
    const readinessActivity = before.activities.readiness;
    if (readinessActivity?.state !== "RUNNING") {
      throw new Error("Start readiness before publishing the suite execution authorization.");
    }
    const suiteId = String(readinessActivity.definition.metadata?.suiteId ?? "");
    const suiteVersion = String(readinessActivity.definition.metadata?.suiteVersion ?? "");
    const environment = required(args, "--environment");
    const suite = await loadStableTestSuite(suiteId, manager.workspaceRoot);
    const validation = await validateStableTestSuite(suiteId, manager.workspaceRoot);
    if (suite.suiteVersion !== suiteVersion
      || validation.driftedPaths.length
      || validation.closureDrift) {
      throw new Error("Stable suite changed after initialization; run a new deterministic reuse assessment.");
    }
    const assessment = await assessStableTestSuite({
      suiteId,
      environment,
      profile: String(readinessActivity.definition.metadata?.effectiveProfile ?? "full_feature") as StableTestSuiteProfile,
      workspaceRoot: manager.workspaceRoot
    });
    if (assessment.decision !== "direct_execute"
      || assessment.suiteVersion !== suiteVersion) {
      throw new Error("Stable suite is no longer eligible for direct execution.");
    }
    const requestedCaseIds = assessment.selectedCaseIds;
    const selectedEntryScriptPaths = stableSuiteEntryScriptsForCases(suite, requestedCaseIds);
    const formalManifest = await loadFormalExecutionManifestFromPath(
      suite.formalManifest.path,
      { workspaceRoot: manager.workspaceRoot, expectedSuiteId: suiteId }
    );
    if (formalManifest.environment !== environment) {
      throw new Error("Stable suite formal manifest environment differs from this run.");
    }
    if (formalManifest.scope === "stable_suite"
      && formalManifest.suiteId !== suiteId) {
      throw new Error("Stable suite formal manifest identity drifted.");
    }
    const selectedDefinitions = formalManifest.cases.filter((item) =>
      requestedCaseIds.includes(item.caseId)
    );
    if (selectedDefinitions.length !== requestedCaseIds.length) {
      throw new Error("Stable suite selected caseIds are not fully declared by the formal manifest.");
    }
    const operations = [...new Set(selectedDefinitions.flatMap((item) => item.requiredOperations ?? []))];
    if (!operations.length) {
      throw new Error("Stable suite direct execution requires explicit per-case operations.");
    }
    const selectorBuildIdentity = await resolveSelectorBuildIdentity({
      manifest: formalManifest,
      workspaceRoot: manager.workspaceRoot
    });
    const capabilityResults = await evaluateCapabilitiesWithProviders(
      formalManifest.capabilities,
      { requestId, environment, targetBuildDigest: selectorBuildIdentity.targetBuildDigest },
      createDefaultCapabilityProviderRegistry()
    );
    const poolKeys = [...new Map(
      selectedDefinitions.flatMap((definition) =>
        (definition.consumesResources ?? []).map((resource) => [
          `${resource.resourceType}:${resource.baselineContractId}`,
          { resourceType: resource.resourceType, baselineContractId: resource.baselineContractId }
        ] as const)
      )
    ).values()];
    const resourcePoolEvidence = await new TestDataManager({
      projectId: formalManifest.projectId,
      envId: environment
    }).inspectReusablePools(poolKeys);
    const resourcePoolBudgets = stableResourcePoolBudgets(suite, formalManifest, requestedCaseIds);
    const readiness = assessExecutionReadiness({
      manifest: formalManifest,
      requestedCaseIds,
      capabilityResults,
      allowedOperations: operations,
      dataWritePolicy: suite.dataWritePolicy,
      resourcePoolBudgets,
      resourcePoolEvidence,
      ...(!resolveFormalRunnerAdapter(requestId).implemented
        ? {
            globalBlockers: [{
              code: "runner_adapter_unavailable",
              source: requestId.split("/")[0]!,
              unblockCondition: `Implement and verify the ${requestId.split("/")[0]} formal runner adapter.`
            }]
          }
        : {})
    });
    if (readiness.invalidCount > 0) {
      throw new Error(`Stable suite readiness contains invalid cases: ${readiness.invalidCases.map((item) => item.caseId).join(", ")}.`);
    }
    if (readiness.runnableCount === 0) {
      const summary = `No runnable suite cases; ${readiness.deferredCount} case(s) await runtime capabilities.`;
      await manager.failActivity("readiness", {
        claimToken: required(args, "--claim"),
        scheduleRetry: true,
        summary,
        maxAttempts: 99,
        retryAt: new Date(Date.now() + 86_400_000).toISOString()
      });
      const blocked = await manager.raiseBlocker({
        blockerId: `readiness-zero-runnable-${suiteVersion.slice(0, 12)}`,
        affectedActivityIds: ["readiness"],
        category: "execution_readiness",
        detail: summary,
        resolutionCondition: "Restore the checked runtime capability and repeat suite readiness; do not rebuild the suite."
      });
      output(args, { readiness, workflow: blocked }, summary);
      process.exitCode = 2;
      return;
    }
    const attemptStarted = [...await manager.events()].reverse().find((event) =>
      event.type === "ActivityAttemptStarted"
      && event.payload.activityId === "readiness"
      && event.payload.attempt === readinessActivity.attempt
    );
    if (!attemptStarted) throw new Error("readiness has no durable start event.");
    const suiteManifestPath = stableSuiteManifestPath(suiteId, manager.workspaceRoot);
    const suiteManifestDigest = createHash("sha256")
      .update(await readFile(suiteManifestPath))
      .digest("hex");
    const manifest = buildExecutionAuthorizationManifest({
      mode: "stable_suite",
      requestId,
      environment,
      scriptPaths: selectedEntryScriptPaths,
      caseIds: readiness.runnableCaseIds,
      runnableCaseIds: readiness.runnableCaseIds,
      deferredCases: readiness.deferredCases,
      capabilityEvidence: readiness.capabilityEvidence,
      targetBuildDigest: selectorBuildIdentity.targetBuildDigest,
      selectorEvidenceDigests: selectorBuildIdentity.evidenceDigests,
      scriptReview: suite.scriptReview,
      caseScopes: caseScopesFromManifest(formalManifest, readiness.runnableCaseIds),
      resourcePoolBudgets,
      resourcePoolEvidence,
      externalTransitions: externalTransitionsFromManifest(formalManifest, readiness.runnableCaseIds),
      allowedOperations: operations,
      resourceBudgets: stableResourceBudgets(suite, formalManifest, readiness.runnableCaseIds),
      dataWritePolicy: suite.dataWritePolicy,
      workspaceRoot: manager.workspaceRoot,
      createdAt: attemptStarted.occurredAt,
      suiteRef: {
        sourceRequestId: suite.sourceRequestId,
        suiteId,
        suiteVersion,
        suiteManifestPath,
        suiteManifestDigest,
        suitePlanPath: suite.plan.path,
        formalManifestPath: suite.formalManifest.path,
        entryScriptPaths: selectedEntryScriptPaths,
        authorizationMode: suite.dataWritePolicy === "no_write"
          ? "policy_auto_no_write"
          : "user_confirmed"
      }
    });
    if (manifest.schemaVersion !== EXECUTION_AUTHORIZATION_SCHEMA_VERSION || manifest.mode !== "stable_suite") {
      throw new Error("Stable suite readiness must publish execution-authorization-v1.");
    }
    const view = await manager.publishArtifactsAndSucceed("readiness", {
      claimToken: required(args, "--claim"),
      publishId: `suite-readiness-${(manifest.readinessDigest ?? manifest.digest).slice(0, 12)}-${sha256(required(args, "--claim")).slice(0, 12)}`,
      verification: `stable-suite:${assessment.assessmentDigest}`,
      artifacts: [{
        targetPath: `testcases/${requestId}/execution-authorization.json`,
        content: `${JSON.stringify(manifest, null, 2)}\n`
      }]
    });
    const workflow = manifest.authorizationMode === "policy_auto_no_write"
      ? await manager.finalizePolicyNoWriteAuthorization()
      : view;
    output(
      args,
      { readiness, manifest, workflow },
      manifest.authorizationMode === "policy_auto_no_write"
        ? `稳定套件 ${suiteId}@${suiteVersion.slice(0, 12)} 已发布 readiness，并为本轮 no_write 范围自动授权。`
        : `稳定套件 ${suiteId}@${suiteVersion.slice(0, 12)} 已发布 readiness；本轮写入范围等待新的用户确认。`
    );
    return;
  }

  if (command === "execution-authorization-publish") {
    throw new Error(
      "execution-authorization-publish is retired; complete script-review-assess, isolated reviewer dispatch/submission, script-review-finalize, readiness-preflight, and execution-readiness-publish."
    );
  }

  if (command === "script-review-finalize") {
    const before = await manager.gate();
    const activity = before.activities["script-review"];
    if (activity?.state !== "RUNNING") {
      throw new Error("Start script-review after all required isolated reviewers have completed.");
    }
    const assessmentPath = resolve(manager.requestRoot, "script-review-assessment.json");
    const assessment = JSON.parse(await readFile(assessmentPath, "utf8")) as {
      inputDigest?: unknown;
      requiredReviewerRoles?: unknown;
    };
    if (typeof assessment.inputDigest !== "string" || !Array.isArray(assessment.requiredReviewerRoles)) {
      throw new Error("Frozen script-review assessment is malformed.");
    }
    const roles = assessment.requiredReviewerRoles.filter((role): role is string =>
      role === "script_quality" || role === "execution_safety"
    );
    const events = await manager.events();
    const receipts = roles.map((role) => {
      const reviewer = Object.values(before.activities).find((candidate) =>
        candidate.definition.metadata?.subflow === "script-review"
        && candidate.definition.metadata?.role === role
      );
      const submission = reviewer
        ? [...events].reverse().find((event) => event.type === "ReviewerSubmitted"
          && event.payload.activityId === reviewer.id)
        : undefined;
      if (!reviewer || reviewer.state !== "SUCCEEDED" || !submission
        || submission.payload.conclusion !== "converged"
        || typeof submission.payload.inputDigest !== "string"
        || typeof submission.payload.findingsDigest !== "string") {
        throw new Error(`Script reviewer ${role} is not approved with a closed findings receipt.`);
      }
      return {
        role,
        activityId: reviewer.id,
        inputDigest: submission.payload.inputDigest,
        findingsDigest: submission.payload.findingsDigest
      };
    });
    const receipt = {
      schemaVersion: "script-review-receipt-v1",
      assessmentInputDigest: assessment.inputDigest,
      reviewerReceipts: receipts
    };
    const view = await manager.publishArtifactsAndSucceed("script-review", {
      claimToken: required(args, "--claim"),
      publishId: option(args, "--publish")
        ?? `script-review-receipt-${assessment.inputDigest.slice(0, 16)}`,
      verification: required(args, "--verified"),
      artifacts: [{
        targetPath: `${manager.requestRoot}/script-review-receipt.json`,
        content: `${JSON.stringify(receipt, null, 2)}\n`
      }]
    });
    output(args, { receipt, workflow: view }, "隔离脚本 reviewer 回执已聚合；readiness-preflight 现在可继续。");
    return;
  }

  if (command === "execution-authorization-verify") {
    const snapshot = await loadConfirmedExecutionAuthorization(
      requestId,
      option(args, "--environment"),
      parseExecutionOperations(options(args, "--operation")),
      manager.workspaceRoot
    );
    output(args, snapshot, `执行授权 ${snapshot.digest.slice(0, 12)} 已确认且摘要有效。`);
    return;
  }

  if (command === "execution-scope-reopen") {
    const incidentPaths = options(args, "--selector-repair");
    if (incidentPaths.length) {
      const assessment = await currentSelectorRepairAssessment(manager, incidentPaths);
      if (assessment.status !== "eligible") {
        throw new Error(
          `Selector repair cannot reopen execution scope: ${assessment.reason ?? assessment.status}.`
        );
      }
      const view = await manager.reopenExecutionScope(
        option(args, "--reason") ?? "eligible_selector_drift_repair",
        selectorRepairEventContext(assessment)
      );
      await applyPendingSelectorRepair(manager);
      output(
        args,
        { assessment, workflow: view },
        `已记录并应用 ${assessment.incidents.length} 个定位修复；旧执行授权失效，请重新完成 build、readiness 和执行清单确认。`
      );
      return;
    }
    const view = await manager.reopenExecutionScope(required(args, "--reason"));
    output(args, view, "工程设计、脚本评审和旧执行授权已失效；请从 engineering 重新推进。");
    return;
  }

  if (command === "execution-run-finalize") {
    rejectOptions(args, [
      "--verified",
      "--test-outcome",
      "--outcome",
      "--file",
      "--digest",
      "--output-digest",
      "--result-digest",
      "--manifest-digest",
      "--execution-subject-digest",
      "--source",
      "--target",
      "--publish"
    ], command);
    const result = await finalizeFormalRunWorkflow({
      manager,
      claimToken: required(args, "--claim")
    });
    output(
      args,
      result,
      result.kind === "parked"
        ? result.parkReason === "deterministic_outcome"
          ? result.outcomeAssessment.allTerminalUnknownsRepairable
            ? `run 已暂停；${result.outcomeAssessment.terminalUnknownCount} 个终态 unknown 均为可修复定位漂移，task:resume 将回退脚本阶段。`
            : `run 已暂停；${result.outcomeAssessment.terminalUnknownCount} 个终态 unknown 必须由后续可信 attempt 消除。`
          : `run 已暂停；等待数据卫生收口：${result.dataHygieneStatus}。`
        : `run 已绑定 FormalExecutionStore 结果 ${result.evidence.resultDigest.slice(0, 12)}。`
    );
    return;
  }

  if (command === "execution-report-finalize") {
    rejectOptions(args, [
      "--verified",
      "--test-outcome",
      "--outcome",
      "--file",
      "--digest",
      "--output-digest",
      "--result-digest",
      "--manifest-digest",
      "--execution-subject-digest",
      "--source",
      "--target",
      "--publish"
    ], command);
    const result = await finalizeFormalReportWorkflow({
      manager,
      claimToken: required(args, "--claim")
    });
    output(
      args,
      result,
      `report 已绑定并发布 FormalExecutionStore 结果 ${result.evidence.resultDigest.slice(0, 12)}。`
    );
    return;
  }

  if (command === "execution-transition-park") {
    const snapshot = await loadConfirmedExecutionAuthorization(
      requestId,
      option(args, "--environment"),
      [],
      manager.workspaceRoot
    );
    const store = new FormalExecutionStore();
    const pending = await store.pendingTransitions(snapshot.digest);
    if (!pending.length) throw new Error("The formal run has no pending external transition.");
    const checkpointDigest = sha256(JSON.stringify(pending.map((item) => ({
      transitionId: item.transitionId,
      checkpointDigest: item.checkpointDigest
    }))));
    const blockerId = `external-transition-${snapshot.digest.slice(0, 12)}-${checkpointDigest.slice(0, 12)}`;
    const view = await manager.parkRunForExternalTransition({
      activityId: option(args, "--activity") ?? "run",
      claimToken: required(args, "--claim"),
      blockerId,
      detail: `等待已冻结的外部状态转换：${pending.map((item) => item.transitionId).join(", ")}；checkpoint=${checkpointDigest}`,
      resolutionCondition: "完成至少一个已列出的审核/驳回动作并提交对应脱敏确认。"
    });
    output(args, { blockerId, checkpointDigest, pending, workflow: view }, `已冻结 ${pending.length} 个外部转换并暂停 run。`);
    return;
  }

  if (command === "execution-transition-resolve") {
    const snapshot = await loadConfirmedExecutionAuthorization(
      requestId,
      option(args, "--environment"),
      [],
      manager.workspaceRoot
    );
    const formalManifest = await loadFormalExecutionManifest(requestId);
    const transitionId = required(args, "--transition");
    const outcome = required(args, "--outcome");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(outcome)) {
      throw new Error("--outcome must be a safe token declared by the transition.");
    }
    const store = new FormalExecutionStore();
    const resolved = await store.resolveExternalTransition({
      authorizationDigest: snapshot.digest,
      manifest: formalManifest,
      transitionId,
      outcome,
      attestations: parseTransitionAttestations(options(args, "--attestation"))
    });
    const before = await manager.gate();
    const activityId = option(args, "--activity") ?? "run";
    const blockerId = before.activities[activityId]?.blockerIds.find((id) =>
      id.startsWith(`external-transition-${snapshot.digest.slice(0, 12)}-`)
    );
    if (!blockerId) {
      output(args, resolved, `外部转换 ${transitionId} 已解析；run 已处于可恢复状态。`);
      return;
    }
    const resumed = await manager.resumeRunAfterExternalTransition({
      activityId,
      blockerId,
      evidenceDigest: sha256(JSON.stringify({
        transitionId,
        outcome,
        checkpointDigest: resolved.checkpointDigest
      })),
      owner: option(args, "--owner") ?? "external-transition-resume"
    });
    output(args, { resolved, resumed }, `外部转换 ${transitionId} 已解析；同一 run 已恢复。`);
    return;
  }

  if (command === "external-operation-start") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.startExternalOperation({
      activityId,
      operationId: required(args, "--operation"),
      operationKind: required(args, "--kind"),
      inputDigest: required(args, "--input-digest"),
      claimToken: required(args, "--claim")
    });
    output(args, view, `外部操作 ${required(args, "--operation")} intent 已持久化。`);
    return;
  }

  if (command === "external-operation-reconcile") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const outcome = required(args, "--outcome");
    if (!["confirmed", "not_found", "unknown", "conflict"].includes(outcome)) {
      throw new Error("External reconciliation outcome must be confirmed, not_found, unknown, or conflict.");
    }
    const view = await manager.reconcileExternalOperation({
      activityId,
      operationId: required(args, "--operation"),
      outcome: outcome as "confirmed" | "not_found" | "unknown" | "conflict",
      evidenceDigest: required(args, "--evidence-digest"),
      claimToken: option(args, "--claim")
    });
    output(args, view, `外部操作 ${required(args, "--operation")} 已核对为 ${outcome}。`);
    return;
  }

  if (command === "review-batch-start") {
    const batchId = required(args, "--batch");
    const subflow = option(args, "--subflow");
    if (subflow !== undefined && subflow !== "case-review" && subflow !== "script-review") {
      throw new Error("--subflow must be case-review or script-review.");
    }
    const inputPaths = options(args, "--input");
    const activityIds = options(args, "--activity");
    const affectedRefs = options(args, "--affected-ref");
    const excludedRefs = options(args, "--excluded-ref");
    // 防呆守卫：同一工作流已有前序批次时，无 --activity/--affected-ref 的再次
    // start 会解析为全量复审。验证有界修正集应走修订分层 structural/scoped 档
    // 或 targeted 范围（r2 实测：2 个结构修复的验证被派发为全量复审，40 分钟异常）。
    if (!activityIds.length && !affectedRefs.length) {
      const priorBatches = (await manager.events()).filter((event) =>
        event.type === "ReviewBatchStarted" && event.payload.batchId !== batchId
      );
      if (priorBatches.length) {
        process.stdout.write(
          `⚠ 本批未声明 --activity/--affected-ref，将解析为全量复审（${priorBatches.length} 个前序批次同纪元）；若仅验证有界修正集，请改用修订分层 structural/scoped 档或 targeted 范围。\n`
        );
      }
    }
    const view = await manager.startReviewBatch({
      batchId,
      ...(subflow ? { subflow } : {}),
      inputPaths,
      activityIds,
      affectedRefs,
      excludedRefs,
      baseBatchId: option(args, "--base-batch"),
      reason: option(args, "--reason")
    });
    output(args, view, `评审批次 ${batchId} 已开始。`);
    return;
  }

  if (command === "review-rereview-start") {
    const fromBatchId = required(args, "--from-batch");
    const view = await manager.startReviewerRereview(fromBatchId);
    output(args, view, `v1 复审批次已从 ${fromBatchId} 确定性派生。`);
    return;
  }

  if (command === "reviewer-dispatch") {
    const before = await manager.gate();
    const activityId = reviewerActivity(before, args, ["READY", "RETRY_WAIT", "RUNNING"]);
    const activity = before.activities[activityId]!;
    const role = option(args, "--role") ?? String(activity.definition.metadata?.role ?? "reviewer");
    const batchId = required(args, "--batch");
    if (option(args, "--input-digest")) {
      throw new Error("reviewer-dispatch derives inputDigest from the frozen batch; do not pass --input-digest.");
    }
    const deterministicDispatch = option(args, "--deterministic");
    const view = await manager.dispatchReviewer({
      activityId,
      batchId,
      role,
      ...(deterministicDispatch
        ? { deterministic: { classifierDigest: required(args, "--classifier-digest") } }
        : { agentTaskId: required(args, "--agent-task") })
    });
    const reviewPacket = await manager.reviewerInputPacket(batchId, activityId);
    output(
      args,
      { ...view, ...(reviewPacket ? { reviewPacket } : {}) },
      deterministicDispatch
        ? `确定性评审已派发（${activityId}，structural 档）。`
        : `Reviewer ${activityId} 已派发。`
    );
    return;
  }

  if (command === "reviewer-submit") {
    const before = await manager.gate();
    const activityId = reviewerActivity(before, args, ["RUNNING"]);
    const activity = before.activities[activityId]!;
    const batchId = required(args, "--batch");
    if (option(args, "--input-digest")) {
      throw new Error("reviewer-submit derives inputDigest from the frozen batch; do not pass --input-digest.");
    }
    const evidencePath = option(args, "--plan-evidence") ?? manager.reviewEvidencePath();
    if (option(args, "--plan-evidence-digest")) {
      throw new Error("reviewer-submit reads the evidence digest itself; do not pass --plan-evidence-digest.");
    }
    const role = option(args, "--role") ?? String(activity.definition.metadata?.role ?? "reviewer");
    const deterministicSubmit = option(args, "--deterministic");
    const findingsPath = required(args, "--findings");
    const view = await manager.submitReviewer({
      activityId,
      batchId,
      role,
      planEvidenceRef: evidencePath,
      findingsPath,
      ...(deterministicSubmit
        ? {
          deterministic: {
            classifierDigest: required(args, "--classifier-digest"),
            findingsPath
          }
        }
        : { agentTaskId: required(args, "--agent-task") })
    });
    output(
      args,
      view,
      deterministicSubmit
        ? `确定性评审已收口（${activityId}，structural 档）。`
        : `Reviewer ${activityId} 的正式 plan.md 证据已提交。`
    );
    return;
  }

  if (command === "reviewer-model-call-start") {
    const before = await manager.gate();
    const activityId = reviewerActivity(before, args, ["RUNNING"]);
    const activity = before.activities[activityId]!;
    const supplemental = option(args, "--supplemental") !== undefined;
    const view = await manager.startReviewerModelCall({
      activityId,
      batchId: required(args, "--batch"),
      role: option(args, "--role") ?? String(activity.definition.metadata?.role ?? "reviewer"),
      agentTaskId: required(args, "--agent-task"),
      supplemental,
      ...(supplemental ? { invalidResponseDigest: required(args, "--invalid-response-digest") } : {})
    });
    output(args, view, supplemental ? "Reviewer 补充模型调用已登记。" : "Reviewer 主模型调用已登记。");
    return;
  }

  if (command === "reviewer-model-call-complete") {
    const before = await manager.gate();
    const activityId = reviewerActivity(before, args, ["RUNNING"]);
    const activity = before.activities[activityId]!;
    const view = await manager.completeReviewerModelCall({
      activityId,
      batchId: required(args, "--batch"),
      role: option(args, "--role") ?? String(activity.definition.metadata?.role ?? "reviewer"),
      agentTaskId: required(args, "--agent-task"),
      resultDigest: required(args, "--result-digest")
    });
    output(args, view, "Reviewer 模型调用已完成并记录摘要。");
    return;
  }

  if (command === "reviewer-fail") {
    const before = await manager.gate();
    const activityId = reviewerActivity(before, args, ["RUNNING"]);
    const view = await manager.failReviewer({
      activityId,
      batchId: required(args, "--batch"),
      summary: required(args, "--reason"),
      retryAt: option(args, "--retry-at")
    });
    output(args, view, `Reviewer ${activityId} 失败已记录。`);
    return;
  }

  if (command === "review-batch-invalidate") {
    const before = await manager.gate();
    const requested = options(args, "--activity");
    const activityIds = requested.length
      ? requested.map((activityId) => resolveActivityId(before, activityId))
      : Object.values(before.activities)
          .filter((activity) => activity.definition.kind === "review")
          .map((activity) => activity.id);
    if (!activityIds.length) throw new Error("No review activities are available to invalidate.");
    const view = await manager.invalidateReviewBatch({
      batchId: required(args, "--batch"),
      activityIds,
      revisionDigest: option(args, "--revision-digest"),
      findingsDigest: option(args, "--findings-digest"),
      reason: required(args, "--reason")
    });
    output(args, view, `评审批次 ${required(args, "--batch")} 已失效并进入下一次 case-review。`);
    return;
  }

  if (command === "history-verify") {
    const result = await manager.verifyHistory();
    output(args, result, `历史校验通过：${result.eventCount} 个事件。`);
    return;
  }

  if (command === "suite-promote") {
    const level = option(args, "--level") ?? "verified";
    if (!['reviewed', 'verified'].includes(level)) {
      throw new Error("suite-promote --level must be reviewed or verified.");
    }
    if (level === "reviewed") {
      rejectOptions(args, [
        "--digest",
        "--suite-version",
        "--script",
        "--manifest",
        "--result-digest",
        "--authorization-digest"
      ], command);
      const suiteId = required(args, "--suite");
      const view = await manager.gate();
      if (view.activities["case-confirmation"]?.state !== "SUCCEEDED"
        || view.activities["script-review"]?.state !== "SUCCEEDED") {
        throw new Error("Reviewed script promotion requires accepted case-confirmation and completed script-review.");
      }
      const receiptPath = resolve(manager.requestRoot, "script-review-receipt.json");
      if (!existsSync(receiptPath)) {
        throw new Error("Reviewed script promotion requires the frozen script-review-receipt.json.");
      }
      const caseScripts = options(args, "--case-script").map((value) => {
        const separator = value.indexOf(":");
        const caseId = separator > 0 ? value.slice(0, separator) : "";
        const sourcePath = separator > 0 ? value.slice(separator + 1) : "";
        if (!caseId || !sourcePath) {
          throw new Error("--case-script must use <caseId>:<candidate-script-path>.");
        }
        return { caseId, sourcePath };
      });
      const result = await promoteReviewedDesignScripts({
        suiteId,
        requestId,
        reviewDigest: createHash("sha256").update(await readFile(receiptPath)).digest("hex"),
        caseScripts,
        workspaceRoot: manager.workspaceRoot
      });
      output(args, result, `稳定套件 ${result.suiteId}@${result.suiteVersion.slice(0, 12)} 已晋升 reviewed 脚本；请审查并提交 Git 变更。`);
      return;
    }
    rejectOptions(args, [
      "--digest",
      "--suite-version",
      "--case-id",
      "--case-script",
      "--script",
      "--manifest",
      "--result-digest",
      "--authorization-digest"
    ], command);
    const result = await promoteStableTestSuite({
      requestId,
      suiteId: required(args, "--suite"),
      workspaceRoot: manager.workspaceRoot
    });
    output(
      args,
      result,
      result.created
        ? `稳定套件 ${result.manifest.suiteId}@${result.manifest.suiteVersion.slice(0, 12)} 已晋升。`
        : `稳定套件 ${result.manifest.suiteId}@${result.manifest.suiteVersion.slice(0, 12)} 已存在，未重复写入。`
    );
    return;
  }

  if (command === "complete") {
    const view = await manager.complete(parseTestOutcome(option(args, "--test-outcome")));
    output(args, view, "工作流已完成。");
    return;
  }

  if (command === "cancel") {
    const view = await manager.cancel(required(args, "--reason"));
    output(args, view, "工作流已取消。");
    return;
  }

  throw new Error(`Unsupported task:manage command: ${command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
