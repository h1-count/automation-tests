import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assessStableDesignSuite,
  parseRuleLedger,
  parseSourceRegistry,
  registerStableDesignSuite,
  validateStableDesignSuite,
  type StableDesignSuiteManifest
} from "../../../src/support/test-suite/designSuite.js";
import { assessStableTestSuite } from "../../../src/support/test-suite/stableSuite.js";

const suiteId = "web/demo/registration";

interface Harness {
  root: string;
  designPath: string;
  casesPath: string;
  sourcePath: string;
  historyPath: string;
  writeHistory: (events: unknown[]) => Promise<void>;
}

async function sha(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(resolve(tmpdir(), "design-suite-"));
  const suiteDir = "testcases/web/demo/suites/registration";
  const designPath = resolve(root, suiteDir, "design.md");
  const casesPath = resolve(root, suiteDir, "cases-registration.md");
  const sourcePath = resolve(root, "sources/requirements/demo/requirement.md");
  const historyPath = resolve(root, ".local/test-runs/web/demo/accepted-run/workflow-history.ndjson");
  await mkdir(resolve(root, suiteDir), { recursive: true });
  await mkdir(resolve(root, "sources/requirements/demo"), { recursive: true });
  await mkdir(resolve(root, ".local/test-runs/web/demo/accepted-run"), { recursive: true });
  const sourceDigest = createHash("sha256").update("requirement body v1\n").digest("hex");
  await writeFile(sourcePath, "requirement body v1\n");
  const specPath = resolve(root, "sources/requirements/demo/spec.md");
  await writeFile(specPath, "supplementary spec v1\n");
  await writeFile(designPath, [
    "# 设计台账",
    "",
    "## 请求内来源",
    "",
    "| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |",
    "| --- | --- | --- | --- |",
    `| SRC-REQ-001 | [需求文档](../../../../sources/requirements/demo/requirement.md)；补充规格 [spec.md](../../../../sources/requirements/demo/spec.md) | \`${sourceDigest}\` | 登录注册需求 | `,
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
    "| RULE-LOGIN-002 | REQ-LOGIN-001 | SRC-REQ-001 | 输入错误密码 | 提示凭据错误 | 边界值 | OPEN-LOGIN-002 | no_write | 已覆盖 |",
    ""
  ].join("\n"));
  await writeFile(casesPath, [
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
    "",
    "<details>",
    "<summary>OPEN-LOGIN-002｜验证错误密码被拒绝｜P1｜中风险</summary>",
    "",
    "> 规则：RULE-LOGIN-002",
    "> 前置条件：演示环境可访问",
    "> 差异：数据策略=no_write；来源=SRC-REQ-001",
    "",
    "| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |",
    "| --- | --- | --- | --- | --- |",
    "| — | 1 | 输入错误密码提交登录 | 正确手机号与错误密码 | 提示凭据错误 |",
    "",
    "</details>",
    ""
  ].join("\n"));
  const harness: Harness = {
    root,
    designPath,
    casesPath,
    sourcePath,
    historyPath,
    writeHistory: async (events) => {
      await writeFile(historyPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    }
  };
  await harness.writeHistory([
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
  ]);
  return harness;
}

test("register-design refuses a request without an accepted case-confirmation", async () => {
  const harness = await createHarness();
  await harness.writeHistory([
    { type: "WorkflowStarted", occurredAt: "2026-08-20T10:00:00.000Z" },
    {
      type: "CallbackResolved",
      occurredAt: "2026-08-20T10:05:00.000Z",
      payload: {
        activityId: "case-confirmation",
        callbackId: "callback-case-confirmation-abc",
        subjectDigest: "b".repeat(64),
        resolution: "revision_requested"
      }
    }
  ]);
  await assert.rejects(
    registerStableDesignSuite({
      suiteId,
      requestId: "web/demo/accepted-run",
      workspaceRoot: harness.root
    }),
    /no user-accepted case-confirmation/
  );
});

test("registered design suite with zero drift selects design_reconfirm", async () => {
  const harness = await createHarness();
  const result = await registerStableDesignSuite({
    suiteId,
    requestId: "web/demo/accepted-run",
    workspaceRoot: harness.root
  });
  assert.equal(result.created, true);
  assert.equal(result.manifest.schemaVersion, "stable-test-suite-manifest-v2");
  const assessment = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(assessment.decision, "design_reconfirm");
  assert.deepEqual(assessment.selectedCaseIds, ["OPEN-LOGIN-001", "OPEN-LOGIN-002"]);
  assert.deepEqual(assessment.reasons, ["design_zero_drift"]);
  const validation = await validateStableDesignSuite(suiteId, harness.root);
  assert.deepEqual(validation.driftedSuitePaths, []);
  assert.deepEqual(validation.driftedSourceIds, []);
});

test("source drift with a complete rule map selects affected_rebuild with the mapped closure", async () => {
  const harness = await createHarness();
  await registerStableDesignSuite({
    suiteId,
    requestId: "web/demo/accepted-run",
    workspaceRoot: harness.root
  });
  await writeFile(harness.sourcePath, "requirement body v2 with changed rules\n");
  const assessment = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(assessment.decision, "affected_rebuild");
  assert.deepEqual(assessment.affectedCaseIds, ["OPEN-LOGIN-001", "OPEN-LOGIN-002"]);
  assert.ok(assessment.reasons.includes("complete_case_impact_mapping"));
  assert.ok(assessment.reasons.some((reason) => reason.startsWith("source_digest_drift:")));
});

test("out-of-band suite asset drift fails closed to full_replan", async () => {
  const harness = await createHarness();
  await registerStableDesignSuite({
    suiteId,
    requestId: "web/demo/accepted-run",
    workspaceRoot: harness.root
  });
  await writeFile(harness.casesPath, "# hand-edited out of band\n");
  const assessment = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(assessment.decision, "full_replan");
  assert.ok(assessment.reasons.includes("suite_design_drift_out_of_band"));
});

test("production environment is rejected before any tier routing", async () => {
  const harness = await createHarness();
  await registerStableDesignSuite({
    suiteId,
    requestId: "web/demo/accepted-run",
    workspaceRoot: harness.root
  });
  const assessment = await assessStableTestSuite({
    suiteId,
    environment: "production",
    workspaceRoot: harness.root
  });
  assert.equal(assessment.decision, "full_replan");
  assert.deepEqual(assessment.reasons, ["production_environment_forbidden"]);
});

test("source registry and rule ledger parse from the real design ledger shape", async () => {
  const harness = await createHarness();
  const ledger = await readFile(harness.designPath, "utf8");
  const registry = parseSourceRegistry(ledger);
  assert.equal(registry.length, 1);
  assert.equal(registry[0]!.sourceId, "SRC-REQ-001");
  assert.deepEqual(registry[0]!.sourcePaths, [
    "sources/requirements/demo/requirement.md",
    "sources/requirements/demo/spec.md"
  ]);
  assert.match(registry[0]!.digest, /^[a-f0-9]{64}$/u);
  const rules = parseRuleLedger(ledger);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0]!.sourceRefs, ["SRC-REQ-001"]);
  assert.deepEqual(rules[0]!.caseIds, ["OPEN-LOGIN-001"]);
});

test("design tier assessment routes through the shared assessment entry point", async () => {
  const harness = await createHarness();
  await registerStableDesignSuite({
    suiteId,
    requestId: "web/demo/accepted-run",
    workspaceRoot: harness.root
  });
  const direct = await assessStableDesignSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(direct.decision, "design_reconfirm");
  const manifest = direct.manifest as StableDesignSuiteManifest;
  assert.equal(manifest.tier, "design");
  assert.equal(manifest.profiles.smoke.length, 1);
});

test("ledger digest matching none of the referenced files refuses registration", async () => {
  const harness = await createHarness();
  const forged = createHash("sha256").update("forged").digest("hex");
  const ledger = (await readFile(harness.designPath, "utf8"))
    .replace(/[a-f0-9]{64}/u, forged);
  await writeFile(harness.designPath, ledger);
  await assert.rejects(
    registerStableDesignSuite({
      suiteId,
      requestId: "web/demo/accepted-run",
      workspaceRoot: harness.root
    }),
    /ledger digest matches none of its referenced files/
  );
});

test("secondary file drift still selects affected_rebuild under per-file baselines", async () => {
  const harness = await createHarness();
  await registerStableDesignSuite({
    suiteId,
    requestId: "web/demo/accepted-run",
    workspaceRoot: harness.root
  });
  const specPath = resolve(harness.root, "sources/requirements/demo/spec.md");
  await writeFile(specPath, "supplementary spec v2" + String.fromCharCode(10));
  const assessment = await assessStableTestSuite({
    suiteId,
    environment: "test",
    workspaceRoot: harness.root
  });
  assert.equal(assessment.decision, "affected_rebuild");
  assert.ok(assessment.reasons.some((reason) => reason.startsWith("source_digest_drift:")));
});
