import { createHash } from "node:crypto";
import { AssertionError } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LedgerStore, atomicWrite, atomicWriteText } from "../test-data/ledgerStore.js";
import type {
  FormalAttemptFinality,
  FormalBusinessOracleDefinition,
  FormalBusinessOracleEvaluationBasis,
  FormalBusinessOracleEvaluator,
  FormalBusinessOracleOutcome,
  FormalBusinessOracleResult,
  FormalBlockEvidence,
  FormalCaseDefinition,
  FormalCaseResult,
  FormalCaseDataEvidence,
  FormalCapabilityResult,
  FormalCaseStatus,
  FormalExecutionCompletionSeal,
  FormalExecutionManifest,
  FormalExecutionRecord,
  FormalExecutionSealInput,
  FormalExecutionSealResult,
  FormalExecutionSealedReport,
  FormalExecutionSummary,
  FormalFailureClassification,
  FormalOperationEvidenceRecord,
  FormalStoredFailureClassification
} from "./types.js";
import type { ExecutionDeferredCase } from "./authorization.js";
import type { ExecutionOperationKind } from "./authorization.js";
import type { DataHygieneStatus } from "../test-data/types.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import {
  digestFormalExecutionManifest,
  formalCapabilityId,
  producedResourceName
} from "./manifest.js";
import { sanitizeOperationEvidenceRecord } from "./operationEvidence.js";
import { buildExecutionDependencyPlan } from "./dependencyPlan.js";
import { canonicalJson, sha256Canonical } from "../task-workflow/canonicalJson.js";

const acceptedDataHygieneStatuses = new Set<DataHygieneStatus>([
  "clean",
  "reusable",
  "retained"
]);
const formalCaseStatuses = new Set<FormalCaseStatus>([
  "passed",
  "failed",
  "blocked",
  "skipped",
  "unknown"
]);

const cleanupFailureReasonKeys = new Set([
  "cleanup_exception",
  "cleanup_failed",
  "dirty",
  "expired_residual",
  "hygiene_cleanup_failed",
  "hygiene_manual_required",
  "manual_required",
  "quarantined",
  "retired",
  "state_available",
  "state_cleaning",
  "state_cleanup_failed",
  "state_cleanup_pending",
  "state_dirty",
  "state_expired",
  "state_leased",
  "state_manual_required",
  "state_quarantined",
  "state_registered",
  "state_retired",
  "state_used",
  "summary_mismatch",
  "summary_unaccepted"
]);

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
      if (existing) {
        this.assertWritableRecord(existing, "initialize formal execution");
        validateBusinessOracleContract(existing);
      } else if (input.manifest.schemaVersion !== "formal-execution-manifest-v3") {
        throw new Error(
          "Legacy formal execution manifests are read-only; establish a formal-execution-manifest-v3 run."
        );
      }
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
      const caseBusinessOracles = validateV3BusinessOracleDefinitions(input.manifest, selectedCaseIds);
      const businessOracleContractDigest = digestBusinessOracleContracts(caseBusinessOracles);
      const selectedDefinitions = input.manifest.cases.filter((item) =>
        selectedCaseIds.includes(item.caseId)
      );
      const dependencyPlan = buildExecutionDependencyPlan(input.manifest, selectedCaseIds);
      const record: FormalExecutionRecord = {
        schemaVersion: "formal-execution-record-v3",
        requestId: input.manifest.requestId,
        projectId: input.manifest.projectId,
        environment: input.manifest.environment,
        authorizationDigest: input.authorizationDigest,
        manifestDigest,
        businessOracleContractDigest,
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
        caseBusinessOracles,
        caseBlockContracts: Object.fromEntries(selectedDefinitions.map((definition) => [
          definition.caseId,
          {
            capabilityIds: [...new Set(
              definition.requiredCapabilities.map(formalCapabilityId)
            )].sort(),
            resourceNames: [...new Set([
              ...definition.requiredResources,
              ...(definition.consumesResources ?? []).map((item) => item.name),
              ...dependencyPlan.edges
                .filter((edge) => edge.consumerCaseId === definition.caseId)
                .map((edge) => edge.resourceName)
            ])].sort()
          }
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
      this.assertWritableRecord(record, "reopen formal cases");
      const timestamp = new Date().toISOString();
      const reopened: string[] = [];
      for (const result of Object.values(record.cases)) {
        if (!["blocked", "unknown"].includes(result.status)) continue;
        const latestAttempt = result.attempts.at(-1);
        if (result.status === "unknown") {
          if (!latestAttempt || attemptFinality(latestAttempt) !== "terminal") continue;
        }
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
        result.attempts.push({
          attempt: result.attempts.length + 1,
          status: "unknown",
          finality: "pending",
          startedAt: timestamp
        });
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
      this.assertWritableRecord(record, "begin a formal case");
      const result = requireCase(record, caseId);
      const pendingAttempt = result.attempts.at(-1);
      if (pendingAttempt && attemptFinality(pendingAttempt) === "pending") {
        return pendingAttempt.attempt;
      }
      if (result.attempts.length > 0) {
        throw new Error(
          `${caseId} already has a terminal attempt; use a controlled retry or transition recovery.`
        );
      }
      const timestamp = new Date().toISOString();
      const attempt = result.attempts.length + 1;
      result.status = "unknown";
      result.reason = undefined;
      result.updatedAt = timestamp;
      result.attempts.push({
        attempt,
        status: "unknown",
        finality: "pending",
        startedAt: timestamp
      });
      record.updatedAt = timestamp;
      await this.write(record);
      return attempt;
    });
  }

  async verifyBusinessOracle(input: {
    authorizationDigest: string;
    caseId: string;
    attempt: number;
    oracleId: string;
    evaluator: FormalBusinessOracleEvaluator;
    evidenceRefs?: string[];
  }): Promise<FormalBusinessOracleOutcome> {
    const preflightRecord = await this.require(input.authorizationDigest);
    this.assertWritableRecord(preflightRecord, "verify a business oracle");
    validateBusinessOracleContract(preflightRecord);
    const preflightResult = requireCase(preflightRecord, input.caseId);
    const preflightAttempt = preflightResult.attempts.find((item) => item.attempt === input.attempt);
    if (!preflightAttempt || attemptFinality(preflightAttempt) !== "pending") {
      throw new Error(`Formal attempt ${input.caseId}#${input.attempt} is not open.`);
    }
    if (!preflightRecord.caseBusinessOracles?.[input.caseId]?.some((item) =>
      item.oracleId === input.oracleId
    )) {
      throw new Error(
        `Business oracle result ${input.oracleId} is outside the immutable case contract.`
      );
    }
    if (preflightAttempt.oracleResults?.some((item) => item.oracleId === input.oracleId)) {
      throw new Error(`Business oracle result ${input.oracleId} is already recorded.`);
    }
    const evaluation = await evaluateBusinessOracleEvaluator(input.evaluator);
    return this.ledger.withExclusive(async () => {
      const record = await this.require(input.authorizationDigest);
      this.assertWritableRecord(record, "record a business oracle result");
      validateBusinessOracleContract(record);
      const result = requireCase(record, input.caseId);
      const current = result.attempts.find((item) => item.attempt === input.attempt);
      if (!current || attemptFinality(current) !== "pending") {
        throw new Error(`Formal attempt ${input.caseId}#${input.attempt} is not open.`);
      }
      const definition = record.caseBusinessOracles?.[input.caseId]?.find((item) =>
        item.oracleId === input.oracleId
      );
      if (!definition) {
        throw new Error(
          `Business oracle result ${input.oracleId} is outside the immutable case contract.`
        );
      }
      if (current.oracleResults?.some((item) => item.oracleId === input.oracleId)) {
        throw new Error(`Business oracle result ${input.oracleId} is already recorded.`);
      }
      const oracleResult = materializeOracleResult(
        definition,
        evaluation.outcome,
        evaluation.evaluationBasis,
        input.evidenceRefs,
        evaluation.reason
      );
      current.oracleResults = [...(current.oracleResults ?? []), oracleResult]
        .sort((left, right) => left.oracleId.localeCompare(right.oracleId));
      record.updatedAt = new Date().toISOString();
      await this.write(record);
      await this.writeCaseEvidenceBundle(
        record.authorizationDigest,
        result,
        record.caseEvidencePolicies?.[input.caseId] ?? "standard",
        record.dataEvidence?.[input.caseId]
      );
      return oracleResult.outcome;
    });
  }

  async finishCase(
    authorizationDigest: string,
    caseId: string,
    attempt: number,
    status: FormalCaseStatus,
    reason?: string,
    evidenceRefs?: string[],
    details?: {
      assertions?: string[];
      runtimeFailure?: boolean;
      blockEvidence?: FormalBlockEvidence;
      operationEvidence?: FormalOperationEvidenceRecord[];
    }
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      this.assertWritableRecord(record, "finish a formal case");
      validateBusinessOracleContract(record);
      const result = requireCase(record, caseId);
      const current = result.attempts.find((item) => item.attempt === attempt);
      if (!current) throw new Error(`Formal attempt ${caseId}#${attempt} is missing.`);
      const definitions = record.caseBusinessOracles?.[caseId] ?? [];
      const oracleResults = current.oracleResults ?? [];
      const failureClassification = deriveV3CaseFailureClassification({
        caseId,
        status,
        definitions,
        oracleResults,
        runtimeFailure: details?.runtimeFailure,
        blockedCause: details?.blockEvidence
          ? validateFormalBlockEvidence(record, caseId, details.blockEvidence)
          : undefined
      });
      if (current.endedAt) {
        if (
          current.status !== status
          || current.finality !== "terminal"
          || JSON.stringify(current.oracleResults ?? []) !== JSON.stringify(oracleResults)
          || JSON.stringify(current.blockEvidence) !== JSON.stringify(details?.blockEvidence)
          || JSON.stringify(current.failureClassification) !== JSON.stringify(failureClassification)
        ) {
          throw new Error(`Formal attempt ${caseId}#${attempt} already ended with a different terminal result.`);
        }
        return;
      }
      const timestamp = new Date().toISOString();
      current.status = status;
      current.finality = "terminal";
      current.reason = sanitizeSensitiveText(reason);
      current.evidenceRefs = validateEvidenceRefs(evidenceRefs);
      current.assertions = details?.assertions?.map((item) => sanitizeSensitiveText(item)!)
        .filter(Boolean);
      current.failureClassification = failureClassification;
      current.blockEvidence = details?.blockEvidence;
      current.operationEvidence = details?.operationEvidence?.map((item) =>
        sanitizeOperationEvidenceRecord(item)
      );
      current.oracleResults = oracleResults;
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

  async markBlocked(
    authorizationDigest: string,
    caseId: string,
    reason: string,
    evidence: FormalBlockEvidence
  ): Promise<void> {
    const attempt = await this.beginCase(authorizationDigest, caseId);
    await this.finishCase(
      authorizationDigest,
      caseId,
      attempt,
      "blocked",
      reason,
      undefined,
      { blockEvidence: evidence }
    );
  }

  async appendEvidenceRefs(
    authorizationDigest: string,
    caseId: string,
    evidenceRefs: string[]
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      this.assertWritableRecord(record, "append formal evidence");
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
      this.assertWritableRecord(record, "reconcile formal attempts");
      const timestamp = new Date().toISOString();
      const reconciled: string[] = [];
      for (const result of Object.values(record.cases)) {
        if (result.status !== "unknown") continue;
        const openAttempt = [...result.attempts].reverse().find((item) => !item.endedAt);
        if (!openAttempt) continue;
        openAttempt.status = "unknown";
        openAttempt.finality = "terminal";
        openAttempt.reason = sanitizeSensitiveText(reason);
        openAttempt.failureClassification = {
          code: "infrastructure",
          basis: "worker_interrupted"
        };
        openAttempt.endedAt = timestamp;
        openAttempt.durationMs = Math.max(
          0,
          Date.parse(timestamp) - Date.parse(openAttempt.startedAt)
        );
        result.status = "unknown";
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
      this.assertWritableRecord(record, "publish a formal resource");
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
      this.assertWritableRecord(record, "reserve a formal operation");
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
      this.assertWritableRecord(record, "complete a formal stage");
      requireCase(record, definition.caseId);
      if (!record.stageProgress) {
        throw new Error("Durable execution stages require formal-execution-record-v3.");
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
      this.assertWritableRecord(record, "await an external transition");
      requireCase(record, definition.caseId);
      if (!record.stageProgress) {
        throw new Error("External transitions require formal-execution-record-v3.");
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
      this.assertWritableRecord(record, "resolve an external transition");
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
      const caseResult = requireCase(record, transition.caseId);
      const latestAttempt = caseResult.attempts.at(-1);
      if (
        caseResult.status === "blocked"
        && latestAttempt?.blockEvidence?.cause === "external_transition"
        && latestAttempt.blockEvidence.transitionId === transition.transitionId
      ) {
        caseResult.status = "unknown";
        caseResult.reason = undefined;
        caseResult.updatedAt = resolvedAt;
        caseResult.attempts.push({
          attempt: latestAttempt.attempt + 1,
          status: "unknown",
          finality: "pending",
          startedAt: resolvedAt
        });
      }
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
    reason?: string,
    options?: { dataHygieneStatus: DataHygieneStatus }
  ): Promise<void> {
    await this.ledger.withExclusive(async () => {
      const record = await this.require(authorizationDigest);
      this.assertWritableRecord(record, "record formal cleanup");
      validateCleanupRecording(status, options?.dataHygieneStatus);
      record.cleanup = {
        status,
        completedAt: new Date().toISOString(),
        reason: status === "failed"
          ? normalizeCleanupFailureReason(reason)
          : sanitizeSensitiveText(reason),
        dataHygieneStatus: options?.dataHygieneStatus
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
      this.assertWritableRecord(record, "record formal data evidence");
      for (const caseId of Object.keys(evidence)) requireCase(record, caseId);
      record.dataEvidence = normalizeFormalDataEvidence(evidence);
      record.updatedAt = new Date().toISOString();
      await this.write(record);
      for (const [caseId, dataEvidence] of Object.entries(record.dataEvidence)) {
        await this.writeCaseEvidenceBundle(
          authorizationDigest,
          record.cases[caseId]!,
          record.caseEvidencePolicies?.[caseId] ?? "standard",
          dataEvidence
        );
      }
    });
  }

  async sealForWorkflow(input: FormalExecutionSealInput): Promise<FormalExecutionSealResult> {
    return this.ledger.withExclusive(async () => {
      const record = await this.require(input.authorizationDigest);
      this.assertV3Record(record, "seal a formal execution");
      validateBusinessOracleContract(record);
      validateSealSubject(record, input);
      const summary = this.summaryFromRecord(record);
      validateSealableRecord(record, summary);
      await this.assertReportTargetCompatible(record.authorizationDigest);
      const resultDigest = formalResultDigest(summary);
      if (record.completionSeal) {
        validateCompletionSeal(record.completionSeal);
        if (record.completionSeal.resultDigest !== resultDigest) {
          throw new Error("Formal execution was already sealed with a different result.");
        }
        return {
          seal: structuredClone(record.completionSeal),
          summary
        };
      }
      const sealedAt = new Date().toISOString();
      const seal: FormalExecutionCompletionSeal = {
        schemaVersion: "formal-execution-completion-seal-v1",
        resultDigest,
        sealedAt
      };
      record.completionSeal = seal;
      record.updatedAt = sealedAt;
      await this.write(record);
      return { seal: structuredClone(seal), summary };
    });
  }

  async materializeSealedReport(
    authorizationDigest: string
  ): Promise<FormalExecutionSealedReport> {
    const record = await this.require(authorizationDigest);
    this.assertV3Record(record, "materialize a sealed formal report");
    validateBusinessOracleContract(record);
    const seal = record.completionSeal;
    if (!seal) throw new Error("Formal execution must be sealed before materializing its report.");
    validateCompletionSeal(seal);
    await this.assertReportTargetCompatible(record.authorizationDigest);
    const summary = this.summaryFromRecord(record);
    validateSealableRecord(record, summary);
    if (formalResultDigest(summary) !== seal.resultDigest) {
      throw new Error("Sealed formal execution result differs from the current record.");
    }
    return {
      summary,
      artifacts: await this.writeReportArtifacts(summary, seal)
    };
  }

  async summarize(authorizationDigest: string): Promise<FormalExecutionSummary> {
    const record = await this.require(authorizationDigest);
    if (record.schemaVersion === "formal-execution-record-v3") {
      validateBusinessOracleContract(record);
    }
    const summary = this.summaryFromRecord(record);
    if (!record.completionSeal && record.schemaVersion === "formal-execution-record-v3") {
      await this.writeArtifactSummary(summary);
    }
    return summary;
  }

  private summaryFromRecord(record: FormalExecutionRecord): FormalExecutionSummary {
    const cases = Object.values(record.cases)
      .sort((left, right) => left.caseId.localeCompare(right.caseId))
      .map((item) => {
        assertFormalCaseStatus(item.status, item.caseId);
        const latestAttempt = item.attempts.at(-1);
        return {
          caseId: item.caseId,
          status: item.status,
          reason: item.reason,
          attempts: item.attempts.length,
          attemptFinality: latestAttempt
            ? attemptFinality(latestAttempt)
            : "not_started" as const,
          evidenceRefs: [...new Set(item.attempts.flatMap((attempt) =>
            attempt.evidenceRefs ?? []
          ))].sort(),
          failureClassification: latestAttempt?.failureClassification,
          dataEvidence: record.dataEvidence?.[item.caseId],
          operationEvidence: item.attempts.flatMap((attempt) =>
            attempt.operationEvidence ?? []
          ),
          oracleResults: latestAttempt?.oracleResults
        };
      });
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
    const cleanup = {
      ...(record.cleanup ?? { status: "unknown" as const }),
      dataHygieneStatus: record.cleanup?.dataHygieneStatus ?? "unknown" as const
    };
    const scopeStatus = counts.blocked > 0
      || counts.skipped > 0
      || counts.unknown > 0
      || pendingTransitions.length > 0
      || (record.deferredCases?.length ?? 0) > 0
      ? "partial" as const
      : "complete" as const;
    const testOutcome = formalTestOutcome({
      scopeStatus,
      passed: counts.passed,
      failed: counts.failed
    });
    return {
      requestId: record.requestId,
      projectId: record.projectId,
      environment: record.environment,
      authorizationDigest: record.authorizationDigest,
      manifestDigest: record.manifestDigest,
      businessOracleContractDigest: record.businessOracleContractDigest,
      targetBuildDigest: record.targetBuildDigest,
      scopeStatus,
      testOutcome,
      dataHygieneStatus: cleanup.dataHygieneStatus,
      complete: scopeStatus === "complete" && cleanupAccepted(cleanup),
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
      cleanup
    };
  }

  private async require(authorizationDigest: string): Promise<FormalExecutionRecord> {
    const record = await this.read(authorizationDigest);
    if (!record) throw new Error("Formal execution state is not initialized for this authorization.");
    return record;
  }

  private async write(record: FormalExecutionRecord): Promise<void> {
    await atomicWrite(this.statePath(record.authorizationDigest), record);
  }

  private assertWritableRecord(record: FormalExecutionRecord, operation: string): void {
    this.assertV3Record(record, operation);
    if (record.completionSeal) {
      throw new Error(`Formal execution is sealed; cannot ${operation}.`);
    }
  }

  private assertV3Record(record: FormalExecutionRecord, operation: string): void {
    if (record.schemaVersion !== "formal-execution-record-v3") {
      throw new Error(`Legacy formal execution records are read-only; cannot ${operation}.`);
    }
  }

  private statePath(authorizationDigest: string): string {
    return resolve(this.ledger.root, "formal", `${authorizationDigest}.json`);
  }

  private async assertReportTargetCompatible(authorizationDigest: string): Promise<void> {
    const directory = resolve(this.artifactRoot, authorizationDigest.slice(0, 12));
    const path = resolve(directory, "run-summary.json");
    const markdownPath = resolve(directory, "execution-summary.md");
    if (!existsSync(path)) {
      if (existsSync(markdownPath)) {
        throw new Error(
          "Existing execution-summary.md has no matching v2 run-summary.json; establish a new authorization and run."
        );
      }
      return;
    }
    let schemaVersion: unknown;
    try {
      schemaVersion = (JSON.parse(await readFile(path, "utf8")) as {
        schemaVersion?: unknown;
      }).schemaVersion;
    } catch {
      throw new Error(
        "Existing formal report target is not a recognized v2 artifact; establish a new authorization and run."
      );
    }
    if (schemaVersion !== "formal-run-summary-v2") {
      throw new Error(
        "Legacy formal-run-summary-v1 artifacts are read-only; establish a new authorization and run."
      );
    }
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

  private async writeReportArtifacts(
    summary: FormalExecutionSummary,
    completionSeal?: FormalExecutionCompletionSeal
  ) {
    const directory = resolve(this.artifactRoot, summary.authorizationDigest.slice(0, 12));
    await mkdir(directory, { recursive: true });
    const runSummaryPath = resolve(directory, "run-summary.json");
    const executionSummaryPath = resolve(directory, "execution-summary.md");
    const runSummaryContent = `${JSON.stringify({
      schemaVersion: "formal-run-summary-v2",
      completionSeal: completionSeal ?? null,
      ...summary
    }, null, 2)}\n`;
    const executionSummaryContent = renderExecutionSummary(summary, completionSeal);
    await atomicWriteText(runSummaryPath, runSummaryContent);
    await atomicWriteText(executionSummaryPath, executionSummaryContent);
    const directoryReference = `artifacts/test-results/formal/${summary.authorizationDigest.slice(0, 12)}`;
    return [{
      path: `${directoryReference}/run-summary.json`,
      digest: sha256Text(runSummaryContent)
    }, {
      path: `${directoryReference}/execution-summary.md`,
      digest: sha256Text(executionSummaryContent)
    }];
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
        finality: attemptFinality(attempt),
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt,
        durationMs: attempt.durationMs,
        assertions: attempt.assertions ?? [],
        evidenceRefs: attempt.evidenceRefs ?? [],
        operationEvidence: attempt.operationEvidence ?? [],
        oracleResults: attempt.oracleResults ?? [],
        failureClassification: attempt.failureClassification,
        reason: attempt.reason
      }))
    });
  }
}

function validateV3BusinessOracleDefinitions(
  manifest: FormalExecutionManifest,
  selectedCaseIds: string[]
): Record<string, FormalBusinessOracleDefinition[]> {
  if (manifest.schemaVersion !== "formal-execution-manifest-v3") {
    throw new Error("Writable formal execution requires formal-execution-manifest-v3.");
  }
  const selected = new Set(selectedCaseIds);
  return Object.fromEntries(manifest.cases
    .filter((definition) => selected.has(definition.caseId))
    .map((definition) => {
      const oracles = definition.businessOracles ?? [];
      if (!Array.isArray(oracles) || oracles.length === 0) {
        throw new Error(`${definition.caseId} requires at least one immutable business oracle.`);
      }
      const localOracleIds = new Set<string>();
      for (const oracle of oracles) {
        validateSafeIdentifier(oracle.oracleId, `${definition.caseId} oracleId`);
        validateSafeIdentifier(oracle.ruleRef, `${oracle.oracleId} ruleRef`);
        if (oracle.contractId !== undefined) {
          validateSafeIdentifier(oracle.contractId, `${oracle.oracleId} contractId`);
        }
        if (![
          "dom",
          "browser_response",
          "postcondition_query",
          "runtime_state"
        ].includes(oracle.observationKind)) {
          throw new Error(`Business oracle ${oracle.oracleId} has an unsupported observation kind.`);
        }
        if (localOracleIds.has(oracle.oracleId)) {
          throw new Error(
            `Business oracle ${definition.caseId}/${oracle.oracleId} is duplicated in its case.`
          );
        }
        localOracleIds.add(oracle.oracleId);
        if (!Array.isArray(oracle.authorities) || oracle.authorities.length === 0) {
          throw new Error(`Business oracle ${oracle.oracleId} has no registered authority.`);
        }
        if (oracle.observationKind === "browser_response") {
          if (!oracle.contractId) {
            throw new Error(`Business oracle ${oracle.oracleId} requires a browser response contractId.`);
          }
          const matches = (definition.operationEvidence ?? []).filter((evidence) =>
            evidence.responseContractId === oracle.contractId
          );
          if (matches.length !== 1) {
            throw new Error(
              `Business oracle ${oracle.oracleId} must match exactly one responseContractId.`
            );
          }
        }
        if (oracle.observationKind === "postcondition_query") {
          if (!oracle.contractId) {
            throw new Error(`Business oracle ${oracle.oracleId} requires a postcondition query contractId.`);
          }
          const matches = (definition.operationEvidence ?? []).filter((evidence) =>
            evidence.queryCapabilityId === oracle.contractId
          );
          if (matches.length !== 1) {
            throw new Error(
              `Business oracle ${oracle.oracleId} must match exactly one queryCapabilityId.`
            );
          }
        }
        const authorityKeys = oracle.authorities.map((authority) => {
          if (authority.kind === "registered_source") {
            validateSafeIdentifier(authority.materialId, `${oracle.oracleId} materialId`);
            validateSafeIdentifier(authority.sectionId, `${oracle.oracleId} sectionId`);
            validateDigest(authority.sourceSha256, `${oracle.oracleId} sourceSha256`);
          } else {
            validateSafeIdentifier(authority.decisionType, `${oracle.oracleId} decisionType`);
            validateDigest(authority.subjectDigest, `${oracle.oracleId} subjectDigest`);
          }
          return canonicalBusinessOracleAuthority(authority);
        });
        if (new Set(authorityKeys).size !== authorityKeys.length) {
          throw new Error(`Business oracle ${oracle.oracleId} contains duplicate authorities.`);
        }
      }
      return [definition.caseId, structuredClone(oracles).sort((left, right) =>
        left.oracleId.localeCompare(right.oracleId)
      )];
    }));
}

export function digestBusinessOracleContracts(
  caseBusinessOracles: Record<string, FormalBusinessOracleDefinition[]>
): string {
  const cases = Object.entries(caseBusinessOracles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, definitions]) => ({
      caseId,
      businessOracles: structuredClone(definitions)
        .sort((left, right) => left.oracleId.localeCompare(right.oracleId))
        .map((definition) => ({
          oracleId: definition.oracleId,
          ruleRef: definition.ruleRef,
          observationKind: definition.observationKind,
          ...(definition.contractId ? { contractId: definition.contractId } : {}),
          authorities: structuredClone(definition.authorities).sort((left, right) =>
            canonicalBusinessOracleAuthority(left).localeCompare(
              canonicalBusinessOracleAuthority(right)
            )
          )
        }))
    }));
  return sha256Canonical(JSON.parse(JSON.stringify({
    schemaVersion: "formal-business-oracle-contract-v1",
    cases
  })) as SafeJsonValue);
}

function validateBusinessOracleContract(record: FormalExecutionRecord): void {
  const definitions = record.caseBusinessOracles;
  if (!definitions || !record.businessOracleContractDigest) {
    throw new Error("formal-execution-record-v3 is missing its business oracle contract digest.");
  }
  validateDigest(record.businessOracleContractDigest, "businessOracleContractDigest");
  const actual = digestBusinessOracleContracts(definitions);
  if (actual !== record.businessOracleContractDigest) {
    throw new Error("Formal business oracle contract differs from its immutable digest.");
  }
  assertExactCaseSet("business oracle", Object.keys(record.cases), Object.keys(definitions));
}

function materializeOracleResult(
  definition: FormalBusinessOracleDefinition,
  outcome: FormalBusinessOracleOutcome,
  evaluationBasis: FormalBusinessOracleEvaluationBasis,
  evidenceRefs?: string[],
  unsafeReason?: string
): FormalBusinessOracleResult {
  if (!["satisfied", "violated", "indeterminate"].includes(outcome)) {
    throw new Error(`Business oracle ${definition.oracleId} has an unsupported outcome.`);
  }
  const validBasis = outcome === "satisfied"
    ? evaluationBasis === "normal_return"
    : outcome === "violated"
      ? evaluationBasis === "assertion_violation"
      : evaluationBasis === "explicit_indeterminate" || evaluationBasis === "evaluator_error";
  if (!validBasis) {
    throw new Error(`Business oracle ${definition.oracleId} outcome conflicts with its evaluation basis.`);
  }
  const reason = sanitizeSensitiveText(unsafeReason);
  if (outcome !== "satisfied" && !reason) {
    throw new Error(`Business oracle ${definition.oracleId} requires a bounded reason for ${outcome}.`);
  }
  return {
    oracleId: definition.oracleId,
    ruleRef: definition.ruleRef,
    observationKind: definition.observationKind,
    ...(definition.contractId ? { contractId: definition.contractId } : {}),
    authorityDigest: oracleAuthorityDigest(definition),
    outcome,
    evaluationBasis,
    evidenceRefs: validateEvidenceRefs(evidenceRefs) ?? [],
    reason
  };
}

async function evaluateBusinessOracleEvaluator(evaluator: FormalBusinessOracleEvaluator): Promise<{
  outcome: FormalBusinessOracleOutcome;
  evaluationBasis: FormalBusinessOracleEvaluationBasis;
  reason?: string;
}> {
  if (typeof evaluator !== "function") {
    return {
      outcome: "indeterminate",
      evaluationBasis: "evaluator_error",
      reason: "Business oracle evaluator is not callable."
    };
  }
  try {
    const result = await evaluator();
    if (isExplicitOracleIndeterminate(result)) {
      return {
        outcome: "indeterminate",
        evaluationBasis: "explicit_indeterminate",
        reason: "Business oracle evaluator reported an indeterminate observation."
      };
    }
    if (result !== undefined) {
      return {
        outcome: "indeterminate",
        evaluationBasis: "evaluator_error",
        reason: "Business oracle evaluator returned an unsupported value."
      };
    }
    return { outcome: "satisfied", evaluationBasis: "normal_return" };
  } catch (error) {
    if (isOracleAssertionViolation(error)) {
      return {
        outcome: "violated",
        evaluationBasis: "assertion_violation",
        reason: "A reviewed business assertion was violated."
      };
    }
    return {
      outcome: "indeterminate",
      evaluationBasis: "evaluator_error",
      reason: "Business oracle evaluation ended unexpectedly."
    };
  }
}

function isExplicitOracleIndeterminate(value: unknown): value is {
  kind: "indeterminate";
  reason: string;
} {
  return Boolean(value)
    && typeof value === "object"
    && (value as { kind?: unknown }).kind === "indeterminate"
    && typeof (value as { reason?: unknown }).reason === "string"
    && (value as { reason: string }).reason.trim().length > 0;
}

function isOracleAssertionViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { matcherResult?: unknown; actual?: unknown; expected?: unknown };
  return error instanceof AssertionError
    || candidate.matcherResult !== undefined
    || (candidate.actual !== undefined && candidate.expected !== undefined);
}

function validateV3CaseOutcome(input: {
  caseId: string;
  status: FormalCaseStatus;
  definitions: FormalBusinessOracleDefinition[];
  oracleResults: FormalBusinessOracleResult[];
  classification?: FormalFailureClassification;
}): FormalFailureClassification | undefined {
  assertFormalCaseStatus(input.status, input.caseId);
  if (input.definitions.length === 0) {
    throw new Error(`${input.caseId} has no immutable business oracle contract.`);
  }
  validateOracleResultBindings(input.caseId, input.definitions, input.oracleResults);
  const expectedOracleIds = input.definitions.map((item) => item.oracleId).sort();
  const actualOracleIds = input.oracleResults.map((item) => item.oracleId).sort();
  const complete = JSON.stringify(expectedOracleIds) === JSON.stringify(actualOracleIds);
  const hasViolation = input.oracleResults.some((item) => item.outcome === "violated");
  const hasIndeterminate = input.oracleResults.some((item) => item.outcome === "indeterminate");
  const hasEvaluatorError = input.oracleResults.some((item) =>
    item.evaluationBasis === "evaluator_error"
  );
  const classification = input.classification;
  if (classification) validateFailureClassification(classification);

  if (input.status === "skipped") {
    throw new Error(
      `${input.caseId} v3 runnable cases cannot finish as skipped; remove an inapplicable case before authorization.`
    );
  }

  if (input.status === "passed" || input.status === "failed") {
    if (input.status === "passed" && !complete) {
      throw new Error(`${input.caseId} cannot finish as passed without complete business oracle results.`);
    }
    const derivedStatus: FormalCaseStatus = hasViolation
      ? "failed"
      : !complete || hasIndeterminate
        ? "unknown"
        : "passed";
    if (derivedStatus !== input.status) {
      throw new Error(
        `${input.caseId} status ${input.status} differs from business oracle outcome ${derivedStatus}.`
      );
    }
    if (input.status === "passed") {
      if (classification !== undefined) {
        throw new Error(`${input.caseId} passed result cannot carry a failure classification.`);
      }
      return undefined;
    }
    if (classification !== undefined && classification.code !== "product") {
      throw new Error(`${input.caseId} product failure has a non-product classification.`);
    }
    return { code: "product", basis: "business_oracle_violated" };
  }

  if (input.status === "unknown") {
    if (classification?.code === "product") {
      throw new Error(`${input.caseId} unknown result cannot be classified as a product failure.`);
    }
    if (hasViolation) {
      throw new Error(`${input.caseId} has a conclusive business oracle violation and must finish as failed.`);
    }
    if (complete && !hasIndeterminate) {
      if (classification?.code === "script" && classification.basis === "runtime_error") {
        return classification;
      }
      throw new Error(
        `${input.caseId} has complete satisfied business oracle results and cannot finish as unknown without a runtime failure.`
      );
    }
    const derived = hasIndeterminate && complete
      ? hasEvaluatorError
        ? { code: "script", basis: "oracle_evaluator_error" }
        : { code: "unknown", basis: "business_oracle_indeterminate" }
      : { code: "script", basis: "missing_business_oracle" };
    if (
      classification
      && !(classification.code === "script" && classification.basis === "runtime_error")
      && !(classification.code === "infrastructure" && classification.basis === "worker_interrupted")
      && JSON.stringify(classification) !== JSON.stringify(derived)
    ) {
      throw new Error(`${input.caseId} unknown classification differs from its persisted runtime facts.`);
    }
    return classification ?? derived as FormalFailureClassification;
  }

  if (classification?.code === "product") {
    throw new Error(`${input.caseId} ${input.status} result cannot be classified as a product failure.`);
  }
  if (input.status === "blocked") {
    if (hasViolation) {
      throw new Error(`${input.caseId} has a conclusive business oracle violation and must finish as failed.`);
    }
    if (hasIndeterminate) {
      throw new Error(`${input.caseId} has an indeterminate business oracle and must finish as unknown.`);
    }
    if (complete) {
      throw new Error(`${input.caseId} has complete satisfied business oracles and must finish as passed.`);
    }
    if (
      classification
      && classification.code !== "environment"
      && classification.code !== "test_data"
    ) {
      throw new Error(`${input.caseId} blocked result has an unsupported classification.`);
    }
    return classification ?? { code: "environment", basis: "capability_unavailable" };
  }
  return classification;
}

function deriveV3CaseFailureClassification(input: {
  caseId: string;
  status: FormalCaseStatus;
  definitions: FormalBusinessOracleDefinition[];
  oracleResults: FormalBusinessOracleResult[];
  runtimeFailure?: boolean;
  blockedCause?: FormalBlockEvidence["cause"];
}): FormalFailureClassification | undefined {
  if (input.runtimeFailure && input.status !== "unknown") {
    throw new Error(`${input.caseId} runtimeFailure is valid only for an unknown result.`);
  }
  if (input.blockedCause && input.status !== "blocked") {
    throw new Error(`${input.caseId} blockedCause is valid only for a blocked result.`);
  }
  if (input.status === "blocked" && !input.blockedCause) {
    throw new Error(`${input.caseId} blocked result requires persisted block evidence.`);
  }
  let classification: FormalFailureClassification | undefined;
  if (input.runtimeFailure) {
    classification = { code: "script", basis: "runtime_error" };
  } else if (input.status === "blocked") {
    classification = input.blockedCause === "required_resource_unavailable"
      ? { code: "test_data", basis: "required_resource_unavailable" }
      : {
          code: "environment",
          basis: input.blockedCause ?? "capability_unavailable"
        };
  }
  return validateV3CaseOutcome({
    caseId: input.caseId,
    status: input.status,
    definitions: input.definitions,
    oracleResults: input.oracleResults,
    classification
  });
}

function validateFormalBlockEvidence(
  record: FormalExecutionRecord,
  caseId: string,
  evidence: FormalBlockEvidence
): FormalBlockEvidence["cause"] {
  const contract = record.caseBlockContracts?.[caseId];
  if (!contract) {
    throw new Error(`${caseId} is missing its immutable block contract.`);
  }
  if (evidence.cause === "capability_unavailable") {
    if (!contract.capabilityIds.includes(evidence.capabilityId)) {
      throw new Error(`${caseId} cannot be blocked by an undeclared capability.`);
    }
    const capability = record.capabilities[evidence.capabilityId];
    if (
      !capability
      || capability.available
      || !capability.affectedCaseIds.includes(caseId)
    ) {
      throw new Error(`${caseId} has no persisted unavailable capability fact.`);
    }
    return evidence.cause;
  }
  if (evidence.cause === "required_resource_unavailable") {
    if (!contract.resourceNames.includes(evidence.resourceName)) {
      throw new Error(`${caseId} cannot be blocked by an undeclared resource.`);
    }
    const resource = record.resources[evidence.resourceName];
    if (!resource || resource.available) {
      throw new Error(`${caseId} has no persisted unavailable resource fact.`);
    }
    return evidence.cause;
  }
  const transition = record.stageProgress?.[caseId]?.transitions[evidence.transitionId];
  if (!transition || transition.caseId !== caseId || transition.status !== "waiting") {
    throw new Error(`${caseId} has no persisted waiting transition fact.`);
  }
  return evidence.cause;
}

function validateOracleResultBindings(
  caseId: string,
  definitions: FormalBusinessOracleDefinition[],
  oracleResults: FormalBusinessOracleResult[]
): void {
  const definitionsById = new Map(definitions.map((item) => [item.oracleId, item]));
  const seen = new Set<string>();
  for (const result of oracleResults) {
    const definition = definitionsById.get(result.oracleId);
    if (!definition || seen.has(result.oracleId)) {
      throw new Error(`${caseId} contains an unknown or duplicate business oracle result.`);
    }
    seen.add(result.oracleId);
    if (
      result.ruleRef !== definition.ruleRef
      || result.observationKind !== definition.observationKind
      || result.contractId !== definition.contractId
      || result.authorityDigest !== oracleAuthorityDigest(definition)
    ) {
      throw new Error(`${caseId}/${result.oracleId} differs from its immutable business oracle binding.`);
    }
    if (!["satisfied", "violated", "indeterminate"].includes(result.outcome)) {
      throw new Error(`${caseId}/${result.oracleId} has an unsupported outcome.`);
    }
    const validBasis = result.outcome === "satisfied"
      ? result.evaluationBasis === "normal_return"
      : result.outcome === "violated"
        ? result.evaluationBasis === "assertion_violation"
        : result.evaluationBasis === "explicit_indeterminate"
          || result.evaluationBasis === "evaluator_error";
    if (!validBasis) {
      throw new Error(`${caseId}/${result.oracleId} outcome conflicts with its evaluation basis.`);
    }
    validateEvidenceRefs(result.evidenceRefs);
    if (result.outcome !== "satisfied" && !sanitizeSensitiveText(result.reason)) {
      throw new Error(`${caseId}/${result.oracleId} requires a bounded non-success reason.`);
    }
  }
}

function validateFailureClassification(value: FormalFailureClassification): void {
  const supported = new Set([
    "product:business_oracle_violated",
    "script:missing_business_oracle",
    "script:runtime_error",
    "script:oracle_evaluator_error",
    "environment:authorization_scope",
    "environment:capability_unavailable",
    "environment:external_transition",
    "test_data:required_resource_unavailable",
    "infrastructure:worker_interrupted",
    "unknown:business_oracle_indeterminate"
  ]);
  if (!supported.has(`${value.code}:${value.basis}`)) {
    throw new Error("Unsupported structured formal failure classification.");
  }
}

function oracleAuthorityDigest(definition: FormalBusinessOracleDefinition): string {
  const authorities = structuredClone(definition.authorities).sort((left, right) =>
    canonicalBusinessOracleAuthority(left).localeCompare(
      canonicalBusinessOracleAuthority(right)
    )
  );
  return sha256Canonical(JSON.parse(JSON.stringify({
    schemaVersion: "formal-business-oracle-authority-v1",
    ...(definition.contractId ? { contractId: definition.contractId } : {}),
    authorities
  })) as SafeJsonValue);
}

function canonicalBusinessOracleAuthority(
  authority: FormalBusinessOracleDefinition["authorities"][number]
): string {
  return canonicalJson(JSON.parse(JSON.stringify(authority)) as SafeJsonValue);
}

function attemptFinality(attempt: {
  finality?: FormalAttemptFinality;
  endedAt?: string;
}): FormalAttemptFinality {
  return attempt.finality ?? (attempt.endedAt ? "terminal" : "pending");
}

function validateSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value)) {
    throw new Error(`Formal business oracle ${label} is invalid.`);
  }
}

function validateSealSubject(
  record: FormalExecutionRecord,
  input: FormalExecutionSealInput
): void {
  validateDigest(input.authorizationDigest, "authorizationDigest");
  validateDigest(input.manifestDigest, "manifestDigest");
  if (input.targetBuildDigest !== undefined) {
    validateDigest(input.targetBuildDigest, "targetBuildDigest");
  }
  if (record.authorizationDigest !== input.authorizationDigest) {
    throw new Error("Formal execution authorization differs from the workflow seal subject.");
  }
  if (record.requestId !== input.requestId) {
    throw new Error("Formal execution request differs from the workflow seal subject.");
  }
  if (record.environment !== input.environment) {
    throw new Error("Formal execution environment differs from the workflow seal subject.");
  }
  if (record.manifestDigest !== input.manifestDigest) {
    throw new Error("Formal execution manifest differs from the workflow seal subject.");
  }
  if (record.targetBuildDigest !== input.targetBuildDigest) {
    throw new Error("Formal execution target build differs from the workflow seal subject.");
  }
  assertExactCaseSet("runnable", Object.keys(record.cases), input.runnableCaseIds);
  assertExactCaseSet(
    "deferred",
    (record.deferredCases ?? []).map((item) => item.caseId),
    input.deferredCaseIds
  );
  const overlap = input.runnableCaseIds.filter((caseId) => input.deferredCaseIds.includes(caseId));
  if (overlap.length > 0) {
    throw new Error(`Formal execution runnable and deferred scopes overlap: ${overlap.sort().join(", ")}.`);
  }
}

function validateSealableRecord(
  record: FormalExecutionRecord,
  summary: FormalExecutionSummary
): void {
  if (summary.counts.unknown !== 0) {
    throw new Error("Formal execution cannot be sealed while unknown cases remain.");
  }
  const openAttempts = Object.values(record.cases).flatMap((result) =>
    result.attempts.filter((attempt) => attemptFinality(attempt) === "pending").map(() => result.caseId)
  );
  if (openAttempts.length > 0) {
    throw new Error(`Formal execution cannot be sealed with open attempts: ${[...new Set(openAttempts)].sort().join(", ")}.`);
  }
  if (summary.pendingTransitions.length !== 0) {
    throw new Error("Formal execution cannot be sealed while external transitions are pending.");
  }
  if (!cleanupAccepted(summary.cleanup)) {
    throw new Error("Formal execution cannot be sealed without explicitly accepted data hygiene.");
  }
  for (const result of Object.values(record.cases)) {
    const latestAttempt = result.attempts.at(-1);
    if (!latestAttempt || attemptFinality(latestAttempt) !== "terminal") {
      throw new Error(`Formal execution case ${result.caseId} has no terminal attempt.`);
    }
    if (!latestAttempt.endedAt) {
      throw new Error(`Formal execution case ${result.caseId} terminal attempt has no endedAt.`);
    }
    if (latestAttempt.status !== result.status) {
      throw new Error(
        `Formal execution case ${result.caseId} status differs from its latest terminal attempt.`
      );
    }
    for (const attempt of result.attempts) {
      assertFormalCaseStatus(attempt.status, `${result.caseId}#${attempt.attempt}`);
      if (attemptFinality(attempt) === "terminal" && !attempt.endedAt) {
        throw new Error(
          `Formal execution case ${result.caseId} has a terminal attempt without endedAt.`
        );
      }
      if (attemptFinality(attempt) === "pending" && attempt.endedAt) {
        throw new Error(
          `Formal execution case ${result.caseId} has a pending attempt with endedAt.`
        );
      }
    }
    if (result.status === "blocked") {
      if (!latestAttempt.blockEvidence) {
        throw new Error(`Formal execution case ${result.caseId} has no persisted block evidence.`);
      }
      const cause = validateFormalBlockEvidence(record, result.caseId, latestAttempt.blockEvidence);
      const expectedClassification: FormalFailureClassification = cause === "required_resource_unavailable"
        ? { code: "test_data", basis: "required_resource_unavailable" }
        : { code: "environment", basis: cause };
      if (JSON.stringify(latestAttempt.failureClassification) !== JSON.stringify(expectedClassification)) {
        throw new Error(
          `Formal execution case ${result.caseId} block classification differs from its persisted fact.`
        );
      }
    }
    const historicalViolation = result.attempts.some((attempt) =>
      attempt.oracleResults?.some((oracle) => oracle.outcome === "violated")
    );
    if (historicalViolation && result.status !== "failed") {
      throw new Error(
        `Formal execution case ${result.caseId} cannot hide a historical business oracle violation.`
      );
    }
    const storedClassification = requireStructuredFailureClassification(
      latestAttempt.failureClassification,
      result.caseId
    );
    const expectedClassification = validateV3CaseOutcome({
      caseId: result.caseId,
      status: result.status,
      definitions: record.caseBusinessOracles?.[result.caseId] ?? [],
      oracleResults: latestAttempt.oracleResults ?? [],
      classification: storedClassification
    });
    if (JSON.stringify(storedClassification) !== JSON.stringify(expectedClassification)) {
      throw new Error(
        `Formal execution case ${result.caseId} failure classification differs from its persisted facts.`
      );
    }
  }
  const runnableCaseIds = Object.keys(record.cases).sort();
  const dataEvidence = record.dataEvidence ?? {};
  assertExactCaseSet("data evidence", runnableCaseIds, Object.keys(dataEvidence));
  for (const caseId of runnableCaseIds) {
    const evidence = dataEvidence[caseId];
    if (!evidence || !Array.isArray(evidence.intents) || !Array.isArray(evidence.resources)) {
      throw new Error(`Formal execution case ${caseId} has invalid data evidence.`);
    }
  }
}

function assertFormalCaseStatus(value: unknown, context: string): asserts value is FormalCaseStatus {
  if (typeof value !== "string" || !formalCaseStatuses.has(value as FormalCaseStatus)) {
    throw new Error(`Formal execution ${context} has an unsupported case status.`);
  }
}

function validateCompletionSeal(seal: FormalExecutionCompletionSeal): void {
  const keys = Object.keys(seal).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["resultDigest", "schemaVersion", "sealedAt"])) {
    throw new Error("Formal execution completion seal has unsupported or missing fields.");
  }
  if (seal.schemaVersion !== "formal-execution-completion-seal-v1") {
    throw new Error("Unsupported formal execution completion seal schema.");
  }
  validateDigest(seal.resultDigest, "resultDigest");
  if (!seal.sealedAt || Number.isNaN(Date.parse(seal.sealedAt))) {
    throw new Error("Formal execution completion seal has an invalid sealedAt timestamp.");
  }
}

function normalizeFormalDataEvidence(
  evidence: Record<string, FormalCaseDataEvidence>
): Record<string, FormalCaseDataEvidence> {
  return Object.fromEntries(Object.entries(evidence)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, value]) => [caseId, {
      intents: structuredClone(value.intents).sort((left, right) =>
        `${left.resourceType}:${left.expectedOutcome}:${left.status}`
          .localeCompare(`${right.resourceType}:${right.expectedOutcome}:${right.status}`)
      ),
      resources: structuredClone(value.resources).sort((left, right) =>
        `${left.resourceType}:${left.state}:${String(left.reusable)}`
          .localeCompare(`${right.resourceType}:${right.state}:${String(right.reusable)}`)
      )
    }])) as Record<string, FormalCaseDataEvidence>;
}

function validateDigest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Formal execution seal requires lowercase SHA-256 ${field}.`);
  }
}

function assertExactCaseSet(label: string, actualValues: string[], expectedValues: string[]): void {
  if (new Set(expectedValues).size !== expectedValues.length) {
    throw new Error(`Formal execution ${label} case set contains duplicates.`);
  }
  if (new Set(actualValues).size !== actualValues.length) {
    throw new Error(`Stored formal execution ${label} case set contains duplicates.`);
  }
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Formal execution ${label} case set differs from the workflow seal subject.`);
  }
}

function cleanupAccepted(cleanup: {
  status: "passed" | "failed" | "not_required" | "unknown";
  dataHygieneStatus?: string;
}): boolean {
  if (cleanup.status === "not_required") return cleanup.dataHygieneStatus === "clean";
  return cleanup.status === "passed"
    && acceptedDataHygieneStatuses.has(cleanup.dataHygieneStatus as DataHygieneStatus);
}

function validateCleanupRecording(
  status: "passed" | "failed" | "not_required",
  dataHygieneStatus?: DataHygieneStatus
): void {
  if (dataHygieneStatus === undefined) return;
  const valid = status === "not_required"
    ? dataHygieneStatus === "clean"
    : status === "passed"
      ? acceptedDataHygieneStatuses.has(dataHygieneStatus)
      : dataHygieneStatus === "cleanup_failed" || dataHygieneStatus === "manual_required";
  if (!valid) {
    throw new Error(`Formal cleanup status ${status} conflicts with data hygiene ${dataHygieneStatus}.`);
  }
}

function normalizeCleanupFailureReason(reason?: string): string {
  if (!reason || reason.length > 512) {
    throw new Error("Formal cleanup failure reason must contain only bounded status counts.");
  }
  const entries = reason.split(",");
  const seen = new Set<string>();
  const normalized = entries.map((entry) => {
    const match = /^([a-z_]+)=([1-9]\d*)$/u.exec(entry);
    const key = match?.[1];
    if (!key || !cleanupFailureReasonKeys.has(key) || seen.has(key)) {
      throw new Error("Formal cleanup failure reason must contain only known status counts.");
    }
    seen.add(key);
    return `${key}=${match[2]}`;
  });
  return normalized.sort().join(",");
}

function formalTestOutcome(input: {
  scopeStatus: FormalExecutionSummary["scopeStatus"];
  passed: number;
  failed: number;
}): FormalExecutionSummary["testOutcome"] {
  if (input.scopeStatus === "partial") {
    return input.passed + input.failed > 0 ? "mixed" : "inconclusive";
  }
  if (input.passed > 0 && input.failed === 0) return "passed";
  if (input.failed > 0 && input.passed === 0) return "failed";
  if (input.passed > 0 && input.failed > 0) return "mixed";
  return "inconclusive";
}

function formalResultDigest(summary: FormalExecutionSummary): string {
  const normalized = JSON.parse(JSON.stringify(summary)) as SafeJsonValue;
  return sha256Canonical({
    schemaVersion: "formal-execution-result-v1",
    summary: normalized
  });
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function renderExecutionSummary(
  summary: FormalExecutionSummary,
  completionSeal?: FormalExecutionCompletionSeal
): string {
  const executionLines = [
    "# 自动化测试执行摘要",
    "",
    `- 请求：${summary.requestId}`,
    `- 授权摘要：${summary.authorizationDigest}`,
    `- 环境：${summary.environment}`,
    `- 目标构建摘要：${summary.targetBuildDigest ?? "未提供（兼容历史授权）"}`,
    `- 业务 Oracle 合同摘要：${summary.businessOracleContractDigest ?? "未提供（只读历史记录）"}`,
    `- 范围状态：${summary.scopeStatus}`,
    `- 测试结果：${summary.testOutcome}`,
    `- 数据卫生：${summary.dataHygieneStatus}`,
    `- 完整性：${summary.complete ? "完整" : "不完整"}`,
    `- 完成封印：${completionSeal ? `${completionSeal.resultDigest}（${completionSeal.sealedAt}）` : "未封印"}`,
    `- 清理：${summary.cleanup.status}${summary.cleanup.reason ? `（${sanitize(summary.cleanup.reason)}）` : ""}`,
    `- 通过：${summary.counts.passed}`,
    `- 失败：${summary.counts.failed}`,
    `- 阻塞：${summary.counts.blocked}`,
    `- 跳过：${summary.counts.skipped}`,
    `- 未执行：${summary.counts.unknown}`,
    `- 等待外部转换：${summary.pendingTransitions.length}`,
    "",
    "| caseId | 状态 | 尝试 | 业务 Oracle | 失败分类 | 操作证据 | 附件证据 | 原因 |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- |",
    ...summary.cases.map((item) =>
      `| ${item.caseId} | ${item.status} | ${item.attempts} | ${businessOracleSummary(item.oracleResults)} | ${failureClassificationSummary(item.failureClassification)} | ${operationEvidenceSummary(item.operationEvidence)} | ${item.evidenceRefs.map((ref) => `\`${ref}\``).join("<br>")} | ${sanitize(item.reason)} |`
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
  return `${executionLines.join("\n")}\n`;
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

function failureClassificationSummary(value?: FormalStoredFailureClassification): string {
  if (typeof value === "string") return sanitize(value);
  return value ? `${value.code}:${value.basis}` : "";
}

function businessOracleSummary(results?: FormalBusinessOracleResult[]): string {
  return (results ?? []).map((result) => {
    const contract = result.contractId ? ` / ${result.contractId}` : "";
    const evidence = result.evidenceRefs.length > 0
      ? ` / evidence=${result.evidenceRefs.join(",")}`
      : "";
    return sanitize(
      `${result.oracleId} / ${result.ruleRef} / ${result.observationKind}${contract} / ${result.outcome} / ${result.evaluationBasis}${evidence}`
    );
  }).join("<br>");
}

function requireStructuredFailureClassification(
  value: FormalStoredFailureClassification | undefined,
  caseId: string
): FormalFailureClassification | undefined {
  if (typeof value === "string") {
    throw new Error(`${caseId} v3 result contains a legacy free-form failure classification.`);
  }
  return value;
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
