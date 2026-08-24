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

test("deriveRequestTimeline 汇总活动净耗时/跨度/浪费与漂移", () => {
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
  assert.equal(candidate.wasteSeconds, 25);
  assert.equal(candidate.driftEvents, 1);
  assert.equal(candidate.outcome, "ActivitySucceeded");
});

test("deriveRequestTimeline 配对 reviewer 派发与提交", () => {
  const timeline = deriveRequestTimeline(events);
  assert.equal(timeline.reviewerSpans.length, 1);
  const span = timeline.reviewerSpans[0]!;
  assert.equal(span.batchId, "rev-r1");
  assert.equal(span.role, "combined");
  assert.equal(span.seconds, 413);
  assert.equal(span.conclusion, "findings_present");
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
  assert.match(report, /rev-r1 \| combined \| 6.9 min \| findings_present/);
  assert.match(report, /\| 总计 \| — \| 45 \| 93420 \| 25818 \| 274448 \|/);
  assert.match(report, /assistant\/message/);
  assert.match(report, /人工等待（callback） \| 4\.5 min/);
  assert.ok(!report.includes("a1b2c3d4-e5f6"), "不得包含会话标识原文");
});
