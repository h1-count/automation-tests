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

/**
 * 需要在可见浏览器中由人工完成安全挑战（点选验证码、短信验证码输入）的用例：
 * 声明了 send_test_otp 或 authenticate_test_account 操作证据的用例一律要求 --headed，
 * 一次性凭据只由用户直接输入，不进入终端、Secret 或测试产物。
 */
export function interactiveOtpCaseIds(
  manifest: Pick<FormalExecutionManifest, "cases">,
  selectedCaseIds: readonly string[]
): string[] {
  const selected = new Set(selectedCaseIds);
  return manifest.cases.flatMap((definition) =>
    selected.has(definition.caseId)
    && definition.operationEvidence?.some((evidence) =>
      evidence.operation === "send_test_otp" || evidence.operation === "authenticate_test_account"
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
