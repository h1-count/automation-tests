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
  /** Only retry/reconciliation idle intervals, never unrelated reviewer wait. */
  retryIdleSeconds: number;
  driftEvents: number;
  outcome: string;
  attemptDetails: ActivityAttemptCost[];
};

/** A completed activity attempt declared by the current workflow event contract. */
export type ActivityAttemptCost = {
  attempt: number;
  seconds: number;
  outcome: "succeeded" | "failed";
  /** Model timing is absent when the activity did not emit a generation start. */
  modelSeconds?: number;
};

export type ReviewerSpan = {
  batchId: string;
  role: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  conclusion: string;
};

export type ReviewerModelCallTiming = {
  batchId: string;
  activityId: string;
  attempt: number;
  supplemental: boolean;
  seconds?: number;
  completed: boolean;
};

export type ReviewerBatchTiming = {
  batchId: string;
  reReview: boolean;
  mode: "full" | "targeted" | "unknown";
  semanticEvolutionCycle?: number;
  dispatchedReviewers: number;
  reusedReviewers: number;
  wallSeconds: number;
  /** Full frozen inputs that dispatched reviewers would otherwise receive. */
  rawInputBytes: number;
  /** Actual role packet bytes issued at dispatch. */
  slicedInputBytes: number;
  savedInputBytes: number;
  inputSavingsRatio: number;
  modelCalls: number;
  modelSeconds: number;
  budgetHits: number;
  unclosedCalls: number;
  roleModelSeconds: Record<string, number>;
};

export type ReviewerOptimizationTiming = {
  initialBatches: number;
  rereviewBatches: number;
  fullRereviewFallbacks: number;
  humanConflictEscalations: number;
  criticalPathSeconds: number;
};

export type CandidateGenerationTiming = {
  compilerSeconds: number;
  compilerModelSeconds: number;
  skeletonSeconds: number;
  skeletonModelSeconds: number;
  fragmentBusySeconds: number;
  fragmentModelSeconds: number;
  fragmentWallSeconds: number;
  fragmentCriticalPathSeconds: number;
  assemblySeconds: number;
  fragmentCount: number;
  deterministicFragmentCount: number;
  modelFragmentCount: number;
  modelTimingCapturedActivities: number;
  modelTimingExpectedActivities: number;
  modelCalls: number;
  modelTimingCapturedCalls: number;
  deterministicCaseCount: number;
  modelCaseCount: number;
  deterministicClauseCount: number;
  modelClauseCount: number;
};

export type ModelCallObservability = {
  candidateCalls: number;
  reviewerCalls: number;
  reviewerTimingCapturedCalls: number;
};

export type RequestTimeline = {
  requestId: string;
  startedAt: string;
  endedAt: string;
  completed: boolean;
  wallSeconds: number;
  activities: ActivityCost[];
  candidateGeneration: CandidateGenerationTiming;
  modelCalls: ModelCallObservability;
  reviewerSpans: ReviewerSpan[];
  reviewerModelCalls: ReviewerModelCallTiming[];
  reviewerBatches: ReviewerBatchTiming[];
  reviewerOptimization: ReviewerOptimizationTiming;
  runIntent?: {
    decision: string;
    suiteId: string;
    digest: string;
    designExecutionReuse?: boolean;
  };
  reviewWorkbook: {
    published: boolean;
    cacheHits: number;
    cacheMisses: number;
    cacheFallbacks: number;
    renderSeconds: number;
  };
  readinessDiagnostics: {
    immutableInputBlocks: number;
    hostOrphans: number;
    environmentDeferred: number;
  };
  humanWaitSeconds: number;
  retryIdleSeconds: number;
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
  const generationStarts = new Map<string, Map<number, string>>();
  const candidateModelCallKeys = new Set<string>();
  const candidateModelTimedCallKeys = new Set<string>();
  const retryStarts = new Map<string, string[]>();
  const retryIntervals: Array<{ start: string; end: string }> = [];
  const activity = new Map<string, {
    attempts: number;
    busy: number;
    first?: string;
    last?: string;
    outcome: string;
    drift: number;
    retryIdle: number;
    attemptDetails: ActivityAttemptCost[];
  }>();
  const openDispatches = new Map<string, string[]>();
  const openCallbacks = new Map<string, string>();
  const reviewerSpans: ReviewerSpan[] = [];
  const reviewerModelCalls: ReviewerModelCallTiming[] = [];
  const openReviewerModelCalls = new Map<string, { call: ReviewerModelCallTiming; startedAt: string }>();
  const reviewerBatches = new Map<string, {
    reReview: boolean;
    mode: ReviewerBatchTiming["mode"];
    semanticEvolutionCycle?: number;
    reusedReviewers: number;
    inputBytes: number;
    packetBytesByActivity: Map<string, number>;
  }>();
  const reviewerDispatchActivities = new Map<string, string[]>();
  const reviewerRoles = new Map<string, string>();
  const deterministicFragments = new Set<string>();
  let deterministicCaseCount = 0;
  let modelCaseCount = 0;
  let deterministicClauseCount = 0;
  let modelClauseCount = 0;
  let runIntent: RequestTimeline["runIntent"];
  let startedAt = "";
  let endedAt = "";
  let completed = false;
  let requestId = "";
  let humanWait = 0;
  let humanConflictEscalations = 0;
  const reviewWorkbook = { published: false, cacheHits: 0, cacheMisses: 0, cacheFallbacks: 0, renderSeconds: 0 };
  const readinessDiagnostics = { immutableInputBlocks: 0, hostOrphans: 0, environmentDeferred: 0 };

  const touch = (id: string) => {
    const current = activity.get(id) ?? {
      attempts: 0,
      busy: 0,
      outcome: "",
      drift: 0,
      retryIdle: 0,
      attemptDetails: []
    };
    activity.set(id, current);
    return current;
  };

  for (const event of events) {
    if (event.type === "TestcaseReviewWorkbookPublished") {
      reviewWorkbook.published = true;
      if (event.payload?.cacheStatus === "hit") reviewWorkbook.cacheHits += 1;
      if (event.payload?.cacheStatus === "miss") reviewWorkbook.cacheMisses += 1;
      if (event.payload?.cacheStatus === "rebuild") reviewWorkbook.cacheFallbacks += 1;
      reviewWorkbook.renderSeconds += (asNumber(event.payload?.renderMilliseconds) ?? 0) / 1000;
    }
    const occurredAt = asString(event.occurredAt);
    const payload = event.payload ?? {};
    const activityId = asString(payload.activityId);
    if (event.type === "ArtifactDriftDetected" && activityId === "readiness" && payload.recovery === "reconcile_before_retry") {
      readinessDiagnostics.hostOrphans += 1;
    }
    if (event.type === "ActivityFailed" && activityId === "readiness-preflight"
      && typeof payload.summary === "string" && payload.summary.startsWith("immutable_input_incompatible:")) {
      readinessDiagnostics.immutableInputBlocks += 1;
    }
    if (event.type === "ActivityFailed" && activityId === "readiness"
      && typeof payload.summary === "string" && payload.summary.startsWith("No runnable")) {
      readinessDiagnostics.environmentDeferred += 1;
    }
    if (!requestId) requestId = asString(event.requestId) ?? "";
    if (occurredAt && (!startedAt || occurredAt < startedAt)) startedAt = occurredAt;

    switch (event.type) {
      case "CandidateGraphExpanded": {
        const additions = Array.isArray(payload.activities) ? payload.activities : [];
        for (const value of additions) {
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          const record = value as Record<string, unknown>;
          const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
            ? record.metadata as Record<string, unknown> : undefined;
          if (record.kind === "candidate_fragment" && typeof record.id === "string" && metadata?.generationMode === "deterministic") {
            deterministicFragments.add(record.id);
          }
          if (record.kind === "candidate_fragment" && metadata) {
            deterministicCaseCount += Array.isArray(metadata.deterministicCaseIds) ? metadata.deterministicCaseIds.length : 0;
            modelCaseCount += Array.isArray(metadata.modelCaseIds) ? metadata.modelCaseIds.length : 0;
            deterministicClauseCount += Array.isArray(metadata.deterministicClauseIds) ? metadata.deterministicClauseIds.length : 0;
            modelClauseCount += Array.isArray(metadata.modelClauseIds) ? metadata.modelClauseIds.length : 0;
          }
        }
        break;
      }
      case "WorkflowStarted":
        requestId = asString(event.requestId) ?? requestId;
        break;
      case "ActivityAttemptStarted":
        if (!activityId || !occurredAt) break;
        const started = touch(activityId);
        const declaredAttempt = asNumber(payload.attempt);
        if (!Number.isInteger(declaredAttempt) || declaredAttempt! <= 0) break;
        const attempt = declaredAttempt!;
        const openAttempts = activityStarts.get(activityId) ?? new Map<number, string>();
        openAttempts.set(attempt, occurredAt);
        activityStarts.set(activityId, openAttempts);
        started.attempts += 1;
        started.first = started.first ?? occurredAt;
        const pendingRetry = retryStarts.get(activityId)?.shift();
        if (pendingRetry) {
          const seconds = Math.round(secondsBetween(pendingRetry, occurredAt));
          started.retryIdle += seconds;
          retryIntervals.push({ start: pendingRetry, end: occurredAt });
        }
        break;
      case "CandidateGenerationStarted": {
        if (!activityId || !occurredAt) break;
        const attempt = asNumber(payload.attempt);
        if (!Number.isInteger(attempt) || attempt! <= 0) break;
        const starts = generationStarts.get(activityId) ?? new Map<number, string>();
        starts.set(attempt!, occurredAt);
        generationStarts.set(activityId, starts);
        candidateModelCallKeys.add(`${activityId}/${attempt}`);
        break;
      }
      case "RunIntentDerived": {
        const decision = asString(payload.decision);
        const suiteId = asString(payload.suiteId);
        const digest = asString(payload.digest);
        if (decision && suiteId && digest) {
          runIntent = {
            decision,
            suiteId,
            digest,
            ...(
              decision === "design_reconfirm"
              && ["script_only", "full_run"].includes(asString(payload.deliveryTarget) ?? "")
                ? { designExecutionReuse: true }
                : {}
            )
          };
        }
        break;
      }
      case "ActivitySucceeded":
        if (activityId === "case-review-resolution" && payload.outcome === "human_conflict") {
          humanConflictEscalations += 1;
        }
      case "ActivityFailed": {
        if (!activityId || !occurredAt) break;
        const declaredAttempt = asNumber(payload.attempt);
        if (!Number.isInteger(declaredAttempt) || declaredAttempt! <= 0) break;
        const attempt = declaredAttempt!;
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
            ...(generationStarts.get(activityId)?.get(attempt)
              ? { modelSeconds: Math.round(secondsBetween(generationStarts.get(activityId)!.get(attempt)!, occurredAt)) }
              : {})
          });
          if (generationStarts.get(activityId)?.get(attempt)) {
            candidateModelTimedCallKeys.add(`${activityId}/${attempt}`);
          }
          generationStarts.get(activityId)?.delete(attempt);
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
      case "RetryScheduled":
        if (activityId && occurredAt) {
          const starts = retryStarts.get(activityId) ?? [];
          starts.push(occurredAt);
          retryStarts.set(activityId, starts);
        }
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
          if (role) reviewerRoles.set(`${batchId}::${activityId}`, role);
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
          mode: scopeRecord?.mode === "full" || scopeRecord?.mode === "targeted"
            ? scopeRecord.mode
            : "unknown",
          ...(typeof scopeRecord?.semanticEvolutionCycle === "number"
            ? { semanticEvolutionCycle: scopeRecord.semanticEvolutionCycle }
            : {}),
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
      case "ReviewerModelCallStarted": {
        const batchId = asString(payload.batchId);
        const attempt = asNumber(payload.attempt);
        if (!occurredAt || !batchId || !activityId || !Number.isInteger(attempt) || attempt! <= 0) break;
        const call: ReviewerModelCallTiming = {
          batchId,
          activityId,
          attempt: attempt!,
          supplemental: payload.supplemental === true,
          completed: false
        };
        reviewerModelCalls.push(call);
        openReviewerModelCalls.set(`${batchId}/${activityId}/${attempt}`, { call, startedAt: occurredAt });
        break;
      }
      case "ReviewerModelCallCompleted": {
        const batchId = asString(payload.batchId);
        const attempt = asNumber(payload.attempt);
        if (!occurredAt || !batchId || !activityId || !Number.isInteger(attempt) || attempt! <= 0) break;
        const key = `${batchId}/${activityId}/${attempt}`;
        const open = openReviewerModelCalls.get(key);
        if (open) {
          open.call.completed = true;
          open.call.seconds = Math.round(secondsBetween(open.startedAt, occurredAt));
          openReviewerModelCalls.delete(key);
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

  const mergedRetryIdleSeconds = (() => {
    const intervals = retryIntervals
      .map((interval) => ({ start: Date.parse(interval.start), end: Date.parse(interval.end) }))
      .filter((interval) => !Number.isNaN(interval.start) && !Number.isNaN(interval.end) && interval.end >= interval.start)
      .sort((left, right) => left.start - right.start);
    let total = 0;
    let current: { start: number; end: number } | undefined;
    for (const interval of intervals) {
      if (!current || interval.start > current.end) {
        if (current) total += current.end - current.start;
        current = interval;
      } else {
        current.end = Math.max(current.end, interval.end);
      }
    }
    if (current) total += current.end - current.start;
    return Math.round(total / 1000);
  })();
  const activities: ActivityCost[] = [...activity.entries()]
    .map(([id, record]) => ({
      activityId: id,
      attempts: record.attempts,
      busySeconds: Math.round(record.busy),
      wallSeconds: record.first && record.last ? Math.round(secondsBetween(record.first, record.last)) : 0,
      retryIdleSeconds: record.retryIdle,
      driftEvents: record.drift,
      outcome: record.outcome,
      attemptDetails: [...record.attemptDetails].sort((left, right) => left.attempt - right.attempt)
    }))
    .sort((left, right) => left.activityId.localeCompare(right.activityId));
  const byActivity = new Map(activities.map((item) => [item.activityId, item]));
  const fragmentRecords = [...activity.entries()]
    .filter(([id]) => /^(?:delta-)?candidate-fragment-/u.test(id));
  const skeletonRecords = [...activity.entries()]
    .filter(([id]) => /^(?:delta-)?candidate-skeleton$/u.test(id));
  const compilerRecords = [...activity.entries()]
    .filter(([id]) => /^(?:delta-)?candidate-compiler$/u.test(id));
  const assemblyRecords = [...activity.entries()]
    .filter(([id]) => /^(?:delta-)?candidate-assemble$/u.test(id));
  const fragmentFirst = fragmentRecords.map(([, item]) => item.first).filter((value): value is string => Boolean(value));
  const fragmentLast = fragmentRecords.map(([, item]) => item.last).filter((value): value is string => Boolean(value));
  const fragmentWallSeconds = fragmentFirst.length && fragmentLast.length
    ? Math.round(secondsBetween(fragmentFirst.sort()[0]!, fragmentLast.sort().at(-1)!))
    : 0;
  const candidateGeneration: CandidateGenerationTiming = {
    compilerSeconds: compilerRecords.reduce((sum, [, item]) => sum + Math.round(item.busy), 0),
    compilerModelSeconds: compilerRecords.reduce((sum, [, item]) => sum + item.attemptDetails
      .reduce((attemptSum, attempt) => attemptSum + (attempt.modelSeconds ?? 0), 0), 0),
    skeletonSeconds: skeletonRecords.reduce((sum, [, item]) => sum + Math.round(item.busy), 0),
    skeletonModelSeconds: skeletonRecords.reduce((sum, [, item]) => sum + item.attemptDetails
      .reduce((attemptSum, attempt) => attemptSum + (attempt.modelSeconds ?? 0), 0), 0),
    fragmentBusySeconds: fragmentRecords.reduce((sum, [, item]) => sum + Math.round(item.busy), 0),
    fragmentModelSeconds: fragmentRecords.reduce((sum, [, item]) => sum + item.attemptDetails
      .reduce((attemptSum, attempt) => attemptSum + (attempt.modelSeconds ?? 0), 0), 0),
    fragmentWallSeconds,
    fragmentCriticalPathSeconds: Math.max(0, ...fragmentRecords.map(([, item]) =>
      item.first && item.last ? Math.round(secondsBetween(item.first, item.last)) : 0
    )),
    assemblySeconds: assemblyRecords.reduce((sum, [, item]) => sum + Math.round(item.busy), 0),
    fragmentCount: fragmentRecords.length,
    deterministicFragmentCount: fragmentRecords.filter(([id]) => deterministicFragments.has(id)).length,
    modelFragmentCount: fragmentRecords.filter(([id]) => !deterministicFragments.has(id)).length,
    modelTimingCapturedActivities: [...compilerRecords.map(([id]) => id), ...skeletonRecords.map(([id]) => id), ...fragmentRecords.map(([id]) => id).filter((id) => !deterministicFragments.has(id))]
      .filter((id) => byActivity.get(id)?.attemptDetails.some((item) => item.modelSeconds !== undefined)).length,
    modelTimingExpectedActivities: [...compilerRecords.map(([id]) => id), ...skeletonRecords.map(([id]) => id), ...fragmentRecords.map(([id]) => id).filter((id) => !deterministicFragments.has(id))]
      .filter((id) => byActivity.has(id)).length,
    modelCalls: candidateModelCallKeys.size,
    modelTimingCapturedCalls: candidateModelTimedCallKeys.size,
    deterministicCaseCount,
    modelCaseCount,
    deterministicClauseCount,
    modelClauseCount
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
        mode: metadata.mode,
        ...(metadata.semanticEvolutionCycle === undefined
          ? {}
          : { semanticEvolutionCycle: metadata.semanticEvolutionCycle }),
        dispatchedReviewers: spans.length,
        reusedReviewers: metadata.reusedReviewers,
        wallSeconds: starts.length && ends.length
          ? Math.round(secondsBetween(starts[0]!, ends.at(-1)!))
          : 0,
        rawInputBytes,
        slicedInputBytes,
        savedInputBytes,
        inputSavingsRatio: rawInputBytes === 0 ? 0 : savedInputBytes / rawInputBytes
        ,modelCalls: reviewerModelCalls.filter((call) => call.batchId === batchId).length
        ,modelSeconds: reviewerModelCalls.filter((call) => call.batchId === batchId)
          .reduce((sum, call) => sum + (call.seconds ?? 0), 0)
        ,budgetHits: reviewerModelCalls.filter((call) => call.batchId === batchId && call.supplemental).length
        ,unclosedCalls: reviewerModelCalls.filter((call) => call.batchId === batchId && !call.completed).length
        ,roleModelSeconds: Object.fromEntries(reviewerModelCalls
          .filter((call) => call.batchId === batchId)
          .reduce((roles, call) => {
            const role = reviewerRoles.get(`${batchId}::${call.activityId}`) ?? call.activityId;
            roles.set(role, (roles.get(role) ?? 0) + (call.seconds ?? 0));
            return roles;
          }, new Map<string, number>()).entries())
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
    modelCalls: {
      candidateCalls: candidateModelCallKeys.size,
      reviewerCalls: reviewerModelCalls.length,
      reviewerTimingCapturedCalls: reviewerModelCalls.filter((call) => call.completed).length
    },
    reviewerSpans,
    reviewerModelCalls,
    reviewerBatches: reviewerBatchTimings,
    reviewerOptimization: {
      initialBatches: reviewerBatchTimings.filter((batch) => !batch.reReview).length,
      rereviewBatches: reviewerBatchTimings.filter((batch) => batch.reReview).length,
      fullRereviewFallbacks: reviewerBatchTimings.filter((batch) => batch.reReview && batch.mode === "full").length,
      humanConflictEscalations,
      criticalPathSeconds: reviewerSpans.length
        ? Math.round(secondsBetween(
          reviewerSpans.map((span) => span.startedAt).sort()[0]!,
          reviewerSpans.map((span) => span.endedAt).sort().at(-1)!
        ))
        : 0
    },
    ...(runIntent ? { runIntent } : {}),
    reviewWorkbook,
    readinessDiagnostics,
    humanWaitSeconds: Math.round(humanWait),
    retryIdleSeconds: mergedRetryIdleSeconds
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
  const accumulatedBusySeconds = timeline.activities.reduce((sum, item) => sum + item.busySeconds, 0);
  const repeatedAttempts = timeline.activities.reduce((sum, item) => sum + Math.max(0, item.attempts - 1), 0);
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
  lines.push(`| 活动累计工作量 | ${formatMinutes(accumulatedBusySeconds)}（可与并行阶段重叠，不等同于墙钟） |`);
  lines.push(`| 重复尝试 | ${repeatedAttempts} 次（活动 attempt 超过首次的总数） |`);
  lines.push(`| 终态 | ${timeline.completed ? "WorkflowCompleted" : "未终态"} |`);
  lines.push(`| 重试/对账空闲（区间并集） | ${formatMinutes(timeline.retryIdleSeconds)}（${timeline.activities.reduce((sum, item) => sum + item.driftEvents, 0)} 次漂移） |`);
  lines.push(`| 人工等待（callback） | ${formatMinutes(timeline.humanWaitSeconds)} |`);
  lines.push(`| Excel 评审版 | ${timeline.reviewWorkbook.published ? "已发布" : "未发布"} · 缓存命中 ${timeline.reviewWorkbook.cacheHits} / 未命中 ${timeline.reviewWorkbook.cacheMisses} / 损坏回退 ${timeline.reviewWorkbook.cacheFallbacks} · 渲染 ${formatMinutes(timeline.reviewWorkbook.renderSeconds)} |`);
  lines.push(`| Readiness 诊断 | 不可变输入阻断 ${timeline.readinessDiagnostics.immutableInputBlocks} · 宿主失联对账 ${timeline.readinessDiagnostics.hostOrphans} · 环境延期 ${timeline.readinessDiagnostics.environmentDeferred} |`);
  const reviewerRawBytes = timeline.reviewerBatches.reduce((sum, batch) => sum + batch.rawInputBytes, 0);
  const reviewerSlicedBytes = timeline.reviewerBatches.reduce((sum, batch) => sum + batch.slicedInputBytes, 0);
  const reviewerSavedBytes = reviewerRawBytes - reviewerSlicedBytes;
  const modelEventCalls = timeline.modelCalls.candidateCalls + timeline.modelCalls.reviewerCalls;
  const tokenTelemetry = totals.calls === 0 && modelEventCalls > 0
    ? `未采集（模型调用事件 ${modelEventCalls}）`
    : `记录 ${totals.calls} 条`;
  lines.push(`| reviewer 输入分片 | 原始 ${reviewerRawBytes} B · 分发 ${reviewerSlicedBytes} B · 节省 ${reviewerSavedBytes} B（${reviewerRawBytes === 0 ? "0.0" : ((reviewerSavedBytes / reviewerRawBytes) * 100).toFixed(1)}%） |`);
  lines.push(`| reviewer 收敛 | 首轮 ${timeline.reviewerOptimization.initialBatches} · 复审 ${timeline.reviewerOptimization.rereviewBatches} · 全量回退 ${timeline.reviewerOptimization.fullRereviewFallbacks} · 人工裁决 ${timeline.reviewerOptimization.humanConflictEscalations} · 关键路径 ${formatMinutes(timeline.reviewerOptimization.criticalPathSeconds)} |`);
  lines.push(`| 模型调用事件 | 候选 ${timeline.modelCalls.candidateCalls} · reviewer ${timeline.modelCalls.reviewerCalls} · 合计 ${modelEventCalls} |`);
  lines.push(`| 模型计时覆盖 | 候选 ${timeline.candidateGeneration.modelTimingCapturedCalls}/${timeline.modelCalls.candidateCalls} · reviewer ${timeline.modelCalls.reviewerTimingCapturedCalls}/${timeline.modelCalls.reviewerCalls} |`);
  lines.push(`| token 采集（窗口内） | ${tokenTelemetry} · input ${totals.inputTokens} · output ${totals.outputTokens} · cacheRead ${totals.cacheReadTokens} |`, "");
  if (timeline.runIntent) {
    lines.push(`- 运行意图：${timeline.runIntent.decision} · 套件 ${timeline.runIntent.suiteId}${timeline.runIntent.designExecutionReuse ? " · 稳定设计复用→工程构建" : ""}${modelEventCalls === 0 ? " · 设计模型调用 0。" : "。"}`, "");
    const buildAttempted = timeline.activities.some((activity) => activity.activityId === "build");
    const scriptAssetMode = timeline.runIntent.decision === "direct_execute"
      ? "稳定 verified 脚本复用（无需候选脚本工作区）"
      : timeline.runIntent.decision === "design_reconfirm" && !buildAttempted
        ? "本轮不构建脚本"
        : timeline.runIntent.decision === "design_reconfirm"
          ? "稳定 reviewed 脚本复用或仅补建缺失脚本"
          : "本轮 candidate-scripts 工作区构建";
    lines.push(`- 脚本资产：${scriptAssetMode}。`, "");
  }
  const webStaticBuild = timeline.activities.find((activity) =>
    activity.activityId === "build" && activity.outcome === "static_compiled"
  );
  if (webStaticBuild) {
    lines.push(`- Web 静态编译：通过；build 编排耗时 ${formatMinutes(webStaticBuild.busySeconds)}，冻结范围由 build 产物而非调用参数派生。`, "");
  }
  lines.push("## 候选生成关键路径", "");
  lines.push("| 编译编排 | 编译模型 | 分片（确定性/模型） | 分片编排合计 | 分片模型合计 | 分片墙钟 | 分片关键路径 | 汇总 | 模型计时采集 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |");
  lines.push(`| ${formatMinutes(timeline.candidateGeneration.compilerSeconds)} | ${formatMinutes(timeline.candidateGeneration.compilerModelSeconds)} | ${timeline.candidateGeneration.fragmentCount}（${timeline.candidateGeneration.deterministicFragmentCount}/${timeline.candidateGeneration.modelFragmentCount}） | ${formatMinutes(timeline.candidateGeneration.fragmentBusySeconds)} | ${formatMinutes(timeline.candidateGeneration.fragmentModelSeconds)} | ${formatMinutes(timeline.candidateGeneration.fragmentWallSeconds)} | ${formatMinutes(timeline.candidateGeneration.fragmentCriticalPathSeconds)} | ${formatMinutes(timeline.candidateGeneration.assemblySeconds)} | ${timeline.candidateGeneration.modelTimingCapturedCalls}/${timeline.candidateGeneration.modelCalls}${timeline.candidateGeneration.modelTimingCapturedCalls === timeline.candidateGeneration.modelCalls ? "" : "（未采集不按 0 计）"} |`, "");
  if (timeline.candidateGeneration.deterministicCaseCount + timeline.candidateGeneration.modelCaseCount > 0) {
    lines.push(`- v11 子约束归属：确定性 case ${timeline.candidateGeneration.deterministicCaseCount} / 模型 case ${timeline.candidateGeneration.modelCaseCount}；确定性 clause ${timeline.candidateGeneration.deterministicClauseCount} / 模型 clause ${timeline.candidateGeneration.modelClauseCount}。`, "");
  }
  lines.push("## 时间口径（按活动）", "");
  lines.push("| 活动 | 尝试 | 编排净耗时 | 跨度 | 重试/对账空闲 | 漂移 | 终态 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of timeline.activities) {
    lines.push(`| ${item.activityId} | ${item.attempts} | ${formatMinutes(item.busySeconds)} | ${formatMinutes(item.wallSeconds)} | ${formatMinutes(item.retryIdleSeconds)} | ${item.driftEvents} | ${item.outcome || "—"} |`);
  }
  lines.push("", "## 时间口径（按尝试）", "");
  lines.push("| 活动 | 尝试 | 编排耗时 | 模型耗时 | 结束 | attempt 来源 |", "| --- | --- | --- | --- | --- |");
  const attempts = timeline.activities.flatMap((item) => item.attemptDetails.map((attempt) => ({
    activityId: item.activityId,
    ...attempt
  })));
  if (!attempts.length) {
    lines.push("| 无可配对尝试 | — | — | — | — | — |");
  }
  for (const attempt of attempts) {
    lines.push(`| ${attempt.activityId} | ${attempt.attempt} | ${formatMinutes(attempt.seconds)} | ${attempt.modelSeconds === undefined ? "未采集" : formatMinutes(attempt.modelSeconds)} | ${attempt.outcome} | 当前事件 |`);
  }
  lines.push("", "## reviewer 批次", "");
  lines.push("| 批次 | 类型/周期 | 已派发 | 复用免派 | 墙钟 | 模型调用/墙钟 | 角色模型墙钟 | 补充调用 | 未闭合 | 原始输入 | 分片输入 | 节省 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  if (timeline.reviewerBatches.length === 0) {
    lines.push("| 无 | — | — | — | — | 未采集 | — | — | — | — | — | — |");
  }
  for (const batch of timeline.reviewerBatches) {
    const roleWall = Object.entries(batch.roleModelSeconds).sort(([left], [right]) => left.localeCompare(right))
      .map(([role, seconds]) => `${role}:${formatMinutes(seconds)}`).join("；") || "未采集";
    lines.push(`| ${batch.batchId} | ${batch.reReview ? "复审" : "首轮"}/${batch.mode}${batch.semanticEvolutionCycle === undefined ? "" : `/${batch.semanticEvolutionCycle}`} | ${batch.dispatchedReviewers} | ${batch.reusedReviewers} | ${formatMinutes(batch.wallSeconds)} | ${batch.modelCalls ? `${batch.modelCalls}/${formatMinutes(batch.modelSeconds)}` : "未采集"} | ${roleWall} | ${batch.budgetHits} | ${batch.unclosedCalls} | ${batch.rawInputBytes} B | ${batch.slicedInputBytes} B | ${batch.savedInputBytes} B（${(batch.inputSavingsRatio * 100).toFixed(1)}%） |`);
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
  lines.push("- 模型调用数只由 workflow 调用事件计算；token 仅是独立会话遥测。未匹配到 token 记录时显示“未采集”，不得据此推断没有模型调用。");
  lines.push("- token 去重口径：仅计会话日志 `assistant/message` 记录；`assistant/chunk` 携带的 usage 与之重复，不计数。");
  lines.push("- 模型耗时只由候选 CandidateGenerationStarted 与 ReviewerModelCallStarted/Completed 事件计量；确定性分片不期待模型计时，缺失计时显示“未采集”，不推断为 0。重试/对账空闲只统计 RetryScheduled 到下一次尝试开始的区间并集。");
  lines.push("- 会话扫描按时间窗过滤；与请求并发的外部会话可能混入，按行人工甄别（标签列标注 reviewer 映射）。");
  if (degradations.length > 0) {
    for (const note of degradations) lines.push(`- ${note}`);
  } else {
    lines.push("- 无降级项。");
  }
  lines.push("");
  return lines.join("\n");
}
