import { FormalExecutionStore } from "./formalExecutionStore.js";
import { loadFormalExecutionManifest } from "./manifest.js";
import { loadConfirmedExecutionAuthorization } from "../task-state/executionAuthorization.js";
import { TestDataManager } from "../test-data/testDataManager.js";
import type { FormalExecutionSummary } from "./types.js";

export async function finalizeFormalExecution(requestId: string): Promise<FormalExecutionSummary> {
  const manifest = await loadFormalExecutionManifest(requestId);
  const snapshot = await loadConfirmedExecutionAuthorization(requestId, manifest.environment);
  const store = new FormalExecutionStore();
  await store.reconcileOpenAttempts(
    snapshot.digest,
    "Playwright worker ended before the formal case transaction committed; the open attempt was conservatively recorded as failed."
  );
  const summary = await store.summarize(snapshot.digest);
  if (!summary.complete || summary.counts.blocked > 0) {
    return summary;
  }
  const record = await store.read(snapshot.digest);
  if (!record) throw new Error("Formal execution state disappeared before teardown.");
  const manager = new TestDataManager({ projectId: manifest.projectId, envId: manifest.environment });
  await manager.cleanupRun(record.testDataRunId);
  const run = await manager.store.readRun(record.testDataRunId);
  if (run?.status === "running") {
    await manager.endRun(record.testDataRunId, summary.counts.failed > 0 ? "failed" : "passed");
  }
  return summary;
}
