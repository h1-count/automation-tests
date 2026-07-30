import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  buildExecutionAuthorizationManifest,
  executionOperationKinds,
  loadConfirmedExecutionAuthorization,
  loadExecutionAuthorizationManifest,
  type ExecutionOperationKind
} from "../../formal-execution/authorization.js";
import { ReviewInputSnapshotStore } from "../reviewInputSnapshot.js";
import {
  DurableWorkflowManager,
  workflowStatusText,
  type WorkflowGateView
} from "../workflowManager.js";
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || args.includes("--help")) {
    process.stdout.write([
      "Usage: task:manage <command> --request <type/project/request> ...",
      "Core: init, resume, activity-start, activity-renew, activity-succeed, artifact-publish-succeed, activity-fail",
      "Waits: callback-request, callback-resolve, callback-reopen, block, resolve, reconcile, suspend",
      "  callback-resolve --callback <id> --resolution <accepted|rejected|revision_requested|cancelled> --plan-source <updated-plan.md>  # required for formal callbacks",
      "Review: review-batch-start, reviewer-dispatch/submit/fail, review-batch-invalidate",
      "  review-batch-start --batch <id> [--activity <review-id> --affected-ref <REQ|RULE|case|section> --excluded-ref <ref> --base-batch <id> --reason <text>]",
      "Execution: execution-authorization-publish/request/verify, execution-scope-reopen, external-operation-start/reconcile",
      "  execution-authorization-publish --claim <lease> --environment <name> --script <path> --case-id <id> --operation <kind> [--budget <type:max>] --data-write-policy <no_write|managed_cleanup|tracked_residual> --verified <evidence>",
      "Lifecycle: history-verify, complete, cancel"
    ].join("\n") + "\n");
    return;
  }

  const requestId = required(args, "--request");
  const manager = new DurableWorkflowManager(requestId);
  const sessionId = option(args, "--session") ?? process.env.CODEX_THREAD_ID;
  const targetThreadId = option(args, "--thread") ?? sessionId;

  if (command === "init") {
    const casePackages = options(args, "--case-package");
    const reviewerRoles = options(args, "--reviewer-role") as ReviewRole[];
    const isolationOptionsPresent = [
      "--contexts-isolated",
      "--accounts-isolated",
      "--data-isolated",
      "--shared-account"
    ].some((name) => option(args, name) !== undefined);
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
      targetThreadId
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
    const view = formalCallbacks.has(activityId)
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
    const manifest = buildExecutionAuthorizationManifest({
      requestId,
      environment: required(args, "--environment"),
      scriptPaths: scripts,
      caseIds,
      allowedOperations: operations,
      resourceBudgets: parseResourceBudgets(options(args, "--budget")),
      dataWritePolicy: required(args, "--data-write-policy") as
        | "no_write"
        | "managed_cleanup"
        | "tracked_residual",
      residualTtlHours: parsePositiveInteger(
        option(args, "--residual-ttl-hours"),
        "--residual-ttl-hours",
        72
      ),
      workspaceRoot: manager.workspaceRoot,
      callbackId: option(args, "--callback"),
      createdAt: attemptStarted.occurredAt
    });
    const targetPath = `testcases/${requestId}/execution-authorization.json`;
    const view = await manager.publishArtifactsAndSucceed("script-review", {
      claimToken,
      publishId: option(args, "--publish")
        ?? `execution-authorization-${manifest.digest.slice(0, 12)}-${sha256(claimToken).slice(0, 12)}`,
      verification: required(args, "--verified"),
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
      ...(option(args, "--agent-task") ? { agentTaskId: option(args, "--agent-task")! } : {})
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
      ...(option(args, "--agent-task") ? { agentTaskId: option(args, "--agent-task")! } : {})
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
      revisionDigest: required(args, "--revision-digest"),
      findingsDigest: required(args, "--findings-digest"),
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
