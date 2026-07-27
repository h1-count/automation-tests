import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CleanupActionRegistry } from "../../../src/support/test-data/cleanupRegistry.js";
import { sanitizeSummary } from "../../../src/support/test-data/summary.js";
import { TestDataManager } from "../../../src/support/test-data/testDataManager.js";
import { getMachineId } from "../../../src/support/test-data/machine.js";
import type { CleanupResult, TestResourceRecord } from "../../../src/support/test-data/types.js";

const projectId = "local-ledger-test-project";
const envId = "test";
const caseId = "OPEN-PLATFORM-LEDGER-001";

async function createHarness(result: CleanupResult = { status: "cleaned" }) {
  const root = await mkdtemp(resolve(tmpdir(), "test-ledger-"));
  const registry = new CleanupActionRegistry();
  registry.register({
    id: "product-delete-v1",
    resourceType: "product",
    risk: "low",
    idempotent: true,
    async cleanup() {
      return result;
    }
  });
  const manager = new TestDataManager({
    projectId,
    envId,
    ledgerRoot: resolve(root, "ledger"),
    artifactRoot: resolve(root, "artifacts"),
    cleanupRegistry: registry,
    resourceValidator: async () => ({ status: "passed" })
  });
  return { root, manager, registry };
}

async function createRun(manager: TestDataManager) {
  return manager.startRun({
    projectId,
    envId,
    caseIds: [caseId],
    dataWritePolicy: "managed_cleanup",
    authorizationDigest: "a".repeat(64),
    writeBudget: { product: 10 }
  });
}

async function registerProduct(manager: TestDataManager, runId: string, resourceId: string, reusable = true, cleanupActionId = "product-delete-v1") {
  return manager.registerCreatedResource({
    resourceId,
    resourceType: "product",
    projectId,
    envId,
    runId,
    caseId,
    reusable,
    cleanupActionId,
    metadata: { alias: "autotest-product" }
  });
}

test("creates a stable local run record", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  assert.match(run.runId, /^\d{14}-[a-f0-9]{8}$/);
  const stored = await manager.store.readRun(run.runId);
  assert.equal(stored?.machineId.startsWith("machine-"), true);
});

test("resumes the same authorized run without resetting resources or budgets", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    projectId,
    envId,
    suiteId: "web/open-platform/registration",
    caseIds: [caseId],
    dataWritePolicy: "managed_cleanup" as const,
    authorizationDigest: "b".repeat(64),
    writeBudget: { product: 1 }
  };
  const first = await manager.startOrResumeAuthorizedRun(input);
  const second = await manager.startOrResumeAuthorizedRun(input);
  assert.equal(second.runId, first.runId);
  assert.deepEqual(second.writeBudget, { product: 1 });
});

test("registers a created resource as a local reusable record", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  const resource = await registerProduct(manager, run.runId, "local-product-001");
  assert.equal(resource.owner, "local-automation-test");
  assert.equal(resource.state, "available");
  assert.equal((await manager.store.readResource("local-product-001"))?.runId, run.runId);
});

test("reuses only a validated local resource in the same project and environment", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const creatorRun = await createRun(manager);
  await registerProduct(manager, creatorRun.runId, "local-product-002");
  const consumerRun = await createRun(manager);
  const acquired = await manager.acquireResource({
    runId: consumerRun.runId,
    projectId,
    envId,
    resourceType: "product",
    caseId
  });
  assert.equal(acquired?.resourceId, "local-product-002");
  assert.equal(acquired?.state, "leased");
});

test("rejects resources whose owner or machine does not match", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  const machineId = await getMachineId(manager.store.root);
  const foreign: TestResourceRecord = {
    resourceId: "foreign-product-001",
    resourceType: "product",
    owner: "other-owner" as "local-automation-test",
    projectId,
    envId,
    machineId,
    runId: run.runId,
    state: "available",
    reusable: true,
    dirty: false,
    cleanupActionId: "product-delete-v1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
    reuseCount: 0,
    stateHistory: []
  };
  await manager.store.writeResource(foreign);
  const acquired = await manager.acquireResource({ runId: run.runId, projectId, envId, resourceType: "product" });
  assert.equal(acquired, null);
  foreign.resourceId = "foreign-product-002";
  foreign.owner = "local-automation-test";
  foreign.machineId = "machine-other";
  await manager.store.writeResource(foreign);
  assert.equal(await manager.acquireResource({ runId: run.runId, projectId, envId, resourceType: "product" }), null);
});

test("refuses to clean a resource outside the local ledger", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => manager.markCleanupPending("not-in-ledger"), /not present/);
});

test("records an unregistered cleanup action as manual_required", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  const resource = await registerProduct(manager, run.runId, "local-product-003", false, "missing-action");
  assert.equal(resource.state, "manual_required");
  assert.equal(resource.cleanupActionId, undefined);
});

test("marks a successful cleanup as cleaned", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  await registerProduct(manager, run.runId, "local-product-004", false);
  const summary = await manager.cleanupRun(run.runId);
  assert.equal(summary.cleaned, 1);
  assert.equal((await manager.store.readResource("local-product-004"))?.state, "cleaned");
});

test("marks a failed cleanup as cleanup_failed", async (context) => {
  const { root, manager } = await createHarness({ status: "failed", message: "temporary failure" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  await registerProduct(manager, run.runId, "local-product-005", false);
  const summary = await manager.cleanupRun(run.runId);
  assert.equal(summary.cleanupFailed, 1);
  assert.equal((await manager.store.readResource("local-product-005"))?.state, "cleanup_failed");
});

test("recovery processes only current-machine local ledger resources", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  await registerProduct(manager, run.runId, "local-product-006", false);
  await manager.markDirty("local-product-006", "simulated interruption");
  const local = await manager.store.readResource("local-product-006");
  assert.ok(local);
  const foreign: TestResourceRecord = { ...local, resourceId: "other-machine-product", machineId: "machine-other", state: "dirty" };
  await manager.store.writeResource(foreign);
  await manager.recoverLocalResources();
  assert.equal((await manager.store.readResource("local-product-006"))?.state, "cleaned");
  assert.equal((await manager.store.readResource("other-machine-product"))?.state, "dirty");
});

test("artifact summaries omit resource identifiers and sensitive messages", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  await registerProduct(manager, run.runId, "local-product-secret-007", false);
  await manager.markDirty("local-product-secret-007", "token=hidden");
  const summary = await manager.summarizeRun(run.runId);
  const report = sanitizeSummary(summary);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("local-product-secret-007"), false);
  assert.equal(serialized.includes("token=hidden"), false);
  const artifact = resolve(root, "artifacts", run.runId, "test-data-summary.json");
  assert.equal((await readFile(artifact, "utf8")).includes("local-product-secret-007"), false);
});

test("create intent is persisted before a managed resource is confirmed", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  const intent = await manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "product",
    syntheticKey: "autotest-managed-001",
    cleanupActionId: "product-delete-v1"
  });
  assert.equal(intent.status, "planned");
  await manager.markIntentCreating(intent.intentId);
  const resource = await manager.confirmCreatedResource({
    intentId: intent.intentId,
    resourceId: "managed-product-001",
    metadata: { alias: "autotest-managed" }
  });
  assert.equal(resource.state, "available");
  assert.equal(resource.createIntentId, intent.intentId);
  assert.equal((await manager.store.readIntent(intent.intentId))?.status, "created");
});

test("tracked residual creates a retained resource with a default 72-hour TTL", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await manager.startRun({
    projectId,
    envId,
    caseIds: [caseId],
    dataWritePolicy: "tracked_residual",
    authorizationDigest: "b".repeat(64),
    writeBudget: { tenant: 2 }
  });
  const intent = await manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "tenant",
    syntheticKey: "autotest-tenant-a"
  });
  await manager.markIntentCreating(intent.intentId);
  const resource = await manager.confirmCreatedResource({
    intentId: intent.intentId,
    resourceId: "tenant-autotest-a",
    metadata: { alias: "autotest-tenant-a" }
  });
  assert.equal(resource.state, "retained");
  assert.ok(resource.expiresAt);
  assert.ok(Date.parse(resource.expiresAt!) - Date.now() > 71 * 3_600_000);
  const summary = await manager.summarizeRun(run.runId);
  assert.equal(summary.retained, 1);
  assert.equal(summary.dataHygieneStatus, "retained");
});

test("no_write rejects create intents and resource budgets are enforced atomically", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const noWrite = await manager.startRun({ projectId, envId, caseIds: [caseId], dataWritePolicy: "no_write" });
  await assert.rejects(() => manager.reserveCreateIntent({
    runId: noWrite.runId,
    projectId,
    envId,
    caseId,
    resourceType: "tenant",
    syntheticKey: "autotest-no-write"
  }), /writable policy/);

  const run = await manager.startRun({
    projectId,
    envId,
    caseIds: [caseId],
    dataWritePolicy: "tracked_residual",
    authorizationDigest: "c".repeat(64),
    writeBudget: { tenant: 1 }
  });
  const first = await manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "tenant",
    syntheticKey: "autotest-budget-a"
  });
  await assert.rejects(() => manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "tenant",
    syntheticKey: "autotest-budget-b"
  }), /budget exhausted/);
  assert.equal((await manager.store.listIntents()).filter((item) => item.runId === run.runId).length, 1);
  assert.equal((await manager.store.readIntent(first.intentId))?.status, "planned");
});

test("creation_unknown is reconciled by exact identity without duplicate resource writes", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(manager);
  const intent = await manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "product",
    syntheticKey: "autotest-unknown",
    cleanupActionId: "product-delete-v1"
  });
  await manager.markIntentCreating(intent.intentId);
  await manager.markCreationUnknown(intent.intentId, "Remote response ended before identity confirmation.");
  const resource = await manager.reconcileCreateIntent({
    intentId: intent.intentId,
    resolution: "created",
    resourceId: "managed-product-reconciled",
    metadata: { alias: "autotest-reconciled" }
  });
  assert.equal("resourceId" in resource && resource.resourceId, "managed-product-reconciled");
  const replay = await manager.confirmCreatedResource({
    intentId: intent.intentId,
    resourceId: "managed-product-reconciled",
    metadata: { alias: "autotest-reconciled" }
  });
  assert.equal(replay.resourceId, "managed-product-reconciled");
  assert.equal((await manager.store.listResources()).filter((item) => item.resourceId === replay.resourceId).length, 1);
});

test("an expired tracked residual freezes later writes but preserves functional status", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = await manager.startRun({
    projectId,
    envId,
    caseIds: [caseId],
    dataWritePolicy: "tracked_residual",
    authorizationDigest: "d".repeat(64),
    writeBudget: { tenant: 2 }
  });
  const intent = await manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "tenant",
    syntheticKey: "autotest-expired-a",
    expiresAt: new Date(Date.now() - 1_000).toISOString()
  });
  await manager.markIntentCreating(intent.intentId);
  await manager.confirmCreatedResource({ intentId: intent.intentId, resourceId: "tenant-expired-a" });
  await assert.rejects(() => manager.reserveCreateIntent({
    runId: run.runId,
    projectId,
    envId,
    caseId,
    resourceType: "tenant",
    syntheticKey: "autotest-after-expiry"
  }), /expired tracked residual/);
  const ended = await manager.endRun(run.runId, "passed");
  assert.equal(ended.status, "passed");
  assert.equal(ended.functionalStatus, "passed");
  assert.equal(ended.dataHygieneStatus, "manual_required");
});

test("an expired ledger lock is recovered without removing a live owner lock", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.store.initialize();
  await writeFile(
    resolve(manager.store.root, "ledger.lock"),
    JSON.stringify({ owner: "expired-worker", expiresAt: Date.now() - 1_000 }),
    "utf8"
  );
  let entered = false;
  await manager.store.withExclusive(async () => {
    entered = true;
  });
  assert.equal(entered, true);
});

test("a dead worker ledger lock is recovered before its lease expires", async (context) => {
  const { root, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.store.initialize();
  await writeFile(
    resolve(manager.store.root, "ledger.lock"),
    JSON.stringify({ owner: "999999:terminated-worker", expiresAt: Date.now() + 30_000 }),
    "utf8"
  );
  let entered = false;
  await manager.store.withExclusive(async () => {
    entered = true;
  });
  assert.equal(entered, true);
});

test("the project ignores local ledger data", async () => {
  const gitignore = await readFile(resolve(process.cwd(), ".gitignore"), "utf8");
  assert.equal(gitignore.includes(".local/"), true);
  assert.equal(gitignore.includes("artifacts/"), true);
});
