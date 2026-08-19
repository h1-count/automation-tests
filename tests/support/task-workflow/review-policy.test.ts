import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  DurableWorkflowManager,
  buildWorkflowDefinition,
  parseReviewBatchScope,
  reviewBatchCoveredActivityIds,
  reviewFindingsDigest,
  reviewRevisionDigest
} from "../../../src/support/task-workflow/index.js";
import { projectRelationProjection } from "../../../src/support/testcase/relationProjection.js";
import { recordFormalDecision } from "./formalDecisionFixture.js";

const requestId = "web/demo/repeatable-review";

function compatibilityManager(root: string): DurableWorkflowManager {
  return new DurableWorkflowManager(requestId, root, {
    compatibilityDefinitionVersion: "v5"
  });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function archivedWorkspaceFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-repeatable-review-"));
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-main.md");
  const sourcePath = resolve(requestRoot, "source.md");
  const sourceBytes = Buffer.from("demo registration requirement", "utf8");
  await writeFile(sourcePath, sourceBytes);
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
      "- 风险标记：普通 test 环境提交申请。",
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
    "| 需求追溯编号 | REQ-DEMO-001 |",
    "| 规则覆盖编号 | RULE-DEMO-001 |",
    "| 数据策略 | ephemeral_cleanup |",
    "| 风险等级 | 低 |",
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
    "| 序号 | 操作 | 输入 | 预期 |",
    "| --- | --- | --- | --- |",
    "| 1 | 核对认证状态并打开当前页 | 无 | 页面可见 |",
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

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-repeatable-review-current-"));
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-main.md");
  const sourcePath = resolve(requestRoot, "source.md");
  const sourceBytes = Buffer.from("demo registration requirement", "utf8");
  await writeFile(sourcePath, sourceBytes);
  await writeFile(planPath, `# Repeatable review

> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。
> 用例格式：testcase-v6-layered。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | ${requestId} |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |

## 测试范围

- 注册。
- 风险标记：普通 test 环境提交申请。

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-DEMO-001 | [需求](${sourcePath})；注册章节 | ${sha256(sourceBytes)} | 注册规则 |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-DEMO-001 | SRC-DEMO-001 | 注册结果可见 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001 | valid | visible result | 场景法 | DEMO-001 | ephemeral_cleanup；执行清单；cleanup；后置查询核对 | 已覆盖 |

## 缺口与风险

- 无。

## 评审与正式决定

- 尚未评审。
- 尚未演进。
`, "utf8");
  await writeFile(casesPath, `> 结构版本：testcase-v6-layered。

# 用例集：Repeatable review

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：ephemeral_cleanup
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 0 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 注册 | DEMO-001 | 验证正常路径 | P1 | 低 |

## 模块：注册

<details open>
<summary>DEMO-001｜验证正常路径｜P1｜低风险</summary>

> 规则：RULE-DEMO-001
> 前置条件：precondition

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 核对认证状态并打开当前页 | 无 | 页面可见 |

</details>
`, "utf8");
  const projected = projectRelationProjection(await readFile(planPath, "utf8"), {
    "cases-main.md": await readFile(casesPath, "utf8")
  });
  assert.deepEqual(projected.issues, []);
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
      role,
      agentTaskId: `${batchId}-${role}`
    });
    await manager.submitReviewer({
      activityId,
      batchId,
      role,
      planEvidenceRef: manager.planPath,
      agentTaskId: `${batchId}-${role}`
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
  assert.equal(view.activities.build?.state, "PENDING");
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
  assert.notEqual(view.activities.build?.state, "READY");
}

test("four progressing revisions can repeat the full case-review before latest convergence", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
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
  assert.equal(view.activities.build?.state, "PENDING");
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
  assert.equal(view.activities.build?.state, "READY");
});

test("review-policy-v2 stops after two semantic evolution cycles in one epoch", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"]
  });
  await advanceToReview(manager);
  const activityId = "case-review-combined";

  const submitExistingBatch = async (batchId: string): Promise<void> => {
    await manager.dispatchReviewer({
      activityId,
      batchId,
      role: "combined",
      agentTaskId: `${batchId}-combined`
    });
    await manager.submitReviewer({
      activityId,
      batchId,
      role: "combined",
      planEvidenceRef: manager.planPath,
      agentTaskId: `${batchId}-combined`
    });
  };
  const evolve = async (batchId: string, cycle: number): Promise<void> => {
    await succeedActivity(manager, "case-review-resolution", "evolve");
    await succeedActivity(manager, "case-review-evolution");
    await changeCase(cycle);
    await manager.invalidateReviewBatch({
      batchId,
      activityIds: [activityId],
      revisionDigest: sha256(`v2-revision:${cycle}`),
      findingsDigest: sha256(`v2-findings:${cycle}`),
      reason: "semantic testcase evolution"
    });
  };
  const changeCase = async (cycle: number): Promise<void> => {
    const path = resolve(manager.requestRoot, "cases-main.md");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replaceAll(
        "验证正常路径",
        `验证正常路径（演进 ${cycle}）`
      ),
      "utf8"
    );
  };

  await manager.startReviewBatch({ batchId: "REV-EPOCH-0" });
  await submitExistingBatch("REV-EPOCH-0");
  await evolve("REV-EPOCH-0", 0);

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await manager.startReviewBatch({
      batchId: `REV-EPOCH-${cycle}`,
      baseBatchId: `REV-EPOCH-${cycle - 1}`,
      affectedRefs: ["DEMO-001", "RULE-DEMO-001"],
      reason: "semantic testcase evolution"
    });
    const started = (await manager.events()).find((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === `REV-EPOCH-${cycle}`
    );
    const scope = parseReviewBatchScope(started?.payload.scope);
    assert.equal(scope.schemaVersion, "review-batch-scope-v3");
    if (scope.schemaVersion === "review-batch-scope-v3") {
      assert.equal(scope.semanticEvolutionCycle, cycle);
    }
    await submitExistingBatch(`REV-EPOCH-${cycle}`);
    await evolve(`REV-EPOCH-${cycle}`, cycle);
  }

  const blocked = await manager.startReviewBatch({
    batchId: "REV-EPOCH-3",
    baseBatchId: "REV-EPOCH-2",
    affectedRefs: ["DEMO-001", "RULE-DEMO-001"],
    reason: "third semantic testcase evolution"
  });
  assert.equal(blocked.workflowState, "BLOCKED");
  assert.equal((await manager.events()).some((event) =>
    event.type === "ReviewBatchStarted" && event.payload.batchId === "REV-EPOCH-3"
  ), false);
  assert.ok(blocked.waits.some((wait) => wait.detail?.includes("review_convergence_failed")));
});

test("automatic evolution preserves plan confirmation unless the user-owned plan boundary changes", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
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
  const manager = compatibilityManager(root);
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

  const acceptedPlan = currentPlan;
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
  const manager = compatibilityManager(root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["interaction"]
  });
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
  const manager = compatibilityManager(root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases-main.md"] });
  await advanceToReview(manager);
  await completeReviewBatch(manager, "REV-CONFLICT");
  await succeedActivity(manager, "case-review-resolution", "human_conflict");
  let view = await manager.gate();
  assert.equal(view.activities["case-review-conflict-decision"]?.state, "READY");
  assert.equal(view.activities["case-review-evolution"]?.state, "PENDING");
  assert.equal(view.activities["case-confirmation"]?.state, "CANCELLED");
  assert.equal(view.activities.build?.state, "PENDING");

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
  assert.equal(view.activities.build?.state, "PENDING");

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
  const manager = compatibilityManager(root);
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
  await manager.startActivity("build", "engineering-worker");
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
  assert.equal(gate.activities.build?.state, "RUNNING");

  gate = await manager.resume("reconcile changed case decision");
  assert.equal(gate.activities.build?.state, "RECONCILING");
  assert.equal(gate.reply.kind, "none");
  assert.ok((await manager.events()).some((event) =>
    event.type === "ArtifactDriftDetected"
    && event.payload.activityId === "build"
  ));
});

test("a dispatched reviewer awaits submission but an idle window only suggests a runtime rebind", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
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
  for (const readyReviewer of Object.values((await manager.gate()).activities)) {
    if (readyReviewer.state !== "READY" || readyReviewer.definition.kind !== "review") continue;
    await manager.dispatchReviewer({
      activityId: readyReviewer.id,
      batchId,
      role: String(readyReviewer.definition.metadata?.role ?? "reviewer"),
      agentTaskId: `${readyReviewer.id}-long-wait`
    });
  }

  const historyBeforeWait = await readFile(manager.historyPath, "utf8");
  const freshView = await manager.gate();
  assert.equal(freshView.activities[activityId]?.state, "RUNNING");
  assert.ok(!freshView.nextActions.some((action) => action.startsWith("reviewer-rebind:")));
  assert.equal(freshView.continuation.kind, "await_event");

  const view = await manager.gate(Date.parse("2099-01-01T00:00:00.000Z"));

  assert.equal(view.activities[activityId]?.state, "RUNNING");
  assert.equal(view.activities[activityId]?.attempt, 1);
  assert.ok(view.nextActions.some((action) =>
    action.startsWith(`reviewer-rebind:${batchId}:`)));
  assert.equal(view.continuation.kind, "continue_now");
  assert.equal(view.continuation.reason, "reviewer_idle_rebind_suggested");
  assert.equal(view.reply.kind, "none");
  assert.equal(await readFile(manager.historyPath, "utf8"), historyBeforeWait);
});

test("one reviewer may retry three times in a batch and then becomes explicitly blocked", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
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
      role: "requirements",
      agentTaskId: "retry-reviewer"
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
  const manager = compatibilityManager(root);
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
      activityId: reviewByRole.get(role)!,
      batchId,
      role,
      agentTaskId: `${batchId}-${role}`
    });
  }

  let view = await manager.gate();
  assert.ok(firstThree.every((role) =>
    view.activities[reviewByRole.get(role)!]?.state === "RUNNING"
  ));
  await assert.rejects(
    manager.dispatchReviewer({
      activityId: reviewByRole.get("interaction")!,
      batchId,
      role: "interaction",
      agentTaskId: `${batchId}-interaction`
    }),
    /capacity is full/
  );

  const completedRole = firstThree[0]!;
  await manager.submitReviewer({
    activityId: reviewByRole.get(completedRole)!,
    batchId,
    role: completedRole,
    planEvidenceRef: manager.planPath,
    agentTaskId: `${batchId}-${completedRole}`
  });
  view = await manager.dispatchReviewer({
    activityId: reviewByRole.get("interaction")!,
    batchId,
    role: "interaction",
    agentTaskId: `${batchId}-interaction`
  });
  assert.equal(
    view.activities[reviewByRole.get("interaction")!]?.state,
    "RUNNING"
  );
});

test("targeted re-review binds changed refs and reuses untouched reviewer evidence", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
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
  assert.deepEqual(
    (scope.reusedReviewerEvidence as Array<{ activityId: string }>)
      .map((evidence) => evidence.activityId)
      .sort(),
    [
      "case-review-impact",
      "case-review-requirements",
      "case-review-traceability"
    ]
  );
  assert.match(String(started.payload.scopeDigest), /^[a-f0-9]{64}$/);
  assert.match(String(started.payload.readinessDigest), /^[a-f0-9]{64}$/);

  await assert.rejects(
    manager.dispatchReviewer({
      activityId: "case-review-requirements",
      batchId: "REV-TARGET-DESIGN",
      role: "requirements",
      agentTaskId: "REV-TARGET-DESIGN-requirements"
    }),
    /outside targeted batch/
  );
  await manager.dispatchReviewer({
    activityId: designActivityId,
    batchId: "REV-TARGET-DESIGN",
    role: "design",
    agentTaskId: "REV-TARGET-DESIGN-design"
  });
  await manager.submitReviewer({
    activityId: designActivityId,
    batchId: "REV-TARGET-DESIGN",
    role: "design",
    planEvidenceRef: manager.planPath,
    agentTaskId: "REV-TARGET-DESIGN-design"
  });
  assert.deepEqual(
    reviewBatchCoveredActivityIds(
      await manager.events(),
      "REV-TARGET-DESIGN"
    ),
    [
      "case-review-design",
      "case-review-impact",
      "case-review-requirements",
      "case-review-traceability"
    ]
  );
  assert.match(
    reviewFindingsDigest(await manager.events(), "REV-TARGET-DESIGN"),
    /^[a-f0-9]{64}$/
  );
});

test("review invalidation deterministically derives omitted revision and findings digests", async (context) => {
  const root = await workspace();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = compatibilityManager(root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases-main.md"],
    reviewerRoles: ["requirements"]
  });
  await advanceToReview(manager);
  const batchId = "REV-DERIVED-INVALIDATION";
  const activityIds = await completeReviewBatch(manager, batchId);
  await succeedActivity(manager, "case-review-resolution", "evolve");
  await succeedActivity(manager, "case-review-evolution");
  const before = await manager.events();
  const expectedRevision = reviewRevisionDigest({
    events: before,
    batchId,
    activityIds
  });
  const expectedFindings = reviewFindingsDigest(before, batchId);

  await manager.invalidateReviewBatch({
    batchId,
    activityIds,
    reason: "derive immutable review evidence"
  });
  const invalidation = (await manager.events()).find((event) =>
    event.type === "ReviewBatchInvalidated"
    && event.payload.batchId === batchId
  );
  assert.equal(invalidation?.payload.revisionDigest, expectedRevision);
  assert.equal(invalidation?.payload.findingsDigest, expectedFindings);
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
  }).activities.find((activity) => activity.id === "run")!.metadata;

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
