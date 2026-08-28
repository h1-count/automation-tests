import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkflowDefinition,
  type WorkflowCapability
} from "../../../src/support/task-workflow/index.js";

const isolatedExecution = {
  contexts: true,
  accounts: true,
  data: true,
  sharedAccount: false
};

function definitionFor(
  capabilities: WorkflowCapability[],
  writesData = false
) {
  return buildWorkflowDefinition({
    requestId: `web/open-platform/capability-${capabilities.join("-")}`,
    planDigest: "a".repeat(64),
    capabilities,
    writesData,
    casePackages: ["cases-main.md"],
    executionIsolation: isolatedExecution
  });
}

function buildCapabilityContract(capability: WorkflowCapability) {
  const contracts = definitionFor([capability]).activities
    .find((activity) => activity.id === "build")
    ?.metadata?.capabilityContracts as Record<string, Record<string, unknown>>;
  return contracts?.[capability];
}

test("current pins every supported capability into one build contract", () => {
  const expectedMetadata: Record<WorkflowCapability, Record<string, unknown>> = {
    web: {
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
    },
    h5: {
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
    },
    webview: {
      sourceContract: "source_first",
      headlessSelectorVerification: "cached_by_build_and_contract",
      visibleExploration: "fallback_only",
      runtime: "appium_web_context"
    },
    app: {
      runtime: "appium",
      deviceValidation: true,
    },
    api: {
      runtime: "typescript_api"
    },
    mqtt: {
      runtime: "mqtt_js"
    },
    iot: {
      runtime: "composite_iot"
    }
  };

  for (const capability of Object.keys(expectedMetadata) as WorkflowCapability[]) {
    assert.deepEqual(buildCapabilityContract(capability), expectedMetadata[capability]);
  }

  const build = definitionFor(["web", "app"]).activities
    .find((activity) => activity.id === "build");
  assert.deepEqual(build?.metadata?.inspectorTriggers, [
    "source_contract_unresolved",
    "runtime_uniqueness_failed",
    "source_runtime_drift",
    "dynamic_semantics"
  ]);
});

test("current permits two isolated read-only workers only for non-device capabilities", () => {
  for (const capability of ["web", "h5", "api", "mqtt"] as WorkflowCapability[]) {
    const execute = definitionFor([capability]).activities.find((activity) => activity.id === "run");
    assert.equal(execute?.metadata?.maxWorkers, 2, capability);
  }

  for (const capability of ["webview", "app", "iot"] as WorkflowCapability[]) {
    const execute = definitionFor([capability]).activities.find((activity) => activity.id === "run");
    assert.equal(execute?.metadata?.maxWorkers, 1, capability);
  }

  const mixed = definitionFor(["web", "app"]);
  assert.ok(mixed.activities.some((activity) => activity.id === "build"));
  assert.equal(
    mixed.activities.find((activity) => activity.id === "run")?.metadata?.maxWorkers,
    1
  );

  assert.equal(
    definitionFor(["api"], true).activities.find((activity) => activity.id === "run")?.metadata?.maxWorkers,
    1
  );
});
