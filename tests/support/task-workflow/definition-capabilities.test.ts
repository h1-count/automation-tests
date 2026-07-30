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

function engineeringMetadata(capability: WorkflowCapability) {
  return definitionFor([capability]).activities
    .find((activity) => activity.id === `engineering-${capability}`)?.metadata;
}

test("v4 expands every supported capability with its required engineering contract", () => {
  const expectedMetadata: Record<WorkflowCapability, Record<string, unknown>> = {
    web: {
      visibleExploration: true,
      playwrightRequired: true,
      inspectorPolicy: "risk_triggered"
    },
    h5: {
      visibleExploration: true,
      playwrightRequired: true,
      inspectorPolicy: "risk_triggered"
    },
    webview: {
      visibleExploration: true,
      assetRequired: true,
      appiumRequired: true,
      deviceValidation: true,
      contextSwitchRequired: true,
      webSemanticsRiskGate: true,
      inspectorPolicy: "risk_triggered"
    },
    app: {
      assetRequired: true,
      appiumRequired: true,
      deviceValidation: true
    },
    api: {
      typescriptApiClientRequired: true
    },
    mqtt: {
      mqttJsRequired: true
    },
    iot: {
      compositeRunnerRequired: true
    }
  };

  for (const capability of Object.keys(expectedMetadata) as WorkflowCapability[]) {
    const metadata = engineeringMetadata(capability);
    assert.ok(metadata, `${capability} engineering metadata should exist`);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(expectedMetadata[capability]!).map((key) => [key, metadata[key]])
      ),
      expectedMetadata[capability]
    );
  }

  assert.equal(engineeringMetadata("webview")?.playwrightRequired, undefined);
});

test("v4 permits two isolated read-only workers only for non-device capabilities", () => {
  for (const capability of ["web", "h5", "api", "mqtt"] as WorkflowCapability[]) {
    const execute = definitionFor([capability]).activities.find((activity) => activity.id === "execute");
    assert.equal(execute?.metadata?.maxWorkers, 2, capability);
  }

  for (const capability of ["webview", "app", "iot"] as WorkflowCapability[]) {
    const execute = definitionFor([capability]).activities.find((activity) => activity.id === "execute");
    assert.equal(execute?.metadata?.maxWorkers, 1, capability);
  }

  const mixed = definitionFor(["web", "app"]);
  assert.ok(mixed.activities.some((activity) => activity.id === "engineering-web"));
  assert.ok(mixed.activities.some((activity) => activity.id === "engineering-app"));
  assert.equal(
    mixed.activities.find((activity) => activity.id === "execute")?.metadata?.maxWorkers,
    1
  );

  assert.equal(
    definitionFor(["api"], true).activities.find((activity) => activity.id === "execute")?.metadata?.maxWorkers,
    1
  );
});
