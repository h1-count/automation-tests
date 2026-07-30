import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { processLockCanBeRecovered, type ProcessLockRecord } from "./processLock.js";
import {
  WorkflowHistoryConflictError,
  WorkflowHistoryIntegrityError,
  workflowEventTypes,
  type NewWorkflowEvent,
  type SafeEventPayload,
  type SafeJsonValue,
  type WorkflowEvent,
  type WorkflowHistoryHead
} from "./types.js";

export const GENESIS_DIGEST = "0".repeat(64);
export const WRITABLE_WORKFLOW_DEFINITION_VERSION = "v4";

export type WorkflowHistoryCandidateValidator = (
  events: readonly WorkflowEvent[]
) => void | Promise<void>;

const forbiddenKey = /(?:password|passwd|passcode|otp|verificationcode|cookie|authorization|accesstoken|refreshtoken|claimtoken|leasetoken|threadid|sessionid|secret|privatekey|credential|phone|mobile|email)/i;
const forbiddenValuePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b1[3-9]\d{9}\b/,
  /(?:^|[;\s])(?:cookie|authorization)\s*[:=]/i
];

function assertIdentifier(value: string, name: string): void {
  if (!value.trim() || value.length > 240 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be a non-empty safe identifier.`);
  }
}

export function assertSafeEventPayload(payload: SafeEventPayload): void {
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`Event payload ${path} contains a non-finite number.`);
      return;
    }
    if (typeof value === "string") {
      if (forbiddenValuePatterns.some((pattern) => pattern.test(value))) {
        throw new Error(`Event payload ${path} appears to contain sensitive data.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`Event payload ${path} must contain plain JSON objects.`);
      }
      for (const [key, item] of Object.entries(value)) {
        if (forbiddenKey.test(key.replace(/[-_]/g, ""))) {
          throw new Error(`Event payload key ${path}.${key} is reserved for sensitive runtime data.`);
        }
        if (item === undefined) throw new Error(`Event payload ${path}.${key} is undefined.`);
        visit(item, `${path}.${key}`);
      }
      return;
    }
    throw new Error(`Event payload ${path} contains unsupported ${typeof value}.`);
  };
  visit(payload, "payload");
}

function eventWithoutDigest(event: Omit<WorkflowEvent, "digest">): SafeJsonValue {
  return event as unknown as SafeJsonValue;
}

export function calculateEventDigest(event: Omit<WorkflowEvent, "digest">): string {
  return createHash("sha256").update(canonicalJson(eventWithoutDigest(event)), "utf8").digest("hex");
}

function semanticInput(event: WorkflowEvent): SafeJsonValue {
  return {
    runId: event.runId,
    requestId: event.requestId,
    definitionId: event.definitionId,
    definitionVersion: event.definitionVersion,
    type: event.type,
    actorType: event.actorType,
    causationId: event.causationId ?? null,
    correlationId: event.correlationId ?? null,
    payload: event.payload
  };
}

function semanticNewEvent(event: NewWorkflowEvent): SafeJsonValue {
  return {
    runId: event.runId,
    requestId: event.requestId,
    definitionId: event.definitionId,
    definitionVersion: event.definitionVersion,
    type: event.type,
    actorType: event.actorType,
    causationId: event.causationId ?? null,
    correlationId: event.correlationId ?? null,
    payload: event.payload ?? {}
  };
}

function validateEventShape(event: WorkflowEvent, expectedSeq: number, prevDigest: string): void {
  if (event.schemaVersion !== "test-workflow-event-v1") {
    throw new WorkflowHistoryIntegrityError(`Unsupported workflow event schema at seq ${expectedSeq}.`);
  }
  if (!workflowEventTypes.includes(event.type)) {
    throw new WorkflowHistoryIntegrityError(`Unsupported workflow event type at seq ${expectedSeq}.`);
  }
  if (event.seq !== expectedSeq) {
    throw new WorkflowHistoryIntegrityError(`Workflow history expected seq ${expectedSeq}, received ${event.seq}.`);
  }
  if (event.prevDigest !== prevDigest) {
    throw new WorkflowHistoryIntegrityError(`Workflow history hash chain broke at seq ${expectedSeq}.`);
  }
  assertSafeEventPayload(event.payload);
  const { digest, ...unsigned } = event;
  if (!/^[a-f0-9]{64}$/.test(digest) || calculateEventDigest(unsigned) !== digest) {
    throw new WorkflowHistoryIntegrityError(`Workflow event digest mismatch at seq ${expectedSeq}.`);
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new WorkflowHistoryIntegrityError(`Workflow event occurredAt is invalid at seq ${expectedSeq}.`);
  }
  [
    ["eventId", event.eventId],
    ["runId", event.runId],
    ["requestId", event.requestId],
    ["definitionId", event.definitionId],
    ["definitionVersion", event.definitionVersion],
    ["idempotencyKey", event.idempotencyKey]
  ].forEach(([name, value]) => assertIdentifier(value!, name!));
}

export function verifyWorkflowHistoryText(text: string): WorkflowEvent[] {
  if (!text) return [];
  if (!text.endsWith("\n")) {
    throw new WorkflowHistoryIntegrityError("Workflow history is truncated: final newline is missing.");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => !line.trim())) {
    throw new WorkflowHistoryIntegrityError("Workflow history contains a blank or partial record.");
  }
  const events: WorkflowEvent[] = [];
  const idempotencyKeys = new Set<string>();
  const eventIds = new Set<string>();
  let prevDigest = GENESIS_DIGEST;
  for (let index = 0; index < lines.length; index += 1) {
    let event: WorkflowEvent;
    try {
      event = JSON.parse(lines[index]!) as WorkflowEvent;
    } catch {
      throw new WorkflowHistoryIntegrityError(`Workflow history contains invalid JSON at seq ${index + 1}.`);
    }
    validateEventShape(event, index + 1, prevDigest);
    if (idempotencyKeys.has(event.idempotencyKey)) {
      throw new WorkflowHistoryIntegrityError(`Duplicate idempotency key at seq ${event.seq}.`);
    }
    if (eventIds.has(event.eventId)) {
      throw new WorkflowHistoryIntegrityError(`Duplicate event id at seq ${event.seq}.`);
    }
    idempotencyKeys.add(event.idempotencyKey);
    eventIds.add(event.eventId);
    events.push(event);
    prevDigest = event.digest;
  }
  return events;
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class WorkflowHistoryStore {
  readonly historyPath: string;
  readonly lockPath: string;

  constructor(
    historyPath: string,
    runtimeRoot = resolve(process.cwd(), ".local/workflow-history-locks"),
    readonly candidateValidator?: WorkflowHistoryCandidateValidator
  ) {
    this.historyPath = resolve(historyPath);
    const lockName = createHash("sha256").update(this.historyPath, "utf8").digest("hex");
    this.lockPath = resolve(runtimeRoot, `${lockName}.lock`);
  }

  async read(): Promise<WorkflowEvent[]> {
    if (!existsSync(this.historyPath)) return [];
    return verifyWorkflowHistoryText(await readFile(this.historyPath, "utf8"));
  }

  async head(): Promise<WorkflowHistoryHead> {
    const events = await this.read();
    const last = events.at(-1);
    return { seq: last?.seq ?? 0, digest: last?.digest ?? GENESIS_DIGEST };
  }

  async append(
    input: NewWorkflowEvent,
    expectedHead?: WorkflowHistoryHead,
    validateCandidate?: WorkflowHistoryCandidateValidator
  ): Promise<WorkflowEvent> {
    const [event] = await this.appendBatch([input], expectedHead, validateCandidate);
    return event!;
  }

  async appendBatch(
    inputs: readonly NewWorkflowEvent[],
    expectedHead?: WorkflowHistoryHead,
    validateCandidate?: WorkflowHistoryCandidateValidator
  ): Promise<WorkflowEvent[]> {
    if (!inputs.length) throw new Error("Workflow history append batch must not be empty.");
    for (const input of inputs) {
      if (input.definitionVersion !== WRITABLE_WORKFLOW_DEFINITION_VERSION) {
        throw new WorkflowHistoryIntegrityError(
          `Workflow history append requires definitionVersion ${WRITABLE_WORKFLOW_DEFINITION_VERSION}; ${input.definitionVersion} is replay-only.`
        );
      }
      if (input.type === "LegacyStateImported") {
        throw new WorkflowHistoryIntegrityError(
          "LegacyStateImported is replay-only and can never be appended."
        );
      }
      assertIdentifier(input.idempotencyKey, "idempotencyKey");
      assertSafeEventPayload(input.payload ?? {});
    }
    await Promise.all([
      mkdir(dirname(this.historyPath), { recursive: true }),
      mkdir(dirname(this.lockPath), { recursive: true })
    ]);
    return this.withExclusive(async () => {
      const events = await this.read();
      const legacyEvent = events.find((event) => event.type === "LegacyStateImported");
      if (legacyEvent) {
        throw new WorkflowHistoryIntegrityError(
          `Workflow history is replay-only because seq ${legacyEvent.seq} uses LegacyStateImported; create a new v4 run instead of appending.`
        );
      }
      const legacyDefinitionEvent = events.find(
        (event) => event.definitionVersion !== WRITABLE_WORKFLOW_DEFINITION_VERSION
      );
      if (legacyDefinitionEvent) {
        throw new WorkflowHistoryIntegrityError(
          `Workflow history is replay-only because seq ${legacyDefinitionEvent.seq} uses definitionVersion ${legacyDefinitionEvent.definitionVersion}; create a new v4 run instead of appending.`
        );
      }
      const last = events.at(-1);
      const currentHead = { seq: last?.seq ?? 0, digest: last?.digest ?? GENESIS_DIGEST };
      const eventsByIdempotencyKey = new Map(
        events.map((event) => [event.idempotencyKey, event])
      );
      const hasNewEvent = inputs.some(
        (input) => !eventsByIdempotencyKey.has(input.idempotencyKey)
      );
      if (hasNewEvent && expectedHead
        && (expectedHead.seq !== currentHead.seq || expectedHead.digest !== currentHead.digest)) {
        throw new WorkflowHistoryConflictError(
          `Workflow history head changed from ${expectedHead.seq}:${expectedHead.digest} to ${currentHead.seq}:${currentHead.digest}.`
        );
      }

      const candidate = [...events];
      const result: WorkflowEvent[] = [];
      for (const input of inputs) {
        const duplicate = eventsByIdempotencyKey.get(input.idempotencyKey);
        if (duplicate) {
          if (canonicalJson(semanticInput(duplicate)) !== canonicalJson(semanticNewEvent(input))) {
            throw new WorkflowHistoryConflictError(
              `Idempotency key ${input.idempotencyKey} was already used for different event content.`
            );
          }
          result.push(duplicate);
          continue;
        }
        const candidateHead = candidate.at(-1);
        const unsigned: Omit<WorkflowEvent, "digest"> = {
          schemaVersion: "test-workflow-event-v1",
          eventId: input.eventId ?? randomUUID(),
          seq: (candidateHead?.seq ?? 0) + 1,
          runId: input.runId,
          requestId: input.requestId,
          definitionId: input.definitionId,
          definitionVersion: input.definitionVersion,
          type: input.type,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
          actorType: input.actorType,
          ...(input.causationId ? { causationId: input.causationId } : {}),
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          idempotencyKey: input.idempotencyKey,
          payload: input.payload ?? {},
          prevDigest: candidateHead?.digest ?? GENESIS_DIGEST
        };
        [
          ["eventId", unsigned.eventId],
          ["runId", unsigned.runId],
          ["requestId", unsigned.requestId],
          ["definitionId", unsigned.definitionId],
          ["definitionVersion", unsigned.definitionVersion]
        ].forEach(([name, value]) => assertIdentifier(value!, name!));
        const event: WorkflowEvent = { ...unsigned, digest: calculateEventDigest(unsigned) };
        validateEventShape(event, event.seq, event.prevDigest);
        candidate.push(event);
        eventsByIdempotencyKey.set(event.idempotencyKey, event);
        result.push(event);
      }

      if (this.candidateValidator) await this.candidateValidator(candidate);
      if (validateCandidate && validateCandidate !== this.candidateValidator) {
        await validateCandidate(candidate);
      }
      if (!hasNewEvent) return result;
      const text = `${candidate
        .map((event) => canonicalJson(event as unknown as SafeJsonValue))
        .join("\n")}\n`;
      await this.atomicReplace(text);
      return result;
    });
  }

  private async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const owner = `${process.pid}:${randomUUID()}`;
    const expiresAt = Date.now() + 30_000;
    const acquire = async () => {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify({ owner, expiresAt })}\n`, "utf8");
        await handle.sync();
        return handle;
      } catch {
        return undefined;
      }
    };
    let lock = await acquire();
    if (!lock) {
      let stale = false;
      try {
        const [lockText, lockStat] = await Promise.all([
          readFile(this.lockPath, "utf8"),
          stat(this.lockPath)
        ]);
        let record: ProcessLockRecord = {};
        try {
          record = JSON.parse(lockText) as ProcessLockRecord;
        } catch {
          // A malformed record has no verifiable PID. Its mtime is the only
          // safe fallback, so a freshly-created partial lock is never stolen.
        }
        stale = processLockCanBeRecovered(
          record,
          Date.now() - lockStat.mtimeMs > 30_000
        );
      } catch {
        // A concurrent worker may be replacing or releasing the lock. Treat
        // inspection failure as busy instead of guessing that ownership died.
      }
      if (stale) {
        const stalePath = `${this.lockPath}.stale.${randomUUID()}`;
        try {
          await rename(this.lockPath, stalePath);
          await rm(stalePath, { force: true });
          lock = await acquire();
        } catch {
          // Another worker won stale-lock recovery.
        }
      }
    }
    if (!lock) throw new WorkflowHistoryConflictError("Workflow history is being updated by another worker.");
    try {
      return await operation();
    } finally {
      await lock.close();
      try {
        const record = JSON.parse(await readFile(this.lockPath, "utf8")) as { owner?: string };
        if (record.owner === owner) await rm(this.lockPath, { force: true });
      } catch {
        // Never remove a lock that is missing or belongs to another worker.
      }
    }
  }

  private async atomicReplace(text: string): Promise<void> {
    const directory = dirname(this.historyPath);
    const temporaryPath = `${this.historyPath}.${process.pid}.${randomUUID()}.tmp`;
    let temporary;
    try {
      temporary = await open(temporaryPath, "wx", 0o600);
      await temporary.writeFile(text, "utf8");
      await temporary.sync();
      await temporary.close();
      temporary = undefined;
      await rename(temporaryPath, this.historyPath);
      await fsyncDirectory(directory);
    } finally {
      if (temporary) await temporary.close();
      await rm(temporaryPath, { force: true });
    }
  }
}
