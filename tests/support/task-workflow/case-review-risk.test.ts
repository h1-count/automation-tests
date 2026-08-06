import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  assessCaseReviewRisk,
  caseReviewRiskDigest
} from "../../../src/support/task-workflow/caseReviewRisk.js";

function testcase(input: {
  caseId: string;
  dataStrategy?: string;
  risk?: string;
  requirement?: string;
  rule?: string;
  precondition?: string;
  operation: string;
}): string {
  return `## 测试用例：${input.caseId}

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | ${input.caseId} |
| 需求追溯编号 | ${input.requirement ?? "REQ-FLOW-001"} |
| 规则覆盖编号 | ${input.rule ?? "RULE-FLOW-001"} |
| 数据策略 | ${input.dataStrategy ?? "no_write"} |
| 风险等级 | ${input.risk ?? "中"} |

## 来源

- 此处可包含上传、OTP 和提交等高风险词，但不影响评级。

## 前置条件

- ${input.precondition ?? "打开 test 页面。"}

## 操作步骤

| 序号 | 操作 | 输入 | 预期 |
| --- | --- | --- | --- |
| 1 | ${input.operation} | 合成数据 | 可观察结果 |

## 待补充信息（missingInfo）

- 不得发送验证码、上传或提交。
`;
}

test("case risk reads executable sections instead of source or missingInfo keywords", () => {
  const assessment = assessCaseReviewRisk(testcase({
    caseId: "OPEN-REG-001",
    operation: "填写企业名称并触发校验"
  }));
  assert.equal(assessment.cases[0]?.level, "light");
  assert.equal(assessment.maxLevel, "light");
});

test("OTP entry inspection and ordinary upload are standard while actual OTP is strict", () => {
  const assessment = assessCaseReviewRisk([
    testcase({
      caseId: "OPEN-REG-001",
      risk: "高",
      precondition: "不点击获取验证码，不触发外部操作。",
      operation: "核对手机号验证入口，但不点击获取控件"
    }),
    testcase({
      caseId: "OPEN-REG-002",
      operation: "请求一次验证码并完成手机号验证"
    }),
    testcase({
      caseId: "OPEN-REG-003",
      dataStrategy: "managed_cleanup",
      operation: "选择并上传合成资产"
    })
  ]);
  assert.deepEqual(
    Object.fromEntries(assessment.cases.map((item) => [item.caseId, item.level])),
    {
      "OPEN-REG-001": "standard",
      "OPEN-REG-002": "strict",
      "OPEN-REG-003": "standard"
    }
  );
});

test("a bounded authentication-attempt still classifies password submission as strict", () => {
  const assessment = assessCaseReviewRisk(testcase({
    caseId: "OPEN-LOGIN-001",
    operation: "在独立 Context 填写受控手机号与密码，以冻结 authentication-attempt 最多提交一次"
  }));
  assert.equal(assessment.cases[0]?.level, "strict");
  assert.deepEqual(assessment.cases[0]?.reasons, ["operation:sensitive_authentication"]);
});

test("case risk digest is deterministic across package order", () => {
  const light = testcase({
    caseId: "OPEN-REG-001",
    risk: "低",
    operation: "打开注册页"
  });
  const strict = testcase({
    caseId: "OPEN-REG-002",
    dataStrategy: "tracked_residual",
    operation: "按反馈重新申请"
  });
  const first = assessCaseReviewRisk([light, strict]);
  const second = assessCaseReviewRisk([strict, light]);
  assert.equal(first.digest, second.digest);
  assert.equal(caseReviewRiskDigest(first), first.digest);
  assert.equal(first.distribution, "mixed");
  assert.deepEqual(first.counts, { light: 1, standard: 1, strict: 0 });
});

test("current open-platform packages are a read-only regression sample for v2 risk", async () => {
  const root = resolve(
    process.cwd(),
    "testcases/web/open-platform/account-access-20260803"
  );
  const assessment = assessCaseReviewRisk(await Promise.all([
    readFile(resolve(root, "cases-account-login.md"), "utf8"),
    readFile(resolve(root, "cases-account-registration.md"), "utf8")
  ]));
  assert.equal(assessment.distribution, "mixed");
  assert.equal(assessment.maxLevel, "strict");
  assert.deepEqual(assessment.counts, { light: 5, standard: 20, strict: 4 });
  assert.deepEqual(
    assessment.cases.filter((item) => item.level === "strict").map((item) => item.caseId),
    [
      "OPEN-LOGIN-20260803-001",
      "OPEN-REG-20260803-009",
      "OPEN-REG-20260803-015",
      "OPEN-REG-20260803-020"
    ]
  );
});
