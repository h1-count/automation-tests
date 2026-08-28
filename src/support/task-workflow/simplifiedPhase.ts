import type {
  ActivityProjection,
  WorkflowPhase,
  WorkflowProjection
} from "./types.js";

export const simplifiedPhaseIds = [
  "planning",
  "cases",
  "review",
  "engineering",
  "execution",
  "reporting"
] as const;

export type SimplifiedPhaseId = (typeof simplifiedPhaseIds)[number];
export type SimplifiedPhaseStatus =
  | "not_started"
  | "active"
  | "waiting"
  | "succeeded"
  | "failed";

export interface SimplifiedWaiting {
  reason: string;
  reference?: string;
}

export interface SimplifiedPhase {
  id: SimplifiedPhaseId;
  status: SimplifiedPhaseStatus;
  waiting?: SimplifiedWaiting;
}

export const currentUserPhaseIds = ["design", "engineering", "execution", "reporting"] as const;
export type CurrentUserPhaseId = (typeof currentUserPhaseIds)[number];
export interface CurrentUserPhase {
  id: CurrentUserPhaseId;
  status: SimplifiedPhaseStatus;
  waiting?: SimplifiedWaiting;
}

const phaseGroups: Record<SimplifiedPhaseId, readonly WorkflowPhase[]> = {
  planning: ["planning", "plan_confirmation"],
  cases: ["case_generation", "case_validation"],
  review: [
    "case_review",
    "initial_review",
    "review_resolution",
    "final_review",
    "case_confirmation"
  ],
  engineering: ["engineering", "script_review"],
  execution: ["execution_authorization", "execution"],
  reporting: ["reporting", "completion"]
};

const waitingStates = new Set([
  "WAITING_CALLBACK",
  "RETRY_WAIT",
  "RECONCILING",
  "BLOCKED",
  "FAILED"
]);

const activeStates = new Set(["READY", "RUNNING"]);

function activitiesFor(
  gate: WorkflowProjection,
  phaseId: SimplifiedPhaseId
): ActivityProjection[] {
  const phases = new Set(phaseGroups[phaseId]);
  return Object.values(gate.activities).filter((activity) =>
    phases.has(activity.definition.phase)
  );
}

function failedActivity(
  gate: WorkflowProjection,
  activity: ActivityProjection
): boolean {
  if (activity.state !== "CANCELLED") return false;
  return gate.workflowState === "CANCELLED"
    || activity.definition.activation === undefined;
}

function statusFor(
  gate: WorkflowProjection,
  activities: ActivityProjection[]
): SimplifiedPhaseStatus {
  if (!activities.length) return "not_started";
  if (activities.some((activity) => failedActivity(gate, activity))) {
    return "failed";
  }
  if (activities.some((activity) => waitingStates.has(activity.state))) {
    return "waiting";
  }
  if (activities.some((activity) => activeStates.has(activity.state))) {
    return "active";
  }
  if (activities.every((activity) =>
    activity.state === "SUCCEEDED"
    || (
      activity.state === "CANCELLED"
      && activity.definition.activation !== undefined
    )
  )) {
    return "succeeded";
  }
  if (activities.some((activity) => activity.state === "SUCCEEDED")) {
    return "active";
  }
  return "not_started";
}

function waitingFor(
  gate: WorkflowProjection,
  activities: ActivityProjection[]
): SimplifiedWaiting {
  const activityIds = new Set(activities.map((activity) => activity.id));
  const wait = gate.waits.find((candidate) =>
    candidate.activityId !== undefined
    && activityIds.has(candidate.activityId)
  );
  const currentGroup = new Set(
    phaseGroups[
      simplifiedPhaseIds.find((phaseId) =>
        phaseGroups[phaseId].includes(gate.phase)
      ) ?? "planning"
    ]
  );
  const isCurrentPhase = currentGroup.has(gate.phase)
    && activities.some((activity) => currentGroup.has(activity.definition.phase));
  if (isCurrentPhase) {
    return {
      reason: gate.continuation.reason,
      ...(gate.continuation.referenceId
        ? { reference: gate.continuation.referenceId }
        : {})
    };
  }
  return {
    reason: wait?.detail ?? wait?.kind ?? "waiting",
    ...(wait?.referenceId ?? wait?.activityId
      ? { reference: wait.referenceId ?? wait.activityId }
      : {})
  };
}

export function projectSimplifiedPhases(
  gate: WorkflowProjection
): SimplifiedPhase[] {
  return simplifiedPhaseIds.map((id) => {
    const activities = activitiesFor(gate, id);
    const status = statusFor(gate, activities);
    return {
      id,
      status,
      ...(status === "waiting"
        ? { waiting: waitingFor(gate, activities) }
        : {})
    };
  });
}

const currentPhaseGroups: Record<CurrentUserPhaseId, readonly WorkflowPhase[]> = {
  design: [
    "planning",
    "case_generation",
    "case_validation",
    "case_review",
    "initial_review",
    "review_resolution",
    "final_review",
    "case_confirmation"
  ],
  engineering: ["engineering", "script_review"],
  execution: ["execution_authorization", "execution"],
  reporting: ["reporting", "completion"]
};

export function projectCurrentUserPhases(gate: WorkflowProjection): CurrentUserPhase[] {
  return currentUserPhaseIds.map((id) => {
    const phases = new Set(currentPhaseGroups[id]);
    const activities = Object.values(gate.activities).filter((activity) =>
      phases.has(activity.definition.phase)
    );
    const status = statusFor(gate, activities);
    return {
      id,
      status,
      ...(status === "waiting" ? { waiting: waitingFor(gate, activities) } : {})
    };
  });
}
