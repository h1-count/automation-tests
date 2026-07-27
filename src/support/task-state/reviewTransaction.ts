import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { synchronizeRequest } from "../../../scripts/testcase-relation-projections.ts";
import { atomicWrite } from "../test-data/ledgerStore.js";
import { TestTaskStateManager } from "./testTaskStateManager.js";

type TransactionJournal = {
  id: string;
  batchId: string;
  status: "准备" | "关系已同步" | "已提交" | "待恢复";
  files: string[];
  digest: string;
  updatedAt: string;
  recoveryAction?: string;
};

function digest(paths: string[]): string {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path, "utf8");
    hash.update(readFileSync(path, "utf8"), "utf8");
  }
  return hash.digest("hex");
}

async function writeJournal(path: string, journal: TransactionJournal): Promise<void> {
  await atomicWrite(path, journal);
}

/** Coordinates the mutating relation projection with the single state commit.
 * The journal contains only paths and hashes. If a process ends after syncing
 * files but before closing TASK-04, a retry completes the same transaction. */
export async function finalizeReviewTransaction(
  manager: TestTaskStateManager,
  batchId: string,
  outputPaths: string[]
): Promise<void> {
  const state = await manager.read();
  if (!state?.planPath) throw new Error("Review transaction requires a plan.md path.");
  const transaction = state.reviewTransactions.find((item) => item.batchId === batchId);
  if (!transaction) throw new Error(`Review batch ${batchId} has no durable review transaction.`);
  if (transaction.status === "已提交") return;
  const requestDirectory = resolve(state.planPath, "..");
  const requestFiles = [resolve(state.planPath), ...readdirSync(requestDirectory)
    .filter((name) => /^cases-.*\.md$/.test(name))
    .map((name) => join(requestDirectory, name))];
  const journalPath = join(manager.store.root, "transactions", `${transaction.id}.json`);
  const journal: TransactionJournal = {
    id: transaction.id,
    batchId,
    status: "准备",
    files: requestFiles.map((path) => path.replace(`${process.cwd()}/`, "")),
    digest: digest(requestFiles),
    updatedAt: new Date().toISOString(),
    recoveryAction: "重新执行同一 review-transaction-finalize；不得改用独立关闭命令。"
  };
  await writeJournal(journalPath, journal);
  try {
    const sync = synchronizeRequest(requestDirectory);
    if (sync.issues.length > 0) throw new Error(sync.issues.map((issue) => `${issue.name}: ${issue.detail}`).join("\n"));
    journal.status = "关系已同步";
    journal.digest = digest(requestFiles);
    journal.updatedAt = new Date().toISOString();
    await writeJournal(journalPath, journal);
    await manager.completeReviewTransaction(batchId, outputPaths);
    journal.status = "已提交";
    journal.recoveryAction = undefined;
    journal.updatedAt = new Date().toISOString();
    await writeJournal(journalPath, journal);
  } catch (error) {
    const action = "修复正式记录、reviewer 登记或关系来源后，重新执行同一 review-transaction-finalize。";
    await manager.markReviewTransactionRecovery(batchId, action);
    journal.status = "待恢复";
    journal.recoveryAction = action;
    journal.updatedAt = new Date().toISOString();
    await writeJournal(journalPath, journal);
    throw error;
  }
}

export async function readReviewTransactionJournal(manager: TestTaskStateManager, transactionId: string): Promise<TransactionJournal | null> {
  const path = join(manager.store.root, "transactions", `${transactionId}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as TransactionJournal;
  } catch {
    return null;
  }
}
