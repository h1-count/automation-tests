import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { CleanupActionRegistry } from "./cleanupRegistry.js";
import { LedgerStore } from "./ledgerStore.js";
import { getMachineId } from "./machine.js";
import { buildSummary, writeArtifactSummary } from "./summary.js";
import {
  assertCleanupAction,
  assertNonProductionEnvironment,
  assertOwnedByCurrentRunner,
  assertSafeMetadata,
  assertSafeText,
  canTransition,
  isExpired
} from "./validators.js";
import {
  localAutomationOwner,
  type AcquireResourceRequest,
  type ConfirmCreatedResourceInput,
  type CreateIntentRecord,
  type DataWritePolicy,
  type PromoteReusableResourceInput,
  type ReconcileCreateIntentInput,
  type RegisterCreatedResourceInput,
  type ReleaseReusableResourceInput,
  type ReserveCreateIntentInput,
  type ResourceValidator,
  type StartRunInput,
  type TestDataSummary,
  type TestResourceRecord,
  type TestResourceState,
  type TestRunRecord,
  type TestRunStatus
} from "./types.js";

export interface TestDataManagerOptions {
  projectId: string;
  envId?: string;
  ledgerRoot?: string;
  artifactRoot?: string;
  cleanupRegistry?: CleanupActionRegistry;
  resourceValidator?: ResourceValidator;
  resourceValidators?: Record<string, ResourceValidator>;
}

/**
 * Manages only resources registered by this local Runner. It never discovers or
 * infers external business resources.
 */
export class TestDataManager {
  readonly store: LedgerStore;
  readonly registry: CleanupActionRegistry;
  private readonly projectId: string;
  private readonly envId?: string;
  private readonly artifactRoot: string;
  private readonly resourceValidator?: ResourceValidator;
  private readonly resourceValidators: Record<string, ResourceValidator>;
  private machineId?: string;

  constructor(options: TestDataManagerOptions) {
    if (!options.projectId.trim()) {
      throw new Error("A scoped projectId is required for local test data management.");
    }
    this.projectId = options.projectId;
    this.envId = options.envId;
    this.store = new LedgerStore(options.ledgerRoot);
    this.registry = options.cleanupRegistry ?? new CleanupActionRegistry();
    this.resourceValidator = options.resourceValidator;
    this.resourceValidators = { ...(options.resourceValidators ?? {}) };
    this.artifactRoot = options.artifactRoot ?? resolve(process.cwd(), "artifacts/test-results");
  }

  registerResourceValidator(baselineContractId: string, validator: ResourceValidator): void {
    if (!baselineContractId.trim()) throw new Error("A reusable fixture validator requires a baselineContractId.");
    if (this.resourceValidators[baselineContractId]) return;
    this.resourceValidators[baselineContractId] = validator;
  }

  async startRun(input: StartRunInput): Promise<TestRunRecord> {
    this.assertScope(input.projectId, input.envId);
    await this.store.initialize();
    const record: TestRunRecord = {
      runId: createRunId(),
      projectId: input.projectId,
      envId: input.envId,
      machineId: await this.currentMachineId(),
      suiteId: input.suiteId,
      caseIds: [...new Set(input.caseIds ?? [])],
      startedAt: new Date().toISOString(),
      status: "running",
      dataWritePolicy: input.dataWritePolicy ?? "ephemeral_cleanup",
      caseWritePolicies: normalizeCaseWritePolicies(input.caseIds ?? [], input.caseWritePolicies),
      caseAllowedWritePolicies: normalizeAllowedCaseWritePolicies(
        input.caseIds ?? [],
        input.caseAllowedWritePolicies
      ),
      authorizationDigest: input.authorizationDigest,
      writeBudget: { ...(input.writeBudget ?? {}) },
      residualTtlHours: input.residualTtlHours ?? 72,
      resources: [],
      createIntents: []
    };
    if (record.dataWritePolicy !== "no_write" && !record.authorizationDigest?.trim()) {
      throw new Error("A writable formal run requires an execution authorization digest.");
    }
    this.assertPoliciesAllowed(record.envId, [
      record.dataWritePolicy,
      ...Object.values(record.caseWritePolicies ?? {}),
      ...Object.values(record.caseAllowedWritePolicies ?? {}).flat()
    ]);
    await this.store.writeRun(record);
    return record;
  }

  /**
   * Returns the one local run bound to an immutable execution authorization.
   * Interrupted workers therefore reuse the same budgets, intents and
   * resources instead of creating another business-data run.
   */
  async startOrResumeAuthorizedRun(input: StartRunInput): Promise<TestRunRecord> {
    this.assertScope(input.projectId, input.envId);
    if (!input.authorizationDigest?.trim()) {
      throw new Error("A stable formal run requires an execution authorization digest.");
    }
    return this.store.withExclusive(async () => {
      const machineId = await this.currentMachineId();
      const expectedCaseIds = [...new Set(input.caseIds ?? [])].sort();
      const matches = (await this.store.listRuns())
        .filter((run) =>
          run.machineId === machineId
          && run.projectId === input.projectId
          && run.envId === input.envId
          && run.suiteId === input.suiteId
          && run.authorizationDigest === input.authorizationDigest
        )
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      if (matches.length > 1) {
        throw new Error("Multiple local runs share the same execution authorization; manual reconciliation is required.");
      }
      const existing = matches[0];
      if (existing) {
        if (JSON.stringify([...existing.caseIds].sort()) !== JSON.stringify(expectedCaseIds)) {
          throw new Error("The stored formal run case scope differs from the confirmed authorization.");
        }
        const expectedPolicy = input.dataWritePolicy ?? "ephemeral_cleanup";
        const expectedCaseWritePolicies = normalizeCaseWritePolicies(
          input.caseIds ?? [],
          input.caseWritePolicies
        );
        const expectedAllowedCaseWritePolicies = normalizeAllowedCaseWritePolicies(
          input.caseIds ?? [],
          input.caseAllowedWritePolicies
        );
        const expectedBudget = input.writeBudget ?? {};
        const expectedResidualTtlHours = input.residualTtlHours ?? 72;
        if (
          existing.dataWritePolicy !== expectedPolicy
          || JSON.stringify(existing.caseWritePolicies ?? {}) !== JSON.stringify(expectedCaseWritePolicies)
          || JSON.stringify(existing.caseAllowedWritePolicies ?? {}) !== JSON.stringify(expectedAllowedCaseWritePolicies)
          || !sameWriteBudget(existing.writeBudget, expectedBudget)
          || existing.residualTtlHours !== expectedResidualTtlHours
        ) {
          throw new Error(
            "The stored formal run write policy, budget, or residual TTL differs from the confirmed authorization."
          );
        }
        if (existing.status !== "passed") {
          existing.status = "running";
          existing.functionalStatus = undefined;
          existing.endedAt = undefined;
          existing.summary = undefined;
          await this.store.writeRun(existing);
        }
        return existing;
      }
      const record: TestRunRecord = {
        runId: createRunId(),
        projectId: input.projectId,
        envId: input.envId,
        machineId,
        suiteId: input.suiteId,
        caseIds: expectedCaseIds,
        startedAt: new Date().toISOString(),
        status: "running",
        dataWritePolicy: input.dataWritePolicy ?? "ephemeral_cleanup",
        caseWritePolicies: normalizeCaseWritePolicies(expectedCaseIds, input.caseWritePolicies),
        caseAllowedWritePolicies: normalizeAllowedCaseWritePolicies(
          expectedCaseIds,
          input.caseAllowedWritePolicies
        ),
        authorizationDigest: input.authorizationDigest,
        writeBudget: { ...(input.writeBudget ?? {}) },
        residualTtlHours: input.residualTtlHours ?? 72,
        resources: [],
        createIntents: []
      };
      this.assertPoliciesAllowed(record.envId, [
        record.dataWritePolicy,
        ...Object.values(record.caseWritePolicies ?? {}),
        ...Object.values(record.caseAllowedWritePolicies ?? {}).flat()
      ]);
      await this.store.writeRun(record);
      return record;
    });
  }

  async endRun(runId: string, status: TestRunStatus): Promise<TestRunRecord> {
    const run = await this.requireRun(runId);
    if (run.status !== "running") {
      throw new Error(`Run ${runId} has already ended with status ${run.status}.`);
    }
    const summary = await this.summarizeRun(runId);
    run.functionalStatus = status === "failed"
      ? "failed"
      : status === "interrupted"
        ? "interrupted"
        : "passed";
    run.dataHygieneStatus = summary.dataHygieneStatus;
    run.status = status;
    run.endedAt = new Date().toISOString();
    run.summary = { ...summary, functionalStatus: run.functionalStatus };
    await this.store.writeRun(run);
    return run;
  }

  async acquireResource(request: AcquireResourceRequest): Promise<TestResourceRecord | null> {
    return this.leaseReusableResource(request);
  }

  async leaseReusableResource(request: AcquireResourceRequest): Promise<TestResourceRecord | null> {
    this.assertScope(request.projectId, request.envId);
    await this.requireRun(request.runId);
    return this.store.withExclusive(async () => {
      const machineId = await this.currentMachineId();
      const requestedMode = request.leaseMode ?? "exclusive";
      const candidates = (await this.store.listResources())
        .filter((resource) => {
          const leases = resource.leases ?? legacyLeases(resource);
          const leaseCompatible = requestedMode === "shared_read"
            ? leases.every((lease) => lease.mode === "shared_read")
            : leases.length === 0;
          return resource.owner === localAutomationOwner
            && resource.machineId === machineId
            && resource.projectId === request.projectId
            && resource.envId === request.envId
            && resource.resourceType === request.resourceType
            && ["available", "leased"].includes(resource.state)
            && resource.reusable
            && !resource.dirty
            && !isExpired(resource)
            && leaseCompatible
            && (!request.baselineContractId
              || resource.pool?.baselineContractId === request.baselineContractId);
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

      for (const resource of candidates) {
        const validator = resource.pool?.baselineContractId
          ? this.resourceValidators[resource.pool.baselineContractId] ?? this.resourceValidator
          : this.resourceValidator;
        if (!validator) continue;
        const validation = await validator(resource);
        resource.lastValidation = { ...validation, checkedAt: new Date().toISOString() };
        if (validation.status !== "passed") {
          resource.dirty = true;
          resource.lease = undefined;
          resource.leases = [];
          await this.transition(
            resource,
            "quarantined",
            validation.message ?? "Reusable fixture baseline validation failed."
          );
          continue;
        }
        if (resource.state === "available") {
          await this.transition(resource, "leased", "Validated reusable fixture lease acquired.");
        }
        const acquiredAt = new Date().toISOString();
        resource.leases = [
          ...(resource.leases ?? legacyLeases(resource)),
          { runId: request.runId, caseId: request.caseId, mode: requestedMode, acquiredAt }
        ];
        resource.lease = requestedMode === "exclusive"
          ? { runId: request.runId, caseId: request.caseId, acquiredAt }
          : undefined;
        resource.reuseCount += 1;
        await this.store.writeResource(resource);
        await this.addResourceToRun(request.runId, resource.resourceId);
        return resource;
      }
      return null;
    });
  }

  async inspectReusablePools(
    pools: Array<{ resourceType: TestResourceRecord["resourceType"]; baselineContractId: string }>
  ): Promise<Array<{
    resourceType: string;
    baselineContractId: string;
    availableCount: number;
    evidenceDigest: string;
    checkedAt: string;
  }>> {
    const machineId = await this.currentMachineId();
    const resources = await this.store.listResources();
    const checkedAt = new Date().toISOString();
    return pools.map((pool) => {
      const matching = resources.filter((resource) =>
        resource.owner === localAutomationOwner
        && resource.machineId === machineId
        && resource.projectId === this.projectId
        && (!this.envId || resource.envId === this.envId)
        && resource.resourceType === pool.resourceType
        && resource.pool?.baselineContractId === pool.baselineContractId
        && resource.state === "available"
        && resource.reusable
        && !resource.dirty
        && !isExpired(resource)
      );
      return {
        resourceType: pool.resourceType,
        baselineContractId: pool.baselineContractId,
        availableCount: matching.length,
        evidenceDigest: createHash("sha256").update(JSON.stringify({
          projectId: this.projectId,
          envId: this.envId,
          resourceType: pool.resourceType,
          baselineContractId: pool.baselineContractId,
          resourceRevisions: matching.map((resource) => ({
            resourceIdDigest: createHash("sha256").update(resource.resourceId).digest("hex"),
            revision: resource.pool?.revision ?? 0,
            updatedAt: resource.updatedAt
          }))
        })).digest("hex"),
        checkedAt
      };
    });
  }

  async reserveCreateIntent(input: ReserveCreateIntentInput): Promise<CreateIntentRecord> {
    this.assertScope(input.projectId, input.envId);
    assertSafeText(input.syntheticKey, "syntheticKey");
    if (!input.caseId.trim()) throw new Error("A create intent requires a caseId.");
    return this.store.withExclusive(async () => {
      const run = await this.requireRun(input.runId);
      if (run.status !== "running") throw new Error(`Run ${run.runId} is not active.`);
      if (!run.caseIds.includes(input.caseId)) {
        throw new Error(`Case ${input.caseId} is not included in the confirmed execution authorization.`);
      }
      const casePolicy = run.caseWritePolicies?.[input.caseId] ?? run.dataWritePolicy;
      const requestedPolicy = input.dataWritePolicy ?? casePolicy;
      const allowedPolicies = run.caseAllowedWritePolicies?.[input.caseId] ?? [casePolicy];
      if (!allowedPolicies.includes(requestedPolicy)) {
        throw new Error(`${input.caseId} cannot create data with undeclared policy ${requestedPolicy}.`);
      }
      this.assertManagedWriteAllowed({
        projectId: input.projectId,
        envId: input.envId,
        resourceType: input.resourceType,
        cleanupActionId: input.cleanupActionId,
        caseId: input.caseId,
        dataWritePolicy: requestedPolicy,
        authorizationDigest: run.authorizationDigest
      });
      await this.assertNoExpiredResidual(input.envId);
      const intentId = createIntentId(run.runId, input.caseId, input.resourceType, input.syntheticKey);
      const existing = await this.store.readIntent(intentId);
      if (existing) return existing;
      const intents = (await this.store.listIntents()).filter((intent) =>
        intent.runId === run.runId
        && intent.resourceType === input.resourceType
        && intent.expectedOutcome === "create"
        && !["failed"].includes(intent.status)
      );
      const budget = run.writeBudget[input.resourceType] ?? 0;
      const created = (await this.resourcesForRun(run)).filter((resource) => resource.resourceType === input.resourceType).length;
      if (budget <= 0 || created >= budget || ((input.expectedOutcome ?? "create") === "create" && intents.length >= budget)) {
        throw new Error(`Write budget exhausted for ${input.resourceType}; new writes are frozen.`);
      }
      const timestamp = new Date().toISOString();
      const expiresAt = input.expiresAt ?? (requestedPolicy === "tracked_residual"
        ? new Date(Date.now() + run.residualTtlHours * 3_600_000).toISOString()
        : undefined);
      const intent: CreateIntentRecord = {
        intentId,
        owner: localAutomationOwner,
        projectId: input.projectId,
        envId: input.envId,
        machineId: run.machineId,
        runId: input.runId,
        caseId: input.caseId,
        resourceType: input.resourceType,
        syntheticKey: input.syntheticKey,
        expectedOutcome: input.expectedOutcome ?? "create",
        dataWritePolicy: requestedPolicy,
        cleanupActionId: input.cleanupActionId,
        authorizationDigest: run.authorizationDigest,
        status: "planned",
        plannedAt: timestamp,
        updatedAt: timestamp,
        expiresAt,
        evidence: input.evidence
      };
      await this.store.writeIntent(intent);
      run.createIntents.push(intent.intentId);
      await this.store.writeRun(run);
      return intent;
    });
  }

  async markIntentCreating(intentId: string): Promise<CreateIntentRecord> {
    return this.transitionIntent(intentId, ["planned"], "creating", "Remote create operation started.");
  }

  async markCreationFailed(intentId: string, message: string): Promise<CreateIntentRecord> {
    assertSafeText(message, "message");
    return this.transitionIntent(intentId, ["planned", "creating"], "failed", message);
  }

  async markCreationUnknown(intentId: string, message: string): Promise<CreateIntentRecord> {
    assertSafeText(message, "message");
    return this.transitionIntent(intentId, ["creating"], "creation_unknown", message);
  }

  async confirmCreatedResource(input: ConfirmCreatedResourceInput): Promise<TestResourceRecord> {
    assertSafeText(input.resourceId, "resourceId");
    assertSafeMetadata(input.metadata ?? {});
    return this.store.withExclusive(async () => {
      const intent = await this.requireIntent(input.intentId);
      if (!["creating", "creation_unknown", "created", "reconciled"].includes(intent.status)) {
        throw new Error(`Create intent ${intent.intentId} cannot confirm a resource from ${intent.status}.`);
      }
      if (intent.resourceId) {
        if (intent.resourceId !== input.resourceId) throw new Error("A create intent cannot be rebound to another resource.");
        const persisted = await this.store.readResource(input.resourceId);
        if (persisted) return persisted;
      }
      const run = await this.requireRun(intent.runId);
      const existing = await this.store.readResource(input.resourceId);
      if (existing) {
        if (existing.createIntentId !== intent.intentId) {
          throw new Error("A local ledger record already exists for this resource ID.");
        }
        return existing;
      }
      const action = this.registry.get(intent.cleanupActionId, intent.resourceType);
      const ephemeralCleanup = isEphemeralCleanup(intent.dataWritePolicy);
      const timestamp = new Date().toISOString();
      const reusableFixture = intent.dataWritePolicy === "reusable_fixture";
      const initialState: TestResourceState = ephemeralCleanup || reusableFixture
        ? "registered"
        : "retained";
      const record: TestResourceRecord = {
        resourceId: input.resourceId,
        resourceType: intent.resourceType,
        owner: localAutomationOwner,
        projectId: intent.projectId,
        envId: intent.envId,
        machineId: intent.machineId,
        runId: intent.runId,
        caseId: intent.caseId,
        createIntentId: intent.intentId,
        dataWritePolicy: intent.dataWritePolicy,
        state: initialState,
        reusable: input.reusable ?? reusableFixture,
        dirty: false,
        cleanupActionId: ephemeralCleanup && action?.idempotent ? intent.cleanupActionId : undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: intent.expiresAt,
        metadata: input.metadata ?? {},
        sensitiveFields: input.sensitiveFields,
        evidence: [...(intent.evidence ?? []), ...(input.evidence ?? [])],
        reuseCount: 0,
        stateHistory: [{
          state: initialState,
          at: timestamp,
          message: ephemeralCleanup
            ? "Resource confirmed from a pre-registered create intent."
            : reusableFixture
              ? "Resource confirmed as a reusable fixture candidate pending promotion."
              : "Authorized test resource retained until its declared expiry."
        }]
      };
      await this.store.writeResource(record);
      if (ephemeralCleanup) {
        await this.transition(record, "available", "Ephemeral resource is available to the current run.");
      }
      intent.resourceId = input.resourceId;
      intent.status = intent.status === "creation_unknown" ? "reconciled" : "created";
      intent.updatedAt = timestamp;
      intent.message = "Exact resource identity confirmed.";
      await this.store.writeIntent(intent);
      await this.addResourceToRun(run.runId, record.resourceId);
      return record;
    });
  }

  async reconcileCreateIntent(input: ReconcileCreateIntentInput): Promise<CreateIntentRecord | TestResourceRecord> {
    const intent = await this.requireIntent(input.intentId);
    if (intent.status !== "creation_unknown") {
      throw new Error(`Only a creation_unknown intent may be reconciled; received ${intent.status}.`);
    }
    if (input.resolution === "created") {
      return this.confirmCreatedResource(input);
    }
    return this.transitionIntent(intent.intentId, ["creation_unknown"], "reconciled", input.message ?? "Exact lookup confirmed that no resource was created.");
  }

  async registerCreatedResource(input: RegisterCreatedResourceInput): Promise<TestResourceRecord> {
    this.assertScope(input.projectId, input.envId);
    assertSafeText(input.resourceId, "resourceId");
    assertSafeMetadata(input.metadata ?? {});
    const run = await this.requireRun(input.runId);
    const existing = await this.store.readResource(input.resourceId);
    if (existing) {
      throw new Error("A local ledger record already exists for this resource ID; do not overwrite resource ownership.");
    }
    const action = this.registry.get(input.cleanupActionId, input.resourceType);
    const hasRegisteredIdempotentCleanup = Boolean(input.cleanupActionId && action?.idempotent);
    const now = new Date().toISOString();
    const casePolicy = run.caseWritePolicies?.[input.caseId ?? ""] ?? run.dataWritePolicy;
    const trackedResidual = casePolicy === "tracked_residual";
    const reusableFixture = casePolicy === "reusable_fixture";
    const ephemeralCleanup = isEphemeralCleanup(casePolicy);
    const initialState: TestResourceState = ephemeralCleanup
      ? "registered"
      : reusableFixture
        ? "registered"
        : trackedResidual
          ? "retained"
          : "manual_required";
    const record: TestResourceRecord = {
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      owner: localAutomationOwner,
      projectId: input.projectId,
      envId: input.envId,
      machineId: run.machineId,
      runId: input.runId,
      caseId: input.caseId,
      dataWritePolicy: casePolicy,
      state: initialState,
      reusable: input.reusable,
      dirty: false,
      cleanupActionId: ephemeralCleanup && hasRegisteredIdempotentCleanup
        ? input.cleanupActionId
        : undefined,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? (trackedResidual ? new Date(Date.now() + run.residualTtlHours * 3_600_000).toISOString() : undefined),
      metadata: input.metadata ?? {},
      sensitiveFields: input.sensitiveFields,
      evidence: input.evidence,
      reuseCount: 0,
      stateHistory: [{
        state: initialState,
        at: now,
        message: ephemeralCleanup
          ? "Resource registered by the creating local Runner."
          : reusableFixture
            ? "Resource registered as a reusable fixture candidate pending promotion."
          : trackedResidual
            ? "Authorized test resource retained until its declared expiry."
            : "Cleanup action is missing or not idempotent; automatic handling is disabled."
      }]
    };
    if (ephemeralCleanup) {
      await this.transition(record, "available", "Ephemeral resource is available to the current run.");
    } else {
      await this.store.writeResource(record);
    }
    await this.addResourceToRun(input.runId, input.resourceId);
    return record;
  }

  assertUnattendedWriteAllowed(input: Pick<RegisterCreatedResourceInput, "projectId" | "envId" | "resourceType" | "cleanupActionId" | "caseId">): void {
    this.assertManagedWriteAllowed({ ...input, dataWritePolicy: "managed_cleanup", authorizationDigest: "legacy-authorized" });
  }

  assertManagedWriteAllowed(input: Pick<RegisterCreatedResourceInput, "projectId" | "envId" | "resourceType" | "cleanupActionId" | "caseId"> & {
    dataWritePolicy: TestRunRecord["dataWritePolicy"];
    authorizationDigest?: string;
  }): void {
    this.assertScope(input.projectId, input.envId);
    if (!input.caseId || !input.authorizationDigest?.trim() || input.dataWritePolicy === "no_write") {
      throw new Error("Managed writes require a caseId, a confirmed authorization digest, and a writable policy.");
    }
    if (input.dataWritePolicy === "tracked_residual" && input.envId !== "test") {
      throw new Error("tracked_residual is allowed only in the test environment.");
    }
  }

  async markUsed(resourceId: string): Promise<void> {
    const resource = await this.requireOwnedResource(resourceId);
    await this.transition(resource, "used", "Resource used by the current local Runner.");
  }

  async markDirty(resourceId: string, reason: string): Promise<void> {
    const resource = await this.requireOwnedResource(resourceId);
    resource.dirty = true;
    await this.transition(resource, "dirty", reason);
  }

  async promoteReusableResource(input: PromoteReusableResourceInput): Promise<TestResourceRecord> {
    assertSafeText(input.requestId, "requestId");
    assertSafeText(input.caseId, "caseId");
    assertSafeText(input.syntheticKey, "syntheticKey");
    assertSafeText(input.baselineContractId, "baselineContractId");
    assertSafeText(input.baselineVersion, "baselineVersion");
    if (!Number.isInteger(input.maxPoolSize) || input.maxPoolSize <= 0) {
      throw new Error("Reusable fixture maxPoolSize must be a positive integer.");
    }
    return this.store.withExclusive(async () => {
      const resource = await this.requireOwnedResource(input.resourceId);
      if (resource.dataWritePolicy !== "reusable_fixture") {
        throw new Error("Only reusable_fixture resources can be promoted into the pool.");
      }
      if (resource.caseId !== input.caseId || resource.dirty || !["registered", "quarantined"].includes(resource.state)) {
        throw new Error("Reusable fixture candidate is not clean, owned by the producer case, and promotable.");
      }
      const validator = this.resourceValidators[input.baselineContractId] ?? this.resourceValidator;
      if (!validator) {
        throw new Error(`Reusable fixture baseline validator ${input.baselineContractId} is not registered.`);
      }
      const validation = await validator(resource);
      resource.lastValidation = { ...validation, checkedAt: new Date().toISOString() };
      if (validation.status !== "passed") {
        resource.dirty = true;
        await this.transition(resource, "quarantined", validation.message ?? "Reusable fixture promotion validation failed.");
        return resource;
      }
      const poolResources = (await this.store.listResources()).filter((candidate) =>
        candidate.resourceId !== resource.resourceId
        && candidate.owner === localAutomationOwner
        && candidate.machineId === resource.machineId
        && candidate.projectId === resource.projectId
        && candidate.envId === resource.envId
        && candidate.resourceType === resource.resourceType
        && candidate.pool?.baselineContractId === input.baselineContractId
        && !["cleaned", "retired"].includes(candidate.state)
      );
      if (poolResources.length >= input.maxPoolSize) {
        resource.dirty = false;
        await this.transition(
          resource,
          "quarantined",
          "Reusable fixture pool capacity is full; retire or replace a fixture before promotion."
        );
        return resource;
      }
      const promotedAt = new Date().toISOString();
      resource.reusable = true;
      resource.dirty = false;
      resource.pool = {
        baselineContractId: input.baselineContractId,
        baselineVersion: input.baselineVersion,
        syntheticKey: input.syntheticKey,
        producerRequestId: input.requestId,
        producerCaseId: input.caseId,
        leaseMode: input.leaseMode,
        maxPoolSize: input.maxPoolSize,
        retirementPolicy: input.retirementPolicy ?? "validate_quarantine_replace",
        revision: (resource.pool?.revision ?? 0) + 1,
        promotedAt
      };
      resource.lease = undefined;
      resource.leases = [];
      await this.transition(resource, "available", "Reusable fixture validated and promoted into the local pool.");
      return resource;
    });
  }

  async retainTrackedResidual(
    resourceId: string,
    reason: string
  ): Promise<TestResourceRecord> {
    assertSafeText(reason, "reason");
    const resource = await this.requireOwnedResource(resourceId);
    if (["cleaned", "retired"].includes(resource.state)) {
      throw new Error("A cleaned or retired resource cannot become a tracked residual.");
    }
    const run = await this.requireRun(resource.runId);
    resource.dataWritePolicy = "tracked_residual";
    resource.reusable = false;
    resource.pool = undefined;
    resource.lease = undefined;
    resource.leases = [];
    resource.expiresAt ??= new Date(
      Date.now() + run.residualTtlHours * 3_600_000
    ).toISOString();
    await this.transition(resource, "retained", reason);
    return resource;
  }

  async quarantineReusableResource(resourceId: string, reason: string): Promise<void> {
    assertSafeText(reason, "reason");
    const resource = await this.requireOwnedResource(resourceId);
    if (!resource.pool) throw new Error("Only a managed reusable fixture can be quarantined.");
    resource.dirty = true;
    resource.lease = undefined;
    resource.leases = [];
    await this.transition(resource, "quarantined", reason);
  }

  async retireReusableResource(resourceId: string, reason: string): Promise<void> {
    assertSafeText(reason, "reason");
    const resource = await this.requireOwnedResource(resourceId);
    if (!resource.pool) throw new Error("Only a managed reusable fixture can be retired.");
    resource.reusable = false;
    resource.lease = undefined;
    resource.leases = [];
    await this.transition(resource, "retired", reason);
  }

  async markCleanupPending(resourceId: string): Promise<void> {
    const resource = await this.requireOwnedResource(resourceId);
    await this.transition(resource, "cleanup_pending", "Cleanup requested for local resource.");
  }

  async recordResourceRestored(
    resourceId: string,
    message = "Authorized UI, API or adapter cleanup restored the resource baseline."
  ): Promise<void> {
    assertSafeText(message, "message");
    const resource = await this.requireOwnedResource(resourceId);
    if (!isEphemeralCleanup(resource.dataWritePolicy ?? "no_write")) {
      throw new Error("Only an ephemeral cleanup resource can be recorded as restored.");
    }
    resource.dirty = false;
    resource.lease = undefined;
    resource.leases = [];
    if (resource.state !== "cleanup_pending") {
      await this.transition(resource, "cleanup_pending", "External cleanup evidence was recorded.");
    }
    await this.transition(resource, "cleaning", "External cleanup verification started.");
    await this.transition(resource, "cleaned", message);
  }

  async releaseResource(resourceId: string): Promise<void> {
    const resource = await this.requireOwnedResource(resourceId);
    const runId = resource.lease?.runId ?? resource.leases?.[0]?.runId;
    if (!runId) return;
    await this.releaseReusableResource({
      resourceId,
      runId,
      baselineRestored: !resource.dirty
    });
  }

  async releaseReusableResource(input: ReleaseReusableResourceInput): Promise<void> {
    const resource = await this.requireOwnedResource(input.resourceId);
    const leases = (resource.leases ?? legacyLeases(resource))
      .filter((lease) => lease.runId !== input.runId);
    if (!input.baselineRestored) {
      resource.dirty = true;
      resource.lease = undefined;
      resource.leases = [];
      await this.transition(
        resource,
        resource.pool ? "quarantined" : "dirty",
        input.reason ?? "Resource baseline was not restored before lease release."
      );
      return;
    }
    resource.lease = undefined;
    resource.leases = leases;
    if (leases.length === 0 && ["leased", "used", "dirty", "quarantined"].includes(resource.state)) {
      resource.dirty = false;
      if (resource.pool) resource.pool.revision += 1;
      await this.transition(resource, "available", input.reason ?? "Reusable fixture baseline restored and lease released.");
      return;
    }
    await this.store.writeResource(resource);
  }

  async cleanupRun(runId: string): Promise<TestDataSummary> {
    const run = await this.requireRun(runId);
    const records = await this.resourcesForRun(run);
    for (const resource of records) {
      if (["retained", "retired"].includes(resource.state)) continue;
      if ((resource.leases ?? legacyLeases(resource)).some((lease) => lease.runId === runId)
        && resource.runId !== runId) {
        await this.releaseReusableResource({
          resourceId: resource.resourceId,
          runId,
          baselineRestored: !resource.dirty
        });
        continue;
      }
      if (resource.runId === runId && resource.dataWritePolicy === "reusable_fixture") {
        if (!resource.pool && resource.state !== "quarantined") {
          await this.transition(resource, "quarantined", "Reusable fixture was not promoted before run cleanup.");
        }
        continue;
      }
      if (resource.runId === runId && (!resource.reusable || resource.dirty || resource.state === "cleanup_pending")) {
        await this.cleanupResource(resource, run.envId);
      }
    }
    return this.summarizeRun(runId);
  }

  async recoverLocalResources(): Promise<TestDataSummary> {
    const machineId = await this.currentMachineId();
    const records = await this.store.listResources();
    const eligible = records.filter((resource) => {
      if (resource.owner !== localAutomationOwner || resource.machineId !== machineId || resource.projectId !== this.projectId) {
        return false;
      }
      if (this.envId && resource.envId !== this.envId) {
        return false;
      }
      return ["cleanup_pending", "cleanup_failed", "dirty", "manual_required", "expired"].includes(resource.state);
    });
    for (const resource of eligible) {
      await this.cleanupResource(resource, resource.envId);
    }
    const summary = buildSummary(`recover-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`, eligible);
    await this.store.writeSummary(summary.runId, summary);
    return summary;
  }

  async summarizeRun(runId: string): Promise<TestDataSummary> {
    const run = await this.requireRun(runId);
    const summary = buildSummary(runId, await this.resourcesForRun(run));
    await this.store.writeSummary(runId, summary);
    await writeArtifactSummary(this.artifactRoot, summary);
    return summary;
  }

  private async cleanupResource(resource: TestResourceRecord, envId: string): Promise<void> {
    try {
      assertOwnedByCurrentRunner(resource, { projectId: this.projectId, envId, machineId: await this.currentMachineId() });
      const action = this.registry.get(resource.cleanupActionId, resource.resourceType);
      assertCleanupAction(action, resource);
      if (resource.state !== "cleanup_pending") {
        if (resource.state === "manual_required" || resource.state === "cleanup_failed" || resource.state === "dirty" || resource.state === "expired") {
          await this.transition(resource, "cleanup_pending", "Recovery requested an explicit local cleanup attempt.");
        } else {
          await this.transition(resource, "cleanup_pending", "Local cleanup requested.");
        }
      }
      await this.transition(resource, "cleaning", "Registered cleanup action started.");
      const result = await action.cleanup(resource);
      if (result.status === "manual_required") {
        await this.transition(resource, "manual_required", result.message ?? "Cleanup requires manual handling.");
        return;
      }
      if (result.status === "failed") {
        await this.transition(resource, "cleanup_failed", result.message ?? "Registered cleanup action failed.");
        return;
      }
      const validation = action.validateCleaned ? await action.validateCleaned(resource) : { status: "passed" as const };
      resource.lastValidation = { ...validation, checkedAt: new Date().toISOString() };
      if (validation.status === "failed") {
        await this.transition(resource, "cleanup_failed", validation.message ?? "Cleanup validation failed.");
        return;
      }
      resource.dirty = false;
      await this.transition(resource, "cleaned", result.message ?? "Registered cleanup action completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown cleanup error.";
      if (resource.state === "cleaning") {
        await this.transition(resource, "cleanup_failed", message);
      } else {
        await this.transition(resource, "manual_required", message);
      }
    }
  }

  private async transition(resource: TestResourceRecord, state: TestResourceState, message?: string): Promise<void> {
    if (resource.state !== state && !canTransition(resource.state, state)) {
      throw new Error(`Unsafe local resource state transition: ${resource.state} -> ${state}.`);
    }
    const now = new Date().toISOString();
    resource.state = state;
    resource.updatedAt = now;
    resource.stateHistory.push({ state, at: now, message });
    await this.store.writeResource(resource);
  }

  private async requireRun(runId: string): Promise<TestRunRecord> {
    const run = await this.store.readRun(runId);
    if (!run) {
      throw new Error("Run is not present in the local test ledger.");
    }
    this.assertScope(run.projectId, run.envId);
    if (run.machineId !== (await this.currentMachineId())) {
      throw new Error("Run belongs to a different machine and cannot be managed locally.");
    }
    return run;
  }

  private async requireOwnedResource(resourceId: string): Promise<TestResourceRecord> {
    const resource = await this.store.readResource(resourceId);
    if (!resource) {
      throw new Error("Resource is not present in the local test ledger.");
    }
    assertOwnedByCurrentRunner(resource, { projectId: this.projectId, envId: this.envId, machineId: await this.currentMachineId() });
    return resource;
  }

  private async requireIntent(intentId: string): Promise<CreateIntentRecord> {
    const intent = await this.store.readIntent(intentId);
    if (!intent) throw new Error("Create intent is not present in the local test ledger.");
    this.assertScope(intent.projectId, intent.envId);
    if (intent.machineId !== (await this.currentMachineId()) || intent.owner !== localAutomationOwner) {
      throw new Error("Create intent belongs to another local runner.");
    }
    return intent;
  }

  private async transitionIntent(
    intentId: string,
    allowedFrom: CreateIntentRecord["status"][],
    status: CreateIntentRecord["status"],
    message: string
  ): Promise<CreateIntentRecord> {
    return this.store.withExclusive(async () => {
      const intent = await this.requireIntent(intentId);
      if (intent.status === status) return intent;
      if (!allowedFrom.includes(intent.status)) {
        throw new Error(`Unsafe create intent transition: ${intent.status} -> ${status}.`);
      }
      intent.status = status;
      intent.updatedAt = new Date().toISOString();
      intent.message = message;
      await this.store.writeIntent(intent);
      return intent;
    });
  }

  private async assertNoExpiredResidual(envId: string): Promise<void> {
    const machineId = await this.currentMachineId();
    const expired = (await this.store.listResources()).find((resource) =>
      resource.owner === localAutomationOwner
      && resource.machineId === machineId
      && resource.projectId === this.projectId
      && resource.envId === envId
      && resource.state === "retained"
      && isExpired(resource)
    );
    if (!expired) return;
    expired.state = "expired";
    expired.updatedAt = new Date().toISOString();
    expired.stateHistory.push({ state: "expired", at: expired.updatedAt, message: "Residual TTL expired; new writes are frozen." });
    await this.store.writeResource(expired);
    throw new Error("An expired tracked residual exists; new writes are frozen until it is reconciled.");
  }

  private async addResourceToRun(runId: string, resourceId: string): Promise<void> {
    const run = await this.requireRun(runId);
    if (!run.resources.includes(resourceId)) {
      run.resources.push(resourceId);
      await this.store.writeRun(run);
    }
  }

  private async resourcesForRun(run: TestRunRecord): Promise<TestResourceRecord[]> {
    const resources = await Promise.all(run.resources.map((resourceId) => this.store.readResource(resourceId)));
    return resources.filter((resource): resource is TestResourceRecord => resource !== null);
  }

  private async currentMachineId(): Promise<string> {
    this.machineId ??= await getMachineId(this.store.root);
    return this.machineId;
  }

  private assertScope(projectId: string, envId: string): void {
    if (projectId !== this.projectId || (this.envId && envId !== this.envId)) {
      throw new Error("Run or resource scope does not match the current local automation project/environment.");
    }
    assertNonProductionEnvironment(envId);
  }

  private assertPoliciesAllowed(envId: string, policies: DataWritePolicy[]): void {
    if (policies.some((policy) => policy === "tracked_residual") && envId !== "test") {
      throw new Error("Tracked residual writes are allowed only in the test environment.");
    }
  }
}

function isEphemeralCleanup(policy: DataWritePolicy): boolean {
  return policy === "ephemeral_cleanup" || policy === "managed_cleanup";
}

function normalizeCaseWritePolicies(
  caseIds: string[],
  policies: Record<string, DataWritePolicy> | undefined
): Record<string, DataWritePolicy> {
  if (!policies) return {};
  const allowed = new Set(caseIds);
  const entries = Object.entries(policies)
    .filter(([caseId]) => allowed.has(caseId))
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length !== Object.keys(policies).length) {
    throw new Error("caseWritePolicies contains a case outside the authorized run scope.");
  }
  return Object.fromEntries(entries);
}

function normalizeAllowedCaseWritePolicies(
  caseIds: string[],
  policies: Record<string, DataWritePolicy[]> | undefined
): Record<string, DataWritePolicy[]> {
  if (!policies) return {};
  const allowed = new Set(caseIds);
  const entries = Object.entries(policies)
    .map(([caseId, values]) => [caseId, [...new Set(values)].sort()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([caseId]) => !allowed.has(caseId))) {
    throw new Error("caseAllowedWritePolicies contains a case outside the authorized run scope.");
  }
  return Object.fromEntries(entries);
}

function legacyLeases(resource: TestResourceRecord): NonNullable<TestResourceRecord["leases"]> {
  return resource.lease
    ? [{ ...resource.lease, mode: "exclusive" }]
    : [];
}

function sameWriteBudget(
  left: TestRunRecord["writeBudget"],
  right: TestRunRecord["writeBudget"]
): boolean {
  const entries = (value: TestRunRecord["writeBudget"]) => Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${stamp}-${randomBytes(4).toString("hex")}`;
}

function createIntentId(runId: string, caseId: string, resourceType: string, syntheticKey: string): string {
  return `intent-${createHash("sha256").update(`${runId}\0${caseId}\0${resourceType}\0${syntheticKey}`).digest("hex").slice(0, 24)}`;
}
