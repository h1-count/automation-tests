import { defineFormalExecutionManifest } from "../../../../src/support/formal-execution/manifest.js";

// 业务 Oracle authority：以已登记的 sources 资料为依据（手机号+密码登录、11位格式验证、进入控制台）。
const docxAuthority = [
  {
    kind: "registered_source" as const,
    materialId: "aiot-platform-project-document",
    sectionId: "platform-home-and-registration",
    sourceSha256:
      "64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b"
  }
];
// 原型 authority：登录页字段与交互（模式切换、tab、错误提示）。
const prototypeAuthority = [
  {
    kind: "registered_source" as const,
    materialId: "open-platform-axure-prototype",
    sectionId: "prototype-account-login",
    sourceSha256:
      "0c21f0f7c472d2fd0cf712201c46cfd584ec5607cfe6a4b01d778c5243bc08e6"
  }
];

const caseIds = [
  "OPEN-PLATFORM-LOGIN-001",
  "OPEN-PLATFORM-LOGIN-002",
  "OPEN-PLATFORM-LOGIN-003",
  "OPEN-PLATFORM-LOGIN-004",
  "OPEN-PLATFORM-LOGIN-005",
  "OPEN-PLATFORM-LOGIN-006",
  "OPEN-PLATFORM-LOGIN-007"
];

export const formalExecutionManifest = defineFormalExecutionManifest({
  schemaVersion: "formal-execution-manifest-v3",
  requestId: "web/open-platform/login-local-20260810",
  projectId: "open-platform",
  environment: "test",
  buildEvidence: [
    {
      kind: "source_contract",
      path: "tests/web/open-platform/login-local-20260810/selector-evidence.json",
      sha256:
        "596fc7ceac0dd050873e9cba6961c689df777ba7eecb825edb490781b8e7cbf3"
    }
  ],
  capabilities: [
    {
      id: "open-platform-test-account",
      requiredForCaseIds: ["OPEN-PLATFORM-LOGIN-001", "OPEN-PLATFORM-LOGIN-004"],
      source: {
        kind: "environment",
        variable: "OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST"
      },
      unavailableReason: "测试账号未在 .env 配置",
      unblockCondition:
        "在 .env 配置 OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST 与 OPEN_PLATFORM_PRODUCT_ADMIN_PASSWORD_TEST（用户已确认本地 dev 可用）"
    }
  ],
  cases: [
    {
      caseId: "OPEN-PLATFORM-LOGIN-001",
      title: "账号登录正向成功进入控制台",
      requiredCapabilities: ["open-platform-test-account"],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "test_write",
      requiredOperations: ["authenticate_test_account"],
      operationBudgets: [
        { operation: "authenticate_test_account", maxExecutions: 1 }
      ],
      dataWritePolicy: "ephemeral_cleanup",
      operationEvidence: [
        { operation: "authenticate_test_account", strategy: "ui_state", finality: "final", stableIdentityRequired: false, uiContractId: "login-result-ui" }
      ],
      businessOracles: [
        {
          oracleId: "login-success-console",
          ruleRef: "RULE-LOGIN-003",
          observationKind: "dom",
          authorities: docxAuthority,
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "sensitive"
    },
    {
      caseId: "OPEN-PLATFORM-LOGIN-002",
      title: "账号登录空手机号阻止登录",
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: [],
      operationBudgets: [],
      dataWritePolicy: "no_write",
      businessOracles: [
        {
          oracleId: "empty-phone-blocked",
          ruleRef: "RULE-LOGIN-004",
          observationKind: "dom",
          authorities: prototypeAuthority,
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "standard"
    },
    {
      caseId: "OPEN-PLATFORM-LOGIN-003",
      title: "账号登录空密码阻止登录",
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: [],
      operationBudgets: [],
      dataWritePolicy: "no_write",
      businessOracles: [
        {
          oracleId: "empty-password-blocked",
          ruleRef: "RULE-LOGIN-005",
          observationKind: "dom",
          authorities: prototypeAuthority,
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "standard"
    },
    {
      caseId: "OPEN-PLATFORM-LOGIN-004",
      title: "账号登录错误密码登录失败",
      requiredCapabilities: ["open-platform-test-account"],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "test_write",
      requiredOperations: ["authenticate_test_account"],
      operationBudgets: [
        { operation: "authenticate_test_account", maxExecutions: 1 }
      ],
      dataWritePolicy: "ephemeral_cleanup",
      operationEvidence: [
        { operation: "authenticate_test_account", strategy: "ui_state", finality: "final", stableIdentityRequired: false, uiContractId: "login-result-ui" }
      ],
      businessOracles: [
        {
          oracleId: "wrong-password-failed",
          ruleRef: "RULE-LOGIN-006",
          observationKind: "dom",
          authorities: prototypeAuthority,
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "sensitive"
    },
    {
      caseId: "OPEN-PLATFORM-LOGIN-005",
      title: "账号登录非11位手机号阻止登录",
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: [],
      operationBudgets: [],
      dataWritePolicy: "no_write",
      businessOracles: [
        {
          oracleId: "invalid-phone-format-blocked",
          ruleRef: "RULE-LOGIN-007",
          observationKind: "dom",
          authorities: docxAuthority,
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "standard"
    },
    {
      caseId: "OPEN-PLATFORM-LOGIN-006",
      title: "账号登录与验证码登录模式切换",
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: [],
      operationBudgets: [],
      dataWritePolicy: "no_write",
      businessOracles: [
        {
          oracleId: "mode-switch-stable",
          ruleRef: "RULE-LOGIN-001",
          observationKind: "dom",
          authorities: prototypeAuthority,
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "standard"
    },
    {
      caseId: "OPEN-PLATFORM-LOGIN-007",
      title: "登录与注册 tab 切换",
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: [],
      operationBudgets: [],
      dataWritePolicy: "no_write",
      businessOracles: [
        {
          oracleId: "tab-switch-stable",
          ruleRef: "RULE-LOGIN-002",
          observationKind: "dom",
          authorities: prototypeAuthority
        }
      ],
      implementation: { status: "source_complete" },
      evidencePolicy: "standard"
    }
  ],
  pageSessionGroups: [
    {
      sessionGroupId: "GROUP-ACCOUNT-LOGIN",
      targetRoute: "/login",
      caseIds,
      resetStrategy: "new_context_per_case",
      isolationReason:
        "认证与表单用例独立 Browser Context，避免会话与字段状态串扰",
      // 用户裁决 MRR-IMP-002：001 先于 004 执行，隔离错误密码的锁定计数对正向登录的波及。
      executionOrder: [
        "OPEN-PLATFORM-LOGIN-001",
        "OPEN-PLATFORM-LOGIN-006",
        "OPEN-PLATFORM-LOGIN-007",
        "OPEN-PLATFORM-LOGIN-002",
        "OPEN-PLATFORM-LOGIN-003",
        "OPEN-PLATFORM-LOGIN-005",
        "OPEN-PLATFORM-LOGIN-004"
      ]
    }
  ]
});
