import {
  inspectFormalSpecSources,
  type FormalSpecInspectionOptions
} from "./sourceGate.js";
import type { ExecutionAuthorizationSnapshot } from "./authorization.js";
import type { FormalExecutionManifest } from "./types.js";
import type { WorkflowProjection } from "../task-workflow/types.js";

export type FormalWorkerCount = 1 | 2;

export function formalWorkerCount(
  projection: WorkflowProjection,
  authorization: Pick<ExecutionAuthorizationSnapshot, "dataWritePolicy" | "caseScopes">
): FormalWorkerCount {
  const configured = (
    projection.activities.run
    ?? projection.activities.execute
  )?.definition.metadata?.maxWorkers;
  const allReadOnly = authorization.caseScopes?.length
    ? authorization.caseScopes.every((scope) => scope.permissionProfile === "read_only")
    : authorization.dataWritePolicy === "no_write";
  return allReadOnly && configured === 2 ? 2 : 1;
}

export function parseFormalWorkerCount(value: string | undefined): FormalWorkerCount {
  if (value === undefined || value === "") return 1;
  if (value === "1" || value === "2") return Number(value) as FormalWorkerCount;
  throw new Error("PLAYWRIGHT_FORMAL_WORKERS must be 1 or 2.");
}

export function interactiveOtpCaseIds(
  manifest: Pick<FormalExecutionManifest, "cases">,
  selectedCaseIds: readonly string[]
): string[] {
  const selected = new Set(selectedCaseIds);
  return manifest.cases.flatMap((definition) =>
    selected.has(definition.caseId)
    && definition.operationEvidence?.some((evidence) =>
      evidence.operation === "send_test_otp" && evidence.strategy === "ui_state"
    )
      ? [definition.caseId]
      : []
  ).sort();
}

export function assertFormalSpecSources(
  sources: Array<{ path: string; source: string }>,
  expectedCaseIds: string[],
  options: FormalSpecInspectionOptions = {}
): void {
  if (!sources.length) throw new Error("Formal Runner found no formal spec sources.");
  const inspection = inspectFormalSpecSources(sources, expectedCaseIds, options);
  if (inspection.issues.length) {
    throw new Error(`Formal source gate failed: ${inspection.issues.join(" ")}`);
  }
}
