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

const runtimeValidationPendingCaseIds = new Set([
  "OPEN-LOGIN-20260803-001",
  "OPEN-LOGIN-20260803-002",
  "OPEN-REG-20260803-007",
  "OPEN-REG-20260803-008",
  "OPEN-REG-20260803-009",
  "OPEN-REG-20260803-010",
  "OPEN-REG-20260803-015",
  "OPEN-REG-20260803-016",
  "OPEN-REG-20260803-017",
  "OPEN-REG-20260803-018",
  "OPEN-REG-20260803-019",
  "OPEN-REG-20260803-020",
  "OPEN-REG-20260803-021",
  "OPEN-REG-20260803-022",
  "OPEN-REG-20260803-023",
  "OPEN-REG-20260803-024",
  "OPEN-REG-20260803-026"
]);

const trackedResidualCaseIds = new Set([
  "OPEN-REG-20260803-007",
  "OPEN-REG-20260803-008",
  "OPEN-REG-20260803-015",
  "OPEN-REG-20260803-016",
  "OPEN-REG-20260803-021"
]);

const ephemeralCleanupCaseIds = new Set<string>();
const reusableFixtureCaseIds = new Set(["OPEN-REG-20260803-009"]);

const buildOnlyCapabilities = new Set([
  "registration-page-selector-contract",
  "company-info-readonly-selector-contract",
  "homepage-account-entry-selector-contract",
  "login-page-selector-contract",
  "login-agreement-control-contract",
  "registration-form-contract",
  "registration-submit-contract",
  "registration-residual-contract",
  "registration-license-upload",
  "sensitive-input-artifact-redaction",
  "aiot-console-landing-contract",
  "approved-platform-resource-contract"
]);

const approvedTransitionId = "open-platform-registration-approved";
const rejectedTransitionId = "open-platform-registration-rejected";
const approvedEnterpriseResource = "approved-enterprise-OPEN-REG-20260803-009";
const approvedReviewEvidenceResource = "approved-review-attestation-OPEN-REG-20260803-009";
const rejectedReviewEvidenceResource = "rejected-review-attestation-OPEN-REG-20260803-021";
const pendingApprovedEnterpriseResource = "pending-enterprise-OPEN-REG-20260803-009";
const pendingRejectedEnterpriseResource = "pending-enterprise-OPEN-REG-20260803-021";
const syntheticLicenseAssetId = "open-platform-synthetic-business-license";

const requiredTestAssetIdsByCaseId: Record<string, string[]> = {
  "OPEN-REG-20260803-007": [syntheticLicenseAssetId],
  "OPEN-REG-20260803-016": [syntheticLicenseAssetId]
};

const requiredOperationsByCaseId: Record<string, FormalCaseDefinition["requiredOperations"]> = {
  "OPEN-LOGIN-20260803-001": ["authenticate_test_account", "accept_agreement"],
  "OPEN-LOGIN-20260803-002": ["authenticate_test_account", "accept_agreement"],
  "OPEN-LOGIN-20260803-003": [],
  "OPEN-REG-20260803-007": ["upload_synthetic_file", "retain_tracked_residual"],
  "OPEN-REG-20260803-008": [
    "send_test_otp",
    "upload_synthetic_file",
    "accept_agreement",
    "submit_registration",
    "retain_tracked_residual"
  ],
  "OPEN-REG-20260803-009": [
    "send_test_otp",
    "upload_synthetic_file",
    "accept_agreement",
    "submit_registration",
    "retain_tracked_residual"
  ],
  "OPEN-REG-20260803-010": [],
  "OPEN-REG-20260803-015": [
    "send_test_otp",
    "upload_synthetic_file",
    "accept_agreement",
    "submit_registration",
    "retain_tracked_residual"
  ],
  "OPEN-REG-20260803-016": [
    "upload_synthetic_file",
    "query_postcondition",
    "retain_tracked_residual"
  ],
  "OPEN-REG-20260803-017": [],
  "OPEN-REG-20260803-018": [],
  "OPEN-REG-20260803-019": [],
  "OPEN-REG-20260803-020": [],
  "OPEN-REG-20260803-021": [
    "send_test_otp",
    "upload_synthetic_file",
    "accept_agreement",
    "submit_registration",
    "retain_tracked_residual"
  ],
  "OPEN-REG-20260803-022": [],
  "OPEN-REG-20260803-023": ["query_postcondition"],
  "OPEN-REG-20260803-024": [],
  "OPEN-REG-20260803-026": []
};

const operationBudgetsByCaseId: Record<string, NonNullable<FormalCaseDefinition["operationBudgets"]>> = {
  "OPEN-LOGIN-20260803-001": [{ operation: "authenticate_test_account", maxExecutions: 1 }],
  "OPEN-LOGIN-20260803-002": [{ operation: "authenticate_test_account", maxExecutions: 1 }],
  "OPEN-REG-20260803-007": [{ operation: "upload_synthetic_file", maxExecutions: 5 }],
  "OPEN-REG-20260803-008": [
    { operation: "send_test_otp", maxExecutions: 4 },
    { operation: "upload_synthetic_file", maxExecutions: 4 },
    { operation: "submit_registration", maxExecutions: 5 }
  ],
  "OPEN-REG-20260803-009": [
    { operation: "send_test_otp", maxExecutions: 1 },
    { operation: "upload_synthetic_file", maxExecutions: 1 },
    { operation: "submit_registration", maxExecutions: 1 }
  ],
  "OPEN-REG-20260803-015": [
    { operation: "send_test_otp", maxExecutions: 1 },
    { operation: "upload_synthetic_file", maxExecutions: 1 },
    { operation: "submit_registration", maxExecutions: 1 }
  ],
  "OPEN-REG-20260803-016": [
    { operation: "upload_synthetic_file", maxExecutions: 3 },
    { operation: "query_postcondition", maxExecutions: 3 }
  ],
  "OPEN-REG-20260803-021": [
    { operation: "send_test_otp", maxExecutions: 2 },
    { operation: "upload_synthetic_file", maxExecutions: 2 },
    { operation: "submit_registration", maxExecutions: 2 }
  ],
  "OPEN-REG-20260803-023": [{ operation: "query_postcondition", maxExecutions: 1 }]
};

const operationEvidenceByCaseId: Record<string, FormalOperationEvidenceDefinition[]> = {
  "OPEN-LOGIN-20260803-001": [
    uiStateEvidence("authenticate_test_account", "open-platform-authenticated-route-v1")
  ],
  "OPEN-LOGIN-20260803-002": [
    uiStateEvidence("authenticate_test_account", "open-platform-authenticated-route-v1")
  ],
  "OPEN-REG-20260803-007": [{
    operation: "upload_synthetic_file",
    strategy: "response_or_ui_rejection",
    responseContractId: "open-platform-upload-response-v1",
    uiContractId: "open-platform-upload-client-rejection-v1",
    finality: "final",
    stableIdentityRequired: true
  }],
  "OPEN-REG-20260803-008": [
    manualOtpEvidence(),
    responseContract("upload_synthetic_file", true),
    uiStateEvidence("submit_registration", "open-platform-registration-submit-blocked-v1")
  ],
  "OPEN-REG-20260803-009": registrationSubmissionEvidence(),
  "OPEN-REG-20260803-015": registrationSubmissionEvidence(),
  "OPEN-REG-20260803-016": [{
    operation: "upload_synthetic_file",
    strategy: "query_only",
    queryCapabilityId: "registration-license-authoritative-verification",
    finality: "final",
    stableIdentityRequired: true
  }, {
    operation: "query_postcondition",
    strategy: "query_only",
    queryCapabilityId: "registration-license-authoritative-verification",
    finality: "final",
    stableIdentityRequired: false
  }],
  "OPEN-REG-20260803-023": [{
    operation: "query_postcondition",
    strategy: "query_only",
    queryCapabilityId: "manager-ledger-query-contract",
    finality: "final",
    stableIdentityRequired: false
  }],
  "OPEN-REG-20260803-021": registrationSubmissionEvidence()
};

const sensitiveEvidenceCaseIds = new Set([
  "OPEN-LOGIN-20260803-001",
  "OPEN-LOGIN-20260803-002",
  "OPEN-REG-20260803-006",
  "OPEN-REG-20260803-007",
  "OPEN-REG-20260803-008",
  "OPEN-REG-20260803-009",
  "OPEN-REG-20260803-015",
  "OPEN-REG-20260803-016",
  "OPEN-REG-20260803-020",
  "OPEN-REG-20260803-021"
]);

const cases: FormalCaseDefinition[] = [
  caseDefinition("OPEN-REG-20260803-001", "企业名称必填、字符集与长度边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260803-002", "已注册企业名称拦截", [
    "registration-page-selector-contract",
    "registered-company-name-fixture"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-003", "企业标识必填、字符集与长度边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260803-004", "已注册企业标识拦截", [
    "registration-page-selector-contract",
    "registered-company-identifier-fixture"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-005", "统一社会信用代码必填与重复拦截", [
    "registration-page-selector-contract",
    "registered-credit-code-fixture"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-006", "联系方式 11 位与手机号验证入口", [
    "registration-page-selector-contract",
    "registration-phone-secret-reference",
    "sensitive-input-artifact-redaction"
  ]),
  caseDefinition("OPEN-REG-20260803-007", "营业执照内容、格式与大小限制", [
    "registration-page-selector-contract",
    "registration-license-upload"
  ], [], [{
    name: "registration-upload-residuals-OPEN-REG-20260803-007",
    resourceType: "custom",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260803-008", "注册提交条件组合阻断", [
    "registration-form-contract"
  ], [approvedEnterpriseResource], [{
    name: "unexpected-registration-residual-OPEN-REG-20260803-008",
    resourceType: "tenant",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260803-009", "合成企业申请受控提交与后置核对", [
    "registration-form-contract",
    "registration-submit-contract"
  ], [], [{
    name: approvedReviewEvidenceResource,
    resourceType: "custom",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260803-010", "审核结果短信通知", [], [
    approvedReviewEvidenceResource,
    rejectedReviewEvidenceResource
  ]),
  caseDefinition("OPEN-REG-20260803-011", "企业地址必填与 50 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260803-012", "申请人姓名必填、字符集与 20 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260803-013", "企业简介选填与 300 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260803-014", "企业邮箱选填与格式校验", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-20260803-015", "同一手机号可申请不同企业", [
    "registration-form-contract",
    "registration-submit-contract"
  ], [approvedEnterpriseResource], [], 600_000),
  caseDefinition("OPEN-REG-20260803-016", "企业名称和信用代码与营业执照一致性", [
    "registration-page-selector-contract",
    "registration-license-upload",
    "registration-license-authoritative-verification"
  ], [], [{
    name: "license-verification-residuals-OPEN-REG-20260803-016",
    resourceType: "custom",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260803-017", "已提交企业名称和地址权威值基线核对", [
    "company-info-readonly-selector-contract",
    "submitted-company-name-baseline",
    "submitted-company-address-baseline",
    "approved-auth-state-path",
    "approved-auth-state-digest"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-018", "注册联系人默认企业管理员", [
    "submitted-contact-name-baseline",
    "approved-auth-state-path",
    "approved-auth-state-digest"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-019", "企业信息审核在 1–2 个工作日内完成", [
    "business-calendar-contract"
  ], [
    approvedReviewEvidenceResource
  ]),
  caseDefinition("OPEN-REG-20260803-020", "审核通过后额外发送平台账号密码通知", [], [
    approvedReviewEvidenceResource,
    approvedEnterpriseResource
  ]),
  caseDefinition("OPEN-REG-20260803-021", "审核不通过后按反馈重新申请", [
    "registration-form-contract",
    "registration-submit-contract",
    "registration-residual-contract"
  ], [], [{
    name: rejectedReviewEvidenceResource,
    resourceType: "custom",
    disposition: "tracked_residual"
  }, {
    name: pendingRejectedEnterpriseResource,
    resourceType: "tenant",
    disposition: "tracked_residual"
  }], 600_000),
  caseDefinition("OPEN-REG-20260803-022", "已提交企业名称只读且与提交基线一致", [
    "company-info-readonly-selector-contract",
    "submitted-company-name-baseline",
    "approved-auth-state-path",
    "approved-auth-state-digest"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-023", "同一企业恰有一个企业管理员账号", [
    "manager-ledger-query-contract",
    "approved-enterprise-fixture"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-024", "已提交企业地址只读且与提交基线一致", [
    "company-info-readonly-selector-contract",
    "submitted-company-address-baseline",
    "approved-auth-state-path",
    "approved-auth-state-digest"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-REG-20260803-025", "首页及顶部五个账户入口", [
    "homepage-account-entry-selector-contract"
  ], [], [], 60_000),
  caseDefinition("OPEN-REG-20260803-026", "登录后企业组名称与提交企业名称一致", [
    "submitted-company-name-baseline",
    "approved-auth-state-path",
    "approved-auth-state-digest"
  ], [approvedEnterpriseResource]),
  caseDefinition("OPEN-LOGIN-20260803-001", "受控手机号与密码登录主路径", [
    "login-page-selector-contract",
    "login-agreement-control-contract",
    "controlled-login-phone",
    "controlled-login-password",
    "sensitive-input-artifact-redaction",
    "aiot-console-landing-contract"
  ], [approvedEnterpriseResource], [], 600_000),
  caseDefinition("OPEN-LOGIN-20260803-002", "登录验证后默认进入 AIoT 控制台", [
    "login-page-selector-contract",
    "login-agreement-control-contract",
    "controlled-login-phone",
    "controlled-login-password",
    "sensitive-input-artifact-redaction",
    "aiot-console-landing-contract"
  ], [approvedEnterpriseResource], [], 600_000),
  caseDefinition("OPEN-LOGIN-20260803-003", "审核通过账号的资源使用资格", [
    "approved-auth-state-path",
    "approved-auth-state-digest",
    "approved-platform-resource-contract",
    "approved-platform-resource-name",
    "approved-platform-resource-path",
    "approved-platform-resource-marker"
  ], [approvedEnterpriseResource], [], 120_000)
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
      path: "tests/web/open-platform/account-access-20260803/selector-contract.json",
      expectedDigest: "87bdfdc8b31626b81866fdf2c4575551871bfa4fb0b6af4212af231df6063628",
      scopeId: "registration"
    }
  },
  "company-info-readonly-selector-contract": {
    kind: "provider",
    providerId: "selector_evidence",
    configuration: {
      path: "tests/web/open-platform/account-access-20260803/selector-contract.json",
      expectedDigest: "87bdfdc8b31626b81866fdf2c4575551871bfa4fb0b6af4212af231df6063628",
      scopeId: "companyInfo"
    }
  },
  "registered-company-name-fixture": {
    variable: "OPEN_PLATFORM_REGISTERED_COMPANY_NAME_TEST",
    pattern: "^.+$"
  },
  "registered-company-identifier-fixture": {
    variable: "OPEN_PLATFORM_REGISTERED_COMPANY_IDENTIFIER_TEST",
    pattern: "^[a-z0-9]{3,6}$"
  },
  "registered-credit-code-fixture": {
    variable: "OPEN_PLATFORM_REGISTERED_CREDIT_CODE_TEST",
    pattern: "^[A-Z0-9]{18}$"
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
  },
  "registration-license-upload": {
    variable: "OPEN_PLATFORM_REGISTRATION_UPLOAD_ENABLED_TEST",
    pattern: "^true$"
  },
  "registration-upload-cleanup": {
    variable: "OPEN_PLATFORM_REGISTRATION_UPLOAD_CLEANUP_ADAPTER_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "review-status-fixtures": {
    kind: "provider",
    providerId: "review_status_fixtures"
  },
  "approved-enterprise-fixture": {
    kind: "provider",
    providerId: "approved_enterprise_fixture"
  },
  "completed-review-fixture": {
    kind: "provider",
    providerId: "completed_review_fixture"
  },
  "registration-license-authoritative-verification": {
    kind: "provider",
    providerId: "registration_license_authoritative_verifier"
  },
  "review-state-query-contract": {
    kind: "provider",
    providerId: "review_state_query"
  },
  "registration-reapply-contract": {
    kind: "provider",
    providerId: "registration_reapplication_query"
  },
  "notification-ledger-query-contract": {
    kind: "provider",
    providerId: "notification_ledger_query"
  },
  "business-calendar-contract": {
    kind: "provider",
    providerId: "business_calendar_verifier"
  },
  "manager-ledger-query-contract": {
    kind: "provider",
    providerId: "manager_ledger_query"
  },
  "enterprise-group-view-contract": {
    kind: "provider",
    providerId: "enterprise_group_view_verifier"
  },
  "homepage-account-entry-selector-contract": {
    kind: "provider",
    providerId: "selector_evidence",
    configuration: {
      path: "tests/web/open-platform/account-access-20260803/selector-contract.json",
      expectedDigest: "87bdfdc8b31626b81866fdf2c4575551871bfa4fb0b6af4212af231df6063628",
      scopeId: "homepageFiveEntries"
    }
  },
  "login-page-selector-contract": {
    kind: "provider",
    providerId: "selector_evidence",
    configuration: {
      path: "tests/web/open-platform/account-access-20260803/selector-contract.json",
      expectedDigest: "87bdfdc8b31626b81866fdf2c4575551871bfa4fb0b6af4212af231df6063628",
      scopeId: "login"
    }
  },
  "login-agreement-control-contract": {
    kind: "provider",
    providerId: "selector_evidence",
    configuration: {
      path: "tests/web/open-platform/account-access-20260803/selector-contract.json",
      expectedDigest: "87bdfdc8b31626b81866fdf2c4575551871bfa4fb0b6af4212af231df6063628",
      scopeId: "login"
    }
  },
  "controlled-login-phone": {
    variable: "OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST",
    pattern: "^1[0-9]{10}$"
  },
  "controlled-login-password": {
    variable: "OPEN_PLATFORM_PRODUCT_ADMIN_PASSWORD_TEST",
    pattern: "^[\\s\\S]+$"
  },
  "approved-auth-state-path": {
    variable: "OPEN_PLATFORM_AUTH_STATE_PATH_TEST",
    pattern: "^.+$"
  },
  "approved-auth-state-digest": {
    variable: "OPEN_PLATFORM_APPROVED_AUTH_STATE_SHA256_TEST",
    pattern: "^[a-f0-9]{64}$"
  },
  "submitted-company-name-baseline": {
    variable: "OPEN_PLATFORM_SUBMITTED_COMPANY_NAME_TEST",
    pattern: "^[^\\r\\n|]{1,100}$"
  },
  "submitted-company-address-baseline": {
    variable: "OPEN_PLATFORM_SUBMITTED_COMPANY_ADDRESS_TEST",
    pattern: "^[^\\r\\n|]{1,100}$"
  },
  "submitted-contact-name-baseline": {
    variable: "OPEN_PLATFORM_SUBMITTED_CONTACT_NAME_TEST",
    pattern: "^[^\\r\\n|]{1,100}$"
  },
  "aiot-console-landing-contract": {
    variable: "OPEN_PLATFORM_AIOT_CONSOLE_LANDING_CONFIRMED_TEST",
    pattern: "^true$"
  },
  "approved-platform-resource-contract": {
    variable: "OPEN_PLATFORM_APPROVED_RESOURCE_CONFIRMED_TEST",
    pattern: "^true$"
  },
  "approved-platform-resource-name": {
    variable: "OPEN_PLATFORM_APPROVED_RESOURCE_NAME_TEST",
    pattern: "^(?:产品接入系统|产品运营系统|产品服务系统)$"
  },
  "approved-platform-resource-path": {
    variable: "OPEN_PLATFORM_APPROVED_RESOURCE_PATH_TEST",
    pattern: "^/(?:integration|device|service)(?:/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$"
  },
  "approved-platform-resource-marker": {
    variable: "OPEN_PLATFORM_APPROVED_RESOURCE_MARKER_TEST",
    pattern: "^[^\\r\\n|]{1,80}$"
  }
};

const capabilityIds = [...new Set(cases.flatMap((item) =>
  item.requiredCapabilities.map(formalCapabilityId)
))];
const capabilities: FormalCapabilityDefinition[] = capabilityIds.map((id) => {
  const explicit = explicitCapabilitySources[id];
  const source: FormalCapabilityDefinition["source"] = explicit && "providerId" in explicit
    ? explicit.providerId === "file_evidence" || explicit.providerId === "auth_state"
      ? explicit
      : {
          kind: "provider",
          providerId: "module_adapter",
          configuration: {
            modulePath: `tests/web/open-platform/account-access-20260803/capability-adapters/${id}.ts`,
            exportName: "capability"
          }
        }
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
    unavailableReason: id === "password-authentication-intent-contract"
      ? "Password authentication lacks stable intent identity, a single-attempt budget, and deterministic recovery."
      : `Formal capability ${id} is unavailable for this test authorization.`,
    unblockCondition: id === "password-authentication-intent-contract"
      ? "Implement stable authentication intent identity, one-attempt budget and fencing, plus postcondition query and reconciliation for unknown outcomes; then rerun script review and readiness."
      : `Configure and review ${
            source.kind === "environment" ? source.variable : source.providerId
          } for the approved test environment.`
  };
});

const localRegistrationFieldCaseIds = [
  "OPEN-REG-20260803-001",
  "OPEN-REG-20260803-003",
  "OPEN-REG-20260803-006",
  "OPEN-REG-20260803-011",
  "OPEN-REG-20260803-012",
  "OPEN-REG-20260803-013",
  "OPEN-REG-20260803-014"
];

const uniquenessRegistrationFieldCaseIds = [
  "OPEN-REG-20260803-002",
  "OPEN-REG-20260803-004",
  "OPEN-REG-20260803-005"
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
    isolationReason: "审核通过合成企业就绪后，名称、标识和信用代码唯一性校验在同一后续波次复用注册页面。",
    executionOrder: uniquenessRegistrationFieldCaseIds
  },
  {
    sessionGroupId: "account-entry-login-isolated",
    targetRoute: "/",
    caseIds: [
      "OPEN-REG-20260803-025",
      "OPEN-LOGIN-20260803-001",
      "OPEN-LOGIN-20260803-002",
      "OPEN-LOGIN-20260803-003"
    ],
    resetStrategy: "new_context_per_case",
    isolationReason: "入口路由、认证态与敏感凭据不得跨 case 共享。",
    executionOrder: [
      "OPEN-REG-20260803-025",
      "OPEN-LOGIN-20260803-001",
      "OPEN-LOGIN-20260803-002",
      "OPEN-LOGIN-20260803-003"
    ]
  },
  {
    sessionGroupId: "registration-write-isolated",
    targetRoute: "/login?tab=register",
    caseIds: [
      "OPEN-REG-20260803-007",
      "OPEN-REG-20260803-008",
      "OPEN-REG-20260803-009",
      "OPEN-REG-20260803-015",
      "OPEN-REG-20260803-021"
    ],
    resetStrategy: "new_context_per_case",
    isolationReason: "上传、OTP 和注册提交具有独立 intent、预算和外部状态，必须逐 case 隔离。",
    executionOrder: [
      "OPEN-REG-20260803-007",
      "OPEN-REG-20260803-008",
      "OPEN-REG-20260803-009",
      "OPEN-REG-20260803-015",
      "OPEN-REG-20260803-021"
    ]
  },
  {
    sessionGroupId: "registration-lifecycle-isolated",
    targetRoute: "/",
    caseIds: [
      "OPEN-REG-20260803-010",
      "OPEN-REG-20260803-016",
      "OPEN-REG-20260803-017",
      "OPEN-REG-20260803-018",
      "OPEN-REG-20260803-019",
      "OPEN-REG-20260803-020",
      "OPEN-REG-20260803-022",
      "OPEN-REG-20260803-023",
      "OPEN-REG-20260803-024",
      "OPEN-REG-20260803-026"
    ],
    resetStrategy: "new_context_per_case",
    isolationReason: "审核、通知、权限和企业状态依赖命名资源与外部转换，不传递页面对象。",
    executionOrder: [
      "OPEN-REG-20260803-010",
      "OPEN-REG-20260803-016",
      "OPEN-REG-20260803-017",
      "OPEN-REG-20260803-018",
      "OPEN-REG-20260803-019",
      "OPEN-REG-20260803-020",
      "OPEN-REG-20260803-022",
      "OPEN-REG-20260803-023",
      "OPEN-REG-20260803-024",
      "OPEN-REG-20260803-026"
    ]
  }
];

function failMissingCapabilitySource(id: string): never {
  throw new Error(`Capability ${id} has no real environment, fixture, observer or adapter source.`);
}

export const formalExecutionManifest = defineFormalExecutionManifest({
  schemaVersion: "formal-execution-manifest-v2",
  requestId: "web/open-platform/account-access-20260803",
  projectId: "open-platform",
  environment: "test",
  cases,
  capabilities,
  pageSessionGroups,
  buildEvidence: [{
    kind: "selector_contract",
    path: "tests/web/open-platform/account-access-20260803/selector-contract.json"
  }, {
    kind: "source_contract",
    path: "tests/web/open-platform/account-access-20260803/source-contract.json"
  }, {
    kind: "browser_response_contract",
    path: "tests/web/open-platform/account-access-20260803/browser-response-contract.json"
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
    producesResources: reusableFixtureCaseIds.has(caseId)
      ? [{
          name: `approved-enterprise-${caseId}`,
          resourceType: "tenant",
          disposition: "reusable_fixture",
          baselineContractId: "approved-enterprise-v1",
          baselineVersion: "1",
          leaseMode: "exclusive",
          maxPoolSize: 5,
          retirementPolicy: "validate_quarantine_replace"
        }, {
          name: `pending-enterprise-${caseId}`,
          resourceType: "tenant",
          disposition: "tracked_residual"
        }, {
          name: `registration-transient-${caseId}`,
          resourceType: "custom",
          disposition: "tracked_residual"
        }, ...producesResources]
      : producesResources,
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
  const approvedCases = new Set([
    "OPEN-LOGIN-20260803-001",
    "OPEN-LOGIN-20260803-002",
    "OPEN-LOGIN-20260803-003",
    "OPEN-REG-20260803-002",
    "OPEN-REG-20260803-004",
    "OPEN-REG-20260803-005",
    "OPEN-REG-20260803-010",
    "OPEN-REG-20260803-015",
    "OPEN-REG-20260803-017",
    "OPEN-REG-20260803-018",
    "OPEN-REG-20260803-019",
    "OPEN-REG-20260803-020",
    "OPEN-REG-20260803-022",
    "OPEN-REG-20260803-023",
    "OPEN-REG-20260803-024",
    "OPEN-REG-20260803-026"
  ]);
  const approvedCapability = /(?:approved|submitted|review|notification|manager|controlled-login|aiot-console|registered-|existing-phone)/u
    .test(capabilityId);
  if (approvedCases.has(caseId) && approvedCapability) return approvedTransitionId;
  if (
    caseId === "OPEN-REG-20260803-021"
    && ["review-state-query-contract", "registration-reapply-contract"].includes(capabilityId)
  ) return rejectedTransitionId;
  return undefined;
}

function executionStages(caseId: string): FormalCaseDefinition["executionStages"] | undefined {
  if (["OPEN-LOGIN-20260803-001", "OPEN-LOGIN-20260803-002"].includes(caseId)) {
    return [{
      stageId: "password-login-intent-recorded",
      title: "冻结一次账号密码登录提交 intent"
    }, {
      stageId: "password-login-outcome-observed",
      title: "记录已认证路由终态",
      dependsOnStageIds: ["password-login-intent-recorded"]
    }];
  }
  if (caseId === "OPEN-REG-20260803-007") {
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
  if (caseId === "OPEN-REG-20260803-016") {
    return ["matching", "name_mismatch", "credit_code_mismatch"].map((key) => ({
      stageId: `license-verification-${key}-completed`,
      title: `完成证照一致性参数 ${key}`
    }));
  }
  if (caseId === "OPEN-REG-20260803-008") {
    return [
      "required_field_missing",
      "agreement_missing",
      "uniqueness_unsatisfied",
      "license_missing",
      "phone_unverified"
    ].map((key) => ({
      stageId: `negative-registration-${key}-completed`,
      title: `完成独立负向注册参数 ${key}`
    }));
  }
  if (caseId === "OPEN-REG-20260803-009") {
    return [{
      stageId: "registration-submitted",
      title: "提交审核通过分支的合成企业申请",
      producesResources: [pendingApprovedEnterpriseResource],
      externalTransition: {
        transitionId: approvedTransitionId,
        kind: "human_attestation",
        actionSummary: "立即在测试环境审核通过该合成企业，并将测试账号配置到本地 Secret。",
        allowedOutcomes: ["approved"],
        requiredAttestationKeys: [
          "review_completed",
          "review_sms_received",
          "credential_sms_received",
          "credentials_configured"
        ]
      }
    }, {
      stageId: "approved-baseline-verified",
      title: "验证审核通过状态并开放后续登录分支",
      dependsOnStageIds: ["registration-submitted"],
      producesResources: [approvedEnterpriseResource, approvedReviewEvidenceResource]
    }];
  }
  if (caseId === "OPEN-REG-20260803-021") {
    return [{
      stageId: "original-registration-submitted",
      title: "提交审核驳回分支的原始合成企业申请",
      producesResources: [pendingRejectedEnterpriseResource],
      externalTransition: {
        transitionId: rejectedTransitionId,
        kind: "human_attestation",
        actionSummary: "立即在测试环境驳回该合成申请，并使用冻结的合成反馈。",
        allowedOutcomes: ["rejected"],
        requiredAttestationKeys: [
          "review_completed",
          "review_sms_received",
          "feedback_frozen",
          "feedback_address_confirmed"
        ]
      }
    }, {
      stageId: "reapplication-submitted",
      title: "按反馈重新发起企业注册",
      dependsOnStageIds: ["original-registration-submitted"],
      producesResources: [rejectedReviewEvidenceResource]
    }];
  }
  return undefined;
}

function responseContract(
  operation: FormalOperationEvidenceDefinition["operation"],
  stableIdentityRequired: boolean
): FormalOperationEvidenceDefinition {
  return {
    operation,
    strategy: "response_contract",
    responseContractId: "open-platform-upload-response-v1",
    finality: "final",
    stableIdentityRequired
  };
}

function queryOnly(
  operation: FormalOperationEvidenceDefinition["operation"],
  queryCapabilityId: string,
  stableIdentityRequired: boolean
): FormalOperationEvidenceDefinition {
  return {
    operation,
    strategy: "query_only",
    queryCapabilityId,
    finality: "final",
    stableIdentityRequired
  };
}

function registrationSubmissionEvidence(): FormalOperationEvidenceDefinition[] {
  return [
    manualOtpEvidence(),
    responseContract("upload_synthetic_file", true),
    {
      operation: "submit_registration",
      strategy: "response_contract",
      responseContractId: "open-platform-registration-submit-response-v1",
      finality: "final",
      stableIdentityRequired: true
    }
  ];
}

function uiStateEvidence(
  operation: FormalOperationEvidenceDefinition["operation"],
  uiContractId: string
): FormalOperationEvidenceDefinition {
  return {
    operation,
    strategy: "ui_state",
    uiContractId,
    finality: "final",
    stableIdentityRequired: false
  };
}

function manualOtpEvidence(): FormalOperationEvidenceDefinition {
  return {
    operation: "send_test_otp",
    strategy: "ui_state",
    uiContractId: "open-platform-otp-resend-countdown-v1",
    finality: "final",
    stableIdentityRequired: false
  };
}
