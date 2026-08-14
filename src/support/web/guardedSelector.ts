import type { Locator, Page } from "@playwright/test";
import type {
  FormalCaseRuntime,
  FormalSelectorRepairIncidentReference
} from "../formal-execution/types.js";
import {
  recordSelectorRepairIncident,
  selectorValuesRelated
} from "../formal-execution/selectorRepair.js";

type Role = Parameters<Page["getByRole"]>[0];
type RoleScope = Pick<Page, "getByRole"> | Pick<Locator, "getByRole">;

export interface GuardedRoleLocatorInput {
  page: Page;
  runtime: FormalCaseRuntime;
  caseId: string;
  selectorId: string;
  sourcePath: string;
  role: Role;
  name: string;
  scopeId: string;
  stateId: string;
  action: "click";
  businessAssertion: false;
  scope?: Locator;
  timeoutMs?: number;
  workspaceRoot?: string;
}

/**
 * Returns the exact authorized locator when it is usable. When only its
 * accessible name drifted, this helper records a zero-write observation and
 * throws. It never clicks the observed candidate as a fallback.
 */
export async function guardedRoleLocator(
  input: GuardedRoleLocatorInput
): Promise<Locator> {
  const scope: RoleScope = input.scope ?? input.page;
  const expected = scope.getByRole(input.role, { name: input.name, exact: true });
  const timeout = input.timeoutMs ?? 5_000;
  try {
    await expected.waitFor({ state: "visible", timeout });
    if (await expected.count() !== 1) {
      throw new Error("authorized selector is not unique");
    }
    await expected.click({ trial: true, timeout });
    return expected;
  } catch {
    // The expected locator remains untouched. Observation below uses only the
    // same role and caller-supplied business container.
  }

  const expectedCount = await expected.count();
  const allRoleCandidates = scope.getByRole(input.role);
  const related: Array<{ name: string; actionable: boolean }> = [];
  for (let index = 0; index < await allRoleCandidates.count(); index += 1) {
    const candidate = allRoleCandidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const name = await boundedAccessibleName(candidate);
    if (!name || !selectorValuesRelated(input.name, name)) continue;
    const actionable = await candidate.click({ trial: true, timeout: Math.min(timeout, 2_000) })
      .then(() => true)
      .catch(() => false);
    related.push({ name, actionable });
  }
  const unique = related.length === 1 ? related[0] : undefined;
  const sideEffectProof = await input.runtime.selectorRepairSafety();
  const { reference } = await recordSelectorRepairIncident({
    snapshot: input.runtime.snapshot,
    caseId: input.caseId,
    attempt: input.runtime.attempt,
    sourcePath: input.sourcePath,
    selectorId: input.selectorId,
    candidateName: unique?.name,
    observedCandidateCount: related.length,
    candidateActionable: unique?.actionable === true,
    failureCode: expectedCount > 1
      ? "selector_not_unique"
      : unique && !unique.actionable
        ? "selector_not_actionable"
        : unique
          ? "accessible_name_drift"
          : "selector_not_found",
    sideEffectProof,
    dependentCaseIds: input.runtime.selectorRepairDependentCaseIds(),
    workspaceRoot: input.workspaceRoot
  });
  throw new FormalSelectorRepairError(reference);
}

export class FormalSelectorRepairError extends Error {
  constructor(readonly incident: FormalSelectorRepairIncidentReference) {
    super(
      incident.eligibility === "eligible"
        ? `Eligible selector drift recorded as ${incident.incidentId}; execution scope must be reopened.`
        : `Non-repairable selector failure recorded as ${incident.incidentId}.`
    );
    this.name = "FormalSelectorRepairError";
  }
}

async function boundedAccessibleName(locator: Locator): Promise<string | undefined> {
  const snapshot = await locator.ariaSnapshot({ timeout: 1_000 }).catch(() => "");
  const firstLine = snapshot.split(/\r?\n/u)[0] ?? "";
  const quoted = /^-\s+[^\s:]+\s+"((?:\\.|[^"])*)"/u.exec(firstLine)?.[1];
  if (quoted !== undefined) {
    try {
      const value = JSON.parse(`"${quoted}"`) as string;
      if (value.trim()) return bound(value);
    } catch {
      // Fall through to bounded attributes/text; never persist the snapshot.
    }
  }
  const ariaLabel = await locator.getAttribute("aria-label").catch(() => null);
  if (ariaLabel?.trim()) return bound(ariaLabel);
  const value = await locator.getAttribute("value").catch(() => null);
  if (value?.trim()) return bound(value);
  const text = await locator.innerText({ timeout: 1_000 }).catch(() => "");
  return text.trim() ? bound(text) : undefined;
}

function bound(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 120);
}
