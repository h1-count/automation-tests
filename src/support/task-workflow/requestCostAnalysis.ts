/**
 * 请求成本分析（request-cost-analysis-v5）。
 *
 * 从运行档案 workflow-history.ndjson 派生时间口径（活动净耗时/跨度/重试浪费、
 * reviewer 批次时长、人工等待），并聚合 DSH 会话日志的逐调用 token usage
 * （inputTokens/outputTokens/cacheReadTokens）。
 *
 * 本模块只做纯计算，不触 IO；会话目录扫描、zstd 解压与报告落盘在
 * scripts/analyze-request-cost.ts。所有输出只含数字、时间戳与标签，
 * 不含会话内容或标识原文（会话 ID 仅以 4 位掩码呈现）。
 */

export const REQUEST_COST_ANALYSIS_SCHEMA_VERSION = "request-cost-analysis-v5";

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
  attemptDetails: ActivityAttemptCost[];
};

/** A completed attempt. `attemptInferred` marks legacy success events that
 * omitted the attempt number and were paired with the latest open attempt. */
export type ActivityAttemptCost = {
  attempt: number;
  seconds: number;
  outcome: "succeeded" | "failed";
  attemptInferred: boolean;
};

export type ReviewerSpan = {
  batchId: string;
  role: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  conclusion: string;
};

export type ReviewerBatchTiming = {
  batchId: string;
  reReview: boolean;
  dispatchedReviewers: number;
  reusedReviewers: number;
  wallSeconds: number;
  /** Full frozen inputs that dispatched reviewers would otherwise receive. */
  rawInputBytes: number;
  /** Actual role packet bytes issued at dispatch. */
  slicedInputBytes: number;
  savedInputBytes: number;
  inputSavingsRatio: number;
};

export type CandidateGenerationTiming = {
  skeletonSeconds: number;
  fragmentBusySeconds: number;
  fragmentWallSeconds: number;
  fragmentCriticalPathSeconds: number;
  assemblySeconds: number;
  fragmentCount: number;
};

export type RequestTimeline = {
  requestId: string;
  startedAt: string;
  endedAt: string;
  completed: boolean;
  wallSeconds: number;
  activities: ActivityCost[];
  candidateGeneration: CandidateGenerationTiming;
  reviewerSpans: ReviewerSpan[];
  reviewerBatches: ReviewerBatchTiming[];
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
  const activityStarts = new Map<string, Map<number, string>>();
  const activity = new Map<string, {
    attempts: number;
    busy: number;
    first?: string;
    last?: string;
    outcome: string;
    drift: number;
    attemptDetails: ActivityAttemptCost[];
  }>();
  const openDispatches = new Map<string, string[]>();
  const openCallbacks = new Map<string, string>();
  const reviewerSpans: ReviewerSpan[] = [];
  const reviewerBatches = new Map<string, {
    reReview: boolean;
    reusedReviewers: number;
    inputBytes: number;
    packetBytesByActivity: Map<string, number>;
  }>();
  const reviewerDispatchActivities = new Map<string, string[]>();
  let startedAt = "";
  let endedAt = "";
  let completed = false;
  let requestId = "";
  let humanWait = 0;

  const touch = (id: string) => {
    const current = activity.get(id) ?? {
      attempts: 0,
      busy: 0,
      outcome: "",
      drift: 0,
      attemptDetails: []
    };
    activity.set(id, current);
    return current;
  };

  const latestOpenAttempt = (activityId: string): number | undefined => {
    const openAttempts = activityStarts.get(activityId);
    if (!openAttempts?.size) return undefined;
    return [...openAttempts.keys()].sort((left, right) => right - left)[0];
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
        const started = touch(activityId);
        const declaredAttempt = asNumber(payload.attempt);
        const attempt = Number.isInteger(declaredAttempt) && declaredAttempt! > 0
          ? declaredAttempt!
          : started.attempts + 1;
        const openAttempts = activityStarts.get(activityId) ?? new Map<number, string>();
        openAttempts.set(attempt, occurredAt);
        activityStarts.set(activityId, openAttempts);
        started.attempts += 1;
        started.first = started.first ?? occurredAt;
        break;
      case "ActivitySucceeded":
      case "ActivityFailed": {
        if (!activityId || !occurredAt) break;
        const declaredAttempt = asNumber(payload.attempt);
        const attemptInferred = !Number.isInteger(declaredAttempt) || declaredAttempt! <= 0;
        const attempt = attemptInferred ? latestOpenAttempt(activityId) : declaredAttempt!;
        const openAttempts = activityStarts.get(activityId);
        const start = attempt === undefined ? undefined : openAttempts?.get(attempt);
        const record = touch(activityId);
        if (start && attempt !== undefined) {
          const seconds = Math.round(secondsBetween(start, occurredAt));
          record.busy += seconds;
          record.attemptDetails.push({
            attempt,
            seconds,
            outcome: event.type === "ActivitySucceeded" ? "succeeded" : "failed",
            attemptInferred
          });
          openAttempts?.delete(attempt);
          if (openAttempts?.size === 0) activityStarts.delete(activityId);
        }
        record.last = occurredAt;
        record.outcome = event.type;
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
        const activityId = asString(payload.activityId);
        if (activityId) {
          const dispatched = reviewerDispatchActivities.get(batchId) ?? [];
          dispatched.push(activityId);
          reviewerDispatchActivities.set(batchId, dispatched);
        }
        break;
      }
      case "ReviewBatchStarted": {
        const batchId = asString(payload.batchId);
        const scope = payload.scope;
        if (!batchId) break;
        const scopeRecord = scope && typeof scope === "object" && !Array.isArray(scope)
          ? scope as Record<string, unknown>
          : undefined;
        const reused = Array.isArray(scopeRecord?.reusedReviewerEvidence)
          ? scopeRecord!.reusedReviewerEvidence.length
          : 0;
        reviewerBatches.set(batchId, {
          reReview: typeof scopeRecord?.baseBatchId === "string",
          reusedReviewers: reused,
          inputBytes: Array.isArray(payload.inputRefs)
            ? payload.inputRefs.reduce((sum, value) => {
                const size = value && typeof value === "object" && !Array.isArray(value)
                  ? asNumber((value as Record<string, unknown>).sizeBytes) ?? 0
                  : 0;
                return sum + Math.max(0, size);
              }, 0)
            : 0,
          packetBytesByActivity: new Map(
            Array.isArray(payload.rolePackets)
              ? payload.rolePackets.flatMap((value) => {
                  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
                  const packet = value as Record<string, unknown>;
                  const activityId = asString(packet.activityId);
                  const packetBytes = asNumber(packet.packetBytes);
                  return activityId && packetBytes !== undefined && packetBytes >= 0
                    ? [[activityId, packetBytes] as const]
                    : [];
                })
              : []
          )
        });
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
            startedAt: dispatchAt,
            endedAt: occurredAt,
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
      outcome: record.outcome,
      attemptDetails: [...record.attemptDetails].sort((left, right) => left.attempt - right.attempt)
    }))
    .sort((left, right) => left.activityId.localeCompare(right.activityId));
  const byActivity = new Map(activities.map((item) => [item.activityId, item]));
  const fragmentRecords = [...activity.entries()]
    .filter(([id]) => id.startsWith("candidate-fragment-"));
  const fragmentFirst = fragmentRecords.map(([, item]) => item.first).filter((value): value is string => Boolean(value));
  const fragmentLast = fragmentRecords.map(([, item]) => item.last).filter((value): value is string => Boolean(value));
  const fragmentWallSeconds = fragmentFirst.length && fragmentLast.length
    ? Math.round(secondsBetween(fragmentFirst.sort()[0]!, fragmentLast.sort().at(-1)!))
    : 0;
  const candidateGeneration: CandidateGenerationTiming = {
    skeletonSeconds: byActivity.get("candidate-skeleton")?.busySeconds ?? 0,
    fragmentBusySeconds: fragmentRecords.reduce((sum, [, item]) => sum + Math.round(item.busy), 0),
    fragmentWallSeconds,
    fragmentCriticalPathSeconds: Math.max(0, ...fragmentRecords.map(([, item]) =>
      item.first && item.last ? Math.round(secondsBetween(item.first, item.last)) : 0
    )),
    assemblySeconds: byActivity.get("candidate-assemble")?.busySeconds ?? 0,
    fragmentCount: fragmentRecords.length
  };
  const reviewerBatchTimings: ReviewerBatchTiming[] = [...reviewerBatches.entries()]
    .map(([batchId, metadata]) => {
      const spans = reviewerSpans.filter((span) => span.batchId === batchId);
      const starts = spans.map((span) => span.startedAt).sort();
      const ends = spans.map((span) => span.endedAt).sort();
      const dispatchedActivities = reviewerDispatchActivities.get(batchId) ?? [];
      const rawInputBytes = metadata.inputBytes * dispatchedActivities.length;
      const slicedInputBytes = dispatchedActivities.reduce(
        (sum, activityId) => sum + (metadata.packetBytesByActivity.get(activityId) ?? metadata.inputBytes),
        0
      );
      const savedInputBytes = rawInputBytes - slicedInputBytes;
      return {
        batchId,
        reReview: metadata.reReview,
        dispatchedReviewers: spans.length,
        reusedReviewers: metadata.reusedReviewers,
        wallSeconds: starts.length && ends.length
          ? Math.round(secondsBetween(starts[0]!, ends.at(-1)!))
          : 0,
        rawInputBytes,
        slicedInputBytes,
        savedInputBytes,
        inputSavingsRatio: rawInputBytes === 0 ? 0 : savedInputBytes / rawInputBytes
      };
    })
    .sort((left, right) => left.batchId.localeCompare(right.batchId));

  return {
    requestId,
    startedAt,
    endedAt,
    completed,
    wallSeconds: startedAt && endedAt ? Math.round(secondsBetween(startedAt, endedAt)) : 0,
    activities,
    candidateGeneration,
    reviewerSpans,
    reviewerBatches: reviewerBatchTimings,
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
  const reviewerRawBytes = timeline.reviewerBatches.reduce((sum, batch) => sum + batch.rawInputBytes, 0);
  const reviewerSlicedBytes = timeline.reviewerBatches.reduce((sum, batch) => sum + batch.slicedInputBytes, 0);
  const reviewerSavedBytes = reviewerRawBytes - reviewerSlicedBytes;
  lines.push(`| reviewer 输入分片 | 原始 ${reviewerRawBytes} B · 分发 ${reviewerSlicedBytes} B · 节省 ${reviewerSavedBytes} B（${reviewerRawBytes === 0 ? "0.0" : ((reviewerSavedBytes / reviewerRawBytes) * 100).toFixed(1)}%） |`);
  lines.push(`| token 总计（窗口内） | 调用 ${totals.calls} · input ${totals.inputTokens} · output ${totals.outputTokens} · cacheRead ${totals.cacheReadTokens} |`, "");
  lines.push("## 候选分片关键路径", "");
  lines.push("| 骨架 | 分片数 | 分片净耗时合计 | 分片墙钟 | 分片关键路径 | 汇总 |",
    "| --- | --- | --- | --- | --- | --- |");
  lines.push(`| ${formatMinutes(timeline.candidateGeneration.skeletonSeconds)} | ${timeline.candidateGeneration.fragmentCount} | ${formatMinutes(timeline.candidateGeneration.fragmentBusySeconds)} | ${formatMinutes(timeline.candidateGeneration.fragmentWallSeconds)} | ${formatMinutes(timeline.candidateGeneration.fragmentCriticalPathSeconds)} | ${formatMinutes(timeline.candidateGeneration.assemblySeconds)} |`, "");
  lines.push("## 时间口径（按活动）", "");
  lines.push("| 活动 | 尝试 | 净耗时 | 跨度 | 浪费 | 漂移 | 终态 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of timeline.activities) {
    lines.push(`| ${item.activityId} | ${item.attempts} | ${formatMinutes(item.busySeconds)} | ${formatMinutes(item.wallSeconds)} | ${formatMinutes(item.wasteSeconds)} | ${item.driftEvents} | ${item.outcome || "—"} |`);
  }
  lines.push("", "## 时间口径（按尝试）", "");
  lines.push("| 活动 | 尝试 | 耗时 | 结束 | attempt 来源 |", "| --- | --- | --- | --- | --- |");
  const attempts = timeline.activities.flatMap((item) => item.attemptDetails.map((attempt) => ({
    activityId: item.activityId,
    ...attempt
  })));
  if (!attempts.length) {
    lines.push("| 无可配对尝试 | — | — | — | — |");
  }
  for (const attempt of attempts) {
    lines.push(`| ${attempt.activityId} | ${attempt.attempt} | ${formatMinutes(attempt.seconds)} | ${attempt.outcome} | ${attempt.attemptInferred ? "从历史事件推断" : "事件声明"} |`);
  }
  lines.push("", "## reviewer 批次", "");
  lines.push("| 批次 | 类型 | 已派发 | 复用免派 | 墙钟 | 原始输入 | 分片输入 | 节省 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  if (timeline.reviewerBatches.length === 0) {
    lines.push("| 无 | — | — | — | — | — | — | — |");
  }
  for (const batch of timeline.reviewerBatches) {
    lines.push(`| ${batch.batchId} | ${batch.reReview ? "复审" : "首轮"} | ${batch.dispatchedReviewers} | ${batch.reusedReviewers} | ${formatMinutes(batch.wallSeconds)} | ${batch.rawInputBytes} B | ${batch.slicedInputBytes} B | ${batch.savedInputBytes} B（${(batch.inputSavingsRatio * 100).toFixed(1)}%） |`);
  }
  lines.push("", "## reviewer 派发明细", "");
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
