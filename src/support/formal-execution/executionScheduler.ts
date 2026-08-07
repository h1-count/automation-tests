import type { ExecutionDependencyPlan } from "./dependencyPlan.js";
import type { FormalExecutionRecord } from "./types.js";

export interface ScheduledBlockedCase {
  caseId: string;
  reason: string;
  resourceName: string;
}

export interface ExecutionScheduleDecision {
  runnableCaseIds: string[];
  blockedCases: ScheduledBlockedCase[];
  waitingTransitionIds: string[];
  complete: boolean;
}

/** Selects one dependency wave from durable case, resource and transition state. */
export function selectNextExecutionWave(
  plan: ExecutionDependencyPlan,
  record: FormalExecutionRecord
): ExecutionScheduleDecision {
  const waitingByCase = new Map<string, string[]>();
  for (const [caseId, progress] of Object.entries(record.stageProgress ?? {})) {
    waitingByCase.set(caseId, Object.values(progress.transitions)
      .filter((transition) => transition.status === "waiting")
      .map((transition) => transition.transitionId)
      .sort());
  }
  const incoming = new Map(plan.nodes.map((node) => [
    node.caseId,
    plan.edges.filter((edge) => edge.consumerCaseId === node.caseId)
  ]));
  const blockedCases: ScheduledBlockedCase[] = [];
  const candidates: Array<{ caseId: string; wave: number }> = [];

  for (const node of plan.nodes) {
    const result = record.cases[node.caseId];
    if (!result || ["passed", "failed", "skipped"].includes(result.status)) continue;
    if (isTerminalUnknown(result)) continue;
    if ((waitingByCase.get(node.caseId) ?? []).length > 0) continue;
    if (result.status === "blocked") continue;
    const missingEdges = (incoming.get(node.caseId) ?? []).filter((edge) =>
      !record.resources[edge.resourceName]?.available
    );
    if (missingEdges.length > 0) {
      const terminal = missingEdges.find((edge) => {
        const producer = record.cases[edge.producerCaseId];
        return producer?.status === "failed"
          || (producer?.status === "passed" && !record.resources[edge.resourceName]?.available)
          || (producer?.status === "blocked"
            && (waitingByCase.get(edge.producerCaseId) ?? []).length === 0);
      });
      if (terminal) {
        blockedCases.push({
          caseId: node.caseId,
          reason: `Dependency ${terminal.resourceName} from ${terminal.producerCaseId} was not produced.`,
          resourceName: terminal.resourceName
        });
      }
      continue;
    }
    const wave = plan.waves.find((item) => item.caseIds.includes(node.caseId))?.index ?? 0;
    candidates.push({ caseId: node.caseId, wave });
  }

  const nextWave = candidates.length
    ? Math.min(...candidates.map((candidate) => candidate.wave))
    : undefined;
  const runnableCaseIds = candidates
    .filter((candidate) => candidate.wave === nextWave)
    .map((candidate) => candidate.caseId)
    .sort();
  const waitingTransitionIds = [...new Set([...waitingByCase.values()].flat())].sort();
  const remaining = Object.values(record.cases).filter((item) =>
    !["passed", "failed", "skipped"].includes(item.status)
    && !isTerminalUnknown(item)
    && !(item.status === "blocked" && (waitingByCase.get(item.caseId) ?? []).length === 0)
    && !blockedCases.some((blocked) => blocked.caseId === item.caseId)
  );
  return {
    runnableCaseIds,
    blockedCases: blockedCases.sort((left, right) => left.caseId.localeCompare(right.caseId)),
    waitingTransitionIds,
    complete: remaining.length === 0 && runnableCaseIds.length === 0 && waitingTransitionIds.length === 0
  };
}

function isTerminalUnknown(result: FormalExecutionRecord["cases"][string]): boolean {
  if (result.status !== "unknown") return false;
  const latest = result.attempts.at(-1);
  return latest?.finality === "terminal"
    || (latest?.finality === undefined && latest?.endedAt !== undefined);
}
