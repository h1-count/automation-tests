import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LedgerStore, atomicWrite, atomicWriteText } from "../test-data/ledgerStore.js";
import type {
  FormalCaseDefinition,
  FormalCaseResult,
  FormalCaseDataEvidence,
  FormalCapabilityResult,
  FormalCaseStatus,
  FormalExecutionManifest,
  FormalExecutionRecord,
  FormalExecutionSummary,
  FormalOperationEvidenceRecord
} from "./types.js";
import type { ExecutionDeferredCase } from "./authorization.js";
import type { ExecutionOperationKind } from "./authorization.js";
import { digestFormalExecutionManifest, producedResourceName } from "./manifest.js";
import { sanitizeOperationEvidenceRecord } from "./operationEvidence.js";

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
    caseIds?: string[];
    deferredCases?: ExecutionDeferredCase[];
    targetBuildDigest?: string;
  }): Promise<FormalExecutionRecord> {
    return this.ledger.withExclusive(async () => {
      const existing = await this.read(input.authorizationDigest);
      const manifestDigest = digestFormalExecutionManifest(input.manifest);
      if (existing) {
        if (existing.manifestDigest !== manifestDigest || existing.testDataRunId !== input.testDataRunId) {
          throw new Error("Formal execution state differs from the immutable manifest or test-data run.");
        }
        existing.capabilities = Object.fromEntries(input.capabilities.map((item) => [item.capabilityId, item]));
        existing.deferredCases = input.deferredCases ?? existing.deferredCases ?? [];
        existing.targetBuildDigest = input.targetBuildDigest ?? existing.targetBuildDigest;
        existing.updatedAt = new Date().toISOString();
        await this.write(existing);
        return existing;
      }
      const timestamp = new Date().toISOString();
      const selectedCaseIds = input.caseIds ?? input.manifest.cases.map((item) => item.caseId);
      const knownCaseIds = new Set(input.manifest.cases.map((item) => item.caseId));
      if (selectedCaseIds.some((caseId) => !knownCaseIds.has(caseId))) {
        throw new Error("Formal execution selected an undeclared caseId.");
      }
      const record: FormalExecutionRecord = {
        schemaVersion: "formal-execution-record-v2",
        requestId: input.manifest.requestId,
        projectId: input.manifest.projectId,
        environment: input.manifest.environment,
        authorizationDigest: input.authorizationDigest,
        manifestDigest,
        targetBuildDigest: input.targetBuildDigest,
        testDataRunId: input.testDataRunId,
        startedAt: timestamp,
        updatedAt: timestamp,
        cases: Object.fromEntries(selectedCaseIds.map((caseId) => [
          caseId,
          { caseId, status: "unknown" as const, attempts: [], updatedAt: timestamp }
        ])),
        capabilities: Object.fromEntries(input.capabilities.map((item) => [item.capabilityId, item])),
        deferredCases: input.deferredCases ?? [],
        caseEvidencePolicies: Object.fromEntries(input.manifest.cases.map((item) => [
          item.caseId,
          item.evidencePolicy ?? "standard"
        ])),
        cleanup: { status: "unknown" },
        dataEvidence: {},
        resources: Object.fromEntries([
          ...(input.manifest.externalResources ?? []).map((name) => [
            name,
            { name, available: true, confirmedAt: timestamp, evidence: "Declared external runtime resource." }
          ] as const),
          ...input.manifest.cases.flatMap((item) => item.producesResources.map((resource) => [
            producedResourceName(resource),
            { name: producedResourceName(resource), available: false, producerCaseId: item.caseId }
          ] as const))
        ]),
        stageProgress: Object.fromEntries(selectedCaseIds.map((caseId) => [
          caseId,
          { completedStages: [], transitions: {} }
        ])),
        operationReservations: Object.fromEntries(selectedCaseIds.map((caseId) => [caseId, {}]))
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

  /** Reopens only terminal cases that have no durable business side effect or
   * multi-stage checkpoint. Explicit --resume can then retry infrastructure
   * failures without replaying an OTP, upload, submit or other write. */
  async reopenSafeRetryableCases(authorizationDigest: string): Promise<string[]> {
    return this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      const timestamp = new Date().toISOString();
      const reopened: string[] = [];
      for (const result of Object.values(record.cases)) {
        if (!["failed", "blocked"].includes(result.status)) continue;
        const progress = record.stageProgress?.[result.caseId];
        if (
          (progress?.completedStages.length ?? 0) > 0
          || Object.keys(progress?.transitions ?? {}).length > 0
        ) {
          continue;
        }
        const dataEvidence = record.dataEvidence?.[result.caseId];
        if (
          (dataEvidence?.intents.length ?? 0) > 0
          || (dataEvidence?.resources.length ?? 0) > 0
          || Object.keys(record.operationReservations?.[result.caseId] ?? {}).length > 0
          || Object.values(record.resources).some((resource) =>
            resource.producerCaseId === result.caseId && resource.available
          )
        ) {
          continue;
        }
        result.status = "unknown";
        result.reason = undefined;
        result.updatedAt = timestamp;
        reopened.push(result.caseId);
      }
      if (reopened.length > 0) {
        record.cleanup = { status: "unknown" };
        record.updatedAt = timestamp;
        await this.write(record);
      }
      return reopened.sort();
    });
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
    evidenceRefs?: string[],
    details?: {
      assertions?: string[];
      failureClassification?: string;
      operationEvidence?: FormalOperationEvidenceRecord[];
    }
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
      current.reason = sanitizeSensitiveText(reason);
      current.evidenceRefs = validateEvidenceRefs(evidenceRefs);
      current.assertions = details?.assertions?.map((item) => sanitizeSensitiveText(item)!)
        .filter(Boolean);
      current.failureClassification = details?.failureClassification
        ? sanitizeSensitiveText(details.failureClassification)
        : undefined;
      current.operationEvidence = details?.operationEvidence?.map((item) =>
        sanitizeOperationEvidenceRecord(item)
      );
      current.endedAt = timestamp;
      current.durationMs = Math.max(
        0,
        Date.parse(timestamp) - Date.parse(current.startedAt)
      );
      result.status = status;
      result.reason = current.reason;
      result.updatedAt = timestamp;
      record.updatedAt = timestamp;
      await this.write(record);
      await this.writeCaseEvidenceBundle(
        record.authorizationDigest,
        result,
        record.caseEvidencePolicies?.[caseId] ?? "standard",
        record.dataEvidence?.[caseId]
      );
    });
  }

  async markBlocked(authorizationDigest: string, caseId: string, reason: string): Promise<void> {
    const attempt = await this.beginCase(authorizationDigest, caseId);
    await this.finishCase(authorizationDigest, caseId, attempt, "blocked", reason);
  }

  async appendEvidenceRefs(
    authorizationDigest: string,
    caseId: string,
    evidenceRefs: string[]
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      const result = requireCase(record, caseId);
      const attempt = [...result.attempts].reverse().find((item) => item.endedAt);
      if (!attempt) return;
      attempt.evidenceRefs = validateEvidenceRefs([
        ...(attempt.evidenceRefs ?? []),
        ...evidenceRefs
      ]);
      record.updatedAt = new Date().toISOString();
      await this.write(record);
      await this.writeCaseEvidenceBundle(
        authorizationDigest,
        result,
        record.caseEvidencePolicies?.[caseId] ?? "standard",
        record.dataEvidence?.[caseId]
      );
    });
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
        openAttempt.reason = sanitizeSensitiveText(reason);
        openAttempt.endedAt = timestamp;
        result.status = "failed";
        result.reason = openAttempt.reason;
        result.updatedAt = timestamp;
        reconciled.push(result.caseId);
      }
      if (reconciled.length > 0) {
        record.updatedAt = timestamp;
        await this.write(record);
        for (const caseId of reconciled) {
          await this.writeCaseEvidenceBundle(
            record.authorizationDigest,
            record.cases[caseId]!,
            record.caseEvidencePolicies?.[caseId] ?? "standard",
            record.dataEvidence?.[caseId]
          );
        }
      }
      return reconciled.sort();
    });
  }

  async confirmResource(authorizationDigest: string, name: string, producerCaseId: string, evidence: string): Promise<void> {
    await this.publishResource(authorizationDigest, name, producerCaseId, evidence);
  }

  async publishResource(
    authorizationDigest: string,
    name: string,
    producerCaseId: string,
    evidence: string,
    ledgerResourceId?: string
  ): Promise<void> {
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
      resource.evidence = sanitizeSensitiveText(evidence);
      resource.ledgerResourceId = ledgerResourceId;
      record.updatedAt = resource.confirmedAt;
      await this.write(record);
    });
  }

  async consumeResource(authorizationDigest: string, name: string): Promise<string> {
    const resource = (await this.require(authorizationDigest)).resources[name];
    if (!resource?.available) throw new Error(`Named formal resource ${name} is not available.`);
    if (!resource.ledgerResourceId) {
      throw new Error(`Named formal resource ${name} has no local ledger resource handle.`);
    }
    return resource.ledgerResourceId;
  }

  async resourceAvailable(authorizationDigest: string, name: string): Promise<boolean> {
    return Boolean((await this.require(authorizationDigest)).resources[name]?.available);
  }

  async reserveOperation(
    authorizationDigest: string,
    definition: FormalCaseDefinition,
    operation: ExecutionOperationKind,
    operationKey: string
  ): Promise<"reserved" | "existing"> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationKey)) {
      throw new Error("Formal operation key must be a safe non-sensitive identifier.");
    }
    return this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      requireCase(record, definition.caseId);
      const budget = definition.operationBudgets?.find((item) => item.operation === operation);
      if (!budget) {
        throw new Error(`${definition.caseId} has no immutable budget for ${String(operation)}.`);
      }
      record.operationReservations ??= {};
      const reservations = record.operationReservations[definition.caseId] ??= {};
      const existing = reservations[operationKey];
      if (existing) {
        if (existing.operation !== operation) {
          throw new Error(`${definition.caseId} operation key is already bound to another operation.`);
        }
        return "existing";
      }
      const used = Object.values(reservations).filter((item) => item.operation === operation).length;
      if (used >= budget.maxExecutions) {
        throw new Error(`${definition.caseId} exhausted its ${String(operation)} execution budget.`);
      }
      reservations[operationKey] = {
        operation,
        reservedAt: new Date().toISOString()
      };
      record.updatedAt = reservations[operationKey].reservedAt;
      await this.write(record);
      return "reserved";
    });
  }

  async stageCompleted(
    authorizationDigest: string,
    caseId: string,
    stageId: string
  ): Promise<boolean> {
    const record = await this.require(authorizationDigest);
    requireCase(record, caseId);
    return Boolean(
      record.stageProgress?.[caseId]?.completedStages.some((stage) => stage.stageId === stageId)
    );
  }

  async completeStage(
    authorizationDigest: string,
    definition: FormalCaseDefinition,
    stageId: string,
    evidenceRefs: string[] = []
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      requireCase(record, definition.caseId);
      if (record.schemaVersion !== "formal-execution-record-v2" || !record.stageProgress) {
        throw new Error("Durable execution stages require formal-execution-record-v2.");
      }
      const stage = definition.executionStages?.find((item) => item.stageId === stageId);
      if (!stage) throw new Error(`${definition.caseId} has no declared stage ${stageId}.`);
      const progress = record.stageProgress[definition.caseId]!;
      if (progress.completedStages.some((item) => item.stageId === stageId)) return;
      const missingDependencies = (stage.dependsOnStageIds ?? []).filter((dependency) =>
        !progress.completedStages.some((item) => item.stageId === dependency)
      );
      if (missingDependencies.length > 0) {
        throw new Error(
          `${definition.caseId}/${stageId} is missing completed stages: ${missingDependencies.join(", ")}.`
        );
      }
      const completedAt = new Date().toISOString();
      progress.completedStages.push({
        stageId,
        completedAt,
        evidenceRefs: validateEvidenceRefs(evidenceRefs) ?? []
      });
      progress.completedStages.sort((left, right) => left.stageId.localeCompare(right.stageId));
      record.updatedAt = completedAt;
      await this.write(record);
    });
  }

  async transitionOutcome(
    authorizationDigest: string,
    caseId: string,
    transitionId: string
  ): Promise<string | undefined> {
    const record = await this.require(authorizationDigest);
    requireCase(record, caseId);
    const transition = Object.values(record.stageProgress ?? {}).flatMap((progress) => {
      const value = progress.transitions[transitionId];
      return value ? [value] : [];
    })[0];
    return transition?.status === "resolved" ? transition.outcome : undefined;
  }

  async transitionRecord(
    authorizationDigest: string,
    caseId: string,
    transitionId: string
  ) {
    const record = await this.require(authorizationDigest);
    requireCase(record, caseId);
    return Object.values(record.stageProgress ?? {}).flatMap((progress) => {
      const transition = progress.transitions[transitionId];
      return transition ? [structuredClone(transition)] : [];
    })[0];
  }

  async awaitExternalTransition(
    authorizationDigest: string,
    definition: FormalCaseDefinition,
    transitionId: string
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      requireCase(record, definition.caseId);
      if (record.schemaVersion !== "formal-execution-record-v2" || !record.stageProgress) {
        throw new Error("External transitions require formal-execution-record-v2.");
      }
      const stage = definition.executionStages?.find(
        (item) => item.externalTransition?.transitionId === transitionId
      );
      const transition = stage?.externalTransition;
      if (!stage || !transition) {
        throw new Error(`${definition.caseId} has no declared transition ${transitionId}.`);
      }
      const progress = record.stageProgress[definition.caseId]!;
      if (!progress.completedStages.some((item) => item.stageId === stage.stageId)) {
        throw new Error(
          `${definition.caseId}/${transitionId} cannot wait before stage ${stage.stageId} completes.`
        );
      }
      const existing = progress.transitions[transitionId];
      if (existing?.status === "resolved") return;
      if (!existing) {
        const requestedAt = new Date().toISOString();
        progress.transitions[transitionId] = {
          transitionId,
          caseId: definition.caseId,
          status: "waiting",
          allowedOutcomes: [...transition.allowedOutcomes].sort(),
          requiredAttestationKeys: [...(transition.requiredAttestationKeys ?? [])].sort(),
          checkpointDigest: createHash("sha256").update(JSON.stringify({
            authorizationDigest,
            caseId: definition.caseId,
            stageId: stage.stageId,
            transitionId,
            completedStages: progress.completedStages.map((item) => item.stageId).sort()
          })).digest("hex"),
          requestedAt,
          resumeCount: 0
        };
        record.updatedAt = requestedAt;
        await this.write(record);
      }
    });
  }

  async resolveExternalTransition(input: {
    authorizationDigest: string;
    manifest: FormalExecutionManifest;
    transitionId: string;
    outcome: string;
    attestations: Record<string, boolean>;
  }): Promise<{ duplicate: boolean; checkpointDigest: string }> {
    return this.ledger.withExclusive(async () => {
      const record = await this.require(input.authorizationDigest);
      if (record.manifestDigest !== digestFormalExecutionManifest(input.manifest)) {
        throw new Error("External transition manifest differs from the immutable formal run.");
      }
      const matches = Object.values(record.stageProgress ?? {}).flatMap((progress) => {
        const transition = progress.transitions[input.transitionId];
        return transition ? [transition] : [];
      });
      if (matches.length !== 1) {
        throw new Error(`External transition ${input.transitionId} is not uniquely waiting in this run.`);
      }
      const transition = matches[0]!;
      if (!transition.allowedOutcomes.includes(input.outcome)) {
        throw new Error(`External transition ${input.transitionId} rejects outcome ${input.outcome}.`);
      }
      const attestationKeys = Object.keys(input.attestations).sort();
      const expectedKeys = [...transition.requiredAttestationKeys].sort();
      if (
        JSON.stringify(attestationKeys) !== JSON.stringify(expectedKeys)
        || expectedKeys.some((key) => input.attestations[key] !== true)
      ) {
        throw new Error(
          `External transition ${input.transitionId} requires true attestations: ${expectedKeys.join(", ") || "none"}.`
        );
      }
      const attestationDigest = createHash("sha256").update(JSON.stringify({
        transitionId: input.transitionId,
        outcome: input.outcome,
        attestations: input.attestations
      })).digest("hex");
      if (transition.status === "resolved") {
        if (
          transition.outcome !== input.outcome
          || transition.attestationDigest !== attestationDigest
        ) {
          throw new Error(`External transition ${input.transitionId} was already resolved differently.`);
        }
        return { duplicate: true, checkpointDigest: transition.checkpointDigest };
      }
      const resolvedAt = new Date().toISOString();
      transition.status = "resolved";
      transition.outcome = input.outcome;
      transition.attestationDigest = attestationDigest;
      transition.resolvedAt = resolvedAt;
      transition.resumeCount += 1;
      record.updatedAt = resolvedAt;
      await this.write(record);
      return { duplicate: false, checkpointDigest: transition.checkpointDigest };
    });
  }

  async pendingTransitions(authorizationDigest: string) {
    const record = await this.require(authorizationDigest);
    return Object.values(record.stageProgress ?? {}).flatMap((progress) =>
      Object.values(progress.transitions).filter((transition) => transition.status === "waiting")
    ).sort((left, right) => left.transitionId.localeCompare(right.transitionId));
  }

  async recordCleanup(
    authorizationDigest: string,
    status: "passed" | "failed" | "not_required",
    reason?: string
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      record.cleanup = {
        status,
        completedAt: new Date().toISOString(),
        reason: sanitizeSensitiveText(reason)
      };
      record.updatedAt = record.cleanup.completedAt!;
      await this.write(record);
    });
  }

  async recordDataEvidence(
    authorizationDigest: string,
    evidence: Record<string, FormalCaseDataEvidence>
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      for (const caseId of Object.keys(evidence)) requireCase(record, caseId);
      record.dataEvidence = structuredClone(evidence);
      record.updatedAt = new Date().toISOString();
      await this.write(record);
      for (const [caseId, dataEvidence] of Object.entries(evidence)) {
        await this.writeCaseEvidenceBundle(
          authorizationDigest,
          record.cases[caseId]!,
          record.caseEvidencePolicies?.[caseId] ?? "standard",
          dataEvidence
        );
      }
    });
  }

  async summarize(authorizationDigest: string): Promise<FormalExecutionSummary> {
    const record = await this.require(authorizationDigest);
    const cases = Object.values(record.cases)
      .sort((left, right) => left.caseId.localeCompare(right.caseId))
      .map((item) => ({
        caseId: item.caseId,
        status: item.status,
        reason: item.reason,
        attempts: item.attempts.length,
        evidenceRefs: [...new Set(item.attempts.flatMap((attempt) =>
          attempt.evidenceRefs ?? []
        ))].sort(),
        failureClassification: [...item.attempts].reverse()
          .find((attempt) => attempt.failureClassification)?.failureClassification,
        dataEvidence: record.dataEvidence?.[item.caseId],
        operationEvidence: item.attempts.flatMap((attempt) =>
          attempt.operationEvidence ?? []
        )
      }));
    const counts: FormalExecutionSummary["counts"] = {
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      unknown: 0
    };
    for (const item of cases) counts[item.status] += 1;
    const stageProgress = Object.entries(record.stageProgress ?? {}).map(([caseId, progress]) => ({
      caseId,
      completedStageIds: progress.completedStages.map((stage) => stage.stageId).sort(),
      waitingTransitionIds: Object.values(progress.transitions)
        .filter((transition) => transition.status === "waiting")
        .map((transition) => transition.transitionId).sort(),
      resolvedTransitionIds: Object.values(progress.transitions)
        .filter((transition) => transition.status === "resolved")
        .map((transition) => transition.transitionId).sort()
    })).sort((left, right) => left.caseId.localeCompare(right.caseId));
    const pendingTransitions = Object.values(record.stageProgress ?? {}).flatMap((progress) =>
      Object.values(progress.transitions).filter((transition) => transition.status === "waiting")
    ).sort((left, right) => left.transitionId.localeCompare(right.transitionId));
    const summary: FormalExecutionSummary = {
      requestId: record.requestId,
      projectId: record.projectId,
      environment: record.environment,
      authorizationDigest,
      manifestDigest: record.manifestDigest,
      targetBuildDigest: record.targetBuildDigest,
      complete: counts.unknown === 0 && pendingTransitions.length === 0,
      counts,
      cases,
      capabilities: Object.values(record.capabilities).sort((left, right) =>
        left.capabilityId.localeCompare(right.capabilityId)
      ),
      resources: Object.values(record.resources).map(({ ledgerResourceId: _local, ...resource }) => resource)
        .sort((left, right) => left.name.localeCompare(right.name)),
      stageProgress,
      pendingTransitions,
      deferredCases: [...(record.deferredCases ?? [])].sort((left, right) =>
        left.caseId.localeCompare(right.caseId)
      ),
      cleanup: record.cleanup ?? { status: "unknown" }
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
    await atomicWrite(resolve(directory, "run-summary.json"), {
      schemaVersion: "formal-run-summary-v1",
      ...summary
    });
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
    const executionLines = [
      "# 自动化测试执行摘要",
      "",
      `- 请求：${summary.requestId}`,
      `- 授权摘要：${summary.authorizationDigest}`,
      `- 环境：${summary.environment}`,
      `- 目标构建摘要：${summary.targetBuildDigest ?? "未提供（兼容历史授权）"}`,
      `- 结果：${summary.complete ? "已完成" : "未完整"}`,
      `- 清理：${summary.cleanup.status}${summary.cleanup.reason ? `（${sanitize(summary.cleanup.reason)}）` : ""}`,
      `- 通过：${summary.counts.passed}`,
      `- 失败：${summary.counts.failed}`,
      `- 阻塞：${summary.counts.blocked}`,
      `- 跳过：${summary.counts.skipped}`,
      `- 未执行：${summary.counts.unknown}`,
      `- 等待外部转换：${summary.pendingTransitions.length}`,
      "",
      "| caseId | 状态 | 尝试 | 失败分类 | 操作证据 | 附件证据 | 原因 |",
      "| --- | --- | ---: | --- | --- | --- | --- |",
      ...summary.cases.map((item) =>
        `| ${item.caseId} | ${item.status} | ${item.attempts} | ${sanitize(item.failureClassification)} | ${operationEvidenceSummary(item.operationEvidence)} | ${item.evidenceRefs.map((ref) => `\`${ref}\``).join("<br>")} | ${sanitize(item.reason)} |`
      ),
      "",
      "## 本次未执行的延期用例",
      "",
      ...(summary.deferredCases.length === 0
        ? ["无。"]
        : [
            "| caseId | 阻塞条件 | 解除条件 |",
            "| --- | --- | --- |",
            ...summary.deferredCases.map((item) =>
              `| ${item.caseId} | ${item.blockers.map((blocker) => sanitize(`${blocker.code}: ${blocker.source}`)).join("<br>")} | ${item.blockers.map((blocker) => sanitize(blocker.unblockCondition)).join("<br>")} |`
            )
          ]),
      "",
      "## 多阶段执行检查点",
      "",
      ...(summary.stageProgress.every((item) =>
        item.completedStageIds.length === 0
        && item.waitingTransitionIds.length === 0
        && item.resolvedTransitionIds.length === 0
      )
        ? ["无多阶段用例。"]
        : summary.stageProgress
            .filter((item) =>
              item.completedStageIds.length > 0
              || item.waitingTransitionIds.length > 0
              || item.resolvedTransitionIds.length > 0
            )
            .map((item) =>
              `- ${item.caseId}：已完成=${item.completedStageIds.join(",") || "无"}；等待=${item.waitingTransitionIds.join(",") || "无"}；已恢复=${item.resolvedTransitionIds.join(",") || "无"}`
            )),
      "",
      "## 写入、后置状态与清理证据",
      "",
      ...(summary.cases.some((item) =>
        (item.dataEvidence?.intents.length ?? 0) > 0
        || (item.dataEvidence?.resources.length ?? 0) > 0
      )
        ? summary.cases
            .filter((item) =>
              (item.dataEvidence?.intents.length ?? 0) > 0
              || (item.dataEvidence?.resources.length ?? 0) > 0
            )
            .map((item) =>
              `- ${item.caseId}：intent=${item.dataEvidence?.intents.map((intent) => `${intent.resourceType}:${intent.expectedOutcome}:${intent.status}`).join(",") || "无"}；resource=${item.dataEvidence?.resources.map((resource) => `${resource.resourceType}:${resource.state}`).join(",") || "无"}`
            )
        : ["无业务写入资源。"]),
      ""
    ];
    await atomicWriteText(
      resolve(directory, "execution-summary.md"),
      `${executionLines.join("\n")}\n`
    );
  }

  private async writeCaseEvidenceBundle(
    authorizationDigest: string,
    result: FormalCaseResult,
    evidencePolicy: "standard" | "sensitive",
    dataEvidence?: FormalCaseDataEvidence
  ): Promise<void> {
    const directory = resolve(
      this.artifactRoot,
      authorizationDigest.slice(0, 12),
      "case-evidence"
    );
    await mkdir(directory, { recursive: true });
    await atomicWrite(resolve(directory, `${result.caseId}.json`), {
      schemaVersion: "case-evidence-bundle-v2",
      caseId: result.caseId,
      status: result.status,
      redactionStatus: evidencePolicy === "sensitive"
        ? "safe_alternative_evidence"
        : "verified_redaction",
      dataEvidence: dataEvidence ?? {
        intents: [],
        resources: []
      },
      stageProgress: (await this.require(authorizationDigest)).stageProgress?.[result.caseId] ?? {
        completedStages: [],
        transitions: {}
      },
      attempts: result.attempts.map((attempt) => ({
        attempt: attempt.attempt,
        status: attempt.status,
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt,
        durationMs: attempt.durationMs,
        assertions: attempt.assertions ?? [],
        evidenceRefs: attempt.evidenceRefs ?? [],
        operationEvidence: attempt.operationEvidence ?? [],
        failureClassification: attempt.failureClassification,
        reason: attempt.reason
      }))
    });
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

function operationEvidenceSummary(values?: FormalOperationEvidenceRecord[]): string {
  if (!values?.length) return "无";
  return values.map((item) => sanitize(
    `${item.operation}:${item.source}:${item.contractId}:${item.outcome}:${item.finality}:fallback=${item.fallbackUsed}:reconciliation=${item.reconciliation}`
  )).join("<br>");
}

function sanitizeSensitiveText(value?: string): string | undefined {
  if (!value) return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b1[3-9]\d{9}\b/g, "[REDACTED_PHONE]")
    .replace(
      /\b(password|passwd|passcode|otp|token|cookie|authorization)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    )
    .slice(0, 2_000);
}

function validateEvidenceRefs(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const normalized = [...new Set(values.map((item) => item.trim()))].filter(Boolean);
  for (const value of normalized) {
    if (
      value.startsWith("/")
      || value.includes("..")
      || !value.startsWith("artifacts/")
      || sanitizeSensitiveText(value) !== value
    ) {
      throw new Error(`Formal evidence reference is unsafe: ${value}.`);
    }
  }
  return normalized.sort();
}
