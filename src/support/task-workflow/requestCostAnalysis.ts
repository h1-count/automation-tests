/**
 * 请求成本分析（request-cost-analysis-v1）。
 *
 * 从运行档案 workflow-history.ndjson 派生时间口径（活动净耗时/跨度/重试浪费、
 * reviewer 批次时长、人工等待），并聚合 DSH 会话日志的逐调用 token usage
 * （inputTokens/outputTokens/cacheReadTokens）。
 *
 * 本模块只做纯计算，不触 IO；会话目录扫描、zstd 解压与报告落盘在
 * scripts/analyze-request-cost.ts。所有输出只含数字、时间戳与标签，
 * 不含会话内容或标识原文（会话 ID 仅以 4 位掩码呈现）。
 */

export const REQUEST_COST_ANALYSIS_SCHEMA_VERSION = "request-cost-analysis-v1";

export type HistoryEventLike = {
  type: string;
  occurredAt?: unknown;
  requestId?: unknown;
  payload?: Record<string, unknown>;
};

export type UsageRecord = {
  timeMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type ActivityCost = {
  activityId: string;
  attempts: number;
  busySeconds: number;
  wallSeconds: number;
  wasteSeconds: number;
  driftEvents: number;
  outcome: string;
};

export type ReviewerSpan = {
  batchId: string;
  role: string;
  seconds: number;
  conclusion: string;
};

export type RequestTimeline = {
  requestId: string;
  startedAt: string;
  endedAt: string;
  completed: boolean;
  wallSeconds: number;
  activities: ActivityCost[];
  reviewerSpans: ReviewerSpan[];
  humanWaitSeconds: number;
};

export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function secondsBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, (to - from) / 1000);
}

export function parseJsonl(text: string): HistoryEventLike[] {
  const events: HistoryEventLike[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        events.push(parsed as HistoryEventLike);
      }
    } catch {
      // 忽略无法解析的行（尾写半行等），报告口径以可解析事件为准。
    }
  }
  return events;
}

/**
 * 从 workflow 事件派生时间口径。事件按文件序（即 seq 序）处理；
 * occurredAt 缺失的事件跳过时长统计但保留计数。
 */
export function deriveRequestTimeline(events: HistoryEventLike[]): RequestTimeline {
  const activityStarts = new Map<string, string>();
  const activity = new Map<string, { attempts: number; busy: number; first?: string; last?: string; outcome: string; drift: number }>();
  const openDispatches = new Map<string, string[]>();
  const openCallbacks = new Map<string, string>();
  const reviewerSpans: ReviewerSpan[] = [];
  let startedAt = "";
  let endedAt = "";
  let completed = false;
  let requestId = "";
  let humanWait = 0;

  const touch = (id: string): {
    attempts: number; busy: number; first?: string; last?: string; outcome: string; drift: number;
  } => {
    const current = activity.get(id) ?? { attempts: 0, busy: 0, outcome: "", drift: 0 };
    activity.set(id, current);
    return current;
  };

  for (const event of events) {
    const occurredAt = asString(event.occurredAt);
    const payload = event.payload ?? {};
    const activityId = asString(payload.activityId);
    if (!requestId) requestId = asString(event.requestId) ?? "";
    if (occurredAt && (!startedAt || occurredAt < startedAt)) startedAt = occurredAt;

    switch (event.type) {
      case "WorkflowStarted":
        requestId = asString(event.requestId) ?? requestId;
        break;
      case "ActivityAttemptStarted":
        if (!activityId || !occurredAt) break;
        activityStarts.set(`${activityId}#${asNumber(payload.attempt) ?? activityStarts.size}`, occurredAt);
        const started = touch(activityId);
        started.attempts += 1;
        started.first = started.first ?? occurredAt;
        break;
      case "ActivitySucceeded":
      case "ActivityFailed": {
        if (!activityId || !occurredAt) break;
        const attemptKey = `${activityId}#${asNumber(payload.attempt) ?? 0}`;
        const start = activityStarts.get(attemptKey) ?? activityStarts.get(`${activityId}#0`);
        const record = touch(activityId);
        if (start) record.busy += secondsBetween(start, occurredAt);
        record.last = occurredAt;
        record.outcome = event.type;
        activityStarts.delete(attemptKey);
        break;
      }
      case "ArtifactDriftDetected":
        if (activityId) touch(activityId).drift += 1;
        break;
      case "ReviewerDispatched": {
        const batchId = asString(payload.batchId);
        const role = asString(payload.role) ?? "";
        if (!occurredAt || !batchId) break;
        const key = `${batchId}::${role}`;
        const queue = openDispatches.get(key) ?? [];
        queue.push(occurredAt);
        openDispatches.set(key, queue);
        break;
      }
      case "ReviewerSubmitted": {
        const batchId = asString(payload.batchId);
        const role = asString(payload.role) ?? "";
        if (!occurredAt || !batchId) break;
        const queue = openDispatches.get(`${batchId}::${role}`) ?? [];
        const dispatchAt = queue.shift();
        if (dispatchAt) {
          reviewerSpans.push({
            batchId,
            role,
            seconds: Math.round(secondsBetween(dispatchAt, occurredAt)),
            conclusion: asString(payload.conclusion) ?? ""
          });
        }
        break;
      }
      case "CallbackRequested": {
        const callbackId = asString(payload.callbackId);
        if (callbackId && occurredAt) openCallbacks.set(callbackId, occurredAt);
        break;
      }
      case "CallbackResolved": {
        const callbackId = asString(payload.callbackId);
        const requested = callbackId ? openCallbacks.get(callbackId) : undefined;
        if (requested && occurredAt) humanWait += secondsBetween(requested, occurredAt);
        if (callbackId) openCallbacks.delete(callbackId);
        break;
      }
      case "WorkflowCompleted":
        completed = true;
        break;
      default:
        break;
    }
    if (occurredAt && (!endedAt || occurredAt > endedAt)) endedAt = occurredAt;
  }

  const activities: ActivityCost[] = [...activity.entries()]
    .map(([id, record]) => ({
      activityId: id,
      attempts: record.attempts,
      busySeconds: Math.round(record.busy),
      wallSeconds: record.first && record.last ? Math.round(secondsBetween(record.first, record.last)) : 0,
      wasteSeconds: record.first && record.last
        ? Math.max(0, Math.round(secondsBetween(record.first, record.last) - record.busy))
        : 0,
      driftEvents: record.drift,
      outcome: record.outcome
    }))
    .sort((left, right) => left.activityId.localeCompare(right.activityId));

  return {
    requestId,
    startedAt,
    endedAt,
    completed,
    wallSeconds: startedAt && endedAt ? Math.round(secondsBetween(startedAt, endedAt)) : 0,
    activities,
    reviewerSpans,
    humanWaitSeconds: Math.round(humanWait)
  };
}

/**
 * 从 DSH 会话日志单行提取 usage 记录。
 * 去重口径：只认 `assistant/message`（每模型调用一条终值）；
 * `assistant/chunk` 中的 usage 与 message 重复，不计数。
 */
export function extractUsageRecord(line: string): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { type?: unknown; time?: unknown; data?: { usage?: Record<string, unknown> } };
  if (record.type !== "assistant/message") return null;
  const usage = record.data?.usage;
  const timeMs = asNumber(record.time);
  if (!usage || timeMs === undefined) return null;
  const inputTokens = asNumber(usage.inputTokens) ?? 0;
  const outputTokens = asNumber(usage.outputTokens) ?? 0;
  const cacheReadTokens = asNumber(usage.cacheReadTokens) ?? 0;
  return { timeMs, inputTokens, outputTokens, cacheReadTokens };
}

export function aggregateUsage(records: UsageRecord[], windowStartMs: number, windowEndMs: number): UsageTotals {
  const totals: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  for (const record of records) {
    if (record.timeMs < windowStartMs || record.timeMs > windowEndMs) continue;
    totals.calls += 1;
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
  }
  return totals;
}

export function usageWindowMs(timeline: RequestTimeline, preSlackMs: number, postSlackMs: number): {
  startMs: number;
  endMs: number;
} {
  const start = Date.parse(timeline.startedAt);
  const end = Date.parse(timeline.endedAt);
  return {
    startMs: (Number.isNaN(start) ? 0 : start) - preSlackMs,
    endMs: (Number.isNaN(end) ? Date.now() : end) + postSlackMs
  };
}

export function maskSessionId(sessionId: string): string {
  return sessionId.length <= 4 ? sessionId : `${sessionId.slice(0, 4)}…`;
}

export type CostReportInput = {
  timeline: RequestTimeline;
  sessions: Array<{ label: string; sessionIdMasked: string; totals: UsageTotals }>;
  degradations: string[];
  window: { startMs: number; endMs: number; preSlackMinutes: number; postSlackMinutes: number };
};

function formatMinutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min`;
}

export function buildCostReport(input: CostReportInput): string {
  const { timeline, sessions, degradations, window } = input;
  const retryWaste = timeline.activities.reduce((sum, item) => sum + item.wasteSeconds, 0);
  const totals = sessions.reduce<UsageTotals>(
    (acc, item) => ({
      calls: acc.calls + item.totals.calls,
      inputTokens: acc.inputTokens + item.totals.inputTokens,
      outputTokens: acc.outputTokens + item.totals.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + item.totals.cacheReadTokens
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  );

  const lines: string[] = [];
  lines.push(`# 请求成本报告：${timeline.requestId || "(未知请求)"}`, "");
  lines.push(`> 口径版本：${REQUEST_COST_ANALYSIS_SCHEMA_VERSION}。只含数字、时间戳与标签，不含会话内容或标识原文。`, "");
  lines.push("## 概览", "");
  lines.push("| 指标 | 值 |", "| --- | --- |");
  lines.push(`| 工作流窗口 | ${timeline.startedAt} → ${timeline.endedAt}（${formatMinutes(timeline.wallSeconds)}） |`);
  lines.push(`| 终态 | ${timeline.completed ? "WorkflowCompleted" : "未终态"} |`);
  lines.push(`| 重试/漂移空闲（按活动求和，可大于 wall） | ${formatMinutes(retryWaste)}（${timeline.activities.reduce((sum, item) => sum + item.driftEvents, 0)} 次漂移） |`);
  lines.push(`| 人工等待（callback） | ${formatMinutes(timeline.humanWaitSeconds)} |`);
  lines.push(`| token 总计（窗口内） | 调用 ${totals.calls} · input ${totals.inputTokens} · output ${totals.outputTokens} · cacheRead ${totals.cacheReadTokens} |`, "");
  lines.push("## 时间口径（按活动）", "");
  lines.push("| 活动 | 尝试 | 净耗时 | 跨度 | 浪费 | 漂移 | 终态 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of timeline.activities) {
    lines.push(`| ${item.activityId} | ${item.attempts} | ${formatMinutes(item.busySeconds)} | ${formatMinutes(item.wallSeconds)} | ${formatMinutes(item.wasteSeconds)} | ${item.driftEvents} | ${item.outcome || "—"} |`);
  }
  lines.push("", "## reviewer 批次", "");
  lines.push("| 批次 | 角色 | 时长 | 结论 |", "| --- | --- | --- | --- |");
  if (timeline.reviewerSpans.length === 0) {
    lines.push("| 无 | — | — | — |");
  }
  for (const span of timeline.reviewerSpans) {
    lines.push(`| ${span.batchId} | ${span.role} | ${formatMinutes(span.seconds)} | ${span.conclusion || "—"} |`);
  }
  lines.push("", `## Token 口径（DSH 会话；窗口 = 起点−${window.preSlackMinutes}min → 终点+${window.postSlackMinutes}min）`, "");
  lines.push("| 会话 | 标签 | 调用 | input | output | cacheRead |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const session of sessions) {
    lines.push(`| ${session.sessionIdMasked} | ${session.label} | ${session.totals.calls} | ${session.totals.inputTokens} | ${session.totals.outputTokens} | ${session.totals.cacheReadTokens} |`);
  }
  lines.push(`| 总计 | — | ${totals.calls} | ${totals.inputTokens} | ${totals.outputTokens} | ${totals.cacheReadTokens} |`);
  lines.push("", "## 降级与口径说明", "");
  lines.push("- token 去重口径：仅计会话日志 `assistant/message` 记录（每模型调用一条）；`assistant/chunk` 携带的 usage 与之重复，不计数。");
  lines.push("- 会话扫描按时间窗过滤；与请求并发的外部会话可能混入，按行人工甄别（标签列标注 reviewer 映射）。");
  if (degradations.length > 0) {
    for (const note of degradations) lines.push(`- ${note}`);
  } else {
    lines.push("- 无降级项。");
  }
  lines.push("");
  return lines.join("\n");
}
