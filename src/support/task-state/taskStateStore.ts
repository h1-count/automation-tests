import { appendFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite } from "../test-data/ledgerStore.js";
import type { TaskStateEvent, TestTaskState } from "./types.js";

export class TaskStateConflictError extends Error {}

function validateStateSnapshot(state: TestTaskState): void {
  const ids = new Set<string>();
  for (const transaction of state.shortTransactions) {
    if (ids.has(transaction.id)) throw new Error(`Duplicate short transaction id: ${transaction.id}`);
    ids.add(transaction.id);
    if (transaction.claimToken
      && (transaction.status !== "进行中" || !transaction.claimOwner || !transaction.leaseExpiresAt)) {
      throw new Error(`Short transaction ${transaction.id} has an incomplete or invalid claim lease.`);
    }
    if (transaction.status === "已完成" && (!transaction.committedAt || !transaction.verificationResult?.trim())) {
      throw new Error(`Completed short transaction ${transaction.id} is missing commit or verification evidence.`);
    }
    for (const dependency of transaction.dependencies) {
      if (!state.shortTransactions.some((candidate) => candidate.id === dependency)) {
        throw new Error(`Short transaction ${transaction.id} references missing dependency ${dependency}.`);
      }
    }
  }
  const claimed = state.shortTransactions.filter((item) => item.claimToken);
  if (claimed.length > 1) throw new Error("Only one short transaction claim may be active.");
  if (state.activeShortTransactionId) {
    const active = state.shortTransactions.find((item) => item.id === state.activeShortTransactionId);
    if (!active || active.status !== "进行中") throw new Error("activeShortTransactionId must reference the in-progress transaction.");
  }
  const confirmationIds = new Set<string>();
  for (const confirmation of state.confirmations) {
    if (confirmationIds.has(confirmation.id)) throw new Error(`Duplicate confirmation id: ${confirmation.id}`);
    confirmationIds.add(confirmation.id);
    if ((confirmation.affectedTransactionIds?.length ?? 0) !== 1) {
      throw new Error(`Confirmation ${confirmation.id} must bind exactly one short transaction.`);
    }
  }
  if (state.executionAuthorization) {
    const snapshot = state.executionAuthorization;
    if (snapshot.requestId !== state.requestId || !/^[a-f0-9]{64}$/.test(snapshot.digest)) {
      throw new Error("Execution authorization snapshot is incomplete or belongs to another request.");
    }
    const confirmation = state.confirmations.find((item) => item.id === snapshot.confirmationId);
    if (!confirmation || !confirmation.affectedTransactionIds?.includes("STX-14")) {
      throw new Error("Execution authorization must bind the STX-14 confirmation.");
    }
  }
}

export class TaskStateStore {
  readonly root: string;
  readonly requestId: string;

  constructor(requestId: string, root = resolve(process.cwd(), ".local/test-task-state")) {
    const segments = requestId.split("/");
    if (!requestId || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
      throw new Error("requestId must be a relative slash-separated test request identifier.");
    }
    this.requestId = requestId;
    this.root = resolve(root, ...segments);
  }

  get statePath(): string {
    return resolve(this.root, "state.json");
  }

  get eventsPath(): string {
    return resolve(this.root, "events.ndjson");
  }

  get lockPath(): string {
    return resolve(this.root, "state.lock");
  }

  /** Serializes state transitions across independent CLI invocations. A stale
   * lock is recoverable because no business action is performed while held. */
  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const owner = `${process.pid}:${randomUUID()}`;
    let handle;
    try {
      handle = await open(this.lockPath, "wx", 0o600);
      await handle.writeFile(`${owner}\n`, "utf8");
    } catch (error: unknown) {
      if (existsSync(this.lockPath) && Date.now() - statSync(this.lockPath).mtimeMs > 120_000) {
        const stalePath = `${this.lockPath}.stale.${randomUUID()}`;
        try {
          await rename(this.lockPath, stalePath);
          await rm(stalePath, { force: true });
          return this.withExclusive(operation);
        } catch {
          throw new Error("Task state lock recovery lost a concurrent compare-and-swap; retry the same action.");
        }
      }
      throw new Error(`Task state is being updated by another recovery worker; retry the same action. ${error instanceof Error ? error.code ?? "" : ""}`.trim());
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      try {
        const currentOwner = (await readFile(this.lockPath, "utf8")).trim();
        if (currentOwner === owner) await rm(this.lockPath, { force: true });
      } catch {
        // A missing lock after the operation is harmless; a different owner is
        // never removed by this process.
      }
    }
  }

  /** The single state mutation boundary. State replacement is authoritative;
   * audit events carry the committed revision and are appended afterwards so a
   * recovery can reconstruct a missing audit line without replaying work. */
  async transact<T>(
    operation: (state: TestTaskState) => Promise<{ result: T; events: TaskStateEvent[] }>
  ): Promise<T> {
    return this.withExclusive(async () => {
      const state = await this.read();
      if (!state) throw new Error("Local task state does not exist; initialize it before mutation.");
      const { result, events } = await operation(state);
      validateStateSnapshot(state);
      state.revision += 1;
      for (const event of events) event.revision = state.revision;
      await this.write(state);
      for (const event of events) await this.appendEvent(event);
      return result;
    });
  }

  async commitSnapshot(
    state: TestTaskState,
    expectedRevision: number,
    events: TaskStateEvent[],
    lockHeld = false
  ): Promise<void> {
    const commit = async () => {
      const current = await this.read();
      if (current && current.revision !== expectedRevision) {
        throw new TaskStateConflictError(`Task state revision changed from ${expectedRevision} to ${current.revision}; retry the same action.`);
      }
      if (!current && expectedRevision !== 0) {
        throw new TaskStateConflictError("Task state disappeared before commit; retry initialization or recovery.");
      }
      validateStateSnapshot(state);
      state.revision = expectedRevision + 1;
      for (const event of events) event.revision = state.revision;
      await this.write(state);
      for (const event of events) await this.appendEvent(event);
    };
    if (lockHeld) await commit();
    else await this.withExclusive(commit);
  }

  async read(): Promise<TestTaskState | null> {
    if (!existsSync(this.statePath)) return null;
    const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<TestTaskState>;
    // Older states may contain mirrored reviewer conclusions and finding IDs.
    // Keep their runtime envelope readable, but discard those duplicated fields
    // before the next v7 write; plan.md is the formal review record.
    const reviewExecutions = Array.isArray(parsed.reviewExecutions)
      ? parsed.reviewExecutions.map((execution) => {
          const { conclusion: _conclusion, findingIds: _findingIds, ...runtimeEnvelope } = execution as Record<string, unknown>;
          return runtimeEnvelope;
        })
      : [];
    const reviewBatches = Array.isArray(parsed.reviewBatches)
      ? parsed.reviewBatches.map((batch) => {
          const { invalidationReason: _reason, invalidationEvidence: _evidence, ...runtimeEnvelope } = batch as Record<string, unknown>;
          return {
            ...runtimeEnvelope,
            automaticEvolutionRound: typeof runtimeEnvelope.automaticEvolutionRound === "number"
              ? runtimeEnvelope.automaticEvolutionRound
              : 0,
            revisionEvidenceRefs: Array.isArray(runtimeEnvelope.revisionEvidenceRefs)
              ? runtimeEnvelope.revisionEvidenceRefs
              : undefined
          };
        })
      : [];
    return {
      ...parsed,
      schemaVersion: "test-task-state-v10",
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
      reviewBatches,
      reviewExecutions,
      reviewTransactions: Array.isArray(parsed.reviewTransactions) ? parsed.reviewTransactions : [],
      shortTransactions: Array.isArray(parsed.shortTransactions) ? parsed.shortTransactions : [],
      activeShortTransactionId: typeof parsed.activeShortTransactionId === "string" ? parsed.activeShortTransactionId : undefined,
      wakeRequests: Array.isArray(parsed.wakeRequests) ? parsed.wakeRequests : [],
      hostContinuation: parsed.hostContinuation,
      currentOutputs: Array.isArray(parsed.currentOutputs) ? parsed.currentOutputs : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      confirmations: Array.isArray(parsed.confirmations) ? parsed.confirmations : [],
      executionAuthorization: parsed.executionAuthorization,
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : []
    } as TestTaskState;
  }

  async write(state: TestTaskState): Promise<void> {
    await atomicWrite(this.statePath, state);
  }

  async appendEvent(event: TaskStateEvent): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  /** Repairs audit lines that were interrupted after the authoritative state
   * snapshot was replaced. Runtime work is not replayed. */
  async reconcileAuditLog(state: TestTaskState): Promise<number> {
    let persisted = "";
    try {
      persisted = await readFile(this.eventsPath, "utf8");
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const eventIds = new Set(persisted.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<TaskStateEvent>;
        return parsed.id ? [parsed.id] : [];
      } catch {
        return [];
      }
    }));
    const missing = state.recentEvents.filter((event) => event.id && !eventIds.has(event.id));
    for (const event of missing) await this.appendEvent(event);
    return missing.length;
  }
}
