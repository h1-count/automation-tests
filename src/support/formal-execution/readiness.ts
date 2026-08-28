import type {
  ExecutionOperationKind,
  ExecutionCapabilityEvidence,
  ExecutionDeferredCase,
  ExecutionReadinessBlocker,
  ExecutionResourcePoolBudget,
  ExecutionResourcePoolEvidence
} from "./authorization.js";
import {
  initialFormalCapabilityIds
} from "./manifest.js";
import {
  buildExecutionDependencyPlan,
  type ExecutionDependencyPlan,
  type ExecutionDependencyWave
} from "./dependencyPlan.js";
import type {
  FormalCapabilityResult,
  FormalExecutionManifest
} from "./types.js";

export type ExecutionCaseReadinessStatus = "runnable" | "deferred" | "invalid";

export interface ExecutionCaseReadiness {
  caseId: string;
  status: ExecutionCaseReadinessStatus;
  blockers: ExecutionReadinessBlocker[];
}

export interface ExecutionReadinessAssessment {
  schemaVersion: "execution-readiness-assessment-v1";
  cases: ExecutionCaseReadiness[];
  initialRunnableCaseIds: string[];
  scheduledCaseIds: string[];
  executionWaves: ExecutionDependencyWave[];
  dependencyPlan: ExecutionDependencyPlan;
  runnableCaseIds: string[];
  deferredCases: ExecutionDeferredCase[];
  invalidCases: ExecutionDeferredCase[];
  capabilityEvidence: ExecutionCapabilityEvidence[];
  runnableCount: number;
  deferredCount: number;
  invalidCount: number;
}

export function assessExecutionReadiness(input: {
  manifest: FormalExecutionManifest;
  requestedCaseIds: string[];
  capabilityResults: FormalCapabilityResult[];
  allowedOperations?: ExecutionOperationKind[];
  dataWritePolicy?: "no_write" | "ephemeral_cleanup" | "reusable_fixture" | "tracked_residual";
  resourcePoolEvidence?: ExecutionResourcePoolEvidence[];
  resourcePoolBudgets?: ExecutionResourcePoolBudget[];
  globalBlockers?: ExecutionReadinessBlocker[];
}): ExecutionReadinessAssessment {
  const definitions = new Map(input.manifest.cases.map((item) => [item.caseId, item]));
  const results = new Map(input.capabilityResults.map((item) => [item.capabilityId, item]));
  const producerByPoolKey = new Map<string, string>();
  for (const definition of input.manifest.cases) {
    for (const resource of definition.producesResources) {
      if (typeof resource !== "string" && resource.baselineContractId) {
        producerByPoolKey.set(
          `${resource.resourceType}:${resource.baselineContractId}`,
          definition.caseId
        );
      }
    }
  }
  const requested = [...new Set(input.requestedCaseIds)].sort();
  const dependencyPlan = buildExecutionDependencyPlan(
    input.manifest,
    requested.filter((caseId) => definitions.has(caseId))
  );
  const readiness = new Map<string, ExecutionCaseReadiness>();

  for (const caseId of requested) {
    const definition = definitions.get(caseId);
    if (!definition) {
      readiness.set(caseId, {
        caseId,
        status: "invalid",
        blockers: [{
          code: "case_not_declared",
          source: "formal_manifest",
          unblockCondition: `Declare ${caseId} in the formal execution manifest.`
        }]
      });
      continue;
    }
    const blockers = [
      ...(input.globalBlockers ?? []),
      ...initialFormalCapabilityIds(definition.requiredCapabilities).flatMap((capabilityId) => {
      const result = results.get(capabilityId);
      if (!result) {
        return [{
          code: "capability_not_checked",
          source: capabilityId,
          unblockCondition: `Register and check capability ${capabilityId}.`
        }];
      }
      if (result.configurationError) {
        return [{
          code: result.configurationError,
          source: capabilityId,
          unblockCondition: result.unblockCondition
            ?? `Repair the invalid capability declaration ${capabilityId}.`
        }];
      }
      if (result.available) return [];
      return [{
        code: "capability_unavailable",
        source: capabilityId,
        unblockCondition: result.unblockCondition
          ?? `Make capability ${capabilityId} available.`
      }];
      })
    ];
    for (const resource of definition.consumesResources ?? []) {
      const poolKey = `${resource.resourceType}:${resource.baselineContractId}`;
      const evidence = input.resourcePoolEvidence?.find((item) =>
        item.resourceType === resource.resourceType
        && item.baselineContractId === resource.baselineContractId
      );
      const budget = input.resourcePoolBudgets?.find((item) =>
        item.resourceType === resource.resourceType
        && item.baselineContractId === resource.baselineContractId
      );
      const canCreateReplacement = Boolean(
        budget?.replacementBudget
        && input.allowedOperations?.includes("create_test_resource")
      );
      const requestedProducer = producerByPoolKey.get(poolKey);
      if (
        (evidence?.availableCount ?? 0) === 0
        && !canCreateReplacement
        && (!requestedProducer || !requested.includes(requestedProducer))
      ) {
        blockers.push({
          code: "reusable_fixture_unavailable",
          source: `${resource.resourceType}:${resource.baselineContractId}`,
          unblockCondition: "Provide a validated reusable fixture or authorize a bounded lazy replacement."
        });
      }
    }
    const invalidCapabilityBlockers = blockers.filter((item) =>
      item.code === "provider_not_registered"
    );
    if (invalidCapabilityBlockers.length > 0) {
      readiness.set(caseId, {
        caseId,
        status: "invalid",
        blockers: invalidCapabilityBlockers
      });
      continue;
    }
    const missingOperations = input.allowedOperations === undefined
      ? []
      : definition.requiredOperations?.filter((operation) =>
        !input.allowedOperations!.includes(operation)
      ) ?? [];
    if (missingOperations.length > 0) {
      readiness.set(caseId, {
        caseId,
        status: "invalid",
        blockers: [{
          code: "operation_scope_mismatch",
          source: "formal_manifest",
          unblockCondition: `Include the declared operations for ${caseId}: ${missingOperations.join(", ")}.`
        }]
      });
      continue;
    }
    if (
      definition.dataWritePolicy
      && definition.dataWritePolicy !== "no_write"
      && input.manifest.schemaVersion === "formal-execution-manifest-v1"
      && canonicalPolicy(input.dataWritePolicy) !== canonicalPolicy(definition.dataWritePolicy)
    ) {
      readiness.set(caseId, {
        caseId,
        status: "invalid",
        blockers: [{
          code: "data_write_policy_mismatch",
          source: "formal_manifest",
          unblockCondition: `Use ${definition.dataWritePolicy} for ${caseId}.`
        }]
      });
      continue;
    }
    readiness.set(caseId, {
      caseId,
      status: blockers.length ? "deferred" : "runnable",
      blockers
    });
  }

  for (const wave of dependencyPlan.waves) {
    for (const caseId of wave.caseIds) {
      const current = readiness.get(caseId);
      if (!current || current.status !== "runnable") continue;
      const incoming = dependencyPlan.edges.filter((edge) => edge.consumerCaseId === caseId);
      const unavailableUpstream = incoming.flatMap((edge) => {
        const upstream = readiness.get(edge.producerCaseId);
        if (!upstream || upstream.status === "runnable") return [];
        return upstream.blockers.map((blocker) => ({
          code: upstream.status === "invalid"
            ? "dependency_root_invalid"
            : "dependency_root_deferred",
          source: `${edge.producerCaseId}->${caseId}:${edge.resourceName}:${blocker.source}`,
          unblockCondition: blocker.unblockCondition
        }));
      });
      if (!unavailableUpstream.length) continue;
      current.status = incoming.some((edge) => readiness.get(edge.producerCaseId)?.status === "invalid")
        ? "invalid"
        : "deferred";
      current.blockers = uniqueBlockers(unavailableUpstream);
    }
  }

  const cases = [...readiness.values()].sort((left, right) =>
    left.caseId.localeCompare(right.caseId)
  );
  const toDeferred = (status: ExecutionCaseReadinessStatus): ExecutionDeferredCase[] =>
    cases.filter((item) => item.status === status)
      .map((item) => ({ caseId: item.caseId, blockers: item.blockers }));
  const runnableCaseIds = cases
    .filter((item) => item.status === "runnable")
    .map((item) => item.caseId);
  const runnable = new Set(runnableCaseIds);
  const executionWaves = dependencyPlan.waves
    .map((wave) => ({ ...wave, caseIds: wave.caseIds.filter((caseId) => runnable.has(caseId)) }))
    .filter((wave) => wave.caseIds.length > 0)
    .map((wave, index) => ({ index, caseIds: wave.caseIds }));
  const initialRunnableCaseIds = executionWaves[0]?.caseIds ?? [];
  const scheduledCaseIds = executionWaves.slice(1).flatMap((wave) => wave.caseIds);
  const deferredCases = toDeferred("deferred");
  const invalidCases = toDeferred("invalid");
  return {
    schemaVersion: "execution-readiness-assessment-v1",
    cases,
    initialRunnableCaseIds,
    scheduledCaseIds,
    executionWaves,
    dependencyPlan,
    runnableCaseIds,
    deferredCases,
    invalidCases,
    capabilityEvidence: input.capabilityResults.filter((item) =>
      input.manifest.cases.some((definition) =>
        requested.includes(definition.caseId)
        && initialFormalCapabilityIds(definition.requiredCapabilities).includes(item.capabilityId)
      )
    ).map((item) => ({
      capabilityId: item.capabilityId,
      available: item.available,
      evidenceDigest: item.evidenceDigest
        ?? "0".repeat(64),
      checkedAt: item.checkedAt,
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {})
    })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
    runnableCount: runnableCaseIds.length,
    deferredCount: deferredCases.length,
    invalidCount: invalidCases.length
  };
}

function uniqueBlockers(blockers: ExecutionReadinessBlocker[]): ExecutionReadinessBlocker[] {
  return [...new Map(blockers.map((blocker) => [
    `${blocker.code}\0${blocker.source}\0${blocker.unblockCondition}`,
    blocker
  ])).values()].sort((left, right) =>
    `${left.code}:${left.source}`.localeCompare(`${right.code}:${right.source}`)
  );
}

function canonicalPolicy(value: string | undefined): string | undefined {
  return value;
}
