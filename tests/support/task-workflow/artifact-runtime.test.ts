import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ArtifactPublisher,
  ArtifactReconciliationRequiredError,
  ArtifactValidationError,
  type ArtifactPublishManifest
} from "../../../src/support/task-workflow/artifactPublisher.ts";
import {
  evaluateTestcasePackage
} from "../../../src/support/task-workflow/packageCompleteness.ts";
import {
  RuntimeLeaseStore,
  WorkflowRuntimeConflictError,
  WorkflowRuntimeLeaseError
} from "../../../src/support/task-workflow/runtimeLeaseStore.ts";
import { WorkflowHistoryStore } from "../../../src/support/task-workflow/historyStore.ts";

test("runtime uses one disposable request snapshot with CAS and fencing", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "workflow-runtime-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const runtimeRoot = resolve(workspace, ".local/test-task-runtime");
  const store = new RuntimeLeaseStore("web/demo/request-1", runtimeRoot);

  const initialized = await store.initialize();
  assert.equal(initialized.schemaVersion, "test-workflow-runtime-v2");
  assert.equal(store.runtimePath, resolve(runtimeRoot, "web/demo/request-1/runtime.json"));
  const bound = await store.bindSession("session-local", "thread-local");
  assert.equal(bound.sessionBinding?.sessionId, "session-local");
  assert.equal(bound.sessionBinding?.targetThreadId, "thread-local");

  await assert.rejects(
    () => store.compareAndSwap(0, () => undefined),
    WorkflowRuntimeConflictError
  );
  const lease1 = await store.acquire("ACT-01", "worker-a");
  await store.release(lease1);
  const lease2 = await store.acquire("ACT-01", "worker-b");
  assert.equal(lease2.fencingToken, lease1.fencingToken + 1);
  await assert.rejects(() => store.assertCanCommit(lease1), WorkflowRuntimeLeaseError);
  await store.assertCanCommit(lease2);

  await rm(store.requestRoot, { recursive: true, force: true });
  const afterDeletion = await store.acquire("ACT-01", "worker-c");
  assert.equal(afterDeletion.fencingToken, 1);
  assert.notEqual(afterDeletion.leaseId, lease1.leaseId);
  await assert.rejects(() => store.assertCanCommit(lease1), WorkflowRuntimeLeaseError);
});

test("legacy v1 runtime is ignored and recreated as disposable v2 coordination state", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "workflow-runtime-v1-rebuild-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new RuntimeLeaseStore(
    "web/demo/runtime-rebuild",
    resolve(workspace, ".local/test-task-runtime")
  );
  await mkdir(store.requestRoot, { recursive: true });
  await writeFile(store.runtimePath, JSON.stringify({
    schemaVersion: "test-workflow-runtime-v1",
    requestId: "web/demo/runtime-rebuild",
    revision: 99,
    reviewerBindings: {},
    leases: {},
    inFlightOperations: {},
    stagingRefs: {}
  }), "utf8");

  assert.equal(await store.read(), null);
  const rebuilt = await store.initialize();
  assert.equal(rebuilt.schemaVersion, "test-workflow-runtime-v2");
  assert.equal(rebuilt.revision, 0);
  assert.equal(JSON.parse(await readFile(store.runtimePath, "utf8")).schemaVersion, "test-workflow-runtime-v2");
});

test("rebuilding a deleted v1 runtime does not alter durable workflow history", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "workflow-runtime-history-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const requestId = "web/demo/runtime-history";
  const history = new WorkflowHistoryStore(
    resolve(workspace, "testcases/web/demo/runtime-history/workflow-history.ndjson"),
    resolve(workspace, ".local/workflow-history-locks")
  );
  await history.append({
    runId: "runtime-history-run",
    requestId,
    definitionId: "durable-test-workflow",
    definitionVersion: "v5",
    type: "WorkflowStarted",
    actorType: "system",
    idempotencyKey: "start",
    payload: {}
  });
  const before = await history.read();
  const runtime = new RuntimeLeaseStore(requestId, resolve(workspace, ".local/test-task-runtime"));
  await mkdir(runtime.requestRoot, { recursive: true });
  await writeFile(runtime.runtimePath, JSON.stringify({
    schemaVersion: "test-workflow-runtime-v1",
    requestId,
    revision: 2,
    reviewerBindings: {},
    leases: {},
    inFlightOperations: {},
    stagingRefs: {}
  }), "utf8");

  await rm(runtime.requestRoot, { recursive: true, force: true });
  await runtime.initialize();
  assert.deepEqual(await history.read(), before);
});

test("an expired runtime mutex owned by a live PID is never recovered", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "workflow-runtime-live-lock-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new RuntimeLeaseStore(
    "web/demo/live-lock",
    resolve(workspace, ".local/test-task-runtime")
  );
  await mkdir(store.requestRoot, { recursive: true });
  await writeFile(store.lockPath, JSON.stringify({
    owner: `${process.pid}:still-running`,
    expiresAt: Date.now() - 60_000
  }), "utf8");
  const old = new Date(Date.now() - 60_000);
  await utimes(store.lockPath, old, old);

  await assert.rejects(() => store.initialize(), WorkflowRuntimeConflictError);
  assert.match(await readFile(store.lockPath, "utf8"), /still-running/);
  assert.equal(await store.read(), null);

  await rm(store.lockPath);
  assert.equal((await store.initialize()).revision, 0);
});

test("expired lease with unresolved work requires explicit complete reconciliation", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "workflow-reconcile-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const store = new RuntimeLeaseStore(
    "api/demo/request-2",
    resolve(workspace, ".local/test-task-runtime")
  );
  const start = Date.now() - 10_000;
  const lease = await store.acquire("ACT-EXT", "worker-a", 100, start);
  await store.addInFlightOperation(
    {
      operationId: "OP-1",
      activityId: "ACT-EXT",
      kind: "business_operation",
      idempotencyKey: "stable-operation-key"
    },
    lease,
    start + 1
  );
  await store.addStagingRef(
    {
      publishId: "PUB-1",
      activityId: "ACT-EXT",
      manifestPath: resolve(workspace, "manifest.json"),
      manifestDigest: sha256("manifest")
    },
    lease,
    start + 2
  );

  await assert.rejects(
    () => store.acquire("ACT-EXT", "worker-b", 1_000, Date.now()),
    /reconcile it before takeover/
  );
  await assert.rejects(
    () => store.reconcileExpiredActivity({
      activityId: "ACT-EXT",
      operationIds: ["OP-1"],
      stagingPublishIds: [],
      resolution: "manual_recovery",
      evidenceDigest: sha256("recovery evidence")
    }),
    /account for every unresolved/
  );

  await store.reconcileExpiredActivity({
    activityId: "ACT-EXT",
    operationIds: ["OP-1"],
    stagingPublishIds: ["PUB-1"],
    resolution: "confirmed_complete",
    evidenceDigest: sha256("verified postcondition")
  });
  const replacement = await store.acquire("ACT-EXT", "worker-b");
  assert.equal(replacement.fencingToken, lease.fencingToken + 1);
  await assert.rejects(() => store.assertCanCommit(lease), WorkflowRuntimeLeaseError);
});

test("artifact publication records prepared intent before atomic target renames", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "artifact-publish-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const runtimeRoot = resolve(workspace, ".local/test-task-runtime");
  const runtime = new RuntimeLeaseStore("web/demo/request-3", runtimeRoot);
  const lease = await runtime.acquire("ACT-PUBLISH", "worker-a");
  const publisher = new ArtifactPublisher("web/demo/request-3", {
    workspaceRoot: workspace,
    runtimeStore: runtime
  });
  const targets = ["testcases/demo/plan.md", "testcases/demo/cases.md"];
  let preparedRecorded = false;

  const result = await publisher.publish(
    {
      publishId: "PUB-ATOMIC",
      activityId: "ACT-PUBLISH",
      lease,
      artifacts: [
        { targetPath: targets[0]!, content: "# Plan\n" },
        { targetPath: targets[1]!, content: "# Cases\n" }
      ],
      validators: [
        ({ content }) => Buffer.from(content).toString("utf8").startsWith("#")
          ? []
          : ["Markdown heading is required."]
      ]
    },
    async (event) => {
      assert.equal(event.type, "ArtifactPublishPrepared");
      assert.equal(event.payload.artifacts.length, 2);
      assert.equal(event.payload.artifacts[0]?.targetPath, targets[0]);
      assert.equal(event.payload.artifacts.some((item) => "stagedPath" in item), false);
      await assert.rejects(() => readFile(resolve(workspace, targets[0]!), "utf8"));
      preparedRecorded = true;
    }
  );

  assert.equal(preparedRecorded, true);
  assert.equal(result.state, "PUBLISHED");
  assert.equal(await readFile(resolve(workspace, targets[0]!), "utf8"), "# Plan\n");
  assert.equal((await publisher.recover("PUB-ATOMIC")).state, "PUBLISHED");
  assert.ok((await runtime.read())?.stagingRefs["PUB-ATOMIC"]);
  await publisher.cleanup("PUB-ATOMIC", lease);
  assert.equal((await runtime.read())?.stagingRefs["PUB-ATOMIC"], undefined);
  await runtime.release(lease);
});

test("artifact validation fails before prepared callback or target publication", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "artifact-validation-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const runtime = new RuntimeLeaseStore(
    "web/demo/request-4",
    resolve(workspace, ".local/test-task-runtime")
  );
  const lease = await runtime.acquire("ACT-PUBLISH", "worker-a");
  const publisher = new ArtifactPublisher("web/demo/request-4", {
    workspaceRoot: workspace,
    runtimeStore: runtime
  });
  let callbackCalled = false;

  await assert.rejects(
    () => publisher.publish(
      {
        publishId: "PUB-INVALID",
        activityId: "ACT-PUBLISH",
        lease,
        artifacts: [{ targetPath: "testcases/demo/empty.md", content: "" }]
      },
      () => {
        callbackCalled = true;
      }
    ),
    ArtifactValidationError
  );
  assert.equal(callbackCalled, false);
  await assert.rejects(() => readFile(resolve(workspace, "testcases/demo/empty.md")));
});

test("artifact publication atomically replaces an unchanged prepared target", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "artifact-update-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const targetPath = resolve(workspace, "testcases/demo/plan.md");
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, "old plan\n", "utf8");
  const runtime = new RuntimeLeaseStore(
    "web/demo/request-update",
    resolve(workspace, ".local/test-task-runtime")
  );
  const lease = await runtime.acquire("ACT-PUBLISH", "worker-a");
  const publisher = new ArtifactPublisher("web/demo/request-update", {
    workspaceRoot: workspace,
    runtimeStore: runtime
  });
  const prepared = await publisher.prepare({
    publishId: "PUB-UPDATE",
    activityId: "ACT-PUBLISH",
    lease,
    artifacts: [{ targetPath: "testcases/demo/plan.md", content: "new plan\n" }]
  });

  const ready = await publisher.recover("PUB-UPDATE");
  assert.equal(ready.state, "READY_TO_PUBLISH");
  assert.deepEqual(ready.pendingTargets, ["testcases/demo/plan.md"]);
  assert.equal(await readFile(targetPath, "utf8"), "old plan\n");
  const result = await publisher.commit(prepared, lease);
  assert.equal(result.state, "PUBLISHED");
  assert.equal(await readFile(targetPath, "utf8"), "new plan\n");
});

test("an expired publication mutex owned by a live PID remains busy until released", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "artifact-live-lock-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const runtime = new RuntimeLeaseStore(
    "web/demo/request-live-lock",
    resolve(workspace, ".local/test-task-runtime")
  );
  const lease = await runtime.acquire("ACT-PUBLISH", "worker-a");
  const publisher = new ArtifactPublisher("web/demo/request-live-lock", {
    workspaceRoot: workspace,
    runtimeStore: runtime
  });
  const prepared = await publisher.prepare({
    publishId: "PUB-LIVE-LOCK",
    activityId: "ACT-PUBLISH",
    lease,
    artifacts: [{ targetPath: "testcases/demo/locked.md", content: "new\n" }]
  });
  await mkdir(dirname(publisher.publicationLockPath), { recursive: true });
  await writeFile(publisher.publicationLockPath, JSON.stringify({
    owner: `${process.pid}:still-running`,
    expiresAt: Date.now() - 60_000
  }), "utf8");
  const old = new Date(Date.now() - 60_000);
  await utimes(publisher.publicationLockPath, old, old);

  let settled = false;
  const commit = publisher.commit(prepared, lease).finally(() => {
    settled = true;
  });
  await delay(100);
  assert.equal(settled, false);
  await assert.rejects(
    () => readFile(resolve(workspace, "testcases/demo/locked.md"), "utf8")
  );
  assert.match(await readFile(publisher.publicationLockPath, "utf8"), /still-running/);

  await rm(publisher.publicationLockPath);
  assert.equal((await commit).state, "PUBLISHED");
  assert.equal(await readFile(resolve(workspace, "testcases/demo/locked.md"), "utf8"), "new\n");
});

test("partial or conflicting artifact publication is RECONCILING", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "artifact-recovery-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const runtime = new RuntimeLeaseStore(
    "web/demo/request-5",
    resolve(workspace, ".local/test-task-runtime")
  );
  const lease = await runtime.acquire("ACT-PUBLISH", "worker-a");
  const publisher = new ArtifactPublisher("web/demo/request-5", {
    workspaceRoot: workspace,
    runtimeStore: runtime
  });
  const prepared = await publisher.prepare({
    publishId: "PUB-PARTIAL",
    activityId: "ACT-PUBLISH",
    lease,
    artifacts: [
      { targetPath: "testcases/demo/a.md", content: "A\n" },
      { targetPath: "testcases/demo/b.md", content: "B\n" }
    ]
  });
  const manifest = JSON.parse(
    await readFile(prepared.manifestPath, "utf8")
  ) as ArtifactPublishManifest;
  const firstTarget = resolve(workspace, manifest.artifacts[0]!.targetPath);
  await mkdir(dirname(firstTarget), { recursive: true });
  await rename(manifest.artifacts[0]!.stagedPath, firstTarget);

  const partial = await publisher.recover("PUB-PARTIAL");
  assert.equal(partial.state, "RECONCILING");
  assert.deepEqual(partial.matchedTargets, ["testcases/demo/a.md"]);
  assert.deepEqual(partial.missingTargets, ["testcases/demo/b.md"]);
  await assert.rejects(
    () => publisher.commit(prepared, lease),
    ArtifactReconciliationRequiredError
  );

  const secondTarget = resolve(workspace, manifest.artifacts[1]!.targetPath);
  await mkdir(dirname(secondTarget), { recursive: true });
  await writeFile(secondTarget, "conflict\n", "utf8");
  const conflict = await publisher.recover("PUB-PARTIAL");
  assert.equal(conflict.state, "RECONCILING");
  assert.deepEqual(conflict.conflictingTargets, ["testcases/demo/b.md"]);
});

test("a crash after replacing only one existing target is RECONCILING", async (context) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "artifact-update-crash-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const targetA = resolve(workspace, "testcases/demo/a.md");
  const targetB = resolve(workspace, "testcases/demo/b.md");
  await mkdir(dirname(targetA), { recursive: true });
  await writeFile(targetA, "old-a\n", "utf8");
  await writeFile(targetB, "old-b\n", "utf8");
  const runtime = new RuntimeLeaseStore(
    "web/demo/request-update-crash",
    resolve(workspace, ".local/test-task-runtime")
  );
  const lease = await runtime.acquire("ACT-PUBLISH", "worker-a");
  const publisher = new ArtifactPublisher("web/demo/request-update-crash", {
    workspaceRoot: workspace,
    runtimeStore: runtime
  });
  const prepared = await publisher.prepare({
    publishId: "PUB-UPDATE-CRASH",
    activityId: "ACT-PUBLISH",
    lease,
    artifacts: [
      { targetPath: "testcases/demo/a.md", content: "new-a\n" },
      { targetPath: "testcases/demo/b.md", content: "new-b\n" }
    ]
  });
  const manifest = JSON.parse(
    await readFile(prepared.manifestPath, "utf8")
  ) as ArtifactPublishManifest;
  await rename(manifest.artifacts[0]!.stagedPath, targetA);

  const recovery = await publisher.recover("PUB-UPDATE-CRASH");
  assert.equal(recovery.state, "RECONCILING");
  assert.deepEqual(recovery.matchedTargets, ["testcases/demo/a.md"]);
  assert.deepEqual(recovery.pendingTargets, ["testcases/demo/b.md"]);
  assert.equal(await readFile(targetB, "utf8"), "old-b\n");
  await assert.rejects(
    () => publisher.commit(prepared, lease),
    ArtifactReconciliationRequiredError
  );
});

test("package completeness ignores labels and rejects 2 of 13 testcase bodies", () => {
  const expectedIds = Array.from(
    { length: 13 },
    (_, index) => `OP-REG-${String(index + 1).padStart(3, "0")}`
  );
  const completeness = evaluateTestcasePackage([
    validCase(expectedIds[0]!),
    validCase(expectedIds[1]!)
  ], { expectedCount: 13, expectedCaseIds: expectedIds });
  assert.equal(completeness.complete, false);
  assert.equal(completeness.expectedCount, 13);
  assert.equal(completeness.actualBodyCount, 2);
  assert.equal(completeness.uniqueCaseIdCount, 2);
  assert.equal(completeness.missingCaseIds.length, 11);
  assert.match(completeness.reasons.join(" "), /Expected 13 testcase bodies but found 2/);
});

test("package completeness requires unique caseIds and every required section", () => {
  const invalid = evaluateTestcasePackage([
    validCase("CASE-001"),
    validCase("CASE-001").replace("| — | 1 | 打开页面 | 无 | 页面可见 |", "")
  ], { expectedCount: 2, expectedCaseIds: ["CASE-001", "CASE-002"] });
  assert.equal(invalid.complete, false);
  assert.deepEqual(invalid.duplicateCaseIds, ["CASE-001"]);
  assert.deepEqual(invalid.missingCaseIds, ["CASE-002"]);
  assert.equal(invalid.casesWithMissingSections.length, 1);

  const complete = evaluateTestcasePackage(
    [validCase("CASE-001"), validCase("CASE-002")],
    { expectedCount: 2, expectedCaseIds: ["CASE-001", "CASE-002"] }
  );
  assert.equal(complete.complete, true);
  assert.equal(complete.reasons.length, 0);
});

function validCase(caseId: string): string {
  return `> 结构版本：testcase-v6-layered。

# 用例集：${caseId}

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 0 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 页面 | ${caseId} | 验证页面 | P1 | 低 |

## 模块：页面

<details open>
<summary>${caseId}｜验证页面｜P1｜低风险</summary>

> 规则：RULE-DEMO-001
> 前置条件：页面可访问

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 打开页面 | 无 | 页面可见 |

</details>`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
