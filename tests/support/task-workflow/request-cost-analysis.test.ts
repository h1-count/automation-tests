import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateUsage,
  buildCostReport,
  deriveRequestTimeline,
  extractUsageRecord,
  parseJsonl,
  usageWindowMs,
  type HistoryEventLike
} from "../../../src/support/task-workflow/requestCostAnalysis.ts";

function event(type: string, occurredAt: string, payload: Record<string, unknown> = {}): HistoryEventLike {
  return { type, occurredAt, requestId: "web/demo/request-1", payload };
}

const events: HistoryEventLike[] = [
  event("WorkflowStarted", "2026-08-21T08:20:33.697Z", { deliveryTarget: "testcase_only" }),
  event("ActivityAttemptStarted", "2026-08-21T08:20:33.698Z", { activityId: "reuse-assessment", attempt: 1 }),
  event("ActivitySucceeded", "2026-08-21T08:20:33.700Z", { activityId: "reuse-assessment", attempt: 1 }),
  event("ActivityAttemptStarted", "2026-08-21T08:21:48.425Z", { activityId: "candidate-generation", attempt: 1 }),
  event("ArtifactDriftDetected", "2026-08-21T08:35:59.918Z", { activityId: "candidate-generation", attempt: 1 }),
  event("ActivityFailed", "2026-08-21T08:36:43.347Z", { activityId: "candidate-generation", attempt: 1 }),
  event("RetryScheduled", "2026-08-21T08:36:43.347Z", { activityId: "candidate-generation", attempt: 1 }),
  event("ActivityAttemptStarted", "2026-08-21T08:37:08.626Z", { activityId: "candidate-generation", attempt: 2 }),
  event("ActivitySucceeded", "2026-08-21T08:39:42.388Z", { activityId: "candidate-generation", attempt: 2 }),
  event("ReviewBatchStarted", "2026-08-21T08:42:29.571Z", { batchId: "rev-r1" }),
  event("ReviewerDispatched", "2026-08-21T08:43:03.122Z", { batchId: "rev-r1", role: "combined", activityId: "case-review-combined" }),
  event("ReviewerSubmitted", "2026-08-21T08:49:55.722Z", { batchId: "rev-r1", role: "combined", conclusion: "findings_present" }),
  event("CallbackRequested", "2026-08-21T09:03:05.214Z", { callbackId: "cb-1", activityId: "case-confirmation" }),
  event("CallbackResolved", "2026-08-21T09:07:35.507Z", { callbackId: "cb-1", activityId: "case-confirmation" }),
  event("WorkflowCompleted", "2026-08-21T09:07:35.507Z", { deliveryTarget: "testcase_only" })
];

test("parseJsonl 跳过空行与坏行", () => {
  const parsed = parseJsonl('\n{"type":"A"}\nnot-json\n{"type":"B"}\n');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.type, "A");
});

test("v11 成本报告区分 compiler、确定性分片、模型分片与 clause/case 归属", () => {
  const timeline = deriveRequestTimeline([
    event("ActivityAttemptStarted", "2026-08-25T00:00:00.000Z", { activityId: "candidate-compiler", attempt: 1 }),
    event("CandidateGenerationStarted", "2026-08-25T00:00:05.000Z", { activityId: "candidate-compiler", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-25T00:01:00.000Z", { activityId: "candidate-compiler", attempt: 1 }),
    event("CandidateGraphExpanded", "2026-08-25T00:01:01.000Z", { activities: [
      {
        id: "candidate-fragment-fixed", kind: "candidate_fragment", metadata: {
          generationMode: "deterministic",
          deterministicCaseIds: ["OPEN-PROD-001"],
          modelCaseIds: [],
          deterministicClauseIds: ["CLAUSE-PROD-001"],
          modelClauseIds: []
        }
      },
      {
        id: "candidate-fragment-unknown", kind: "candidate_fragment", metadata: {
          generationMode: "model",
          deterministicCaseIds: [],
          modelCaseIds: ["OPEN-PROD-002", "OPEN-PROD-003"],
          deterministicClauseIds: [],
          modelClauseIds: ["CLAUSE-PROD-002", "CLAUSE-PROD-003"]
        }
      }
    ] }),
    event("ActivityAttemptStarted", "2026-08-25T00:01:02.000Z", { activityId: "candidate-fragment-fixed", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-25T00:01:03.000Z", { activityId: "candidate-fragment-fixed", attempt: 1 }),
    event("ActivityAttemptStarted", "2026-08-25T00:01:02.000Z", { activityId: "candidate-fragment-unknown", attempt: 1 }),
    event("CandidateGenerationStarted", "2026-08-25T00:01:04.000Z", { activityId: "candidate-fragment-unknown", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-25T00:03:02.000Z", { activityId: "candidate-fragment-unknown", attempt: 1 })
  ]);
  assert.equal(timeline.candidateGeneration.compilerModelSeconds, 55);
  assert.equal(timeline.candidateGeneration.deterministicFragmentCount, 1);
  assert.equal(timeline.candidateGeneration.modelFragmentCount, 1);
  assert.equal(timeline.candidateGeneration.modelTimingExpectedActivities, 2);
  assert.equal(timeline.modelCalls.candidateCalls, 2);
  assert.equal(timeline.candidateGeneration.modelTimingCapturedCalls, 2);
  assert.deepEqual({
    deterministicCases: timeline.candidateGeneration.deterministicCaseCount,
    modelCases: timeline.candidateGeneration.modelCaseCount,
    deterministicClauses: timeline.candidateGeneration.deterministicClauseCount,
    modelClauses: timeline.candidateGeneration.modelClauseCount
  }, {
    deterministicCases: 1,
    modelCases: 2,
    deterministicClauses: 1,
    modelClauses: 2
  });
  assert.match(buildCostReport({
    timeline, sessions: [], degradations: [], window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  }), /v11 子约束归属：确定性 case 1 \/ 模型 case 2；确定性 clause 1 \/ 模型 clause 2/u);
});

test("deriveRequestTimeline 仅把 RetryScheduled 到重试领取计入重试空闲", () => {
  const timeline = deriveRequestTimeline(events);
  assert.equal(timeline.requestId, "web/demo/request-1");
  assert.equal(timeline.completed, true);
  assert.equal(timeline.wallSeconds, 2822);
  const candidate = timeline.activities.find((item) => item.activityId === "candidate-generation");
  assert.ok(candidate);
  assert.equal(candidate.attempts, 2);
  // attempt1: 08:21:48→08:36:43 = 894.9s；attempt2: 08:37:08→08:39:42 = 153.8s
  assert.equal(candidate.busySeconds, 1049);
  assert.equal(candidate.wallSeconds, 1074);
  assert.equal(candidate.retryIdleSeconds, 25);
  assert.equal(timeline.retryIdleSeconds, 25);
  assert.equal(candidate.driftEvents, 1);
  assert.equal(candidate.outcome, "ActivitySucceeded");
  assert.deepEqual(candidate.attemptDetails, [
    { attempt: 1, seconds: 895, outcome: "failed" },
    { attempt: 2, seconds: 154, outcome: "succeeded" }
  ]);
});

test("成本报告区分 readiness 输入阻断、宿主失联与环境延期", () => {
  const timeline = deriveRequestTimeline([
    event("ActivityFailed", "2026-08-26T00:00:00.000Z", {
      activityId: "readiness-preflight", summary: "immutable_input_incompatible: 缺少来源证据"
    }),
    event("ArtifactDriftDetected", "2026-08-26T00:01:00.000Z", {
      activityId: "readiness", recovery: "reconcile_before_retry"
    }),
    event("ActivityFailed", "2026-08-26T00:02:00.000Z", {
      activityId: "readiness", summary: "No runnable cases; 1 case(s) are deferred by checked capabilities."
    })
  ]);
  assert.deepEqual(timeline.readinessDiagnostics, {
    immutableInputBlocks: 1,
    hostOrphans: 1,
    environmentDeferred: 1
  });
  assert.match(buildCostReport({
    timeline, sessions: [], degradations: [], window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  }), /Readiness 诊断 \| 不可变输入阻断 1 · 宿主失联对账 1 · 环境延期 1/u);
});

test("design reuse reports zero design model calls only when no model events exist", () => {
  const timeline = deriveRequestTimeline([
    event("WorkflowStarted", "2026-08-21T08:00:00.000Z"),
    event("RunIntentDerived", "2026-08-21T08:00:01.000Z", {
      decision: "direct_execute", suiteId: "web/demo/login", digest: "a".repeat(64)
    })
  ]);
  assert.deepEqual(timeline.runIntent, {
    decision: "direct_execute", suiteId: "web/demo/login", digest: "a".repeat(64)
  });
  assert.match(buildCostReport({
    timeline, sessions: [], degradations: [], window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  }), /设计模型调用 0/u);
});

test("cost report separates model events from uncollected token telemetry", () => {
  const timeline = deriveRequestTimeline([
    event("ActivityAttemptStarted", "2026-08-25T00:00:00.000Z", { activityId: "candidate-compiler", attempt: 1 }),
    event("CandidateGenerationStarted", "2026-08-25T00:00:01.000Z", { activityId: "candidate-compiler", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-25T00:00:02.000Z", { activityId: "candidate-compiler", attempt: 1 }),
    event("ReviewerModelCallStarted", "2026-08-25T00:00:03.000Z", { batchId: "r1", activityId: "case-review-combined", attempt: 1, supplemental: false }),
    event("ReviewerModelCallCompleted", "2026-08-25T00:00:04.000Z", { batchId: "r1", activityId: "case-review-combined", attempt: 1 })
  ]);
  const report = buildCostReport({
    timeline, sessions: [], degradations: [], window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  });
  assert.equal(timeline.modelCalls.candidateCalls, 1);
  assert.equal(timeline.modelCalls.reviewerCalls, 1);
  assert.match(report, /模型调用事件 \| 候选 1 · reviewer 1 · 合计 2/u);
  assert.match(report, /token 采集（窗口内） \| 未采集（模型调用事件 2）/u);
  assert.doesNotMatch(report, /设计侧 LLM 调用数/u);
});

test("design reuse full_run is labelled as engineering build reuse", () => {
  const timeline = deriveRequestTimeline([
    event("RunIntentDerived", "2026-08-21T08:00:01.000Z", {
      decision: "design_reconfirm", suiteId: "web/demo/login", digest: "a".repeat(64), deliveryTarget: "full_run"
    })
  ]);
  assert.equal(timeline.runIntent?.designExecutionReuse, true);
  assert.match(buildCostReport({
    timeline, sessions: [], degradations: [], window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  }), /稳定设计复用→工程构建/u);
});

test("completion without an attempt is excluded from current workflow cost accounting", () => {
  const timeline = deriveRequestTimeline([
    event("ActivityAttemptStarted", "2026-08-21T08:00:00.000Z", { activityId: "candidate-generation", attempt: 1 }),
    event("ActivityFailed", "2026-08-21T08:01:00.000Z", { activityId: "candidate-generation", attempt: 1 }),
    event("RetryScheduled", "2026-08-21T08:01:00.000Z", { activityId: "candidate-generation", attempt: 1 }),
    event("ActivityAttemptStarted", "2026-08-21T08:02:00.000Z", { activityId: "candidate-generation", attempt: 2 }),
    event("ActivitySucceeded", "2026-08-21T08:05:00.000Z", { activityId: "candidate-generation" })
  ]);
  const candidate = timeline.activities.find((item) => item.activityId === "candidate-generation");
  assert.ok(candidate);
  assert.equal(candidate.busySeconds, 60);
  assert.equal(candidate.retryIdleSeconds, 60);
  assert.deepEqual(candidate.attemptDetails, [
    { attempt: 1, seconds: 60, outcome: "failed" }
  ]);
});

test("reviewer 或 callback 等待不会被误归因为重试空闲", () => {
  const timeline = deriveRequestTimeline([
    event("ActivityAttemptStarted", "2026-08-21T08:00:00.000Z", { activityId: "candidate-generation", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-21T08:01:00.000Z", { activityId: "candidate-generation", attempt: 1 }),
    event("ReviewerDispatched", "2026-08-21T08:02:00.000Z", { batchId: "r1", role: "combined" }),
    event("ReviewerSubmitted", "2026-08-21T08:42:00.000Z", { batchId: "r1", role: "combined" }),
    event("CallbackRequested", "2026-08-21T08:43:00.000Z", { callbackId: "cb" }),
    event("CallbackResolved", "2026-08-21T09:43:00.000Z", { callbackId: "cb" })
  ]);
  assert.equal(timeline.retryIdleSeconds, 0);
  assert.equal(timeline.humanWaitSeconds, 3600);
});

test("current candidate events without model-call timing do not invent missing model-call events", () => {
  const timeline = deriveRequestTimeline([
    event("ActivityAttemptStarted", "2026-08-21T08:00:00.000Z", { activityId: "candidate-skeleton", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-21T08:02:00.000Z", { activityId: "candidate-skeleton", attempt: 1 })
  ]);
  assert.equal(timeline.candidateGeneration.modelTimingCapturedActivities, 0);
  assert.equal(timeline.candidateGeneration.modelTimingExpectedActivities, 1);
  assert.match(buildCostReport({
    timeline,
    sessions: [],
    degradations: [],
    window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  }), /模型调用事件 \| 候选 0 · reviewer 0 · 合计 0/u);
});

test("deriveRequestTimeline 配对 reviewer 派发与提交", () => {
  const timeline = deriveRequestTimeline(events);
  assert.equal(timeline.reviewerSpans.length, 1);
  const span = timeline.reviewerSpans[0]!;
  assert.equal(span.batchId, "rev-r1");
  assert.equal(span.role, "combined");
  assert.equal(span.startedAt, "2026-08-21T08:43:03.122Z");
  assert.equal(span.endedAt, "2026-08-21T08:49:55.722Z");
  assert.equal(span.seconds, 413);
  assert.equal(span.conclusion, "findings_present");
});

test("deriveRequestTimeline reports re-review wall time and reused reviewer evidence", () => {
  const timeline = deriveRequestTimeline([
    event("ReviewBatchStarted", "2026-08-21T08:00:00.000Z", {
      batchId: "rev-r2",
      scope: {
        baseBatchId: "rev-r1",
        reusedReviewerEvidence: [{ activityId: "case-review-impact" }]
      }
    }),
    event("ReviewerDispatched", "2026-08-21T08:01:00.000Z", { batchId: "rev-r2", role: "combined" }),
    event("ReviewerSubmitted", "2026-08-21T08:04:00.000Z", { batchId: "rev-r2", role: "combined" })
  ]);
  assert.deepEqual(timeline.reviewerBatches, [{
    batchId: "rev-r2",
    reReview: true,
    mode: "unknown",
    dispatchedReviewers: 1,
    reusedReviewers: 1,
    wallSeconds: 180,
    rawInputBytes: 0,
    slicedInputBytes: 0,
    savedInputBytes: 0,
    inputSavingsRatio: 0,
    modelCalls: 0,
    modelSeconds: 0,
    budgetHits: 0,
    unclosedCalls: 0,
    roleModelSeconds: {}
  }]);
});

test("deriveRequestTimeline reports reviewer packet bytes against full frozen inputs", () => {
  const timeline = deriveRequestTimeline([
    event("ReviewBatchStarted", "2026-08-21T08:00:00.000Z", {
      batchId: "rev-sliced",
      inputRefs: [
        { path: "testcases/web/demo/plan.md", sizeBytes: 1000 },
        { path: "testcases/web/demo/cases.md", sizeBytes: 3000 }
      ],
      rolePackets: [
        { activityId: "case-review-combined", packetBytes: 900 },
        { activityId: "case-review-impact", packetBytes: 500 }
      ]
    }),
    event("ReviewerDispatched", "2026-08-21T08:01:00.000Z", {
      batchId: "rev-sliced", role: "combined", activityId: "case-review-combined"
    }),
    event("ReviewerDispatched", "2026-08-21T08:01:01.000Z", {
      batchId: "rev-sliced", role: "impact", activityId: "case-review-impact"
    })
  ]);
  assert.deepEqual(timeline.reviewerBatches, [{
    batchId: "rev-sliced",
    reReview: false,
    mode: "unknown",
    dispatchedReviewers: 0,
    reusedReviewers: 0,
    wallSeconds: 0,
    rawInputBytes: 8000,
    slicedInputBytes: 1400,
    savedInputBytes: 6600,
    inputSavingsRatio: 0.825,
    modelCalls: 0,
    modelSeconds: 0,
    budgetHits: 0,
    unclosedCalls: 0,
    roleModelSeconds: {}
  }]);
  assert.match(buildCostReport({
    timeline,
    sessions: [],
    degradations: [],
    window: { startMs: 0, endMs: 0, preSlackMinutes: 0, postSlackMinutes: 0 }
  }), /节省 6600 B（82\.5%）/);
});

test("deriveRequestTimeline captures reviewer model wall time and supplemental budget hits", () => {
  const timeline = deriveRequestTimeline([
    event("ReviewBatchStarted", "2026-08-21T08:00:00.000Z", { batchId: "rev-current" }),
    event("ReviewerModelCallStarted", "2026-08-21T08:01:00.000Z", {
      batchId: "rev-current", activityId: "case-review-combined", attempt: 1, supplemental: false
    }),
    event("ReviewerModelCallCompleted", "2026-08-21T08:04:00.000Z", {
      batchId: "rev-current", activityId: "case-review-combined", attempt: 1
    }),
    event("ReviewerModelCallStarted", "2026-08-21T08:04:10.000Z", {
      batchId: "rev-current", activityId: "case-review-combined", attempt: 1, supplemental: true
    }),
    event("ReviewerModelCallCompleted", "2026-08-21T08:05:10.000Z", {
      batchId: "rev-current", activityId: "case-review-combined", attempt: 1
    })
  ]);
  assert.equal(timeline.reviewerModelCalls.length, 2);
  assert.equal(timeline.reviewerModelCalls[0]?.seconds, 180);
  assert.equal(timeline.reviewerBatches[0]?.modelCalls, 2);
  assert.equal(timeline.reviewerBatches[0]?.modelSeconds, 240);
  assert.equal(timeline.reviewerBatches[0]?.budgetHits, 1);
});

test("deriveRequestTimeline keeps same-attempt reviewer calls isolated by batch", () => {
  const timeline = deriveRequestTimeline([
    event("ReviewerModelCallStarted", "2026-08-21T08:01:00.000Z", {
      batchId: "rev-original", activityId: "script-review-quality", attempt: 1, supplemental: false
    }),
    event("ReviewerModelCallCompleted", "2026-08-21T08:02:00.000Z", {
      batchId: "rev-original", activityId: "script-review-quality", attempt: 1
    }),
    event("ReviewerModelCallStarted", "2026-08-21T08:03:00.000Z", {
      batchId: "rev-repaired", activityId: "script-review-quality", attempt: 1, supplemental: false
    }),
    event("ReviewerModelCallCompleted", "2026-08-21T08:05:00.000Z", {
      batchId: "rev-repaired", activityId: "script-review-quality", attempt: 1
    })
  ]);
  assert.deepEqual(timeline.reviewerModelCalls.map((call) => call.seconds), [60, 120]);
  assert.ok(timeline.reviewerModelCalls.every((call) => call.completed));
});

test("deriveRequestTimeline reports v10 rereview reuse, role wall time, and human escalation", () => {
  const scope = {
    schemaVersion: "review-batch-scope-v1",
    mode: "targeted",
    baseBatchId: "rev-initial",
    semanticEvolutionCycle: 1,
    reusedReviewerEvidence: [{}]
  };
  const timeline = deriveRequestTimeline([
    event("ReviewBatchStarted", "2026-08-21T08:00:00.000Z", { batchId: "rev-initial", scope: { mode: "full" } }),
    event("ReviewBatchStarted", "2026-08-21T08:01:00.000Z", { batchId: "rev-rereview", scope }),
    event("ReviewerDispatched", "2026-08-21T08:02:00.000Z", { batchId: "rev-rereview", activityId: "case-review-impact", role: "impact" }),
    event("ReviewerModelCallStarted", "2026-08-21T08:02:00.000Z", { batchId: "rev-rereview", activityId: "case-review-impact", attempt: 1, supplemental: false }),
    event("ReviewerModelCallCompleted", "2026-08-21T08:05:00.000Z", { batchId: "rev-rereview", activityId: "case-review-impact", attempt: 1 }),
    event("ActivitySucceeded", "2026-08-21T08:06:00.000Z", { activityId: "case-review-resolution", outcome: "human_conflict" })
  ]);
  const rereview = timeline.reviewerBatches.find((batch) => batch.batchId === "rev-rereview");
  assert.equal(rereview?.mode, "targeted");
  assert.equal(rereview?.semanticEvolutionCycle, 1);
  assert.deepEqual(rereview?.roleModelSeconds, { impact: 180 });
  assert.equal(timeline.reviewerOptimization.rereviewBatches, 1);
  assert.equal(timeline.reviewerOptimization.fullRereviewFallbacks, 0);
  assert.equal(timeline.reviewerOptimization.humanConflictEscalations, 1);
});

test("deriveRequestTimeline 统计人工等待", () => {
  const timeline = deriveRequestTimeline(events);
  assert.equal(timeline.humanWaitSeconds, 270);
});

test("extractUsageRecord 只认 assistant/message 并读取终值", () => {
  const message = JSON.stringify({
    type: "assistant/message",
    time: 1787299929392,
    data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000 } }
  });
  const record = extractUsageRecord(message);
  assert.deepEqual(record, { timeMs: 1787299929392, inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000 });
  const chunk = JSON.stringify({
    type: "assistant/chunk",
    time: 1787299929393,
    data: { chunk: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000 } } }
  });
  assert.equal(extractUsageRecord(chunk), null, "chunk 携带的 usage 与 message 重复，必须去重");
  assert.equal(extractUsageRecord("{bad json"), null);
});

test("aggregateUsage 按时间窗过滤并求和", () => {
  const start = Date.parse("2026-08-21T08:00:00.000Z");
  const totals = aggregateUsage(
    [
      { timeMs: start, inputTokens: 10, outputTokens: 1, cacheReadTokens: 100 },
      { timeMs: start + 60_000, inputTokens: 20, outputTokens: 2, cacheReadTokens: 200 },
      { timeMs: start + 10 * 60_000, inputTokens: 999, outputTokens: 999, cacheReadTokens: 999 }
    ],
    start,
    start + 5 * 60_000
  );
  assert.deepEqual(totals, { calls: 2, inputTokens: 30, outputTokens: 3, cacheReadTokens: 300 });
});

test("usageWindowMs 应用前后松弛", () => {
  const timeline = deriveRequestTimeline(events);
  const window = usageWindowMs(timeline, 20 * 60_000, 10 * 60_000);
  assert.equal(window.startMs, Date.parse("2026-08-21T08:20:33.697Z") - 20 * 60_000);
  assert.equal(window.endMs, Date.parse("2026-08-21T09:07:35.507Z") + 10 * 60_000);
});

test("buildCostReport 渲染双口径且不含会话标识原文", () => {
  const timeline = deriveRequestTimeline(events);
  const report = buildCostReport({
    timeline,
    sessions: [
      { label: "reviewer rev-r1/combined", sessionIdMasked: "a1b2…", totals: { calls: 5, inputTokens: 43420, outputTokens: 22818, cacheReadTokens: 184448 } },
      { label: "未映射会话", sessionIdMasked: "c3d4…", totals: { calls: 40, inputTokens: 50000, outputTokens: 3000, cacheReadTokens: 90000 } }
    ],
    degradations: ["示例降级项"],
    window: { startMs: 0, endMs: 1, preSlackMinutes: 20, postSlackMinutes: 10 }
  });
  assert.match(report, /# 请求成本报告：web\/demo\/request-1/);
  assert.match(report, /candidate-generation \| 2 \|/);
  assert.match(report, /时间口径（按尝试）/);
  assert.match(report, /rev-r1 \| 首轮\/unknown \| 1 \| 旧记录 \| 0 \| 6\.9 min/);
  assert.match(report, /rev-r1 \| combined \| 旧记录 \| 6.9 min \| findings_present/);
  assert.match(report, /reviewer 代理视图 \| 当前活跃 0 · 历史累计 1 · 故障重派 0/);
  assert.match(report, /\| 总计 \| — \| 45 \| 93420 \| 25818 \| 274448 \|/);
  assert.match(report, /assistant\/message/);
  assert.match(report, /人工等待（callback） \| 4\.5 min/);
  assert.match(report, /活动累计工作量 \|/);
  assert.match(report, /重复尝试 \| 1 次/);
  assert.ok(!report.includes("a1b2c3d4-e5f6"), "不得包含会话标识原文");
});

test("成本报告区分首审、定向复审、故障重派与当前活跃 reviewer", () => {
  const timeline = deriveRequestTimeline([
    event("ReviewBatchStarted", "2026-08-28T08:00:00.000Z", { batchId: "script-r1" }),
    event("ReviewerDispatched", "2026-08-28T08:00:01.000Z", {
      batchId: "script-r1", activityId: "script-review-quality", role: "script_quality",
      dispatchKind: "initial", semanticRound: 0
    }),
    event("ReviewerSubmitted", "2026-08-28T08:00:20.000Z", {
      batchId: "script-r1", role: "script_quality", conclusion: "findings_present"
    }),
    event("ReviewBatchStarted", "2026-08-28T08:01:00.000Z", {
      batchId: "script-r2", scope: { baseBatchId: "script-r1", mode: "targeted" }
    }),
    event("ReviewerDispatched", "2026-08-28T08:01:01.000Z", {
      batchId: "script-r2", activityId: "script-review-quality", role: "script_quality",
      dispatchKind: "targeted_rereview", semanticRound: 1
    }),
    event("ReviewerDispatched", "2026-08-28T08:01:02.000Z", {
      batchId: "script-r2", activityId: "script-review-safety", role: "execution_safety",
      dispatchKind: "recovery_rebind", semanticRound: 1
    })
  ]);
  assert.equal(timeline.reviewerOptimization.historicalReviewerDispatches, 3);
  assert.equal(timeline.reviewerOptimization.activeReviewers, 2);
  assert.equal(timeline.reviewerOptimization.recoveryRedispatches, 1);
  assert.deepEqual(timeline.reviewerBatches.find((batch) => batch.batchId === "script-r2")?.dispatchKinds, {
    targeted_rereview: 1,
    recovery_rebind: 1
  });
});
