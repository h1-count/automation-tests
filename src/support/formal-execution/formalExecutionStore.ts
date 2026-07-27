import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LedgerStore, atomicWrite, atomicWriteText } from "../test-data/ledgerStore.js";
import type {
  FormalCapabilityResult,
  FormalCaseStatus,
  FormalExecutionManifest,
  FormalExecutionRecord,
  FormalExecutionSummary
} from "./types.js";
import { digestFormalExecutionManifest } from "./manifest.js";

export class FormalExecutionStore {
  private readonly ledger: LedgerStore;
  private readonly artifactRoot: string;

  constructor(
    ledgerRoot = resolve(process.cwd(), ".local/test-ledger"),
    artifactRoot = resolve(process.cwd(), "artifacts/test-results/formal")
  ) {
    this.ledger = new LedgerStore(ledgerRoot);
    this.artifactRoot = artifactRoot;
  }

  async initialize(input: {
    manifest: FormalExecutionManifest;
    authorizationDigest: string;
    testDataRunId: string;
    capabilities: FormalCapabilityResult[];
  }): Promise<FormalExecutionRecord> {
    return this.ledger.withExclusive(async () => {
      const existing = await this.read(input.authorizationDigest);
      const manifestDigest = digestFormalExecutionManifest(input.manifest);
      if (existing) {
        if (existing.manifestDigest !== manifestDigest || existing.testDataRunId !== input.testDataRunId) {
          throw new Error("Formal execution state differs from the immutable manifest or test-data run.");
        }
        existing.capabilities = Object.fromEntries(input.capabilities.map((item) => [item.capabilityId, item]));
        existing.updatedAt = new Date().toISOString();
        await this.write(existing);
        return existing;
      }
      const timestamp = new Date().toISOString();
      const record: FormalExecutionRecord = {
        schemaVersion: "formal-execution-record-v1",
        requestId: input.manifest.requestId,
        projectId: input.manifest.projectId,
        environment: input.manifest.environment,
        authorizationDigest: input.authorizationDigest,
        manifestDigest,
        testDataRunId: input.testDataRunId,
        startedAt: timestamp,
        updatedAt: timestamp,
        cases: Object.fromEntries(input.manifest.cases.map((item) => [
          item.caseId,
          { caseId: item.caseId, status: "unknown" as const, attempts: [], updatedAt: timestamp }
        ])),
        capabilities: Object.fromEntries(input.capabilities.map((item) => [item.capabilityId, item])),
        resources: Object.fromEntries([
          ...(input.manifest.externalResources ?? []).map((name) => [
            name,
            { name, available: true, confirmedAt: timestamp, evidence: "Declared external runtime resource." }
          ] as const),
          ...input.manifest.cases.flatMap((item) => item.producesResources.map((name) => [
            name,
            { name, available: false, producerCaseId: item.caseId }
          ] as const))
        ])
      };
      await this.write(record);
      return record;
    });
  }

  async read(authorizationDigest: string): Promise<FormalExecutionRecord | null> {
    const path = this.statePath(authorizationDigest);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, "utf8")) as FormalExecutionRecord;
  }

  async beginCase(authorizationDigest: string, caseId: string): Promise<number> {
    return this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      const result = requireCase(record, caseId);
      const timestamp = new Date().toISOString();
      const attempt = result.attempts.length + 1;
      result.status = "unknown";
      result.reason = undefined;
      result.updatedAt = timestamp;
      result.attempts.push({ attempt, status: "unknown", startedAt: timestamp });
      record.updatedAt = timestamp;
      await this.write(record);
      return attempt;
    });
  }

  async finishCase(
    authorizationDigest: string,
    caseId: string,
    attempt: number,
    status: Exclude<FormalCaseStatus, "unknown">,
    reason?: string,
    evidenceRefs?: string[]
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      const result = requireCase(record, caseId);
      const current = result.attempts.find((item) => item.attempt === attempt);
      if (!current) throw new Error(`Formal attempt ${caseId}#${attempt} is missing.`);
      if (current.endedAt) {
        if (current.status !== status) throw new Error(`Formal attempt ${caseId}#${attempt} already ended as ${current.status}.`);
        return;
      }
      const timestamp = new Date().toISOString();
      current.status = status;
      current.reason = reason;
      current.evidenceRefs = evidenceRefs;
      current.endedAt = timestamp;
      result.status = status;
      result.reason = reason;
      result.updatedAt = timestamp;
      record.updatedAt = timestamp;
      await this.write(record);
    });
  }

  async markBlocked(authorizationDigest: string, caseId: string, reason: string): Promise<void> {
    const attempt = await this.beginCase(authorizationDigest, caseId);
    await this.finishCase(authorizationDigest, caseId, attempt, "blocked", reason);
  }

  async reconcileOpenAttempts(authorizationDigest: string, reason: string): Promise<string[]> {
    return this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      const timestamp = new Date().toISOString();
      const reconciled: string[] = [];
      for (const result of Object.values(record.cases)) {
        if (result.status !== "unknown") continue;
        const openAttempt = [...result.attempts].reverse().find((item) => !item.endedAt);
        if (!openAttempt) continue;
        openAttempt.status = "failed";
        openAttempt.reason = reason;
        openAttempt.endedAt = timestamp;
        result.status = "failed";
        result.reason = reason;
        result.updatedAt = timestamp;
        reconciled.push(result.caseId);
      }
      if (reconciled.length > 0) {
        record.updatedAt = timestamp;
        await this.write(record);
      }
      return reconciled.sort();
    });
  }

  async confirmResource(authorizationDigest: string, name: string, producerCaseId: string, evidence: string): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      const resource = record.resources[name];
      if (!resource) throw new Error(`Named formal resource ${name} is not declared.`);
      if (resource.producerCaseId && resource.producerCaseId !== producerCaseId) {
        throw new Error(`Named formal resource ${name} belongs to ${resource.producerCaseId}, not ${producerCaseId}.`);
      }
      resource.available = true;
      resource.producerCaseId = producerCaseId;
      resource.confirmedAt = new Date().toISOString();
      resource.evidence = evidence;
      record.updatedAt = resource.confirmedAt;
      await this.write(record);
    });
  }

  async resourceAvailable(authorizationDigest: string, name: string): Promise<boolean> {
    return Boolean((await this.require(authorizationDigest)).resources[name]?.available);
  }

  async summarize(authorizationDigest: string): Promise<FormalExecutionSummary> {
    const record = await this.require(authorizationDigest);
    const cases = Object.values(record.cases)
      .sort((left, right) => left.caseId.localeCompare(right.caseId))
      .map((item) => ({ caseId: item.caseId, status: item.status, reason: item.reason }));
    const counts: FormalExecutionSummary["counts"] = {
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      unknown: 0
    };
    for (const item of cases) counts[item.status] += 1;
    const summary: FormalExecutionSummary = {
      requestId: record.requestId,
      authorizationDigest,
      complete: counts.unknown === 0,
      counts,
      cases,
      capabilities: Object.values(record.capabilities).sort((left, right) =>
        left.capabilityId.localeCompare(right.capabilityId)
      ),
      resources: Object.values(record.resources).sort((left, right) => left.name.localeCompare(right.name))
    };
    await this.writeArtifactSummary(summary);
    return summary;
  }

  private async require(authorizationDigest: string): Promise<FormalExecutionRecord> {
    const record = await this.read(authorizationDigest);
    if (!record) throw new Error("Formal execution state is not initialized for this authorization.");
    return record;
  }

  private async write(record: FormalExecutionRecord): Promise<void> {
    await atomicWrite(this.statePath(record.authorizationDigest), record);
  }

  private statePath(authorizationDigest: string): string {
    return resolve(this.ledger.root, "formal", `${authorizationDigest}.json`);
  }

  private async writeArtifactSummary(summary: FormalExecutionSummary): Promise<void> {
    const directory = resolve(this.artifactRoot, summary.authorizationDigest.slice(0, 12));
    await mkdir(directory, { recursive: true });
    await atomicWrite(resolve(directory, "formal-case-results.json"), summary);
    const lines = [
      "# 正式原子用例结果",
      "",
      `- 请求：${summary.requestId}`,
      `- 授权摘要：${summary.authorizationDigest.slice(0, 12)}`,
      `- 完整性：${summary.complete ? "完整" : "不完整"}`,
      `- 通过/失败/阻塞/跳过/未知：${summary.counts.passed}/${summary.counts.failed}/${summary.counts.blocked}/${summary.counts.skipped}/${summary.counts.unknown}`,
      "",
      "| caseId | 状态 | 原因 |",
      "| --- | --- | --- |",
      ...summary.cases.map((item) => `| ${item.caseId} | ${item.status} | ${sanitize(item.reason)} |`),
      ""
    ];
    await atomicWriteText(resolve(directory, "formal-case-results.md"), `${lines.join("\n")}\n`);
  }
}

function requireCase(record: FormalExecutionRecord, caseId: string) {
  const result = record.cases[caseId];
  if (!result) throw new Error(`Case ${caseId} is outside the immutable formal scope.`);
  return result;
}

function sanitize(value?: string): string {
  if (!value) return "";
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 300);
}
