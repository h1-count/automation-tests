import {
  defineFormalExecutionManifest,
  formalCapabilityId
} from "../../../../src/support/formal-execution/manifest.js";
import type {
  FormalCapabilityDefinition,
  FormalCaseDefinition,
  FormalOperationEvidenceDefinition,
  FormalPageSessionGroupDefinition
} from "../../../../src/support/formal-execution/types.js";

// 收窄到“开放平台注册”本职：001–011 + 014（重复申请）。
// 012（审核时限）/013（审核通过登录管理员）移出本次——属管理后台范畴。
// 010 止于“提交受理”（跳转 pending 页），不测审核通过；产出 pending-enterprise 供唯一性用例消费。
// 014 驳回由用户在管理后台最小人工完成（human attestation），不调 API、不写 adapter。
// 移除门禁变量与 capability adapter（注册成功看 UI，不必调后端 API）。
const runtimeValidationPendingCaseIds = new Set([
  "OPEN-REG-20260807-009",
  "OPEN-REG-20260807-010",
  "OPEN-REG-20260807-014"
]);

const trackedResidualCaseIds = new Set([
  "OPEN-REG-20260807-010",
  "OPEN-REG-20260807-014"
]);
const ephemeralCleanupCaseIds = new Set(["OPEN-REG-20260807-009"]);
const reusableFixtureCaseIds = new Set<string>();

const buildOnlyCapabilities = new Set([
  "registration-page-selector-contract",
  "registration-form-contract",
  "registration-submit-contract",
  "registration-residual-contract",
  "sensitive-input-artifact-redaction"
]);

const rejectedTransitionId = "open-platform-registration-rejected";
const pendingEnterpriseResource = "pending-enterprise-OPEN-REG-20260807-010";
const pendingRejectedEnterpriseResource = "pending-enterprise-OPEN-REG-20260807-014";
const rejectedReviewEvidenceResource = "rejected-review-attestation-OPEN-REG-20260807-014";
const syntheticLicenseAssetId = "open-platform-synthetic-business-license";

const requiredTestAssetIdsByCaseId: Record<string, string[]> = {
  "OPEN-REG-20260807-009": [syntheticLicenseAssetId],
  "OPEN-REG-20260807-010": [syntheticLicenseAssetId],
  "OPEN-REG-20260807-014": [syntheticLicenseAssetId]
};

const requiredOperationsByCaseId: Record<string, FormalCaseDefinition["requiredOperations"]> = {
  "OPEN-REG-20260807-009": ["upload_synthetic_file"],
  "OPEN-REG-20260807-010": [
    "send_test_otp",
    "upload_synthetic_file",
    "accept_agreement",
    "submit_registration",
    "retain_tracked_residual"
  ],
  "OPEN-REG-20260807-014": [
    "send_test_otp",
    "upload_synthetic_file",
    "accept_agreement",
    "submit_registration",
    "retain_tracked_residual"
  ]
};

const operationBudgetsByCaseId: Record<string, NonNullable<FormalCaseDefinition["operationBudgets"]>> = {
  "OPEN-REG-20260807-009": [{ operation: "upload_synthetic_file", maxExecutions: 5 }],
  "OPEN-REG-20260807-010": [
    { operation: "send_test_otp", maxExecutions: 1 },
    { operation: "upload_synthetic_file", maxExecutions: 1 },
    { operation: "submit_registration", maxExecutions: 1 }
  ],
  "OPEN-REG-20260807-014": [
    { operation: "send_test_otp", maxExecutions: 2 },
    { operation: "upload_synthetic_file", maxExecutions: 2 },
    { operation: "submit_registration", maxExecutions: 2 }
  ]
};

const operationEvidenceByCaseId: Record<string, FormalOperationEvidenceDefinition[]> = {
  "OPEN-REG-20260807-009": [{
    operation: "upload_synthetic_file",
    strategy: "response_or_ui_rejection",
    responseContractId: "open-platform-upload-response-v1",
    uiContractId: "open-platform-upload-client-rejection-v1",
    finality: "final",
    stableIdentityRequired: false
  }],
  "OPEN-REG-20260807-010": registrationSubmissionEvidence(),
  "OPEN-REG-20260807-014": registrationSubmissionEvidence()
};

const sensitiveEvidenceCaseIds = new Set([
  "OPEN-REG-20260807-007",
  "OPEN-REG-20260807-009",
  "OPEN-REG-20260807-010",
  "OPEN-REG-20260807-014"
]);

const cases: FormalCaseDefinition[] = [
  caseDefinition("OPEN-REG-20260807-001", "企业名称必填、字符集与 2–50 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260807-002", "已存在企业名称的精确唯一性提示", [
    "registration-page-selector-contract"
  ], [pendingEnterpriseResource]),
  caseDefinition("OPEN-REG-20260807-003", "企业信用代码必填与重复唯一性提示", [
    "registration-page-selector-contract"
  ], [pendingEnterpriseResource]),
  caseDefinition("OPEN-REG-20260807-004", "企业地址必填与 50 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260807-005", "企业标识必填、字符集、3–6 位边界与唯一性", [
    "registration-page-selector-contract"
  ], [pendingEnterpriseResource]),
  caseDefinition("OPEN-REG-20260807-006", "申请人姓名必填、中英文与 20 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260807-007", "联系方式必填与 11 位手机号格式", [
    "registration-page-selector-contract",
    "registration-phone-secret-reference",
    "sensitive-input-artifact-redaction"
  ]),
  caseDefinition("OPEN-REG-20260807-008", "企业简介与邮箱选填、长度与格式", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260807-009", "营业执照格式与明确大小区间", [
    "registration-page-selector-contract"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-20260807-010", "合成企业申请单次受控提交（含一次 OTP）", [
    "registration-form-contract",
    "registration-submit-contract",
    "registration-phone-secret-reference",
    "sensitive-input-artifact-redaction"
  ], [], [{
    name: pendingEnterpriseResource,
    resourceType: "tenant",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260807-011", "协议与必填条件对提交资格的阻断", [
    "registration-form-contract"
  ], [pendingEnterpriseResource], [{
    name: "unexpected-registration-residual-OPEN-REG-20260807-011",
    resourceType: "tenant",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260807-014", "审核驳回后按反馈重新发起注册（复用同手机号）", [
    "registration-form-contract",
    "registration-submit-contract",
    "registration-residual-contract",
    "registration-phone-secret-reference",
    "sensitive-input-artifact-redaction"
  ], [], [{
    name: rejectedReviewEvidenceResource,
    resourceType: "custom",
    disposition: "tracked_residual"
  }, {
    name: pendingRejectedEnterpriseResource,
    resourceType: "tenant",
    disposition: "tracked_residual"
  }], 600_000)
];

type EnvironmentSourceConfig = Omit<
  Extract<FormalCapabilityDefinition["source"], { kind: "environment" }>,
  "kind"
>;
type ProviderSourceConfig = Extract<
  FormalCapabilityDefinition["source"],
  { kind: "provider" }
>;

const explicitCapabilitySources: Record<string, EnvironmentSourceConfig | ProviderSourceConfig> = {
  "registration-page-selector-contract": {
    kind: "provider",
    providerId: "selector_evidence",
    configuration: {
      path: "tests/web/open-platform/registration-20260807/selector-contract.json",
      expectedDigest: "ba1597402eb363f9417d7ddfcdf2a2faa876d41e707e6c09d477bc4d923c2770",
      scopeId: "registration"
    }
  },
  "registration-phone-secret-reference": {
    variable: "OPEN_PLATFORM_REGISTRATION_PHONE_TEST",
    pattern: "^1[0-9]{10}$"
  },
  "sensitive-input-artifact-redaction": {
    kind: "provider",
    providerId: "file_evidence",
    configuration: {
      path: "src/support/formal-execution/artifactRedaction.ts",
      expectedDigest: "1517939204c22c4a5bc0aa6c1c462bbe1de507c3cde297e135fd7f5cc24a42ec"
    }
  }
};

const capabilityIds = [...new Set(cases.flatMap((item) =>
  item.requiredCapabilities.map(formalCapabilityId)
))];
const capabilities: FormalCapabilityDefinition[] = capabilityIds.map((id) => {
  const explicit = explicitCapabilitySources[id];
  const source: FormalCapabilityDefinition["source"] = explicit && "providerId" in explicit
    ? explicit
    : {
        kind: "environment",
        ...(explicit ?? failMissingCapabilitySource(id))
      };
  return {
    id,
    requiredForCaseIds: cases
      .filter((item) => item.requiredCapabilities.map(formalCapabilityId).includes(id))
      .map((item) => item.caseId),
    source,
    unavailableReason: `Formal capability ${id} is unavailable for this test authorization.`,
    unblockCondition: `Configure and review ${
      source.kind === "environment" ? source.variable : source.providerId
    } for the approved test environment.`
  };
});

const localRegistrationFieldCaseIds = [
  "OPEN-REG-20260807-001",
  "OPEN-REG-20260807-004",
  "OPEN-REG-20260807-006",
  "OPEN-REG-20260807-007",
  "OPEN-REG-20260807-008"
];

const uniquenessRegistrationFieldCaseIds = [
  "OPEN-REG-20260807-002",
  "OPEN-REG-20260807-003",
  "OPEN-REG-20260807-005"
];

const pageSessionGroups: FormalPageSessionGroupDefinition[] = [
  {
    sessionGroupId: "registration-fields-local-shared",
    targetRoute: "/login?tab=register",
    caseIds: localRegistrationFieldCaseIds,
    resetStrategy: "preserve_unrelated_fields",
    isolationReason: "同一注册表单的本地零写入字段校验只操作当前目标字段，其他字段状态不参与本 case 结论。",
    executionOrder: localRegistrationFieldCaseIds
  },
  {
    sessionGroupId: "registration-fields-uniqueness-shared",
    targetRoute: "/login?tab=register",
    caseIds: uniquenessRegistrationFieldCaseIds,
    resetStrategy: "preserve_unrelated_fields",
    isolationReason: "010 提交产出 pending-enterprise 后，名称、信用代码和标识唯一性校验在同一后续波次复用注册页面。",
    executionOrder: uniquenessRegistrationFieldCaseIds
  },
  {
    sessionGroupId: "registration-write-isolated",
    targetRoute: "/login?tab=register",
    caseIds: [
      "OPEN-REG-20260807-009",
      "OPEN-REG-20260807-010",
      "OPEN-REG-20260807-011",
      "OPEN-REG-20260807-014"
    ],
    resetStrategy: "new_context_per_case",
    isolationReason: "上传、OTP 和注册提交具有独立 intent、预算和外部状态，必须逐 case 隔离；011 复用 010 已验证会话属同一注册事务的决策表检查。",
    executionOrder: [
      "OPEN-REG-20260807-009",
      "OPEN-REG-20260807-010",
      "OPEN-REG-20260807-011",
      "OPEN-REG-20260807-014"
    ]
  }
];

function failMissingCapabilitySource(id: string): never {
  throw new Error(`Capability ${id} has no real environment, fixture, observer or adapter source.`);
}

export const formalExecutionManifest = defineFormalExecutionManifest({
  schemaVersion: "formal-execution-manifest-v2",
  requestId: "web/open-platform/registration-20260807",
  projectId: "open-platform",
  environment: "test",
  cases,
  capabilities,
  pageSessionGroups,
  buildEvidence: [{
    kind: "selector_contract",
    path: "tests/web/open-platform/registration-20260807/selector-contract.json"
  }, {
    kind: "source_contract",
    path: "tests/web/open-platform/registration-20260807/source-contract.json"
  }, {
    kind: "browser_response_contract",
    path: "tests/web/open-platform/registration-20260807/browser-response-contract.json"
  }, {
    kind: "test_asset",
    assetId: syntheticLicenseAssetId,
    sha256: "7d3363a1a467b98174155c190e6d4b4c3e37226ec51f910b818b8e3bb8267e61",
    scope: "registration",
    path: "test-assets/documents/open-platform/synthetic-business-license.png.b64"
  }]
});

function caseDefinition(
  caseId: string,
  title: string,
  requiredCapabilities: string[],
  requiredResources: string[] = [],
  producesResources: FormalCaseDefinition["producesResources"] = [],
  timeoutMs?: number
): FormalCaseDefinition {
  const runtimeCapabilities = requiredCapabilities.filter((id) => !buildOnlyCapabilities.has(id));
  const runtimePending = runtimeValidationPendingCaseIds.has(caseId) && runtimeCapabilities.length > 0;
  const dataWritePolicy = reusableFixtureCaseIds.has(caseId)
    ? "reusable_fixture"
    : ephemeralCleanupCaseIds.has(caseId)
      ? "ephemeral_cleanup"
      : trackedResidualCaseIds.has(caseId)
        ? "tracked_residual"
        : "no_write";
  return {
    caseId,
    title,
    requiredCapabilities: runtimeCapabilities.map((capabilityId) => {
      const transitionId = delayedCapabilityTransition(caseId, capabilityId);
      return transitionId ? { capabilityId, checkAfterTransitionId: transitionId } : capabilityId;
    }),
    requiredTestAssetIds: requiredTestAssetIdsByCaseId[caseId] ?? [],
    requiredResources,
    producesResources,
    consumesResources: [],
    requiredOperations: requiredOperationsByCaseId[caseId] ?? [],
    operationBudgets: operationBudgetsByCaseId[caseId] ?? [],
    dataWritePolicy,
    permissionProfile: requiredOperationsByCaseId[caseId]?.includes("send_test_otp")
      ? "privileged_test"
      : dataWritePolicy === "no_write"
        ? "read_only"
        : "test_write",
    implementation: runtimePending
      ? {
          status: "runtime_validation_pending",
          reachableBoundary: "Source-derived candidate is complete; runtime provider or deployed selector validation is pending.",
          pendingCapabilityIds: runtimeCapabilities
        }
      : { status: "source_complete" },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(operationEvidenceByCaseId[caseId]
      ? { operationEvidence: operationEvidenceByCaseId[caseId] }
      : {}),
    ...(executionStages(caseId) ? { executionStages: executionStages(caseId) } : {}),
    ...(sensitiveEvidenceCaseIds.has(caseId) ? { evidencePolicy: "sensitive" as const } : {})
  };
}

function delayedCapabilityTransition(caseId: string, capabilityId: string): string | undefined {
  // 014 的驳回依赖用户在管理后台的最小人工转换（human attestation），不调 API。
  if (
    caseId === "OPEN-REG-20260807-014"
    && ["registration-residual-contract"].includes(capabilityId)
  ) return rejectedTransitionId;
  return undefined;
}

function executionStages(caseId: string): FormalCaseDefinition["executionStages"] | undefined {
  if (caseId === "OPEN-REG-20260807-009") {
    return [
      "png-under-limit",
      "jpeg-under-limit",
      "jpg-under-limit",
      "unsupported-format",
      "size-clearly-over-limit"
    ].map((key) => ({
      stageId: `upload-variant-${key}-completed`,
      title: `完成独立上传参数 ${key}`
    }));
  }
  if (caseId === "OPEN-REG-20260807-010") {
    // 止于“提交受理”：跳转 register-pending 即成功，不测审核通过。
    return [{
      stageId: "registration-submitted",
      title: "合成企业申请提交并被受理（跳转待审核页）",
      producesResources: [pendingEnterpriseResource]
    }];
  }
  if (caseId === "OPEN-REG-20260807-014") {
    return [{
      stageId: "rejected-registration-submitted",
      title: "复用同手机号提交候选 B 并等待用户在管理后台驳回",
      producesResources: [pendingRejectedEnterpriseResource],
      externalTransition: {
        transitionId: rejectedTransitionId,
        kind: "human_attestation",
        actionSummary: "在管理后台驳回候选 B（最小人工），并使用冻结的合成反馈。",
        allowedOutcomes: ["rejected"],
        requiredAttestationKeys: [
          "review_completed",
          "feedback_frozen"
        ]
      }
    }, {
      stageId: "reapplication-submitted",
      title: "按反馈用同一手机号重新发起候选 C 注册",
      dependsOnStageIds: ["rejected-registration-submitted"],
      producesResources: [rejectedReviewEvidenceResource]
    }];
  }
  return undefined;
}

function registrationSubmissionEvidence(): FormalOperationEvidenceDefinition[] {
  return [
    {
      operation: "send_test_otp",
      strategy: "ui_state",
      uiContractId: "open-platform-otp-resend-countdown-v1",
      finality: "final",
      stableIdentityRequired: false
    },
    {
      operation: "upload_synthetic_file",
      strategy: "response_contract",
      responseContractId: "open-platform-upload-response-v1",
      finality: "final",
      stableIdentityRequired: true
    },
    {
      operation: "submit_registration",
      strategy: "response_contract",
      responseContractId: "open-platform-registration-submit-response-v1",
      finality: "final",
      stableIdentityRequired: true
    }
  ];
}
