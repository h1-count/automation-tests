import { FormalExecutionStore } from "./formalExecutionStore.js";
import { loadFormalExecutionManifest } from "./manifest.js";
import { loadConfirmedExecutionAuthorization } from "./authorization.js";
import { TestDataManager } from "../test-data/testDataManager.js";
import type { FormalExecutionSummary } from "./types.js";

export async function finalizeFormalExecution(requestId: string): Promise<FormalExecutionSummary> {
  const snapshot = await loadConfirmedExecutionAuthorization(requestId);
  const manifest = await loadFormalExecutionManifest(requestId);
  if (snapshot.environment !== manifest.environment) {
    throw new Error("Execution environment differs from the confirmed authorization.");
  }
  const store = new FormalExecutionStore();
  await store.reconcileOpenAttempts(
    snapshot.digest,
    "Playwright worker ended before the formal case transaction committed; the open attempt was conservatively recorded as failed."
  );
  const preliminarySummary = await store.summarize(snapshot.digest);
  const record = await store.read(snapshot.digest);
  if (!record) throw new Error("Formal execution state disappeared before teardown.");
  const manager = new TestDataManager({ projectId: manifest.projectId, envId: manifest.environment });
  let cleanupFailed = false;
  try {
    await manager.cleanupRun(record.testDataRunId);
    await store.recordCleanup(snapshot.digest, "passed");
  } catch (error) {
    cleanupFailed = true;
    await store.recordCleanup(
      snapshot.digest,
      "failed",
      error instanceof Error ? error.message : "Unknown cleanup failure."
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
  if (run?.status === "running") {
    await manager.endRun(
      record.testDataRunId,
      preliminarySummary.counts.failed > 0
      || preliminarySummary.counts.blocked > 0
      || !preliminarySummary.complete
      || cleanupFailed
        ? "failed"
        : "passed"
    );
  }
  return store.summarize(snapshot.digest);
}
