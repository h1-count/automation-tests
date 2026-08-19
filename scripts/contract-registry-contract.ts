export const CONTRACT_REGISTRY_SCHEMA_VERSION = "contract-registry-v1" as const;

export interface ContractRegistryDocument {
  path: string;
  content: string;
}

export interface ContractRegistryInspection {
  activeIds: string[];
  replayOnlyIds: string[];
  archivedIds: string[];
  violations: string[];
}

const contractIdPattern = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v\d+(?:-[a-z0-9]+)*\b/gu;

export function extractContractIds(content: string): string[] {
  return [...new Set(content.match(contractIdPattern) ?? [])].sort();
}

function section(content: string, heading: string, nextHeading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const end = content.indexOf(nextHeading, start + heading.length);
  return content.slice(start, end < 0 ? content.length : end);
}

function registryColumns(content: string): {
  activeIds: string[];
  replayOnlyIds: string[];
  archivedIds: string[];
} {
  const table = section(content, "| 契约族 |", "## 变更规则");
  const active = new Set<string>();
  const replayOnly = new Set<string>();
  const archived = new Set<string>();
  for (const line of table.split(/\r?\n/u)) {
    if (!line.startsWith("|") || /^\|\s*-+\s*\|/u.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === "契约族") continue;
    for (const id of extractContractIds(cells[1] ?? "")) active.add(id);
    const noncurrent = cells[2] ?? "";
    const target = noncurrent.includes("归档证据") ? archived : replayOnly;
    for (const id of extractContractIds(noncurrent)) target.add(id);
  }
  return {
    activeIds: [...active].sort(),
    replayOnlyIds: [...replayOnly].sort(),
    archivedIds: [...archived].sort()
  };
}

export function inspectContractRegistry(
  registryContent: string,
  documents: readonly ContractRegistryDocument[]
): ContractRegistryInspection {
  const violations: string[] = [];
  if (!registryContent.includes(`注册表版本：${CONTRACT_REGISTRY_SCHEMA_VERSION}`)) {
    violations.push(`Contract registry must declare ${CONTRACT_REGISTRY_SCHEMA_VERSION}.`);
  }
  const { activeIds, replayOnlyIds, archivedIds } = registryColumns(registryContent);
  if (activeIds.length === 0) violations.push("Contract registry has no active identifiers.");
  const replaySet = new Set(replayOnlyIds);
  const archivedSet = new Set(archivedIds);
  for (const id of activeIds) {
    if (replaySet.has(id)) violations.push(`${id}: cannot be both active and replay-only.`);
    if (archivedSet.has(id)) violations.push(`${id}: cannot be both active and archived.`);
  }
  if (!activeIds.includes(CONTRACT_REGISTRY_SCHEMA_VERSION)) {
    violations.push(`${CONTRACT_REGISTRY_SCHEMA_VERSION}: registry schema must be active.`);
  }

  const registered = new Set([...activeIds, ...replayOnlyIds, ...archivedIds]);
  for (const document of documents) {
    for (const id of extractContractIds(document.content)) {
      if (!registered.has(id)) {
        violations.push(`${document.path}: unregistered contract identifier ${id}.`);
      }
    }
  }
  return { activeIds, replayOnlyIds, archivedIds, violations };
}

export function inspectCurrentContractUsage(
  registryContent: string,
  documents: readonly ContractRegistryDocument[]
): string[] {
  const { replayOnlyIds, archivedIds } = registryColumns(registryContent);
  const noncurrent = new Map([
    ...replayOnlyIds.map((id) => [id, "replay-only"] as const),
    ...archivedIds.map((id) => [id, "archived"] as const)
  ]);
  return documents.flatMap((document) =>
    extractContractIds(document.content)
      .filter((id) => noncurrent.has(id))
      .map((id) => `${document.path}: current-generation surface uses ${noncurrent.get(id)} contract ${id}.`)
  );
}
