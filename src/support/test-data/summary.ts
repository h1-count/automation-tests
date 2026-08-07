import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWrite } from "./ledgerStore.js";
import type { TestDataReportSummary, TestDataSummary, TestResourceRecord } from "./types.js";

export function buildSummary(runId: string, resources: TestResourceRecord[]): TestDataSummary {
  const cleanupFailed = resources.filter((resource) => resource.state === "cleanup_failed").length;
  const manualRequired = resources.filter((resource) => resource.state === "manual_required").length;
  const retained = resources.filter((resource) => resource.state === "retained").length;
  const reusableAvailable = resources.filter((resource) =>
    resource.reusable && resource.state === "available"
  ).length;
  const quarantined = resources.filter((resource) => resource.state === "quarantined").length;
  const retired = resources.filter((resource) => resource.state === "retired").length;
  const expiredResidual = resources.filter((resource) =>
    resource.state === "expired" || (resource.state === "retained" && Boolean(resource.expiresAt) && Date.parse(resource.expiresAt!) <= Date.now())
  ).length;
  const dataHygieneStatus = cleanupFailed > 0
    ? "cleanup_failed"
    : manualRequired > 0 || expiredResidual > 0 || quarantined > 0 || retired > 0
      ? "manual_required"
      : retained > 0
        ? "retained"
        : reusableAvailable > 0
          ? "reusable"
          : "clean";
  return {
    runId,
    totalResources: resources.length,
    created: resources.filter((resource) => resource.runId === runId).length,
    reused: resources.filter((resource) => resource.lease?.runId === runId && resource.runId !== runId).length,
    cleaned: resources.filter((resource) => resource.state === "cleaned").length,
    cleanupFailed,
    manualRequired,
    retained,
    reusableAvailable,
    quarantined,
    retired,
    expiredResidual,
    dirty: resources.filter((resource) => resource.dirty || resource.state === "dirty").length,
    dataHygieneStatus,
    resources: resources.map((resource) => ({
      resourceId: resource.resourceId,
      resourceType: resource.resourceType,
      state: resource.state,
      reusable: resource.reusable,
      cleanupActionId: resource.cleanupActionId,
      message: resource.stateHistory.at(-1)?.message
    }))
  };
}

export function isAcceptedTestDataSummary(summary: TestDataSummary): boolean {
  const cleaned = summary.resources.filter((resource) => resource.state === "cleaned").length;
  const retained = summary.resources.filter((resource) => resource.state === "retained").length;
  const reusableAvailable = summary.resources.filter((resource) =>
    resource.state === "available" && resource.reusable
  ).length;
  const expectedHygiene = retained > 0
    ? "retained"
    : reusableAvailable > 0
      ? "reusable"
      : "clean";
  return summary.totalResources === summary.resources.length
    && summary.cleaned === cleaned
    && summary.retained === retained
    && summary.reusableAvailable === reusableAvailable
    && summary.dataHygieneStatus === expectedHygiene
    && summary.cleanupFailed === 0
    && summary.manualRequired === 0
    && summary.quarantined === 0
    && summary.retired === 0
    && summary.expiredResidual === 0
    && summary.dirty === 0
    && summary.resources.every((resource) =>
      resource.state === "cleaned"
      || resource.state === "retained"
      || (resource.state === "available" && resource.reusable)
    );
}

export function sanitizeSummary(summary: TestDataSummary): TestDataReportSummary {
  return {
    ...summary,
    resources: summary.resources.map(({ resourceId, ...resource }) => ({
      ...resource,
      message: sanitizeMessage(resource.message, resourceId)
    })),
    hasResidualRisk: summary.cleanupFailed > 0
      || summary.manualRequired > 0
      || summary.retained > 0
      || summary.quarantined > 0
      || summary.retired > 0
      || summary.expiredResidual > 0
      || summary.dirty > 0
  };
}

export async function writeArtifactSummary(artifactRoot: string, summary: TestDataSummary): Promise<string> {
  const directory = resolve(artifactRoot, summary.runId);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "test-data-summary.json");
  await atomicWrite(path, sanitizeSummary(summary));
  return path;
}

function sanitizeMessage(message: string | undefined, resourceId: string): string | undefined {
  if (!message) {
    return undefined;
  }
  return /(token|secret|password|cookie|session|验证码|bearer)/i.test(message) || message.includes(resourceId)
    ? "敏感详情已脱敏"
    : message;
}
