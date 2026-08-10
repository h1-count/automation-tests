import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  buildExecutionAuthorizationManifest,
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  executionOperationKinds,
  loadConfirmedExecutionAuthorization,
  loadExecutionAuthorizationManifest,
  type ExecutionCaseScope,
  type ExecutionExternalTransitionSummary,
  type ExecutionOperationKind,
  type ExecutionResourcePoolBudget
} from "../../formal-execution/authorization.js";
import {
  evaluateCapabilitiesWithProviders,
  loadFormalExecutionManifest,
  loadFormalExecutionManifestFromPath
} from "../../formal-execution/manifest.js";
import { createDefaultCapabilityProviderRegistry } from "../../formal-execution/capabilityProvider.js";
import { FormalExecutionStore } from "../../formal-execution/formalExecutionStore.js";
import {
  finalizeFormalReportWorkflow,
  finalizeFormalRunWorkflow
} from "../../formal-execution/workflowCompletion.js";
import { resolveSelectorBuildIdentity } from "../../formal-execution/selectorBuildIdentity.js";
import { resolveFormalRunnerAdapter } from "../../formal-execution/runnerAdapters.js";
import { assessExecutionReadiness } from "../../formal-execution/readiness.js";
import { TestDataManager } from "../../test-data/testDataManager.js";
import type { FormalExecutionManifest } from "../../formal-execution/types.js";
import {
  assessStableTestSuite,
  loadStableTestSuite,
  promoteStableTestSuite,
  stableSuiteEntryScriptsForCases,
  stableSuiteManifestPath,
  validateStableTestSuite
} from "../../test-suite/stableSuite.js";
import { ReviewInputSnapshotStore } from "../reviewInputSnapshot.js";
import {
  SCRIPT_REVIEW_POLICY_VERSION,
  assessScriptReview,
  scriptReviewVerification,
  validateScriptReviewEvidenceFiles,
  type ScriptReviewAssessment,
  type ScriptReviewCaseRisk,
  type ScriptReviewDataWritePolicy
} from "../../formal-execution/scriptReviewPolicy.js";
import {
  DurableWorkflowManager,
  workflowStatusText,
  type WorkflowGateView
} from "../workflowManager.js";
import type {
  StableTestSuiteManifest,
  StableTestSuiteProfile
} from "../../test-suite/stableSuite.js";
import type {
  ActivityProjection,
  CallbackResolution,
  ReviewRole,
  TestOutcome,
  WorkflowCapability
} from "../types.js";

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
  if (!["no_write", "managed_cleanup", "ephemeral_cleanup", "reusable_fixture", "tracked_residual"].includes(value)) {
    throw new Error(
      "--data-write-policy must be no_write, ephemeral_cleanup, reusable_fixture, tracked_residual, or legacy managed_cleanup."
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
      !["formal-execution-manifest-v3", "formal-execution-manifest-v4"].includes(manifest.schemaVersion)
      || !definition.permissionProfile
      || !definition.requiredOperations
      || !definition.dataWritePolicy
    ) {
      throw new Error(`${definition.caseId} must use formal-execution-manifest-v3 before publishing v4 authorization.`);
    }
    return {
      caseId: definition.caseId,
      permissionProfile: definition.permissionProfile,
      requiredOperations: definition.requiredOperations,
      operationBudgets: definition.operationBudgets ?? [],
      dataWritePolicy: definition.dataWritePolicy === "managed_cleanup"
        ? "ephemeral_cleanup"
        : definition.dataWritePolicy,
      consumesResources: definition.consumesResources ?? [],
      producesResources: definition.producesResources.map((resource) => {
        if (typeof resource === "string") {
          throw new Error(`${definition.caseId} v4 authorization requires produced resource contracts.`);
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
    planPath: manager.planPath,
    scriptPaths: input.scripts,
    caseIds: input.caseIds,
    environment: input.environment,
    allowedOperations: input.operations,
    resourceBudgets: input.resourceBudgets,
    dataWritePolicy: input.dataWritePolicy,
    residualTtlHours: input.residualTtlHours,
    capabilities,
    caseRiskAssessments: input.caseRiskAssessments,
    caseReviewPolicy: view.reviewPolicy,
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
  const command = args[0];
  if (!command || command === "--help" || args.includes("--help")) {
    process.stdout.write([
      "Usage: task:manage <command> --request <type/project/request> ...",
      "Reuse: init --suite <type/project/feature> --reuse auto --environment <test|pre> [--profile <profile>], suite-promote --suite <type/project/feature>",
      "Core: init, resume, activity-start, activity-renew, activity-succeed, artifact-publish-succeed, activity-fail",
      "Waits: callback-request, callback-resolve, callback-reopen, block, resolve, reconcile, suspend",
      "  callback-resolve --callback <id> --resolution <accepted|rejected|revision_requested|cancelled> --plan-source <updated-plan.md>  # required for formal callbacks",
      "Review: review-batch-start, reviewer-dispatch/submit/fail, review-batch-invalidate",
      "  review-batch-start --batch <id> [--activity <review-id> --affected-ref <REQ|RULE|case|section> --excluded-ref <ref> --base-batch <id> --reason <text>]",
      "  reviewer-dispatch --batch <id> --activity <review-id> --agent-task <host-task-id>",
      "  reviewer-submit --batch <id> --activity <review-id> --agent-task <host-task-id> [--plan-evidence <plan.md>]",
      "  review-batch-invalidate --batch <id> --reason <text> [--activity <review-id> --revision-digest <sha256> --findings-digest <sha256>]",
      "Execution: script-review-assess, execution-readiness-publish, suite-readiness-publish, execution-authorization-publish/request/verify, execution-scope-reopen, execution-run-finalize, execution-report-finalize, execution-transition-park/resolve, external-operation-start/reconcile",
      "  script-review-assess --environment <name> --script <path> --case-id <id> [--case-risk <id:level>] --operation <kind> [--budget <type:max>] --data-write-policy <no_write|ephemeral_cleanup|reusable_fixture|tracked_residual>",
      "  execution-readiness-publish --claim <lease> --environment <name> [--target-build-digest <sha256>] --script <path> --case-id <id> [--case-risk <id:level>] --operation <kind> [--selector-evidence-digest <sha256>] [--review-evidence <runtime-json>] --verified <evidence>",
      "  suite-readiness-publish --claim <lease> --environment <test|pre>  # all suite identities and scopes are derived",
      "  execution-authorization-publish --claim <lease> --environment <name> --script <path> --case-id <id> --operation <kind> [--budget <type:max>] --data-write-policy <no_write|ephemeral_cleanup|reusable_fixture|tracked_residual> [--review-evidence <runtime-json>] --verified <evidence>",
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
    ?? process.env.TEST_WORKFLOW_HOST_SESSION_ID
    ?? process.env.CODEX_THREAD_ID;
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
    if (reuse !== undefined && reuse !== "auto") {
      throw new Error("--reuse only accepts auto; the CLI derives the reuse decision.");
    }
    if (reuse === "auto") {
      if (!option(args, "--suite")) throw new Error("--reuse auto requires --suite.");
      const environment = option(args, "--environment");
      if (environment !== "test" && environment !== "pre") {
        throw new Error("--reuse auto requires --environment test or --environment pre.");
      }
      const forbidden = [
        "--plan",
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
      profile: profile as StableTestSuiteProfile | undefined
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
    const view = await manager.resume(option(args, "--reason") ?? "explicit_cli_resume");
    output(args, view, workflowStatusText(view));
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

  if (command === "artifact-publish-succeed") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
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

  if (command === "activity-fail") {
    const activityId = resolveActivityId(await manager.gate(), required(args, "--activity"));
    const view = await manager.failActivity(activityId, {
      claimToken: required(args, "--claim"),
      summary: required(args, "--reason"),
      retryable: parseBoolean(option(args, "--retryable") ?? "false", "--retryable"),
      retryAt: option(args, "--retry-at"),
      maxAttempts: parsePositiveInteger(option(args, "--max-attempts"), "--max-attempts", 3)
    });
    output(args, view, `Activity ${activityId} 已记录失败；工作流状态：${view.workflowState}`);
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
    const historyOnlyExecutionAuthorization = before.definitionVersion === "v6"
      && activityId === "execution-authorization";
    const view = formalCallbacks.has(activityId) && !historyOnlyExecutionAuthorization
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
    const scripts = currentView.activities.readiness
      ? [...new Set([
          ...suppliedScripts,
          `tests/${requestId}/execution.manifest.ts`
        ])]
      : suppliedScripts;
    const caseIds = options(args, "--case-id");
    const operations = parseExecutionOperations(options(args, "--operation"));
    if (!suppliedScripts.length || !caseIds.length || !operations.length) {
      throw new Error(
        "script-review-assess requires --script, --case-id, and --operation."
      );
    }
    const view = currentView;
    const scriptReview = view.activities["script-review"] ?? view.activities.readiness;
    if (!scriptReview) {
      throw new Error("Workflow definition is missing script-review/readiness.");
    }
    const assessment = await scriptReviewAssessment(manager, view, {
      scripts,
      caseIds,
      operations,
      environment: required(args, "--environment"),
      resourceBudgets: parseResourceBudgets(options(args, "--budget")),
      dataWritePolicy: parseDataWritePolicy(required(args, "--data-write-policy")),
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
    const suppliedScripts = options(args, "--script");
    const formalManifestScript = `tests/${requestId}/execution.manifest.ts`;
    const scripts = [...new Set([
      ...suppliedScripts,
      formalManifestScript
    ])];
    const caseIds = options(args, "--case-id");
    const operations = parseExecutionOperations(options(args, "--operation"));
    if (!suppliedScripts.length || !caseIds.length || !operations.length) {
      throw new Error(
        "execution-readiness-publish requires --script, --case-id, and --operation."
      );
    }
    const before = await manager.gate();
    const readinessActivity = before.activities.readiness;
    if (readinessActivity?.state !== "RUNNING") {
      throw new Error(
        "Start readiness before publishing execution-authorization-v4."
      );
    }
    const reuseMetadata = before.activities["reuse-assessment"]?.definition.metadata;
    if (before.definitionVersion === "v6"
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
    const authorizationSchemaVersion = readinessActivity.definition.metadata?.outputSchemaVersion
      === READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
      ? READINESS_EXECUTION_AUTHORIZATION_SCHEMA_VERSION
      : EXECUTION_AUTHORIZATION_SCHEMA_VERSION;
    const environment = required(args, "--environment");
    const suppliedTargetBuildDigest = option(args, "--target-build-digest");
    const suppliedSelectorEvidenceDigests = options(args, "--selector-evidence-digest");
    const resourceBudgets = parseResourceBudgets(options(args, "--budget"));
    const resourcePoolBudgets = parseResourcePoolBudgets(options(args, "--pool-budget"));
    const dataWritePolicy = parseDataWritePolicy(required(args, "--data-write-policy"));
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
        retryable: true,
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
    const reviewEvidence = await validateScriptReviewEvidenceFiles({
      assessment: scriptAssessment,
      evidencePaths: options(args, "--review-evidence"),
      workspaceRoot: manager.workspaceRoot,
      runtimeRequestRoot: manager.runtime.requestRoot
    });
    const manifest = buildExecutionAuthorizationManifest({
      schemaVersion: authorizationSchemaVersion,
      requestId,
      environment,
      scriptPaths: scripts,
      caseIds: readiness.runnableCaseIds,
      runnableCaseIds: readiness.runnableCaseIds,
      deferredCases: readiness.deferredCases,
      capabilityEvidence: readiness.capabilityEvidence,
      targetBuildDigest,
      selectorEvidenceDigests,
      scriptReview: {
        level: scriptAssessment.level,
        evidenceDigests: reviewEvidence.map((item) => item.digest)
      },
      ...(authorizationSchemaVersion === EXECUTION_AUTHORIZATION_SCHEMA_VERSION
        ? {
            caseScopes: caseScopesFromManifest(formalManifest, readiness.runnableCaseIds),
            resourcePoolBudgets,
            resourcePoolEvidence,
            externalTransitions: externalTransitionsFromManifest(
              formalManifest,
              readiness.runnableCaseIds
            )
          }
        : {}),
      allowedOperations: operations,
      resourceBudgets,
      dataWritePolicy,
      residualTtlHours,
      workspaceRoot: manager.workspaceRoot,
      callbackId: option(args, "--callback"),
      createdAt: attemptStarted.occurredAt
    });
    if (manifest.schemaVersion !== authorizationSchemaVersion) {
      throw new Error(`Readiness must publish ${authorizationSchemaVersion}.`);
    }
    const targetPath = `testcases/${requestId}/execution-authorization.json`;
    const view = await manager.publishArtifactsAndSucceed("readiness", {
      claimToken,
      publishId: option(args, "--publish")
        ?? `execution-readiness-${manifest.readinessDigest.slice(0, 12)}-${sha256(claimToken).slice(0, 12)}`,
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
    output(
      args,
      {
        readiness,
        manifest,
        targetBuildDigestSource: selectorBuildIdentity.sources,
        workflow: view
      },
      `readiness 已从 ${selectorBuildIdentity.sources.join(", ")} 读取 targetBuildDigest=${targetBuildDigest}，发布 ${readiness.runnableCount} 个执行链用例（首波 ${readiness.initialRunnableCaseIds.length}，后续 ${readiness.scheduledCaseIds.length}，共 ${readiness.executionWaves.length} 波，graph=${readiness.dependencyPlan.graphDigest.slice(0, 12)}），${readiness.deferredCount} 个真实延期用例。`
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
    if (before.definitionVersion !== "v6") {
      throw new Error("suite-readiness-publish requires a v6 stable-suite workflow.");
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
      throw new Error("Stable suite changed after v6 initialization; run a new deterministic reuse assessment.");
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
    if (formalManifest.schemaVersion === "formal-execution-manifest-v4"
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
        retryable: true,
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
      schemaVersion: STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
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
    if (manifest.schemaVersion !== STABLE_SUITE_EXECUTION_AUTHORIZATION_SCHEMA_VERSION) {
      throw new Error("Stable suite readiness must publish execution-authorization-v5.");
    }
    const view = await manager.publishArtifactsAndSucceed("readiness", {
      claimToken: required(args, "--claim"),
      publishId: `suite-readiness-${manifest.readinessDigest.slice(0, 12)}-${sha256(required(args, "--claim")).slice(0, 12)}`,
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
    const scripts = options(args, "--script");
    const caseIds = options(args, "--case-id");
    const operations = parseExecutionOperations(options(args, "--operation"));
    if (!scripts.length || !caseIds.length || !operations.length) {
      throw new Error(
        "execution-authorization-publish requires --script, --case-id, and --operation."
      );
    }
    const before = await manager.gate();
    const scriptReview = before.activities["script-review"];
    if (scriptReview?.state !== "RUNNING") {
      throw new Error(
        "Start script-review before publishing its immutable execution authorization."
      );
    }
    const attemptStarted = [...await manager.events()].reverse().find((event) =>
      event.type === "ActivityAttemptStarted"
      && event.payload.activityId === "script-review"
      && event.payload.attempt === scriptReview.attempt
    );
    if (!attemptStarted) {
      throw new Error("script-review has no durable ActivityAttemptStarted timestamp.");
    }
    const claimToken = required(args, "--claim");
    const environment = required(args, "--environment");
    const resourceBudgets = parseResourceBudgets(options(args, "--budget"));
    const dataWritePolicy = parseDataWritePolicy(required(args, "--data-write-policy"));
    const residualTtlHours = parsePositiveInteger(
      option(args, "--residual-ttl-hours"),
      "--residual-ttl-hours",
      72
    );
    const policyEnforced = scriptReview.definition.metadata?.scriptReviewPolicyVersion
      === SCRIPT_REVIEW_POLICY_VERSION;
    const assessment = policyEnforced
      ? await scriptReviewAssessment(manager, before, {
          scripts,
          caseIds,
          operations,
          environment,
          resourceBudgets,
          dataWritePolicy,
          caseRiskAssessments: parseScriptCaseRisks(options(args, "--case-risk")),
          residualTtlHours
        })
      : undefined;
    if (assessment && !assessment.publishable) {
      throw new Error(
        `Script review static gate failed: ${assessment.blockingIssues.join(" ")}`
      );
    }
    const evidence = assessment
      ? await validateScriptReviewEvidenceFiles({
          assessment,
          evidencePaths: options(args, "--review-evidence"),
          workspaceRoot: manager.workspaceRoot,
          runtimeRequestRoot: manager.runtime.requestRoot
        })
      : [];
    const manifest = buildExecutionAuthorizationManifest({
      requestId,
      environment,
      scriptPaths: scripts,
      caseIds,
      allowedOperations: operations,
      resourceBudgets,
      dataWritePolicy,
      residualTtlHours,
      workspaceRoot: manager.workspaceRoot,
      callbackId: option(args, "--callback"),
      createdAt: attemptStarted.occurredAt
    });
    const targetPath = `testcases/${requestId}/execution-authorization.json`;
    const view = await manager.publishArtifactsAndSucceed("script-review", {
      claimToken,
      publishId: option(args, "--publish")
        ?? `execution-authorization-${manifest.digest.slice(0, 12)}-${sha256(claimToken).slice(0, 12)}`,
      verification: assessment
        ? scriptReviewVerification({
            assessment,
            evidence,
            verification: required(args, "--verified")
          })
        : required(args, "--verified"),
      artifacts: [{
        targetPath,
        content: `${JSON.stringify(manifest, null, 2)}\n`
      }]
    });
    output(
      args,
      view,
      `执行清单 ${manifest.digest.slice(0, 12)} 已由 script-review 原子发布。`
    );
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
          ? `run 已暂停；${result.outcomeAssessment.terminalUnknownCount} 个终态 unknown 必须由后续可信 attempt 消除。`
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
    const inputPaths = options(args, "--input");
    const activityIds = options(args, "--activity");
    const affectedRefs = options(args, "--affected-ref");
    const excludedRefs = options(args, "--excluded-ref");
    const view = await manager.startReviewBatch({
      batchId,
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

  if (command === "reviewer-dispatch") {
    const before = await manager.gate();
    const activityId = reviewerActivity(before, args, ["READY", "RETRY_WAIT", "RUNNING"]);
    const activity = before.activities[activityId]!;
    const role = option(args, "--role") ?? String(activity.definition.metadata?.role ?? "reviewer");
    const batchId = required(args, "--batch");
    if (option(args, "--input-digest")) {
      throw new Error("reviewer-dispatch derives inputDigest from the frozen batch; do not pass --input-digest.");
    }
    const view = await manager.dispatchReviewer({
      activityId,
      batchId,
      role,
      agentTaskId: required(args, "--agent-task")
    });
    output(args, view, `Reviewer ${activityId} 已派发。`);
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
    const evidencePath = option(args, "--plan-evidence") ?? manager.planPath;
    if (option(args, "--plan-evidence-digest")) {
      throw new Error("reviewer-submit reads the evidence digest itself; do not pass --plan-evidence-digest.");
    }
    const role = option(args, "--role") ?? String(activity.definition.metadata?.role ?? "reviewer");
    const view = await manager.submitReviewer({
      activityId,
      batchId,
      role,
      planEvidenceRef: evidencePath,
      agentTaskId: required(args, "--agent-task")
    });
    output(args, view, `Reviewer ${activityId} 的正式 plan.md 证据已提交。`);
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
    rejectOptions(args, [
      "--digest",
      "--suite-version",
      "--case-id",
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
