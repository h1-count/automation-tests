import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  ReviewInputSnapshotStore
} from "../../../src/support/task-workflow/index.js";
import { assessCaseReviewRisk, caseReviewRiskDigest } from "../../../src/support/task-workflow/caseReviewRisk.js";
import { buildCompleteReviewBatchScope } from "../../../src/support/task-workflow/reviewBatchScope.js";

function snapshotScope() {
  const cases = [{
    caseId: "DEMO-REG-001",
    level: "standard" as const,
    requirementRefs: ["REQ-REG-001"],
    ruleRefs: ["RULE-REG-001"],
    reasons: []
  }];
  const assessment = {
    schemaVersion: "case-review-risk-v1" as const,
    distribution: "uniform" as const,
    maxLevel: "standard" as const,
    counts: { light: 0, standard: 1, strict: 0 },
    cases,
    digest: caseReviewRiskDigest({ cases })
  };
  return buildCompleteReviewBatchScope({
    allActivityIds: ["case-review-combined"],
    caseRiskAssessment: assessment,
    activityRoles: [{ activityId: "case-review-combined", role: "combined" }],
    reviewEpochDigest: "a".repeat(64),
    semanticEvolutionCycle: 0
  });
}

test("review input identity inspection is read-only", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-inspect-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-registration.md");
  await writeFile(planPath, "# plan\n", "utf8");
  await writeFile(casesPath, `> 结构版本：testcase-v1-layered。

# 用例集：注册演示

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。

## 模块：注册

<details open>
<summary>DEMO-REG-001｜验证注册状态展示｜P1｜低风险</summary>

> 规则：RULE-REG-001

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 查询注册状态 | 无 | 显示当前状态 |

</details>
`, "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const identity = await store.inspectCurrent([casesPath, planPath]);
  assert.equal(identity.artifacts.length, 2);
  assert.match(identity.combinedDigest, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(resolve(workspaceRoot, ".local")), false);
});

test("review input accepts only the request-scoped reusable review artifacts", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-reuse-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/reuse-run";
  const requestRoot = resolve(workspaceRoot, ".local/test-runs/web/demo/reuse-run");
  const specPath = resolve(requestRoot, "candidate-scripts/web.formal.spec.ts");
  await mkdir(resolve(specPath, ".."), { recursive: true });
  await writeFile(resolve(requestRoot, "run-intent.json"), "{\"schemaVersion\":\"run-intent-v1\"}\n", "utf8");
  await writeFile(resolve(requestRoot, "script-review-assessment.json"), "{}\n", "utf8");
  await writeFile(specPath, "export {};\n", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot, runRoot: requestRoot });
  const identity = await store.inspectCurrent([
    resolve(requestRoot, "run-intent.json"),
    resolve(requestRoot, "script-review-assessment.json"),
    specPath
  ]);
  assert.equal(identity.artifacts.length, 3);
  await assert.rejects(
    store.inspectCurrent([resolve(requestRoot, "candidate-scripts/../../outside.ts")]),
    /Reviewer input must be/u
  );
});

test("review input snapshot freezes immutable plan, case, and controlled source bytes", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-snapshot-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-registration.md");
  const sourcePath = resolve(workspaceRoot, "sources/requirements/demo/requirements.md");
  const knowledgePath = resolve(workspaceRoot, "sources/knowledge-base/demo/help.pdf");
  await mkdir(resolve(sourcePath, ".."), { recursive: true });
  await mkdir(resolve(knowledgePath, ".."), { recursive: true });
  await writeFile(planPath, "# plan v1\n", "utf8");
  await writeFile(casesPath, `> 结构版本：testcase-v1-layered。

# 用例集：注册演示

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。

## 模块：注册

<details open>
<summary>DEMO-REG-001｜验证注册状态展示｜P1｜低风险</summary>

> 规则：RULE-REG-001

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 查询注册状态 | 无 | 显示当前状态 |

</details>
`, "utf8");
  await writeFile(sourcePath, "# source v1\n", "utf8");
  await writeFile(knowledgePath, "controlled knowledge bytes", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const scope = snapshotScope();
  const frozen = await store.freeze("REV-DEMO-01", [casesPath, planPath, sourcePath, knowledgePath], scope);
  assert.equal(frozen.artifacts.length, 4);
  assert.match(frozen.combinedDigest, /^[a-f0-9]{64}$/);
  assert.ok(frozen.artifacts.every((artifact) =>
    artifact.snapshotPath.includes(".local/test-task-runtime/")
  ));

  await writeFile(planPath, "# current plan\n", "utf8");
  const verified = await store.verify("REV-DEMO-01");
  assert.equal(verified.combinedDigest, frozen.combinedDigest);
  const snapshotPlan = verified.artifacts.find((artifact) => artifact.sourcePath.endsWith("/plan.md"));
  assert.equal(await readFile(snapshotPlan!.snapshotPath, "utf8"), "# plan v1\n");
  await assert.rejects(
    store.verifyCurrentSources("REV-DEMO-01"),
    /input drifted/
  );
  await assert.rejects(
    store.freeze("REV-DEMO-01", [casesPath, planPath, sourcePath, knowledgePath], scope),
    /already exists with another input digest/
  );
});

test("current semantic snapshot ignores derived index and review records but detects testcase semantics", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-semantic-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/semantic-review";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/semantic-review");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-main.md");
  const plan = `# Plan

> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。
> 用例格式：testcase-v1-layered。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | ${requestId} |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

- 认证状态。

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-AUTH-001 | SRC-AUTH-001 | 显示认证状态 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-AUTH-001 | REQ-AUTH-001 | SRC-AUTH-001 | 查询认证状态 | 显示当前状态 | 场景法 | DEMO-AUTH-001 | no_write | 已覆盖 |

## 评审与正式决定

- 尚未评审。
`;
  const cases = `> 结构版本：testcase-v1-layered。

# 用例集：认证状态

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 0 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 认证 | DEMO-AUTH-001 | 验证认证状态 | P1 | 中 |

## 模块：认证

<details open>
<summary>DEMO-AUTH-001｜验证认证状态｜P1｜中风险</summary>

> 规则：RULE-AUTH-001
> 前置条件：test 环境可用

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 查询认证状态 | 无 | 显示当前状态 |

</details>
`;
  await writeFile(planPath, plan, "utf8");
  await writeFile(casesPath, cases, "utf8");
  const assessment = assessCaseReviewRisk(cases);
  const scope = buildCompleteReviewBatchScope({
    allActivityIds: ["case-review-combined"],
    caseRiskAssessment: assessment,
    activityRoles: [{ activityId: "case-review-combined", role: "combined" }],
    reviewEpochDigest: "d".repeat(64),
    semanticEvolutionCycle: 0
  });
  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const frozen = await store.freeze("REV-SEMANTIC-01", [planPath, casesPath], scope);
  assert.equal(frozen.schemaVersion, "review-input-snapshot-v1");
  assert.deepEqual(Object.keys(frozen.roleInputDigests ?? {}), ["case-review-combined"]);
  const packet = await store.readRolePacket("REV-SEMANTIC-01", "case-review-combined");
  assert.ok(packet);
  assert.equal(packet.originalBytes, frozen.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0));
  const packetContent = await readFile(packet.packetPath, "utf8");
  assert.match(packetContent, /# 评审输入包/);
  assert.match(packetContent, /切片：testcases\/web\/demo\/semantic-review\/plan\.md/);
  assert.match(packetContent, /切片：testcases\/web\/demo\/semantic-review\/cases-main\.md/);

  await writeFile(
    planPath,
    plan
      .replace("| RULE-AUTH-001", "| RULE-AUTH-001")
      .replace("- 尚未评审。", "- reviewer 正式记录已写入。"),
    "utf8"
  );
  await writeFile(
    casesPath,
    cases.replace("| 认证 | DEMO-AUTH-001 | 验证认证状态 |", "| 认证 | DEMO-AUTH-001 | 验证认证状态（索引更新） |"),
    "utf8"
  );
  await store.verifyCurrentSources("REV-SEMANTIC-01");

  await writeFile(
    casesPath,
    (await readFile(casesPath, "utf8")).replace("查询认证状态", "修改认证状态"),
    "utf8"
  );
  await assert.rejects(store.verifyCurrentSources("REV-SEMANTIC-01"), /input drifted/);
});

test("review input snapshots share content blobs without coupling batch lifecycle", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-snapshot-dedup-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  const planPath = resolve(requestRoot, "plan.md");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(planPath, "# shared plan\n", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const scope = snapshotScope();
  const first = await store.freeze("REV-DEMO-01", [planPath], scope);
  const second = await store.freeze("REV-DEMO-02", [planPath], scope);
  const digest = first.artifacts[0]!.digest;
  const blobDirectory = resolve(
    workspaceRoot,
    ".local/test-task-runtime/review-input-blobs/sha256",
    digest.slice(0, 2)
  );
  assert.deepEqual(await readdir(blobDirectory), [digest]);

  const firstStat = await stat(first.artifacts[0]!.snapshotPath);
  const secondStat = await stat(second.artifacts[0]!.snapshotPath);
  const blobStat = await stat(resolve(blobDirectory, digest));
  if (blobStat.ino !== 0 && blobStat.nlink > 1) {
    assert.equal(firstStat.ino, blobStat.ino);
    assert.equal(secondStat.ino, blobStat.ino);
  }

  await rm(resolve(first.artifacts[0]!.snapshotPath, ".."), { recursive: true, force: true });
  assert.equal((await store.verify("REV-DEMO-02")).combinedDigest, second.combinedDigest);

  await store.repair("REV-DEMO-01", [planPath], scope);
  assert.equal((await store.verify("REV-DEMO-02")).combinedDigest, second.combinedDigest);
  assert.deepEqual(await readdir(blobDirectory), [digest]);
});

test("review input snapshot rejects paths outside the request and detects corruption", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-snapshot-safe-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), "# plan\n", "utf8");
  await writeFile(resolve(workspaceRoot, "outside.md"), "# outside\n", "utf8");
  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });

  await assert.rejects(
    store.freeze("REV-DEMO-01", [resolve(workspaceRoot, "outside.md")], snapshotScope()),
    /Reviewer input must be/
  );
  const frozen = await store.freeze("REV-DEMO-01", [resolve(requestRoot, "plan.md")], snapshotScope());
  await writeFile(frozen.artifacts[0]!.snapshotPath, "# tampered\n", "utf8");
  await assert.rejects(store.verify("REV-DEMO-01"), /is corrupt/);
});
