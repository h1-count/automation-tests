import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  candidateSourceImpact,
  candidateReviewRoles,
  evaluateCandidateGate
} from "../../../src/support/task-workflow/candidateGate.js";
import {
  isPolicyAutoNoWriteSubject
} from "../../../src/support/task-workflow/workflowManager.js";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";
import { parseReviewBatchScope,
  hasCompleteReviewBatchScope
} from "../../../src/support/task-workflow/reviewBatchScope.js";
import { recordFormalDecision } from "./formalDecisionFixture.js";

const sourceDigest = "a".repeat(64);

function plan(dataStrategy = "no_write", environment = "test"): string {
  return `# Demo

> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。
> 用例格式：testcase-v1-layered。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/demo/request |
| 测试类型 | Web |
| 目标环境 | ${environment} |
| 数据策略 | ${dataStrategy} |

## 测试范围

- 展示页面。

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-DEMO-001 | [需求](/tmp/demo-spec.pdf)；第 1 页 | ${sourceDigest} | 展示规则 |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-DEMO-001 | SRC-DEMO-001；第 1 页 | 页面展示欢迎信息 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001；第 1 页 | 用户打开页面 | 页面展示欢迎信息 | 场景法 | CASE-DEMO-001 | 无 | 已覆盖 |

## 需求歧义与未定义预期

- 无。

## 缺口与风险

- 无。

## 评审与正式决定

| 类型 | subjectDigest / 输入摘要 | 结论或决定 | 说明 |
| --- | --- | --- | --- |
`;
}

function cases(_ignoredRows = "", dataStrategy = "no_write", environment = "test"): string {
  const risk = environment === "production" ? "高" : "低";
  return `> 结构版本：testcase-v1-layered。

# 用例集：Demo

> 测试类型：Web ｜ 默认环境：${environment} ｜ 默认数据策略：${dataStrategy}
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 0 条 ｜ 高风险 ${risk === "高" ? "1" : "0"} 条 ｜ 参数化 0 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 页面展示 | CASE-DEMO-001 | 验证页面展示欢迎信息 | P1 | ${risk} |

## 模块：页面展示

<details open>
<summary>CASE-DEMO-001｜验证页面展示欢迎信息｜P1｜${risk}风险</summary>

> 规则：RULE-DEMO-001
> 前置条件：页面可访问

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 打开页面 | 无 | 页面展示欢迎信息 |

</details>
`;
}


let findingsCounter = 0;

async function writeReviewerFindings(
  root: string,
  name: string,
  conclusion: "converged" | "findings_present" = "converged"
): Promise<string> {
  const path = resolve(root, `${name}-reviewer-findings.md`);
  await writeFile(path, [
    "# Reviewer Findings",
    "",
    "## 结论",
    "",
    conclusion,
    "",
    "## 发现项",
    "",
    ...(conclusion === "converged"
      ? ["无"]
      : ["| 编号 | 类别 | 位置 | 发现 | 处置建议 |", "| --- | --- | --- | --- | --- |", "| F-01 | 语义演进 | 位置 | 发现 | 处置 |"]),
    ""
  ].join("\n"), "utf8");
  return path;
}

test("no_write cases with business write verbs are blocked at the candidate gate", () => {
  const writeCase = cases()
    .replace("| — | 1 | 打开页面 | 无 | 页面展示欢迎信息 |",
      "| — | 1 | 打开页面 | 无 | 页面展示欢迎信息 |\n| — | 2 | 编辑产品信息后回到产品页 | 临时修改 | 更新时间刷新 |");
  const report = evaluateCandidateGate({ plan: plan(), cases: writeCase });
  assert.ok(report.issues.some((issue) =>
    issue.includes("CASE-DEMO-001") && issue.includes("写动词") && issue.includes("no_write")
  ));
  const cleanReport = evaluateCandidateGate({ plan: plan(), cases: cases() });
  assert.equal(cleanReport.issues.some((issue) => issue.includes("写动词")), false);
});

test("no_write permits document inspection but blocks executable create and API calls", () => {
  const inspection = cases().replace("打开页面", "核对创建产品 API 路径与请求方式");
  assert.equal(evaluateCandidateGate({ plan: plan(), cases: inspection }).issues.some((issue) => issue.includes("写动词")), false);
  for (const action of ["打开创建产品入口", "查看未上传图片产品的列表记录", "查看提交前状态"]) {
    const candidate = cases().replace("打开页面", action);
    assert.equal(evaluateCandidateGate({ plan: plan(), cases: candidate }).issues.some((issue) => issue.includes("写动词")), false, action);
  }
  const fieldValidation = cases().replace("打开页面", "输入手机号并失焦校验，不提交表单");
  assert.equal(evaluateCandidateGate({ plan: plan(), cases: fieldValidation }).reviewMode, "deterministic_only");
  for (const action of ["发送 POST 创建请求", "调用创建产品接口", "点击创建并提交", "编辑产品信息并保存", "删除记录"]) {
    const candidate = cases().replace("打开页面", action);
    assert.ok(evaluateCandidateGate({ plan: plan(), cases: candidate }).issues.some((issue) => issue.includes("写动词")), action);
  }
});

test("required-field rules without an empty-input data row raise a coverage warning", () => {
  const requiredPlan = plan().replace(
    "| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001；第 1 页 | 用户打开页面 |",
    "| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001；第 1 页 | 产品名称必填、≤60 字符 |"
  );
  const parameterizedCases = cases()
    .replace("> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 0 条",
      "> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 1 条")
    .replace("| — | 1 | 打开页面 | 无 | 页面展示欢迎信息 |",
      "| D01 | 1 | 输入名称并触发校验 | 60 个合法字符 | 提示通过 |\n| D02 | 1 | 输入名称并触发校验 | 61 个字符 | 提示长度超限 |");
  const warnReport = evaluateCandidateGate({ plan: requiredPlan, cases: parameterizedCases });
  assert.ok(warnReport.warnings.some((warning) =>
    warning.includes("RULE-DEMO-001") && warning.includes("空值输入数据行")
  ));
  const coveredCases = parameterizedCases.replace(
    "| D02 | 1 | 输入名称并触发校验 | 61 个字符 | 提示长度超限 |",
    "| D02 | 1 | 输入名称并触发校验 | 61 个字符 | 提示长度超限 |\n| D03 | 1 | 输入名称并触发校验 | 名称留空 | 提示必填 |"
  ).replace("> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 1 条",
    "> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 1 条");
  const okReport = evaluateCandidateGate({ plan: requiredPlan, cases: coveredCases });
  assert.equal(okReport.warnings.some((warning) => warning.includes("空值输入数据行")), false);
});

test("candidate gate keeps a lean design deterministic", () => {
  const report = evaluateCandidateGate({ plan: plan(), cases: cases() });
  assert.deepEqual(report.issues, []);
  assert.equal(report.profile, "lean");
  assert.equal(report.reviewMode, "deterministic_only");
  assert.deepEqual(candidateReviewRoles(report), []);
});

test("candidate gate rejects an unsupported testcase marker", () => {
  const planText = plan();
  const casesText = cases().replace("testcase-v1-layered", "testcase-v1");
  const report = evaluateCandidateGate({ plan: planText, cases: casesText });
  assert.ok(report.issues.some((issue) => issue.includes("testcase-v1-layered")));
});

test("lean reviewer failure is waived once with a durable warning", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-gate-lean-review-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/lean-review";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  const sourcePath = resolve(root, "demo-spec.pdf");
  const source = Buffer.from("demo requirement", "utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  const planText = plan()
    .replace("web/demo/request", requestId)
    .replace("/tmp/demo-spec.pdf", sourcePath)
    .replace(sourceDigest, sourceSha)
    .replace("- 无。", "- 待确认展示文案。");
  const casesText = cases();
  await mkdir(requestRoot, { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(resolve(requestRoot, "plan.md"), planText, "utf8");
  await writeFile(resolve(requestRoot, "cases.md"), casesText, "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "testcase_only"
  });
  const sourceSelection = await manager.startActivity("source-selection", "test");
  await manager.succeedActivity("source-selection", {
    claimToken: sourceSelection.claimToken,
    verification: "source selected"
  });
  const generation = await manager.startActivity("candidate-generation", "test");
  await manager.publishArtifactsAndSucceed("candidate-generation", {
    claimToken: generation.claimToken,
    publishId: "candidate-generation-test",
    verification: "candidate generated",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: planText
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: casesText
    }]
  });
  const gate = await manager.startActivity("candidate-gate", "test");
  const evaluated = await manager.succeedCandidateGate(gate.claimToken);
  assert.equal(evaluated.report.reviewMode, "combined");
  await manager.startReviewBatch({ batchId: "REV-LEAN-01" });
  await manager.dispatchReviewer({
    activityId: "case-review-combined",
    batchId: "REV-LEAN-01",
    role: "combined",
    agentTaskId: "lean-reviewer"
  });
  const view = await manager.failReviewer({
    activityId: "case-review-combined",
    batchId: "REV-LEAN-01",
    summary: "reviewer temporarily unavailable"
  });
  assert.equal(view.activities["case-review-combined"]?.state, "CANCELLED");
  assert.equal(view.activities["case-review-combined"]?.outcome, "waived_with_warning");
  assert.equal(view.activities["case-review-resolution"]?.state, "READY");
  assert.equal(
    (await manager.events()).filter((event) => event.type === "ReviewerWaived").length,
    1
  );
  assert.equal((await readFile(manager.planPath, "utf8")), planText);
});

test("ordinary cleanup writes keep lean cases but require impact review", () => {
  const report = evaluateCandidateGate({
    plan: plan("ephemeral_cleanup"),
    cases: cases("", "ephemeral_cleanup")
  });
  assert.deepEqual(report.issues, []);
  assert.equal(report.profile, "lean");
  assert.equal(report.effectiveWritesData, true);
  assert.equal(report.reviewMode, "combined_with_impact");
  assert.deepEqual(candidateReviewRoles(report), ["combined", "impact"]);
});

test("resume activates a frozen targeted review batch after current evolution", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-gate-review-activation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/review-activation";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  const sourcePath = resolve(root, "review-activation-spec.pdf");
  const source = Buffer.from("review activation requirement", "utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  const planText = plan("ephemeral_cleanup")
    .replace("web/demo/request", requestId)
    .replace("/tmp/demo-spec.pdf", sourcePath)
    .replace(sourceDigest, sourceSha)
    .replace(
      "## 评审与正式决定",
      "## 多角色评审记录\n\n- 待评审。\n\n## 评审与正式决定"
    );
  const casesText = cases("", "ephemeral_cleanup")
    .replace("打开页面", "创建隔离测试数据");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(resolve(requestRoot, "plan.md"), planText, "utf8");
  await writeFile(resolve(requestRoot, "cases.md"), casesText, "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "testcase_only"
  });
  const sourceSelection = await manager.startActivity("source-selection", "test");
  await manager.succeedActivity("source-selection", {
    claimToken: sourceSelection.claimToken,
    verification: "source selected"
  });
  const generation = await manager.startActivity("candidate-generation", "test");
  await manager.publishArtifactsAndSucceed("candidate-generation", {
    claimToken: generation.claimToken,
    publishId: "review-activation-candidate",
    verification: "candidate generated",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: planText
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: casesText
    }]
  });
  const candidateGate = await manager.startActivity("candidate-gate", "test");
  const evaluated = await manager.succeedCandidateGate(candidateGate.claimToken);
  assert.equal(evaluated.report.reviewMode, "combined_with_impact");

  const baseBatchId = "REV-ACTIVATION-BASE";
  await manager.startReviewBatch({ batchId: baseBatchId });
  for (const role of ["combined", "impact"] as const) {
    const activityId = `case-review-${role}`;
    const agentTaskId = `${baseBatchId}-${role}`;
    await manager.dispatchReviewer({ activityId, batchId: baseBatchId, role, agentTaskId });
    await manager.submitReviewer({
      activityId,
      batchId: baseBatchId,
      role,
      planEvidenceRef: manager.planPath,
      agentTaskId,
      findingsPath: await writeReviewerFindings(manager.workspaceRoot, `findings-${++findingsCounter}`)
    });
  }
  const resolution = await manager.startActivity("case-review-resolution", "test");
  const reviewedPlan = planText.replace(
    "- 待评审。",
    "- reviewer 请求补充执行行继承契约。"
  );
  await manager.publishArtifactsAndSucceed("case-review-resolution", {
    claimToken: resolution.claimToken,
    publishId: "review-activation-resolution",
    verification: "review requested one evolution",
    outcome: "evolve",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: reviewedPlan
    }]
  });
  const evolution = await manager.startActivity("case-review-evolution", "test");
  const evolvedPlan = reviewedPlan.replace(
    "reviewer 请求补充执行行继承契约。",
    "reviewer 已确认执行行继承契约。"
  );
  const evolvedCases = casesText.replaceAll(
    "页面展示欢迎信息",
    "页面展示欢迎信息且页面可继续操作"
  );
  await manager.publishArtifactsAndSucceed("case-review-evolution", {
    claimToken: evolution.claimToken,
    publishId: "review-activation-evolution",
    verification: "inheritance contract published",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: evolvedPlan
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: evolvedCases
    }]
  });

  const nextBatchId = "REV-ACTIVATION-TARGETED";
  await manager.startReviewBatch({
    batchId: nextBatchId,
    activityIds: ["case-review-impact"],
    affectedRefs: ["CASE-DEMO-001", "RULE-DEMO-001"],
    baseBatchId,
    reason: "execution governance inheritance changed"
  });
  const history = await readFile(manager.history.historyPath, "utf8");
  const lines = history.trimEnd().split("\n");
  const activation = JSON.parse(lines.at(-1)!) as {
    type: string;
    payload: { reason?: string };
  };
  assert.equal(activation.type, "ActivitiesInvalidated");
  assert.equal(activation.payload.reason, "activate_evolved_review_batch");
  await writeFile(manager.history.historyPath, `${lines.slice(0, -1).join("\n")}\n`, "utf8");
  await rm(resolve(root, ".local/test-task-runtime"), { recursive: true, force: true });

  const recovered = new DurableWorkflowManager(requestId, root);
  assert.equal((await recovered.gate()).activities["case-review-impact"]?.state, "SUCCEEDED");
  const resumed = await recovered.resume("recover targeted review activation");
  assert.equal(resumed.activities["case-review-impact"]?.state, "READY");
  assert.equal(resumed.activities["case-review-combined"]?.state, "SUCCEEDED");
  assert.ok((await recovered.events()).some((event) =>
    event.type === "ActivitiesInvalidated"
    && event.payload.reason === "activate_evolved_review_batch"
  ));
});

test("strict profile requires explicit per-case source, environment, data, and risk", () => {
  const report = evaluateCandidateGate({
    plan: plan("no_write", "production"),
    cases: cases("", "no_write", "production")
  });
  assert.equal(report.profile, "strict");
  assert.equal(report.reviewMode, "combined_with_impact");
  assert.deepEqual(report.issues, []);
});

test("strict reviewer retries once and then blocks execution", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-gate-strict-review-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/strict-review";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  const sourcePath = resolve(root, "strict-spec.pdf");
  const source = Buffer.from("strict requirement", "utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  const planText = plan("no_write", "production")
    .replace("web/demo/request", requestId)
    .replace("/tmp/demo-spec.pdf", sourcePath)
    .replace(sourceDigest, sourceSha);
  const casesText = `${cases([
    "| 目标环境 | production |",
    "| 数据策略 | no_write |",
    "| 风险等级 | 高 |"
  ].join("\n"), "no_write", "production")}`;
  await mkdir(requestRoot, { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(resolve(requestRoot, "plan.md"), planText, "utf8");
  await writeFile(resolve(requestRoot, "cases.md"), casesText, "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "testcase_only"
  });
  const sourceSelection = await manager.startActivity("source-selection", "test");
  await manager.succeedActivity("source-selection", {
    claimToken: sourceSelection.claimToken,
    verification: "source selected"
  });
  const generation = await manager.startActivity("candidate-generation", "test");
  await manager.publishArtifactsAndSucceed("candidate-generation", {
    claimToken: generation.claimToken,
    publishId: "strict-candidate-generation-test",
    verification: "candidate generated",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: planText
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: casesText
    }]
  });
  const gate = await manager.startActivity("candidate-gate", "test");
  const evaluated = await manager.succeedCandidateGate(gate.claimToken);
  assert.equal(evaluated.report.profile, "strict");
  assert.equal(evaluated.report.reviewMode, "combined_with_impact");
  await manager.startReviewBatch({ batchId: "REV-STRICT-01" });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await manager.dispatchReviewer({
      activityId: "case-review-combined",
      batchId: "REV-STRICT-01",
      role: "combined",
      agentTaskId: "strict-reviewer"
    });
    const view = await manager.failReviewer({
      activityId: "case-review-combined",
      batchId: "REV-STRICT-01",
      summary: `strict reviewer unavailable ${attempt}`,
      retryAt: new Date(Date.now() - 1).toISOString()
    });
    assert.equal(
      view.activities["case-review-combined"]?.state,
      attempt === 1 ? "READY" : "BLOCKED"
    );
  }
});

test("policy_auto_no_write_v1 accepts only fully proven test/pre read-only scope", () => {
  const safe = {
    schemaVersion: "execution-authorization-v1",
    mode: "request",
    environment: "pre",
    dataWritePolicy: "no_write",
    allowedOperations: ["authenticate_test_account", "query_postcondition"],
    deferredCases: [],
    capabilityEvidence: [{ available: true }],
    externalTransitions: [],
    resourceBudgets: [{ resourceType: "account", maxCreates: 0 }],
    caseScopes: [{
      dataWritePolicy: "no_write",
      permissionProfile: "read_only",
      requiredOperations: ["query_postcondition"],
      producesResources: []
    }]
  };
  assert.equal(isPolicyAutoNoWriteSubject(safe, true), true);
  assert.equal(isPolicyAutoNoWriteSubject({
    ...safe,
    allowedOperations: ["query_postcondition"],
    caseScopes: [{
      dataWritePolicy: "no_write",
      permissionProfile: "read_only",
      requiredOperations: ["query_postcondition"],
      producesResources: []
    }]
  }, true), true, "anonymous read-only is eligible without an authentication operation");

  for (const [label, unsafe] of [
    ["upload", { ...safe, allowedOperations: ["upload_synthetic_file"] }],
    ["OTP", { ...safe, allowedOperations: ["send_test_otp"] }],
    ["device", { ...safe, allowedOperations: ["invoke_test_device_action"] }],
    ["production", { ...safe, environment: "production" }],
    ["deferred", { ...safe, deferredCases: [{ caseId: "CASE-DEMO-001" }] }],
    ["write-policy drift", { ...safe, dataWritePolicy: "ephemeral_cleanup" }],
    ["permission drift", {
      ...safe,
      caseScopes: [{
        dataWritePolicy: "no_write",
        permissionProfile: "write",
        requiredOperations: ["query_postcondition"],
        producesResources: []
      }]
    }]
  ] as const) {
    assert.equal(isPolicyAutoNoWriteSubject(unsafe, true), false, label);
  }
});

test("request source digest drift invalidates only linked rules and cases", () => {
  const previous = plan();
  const current = previous.replace(sourceDigest, "b".repeat(64));
  const impact = candidateSourceImpact(previous, current);
  assert.deepEqual(impact.changedSourceIds, ["SRC-DEMO-001"]);
  assert.deepEqual(impact.affectedRuleIds, ["RULE-DEMO-001"]);
  assert.deepEqual(impact.affectedCaseIds, ["CASE-DEMO-001"]);
  assert.equal(impact.fullReplanRequired, false);
});

test("single-reviewer current evolution auto-activates the review activity without manual invalidate", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-gate-single-reviewer-activation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/single-reviewer-activation";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  const sourcePath = resolve(root, "single-reviewer-spec.pdf");
  const source = Buffer.from("single reviewer requirement", "utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  const planText = plan()
    .replace("web/demo/request", requestId)
    .replace("/tmp/demo-spec.pdf", sourcePath)
    .replace(sourceDigest, sourceSha)
    .replace("- 展示页面。", "- 展示页面。\n- 状态流转规则。")
    .replace(
      "## 评审与正式决定",
      "## 多角色评审记录\n\n- 待评审。\n\n## 评审与正式决定"
    );
  const casesText = cases();
  await mkdir(requestRoot, { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(resolve(requestRoot, "plan.md"), planText, "utf8");
  await writeFile(resolve(requestRoot, "cases.md"), casesText, "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "testcase_only"
  });
  const sourceSelection = await manager.startActivity("source-selection", "test");
  await manager.succeedActivity("source-selection", {
    claimToken: sourceSelection.claimToken,
    verification: "source selected"
  });
  const generation = await manager.startActivity("candidate-generation", "test");
  await manager.publishArtifactsAndSucceed("candidate-generation", {
    claimToken: generation.claimToken,
    publishId: "single-reviewer-candidate",
    verification: "candidate generated",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: planText
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: casesText
    }]
  });
  const candidateGate = await manager.startActivity("candidate-gate", "test");
  const evaluated = await manager.succeedCandidateGate(candidateGate.claimToken);
  // 单 review 活动：no_write + 状态流转 marker → combined 模式，无 impact 活动
  assert.equal(evaluated.report.reviewMode, "combined");

  const baseBatchId = "REV-SINGLE-BASE";
  await manager.startReviewBatch({ batchId: baseBatchId });
  await manager.dispatchReviewer({
    activityId: "case-review-combined",
    batchId: baseBatchId,
    role: "combined",
    agentTaskId: `${baseBatchId}-combined`
  });
  await manager.submitReviewer({
    activityId: "case-review-combined",
    batchId: baseBatchId,
    role: "combined",
    planEvidenceRef: manager.planPath,
    agentTaskId: `${baseBatchId}-combined`,
    findingsPath: await writeReviewerFindings(manager.workspaceRoot, `findings-${++findingsCounter}`, "findings_present")
  });
  const resolution = await manager.startActivity("case-review-resolution", "test");
  const reviewedPlan = planText.replace("- 待评审。", "- reviewer 请求补充继承契约。");
  await manager.publishArtifactsAndSucceed("case-review-resolution", {
    claimToken: resolution.claimToken,
    publishId: "single-reviewer-resolution",
    verification: "review requested one evolution",
    outcome: "evolve",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: reviewedPlan
    }]
  });
  const evolution = await manager.startActivity("case-review-evolution", "test");
  const evolvedCases = casesText.replaceAll("页面展示欢迎信息", "页面展示欢迎信息且可继续操作");
  const evolvedPlan = reviewedPlan.replace(
    "- reviewer 请求补充继承契约。",
    "- reviewer 已确认继承契约。"
  );
  await manager.publishArtifactsAndSucceed("case-review-evolution", {
    claimToken: evolution.claimToken,
    publishId: "single-reviewer-evolution",
    verification: "evolved testcase revision",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: evolvedPlan
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: evolvedCases
    }]
  });

  // 单 review 活动（full 模式、无 baseBatchId）的演进复审批次必须被自动激活，
  // 不再需要手工 activity-invalidate（EXP-260F23257EEE 的 workaround 场景）。
  await manager.startReviewBatch({
    batchId: "REV-SINGLE-NEXT",
    activityIds: ["case-review-combined"],
    reason: "single reviewer evolution re-review"
  });
  const history = await readFile(manager.history.historyPath, "utf8");
  const last = JSON.parse(history.trimEnd().split("\n").at(-1)!) as {
    type: string;
    payload: { reason?: string };
  };
  assert.equal(last.type, "ActivitiesInvalidated");
  assert.equal(last.payload.reason, "activate_evolved_review_batch");
  assert.equal(
    (await manager.gate()).activities["case-review-combined"]?.state,
    "READY"
  );
});

test("current formal decision refreshes the review epoch so later batches are not permanently blocked", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-gate-epoch-refresh-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/epoch-refresh";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  const sourcePath = resolve(root, "epoch-refresh-spec.pdf");
  const source = Buffer.from("epoch refresh requirement", "utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  const planText = plan()
    .replace("web/demo/request", requestId)
    .replace("/tmp/demo-spec.pdf", sourcePath)
    .replace(sourceDigest, sourceSha)
    .replace("- 展示页面。", "- 展示页面。\n- 状态流转规则。")
    .replace(
      "## 评审与正式决定",
      "## 多角色评审记录\n\n- 待评审。\n\n## 评审与正式决定"
    );
  const casesText = cases();
  await mkdir(requestRoot, { recursive: true });
  await writeFile(sourcePath, source);
  await writeFile(resolve(requestRoot, "plan.md"), planText, "utf8");
  await writeFile(resolve(requestRoot, "cases.md"), casesText, "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases.md"]
  });
  const sourceSelection = await manager.startActivity("source-selection", "test");
  await manager.succeedActivity("source-selection", {
    claimToken: sourceSelection.claimToken,
    verification: "source selected"
  });
  const generation = await manager.startActivity("candidate-generation", "test");
  await manager.publishArtifactsAndSucceed("candidate-generation", {
    claimToken: generation.claimToken,
    publishId: "epoch-refresh-candidate",
    verification: "candidate generated",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: planText
    }, {
      targetPath: `testcases/${requestId}/cases.md`,
      content: casesText
    }]
  });
  const candidateGate = await manager.startActivity("candidate-gate", "test");
  await manager.succeedCandidateGate(candidateGate.claimToken);

  const batchBeforeDecision = "REV-EPOCH-BEFORE";
  await manager.startReviewBatch({ batchId: batchBeforeDecision });
  const beforeScope = parseReviewBatchScope(
    [...(await manager.events())].reverse().find((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === batchBeforeDecision
    )!.payload.scope
  );
  assert.equal(beforeScope.schemaVersion, "review-batch-scope-v1");

  await manager.dispatchReviewer({
    activityId: "case-review-combined",
    batchId: batchBeforeDecision,
    role: "combined",
    agentTaskId: `${batchBeforeDecision}-combined`
  });
  await manager.submitReviewer({
    activityId: "case-review-combined",
    batchId: batchBeforeDecision,
    role: "combined",
    planEvidenceRef: manager.planPath,
    agentTaskId: `${batchBeforeDecision}-combined`,
    findingsPath: await writeReviewerFindings(manager.workspaceRoot, `findings-${++findingsCounter}`)
  });
  const resolution = await manager.startActivity("case-review-resolution", "test");
  await manager.publishArtifactsAndSucceed("case-review-resolution", {
    claimToken: resolution.claimToken,
    publishId: "epoch-refresh-resolution",
    verification: "review converged",
    outcome: "converged",
    artifacts: [{
      targetPath: `testcases/${requestId}/plan.md`,
      content: planText
    }]
  });

  const confirmation = await manager.gate();
  assert.equal(confirmation.activities["case-confirmation"]?.state, "READY");
  const subjectDigest = await manager.callbackSubjectDigest("case-confirmation");
  await manager.requestCallback({
    activityId: "case-confirmation",
    callbackId: "confirm-epoch",
    subjectDigest,
    kind: "case_confirmation"
  });
  await recordFormalDecision(manager, "case-confirmation", subjectDigest, "accepted");
  await manager.resolveCallback({
    activityId: "case-confirmation",
    callbackId: "confirm-epoch",
    subjectDigest,
    resolution: "accepted"
  });

  // 正式决定（CallbackResolved）必须携带发布后 plan digest——评审纪元刷新的数据前提。
  const resolved = [...(await manager.events())].reverse().find((event) =>
    event.type === "CallbackResolved" && event.payload.activityId === "case-confirmation"
  )!;
  assert.equal(typeof resolved.payload.planDigest, "string");

  // 正式决定后开新批次：纪元刷新（reviewEpochDigest 变化），不再被同纪元
  // 收敛断路器以「只解除一次」拒绝。
  const batchAfterDecision = "REV-EPOCH-AFTER";
  const view = await manager.startReviewBatch({ batchId: batchAfterDecision });
  assert.notEqual(view.workflowState, "BLOCKED");
  const afterScope = parseReviewBatchScope(
    [...(await manager.events())].reverse().find((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === batchAfterDecision
    )!.payload.scope
  );
  assert.equal(afterScope.schemaVersion, "review-batch-scope-v1");
  if (hasCompleteReviewBatchScope(afterScope) && hasCompleteReviewBatchScope(beforeScope)) {
    assert.notEqual(afterScope.reviewEpochDigest, beforeScope.reviewEpochDigest);
  }
});
