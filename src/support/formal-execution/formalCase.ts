import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../../fixtures/formalWebFixture.js";
import {
  loadConfirmedExecutionAuthorization,
  type ExecutionAuthorizationSnapshot
} from "./authorization.js";
import { TestDataManager } from "../test-data/testDataManager.js";
import type { TestResourceType } from "../test-data/types.js";
import { FormalExecutionStore } from "./formalExecutionStore.js";
import {
  type CapabilityCheckContext,
  type CapabilityProviderRegistry,
  createDefaultCapabilityProviderRegistry
} from "./capabilityProvider.js";
import {
  capabilityTransitionId,
  evaluateCapabilitiesWithProviders,
  formalCapabilityId,
  producedResourceName,
  validateFormalExecutionManifest
} from "./manifest.js";
import {
  operationEvidenceCompletionIssues,
  sanitizeOperationEvidenceRecord
} from "./operationEvidence.js";
import type {
  FormalBusinessOracleDefinition,
  FormalBusinessOracleResult,
  FormalBlockEvidence,
  FormalCaseDefinition,
  FormalCaseRuntime,
  FormalExecutionManifest,
  FormalExecutionSummary,
  FormalFailureClassification,
  FormalResourceHandle,
  FormalOperationEvidenceRecord
} from "./types.js";
import { assertLocalResourceHandoff } from "./resourceHandoff.js";
import { registerFormalPageSessionGroups } from "./pageSessionGroups.js";
import { assertFormalBuildAuthorization } from "./selectorBuildIdentity.js";
import { FormalSelectorRepairError } from "../web/guardedSelector.js";
import { selectorRepairRetryCaseIds } from "./selectorRepair.js";

type FormalFixtures = {
  page: Page;
  browser: Browser;
  context: BrowserContext;
};

type FormalBody = (fixtures: FormalFixtures, runtime: FormalCaseRuntime, testInfo: TestInfo) => Promise<void>;

let configuredManifest: FormalExecutionManifest | undefined;
let runtimePromise: Promise<InternalRuntime> | undefined;

interface InternalRuntime extends Omit<
  FormalCaseRuntime,
  | "addEvidence"
  | "addAssertion"
  | "addOperationEvidence"
  | "verifyBusinessOracle"
  | "classifyFailure"
  | "useCapability"
  | "reserveOperation"
  | "leaseResource"
  | "releaseResource"
  | "stageCompleted"
  | "completeStage"
  | "transitionOutcome"
  | "transitionRecord"
  | "awaitExternalTransition"
  | "selectorRepairSafety"
  | "selectorRepairDependentCaseIds"
  | "attempt"
> {
  store: FormalExecutionStore;
  manifest: FormalExecutionManifest;
  capabilityRegistry: CapabilityProviderRegistry;
  capabilityContext: CapabilityCheckContext;
}

export function configureFormalSuite(manifest: FormalExecutionManifest): void {
  validateFormalExecutionManifest(manifest);
  if (configuredManifest && configuredManifest.requestId !== manifest.requestId) {
    throw new Error("A formal spec may configure only one request manifest.");
  }
  registerFormalPageSessionGroups(manifest);
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
    const latestPriorAttempt = prior?.attempts.at(-1);
    const hasOpenRetryAttempt = latestPriorAttempt !== undefined
      && (latestPriorAttempt.finality === "pending"
        || (latestPriorAttempt.finality === undefined && latestPriorAttempt.endedAt === undefined));
    if (prior && (prior.status !== "unknown" || prior.attempts.length > 0) && !hasOpenRetryAttempt) {
      testInfo.annotations.push({
        type: "formalStatus",
        description: `${prior.status}: restored from the same authorization run`
      });
      return;
    }
    const executionScopeBlock = caseExecutionScopeBlock(definition, runtime.snapshot);
    if (executionScopeBlock) {
      throw new Error(executionScopeBlock);
    }
    const activeCapabilityIds = definition.requiredCapabilities.flatMap((requirement) => {
      const capabilityId = formalCapabilityId(requirement);
      const transitionId = capabilityTransitionId(definition.requiredCapabilities, capabilityId);
      if (!transitionId) return [capabilityId];
      return Object.values(record?.stageProgress ?? {}).some((progress) =>
        progress.transitions[transitionId]?.status === "resolved"
      )
        ? [capabilityId]
        : [];
    });
    const capabilityBlock = activeCapabilityIds
      .map((id) => record?.capabilities[id])
      .find((item) => item && !item.available);
    if (capabilityBlock) {
      const reason = capabilityBlock.reason ?? `Capability ${capabilityBlock.capabilityId} is unavailable.`;
      await runtime.store.markBlocked(
        runtime.snapshot.digest,
        caseId,
        reason,
        {
          cause: "capability_unavailable",
          capabilityId: capabilityBlock.capabilityId
        }
      );
      testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason}` });
      test.skip(true, reason);
    }
    for (const resource of definition.requiredResources) {
      if (!(await runtime.store.resourceAvailable(runtime.snapshot.digest, resource))) {
        const reason = `Named resource ${resource} is not confirmed; only dependent case ${caseId} is blocked.`;
        await runtime.store.markBlocked(
          runtime.snapshot.digest,
          caseId,
          reason,
          { cause: "required_resource_unavailable", resourceName: resource }
        );
        testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason}` });
        test.skip(true, reason);
      }
    }
    if (definition.dataWritePolicy !== "no_write") {
      const producedTypes = definition.producesResources
        .filter((resource): resource is Exclude<typeof resource, string> => typeof resource !== "string")
        .map((resource) => resource.resourceType);
      const unresolved = (await runtime.manager.store.listResources()).find((resource) =>
        resource.runId === runtime.runId
        && producedTypes.includes(resource.resourceType)
        && ["dirty", "cleanup_pending", "cleanup_failed", "manual_required"].includes(resource.state)
      );
      if (unresolved) {
        const reason = `Test-data writes for ${unresolved.resourceType} are frozen until ${unresolved.resourceId} cleanup is reconciled.`;
        await runtime.store.markBlocked(runtime.snapshot.digest, caseId, reason, {
          cause: "required_resource_unavailable",
          resourceName: unresolved.resourceId
        });
        testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason}` });
        test.skip(true, reason);
      }
    }

    const attempt = await runtime.store.beginCase(runtime.snapshot.digest, caseId);
    const evidenceRefs: string[] = [];
    const assertions: string[] = [];
    const operationEvidence: FormalOperationEvidenceRecord[] = [];
    try {
      await body({ page, browser, context }, {
        snapshot: runtime.snapshot,
        manager: runtime.manager,
        runId: runtime.runId,
        attempt,
        confirmResource: async (name, evidence) =>
          runtime.store.confirmResource(runtime.snapshot.digest, name, caseId, evidence),
        publishResource: async (name, ledgerResourceId, evidence) => {
          await assertPublishableResource(runtime, definition, caseId, name, ledgerResourceId);
          await runtime.store.publishResource(
            runtime.snapshot.digest,
            name,
            caseId,
            evidence,
            ledgerResourceId
          );
        },
        consumeResource: (name) => consumeCaseResource(runtime, definition, name),
        resourceMetadata: async (name, key) => {
          const handle = await consumeCaseResource(runtime, definition, name);
          const value = handle.metadata[key];
          if (typeof value !== "string" || !value.trim()) {
            throw new Error(`${caseId} resource ${name} has no readable metadata ${key}.`);
          }
          return value;
        },
        markResourceDirty: async (name, reason) => {
          const handle = await consumeCaseResource(runtime, definition, name);
          await runtime.manager.markDirty(handle.resourceId, reason);
        },
        resourceAvailable: async (name) => runtime.store.resourceAvailable(runtime.snapshot.digest, name),
        beginSyntheticCreate: (input) =>
          runtime.manager.reserveCreateIntent({
            runId: runtime.runId,
            projectId: runtime.manifest.projectId,
            envId: runtime.manifest.environment,
            caseId,
            resourceType: input.resourceType as TestResourceType,
            syntheticKey: input.syntheticKey,
            ...(input.expectedOutcome ? { expectedOutcome: input.expectedOutcome } : {}),
            ...(input.dataWritePolicy ? { dataWritePolicy: input.dataWritePolicy } : {}),
            ...(input.evidenceSummary
              ? { evidence: [{ type: "web" as const, summary: input.evidenceSummary }] }
              : {})
          }),
        markSyntheticCreating: (intentId) => runtime.manager.markIntentCreating(intentId),
        confirmSyntheticResource: async (input) => {
          const record = await runtime.manager.confirmCreatedResource({
            intentId: input.intentId,
            resourceId: input.resourceId,
            reusable: false,
            ...(input.metadata ? { metadata: input.metadata } : {}),
            ...(input.evidenceSummary
              ? { evidence: [{ type: "web" as const, summary: input.evidenceSummary }] }
              : {})
          });
          if (input.publishName) {
            await assertPublishableResource(
              runtime,
              definition,
              caseId,
              input.publishName,
              record.resourceId
            );
            await runtime.store.publishResource(
              runtime.snapshot.digest,
              input.publishName,
              caseId,
              input.evidenceSummary ?? "Synthetic resource created and verified.",
              record.resourceId
            );
          }
          return record;
        },
        markSyntheticRejected: (intentId, message) =>
          runtime.manager.markCreationFailed(intentId, message),
        restoreSyntheticResource: async (name, message) => {
          const handle = await consumeCaseResource(runtime, definition, name);
          await runtime.manager.recordResourceRestored(handle.resourceId, message);
        },
        leaseResource: async (name, validator) => {
          const contract = definition.consumesResources?.find((item) => item.name === name);
          if (!contract) {
            throw new Error(`${caseId} cannot lease undeclared reusable fixture ${name}.`);
          }
          runtime.manager.registerResourceValidator(contract.baselineContractId, validator);
          return runtime.manager.leaseReusableResource({
            runId: runtime.runId,
            projectId: runtime.manifest.projectId,
            envId: runtime.manifest.environment,
            resourceType: contract.resourceType,
            baselineContractId: contract.baselineContractId,
            leaseMode: contract.leaseMode,
            caseId
          });
        },
        releaseResource: (resourceId, baselineRestored, reason) =>
          runtime.manager.releaseReusableResource({
            resourceId,
            runId: runtime.runId,
            baselineRestored,
            reason
          }),
        useCapability: <T>(capabilityId: string) =>
          useCaseCapability<T>(runtime, definition, capabilityId),
        reserveOperation: (operation, operationKey) =>
          runtime.store.reserveOperation(
            runtime.snapshot.digest,
            definition,
            operation,
            operationKey
          ),
        stageCompleted: (stageId) =>
          runtime.store.stageCompleted(runtime.snapshot.digest, caseId, stageId),
        completeStage: (stageId, stageEvidenceRefs = []) =>
          runtime.store.completeStage(
            runtime.snapshot.digest,
            definition,
            stageId,
            stageEvidenceRefs
          ),
        transitionOutcome: (transitionId) =>
          runtime.store.transitionOutcome(runtime.snapshot.digest, caseId, transitionId),
        transitionRecord: (transitionId) =>
          runtime.store.transitionRecord(runtime.snapshot.digest, caseId, transitionId),
        awaitExternalTransition: async (transitionId) => {
          await runtime.store.awaitExternalTransition(
            runtime.snapshot.digest,
            definition,
            transitionId
          );
          throw new FormalExternalTransitionRequired(caseId, transitionId);
        },
        selectorRepairSafety: () => runtime.store.selectorRepairSafety(
          runtime.snapshot.digest,
          caseId,
          attempt
        ),
        selectorRepairDependentCaseIds: () => selectorRepairRetryCaseIds(
          runtime.manifest,
          runtime.snapshot.caseIds,
          [caseId]
        ).filter((candidateCaseId) => candidateCaseId !== caseId),
        addEvidence: (reference) => evidenceRefs.push(reference),
        addAssertion: (description) => assertions.push(description),
        addOperationEvidence: (evidence) => {
          if (!definition.operationEvidence?.some((item) =>
            item.operation === evidence.operation
            && (item.responseContractId === evidence.contractId
              || item.queryCapabilityId === evidence.contractId
              || item.uiContractId === evidence.contractId)
          )) {
            throw new Error(
              `${caseId} recorded operation evidence outside its immutable manifest.`
            );
          }
          operationEvidence.push(sanitizeOperationEvidenceRecord(evidence));
        },
        verifyBusinessOracle: async (oracleId, evaluator) => {
          const oracle = definition.businessOracles?.find((item) => item.oracleId === oracleId);
          if (!oracle) {
            throw new Error(
              `${caseId} verified business oracle ${oracleId} outside its immutable manifest.`
            );
          }
          return runtime.store.verifyBusinessOracle({
            authorizationDigest: runtime.snapshot.digest,
            caseId,
            attempt,
            oracleId,
            evaluator,
            evidenceRefs
          });
        },
        classifyFailure: () => {
          throw new Error(
            `${caseId} cannot use classifyFailure() in formal-execution-manifest-v1.`
          );
        }
      }, testInfo);
      const persistedAttempt = await readAttemptOracleResults(
        runtime.store,
        runtime.snapshot.digest,
        caseId,
        attempt
      );
      const completion = resolveFormalOracleCompletion({
        definitions: definition.businessOracles ?? [],
        oracleResults: persistedAttempt,
        errors: testInfo.errors
      });
      if (completion.status === "passed") {
        const persisted = await runtime.store.read(runtime.snapshot.digest);
        const accumulatedOperationEvidence = [
          ...(persisted?.cases[caseId]?.attempts.flatMap((item) =>
            item.attempt === attempt ? [] : item.operationEvidence ?? []
          ) ?? []),
          ...operationEvidence
        ];
        const evidenceIssues = operationEvidenceCompletionIssues({
          definitions: definition.operationEvidence,
          records: accumulatedOperationEvidence
        });
        if (evidenceIssues.length > 0) {
          throw new Error(
            `Structured operation evidence is incomplete: ${evidenceIssues.join(" ")}`
          );
        }
      }
      await runtime.store.finishCase(
        runtime.snapshot.digest,
        caseId,
        attempt,
        completion.status,
        completion.reason,
        evidenceRefs,
        {
          assertions,
          ...(completion.failureClassification?.basis === "runtime_error"
            ? { runtimeFailure: true }
            : {}),
          operationEvidence
        }
      );
      testInfo.annotations.push({ type: "formalStatus", description: completion.status });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown formal case failure.";
      const selectorRepairIncident = error instanceof FormalSelectorRepairError
        ? error.incident
        : undefined;
      if (selectorRepairIncident) evidenceRefs.push(selectorRepairIncident.path);
      const blockEvidence = error instanceof FormalExternalTransitionRequired
        ? { cause: "external_transition" as const, transitionId: error.transitionId }
        : error instanceof FormalBlockedError
          ? error.blockEvidence
          : undefined;
      if (blockEvidence) {
        await runtime.store.finishCase(
          runtime.snapshot.digest,
          caseId,
          attempt,
          "blocked",
          reason,
          evidenceRefs,
          {
            assertions,
            blockEvidence,
            operationEvidence
          }
        );
        testInfo.annotations.push({ type: "formalStatus", description: `blocked: ${reason.slice(0, 200)}` });
        test.skip(true, reason);
        return;
      }
      const persistedAttempt = await readAttemptOracleResults(
        runtime.store,
        runtime.snapshot.digest,
        caseId,
        attempt
      );
      const completion = resolveFormalOracleCompletion({
        definitions: definition.businessOracles ?? [],
        oracleResults: persistedAttempt,
        errors: [...testInfo.errors, error],
        runtimeError: true
      });
      await runtime.store.finishCase(
        runtime.snapshot.digest,
        caseId,
        attempt,
        completion.status,
        reason,
        evidenceRefs,
        {
          assertions,
          ...(completion.status === "unknown" ? { runtimeFailure: true } : {}),
          operationEvidence,
          ...(selectorRepairIncident ? { selectorRepairIncident } : {})
        }
      );
      testInfo.annotations.push({
        type: "formalStatus",
        description: `${completion.status}: ${reason.slice(0, 200)}`
      });
      throw error;
    }
  });
}

export function caseExecutionScopeBlock(
  definition: FormalCaseDefinition,
  snapshot: ExecutionAuthorizationSnapshot
): string | undefined {
  if (snapshot.schemaVersion !== "execution-authorization-v1") {
    return "Formal execution requires execution-authorization-v1.";
  }
  const caseScope = snapshot.caseScopes.find((scope) => scope.caseId === definition.caseId);
  if (!caseScope) {
    return `${definition.caseId} has no frozen execution-authorization-v1 case scope.`;
  }
  const missingOperations = definition.requiredOperations?.filter((operation) =>
    !(caseScope?.requiredOperations ?? snapshot.allowedOperations).includes(operation)
  ) ?? [];
  if (missingOperations.length > 0) {
    return `${definition.caseId} authorization is missing declared operations: ${missingOperations.join(", ")}.`;
  }
  const frozenBudgets = caseScope.operationBudgets ?? [];
  for (const budget of definition.operationBudgets ?? []) {
    const frozen = frozenBudgets.find((item) => item.operation === budget.operation);
    if (!frozen || frozen.maxExecutions !== budget.maxExecutions) {
      return `${definition.caseId} authorization is missing the exact ${budget.operation} execution budget.`;
    }
  }
  if (
    definition.dataWritePolicy
    && definition.dataWritePolicy !== "no_write"
    && !definition.permissionProfile
    && (caseScope?.dataWritePolicy ?? snapshot.dataWritePolicy) !== definition.dataWritePolicy
  ) {
    return `${definition.caseId} requires ${definition.dataWritePolicy}, not ${caseScope?.dataWritePolicy ?? snapshot.dataWritePolicy}.`;
  }
  return undefined;
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

export function resolveFormalOracleCompletion(input: {
  definitions: FormalBusinessOracleDefinition[];
  oracleResults: Array<Pick<FormalBusinessOracleResult, "oracleId" | "outcome" | "evaluationBasis">>;
  errors: ReadonlyArray<unknown>;
  runtimeError?: boolean;
}): {
  status: "passed" | "failed" | "unknown";
  reason?: string;
  failureClassification?: FormalFailureClassification;
} {
  if (input.definitions.length === 0) {
    throw new Error("formal-execution-manifest-v1 cases require immutable business oracles.");
  }
  const expected = input.definitions.map((item) => item.oracleId).sort();
  const actual = input.oracleResults.map((item) => item.oracleId).sort();
  if (new Set(actual).size !== actual.length) {
    throw new Error("A formal case cannot record the same business oracle more than once.");
  }
  const unknownOracleIds = actual.filter((oracleId) => !expected.includes(oracleId));
  if (unknownOracleIds.length > 0) {
    throw new Error(`Business oracle results are outside the immutable case contract: ${unknownOracleIds.join(", ")}.`);
  }
  const complete = JSON.stringify(expected) === JSON.stringify(actual);
  const hasViolation = input.oracleResults.some((item) => item.outcome === "violated");
  const hasIndeterminate = input.oracleResults.some((item) => item.outcome === "indeterminate");
  const hasEvaluatorError = input.oracleResults.some((item) =>
    item.evaluationBasis === "evaluator_error"
  );
  const hasRuntimeFailure = input.runtimeError === true || input.errors.length > 0;

  if (hasViolation) {
    return {
      status: "failed",
      reason: "At least one business oracle result was violated.",
      failureClassification: { code: "product", basis: "business_oracle_violated" }
    };
  }
  if (hasRuntimeFailure) {
    return {
      status: "unknown",
      reason: input.errors.length > 0
        ? `${input.errors.length} runtime or soft assertion failure(s) left the business result indeterminate.`
        : "The runtime failed before the business result could be determined.",
      failureClassification: { code: "script", basis: "runtime_error" }
    };
  }
  if (!complete) {
    const missing = expected.filter((oracleId) => !actual.includes(oracleId));
    return {
      status: "unknown",
      reason: `Business oracle results are incomplete: ${missing.join(", ")}.`,
      failureClassification: { code: "script", basis: "missing_business_oracle" }
    };
  }
  if (hasIndeterminate) {
    return {
      status: "unknown",
      reason: "At least one business oracle result is indeterminate.",
      failureClassification: hasEvaluatorError
        ? { code: "script", basis: "oracle_evaluator_error" }
        : { code: "unknown", basis: "business_oracle_indeterminate" }
    };
  }
  return { status: "passed" };
}

async function readAttemptOracleResults(
  store: FormalExecutionStore,
  authorizationDigest: string,
  caseId: string,
  attempt: number
): Promise<FormalBusinessOracleResult[]> {
  const record = await store.read(authorizationDigest);
  return structuredClone(
    record?.cases[caseId]?.attempts.find((item) => item.attempt === attempt)?.oracleResults ?? []
  );
}

export class FormalBlockedError extends Error {
  constructor(message: string, readonly blockEvidence?: FormalBlockEvidence) {
    super(message);
    this.name = "FormalBlockedError";
  }
}

export class FormalExternalTransitionRequired extends Error {
  constructor(readonly caseId: string, readonly transitionId: string) {
    super(`${caseId} is waiting for external transition ${transitionId}.`);
    this.name = "FormalExternalTransitionRequired";
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
  const runRequestId = process.env.FORMAL_EXECUTION_RUN_REQUEST_ID?.trim() || manifest.requestId;
  const snapshot = await loadConfirmedExecutionAuthorization(runRequestId, manifest.environment);
  if (snapshot.mode === "stable_suite"
    && manifest.scope === "stable_suite"
    && snapshot.suiteId !== manifest.suiteId) {
    throw new Error("Formal manifest suite identity differs from stable suite authorization.");
  }
  assertFormalBuildAuthorization({
    manifest,
    authorizationSchemaVersion: snapshot.schemaVersion
  });
  const declared = new Set(manifest.cases.map((item) => item.caseId));
  if (snapshot.caseIds.some((caseId) => !declared.has(caseId))) {
    throw new Error("Formal manifest must declare every authorized runnable caseId.");
  }
  const writeBudget = Object.fromEntries(
    snapshot.resourceBudgets.map((item) => [item.resourceType, item.maxCreates])
  ) as Partial<Record<TestResourceType, number>>;
  const manager = new TestDataManager({ projectId: manifest.projectId, envId: manifest.environment });
  const run = await manager.startOrResumeAuthorizedRun({
    projectId: manifest.projectId,
    envId: manifest.environment,
    suiteId: manifest.suiteId ?? manifest.requestId,
    caseIds: snapshot.caseIds,
    dataWritePolicy: snapshot.dataWritePolicy,
    caseWritePolicies: Object.fromEntries(
      snapshot.caseScopes?.map((scope) => [scope.caseId, scope.dataWritePolicy])
      ?? manifest.cases
        .filter((definition) => snapshot.caseIds.includes(definition.caseId))
        .map((definition) => [definition.caseId, definition.dataWritePolicy ?? snapshot.dataWritePolicy])
    ),
    caseAllowedWritePolicies: Object.fromEntries(
      manifest.cases
        .filter((definition) => snapshot.caseIds.includes(definition.caseId))
        .map((definition) => [
          definition.caseId,
          [...new Set([
            definition.dataWritePolicy ?? snapshot.dataWritePolicy,
            ...definition.producesResources.flatMap((resource) =>
              typeof resource === "string" ? [] : [resource.disposition]
            )
          ])]
        ])
    ),
    authorizationDigest: snapshot.digest,
    writeBudget,
    residualTtlHours: snapshot.residualTtlHours
  });
  const store = new FormalExecutionStore(manager.store.root);
  const capabilityRegistry = createDefaultCapabilityProviderRegistry();
  const capabilityContext: CapabilityCheckContext = {
    requestId: runRequestId,
    environment: manifest.environment,
    targetBuildDigest: snapshot.targetBuildDigest,
    workspaceRoot: process.cwd()
  };
  const capabilityResults = formalCapabilityResultsFromRunner()
    ?? await evaluateCapabilitiesWithProviders(
      manifest.capabilities,
      capabilityContext,
      capabilityRegistry
    );
  await store.initialize({
    manifest,
    authorizationDigest: snapshot.digest,
    testDataRunId: run.runId,
    capabilities: capabilityResults,
    caseIds: snapshot.caseIds,
    deferredCases: snapshot.deferredCases ?? [],
    targetBuildDigest: snapshot.targetBuildDigest,
    runRequestId,
    suiteId: snapshot.suiteId,
    suiteVersion: snapshot.suiteVersion,
    repairContext: snapshot.repairContext
  });
  return {
    snapshot,
    manager,
    runId: run.runId,
    store,
    manifest,
    capabilityRegistry,
    capabilityContext,
    confirmResource: async (name, evidence) => store.confirmResource(snapshot.digest, name, "runtime", evidence),
    publishResource: async () => {
      throw new Error("Suite runtime cannot publish a case-owned resource.");
    },
    consumeResource: async () => {
      throw new Error("Suite runtime cannot consume a case-owned resource.");
    },
    resourceMetadata: async () => {
      throw new Error("Suite runtime cannot read a case-owned resource.");
    },
    markResourceDirty: async () => {
      throw new Error("Suite runtime cannot alter a case-owned resource.");
    },
    resourceAvailable: async (name) => store.resourceAvailable(snapshot.digest, name),
    beginSyntheticCreate: async () => {
      throw new Error("Suite runtime cannot reserve a case-owned create intent.");
    },
    markSyntheticCreating: async () => {
      throw new Error("Suite runtime cannot transition a case-owned create intent.");
    },
    confirmSyntheticResource: async () => {
      throw new Error("Suite runtime cannot confirm a case-owned resource.");
    },
    markSyntheticRejected: async () => {
      throw new Error("Suite runtime cannot transition a case-owned create intent.");
    },
    restoreSyntheticResource: async () => {
      throw new Error("Suite runtime cannot restore a case-owned resource.");
    }
  };
}

async function assertPublishableResource(
  runtime: InternalRuntime,
  definition: FormalCaseDefinition,
  caseId: string,
  name: string,
  ledgerResourceId: string
): Promise<void> {
  const contract = definition.producesResources.find((resource) => producedResourceName(resource) === name);
  if (!contract) throw new Error(`${caseId} cannot publish undeclared resource ${name}.`);
  const resource = await runtime.manager.store.readResource(ledgerResourceId);
  assertLocalResourceHandoff({
    resource,
    runId: runtime.runId,
    caseId,
    projectId: runtime.manifest.projectId,
    environment: runtime.manifest.environment,
    ...(typeof contract === "string" ? {} : { expectedResourceType: contract.resourceType })
  });
}

async function consumeCaseResource(
  runtime: InternalRuntime,
  definition: FormalCaseDefinition,
  name: string
): Promise<FormalResourceHandle> {
  const selfProduced = definition.producesResources.some(
    (resource) => producedResourceName(resource) === name
  );
  if (
    !definition.requiredResources.includes(name)
    && !definition.consumesResources?.some((resource) => resource.name === name)
    && !selfProduced
  ) {
    throw new Error(`${definition.caseId} cannot consume undeclared resource ${name}.`);
  }
  const resolvedName = resolveConsumableResourceName(runtime.manifest, definition, name);
  const resourceId = await runtime.store.consumeResource(runtime.snapshot.digest, resolvedName);
  const resource = await runtime.manager.store.readResource(resourceId);
  const validated = assertLocalResourceHandoff({
    resource,
    runId: runtime.runId,
    projectId: runtime.manifest.projectId,
    environment: runtime.manifest.environment,
    ...(selfProduced ? { caseId: definition.caseId } : {})
  });
  return { resourceId, resourceType: validated.resourceType, metadata: validated.metadata };
}

function resolveConsumableResourceName(
  manifest: FormalExecutionManifest,
  definition: FormalCaseDefinition,
  requestedName: string
): string {
  if (definition.requiredResources.includes(requestedName)) return requestedName;
  const contract = definition.consumesResources?.find((resource) => resource.name === requestedName);
  if (!contract) return requestedName;
  const exact = manifest.cases.flatMap((item) => item.producesResources)
    .find((resource) => producedResourceName(resource) === requestedName);
  if (exact) return requestedName;
  const candidates = manifest.cases.flatMap((item) => item.producesResources)
    .filter((resource) => typeof resource !== "string"
      && resource.resourceType === contract.resourceType
      && resource.baselineContractId === contract.baselineContractId)
    .map(producedResourceName);
  if (candidates.length !== 1) {
    throw new Error(
      `${definition.caseId} cannot resolve reusable resource ${requestedName} to one in-run producer.`
    );
  }
  return candidates[0]!;
}

async function useCaseCapability<T>(
  runtime: InternalRuntime,
  definition: FormalCaseDefinition,
  capabilityId: string
): Promise<T> {
  if (!definition.requiredCapabilities.map(formalCapabilityId).includes(capabilityId)) {
    throw new Error(`${definition.caseId} cannot use undeclared capability ${capabilityId}.`);
  }
  const transitionId = capabilityTransitionId(definition.requiredCapabilities, capabilityId);
  if (
    transitionId
    && await runtime.store.transitionOutcome(
      runtime.snapshot.digest,
      definition.caseId,
      transitionId
    ) === undefined
  ) {
    throw new Error(
      `${definition.caseId} cannot use ${capabilityId} before transition ${transitionId} resolves.`
    );
  }
  const capability = runtime.manifest.capabilities.find((item) => item.id === capabilityId);
  if (!capability) {
    throw new Error(`${definition.caseId} references missing capability ${capabilityId}.`);
  }
  return runtime.capabilityRegistry.use<T>(capability, runtime.capabilityContext);
}

function formalCapabilityResultsFromRunner() {
  const value = process.env.PLAYWRIGHT_CAPABILITY_RESULTS?.trim();
  if (!value) return undefined;
  const parsed = JSON.parse(value) as Array<{
    capabilityId?: unknown;
    available?: unknown;
    affectedCaseIds?: unknown;
    checkedAt?: unknown;
    evidenceDigest?: unknown;
    reason?: unknown;
    unblockCondition?: unknown;
    configurationError?: unknown;
    expiresAt?: unknown;
  }>;
  if (
    !Array.isArray(parsed)
    || parsed.some((item) =>
      typeof item.capabilityId !== "string"
      || typeof item.available !== "boolean"
      || !Array.isArray(item.affectedCaseIds)
      || item.affectedCaseIds.some((caseId) => typeof caseId !== "string")
      || typeof item.checkedAt !== "string"
      || typeof item.evidenceDigest !== "string"
      || !/^[a-f0-9]{64}$/.test(item.evidenceDigest)
      || (item.reason !== undefined && typeof item.reason !== "string")
      || (item.unblockCondition !== undefined && typeof item.unblockCondition !== "string")
      || (item.configurationError !== undefined
        && item.configurationError !== "provider_not_registered")
      || (item.expiresAt !== undefined && typeof item.expiresAt !== "string")
    )
  ) {
    throw new Error("Runner capability results are malformed.");
  }
  return parsed as import("./types.js").FormalCapabilityResult[];
}

function requireDefinition(manifest: FormalExecutionManifest, caseId: string): FormalCaseDefinition {
  const definition = manifest.cases.find((item) => item.caseId === caseId);
  if (!definition) throw new Error(`Case ${caseId} is not declared in the formal execution manifest.`);
  return definition;
}
