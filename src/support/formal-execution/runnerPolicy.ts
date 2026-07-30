import { inspectFormalSpecSource } from "./sourceGate.js";
import type { ExecutionAuthorizationSnapshot } from "./authorization.js";
import type { WorkflowProjection } from "../task-workflow/types.js";

export type FormalWorkerCount = 1 | 2;

export function formalWorkerCount(
  projection: WorkflowProjection,
  authorization: Pick<ExecutionAuthorizationSnapshot, "dataWritePolicy">
): FormalWorkerCount {
  const configured = projection.activities.execute?.definition.metadata?.maxWorkers;
  return authorization.dataWritePolicy === "no_write" && configured === 2 ? 2 : 1;
}

export function parseFormalWorkerCount(value: string | undefined): FormalWorkerCount {
  if (value === undefined || value === "") return 1;
  if (value === "1" || value === "2") return Number(value) as FormalWorkerCount;
  throw new Error("PLAYWRIGHT_FORMAL_WORKERS must be 1 or 2.");
}

export function assertFormalSpecSources(
  sources: Array<{ path: string; source: string }>,
  expectedCaseIds: string[]
): void {
  if (!sources.length) throw new Error("Formal Runner found no formal spec sources.");
  const inspection = inspectFormalSpecSource(
    sources.map(({ path, source }) => `// ${path}\n${source}`).join("\n"),
    expectedCaseIds
  );
  if (inspection.issues.length) {
    throw new Error(`Formal source gate failed: ${inspection.issues.join(" ")}`);
  }
}
