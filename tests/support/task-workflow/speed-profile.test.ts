import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capReviewMode,
  defaultReviewSpeed,
  parseReviewSpeed,
  resolveReviewSpeed
} from "../../../src/support/task-workflow/speedProfile.js";
import { evaluateCandidateGate } from "../../../src/support/task-workflow/candidateGate.js";

const PLAN = [
  "# plan",
  "",
  "| 用例包 | 说明 |",
  "| --- | --- |",
  "| `cases.md` | full |",
  "",
  "## 请求默认值",
  "",
  "| 项目 | 内容 |",
  "| --- | --- |",
  "| 测试类型 | Web |",
  "| 目标环境 | test |",
  "| 数据策略 | no_write |",
  "",
  "## 请求内来源",
  "",
  "| 来源 ID | 路径 | 版本 | 用途 |",
  "| --- | --- | --- | --- |",
  "| SRC-001 | [a.docx](sources/a.docx) | `abc` | u |",
  "",
  "## 规则设计台账",
  "",
  "| RULE | REQ | sourceRef | 条件 | 预期 | 方法 | caseIds | 风险 | 结论 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| RULE-X-001 | REQ-X-001 | SRC-001 | 获取验证码入口存在 | 提供验证码入口 | 场景法 | CASE-X-001 | no_write | 已覆盖 |"
].join("\n");

const CASES = [
  "# cases",
  "",
  "> 格式：testcase-v1-layered；测试类型：Web；目标环境：test；数据策略：no_write；来源=SRC-001。",
  "",
  "## 模块：X",
  "",
  "### CASE-X-001 验证验证码入口 | P1 | 低",
  "",
  "> 规则：RULE-X-001",
  "> 前置条件：页面可打开",
  "> 差异：数据策略=no_write；来源=SRC-001",
  "",
  "| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |",
  "| --- | --- | --- | --- | --- |",
  "| — | 1 | 查看验证码获取入口 | — | 提供验证码获取入口 |"
].join("\n");

describe("speed profile defaults", () => {
  it("defaults testcase_only without writes to fast", () => {
    assert.equal(defaultReviewSpeed({ deliveryTarget: "testcase_only", writesData: false }), "fast");
  });

  it("keeps strict for writes or other delivery targets", () => {
    assert.equal(defaultReviewSpeed({ deliveryTarget: "testcase_only", writesData: true }), "strict");
    assert.equal(defaultReviewSpeed({ deliveryTarget: "full_run", writesData: false }), "strict");
  });

  it("explicit request wins over default", () => {
    assert.equal(
      resolveReviewSpeed({ requested: "balanced", deliveryTarget: "testcase_only", writesData: false }),
      "balanced"
    );
    assert.equal(
      resolveReviewSpeed({ requested: "strict", deliveryTarget: "testcase_only", writesData: false }),
      "strict"
    );
  });

  it("rejects unknown speeds", () => {
    assert.throws(() => parseReviewSpeed("turbo"));
    assert.equal(parseReviewSpeed(undefined), undefined);
    assert.equal(parseReviewSpeed("fast"), "fast");
  });
});

describe("review mode capping", () => {
  it("fast caps keyword-driven combined_with_impact to deterministic_only for no_write suites", () => {
    // 验证码 keyword in plan/cases derives combined_with_impact; fast must skip reviewers.
    assert.equal(
      capReviewMode("fast", "combined_with_impact", false),
      "deterministic_only"
    );
  });

  it("fast still reviews suites that effectively write data", () => {
    assert.equal(capReviewMode("fast", "combined_with_impact", true), "combined");
    assert.equal(capReviewMode("fast", "deterministic_only", true), "combined");
  });

  it("balanced keeps at most one combined reviewer", () => {
    assert.equal(capReviewMode("balanced", "combined_with_impact", true), "combined");
    assert.equal(capReviewMode("balanced", "combined", false), "combined");
    assert.equal(capReviewMode("balanced", "deterministic_only", false), "deterministic_only");
  });

  it("strict keeps the derived mode", () => {
    assert.equal(capReviewMode("strict", "combined_with_impact", false), "combined_with_impact");
  });
});

describe("candidate gate honors speed", () => {
  it("derives combined_with_impact on strict current behavior for captcha-mentioning suites", () => {
    const report = evaluateCandidateGate({ plan: PLAN, cases: CASES });
    assert.equal(report.reviewSpeed, "strict");
    assert.equal(report.reviewMode, "combined_with_impact");
  });

  it("fast caps the same suite to deterministic_only with a visible warning", () => {
    const report = evaluateCandidateGate({ plan: PLAN, cases: CASES, speed: "fast" });
    assert.equal(report.reviewSpeed, "fast");
    assert.equal(report.reviewMode, "deterministic_only");
    assert.ok(report.warnings.some((warning) => warning.includes("已将评审模式从")));
    assert.ok(report.warnings.some((warning) => warning.includes("关闭自动语义演进")));
  });

  it("balanced caps to combined", () => {
    const report = evaluateCandidateGate({ plan: PLAN, cases: CASES, speed: "balanced" });
    assert.equal(report.reviewMode, "combined");
  });
});
