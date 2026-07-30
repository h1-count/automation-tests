import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const loader = resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs");
const manage = resolve(repositoryRoot, "src/support/task-workflow/cli/manage.ts");
const requestId = "web/demo/cli-contract";

function harness() {
  const root = mkdtempSync(resolve(tmpdir(), "task-manage-contract-"));
  const plan = resolve(root, "testcases", requestId, "plan.md");
  mkdirSync(resolve(plan, ".."), { recursive: true });
  writeFileSync(plan, `# plan\n\n## 用例包目录\n\n| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 |\n| --- | --- | --- | --- |\n| \`cases-main.md\` | demo | demo | 阶段二生成 |\n`, "utf8");
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", loader, manage, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  return { root, run };
}

test("task:manage rejects retired command aliases after a valid workflow exists", () => {
  const subject = harness();
  try {
    const initialized = subject.run("init", "--request", requestId, "--capability", "web");
    assert.equal(initialized.status, 0, initialized.stderr);
    for (const command of [
      "reviewer-bind",
      "migrate-v11",
      "transaction-start",
      "review-transaction-finalize",
      "heartbeat-start"
    ]) {
      const result = subject.run(command, "--request", requestId);
      assert.notEqual(result.status, 0, command);
      assert.match(result.stderr, /Unsupported task:manage command/);
    }
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});
