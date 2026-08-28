import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCallbackDriftProjection,
  assertFormalUserDecision,
  callbackDecisionIsCurrent,
  formalUserDecisionResolution,
  planConfirmationSubjectProjection,
  planDecisionProjection
} from "../../../src/support/task-workflow/callbackDecision.js";
import {
  prepareReviewLifecycleEvent,
  referencedControlledSources,
  requiredReviewInputs,
  reviewerBindingId
} from "../../../src/support/task-workflow/reviewLifecycle.js";
import {
  planResumeRecovery,
  REVIEWER_IDLE_REBIND_THRESHOLD_MS,
  reviewerIdleRebindAction
} from "../../../src/support/task-workflow/resumeRecovery.js";
import type { WorkflowRuntimeState } from "../../../src/support/task-workflow/runtimeLeaseStore.js";
import type {
  WorkflowEvent,
  WorkflowProjection
} from "../../../src/support/task-workflow/types.js";

test("callback decision projection excludes derived review state but preserves formal scope", () => {
  const base = [
    "# Plan",
    "",
    "## 基本信息",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    "| 目标环境 | test |",
    "| 写入策略 | no_write |",
    "",
    "## 测试范围",
    "",
    "- 注册。",
    "",
    "## 需求追溯矩阵",
    "",
    "| REQ | 派生 caseId |",
    "| --- | --- |",
    "| REQ-DEMO-001 | DEMO-REG-001 |",
    ""
  ].join("\n");
  const derivedOnly = base.replace("DEMO-REG-001", "DEMO-REG-002");
  const scopeChanged = base.replace("- 注册。", "- 注册与登录。");
  const environmentChanged = base.replace("| 目标环境 | test |", "| 目标环境 | staging |");
  const writePolicyChanged = base.replace("| 写入策略 | no_write |", "| 写入策略 | ephemeral_cleanup |");

  assert.equal(planDecisionProjection(derivedOnly), planDecisionProjection(base));
  assert.notEqual(planDecisionProjection(scopeChanged), planDecisionProjection(base));
  assert.notEqual(planDecisionProjection(environmentChanged), planDecisionProjection(base));
  assert.notEqual(planDecisionProjection(writePolicyChanged), planDecisionProjection(base));
  assert.equal(callbackDecisionIsCurrent({
    acceptedSubject: "a",
    actualSubject: "a",
    formalDecisionValid: true
  }), true);
  assert.equal(callbackDecisionIsCurrent({
    acceptedSubject: "a",
    actualSubject: "b",
    formalDecisionValid: true
  }), false);

  const projection = {
    activities: {
      "plan-confirmation": {
        id: "plan-confirmation",
        state: "SUCCEEDED",
        blockerIds: [],
        definition: {
          id: "plan-confirmation",
          kind: "callback",
          phase: "plan_confirmation",
          dependencies: [],
          required: true
        }
      },
      "case-generation": {
        id: "case-generation",
        state: "READY",
        blockerIds: [],
        definition: {
          id: "case-generation",
          kind: "case_generation",
          phase: "case_generation",
          dependencies: ["plan-confirmation"],
          required: true
        }
      }
    },
    readyActivities: ["case-generation"],
    runningActivities: [],
    waits: [],
    nextActions: ["case-generation"],
    workflowState: "RUNNING",
    continuation: {
      kind: "continue_now",
      referenceId: "case-generation",
      reason: "ready_activity_available"
    },
    reply: {
      kind: "none",
      allowed: false,
      reason: "automatic_work_remaining"
    }
  } as unknown as WorkflowProjection;
  applyCallbackDriftProjection({
    projection,
    activityId: "plan-confirmation",
    acceptedSubject: "a",
    actualSubject: "b",
    formalDecisionValid: true
  });
  assert.equal(projection.activities["plan-confirmation"]?.state, "BLOCKED");
  assert.equal(projection.activities["case-generation"]?.state, "PENDING");
  assert.deepEqual(projection.nextActions, ["callback-reopen:plan-confirmation"]);
});

test("v1 plan confirmation subject ignores testcase evolution but detects material plan changes", () => {
  const base = [
    "# Plan",
    "",
    "## 基本信息",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    "| 测试请求 | `web/demo/account-access` |",
    "| 测试类型 | Web |",
    "| 目标环境 | `test`（候选，尚未授权执行） |",
    "",
    "## 测试范围",
    "",
    "### 包含",
    "",
    "- 企业注册：字段、协议、验证码和提交条件。",
    "- 账号登录：手机号密码登录及控制台断言。",
    "- 不产生业务写入的页面探索；提交与上传保留到执行授权后。",
    "",
    "### 不包含",
    "",
    "- 密码找回。",
    "- 生产环境和未定义验收标准的安全攻击测试。",
    "",
    "## 测试数据策略与残留台账",
    "",
    "| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 正式决定引用 |",
    "| --- | --- | --- | --- | --- | --- |",
    "| no_write | test | 无 | 0 | 注册字段 / DEMO-REG-001 | 计划确认 |",
    "",
    "### 写入策略明细",
    "",
    "- no_write：仅观察页面，不提交。",
    "",
    "### 执行清单映射",
    "",
    "| caseId | 正式脚本 | 允许操作 | 资源类型 | 数量预算 | 后台验证 | 敏感产物策略 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| DEMO-REG-001 | demo.spec.ts | 无 | 无 | 0 | 无 | 常规 |",
    "",
    "## 需求追溯矩阵",
    "",
    "| REQ | 规则 | 派生 caseId |",
    "| --- | --- | --- |",
    "| REQ-DEMO-001 | 必须输入验证码 | DEMO-REG-001 |",
    "",
    "## 多角色评审记录",
    "",
    "- reviewer 尚未返回。",
    ""
  ].join("\n");
  const evolved = base
    .replace("字段、协议、验证码和提交条件", "字段、协议和提交条件")
    .replace("控制台断言", "默认进入 AIoT 控制台")
    .replaceAll("DEMO-REG-001", "DEMO-REG-002")
    .replace("必须输入验证码", "仅校验资料定义的提交条件")
    .replace("reviewer 尚未返回", "reviewer 已完成自动演进");

  assert.equal(
    planConfirmationSubjectProjection(evolved),
    planConfirmationSubjectProjection(base)
  );
  assert.match(
    planConfirmationSubjectProjection(base),
    /"schemaVersion":"plan-confirmation-subject-v1"/
  );

  assert.notEqual(
    planConfirmationSubjectProjection(
      base.replace("- 账号登录：手机号密码登录及控制台断言。", "- 密码找回：重置后重新登录。")
    ),
    planConfirmationSubjectProjection(base)
  );
  assert.notEqual(
    planConfirmationSubjectProjection(base.replace("| 测试类型 | Web |", "| 测试类型 | App |")),
    planConfirmationSubjectProjection(base)
  );
  assert.notEqual(
    planConfirmationSubjectProjection(
      base.replace("`web/demo/account-access`", "`web/demo/password-reset`")
    ),
    planConfirmationSubjectProjection(base)
  );
  assert.notEqual(
    planConfirmationSubjectProjection(base.replace("`test`（候选，尚未授权执行）", "`pre`（候选）")),
    planConfirmationSubjectProjection(base)
  );
  assert.notEqual(
    planConfirmationSubjectProjection(
      base.replace(
        "| no_write | test | 无 | 0 | 注册字段 / DEMO-REG-001 | 计划确认 |",
        "| ephemeral_cleanup | test | 企业申请 | 1 | 注册提交 / DEMO-REG-001 | 计划确认 |"
      )
    ),
    planConfirmationSubjectProjection(base)
  );
  assert.notEqual(
    planConfirmationSubjectProjection(
      base.replace(
        "## 多角色评审记录",
        "## 风险与审核事项\n\n- 允许执行设备控制。\n\n## 多角色评审记录"
      )
    ),
    planConfirmationSubjectProjection(base)
  );
});

test("formal callback decision parser binds resolution to activity and subject digest", () => {
  const digest = "a".repeat(64);
  const plan = [
    "# Plan",
    "",
    "## 正式用户决定",
    "",
    "| 决定类型 | subjectDigest | 正式决定 |",
    "| --- | --- | --- |",
    `| 计划确认 | ${digest} | accepted |`,
    ""
  ].join("\n");

  assert.equal(
    formalUserDecisionResolution(plan, "plan-confirmation", digest),
    "accepted"
  );
  assert.doesNotThrow(() =>
    assertFormalUserDecision(plan, "plan-confirmation", digest, "accepted")
  );
  assert.throws(
    () => assertFormalUserDecision(plan, "plan-confirmation", digest, "rejected"),
    /no 计划确认 decision/
  );
});

test("review lifecycle derives controlled inputs and stable runtime binding identity", () => {
  const plan = [
    "[manifest](sources/manifest.yaml)",
    "`sources/indexes/demo.yaml`",
    "[requirement](../../../../sources/requirements/demo/spec.md)",
    "[word](<../../../../sources/requirements/demo/V1.0 需求.docx>)",
    "[encoded](../../../../sources/requirements/demo/V1.0%20需求.docx)"
  ].join("\n");
  const sources = referencedControlledSources(plan);
  assert.deepEqual(sources, [
    "sources/manifest.yaml",
    "sources/indexes/demo.yaml",
    "../../../../sources/requirements/demo/spec.md",
    "../../../../sources/requirements/demo/V1.0 需求.docx",
    "../../../../sources/requirements/demo/V1.0 需求.docx"
  ]);
  assert.deepEqual(
    requiredReviewInputs(
      "testcases/web/demo/request/plan.md",
      ["testcases/web/demo/request/cases-main.md"],
      sources,
      ["testcases/web/demo/request/plan.md"]
    ),
    [
      "testcases/web/demo/request/plan.md",
      "testcases/web/demo/request/cases-main.md",
      ...sources.filter((source, index) => sources.indexOf(source) === index)
    ]
  );
  assert.equal(
    reviewerBindingId("case-review-design", "design", "REV-01"),
    "REV-01:case-review-design:design"
  );

  const projection = {
    activities: {
      "case-review-design": {
        id: "case-review-design",
        state: "READY",
        attempt: 0,
        definition: {
          id: "case-review-design",
          kind: "review",
          phase: "case_review",
          dependencies: [],
          required: true,
          concurrencyGroup: "reviewer",
          metadata: { role: "design" }
        }
      }
    },
    runningActivities: [],
    reviewPolicy: {
      schemaVersion: "review-policy-v1",
      requiredRoles: ["design"],
      maxConcurrentReviewers: 3,
      maxAttemptsPerRole: 3,
      maxUnchangedRevisionCycles: 2
    }
  } as unknown as WorkflowProjection;
  assert.deepEqual(
    prepareReviewLifecycleEvent(projection, {
      type: "ReviewerDispatched",
      activityId: "case-review-design",
      batchId: "REV-01",
      role: "design",
      inputDigest: "a".repeat(64)
    }),
    {
      duplicate: false,
      payload: {
        batchId: "REV-01",
        activityId: "case-review-design",
        role: "design",
        inputDigest: "a".repeat(64),
        attempt: 1
      }
    }
  );
});

test("resume recovery derives a host rebind action without inventing durable work", () => {
  const projection = {
    activities: {
      "case-review-design": {
        id: "case-review-design",
        state: "RUNNING",
        attempt: 1,
        definition: {
          id: "case-review-design",
          kind: "review",
          phase: "case_review",
          dependencies: [],
          required: true,
          metadata: { role: "design" }
        }
      }
    },
    runningActivities: ["case-review-design"]
  } as unknown as WorkflowProjection;
  const events = [{
    seq: 1,
    type: "ReviewerDispatched",
    payload: {
      activityId: "case-review-design",
      batchId: "REV-01",
      role: "design"
    }
  }] as unknown as WorkflowEvent[];

  assert.deepEqual(
    planResumeRecovery({
      projection,
      events,
      runtime: null,
      now: Date.now()
    }),
    [{
      kind: "reviewer_rebind_required",
      activityId: "case-review-design",
      batchId: "REV-01",
      role: "design",
      bindingId: "REV-01:case-review-design:design",
      attempt: 1
    }]
  );
});

test("resume recovery suggests an idle rebind after a silent dispatch window", () => {
  const projection = {
    activities: {
      "case-review-design": {
        id: "case-review-design",
        state: "RUNNING",
        attempt: 1,
        definition: {
          id: "case-review-design",
          kind: "review",
          phase: "case_review",
          dependencies: [],
          required: true,
          metadata: { role: "design" }
        }
      }
    },
    runningActivities: ["case-review-design"]
  } as unknown as WorkflowProjection;
  const now = Date.parse("2026-08-17T10:00:00.000Z");
  const dispatchedAt = new Date(
    now - REVIEWER_IDLE_REBIND_THRESHOLD_MS - 60_000
  ).toISOString();
  const events = [{
    seq: 1,
    type: "ReviewerDispatched",
    occurredAt: dispatchedAt,
    payload: {
      activityId: "case-review-design",
      batchId: "REV-01",
      role: "design"
    }
  }] as unknown as WorkflowEvent[];
  const bindingId = "REV-01:case-review-design:design";
  const runtime = {
    schemaVersion: "test-workflow-runtime-v1",
    requestId: "web/demo/req",
    revision: 1,
    reviewerBindings: {
      [bindingId]: {
        bindingId,
        activityId: "case-review-design",
        batchId: "REV-01",
        role: "design",
        agentTaskId: "host-task-1",
        status: "running",
        startedAt: dispatchedAt,
        updatedAt: dispatchedAt
      }
    },
    leases: {},
    inFlightOperations: {},
    stagingRefs: {}
  } as unknown as WorkflowRuntimeState;

  const actions = planResumeRecovery({ projection, events, runtime, now });
  assert.deepEqual(reviewerIdleRebindAction(actions), {
    kind: "reviewer_idle_rebind",
    activityId: "case-review-design",
    batchId: "REV-01",
    role: "design",
    bindingId,
    attempt: 1
  });
  assert.deepEqual(actions.filter((action) => action.kind === "clear_reviewer_binding"), [{
    kind: "clear_reviewer_binding",
    bindingId
  }]);
  assert.equal(reviewerIdleRebindAction(actions)?.kind, "reviewer_idle_rebind");
  assert.ok(!actions.some((action) => action.kind === "reviewer_rebind_required"));
});

test("a recently refreshed reviewer binding does not trigger the idle rebind", () => {
  const projection = {
    activities: {
      "case-review-design": {
        id: "case-review-design",
        state: "RUNNING",
        attempt: 1,
        definition: {
          id: "case-review-design",
          kind: "review",
          phase: "case_review",
          dependencies: [],
          required: true,
          metadata: { role: "design" }
        }
      }
    },
    runningActivities: ["case-review-design"]
  } as unknown as WorkflowProjection;
  const now = Date.parse("2026-08-17T10:00:00.000Z");
  const staleDispatch = new Date(
    now - REVIEWER_IDLE_REBIND_THRESHOLD_MS - 60_000
  ).toISOString();
  const freshBinding = new Date(now - 60_000).toISOString();
  const events = [{
    seq: 1,
    type: "ReviewerDispatched",
    occurredAt: staleDispatch,
    payload: {
      activityId: "case-review-design",
      batchId: "REV-01",
      role: "design"
    }
  }] as unknown as WorkflowEvent[];
  const bindingId = "REV-01:case-review-design:design";
  const runtime = {
    schemaVersion: "test-workflow-runtime-v1",
    requestId: "web/demo/req",
    revision: 1,
    reviewerBindings: {
      [bindingId]: {
        bindingId,
        activityId: "case-review-design",
        batchId: "REV-01",
        role: "design",
        agentTaskId: "host-task-1",
        status: "running",
        startedAt: staleDispatch,
        updatedAt: freshBinding
      }
    },
    leases: {},
    inFlightOperations: {},
    stagingRefs: {}
  } as unknown as WorkflowRuntimeState;

  const actions = planResumeRecovery({ projection, events, runtime, now });
  assert.equal(reviewerIdleRebindAction(actions), undefined);
  assert.ok(!actions.some((action) => action.kind === "clear_reviewer_binding"));
});
