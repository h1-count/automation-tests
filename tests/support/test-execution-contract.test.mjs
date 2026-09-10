import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { expandPrerequisites, loadExecutionContract } from "../../scripts/support/test-execution-contract.mjs";

test("执行契约递归补齐同包前置用例", () => {
  const selected = expandPrerequisites({ dependsOn: { "OP-X-001": [], "OP-X-002": ["OP-X-001"], "OP-X-003": ["OP-X-002"] } }, ["OP-X-003"]);
  assert.deepEqual(selected, ["OP-X-001", "OP-X-002", "OP-X-003"]);
});

test("执行契约拒绝仅在注释中出现的用例和循环依赖", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "execution-contract-"));
  const pack = path.join(root, "testpacks", "web", "demo");
  await fs.mkdir(pack, { recursive: true });
  await fs.writeFile(path.join(pack, "cases.md"), "OP-X-001\nOP-X-002\n");
  await fs.writeFile(path.join(pack, "demo.spec.ts"), '// 覆盖用例 OP-X-001\ntest("OP-X-002 可执行", async () => {});\n');
  await fs.writeFile(path.join(pack, "execution.json"), JSON.stringify({ schema: "test-execution-contract", cases: { "OP-X-001": { dependsOn: ["OP-X-002"] }, "OP-X-002": { dependsOn: ["OP-X-001"] } } }));
  await assert.rejects(() => loadExecutionContract(root, pack), /未出现在可选择的 test\(\) 标题.*循环依赖/u);
  await fs.rm(root, { recursive: true, force: true });
});
