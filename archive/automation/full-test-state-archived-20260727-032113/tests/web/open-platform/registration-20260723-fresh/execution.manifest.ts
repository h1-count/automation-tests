import { defineFormalExecutionManifest } from "../../../../src/support/formal-execution/manifest.js";

const writeCaseIds = [
  "OPEN-REG-002",
  "OPEN-REG-003",
  "OPEN-REG-004",
  "OPEN-REG-005",
  "OPEN-REG-006",
  "OPEN-REG-007"
];

const titles: Record<string, string> = {
  "OPEN-REG-001": "企业名称必填校验",
  "OPEN-REG-002": "重复企业名称提示",
  "OPEN-REG-003": "注册账号默认管理员",
  "OPEN-REG-004": "重复企业标识提示",
  "OPEN-REG-005": "重复信用代码提示",
  "OPEN-REG-006": "同手机号注册多个企业",
  "OPEN-REG-007": "控制台统一登录后默认进入 AIoT 控制台",
  "OPEN-REG-008": "企业地址必填校验",
  "OPEN-REG-009": "企业标识必填校验",
  "OPEN-REG-010": "申请人必填校验",
  "OPEN-REG-011": "手机号必填校验",
  "OPEN-REG-012": "企业简介选填空值",
  "OPEN-REG-013": "企业邮箱选填空值",
  "OPEN-REG-014": "统一社会信用代码必填校验",
  "OPEN-REG-015": "营业执照必填校验",
  "OPEN-REG-016": "验证码输入与获取入口可见",
  "OPEN-REG-017": "用户协议确认控件可见",
  "OPEN-REG-018": "注册提交入口可见",
  "OPEN-REG-019": "企业名称长度边界",
  "OPEN-REG-020": "企业名称内容规则",
  "OPEN-REG-021": "企业地址长度边界",
  "OPEN-REG-022": "企业标识长度边界",
  "OPEN-REG-023": "企业标识内容规则",
  "OPEN-REG-024": "申请人长度边界",
  "OPEN-REG-025": "申请人内容规则",
  "OPEN-REG-026": "手机号格式校验",
  "OPEN-REG-027": "企业简介长度边界",
  "OPEN-REG-028": "企业邮箱常用格式有效输入",
  "OPEN-REG-029": "企业邮箱常用格式无效输入"
};

export const formalExecutionManifest = defineFormalExecutionManifest({
  schemaVersion: "formal-execution-manifest-v1",
  requestId: "web/open-platform/registration-20260723-fresh",
  projectId: "open-platform",
  environment: "test",
  capabilities: [{
    id: "registration-test-phone",
    requiredForCaseIds: writeCaseIds,
    source: {
      kind: "environment",
      variable: "OPEN_PLATFORM_REGISTRATION_PHONE_TEST",
      pattern: "^1[3-9]\\d{9}$"
    },
    unavailableReason: "专用测试手机号不可用；仅六条注册写入用例被阻塞。",
    unblockCondition: "在本机 Secret 中配置格式有效的 OPEN_PLATFORM_REGISTRATION_PHONE_TEST。"
  }],
  cases: Object.keys(titles).map((caseId) => {
    const requiredCapabilities = writeCaseIds.includes(caseId) ? ["registration-test-phone"] : [];
    const requiredResources = caseId === "OPEN-REG-003"
      ? []
      : ["OPEN-REG-002", "OPEN-REG-004", "OPEN-REG-005"].includes(caseId)
        ? ["company-a", "registration-auth", "synthetic-upload"]
        : caseId === "OPEN-REG-006"
          ? ["company-a", "registration-auth", "synthetic-upload"]
          : caseId === "OPEN-REG-007"
            ? ["company-a", "registration-auth"]
            : [];
    const producesResources = caseId === "OPEN-REG-003"
      ? ["company-a", "registration-auth", "synthetic-upload"]
      : caseId === "OPEN-REG-006"
        ? ["company-b"]
        : [];
    return {
      caseId,
      title: titles[caseId]!,
      requiredCapabilities,
      requiredResources,
      producesResources,
      timeoutMs: writeCaseIds.includes(caseId) ? 360_000 : undefined
    };
  })
});
