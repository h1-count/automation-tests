import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";

const requestId = "web/demo/current-run";

test("manager uses only the current local run directory", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-manager-v1-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const manager = new DurableWorkflowManager(requestId, root);

  assert.equal(manager.requestRoot, resolve(root, ".local/test-runs", ...requestId.split("/")));
  assert.equal(manager.planPath, resolve(root, ".local/test-runs", ...requestId.split("/"), "plan.md"));
  assert.equal(manager.historyPath, resolve(root, ".local/test-runs", ...requestId.split("/"), "workflow-history.ndjson"));
});

test("manager does not fall back to the retired request directory", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-manager-v1-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const retiredRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(retiredRoot, { recursive: true });
  await writeFile(resolve(retiredRoot, "plan.md"), "obsolete request plan\n", "utf8");

  const manager = new DurableWorkflowManager(requestId, root);
  await assert.rejects(
    manager.initialize({ capabilities: ["web"], deliveryTarget: "testcase_only" }),
    /Workflow initialization requires plan\.md/u
  );
});
