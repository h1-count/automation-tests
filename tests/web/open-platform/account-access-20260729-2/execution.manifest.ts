import {
  defineFormalExecutionManifest,
  formalCapabilityId
} from "../../../../src/support/formal-execution/manifest.js";
import type {
  FormalCapabilityDefinition,
  FormalCaseDefinition
} from "../../../../src/support/formal-execution/types.js";

const cases: FormalCaseDefinition[] = [
  caseDefinition("OPEN-REG-001", "企业名称必填、字符集与长度边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-002", "已注册企业名称拦截", [
    "registration-page-selector-contract",
    "registered-company-name-fixture",
    "registration-application-readonly-query"
  ]),
  caseDefinition("OPEN-REG-003", "企业标识必填、字符集与长度边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-004", "已注册企业标识拦截", [
    "registration-page-selector-contract",
    "registered-company-identifier-fixture",
    "registration-application-readonly-query"
  ]),
  caseDefinition("OPEN-REG-005", "统一社会信用代码必填与重复拦截", [
    "registration-page-selector-contract",
    "registered-credit-code-fixture",
    "registration-application-readonly-query"
  ]),
  caseDefinition("OPEN-REG-006", "联系方式 11 位与手机号验证入口", [
    "registration-page-selector-contract",
    "registration-phone-secret-reference",
    "sensitive-input-artifact-redaction"
  ]),
  caseDefinition("OPEN-REG-007", "营业执照内容、格式与大小限制", [
    "registration-page-selector-contract",
    "synthetic-business-license-asset",
    "registration-license-upload",
    "registration-upload-response-contract",
    "registration-upload-cleanup"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-008", "注册提交条件组合阻断", [
    "registration-form-contract",
    "test-otp-contract",
    "synthetic-license-upload-contract",
    "registration-postcondition-query-contract",
    "registration-cleanup-contract",
    "registration-negative-row-fixtures"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-009", "合成企业申请受控提交与后置核对", [
    "registration-form-contract",
    "test-otp-contract",
    "synthetic-license-upload-contract",
    "registration-submit-contract",
    "registration-postcondition-query-contract",
    "registration-cleanup-contract",
    "registration-positive-fixture"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-010", "审核结果短信通知", [
    "review-state-query-contract",
    "notification-ledger-query-contract",
    "safe-recipient-compare-contract",
    "review-status-fixtures"
  ]),
  caseDefinition("OPEN-REG-011", "企业地址必填与 50 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-012", "申请人姓名必填、字符集与 20 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-013", "企业简介选填与 300 字符边界", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-014", "企业邮箱选填与格式校验", [
    "registration-page-selector-contract"
  ]),
  caseDefinition("OPEN-REG-015", "同一手机号可申请不同企业", [
    "registration-form-contract",
    "test-otp-contract",
    "synthetic-license-upload-contract",
    "registration-submit-contract",
    "registration-postcondition-query-contract",
    "registration-cleanup-contract",
    "existing-phone-enterprise-fixture",
    "registration-positive-fixture"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-016", "企业名称和信用代码与营业执照一致性", [
    "registration-page-selector-contract",
    "synthetic-business-license-asset",
    "registration-license-upload",
    "registration-license-authoritative-verification",
    "registration-upload-cleanup"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-017", "已提交企业名称和地址权威值基线核对", [
    "enterprise-authoritative-query-contract",
    "submitted-enterprise-fixture"
  ]),
  caseDefinition("OPEN-REG-018", "注册联系人默认企业管理员", [
    "enterprise-authoritative-query-contract",
    "manager-ledger-query-contract",
    "safe-identity-compare-contract",
    "approved-enterprise-fixture"
  ]),
  caseDefinition("OPEN-REG-019", "企业信息审核在 1–2 个工作日内完成", [
    "review-state-query-contract",
    "business-calendar-contract",
    "completed-review-fixture"
  ]),
  caseDefinition("OPEN-REG-020", "审核通过后额外发送平台账号密码通知", [
    "notification-ledger-query-contract",
    "safe-recipient-compare-contract",
    "approved-enterprise-fixture"
  ]),
  caseDefinition("OPEN-REG-021", "审核不通过后按反馈重新申请", [
    "review-state-query-contract",
    "registration-reapply-contract",
    "registration-postcondition-query-contract",
    "registration-residual-contract",
    "rejected-application-fixture"
  ], [], [], 600_000),
  caseDefinition("OPEN-REG-022", "已提交企业名称更新不生效且权威值不变", [
    "enterprise-authoritative-query-contract",
    "enterprise-update-contract",
    "enterprise-cleanup-contract",
    "submitted-enterprise-fixture"
  ]),
  caseDefinition("OPEN-REG-023", "同一企业恰有一个企业管理员账号", [
    "manager-ledger-query-contract",
    "safe-identity-compare-contract",
    "approved-enterprise-fixture"
  ]),
  caseDefinition("OPEN-REG-024", "已提交企业地址更新不生效且权威值不变", [
    "enterprise-authoritative-query-contract",
    "enterprise-update-contract",
    "enterprise-cleanup-contract",
    "submitted-enterprise-fixture"
  ]),
  caseDefinition("OPEN-REG-025", "首页账户入口分别进入登录页和注册页", [
    "homepage-account-entry-selector-contract"
  ], [], [], 60_000),
  caseDefinition("OPEN-REG-026", "登录后企业组名称与提交企业名称一致", [
    "approved-enterprise-session-contract",
    "enterprise-authoritative-query-contract",
    "enterprise-group-view-contract",
    "approved-enterprise-fixture",
    "approved-auth-state-path",
    "approved-auth-state-digest"
  ]),
  caseDefinition("OPEN-LOGIN-001", "受控手机号与密码登录主路径", [
    "login-page-selector-contract",
    "login-agreement-control-contract",
    "controlled-login-phone",
    "controlled-login-password",
    "sensitive-input-artifact-redaction"
  ], [], [], 600_000),
  caseDefinition("OPEN-LOGIN-002", "登录验证后默认进入 AIoT 控制台", [
    "login-page-selector-contract",
    "login-agreement-control-contract",
    "controlled-login-phone",
    "controlled-login-password",
    "sensitive-input-artifact-redaction",
    "aiot-console-landing-contract"
  ], [], [], 600_000),
  caseDefinition("OPEN-LOGIN-003", "审核通过账号的资源使用资格", [
    "approved-enterprise-session-contract",
    "approved-auth-state-path",
    "approved-auth-state-digest",
    "approved-platform-resource-contract",
    "approved-platform-resource-name",
    "approved-platform-resource-path",
    "approved-platform-resource-marker"
  ], [], [], 120_000)
];

const explicitCapabilitySources: Record<string, { variable: string; pattern: string }> = {
  "registration-page-selector-contract": {
    variable: "OPEN_PLATFORM_REGISTRATION_SELECTORS_CONFIRMED_TEST",
    pattern: "^true$"
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
  "registration-application-readonly-query": {
    variable: "OPEN_PLATFORM_REGISTRATION_READONLY_QUERY_ADAPTER_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "registration-phone-secret-reference": {
    variable: "OPEN_PLATFORM_REGISTRATION_PHONE_TEST",
    pattern: "^1[0-9]{10}$"
  },
  "sensitive-input-artifact-redaction": {
    variable: "PLAYWRIGHT_SENSITIVE_INPUT_REDACTION_TEST",
    pattern: "^true$"
  },
  "synthetic-business-license-asset": {
    variable: "OPEN_PLATFORM_REGISTRATION_LICENSE_ASSET_ID_TEST",
    pattern: "^open-platform-synthetic-business-license$"
  },
  "registration-license-upload": {
    variable: "OPEN_PLATFORM_REGISTRATION_UPLOAD_ENABLED_TEST",
    pattern: "^true$"
  },
  "registration-upload-cleanup": {
    variable: "OPEN_PLATFORM_REGISTRATION_UPLOAD_CLEANUP_ADAPTER_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "registration-upload-response-contract": {
    variable: "OPEN_PLATFORM_REGISTRATION_UPLOAD_RESPONSE_SCHEMA_TEST",
    pattern: "^safe-resource-id-v1$"
  },
  "registration-negative-row-fixtures": {
    variable: "OPEN_PLATFORM_REGISTRATION_NEGATIVE_FIXTURE_SET_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "registration-positive-fixture": {
    variable: "OPEN_PLATFORM_REGISTRATION_POSITIVE_FIXTURE_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "review-status-fixtures": {
    variable: "OPEN_PLATFORM_REVIEW_STATUS_FIXTURE_SET_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "existing-phone-enterprise-fixture": {
    variable: "OPEN_PLATFORM_EXISTING_PHONE_ENTERPRISE_FIXTURE_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "submitted-enterprise-fixture": {
    variable: "OPEN_PLATFORM_SUBMITTED_ENTERPRISE_FIXTURE_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "approved-enterprise-fixture": {
    variable: "OPEN_PLATFORM_APPROVED_ENTERPRISE_FIXTURE_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "completed-review-fixture": {
    variable: "OPEN_PLATFORM_COMPLETED_REVIEW_FIXTURE_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "rejected-application-fixture": {
    variable: "OPEN_PLATFORM_REJECTED_APPLICATION_FIXTURE_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "registration-license-authoritative-verification": {
    variable: "OPEN_PLATFORM_REGISTRATION_LICENSE_VERIFIER_TEST",
    pattern: "^[A-Za-z0-9._:-]+$"
  },
  "homepage-account-entry-selector-contract": {
    variable: "OPEN_PLATFORM_ACCOUNT_ENTRY_SELECTORS_CONFIRMED_TEST",
    pattern: "^true$"
  },
  "login-page-selector-contract": {
    variable: "OPEN_PLATFORM_LOGIN_SELECTORS_CONFIRMED_TEST",
    pattern: "^true$"
  },
  "login-agreement-control-contract": {
    variable: "OPEN_PLATFORM_LOGIN_AGREEMENT_CONFIRMED_TEST",
    pattern: "^true$"
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
  const source = explicit ?? {
    variable: `OPEN_PLATFORM_CAP_${id.replaceAll("-", "_").toUpperCase()}`,
    pattern: "^(?:1|true)$"
  };
  return {
    id,
    requiredForCaseIds: cases
      .filter((item) => item.requiredCapabilities.map(formalCapabilityId).includes(id))
      .map((item) => item.caseId),
    source: { kind: "environment", ...source },
    unavailableReason: `Formal capability ${id} is unavailable for this test authorization.`,
    unblockCondition: `Configure and review ${source.variable} for the approved test environment.`
  };
});

export const formalExecutionManifest = defineFormalExecutionManifest({
  schemaVersion: "formal-execution-manifest-v1",
  requestId: "web/open-platform/account-access-20260729-2",
  projectId: "open-platform",
  environment: "test",
  cases,
  capabilities
});

function caseDefinition(
  caseId: string,
  title: string,
  requiredCapabilities: string[],
  requiredResources: string[] = [],
  producesResources: string[] = [],
  timeoutMs?: number
): FormalCaseDefinition {
  return {
    caseId,
    title,
    requiredCapabilities,
    requiredResources,
    producesResources,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  };
}
