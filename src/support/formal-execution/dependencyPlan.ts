import { createHash } from "node:crypto";
import { producedResourceName } from "./manifest.js";
import type {
  FormalConsumedResourceContract,
  FormalExecutionManifest,
  FormalProducedResourceContract
} from "./types.js";

export interface ExecutionDependencyEdge {
  producerCaseId: string;
  consumerCaseId: string;
  resourceName: string;
  /** Present when a reusable-pool contract aliases the producer's exact name. */
  consumerResourceName?: string;
  producerStageId?: string;
  consumerStageId?: string;
}

export interface ExecutionDependencyStageNode {
  nodeId: string;
  caseId: string;
  stageId: string;
  requiredResources: string[];
  producesResources: string[];
}

export interface ExecutionDependencyNode {
  caseId: string;
  stageIds: string[];
  upstreamCaseIds: string[];
  downstreamCaseIds: string[];
  dependencyPaths: string[][];
}

export interface ExecutionDependencyWave {
  index: number;
  caseIds: string[];
}

export interface ExecutionDependencyPlan {
  schemaVersion: "formal-execution-dependency-plan-v1";
  nodes: ExecutionDependencyNode[];
  stageNodes: ExecutionDependencyStageNode[];
  edges: ExecutionDependencyEdge[];
  waves: ExecutionDependencyWave[];
  initialCaseIds: string[];
  scheduledCaseIds: string[];
  graphDigest: string;
}

interface ProducedResource {
  caseId: string;
  resource: string | FormalProducedResourceContract;
  stageId?: string;
}

/**
 * Builds the immutable case ordering from named resource contracts. There is no
 * second, order-only dependency declaration that can drift from the data flow.
 */
export function buildExecutionDependencyPlan(
  manifest: FormalExecutionManifest,
  selectedCaseIds: string[]
): ExecutionDependencyPlan {
  const definitions = new Map(manifest.cases.map((item) => [item.caseId, item]));
  const selected = [...new Set(selectedCaseIds)].sort();
  const selectedSet = new Set(selected);
  for (const caseId of selected) {
    if (!definitions.has(caseId)) {
      throw new Error(`Dependency plan selected undeclared case ${caseId}.`);
    }
  }

  const external = new Set(manifest.externalResources ?? []);
  const producers = new Map<string, ProducedResource>();
  const poolProducers = new Map<string, ProducedResource[]>();
  for (const definition of manifest.cases) {
    for (const resource of definition.producesResources) {
      const name = producedResourceName(resource);
      const stageIds = (definition.executionStages ?? [])
        .filter((stage) => stage.producesResources?.includes(name))
        .map((stage) => stage.stageId);
      if (stageIds.length > 1) {
        throw new Error(`${definition.caseId} produces ${name} in more than one execution stage.`);
      }
      const produced: ProducedResource = {
        caseId: definition.caseId,
        resource,
        ...(stageIds[0] ? { stageId: stageIds[0] } : {})
      };
      const existing = producers.get(name);
      if (existing && existing.caseId !== definition.caseId) {
        throw new Error(`Named resource ${name} has multiple producers.`);
      }
      producers.set(name, produced);
      if (typeof resource !== "string" && resource.baselineContractId) {
        const key = poolKey(resource.resourceType, resource.baselineContractId);
        poolProducers.set(key, [...(poolProducers.get(key) ?? []), produced]);
      }
    }
  }

  const edges: ExecutionDependencyEdge[] = [];
  for (const caseId of selected) {
    const definition = definitions.get(caseId)!;
    for (const resourceName of definition.requiredResources) {
      if (external.has(resourceName)) continue;
      const producer = producers.get(resourceName);
      if (!producer) {
        throw new Error(`${caseId} requires ${resourceName} without a producer or external resource.`);
      }
      requireSelectedProducer(caseId, producer.caseId, resourceName, selectedSet);
      edges.push({
        producerCaseId: producer.caseId,
        consumerCaseId: caseId,
        resourceName,
        ...(producer.stageId ? { producerStageId: producer.stageId } : {}),
        ...consumerStage(definition.executionStages ?? [], resourceName)
      });
    }
    for (const contract of definition.consumesResources ?? []) {
      const exact = producers.get(contract.name);
      const producer = exact ?? uniquePoolProducer(contract, poolProducers);
      if (!producer) continue;
      requireSelectedProducer(caseId, producer.caseId, contract.name, selectedSet);
      const producedName = producedResourceName(producer.resource);
      edges.push({
        producerCaseId: producer.caseId,
        consumerCaseId: caseId,
        resourceName: producedName,
        ...(producedName === contract.name ? {} : { consumerResourceName: contract.name }),
        ...(producer.stageId ? { producerStageId: producer.stageId } : {})
      });
    }
  }

  const normalizedEdges = uniqueEdges(edges).sort(compareEdges);
  const waves = topologicalWaves(selected, normalizedEdges);
  const roots = waves[0]?.caseIds ?? [];
  const nodes = selected.map((caseId) => ({
    caseId,
    stageIds: (definitions.get(caseId)?.executionStages ?? []).map((stage) => stage.stageId),
    upstreamCaseIds: uniqueSorted(normalizedEdges
      .filter((edge) => edge.consumerCaseId === caseId)
      .map((edge) => edge.producerCaseId)),
    downstreamCaseIds: uniqueSorted(normalizedEdges
      .filter((edge) => edge.producerCaseId === caseId)
      .map((edge) => edge.consumerCaseId)),
    dependencyPaths: dependencyPaths(caseId, roots, normalizedEdges)
  }));
  const stageNodes = selected.flatMap((caseId) =>
    (definitions.get(caseId)?.executionStages ?? []).map((stage) => ({
      nodeId: `${caseId}#${stage.stageId}`,
      caseId,
      stageId: stage.stageId,
      requiredResources: [...(stage.requiredResources ?? [])].sort(),
      producesResources: [...(stage.producesResources ?? [])].sort()
    }))
  );
  const digestInput = {
    schemaVersion: "formal-execution-dependency-plan-v1",
    selectedCaseIds: selected,
    nodes,
    stageNodes,
    edges: normalizedEdges,
    waves
  };
  return {
    schemaVersion: "formal-execution-dependency-plan-v1",
    nodes,
    stageNodes,
    edges: normalizedEdges,
    waves,
    initialCaseIds: [...roots],
    scheduledCaseIds: waves.slice(1).flatMap((wave) => wave.caseIds),
    graphDigest: createHash("sha256").update(JSON.stringify(digestInput)).digest("hex")
  };
}

function poolKey(resourceType: string, baselineContractId: string): string {
  return `${resourceType}:${baselineContractId}`;
}

function uniquePoolProducer(
  contract: FormalConsumedResourceContract,
  poolProducers: Map<string, ProducedResource[]>
): ProducedResource | undefined {
  const candidates = poolProducers.get(poolKey(contract.resourceType, contract.baselineContractId)) ?? [];
  if (candidates.length > 1) {
    throw new Error(
      `${contract.name} has ambiguous in-run producers for ${contract.resourceType}:${contract.baselineContractId}.`
    );
  }
  return candidates[0];
}

function requireSelectedProducer(
  consumerCaseId: string,
  producerCaseId: string,
  resourceName: string,
  selected: Set<string>
): void {
  if (!selected.has(producerCaseId)) {
    throw new Error(
      `${consumerCaseId} requires ${resourceName} from unselected producer ${producerCaseId}.`
    );
  }
}

function consumerStage(
  stages: NonNullable<FormalExecutionManifest["cases"][number]["executionStages"]>,
  resourceName: string
): Pick<ExecutionDependencyEdge, "consumerStageId"> {
  const stageIds = stages
    .filter((stage) => stage.requiredResources?.includes(resourceName))
    .map((stage) => stage.stageId);
  if (stageIds.length > 1) {
    throw new Error(`Resource ${resourceName} is consumed by more than one stage in the same case.`);
  }
  return stageIds[0] ? { consumerStageId: stageIds[0] } : {};
}

function uniqueEdges(edges: ExecutionDependencyEdge[]): ExecutionDependencyEdge[] {
  return [...new Map(edges.map((edge) => [
    `${edge.producerCaseId}\0${edge.consumerCaseId}\0${edge.resourceName}\0${edge.consumerResourceName ?? ""}`,
    edge
  ])).values()];
}

function compareEdges(left: ExecutionDependencyEdge, right: ExecutionDependencyEdge): number {
  return left.producerCaseId.localeCompare(right.producerCaseId)
    || left.consumerCaseId.localeCompare(right.consumerCaseId)
    || left.resourceName.localeCompare(right.resourceName);
}

function topologicalWaves(caseIds: string[], edges: ExecutionDependencyEdge[]): ExecutionDependencyWave[] {
  const downstream = new Map(caseIds.map((caseId) => [caseId, [] as string[]]));
  const indegree = new Map(caseIds.map((caseId) => [caseId, 0]));
  for (const edge of edges) {
    downstream.get(edge.producerCaseId)!.push(edge.consumerCaseId);
    indegree.set(edge.consumerCaseId, (indegree.get(edge.consumerCaseId) ?? 0) + 1);
  }
  const waves: ExecutionDependencyWave[] = [];
  const remaining = new Set(caseIds);
  while (remaining.size > 0) {
    const current = [...remaining].filter((caseId) => indegree.get(caseId) === 0).sort();
    if (current.length === 0) {
      throw new Error(`Formal case dependency graph contains a cycle: ${[...remaining].sort().join(", ")}.`);
    }
    waves.push({ index: waves.length, caseIds: current });
    for (const caseId of current) {
      remaining.delete(caseId);
      for (const consumer of downstream.get(caseId) ?? []) {
        indegree.set(consumer, (indegree.get(consumer) ?? 0) - 1);
      }
    }
  }
  return waves;
}

function dependencyPaths(
  target: string,
  roots: string[],
  edges: ExecutionDependencyEdge[]
): string[][] {
  const upstream = new Map<string, string[]>();
  for (const edge of edges) {
    upstream.set(edge.consumerCaseId, uniqueSorted([
      ...(upstream.get(edge.consumerCaseId) ?? []),
      edge.producerCaseId
    ]));
  }
  const paths: string[][] = [];
  const visit = (caseId: string, suffix: string[]): void => {
    const parents = upstream.get(caseId) ?? [];
    if (!parents.length) {
      if (roots.includes(caseId)) paths.push([caseId, ...suffix]);
      return;
    }
    for (const parent of parents) visit(parent, [caseId, ...suffix]);
  };
  visit(target, []);
  return paths.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
