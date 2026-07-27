import assert from "node:assert/strict";
import test from "node:test";
import { parseRuleRecords, summarizeRuleCoverage, validateRuleCoverage } from "../../scripts/testcase-quality-gate.ts";

const strictPlan = `
## 需求追溯矩阵
| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 / 原子用例关联 | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-AUTH-001 | PRD 3.1 | P0 | 登录规则 | 适用 | AUTH-LOGIN-001 | 已覆盖 | 无 |

## 规则覆盖台账
> 结构版本：rule-coverage-v1
| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-AUTH-001 | REQ-AUTH-001 | PRD 3.1 验证码 | 输入边界 | 验证码过期 | 展示过期提示且禁止登录 | 等价类与边界：有效、过期 | 适用 | 已覆盖 | AUTH-LOGIN-001 | 资料明确 |
| RULE-AUTH-002 | REQ-AUTH-001 | PRD 3.2 协议 | 页面交互 | 未勾选协议 | 登录按钮禁用 | 交互断言：禁用态可见 | 适用 | 已覆盖 | AUTH-LOGIN-001 | 资料明确 |
`;

test("解析规则台账并输出规则级统计", () => {
  const rules = parseRuleRecords(strictPlan);
  assert.equal(rules.length, 2);
  assert.equal(rules[0]?.type, "输入边界");
  assert.match(summarizeRuleCoverage(strictPlan), /适用规则 2；已覆盖 2/);
});

test("严格规则台账通过双向映射和设计证据", () => {
  assert.deepEqual(validateRuleCoverage(strictPlan, [{ caseId: "AUTH-LOGIN-001", ruleIds: ["RULE-AUTH-001", "RULE-AUTH-002"], source: "cases-login.md" }]), []);
});

test("登录注册规则覆盖时效频控、错误次数、交互分支和弱网恢复", () => {
  const loginPlan = `${strictPlan}
| RULE-AUTH-003 | REQ-AUTH-001 | PRD 3.1 频控 | 异常与恢复 | 连续请求验证码 | 显示频控反馈且可在冷却后重试 | 异常路径与恢复路径：频控、冷却后重试 | 适用 | 已覆盖 | AUTH-LOGIN-002 | 资料明确 |
| RULE-AUTH-004 | REQ-AUTH-001 | PRD 3.3 密码 | 业务规则 | 密码连续错误达到阈值 | 账号锁定或显示资料定义的错误反馈 | 决策表：错误次数与结果 | 适用 | 已覆盖 | AUTH-LOGIN-003 | 资料明确 |
| RULE-AUTH-005 | REQ-AUTH-001 | 原型 登录页 | 页面交互 | 从注册页返回登录页 | 返回到资料承诺的页面且输入状态符合规则 | 交互断言：返回路径与焦点 | 适用 | 已覆盖 | AUTH-LOGIN-004 | 原型明确 |
| RULE-AUTH-006 | REQ-AUTH-001 | PRD 3.4 自动提交 | 分支/决策 | 验证码输入完成或未完成 | 仅完成时自动提交，未完成不提交 | 决策表：输入长度与提交结果 | 适用 | 已覆盖 | AUTH-LOGIN-005 | 资料明确 |
| RULE-AUTH-007 | REQ-AUTH-001 | PRD 3.5 第三方 | 分支/决策 | 第三方账号已绑定或未绑定 | 已绑定登录，未绑定进入绑定或提示分支 | 决策表：绑定状态与去向 | 适用 | 已覆盖 | AUTH-LOGIN-006 | 资料明确 |
| RULE-AUTH-008 | REQ-AUTH-001 | PRD 3.6 网络 | 异常与恢复 | 弱网提交登录 | 给出可观察反馈，恢复网络后不重复提交 | 异常路径与恢复路径：重试与幂等 | 适用 | 已覆盖 | AUTH-LOGIN-007 | 资料明确 |`;
  const cases = [
    { caseId: "AUTH-LOGIN-001", ruleIds: ["RULE-AUTH-001", "RULE-AUTH-002"], source: "cases-login.md" },
    { caseId: "AUTH-LOGIN-002", ruleIds: ["RULE-AUTH-003"], source: "cases-login.md" },
    { caseId: "AUTH-LOGIN-003", ruleIds: ["RULE-AUTH-004"], source: "cases-login.md" },
    { caseId: "AUTH-LOGIN-004", ruleIds: ["RULE-AUTH-005"], source: "cases-login.md" },
    { caseId: "AUTH-LOGIN-005", ruleIds: ["RULE-AUTH-006"], source: "cases-login.md" },
    { caseId: "AUTH-LOGIN-006", ruleIds: ["RULE-AUTH-007"], source: "cases-login.md" },
    { caseId: "AUTH-LOGIN-007", ruleIds: ["RULE-AUTH-008"], source: "cases-login.md" }
  ];
  assert.deepEqual(validateRuleCoverage(loginPlan, cases), []);
});

test("适用规则缺用例、用例未回链及边界证据缺失均失败", () => {
  const broken = strictPlan.replace("等价类与边界：有效、过期", "场景法").replace("AUTH-LOGIN-001 | 资料明确 |", "无 | 资料明确 |");
  const issues = validateRuleCoverage(broken, [{ caseId: "AUTH-LOGIN-001", ruleIds: ["RULE-AUTH-001", "RULE-AUTH-002"], source: "cases-login.md" }]);
  assert.ok(issues.some((issue) => issue.name === "规则设计证据"));
  assert.ok(issues.some((issue) => issue.name === "适用规则关联"));
  assert.ok(issues.some((issue) => issue.name === "RULE ↔ caseId 双向追溯"));
});

test("不适用和待补充必须给出依据", () => {
  const invalid = strictPlan.replace("| RULE-AUTH-002 | REQ-AUTH-001 | PRD 3.2 协议 | 页面交互 | 未勾选协议 | 登录按钮禁用 | 交互断言：禁用态可见 | 适用 | 已覆盖 | AUTH-LOGIN-001 | 资料明确 |", "| RULE-AUTH-002 | REQ-AUTH-001 | PRD 3.2 协议 | 页面交互 | 未勾选协议 | 登录按钮禁用 | 交互断言：禁用态可见 | 待补充 | 待补充 | 无 | 无 |");
  assert.ok(validateRuleCoverage(invalid, [{ caseId: "AUTH-LOGIN-001", ruleIds: ["RULE-AUTH-001"], source: "cases-login.md" }]).some((issue) => issue.name === "规则适用性依据"));
});

test("历史计划不升级为严格失败", () => {
  const issues = validateRuleCoverage("## 需求追溯矩阵\n", []);
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.detail ?? "", /历史请求/);
});
