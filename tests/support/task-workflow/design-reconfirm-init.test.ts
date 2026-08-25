import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { registerStableDesignSuite } from "../../../src/support/test-suite/designSuite.js";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";

/**
 * Regression coverage for tier-aware suite loading at initialize time:
 * a registered design-tier suite (stable-test-suite-manifest-v2) previously
 * crashed initialize with "Stable test suite manifest identity is invalid."
 * because the shared loader parsed it with the execution-tier v1 contract.
 */
async function createDesignSuiteHarness(): Promise<string> {
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
    "> 结构版本：testcase-v6-layered。",
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
    "> 差异：数据策略=no_write；来源=SRC-REQ-001",
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

  assert.equal(gate.definitionVersion, "v9");
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

test("a missing v9 run intent is rebuilt from the durable summary without appending history", async () => {
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
  await writeFile(resolve(root, "sources/requirements/demo/requirement.md"), "requirement body v2\n");

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

test("an unprovable affected closure activates the same-request full candidate branch", async () => {
  const root = await createDesignSuiteHarness();
  const requestRoot = resolve(root, ".local/test-runs/web/demo/affected-fallback");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), "# 候选计划\n");
  await writeFile(resolve(root, "sources/requirements/demo/requirement.md"), "requirement body v2\n");
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
  assert.equal(gate.definitionVersion, "v9");
  assert.equal(existsSync(resolve(root, ".local/test-runs/web/demo/reconfirm-run-4/plan.md")), false);
  assert.equal(existsSync(resolve(root, ".local/test-runs/web/demo/reconfirm-run-4/run-intent.json")), true);
});
