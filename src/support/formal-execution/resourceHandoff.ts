import { localAutomationOwner, type TestResourceRecord } from "../test-data/types.js";

export function assertLocalResourceHandoff(input: {
  resource: TestResourceRecord | null;
  runId: string;
  caseId?: string;
  projectId: string;
  environment: string;
  expectedResourceType?: string;
}): TestResourceRecord {
  const resource = input.resource;
  if (
    !resource
    || resource.owner !== localAutomationOwner
    || resource.runId !== input.runId
    || (input.caseId !== undefined && resource.caseId !== input.caseId)
    || resource.projectId !== input.projectId
    || resource.envId !== input.environment
  ) {
    throw new Error("Formal resource handoff accepts only a resource owned by the current authorized run.");
  }
  if (input.expectedResourceType && resource.resourceType !== input.expectedResourceType) {
    throw new Error("Formal resource handoff type differs from the immutable manifest.");
  }
  return resource;
}
