import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type {
  FormalCapabilityDefinition,
  FormalCapabilityResult,
  FormalExecutionManifest
} from "./types.js";

export function defineFormalExecutionManifest(manifest: FormalExecutionManifest): FormalExecutionManifest {
  validateFormalExecutionManifest(manifest);
  return manifest;
}

export function validateFormalExecutionManifest(manifest: FormalExecutionManifest): void {
  if (manifest.schemaVersion !== "formal-execution-manifest-v1") {
    throw new Error("Unsupported formal execution manifest schema.");
  }
  if (!manifest.requestId.trim() || !manifest.projectId.trim() || !manifest.environment.trim()) {
    throw new Error("Formal execution manifest requires request, project and environment.");
  }
  const caseIds = manifest.cases.map((item) => item.caseId);
  assertUnique(caseIds, "caseId");
  if (caseIds.length === 0) throw new Error("Formal execution manifest must contain at least one case.");
  assertUnique(manifest.capabilities.map((item) => item.id), "capability");

  const caseSet = new Set(caseIds);
  const capabilitySet = new Set(manifest.capabilities.map((item) => item.id));
  const producers = new Map<string, string>();
  for (const item of manifest.cases) {
    if (!item.caseId.trim() || !item.title.trim()) throw new Error("Every formal case requires a caseId and title.");
    if (item.timeoutMs !== undefined
      && (!Number.isInteger(item.timeoutMs) || item.timeoutMs < 30_000 || item.timeoutMs > 600_000)) {
      throw new Error(`${item.caseId} timeoutMs must be an integer between 30000 and 600000.`);
    }
    assertUnique(item.requiredCapabilities, `${item.caseId} required capability`);
    assertUnique(item.requiredResources, `${item.caseId} required resource`);
    assertUnique(item.producesResources, `${item.caseId} produced resource`);
    for (const capability of item.requiredCapabilities) {
      if (!capabilitySet.has(capability)) {
        throw new Error(`${item.caseId} requires undeclared capability ${capability}.`);
      }
    }
    for (const resource of item.producesResources) {
      const existing = producers.get(resource);
      if (existing) throw new Error(`Named resource ${resource} has multiple producers: ${existing}, ${item.caseId}.`);
      producers.set(resource, item.caseId);
    }
  }
  for (const capability of manifest.capabilities) {
    for (const caseId of capability.requiredForCaseIds) {
      if (!caseSet.has(caseId)) throw new Error(`Capability ${capability.id} references unknown case ${caseId}.`);
    }
    const mapped = caseIds.filter((caseId) =>
      manifest.cases.find((item) => item.caseId === caseId)?.requiredCapabilities.includes(capability.id)
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
    const value = environment[definition.source.variable]?.trim();
    const available = Boolean(value)
      && (!definition.source.pattern || new RegExp(definition.source.pattern).test(value!));
    return {
      capabilityId: definition.id,
      available,
      affectedCaseIds: [...definition.requiredForCaseIds],
      reason: available ? undefined : definition.unavailableReason,
      unblockCondition: available ? undefined : definition.unblockCondition,
      checkedAt
    };
  });
}

export async function loadFormalExecutionManifest(requestId: string): Promise<FormalExecutionManifest> {
  if (!/^web\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(requestId)) {
    throw new Error("Formal Web request must use web/<project>/<request>.");
  }
  const relativeRequest = requestId.replace(/^web\//, "");
  const path = resolve(process.cwd(), "tests/web", relativeRequest, "execution.manifest.ts");
  const imported = await import(pathToFileURL(path).href) as { formalExecutionManifest?: FormalExecutionManifest };
  if (!imported.formalExecutionManifest) {
    throw new Error(`Formal execution manifest is missing at tests/web/${relativeRequest}/execution.manifest.ts.`);
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
