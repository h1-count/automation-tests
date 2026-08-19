import { defineFormalExecutionManifest } from "../../../../src/support/formal-execution/manifest.js";

export const formalExecutionManifest = defineFormalExecutionManifest({
  schemaVersion: "formal-execution-manifest-v3",
  requestId: "${TYPE}/${PROJECT}/${REQUEST}",
  projectId: "${PROJECT}",
  environment: "${ENVIRONMENT}",
  buildEvidence: [{
    kind: "source_contract",
    path: "${WORKSPACE_SOURCE_CONTRACT_PATH}",
    sha256: "${SOURCE_CONTRACT_SHA256}"
  }, {
    kind: "selector_contract",
    path: "${WORKSPACE_SELECTOR_EVIDENCE_PATH}",
    sha256: "${SELECTOR_EVIDENCE_SHA256}"
  }, {
    kind: "browser_response_contract",
    path: "${WORKSPACE_RESPONSE_CONTRACT_PATH}",
    sha256: "${RESPONSE_CONTRACT_SHA256}"
  }, {
    kind: "test_asset",
    assetId: "${TEST_ASSET_ID}",
    sha256: "${TEST_ASSET_SHA256}",
    scope: "${TEST_ASSET_SCOPE}",
    path: "test-assets/${TEST_ASSET_PATH}"
  }],
  cases: [{
    caseId: "${CASE_ID}",
    title: "${TITLE}",
    requiredCapabilities: ["${CAPABILITY_ID}", {
      capabilityId: "${DELAYED_CAPABILITY_ID}",
      checkAfterTransitionId: "${TRANSITION_ID}"
    }],
    // Git-managed static assets are build evidence, not runtime capabilities.
    requiredTestAssetIds: ["${TEST_ASSET_ID}"],
    requiredResources: [],
    consumesResources: [],
    producesResources: [{
      name: "${RESOURCE_NAME}",
      resourceType: "${RESOURCE_TYPE}",
      disposition: "reusable_fixture",
      baselineContractId: "${BASELINE_CONTRACT_ID}",
      baselineVersion: "v1",
      leaseMode: "exclusive",
      maxPoolSize: 3,
      retirementPolicy: "validate_quarantine_replace"
    }],
    permissionProfile: "test_write",
    requiredOperations: ["submit_registration", "create_test_resource"],
    operationBudgets: [{
      operation: "submit_registration",
      maxExecutions: 1
    }, {
      operation: "create_test_resource",
      maxExecutions: 1
    }],
    dataWritePolicy: "reusable_fixture",
    operationEvidence: [{
      operation: "submit_registration",
      strategy: "response_contract",
      responseContractId: "${RESPONSE_CONTRACT_ID}",
      finality: "final",
      stableIdentityRequired: true
    }, {
      operation: "create_test_resource",
      strategy: "response_contract",
      responseContractId: "${RESPONSE_CONTRACT_ID}",
      finality: "final",
      stableIdentityRequired: true
    }],
    implementation: {
      status: "source_complete",
      // For source-complete candidates that cross an unverified runtime boundary:
      // status: "runtime_validation_pending",
      // reachableBoundary: "${REACHABLE_BOUNDARY}",
      // pendingCapabilityIds: ["${CAPABILITY_ID}"]
    },
    businessOracles: [{
      oracleId: "${ORACLE_ID}",
      ruleRef: "${RULE_ID}",
      // Use browser_response, postcondition_query or runtime_state only when
      // the reviewed Oracle actually uses that observation contract.
      observationKind: "dom",
      authorities: [{
        kind: "registered_source",
        materialId: "${SOURCE_MATERIAL_ID}",
        sectionId: "${SOURCE_SECTION_ID}",
        sourceSha256: "${SOURCE_SHA256}"
      }]
    }],
    // Only add stages when this one business case truly depends on an
    // external state transition. Simple atomic cases omit executionStages.
    executionStages: [{
      stageId: "submit-once",
      producesResources: ["${RESOURCE_NAME}"],
      externalTransition: {
        transitionId: "${TRANSITION_ID}",
        actionSummary: "${SAFE_EXTERNAL_ACTION_SUMMARY}",
        allowedOutcomes: ["approved"],
        requiredAttestationKeys: ["${SAFE_ATTESTATION_KEY}"]
      }
    }, {
      stageId: "verify-after-transition",
      dependsOnStageIds: ["submit-once"]
    }],
    // Use sensitive for password, OTP, Token or other intervals where image
    // and Trace capture must be disabled for the whole authorized batch.
    evidencePolicy: "standard"
  }],
  pageSessionGroups: [{
    sessionGroupId: "${SESSION_GROUP_ID}",
    targetRoute: "${TARGET_ROUTE}",
    caseIds: ["${CASE_ID}"],
    resetStrategy: "new_context_per_case",
    isolationReason: "${SESSION_ISOLATION_REASON}",
    executionOrder: ["${CASE_ID}"]
  }],
  capabilities: [{
    id: "${CAPABILITY_ID}",
    requiredForCaseIds: ["${CASE_ID}"],
    source: {
      kind: "environment",
      variable: "${CAPABILITY_ENV_VARIABLE}"
    },
    unavailableReason: "${UNAVAILABLE_REASON}",
    unblockCondition: "${UNBLOCK_CONDITION}"
  }, {
    id: "${DELAYED_CAPABILITY_ID}",
    requiredForCaseIds: ["${CASE_ID}"],
    source: {
      kind: "environment",
      variable: "${DELAYED_CAPABILITY_ENV_VARIABLE}"
    },
    unavailableReason: "${DELAYED_UNAVAILABLE_REASON}",
    unblockCondition: "${DELAYED_UNBLOCK_CONDITION}"
  }]
});
