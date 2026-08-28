import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { processLockCanBeRecovered, type ProcessLockRecord } from "./processLock.js";

export const WORKFLOW_RUNTIME_SCHEMA_VERSION = "test-workflow-runtime-v1" as const;

export interface RuntimeSessionBinding {
  sessionId: string;
  targetThreadId?: string;
  boundAt: string;
  updatedAt: string;
}

export interface RuntimeReviewerBinding {
  bindingId: string;
  activityId: string;
  batchId: string;
  role: string;
  agentTaskId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
}

export interface RuntimeLeaseRecord {
  activityId: string;
  owner: string;
  leaseId: string;
  fencingToken: number;
  acquiredAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export interface RuntimeLeaseHandle {
  requestId: string;
  activityId: string;
  owner: string;
  leaseId: string;
  fencingToken: number;
  expiresAt: string;
}

export interface RuntimeInFlightOperation {
  operationId: string;
  activityId: string;
  kind: string;
  idempotencyKey: string;
  leaseId: string;
  fencingToken: number;
  startedAt: string;
}

export interface RuntimeStagingRef {
  publishId: string;
  activityId: string;
  manifestPath: string;
  manifestDigest: string;
  leaseId: string;
  fencingToken: number;
  createdAt: string;
}

export interface WorkflowRuntimeState {
  schemaVersion: typeof WORKFLOW_RUNTIME_SCHEMA_VERSION;
  requestId: string;
  revision: number;
  sessionBinding?: RuntimeSessionBinding;
  reviewerBindings: Record<string, RuntimeReviewerBinding>;
  leases: Record<string, RuntimeLeaseRecord>;
  inFlightOperations: Record<string, RuntimeInFlightOperation>;
  stagingRefs: Record<string, RuntimeStagingRef>;
}

export class WorkflowRuntimeConflictError extends Error {}
export class WorkflowRuntimeLeaseError extends Error {}

/**
 * Stores only disposable host/runtime coordination data. Deleting this
 * directory must never change the workflow projection reconstructed from the
 * tracked event history.
 */
export class RuntimeLeaseStore {
  readonly requestId: string;
  readonly requestRoot: string;

  constructor(
    requestId: string,
    runtimeRoot = resolve(process.cwd(), ".local/test-task-runtime")
  ) {
    validateRequestId(requestId);
    this.requestId = requestId;
    this.requestRoot = resolve(runtimeRoot, ...requestId.split("/"));
  }

  get runtimePath(): string {
    return resolve(this.requestRoot, "runtime.json");
  }

  get lockPath(): string {
    return resolve(this.requestRoot, "runtime.lock");
  }

  async read(): Promise<WorkflowRuntimeState | null> {
    if (!existsSync(this.runtimePath)) return null;
    const parsed = JSON.parse(await readFile(this.runtimePath, "utf8")) as
      | WorkflowRuntimeState
      | { schemaVersion: string };
    // Runtime data is disposable coordination state. It is never migrated:
    // any unsupported schema is rejected and durable history remains authoritative.
    const runtime = parsed as WorkflowRuntimeState;
    validateRuntime(runtime, this.requestId);
    return runtime;
  }

  async initialize(expectedRevision = 0): Promise<WorkflowRuntimeState> {
    return this.withExclusive(async () => {
      const current = await this.read();
      if (current) {
        if (current.revision !== expectedRevision) {
          throw new WorkflowRuntimeConflictError(
            `Workflow runtime revision changed from ${expectedRevision} to ${current.revision}.`
          );
        }
        return current;
      }
      if (expectedRevision !== 0) {
        throw new WorkflowRuntimeConflictError(
          `Workflow runtime is missing at expected revision ${expectedRevision}.`
        );
      }
      const created = emptyRuntime(this.requestId);
      await atomicWriteJson(this.runtimePath, created);
      return created;
    });
  }

  async compareAndSwap<T>(
    expectedRevision: number,
    update: (runtime: WorkflowRuntimeState) => T | Promise<T>
  ): Promise<{ result: T; runtime: WorkflowRuntimeState }> {
    return this.withExclusive(async () => {
      const current = (await this.read()) ?? emptyRuntime(this.requestId);
      if (current.revision !== expectedRevision) {
        throw new WorkflowRuntimeConflictError(
          `Workflow runtime revision changed from ${expectedRevision} to ${current.revision}.`
        );
      }
      const draft = structuredClone(current);
      const result = await update(draft);
      validateRuntime(draft, this.requestId);
      draft.revision = current.revision + 1;
      await atomicWriteJson(this.runtimePath, draft);
      return { result, runtime: draft };
    });
  }

  async bindSession(sessionId: string, targetThreadId?: string): Promise<WorkflowRuntimeState> {
    if (!sessionId.trim()) throw new Error("sessionId must not be empty.");
    return this.mutate((runtime) => {
      const timestamp = new Date().toISOString();
      runtime.sessionBinding = {
        sessionId: sessionId.trim(),
        targetThreadId: targetThreadId?.trim() || undefined,
        boundAt: runtime.sessionBinding?.boundAt ?? timestamp,
        updatedAt: timestamp
      };
    });
  }

  async setReviewerBinding(input: {
    bindingId: string;
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId: string;
    status?: RuntimeReviewerBinding["status"];
  }): Promise<WorkflowRuntimeState> {
    validateRuntimeKey(input.bindingId, "bindingId");
    validateRuntimeKey(input.activityId, "activityId");
    validateRuntimeKey(input.batchId, "batchId");
    validateRuntimeKey(input.role, "role");
    if (
      typeof input.agentTaskId !== "string"
      || !input.agentTaskId.trim()
      || input.agentTaskId.length > 512
    ) {
      throw new Error("agentTaskId must be a non-empty runtime-only identifier.");
    }
    return this.mutate((runtime) => {
      assertReviewerTaskIsIsolated(runtime, input.agentTaskId);
      const timestamp = new Date().toISOString();
      const existing = runtime.reviewerBindings[input.bindingId];
      if (existing && (
        existing.activityId !== input.activityId
        || existing.batchId !== input.batchId
        || existing.role !== input.role
        || existing.agentTaskId !== input.agentTaskId.trim()
      )) {
        throw new WorkflowRuntimeConflictError(
          `Reviewer binding ${input.bindingId} already identifies another reviewer task.`
        );
      }
      runtime.reviewerBindings[input.bindingId] = {
        bindingId: input.bindingId,
        activityId: input.activityId,
        batchId: input.batchId,
        role: input.role,
        agentTaskId: input.agentTaskId.trim(),
        status: input.status ?? existing?.status ?? "running",
        startedAt: existing?.startedAt ?? timestamp,
        updatedAt: timestamp
      };
    });
  }

  async assertReviewerTaskIsIsolated(agentTaskId: string): Promise<void> {
    if (
      typeof agentTaskId !== "string"
      || !agentTaskId.trim()
      || agentTaskId.length > 512
    ) {
      throw new Error("agentTaskId must be a non-empty runtime-only identifier.");
    }
    const normalized = agentTaskId.trim();
    const runtime = await this.read();
    if (runtime) assertReviewerTaskIsIsolated(runtime, normalized);
  }

  async requireReviewerBinding(input: {
    bindingId: string;
    activityId: string;
    batchId: string;
    role: string;
    agentTaskId: string;
    status: RuntimeReviewerBinding["status"];
  }): Promise<RuntimeReviewerBinding> {
    await this.assertReviewerTaskIsIsolated(input.agentTaskId);
    const binding = (await this.read())?.reviewerBindings[input.bindingId];
    if (!binding) {
      throw new WorkflowRuntimeConflictError(
        `Reviewer binding ${input.bindingId} is missing; rebind the reviewer before submission.`
      );
    }
    if (
      binding.activityId !== input.activityId
      || binding.batchId !== input.batchId
      || binding.role !== input.role
      || binding.agentTaskId !== input.agentTaskId.trim()
      || binding.status !== input.status
    ) {
      throw new WorkflowRuntimeConflictError(
        `Reviewer binding ${input.bindingId} does not match the isolated reviewer submission.`
      );
    }
    return binding;
  }

  async removeReviewerBinding(bindingId: string): Promise<WorkflowRuntimeState> {
    validateRuntimeKey(bindingId, "bindingId");
    return this.mutate((runtime) => {
      delete runtime.reviewerBindings[bindingId];
    });
  }

  async acquire(
    activityId: string,
    owner: string,
    leaseMs = 120_000,
    now = Date.now()
  ): Promise<RuntimeLeaseHandle> {
    validateRuntimeKey(activityId, "activityId");
    if (!owner.trim()) throw new Error("Lease owner must not be empty.");
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer.");
    }
    let handle!: RuntimeLeaseHandle;
    await this.mutate((runtime) => {
      const existing = runtime.leases[activityId];
      if (existing && !existing.releasedAt && Date.parse(existing.expiresAt) > now) {
        throw new WorkflowRuntimeLeaseError(
          `Activity ${activityId} is leased by another runtime worker until ${existing.expiresAt}.`
        );
      }
      const unresolvedOperations = Object.values(runtime.inFlightOperations)
        .filter((operation) => operation.activityId === activityId);
      const unresolvedStaging = Object.values(runtime.stagingRefs)
        .filter((staging) => staging.activityId === activityId);
      if (unresolvedOperations.length > 0 || unresolvedStaging.length > 0) {
        throw new WorkflowRuntimeLeaseError(
          `Activity ${activityId} has an expired lease with unresolved external or staged work; reconcile it before takeover.`
        );
      }
      const acquiredAt = new Date(now).toISOString();
      const expiresAt = new Date(now + leaseMs).toISOString();
      const record: RuntimeLeaseRecord = {
        activityId,
        owner: owner.trim(),
        leaseId: randomUUID(),
        fencingToken: (existing?.fencingToken ?? 0) + 1,
        acquiredAt,
        expiresAt
      };
      runtime.leases[activityId] = record;
      handle = toHandle(this.requestId, record);
    });
    return handle;
  }

  async reconcileExpiredActivity(input: {
    activityId: string;
    operationIds: string[];
    stagingPublishIds: string[];
    resolution: "confirmed_complete" | "confirmed_not_applied" | "manual_recovery";
    evidenceDigest: string;
  }, now = Date.now()): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(input.evidenceDigest)) {
      throw new Error("Expired activity reconciliation requires a SHA-256 evidenceDigest.");
    }
    const publicationRoots: string[] = [];
    await this.mutate((runtime) => {
      const lease = runtime.leases[input.activityId];
      if (!lease || lease.releasedAt) {
        throw new WorkflowRuntimeLeaseError(
          `Activity ${input.activityId} has no unreleased lease to reconcile.`
        );
      }
      if (Date.parse(lease.expiresAt) > now) {
        throw new WorkflowRuntimeLeaseError(
          `Activity ${input.activityId} lease is still active and cannot be reconciled as expired.`
        );
      }
      const expectedOperationIds = Object.values(runtime.inFlightOperations)
        .filter((operation) => operation.activityId === input.activityId)
        .map((operation) => operation.operationId)
        .sort();
      const expectedPublishIds = Object.values(runtime.stagingRefs)
        .filter((staging) => staging.activityId === input.activityId)
        .map((staging) => staging.publishId)
        .sort();
      if (
        !sameSet(expectedOperationIds, input.operationIds)
        || !sameSet(expectedPublishIds, input.stagingPublishIds)
      ) {
        throw new WorkflowRuntimeConflictError(
          `Activity ${input.activityId} reconciliation must account for every unresolved operation and staging reference.`
        );
      }
      for (const operationId of expectedOperationIds) {
        delete runtime.inFlightOperations[operationId];
      }
      for (const publishId of expectedPublishIds) {
        const staging = runtime.stagingRefs[publishId];
        if (staging) publicationRoots.push(dirname(staging.manifestPath));
        delete runtime.stagingRefs[publishId];
      }
      // The semantic resolution and its evidence belong in workflow history.
      // Local runtime only releases the stale fence after the caller records it.
      lease.releasedAt = new Date(now).toISOString();
    });
    const stagingRoot = resolve(this.requestRoot, "staging");
    for (const publicationRoot of publicationRoots) {
      const resolved = resolve(publicationRoot);
      if (resolved.startsWith(`${stagingRoot}/`)) {
        await rm(resolved, { recursive: true, force: true });
      }
    }
  }

  async renew(
    handle: RuntimeLeaseHandle,
    leaseMs = 120_000,
    now = Date.now()
  ): Promise<RuntimeLeaseHandle> {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("leaseMs must be a positive integer.");
    }
    let renewed!: RuntimeLeaseHandle;
    await this.mutate((runtime) => {
      const current = requireCurrentLease(runtime, handle, now);
      current.expiresAt = new Date(now + leaseMs).toISOString();
      renewed = toHandle(this.requestId, current);
    });
    return renewed;
  }

  async release(handle: RuntimeLeaseHandle, now = Date.now()): Promise<void> {
    await this.mutate((runtime) => {
      const current = requireCurrentLease(runtime, handle, now);
      const unresolved = [
        ...Object.values(runtime.inFlightOperations)
          .filter((operation) => operation.activityId === handle.activityId)
          .map((operation) => operation.operationId),
        ...Object.values(runtime.stagingRefs)
          .filter((staging) => staging.activityId === handle.activityId)
          .map((staging) => staging.publishId)
      ];
      if (unresolved.length > 0) {
        throw new WorkflowRuntimeLeaseError(
          `Activity ${handle.activityId} still owns unresolved runtime work: ${unresolved.join(", ")}.`
        );
      }
      current.releasedAt = new Date(now).toISOString();
    });
  }

  async assertCanCommit(handle: RuntimeLeaseHandle, now = Date.now()): Promise<void> {
    if (handle.requestId !== this.requestId) {
      throw new WorkflowRuntimeLeaseError("Lease handle belongs to another test request.");
    }
    const runtime = await this.read();
    if (!runtime) throw new WorkflowRuntimeLeaseError("Workflow runtime lease state is missing.");
    requireCurrentLease(runtime, handle, now);
  }

  async addInFlightOperation(
    operation: Omit<RuntimeInFlightOperation, "leaseId" | "fencingToken" | "startedAt">,
    handle: RuntimeLeaseHandle,
    now = Date.now()
  ): Promise<void> {
    validateRuntimeKey(operation.operationId, "operationId");
    if (operation.activityId !== handle.activityId) {
      throw new WorkflowRuntimeLeaseError(
        "In-flight operation activityId must match the current runtime lease."
      );
    }
    await this.mutate((runtime) => {
      requireCurrentLease(runtime, handle, now);
      const existing = runtime.inFlightOperations[operation.operationId];
      if (existing) {
        if (existing.idempotencyKey === operation.idempotencyKey) return;
        throw new WorkflowRuntimeConflictError(
          `In-flight operation ${operation.operationId} already has another idempotency key.`
        );
      }
      runtime.inFlightOperations[operation.operationId] = {
        ...operation,
        leaseId: handle.leaseId,
        fencingToken: handle.fencingToken,
        startedAt: new Date(now).toISOString()
      };
    });
  }

  async removeInFlightOperation(
    operationId: string,
    handle: RuntimeLeaseHandle,
    now = Date.now()
  ): Promise<void> {
    await this.mutate((runtime) => {
      requireCurrentLease(runtime, handle, now);
      const existing = runtime.inFlightOperations[operationId];
      if (!existing) return;
      if (existing.leaseId !== handle.leaseId || existing.fencingToken !== handle.fencingToken) {
        throw new WorkflowRuntimeLeaseError(
          `In-flight operation ${operationId} belongs to a stale fencing token.`
        );
      }
      delete runtime.inFlightOperations[operationId];
    });
  }

  async addStagingRef(
    input: Omit<RuntimeStagingRef, "leaseId" | "fencingToken" | "createdAt">,
    handle: RuntimeLeaseHandle,
    now = Date.now()
  ): Promise<void> {
    validateRuntimeKey(input.publishId, "publishId");
    if (input.activityId !== handle.activityId) {
      throw new WorkflowRuntimeLeaseError(
        "Staging reference activityId must match the current runtime lease."
      );
    }
    await this.mutate((runtime) => {
      requireCurrentLease(runtime, handle, now);
      const existing = runtime.stagingRefs[input.publishId];
      if (existing) {
        if (existing.manifestDigest === input.manifestDigest) return;
        throw new WorkflowRuntimeConflictError(
          `Staging reference ${input.publishId} already points to another manifest.`
        );
      }
      runtime.stagingRefs[input.publishId] = {
        ...input,
        leaseId: handle.leaseId,
        fencingToken: handle.fencingToken,
        createdAt: new Date(now).toISOString()
      };
    });
  }

  async removeStagingRef(
    publishId: string,
    handle: RuntimeLeaseHandle,
    now = Date.now()
  ): Promise<void> {
    await this.mutate((runtime) => {
      requireCurrentLease(runtime, handle, now);
      const existing = runtime.stagingRefs[publishId];
      if (!existing) return;
      if (existing.leaseId !== handle.leaseId || existing.fencingToken !== handle.fencingToken) {
        throw new WorkflowRuntimeLeaseError(
          `Staging reference ${publishId} belongs to a stale fencing token.`
        );
      }
      delete runtime.stagingRefs[publishId];
    });
  }

  /**
   * Closes disposable runtime ownership after an ActivitySucceeded or
   * CallbackResolved outcome is durable. The manager may call this without a
   * live handle during replay recovery, but only after replay has projected
   * the corresponding durable activity outcome.
   */
  async finalizeSucceededActivity(
    activityId: string,
    handle?: RuntimeLeaseHandle,
    now = Date.now()
  ): Promise<void> {
    validateRuntimeKey(activityId, "activityId");
    const publicationRoots: string[] = [];
    await this.mutate((runtime) => {
      const lease = runtime.leases[activityId];
      if (handle) {
        if (
          !lease
          || handle.requestId !== this.requestId
          || handle.activityId !== activityId
          || lease.leaseId !== handle.leaseId
          || lease.fencingToken !== handle.fencingToken
          || lease.owner !== handle.owner
        ) {
          throw new WorkflowRuntimeLeaseError(
            `Activity ${activityId} runtime finalization requires its committed fencing token.`
          );
        }
      }
      for (const [operationId, operation] of Object.entries(runtime.inFlightOperations)) {
        if (operation.activityId === activityId) delete runtime.inFlightOperations[operationId];
      }
      for (const [publishId, staging] of Object.entries(runtime.stagingRefs)) {
        if (staging.activityId === activityId) {
          publicationRoots.push(dirname(staging.manifestPath));
          delete runtime.stagingRefs[publishId];
        }
      }
      if (lease && !lease.releasedAt) lease.releasedAt = new Date(now).toISOString();
    });
    const stagingRoot = resolve(this.requestRoot, "staging");
    for (const publicationRoot of publicationRoots) {
      const resolved = resolve(publicationRoot);
      if (resolved.startsWith(`${stagingRoot}/`)) {
        await rm(resolved, { recursive: true, force: true });
      }
    }
  }

  /**
   * Releases a durable retry attempt without discarding unresolved runtime
   * evidence. The manager may call this only after RetryScheduled is durable.
   */
  async finalizeRetryableActivity(
    activityId: string,
    now = Date.now()
  ): Promise<void> {
    validateRuntimeKey(activityId, "activityId");
    await this.mutate((runtime) => {
      const unresolved = [
        ...Object.values(runtime.inFlightOperations)
          .filter((operation) => operation.activityId === activityId)
          .map((operation) => operation.operationId),
        ...Object.values(runtime.stagingRefs)
          .filter((staging) => staging.activityId === activityId)
          .map((staging) => staging.publishId)
      ];
      if (unresolved.length) {
        throw new WorkflowRuntimeLeaseError(
          `Activity ${activityId} still owns unresolved runtime work: ${unresolved.join(", ")}.`
        );
      }
      const lease = runtime.leases[activityId];
      if (lease && !lease.releasedAt) {
        lease.releasedAt = new Date(now).toISOString();
      }
    });
  }

  /**
   * Clears a runtime operation handle after its reconciliation event is
   * durable. Handle-less use is reserved for manager replay recovery.
   */
  async finalizeReconciledOperation(
    activityId: string,
    operationId: string,
    handle?: RuntimeLeaseHandle
  ): Promise<void> {
    validateRuntimeKey(activityId, "activityId");
    validateRuntimeKey(operationId, "operationId");
    await this.mutate((runtime) => {
      const operation = runtime.inFlightOperations[operationId];
      if (!operation) return;
      if (operation.activityId !== activityId) {
        throw new WorkflowRuntimeConflictError(
          `Runtime operation ${operationId} belongs to another activity.`
        );
      }
      if (handle && (
        handle.requestId !== this.requestId
        || handle.activityId !== activityId
        || operation.leaseId !== handle.leaseId
        || operation.fencingToken !== handle.fencingToken
      )) {
        throw new WorkflowRuntimeLeaseError(
          `Runtime operation ${operationId} belongs to a stale fencing token.`
        );
      }
      delete runtime.inFlightOperations[operationId];
    });
  }

  /**
   * Removes all disposable coordination files after the workflow reached a
   * durable terminal event. Callers must append WorkflowCompleted or
   * WorkflowCancelled before invoking this method: runtime state is never a
   * source of workflow truth and cannot be used to recover a non-terminal
   * request.
   */
  async discardTerminalRuntime(): Promise<void> {
    await rm(this.requestRoot, { recursive: true, force: true });
  }

  private async mutate(
    update: (runtime: WorkflowRuntimeState) => void | Promise<void>
  ): Promise<WorkflowRuntimeState> {
    return this.withExclusive(async () => {
      const current = (await this.read()) ?? emptyRuntime(this.requestId);
      const draft = structuredClone(current);
      await update(draft);
      validateRuntime(draft, this.requestId);
      draft.revision = current.revision + 1;
      await atomicWriteJson(this.runtimePath, draft);
      return draft;
    });
  }

  private async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.requestRoot, { recursive: true });
    const owner = `${process.pid}:${randomUUID()}`;
    let handle;
    try {
      handle = await open(this.lockPath, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({ owner, expiresAt: Date.now() + 30_000 }),
        "utf8"
      );
      await handle.sync();
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        handle = undefined;
      }
      let recoverable = false;
      try {
        const [lockText, lockStat] = await Promise.all([
          readFile(this.lockPath, "utf8"),
          stat(this.lockPath)
        ]);
        let record: ProcessLockRecord = {};
        try {
          record = JSON.parse(lockText) as ProcessLockRecord;
        } catch {
          // Fresh partial records remain busy until their mtime times out.
        }
        recoverable = processLockCanBeRecovered(
          record,
          Date.now() - lockStat.mtimeMs > 30_000
        );
      } catch {
        // Lock inspection races are not proof that the owner process died.
      }
      if (recoverable) {
        const stalePath = `${this.lockPath}.stale.${randomUUID()}`;
        try {
          await rename(this.lockPath, stalePath);
          await rm(stalePath, { force: true });
          return this.withExclusive(operation);
        } catch {
          // Another process recovered the stale lock first.
        }
      }
      throw new WorkflowRuntimeConflictError(
        `Workflow runtime is being updated by another worker. ${
          error instanceof Error ? (error as NodeJS.ErrnoException).code ?? "" : ""
        }`.trim()
      );
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      try {
        const current = JSON.parse(await readFile(this.lockPath, "utf8")) as { owner?: string };
        if (current.owner === owner) await rm(this.lockPath, { force: true });
      } catch {
        // Never remove a lock that is missing or belongs to another process.
      }
    }
  }
}

function assertReviewerTaskIsIsolated(
  runtime: WorkflowRuntimeState,
  agentTaskId: string
): void {
  const normalized = agentTaskId.trim();
  if (
    runtime.sessionBinding?.sessionId === normalized
    || runtime.sessionBinding?.targetThreadId === normalized
  ) {
    throw new WorkflowRuntimeConflictError(
      "Reviewer task must be isolated from the bound primary session and thread."
    );
  }
}

function emptyRuntime(requestId: string): WorkflowRuntimeState {
  return {
    schemaVersion: WORKFLOW_RUNTIME_SCHEMA_VERSION,
    requestId,
    revision: 0,
    reviewerBindings: {},
    leases: {},
    inFlightOperations: {},
    stagingRefs: {}
  };
}

function requireCurrentLease(
  runtime: WorkflowRuntimeState,
  handle: RuntimeLeaseHandle,
  now: number
): RuntimeLeaseRecord {
  if (handle.requestId !== runtime.requestId) {
    throw new WorkflowRuntimeLeaseError("Lease handle belongs to another test request.");
  }
  const current = runtime.leases[handle.activityId];
  if (
    !current
    || current.leaseId !== handle.leaseId
    || current.fencingToken !== handle.fencingToken
    || current.owner !== handle.owner
    || current.releasedAt
  ) {
    throw new WorkflowRuntimeLeaseError(
      `Activity ${handle.activityId} lease has been replaced or released; stale fencing token cannot commit.`
    );
  }
  if (Date.parse(current.expiresAt) <= now) {
    throw new WorkflowRuntimeLeaseError(
      `Activity ${handle.activityId} lease expired; reconcile before acquiring a new lease.`
    );
  }
  return current;
}

function toHandle(requestId: string, record: RuntimeLeaseRecord): RuntimeLeaseHandle {
  return {
    requestId,
    activityId: record.activityId,
    owner: record.owner,
    leaseId: record.leaseId,
    fencingToken: record.fencingToken,
    expiresAt: record.expiresAt
  };
}

function validateRuntime(runtime: WorkflowRuntimeState, requestId: string): void {
  if (
    runtime.schemaVersion !== WORKFLOW_RUNTIME_SCHEMA_VERSION
    || runtime.requestId !== requestId
    || !Number.isInteger(runtime.revision)
    || runtime.revision < 0
  ) {
    throw new Error("Workflow runtime snapshot has an invalid identity or revision.");
  }
  if (
    !runtime.reviewerBindings
    || !runtime.leases
    || !runtime.inFlightOperations
    || !runtime.stagingRefs
    || typeof runtime.reviewerBindings !== "object"
    || typeof runtime.leases !== "object"
    || typeof runtime.inFlightOperations !== "object"
    || typeof runtime.stagingRefs !== "object"
  ) {
    throw new Error("Workflow runtime snapshot is missing required collections.");
  }
  if (runtime.sessionBinding && !runtime.sessionBinding.sessionId.trim()) {
    throw new Error("Workflow runtime session binding is empty.");
  }
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === [...right].sort()[index]);
}

function validateRequestId(requestId: string): void {
  const segments = requestId.split("/");
  if (!requestId || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error("requestId must be a relative slash-separated test request identifier.");
  }
}

function validateRuntimeKey(value: string, label: string): void {
  if (!value || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
