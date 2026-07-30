import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  EXECUTION_AUTHORIZATION_ARTIFACT,
  assertCurrentAuthorizedScripts,
  buildExecutionAuthorizationManifest,
  loadConfirmedExecutionAuthorization
} from "../../../src/support/formal-execution/authorization.js";
import { ArtifactPublisher } from "../../../src/support/task-workflow/artifactPublisher.js";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";
import { projectRelationProjection } from "../../../src/support/testcase/relationProjection.js";
import { recordFormalDecision } from "../task-workflow/formalDecisionFixture.js";

const requestId = "web/project/authorization";
const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const managePath = resolve(repositoryRoot, "src/support/task-workflow/cli/manage.ts");
const tsxLoader = pathToFileURL(
  resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs")
).href;
const caseId = "AUTH-CASE-001";

function relationFixture(): { plan: string; cases: string } {
  const plan = [
    "# Authorization plan",
    "",
    "结构版本：case-relation-projection-v1",
    "结构版本：rule-design-matrix-v1",
    "",
    "## 基本信息",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    "| 状态 | 已确认 |",
    "",
    "## 测试范围",
    "",
    "### 包含",
    "",
    "- query only",
    "",
    "## 用例包目录",
    "",
    "| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 特殊门禁 |",
    "| --- | --- | --- | --- | --- |",
    "| `cases-core.md` | query | query | 手工值 | 无 |",
    "",
    "## 覆盖矩阵",
    "",
    "| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |",
    "| --- | --- | --- | --- | --- |",
    "| 业务功能与规则 | requirement | query | 已覆盖 | 手工值 |",
    "",
    "## 需求追溯矩阵",
    "",
    "| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| REQ-AUTH-001 | Authorization PRD | P0 | query response | 适用 | query | 手工值 | 已覆盖 | no_write |",
    "",
    "## 规则覆盖台账",
    "",
    "| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| RULE-AUTH-001 | REQ-AUTH-001 | Authorization PRD | 业务规则 | query request | visible query response | scenario | 适用 | 已覆盖 | ${caseId} | no_write |`,
    "",
    "## 规则设计矩阵",
    "",
    "| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| RULE-AUTH-001 | query | 必填 | valid query request | visible query response | isolated read data | no_write | ${caseId} | 已覆盖 |`,
    ""
  ].join("\n");
  const cases = `# Core cases

## 用例目录

| 用例编号 | 标题 |
| --- | --- |
| ${caseId} | query |

## 测试用例：query
## 基本信息
| 用例编号 | ${caseId} |
## 来源
- requirement
## 前置条件
- ready
## 操作步骤
- query
## 预期结果
- visible
## 覆盖关联
- RULE-AUTH-001
## 合理推断
- none
## 待补充信息
- none
## 评审与演进回链
- pending
`;
  const projected = projectRelationProjection(plan, { "cases-core.md": cases });
  assert.deepEqual(projected.issues, []);
  return { plan: projected.plan, cases: projected.packages["cases-core.md"]! };
}

async function createVNextHarness(options: { publishAuthorization?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-authorization-"));
  const requestRoot = resolve(root, "testcases/web/project/authorization");
  const planPath = resolve(requestRoot, "plan.md");
  const scriptPath = resolve(root, "tests/web/project/authorization/example.formal.spec.ts");
  const casePackagePath = resolve(requestRoot, "cases-core.md");
  await mkdir(dirname(scriptPath), { recursive: true });
  await mkdir(requestRoot, { recursive: true });
  const fixture = relationFixture();
  await writeFile(planPath, fixture.plan, "utf8");
  await writeFile(scriptPath, "export const formal = true;\n", "utf8");
  await writeFile(casePackagePath, fixture.cases, "utf8");
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    writesData: false,
    casePackages: ["cases-core.md"],
    reviewerRoles: ["requirements"]
  });
  await succeed(manager, "source-selection");
  await succeed(manager, "plan-validation");
  await acceptCallback(manager, "plan-confirmation", "a".repeat(64), "plan-confirmation");
  await succeed(manager, "case-generation-cases-core-md");
  await succeed(manager, "relation-sync");
  await succeed(manager, "completeness-validation");
  const initialReviewIds = Object.values((await manager.gate()).activities)
    .filter((activity) => activity.definition.kind === "review")
    .map((activity) => activity.id);
  for (const activityId of initialReviewIds) await succeed(manager, activityId);
  await succeed(manager, "case-review-resolution", "converged");
  await acceptCallback(manager, "case-confirmation", "b".repeat(64), "case-confirmation");
  await succeed(manager, "engineering-web");
  await succeed(manager, "script-generation");

  const manifest = buildExecutionAuthorizationManifest({
    requestId,
    environment: "test",
    scriptPaths: ["tests/web/project/authorization/example.formal.spec.ts"],
    caseIds: [caseId],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [{ resourceType: "query", maxCreates: 0 }],
    dataWritePolicy: "no_write",
    workspaceRoot: root,
    createdAt: "2026-07-28T00:00:00.000Z"
  });
  if (options.publishAuthorization !== false) {
    const scriptReview = await manager.startActivity("script-review", "authorization-test");
    const publisher = new ArtifactPublisher(manager.requestId, {
      workspaceRoot: manager.workspaceRoot,
      runtimeStore: manager.runtime
    });
    const publication = await publisher.publish({
      publishId: `fixture-script-review-${manifest.digest.slice(0, 12)}`,
      activityId: "script-review",
      lease: {
        requestId: manager.requestId,
        activityId: "script-review",
        owner: "authorization-test",
        leaseId: scriptReview.claimToken,
        fencingToken: scriptReview.fencingToken,
        expiresAt: scriptReview.leaseExpiresAt
      },
      artifacts: [{
        targetPath: `testcases/${requestId}/${EXECUTION_AUTHORIZATION_ARTIFACT}`,
        content: `${JSON.stringify(manifest, null, 2)}\n`
      }]
    }, (event) => manager.recordArtifactPublishPrepared(event));
    await manager.succeedActivity("script-review", {
      claimToken: scriptReview.claimToken,
      verification: "scripts and immutable execution manifest reviewed",
      outputRefs: publication.artifacts.map((artifact) => artifact.targetPath),
      outputDigests: publication.artifacts.map((artifact) => ({
        path: artifact.targetPath,
        digest: artifact.digest
      }))
    });
  }
  return { root, requestRoot, planPath, scriptPath, casePackagePath, manager, manifest };
}

async function succeed(
  manager: DurableWorkflowManager,
  activityId: string,
  outcome?: string
): Promise<void> {
  const before = await manager.gate();
  const activity = before.activities[activityId];
  if (!activity) throw new Error(`Missing fixture activity ${activityId}.`);
  if (activity.definition.kind === "review") {
    const role = String(activity.definition.metadata?.role ?? activityId);
    const batchId = `TEST-${activity.definition.phase}`;
    if (!(await manager.events()).some((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === batchId
    )) {
      await manager.startReviewBatch({
        batchId,
        inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-core.md")]
      });
    }
    await manager.dispatchReviewer({
      activityId,
      batchId,
      role
    });
    await manager.submitReviewer({
      activityId,
      batchId,
      role,
      planEvidenceRef: manager.planPath
    });
    return;
  }
  const owner = "authorization-test";
  const started = await manager.startActivity(activityId, owner);
  if (activity.definition.publishesArtifacts) {
    const publisher = new ArtifactPublisher(manager.requestId, {
      workspaceRoot: manager.workspaceRoot,
      runtimeStore: manager.runtime
    });
    const publishId = `fixture-${activityId}-attempt-${activity.attempt + 1}`;
    const planArtifactPath = `testcases/${manager.requestId}/plan.md`;
    const caseArtifactPath = `testcases/${manager.requestId}/cases-core.md`;
    const artifactPaths = activityId === "relation-sync"
      ? [planArtifactPath, caseArtifactPath]
      : activity.definition.kind === "case_generation"
        ? [caseArtifactPath]
        : [planArtifactPath];
    const result = await publisher.publish({
      publishId,
      activityId,
      lease: {
        requestId: manager.requestId,
        activityId,
        owner,
        leaseId: started.claimToken,
        fencingToken: started.fencingToken,
        expiresAt: started.leaseExpiresAt
      },
      artifacts: await Promise.all(artifactPaths.map(async (path) => ({
        targetPath: path,
        content: await readFile(resolve(manager.workspaceRoot, path))
      })))
    }, (event) => manager.recordArtifactPublishPrepared(event));
    await manager.succeedActivity(activityId, {
      claimToken: started.claimToken,
      verification: "contract verified",
      outcome,
      outputRefs: result.artifacts.map((artifact) => artifact.targetPath),
      outputDigests: result.artifacts.map((artifact) => ({
        path: artifact.targetPath,
        digest: artifact.digest
      }))
    });
    return;
  }
  await manager.succeedActivity(activityId, {
    claimToken: started.claimToken,
    verification: "contract verified",
    outcome
  });
}

async function acceptCallback(
  manager: DurableWorkflowManager,
  activityId: string,
  subjectDigest: string,
  callbackId: string
): Promise<void> {
  const currentSubject = activityId === "plan-confirmation" || activityId === "case-confirmation"
    ? await manager.callbackSubjectDigest(activityId)
    : subjectDigest;
  await manager.requestCallback({
    activityId,
    subjectDigest: currentSubject,
    callbackId,
    kind: "test-confirmation"
  });
  await recordFormalDecision(manager, activityId, currentSubject, "accepted");
  await manager.resolveCallback({
    activityId,
    subjectDigest: currentSubject,
    callbackId,
    resolution: "accepted"
  });
}

test("public CLI atomically publishes the execution manifest from script-review", async (context) => {
  const harness = await createVNextHarness({ publishAuthorization: false });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  const started = await harness.manager.startActivity("script-review", "cli-publisher");
  const attemptEvent = [...await harness.manager.events()].reverse().find((event) =>
    event.type === "ActivityAttemptStarted"
    && event.payload.activityId === "script-review"
  );
  assert.ok(attemptEvent);

  await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "execution-authorization-publish",
    "--request",
    requestId,
    "--claim",
    started.claimToken,
    "--environment",
    "test",
    "--script",
    "tests/web/project/authorization/example.formal.spec.ts",
    "--case-id",
    caseId,
    "--operation",
    "query_postcondition",
    "--budget",
    "query:0",
    "--data-write-policy",
    "no_write",
    "--verified",
    "script review passed"
  ], { cwd: harness.root });

  const published = JSON.parse(
    await readFile(
      resolve(harness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT),
      "utf8"
    )
  ) as { createdAt: string; digest: string };
  assert.equal(published.createdAt, attemptEvent.occurredAt);
  assert.equal(
    (await harness.manager.gate()).activities["script-review"]?.state,
    "SUCCEEDED"
  );
  assert.equal(
    await harness.manager.callbackSubjectDigest("execution-authorization"),
    published.digest
  );
});

test("v4 formal authorization is derived from the accepted manifest-digest callback", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );

  const snapshot = await loadConfirmedExecutionAuthorization(
    requestId,
    "test",
    ["query_postcondition"],
    harness.root
  );
  assert.equal(snapshot.schemaVersion, "execution-authorization-v2");
  assert.equal(snapshot.status, "confirmed");
  assert.equal(snapshot.digest, harness.manifest.digest);
  assert.equal(snapshot.confirmationId, harness.manifest.callbackId);
  const gate = await harness.manager.gate();
  assert.equal(gate.activities["plan-confirmation"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["case-confirmation"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["execution-authorization"]?.state, "SUCCEEDED");
  const head = gate.head;
  const duplicate = await harness.manager.resolveCallback({
    activityId: "execution-authorization",
    callbackId: harness.manifest.callbackId,
    subjectDigest: harness.manifest.digest,
    resolution: "accepted"
  });
  assert.deepEqual(duplicate.head, head);
});

test("rejected or revision-requested authorization is never accepted", async (context) => {
  for (const resolution of ["rejected", "revision_requested"] as const) {
    const harness = await createVNextHarness();
    context.after(() => rm(harness.root, { recursive: true, force: true }));
    await harness.manager.requestCallback({
      activityId: "execution-authorization",
      subjectDigest: harness.manifest.digest,
      callbackId: harness.manifest.callbackId,
      kind: "execution-authorization"
    });
    await recordFormalDecision(
      harness.manager,
      "execution-authorization",
      harness.manifest.digest,
      resolution
    );
    await harness.manager.resolveCallback({
      activityId: "execution-authorization",
      subjectDigest: harness.manifest.digest,
      callbackId: harness.manifest.callbackId,
      resolution
    });
    const runtime = await harness.manager.runtime.read();
    assert.equal(
      Object.values(runtime?.stagingRefs ?? {})
        .filter((staging) => staging.activityId === "execution-authorization")
        .length,
      0
    );
    assert.ok(runtime?.leases["execution-authorization"]?.releasedAt);
    await assert.rejects(
      loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
      /accepted execution-authorization callback/
    );
  }
});

test("subject or manifest digest drift cannot reuse an old accepted callback", async (context) => {
  const subjectHarness = await createVNextHarness();
  context.after(() => rm(subjectHarness.root, { recursive: true, force: true }));
  await assert.rejects(
    subjectHarness.manager.requestCallback({
      activityId: "execution-authorization",
      subjectDigest: "f".repeat(64),
      callbackId: subjectHarness.manifest.callbackId,
      kind: "execution-authorization"
    }),
    /subject digest does not match current repository evidence/
  );

  const driftHarness = await createVNextHarness();
  context.after(() => rm(driftHarness.root, { recursive: true, force: true }));
  await acceptCallback(
    driftHarness.manager,
    "execution-authorization",
    driftHarness.manifest.digest,
    driftHarness.manifest.callbackId
  );
  const drifted = { ...driftHarness.manifest, caseIds: [caseId, "AUTH-CASE-002"] };
  await writeFile(
    resolve(driftHarness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT),
    `${JSON.stringify(drifted)}\n`,
    "utf8"
  );
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], driftHarness.root),
    /digest does not match/
  );
  const driftGate = await driftHarness.manager.gate();
  assert.equal(driftGate.reply.kind, "none");
  assert.equal(driftGate.continuation.kind, "continue_now");
  assert.equal(driftGate.continuation.reason, "callback_subject_drift");
  const reopened = await driftHarness.manager.resume("manifest subject changed");
  assert.equal(reopened.activities["execution-authorization"]?.state, "READY");
});

test("execution callback rejects a self-consistent manifest not owned by latest script-review publication", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  const replaced = {
    ...harness.manifest,
    callbackId: "execution-authorization-replaced"
  };
  await writeFile(
    resolve(harness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT),
    `${JSON.stringify(replaced, null, 2)}\n`,
    "utf8"
  );
  await assert.rejects(
    harness.manager.requestCallback({
      activityId: "execution-authorization",
      subjectDigest: replaced.digest,
      callbackId: replaced.callbackId,
      kind: "execution-authorization"
    }),
    /latest script-review publication digest/
  );
});

test("explicit scope reopen invalidates the previously accepted authorization", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root);
  await harness.manager.invalidateActivities({
    activityIds: ["execution-authorization"],
    reason: "formal scope changed",
    subjectDigest: harness.manifest.digest
  });
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /accepted execution-authorization callback/
  );
});

test("execution scope reopen restarts engineering while preserving confirmed cases", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );

  const reopened = await harness.manager.reopenExecutionScope(
    "reviewed script or immutable scope changed"
  );
  assert.equal(reopened.activities["case-confirmation"]?.state, "SUCCEEDED");
  assert.equal(reopened.activities["engineering-web"]?.state, "READY");
  assert.equal(reopened.activities["script-generation"]?.state, "PENDING");
  assert.equal(reopened.activities["script-review"]?.state, "PENDING");
  assert.equal(reopened.activities["execution-authorization"]?.state, "PENDING");
});

test("formal plan or script drift invalidates authorization", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const originalPlan = await readFile(harness.planPath, "utf8");
  await writeFile(
    harness.planPath,
    (await readFile(harness.planPath, "utf8")).replace("- query only", "- expanded formal scope"),
    "utf8"
  );
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /plan\.md changed/
  );
  let gate = await harness.manager.gate();
  assert.equal(gate.reply.kind, "none");
  assert.equal(gate.continuation.reason, "callback_subject_drift");

  await writeFile(harness.planPath, originalPlan, "utf8");
  await writeFile(harness.scriptPath, "export const formal = false;\n", "utf8");
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /Script changed/
  );
  gate = await harness.manager.gate();
  assert.equal(gate.continuation.referenceId, "execution-authorization");
});

test("removing accepted plan or case decisions invalidates the matching callback only", async (context) => {
  for (const [activityId, decisionType] of [
    ["plan-confirmation", "计划确认"],
    ["case-confirmation", "用例确认"]
  ] as const) {
    const harness = await createVNextHarness();
    context.after(() => rm(harness.root, { recursive: true, force: true }));
    const plan = await readFile(harness.planPath, "utf8");
    await writeFile(
      harness.planPath,
      plan.split("\n")
        .filter((line) => !line.startsWith(`| ${decisionType} |`))
        .join("\n"),
      "utf8"
    );
    const gate = await harness.manager.gate();
    assert.equal(gate.reply.kind, "none");
    assert.equal(gate.continuation.kind, "continue_now");
    assert.equal(gate.continuation.referenceId, activityId);
    assert.equal(gate.activities[activityId]?.state, "BLOCKED");
  }
});

test("formal decision rows are outside plan scope but remain mandatory for execution", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );

  const confirmed = await loadConfirmedExecutionAuthorization(
    requestId,
    "test",
    [],
    harness.root
  );
  assert.equal(confirmed.digest, harness.manifest.digest);

  const plan = await readFile(harness.planPath, "utf8");
  await writeFile(
    harness.planPath,
    plan.replace(
      /^\| 执行清单确认 \| .+ \| accepted \| test fixture \| continue \|\n/m,
      ""
    ),
    "utf8"
  );
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /accepted execution-authorization callback/
  );
});

test("Runner-discovered formal scripts must all be authorized and current", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const snapshot = await loadConfirmedExecutionAuthorization(
    requestId,
    "test",
    [],
    harness.root
  );
  assert.doesNotThrow(() =>
    assertCurrentAuthorizedScripts(snapshot, [harness.scriptPath], harness.root)
  );

  const extraPath = resolve(
    harness.root,
    "tests/web/project/authorization/unreviewed.formal.spec.ts"
  );
  await writeFile(extraPath, "export const unreviewed = true;\n", "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts(snapshot, [harness.scriptPath, extraPath], harness.root),
    /outside the confirmed authorization/
  );

  await writeFile(harness.scriptPath, "export const formal = false;\n", "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts(snapshot, [harness.scriptPath], harness.root),
    /Script changed/
  );
});
