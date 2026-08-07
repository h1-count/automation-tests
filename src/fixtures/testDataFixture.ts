import { test as base } from "@playwright/test";
import { CleanupActionRegistry } from "../support/test-data/cleanupRegistry.js";
import { TestDataManager } from "../support/test-data/testDataManager.js";
import { isAcceptedTestDataSummary } from "../support/test-data/summary.js";
import type {
  DataWritePolicy,
  ResourceValidator,
  ResourceLeaseMode,
  TestResourceType,
  TestRunStatus
} from "../support/test-data/types.js";

export interface TestDataFixtureOptions {
  projectId: string;
  envId: string;
  suiteId?: string;
  cleanupRegistry: CleanupActionRegistry;
  resourceValidator?: ResourceValidator;
  resourceValidators?: Record<string, ResourceValidator>;
  dataWritePolicy: DataWritePolicy;
  authorizationDigest: string;
  writeBudget: Partial<Record<TestResourceType, number>>;
  residualTtlHours?: number;
}

export function createTestDataFixture(options: TestDataFixtureOptions) {
  return base.extend<{ testData: { manager: TestDataManager; runId: string } }>({
    testData: async ({}, use, testInfo) => {
      const manager = new TestDataManager({
        projectId: options.projectId,
        envId: options.envId,
        cleanupRegistry: options.cleanupRegistry,
        resourceValidator: options.resourceValidator,
        resourceValidators: options.resourceValidators
      });
      const run = await manager.startRun({
        projectId: options.projectId,
        envId: options.envId,
        suiteId: options.suiteId ?? testInfo.file,
        caseIds: extractCaseIds(testInfo.title),
        dataWritePolicy: options.dataWritePolicy,
        authorizationDigest: options.authorizationDigest,
        writeBudget: options.writeBudget,
        residualTtlHours: options.residualTtlHours
      });
      let runStatus: TestRunStatus = "passed";
      try {
        await use({ manager, runId: run.runId });
        if (testInfo.status !== testInfo.expectedStatus) {
          runStatus = "failed";
        }
      } catch (error) {
        runStatus = "failed";
        throw error;
      } finally {
        const summary = await manager.cleanupRun(run.runId);
        if (isAcceptedTestDataSummary(summary)) {
          await manager.endRun(
            run.runId,
            runStatus,
            runStatus === "failed" ? "failed" : "passed"
          );
        }
        await testInfo.attach("test-data-summary", {
          path: `artifacts/test-results/${run.runId}/test-data-summary.json`,
          contentType: "application/json"
        });
      }
    }
  });
}

export type ReusableFixtureLease = {
  resourceType: TestResourceType;
  baselineContractId: string;
  leaseMode: ResourceLeaseMode;
};

function extractCaseIds(title: string): string[] {
  return [...new Set(title.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g) ?? [])];
}
