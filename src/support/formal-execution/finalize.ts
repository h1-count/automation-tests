import { FormalExecutionStore } from "./formalExecutionStore.js";
import { loadFormalExecutionManifest } from "./manifest.js";
import { loadConfirmedExecutionAuthorization } from "./authorization.js";
import { TestDataManager } from "../test-data/testDataManager.js";
import { isAcceptedTestDataSummary } from "../test-data/summary.js";
import type {
  DataHygieneStatus,
  FunctionalStatus,
  TestDataSummary,
  TestRunStatus
} from "../test-data/types.js";
import type { FormalExecutionSummary } from "./types.js";

type AcceptedDataHygieneStatus = Extract<
  DataHygieneStatus,
  "clean" | "reusable" | "retained"
>;

export type CleanupPhaseResult =
  | {
      status: "not_required";
      dataHygieneStatus: "clean";
    }
  | {
      status: "passed";
      dataHygieneStatus: AcceptedDataHygieneStatus;
    }
  | {
      status: "failed";
      dataHygieneStatus: Extract<DataHygieneStatus, "cleanup_failed" | "manual_required">;
      reason: string;
    };

export type FormalSettlement =
  | {
      kind: "parked";
      summary: FormalExecutionSummary;
      pendingTransitionIds: string[];
    }
  | {
      kind: "terminal";
      summary: FormalExecutionSummary;
      cleanup: CleanupPhaseResult;
    };

type LoadedAuthorization = Awaited<ReturnType<typeof loadConfirmedExecutionAuthorization>>;
type LoadedManifest = Awaited<ReturnType<typeof loadFormalExecutionManifest>>;

export interface FinalizeFormalExecutionOptions {
  requested?: "terminal" | "park";
  snapshot?: LoadedAuthorization;
  manifest?: LoadedManifest;
  store?: FormalExecutionStore;
  managerFactory?: (projectId: string, environment: string) => TestDataManager;
}

export async function finalizeFormalExecution(
  requestId: string,
  options: FinalizeFormalExecutionOptions = {}
): Promise<FormalSettlement> {
  const snapshot = options.snapshot ?? await loadConfirmedExecutionAuthorization(requestId);
  const manifest = options.manifest ?? await loadFormalExecutionManifest(requestId);
  if (snapshot.environment !== manifest.environment) {
    throw new Error("Execution environment differs from the confirmed authorization.");
  }
  const store = options.store ?? new FormalExecutionStore();
  const initialPending = await store.pendingTransitions(snapshot.digest);
  if (options.requested === "park" || initialPending.length > 0) {
    return parkedSettlement(await store.summarize(snapshot.digest), initialPending);
  }

  await store.reconcileOpenAttempts(
    snapshot.digest,
    "Playwright worker ended before the formal case transaction committed; the open attempt was conservatively recorded as terminal unknown."
  );
  const preliminarySummary = await store.summarize(snapshot.digest);
  const pendingAfterReconciliation = await store.pendingTransitions(snapshot.digest);
  if (pendingAfterReconciliation.length > 0) {
    return parkedSettlement(preliminarySummary, pendingAfterReconciliation);
  }

  const record = await store.read(snapshot.digest);
  if (!record) throw new Error("Formal execution state disappeared before teardown.");
  const manager = options.managerFactory?.(manifest.projectId, manifest.environment)
    ?? new TestDataManager({ projectId: manifest.projectId, envId: manifest.environment });
  let cleanup: CleanupPhaseResult;
  try {
    cleanup = classifyCleanupSummary(await manager.cleanupRun(record.testDataRunId));
  } catch {
    cleanup = {
      status: "failed",
      dataHygieneStatus: "cleanup_failed",
      reason: "cleanup_exception=1"
    };
  }

  if (cleanup.status === "failed") {
    await store.recordCleanup(
      snapshot.digest,
      cleanup.status,
      cleanup.reason,
      { dataHygieneStatus: cleanup.dataHygieneStatus }
    );
  }

  const intents = (await manager.store.listIntents()).filter((item) =>
    item.runId === record.testDataRunId
  );
  const run = await manager.store.readRun(record.testDataRunId);
  const runResourceIds = new Set(run?.resources ?? []);
  const resources = (await manager.store.listResources()).filter((item) =>
    item.runId === record.testDataRunId || runResourceIds.has(item.resourceId)
  );
  const dataEvidence = Object.fromEntries(
    snapshot.caseIds.map((caseId) => [
      caseId,
      {
        intents: intents
          .filter((item) => item.caseId === caseId)
          .map((item) => ({
            resourceType: item.resourceType,
            expectedOutcome: item.expectedOutcome,
            status: item.status
          })),
        resources: resources
          .filter((item) => item.caseId === caseId)
          .map((item) => ({
            resourceType: item.resourceType,
            state: item.state,
            reusable: item.reusable
          }))
      }
    ])
  );
  await store.recordDataEvidence(snapshot.digest, dataEvidence);

  if (cleanup.status !== "failed" && run?.status === "running") {
    const terminalStatus = functionalTerminalStatus(preliminarySummary);
    await manager.endRun(
      record.testDataRunId,
      terminalStatus.overallStatus,
      terminalStatus.functionalStatus
    );
  }
  if (cleanup.status !== "failed") {
    await store.recordCleanup(
      snapshot.digest,
      cleanup.status,
      undefined,
      { dataHygieneStatus: cleanup.dataHygieneStatus }
    );
  }
  return {
    kind: "terminal",
    summary: await store.summarize(snapshot.digest),
    cleanup
  };
}

export function classifyCleanupSummary(summary: TestDataSummary): CleanupPhaseResult {
  const unresolvedStateCounts = new Map<string, number>();
  for (const resource of summary.resources) {
    const accepted = resource.state === "cleaned"
      || resource.state === "retained"
      || (resource.state === "available" && resource.reusable);
    if (!accepted) {
      unresolvedStateCounts.set(
        resource.state,
        (unresolvedStateCounts.get(resource.state) ?? 0) + 1
      );
    }
  }

  const failures = new Map<string, number>();
  addFailure(failures, "summary_mismatch", summary.totalResources === summary.resources.length ? 0 : 1);
  addFailure(failures, "cleanup_failed", summary.cleanupFailed);
  addFailure(failures, "manual_required", summary.manualRequired);
  addFailure(failures, "quarantined", summary.quarantined);
  addFailure(failures, "retired", summary.retired);
  addFailure(failures, "expired_residual", summary.expiredResidual);
  addFailure(failures, "dirty", summary.dirty);
  for (const [state, count] of unresolvedStateCounts) {
    addFailure(failures, `state_${state}`, count);
  }
  if (
    failures.size === 0
    && !["clean", "reusable", "retained"].includes(summary.dataHygieneStatus)
  ) {
    addFailure(failures, `hygiene_${summary.dataHygieneStatus}`, 1);
  }
  if (failures.size === 0 && !isAcceptedTestDataSummary(summary)) {
    addFailure(failures, "summary_unaccepted", 1);
  }

  if (failures.size > 0) {
    const cleanupFailed = (failures.get("cleanup_failed") ?? 0) > 0
      || (failures.get("state_cleanup_failed") ?? 0) > 0;
    return {
      status: "failed",
      dataHygieneStatus: cleanupFailed ? "cleanup_failed" : "manual_required",
      reason: [...failures.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([state, count]) => `${state}=${count}`)
        .join(",")
    };
  }
  if (summary.totalResources === 0) {
    return { status: "not_required", dataHygieneStatus: "clean" };
  }
  const dataHygieneStatus: AcceptedDataHygieneStatus = summary.retained > 0
    ? "retained"
    : summary.reusableAvailable > 0
      ? "reusable"
      : "clean";
  return { status: "passed", dataHygieneStatus };
}

function parkedSettlement(
  summary: FormalExecutionSummary,
  pending: Awaited<ReturnType<FormalExecutionStore["pendingTransitions"]>>
): FormalSettlement {
  return {
    kind: "parked",
    summary,
    pendingTransitionIds: [...new Set([
      ...pending.map((item) => item.transitionId),
      ...summary.pendingTransitions.map((item) => item.transitionId)
    ])].sort()
  };
}

function functionalTerminalStatus(summary: FormalExecutionSummary): {
  overallStatus: TestRunStatus;
  functionalStatus: FunctionalStatus;
} {
  if (summary.counts.failed > 0) {
    return { overallStatus: "failed", functionalStatus: "failed" };
  }
  if (summary.counts.blocked > 0) {
    return { overallStatus: "failed", functionalStatus: "blocked" };
  }
  if (
    summary.counts.unknown > 0
    || summary.deferredCases.length > 0
    || summary.pendingTransitions.length > 0
  ) {
    return { overallStatus: "interrupted", functionalStatus: "interrupted" };
  }
  return { overallStatus: "passed", functionalStatus: "passed" };
}

function addFailure(failures: Map<string, number>, status: string, count: number): void {
  if (Number.isInteger(count) && count > 0) failures.set(status, count);
}
