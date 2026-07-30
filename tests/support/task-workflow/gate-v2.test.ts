import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  DurableWorkflowManager,
  isSafeWorkflowReply,
  type WorkflowGateView
} from "../../../src/support/task-workflow/index.js";
import {
  buildFormalDecisionPlan,
  recordFormalDecision
} from "./formalDecisionFixture.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const gatePath = resolve(repositoryRoot, "src/support/task-workflow/cli/gate.ts");
const managePath = resolve(repositoryRoot, "src/support/task-workflow/cli/manage.ts");
const statusPath = resolve(repositoryRoot, "src/support/task-workflow/cli/status.ts");
const tsxLoader = pathToFileURL(resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs")).href;
const requestId = "web/demo/gate-v2";

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-gate-v2-"));
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), [
    "# Gate v2 plan",
    "",
    "## 基本信息",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    `| 测试请求 | \`${requestId}\` |`,
    "| 测试类型 | Web |",
    "| 目标环境 | test |",
    "",
    "## 测试范围",
    "",
    "### 包含",
    "",
    "- 注册。",
    "",
    "### 不包含",
    "",
    "- 生产环境。",
    ""
  ].join("\n"), "utf8");
  return root;
}

async function succeed(
  manager: DurableWorkflowManager,
  activityId: string
): Promise<void> {
  const started = await manager.startActivity(activityId, "gate-test");
  const activity = started.projection.activities[activityId]!;
  const artifactPath = activity.definition.kind === "plan_validation"
    ? `testcases/${requestId}/plan.md`
    : `testcases/${requestId}/${activityId}.md`;
  if (activity.definition.publishesArtifacts) {
    if (activity.definition.kind !== "plan_validation") {
      await writeFile(
        resolve(manager.workspaceRoot, artifactPath),
        `# ${activityId}\n`,
        "utf8"
      );
    }
  }
  const evidence = {
    path: artifactPath,
    digest: activity.definition.publishesArtifacts
      ? createHash("sha256")
          .update(await readFile(resolve(manager.workspaceRoot, artifactPath)))
          .digest("hex")
      : ""
  };
  if (activity.definition.publishesArtifacts) {
    await manager.recordArtifactPublishPrepared({
      type: "ArtifactPublishPrepared",
      idempotencyKey: `${activityId}-prepared`,
      payload: {
        activityId,
        publishId: `${activityId}-publish`,
        manifestDigest: createHash("sha256").update(`${activityId}:manifest`).digest("hex"),
        artifacts: [{
          targetPath: evidence.path,
          digest: evidence.digest,
          expectedPreviousDigest: null,
          sizeBytes: 1
        }]
      }
    });
  }
  await manager.succeedActivity(activityId, {
    claimToken: started.claimToken,
    verification: "verified",
    ...(activity.definition.publishesArtifacts
      ? { outputRefs: [evidence.path], outputDigests: [evidence] }
      : {})
  });
}

async function hook(root: string, active: boolean): Promise<Record<string, unknown>> {
  const result = await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    gatePath,
    "--request",
    requestId,
    "--hook",
    "--stop-hook-active",
    String(active)
  ], { cwd: root });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test("Gate v2 exposes continuation without legacy scheduling fields", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  const view = await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-registration.md"],
    sessionId: "session-local",
    targetThreadId: "thread-local"
  });

  assert.equal(view.schemaVersion, "workflow-gate-v2");
  assert.equal(view.continuation.kind, "continue_now");
  assert.equal(view.reply.kind, "none");
  assert.equal(view.reply.allowed, false);
  assert.equal("wake" in view, false);
});

test("accepted plan callback immediately exposes case generation in the same gate result", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases-registration.md"] });
  await succeed(manager, "source-selection");
  await succeed(manager, "plan-validation");
  const digest = await manager.callbackSubjectDigest("plan-confirmation");
  await manager.requestCallback({
    activityId: "plan-confirmation",
    callbackId: "confirm-plan",
    subjectDigest: digest,
    kind: "plan_confirmation"
  });
  const planSource = resolve(root, "plan-with-formal-decision.md");
  await writeFile(
    planSource,
    await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      digest,
      "accepted"
    ),
    "utf8"
  );
  const resolveArgs = [
    "--import",
    tsxLoader,
    managePath,
    "callback-resolve",
    "--request",
    requestId,
    "--callback",
    "confirm-plan",
    "--resolution",
    "accepted",
    "--plan-source",
    planSource
  ];
  await execFileAsync(process.execPath, resolveArgs, { cwd: root });
  const accepted = await manager.gate();

  assert.equal(accepted.continuation.kind, "continue_now");
  assert.equal(accepted.reply.kind, "none");
  assert.deepEqual(accepted.readyActivities, ["case-generation-cases-registration-md"]);
  const events = await manager.events();
  const preparedIndex = events.findIndex((event) =>
    event.type === "ArtifactPublishPrepared"
    && event.payload.activityId === "plan-confirmation"
  );
  const resolvedIndex = events.findIndex((event) =>
    event.type === "CallbackResolved"
    && event.payload.activityId === "plan-confirmation"
  );
  assert.ok(preparedIndex >= 0 && resolvedIndex > preparedIndex);
  assert.equal(
    Object.keys((await manager.runtime.read())?.stagingRefs ?? {}).length,
    0
  );
  const historyAfterResolution = await readFile(manager.historyPath, "utf8");
  await execFileAsync(process.execPath, resolveArgs, { cwd: root });
  assert.equal(await readFile(manager.historyPath, "utf8"), historyAfterResolution);
  const conflictingPlanSource = resolve(root, "conflicting-plan-replay.md");
  await writeFile(
    conflictingPlanSource,
    `${await readFile(planSource, "utf8")}\n<!-- different replay bytes -->\n`,
    "utf8"
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      ...resolveArgs.slice(0, -1),
      conflictingPlanSource
    ], { cwd: root }),
    (error: unknown) => {
      assert.match(
        String((error as { stderr?: string }).stderr ?? error),
        /replay planContent conflicts/
      );
      return true;
    }
  );
});

test("safe reply requires an exact reply and continuation pairing", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  const base = await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-registration.md"]
  });
  assert.equal(isSafeWorkflowReply(base), false);
  assert.equal(isSafeWorkflowReply({
    ...base,
    workflowState: "SUCCEEDED",
    continuation: { kind: "continue_now", reason: "invalid" },
    reply: { kind: "final", allowed: true, reason: "invalid" },
    checkpoint: { safe: true, reason: "safe" }
  } as WorkflowGateView), false);
  assert.equal(isSafeWorkflowReply({
    ...base,
    workflowState: "SUCCEEDED",
    continuation: { kind: "stop", reason: "terminal" },
    reply: { kind: "final", allowed: true, reason: "terminal" },
    checkpoint: { safe: true, reason: "safe" }
  } as WorkflowGateView), true);
  assert.equal(isSafeWorkflowReply({
    ...base,
    workflowState: "WAITING_HUMAN",
    continuation: { kind: "continue_now", reason: "invalid" },
    reply: { kind: "action_required", allowed: true, reason: "invalid" },
    checkpoint: { safe: true, reason: "safe" }
  } as WorkflowGateView), false);
  assert.equal(isSafeWorkflowReply({
    ...base,
    workflowState: "WAITING_HUMAN",
    continuation: { kind: "wait_user", reason: "decision" },
    reply: { kind: "action_required", allowed: true, reason: "decision" },
    checkpoint: { safe: true, reason: "safe" }
  } as WorkflowGateView), true);
  assert.equal(isSafeWorkflowReply({
    ...base,
    workflowState: "SUSPENDED",
    continuation: { kind: "stop", reason: "suspended" },
    reply: { kind: "action_required", allowed: true, reason: "suspended" },
    checkpoint: { safe: true, reason: "safe" }
  } as WorkflowGateView), true);
});

test("read-only status may describe a non-terminal workflow without making it a safe final reply", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases-registration.md"] });
  const historyBefore = await readFile(manager.historyPath, "utf8");

  const status = await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    statusPath,
    "--request",
    requestId,
    "--json"
  ], { cwd: root });
  const projection = JSON.parse(status.stdout) as WorkflowGateView;
  assert.equal(projection.reply.kind, "none");
  assert.equal(projection.workflowState, "RUNNING");
  assert.equal(await readFile(manager.historyPath, "utf8"), historyBefore);

  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      tsxLoader,
      gatePath,
      "--request",
      requestId,
      "--assert-safe-reply"
    ], { cwd: root }),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, 2);
      return true;
    }
  );
  assert.equal(await readFile(manager.historyPath, "utf8"), historyBefore);
});

test("Stop Hook emits one continuation, prevents recursion, and allows safe user waits", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases-registration.md"] });

  const first = await hook(root, false);
  assert.equal(first.decision, "block");
  assert.match(String(first.reason), /不得宣称工作流完成/);
  const recursive = await hook(root, true);
  assert.equal(recursive.continue, false);
  assert.match(String(recursive.stopReason), /保持只读/);

  await succeed(manager, "source-selection");
  await succeed(manager, "plan-validation");
  const digest = await manager.callbackSubjectDigest("plan-confirmation");
  await manager.requestCallback({
    activityId: "plan-confirmation",
    callbackId: "confirm-plan",
    subjectDigest: digest,
    kind: "plan_confirmation"
  });
  assert.deepEqual(await hook(root, false), {});
});

test("deleting runtime preserves business projection and only loses host bindings", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-registration.md"],
    sessionId: "session-local",
    targetThreadId: "thread-local"
  });
  await succeed(manager, "source-selection");
  const before = await manager.projection();
  await rm(resolve(root, ".local/test-task-runtime"), { recursive: true, force: true });
  const after = await new DurableWorkflowManager(requestId, root).projection();
  assert.deepEqual(after, before);
  assert.match(await readFile(manager.historyPath, "utf8"), /ActivitySucceeded/);
});
