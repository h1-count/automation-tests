import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBatches, buildRequestPlan, inferRuntimeDataCandidates, validateRequestPlan } from "../../scripts/support/test-request-plan.mjs";

const packs = ["web/demo/create", "web/demo/edit", "web/demo/remove"].map((path) => ({ path, feature: path.split("/").at(-1), generatedData: { available: false, recordCount: 0, kind: null } }));
const runtimeDependency = { from: "web/demo/create", to: "web/demo/edit", kind: "runtime_data", evidence: "需求：创建后可编辑", status: "confirmed" };

test("三个无依赖功能包进入最多三个并行设计工作单元", () => {
  const plan = buildRequestPlan({ reportId: "demo", packs });
  assert.equal(plan.designMode, "parallel");
  assert.deepEqual(plan.designBatches, [["web/demo/create", "web/demo/edit", "web/demo/remove"]]);
  assert.deepEqual(plan.executionOrder, ["web/demo/create", "web/demo/edit", "web/demo/remove"]);
});

test("确认的数据依赖阻断下游设计批次并保持脚本和执行串行", () => {
  const plan = buildRequestPlan({ reportId: "demo", packs, dependencies: [runtimeDependency] });
  assert.deepEqual(plan.designBatches, [["web/demo/create", "web/demo/remove"], ["web/demo/edit"]]);
  assert.deepEqual(plan.scriptBatches, [["web/demo/create"], ["web/demo/edit"], ["web/demo/remove"]]);
  assert.deepEqual(plan.executionOrder, ["web/demo/create", "web/demo/edit", "web/demo/remove"]);
});

test("待确认关系、循环依赖和遗漏功能包均无法通过请求门禁", () => {
  const pending = buildRequestPlan({ reportId: "demo", packs, dependencies: [{ ...runtimeDependency, status: "pending_confirmation" }] });
  assert.ok(validateRequestPlan(pending).some((problem) => problem.includes("待确认")));
  const cyclic = { ...buildRequestPlan({ reportId: "demo", packs: packs.slice(0, 2) }), dependencies: [runtimeDependency, { from: "web/demo/edit", to: "web/demo/create", kind: "business_precondition", evidence: "循环", status: "confirmed" }] };
  assert.ok(validateRequestPlan(cyclic).some((problem) => problem.includes("循环依赖")));
  const missing = { ...buildRequestPlan({ reportId: "demo", packs: packs.slice(0, 2) }), dependencies: [{ ...runtimeDependency, to: "web/demo/remove" }] };
  assert.ok(validateRequestPlan(missing).some((problem) => problem.includes("必须都属于")));
});

test("两包请求保持串行设计", () => {
  assert.deepEqual(buildBatches(["a", "b"], [], false), [["a"], ["b"]]);
});

test("脚本读取上游台账时生成待确认数据依赖候选", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "request-plan-"));
  try {
    const consumer = "web/demo/consumer";
    await fs.mkdir(path.join(root, "testpacks", consumer), { recursive: true });
    await fs.writeFile(path.join(root, "testpacks", consumer, "consumer.spec.ts"), 'const p = join(packDirectory, "..", "producer", "runtime", "generated-data.json");\n');
    const candidates = await inferRuntimeDataCandidates(root, [
      { path: "web/demo/producer", feature: "producer" },
      { path: consumer, feature: "consumer" }
    ]);
    assert.deepEqual(candidates, [{ from: "web/demo/producer", to: consumer, kind: "runtime_data", evidence: "脚本读取 web/demo/producer/runtime/generated-data.json", status: "pending_confirmation" }]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
