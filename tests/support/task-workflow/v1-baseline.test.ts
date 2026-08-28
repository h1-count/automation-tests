import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { buildWorkflowDefinition, workflowStartedPayload } from "../../../src/support/task-workflow/definition.js";
import { CURRENT_WORKFLOW_VERSION } from "../../../src/support/task-workflow/currentVersion.js";
import { WorkflowHistoryStore } from "../../../src/support/task-workflow/historyStore.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test("v1 freezes request-policy-v1 into the only writable definition", () => {
  const definition = buildWorkflowDefinition({
    requestId: "web/demo/v1-baseline",
    planDigest: digest("plan"),
    planText: "rule-design-ledger-v1",
    capabilities: ["web"],
    writesData: false,
    deliveryTarget: "testcase_only",
    casePackages: ["cases.md"],
    requestPolicy: {
      schemaVersion: "request-policy-v1",
      reuseDecision: "full_replan",
      deliveryTarget: "testcase_only",
      reviewSpeed: "fast",
      writesData: false,
      selectedCaseIds: ["DEMO-001"]
    }
  });
  assert.equal(definition.definitionVersion, CURRENT_WORKFLOW_VERSION);
  assert.equal(definition.requestPolicy.reviewSpeed, "fast");
  assert.deepEqual(workflowStartedPayload(definition).requestPolicy, definition.requestPolicy);
});

test("history store rejects a pre-baseline definition before it can be replayed", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-v1-baseline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkflowHistoryStore(resolve(root, "workflow-history.ndjson"));
  await assert.rejects(
    store.append({
      runId: "run-1",
      requestId: "web/demo/unsupported",
      definitionId: "durable-test-workflow",
      definitionVersion: "v13",
      type: "WorkflowStarted",
      actorType: "system",
      idempotencyKey: "unsupported/start"
    }),
    /debug baseline reset/
  );
});
