import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { registerStableDesignSuite } from "../../../src/support/test-suite/designSuite.js";
import { assessReadinessPreflight } from "../../../src/support/formal-execution/readinessPreflight.js";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";

/**
 * Regression coverage for tier-aware suite loading at initialize time:
 * a registered design-tier suite (stable-test-suite-manifest-v1) previously
 * crashed initialize with "Stable test suite manifest identity is invalid."
 * because the shared loader parsed it with the execution-tier v1 contract.
 */
async function createDesignSuiteHarness(dataStrategy = "no_write"): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "design-reconfirm-init-"));
  const suiteDir = "testcases/web/demo/suites/registration";
  await mkdir(resolve(root, suiteDir), { recursive: true });
  await mkdir(resolve(root, "sources/requirements/demo"), { recursive: true });
  await mkdir(resolve(root, ".local/test-runs/web/demo/accepted-run"), { recursive: true });

  const sourceDigest = createHash("sha256").update("requirement body v1\n").digest("hex");
  await writeFile(resolve(root, "sources/requirements/demo/requirement.md"), "requirement body v1\n");
  await writeFile(resolve(root, `${suiteDir}/design.md`), [
    "# 设计台账",
    "",
    "## 请求内来源",
    "",
    "| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |",
    "| --- | --- | --- | --- |",
    `| SRC-REQ-001 | [需求文档](../../../../sources/requirements/demo/requirement.md) | \`${sourceDigest}\` | 登录注册需求 | `,
    "",
    "## 需求适用性",
    "",
    "| REQ | sourceRef | 可验证需求 | 适用性 |",
    "| --- | --- | --- | --- |",
    "| REQ-LOGIN-001 | SRC-REQ-001 | 支持手机号密码登录 | 适用 |",
    "",
    "## 规则设计台账",
    "",
    "| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| RULE-LOGIN-001 | REQ-LOGIN-001 | SRC-REQ-001 | 输入正确手机号密码 | 登录成功进入控制台 | 场景法 | OPEN-LOGIN-001 | no_write | 已覆盖 |",
    ""
  ].join("\n"));
  await writeFile(resolve(root, `${suiteDir}/cases.md`), [
    "> 结构版本：testcase-v1-layered。",
    "",
    "# 用例集：演示登录",
    "",
    "## 模块：登录",
    "",
    "<details>",
    "<summary>OPEN-LOGIN-001｜验证正确凭据可登录｜P0｜中风险</summary>",
    "",
    "> 规则：RULE-LOGIN-001",
    "> 前置条件：演示环境可访问",
    `> 差异：数据策略=${dataStrategy}；来源=SRC-REQ-001`,
    "",
    "| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |",
    "| --- | --- | --- | --- | --- |",
    "| — | 1 | 输入正确凭据提交登录 | 正确手机号与密码 | 登录成功进入控制台 |",
    "",
    "</details>",
    ""
  ].join("\n"));
  await writeFile(
    resolve(root, ".local/test-runs/web/demo/accepted-run/workflow-history.ndjson"),
    [
      { type: "WorkflowStarted", occurredAt: "2026-08-20T10:00:00.000Z", digest: "a".repeat(64) },
      {
        type: "CallbackResolved",
        occurredAt: "2026-08-20T10:05:00.000Z",
        payload: {
          activityId: "case-confirmation",
          callbackId: "callback-case-confirmation-abc",
          subjectDigest: "b".repeat(64),
          resolution: "accepted"
        }
      },
      { type: "WorkflowCompleted", occurredAt: "2026-08-20T10:06:00.000Z", digest: "c".repeat(64) }
    ].map((event) => JSON.stringify(event)).join("\n") + "\n"
  );
  await registerStableDesignSuite({
    suiteId: "web/demo/registration",
    requestId: "web/demo/accepted-run",
    workspaceRoot: root
  });
  return root;
}

test("initialize materializes the design_reconfirm chain from a design-tier manifest", async () => {
  const root = await createDesignSuiteHarness();
  const requestRoot = resolve(root, ".local/test-runs/web/demo/reconfirm-run");
  await mkdir(requestRoot, { recursive: true });

  const manager = new DurableWorkflowManager("web/demo/reconfirm-run", root);
  const gate = await manager.initialize({
    suiteId: "web/demo/registration",
    reuse: "auto",
    environment: "test",
    deliveryTarget: "testcase_only"
  });

  assert.equal(gate.definitionVersion, "v1");
  assert.equal(gate.activities["reuse-assessment"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["reuse-assessment"]?.outcome, "design_reconfirm");
  assert.equal(gate.activities["design-revalidation"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["design-revalidation"]?.outcome, "zero_drift_reconfirmed");
  const confirmation = gate.activities["case-confirmation"];
  assert.ok(confirmation, "design_reconfirm keeps the reconfirm-scoped case confirmation");
  assert.equal(confirmation.state, "READY");
  assert.equal(confirmation.definition.metadata?.scope, "reconfirm");
  assert.deepEqual(confirmation.definition.metadata?.casePackages, ["cases.md"]);
  assert.equal(gate.activities["source-selection"], undefined);
  assert.equal(gate.activities["candidate-skeleton"], undefined);
  assert.equal(gate.activities["targeted-review"], undefined);
  assert.equal(gate.activities.build, undefined);
  assert.equal(gate.activities.readiness, undefined);
  assert.equal(existsSync(resolve(requestRoot, "plan.md")), false);
  assert.equal(existsSync(resolve(requestRoot, "run-intent.json")), true);

  const started = (await manager.events())[0]!;
  assert.equal(
    (started.payload.reuseAssessment as Record<string, unknown>).decision,
    "design_reconfirm"
  );
});

test("design_reconfirm full_run reuses stable design and enters engineering without candidate generation", async () => {
  const root = await createDesignSuiteHarness();
  try {
    const manager = new DurableWorkflowManager("web/demo/reconfirm-full-run", root);
    const gate = await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "full_run"
    });
    assert.equal(gate.definitionVersion, "v1");
    assert.equal(gate.activities["design-revalidation"]?.outcome, "zero_drift_reconfirmed");
    assert.equal(gate.activities.build?.state, "PENDING");
    assert.equal(gate.activities.readiness?.state, "PENDING");
    assert.equal(gate.activities["case-confirmation"]?.state, "READY");
    assert.equal(gate.activities["candidate-compiler"], undefined);
    assert.equal(existsSync(resolve(root, ".local/test-runs/web/demo/reconfirm-full-run/plan.md")), false);
    assert.equal(gate.activities.build?.definition.metadata?.designReuseExecution, "stable_design_zero_drift");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("design_reconfirm testcase_only resolves from the frozen suite without creating plan.md", async () => {
  const root = await createDesignSuiteHarness();
  try {
    const manager = new DurableWorkflowManager("web/demo/reconfirm-accept", root);
    const initialized = await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "testcase_only"
    });
    assert.equal(initialized.activities["case-confirmation"]?.definition.metadata?.completesWorkflow, true);
    assert.equal(initialized.activities["case-confirmation"]?.definition.metadata?.deliveryTarget, "testcase_only");
    const reviewExport = await manager.currentTestcaseReviewExport();
    const subjectDigest = reviewExport.callbackSubjectDigest;
    const workbook = Buffer.from("review workbook");
    await writeFile(resolve(root, ".local/test-runs/web/demo/reconfirm-accept/cases-review.xlsx"), workbook);
    await manager.recordTestcaseReviewWorkbookPublication({
      subjectDigest,
      contentDigest: reviewExport.contentDigest,
      bindingDigest: reviewExport.bindingDigest,
      workbookDigest: createHash("sha256").update(workbook).digest("hex"),
      receiptDigest: "c".repeat(64),
      cacheStatus: "miss",
      renderMilliseconds: 1
    });
    await manager.requestCallback({
      activityId: "case-confirmation",
      callbackId: "callback-case-confirmation-reconfirm",
      subjectDigest,
      kind: "case_confirmation"
    });
    const completed = await manager.resolveCallback({
      activityId: "case-confirmation",
      callbackId: "callback-case-confirmation-reconfirm",
      subjectDigest,
      resolution: "accepted"
    });
    assert.equal(completed.workflowState, "SUCCEEDED");
    assert.equal(existsSync(resolve(root, ".local/test-runs/web/demo/reconfirm-accept/plan.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reopening a reuse confirmation invalidates the confirmation itself, not downstream script reviewers", async () => {
  const root = await createDesignSuiteHarness();
  try {
    const requestId = "web/demo/reconfirm-reopen";
    const manager = new DurableWorkflowManager(requestId, root);
    await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "script_only"
    });
    const reviewExport = await manager.currentTestcaseReviewExport();
    const workbook = Buffer.from("review workbook");
    await writeFile(resolve(root, `.local/test-runs/${requestId}/cases-review.xlsx`), workbook);
    await manager.recordTestcaseReviewWorkbookPublication({
      subjectDigest: reviewExport.callbackSubjectDigest,
      contentDigest: reviewExport.contentDigest,
      bindingDigest: reviewExport.bindingDigest,
      workbookDigest: createHash("sha256").update(workbook).digest("hex"),
      receiptDigest: "d".repeat(64),
      cacheStatus: "miss",
      renderMilliseconds: 1
    });
    await manager.requestCallback({
      activityId: "case-confirmation",
      callbackId: "callback-case-confirmation-reopen",
      subjectDigest: reviewExport.callbackSubjectDigest,
      kind: "case_confirmation"
    });
    await manager.resolveCallback({
      activityId: "case-confirmation",
      callbackId: "callback-case-confirmation-reopen",
      subjectDigest: reviewExport.callbackSubjectDigest,
      resolution: "accepted"
    });
    const reopened = await manager.reopenCallback({
      activityId: "case-confirmation",
      callbackId: "callback-case-confirmation-reopen-2",
      subjectDigest: reviewExport.callbackSubjectDigest,
      kind: "case_confirmation",
      reason: "suite semantic change"
    });
    assert.equal(reopened.activities["case-confirmation"]?.state, "READY");
    assert.equal(reopened.activities.build?.state, "PENDING");
    assert.equal(reopened.activities["script-review-quality"]?.state, "PENDING");
    assert.equal(reopened.activities["script-review-safety"]?.state, "PENDING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("design_reconfirm derives a write-capable full_run from selected case data policy", async () => {
  const root = await createDesignSuiteHarness("ephemeral_cleanup");
  try {
    const manager = new DurableWorkflowManager("web/demo/reconfirm-write-run", root);
    const gate = await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "full_run"
    });
    assert.equal(gate.activities.run?.definition.requiresExternalOperation, true);
    assert.equal(gate.activities["execution-authorization"]?.definition.metadata?.decisionMode, "user_confirmed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the reconfirm case-confirmation subject binds the suite cases through the suite binding", async () => {
  const root = await createDesignSuiteHarness();
  const requestRoot = resolve(root, ".local/test-runs/web/demo/reconfirm-run-2");
  await mkdir(requestRoot, { recursive: true });

  const manager = new DurableWorkflowManager("web/demo/reconfirm-run-2", root);
  await manager.initialize({
    suiteId: "web/demo/registration",
    reuse: "auto",
    environment: "test",
    deliveryTarget: "testcase_only"
  });

  const subjectDigest = await manager.callbackSubjectDigest("case-confirmation");
  assert.match(subjectDigest, /^[a-f0-9]{64}$/u);
  // The subject must be stable across recomputation from the frozen suite assets.
  assert.equal(await manager.callbackSubjectDigest("case-confirmation"), subjectDigest);
});

test("a missing v10 run intent is rebuilt from the durable summary without appending history", async () => {
  const root = await createDesignSuiteHarness();
  const requestRoot = resolve(root, ".local/test-runs/web/demo/reconfirm-run-recovery");
  await mkdir(requestRoot, { recursive: true });
  const manager = new DurableWorkflowManager("web/demo/reconfirm-run-recovery", root);
  await manager.initialize({
    suiteId: "web/demo/registration", reuse: "auto", environment: "test", deliveryTarget: "testcase_only"
  });
  const before = await manager.events();
  await rm(resolve(requestRoot, "run-intent.json"));
  const recovered = await manager.recoverRunIntent();
  assert.equal(recovered.reuseDecision, "design_reconfirm");
  assert.equal((await manager.events()).length, before.length);
  assert.equal(existsSync(resolve(requestRoot, "run-intent.json")), true);
});

test("initialize routes design-tier source drift into an isolated affected rebuild", async () => {
  const root = await createDesignSuiteHarness();
  const requestRoot = resolve(root, ".local/test-runs/web/demo/reconfirm-run-3");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), "# plan\n");
  const stableCasesPath = resolve(root, "testcases/web/demo/suites/registration/cases.md");
  const stableCases = await readFile(stableCasesPath, "utf8");
  await writeFile(resolve(root, "sources/requirements/demo/requirement.md"), "updated requirement body\n");

  const manager = new DurableWorkflowManager("web/demo/reconfirm-run-3", root);
  const gate = await manager.initialize({
    suiteId: "web/demo/registration",
    reuse: "auto",
    environment: "test",
    deliveryTarget: "testcase_only"
  });
  assert.equal(gate.activities["reuse-assessment"]?.outcome, "affected_rebuild");
  assert.equal(gate.activities["impact-location"]?.state, "READY");
  assert.equal(gate.activities["source-selection"], undefined);
  assert.equal(manager.suiteRoot, undefined, "affected rebuild must not target the stable suite directory");
  assert.equal(
    await readFile(resolve(requestRoot, "cases.md"), "utf8"),
    stableCases,
    "targeted evolution starts from a request-local case package copy"
  );
  assert.equal(await readFile(stableCasesPath, "utf8"), stableCases);
});

test("initialize routes a bounded case edit into only that case's affected rebuild", async () => {
  const root = await createDesignSuiteHarness();
  try {
    const requestRoot = resolve(root, ".local/test-runs/web/demo/bounded-case-edit");
    await mkdir(requestRoot, { recursive: true });
    await writeFile(resolve(requestRoot, "plan.md"), "# plan\n");
    const stableCasesPath = resolve(root, "testcases/web/demo/suites/registration/cases.md");
    const changedCases = (await readFile(stableCasesPath, "utf8"))
      .replace("输入正确凭据提交登录", "输入已注册手机号和正确密码后提交登录");
    await writeFile(stableCasesPath, changedCases);

    const manager = new DurableWorkflowManager("web/demo/bounded-case-edit", root);
    const gate = await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "testcase_only"
    });

    assert.equal(gate.activities["reuse-assessment"]?.outcome, "affected_rebuild");
    assert.deepEqual(
      gate.activities["reuse-assessment"]?.definition.metadata?.affectedCaseIds,
      ["OPEN-LOGIN-001"]
    );
    assert.equal(gate.activities["impact-location"]?.state, "READY");
    assert.equal(gate.activities["source-selection"], undefined);
    assert.equal(
      await readFile(resolve(requestRoot, "cases.md"), "utf8"),
      changedCases,
      "only the changed case is scheduled for review; the request copy preserves the proposed edit"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unprovable affected closure activates the same-request full candidate branch", async () => {
  const root = await createDesignSuiteHarness();
  const requestRoot = resolve(root, ".local/test-runs/web/demo/affected-fallback");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), "# 候选计划\n");
  await writeFile(resolve(root, "sources/requirements/demo/requirement.md"), "updated requirement body\n");
  const manager = new DurableWorkflowManager("web/demo/affected-fallback", root);
  await manager.initialize({
    suiteId: "web/demo/registration", reuse: "auto", environment: "test", deliveryTarget: "testcase_only"
  });
  const impact = await manager.startActivity("impact-location", "host");
  await manager.succeedActivity("impact-location", { claimToken: impact.claimToken, verification: "impact located" });
  const intent = await manager.startActivity("run-intent-derive", "host");
  await manager.deriveCurrentRunIntent(intent.claimToken);
  await rm(resolve(root, "testcases/web/demo/suites/registration/design.md"));
  const closure = await manager.startActivity("impact-closure-build", "host");
  const result = await manager.buildImpactClosure(closure.claimToken);
  assert.equal(result.activities["impact-closure-build"]?.outcome, "full_replan");
  assert.equal(result.activities["delta-preflight"]?.state, "CANCELLED");
  assert.equal(result.activities["full-source-selection"]?.state, "READY");
  assert.equal(result.activities["candidate-preflight"]?.state, "PENDING");
});

test("initialize of a design_reconfirm run derives run-intent without a run plan.md", async () => {
  const root = await createDesignSuiteHarness();
  const manager = new DurableWorkflowManager("web/demo/reconfirm-run-4", root);
  const gate = await manager.initialize({
    suiteId: "web/demo/registration",
    reuse: "auto",
    environment: "test",
    deliveryTarget: "testcase_only"
  });
  assert.equal(gate.definitionVersion, "v1");
  assert.equal(existsSync(resolve(root, ".local/test-runs/web/demo/reconfirm-run-4/plan.md")), false);
  assert.equal(existsSync(resolve(root, ".local/test-runs/web/demo/reconfirm-run-4/run-intent.json")), true);
});

test("v12 readiness preflight fails closed before a missing formal manifest can start readiness", async () => {
  const root = await createDesignSuiteHarness();
  try {
    const manager = new DurableWorkflowManager("web/demo/reconfirm-readiness", root);
    await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "full_run"
    });
    const report = await assessReadinessPreflight({
      workspaceRoot: manager.workspaceRoot,
      requestId: manager.requestId,
      requestRoot: manager.requestRoot,
      runRootMode: manager.runRootMode,
      suiteRoot: manager.suiteRoot,
      definitionVersion: "v12"
    });
    assert.equal(report.complete, false);
    assert.equal(report.category, "immutable_input_incompatible");
    assert.match(report.issues.join("\n"), /formal manifest/u);
    assert.equal((await manager.gate()).activities.readiness?.state, "PENDING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a new controlled source prevents accidental design_reconfirm initialization", async () => {
  const root = await createDesignSuiteHarness();
  try {
    const requestRoot = resolve(root, ".local/test-runs/web/demo/protocol-replan");
    await mkdir(requestRoot, { recursive: true });
    await writeFile(resolve(root, "sources/requirements/demo/protocol.md"), "supported protocols\n");
    const manager = new DurableWorkflowManager("web/demo/protocol-replan", root);
    const gate = await manager.initialize({
      suiteId: "web/demo/registration",
      reuse: "auto",
      environment: "test",
      deliveryTarget: "testcase_only",
      additionalSourcePaths: ["sources/requirements/demo/protocol.md"]
    });

    assert.equal(gate.activities["reuse-assessment"]?.outcome, "full_replan");
    assert.equal(gate.activities["source-selection"]?.state, "PENDING");
    assert.equal(gate.activities["design-revalidation"], undefined);
    assert.equal(gate.activities["candidate-compiler"]?.state, "PENDING");
    const staging = resolve(requestRoot, "staging/candidate-plan.md");
    assert.equal(existsSync(staging), true);
    assert.match(await readFile(staging, "utf8"), /candidate-plan-staging-v1/u);
    assert.equal(existsSync(resolve(requestRoot, "plan.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
