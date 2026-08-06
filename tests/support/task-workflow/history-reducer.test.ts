import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  GENESIS_DIGEST,
  WorkflowHistoryConflictError,
  WorkflowHistoryIntegrityError,
  WorkflowHistoryStore,
  WorkflowTransitionError,
  activitiesExpandedPayload,
  buildWorkflowDefinition,
  calculateEventDigest,
  canonicalJson,
  reduceWorkflow,
  reviewInputDigest,
  workflowStartedPayload,
  type NewWorkflowEvent,
  type SafeJsonValue,
  type WorkflowDefinition,
  type WorkflowEvent
} from "../../../src/support/task-workflow/index.js";

const planDigest = "a".repeat(64);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function definition(
  overrides: Partial<Parameters<typeof buildWorkflowDefinition>[0]> = {}
): WorkflowDefinition {
  return buildWorkflowDefinition({
    requestId: "web/open-platform/registration",
    planDigest,
    capabilities: ["web"],
    casePackages: ["cases-registration.md"],
    ...overrides
  });
}

function eventInput(
  workflow: WorkflowDefinition,
  type: NewWorkflowEvent["type"],
  idempotencyKey: string,
  payload: NewWorkflowEvent["payload"] = {},
  actorType: NewWorkflowEvent["actorType"] = "agent"
): NewWorkflowEvent {
  return {
    runId: "run-1",
    requestId: workflow.requestId,
    definitionId: workflow.definitionId,
    definitionVersion: workflow.definitionVersion,
    type,
    actorType,
    idempotencyKey,
    payload,
    occurredAt: "2026-07-28T00:00:00.000Z"
  };
}

async function initialized(
  root: string,
  workflow = definition()
): Promise<WorkflowHistoryStore> {
  const store = new WorkflowHistoryStore(
    resolve(root, "workflow-history.ndjson"),
    resolve(root, ".local/workflow-history-locks"),
    (events) => {
      reduceWorkflow(events);
    }
  );
  await store.appendBatch([
    eventInput(workflow, "WorkflowStarted", "start", workflowStartedPayload(workflow), "system"),
    eventInput(workflow, "ActivitiesExpanded", "expand", activitiesExpandedPayload(workflow), "system")
  ], { seq: 0, digest: GENESIS_DIGEST });
  return store;
}

async function appendActivitySuccess(
  store: WorkflowHistoryStore,
  workflow: WorkflowDefinition,
  activityId: string,
  key: string,
  extra: Record<string, SafeJsonValue> = {}
): Promise<void> {
  const projection = reduceWorkflow(await store.read());
  const activity = projection.activities[activityId]!;
  await store.append(eventInput(workflow, "ActivityAttemptStarted", `${key}-start`, {
    activityId,
    attempt: activity.attempt + 1
  }));
  if (activity.definition.publishesArtifacts) {
    const path = `testcases/web/open-platform/registration/${activityId}.md`;
    const digest = sha256(`artifact:${activityId}`);
    await store.append(eventInput(workflow, "ArtifactPublishPrepared", `${key}-prepare`, {
      activityId,
      publishId: `${key}-publish`,
      manifestDigest: sha256(`${key}:manifest`),
      artifacts: [{
        targetPath: path,
        digest,
        expectedPreviousDigest: null,
        sizeBytes: 1
      }]
    }));
    await store.append(eventInput(workflow, "ActivitySucceeded", `${key}-success`, {
      activityId,
      outputRefs: [path],
      outputDigests: [{ path, digest }],
      ...extra
    }));
    return;
  }
  await store.append(eventInput(workflow, "ActivitySucceeded", `${key}-success`, {
    activityId,
    ...extra
  }));
}

test("canonical JSON is stable regardless of insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: true, a: ["x", null] } }),
    canonicalJson({ nested: { a: ["x", null], b: true }, z: 1 })
  );
});

test("history append is hash chained, CAS protected, idempotent, and sensitive-safe", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-history-contract-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const store = await initialized(root, workflow);
  const events = await store.read();
  assert.equal(events.length, 2);
  assert.equal(events[1]!.prevDigest, events[0]!.digest);

  const duplicate = await store.append(
    eventInput(workflow, "ActivitiesExpanded", "expand", activitiesExpandedPayload(workflow), "system")
  );
  assert.equal(duplicate.seq, 2);
  await assert.rejects(
    store.append(
      eventInput(workflow, "WorkflowSuspended", "stale", { reason: "stale" }),
      { seq: 0, digest: GENESIS_DIGEST }
    ),
    WorkflowHistoryConflictError
  );
  await assert.rejects(
    store.append(eventInput(workflow, "WorkflowSuspended", "secret", {
      claimToken: "must-not-persist"
    })),
    /reserved for sensitive runtime data/
  );
  await assert.rejects(
    store.append(eventInput(workflow, "LegacyStateImported", "legacy-write")),
    /can never be appended/
  );
});

test("history verification safely rejects truncation, tampering, and duplicate sequence", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-history-integrity-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = await initialized(root);
  const valid = await readFile(store.historyPath, "utf8");
  await writeFile(store.historyPath, valid.trimEnd(), "utf8");
  await assert.rejects(store.read(), WorkflowHistoryIntegrityError);

  await writeFile(store.historyPath, valid.replace('"requestId":"web/', '"requestId":"api/'), "utf8");
  await assert.rejects(store.read(), WorkflowHistoryIntegrityError);

  const first = valid.trimEnd().split("\n")[0]!;
  await writeFile(store.historyPath, `${first}\n${first}\n`, "utf8");
  await assert.rejects(store.read(), WorkflowHistoryIntegrityError);
});

test("v3 and vnext histories remain readable but reject every new append", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-readonly-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const writable = definition();

  for (const version of ["v3", "vnext-1"]) {
    const historical = { ...writable, definitionVersion: version };
    const input = eventInput(
      historical,
      "WorkflowStarted",
      `start-${version}`,
      workflowStartedPayload(historical),
      "system"
    );
    const unsigned: Omit<WorkflowEvent, "digest"> = {
      schemaVersion: "test-workflow-event-v1",
      eventId: `historical-${version}`,
      seq: 1,
      runId: input.runId,
      requestId: input.requestId,
      definitionId: input.definitionId,
      definitionVersion: input.definitionVersion,
      type: input.type,
      occurredAt: input.occurredAt!,
      actorType: input.actorType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      prevDigest: GENESIS_DIGEST
    };
    const path = resolve(root, version, "workflow-history.ndjson");
    await mkdir(resolve(root, version), { recursive: true });
    await writeFile(path, `${canonicalJson({ ...unsigned, digest: calculateEventDigest(unsigned) } as SafeJsonValue)}\n`, "utf8");
    const store = new WorkflowHistoryStore(path, resolve(root, ".local", `locks-${version}`));
    assert.equal((await store.read())[0]?.definitionVersion, version);
    await assert.rejects(
      store.append(eventInput(writable, "WorkflowSuspended", `append-${version}`, { reason: "test" })),
      /replay-only.*definitionVersion/
    );
  }
});

test("v3 review invalidation without inputDigest remains replayable", () => {
  const writable = definition({ reviewerRoles: ["requirements"] });
  const reviewActivityId = "case-review-requirements";
  const historical: WorkflowDefinition = {
    ...writable,
    definitionVersion: "v3",
    activities: writable.activities.map((activity) =>
      activity.id === reviewActivityId ? { ...activity, dependencies: [] } : activity
    )
  };
  const { graphDigest: _previousDigest, ...unsignedDefinition } = historical;
  historical.graphDigest = sha256(canonicalJson(unsignedDefinition as unknown as SafeJsonValue));
  const inputDigest = "b".repeat(64);
  const drafts: NewWorkflowEvent[] = [
    eventInput(historical, "WorkflowStarted", "v3-start", workflowStartedPayload(historical), "system"),
    eventInput(historical, "ActivitiesExpanded", "v3-expand", activitiesExpandedPayload(historical), "system"),
    eventInput(historical, "ReviewBatchStarted", "v3-batch", {
      batchId: "REV-V3-1",
      inputDigest
    }),
    eventInput(historical, "ReviewerDispatched", "v3-dispatch", {
      activityId: reviewActivityId,
      batchId: "REV-V3-1",
      role: "requirements",
      attempt: 1,
      inputDigest
    }),
    eventInput(historical, "ReviewerSubmitted", "v3-submit", {
      activityId: reviewActivityId,
      batchId: "REV-V3-1",
      role: "requirements",
      attempt: 1,
      inputDigest,
      planEvidenceRef: "testcases/web/open-platform/registration/plan.md",
      planEvidenceDigest: planDigest
    }, "reviewer"),
    eventInput(historical, "ReviewBatchInvalidated", "v3-invalidate", {
      batchId: "REV-V3-1",
      activityIds: [reviewActivityId],
      revisionDigest: "c".repeat(64),
      findingsDigest: "d".repeat(64),
      reason: "evidence-backed-case-review-evolution"
    }, "system")
  ];
  let previousDigest = GENESIS_DIGEST;
  const events = drafts.map((draft, index) => {
    const unsigned: Omit<WorkflowEvent, "digest"> = {
      schemaVersion: "test-workflow-event-v1",
      eventId: `v3-event-${index + 1}`,
      seq: index + 1,
      runId: draft.runId,
      requestId: draft.requestId,
      definitionId: draft.definitionId,
      definitionVersion: draft.definitionVersion,
      type: draft.type,
      occurredAt: draft.occurredAt!,
      actorType: draft.actorType,
      idempotencyKey: draft.idempotencyKey,
      payload: draft.payload ?? {},
      prevDigest: previousDigest
    };
    const event = { ...unsigned, digest: calculateEventDigest(unsigned) };
    previousDigest = event.digest;
    return event;
  });

  const projection = reduceWorkflow(events);
  assert.equal(projection.activities[reviewActivityId]?.state, "READY");
});

test("stable history locks are independent from disposable runtime deletion", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-history-stable-lock-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const lockRoot = resolve(root, ".local/workflow-history-locks");
  const store = new WorkflowHistoryStore(
    resolve(root, "request/workflow-history.ndjson"),
    lockRoot
  );
  await store.append(eventInput(
    workflow,
    "WorkflowStarted",
    "start",
    workflowStartedPayload(workflow),
    "system"
  ));
  await mkdir(resolve(root, ".local/test-task-runtime"), { recursive: true });
  await rm(resolve(root, ".local/test-task-runtime"), { recursive: true, force: true });
  assert.ok(store.lockPath.startsWith(lockRoot));
  const head = await store.head();
  const results = await Promise.allSettled([
    store.append(
      eventInput(workflow, "ActivitiesExpanded", "expand-a", activitiesExpandedPayload(workflow), "system"),
      head
    ),
    store.append(
      eventInput(workflow, "ActivitiesExpanded", "expand-b", activitiesExpandedPayload(workflow), "system"),
      head
    )
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await store.read()).length, 2);
});

test("an expired history lock owned by a live PID is never recovered", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-history-live-lock-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const store = new WorkflowHistoryStore(
    resolve(root, "request/workflow-history.ndjson"),
    resolve(root, ".local/workflow-history-locks")
  );
  await mkdir(resolve(store.lockPath, ".."), { recursive: true });
  await writeFile(store.lockPath, JSON.stringify({
    owner: `${process.pid}:still-running`,
    expiresAt: Date.now() - 60_000
  }), "utf8");
  const old = new Date(Date.now() - 60_000);
  await utimes(store.lockPath, old, old);

  await assert.rejects(
    store.append(eventInput(
      workflow,
      "WorkflowStarted",
      "start",
      workflowStartedPayload(workflow),
      "system"
    )),
    WorkflowHistoryConflictError
  );
  assert.match(await readFile(store.lockPath, "utf8"), /still-running/);
  assert.deepEqual(await store.read(), []);
});

test("an unverifiable history lock is recovered only after its fallback timeout", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-history-unknown-lock-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const store = new WorkflowHistoryStore(
    resolve(root, "request/workflow-history.ndjson"),
    resolve(root, ".local/workflow-history-locks")
  );
  await mkdir(resolve(store.lockPath, ".."), { recursive: true });
  await writeFile(store.lockPath, "{partial", "utf8");

  await assert.rejects(
    store.append(eventInput(
      workflow,
      "WorkflowStarted",
      "start",
      workflowStartedPayload(workflow),
      "system"
    )),
    WorkflowHistoryConflictError
  );

  const old = new Date(Date.now() - 60_000);
  await utimes(store.lockPath, old, old);
  await store.append(eventInput(
    workflow,
    "WorkflowStarted",
    "start",
    workflowStartedPayload(workflow),
    "system"
  ));
  assert.equal((await store.read()).length, 1);
});

test("new definition is v5-only, risk-selectable, and has exactly three fixed confirmations", () => {
  const defaults = definition();
  assert.equal(defaults.definitionVersion, "v5");
  assert.deepEqual(
    defaults.reviewPolicy?.requiredRoles,
    ["requirements", "design", "traceability"]
  );
  const selected = definition({ reviewerRoles: ["interaction"] });
  assert.deepEqual(selected.reviewPolicy?.requiredRoles, ["interaction"]);
  assert.ok(selected.activities
    .filter((activity) => activity.kind === "review")
    .every((activity) => activity.concurrencyLimit === 3));
  const callbackIds = selected.activities
    .filter((activity) => [
      "plan-confirmation",
      "case-confirmation",
      "execution-authorization"
    ].includes(activity.id))
    .map((activity) => activity.id);
  assert.deepEqual(callbackIds, [
    "plan-confirmation",
    "case-confirmation",
    "execution-authorization"
  ]);
  assert.equal(selected.activities.some((activity) => activity.id === "asset-change-decision"), false);
});

test("explicit isolation is the only way a read execution receives two workers", () => {
  const execute = (isolation?: {
    contexts: boolean;
    accounts: boolean;
    data: boolean;
    sharedAccount?: boolean;
  }) => definition({ executionIsolation: isolation }).activities
    .find((activity) => activity.id === "run")!;
  assert.equal(execute().metadata?.maxWorkers, 1);
  assert.equal(execute({
    contexts: true,
    accounts: true,
    data: true,
    sharedAccount: true
  }).metadata?.maxWorkers, 1);
  assert.equal(execute({
    contexts: true,
    accounts: true,
    data: true,
    sharedAccount: false
  }).metadata?.maxWorkers, 2);
  assert.equal(definition({ writesData: true }).activities
    .find((activity) => activity.id === "run")?.metadata?.maxWorkers, 1);
});

test("accepted plan callback immediately makes every case package ready", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-plan-callback-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition({ casePackages: ["cases-a.md", "cases-b.md"] });
  const store = await initialized(root, workflow);
  await appendActivitySuccess(store, workflow, "source-selection", "source");
  await appendActivitySuccess(store, workflow, "plan-validation", "plan");
  const callbackPlanPath = "testcases/web/open-platform/registration/plan.md";
  const callbackPlanDigest = sha256("accepted plan");
  const callbackManifestDigest = sha256("callback plan manifest");
  await store.appendBatch([
    eventInput(workflow, "ActivityAttemptStarted", "callback-start", {
      activityId: "plan-confirmation",
      attempt: 1
    }),
    eventInput(workflow, "CallbackRequested", "callback-request", {
      activityId: "plan-confirmation",
      callbackId: "confirm-plan",
      subjectDigest: planDigest,
      kind: "plan_confirmation"
    }),
    eventInput(workflow, "ArtifactPublishPrepared", "callback-plan-prepared", {
      activityId: "plan-confirmation",
      publishId: "callback-plan-publish",
      manifestDigest: callbackManifestDigest,
      artifacts: [{
        targetPath: callbackPlanPath,
        digest: callbackPlanDigest,
        expectedPreviousDigest: null,
        sizeBytes: 1
      }]
    }),
    eventInput(workflow, "CallbackResolved", "callback-accepted", {
      activityId: "plan-confirmation",
      callbackId: "confirm-plan",
      subjectDigest: planDigest,
      resolution: "accepted",
      publishId: "callback-plan-publish",
      manifestDigest: callbackManifestDigest,
      planPath: callbackPlanPath,
      planDigest: callbackPlanDigest
    }, "user")
  ], await store.head());
  const projection = reduceWorkflow(await store.read());
  assert.deepEqual(
    projection.readyActivities.sort(),
    ["case-generation-cases-a-md", "case-generation-cases-b-md"]
  );
  assert.equal(projection.continuation.kind, "continue_now");
  assert.equal(projection.reply.kind, "none");
});

test("a system carry-forward preserves the real plan decision and supersedes one legacy callback", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-plan-carry-forward-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  workflow.activities = workflow.activities.map((activity) =>
    activity.id === "case-review-resolution"
      ? { ...activity, dependencies: [] }
      : activity
  );
  const { graphDigest: _graphDigest, ...unsignedWorkflow } = workflow;
  workflow.graphDigest = sha256(
    canonicalJson(unsignedWorkflow as unknown as SafeJsonValue)
  );
  const store = await initialized(root, workflow);
  await appendActivitySuccess(store, workflow, "source-selection", "source");
  await appendActivitySuccess(store, workflow, "plan-validation", "plan");
  const callbackPlanPath = "testcases/web/open-platform/registration/plan.md";
  const originSubjectDigest = "1".repeat(64);
  const pendingSubjectDigest = "2".repeat(64);
  const effectiveSubjectDigest = "3".repeat(64);
  const originPlanDigest = "4".repeat(64);
  const currentPlanDigest = sha256("artifact:case-review-resolution");
  const callbackManifestDigest = "6".repeat(64);
  const reviewInputRefs = [{
    path: callbackPlanPath,
    digest: originPlanDigest,
    sizeBytes: 1
  }];
  const reviewInputDigestValue = reviewInputDigest(
    workflow.requestId,
    reviewInputRefs.map((ref) => ({
      sourcePath: ref.path,
      digest: ref.digest,
      sizeBytes: ref.sizeBytes
    }))
  );
  await store.appendBatch([
    eventInput(workflow, "ActivityAttemptStarted", "origin-start", {
      activityId: "plan-confirmation",
      attempt: 1
    }),
    eventInput(workflow, "CallbackRequested", "origin-request", {
      activityId: "plan-confirmation",
      callbackId: "origin-plan-confirmation",
      subjectDigest: originSubjectDigest,
      kind: "plan_confirmation"
    }),
    eventInput(workflow, "ArtifactPublishPrepared", "origin-plan-prepared", {
      activityId: "plan-confirmation",
      publishId: "origin-plan-publish",
      manifestDigest: callbackManifestDigest,
      artifacts: [{
        targetPath: callbackPlanPath,
        digest: originPlanDigest,
        expectedPreviousDigest: null,
        sizeBytes: 1
      }]
    }),
    eventInput(workflow, "CallbackResolved", "origin-accepted", {
      activityId: "plan-confirmation",
      callbackId: "origin-plan-confirmation",
      subjectDigest: originSubjectDigest,
      resolution: "accepted",
      publishId: "origin-plan-publish",
      manifestDigest: callbackManifestDigest,
      planPath: callbackPlanPath,
      planDigest: originPlanDigest
    }, "user"),
    eventInput(workflow, "ReviewBatchStarted", "review-batch", {
      batchId: "REV-LEGACY-1",
      inputDigest: reviewInputDigestValue,
      inputRefs: reviewInputRefs
    })
  ], await store.head());
  await appendActivitySuccess(
    store,
    workflow,
    "case-review-resolution",
    "review-resolution",
    { outcome: "evolve" }
  );
  await store.appendBatch([
    eventInput(workflow, "ActivitiesInvalidated", "invalidate-plan", {
      activityIds: ["plan-confirmation"],
      reason: "legacy projection drift",
      subjectDigest: originSubjectDigest
    }),
    eventInput(workflow, "ActivityAttemptStarted", "pending-start", {
      activityId: "plan-confirmation",
      attempt: 2
    }),
    eventInput(workflow, "CallbackRequested", "pending-request", {
      activityId: "plan-confirmation",
      callbackId: "pending-plan-confirmation",
      subjectDigest: pendingSubjectDigest,
      kind: "plan_confirmation"
    })
  ], await store.head());
  const carryPayload = {
    activityId: "plan-confirmation",
    originCallbackId: "origin-plan-confirmation",
    originSubjectDigest,
    originSubjectSchemaVersion: "plan-confirmation-subject-v1",
    originPlanDigest,
    supersededCallbackId: "pending-plan-confirmation",
    supersededSubjectDigest: pendingSubjectDigest,
    currentPlanDigest,
    effectiveSubjectSchemaVersion: "plan-confirmation-subject-v2",
    effectiveSubjectDigest,
    reviewBatchId: "REV-LEGACY-1",
    reviewInputDigest: reviewInputDigestValue,
    evolutionActivityId: "case-review-resolution"
  };
  await assert.rejects(
    store.append(eventInput(
      workflow,
      "PlanConfirmationCarriedForward",
      "carry-wrong-origin-plan",
      { ...carryPayload, originPlanDigest: "7".repeat(64) },
      "system"
    )),
    /origin is not a recorded accepted plan callback/
  );
  await assert.rejects(
    store.append(eventInput(
      workflow,
      "PlanConfirmationCarriedForward",
      "carry-wrong-review-input",
      { ...carryPayload, reviewInputDigest: "8".repeat(64) },
      "system"
    )),
    /review input does not match/
  );
  await assert.rejects(
    store.append(eventInput(
      workflow,
      "PlanConfirmationCarriedForward",
      "carry-missing-evolution",
      { ...carryPayload, evolutionActivityId: "case-review-evolution" },
      "system"
    )),
    /completed, plan-producing review evolution/
  );
  await assert.rejects(
    store.append(eventInput(
      workflow,
      "PlanConfirmationCarriedForward",
      "carry-wrong-current-plan",
      { ...carryPayload, currentPlanDigest: "9".repeat(64) },
      "system"
    )),
    /completed, plan-producing review evolution/
  );
  await store.append(eventInput(
    workflow,
    "PlanConfirmationCarriedForward",
    "carry-forward",
    carryPayload,
    "system"
  ));

  const projection = reduceWorkflow(await store.read());
  const confirmation = projection.activities["plan-confirmation"]!;
  assert.equal(confirmation.state, "SUCCEEDED");
  assert.equal(confirmation.callbackSubjectDigest, effectiveSubjectDigest);
  assert.equal(
    confirmation.callbackSubjectSchemaVersion,
    "plan-confirmation-subject-v2"
  );
  assert.equal(confirmation.decisionOriginCallbackId, "origin-plan-confirmation");
  assert.equal(confirmation.decisionOriginSubjectDigest, originSubjectDigest);
  assert.deepEqual(projection.readyActivities.sort(), [
    "case-generation-cases-registration-md",
    "case-review-evolution"
  ]);

  await assert.rejects(
    store.append(eventInput(workflow, "CallbackResolved", "stale-resolution", {
      activityId: "plan-confirmation",
      callbackId: "pending-plan-confirmation",
      subjectDigest: pendingSubjectDigest,
      resolution: "accepted"
    }, "user")),
    WorkflowTransitionError
  );
});

test("v4 formal callback resolution cannot bypass its prepared plan publication", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-callback-publication-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const store = await initialized(root, workflow);
  await appendActivitySuccess(store, workflow, "source-selection", "source");
  await appendActivitySuccess(store, workflow, "plan-validation", "plan");
  await store.appendBatch([
    eventInput(workflow, "ActivityAttemptStarted", "callback-start", {
      activityId: "plan-confirmation",
      attempt: 1
    }),
    eventInput(workflow, "CallbackRequested", "callback-request", {
      activityId: "plan-confirmation",
      callbackId: "confirm-plan",
      subjectDigest: planDigest,
      kind: "plan_confirmation"
    })
  ], await store.head());

  await assert.rejects(
    store.append(eventInput(workflow, "CallbackResolved", "callback-bypass", {
      activityId: "plan-confirmation",
      callbackId: "confirm-plan",
      subjectDigest: planDigest,
      resolution: "accepted"
    }, "user")),
    WorkflowTransitionError
  );
});

test("formal callback resolution cannot splice manifest and plan digests across publications", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-callback-publication-splice-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const store = await initialized(root, workflow);
  await appendActivitySuccess(store, workflow, "source-selection", "source");
  await appendActivitySuccess(store, workflow, "plan-validation", "plan");
  const callbackPlanPath = "testcases/web/open-platform/registration/plan.md";
  const planDigestA = sha256("plan A");
  const planDigestB = sha256("plan B");
  const manifestDigestA = sha256("manifest A");
  const manifestDigestB = sha256("manifest B");
  await store.appendBatch([
    eventInput(workflow, "ActivityAttemptStarted", "callback-start", {
      activityId: "plan-confirmation",
      attempt: 1
    }),
    eventInput(workflow, "CallbackRequested", "callback-request", {
      activityId: "plan-confirmation",
      callbackId: "confirm-plan",
      subjectDigest: planDigest,
      kind: "plan_confirmation"
    }),
    eventInput(workflow, "ArtifactPublishPrepared", "callback-plan-a", {
      activityId: "plan-confirmation",
      publishId: "callback-plan-a",
      manifestDigest: manifestDigestA,
      artifacts: [{
        targetPath: callbackPlanPath,
        digest: planDigestA,
        expectedPreviousDigest: null,
        sizeBytes: 1
      }]
    }),
    eventInput(workflow, "ArtifactPublishPrepared", "callback-plan-b", {
      activityId: "plan-confirmation",
      publishId: "callback-plan-b",
      manifestDigest: manifestDigestB,
      artifacts: [{
        targetPath: callbackPlanPath,
        digest: planDigestB,
        expectedPreviousDigest: planDigestA,
        sizeBytes: 1
      }]
    })
  ], await store.head());

  await assert.rejects(
    store.append(eventInput(workflow, "CallbackResolved", "callback-splice", {
      activityId: "plan-confirmation",
      callbackId: "confirm-plan",
      subjectDigest: planDigest,
      resolution: "accepted",
      publishId: "callback-plan-a",
      manifestDigest: manifestDigestA,
      planPath: callbackPlanPath,
      planDigest: planDigestB
    }, "user")),
    /does not match its single prepared plan publication/
  );
});

test("review role and attempt are bound to the v4 activity and stale submissions fail replay", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-review-binding-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition({ reviewerRoles: ["requirements"] });
  const store = await initialized(root, workflow);
  const activity = "case-review-requirements";
  const isolated: WorkflowDefinition = {
    ...workflow,
    activities: workflow.activities.map((item) =>
      item.id === activity ? { ...item, dependencies: [] } : item
    )
  };
  const { graphDigest: _old, ...unsigned } = isolated;
  isolated.graphDigest = sha256(canonicalJson(unsigned as unknown as SafeJsonValue));
  const isolatedRoot = resolve(root, "isolated");
  const isolatedStore = await initialized(isolatedRoot, isolated);
  const inputRefs = [{
    path: `testcases/${isolated.requestId}/plan.md`,
    digest: "b".repeat(64),
    sizeBytes: 1
  }];
  const inputDigest = reviewInputDigest(isolated.requestId, inputRefs.map((ref) => ({
    sourcePath: ref.path,
    digest: ref.digest,
    sizeBytes: ref.sizeBytes
  })));
  await isolatedStore.append(eventInput(isolated, "ReviewBatchStarted", "batch", {
    batchId: "REV-1",
    inputDigest,
    inputRefs
  }));
  const head = await isolatedStore.head();
  await assert.rejects(
    isolatedStore.append(eventInput(isolated, "ReviewerDispatched", "wrong-role", {
      activityId: activity,
      batchId: "REV-1",
      role: "design",
      attempt: 1,
      inputDigest
    }), head),
    /does not match/
  );
  await isolatedStore.append(eventInput(isolated, "ReviewerDispatched", "dispatch", {
    activityId: activity,
    batchId: "REV-1",
    role: "requirements",
    attempt: 1,
    inputDigest
  }));
  await assert.rejects(
    isolatedStore.append(eventInput(isolated, "ReviewerSubmitted", "stale-attempt", {
      activityId: activity,
      batchId: "REV-1",
      role: "requirements",
      attempt: 0,
      inputDigest,
      planEvidenceRef: "testcases/web/open-platform/registration/plan.md",
      planEvidenceDigest: planDigest
    })),
    /current attempt 1/
  );
});

test("reconciliation is active work with a concrete next action", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-reconcile-continuation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workflow = definition();
  const store = await initialized(root, workflow);
  await store.append(eventInput(workflow, "ActivityAttemptStarted", "start-source", {
    activityId: "source-selection",
    attempt: 1
  }));
  await store.append(eventInput(workflow, "ArtifactDriftDetected", "drift", {
    activityId: "source-selection",
    detail: "worker outcome unknown"
  }));
  const projection = reduceWorkflow(await store.read());
  assert.equal(projection.workflowState, "RECONCILING");
  assert.equal(projection.continuation.kind, "continue_now");
  assert.equal(projection.continuation.referenceId, "source-selection");
  assert.deepEqual(projection.nextActions, ["source-selection"]);
  assert.equal(projection.reply.kind, "none");
});

test("LegacyStateImported remains readable only from an existing verified history", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-legacy-replay-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const unsignedDefinition = {
    schemaVersion: "test-workflow-definition-v1" as const,
    definitionId: "durable-test-workflow",
    definitionVersion: "vnext-2",
    requestId: "web/legacy/request",
    planDigest,
    capabilities: ["web"] as const,
    writesData: false,
    activities: [{
      id: "legacy-source",
      kind: "source_selection" as const,
      phase: "planning" as const,
      dependencies: [],
      required: true
    }]
  };
  const legacy: WorkflowDefinition = {
    ...unsignedDefinition,
    capabilities: [...unsignedDefinition.capabilities],
    graphDigest: sha256(canonicalJson(unsignedDefinition as unknown as SafeJsonValue))
  };
  const rawEvents: Array<Omit<WorkflowEvent, "digest">> = [];
  const push = (
    type: WorkflowEvent["type"],
    payload: WorkflowEvent["payload"],
    idempotencyKey: string
  ) => {
    const previous = rawEvents.at(-1);
    rawEvents.push({
      schemaVersion: "test-workflow-event-v1",
      eventId: `legacy-${rawEvents.length + 1}`,
      seq: rawEvents.length + 1,
      runId: "legacy-run",
      requestId: legacy.requestId,
      definitionId: legacy.definitionId,
      definitionVersion: legacy.definitionVersion,
      type,
      occurredAt: "2026-07-28T00:00:00.000Z",
      actorType: "system",
      idempotencyKey,
      payload,
      prevDigest: previous ? calculateEventDigest(previous) : GENESIS_DIGEST
    });
  };
  push("WorkflowStarted", workflowStartedPayload(legacy), "start");
  push("LegacyStateImported", { source: "v11-read-only" }, "legacy");
  push("ActivitiesExpanded", activitiesExpandedPayload(legacy), "expand");
  const events: WorkflowEvent[] = rawEvents.map((event) => ({
    ...event,
    digest: calculateEventDigest(event)
  }));
  const historyPath = resolve(root, "workflow-history.ndjson");
  await writeFile(
    historyPath,
    `${events.map((event) => canonicalJson(event as unknown as SafeJsonValue)).join("\n")}\n`,
    "utf8"
  );
  const store = new WorkflowHistoryStore(historyPath, resolve(root, ".local/workflow-history-locks"));
  const replayed = await store.read();
  assert.equal(replayed[1]?.type, "LegacyStateImported");
  assert.deepEqual(reduceWorkflow(replayed).readyActivities, ["legacy-source"]);
  await assert.rejects(
    store.append({
      ...eventInput(legacy, "ActivityAttemptStarted", "legacy-append", {
        activityId: "legacy-source",
        attempt: 1
      }),
      definitionVersion: "v4"
    }),
    /replay-only/
  );
}
);
