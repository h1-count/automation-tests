import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  ArtifactPublisher,
  ArtifactReconciliationRequiredError,
  DurableWorkflowManager,
  isSafeWorkflowReply,
  parseReviewBatchScope,
  planDecisionProjection,
  reviewFindingsDigest,
  type SafeEventPayload,
  type WorkflowActorType,
  type WorkflowEventType,
  WorkflowRuntimeLeaseError,
  WorkflowTransitionError
} from "../../../src/support/task-workflow/index.js";
import { projectRelationProjection } from "../../../src/support/testcase/relationProjection.js";
import {
  buildFormalDecisionPlan,
  recordFormalDecision
} from "./formalDecisionFixture.js";

const requestId = "web/demo/registration-1";
const execFileAsync = promisify(execFile);
const manageCliPath = resolve(
  process.cwd(),
  "src/support/task-workflow/cli/manage.ts"
);
const tsxLoaderPath = resolve(process.cwd(), "node_modules/tsx/dist/loader.mjs");

async function succeedManagerActivity(
  manager: DurableWorkflowManager,
  activityId: string,
  claimToken: string,
  verification: string
): Promise<void> {
  const activity = (await manager.projection()).activities[activityId]!;
  const defaultPath = `testcases/${requestId}/${activityId}.md`;
  const outputPaths = !activity.definition.publishesArtifacts
    ? []
    : activity.definition.kind === "case_generation"
      ? [`testcases/${requestId}/cases-registration.md`]
      : activity.definition.kind === "relation_sync"
          || activity.definition.kind === "automatic_evolution"
        ? [
            `testcases/${requestId}/plan.md`,
            `testcases/${requestId}/cases-registration.md`
          ]
        : activity.definition.kind === "plan_validation"
            || activity.definition.kind === "review_resolution"
          ? [`testcases/${requestId}/plan.md`]
          : [defaultPath];
  if (
    activity.definition.publishesArtifacts
    && activity.definition.kind !== "case_generation"
    && activity.definition.kind !== "relation_sync"
    && activity.definition.kind !== "automatic_evolution"
    && activity.definition.kind !== "plan_validation"
    && activity.definition.kind !== "review_resolution"
  ) {
    await writeFile(resolve(manager.workspaceRoot, defaultPath), `# ${activityId}\n`, "utf8");
  }
  const evidence = await Promise.all(outputPaths.map(async (path) => ({
    path,
    digest: createHash("sha256")
      .update(await readFile(resolve(manager.workspaceRoot, path)))
      .digest("hex")
  })));
  if (
    activity.definition.publishesArtifacts
    && [
      "review_resolution",
      "relation_sync",
      "automatic_evolution"
    ].includes(activity.definition.kind)
  ) {
    await manager.publishArtifactsAndSucceed(activityId, {
      claimToken,
      publishId: `${activityId}-publish-${activity.attempt}`,
      verification,
      artifacts: await Promise.all(outputPaths.map(async (path) => ({
        targetPath: path,
        content: await readFile(resolve(manager.workspaceRoot, path))
      })))
    });
    return;
  }
  if (activity.definition.publishesArtifacts) {
    await manager.recordArtifactPublishPrepared({
      type: "ArtifactPublishPrepared",
      idempotencyKey: `${activityId}-prepared-${activity.attempt}`,
      payload: {
        activityId,
        publishId: `${activityId}-publish-${activity.attempt}`,
        manifestDigest: createHash("sha256")
          .update(`manifest:${activityId}:${activity.attempt}`, "utf8")
          .digest("hex"),
        artifacts: evidence.map((item) => ({
          targetPath: item.path,
          digest: item.digest,
          expectedPreviousDigest: null,
          sizeBytes: 1
        }))
      }
    });
  }
  await manager.succeedActivity(activityId, {
    claimToken,
    verification,
    ...(activity.definition.publishesArtifacts
      ? {
          outputRefs: evidence.map((item) => item.path),
          outputDigests: evidence
        }
      : {})
  });
}

function planMarkdown(
  caseIds = ["DEMO-REG-001", "DEMO-REG-002", "DEMO-REG-003"],
  status = "草案"
): string {
  return `# 测试计划

结构版本：case-relation-projection-v1
结构版本：rule-design-matrix-v1

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 测试请求 | \`${requestId}\` |
| 测试类型 | Web |
| 状态 | ${status} |
| 目标环境 | test（用户未指定环境，按本机长期偏好默认选择，待计划确认） |

## 测试范围

### 包含

- 注册字段与正常提交。

### 不包含

- 生产环境。

## 输入资料

- manifest \`demo-product-requirement\`；sectionId \`registration\`。

## 用例包目录

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 特殊门禁 |
| --- | --- | --- | --- | --- |
| \`cases-registration.md\` | 注册 | 字段 | 手工值 | 无 |

## 覆盖矩阵

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 注册资料已定义 | 注册字段与正常提交 | 已覆盖 | 手工值 |

## 需求追溯矩阵

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-DEMO-REG-001 | Demo PRD 1.0 | P0 | 注册字段与正常提交 | 适用 | 字段校验 | 手工值 | 已覆盖 | 无 |

## 规则覆盖台账

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${caseIds.map((caseId) => `| RULE-${caseId} | REQ-DEMO-REG-001 | Demo PRD 1.0 | 业务规则 | ${caseId} 合法注册输入 | 注册流程给出可观察结果 | 场景法 | 适用 | 已覆盖 | ${caseId} | test 隔离环境，无写入 |`).join("\n")}

## 规则设计矩阵

| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${caseIds.map((caseId) => `| RULE-${caseId} | 注册字段 | 必填 | ${caseId} 合法输入 | 页面显示资料定义的注册结果 | 已隔离测试账号 | 无写入 | ${caseId} | 已覆盖 |`).join("\n")}
`;
}

function testcaseBody(caseId: string): string {
  return `## 测试用例：${caseId}
## 基本信息
| 项目 | 内容 |
| --- | --- |
| 用例编号 | ${caseId} |
| 需求追溯编号 | REQ-DEMO-REG-001 |
| 规则覆盖编号 | RULE-${caseId} |
| 数据策略 | no_write |
| 风险等级 | 低 |
## 来源
- manifest \`demo-product-requirement\`；sectionId \`registration\`；SHA-256 \`${"a".repeat(64)}\`
## 前置条件
- ready
## 操作步骤
| 序号 | 操作 | 输入 | 预期 |
| --- | --- | --- | --- |
| 1 | 打开当前页 | 无 | 页面可见 |
## 预期结果
- result
## 覆盖关联
- relation
## 合理推断
- none
## 待补充信息
- none
## 评审与演进回链
- none
`;
}

function casesMarkdown(bodyCount: number): string {
  const ids = ["DEMO-REG-001", "DEMO-REG-002", "DEMO-REG-003"];
  return casesMarkdownFor(ids, bodyCount);
}

function casesMarkdownFor(ids: string[], bodyCount: number): string {
  return `# 用例包

## 包信息

| 项目 | 内容 |
| --- | --- |
| 用例包生成状态 | 草案完整 |

## 用例目录

| 用例编号 | 标题 |
| --- | --- |
${ids.map((id) => `| ${id} | ${id} |`).join("\n")}

${ids.slice(0, bodyCount).map(testcaseBody).join("\n")}
`;
}

function mixedRiskCasesMarkdown(
  ids: string[],
  strictCaseIds: Set<string>,
  lightCaseIds: Set<string>
): string {
  const bodies = ids.map((caseId) => {
    const base = testcaseBody(caseId);
    if (strictCaseIds.has(caseId)) {
      return base
        .replace("| 数据策略 | no_write |", "| 数据策略 | managed_cleanup |")
        .replace("| 风险等级 | 低 |", "| 风险等级 | 高 |")
        .replace("打开当前页", "发送一次 OTP 并提交受控合成申请");
    }
    if (lightCaseIds.has(caseId)) return base;
    return base
      .replace("| 风险等级 | 低 |", "| 风险等级 | 高 |")
      .replace("打开当前页", "查询已注册企业的审核状态");
  });
  return `# 用例包

## 包信息

| 项目 | 内容 |
| --- | --- |
| 用例包生成状态 | 草案完整 |

## 用例目录

| 用例编号 | 标题 |
| --- | --- |
${ids.map((id) => `| ${id} | ${id} |`).join("\n")}

${bodies.join("\n")}
`;
}

function relationFixture(ids: string[], bodyCount: number): { plan: string; cases: string } {
  const packages = { "cases-registration.md": casesMarkdownFor(ids, bodyCount) };
  const projected = projectRelationProjection(planMarkdown(ids.slice(0, bodyCount)), packages);
  assert.deepEqual(projected.issues, []);
  return { plan: projected.plan, cases: projected.packages["cases-registration.md"]! };
}

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "durable-workflow-manager-"));
  const requestRoot = resolve(root, "testcases/web/demo/registration-1");
  await mkdir(requestRoot, { recursive: true });
  const fixture = relationFixture(["DEMO-REG-001", "DEMO-REG-002", "DEMO-REG-003"], 3);
  await writeFile(resolve(requestRoot, "plan.md"), fixture.plan, "utf8");
  await writeFile(resolve(requestRoot, "cases-registration.md"), fixture.cases, "utf8");
  return root;
}

async function appendWorkflowEvent(
  manager: DurableWorkflowManager,
  input: {
    type: WorkflowEventType;
    actorType?: WorkflowActorType;
    idempotencyKey: string;
    payload: SafeEventPayload;
  }
): Promise<void> {
  const started = (await manager.events())[0]!;
  await manager.history.append({
    runId: started.runId,
    requestId: started.requestId,
    definitionId: started.definitionId,
    definitionVersion: started.definitionVersion,
    type: input.type,
    actorType: input.actorType ?? "agent",
    idempotencyKey: input.idempotencyKey,
    payload: input.payload
  }, await manager.history.head());
}

async function advanceToReviewReady(manager: DurableWorkflowManager): Promise<void> {
  await manager.initialize({ reviewerRoles: ["requirements"] });
  for (const activityId of ["source-selection", "plan-validation"]) {
    const claim = await manager.startActivity(activityId, "review-input-worker");
    await succeedManagerActivity(manager, activityId, claim.claimToken, `${activityId} verified`);
  }
  const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
  await manager.requestCallback({
    activityId: "plan-confirmation",
    callbackId: "review-input-plan-confirmation",
    subjectDigest,
    kind: "plan_confirmation"
  });
  await recordFormalDecision(manager, "plan-confirmation", subjectDigest, "accepted");
  await manager.resolveCallback({
    activityId: "plan-confirmation",
    callbackId: "review-input-plan-confirmation",
    subjectDigest,
    resolution: "accepted"
  });
  for (const activityId of [
    "case-generation-cases-registration-md",
    "relation-sync",
    "completeness-validation"
  ]) {
    const claim = await manager.startActivity(activityId, "review-input-worker");
    await succeedManagerActivity(manager, activityId, claim.claimToken, `${activityId} verified`);
  }
}

test("deleting disposable runtime preserves the exact event-derived business state", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const started = await manager.startActivity("source-selection", "worker-a");
    await manager.succeedActivity("source-selection", {
      claimToken: started.claimToken,
      verification: "source evidence verified"
    });
    const before = await manager.projection();

    await rm(resolve(root, ".local/test-task-runtime"), { recursive: true, force: true });
    const after = await new DurableWorkflowManager(requestId, root).projection();

    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume turns a lease-less running activity into reconciliation instead of retrying it", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    await manager.startActivity("source-selection", "worker-a");
    await rm(resolve(root, ".local/test-task-runtime"), { recursive: true, force: true });

    const beforeResume = await new DurableWorkflowManager(requestId, root).projection();
    assert.equal(beforeResume.activities["source-selection"]?.state, "RUNNING");
    const resumed = await new DurableWorkflowManager(requestId, root).resume("host wake");
    assert.equal(resumed.activities["source-selection"]?.state, "RECONCILING");
    assert.equal(resumed.workflowState, "RECONCILING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manager-owned artifact publication durably succeeds and removes staging runtime residue", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    const started = await manager.startActivity("plan-validation", "publisher");
    const published = await manager.publishArtifactsAndSucceed("plan-validation", {
      claimToken: started.claimToken,
      publishId: "PUB-MANAGER-PLAN",
      verification: "published and read back",
      artifacts: [{
        targetPath: `testcases/${manager.requestId}/plan.md`,
        content: await readFile(manager.planPath)
      }]
    });
    assert.equal(published.activities["plan-validation"]?.state, "SUCCEEDED");
    const runtime = await manager.runtime.read();
    assert.deepEqual(runtime?.stagingRefs, {});
    assert.ok(runtime?.leases["plan-validation"]?.releasedAt);
    await assert.rejects(
      readFile(resolve(
        manager.runtime.requestRoot,
        "staging/PUB-MANAGER-PLAN/manifest.json"
      ))
    );
    assert.equal(published.checkpoint.safe, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact ownership is validated before publication can modify another file", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await writeFile(resolve(root, "package.json"), "{\"private\":true}\n", "utf8");
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    const started = await manager.startActivity("plan-validation", "publisher");
    const packageBefore = await readFile(resolve(root, "package.json"), "utf8");
    const headBefore = (await manager.gate()).head;

    await assert.rejects(
      manager.publishArtifactsAndSucceed("plan-validation", {
        claimToken: started.claimToken,
        publishId: "PUB-WRONG-OWNER",
        verification: "must never publish",
        artifacts: [{
          targetPath: "package.json",
          content: "{\"private\":false}\n"
        }]
      }),
      /must publish exactly its owned artifacts/
    );

    assert.equal(await readFile(resolve(root, "package.json"), "utf8"), packageBefore);
    assert.deepEqual((await manager.gate()).head, headBefore);
    assert.deepEqual((await manager.runtime.read())?.stagingRefs, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a prepared publication conflict immediately enters durable reconciliation", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    const started = await manager.startActivity("plan-validation", "publisher");
    const lease = (await manager.runtime.read())!.leases["plan-validation"]!;
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    await publisher.prepare({
      publishId: "PUB-MANAGER-CONFLICT",
      activityId: "plan-validation",
      lease: {
        requestId,
        activityId: "plan-validation",
        owner: lease.owner,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        expiresAt: lease.expiresAt
      },
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: "# replacement plan\n"
      }]
    });
    await writeFile(manager.planPath, "# concurrent plan change\n", "utf8");

    await assert.rejects(
      manager.publishArtifactsAndSucceed("plan-validation", {
        claimToken: started.claimToken,
        publishId: "PUB-MANAGER-CONFLICT",
        verification: "must reconcile conflict",
        artifacts: [{
          targetPath: `testcases/${requestId}/plan.md`,
          content: "# replacement plan\n"
        }]
      }),
      ArtifactReconciliationRequiredError
    );

    const gate = await manager.gate();
    assert.equal(gate.activities["plan-validation"]?.state, "RECONCILING");
    assert.equal(gate.continuation.kind, "continue_now");
    assert.equal(gate.reply.kind, "none");
    assert.ok((await manager.events()).some((event) =>
      event.type === "ArtifactDriftDetected"
      && event.payload.activityId === "plan-validation"
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("claimless reconciliation completes a prepared publication only when the target is unchanged", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    await manager.startActivity("plan-validation", "publisher");
    const lease = (await manager.runtime.read())!.leases["plan-validation"]!;
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    const prepared = await publisher.prepare({
      publishId: "PUB-RECOVER-PENDING",
      activityId: "plan-validation",
      lease: {
        requestId,
        activityId: "plan-validation",
        owner: lease.owner,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        expiresAt: lease.expiresAt
      },
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: "# recovered plan\n"
      }]
    });
    await manager.recordArtifactPublishPrepared(prepared.event);
    await manager.markArtifactDrift({
      activityId: "plan-validation",
      artifactPath: `testcases/${requestId}/plan.md`,
      detail: "worker stopped before target rename"
    });

    const reconciled = await manager.reconcilePreparedPublication(
      "plan-validation",
      "PUB-RECOVER-PENDING",
      "prepared target matched its expected previous digest"
    );
    assert.equal(reconciled.activities["plan-validation"]?.state, "SUCCEEDED");
    assert.equal(await readFile(manager.planPath, "utf8"), "# recovered plan\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI retry abandons only an expired publication whose final target is still unchanged", async () => {
  const root = await realpath(await makeWorkspace());
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    await manager.startActivity("plan-validation", "publisher");
    const runtime = await manager.runtime.read();
    const lease = runtime!.leases["plan-validation"]!;
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    await publisher.prepare({
      publishId: "PUB-CRASH-BEFORE-PREPARED-EVENT",
      activityId: "plan-validation",
      lease: {
        requestId,
        activityId: "plan-validation",
        owner: lease.owner,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        expiresAt: lease.expiresAt
      },
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: "# regenerated plan\n"
      }]
    });
    assert.equal(
      (await manager.events()).some((event) => event.type === "ArtifactPublishPrepared"),
      false
    );
    await manager.runtime.compareAndSwap(
      (await manager.runtime.read())!.revision,
      (draft) => {
        draft.leases["plan-validation"]!.expiresAt =
          new Date(Date.now() - 1).toISOString();
      }
    );
    await manager.resume("publisher crashed before prepared event");

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      tsxLoaderPath,
      manageCliPath,
      "reconcile",
      "--request",
      requestId,
      "--activity",
      "plan-validation",
      "--outcome",
      "retry",
      "--evidence",
      "recovery proved no final target changed",
      "--retry-at",
      new Date(Date.now() - 1).toISOString(),
      "--json"
    ], { cwd: root });
    const gate = JSON.parse(stdout) as {
      activities: Record<string, { state: string }>;
    };
    assert.equal(gate.activities["plan-validation"]?.state, "READY");
    assert.deepEqual((await manager.runtime.read())?.stagingRefs, {});
    await assert.rejects(
      readFile(resolve(
        manager.runtime.requestRoot,
        "staging/PUB-CRASH-BEFORE-PREPARED-EVENT/manifest.json"
      ))
    );
    const replacement = await manager.startActivity(
      "plan-validation",
      "replacement-publisher"
    );
    assert.ok(replacement.fencingToken > lease.fencingToken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact retry is forbidden after a prepared target is already published", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    await manager.startActivity("plan-validation", "publisher");
    const runtime = await manager.runtime.read();
    const lease = runtime!.leases["plan-validation"]!;
    const handle = {
      requestId,
      activityId: "plan-validation",
      owner: lease.owner,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      expiresAt: lease.expiresAt
    };
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    const prepared = await publisher.prepare({
      publishId: "PUB-CRASH-AFTER-RENAME",
      activityId: "plan-validation",
      lease: handle,
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: "# already published plan\n"
      }]
    });
    await publisher.commit(prepared, handle);
    await manager.runtime.compareAndSwap(
      (await manager.runtime.read())!.revision,
      (draft) => {
        draft.leases["plan-validation"]!.expiresAt =
          new Date(Date.now() - 1).toISOString();
      }
    );
    await manager.resume("publisher crashed after rename");

    await assert.rejects(
      manager.reconcileActivity(
        "plan-validation",
        "retry",
        "must not overwrite an already published target"
      ),
      /PUBLISHED; retry is forbidden/
    );
    assert.equal(
      (await manager.gate()).activities["plan-validation"]?.state,
      "RECONCILING"
    );
    assert.ok(
      (await manager.runtime.read())?.stagingRefs["PUB-CRASH-AFTER-RENAME"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository plan subject drift invalidates acceptance and resume opens a new callback", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const firstDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation-first",
      subjectDigest: firstDigest,
      kind: "plan_confirmation"
    });
    const headBeforeStaleResolution = (await manager.gate()).head;
    const historyBeforeStaleResolution = await readFile(manager.historyPath, "utf8");
    await assert.rejects(
      manager.resolveCallback({
        activityId: "plan-confirmation",
        callbackId: "plan-confirmation-first",
        subjectDigest: "f".repeat(64),
        resolution: "accepted"
      }),
      /repository subject changed/
    );
    assert.deepEqual((await manager.gate()).head, headBeforeStaleResolution);
    assert.equal(
      await readFile(manager.historyPath, "utf8"),
      historyBeforeStaleResolution
    );
    await recordFormalDecision(manager, "plan-confirmation", firstDigest, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation-first",
      subjectDigest: firstDigest,
      resolution: "accepted"
    });

    await writeFile(
      manager.planPath,
      planMarkdown().replace("注册字段与正常提交。", "注册字段、异常校验与正常提交。"),
      "utf8"
    );
    const drifted = await manager.gate();
    assert.equal(drifted.reply.kind, "none");
    assert.equal(drifted.continuation.kind, "continue_now");
    assert.equal(drifted.continuation.reason, "callback_subject_drift");
    assert.equal(
      drifted.activities["case-generation-cases-registration-md"]?.state,
      "PENDING"
    );
    const pending = await manager.resume("detect subject drift");
    assert.equal(pending.activities["plan-confirmation"]?.state, "WAITING_CALLBACK");
    assert.equal(
      pending.activities["plan-confirmation"]?.callbackSubjectDigest,
      await manager.callbackSubjectDigest("plan-confirmation")
    );
    assert.equal(pending.workflowState, "WAITING_HUMAN");
    assert.equal(pending.reply.kind, "action_required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derived RULE caseId projection does not invalidate accepted plan confirmation", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(manager, activityId, claim.claimToken, `${activityId} verified`);
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation-derived-caseids",
      subjectDigest,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", subjectDigest, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation-derived-caseids",
      subjectDigest,
      resolution: "accepted"
    });

    await writeFile(
      manager.planPath,
      (await readFile(manager.planPath, "utf8")).replace(
        "| RULE-DEMO-REG-001 | 阶段二生成 |",
        "| RULE-DEMO-REG-001 | DEMO-REG-001 |"
      ),
      "utf8"
    );

    const view = await manager.gate();
    assert.equal(view.activities["plan-confirmation"]?.state, "SUCCEEDED");
    assert.deepEqual(view.readyActivities.sort(), [
      "case-generation-cases-registration-md"
    ]);
    assert.equal(view.continuation.reason, "ready_activity_available");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume completes a published formal decision from history after runtime deletion", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "history-only-plan-decision",
      subjectDigest,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    await rm(resolve(root, ".local/test-task-runtime"), {
      recursive: true,
      force: true
    });

    const recovered = await new DurableWorkflowManager(requestId, root)
      .resume("recover callback from history and final plan");
    assert.equal(recovered.activities["plan-confirmation"]?.state, "SUCCEEDED");
    assert.equal(
      recovered.activities["case-generation-cases-registration-md"]?.state,
      "READY"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume republishes a prepared callback plan after its worker lease expires", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "prepared-plan-decision",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const planContent = await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    const lease = await manager.runtime.acquire(
      "plan-confirmation",
      "crashed-plan-publisher",
      250
    );
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    const prepared = await publisher.prepare({
      publishId: "prepared-before-plan-rename",
      activityId: "plan-confirmation",
      lease,
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: planContent
      }]
    });
    await manager.recordArtifactPublishPrepared(prepared.event);
    const inFlight = await manager.resume("publisher is still committing");
    assert.equal(inFlight.checkpoint.safe, false);
    assert.equal(inFlight.reply.kind, "none");
    assert.equal(inFlight.continuation.kind, "wait_until");
    assert.equal(
      inFlight.continuation.reason,
      "formal_callback_publication_in_flight"
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));

    const recovered = await manager.resume("recover prepared callback plan");
    assert.equal(recovered.activities["plan-confirmation"]?.state, "SUCCEEDED");
    assert.equal(
      recovered.activities["case-generation-cases-registration-md"]?.state,
      "READY"
    );
    assert.ok((await manager.events()).some((event) =>
      event.type === "ArtifactDriftDetected"
      && event.payload.activityId === "plan-confirmation"
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lost staging before rename leaves the callback waiting and permits a rebuilt publication", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "lost-staged-plan-decision",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const planContent = await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    const lease = await manager.runtime.acquire(
      "plan-confirmation",
      "lost-plan-publisher"
    );
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    const callbackHash = createHash("sha256")
      .update("lost-staged-plan-decision")
      .digest("hex")
      .slice(0, 16);
    const planHash = createHash("sha256")
      .update(planContent)
      .digest("hex")
      .slice(0, 16);
    const prepared = await publisher.prepare({
      publishId: `callback-plan-${callbackHash}-${planHash}-g1`,
      activityId: "plan-confirmation",
      lease,
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: planContent
      }]
    });
    await manager.recordArtifactPublishPrepared(prepared.event);
    await rm(resolve(root, ".local/test-task-runtime"), {
      recursive: true,
      force: true
    });

    let recovered = await manager.resume("staging was deleted before rename");
    assert.equal(
      recovered.activities["plan-confirmation"]?.state,
      "WAITING_CALLBACK"
    );
    assert.equal(recovered.workflowState, "WAITING_HUMAN");

    recovered = await manager.publishPlanAndResolveCallback({
      activityId: "plan-confirmation",
      callbackId: "lost-staged-plan-decision",
      subjectDigest,
      resolution: "accepted",
      planContent,
      owner: "rebuilt-plan-publisher"
    });
    assert.equal(recovered.activities["plan-confirmation"]?.state, "SUCCEEDED");
    const publishIds = (await manager.events()).flatMap((event) =>
      event.type === "ArtifactPublishPrepared"
      && event.payload.activityId === "plan-confirmation"
      && typeof event.payload.publishId === "string"
        ? [event.payload.publishId]
        : []
    );
    assert.deepEqual(publishIds, [
      `callback-plan-${callbackHash}-${planHash}-g1`,
      `callback-plan-${callbackHash}-${planHash}-g2`
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired callback publisher fencing cannot resolve but history recovery can", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "expired-callback-publisher",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const planContent = await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    await manager.publishFormalDecisionPlan({
      activityId: "plan-confirmation",
      callbackId: "expired-callback-publisher",
      subjectDigest,
      resolution: "accepted",
      planContent,
      owner: "expiring-callback-publisher",
      leaseMs: 250
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));

    await assert.rejects(
      manager.resolveCallback({
        activityId: "plan-confirmation",
        callbackId: "expired-callback-publisher",
        subjectDigest,
        resolution: "accepted"
      }),
      WorkflowRuntimeLeaseError
    );
    const recovered = await manager.resume("recover expired callback publisher");
    assert.equal(recovered.activities["plan-confirmation"]?.state, "SUCCEEDED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing staged bytes with an unchanged final plan remains safely rebuildable", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "missing-staged-plan-bytes",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const planContent = await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    const lease = await manager.runtime.acquire(
      "plan-confirmation",
      "missing-staged-bytes",
      250
    );
    const publisher = new ArtifactPublisher(requestId, {
      workspaceRoot: root,
      runtimeStore: manager.runtime
    });
    const prepared = await publisher.prepare({
      publishId: "missing-staged-plan-bytes",
      activityId: "plan-confirmation",
      lease,
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: planContent
      }]
    });
    await manager.recordArtifactPublishPrepared(prepared.event);
    const manifest = JSON.parse(
      await readFile(prepared.manifestPath, "utf8")
    ) as { artifacts: Array<{ stagedPath: string }> };
    await rm(manifest.artifacts[0]!.stagedPath, { force: true });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));

    let recovered = await manager.resume("staged bytes were lost");
    assert.equal(
      recovered.activities["plan-confirmation"]?.state,
      "WAITING_CALLBACK"
    );
    recovered = await manager.publishPlanAndResolveCallback({
      activityId: "plan-confirmation",
      callbackId: "missing-staged-plan-bytes",
      subjectDigest,
      resolution: "accepted",
      planContent,
      owner: "rebuilt-after-staged-loss"
    });
    assert.equal(recovered.activities["plan-confirmation"]?.state, "SUCCEEDED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("callback plan publication cannot rewrite unrelated formal decisions", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await writeFile(
      manager.planPath,
      `${await readFile(manager.planPath, "utf8")}\n## 正式用户决定\n\n`
        + "| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |\n"
        + "| --- | --- | --- | --- | --- |\n"
        + `| 正式资产变更 | ${"9".repeat(64)} | rejected | preserve me | none |\n`,
      "utf8"
    );
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "preserve-formal-history",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const candidate = (await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    )).split("\n")
      .filter((line) => !line.startsWith("| 正式资产变更 |"))
      .join("\n");

    await assert.rejects(
      manager.publishPlanAndResolveCallback({
        activityId: "plan-confirmation",
        callbackId: "preserve-formal-history",
        subjectDigest,
        resolution: "accepted",
        planContent: candidate
      }),
      /preserve every existing formal decision row/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("callback plan publication preserves earlier decisions for the same subject", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    const original = await readFile(manager.planPath, "utf8");
    await writeFile(
      manager.planPath,
      `${original.trimEnd()}\n\n## 正式用户决定\n\n`
        + "| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |\n"
        + "| --- | --- | --- | --- | --- |\n"
        + `| 计划确认 | ${subjectDigest} | revision_requested | keep this audit row | revise |\n`,
      "utf8"
    );
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "preserve-same-subject-history",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const candidate = (await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    )).split("\n")
      .filter((line) => !line.includes("keep this audit row"))
      .join("\n");

    await assert.rejects(
      manager.publishPlanAndResolveCallback({
        activityId: "plan-confirmation",
        callbackId: "preserve-same-subject-history",
        subjectDigest,
        resolution: "accepted",
        planContent: candidate
      }),
      /preserve every existing formal decision row/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolved callback replay is exact, survives later decisions, and rejects different plan bytes", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    const callbackId = "exact-plan-replay";
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId,
      subjectDigest,
      kind: "plan_confirmation"
    });
    const planContent = await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    const resolved = await manager.publishPlanAndResolveCallback({
      activityId: "plan-confirmation",
      callbackId,
      subjectDigest,
      resolution: "accepted",
      planContent
    });
    const resolvedHead = resolved.head;
    const exactReplay = await manager.publishPlanAndResolveCallback({
      activityId: "plan-confirmation",
      callbackId,
      subjectDigest,
      resolution: "accepted",
      planContent
    });
    assert.deepEqual(exactReplay.head, resolvedHead);

    const planWithLaterDecision = await buildFormalDecisionPlan(
      manager,
      "case-confirmation",
      "a".repeat(64),
      "rejected"
    );
    await writeFile(manager.planPath, planWithLaterDecision, "utf8");
    const replayAfterLaterDecision = await manager.publishPlanAndResolveCallback({
      activityId: "plan-confirmation",
      callbackId,
      subjectDigest,
      resolution: "accepted",
      planContent
    });
    assert.deepEqual(replayAfterLaterDecision.head, resolvedHead);
    await assert.rejects(
      manager.publishPlanAndResolveCallback({
        activityId: "plan-confirmation",
        callbackId,
        subjectDigest,
        resolution: "accepted",
        planContent: `${planContent}\n<!-- different replay bytes -->\n`
      }),
      /replay planContent conflicts/
    );
    assert.deepEqual((await manager.gate()).head, resolvedHead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every formal callback resolution returns a cleaned durable checkpoint", async () => {
  for (const resolution of [
    "accepted",
    "rejected",
    "revision_requested",
    "cancelled"
  ] as const) {
    const root = await makeWorkspace();
    try {
      const manager = new DurableWorkflowManager(requestId, root);
      await manager.initialize();
      for (const activityId of ["source-selection", "plan-validation"]) {
        const claim = await manager.startActivity(activityId, "worker-a");
        await succeedManagerActivity(
          manager,
          activityId,
          claim.claimToken,
          `${activityId} verified`
        );
      }
      const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
      const callbackId = `checkpoint-${resolution}`;
      await manager.requestCallback({
        activityId: "plan-confirmation",
        callbackId,
        subjectDigest,
        kind: "plan_confirmation"
      });
      const planContent = await buildFormalDecisionPlan(
        manager,
        "plan-confirmation",
        subjectDigest,
        resolution
      );
      const result = await manager.publishPlanAndResolveCallback({
        activityId: "plan-confirmation",
        callbackId,
        subjectDigest,
        resolution,
        planContent
      });
      assert.equal(result.checkpoint.safe, true, resolution);
      assert.equal(
        isSafeWorkflowReply(result),
        resolution !== "accepted",
        resolution
      );
      assert.equal(
        Object.keys((await manager.runtime.read())?.stagingRefs ?? {}).length,
        0,
        resolution
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("formal callback publication detects a plan change between validation and prepare", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-baseline-race",
      subjectDigest,
      kind: "plan_confirmation"
    });
    const planContent = await buildFormalDecisionPlan(
      manager,
      "plan-confirmation",
      subjectDigest,
      "accepted"
    );
    const originalAcquire = manager.runtime.acquire.bind(manager.runtime);
    const concurrentPlan = `${await readFile(manager.planPath, "utf8")}\n<!-- concurrent edit -->\n`;
    manager.runtime.acquire = async (activityId, owner, leaseMs, now) => {
      const handle = await originalAcquire(activityId, owner, leaseMs, now);
      await writeFile(manager.planPath, concurrentPlan, "utf8");
      return handle;
    };

    await assert.rejects(
      manager.publishPlanAndResolveCallback({
        activityId: "plan-confirmation",
        callbackId: "plan-baseline-race",
        subjectDigest,
        resolution: "accepted",
        planContent
      }),
      /changed after callback decision validation/
    );
    assert.equal(await readFile(manager.planPath, "utf8"), concurrentPlan);
    assert.equal(
      (await manager.events()).some((event) =>
        event.type === "ArtifactPublishPrepared"
        && event.payload.activityId === "plan-confirmation"
      ),
      false
    );
    const gate = await manager.gate();
    assert.equal(gate.activities["plan-confirmation"]?.state, "WAITING_CALLBACK");
    assert.equal(gate.checkpoint.safe, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derived caseId backfill is ignored but later static plan changes still invalidate confirmation", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await writeFile(
      manager.planPath,
      planMarkdown().replace("| 注册 | 字段 |", "| 注册 \\| Web | 字段 |"),
      "utf8"
    );
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-with-derived-caseids",
      subjectDigest,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", subjectDigest, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-with-derived-caseids",
      subjectDigest,
      resolution: "accepted"
    });
    const generated = await manager.startActivity(
      "case-generation-cases-registration-md",
      "worker-a"
    );
    await succeedManagerActivity(
      manager,
      "case-generation-cases-registration-md",
      generated.claimToken,
      "cases generated"
    );

    await writeFile(
      manager.planPath,
      (await readFile(manager.planPath, "utf8")).replace(
        "DEMO-REG-001、DEMO-REG-002、DEMO-REG-003",
        "DEMO-REG-101、DEMO-REG-102、DEMO-REG-103"
      ),
      "utf8"
    );
    let gate = await manager.gate();
    assert.equal(gate.activities["plan-confirmation"]?.state, "SUCCEEDED");
    assert.notEqual(gate.continuation.reason, "callback_subject_drift");

    await writeFile(
      manager.planPath,
      (await readFile(manager.planPath, "utf8")).replace(
        "注册字段与正常提交。",
        "注册字段、异常校验与正常提交。"
      ),
      "utf8"
    );
    gate = await manager.gate();
    assert.equal(gate.reply.kind, "none");
    assert.equal(gate.continuation.kind, "continue_now");
    assert.equal(gate.continuation.reason, "callback_subject_drift");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a repository subject change while confirmation is waiting cannot be accepted", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const requestedDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation-waiting",
      subjectDigest: requestedDigest,
      kind: "plan_confirmation"
    });
    await writeFile(
      manager.planPath,
      planMarkdown().replace(
        "test（用户未指定环境",
        "pre（用户未指定环境"
      ),
      "utf8"
    );
    const headBefore = (await manager.gate()).head;

    await assert.rejects(
      manager.resolveCallback({
        activityId: "plan-confirmation",
        callbackId: "plan-confirmation-waiting",
        subjectDigest: requestedDigest,
        resolution: "accepted"
      }),
      /repository subject changed/
    );

    const after = await manager.gate();
    assert.deepEqual(after.head, headBefore);
    assert.equal(after.activities["plan-confirmation"]?.state, "WAITING_CALLBACK");
    assert.equal(
      after.activities["case-generation-cases-registration-md"]?.state,
      "PENDING"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume carries one legacy plan confirmation across evidence-backed testcase evolution", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize({ reviewerRoles: ["requirements"] });
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "legacy-carry-worker");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }

    const legacySubject = createHash("sha256")
      .update(planDecisionProjection(await readFile(manager.planPath, "utf8")))
      .digest("hex");
    await appendWorkflowEvent(manager, {
      type: "ActivityAttemptStarted",
      idempotencyKey: "legacy-plan-confirmation/start",
      payload: { activityId: "plan-confirmation", attempt: 1 }
    });
    await appendWorkflowEvent(manager, {
      type: "CallbackRequested",
      idempotencyKey: "legacy-plan-confirmation/requested",
      payload: {
        activityId: "plan-confirmation",
        callbackId: "legacy-plan-confirmation",
        subjectDigest: legacySubject,
        kind: "plan_confirmation"
      }
    });
    await recordFormalDecision(
      manager,
      "plan-confirmation",
      legacySubject,
      "accepted"
    );
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "legacy-plan-confirmation",
      subjectDigest: legacySubject,
      resolution: "accepted"
    });

    for (const activityId of [
      "case-generation-cases-registration-md",
      "relation-sync",
      "completeness-validation"
    ]) {
      const claim = await manager.startActivity(activityId, "legacy-carry-worker");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const batchId = "REV-LEGACY-CARRY";
    await manager.startReviewBatch({ batchId });
    await manager.dispatchReviewer({
      activityId: "case-review-requirements",
      batchId,
      role: "requirements",
      agentTaskId: `${batchId}-requirements`
    });
    await manager.submitReviewer({
      activityId: "case-review-requirements",
      batchId,
      role: "requirements",
      planEvidenceRef: manager.planPath,
      agentTaskId: `${batchId}-requirements`
    });
    const resolution = await manager.startActivity(
      "case-review-resolution",
      "legacy-carry-worker"
    );
    await manager.publishArtifactsAndSucceed("case-review-resolution", {
      claimToken: resolution.claimToken,
      publishId: "legacy-carry-review-resolution",
      verification: "review findings verified",
      outcome: "evolve",
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: await readFile(manager.planPath)
      }]
    });
    const evolution = await manager.startActivity(
      "case-review-evolution",
      "legacy-carry-worker"
    );
    const evolvedPlan = `${(await readFile(manager.planPath, "utf8")).trimEnd()}

## 需求依据更新

- reviewer 修正了需求定位、RULE 和原子 case 映射；顶层范围不变。
`;
    await manager.publishArtifactsAndSucceed("case-review-evolution", {
      claimToken: evolution.claimToken,
      publishId: "legacy-carry-automatic-evolution",
      verification: "derived testcase evolution verified",
      artifacts: [
        {
          targetPath: `testcases/${requestId}/plan.md`,
          content: evolvedPlan
        },
        {
          targetPath: `testcases/${requestId}/cases-registration.md`,
          content: `${(await readFile(
            resolve(manager.requestRoot, "cases-registration.md"),
            "utf8"
          )).trimEnd()}\n\n<!-- reviewer-derived atomic mapping update -->\n`
        }
      ]
    });

    const pendingSubject = createHash("sha256")
      .update(planDecisionProjection(evolvedPlan))
      .digest("hex");
    assert.notEqual(pendingSubject, legacySubject);
    await manager.invalidateActivities({
      activityIds: ["plan-confirmation"],
      reason: "legacy full-plan projection treated derived evolution as plan drift",
      subjectDigest: legacySubject
    });
    await appendWorkflowEvent(manager, {
      type: "ActivityAttemptStarted",
      idempotencyKey: "legacy-plan-confirmation/reopened/start",
      payload: { activityId: "plan-confirmation", attempt: 2 }
    });
    await appendWorkflowEvent(manager, {
      type: "CallbackRequested",
      idempotencyKey: "legacy-plan-confirmation/reopened/requested",
      payload: {
        activityId: "plan-confirmation",
        callbackId: "legacy-plan-confirmation-duplicate",
        subjectDigest: pendingSubject,
        kind: "plan_confirmation"
      }
    });

    const resumed = await manager.resume("recover legacy plan confirmation");
    assert.equal(resumed.activities["plan-confirmation"]?.state, "SUCCEEDED");
    assert.equal(
      resumed.activities["plan-confirmation"]?.callbackSubjectSchemaVersion,
      "plan-confirmation-subject-v2"
    );
    assert.equal(
      resumed.activities["plan-confirmation"]?.decisionOriginCallbackId,
      "legacy-plan-confirmation"
    );
    assert.equal(resumed.continuation.kind, "continue_now");
    const carried = (await manager.events()).filter((event) =>
      event.type === "PlanConfirmationCarriedForward"
    );
    assert.equal(carried.length, 1);
    assert.equal(
      carried[0]?.payload.supersededCallbackId,
      "legacy-plan-confirmation-duplicate"
    );
    const eventCount = (await manager.events()).length;
    await manager.resume("repeat legacy recovery");
    assert.equal((await manager.events()).length, eventCount);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a cancelled callback durably cancels the workflow instead of stranding a branch", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "cancel-plan",
      subjectDigest,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", subjectDigest, "cancelled");
    const cancelled = await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "cancel-plan",
      subjectDigest,
      resolution: "cancelled"
    });
    assert.equal(cancelled.workflowState, "CANCELLED");
    assert.equal(cancelled.reply.kind, "final");
    assert.equal(cancelled.continuation.kind, "stop");
    const runtime = await manager.runtime.read();
    assert.equal(Object.keys(runtime?.stagingRefs ?? {}).length, 0);
    assert.ok(runtime?.leases["plan-confirmation"]?.releasedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow cancellation is rejected while an activity remains in flight", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    await manager.startActivity("source-selection", "worker-a");
    const before = await manager.gate();
    assert.equal(before.checkpoint.safe, false);

    await assert.rejects(
      manager.cancel("cancel while worker is running"),
      /cancellation checkpoint is unsafe/
    );

    const after = await manager.gate();
    assert.deepEqual(after.head, before.head);
    assert.equal(after.activities["source-selection"]?.state, "RUNNING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("due retries stay dormant while the workflow is suspended or globally blocked", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const started = await manager.startActivity("source-selection", "worker-a");
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    await manager.failActivity("source-selection", {
      claimToken: started.claimToken,
      summary: "temporary source failure",
      retryable: true,
      retryAt
    });
    await manager.suspend("operator pause");
    let gate = await manager.gate(Date.parse(retryAt) + 1);
    assert.equal(gate.workflowState, "SUSPENDED");
    assert.equal(gate.activities["source-selection"]?.state, "RETRY_WAIT");
    assert.equal(gate.continuation.kind, "stop");

    await manager.resume("inspect blocked retry");
    await manager.raiseBlocker({
      blockerId: "GLOBAL-SOURCE-BLOCKER",
      category: "source",
      detail: "controlled source is unavailable",
      resolutionCondition: "source restored"
    });
    gate = await manager.gate(Date.parse(retryAt) + 1);
    assert.equal(gate.workflowState, "BLOCKED");
    assert.equal(gate.activities["source-selection"]?.state, "RETRY_WAIT");
    assert.equal(gate.reply.kind, "action_required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manager completeness gate rejects a labelled 2-of-13 package without advancing review", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    const ids = Array.from(
      { length: 13 },
      (_, index) => `DEMO-REG-${String(index + 1).padStart(3, "0")}`
    );
    const fixture = relationFixture(ids, 2);
    await writeFile(
      resolve(manager.requestRoot, "cases-registration.md"),
      fixture.cases,
      "utf8"
    );
    await writeFile(
      manager.planPath,
      fixture.plan.replaceAll("正常提交", "只读校验"),
      "utf8"
    );
    await manager.initialize({ reviewerRoles: ["requirements"] });
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "confirm-incomplete-plan",
      subjectDigest,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", subjectDigest, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "confirm-incomplete-plan",
      subjectDigest,
      resolution: "accepted"
    });
    for (const activityId of [
      "case-generation-cases-registration-md",
      "relation-sync"
    ]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const completeness = await manager.startActivity(
      "completeness-validation",
      "worker-a"
    );
    const headBefore = (await manager.gate()).head;

    await assert.rejects(
      succeedManagerActivity(
        manager,
        "completeness-validation",
        completeness.claimToken,
        "incorrect completeness claim"
      ),
      /Expected 13 testcase bodies but found 2/
    );

    const after = await manager.gate();
    assert.deepEqual(after.head, headBefore);
    assert.equal(after.activities["completeness-validation"]?.state, "RUNNING");
    assert.equal(after.activities["case-review-requirements"]?.state, "PENDING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review batch freezes every plan-referenced controlled source and refuses a missing source", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    const sourcePath = resolve(root, "sources/requirements/demo/registration.md");
    await mkdir(resolve(sourcePath, ".."), { recursive: true });
    await writeFile(sourcePath, "# Controlled registration requirement\n", "utf8");
    await writeFile(
      manager.planPath,
      `${await readFile(manager.planPath, "utf8")}\n受控资料：[注册需求](sources/requirements/demo/registration.md)\n`,
      "utf8"
    );
    await advanceToReviewReady(manager);
    await manager.startReviewBatch({ batchId: "REV-CONTROLLED-SOURCE" });
    const started = (await manager.events()).find((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === "REV-CONTROLLED-SOURCE"
    );
    const paths = Array.isArray(started?.payload.inputRefs)
      ? started.payload.inputRefs.map((value) => String((value as { path?: string }).path)).sort()
      : [];
    assert.deepEqual(paths, [
      `sources/requirements/demo/registration.md`,
      `testcases/${requestId}/cases-registration.md`,
      `testcases/${requestId}/plan.md`
    ]);

    const missingPlan = `${await readFile(manager.planPath, "utf8")}\n缺失资料：[不存在](sources/requirements/demo/missing.md)\n`;
    await writeFile(manager.planPath, missingPlan, "utf8");
    await assert.rejects(
      manager.startReviewBatch({ batchId: "REV-MISSING-CONTROLLED-SOURCE" }),
      /ENOENT|no such file/i
    );
    assert.equal(
      (await manager.events()).some((event) =>
        event.type === "ReviewBatchStarted" && event.payload.batchId === "REV-MISSING-CONTROLLED-SOURCE"
      ),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manager persists v2 risk with combined and strict-only impact scope v3", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    const caseIds = [
      ...Array.from({ length: 3 }, (_, index) =>
        `OPEN-LOGIN-20260803-${String(index + 1).padStart(3, "0")}`
      ),
      ...Array.from({ length: 26 }, (_, index) =>
        `OPEN-REG-20260803-${String(index + 1).padStart(3, "0")}`
      )
    ];
    const strictCaseIds = new Set([
      "OPEN-LOGIN-20260803-001",
      "OPEN-REG-20260803-007",
      "OPEN-REG-20260803-008",
      "OPEN-REG-20260803-009",
      "OPEN-REG-20260803-015",
      "OPEN-REG-20260803-016",
      "OPEN-REG-20260803-020",
      "OPEN-REG-20260803-021",
      "OPEN-REG-20260803-022",
      "OPEN-REG-20260803-024"
    ]);
    const lightCaseIds = new Set([
      "OPEN-REG-20260803-001",
      "OPEN-REG-20260803-003",
      "OPEN-REG-20260803-013",
      "OPEN-REG-20260803-014",
      "OPEN-REG-20260803-025"
    ]);
    const packages = {
      "cases-registration.md": mixedRiskCasesMarkdown(caseIds, strictCaseIds, lightCaseIds)
    };
    const projected = projectRelationProjection(planMarkdown(caseIds), packages);
    assert.deepEqual(projected.issues, []);
    await writeFile(
      manager.planPath,
      projected.plan.replace(
        "## 输入资料",
        "## 安全与数据边界\n\n- 风险标记：实际发送短信验证码。\n\n## 输入资料"
      ),
      "utf8"
    );
    await writeFile(
      resolve(manager.requestRoot, "cases-registration.md"),
      projected.packages["cases-registration.md"]!,
      "utf8"
    );

    await manager.initialize({
      writesData: true,
      capabilities: ["web"],
      casePackages: ["cases-registration.md"]
    });
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "mixed-risk-worker");
      await succeedManagerActivity(manager, activityId, claim.claimToken, `${activityId} verified`);
    }
    const subjectDigest = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "mixed-risk-plan-confirmation",
      subjectDigest,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", subjectDigest, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "mixed-risk-plan-confirmation",
      subjectDigest,
      resolution: "accepted"
    });
    for (const activityId of [
      "case-generation-cases-registration-md",
      "relation-sync",
      "completeness-validation"
    ]) {
      const claim = await manager.startActivity(activityId, "mixed-risk-worker");
      await succeedManagerActivity(manager, activityId, claim.claimToken, `${activityId} verified`);
    }

    await manager.startReviewBatch({ batchId: "REV-MIXED-RISK-V2" });
    const event = (await manager.events()).find((item) =>
      item.type === "ReviewBatchStarted" && item.payload.batchId === "REV-MIXED-RISK-V2"
    );
    const scope = parseReviewBatchScope(event?.payload.scope);
    assert.equal(scope.schemaVersion, "review-batch-scope-v3");
    if (scope.schemaVersion !== "review-batch-scope-v3") {
      throw new Error("Expected a review-batch-scope-v3 event.");
    }
    assert.equal(scope.riskSummary.distribution, "mixed");
    assert.equal(scope.riskSummary.maxLevel, "strict");
    assert.deepEqual(scope.riskSummary.counts, { light: 5, standard: 14, strict: 10 });
    assert.deepEqual(
      scope.roleScopes.find((item) => item.role === "impact")?.caseIds,
      [...strictCaseIds].sort()
    );
    assert.equal(
      scope.roleScopes.find((item) => item.role === "combined")?.caseIds.length,
      24
    );
    assert.deepEqual(event?.payload.roleInputDigests && Object.keys(event.payload.roleInputDigests).sort(), [
      "case-review-combined",
      "case-review-impact"
    ]);
    await manager.dispatchReviewer({
      activityId: "case-review-combined",
      batchId: "REV-MIXED-RISK-V2",
      role: "combined",
      agentTaskId: "REV-MIXED-RISK-V2-combined"
    });
    const dispatch = (await manager.events()).find((item) =>
      item.type === "ReviewerDispatched"
      && item.payload.batchId === "REV-MIXED-RISK-V2"
      && item.payload.activityId === "case-review-combined"
    );
    assert.equal(
      dispatch?.payload.inputDigest,
      (event?.payload.roleInputDigests as Record<string, string> | undefined)
        ?.["case-review-combined"]
    );
    await manager.submitReviewer({
      activityId: "case-review-combined",
      batchId: "REV-MIXED-RISK-V2",
      role: "combined",
      planEvidenceRef: manager.planPath,
      agentTaskId: "REV-MIXED-RISK-V2-combined"
    });
    await manager.dispatchReviewer({
      activityId: "case-review-impact",
      batchId: "REV-MIXED-RISK-V2",
      role: "impact",
      agentTaskId: "REV-MIXED-RISK-V2-impact"
    });
    await manager.submitReviewer({
      activityId: "case-review-impact",
      batchId: "REV-MIXED-RISK-V2",
      role: "impact",
      planEvidenceRef: manager.planPath,
      agentTaskId: "REV-MIXED-RISK-V2-impact"
    });
    const casePath = resolve(manager.requestRoot, "cases-registration.md");
    await writeFile(
      casePath,
      (await readFile(casePath, "utf8")).replace(
        "| 数据策略 | managed_cleanup |",
        "| 数据策略 | tracked_residual |"
      ),
      "utf8"
    );
    const invalidated = await manager.invalidateReviewBatch({
      batchId: "REV-MIXED-RISK-V2",
      activityIds: ["case-review-combined", "case-review-impact"],
      reason: "safety policy changed"
    });
    assert.equal(invalidated.activities["case-review-combined"]?.state, "SUCCEEDED");
    assert.equal(invalidated.activities["case-review-impact"]?.state, "READY");
    const invalidation = (await manager.events()).find((item) =>
      item.type === "ReviewBatchInvalidated"
      && item.payload.batchId === "REV-MIXED-RISK-V2"
    );
    assert.deepEqual(invalidation?.payload.activityIds, ["case-review-impact"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("light workflow reaches deterministic review resolution without reviewer events", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    const fixture = relationFixture(["DEMO-REG-001"], 1);
    await writeFile(manager.planPath, fixture.plan, "utf8");
    await writeFile(
      resolve(manager.requestRoot, "cases-registration.md"),
      fixture.cases,
      "utf8"
    );
    await manager.initialize();
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const planSubject = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation",
      subjectDigest: planSubject,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", planSubject, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation",
      subjectDigest: planSubject,
      resolution: "accepted"
    });
    for (const activityId of [
      "case-generation-cases-registration-md",
      "relation-sync",
      "completeness-validation"
    ]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const view = await manager.gate();
    assert.equal(
      Object.values(view.activities).filter((activity) => activity.definition.kind === "review").length,
      0
    );
    assert.equal(view.activities["case-review-resolution"]?.state, "READY");
    assert.equal((await manager.events()).some((event) => [
      "ReviewBatchStarted",
      "ReviewerDispatched",
      "ReviewerSubmitted"
    ].includes(event.type)), false);
    assert.equal(view.reply.kind, "none");
    assert.equal(view.continuation.kind, "continue_now");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewer submission requires a distinct running host binding and records only an isolation proof", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize({
      reviewerRoles: ["requirements"],
      sessionId: "primary-session",
      targetThreadId: "primary-thread"
    });
    await advanceToReviewReady(manager);
    const batchId = "REV-ISOLATION";
    const activityId = "case-review-requirements";
    await manager.startReviewBatch({ batchId });

    await assert.rejects(
      manager.dispatchReviewer({
        activityId,
        batchId,
        role: "requirements"
      } as Parameters<typeof manager.dispatchReviewer>[0]),
      /agentTaskId must be a non-empty/
    );
    for (const primaryId of ["primary-session", "primary-thread"]) {
      await assert.rejects(
        manager.dispatchReviewer({
          activityId,
          batchId,
          role: "requirements",
          agentTaskId: primaryId
        }),
        /must be isolated/
      );
    }
    assert.equal((await manager.events()).filter((event) =>
      event.type === "ReviewerDispatched"
    ).length, 0);

    await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "requirements",
      agentTaskId: "isolated-reviewer"
    });
    await assert.rejects(
      manager.submitReviewer({
        activityId,
        batchId,
        role: "requirements",
        planEvidenceRef: manager.planPath,
        agentTaskId: "different-reviewer"
      }),
      /does not match the isolated reviewer submission/
    );
    assert.equal((await manager.events()).filter((event) =>
      event.type === "ReviewerSubmitted"
    ).length, 0);

    await manager.submitReviewer({
      activityId,
      batchId,
      role: "requirements",
      planEvidenceRef: manager.planPath,
      agentTaskId: "isolated-reviewer"
    });
    const submission = (await manager.events()).find((event) =>
      event.type === "ReviewerSubmitted"
    );
    assert.equal(
      submission?.payload.isolationProofVersion,
      "reviewer-isolation-proof-v1"
    );
    assert.equal(submission?.payload.agentTaskId, undefined);
    assert.equal(JSON.stringify(submission).includes("isolated-reviewer"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume preserves a durably dispatched reviewer without duplicating its batch", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize({ reviewerRoles: ["requirements"] });
    for (const activityId of ["source-selection", "plan-validation"]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    const planSubject = await manager.callbackSubjectDigest("plan-confirmation");
    await manager.requestCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation",
      subjectDigest: planSubject,
      kind: "plan_confirmation"
    });
    await recordFormalDecision(manager, "plan-confirmation", planSubject, "accepted");
    await manager.resolveCallback({
      activityId: "plan-confirmation",
      callbackId: "plan-confirmation",
      subjectDigest: planSubject,
      resolution: "accepted"
    });
    for (const activityId of [
      "case-generation-cases-registration-md",
      "relation-sync",
      "completeness-validation"
    ]) {
      const claim = await manager.startActivity(activityId, "worker-a");
      await succeedManagerActivity(
        manager,
        activityId,
        claim.claimToken,
        `${activityId} verified`
      );
    }
    await manager.startReviewBatch({
      batchId: "REV-ORPHAN-1",
      inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-registration.md")]
    });
    await manager.dispatchReviewer({
      activityId: "case-review-requirements",
      batchId: "REV-ORPHAN-1",
      role: "requirements",
      agentTaskId: "original-reviewer-task"
    });
    await rm(resolve(root, ".local/test-task-runtime"), { recursive: true, force: true });

    const recoveredManager = new DurableWorkflowManager(requestId, root);
    const durableHead = (await recoveredManager.projection()).head;
    const recovered = await recoveredManager.resume("reviewer host was lost");
    assert.equal(recovered.activities["case-review-requirements"]?.state, "RUNNING");
    assert.equal(recovered.activities["case-review-requirements"]?.attempt, 1);
    assert.equal(recovered.continuation.reason, "reviewer_runtime_rebind_required");
    assert.ok(recovered.nextActions.includes(
      "reviewer-rebind:REV-ORPHAN-1:case-review-requirements:requirements"
    ));
    assert.deepEqual(recovered.head, durableHead);
    const rebound = await recoveredManager.dispatchReviewer({
      activityId: "case-review-requirements",
      batchId: "REV-ORPHAN-1",
      role: "requirements",
      agentTaskId: "replacement-reviewer-task"
    });
    assert.equal(rebound.runtimeBinding, "bound");
    assert.equal((await recoveredManager.events()).filter((event) =>
      event.type === "ReviewerDispatched"
      && event.payload.activityId === "case-review-requirements"
    ).length, 1);
    assert.ok((await recoveredManager.runtime.read())?.reviewerBindings[
      "REV-ORPHAN-1:case-review-requirements:requirements"
    ]);

    await writeFile(
      recoveredManager.planPath,
      `${await readFile(recoveredManager.planPath, "utf8")}\n<!-- review input changed -->\n`,
      "utf8"
    );
    const rejected = await recoveredManager.submitReviewer({
      activityId: "case-review-requirements",
      batchId: "REV-ORPHAN-1",
      role: "requirements",
      planEvidenceRef: recoveredManager.planPath,
      agentTaskId: "replacement-reviewer-task"
    });
    assert.equal(rejected.reviewBatch?.status, "new_batch_started");
    assert.equal(rejected.reviewBatch?.previousBatchId, "REV-ORPHAN-1");
    assert.match(rejected.reviewBatch?.batchId ?? "", /^REV-ORPHAN-1-r[a-f0-9]{12}$/);
    assert.equal(rejected.activities["case-review-requirements"]?.state, "READY");
    assert.equal((await recoveredManager.events()).filter((event) => event.type === "ReviewerSubmitted").length, 0);
    const rotatedEvents = await recoveredManager.events();
    const invalidation = rotatedEvents.find((event) =>
      event.type === "ReviewBatchInvalidated"
      && event.payload.batchId === "REV-ORPHAN-1"
    );
    assert.ok(invalidation);
    assert.equal(rotatedEvents.filter((event) =>
      event.type === "ReviewBatchInvalidated"
      && event.payload.batchId === "REV-ORPHAN-1"
    ).length, 1);
    const rotatedStart = rotatedEvents.find((event) =>
      event.type === "ReviewBatchStarted"
      && event.payload.batchId === rejected.reviewBatch?.batchId
    );
    assert.ok(rotatedStart);
    assert.equal(rotatedEvents.filter((event) =>
      event.type === "ReviewBatchStarted"
      && event.payload.batchId === rejected.reviewBatch?.batchId
    ).length, 1);
    assert.equal(invalidation?.payload.revisionDigest, rotatedStart?.payload.inputDigest);
    assert.equal(
      invalidation?.payload.findingsDigest,
      reviewFindingsDigest(rotatedEvents, "REV-ORPHAN-1")
    );
    assert.equal(
      (await recoveredManager.runtime.read())?.reviewerBindings[
        "REV-ORPHAN-1:case-review-requirements:requirements"
      ],
      undefined
    );
    const rotatedHead = (await recoveredManager.gate()).head;
    const repeated = await recoveredManager.submitReviewer({
      activityId: "case-review-requirements",
      batchId: "REV-ORPHAN-1",
      role: "requirements",
      planEvidenceRef: recoveredManager.planPath,
      agentTaskId: "replacement-reviewer-task"
    });
    assert.equal(repeated.reviewBatch?.batchId, rejected.reviewBatch?.batchId);
    assert.deepEqual((await recoveredManager.gate()).head, rotatedHead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable reviewer dispatch survives runtime binding failure and resume repairs without redispatch", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await advanceToReviewReady(manager);
    const batchId = "REV-RUNTIME-REPAIR";
    const activityId = "case-review-requirements";
    await manager.startReviewBatch({ batchId });

    const originalSetBinding = manager.runtime.setReviewerBinding.bind(manager.runtime);
    Object.defineProperty(manager.runtime, "setReviewerBinding", {
      configurable: true,
      value: async () => {
        throw new Error("simulated disposable runtime write failure");
      }
    });
    const dispatched = await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "requirements",
      agentTaskId: "reviewer-task-before-runtime-failure"
    });
    assert.equal(dispatched.runtimeBinding, "repair_pending");
    assert.equal((await manager.events()).filter((event) =>
      event.type === "ReviewerDispatched"
      && event.payload.activityId === activityId
    ).length, 1);

    Object.defineProperty(manager.runtime, "setReviewerBinding", {
      configurable: true,
      value: originalSetBinding
    });
    const headAfterDispatch = (await manager.projection()).head;
    const resumed = await manager.resume("repair reviewer runtime");
    assert.deepEqual(resumed.head, headAfterDispatch);
    assert.ok(resumed.nextActions.includes(
      `reviewer-rebind:${batchId}:${activityId}:requirements`
    ));

    const rebound = await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "requirements",
      agentTaskId: "reviewer-task-after-runtime-failure"
    });
    assert.equal(rebound.runtimeBinding, "bound");
    assert.equal((await manager.events()).filter((event) =>
      event.type === "ReviewerDispatched"
      && event.payload.activityId === activityId
    ).length, 1);

    await manager.submitReviewer({
      activityId,
      batchId,
      role: "requirements",
      planEvidenceRef: manager.planPath,
      agentTaskId: "reviewer-task-after-runtime-failure"
    });
    assert.ok((await manager.runtime.read())?.reviewerBindings[
      `${batchId}:${activityId}:requirements`
    ]);
    const submittedHead = (await manager.projection()).head;
    const cleaned = await manager.resume("clear submitted reviewer binding");
    assert.deepEqual(cleaned.head, submittedHead);
    assert.equal(
      (await manager.runtime.read())?.reviewerBindings[
        `${batchId}:${activityId}:requirements`
      ],
      undefined
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume rebuilds an unchanged reviewer snapshot and rotates a drifted one", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await advanceToReviewReady(manager);
    const batchId = "REV-RESUME-DRIFT";
    const activityId = "case-review-requirements";
    await manager.startReviewBatch({ batchId });
    await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "requirements",
      agentTaskId: "resume-drift-reviewer-task"
    });
    await rm(resolve(root, ".local/test-task-runtime"), {
      recursive: true,
      force: true
    });

    const recovered = new DurableWorkflowManager(requestId, root);
    const unchangedHead = (await recovered.projection()).head;
    const unchanged = await recovered.resume("rebuild unchanged reviewer snapshot");
    assert.deepEqual(unchanged.head, unchangedHead);
    assert.equal(unchanged.activities[activityId]?.state, "RUNNING");

    await writeFile(
      recovered.planPath,
      `${await readFile(recovered.planPath, "utf8")}\n<!-- reviewer-derived revision -->\n`,
      "utf8"
    );
    const rotated = await recovered.resume("rotate drifted reviewer input");
    assert.equal(rotated.activities[activityId]?.state, "READY");
    const events = await recovered.events();
    assert.equal(events.filter((event) =>
      event.type === "ReviewBatchInvalidated"
      && event.payload.batchId === batchId
    ).length, 1);
    assert.equal(events.filter((event) =>
      event.type === "ReviewBatchStarted"
      && typeof event.payload.batchId === "string"
      && event.payload.batchId.startsWith(`${batchId}-r`)
    ).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review input drift before the first dispatch rotates without invalidating unowned activities", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await advanceToReviewReady(manager);
    const batchId = "REV-PRE-DISPATCH-DRIFT";
    const activityId = "case-review-requirements";
    await manager.startReviewBatch({ batchId });

    await writeFile(
      manager.planPath,
      `${await readFile(manager.planPath, "utf8")}\n<!-- evolved before reviewer dispatch -->\n`,
      "utf8"
    );
    const rotated = await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "requirements",
      agentTaskId: "pre-dispatch-drift-reviewer"
    });

    assert.equal(rotated.reviewBatch?.status, "new_batch_started");
    assert.equal(rotated.reviewBatch?.previousBatchId, batchId);
    assert.match(rotated.reviewBatch?.batchId ?? "", /^REV-PRE-DISPATCH-DRIFT-r[a-f0-9]{12}$/);
    assert.equal(rotated.activities[activityId]?.state, "READY");
    const events = await manager.events();
    assert.equal(events.filter((event) =>
      event.type === "ReviewBatchInvalidated"
      && event.payload.batchId === batchId
    ).length, 0);
    assert.equal(events.filter((event) =>
      event.type === "ReviewerDispatched"
      && event.payload.batchId === batchId
    ).length, 0);

    const rebound = await manager.dispatchReviewer({
      activityId,
      batchId: rotated.reviewBatch!.batchId,
      role: "requirements",
      agentTaskId: "pre-dispatch-drift-reviewer"
    });
    assert.equal(rebound.runtimeBinding, "bound");
    assert.equal(rebound.activities[activityId]?.state, "RUNNING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconciliation closes a published artifact only after final readback matches", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize();
    const source = await manager.startActivity("source-selection", "publisher");
    await manager.succeedActivity("source-selection", {
      claimToken: source.claimToken,
      verification: "source selected"
    });
    await manager.startActivity("plan-validation", "publisher");
    const artifacts = [
      {
        path: `testcases/${requestId}/plan.md`,
        digest: createHash("sha256").update("published-plan").digest("hex")
      }
    ];
    await writeFile(resolve(root, artifacts[0]!.path), "published-plan", "utf8");
    await manager.recordArtifactPublishPrepared({
      type: "ArtifactPublishPrepared",
      idempotencyKey: "plan-validation/prepared-before-crash",
      payload: {
        activityId: "plan-validation",
        publishId: "plan-validation-crash",
        manifestDigest: createHash("sha256").update("manifest").digest("hex"),
        artifacts: artifacts.map((artifact) => ({
          targetPath: artifact.path,
          digest: artifact.digest,
          expectedPreviousDigest: null,
          sizeBytes: 1
        }))
      }
    });
    await manager.markArtifactDrift({
      activityId: "plan-validation",
      artifactPath: artifacts[0]!.path,
      detail: "worker ended after target replacement but before success event"
    });

    const beforePartial = await manager.history.head();
    await assert.rejects(
      manager.reconcileActivity(
        "plan-validation",
        "confirmed",
        "target digest conflicts",
        undefined,
        [artifacts[0]!.path],
        [{ path: artifacts[0]!.path, digest: "0".repeat(64) }]
      ),
      /Published output digest mismatch/
    );
    assert.deepEqual(await manager.history.head(), beforePartial);

    const reconciled = await manager.reconcileActivity(
      "plan-validation",
      "confirmed",
      "all final targets match the prepared manifest",
      undefined,
      artifacts.map((artifact) => artifact.path),
      artifacts
    );
    assert.equal(reconciled.activities["plan-validation"]?.state, "SUCCEEDED");
    assert.equal(reconciled.continuation.kind, "continue_now");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired fencing token is rejected while claimless reconciliation can recover the orphan", async () => {
  const root = await makeWorkspace();
  try {
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize({
      capabilities: ["web"],
      writesData: false,
      casePackages: ["cases-registration.md"]
    });
    const started = await manager.startActivity(
      "source-selection",
      "expiring-worker",
      60_000
    );
    await manager.startExternalOperation({
      activityId: "source-selection",
      operationId: "OP-STALE-FENCE",
      operationKind: "read_probe",
      inputDigest: "a".repeat(64),
      claimToken: started.claimToken
    });
    const runtime = await manager.runtime.read();
    assert.ok(runtime);
    await manager.runtime.compareAndSwap(runtime.revision, (draft) => {
      draft.leases["source-selection"].expiresAt = new Date(Date.now() - 1).toISOString();
    });
    const before = await manager.history.head();
    await assert.rejects(
      manager.reconcileExternalOperation({
        activityId: "source-selection",
        operationId: "OP-STALE-FENCE",
        outcome: "confirmed",
        evidenceDigest: "b".repeat(64),
        claimToken: started.claimToken
      }),
      /expired|current claim token/
    );
    assert.deepEqual(await manager.history.head(), before);
    assert.ok(
      (await manager.projection()).activities["source-selection"]
        ?.unresolvedExternalOperationIds.includes("OP-STALE-FENCE")
    );
    const orphaned = await manager.resume("expired external worker");
    assert.equal(orphaned.activities["source-selection"]?.state, "RECONCILING");
    const reconciledOperation = await manager.reconcileExternalOperation({
      activityId: "source-selection",
      operationId: "OP-STALE-FENCE",
      outcome: "confirmed",
      evidenceDigest: "c".repeat(64)
    });
    assert.deepEqual(
      reconciledOperation.activities["source-selection"]?.unresolvedExternalOperationIds,
      []
    );
    assert.equal(
      (await manager.runtime.read())?.inFlightOperations["OP-STALE-FENCE"],
      undefined
    );
    const retried = await manager.reconcileActivity(
      "source-selection",
      "retry",
      "confirmed external operation; repeat only the local verification",
      new Date(Date.now() - 1).toISOString()
    );
    assert.equal(retried.activities["source-selection"]?.state, "READY");
    assert.equal(retried.activities["source-selection"]?.retryAt, undefined);
    assert.equal(
      retried.waits.some((wait) =>
        wait.kind === "retry" && wait.activityId === "source-selection"
      ),
      false
    );
    const replacement = await manager.startActivity("source-selection", "replacement-worker");
    assert.ok(replacement.fencingToken > started.fencingToken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
