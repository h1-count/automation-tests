import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import {
  workflowCapabilities,
  workflowDeliveryTargets,
  workflowPhases,
  type BuildWorkflowDefinitionInput,
  type ReusableWorkflowDefinitionInput,
  type ReviewPolicy,
  type SafeEventPayload,
  type SafeJsonValue,
  type WorkflowActivityDefinition,
  type WorkflowCapability,
  type WorkflowDeliveryTarget,
  type WorkflowDefinition
} from "./types.js";
import {
  buildAdaptiveReviewPolicy,
  buildReviewPolicy,
  validateReviewPolicy
} from "./reviewPolicy.js";
import type { CandidateFragmentModule } from "./candidateFragments.js";

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
  if (["v3", "v4", "v5", "v6", "v7", "v8", "v9"].includes(definition.definitionVersion) && !definition.reviewPolicy) {
    throw new Error("Workflow definition v3+ requires a pinned review policy.");
  }
  if (definition.deliveryTarget !== undefined
    && !workflowDeliveryTargets.includes(definition.deliveryTarget)) {
    throw new Error(`Unsupported workflow delivery target: ${definition.deliveryTarget}`);
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
  const expectedGraphDigest = workflowGraphDigest(unsigned);
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
    ...(definition.deliveryTarget ? { deliveryTarget: definition.deliveryTarget } : {}),
    ...(definition.reviewPolicy ? { reviewPolicy: definition.reviewPolicy } : {}),
    activities: definition.activities
  } as unknown as SafeJsonValue;
}

export function workflowGraphDigest(definition: Omit<WorkflowDefinition, "graphDigest">): string {
  return createHash("sha256").update(canonicalJson(graphValue(definition)), "utf8").digest("hex");
}

export function buildWorkflowDefinition(input: BuildWorkflowDefinitionInput): WorkflowDefinition {
  assertDigest(input.planDigest, "planDigest");
  const capabilities = unique(input.capabilities).sort() as WorkflowCapability[];
  if (!capabilities.length || capabilities.some((capability) => !workflowCapabilities.includes(capability))) {
    throw new Error("At least one supported workflow capability is required.");
  }
  const casePackages = unique(input.casePackages ?? []);
  if (!casePackages.length || casePackages.some((name) =>
    name !== "cases.md" && !/^cases-[a-z0-9][a-z0-9-]*\.md$/.test(name)
  )) {
    throw new Error("At least one cases.md or cases-*.md package filename is required.");
  }
  const optimizedV3 = input.planText?.includes("rule-design-ledger-v3") === true;
  const fragmented = optimizedV3 && input.fragmented === true;
  const reviewPolicy = optimizedV3 ? buildAdaptiveReviewPolicy() : buildReviewPolicy({
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
  const deliveryTarget = input.deliveryTarget ?? "full_run";
  const activities = fragmented ? buildV8FullBootstrapActivities() : buildV7FullActivities(
    capabilities,
    input.writesData ?? false,
    casePackages,
    reviewPolicy,
    deliveryTarget,
    input.executionIsolation,
    optimizedV3
  );
  const base: Omit<WorkflowDefinition, "graphDigest"> = {
    schemaVersion: "test-workflow-definition-v1",
    definitionId: input.definitionId ?? "durable-test-workflow",
    definitionVersion: fragmented ? "v8" : "v7",
    requestId: input.requestId,
    planDigest: input.planDigest,
    capabilities,
    writesData: input.writesData ?? false,
    deliveryTarget,
    reviewPolicy,
    activities
  };
  const definition: WorkflowDefinition = {
    ...base,
    graphDigest: workflowGraphDigest(base)
  };
  validateWorkflowDefinition(definition);
  return definition;
}

/** Builds the pinned legacy graph for replay/compatibility tests. New requests
 * must use buildWorkflowDefinition and therefore start on v7. */
export function buildLegacyV5WorkflowDefinition(
  input: BuildWorkflowDefinitionInput
): WorkflowDefinition {
  // The compatibility graph is used only to replay and verify archived event
  // semantics. Do not let the current document marker switch its reviewer
  // topology to the v7 risk-adaptive design.
  const current = buildWorkflowDefinition({ ...input, planText: undefined });
  const reviewPolicy = buildReviewPolicy({
    reviewerRoles: input.reviewerRoles,
    writesData: input.writesData ?? false,
    ...(input.planText !== undefined
      ? {
          planText: input.planText,
          capabilities: current.capabilities,
          casePackages: unique(input.casePackages ?? [])
        }
      : {})
  });
  const activities = buildV5Activities(
    current.capabilities,
    current.writesData,
    unique(input.casePackages ?? []),
    reviewPolicy,
    input.executionIsolation
  );
  const {
    graphDigest: _currentGraphDigest,
    deliveryTarget: _currentDeliveryTarget,
    ...currentUnsigned
  } = current;
  const base: Omit<WorkflowDefinition, "graphDigest"> = {
    ...currentUnsigned,
    definitionVersion: "v5",
    reviewPolicy,
    activities
  };
  const definition = {
    ...base,
    graphDigest: createHash("sha256").update(canonicalJson(graphValue(base)), "utf8").digest("hex")
  };
  validateWorkflowDefinition(definition);
  return definition;
}

export function buildReusableWorkflowDefinition(
  input: ReusableWorkflowDefinitionInput
): WorkflowDefinition {
  assertDigest(input.planDigest, "planDigest");
  assertDigest(input.reuseAssessment.assessmentDigest, "assessmentDigest");
  if (input.reuseAssessment.suiteVersion) {
    assertDigest(input.reuseAssessment.suiteVersion, "suiteVersion");
  }
  const capabilities = unique(input.capabilities).sort() as WorkflowCapability[];
  if (!capabilities.length || capabilities.some((capability) => !workflowCapabilities.includes(capability))) {
    throw new Error("At least one supported workflow capability is required.");
  }
  const casePackages = unique(input.casePackages ?? []);
  if (!casePackages.length || casePackages.some((name) =>
    name !== "cases.md" && !/^cases-[a-z0-9][a-z0-9-]*\.md$/.test(name)
  )) {
    throw new Error("At least one cases.md or cases-*.md package filename is required.");
  }
  const optimizedV3 = input.planText?.includes("rule-design-ledger-v3") === true;
  const fragmented = optimizedV3 && input.fragmented === true;
  const reviewPolicy = optimizedV3 ? buildAdaptiveReviewPolicy() : buildReviewPolicy({
    reviewerRoles: input.reviewerRoles,
    writesData: input.writesData ?? false,
    ...(input.planText !== undefined
      ? { planText: input.planText, capabilities, casePackages }
      : {}),
    maxAttemptsPerRole: input.reviewPolicy?.maxAttemptsPerRole,
    maxUnchangedRevisionCycles: input.reviewPolicy?.maxUnchangedRevisionCycles,
    maxSemanticEvolutionCycles: input.reviewPolicy?.maxSemanticEvolutionCycles
  });
  const deliveryTarget = input.deliveryTarget ?? "full_run";
  const v9ZeroModelReuse = input.reuseProtocol === "v9"
    && ["direct_execute", "design_reconfirm"].includes(input.reuseAssessment.decision);
  const v9AffectedReuse = input.reuseProtocol === "v9"
    && input.reuseAssessment.decision === "affected_rebuild";
  const v9FullReplan = input.reuseProtocol === "v9"
    && input.reuseAssessment.decision === "full_replan";
  const activities = v9ZeroModelReuse
    ? buildV9ZeroModelReuseActivities(
        capabilities,
        input.writesData ?? false,
        casePackages,
        input.reuseAssessment,
        deliveryTarget,
        input.executionIsolation
      )
    : v9AffectedReuse
      ? buildV9AffectedBootstrapActivities(input.reuseAssessment)
      : v9FullReplan
        ? buildV9FullReplanBootstrapActivities(input.reuseAssessment)
      : fragmented
    && ["full_replan", "affected_rebuild"].includes(input.reuseAssessment.decision)
    ? buildV8ReusableBootstrapActivities(input.reuseAssessment)
    : buildV7ReusableActivities(
    capabilities,
    input.writesData ?? false,
    casePackages,
    reviewPolicy,
    input.reuseAssessment,
    deliveryTarget,
    input.executionIsolation,
    optimizedV3
  );
  const base: Omit<WorkflowDefinition, "graphDigest"> = {
    schemaVersion: "test-workflow-definition-v1",
    definitionId: input.definitionId ?? "durable-test-workflow",
    definitionVersion: v9ZeroModelReuse || v9AffectedReuse || v9FullReplan
      ? "v9"
      : fragmented && ["full_replan", "affected_rebuild"].includes(input.reuseAssessment.decision)
        ? "v8"
        : "v7",
    requestId: input.requestId,
    planDigest: input.planDigest,
    capabilities,
    writesData: input.writesData ?? false,
    deliveryTarget,
    reviewPolicy,
    activities
  };
  const definition: WorkflowDefinition = {
    ...base,
    graphDigest: workflowGraphDigest(base)
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
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"],
  adaptiveAuthorization = false
): void {
  const capabilityContracts = Object.fromEntries(capabilities.map((capability) => [
    capability,
    capability === "web" || capability === "h5"
      ? {
          sourceContract: "runtime_first_source_supplement",
          browserExploration: {
            adapter: "chrome_devtools_mcp",
            policy: "preferred_when_eligible",
            mode: "read_only",
            availability: "optional",
            evidence: "candidate_only"
          },
          headlessSelectorVerification: "required_for_runtime_verified",
          visibleExploration: "playwright_guarded_fallback",
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
      selectorEvidencePolicy: "mcp_candidate_playwright_verified",
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
        decisionMode: adaptiveAuthorization ? "risk_adaptive" : "user_confirmed",
        ...(adaptiveAuthorization
          ? { policyVersion: "policy_auto_no_write_v2" }
          : {}),
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
      completionContract: "formal-execution-completion-seal-v1",
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
      completionContract: "formal-execution-completion-seal-v1",
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

function buildV6Activities(
  capabilities: WorkflowCapability[],
  writesData: boolean,
  casePackages: string[],
  reviewPolicy: ReviewPolicy,
  reuseAssessment: ReusableWorkflowDefinitionInput["reuseAssessment"],
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"]
): WorkflowActivityDefinition[] {
  const fullActivities = buildV5Activities(
    capabilities,
    writesData,
    casePackages,
    reviewPolicy,
    executionIsolation
  ).filter((activity) => !["readiness", "execution-authorization", "run", "report"].includes(activity.id));
  const sourceSelection = fullActivities.find((activity) => activity.id === "source-selection")!;
  sourceSelection.dependencies = ["reuse-assessment"];
  const suiteMetadata = {
    suiteId: reuseAssessment.suiteId,
    ...(reuseAssessment.suiteVersion ? { suiteVersion: reuseAssessment.suiteVersion } : {}),
    assessmentDigest: reuseAssessment.assessmentDigest,
    requestedProfile: reuseAssessment.requestedProfile,
    effectiveProfile: reuseAssessment.effectiveProfile,
    selectedCaseIds: reuseAssessment.selectedCaseIds,
    affectedCaseIds: reuseAssessment.affectedCaseIds
  } as Record<string, SafeJsonValue>;
  const assessmentActivity: WorkflowActivityDefinition = {
      id: "reuse-assessment",
      kind: "reuse_assessment",
      phase: "reuse_assessment",
      dependencies: [],
      required: true,
      metadata: {
        ...suiteMetadata,
        schemaVersion: reuseAssessment.schemaVersion,
        decision: reuseAssessment.decision
      }
    };
  const directActivities: WorkflowActivityDefinition[] = [{
      id: "suite-validation",
      kind: "suite_validation",
      phase: "engineering",
      dependencies: ["reuse-assessment"],
      required: true,
      metadata: suiteMetadata
    }];
  const affectedActivities: WorkflowActivityDefinition[] = [{
      id: "impact-location",
      kind: "impact_location",
      phase: "engineering",
      dependencies: ["reuse-assessment"],
      required: true,
      metadata: suiteMetadata
    },
    {
      id: "targeted-evolution",
      kind: "engineering",
      phase: "engineering",
      dependencies: ["impact-location"],
      required: true,
      publishesArtifacts: true,
      metadata: { ...suiteMetadata, scope: "affected_only" }
    },
    {
      id: "targeted-review",
      kind: "review",
      phase: "script_review",
      dependencies: ["targeted-evolution"],
      required: true,
      concurrencyGroup: "reviewer",
      concurrencyLimit: 1,
      metadata: { ...suiteMetadata, subflow: "affected-rebuild", role: "combined" }
    }];
  const branchActivities = reuseAssessment.decision === "direct_execute"
    ? directActivities
    : reuseAssessment.decision === "affected_rebuild"
      ? affectedActivities
      : fullActivities;
  const branchTail = reuseAssessment.decision === "direct_execute"
    ? "suite-validation"
    : reuseAssessment.decision === "affected_rebuild"
      ? "targeted-review"
      : "build";
  const usesStableSuiteAuthorization = reuseAssessment.decision === "direct_execute";
  const authorizationSchemaVersion = usesStableSuiteAuthorization
    ? "execution-authorization-v5"
    : "execution-authorization-v4";
  const authorizationKind = usesStableSuiteAuthorization && !writesData
    ? "policy_authorization"
    : "execution_authorization";
  const activities: WorkflowActivityDefinition[] = [
    assessmentActivity,
    ...branchActivities,
    {
      id: "readiness",
      kind: "readiness",
      phase: "script_review",
      dependencies: [branchTail],
      required: true,
      publishesArtifacts: true,
      metadata: {
        ...suiteMetadata,
        outputArtifact: "execution-authorization.json",
        outputSchemaVersion: authorizationSchemaVersion,
        readinessPolicyVersion: "execution-readiness-v1",
        zeroRunnablePolicy: "block_before_authorization"
      }
    },
    {
      id: "execution-authorization",
      kind: authorizationKind,
      phase: "execution_authorization",
      dependencies: ["readiness"],
      required: true,
      metadata: {
        ...suiteMetadata,
        decisionMode: authorizationKind === "policy_authorization"
          ? "policy_auto_no_write"
          : "user_confirmed",
        callbackSubjectArtifact: "execution-authorization.json",
        callbackSubjectFormat: "canonical_json_digest_v1",
        callbackSubjectSchemaVersion: authorizationSchemaVersion,
        publisherActivityId: "readiness"
      }
    },
    {
      id: "run",
      kind: "run",
      phase: "execution",
      dependencies: ["execution-authorization"],
      required: true,
      metadata: {
        ...suiteMetadata,
        completionContract: "formal-execution-completion-seal-v1",
        maxWorkers: 1,
        transaction: [
          "capability_recheck",
          "lazy_setup",
          "case_execution",
          "postcondition_when_required",
          "finally_cleanup",
          "reconciliation"
        ]
      },
      ...(writesData
        ? {
            requiresExternalOperation: true,
            concurrencyGroup: "business_write" as const,
            concurrencyLimit: 1
          }
        : {})
    },
    {
      id: "report",
      kind: "report",
      phase: "reporting",
      dependencies: ["run"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        ...suiteMetadata,
        completionContract: "formal-execution-completion-seal-v1",
        deterministic: true,
        outputs: ["run-summary.json", "execution-summary.md"],
        completesWorkflow: true
      }
    }
  ];
  return activities;
}

function v7DesignActivities(
  casePackages: string[],
  reviewPolicy: ReviewPolicy
): WorkflowActivityDefinition[] {
  const activities: WorkflowActivityDefinition[] = [
    {
      id: "source-selection",
      kind: "source_selection",
      phase: "planning",
      dependencies: [],
      required: true
    },
    {
      id: "plan-validation",
      kind: "plan_validation",
      phase: "planning",
      dependencies: ["source-selection"],
      required: true,
      publishesArtifacts: true
    }
  ];
  const caseIds = casePackages.map((name) => `case-generation-${stableSegment(name)}`);
  casePackages.forEach((name, index) => activities.push({
    id: caseIds[index]!,
    kind: "case_generation",
    phase: "case_generation",
    dependencies: ["plan-validation"],
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
      id: "case-review-evolution",
      kind: "automatic_evolution",
      phase: "case_review",
      dependencies: ["case-review-resolution"],
      required: true,
      publishesArtifacts: true,
      activation: { activityId: "case-review-resolution", outcomes: ["evolve"] },
      metadata: { subflow: "case-review", repeatable: true }
    },
    {
      id: "case-confirmation",
      kind: "callback",
      phase: "case_confirmation",
      dependencies: ["case-review-resolution", "case-review-evolution"],
      optionalDependencies: ["case-review-evolution"],
      required: true,
      activation: {
        activityId: "case-review-resolution",
        outcomes: ["converged", "human_conflict", "plan_revision_required"]
      },
      metadata: {
        subjectSchemaVersion: "case-confirmation-subject-v2",
        scope: "full",
        casePackages
      }
    }
  );
  return activities;
}

function buildV7FullActivities(
  capabilities: WorkflowCapability[],
  writesData: boolean,
  casePackages: string[],
  reviewPolicy: ReviewPolicy,
  deliveryTarget: WorkflowDeliveryTarget,
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"],
  optimizedV3 = false
): WorkflowActivityDefinition[] {
  const activities = optimizedV3
    ? v7OptimizedDesignActivities()
    : v7DesignActivities(casePackages, reviewPolicy);
  if (deliveryTarget === "testcase_only") {
    markDeliveryTerminal(activities, "case-confirmation", deliveryTarget);
    return activities;
  }
  appendBuildReadinessAndExecution(
    activities,
    capabilities,
    writesData,
    "case-confirmation",
    executionIsolation,
    optimizedV3
  );
  if (deliveryTarget === "script_only") {
    const buildIndex = activities.findIndex((activity) => activity.id === "build");
    activities.splice(buildIndex + 1);
    markDeliveryTerminal(activities, "build", deliveryTarget);
  }
  return activities;
}

function v7OptimizedDesignActivities(): WorkflowActivityDefinition[] {
  return [
    {
      id: "source-selection",
      kind: "source_selection",
      phase: "planning",
      dependencies: [],
      required: true,
      metadata: { sourcePolicyVersion: "request-local-source-v1" }
    },
    {
      id: "candidate-generation",
      kind: "candidate_generation",
      phase: "case_generation",
      dependencies: ["source-selection"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        package: "cases.md",
        generationPolicyVersion: "candidate-generation-policy-v1"
      }
    },
    {
      id: "candidate-gate",
      kind: "candidate_gate",
      phase: "case_validation",
      dependencies: ["candidate-generation"],
      required: true,
      metadata: { gateSchemaVersion: "candidate-gate-v1" }
    },
    {
      id: "case-review-combined",
      kind: "review",
      phase: "case_review",
      dependencies: ["candidate-gate"],
      required: true,
      concurrencyGroup: "reviewer",
      concurrencyLimit: 2,
      activation: {
        activityId: "candidate-gate",
        outcomes: ["combined", "combined_with_impact"]
      },
      metadata: {
        subflow: "case-review",
        role: "combined",
        failurePolicy: "lean_warning_strict_block"
      }
    },
    {
      id: "case-review-impact",
      kind: "review",
      phase: "case_review",
      dependencies: ["candidate-gate"],
      required: true,
      concurrencyGroup: "reviewer",
      concurrencyLimit: 2,
      activation: {
        activityId: "candidate-gate",
        outcomes: ["combined_with_impact"]
      },
      metadata: {
        subflow: "case-review",
        role: "impact",
        failurePolicy: "lean_warning_strict_block"
      }
    },
    {
      id: "case-review-resolution",
      kind: "review_resolution",
      phase: "case_review",
      dependencies: ["candidate-gate", "case-review-combined", "case-review-impact"],
      optionalDependencies: ["case-review-combined", "case-review-impact"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        subflow: "case-review",
        riskAdaptive: true,
        maxSemanticEvolutionCycles: 1
      }
    },
    {
      id: "case-review-evolution",
      kind: "automatic_evolution",
      phase: "case_review",
      dependencies: ["case-review-resolution"],
      required: true,
      publishesArtifacts: true,
      activation: { activityId: "case-review-resolution", outcomes: ["evolve"] },
      metadata: { subflow: "case-review", repeatable: true, maxCycles: 1 }
    },
    {
      id: "case-confirmation",
      kind: "callback",
      phase: "case_confirmation",
      dependencies: ["case-review-resolution", "case-review-evolution"],
      optionalDependencies: ["case-review-evolution"],
      required: true,
      activation: {
        activityId: "case-review-resolution",
        outcomes: ["converged", "human_conflict", "plan_revision_required"]
      },
      metadata: {
        subjectSchemaVersion: "case-confirmation-subject-v2",
        scope: "full",
        casePackages: ["cases.md"]
      }
    }
  ];
}

function v8SkeletonActivity(dependency: string, scope: "full" | "affected"): WorkflowActivityDefinition {
  return {
    id: "candidate-skeleton",
    kind: "candidate_skeleton",
    phase: "case_generation",
    dependencies: [dependency],
    required: true,
    publishesArtifacts: true,
    metadata: {
      scope,
      manifestPath: "candidate-fragments/manifest.json",
      generationPolicyVersion: "candidate-generation-policy-v2"
    }
  };
}

function v8PreflightActivity(dependency: string): WorkflowActivityDefinition {
  return {
    id: "candidate-preflight",
    kind: "candidate_preflight",
    phase: "planning",
    dependencies: [dependency],
    required: true,
    publishesArtifacts: true,
    metadata: { preflightSchemaVersion: "candidate-plan-preflight-v1" }
  };
}

function buildV8FullBootstrapActivities(): WorkflowActivityDefinition[] {
  return [
    {
      id: "source-selection",
      kind: "source_selection",
      phase: "planning",
      dependencies: [],
      required: true,
      metadata: { sourcePolicyVersion: "request-local-source-v1" }
    },
    v8PreflightActivity("source-selection"),
    v8SkeletonActivity("candidate-preflight", "full")
  ];
}

function buildV8ReusableBootstrapActivities(
  assessment: ReusableWorkflowDefinitionInput["reuseAssessment"]
): WorkflowActivityDefinition[] {
  const suiteMetadata: Record<string, SafeJsonValue> = {
    suiteId: assessment.suiteId,
    assessmentDigest: assessment.assessmentDigest,
    decision: assessment.decision,
    selectedCaseIds: assessment.selectedCaseIds,
    affectedCaseIds: assessment.affectedCaseIds
  };
  if (assessment.suiteVersion) suiteMetadata.suiteVersion = assessment.suiteVersion;
  const activities: WorkflowActivityDefinition[] = [{
    id: "reuse-assessment",
    kind: "reuse_assessment",
    phase: "reuse_assessment",
    dependencies: [],
    required: true,
    metadata: suiteMetadata
  }];
  if (assessment.decision === "affected_rebuild") {
    activities.push({
      id: "impact-location",
      kind: "impact_location",
      phase: "case_generation",
      dependencies: ["reuse-assessment"],
      required: true,
      metadata: suiteMetadata
    }, v8PreflightActivity("impact-location"), v8SkeletonActivity("candidate-preflight", "affected"));
  } else {
    activities.push({
      id: "source-selection",
      kind: "source_selection",
      phase: "planning",
      dependencies: ["reuse-assessment"],
      required: true,
      metadata: { ...suiteMetadata, sourcePolicyVersion: "request-local-source-v1" }
    }, v8PreflightActivity("source-selection"), v8SkeletonActivity("candidate-preflight", "full"));
  }
  return activities;
}

function buildV9AffectedBootstrapActivities(
  assessment: ReusableWorkflowDefinitionInput["reuseAssessment"]
): WorkflowActivityDefinition[] {
  const metadata: Record<string, SafeJsonValue> = {
    suiteId: assessment.suiteId,
    ...(assessment.suiteVersion ? { suiteVersion: assessment.suiteVersion } : {}),
    assessmentDigest: assessment.assessmentDigest,
    selectedCaseIds: assessment.selectedCaseIds,
    affectedCaseIds: assessment.affectedCaseIds,
    decision: assessment.decision
  };
  return [
    { id: "reuse-assessment", kind: "reuse_assessment", phase: "reuse_assessment", dependencies: [], required: true, metadata },
    { id: "impact-location", kind: "impact_location", phase: "case_validation", dependencies: ["reuse-assessment"], required: true, metadata },
    { id: "run-intent-derive", kind: "run_intent_derive", phase: "reuse_assessment", dependencies: ["impact-location"], required: true, metadata: { ...metadata, schemaVersion: "run-intent-v1" } },
    { id: "impact-closure-build", kind: "impact_closure", phase: "case_validation", dependencies: ["run-intent-derive"], required: true, metadata: { ...metadata, schemaVersion: "impact-closure-v1", maxSemanticCases: 8 } },
    {
      id: "delta-preflight", kind: "delta_preflight", phase: "planning", dependencies: ["impact-closure-build"], required: true,
      activation: { activityId: "impact-closure-build", outcomes: ["bounded"] },
      metadata: { ...metadata, schemaVersion: "design-delta-v1" }
    },
    {
      id: "delta-skeleton", kind: "delta_skeleton", phase: "case_generation", dependencies: ["delta-preflight"], required: true,
      activation: { activityId: "impact-closure-build", outcomes: ["bounded"] },
      metadata: { ...metadata, schemaVersion: "design-delta-v1" }
    },
    {
      ...v8PreflightActivity("delta-skeleton"),
      id: "delta-candidate-preflight",
      activation: { activityId: "impact-closure-build", outcomes: ["bounded"] },
      metadata: { ...metadata, preflightSchemaVersion: "candidate-plan-preflight-v1", candidateNamespace: "delta" }
    },
    {
      ...v8SkeletonActivity("delta-candidate-preflight", "affected"),
      id: "delta-candidate-skeleton",
      activation: { activityId: "impact-closure-build", outcomes: ["bounded"] },
      metadata: {
        ...metadata,
        scope: "affected",
        manifestPath: "delta-candidate-fragments/manifest.json",
        generationPolicyVersion: "candidate-generation-policy-v2",
        candidateNamespace: "delta"
      }
    },
    {
      id: "full-source-selection", kind: "source_selection", phase: "planning", dependencies: ["impact-closure-build"], required: true,
      activation: { activityId: "impact-closure-build", outcomes: ["full_replan"] },
      metadata: { ...metadata, sourcePolicyVersion: "request-local-source-v1", fallbackFrom: "affected_rebuild" }
    },
    {
      ...v8PreflightActivity("full-source-selection"),
      activation: { activityId: "impact-closure-build", outcomes: ["full_replan"] },
      metadata: { ...metadata, preflightSchemaVersion: "candidate-plan-preflight-v1", fallbackFrom: "affected_rebuild" }
    },
    {
      ...v8SkeletonActivity("candidate-preflight", "full"),
      activation: { activityId: "impact-closure-build", outcomes: ["full_replan"] },
      metadata: {
        ...metadata,
        scope: "full",
        manifestPath: "candidate-fragments/manifest.json",
        generationPolicyVersion: "candidate-generation-policy-v2",
        fallbackFrom: "affected_rebuild"
      }
    }
  ];
}

function buildV9FullReplanBootstrapActivities(
  assessment: ReusableWorkflowDefinitionInput["reuseAssessment"]
): WorkflowActivityDefinition[] {
  const activities = buildV8ReusableBootstrapActivities(assessment);
  const source = activities.find((activity) => activity.id === "source-selection");
  if (!source) throw new Error("v9 full_replan requires source-selection.");
  source.dependencies = ["run-intent-derive"];
  activities.splice(1, 0, {
    id: "run-intent-derive",
    kind: "run_intent_derive",
    phase: "reuse_assessment",
    dependencies: ["reuse-assessment"],
    required: true,
    metadata: {
      suiteId: assessment.suiteId,
      ...(assessment.suiteVersion ? { suiteVersion: assessment.suiteVersion } : {}),
      assessmentDigest: assessment.assessmentDigest,
      selectedCaseIds: assessment.selectedCaseIds,
      affectedCaseIds: assessment.affectedCaseIds,
      decision: assessment.decision,
      schemaVersion: "run-intent-v1"
    }
  });
  return activities;
}

/** Builds the immutable v8 candidate subgraph after a skeleton manifest has
 * frozen module ownership. The graph is intentionally constructed only from
 * the manifest, never from model fragment output. */
export function buildV8CandidateExtension(input: {
  modules: CandidateFragmentModule[];
  scope: "full" | "affected";
  capabilities: WorkflowCapability[];
  writesData: boolean;
  deliveryTarget: WorkflowDeliveryTarget;
  reviewPolicy: ReviewPolicy;
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"];
  /** Pinned from candidate-skeleton so historical v8 graph expansions replay
   * exactly; newly built v8 graphs use v2. */
  generationPolicyVersion?: "candidate-generation-policy-v1" | "candidate-generation-policy-v2";
  /** v9 delta uses a separate fragment and assembly namespace; full v8/v9
   * keeps the historical identifiers unchanged. */
  candidateNamespace?: "delta";
}): WorkflowActivityDefinition[] {
  const prefix = input.candidateNamespace ? `${input.candidateNamespace}-` : "";
  const skeletonId = `${prefix}candidate-skeleton`;
  const fragmentRoot = `${prefix}candidate-fragments`;
  const fragments = input.modules.map((module) => ({
    id: `${prefix}candidate-fragment-${module.id}`,
    kind: "candidate_fragment" as const,
    phase: "case_generation" as const,
    dependencies: [skeletonId],
    required: true,
    publishesArtifacts: true,
    concurrencyGroup: "candidate_generation" as const,
    concurrencyLimit: 3,
    metadata: {
      moduleId: module.id,
      moduleTitle: module.title,
      ruleIds: module.ruleIds,
      casePrefix: module.casePrefix,
      sourceRefs: module.sourceRefs,
      fragmentPath: `${fragmentRoot}/${module.id}.md`,
      ...(input.candidateNamespace ? { candidateNamespace: input.candidateNamespace } : {}),
      ...((input.generationPolicyVersion ?? "candidate-generation-policy-v2") === "candidate-generation-policy-v2"
        ? { generationPolicyVersion: "candidate-generation-policy-v2" }
        : {})
    }
  }));
  const assemble: WorkflowActivityDefinition = {
    id: `${prefix}candidate-assemble`,
    kind: "candidate_assembly",
    phase: "case_generation",
    dependencies: fragments.map((fragment) => fragment.id),
    required: true,
    publishesArtifacts: true,
    metadata: { package: "cases.md", scope: input.scope, ...(input.candidateNamespace ? { candidateNamespace: input.candidateNamespace } : {}) }
  };
  if (input.scope === "full") {
    const downstream = buildV7FullActivities(
      input.capabilities,
      input.writesData,
      ["cases.md"],
      input.reviewPolicy,
      input.deliveryTarget,
      input.executionIsolation,
      true
    ).filter((activity) => !["source-selection", "candidate-generation"].includes(activity.id));
    downstream.find((activity) => activity.id === "candidate-gate")!.dependencies = [assemble.id];
    return [...fragments, assemble, ...downstream];
  }
  const activities: WorkflowActivityDefinition[] = [
    ...fragments,
    assemble,
    {
      id: "candidate-gate",
      kind: "candidate_gate",
      phase: "case_validation",
      dependencies: [assemble.id],
      required: true,
      metadata: { gateSchemaVersion: "candidate-gate-v1", scope: "affected" }
    },
    {
      id: "targeted-review",
      kind: "review",
      phase: "case_review",
      dependencies: ["candidate-gate"],
      required: true,
      concurrencyGroup: "reviewer",
      concurrencyLimit: 1,
      metadata: { subflow: "affected-rebuild", role: "combined" }
    },
    {
      id: "case-confirmation",
      kind: "callback",
      phase: "case_confirmation",
      dependencies: ["targeted-review"],
      required: true,
      metadata: {
        subjectSchemaVersion: "case-confirmation-subject-v2",
        scope: "affected",
        casePackages: ["cases.md"],
        completesWorkflow: input.deliveryTarget === "testcase_only",
        deliveryTarget: input.deliveryTarget
      }
    }
  ];
  if (input.deliveryTarget !== "testcase_only") {
    appendBuildReadinessAndExecution(
      activities,
      input.capabilities,
      input.writesData,
      "case-confirmation",
      input.executionIsolation,
      true
    );
    if (input.deliveryTarget === "script_only") {
      const buildIndex = activities.findIndex((activity) => activity.id === "build");
      activities.splice(buildIndex + 1);
      markDeliveryTerminal(activities, "build", input.deliveryTarget);
    }
  }
  return activities;
}

function markDeliveryTerminal(
  activities: WorkflowActivityDefinition[],
  activityId: string,
  deliveryTarget: Exclude<WorkflowDeliveryTarget, "full_run">
): void {
  const activity = activities.find((candidate) => candidate.id === activityId);
  if (!activity) throw new Error(`Delivery target ${deliveryTarget} has no terminal activity ${activityId}.`);
  activity.metadata = {
    ...activity.metadata,
    completesWorkflow: true,
    deliveryTarget
  };
}

/** v9 reuse branches are intentionally graph-level proof that design LLM work
 * is absent. The run-intent artifact binds the request to the stable suite;
 * no plan/candidate/reviewer activity is present in either branch. */
function buildV9ZeroModelReuseActivities(
  capabilities: WorkflowCapability[],
  writesData: boolean,
  casePackages: string[],
  reuseAssessment: ReusableWorkflowDefinitionInput["reuseAssessment"],
  deliveryTarget: WorkflowDeliveryTarget,
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"]
): WorkflowActivityDefinition[] {
  const metadata = {
    suiteId: reuseAssessment.suiteId,
    ...(reuseAssessment.suiteVersion ? { suiteVersion: reuseAssessment.suiteVersion } : {}),
    assessmentDigest: reuseAssessment.assessmentDigest,
    selectedCaseIds: reuseAssessment.selectedCaseIds,
    affectedCaseIds: reuseAssessment.affectedCaseIds,
    decision: reuseAssessment.decision,
    reuseProtocol: "run-intent-v1"
  } as Record<string, SafeJsonValue>;
  const intent: WorkflowActivityDefinition = {
    id: "run-intent-derive",
    kind: "run_intent_derive",
    phase: "reuse_assessment",
    dependencies: ["reuse-assessment"],
    required: true,
    metadata: { ...metadata, schemaVersion: "run-intent-v1" }
  };
  const assessment: WorkflowActivityDefinition = {
    id: "reuse-assessment",
    kind: "reuse_assessment",
    phase: "reuse_assessment",
    dependencies: [],
    required: true,
    metadata: { ...metadata, schemaVersion: reuseAssessment.schemaVersion, decision: reuseAssessment.decision }
  };
  if (reuseAssessment.decision === "design_reconfirm") {
    const activities: WorkflowActivityDefinition[] = [
      assessment,
      intent,
      {
        id: "design-revalidation",
        kind: "design_revalidation",
        phase: "case_validation",
        dependencies: [intent.id],
        required: true,
        metadata: { ...metadata, tier: "design", scope: "reconfirm" }
      },
      {
        id: "case-confirmation",
        kind: "callback",
        phase: "case_confirmation",
        dependencies: ["design-revalidation"],
        required: true,
        metadata: {
          ...metadata,
          subjectSchemaVersion: "case-confirmation-subject-v2",
          scope: "reconfirm",
          casePackages,
          completesWorkflow: true,
          deliveryTarget: "testcase_only"
        }
      }
    ];
    return activities;
  }
  const activities: WorkflowActivityDefinition[] = [
    assessment,
    intent,
    {
      id: "suite-validation",
      kind: "suite_validation",
      phase: "engineering",
      dependencies: [intent.id],
      required: true,
      metadata
    },
    {
      id: "readiness",
      kind: "readiness",
      phase: "script_review",
      dependencies: ["suite-validation"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        ...metadata,
        outputArtifact: "execution-authorization.json",
        outputSchemaVersion: "execution-authorization-v5",
        readinessPolicyVersion: "execution-readiness-v1",
        zeroRunnablePolicy: "block_before_authorization"
      }
    },
    {
      id: "execution-authorization",
      kind: !writesData ? "policy_authorization" : "execution_authorization",
      phase: "execution_authorization",
      dependencies: ["readiness"],
      required: true,
      metadata: {
        ...metadata,
        decisionMode: !writesData ? "policy_auto_no_write" : "user_confirmed",
        callbackSubjectArtifact: "execution-authorization.json",
        callbackSubjectFormat: "canonical_json_digest_v1",
        callbackSubjectSchemaVersion: "execution-authorization-v5",
        publisherActivityId: "readiness"
      }
    },
    {
      id: "run",
      kind: "run",
      phase: "execution",
      dependencies: ["execution-authorization"],
      required: true,
      metadata: { ...metadata, completionContract: "formal-execution-completion-seal-v1", maxWorkers: 1 },
      ...(writesData ? { requiresExternalOperation: true, concurrencyGroup: "business_write" as const, concurrencyLimit: 1 } : {})
    },
    {
      id: "report",
      kind: "report",
      phase: "reporting",
      dependencies: ["run"],
      required: true,
      publishesArtifacts: true,
      metadata: { ...metadata, completionContract: "formal-execution-completion-seal-v1", completesWorkflow: true }
    }
  ];
  if (deliveryTarget !== "full_run") {
    activities.splice(activities.findIndex((activity) => activity.id === "readiness"));
    markDeliveryTerminal(activities, "suite-validation", deliveryTarget);
  }
  return activities;
}

function buildV7ReusableActivities(
  capabilities: WorkflowCapability[],
  writesData: boolean,
  casePackages: string[],
  reviewPolicy: ReviewPolicy,
  reuseAssessment: ReusableWorkflowDefinitionInput["reuseAssessment"],
  deliveryTarget: WorkflowDeliveryTarget,
  executionIsolation?: BuildWorkflowDefinitionInput["executionIsolation"],
  optimizedV3 = false
): WorkflowActivityDefinition[] {
  const suiteMetadata = {
    suiteId: reuseAssessment.suiteId,
    ...(reuseAssessment.suiteVersion ? { suiteVersion: reuseAssessment.suiteVersion } : {}),
    assessmentDigest: reuseAssessment.assessmentDigest,
    requestedProfile: reuseAssessment.requestedProfile,
    effectiveProfile: reuseAssessment.effectiveProfile,
    selectedCaseIds: reuseAssessment.selectedCaseIds,
    affectedCaseIds: reuseAssessment.affectedCaseIds
  } as Record<string, SafeJsonValue>;
  const assessmentActivity: WorkflowActivityDefinition = {
    id: "reuse-assessment",
    kind: "reuse_assessment",
    phase: "reuse_assessment",
    dependencies: [],
    required: true,
    metadata: {
      ...suiteMetadata,
      schemaVersion: reuseAssessment.schemaVersion,
      decision: reuseAssessment.decision
    }
  };
  const directActivities: WorkflowActivityDefinition[] = [{
    id: "suite-validation",
    kind: "suite_validation",
    phase: "engineering",
    dependencies: ["reuse-assessment"],
    required: true,
    metadata: suiteMetadata
  }];
  const designReconfirmActivities: WorkflowActivityDefinition[] = [
    {
      id: "design-revalidation",
      kind: "design_revalidation",
      phase: "case_validation",
      dependencies: ["reuse-assessment"],
      required: true,
      metadata: { ...suiteMetadata, tier: "design", scope: "reconfirm" }
    },
    {
      id: "case-confirmation",
      kind: "callback",
      phase: "case_confirmation",
      dependencies: ["design-revalidation"],
      required: true,
      metadata: {
        ...suiteMetadata,
        subjectSchemaVersion: "case-confirmation-subject-v2",
        scope: "reconfirm",
        casePackages
      }
    }
  ];
  const affectedBuildChain: WorkflowActivityDefinition[] = [];
  appendBuildReadinessAndExecution(
    affectedBuildChain,
    capabilities,
    writesData,
    "case-confirmation",
    executionIsolation
  );
  const affectedBuild = affectedBuildChain.find((activity) => activity.id === "build")!;
  const affectedActivities: WorkflowActivityDefinition[] = [
    {
      id: "impact-location",
      kind: "impact_location",
      phase: "case_validation",
      dependencies: ["reuse-assessment"],
      required: true,
      metadata: suiteMetadata
    },
    {
      id: "targeted-evolution",
      kind: "engineering",
      phase: "case_generation",
      dependencies: ["impact-location"],
      required: true,
      publishesArtifacts: true,
      metadata: { ...suiteMetadata, scope: "affected_only", casePackages }
    },
    {
      id: "targeted-review",
      kind: "review",
      phase: "case_review",
      dependencies: ["targeted-evolution"],
      required: true,
      concurrencyGroup: "reviewer",
      concurrencyLimit: 1,
      metadata: { ...suiteMetadata, subflow: "affected-rebuild", role: "combined" }
    },
    {
      id: "case-confirmation",
      kind: "callback",
      phase: "case_confirmation",
      dependencies: ["targeted-review"],
      required: true,
      metadata: {
        ...suiteMetadata,
        subjectSchemaVersion: "case-confirmation-subject-v2",
        scope: "affected",
        casePackages
      }
    }
  ];
  if (deliveryTarget !== "testcase_only") affectedActivities.push(affectedBuild);
  const fullActivities = (optimizedV3
    ? v7OptimizedDesignActivities()
    : v7DesignActivities(casePackages, reviewPolicy))
    .filter((activity) => !["readiness", "execution-authorization", "run", "report"].includes(activity.id));
  fullActivities.find((activity) => activity.id === "source-selection")!.dependencies = ["reuse-assessment"];
  const fullBuildChain: WorkflowActivityDefinition[] = [];
  appendBuildReadinessAndExecution(
    fullBuildChain,
    capabilities,
    writesData,
    "case-confirmation",
    executionIsolation
  );
  if (deliveryTarget !== "testcase_only") {
    fullActivities.push(fullBuildChain.find((activity) => activity.id === "build")!);
  }
  const branchActivities = reuseAssessment.decision === "direct_execute"
    ? directActivities
    : reuseAssessment.decision === "design_reconfirm"
      ? designReconfirmActivities
      : reuseAssessment.decision === "affected_rebuild"
        ? affectedActivities
        : fullActivities;
  if (deliveryTarget !== "full_run") {
    const branchTail = reuseAssessment.decision === "direct_execute"
      ? "suite-validation"
      : reuseAssessment.decision === "design_reconfirm"
        ? "case-confirmation"
        : deliveryTarget === "testcase_only"
        ? "case-confirmation"
        : "build";
    markDeliveryTerminal(branchActivities, branchTail, deliveryTarget);
    return [assessmentActivity, ...branchActivities];
  }
  if (reuseAssessment.decision === "design_reconfirm") {
    throw new Error(
      "design_reconfirm is a testcase_only reuse decision; a full_run request must take full_replan."
    );
  }
  const branchTail = reuseAssessment.decision === "direct_execute" ? "suite-validation" : "build";
  const usesStableSuiteAuthorization = reuseAssessment.decision === "direct_execute";
  const authorizationSchemaVersion = usesStableSuiteAuthorization
    ? "execution-authorization-v5"
    : "execution-authorization-v4";
  const authorizationKind = usesStableSuiteAuthorization && !writesData
    ? "policy_authorization"
    : "execution_authorization";
  const adaptiveAuthorization = optimizedV3 && !usesStableSuiteAuthorization;
  return [
    assessmentActivity,
    ...branchActivities,
    {
      id: "readiness",
      kind: "readiness",
      phase: "script_review",
      dependencies: [branchTail],
      required: true,
      publishesArtifacts: true,
      metadata: {
        ...suiteMetadata,
        outputArtifact: "execution-authorization.json",
        outputSchemaVersion: authorizationSchemaVersion,
        readinessPolicyVersion: "execution-readiness-v1",
        zeroRunnablePolicy: "block_before_authorization"
      }
    },
    {
      id: "execution-authorization",
      kind: authorizationKind,
      phase: "execution_authorization",
      dependencies: ["readiness"],
      required: true,
      metadata: {
        ...suiteMetadata,
        decisionMode: authorizationKind === "policy_authorization"
          ? "policy_auto_no_write"
          : adaptiveAuthorization
            ? "risk_adaptive"
            : "user_confirmed",
        ...(adaptiveAuthorization
          ? { policyVersion: "policy_auto_no_write_v2" }
          : {}),
        callbackSubjectArtifact: "execution-authorization.json",
        callbackSubjectFormat: "canonical_json_digest_v1",
        callbackSubjectSchemaVersion: authorizationSchemaVersion,
        publisherActivityId: "readiness"
      }
    },
    {
      id: "run",
      kind: "run",
      phase: "execution",
      dependencies: ["execution-authorization"],
      required: true,
      metadata: {
        ...suiteMetadata,
        completionContract: "formal-execution-completion-seal-v1",
        maxWorkers: 1,
        transaction: [
          "capability_recheck",
          "lazy_setup",
          "case_execution",
          "postcondition_when_required",
          "finally_cleanup",
          "reconciliation"
        ]
      },
      ...(writesData
        ? {
            requiresExternalOperation: true,
            concurrencyGroup: "business_write" as const,
            concurrencyLimit: 1
          }
        : {})
    },
    {
      id: "report",
      kind: "report",
      phase: "reporting",
      dependencies: ["run"],
      required: true,
      publishesArtifacts: true,
      metadata: {
        ...suiteMetadata,
        completionContract: "formal-execution-completion-seal-v1",
        deterministic: true,
        outputs: ["run-summary.json", "execution-summary.md"],
        completesWorkflow: true
      }
    }
  ];
}

export function workflowStartedPayload(definition: WorkflowDefinition): SafeEventPayload {
  const reuse = definition.activities.find((activity) => activity.id === "reuse-assessment")?.metadata;
  return {
    planDigest: definition.planDigest,
    graphDigest: definition.graphDigest,
    ...(definition.deliveryTarget ? { deliveryTarget: definition.deliveryTarget } : {}),
    ...(reuse ? { reuseAssessment: reuse as unknown as SafeJsonValue } : {})
  };
}

export function activitiesExpandedPayload(definition: WorkflowDefinition): SafeEventPayload {
  return {
    planDigest: definition.planDigest,
    graphDigest: definition.graphDigest,
    capabilities: definition.capabilities,
    writesData: definition.writesData,
    ...(definition.deliveryTarget ? { deliveryTarget: definition.deliveryTarget } : {}),
    ...(definition.reviewPolicy
      ? { reviewPolicy: definition.reviewPolicy as unknown as SafeJsonValue }
      : {}),
    activities: definition.activities as unknown as SafeJsonValue
  };
}
