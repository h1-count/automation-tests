import assert from "node:assert/strict";
import test from "node:test";
import { auditAgentDispatch } from "../../scripts/audit-agent-dispatch.mjs";
import { buildRequestPlan, validateAgentWorkOrders, validateWorkOrderUse } from "../../scripts/support/test-request-plan.mjs";

const packs = ["web/demo/create", "web/demo/edit", "web/demo/remove", "web/demo/publish"]
  .map((path) => ({ path, feature: path.split("/").at(-1), generatedData: { available: false, recordCount: 0, kind: null } }));

test("一至两包没有工作单，三包以上每包恰有一个功能包级工作单", () => {
  assert.deepEqual(buildRequestPlan({ reportId: "one", packs: packs.slice(0, 1) }).agentWorkOrders, []);
  assert.deepEqual(buildRequestPlan({ reportId: "two", packs: packs.slice(0, 2) }).agentWorkOrders, []);
  const plan = buildRequestPlan({ reportId: "four", packs });
  assert.equal(plan.agentWorkOrders.length, 4);
  assert.deepEqual(plan.agentWorkOrders.map((item) => item.packPath).sort(), packs.map((item) => item.path).sort());
  assert.ok(plan.agentWorkOrders.every((item) => item.allowedStages.length === 4));
  assert.ok(plan.designBatches.every((batch) => batch.length <= 3));
});

test("确认依赖同步决定工作单批次与上游上下文", () => {
  const dependency = { from: "web/demo/create", to: "web/demo/edit", kind: "runtime_data", evidence: "创建后编辑", status: "confirmed" };
  const plan = buildRequestPlan({ reportId: "dependency", packs: packs.slice(0, 3), dependencies: [dependency] });
  const edit = plan.agentWorkOrders.find((item) => item.packPath === "web/demo/edit");
  assert.equal(edit.batchId, 2);
  assert.deepEqual(edit.allowedContext.upstreamDependencies, [{ packPath: dependency.from, kind: dependency.kind, evidence: dependency.evidence }]);
});

test("组件级字段、错误批次和越界工作单都会被拒绝", () => {
  const plan = buildRequestPlan({ reportId: "invalid", packs: packs.slice(0, 3) });
  plan.agentWorkOrders[0].componentPath = "components/UpRule.vue";
  assert.ok(validateAgentWorkOrders(plan).some((problem) => problem.includes("禁止组件")));

  const wrongBatch = buildRequestPlan({ reportId: "wrong-batch", packs: packs.slice(0, 3) });
  wrongBatch.agentWorkOrders[0].batchId = 9;
  assert.ok(auditAgentDispatch(wrongBatch).problems.some((problem) => problem.includes("机器计算结果")));

  const valid = buildRequestPlan({ reportId: "use", packs: packs.slice(0, 3) });
  assert.ok(validateWorkOrderUse(valid, "web/demo/edit", "WO-B1-01", "case_design").some((problem) => problem.includes("只能处理")));
  assert.ok(validateWorkOrderUse(valid, "web/demo/edit", undefined, "case_design").some((problem) => problem.includes("必须提供")));
});
