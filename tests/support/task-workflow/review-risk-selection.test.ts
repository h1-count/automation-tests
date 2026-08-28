import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewPolicy,
  deriveReviewRiskSelection
} from "../../../src/support/task-workflow/reviewPolicy.js";
import { buildWorkflowDefinition } from "../../../src/support/task-workflow/definition.js";
import { isDeterministicReviewMode } from "../../../src/support/task-workflow/types.js";

test("light profile uses deterministic checks without a model reviewer", () => {
  const selection = deriveReviewRiskSelection({
    planText: [
      "# Login visibility",
      "",
      "## 测试范围",
      "",
      "### 包含",
      "",
      "| REQ-LOGIN-001 | 登录入口可见 |",
      "| RULE-LOGIN-001 | 只读导航 |",
      "| DEMO-LOGIN-001 | 查看登录入口 |",
      "",
      "### 不包含",
      "",
      "- 短信验证码、文件上传和安全挑战。"
    ].join("\n"),
    writesData: false,
    capabilities: ["web"],
    casePackages: ["cases-login.md"]
  });

  assert.equal(selection.profile, "light");
  assert.deepEqual(selection.recommendedRoles, []);
  assert.deepEqual(selection.reasons, [
    "bounded_structure:req=1;rule=1;case=1;capabilities=1;packages=1"
  ]);
});

test("current boundary category labels do not create a false strict review", () => {
  const policy = buildReviewPolicy({
    planText: `# 设计索引

## 环境、静态资产与数据安全边界

| 类别 | 已确定边界 | 未决项或门禁 |
| --- | --- | --- |
| 权限与安全 | 只读 | 无 |
`,
    writesData: false,
    capabilities: ["web"],
    casePackages: ["cases-registration.md"]
  });
  assert.equal(policy.riskProfile, "light");
  assert.deepEqual(policy.requiredRoles, []);
});

test("new workflow definitions pin the selected risk profile and reviewer reason", () => {
  const definition = buildWorkflowDefinition({
    requestId: "web/demo/simple-login",
    planDigest: "a".repeat(64),
    planText: [
      "## 测试范围",
      "| REQ-LOGIN-001 | 登录入口 |",
      "| RULE-LOGIN-001 | 入口可见 |",
      "| DEMO-LOGIN-001 | 查看入口 |"
    ].join("\n"),
    capabilities: ["web"],
    casePackages: ["cases-login.md"]
  });

  assert.equal(definition.reviewPolicy?.riskProfile, "light");
  assert.ok(definition.reviewPolicy !== undefined && isDeterministicReviewMode(definition.reviewPolicy));
  assert.equal(definition.reviewPolicy.mode, "deterministic_only");
  assert.deepEqual(definition.reviewPolicy?.requiredRoles, []);
  assert.deepEqual(definition.reviewPolicy?.selectionReasons, [
    "bounded_structure:req=1;rule=1;case=1;capabilities=1;packages=1"
  ]);
  assert.equal(
    definition.activities.find((activity) => activity.id === "readiness")
      ?.metadata?.readinessPolicyVersion,
    "execution-readiness-v1"
  );
  assert.deepEqual(
    definition.activities
      .filter((activity) => activity.id === "readiness")
      .map((activity) => activity.id),
    ["readiness"]
  );
});

test("standard profile selects one combined reviewer from structural complexity", () => {
  const selection = deriveReviewRiskSelection({
    planText: [
      "| REQ-READ-001 | 页面 A |",
      "| RULE-READ-001 | 页面 A 可见 |",
      "| DEMO-READ-001 | 查看页面 A |"
    ].join("\n"),
    writesData: false,
    capabilities: ["web"],
    casePackages: ["cases-page-a.md", "cases-page-b.md"]
  });

  assert.equal(selection.profile, "standard");
  assert.deepEqual(selection.recommendedRoles, ["combined"]);
  assert.deepEqual(selection.reasons, ["multiple_case_packages:2"]);
});

test("strict profile records stable markers and selects impact review", () => {
  const selection = deriveReviewRiskSelection({
    planText: [
      "## 安全与数据边界",
      "",
      "- 风险标记：短信验证码、上传营业执照、管理员权限、安全挑战。",
      "",
      "| RULE-REG-001 | 获取验证码 | 受控执行 |",
      "| RULE-REG-002 | 上传营业执照 | 受控执行 |"
    ].join("\n"),
    writesData: true,
    capabilities: ["iot"],
    casePackages: ["cases-device-security.md"]
  });

  assert.equal(selection.profile, "strict");
  assert.deepEqual(selection.recommendedRoles, ["combined", "impact"]);
  assert.deepEqual(selection.reasons, [
    "device_capability:iot",
    "plan_marker:otp",
    "plan_marker:permission",
    "plan_marker:security_challenge",
    "case_package_marker:device",
    "case_package_marker:security",
    "writes_data",
    "plan_marker:upload"
  ]);
});

test("review policy rejects missing current risk context", () => {
  assert.throws(
    () => buildReviewPolicy({ writesData: false }),
    /requires planText, capabilities and casePackages/
  );
});

test("explicit roles override automatic selection when no data write is present", () => {
  const policy = buildReviewPolicy({
    reviewerRoles: ["interaction"],
    writesData: false,
    planText: "| RULE-AUTH-001 | 短信验证码 | 受控执行 |",
    capabilities: ["web"],
    casePackages: ["cases-auth.md"]
  });

  assert.deepEqual(policy.requiredRoles, ["interaction"]);
  assert.equal(policy.riskProfile, "strict");
  assert.ok(policy.selectionReasons?.includes("explicit_roles"));
});

test("a data write always adds impact to normalized explicit roles", () => {
  const policy = buildReviewPolicy({
    reviewerRoles: [" design ", "requirements", "design", "impact"],
    writesData: true,
    planText: "",
    capabilities: ["web"],
    casePackages: ["cases-main.md"]
  });

  assert.deepEqual(policy.requiredRoles, ["design", "requirements", "impact"]);
  assert.equal(policy.riskProfile, "standard");
});

test("risk reasons and recommended roles remain de-duplicated and ordered", () => {
  const first = deriveReviewRiskSelection({
    planText: [
      "| RULE-AUTH-001 | 获取验证码 | 受控执行 |",
      "| RULE-AUTH-002 | 获取验证码 | 受控执行 |"
    ].join("\n"),
    writesData: false,
    capabilities: ["web", "web"],
    casePackages: ["cases-otp.md", "cases-otp.md"]
  });
  const second = deriveReviewRiskSelection({
    planText: [
      "| RULE-AUTH-001 | 获取验证码 | 受控执行 |",
      "| RULE-AUTH-002 | 获取验证码 | 受控执行 |"
    ].join("\n"),
    writesData: false,
    capabilities: ["web", "web"],
    casePackages: ["cases-otp.md", "cases-otp.md"]
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.recommendedRoles, ["combined", "impact"]);
  assert.deepEqual(first.reasons, [
    "plan_marker:otp",
    "case_package_marker:otp"
  ]);
});
