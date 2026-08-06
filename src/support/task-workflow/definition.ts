import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import {
  workflowCapabilities,
  workflowPhases,
  type BuildWorkflowDefinitionInput,
  type ReviewPolicy,
  type SafeEventPayload,
  type SafeJsonValue,
  type WorkflowActivityDefinition,
  type WorkflowCapability,
  type WorkflowDefinition
} from "./types.js";
import { buildReviewPolicy, validateReviewPolicy } from "./reviewPolicy.js";

function stableSegment(value: string): string {
  const ascii = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii || createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function assertDigest(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest.`);
}

export function validateWorkflowDefinition(definition: WorkflowDefinition): void {
  assertDigest(definition.planDigest, "planDigest");
  assertDigest(definition.graphDigest, "graphDigest");
  if (!definition.requestId.trim() || !definition.definitionId.trim() || !definition.definitionVersion.trim()) {
    throw new Error("Workflow definition identity is incomplete.");
  }
  if (definition.reviewPolicy) validateReviewPolicy(definition.reviewPolicy);
  if (["v3", "v4", "v5"].includes(definition.definitionVersion) && !definition.reviewPolicy) {
    throw new Error("Workflow definition v3+ requires a pinned review policy.");
  }
  const ids = new Set<string>();
  for (const activity of definition.activities) {
    if (!activity.id.trim() || ids.has(activity.id)) throw new Error(`Duplicate or empty activity id: ${activity.id}`);
    ids.add(activity.id);
    if (!workflowPhases.includes(activity.phase)) throw new Error(`Unsupported phase for activity ${activity.id}.`);
    if (activity.concurrencyLimit !== undefined
      && (!Number.isInteger(activity.concurrencyLimit) || activity.concurrencyLimit < 1)) {
      throw new Error(`Activity ${activity.id} has an invalid concurrency limit.`);
    }
    if (activity.activation
      && (!activity.activation.activityId.trim() || !activity.activation.outcomes.length)) {
      throw new Error(`Activity ${activity.id} has an invalid branch activation.`);
    }
    if (activity.optionalDependencies?.some((dependency) => !activity.dependencies.includes(dependency))) {
      throw new Error(`Activity ${activity.id} has an optional dependency that is not a dependency.`);
    }
    if (activity.publishesArtifacts && (activity.kind === "callback" || activity.kind === "review")) {
      throw new Error(`Activity ${activity.id} cannot use artifact ActivitySucceeded semantics for ${activity.kind}.`);
    }
    if (activity.requiresExternalOperation && activity.concurrencyGroup !== "business_write") {
      throw new Error(
        `Activity ${activity.id} requires external operations but is not serialized as a business write.`
      );
    }
  }
  for (const activity of definition.activities) {
    for (const dependency of activity.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Activity ${activity.id} references missing dependency ${dependency}.`);
      if (dependency === activity.id) throw new Error(`Activity ${activity.id} cannot depend on itself.`);
    }
    if (activity.activation && !ids.has(activity.activation.activityId)) {
      throw new Error(`Activity ${activity.id} activation references missing activity ${activity.activation.activityId}.`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(definition.activities.map((activity) => [activity.id, activity]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Workflow definition contains a cycle at ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  const { graphDigest: _graphDigest, ...unsigned } = definition;
  const expectedGraphDigest = createHash("sha256")
    .update(canonicalJson(graphValue(unsigned)), "utf8")
    .digest("hex");
  if (expectedGraphDigest !== definition.graphDigest) {
    throw new Error("Workflow definition graphDigest does not match its pinned graph.");
  }
}

function graphValue(definition: Omit<WorkflowDefinition, "graphDigest">): SafeJsonValue {
  return {
    schemaVersion: definition.schemaVersion,
    definitionId: definition.definitionId,
    definitionVersion: definition.definitionVersion,
    requestId: definition.requestId,
    planDigest: definition.planDigest,
    capabilities: definition.capabilities,
    writesData: definition.writesData,
    ...(definition.reviewPolicy ? { reviewPolicy: definition.reviewPolicy } : {}),
    activities: definition.activities
  } as unknown as SafeJsonValue;
}

export function buildWorkflowDefinition(input: BuildWorkflowDefinitionInput): WorkflowDefinition {
  assertDigest(input.planDigest, "planDigest");
  const capabilities = unique(input.capabilities).sort() as WorkflowCapability[];
  if (!capabilities.length || capabilities.some((capability) => !workflowCapabilities.includes(capability))) {
    throw new Error("At least one supported workflow capability is required.");
  }
  const casePackages = unique(input.casePackages ?? []);
  if (
    !casePackages.length
    || casePackages.some((name) => !/^cases-[a-z0-9][a-z0-9-]*\.md$/.test(name))
  ) {
    throw new Error("At least one cases-*.md package filename is required.");
  }
  const reviewPolicy = buildReviewPolicy({
    reviewerRoles: input.reviewerRoles,
    writesData: input.writesData ?? false,
    ...(input.planText !== undefined
      ? {
          planText: input.planText,
          capabilities,
          casePackages
        }
      : {}),
    maxAttemptsPerRole: input.reviewPolicy?.maxAttemptsPerRole,
    maxUnchangedRevisionCycles: input.reviewPolicy?.maxUnchangedRevisionCycles,
    maxSemanticEvolutionCycles: input.reviewPolicy?.maxSemanticEvolutionCycles
  });
  const activities = buildV5Activities(
    capabilities,
    input.writesData ?? false,
    casePackages,
    reviewPolicy,
    input.executionIsolation
  );
  const base: Omit<WorkflowDefinition, "graphDigest"> = {
    schemaVersion: "test-workflow-definition-v1",
    definitionId: input.definitionId ?? "durable-test-workflow",
    definitionVersion: "v5",
    requestId: input.requestId,
    planDigest: input.planDigest,
    capabilities,
    writesData: input.writesData ?? false,
    reviewPolicy,
    activities
  };
  const definition: WorkflowDefinition = {
    ...base,
    graphDigest: createHash("sha256").update(canonicalJson(graphValue(base)), "utf8").digest("hex")
  };
  validateWorkflowDefinition(definition);
  return definition;
}

function baseActivities(casePackages: string[]): {
  activities: WorkflowActivityDefinition[];
  caseIds: string[];
} {
  const activities: WorkflowActivityDefinition[] = [
    { id: "source-selection", kind: "source_selection", phase: "planning", dependencies: [], required: true },
    {
      id: "plan-validation",
      kind: "plan_validation",
      phase: "planning",
      dependencies: ["source-selection"],
      required: true,
      publishesArtifacts: true
    },
    {
      id: "plan-confirmation",
      kind: "callback",
      phase: "plan_confirmation",
      dependencies: ["plan-validation"],
      required: true
    }
  ];
  const caseIds = casePackages.map((name) => `case-generation-${stableSegment(name)}`);
  casePackages.forEach((name, index) => activities.push({
    id: caseIds[index]!,
    kind: "case_generation",
    phase: "case_generation",
    dependencies: ["plan-confirmation"],
    required: true,
    publishesArtifacts: true,
    metadata: { package: name }
  }));
  activities.push(
    {
      id: "relation-sync",
      kind: "relation_sync",
      phase: "case_validation",
      dependencies: caseIds,
      required: true,
      publishesArtifacts: true
    },
    {
      id: "completeness-validation",
      kind: "completeness_validation",
      phase: "case_validation",
      dependencies: ["relation-sync"],
      required: true
    }
  );
  return { activities, caseIds };
}

function appendBuildReadinessAndExecution(
  activities: WorkflowActivityDefinition[],
  capabilities: WorkflowCapability[],
  writesData: boolean,
  caseConfirmationId: string,
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"]
): void {
  const capabilityContracts = Object.fromEntries(capabilities.map((capability) => [
    capability,
    capability === "web" || capability === "h5"
      ? {
          sourceContract: "source_first",
          headlessSelectorVerification: "cached_by_build_and_contract",
          visibleExploration: "fallback_only",
          runtime: "playwright"
        }
      : capability === "webview"
        ? {
            sourceContract: "source_first",
            headlessSelectorVerification: "cached_by_build_and_contract",
            visibleExploration: "fallback_only",
            runtime: "appium_web_context"
          }
        : capability === "app"
          ? { runtime: "appium", deviceValidation: true }
          : capability === "api"
            ? { runtime: "typescript_api" }
            : capability === "mqtt"
              ? { runtime: "mqtt_js" }
              : { runtime: "composite_iot" }
  ]));
  activities.push({
    id: "build",
    kind: "build",
    phase: "engineering",
    dependencies: [caseConfirmationId],
    required: true,
    publishesArtifacts: true,
    metadata: {
      capabilityContracts: capabilityContracts as unknown as SafeJsonValue,
      selectorEvidencePolicy: "source_first_cached",
      scriptReviewPolicyVersion: "script-review-policy-v3",
      inspectorTriggers: [
        "source_contract_unresolved",
        "runtime_uniqueness_failed",
        "source_runtime_drift",
        "dynamic_semantics"
      ],
      reviewPolicy: "risk_and_digest_scoped"
    }
  });
  activities.push(
    {
      id: "readiness",
      kind: "readiness",
      phase: "script_review",
      dependencies: ["build"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        outputArtifact: "execution-authorization.json",
        outputSchemaVersion: "execution-authorization-v4",
        readinessPolicyVersion: "execution-readiness-v1",
        zeroRunnablePolicy: "block_before_authorization"
      }
    },
    {
      id: "execution-authorization",
      kind: "execution_authorization",
      phase: "execution_authorization",
      dependencies: ["readiness"],
      required: true,
      metadata: {
        callbackSubjectArtifact: "execution-authorization.json",
        callbackSubjectFormat: "canonical_json_digest_v1",
        callbackSubjectSchemaVersion: "execution-authorization-v4",
        publisherActivityId: "readiness"
      }
    }
  );

  const deviceBoundCapability = capabilities.some((capability) => ["app", "webview", "iot"].includes(capability));
  const parallelExecutionEligible = !writesData
    && !deviceBoundCapability
    && executionIsolation?.contexts === true
    && executionIsolation.accounts === true
    && executionIsolation.data === true
    && executionIsolation.sharedAccount !== true;
  activities.push({
    id: "run",
    kind: "run",
    phase: "execution",
    dependencies: ["execution-authorization"],
    required: true,
    metadata: {
      maxWorkers: parallelExecutionEligible ? 2 : 1,
      transaction: [
        "capability_recheck",
        "lazy_setup",
        "case_execution",
        "postcondition_when_required",
        "finally_cleanup",
        "reconciliation"
      ],
      parallelEligibleOnlyWhen: ["contexts_isolated", "accounts_isolated", "data_isolated", "no_shared_account", "no_device_bound_capability"],
      parallelExecutionEligible
    },
    ...(writesData
      ? {
          requiresExternalOperation: true,
          concurrencyGroup: "business_write" as const,
          concurrencyLimit: 1
        }
      : {})
  });
  activities.push({
    id: "report",
    kind: "report",
    phase: "reporting",
    dependencies: ["run"],
    required: true,
    publishesArtifacts: true,
    metadata: {
      deterministic: true,
      outputs: ["run-summary.json", "execution-summary.md"],
      completesWorkflow: true
    }
  });
}

function buildV5Activities(
  capabilities: WorkflowCapability[],
  writesData: boolean,
  casePackages: string[],
  reviewPolicy: ReviewPolicy,
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"]
): WorkflowActivityDefinition[] {
  const { activities } = baseActivities(casePackages);
  const reviewIds = reviewPolicy.requiredRoles.map((role) => `case-review-${stableSegment(role)}`);
  reviewPolicy.requiredRoles.forEach((role, index) => activities.push({
    id: reviewIds[index]!,
    kind: "review",
    phase: "case_review",
    dependencies: ["completeness-validation"],
    required: true,
    concurrencyGroup: "reviewer",
    concurrencyLimit: reviewPolicy.maxConcurrentReviewers,
    metadata: { subflow: "case-review", role }
  }));
  activities.push(
    {
      id: "case-review-resolution",
      kind: "review_resolution",
      phase: "case_review",
      dependencies: reviewIds.length ? reviewIds : ["completeness-validation"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        subflow: "case-review",
        ...(reviewPolicy.schemaVersion === "review-policy-v2"
          && reviewPolicy.mode === "deterministic_only"
          ? { deterministicOnly: true }
          : {})
      }
    },
    {
      id: "case-review-conflict-decision",
      kind: "callback",
      phase: "case_review",
      dependencies: ["case-review-resolution"],
      required: true,
      activation: { activityId: "case-review-resolution", outcomes: ["human_conflict"] }
    },
    {
      id: "case-review-evolution",
      kind: "automatic_evolution",
      phase: "case_review",
      dependencies: ["case-review-resolution", "case-review-conflict-decision"],
      optionalDependencies: ["case-review-conflict-decision"],
      required: true,
      publishesArtifacts: true,
      activation: {
        activityId: "case-review-resolution",
        outcomes: ["evolve", "human_conflict", "plan_revision_required"]
      },
      metadata: { subflow: "case-review", repeatable: true }
    },
    {
      id: "case-confirmation",
      kind: "callback",
      phase: "case_confirmation",
      dependencies: ["case-review-resolution", "case-review-evolution"],
      optionalDependencies: ["case-review-evolution"],
      required: true,
      activation: { activityId: "case-review-resolution", outcomes: ["converged"] }
    }
  );
  appendBuildReadinessAndExecution(
    activities,
    capabilities,
    writesData,
    "case-confirmation",
    executionIsolation
  );
  return activities;
}

export function workflowStartedPayload(definition: WorkflowDefinition): SafeEventPayload {
  return { planDigest: definition.planDigest, graphDigest: definition.graphDigest };
}

export function activitiesExpandedPayload(definition: WorkflowDefinition): SafeEventPayload {
  return {
    planDigest: definition.planDigest,
    graphDigest: definition.graphDigest,
    capabilities: definition.capabilities,
    writesData: definition.writesData,
    ...(definition.reviewPolicy
      ? { reviewPolicy: definition.reviewPolicy as unknown as SafeJsonValue }
      : {}),
    activities: definition.activities as unknown as SafeJsonValue
  };
}
