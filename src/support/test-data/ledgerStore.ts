import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { CreateIntentRecord, TestDataSummary, TestResourceRecord, TestRunRecord } from "./types.js";

const localReadme = `# 本机测试数据台账\n\n此目录只保存本机 Runner 创建且登记的非生产测试资源。不得提交、共享、手工替换或用于处理未知来源数据。\n`;

export class LedgerStore {
  readonly root: string;

  constructor(root = resolve(process.cwd(), ".local/test-ledger")) {
    this.root = root;
  }

  async initialize(): Promise<void> {
    await Promise.all(["runs", "resources", "intents", "summaries"].map((segment) => mkdir(resolve(this.root, segment), { recursive: true })));
    const readmePath = resolve(this.root, "README.md");
    if (!existsSync(readmePath)) {
      await atomicWrite(readmePath, localReadme);
    }
  }

  async writeRun(record: TestRunRecord): Promise<void> {
    await this.initialize();
    await atomicWrite(resolve(this.root, "runs", `${record.runId}.json`), record);
  }

  async readRun(runId: string): Promise<TestRunRecord | null> {
    return readJson<TestRunRecord>(resolve(this.root, "runs", `${runId}.json`));
  }

  async listRuns(): Promise<TestRunRecord[]> {
    const directory = resolve(this.root, "runs");
    if (!existsSync(directory)) {
      return [];
    }
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const records = await Promise.all(files.map((file) => readJson<TestRunRecord>(resolve(directory, file))));
    return records.filter((record): record is TestRunRecord => record !== null);
  }

  async writeResource(record: TestResourceRecord): Promise<void> {
    await this.initialize();
    await atomicWrite(this.resourcePath(record.resourceId), record);
  }

  async readResource(resourceId: string): Promise<TestResourceRecord | null> {
    return readJson<TestResourceRecord>(this.resourcePath(resourceId));
  }

  async listResources(): Promise<TestResourceRecord[]> {
    const directory = resolve(this.root, "resources");
    if (!existsSync(directory)) {
      return [];
    }
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const records = await Promise.all(files.map((file) => readJson<TestResourceRecord>(resolve(directory, file))));
    return records.filter((record): record is TestResourceRecord => record !== null);
  }

  async writeIntent(record: CreateIntentRecord): Promise<void> {
    await this.initialize();
    await atomicWrite(this.intentPath(record.intentId), record);
  }

  async readIntent(intentId: string): Promise<CreateIntentRecord | null> {
    return readJson<CreateIntentRecord>(this.intentPath(intentId));
  }

  async listIntents(): Promise<CreateIntentRecord[]> {
    const directory = resolve(this.root, "intents");
    if (!existsSync(directory)) {
      return [];
    }
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const records = await Promise.all(files.map((file) => readJson<CreateIntentRecord>(resolve(directory, file))));
    return records.filter((record): record is CreateIntentRecord => record !== null);
  }

  async deleteResource(resourceId: string): Promise<void> {
    await rm(this.resourcePath(resourceId), { force: true });
  }

  async writeSummary(name: string, summary: TestDataSummary): Promise<void> {
    await this.initialize();
    await atomicWrite(resolve(this.root, "summaries", `${name}.json`), summary);
  }

  resourcePath(resourceId: string): string {
    return resolve(this.root, "resources", `${Buffer.from(resourceId, "utf8").toString("base64url")}.json`);
  }

  intentPath(intentId: string): string {
    return resolve(this.root, "intents", `${Buffer.from(intentId, "utf8").toString("base64url")}.json`);
  }

  /** Serializes budget reservation and create-intent transitions. Remote
   * business calls are intentionally made outside this lock. */
  async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.initialize();
    const lockPath = resolve(this.root, "ledger.lock");
    const owner = `${process.pid}:${randomUUID()}`;
    const leaseMs = 30_000;
    const handle = await acquireLock(lockPath, owner, leaseMs, 5_000);
    if (!handle) throw new Error("Test data ledger is being updated by another worker; retry the same intent transition.");
    try {
      return await operation();
    } finally {
      await handle.close();
      try {
        if ((await readLock(lockPath))?.owner === owner) {
          await rm(lockPath, { force: true });
        }
      } catch {
        // Never remove a lock owned by another process.
      }
    }
  }
}

interface LedgerLock {
  owner: string;
  expiresAt: number;
}

async function acquireLock(lockPath: string, owner: string, leaseMs: number, waitMs: number) {
  const deadline = Date.now() + waitMs;
  while (true) {
    const handle = await tryAcquireLock(lockPath, owner, leaseMs);
    if (handle) return handle;

    const existing = await readLock(lockPath);
    const recoverable = existing
      && (existing.expiresAt <= Date.now() || lockOwnerIsDead(existing.owner));
    if (recoverable) {
      const stalePath = `${lockPath}.stale.${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { force: true });
        continue;
      } catch {
        // Another worker already recovered or replaced the stale lock.
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(50, remaining)));
  }
}

function lockOwnerIsDead(owner: string): boolean {
  const separator = owner.indexOf(":");
  const pid = Number(separator > 0 ? owner.slice(0, separator) : "");
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function tryAcquireLock(lockPath: string, owner: string, leaseMs: number) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ owner, expiresAt: Date.now() + leaseMs } satisfies LedgerLock), "utf8");
    return handle;
  } catch {
    return null;
  }
}

async function readLock(lockPath: string): Promise<LedgerLock | null> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LedgerLock>;
    return typeof value.owner === "string" && typeof value.expiresAt === "number"
      ? { owner: value.owner, expiresAt: value.expiresAt }
      : null;
  } catch {
    return null;
  }
}

export async function atomicWrite(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as T;
}
