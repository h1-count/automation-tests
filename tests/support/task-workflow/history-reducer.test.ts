import assert from "node:assert/strict";
import test from "node:test";
import {
  activitiesExpandedPayload,
  buildWorkflowDefinition,
  reduceWorkflow,
  workflowStartedPayload,
  type WorkflowEvent
} from "../../../src/support/task-workflow/index.js";

const workflow = buildWorkflowDefinition({
  requestId: "web/demo/current-history",
  planDigest: "a".repeat(64),
  planText: "当前 v1 工作流历史夹具。",
  capabilities: ["web"],
  casePackages: ["cases.md"]
});

function event(
  type: WorkflowEvent["type"],
  seq: number,
  payload: WorkflowEvent["payload"]
): WorkflowEvent {
  return {
    schemaVersion: "test-workflow-event-v1",
    eventId: `event-${seq}`,
    seq,
    runId: "run-current",
    requestId: workflow.requestId,
    definitionId: workflow.definitionId,
    definitionVersion: workflow.definitionVersion,
    type,
    occurredAt: "2026-08-27T00:00:00.000Z",
    actorType: "system",
    idempotencyKey: `event-${seq}`,
    payload,
    prevDigest: seq === 1 ? "0".repeat(64) : "1".repeat(64),
    digest: "2".repeat(64)
  };
}

function currentHistory(): WorkflowEvent[] {
  return [
    event("WorkflowStarted", 1, workflowStartedPayload(workflow)),
    event("ActivitiesExpanded", 2, activitiesExpandedPayload(workflow))
  ];
}

test("current v1 workflow history reduces without retired events", () => {
  assert.equal(reduceWorkflow(currentHistory()).workflowState, "RUNNING");
});

test("current v1 workflow history rejects an unsupported event type", () => {
  const history = currentHistory();
  history.push({ ...event("WorkflowSuspended", 3, { reason: "test" }), type: "unsupported-version" as never });
  assert.throws(() => reduceWorkflow(history), /Unsupported workflow event type/);
});

test("current v1 workflow history rejects a non-v1 definition", () => {
  const history = currentHistory();
  history[0] = { ...history[0]!, definitionVersion: "unsupported-version" };
  assert.throws(() => reduceWorkflow(history), /current v1 baseline/);
});
