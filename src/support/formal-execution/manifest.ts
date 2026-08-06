import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type {
  FormalCapabilityDefinition,
  FormalCapabilityRequirementInput,
  FormalCapabilityResult,
  FormalProducedResourceContract,
  FormalExecutionManifest
} from "./types.js";
import {
  executionOperationKinds,
  type ExecutionOperationKind
} from "./authorization.js";
import {
  CapabilityProviderRegistry,
  createDefaultCapabilityProviderRegistry,
  type CapabilityCheckContext
} from "./capabilityProvider.js";
import { operationEvidenceDefinitionIssues } from "./operationEvidence.js";

export function defineFormalExecutionManifest(manifest: FormalExecutionManifest): FormalExecutionManifest {
  validateFormalExecutionManifest(manifest);
  return manifest;
}

export function validateFormalExecutionManifest(manifest: FormalExecutionManifest): void {
  if (!["formal-execution-manifest-v1", "formal-execution-manifest-v2"].includes(manifest.schemaVersion)) {
    throw new Error("Unsupported formal execution manifest schema.");
  }
  if (!manifest.requestId.trim() || !manifest.projectId.trim() || !manifest.environment.trim()) {
    throw new Error("Formal execution manifest requires request, project and environment.");
  }
  const caseIds = manifest.cases.map((item) => item.caseId);
  assertUnique(caseIds, "caseId");
  if (caseIds.length === 0) throw new Error("Formal execution manifest must contain at least one case.");
  assertUnique(manifest.capabilities.map((item) => item.id), "capability");
  if (manifest.schemaVersion === "formal-execution-manifest-v2") {
    if (!manifest.buildEvidence?.length) {
      throw new Error("formal-execution-manifest-v2 requires frozen buildEvidence.");
    }
    assertUnique(manifest.buildEvidence.map((item) => item.path), "build evidence path");
    if (manifest.buildEvidence.some((item) => {
      if (!item.path.trim()
        || !["source_contract", "selector_contract", "browser_response_contract", "test_asset"].includes(item.kind)) {
        return true;
      }
      return item.kind === "test_asset" && (
        !item.assetId?.trim()
        || !/^[a-f0-9]{64}$/u.test(item.sha256 ?? "")
      );
    })) {
      throw new Error("formal-execution-manifest-v2 contains invalid build evidence.");
    }
    assertUnique(
      manifest.buildEvidence
        .filter((item) => item.kind === "test_asset")
        .map((item) => item.assetId!),
      "test asset build evidence"
    );
  }

  const caseSet = new Set(caseIds);
  validatePageSessionGroups(manifest, caseSet);
  const capabilitySet = new Set(manifest.capabilities.map((item) => item.id));
  const testAssetEvidenceIds = new Set(
    manifest.buildEvidence
      ?.filter((item) => item.kind === "test_asset")
      .map((item) => item.assetId!) ?? []
  );
  const referencedTestAssetIds = new Set<string>();
  const manifestTransitionIds = manifest.cases.flatMap((item) =>
    (item.executionStages ?? []).flatMap((stage) =>
      stage.externalTransition ? [stage.externalTransition.transitionId] : []
    )
  );
  assertUnique(manifestTransitionIds, "external transitionId");
  const manifestTransitionSet = new Set(manifestTransitionIds);
  const producers = new Map<string, string>();
  const mutatingOperations = new Set<ExecutionOperationKind>([
    "send_test_otp",
    "upload_synthetic_file",
    "submit_registration",
    "create_test_resource",
    "update_test_resource",
    "delete_test_resource",
    "change_test_permission",
    "invoke_test_device_action",
    "cleanup_test_resource",
    "retain_tracked_residual"
  ]);
  const budgetedOperations = new Set<ExecutionOperationKind>([
    "authenticate_test_account",
    "send_test_otp",
    "upload_synthetic_file",
    "submit_registration",
    "create_test_resource",
    "update_test_resource",
    "delete_test_resource",
    "change_test_permission",
    "invoke_test_device_action",
    "query_postcondition",
    "cleanup_test_resource"
  ]);
  for (const item of manifest.cases) {
    if (!item.caseId.trim() || !item.title.trim()) throw new Error("Every formal case requires a caseId and title.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.caseId)) {
      throw new Error(`${item.caseId} is not a safe formal caseId.`);
    }
    if (item.timeoutMs !== undefined
      && (!Number.isInteger(item.timeoutMs) || item.timeoutMs < 30_000 || item.timeoutMs > 600_000)) {
      throw new Error(`${item.caseId} timeoutMs must be an integer between 30000 and 600000.`);
    }
    if (item.evidencePolicy !== undefined
      && !["standard", "sensitive"].includes(item.evidencePolicy)) {
      throw new Error(`${item.caseId} evidencePolicy must be standard or sensitive.`);
    }
    assertUnique(item.requiredCapabilities.map(formalCapabilityId), `${item.caseId} required capability`);
    assertUnique(item.requiredTestAssetIds ?? [], `${item.caseId} required test asset`);
    assertUnique(item.requiredResources, `${item.caseId} required resource`);
    assertUnique(item.producesResources.map(producedResourceName), `${item.caseId} produced resource`);
    if (manifest.schemaVersion === "formal-execution-manifest-v2") {
      if (!item.permissionProfile || !item.dataWritePolicy || !item.requiredOperations || !item.implementation) {
        throw new Error(`${item.caseId} v2 requires permissionProfile, operations, data policy and implementation.`);
      }
      if (item.permissionProfile === "read_only" && item.dataWritePolicy !== "no_write") {
        throw new Error(`${item.caseId} read_only must use no_write.`);
      }
      assertUnique(
        (item.consumesResources ?? []).map((resource) => resource.name),
        `${item.caseId} consumed resource`
      );
      for (const resource of item.consumesResources ?? []) {
        if (!resource.name.trim() || !resource.baselineContractId.trim()) {
          throw new Error(`${item.caseId} consumed resources require a name and baseline contract.`);
        }
        if (item.permissionProfile !== "read_only" && resource.leaseMode !== "exclusive") {
          throw new Error(`${item.caseId} write-capable resource consumers require an exclusive lease.`);
        }
      }
      for (const resource of item.producesResources) {
        if (typeof resource === "string") {
          throw new Error(`${item.caseId} v2 produced resources require an explicit disposition contract.`);
        }
        validateProducedResourceContract(item.caseId, resource);
      }
      for (const assetId of item.requiredTestAssetIds ?? []) {
        if (!testAssetEvidenceIds.has(assetId)) {
          throw new Error(`${item.caseId} requires test asset ${assetId} without frozen test_asset build evidence.`);
        }
        referencedTestAssetIds.add(assetId);
      }
    }
    if (item.requiredOperations !== undefined) {
      assertUnique(item.requiredOperations, `${item.caseId} required operation`);
      for (const operation of item.requiredOperations) {
        if (!executionOperationKinds.includes(operation)) {
          throw new Error(`${item.caseId} declares unknown operation ${operation}.`);
        }
      }
      assertUnique(
        (item.operationBudgets ?? []).map((budget) => budget.operation),
        `${item.caseId} operation budget`
      );
      for (const budget of item.operationBudgets ?? []) {
        if (!item.requiredOperations.includes(budget.operation)
          || !Number.isInteger(budget.maxExecutions)
          || budget.maxExecutions <= 0) {
          throw new Error(`${item.caseId} contains an invalid per-case operation budget.`);
        }
      }
      if (item.operationBudgets !== undefined) {
        const missingBudgets = item.requiredOperations.filter((operation) =>
          budgetedOperations.has(operation)
          && !item.operationBudgets!.some((budget) => budget.operation === operation)
        );
        if (missingBudgets.length > 0) {
          throw new Error(`${item.caseId} is missing per-case operation budgets: ${missingBudgets.join(", ")}.`);
        }
      }
    }
    const v5Fields = [item.requiredOperations, item.dataWritePolicy, item.implementation];
    if (v5Fields.some((value) => value !== undefined)
      && v5Fields.some((value) => value === undefined)) {
      throw new Error(
        `${item.caseId} must declare requiredOperations, dataWritePolicy and implementation together.`
      );
    }
    if (item.requiredOperations && item.dataWritePolicy === "no_write"
      && item.requiredOperations.some((operation) => mutatingOperations.has(operation))) {
      throw new Error(`${item.caseId} no_write cannot declare mutating operations.`);
    }
    if (item.dataWritePolicy === "tracked_residual" && manifest.environment !== "test") {
      throw new Error(`${item.caseId} tracked_residual is allowed only in the test environment.`);
    }
    if (item.implementation?.status === "source_complete" && (
      item.implementation.reachableBoundary
      || item.implementation.pendingCapabilityIds?.length
    )) {
      throw new Error(`${item.caseId} source_complete cannot declare pending runtime boundaries.`);
    }
    if (item.implementation?.status === "runtime_validation_pending") {
      if (!item.implementation.reachableBoundary?.trim()) {
        throw new Error(`${item.caseId} runtime_validation_pending requires reachableBoundary.`);
      }
      if (!item.implementation.pendingCapabilityIds?.length) {
        throw new Error(`${item.caseId} runtime_validation_pending requires pendingCapabilityIds.`);
      }
      assertUnique(
        item.implementation.pendingCapabilityIds,
        `${item.caseId} pending capability`
      );
      for (const capabilityId of item.implementation.pendingCapabilityIds) {
        if (capabilityId === "runtime-validation-pending") {
          throw new Error(
            `${item.caseId} must reference real pending capabilities, not runtime-validation-pending.`
          );
        }
        if (!item.requiredCapabilities.map(formalCapabilityId).includes(capabilityId)) {
          throw new Error(
            `${item.caseId} pending capability ${capabilityId} is not required by the case.`
          );
        }
      }
    }
    const operationEvidenceIssues = operationEvidenceDefinitionIssues({
      requiredOperations: item.requiredOperations ?? [],
      requiredCapabilities: item.requiredCapabilities.map(formalCapabilityId),
      definitions: item.operationEvidence,
      dataWritePolicy: item.dataWritePolicy
    });
    if (item.operationEvidence && operationEvidenceIssues.length) {
      throw new Error(`${item.caseId} ${operationEvidenceIssues.join(" ")}`);
    }
    validateExecutionStages(item);
    for (const requirement of item.requiredCapabilities) {
      const capability = formalCapabilityId(requirement);
      if (!capabilitySet.has(capability)) {
        throw new Error(`${item.caseId} requires undeclared capability ${capability}.`);
      }
      if (
        typeof requirement !== "string"
        && !manifestTransitionSet.has(requirement.checkAfterTransitionId)
      ) {
        throw new Error(
          `${item.caseId} capability ${capability} references unknown transition ${requirement.checkAfterTransitionId}.`
        );
      }
    }
    for (const produced of item.producesResources) {
      const resource = producedResourceName(produced);
      const existing = producers.get(resource);
      if (existing) throw new Error(`Named resource ${resource} has multiple producers: ${existing}, ${item.caseId}.`);
      producers.set(resource, item.caseId);
    }
  }
  for (const assetId of testAssetEvidenceIds) {
    if (!referencedTestAssetIds.has(assetId)) {
      throw new Error(`Test asset build evidence ${assetId} is not required by any formal case.`);
    }
  }
  for (const capability of manifest.capabilities) {
    if (
      manifest.schemaVersion === "formal-execution-manifest-v2"
      && capability.source.kind === "provider"
      && /(?:selector|aria|browser[_-]?response|source[_-]?contract)/iu.test(capability.source.providerId)
    ) {
      throw new Error(
        `Capability ${capability.id} is build evidence, not a runtime provider.`
      );
    }
    if (
      capability.id === "runtime-validation-pending"
      || (capability.source.kind === "provider"
        && capability.source.providerId === "runtime_validation_pending")
    ) {
      throw new Error(
        "runtime-validation-pending is not a capability; declare the real pending capabilities."
      );
    }
    if (
      capability.source.kind === "provider"
      && !capability.source.providerId.trim()
    ) {
      throw new Error(`Capability ${capability.id} requires a providerId.`);
    }
    for (const caseId of capability.requiredForCaseIds) {
      if (!caseSet.has(caseId)) throw new Error(`Capability ${capability.id} references unknown case ${caseId}.`);
    }
    const mapped = caseIds.filter((caseId) =>
      manifest.cases.find((item) => item.caseId === caseId)?.requiredCapabilities
        .map(formalCapabilityId).includes(capability.id)
    );
    if (JSON.stringify([...mapped].sort()) !== JSON.stringify([...capability.requiredForCaseIds].sort())) {
      throw new Error(`Capability ${capability.id} affected cases differ from case dependency declarations.`);
    }
  }

  const external = new Set(manifest.externalResources ?? []);
  const edges = new Map(caseIds.map((caseId) => [caseId, [] as string[]]));
  for (const item of manifest.cases) {
    for (const resource of item.requiredResources) {
      const producer = producers.get(resource);
      if (!producer && !external.has(resource)) {
        throw new Error(`${item.caseId} requires named resource ${resource} without a producer or external declaration.`);
      }
      if (producer) edges.get(producer)!.push(item.caseId);
    }
  }
  assertAcyclic(edges);
}

function validatePageSessionGroups(
  manifest: FormalExecutionManifest,
  caseSet: ReadonlySet<string>
): void {
  const groups = manifest.pageSessionGroups;
  if (!groups) return;
  if (groups.length === 0) {
    throw new Error("pageSessionGroups cannot be empty when declared.");
  }
  assertUnique(groups.map((group) => group.sessionGroupId), "page session group");
  const assignedCaseIds: string[] = [];
  for (const group of groups) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(group.sessionGroupId)) {
      throw new Error(`Page session group ${group.sessionGroupId} has an unsafe id.`);
    }
    if (!group.targetRoute.startsWith("/") || !group.isolationReason.trim()) {
      throw new Error(`Page session group ${group.sessionGroupId} requires a route and isolation reason.`);
    }
    if (group.caseIds.length === 0) {
      throw new Error(`Page session group ${group.sessionGroupId} must contain at least one case.`);
    }
    assertUnique(group.caseIds, `${group.sessionGroupId} case`);
    assertUnique(group.executionOrder, `${group.sessionGroupId} execution order`);
    if (
      JSON.stringify([...group.caseIds].sort())
      !== JSON.stringify([...group.executionOrder].sort())
    ) {
      throw new Error(`Page session group ${group.sessionGroupId} executionOrder must cover its cases exactly.`);
    }
    for (const caseId of group.caseIds) {
      if (!caseSet.has(caseId)) {
        throw new Error(`Page session group ${group.sessionGroupId} references unknown case ${caseId}.`);
      }
      assignedCaseIds.push(caseId);
    }
    if (group.resetStrategy !== "new_context_per_case") {
      const unsafeCases = group.caseIds.filter((caseId) => {
        const definition = manifest.cases.find((item) => item.caseId === caseId)!;
        return definition.dataWritePolicy !== "no_write"
          || definition.permissionProfile !== "read_only"
          || (definition.requiredOperations?.length ?? 0) > 0;
      });
      if (unsafeCases.length > 0) {
        throw new Error(
          `Page session group ${group.sessionGroupId} may reuse a page only for read-only no-write cases without authorized external operations: ${unsafeCases.join(", ")}.`
        );
      }
    }
  }
  assertUnique(assignedCaseIds, "page session case assignment");
  if (
    JSON.stringify([...assignedCaseIds].sort())
    !== JSON.stringify([...caseSet].sort())
  ) {
    throw new Error("pageSessionGroups must assign every formal case exactly once.");
  }
}

export function formalCapabilityId(requirement: FormalCapabilityRequirementInput): string {
  return typeof requirement === "string" ? requirement : requirement.capabilityId;
}

export function initialFormalCapabilityIds(
  requirements: FormalCapabilityRequirementInput[]
): string[] {
  return requirements.flatMap((requirement) =>
    typeof requirement === "string" ? [requirement] : []
  );
}

export function capabilityTransitionId(
  requirements: FormalCapabilityRequirementInput[],
  capabilityId: string
): string | undefined {
  const requirement = requirements.find((item) => formalCapabilityId(item) === capabilityId);
  return typeof requirement === "string" ? undefined : requirement?.checkAfterTransitionId;
}

export function producedResourceName(
  resource: string | FormalProducedResourceContract
): string {
  return typeof resource === "string" ? resource : resource.name;
}

function validateProducedResourceContract(
  caseId: string,
  resource: FormalProducedResourceContract
): void {
  if (!resource.name.trim()) throw new Error(`${caseId} produced resource requires a name.`);
  if (resource.disposition === "reusable_fixture") {
    if (
      !resource.baselineContractId?.trim()
      || !resource.baselineVersion?.trim()
      || !resource.leaseMode
      || !Number.isInteger(resource.maxPoolSize)
      || resource.maxPoolSize! <= 0
      || resource.retirementPolicy !== "validate_quarantine_replace"
    ) {
      throw new Error(`${caseId} reusable_fixture requires baseline, lease, capacity and retirement contracts.`);
    }
  }
}

function validateExecutionStages(item: FormalExecutionManifest["cases"][number]): void {
  const stages = item.executionStages ?? [];
  if (!stages.length) return;
  assertUnique(stages.map((stage) => stage.stageId), `${item.caseId} stageId`);
  const stageIds = new Set(stages.map((stage) => stage.stageId));
  const transitionIds: string[] = [];
  const edges = new Map(stages.map((stage) => [stage.stageId, [] as string[]]));
  const producedNames = new Set(item.producesResources.map(producedResourceName));
  for (const stage of stages) {
    if (!stage.stageId.trim() || !stage.title.trim()) {
      throw new Error(`${item.caseId} execution stage requires a stageId and title.`);
    }
    assertUnique(stage.dependsOnStageIds ?? [], `${item.caseId}/${stage.stageId} stage dependency`);
    for (const dependency of stage.dependsOnStageIds ?? []) {
      if (!stageIds.has(dependency)) {
        throw new Error(`${item.caseId}/${stage.stageId} depends on unknown stage ${dependency}.`);
      }
      edges.get(dependency)!.push(stage.stageId);
    }
    for (const resource of stage.requiredResources ?? []) {
      if (!item.requiredResources.includes(resource)) {
        throw new Error(`${item.caseId}/${stage.stageId} requires undeclared resource ${resource}.`);
      }
    }
    for (const resource of stage.producesResources ?? []) {
      if (!producedNames.has(resource)) {
        throw new Error(`${item.caseId}/${stage.stageId} produces undeclared resource ${resource}.`);
      }
    }
    const transition = stage.externalTransition;
    if (!transition) continue;
    transitionIds.push(transition.transitionId);
    if (
      !transition.transitionId.trim()
      || transition.kind !== "human_attestation"
      || !transition.actionSummary.trim()
      || !transition.allowedOutcomes.length
    ) {
      throw new Error(`${item.caseId}/${stage.stageId} contains an invalid external transition.`);
    }
    assertUnique(transition.allowedOutcomes, `${item.caseId}/${transition.transitionId} outcome`);
    assertUnique(
      transition.requiredAttestationKeys ?? [],
      `${item.caseId}/${transition.transitionId} attestation key`
    );
    for (const value of [
      transition.transitionId,
      ...transition.allowedOutcomes,
      ...(transition.requiredAttestationKeys ?? [])
    ]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
        throw new Error(`${item.caseId} external transition identifiers must be safe tokens.`);
      }
    }
  }
  assertUnique(transitionIds, `${item.caseId} transitionId`);
  assertAcyclic(edges);
}

function canonicalPolicy(policy: string): string {
  return policy === "managed_cleanup" ? "ephemeral_cleanup" : policy;
}

export function digestFormalExecutionManifest(manifest: FormalExecutionManifest): string {
  validateFormalExecutionManifest(manifest);
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function evaluateCapabilities(
  definitions: FormalCapabilityDefinition[],
  environment: NodeJS.ProcessEnv = process.env
): FormalCapabilityResult[] {
  const checkedAt = new Date().toISOString();
  return definitions.map((definition) => {
    if (definition.source.kind !== "environment") {
      return {
        capabilityId: definition.id,
        available: false,
        affectedCaseIds: [...definition.requiredForCaseIds],
        reason: `Capability provider ${definition.source.providerId} requires the provider registry.`,
        unblockCondition: `Check ${definition.source.providerId} through evaluateCapabilitiesWithProviders().`,
        checkedAt,
        evidenceDigest: createHash("sha256")
          .update(`${definition.id}:provider_registry_required`, "utf8")
          .digest("hex")
      };
    }
    const value = environment[definition.source.variable]?.trim();
    const available = Boolean(value)
      && (!definition.source.pattern || new RegExp(definition.source.pattern).test(value!));
    return {
      capabilityId: definition.id,
      available,
      affectedCaseIds: [...definition.requiredForCaseIds],
      reason: available ? undefined : definition.unavailableReason,
      unblockCondition: available ? undefined : definition.unblockCondition,
      checkedAt,
      evidenceDigest: createHash("sha256")
        .update(JSON.stringify({
          capabilityId: definition.id,
          variable: definition.source.variable,
          configured: Boolean(value),
          patternSatisfied: available
        }), "utf8")
        .digest("hex")
    };
  });
}

export async function evaluateCapabilitiesWithProviders(
  definitions: FormalCapabilityDefinition[],
  context: CapabilityCheckContext,
  registry = createDefaultCapabilityProviderRegistry()
): Promise<FormalCapabilityResult[]> {
  return registry.check(definitions, context);
}

export async function loadFormalExecutionManifest(requestId: string): Promise<FormalExecutionManifest> {
  if (!/^(?:web|h5|app|api|mqtt|iot)\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(requestId)) {
    throw new Error("Formal request must use <web|h5|app|api|mqtt|iot>/<project>/<request>.");
  }
  const [type, ...requestParts] = requestId.split("/");
  const relativeRequest = requestParts.join("/");
  const path = resolve(process.cwd(), "tests", type!, relativeRequest, "execution.manifest.ts");
  const imported = await import(pathToFileURL(path).href) as { formalExecutionManifest?: FormalExecutionManifest };
  if (!imported.formalExecutionManifest) {
    throw new Error(`Formal execution manifest is missing at tests/${type}/${relativeRequest}/execution.manifest.ts.`);
  }
  validateFormalExecutionManifest(imported.formalExecutionManifest);
  if (imported.formalExecutionManifest.requestId !== requestId) {
    throw new Error("Formal execution manifest requestId differs from the requested scope.");
  }
  return imported.formalExecutionManifest;
}

function assertUnique(values: string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate ${label}: ${[...new Set(duplicates)].join(", ")}.`);
  }
}

function assertAcyclic(edges: Map<string, string[]>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (caseId: string) => {
    if (visiting.has(caseId)) throw new Error(`Formal case resource dependency cycle includes ${caseId}.`);
    if (visited.has(caseId)) return;
    visiting.add(caseId);
    for (const dependency of edges.get(caseId) ?? []) visit(dependency);
    visiting.delete(caseId);
    visited.add(caseId);
  };
  for (const caseId of edges.keys()) visit(caseId);
}
