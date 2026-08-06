import type { CleanupAction, TestResourceRecord, TestResourceState } from "./types.js";
import { localAutomationOwner } from "./types.js";

const sensitiveKeyPattern = /(password|passwd|token|secret|cookie|session|credential|private.?key|验证码|密钥)/i;
const sensitiveValuePattern = /(bearer\s+|password\s*[=:]|token\s*[=:]|secret\s*[=:]|cookie\s*[=:]|验证码|\b1\d{10}\b)/i;
const productionEnvironmentPattern = /(^|[-_])(?:prod|production|live)([-_]|$)/i;

export function assertNonProductionEnvironment(envId: string) {
  if (!envId.trim() || productionEnvironmentPattern.test(envId)) {
    throw new Error("Local test data lifecycle management is not allowed for production environments.");
  }
}

export function assertSafeMetadata(value: Record<string, unknown> = {}) {
  assertSafeUnknown(value, "metadata");
}

export function assertSafeText(value: string, field: string) {
  if (!value.trim() || sensitiveValuePattern.test(value)) {
    throw new Error(`${field} is empty or appears to contain sensitive data.`);
  }
}

export function isExpired(record: TestResourceRecord, now = new Date()): boolean {
  return Boolean(record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime());
}

export function assertOwnedByCurrentRunner(
  record: TestResourceRecord,
  scope: { projectId: string; envId?: string; machineId: string }
) {
  if (
    record.owner !== localAutomationOwner ||
    record.projectId !== scope.projectId ||
    record.machineId !== scope.machineId ||
    (scope.envId && record.envId !== scope.envId)
  ) {
    throw new Error("Resource is not owned by the current local automation runner.");
  }
  assertNonProductionEnvironment(record.envId);
}

export function assertCleanupAction(action: CleanupAction | undefined, record: TestResourceRecord): asserts action is CleanupAction {
  if (!action || !record.cleanupActionId || action.id !== record.cleanupActionId || action.resourceType !== record.resourceType) {
    throw new Error("No matching registered cleanup action exists for this local resource.");
  }
}

export function canTransition(from: TestResourceState, to: TestResourceState): boolean {
  const transitions: Record<TestResourceState, TestResourceState[]> = {
    registered: ["available", "retained", "quarantined", "retired", "manual_required"],
    available: ["leased", "cleanup_pending", "dirty", "expired", "retained", "quarantined", "retired", "manual_required"],
    leased: ["used", "available", "dirty", "cleanup_pending", "retained", "quarantined", "retired", "manual_required"],
    used: ["available", "dirty", "cleanup_pending", "retained", "quarantined", "retired", "manual_required"],
    dirty: ["available", "cleanup_pending", "retained", "quarantined", "retired", "manual_required"],
    cleanup_pending: ["cleaning", "manual_required"],
    cleaning: ["cleaned", "cleanup_failed", "manual_required"],
    cleaned: ["retired"],
    cleanup_failed: ["cleanup_pending", "cleaning", "manual_required"],
    manual_required: ["cleanup_pending", "cleaning"],
    retained: ["cleanup_pending", "expired", "quarantined", "retired", "manual_required"],
    quarantined: ["available", "cleanup_pending", "retained", "retired", "manual_required"],
    retired: ["cleanup_pending", "retained", "manual_required"],
    expired: ["cleanup_pending", "quarantined", "retired", "manual_required"]
  };
  return transitions[from].includes(to);
}

function assertSafeUnknown(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (sensitiveValuePattern.test(value)) {
      throw new Error(`${path} appears to contain sensitive data.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeUnknown(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (sensitiveKeyPattern.test(key)) {
        throw new Error(`${path}.${key} is a prohibited sensitive field.`);
      }
      assertSafeUnknown(item, `${path}.${key}`);
    }
  }
}
