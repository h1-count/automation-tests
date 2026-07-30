import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  DurableWorkflowManager,
  buildWorkflowDefinition,
  reviewBatchCoveredActivityIds,
  reviewFindingsDigest
} from "../../../src/support/task-workflow/index.js";
import { projectRelationProjection } from "../../../src/support/testcase/relationProjection.js";
import { recordFormalDecision } from "./formalDecisionFixture.js";

const requestId = "web/demo/repeatable-review";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-repeatable-review-"));
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-main.md");
  await writeFile(
    planPath,
    [
      "# Repeatable review",
      "",
      "结构版本：case-relation-projection-v1",
      "结构版本：rule-design-matrix-v1",
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
      "",
      "## 输入资料",
      "",
      "- manifest `demo-product-requirement`；sectionId `registration`。",
      "",
      "## 覆盖基准与拆分清单",
      "",
      "- 注册主路径。",
      "",
      "## 需求追溯矩阵",
      "",
      "| 需求追溯编号 | 派生 caseId |",
      "| --- | --- |",
      "| REQ-DEMO-001 | DEMO-001 |",
      "",
      "## 规则覆盖台账",
      "",
      "| RULE | REQ | 来源 | 类型 | 输入 | 预期 | 技术 | 适用性 | 结论 | caseId |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| RULE-DEMO-001 | REQ-DEMO-001 | source | 业务规则 | valid | visible result | 场景法 | 适用 | 已覆盖 | DEMO-001 |",
      "",
      "## 规则设计矩阵",
      "",
      "| RULE | 字段或状态 | 必填性 | 输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| RULE-DEMO-001 | demo | 必填 | valid | visible result | isolated | no_write | DEMO-001 | 已覆盖 |",
      "",
      "## 多角色评审记录",
      "",
      "- 尚未评审。",
      "",
      "## 用例集评审与演进",
      "",
      "- 尚未演进。",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(casesPath, [
    "# Cases",
    "",
    "## 用例目录",
    "",
    "| 用例编号 | 标题 |",
    "|---|---|",
    "| `DEMO-001` | 正常路径 |",
    "",
    "## 测试用例：正常路径",
    "",
    "## 基本信息",
    "",
    "| 用例编号 | DEMO-001 |",
    "|---|---|",
    "",
    "## 来源",
    "",
    `manifest \`demo-product-requirement\`；sectionId \`registration\`；SHA-256 \`${"a".repeat(64)}\``,
    "",
    "## 前置条件",
    "",
    "precondition",
    "",
    "## 操作步骤",
    "",
    "step",
    "",
    "## 预期结果",
    "",
    "expected",
    "",
    "## 覆盖关联",
    "",
    "relation",
    "",
    "## 合理推断",
    "",
    "none",
    "",
    "## 待补充信息",
    "",
    "none",
    "",
    "## 评审与演进回链",
    "",
    "review",
    ""
  ].join("\n"), "utf8");
  const projected = projectRelationProjection(
    await readFile(planPath, "utf8"),
    { "cases-main.md": await readFile(casesPath, "utf8") }
  );
  assert.deepEqual(projected.issues, []);
  await writeFile(planPath, projected.plan, "utf8");
  await writeFile(casesPath, projected.packages["cases-main.md"]!, "utf8");
  return root;
}

async function succeedActivity(
  manager: DurableWorkflowManager,
  activityId: string,
  outcome?: string
): Promise<void> {
  const started = await manager.startActivity(activityId, `worker-${activityId}`);
  const activity = started.projection.activities[activityId]!;
  const defaultPath = `testcases/${requestId}/${activityId}.md`;
  const outputs = !activity.definition.publishesArtifacts
    ? []
    : activity.definition.kind === "case_generation"
      ? [`testcases/${requestId}/cases-main.md`]
      : activity.definition.kind === "relation_sync"
          || activity.definition.kind === "automatic_evolution"
        ? [`testcases/${requestId}/plan.md`, `testcases/${requestId}/cases-main.md`]
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
    await writeFile(
      resolve(manager.workspaceRoot, defaultPath),
      `# ${activityId}\n`,
      "utf8"
    );
  }
  const evidence = await Promise.all(outputs.map(async (path) => ({
    path,
    digest: sha256(await readFile(resolve(manager.workspaceRoot, path)))
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
      claimToken: started.claimToken,
      publishId: `${activityId}-publish-${activity.attempt}`,
      verification: "verified",
      outcome,
      artifacts: await Promise.all(outputs.map(async (path) => ({
        targetPath: path,
        content: await readFile(resolve(manager.workspaceRoot, path))
      })))
    });
    return;
  }
  if (activity.definition.publishesArtifacts) {
    await manager.recordArtifactPublishPrepared({
      type: "ArtifactPublishPrepared",
      idempotencyKey: `${activityId}/prepared/${activity.attempt}`,
      payload: {
        activityId,
        publishId: `${activityId}-publish-${activity.attempt}`,
        manifestDigest: sha256(`${activityId}:manifest:${activity.attempt}`),
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
    claimToken: started.claimToken,
    verification: "verified",
    outcome,
    ...(activity.definition.publishesArtifacts
      ? { outputRefs: evidence.map((item) => item.path), outputDigests: evidence }
      : {})
  });
}

async function advanceToReview(manager: DurableWorkflowManager): Promise<void> {
  await succeedActivity(manager, "source-selection");
  await succeedActivity(manager, "plan-validation");
  const planDigest = await manager.callbackSubjectDigest("plan-confirmation");
  await manager.requestCallback({
    activityId: "plan-confirmation",
    callbackId: "confirm-plan",
    subjectDigest: planDigest,
    kind: "plan_confirmation"
  });
  await recordFormalDecision(manager, "plan-confirmation", planDigest, "accepted");
  await manager.resolveCallback({
    activityId: "plan-confirmation",
    callbackId: "confirm-plan",
    subjectDigest: planDigest,
    resolution: "accepted"
  });
  await succeedActivity(manager, "case-generation-cases-main-md");
  await succeedActivity(manager, "relation-sync");
  await succeedActivity(manager, "completeness-validation");
}

async function completeReviewBatch(
  manager: DurableWorkflowManager,
  batchId: string
): Promise<string[]> {
  await manager.startReviewBatch({
    batchId,
    inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-main.md")]
  });
  const reviewIds = Object.values((await manager.gate()).activities)
    .filter((activity) => activity.definition.kind === "review")
    .map((activity) => activity.id);
  for (const activityId of reviewIds) {
    const role = String((await manager.gate()).activities[activityId]!.definition.metadata?.role);
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
  }
  return reviewIds;
}

async function evolveAndInvalidate(
  manager: DurableWorkflowManager,
  batchId: string,
  revisionDigest: string,
  findingsDigest: string
): Promise<void> {
  await succeedActivity(manager, "case-review-resolution", "evolve");
  let view = await manager.gate();
  assert.equal(view.activities["case-confirmation"]?.state, "CANCELLED");
  assert.equal(view.activities["engineering-web"]?.state, "PENDING");
  await succeedActivity(manager, "case-review-evolution");
  const reviewIds = Object.values((await manager.gate()).activities)
    .filter((activity) => activity.definition.kind === "review")
    .map((activity) => activity.id);
  view = await manager.invalidateReviewBatch({
    batchId,
    activityIds: reviewIds,
    revisionDigest,
    findingsDigest,
    reason: "evidence-backed evolution"
  });
  assert.ok(reviewIds.every((activityId) => view.activities[activityId]?.state === "READY"));
  assert.ok(reviewIds.every((activityId) => view.activities[activityId]?.attempt === 0));
  assert.notEqual(view.activities["engineering-web"]?.state, "READY");
}

test("four progressing revisions can repeat the full case-review before latest convergence", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["interaction"]
  });
  await advanceToReview(manager);

  for (let cycle = 1; cycle <= 4; cycle += 1) {
    const batchId = `REV-${cycle}`;
    await completeReviewBatch(manager, batchId);
    await evolveAndInvalidate(
      manager,
      batchId,
      sha256(`revision:${cycle}`),
      sha256(`findings:${cycle}`)
    );
  }

  await completeReviewBatch(manager, "REV-CONVERGED");
  await succeedActivity(manager, "case-review-resolution", "converged");
  let view = await manager.gate();
  assert.equal(view.activities["case-confirmation"]?.state, "READY");
  assert.equal(view.activities["engineering-web"]?.state, "PENDING");
  const caseSubjectDigest = await manager.callbackSubjectDigest("case-confirmation");
  await manager.requestCallback({
    activityId: "case-confirmation",
    callbackId: "confirm-cases",
    subjectDigest: caseSubjectDigest,
    kind: "case_confirmation"
  });
  await recordFormalDecision(manager, "case-confirmation", caseSubjectDigest, "accepted");
  view = await manager.resolveCallback({
    activityId: "case-confirmation",
    callbackId: "confirm-cases",
    subjectDigest: caseSubjectDigest,
    resolution: "accepted"
  });
  assert.equal(view.activities["engineering-web"]?.state, "READY");
});

test("automatic evolution preserves plan confirmation unless the user-owned plan boundary changes", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements"]
  });
  await advanceToReview(manager);
  await completeReviewBatch(manager, "REV-PLAN-DRIFT");
  await succeedActivity(manager, "case-review-resolution", "evolve");
  await succeedActivity(manager, "case-review-evolution");

  const evolvedPlan = `${await readFile(manager.planPath, "utf8")}
## 需求追溯矩阵

| REQ | 可验证业务规则 | 派生 caseId |
| --- | --- | --- |
| REQ-DEMO-001 | 资料驱动的字段规则已修订 | DEMO-002 |

## 规则覆盖台账

| RULE | 关联 caseId | 可观察预期 |
| --- | --- | --- |
| RULE-DEMO-001 | DEMO-002 | 修订后的资料定义结果 |
`;
  await writeFile(
    manager.planPath,
    evolvedPlan.replace("- 尚未评审。", "- reviewer 已登记自动演进结论。"),
    "utf8"
  );
  await writeFile(
    resolve(manager.requestRoot, "cases-main.md"),
    `${await readFile(resolve(manager.requestRoot, "cases-main.md"), "utf8")}
<!-- caseId and assertion evolved: DEMO-002 -->
`,
    "utf8"
  );
  let view = await manager.gate();
  assert.equal(view.activities["plan-confirmation"]?.state, "SUCCEEDED");
  assert.notEqual(view.continuation.reason, "callback_subject_drift");

  const stablePlan = await readFile(manager.planPath, "utf8");
  const materialChanges = [
    {
      name: "top-level business scope",
      plan: stablePlan.replace("- 注册。", "- 注册。\n- 登录。")
    },
    {
      name: "target environment",
      plan: stablePlan.replace("| 目标环境 | test |", "| 目标环境 | pre |")
    },
    {
      name: "data write category",
      plan: `${stablePlan}
## 测试数据策略与残留台账

| 数据策略 | 允许环境 | 资源类型 | 最大数量 |
| --- | --- | --- | --- |
| managed_cleanup | test | 企业申请 | 1 |
`
    },
    {
      name: "permission ceiling",
      plan: `${stablePlan}
## 风险与审核事项

- 允许执行设备控制。
`
    }
  ];
  for (const change of materialChanges) {
    await writeFile(manager.planPath, change.plan, "utf8");
    view = await manager.gate();
    assert.equal(
      view.activities["plan-confirmation"]?.state,
      "BLOCKED",
      change.name
    );
    assert.equal(view.continuation.reason, "callback_subject_drift", change.name);
    assert.equal(view.reply.kind, "none", change.name);
    await writeFile(manager.planPath, stablePlan, "utf8");
    assert.equal(
      (await manager.gate()).activities["plan-confirmation"]?.state,
      "SUCCEEDED",
      `${change.name} restore`
    );
  }
});

test("review resolution rejects scope, rule, and testcase changes before publication", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements"]
  });
  await advanceToReview(manager);
  await completeReviewBatch(manager, "REV-OWNERSHIP");
  const started = await manager.startActivity(
    "case-review-resolution",
    "review-resolution-owner"
  );
  const currentPlan = await readFile(manager.planPath, "utf8");
  const currentCases = await readFile(
    resolve(manager.requestRoot, "cases-main.md"),
    "utf8"
  );

  const rejectedPublications = [
    {
      publishId: "review-resolution-scope-smuggle",
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: currentPlan.replace("- 注册。", "- 注册。\n- 登录。")
      }],
      error: /may change only the multi-role review and testcase review\/evolution sections/
    },
    {
      publishId: "review-resolution-rule-smuggle",
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: `${currentPlan}
## 规则覆盖台账

| RULE | 关联 caseId |
| --- | --- |
| RULE-DEMO-001 | DEMO-002 |
`
      }],
      error: /may change only the multi-role review and testcase review\/evolution sections/
    },
    {
      publishId: "review-resolution-case-smuggle",
      artifacts: [
        {
          targetPath: `testcases/${requestId}/plan.md`,
          content: currentPlan
        },
        {
          targetPath: `testcases/${requestId}/cases-main.md`,
          content: `${currentCases}\n<!-- unauthorized testcase change -->\n`
        }
      ],
      error: /must publish exactly its owned artifacts/
    }
  ];
  for (const attempt of rejectedPublications) {
    await assert.rejects(
      manager.publishArtifactsAndSucceed("case-review-resolution", {
        claimToken: started.claimToken,
        publishId: attempt.publishId,
        verification: "review findings verified",
        outcome: "evolve",
        artifacts: attempt.artifacts
      }),
      attempt.error
    );
    assert.equal(await readFile(manager.planPath, "utf8"), currentPlan);
    assert.equal(
      await readFile(resolve(manager.requestRoot, "cases-main.md"), "utf8"),
      currentCases
    );
    assert.equal(
      (await manager.events()).some((event) =>
        event.type === "ArtifactPublishPrepared"
        && event.payload.publishId === attempt.publishId
      ),
      false
    );
    assert.equal(
      (await manager.gate()).activities["case-review-resolution"]?.state,
      "RUNNING"
    );
  }

  const acceptedPlan = currentPlan
    .replace("- 尚未评审。", "- reviewer 结论与发现项已登记。")
    .replace("- 尚未演进。", "- 结论为需演进，等待 automatic evolution。");
  const completed = await manager.publishArtifactsAndSucceed(
    "case-review-resolution",
    {
      claimToken: started.claimToken,
      publishId: "review-resolution-owned-sections",
      verification: "review findings verified",
      outcome: "evolve",
      artifacts: [{
        targetPath: `testcases/${requestId}/plan.md`,
        content: acceptedPlan
      }]
    }
  );
  assert.equal(
    completed.activities["case-review-resolution"]?.state,
    "SUCCEEDED"
  );
  assert.equal(await readFile(manager.planPath, "utf8"), acceptedPlan);
});

test("two consecutive unchanged revisions block on the third identical signature", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases-main.md"] });
  await advanceToReview(manager);
  const revisionDigest = sha256("unchanged-revision");
  const findingsDigest = sha256("unchanged-findings");

  await completeReviewBatch(manager, "REV-SAME-1");
  await evolveAndInvalidate(manager, "REV-SAME-1", revisionDigest, findingsDigest);
  assert.notEqual((await manager.gate()).workflowState, "BLOCKED");

  await completeReviewBatch(manager, "REV-SAME-2");
  await evolveAndInvalidate(manager, "REV-SAME-2", revisionDigest, findingsDigest);
  assert.notEqual((await manager.gate()).workflowState, "BLOCKED");

  await completeReviewBatch(manager, "REV-SAME-3");
  await succeedActivity(manager, "case-review-resolution", "evolve");
  await succeedActivity(manager, "case-review-evolution");
  const reviewIds = Object.values((await manager.gate()).activities)
    .filter((activity) => activity.definition.kind === "review")
    .map((activity) => activity.id);
  const blocked = await manager.invalidateReviewBatch({
    batchId: "REV-SAME-3",
    activityIds: reviewIds,
    revisionDigest,
    findingsDigest,
    reason: "no observable draft progress"
  });
  assert.equal(blocked.workflowState, "BLOCKED");
  assert.equal(blocked.reply.kind, "action_required");
  assert.ok(reviewIds.every((activityId) => blocked.activities[activityId]?.state === "BLOCKED"));
});

test("human conflict cannot bypass evolution, re-review, and case confirmation", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases-main.md"] });
  await advanceToReview(manager);
  await completeReviewBatch(manager, "REV-CONFLICT");
  await succeedActivity(manager, "case-review-resolution", "human_conflict");
  let view = await manager.gate();
  assert.equal(view.activities["case-review-conflict-decision"]?.state, "READY");
  assert.equal(view.activities["case-review-evolution"]?.state, "PENDING");
  assert.equal(view.activities["case-confirmation"]?.state, "CANCELLED");
  assert.equal(view.activities["engineering-web"]?.state, "PENDING");

  const conflictDigest = await manager.callbackSubjectDigest(
    "case-review-conflict-decision"
  );
  await manager.requestCallback({
    activityId: "case-review-conflict-decision",
    callbackId: "resolve-conflict",
    subjectDigest: conflictDigest,
    kind: "business_conflict"
  });
  await recordFormalDecision(
    manager,
    "case-review-conflict-decision",
    conflictDigest,
    "accepted"
  );
  view = await manager.resolveCallback({
    activityId: "case-review-conflict-decision",
    callbackId: "resolve-conflict",
    subjectDigest: conflictDigest,
    resolution: "accepted"
  });
  assert.equal(view.activities["case-review-evolution"]?.state, "READY");
  assert.equal(view.activities["engineering-web"]?.state, "PENDING");

  await succeedActivity(manager, "case-review-evolution");
  await writeFile(
    resolve(root, "testcases", ...requestId.split("/"), "cases-main.md"),
    `${await readFile(resolve(root, "testcases", ...requestId.split("/"), "cases-main.md"), "utf8")}\n<!-- expected evolution -->\n`,
    "utf8"
  );
  view = await manager.gate();
  assert.equal(
    view.activities["case-review-conflict-decision"]?.state,
    "SUCCEEDED"
  );
  assert.notEqual(
    view.continuation.referenceId,
    "case-review-conflict-decision"
  );

  await writeFile(
    manager.planPath,
    (await readFile(manager.planPath, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("| 业务裁决 |"))
      .join("\n"),
    "utf8"
  );
  view = await manager.gate();
  assert.equal(view.reply.kind, "none");
  assert.equal(
    view.continuation.referenceId,
    "case-review-conflict-decision"
  );
  assert.equal(
    view.activities["case-review-conflict-decision"]?.state,
    "BLOCKED"
  );
});

test("case subject drift reconciles in-flight downstream work before reopening confirmation", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements"]
  });
  await advanceToReview(manager);
  await completeReviewBatch(manager, "REV-DRIFT");
  await succeedActivity(manager, "case-review-resolution", "converged");
  const subjectDigest = await manager.callbackSubjectDigest("case-confirmation");
  await manager.requestCallback({
    activityId: "case-confirmation",
    callbackId: "confirm-before-drift",
    subjectDigest,
    kind: "case_confirmation"
  });
  await recordFormalDecision(manager, "case-confirmation", subjectDigest, "accepted");
  await manager.resolveCallback({
    activityId: "case-confirmation",
    callbackId: "confirm-before-drift",
    subjectDigest,
    resolution: "accepted"
  });
  await manager.startActivity("engineering-web", "engineering-worker");
  await writeFile(
    resolve(root, "testcases", ...requestId.split("/"), "cases-main.md"),
    `${await readFile(resolve(root, "testcases", ...requestId.split("/"), "cases-main.md"), "utf8")}\n<!-- changed decision subject -->\n`,
    "utf8"
  );

  let gate = await manager.gate();
  assert.equal(gate.workflowState, "RECONCILING");
  assert.equal(gate.reply.kind, "none");
  assert.equal(gate.continuation.kind, "continue_now");
  assert.equal(gate.continuation.reason, "callback_subject_drift_reconcile");
  assert.equal(gate.activities["engineering-web"]?.state, "RUNNING");

  gate = await manager.resume("reconcile changed case decision");
  assert.equal(gate.activities["engineering-web"]?.state, "RECONCILING");
  assert.equal(gate.reply.kind, "none");
  assert.ok((await manager.events()).some((event) =>
    event.type === "ArtifactDriftDetected"
    && event.payload.activityId === "engineering-web"
  ));
});

test("a dispatched reviewer stays await_event regardless of elapsed wall-clock time", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements"]
  });
  await advanceToReview(manager);
  const batchId = "REV-LONG-WAIT";
  const activityId = "case-review-requirements";
  await manager.startReviewBatch({
    batchId,
    inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-main.md")]
  });
  await manager.dispatchReviewer({
    activityId,
    batchId,
    role: "requirements",
    agentTaskId: "requirements-long-wait"
  });

  const historyBeforeWait = await readFile(manager.historyPath, "utf8");
  const view = await manager.gate(Date.parse("2099-01-01T00:00:00.000Z"));

  assert.equal(view.activities[activityId]?.state, "RUNNING");
  assert.equal(view.activities[activityId]?.attempt, 1);
  assert.equal(view.continuation.kind, "await_event");
  assert.equal(view.reply.kind, "none");
  assert.equal(await readFile(manager.historyPath, "utf8"), historyBeforeWait);
});

test("one reviewer may retry three times in a batch and then becomes explicitly blocked", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements"]
  });
  await advanceToReview(manager);
  const batchId = "REV-RETRY";
  await manager.startReviewBatch({ batchId, inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-main.md")] });
  const activityId = "case-review-requirements";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "requirements"
    });
    const view = await manager.failReviewer({
      activityId,
      batchId,
      summary: `reviewer unavailable ${attempt}`,
      retryAt: new Date(Date.now() - 1).toISOString()
    });
    if (attempt < 3) {
      assert.equal(view.continuation.kind, "continue_now");
      assert.equal(view.activities[activityId]?.attempt, attempt);
    } else {
      assert.equal(view.activities[activityId]?.state, "BLOCKED");
      assert.ok(view.waits.some((wait) =>
        wait.activityId === activityId && wait.kind === "blocker"
      ));
    }
  }
});

test("review capacity admits three independent v4 reviewers and rejects only the fourth", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements", "design", "traceability", "interaction"]
  });
  await advanceToReview(manager);

  const batchId = "REV-CAPACITY";
  await manager.startReviewBatch({ batchId, inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-main.md")] });
  const reviewByRole = new Map(
    Object.values((await manager.gate()).activities)
      .filter((activity) => activity.definition.kind === "review")
      .map((activity) => [
        String(activity.definition.metadata?.role),
        activity.id
      ])
  );
  const firstThree = ["requirements", "design", "traceability"];
  for (const role of firstThree) {
    await manager.dispatchReviewer({
      activityId: reviewByRole.get(role),
      batchId,
      role
    });
  }

  let view = await manager.gate();
  assert.ok(firstThree.every((role) =>
    view.activities[reviewByRole.get(role)!]?.state === "RUNNING"
  ));
  await assert.rejects(
    manager.dispatchReviewer({
      activityId: reviewByRole.get("interaction"),
      batchId,
      role: "interaction"
    }),
    /capacity is full/
  );

  const completedRole = firstThree[0]!;
  await manager.submitReviewer({
    activityId: reviewByRole.get(completedRole),
    batchId,
    role: completedRole,
    planEvidenceRef: manager.planPath
  });
  view = await manager.dispatchReviewer({
    activityId: reviewByRole.get("interaction"),
    batchId,
    role: "interaction"
  });
  assert.equal(
    view.activities[reviewByRole.get("interaction")!]?.state,
    "RUNNING"
  );
});

test("targeted re-review binds changed refs and reuses untouched reviewer evidence", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements", "design", "traceability"]
  });
  await advanceToReview(manager);
  const reviewIds = await completeReviewBatch(manager, "REV-TARGET-BASE");
  await succeedActivity(manager, "case-review-resolution", "evolve");
  await succeedActivity(manager, "case-review-evolution");

  const designActivityId = "case-review-design";
  assert.ok(reviewIds.includes(designActivityId));
  await manager.invalidateReviewBatch({
    batchId: "REV-TARGET-BASE",
    activityIds: [designActivityId],
    revisionDigest: sha256("targeted revision"),
    findingsDigest: sha256("targeted findings"),
    reason: "one design rule changed"
  });
  await manager.startReviewBatch({
    batchId: "REV-TARGET-DESIGN",
    activityIds: [designActivityId],
    affectedRefs: ["RULE-DEMO-001", "cases-main.md#DEMO-001"],
    excludedRefs: ["unaffected requirements"],
    baseBatchId: "REV-TARGET-BASE",
    reason: "one design rule changed"
  });

  const started = [...await manager.events()].reverse().find((event) =>
    event.type === "ReviewBatchStarted"
    && event.payload.batchId === "REV-TARGET-DESIGN"
  );
  assert.ok(started);
  const scope = started.payload.scope as Record<string, unknown>;
  assert.equal(scope.mode, "targeted");
  assert.deepEqual(scope.requiredActivityIds, [designActivityId]);
  assert.equal(
    (scope.reusedReviewerEvidence as unknown[]).length,
    2
  );
  assert.match(String(started.payload.scopeDigest), /^[a-f0-9]{64}$/);
  assert.match(String(started.payload.readinessDigest), /^[a-f0-9]{64}$/);

  await assert.rejects(
    manager.dispatchReviewer({
      activityId: "case-review-requirements",
      batchId: "REV-TARGET-DESIGN",
      role: "requirements"
    }),
    /outside targeted batch/
  );
  await manager.dispatchReviewer({
    activityId: designActivityId,
    batchId: "REV-TARGET-DESIGN",
    role: "design"
  });
  await manager.submitReviewer({
    activityId: designActivityId,
    batchId: "REV-TARGET-DESIGN",
    role: "design",
    planEvidenceRef: manager.planPath
  });
  assert.deepEqual(
    reviewBatchCoveredActivityIds(
      await manager.events(),
      "REV-TARGET-DESIGN"
    ),
    [
      "case-review-design",
      "case-review-requirements",
      "case-review-traceability"
    ]
  );
  assert.match(
    reviewFindingsDigest(await manager.events(), "REV-TARGET-DESIGN"),
    /^[a-f0-9]{64}$/
  );
});

test("read execution parallelism requires complete isolation evidence and no shared account", () => {
  const build = (executionIsolation?: {
    contexts: boolean;
    accounts: boolean;
    data: boolean;
    sharedAccount?: boolean;
  }) => buildWorkflowDefinition({
    requestId: "web/demo/isolation",
    planDigest: "a".repeat(64),
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    executionIsolation
  }).activities.find((activity) => activity.id === "execute")!.metadata;

  assert.equal(build()?.maxWorkers, 1);
  assert.equal(build({ contexts: true, accounts: false, data: true })?.maxWorkers, 1);
  assert.equal(build({
    contexts: true,
    accounts: true,
    data: true,
    sharedAccount: true
  })?.maxWorkers, 1);
  assert.equal(build({
    contexts: true,
    accounts: true,
    data: true,
    sharedAccount: false
  })?.maxWorkers, 2);
});
