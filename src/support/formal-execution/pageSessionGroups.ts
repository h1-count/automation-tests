import type {
  FormalExecutionManifest,
  FormalPageSessionGroupDefinition
} from "./types.js";

let registeredRequestId: string | undefined;
const groupsByCaseId = new Map<string, FormalPageSessionGroupDefinition>();

export function registerFormalPageSessionGroups(manifest: FormalExecutionManifest): void {
  if (!manifest.pageSessionGroups) return;
  if (registeredRequestId && registeredRequestId !== manifest.requestId) {
    throw new Error("A Playwright worker cannot mix formal page-session manifests.");
  }
  registeredRequestId = manifest.requestId;
  for (const group of manifest.pageSessionGroups) {
    for (const caseId of group.caseIds) {
      const existing = groupsByCaseId.get(caseId);
      if (existing && existing.sessionGroupId !== group.sessionGroupId) {
        throw new Error(`${caseId} has conflicting page-session groups.`);
      }
      groupsByCaseId.set(caseId, group);
    }
  }
}

export function formalPageSessionGroupForCase(
  requestId: string,
  caseId: string
): FormalPageSessionGroupDefinition | undefined {
  if (registeredRequestId && registeredRequestId !== requestId) {
    throw new Error(`Page-session registry belongs to ${registeredRequestId}, not ${requestId}.`);
  }
  return groupsByCaseId.get(caseId);
}

export function formalCaseIdFromTestTitle(title: string): string {
  const separator = title.indexOf("：");
  const caseId = (separator < 0 ? title : title.slice(0, separator)).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(caseId)) {
    throw new Error(`Cannot resolve a formal caseId from Playwright title: ${title}`);
  }
  return caseId;
}

export function pageSessionGroupsRequireSingleWorker(
  manifest: Pick<FormalExecutionManifest, "pageSessionGroups">,
  selectedCaseIds: readonly string[]
): boolean {
  const selected = new Set(selectedCaseIds);
  return manifest.pageSessionGroups?.some((group) =>
    group.resetStrategy !== "new_context_per_case"
    && group.caseIds.filter((caseId) => selected.has(caseId)).length > 1
  ) ?? false;
}
