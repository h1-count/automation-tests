import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSimplifiedPhases
} from "../../../src/support/task-workflow/simplifiedPhase.js";
import type {
  ActivityProjection,
  ActivityState,
  WorkflowPhase,
  WorkflowProjection,
  WorkflowState,
  WorkflowWait
} from "../../../src/support/task-workflow/types.js";

function activity(
  id: string,
  phase: WorkflowPhase,
  state: ActivityState,
  conditional = false
): ActivityProjection {
  return {
    id,
    definition: {
      id,
      kind: "verify",
      phase,
      dependencies: [],
      required: true,
      ...(conditional
        ? { activation: { activityId: "decision", outcomes: ["selected"] } }
        : {})
    },
    state,
    attempt: 0,
    blockerIds: [],
    unresolvedExternalOperationIds: []
  };
}

function gate(input: {
  phase: WorkflowPhase;
  workflowState?: WorkflowState;
  activities: ActivityProjection[];
  waits?: WorkflowWait[];
  continuation?: WorkflowProjection["continuation"];
}): WorkflowProjection {
  return {
    runId: "run-1",
    requestId: "web/demo/request",
    definitionId: "durable-test-workflow",
    definitionVersion: "v1",
    graphDigest: "a".repeat(64),
    planDigest: "b".repeat(64),
    requestPolicy: {
      schemaVersion: "request-policy-v1",
      reuseDecision: "full_replan",
      deliveryTarget: "testcase_only",
      reviewSpeed: "strict",
      reviewMode: "combined",
      riskProfile: "strict",
      writesData: false,
      selectedCaseIds: []
    },
    head: { seq: 1, digest: "c".repeat(64) },
    workflowState: input.workflowState ?? "RUNNING",
    phase: input.phase,
    activities: Object.fromEntries(input.activities.map((item) => [item.id, item])),
    readyActivities: input.activities
      .filter((item) => item.state === "READY")
      .map((item) => item.id),
    runningActivities: input.activities
      .filter((item) => item.state === "RUNNING")
      .map((item) => item.id),
    waits: input.waits ?? [],
    nextActions: [],
    continuation: input.continuation ?? {
      kind: "continue_now",
      reason: "ready_activity_available"
    },
    reply: {
      kind: "none",
      allowed: false,
      reason: "automatic_work_remaining"
    }
  };
}

function statuses(view: ReturnType<typeof projectSimplifiedPhases>) {
  return Object.fromEntries(view.map((phase) => [phase.id, phase.status]));
}

test("projects normal progress without changing detailed activity state", () => {
  const source = activity("source-selection", "planning", "SUCCEEDED");
  const planConfirmation = activity(
    "plan-confirmation",
    "plan_confirmation",
    "SUCCEEDED"
  );
  const caseGeneration = activity(
    "case-generation-cases-main-md",
    "case_generation",
    "RUNNING"
  );
  const review = activity("case-review-requirements", "case_review", "PENDING");
  const engineering = activity("engineering-web", "engineering", "PENDING");
  const execution = activity("execute", "execution", "PENDING");
  const reporting = activity("report", "reporting", "PENDING");
  const projection = projectSimplifiedPhases(gate({
    phase: "case_generation",
    activities: [
      source,
      planConfirmation,
      caseGeneration,
      review,
      engineering,
      execution,
      reporting
    ]
  }));

  assert.deepEqual(statuses(projection), {
    planning: "succeeded",
    cases: "active",
    review: "not_started",
    engineering: "not_started",
    execution: "not_started",
    reporting: "not_started"
  });
  assert.equal(caseGeneration.state, "RUNNING");
});

test("preserves callback waiting reason and reference", () => {
  const projection = projectSimplifiedPhases(gate({
    phase: "plan_confirmation",
    workflowState: "WAITING_HUMAN",
    activities: [
      activity("source-selection", "planning", "SUCCEEDED"),
      activity("plan-confirmation", "plan_confirmation", "WAITING_CALLBACK")
    ],
    waits: [{
      kind: "human",
      activityId: "plan-confirmation",
      referenceId: "callback-plan-1"
    }],
    continuation: {
      kind: "wait_user",
      referenceId: "callback-plan-1",
      reason: "waiting_human"
    }
  }));

  assert.deepEqual(projection[0], {
    id: "planning",
    status: "waiting",
    waiting: {
      reason: "waiting_human",
      reference: "callback-plan-1"
    }
  });
});

test("projects reconciliation as waiting with its durable continuation", () => {
  const projection = projectSimplifiedPhases(gate({
    phase: "execution",
    workflowState: "RECONCILING",
    activities: [
      activity("execution-authorization", "execution_authorization", "SUCCEEDED"),
      activity("execute", "execution", "RECONCILING")
    ],
    waits: [{ kind: "reconciliation", activityId: "execute" }],
    continuation: {
      kind: "continue_now",
      referenceId: "execute",
      reason: "reconciliation_required"
    }
  }));

  assert.deepEqual(projection[4], {
    id: "execution",
    status: "waiting",
    waiting: {
      reason: "reconciliation_required",
      reference: "execute"
    }
  });
});

test("projects recoverable failures as waiting and cancelled activities as failed", () => {
  const failed = projectSimplifiedPhases(gate({
    phase: "engineering",
    workflowState: "BLOCKED",
    activities: [
      activity("engineering-web", "engineering", "FAILED"),
      activity("execute", "execution", "PENDING")
    ],
    waits: [{ kind: "recovery", activityId: "engineering-web", referenceId: "engineering-web" }],
    continuation: { kind: "wait_user", reason: "blocked", referenceId: "engineering-web" }
  }));
  assert.equal(failed[3]?.status, "waiting");

  const cancelled = projectSimplifiedPhases(gate({
    phase: "execution",
    workflowState: "CANCELLED",
    activities: [
      activity("case-review-evolution", "case_review", "CANCELLED", true),
      activity("execute", "execution", "CANCELLED")
    ],
    continuation: { kind: "stop", reason: "workflow_terminal" }
  }));
  assert.equal(cancelled[2]?.status, "failed");
  assert.equal(cancelled[4]?.status, "failed");
});

test("treats an inactive conditional branch as successful, not failed", () => {
  const projection = projectSimplifiedPhases(gate({
    phase: "engineering",
    activities: [
      activity("case-review-resolution", "case_review", "SUCCEEDED"),
      activity("case-review-evolution", "case_review", "CANCELLED", true),
      activity("case-confirmation", "case_confirmation", "SUCCEEDED"),
      activity("engineering-web", "engineering", "READY")
    ]
  }));

  assert.equal(projection[2]?.status, "succeeded");
  assert.equal(projection[3]?.status, "active");
});
