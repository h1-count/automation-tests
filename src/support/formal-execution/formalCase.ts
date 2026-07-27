import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../../fixtures/formalWebFixture.js";
import { loadConfirmedExecutionAuthorization } from "../task-state/executionAuthorization.js";
import { TestDataManager } from "../test-data/testDataManager.js";
import type { TestResourceType } from "../test-data/types.js";
import { FormalExecutionStore } from "./formalExecutionStore.js";
import { evaluateCapabilities, validateFormalExecutionManifest } from "./manifest.js";
import type {
  FormalCaseDefinition,
  FormalCaseRuntime,
  FormalExecutionManifest,
  FormalExecutionSummary
} from "./types.js";

type FormalFixtures = {
  page: Page;
  browser: Browser;
  context: BrowserContext;
};

type FormalBody = (fixtures: FormalFixtures, runtime: FormalCaseRuntime, testInfo: TestInfo) => Promise<void>;

let configuredManifest: FormalExecutionManifest | undefined;
let runtimePromise: Promise<InternalRuntime> | undefined;

interface InternalRuntime extends FormalCaseRuntime {
  store: FormalExecutionStore;
  manifest: FormalExecutionManifest;
}

export function configureFormalSuite(manifest: FormalExecutionManifest): void {
  validateFormalExecutionManifest(manifest);
  if (configuredManifest && configuredManifest.requestId !== manifest.requestId) {
    throw new Error("A formal spec may configure only one request manifest.");
  }
  configuredManifest = manifest;
}

export function formalCase(caseId: string, title: string, body: FormalBody): void {
  if (!configuredManifest) throw new Error("Call configureFormalSuite(manifest) before registering formalCase tests.");
  const declaredDefinition = requireDefinition(configuredManifest, caseId);
  if (declaredDefinition.title !== title) {
    throw new Error(`${caseId} title differs from the immutable formal manifest.`);
  }
  test(`${caseId}：${title}`, async ({ page, browser, context }, testInfo) => {
    if (declaredDefinition.timeoutMs !== undefined) {
      testInfo.setTimeout(declaredDefinition.timeoutMs);
    }
    const runtime = await getRuntime();
    const definition = requireDefinition(runtime.manifest, caseId);
    const record = await runtime.store.read(runtime.snapshot.digest);
    const prior = record?.cases[caseId];
    if (prior?.status === "passed") {
      testInfo.annotations.push({ type: "formalStatus", description: "passed: restored from the same authorization run" });
      test.skip(true, "Already passed in the same immutable authorization run.");
    }
    const capabilityBlock = definition.requiredCapabilities
      .map((id) => record?.capabilities[id])
      .find((item) => item && !item.available);
    if (capabilityBlock) {
      const reason = capabilityBlock.reason ?? `Capability ${capabilityBlock.capabilityId} is unavailable.`;
      await runtime.store.markBlocked(runtime.snapshot.digest, caseId, reason);
      testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason}` });
      test.skip(true, reason);
    }
    for (const resource of definition.requiredResources) {
      if (!(await runtime.store.resourceAvailable(runtime.snapshot.digest, resource))) {
        const reason = `Named resource ${resource} is not confirmed; only dependent case ${caseId} is blocked.`;
        await runtime.store.markBlocked(runtime.snapshot.digest, caseId, reason);
        testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason}` });
        test.skip(true, reason);
      }
    }

    const attempt = await runtime.store.beginCase(runtime.snapshot.digest, caseId);
    try {
      await body({ page, browser, context }, {
        snapshot: runtime.snapshot,
        manager: runtime.manager,
        runId: runtime.runId,
        confirmResource: async (name, evidence) =>
          runtime.store.confirmResource(runtime.snapshot.digest, name, caseId, evidence),
        resourceAvailable: async (name) => runtime.store.resourceAvailable(runtime.snapshot.digest, name)
      }, testInfo);
      const completion = resolveFormalCompletion(testInfo.errors);
      await runtime.store.finishCase(
        runtime.snapshot.digest,
        caseId,
        attempt,
        completion.status,
        completion.reason
      );
      testInfo.annotations.push({ type: "formalStatus", description: completion.status });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown formal case failure.";
      if (error instanceof FormalBlockedError) {
        await runtime.store.finishCase(runtime.snapshot.digest, caseId, attempt, "blocked", reason);
        testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason.slice(0, 200)}` });
        test.skip(true, reason);
        return;
      }
      await runtime.store.finishCase(runtime.snapshot.digest, caseId, attempt, "failed", reason);
      testInfo.annotations.push({ type: "formalStatus", description: `failed: ${reason.slice(0, 200)}` });
      throw error;
    }
  });
}

export function resolveFormalCompletion(errors: ReadonlyArray<unknown>): {
  status: "passed" | "failed";
  reason?: string;
} {
  if (errors.length === 0) return { status: "passed" };
  return {
    status: "failed",
    reason: `${errors.length} soft assertion failure(s); inspect the redacted Playwright evidence.`
  };
}

export class FormalBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormalBlockedError";
  }
}

export async function initializeConfiguredFormalExecution(): Promise<FormalExecutionSummary> {
  const runtime = await getRuntime();
  return runtime.store.summarize(runtime.snapshot.digest);
}

export async function summarizeConfiguredFormalExecution(): Promise<FormalExecutionSummary> {
  const runtime = await getRuntime();
  return runtime.store.summarize(runtime.snapshot.digest);
}

export { expect, test as formalSuite };

async function getRuntime(): Promise<InternalRuntime> {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}

async function createRuntime(): Promise<InternalRuntime> {
  const manifest = configuredManifest;
  if (!manifest) throw new Error("Call configureFormalSuite(manifest) before registering formalCase tests.");
  const snapshot = await loadConfirmedExecutionAuthorization(manifest.requestId, manifest.environment);
  const authorized = [...snapshot.caseIds].sort();
  const declared = manifest.cases.map((item) => item.caseId).sort();
  if (JSON.stringify(authorized) !== JSON.stringify(declared)) {
    throw new Error("Formal manifest must contain every authorized caseId exactly once.");
  }
  const writeBudget = Object.fromEntries(
    snapshot.resourceBudgets.map((item) => [item.resourceType, item.maxCreates])
  ) as Partial<Record<TestResourceType, number>>;
  const manager = new TestDataManager({ projectId: manifest.projectId, envId: manifest.environment });
  const run = await manager.startOrResumeAuthorizedRun({
    projectId: manifest.projectId,
    envId: manifest.environment,
    suiteId: manifest.requestId,
    caseIds: snapshot.caseIds,
    dataWritePolicy: snapshot.dataWritePolicy,
    authorizationDigest: snapshot.digest,
    writeBudget,
    residualTtlHours: snapshot.residualTtlHours
  });
  const store = new FormalExecutionStore(manager.store.root);
  await store.initialize({
    manifest,
    authorizationDigest: snapshot.digest,
    testDataRunId: run.runId,
    capabilities: evaluateCapabilities(manifest.capabilities)
  });
  return {
    snapshot,
    manager,
    runId: run.runId,
    store,
    manifest,
    confirmResource: async (name, evidence) => store.confirmResource(snapshot.digest, name, "runtime", evidence),
    resourceAvailable: async (name) => store.resourceAvailable(snapshot.digest, name)
  };
}

function requireDefinition(manifest: FormalExecutionManifest, caseId: string): FormalCaseDefinition {
  const definition = manifest.cases.find((item) => item.caseId === caseId);
  if (!definition) throw new Error(`Case ${caseId} is not declared in the formal execution manifest.`);
  return definition;
}
