import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assembleCandidateFragments,
  candidateFragmentManifestDigest,
  parseCandidateFragmentManifest,
  validateCandidateFragmentContent
} from "../../../src/support/task-workflow/candidateFragments.ts";
import { buildV8CandidateExtension } from "../../../src/support/task-workflow/definition.ts";
import { buildAdaptiveReviewPolicy } from "../../../src/support/task-workflow/reviewPolicy.ts";
import { reduceWorkflow } from "../../../src/support/task-workflow/reducer.ts";
import { deriveRequestTimeline } from "../../../src/support/task-workflow/requestCostAnalysis.ts";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.ts";
import { ActivityLeaseKeepalive } from "../../../src/support/task-workflow/activityLeaseKeepalive.ts";

const manifestText = JSON.stringify({
  schemaVersion: "candidate-fragment-manifest-v1",
  scope: "full",
  modules: [
    {
      id: "account",
      title: "账号",
      ruleIds: ["RULE-DEMO-ACCOUNT"],
      casePrefix: "DEMO-ACCOUNT",
      sourceRefs: ["SRC-DEMO-ACCOUNT"]
    },
    {
      id: "profile",
      title: "资料",
      ruleIds: ["RULE-DEMO-PROFILE"],
      casePrefix: "DEMO-PROFILE",
      sourceRefs: ["SRC-DEMO-PROFILE"]
    }
  ]
});

function fragmentMarkdown(module: ReturnType<typeof parseCandidateFragmentManifest>["modules"][number]): string {
  return `## 模块：${module.title}

<details>
<summary>${module.casePrefix}-001｜验证${module.title}规则｜P1｜低风险</summary>

> 规则：${module.ruleIds.join("、")}
> 前置条件：无
> 差异：来源=${module.sourceRefs.join("、")}

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 查看${module.title}页面 | 无 | 页面展示预期结果 |

</details>
`;
}

test("fragment manifest freezes unique module RULE ownership", () => {
  const manifest = parseCandidateFragmentManifest(manifestText);
  assert.equal(manifest.modules.length, 2);
  assert.match(candidateFragmentManifestDigest(manifest), /^[a-f0-9]{64}$/);
  assert.throws(() => parseCandidateFragmentManifest(JSON.stringify({
    ...manifest,
    modules: [manifest.modules[0], { ...manifest.modules[1], ruleIds: ["RULE-DEMO-ACCOUNT"] }]
  })), /cross-module RULE ownership/);
});

test("fragment content rejects RULEs outside its frozen module", () => {
  const module = parseCandidateFragmentManifest(manifestText).modules[0]!;
  validateCandidateFragmentContent(fragmentMarkdown(module), module);
  assert.throws(
    () => validateCandidateFragmentContent(fragmentMarkdown({
      ...module,
      ruleIds: ["RULE-DEMO-PROFILE"]
    }), module),
    /outside its frozen module/
  );
});

test("deterministic assembly keeps frozen module order and rebuilds the derived view", () => {
  const manifest = parseCandidateFragmentManifest(manifestText);
  const cases = assembleCandidateFragments({
    manifest,
    fragments: new Map(manifest.modules.map((module) => [module.id, fragmentMarkdown(module)])),
    defaults: { testType: "Web", environment: "test", dataStrategy: "no_write" }
  });
  assert.match(cases, /> 共 2 条 ｜ P0 0 条 ｜ 高风险 0 条 ｜ 参数化 0 条/u);
  assert.ok(cases.indexOf("## 模块：账号") < cases.indexOf("## 模块：资料"));
  assert.match(cases, /\| 账号 \| DEMO-ACCOUNT-001 \|/u);
  assert.throws(() => assembleCandidateFragments({
    manifest,
    fragments: new Map([[manifest.modules[0]!.id, fragmentMarkdown(manifest.modules[0]!)]]),
    defaults: { testType: "Web", environment: "test", dataStrategy: "no_write" }
  }), /missing fragment profile/u);
});

test("fragment lease keeper renews at one third and blocks publication after renewal failure", async () => {
  let renewals = 0;
  const keeper = new ActivityLeaseKeepalive(900, async () => {
    renewals += 1;
  });
  assert.equal(keeper.intervalMs, 300);
  await keeper.renewNow();
  assert.equal(renewals, 1);

  const failing = new ActivityLeaseKeepalive(900, async () => {
    throw new Error("lease lost");
  });
  await failing.renewNow();
  assert.throws(() => failing.assertHealthy(), /stop new calls and reconcile/u);
});

test("v8 extension uses independently retryable fragments with bounded concurrency", () => {
  const manifest = parseCandidateFragmentManifest(manifestText);
  const activities = buildV8CandidateExtension({
    modules: manifest.modules,
    scope: "full",
    capabilities: ["web"],
    writesData: false,
    deliveryTarget: "testcase_only",
    reviewPolicy: buildAdaptiveReviewPolicy()
  });
  const fragments = activities.filter((activity) => activity.kind === "candidate_fragment");
  assert.equal(fragments.length, 2);
  assert.ok(fragments.every((activity) =>
    activity.concurrencyGroup === "candidate_generation" && activity.concurrencyLimit === 3
  ));
  assert.deepEqual(
    activities.find((activity) => activity.id === "candidate-assemble")?.dependencies,
    fragments.map((activity) => activity.id)
  );
});

test("v8 skeleton expands once and independently publishes every frozen fragment", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-fragments-v8-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/candidate-fragments";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), `# 测试计划

> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |
`, "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    casePackages: ["cases.md"],
    deliveryTarget: "testcase_only",
    fragmented: true
  });
  const source = await manager.startActivity("source-selection", "host");
  await manager.succeedActivity("source-selection", {
    claimToken: source.claimToken,
    verification: "sources selected"
  });
  const skeleton = await manager.startActivity("candidate-skeleton", "host");
  await manager.publishArtifactsAndSucceed("candidate-skeleton", {
    claimToken: skeleton.claimToken,
    publishId: "candidate-skeleton-v8",
    verification: "frozen candidate skeleton",
    artifacts: [{
      targetPath: `testcases/${requestId}/candidate-fragments/manifest.json`,
      content: manifestText
    }]
  });

  const expanded = await manager.expandCandidateGraph();
  assert.equal(expanded.definitionVersion, "v8");
  assert.ok(expanded.activities["candidate-fragment-account"]);
  assert.ok(expanded.activities["candidate-fragment-profile"]);
  assert.deepEqual(
    expanded.readyActivities.sort(),
    ["candidate-fragment-account", "candidate-fragment-profile"]
  );
  await assert.rejects(manager.expandCandidateGraph(), /already expanded/u);
  const events = await manager.events();
  const tamperedParent = events.map((event) => event.type === "CandidateGraphExpanded"
    ? { ...event, payload: { ...event.payload, parentGraphDigest: "0".repeat(64) } }
    : event
  );
  assert.throws(
    () => reduceWorkflow(tamperedParent),
    /parentGraphDigest does not match/u
  );
  const tamperedModules = events.map((event) => event.type === "CandidateGraphExpanded"
    ? {
        ...event,
        payload: {
          ...event.payload,
          modules: [{
            ...(event.payload.modules as Array<Record<string, unknown>>)[0]!,
            ruleIds: ["RULE-TAMPERED"]
          }]
        }
      }
    : event
  );
  assert.throws(
    () => reduceWorkflow(tamperedModules),
    /not a valid frozen skeleton|skeletonDigest does not match/u
  );

  for (const module of parseCandidateFragmentManifest(manifestText).modules) {
    const activityId = `candidate-fragment-${module.id}`;
    const fragment = await manager.startActivity(activityId, "host");
    await manager.publishArtifactsAndSucceed(activityId, {
      claimToken: fragment.claimToken,
      publishId: `${activityId}-v8`,
      verification: `fragment ${module.id}`,
      artifacts: [{
        targetPath: `testcases/${requestId}/candidate-fragments/${module.id}.md`,
        content: fragmentMarkdown(module)
      }]
    });
  }
  const readyForAssembly = await manager.gate();
  assert.deepEqual(readyForAssembly.readyActivities, ["candidate-assemble"]);
  const assembly = await manager.startActivity("candidate-assemble", "host");
  const assembled = await manager.assembleCandidateFragments({
    claimToken: assembly.claimToken,
    publishId: "candidate-assemble-v8",
    verification: "deterministic assembly"
  });
  assert.deepEqual(assembled.readyActivities, ["candidate-gate"]);
  const cases = await readFile(resolve(requestRoot, "cases.md"), "utf8");
  assert.match(cases, /# 用例集：候选测试设计/u);
  assert.match(cases, /\| 资料 \| DEMO-PROFILE-001 \|/u);
});

test("cost analysis reports fragment wall time separately from aggregate work", () => {
  const timeline = deriveRequestTimeline([
    { type: "ActivityAttemptStarted", occurredAt: "2026-08-24T00:00:00.000Z", payload: { activityId: "candidate-skeleton", attempt: 1 } },
    { type: "ActivitySucceeded", occurredAt: "2026-08-24T00:01:00.000Z", payload: { activityId: "candidate-skeleton", attempt: 1 } },
    { type: "ActivityAttemptStarted", occurredAt: "2026-08-24T00:01:00.000Z", payload: { activityId: "candidate-fragment-a", attempt: 1 } },
    { type: "ActivityAttemptStarted", occurredAt: "2026-08-24T00:01:00.000Z", payload: { activityId: "candidate-fragment-b", attempt: 1 } },
    { type: "ActivitySucceeded", occurredAt: "2026-08-24T00:03:00.000Z", payload: { activityId: "candidate-fragment-a", attempt: 1 } },
    { type: "ActivitySucceeded", occurredAt: "2026-08-24T00:04:00.000Z", payload: { activityId: "candidate-fragment-b", attempt: 1 } }
  ]);
  assert.deepEqual(timeline.candidateGeneration, {
    skeletonSeconds: 60,
    fragmentBusySeconds: 300,
    fragmentWallSeconds: 180,
    fragmentCriticalPathSeconds: 180,
    assemblySeconds: 0,
    fragmentCount: 2
  });
});
