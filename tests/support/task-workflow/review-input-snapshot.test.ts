import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  ReviewInputSnapshotStore
} from "../../../src/support/task-workflow/index.js";
import { assessCaseReviewRisk } from "../../../src/support/task-workflow/caseReviewRisk.js";
import { buildReviewBatchScopeV3 } from "../../../src/support/task-workflow/reviewBatchScope.js";

test("review input identity inspection is read-only", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-inspect-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-registration.md");
  await writeFile(planPath, "# plan\n", "utf8");
  await writeFile(casesPath, "# cases\n", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const identity = await store.inspectCurrent([casesPath, planPath]);
  assert.equal(identity.artifacts.length, 2);
  assert.match(identity.combinedDigest, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(resolve(workspaceRoot, ".local")), false);
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
  await writeFile(casesPath, "# cases v1\n", "utf8");
  await writeFile(sourcePath, "# source v1\n", "utf8");
  await writeFile(knowledgePath, "controlled knowledge bytes", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const frozen = await store.freeze("REV-DEMO-01", [casesPath, planPath, sourcePath, knowledgePath]);
  assert.equal(frozen.artifacts.length, 4);
  assert.match(frozen.combinedDigest, /^[a-f0-9]{64}$/);
  assert.ok(frozen.artifacts.every((artifact) =>
    artifact.snapshotPath.includes(".local/test-task-runtime/")
  ));

  await writeFile(planPath, "# plan v2\n", "utf8");
  const verified = await store.verify("REV-DEMO-01");
  assert.equal(verified.combinedDigest, frozen.combinedDigest);
  const snapshotPlan = verified.artifacts.find((artifact) => artifact.sourcePath.endsWith("/plan.md"));
  assert.equal(await readFile(snapshotPlan!.snapshotPath, "utf8"), "# plan v1\n");
  await assert.rejects(
    store.verifyCurrentSources("REV-DEMO-01"),
    /input drifted/
  );
  await assert.rejects(
    store.freeze("REV-DEMO-01", [casesPath, planPath, sourcePath, knowledgePath]),
    /already exists with another input digest/
  );
});

test("v2 semantic snapshot ignores generated records but detects testcase semantics", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-semantic-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/semantic-review";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/semantic-review");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-main.md");
  const plan = "# Plan\n\n## 测试范围\n\n- 认证状态。\n\n## 需求追溯矩阵\n\n| REQ | caseId |\n| --- | --- |\n| REQ-AUTH-001 | DEMO-AUTH-001 |\n\n## 多角色评审记录\n\n- 尚未评审。\n";
  const cases = `# Cases

## 用例目录

| 用例编号 | 标题 |
| --- | --- |
| DEMO-AUTH-001 | 认证状态 |

## 测试用例：认证状态

## 基本信息
| 用例编号 | DEMO-AUTH-001 |
| 需求追溯编号 | REQ-AUTH-001 |
| 规则覆盖编号 | RULE-AUTH-001 |
| 数据策略 | no_write |
| 风险等级 | 中 |

## 前置条件
- test 环境。

## 操作步骤
| 序号 | 操作 | 输入 | 预期 |
| --- | --- | --- | --- |
| 1 | 查询认证状态 | 无 | 显示当前状态 |
`;
  await writeFile(planPath, plan, "utf8");
  await writeFile(casesPath, cases, "utf8");
  const assessment = assessCaseReviewRisk(cases);
  const scope = buildReviewBatchScopeV3({
    allActivityIds: ["case-review-combined"],
    caseRiskAssessment: assessment,
    activityRoles: [{ activityId: "case-review-combined", role: "combined" }],
    reviewEpochDigest: "d".repeat(64),
    semanticEvolutionCycle: 0
  });
  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const frozen = await store.freeze("REV-SEMANTIC-01", [planPath, casesPath], scope);
  assert.equal(frozen.schemaVersion, "review-input-snapshot-v2");
  assert.deepEqual(Object.keys(frozen.roleInputDigests ?? {}), ["case-review-combined"]);

  await writeFile(
    planPath,
    plan
      .replace("DEMO-AUTH-001", "DEMO-AUTH-009")
      .replace("- 尚未评审。", "- reviewer 正式记录已写入。"),
    "utf8"
  );
  await writeFile(
    casesPath,
    cases.replace("| DEMO-AUTH-001 | 认证状态 |", "| DEMO-AUTH-001 | 认证状态（索引更新） |"),
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

test("role input digests isolate safety-only changes to impact", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-role-scope-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/role-scope";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/role-scope");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-main.md");
  await writeFile(planPath, "# Plan\n\n## 测试范围\n\n- OTP 流程。\n", "utf8");
  const cases = `## 测试用例：OTP
## 基本信息
| 用例编号 | DEMO-OTP-001 |
| 需求追溯编号 | REQ-OTP-001 |
| 规则覆盖编号 | RULE-OTP-001 |
| 数据策略 | tracked_residual |
| 风险等级 | 高 |
## 前置条件
- test 环境。
## 操作步骤
| 序号 | 操作 | 输入 | 预期 |
| --- | --- | --- | --- |
| 1 | 发送一次 OTP 验证码 | 合成手机号 | 进入等待输入状态 |
`;
  await writeFile(casesPath, cases, "utf8");
  const assessment = assessCaseReviewRisk(cases);
  const scope = buildReviewBatchScopeV3({
    allActivityIds: ["case-review-combined", "case-review-impact"],
    caseRiskAssessment: assessment,
    activityRoles: [
      { activityId: "case-review-combined", role: "combined" },
      { activityId: "case-review-impact", role: "impact" }
    ],
    reviewEpochDigest: "e".repeat(64),
    semanticEvolutionCycle: 0
  });
  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  await store.freeze("REV-ROLE-01", [planPath, casesPath], scope);
  await writeFile(
    casesPath,
    cases.replace("tracked_residual", "ephemeral_cleanup"),
    "utf8"
  );
  await store.verifyCurrentSources("REV-ROLE-01", "case-review-combined");
  await assert.rejects(
    store.verifyCurrentSources("REV-ROLE-01", "case-review-impact"),
    /input drifted/
  );
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
  const first = await store.freeze("REV-DEMO-01", [planPath]);
  const second = await store.freeze("REV-DEMO-02", [planPath]);
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

  await store.repair("REV-DEMO-01", [planPath]);
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
    store.freeze("REV-DEMO-01", [resolve(workspaceRoot, "outside.md")]),
    /Reviewer input must be/
  );
  const frozen = await store.freeze("REV-DEMO-01", [resolve(requestRoot, "plan.md")]);
  await writeFile(frozen.artifacts[0]!.snapshotPath, "# tampered\n", "utf8");
  await assert.rejects(store.verify("REV-DEMO-01"), /is corrupt/);
});
