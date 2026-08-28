import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalResourceHandoff } from "../../../src/support/formal-execution/resourceHandoff.js";
import { localAutomationOwner, type TestResourceRecord } from "../../../src/support/test-data/types.js";

test("resource handoff accepts only the current run, project, environment and producer", () => {
  const resource = record();
  assert.doesNotThrow(() => assertLocalResourceHandoff({
    resource,
    runId: "run-current",
    caseId: "CREATE",
    projectId: "example",
    environment: "test",
    expectedResourceType: "tenant"
  }));
  for (const mutation of [
    { runId: "other-run" },
    { caseId: "OTHER" },
    { projectId: "other-project" },
    { environment: "staging" },
    { expectedResourceType: "device" }
  ]) {
    assert.throws(() => assertLocalResourceHandoff({
      resource,
      runId: "run-current",
      caseId: "CREATE",
      projectId: "example",
      environment: "test",
      expectedResourceType: "tenant",
      ...mutation
    }), /Formal resource handoff/);
  }
});

function record(): TestResourceRecord {
  const now = "2026-08-05T00:00:00.000Z";
  return {
    resourceId: "synthetic-tenant",
    resourceType: "tenant",
    owner: localAutomationOwner,
    projectId: "example",
    envId: "test",
    machineId: "machine",
    runId: "run-current",
    caseId: "CREATE",
    state: "registered",
    reusable: false,
    dirty: false,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    leases: [],
    reuseCount: 0,
    stateHistory: [{ state: "registered", at: now }]
  };
}
