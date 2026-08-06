import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  EXECUTION_AUTHORIZATION_ARTIFACT,
  assertCurrentAuthorizedScripts,
  buildExecutionAuthorizationManifest,
  loadConfirmedExecutionAuthorization
} from "../../../src/support/formal-execution/authorization.js";
import { ArtifactPublisher } from "../../../src/support/task-workflow/artifactPublisher.js";
import {
  SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION,
  type ScriptReviewRole
} from "../../../src/support/formal-execution/scriptReviewPolicy.js";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";
import { projectRelationProjection } from "../../../src/support/testcase/relationProjection.js";
import { recordFormalDecision } from "../task-workflow/formalDecisionFixture.js";

const requestId = "web/project/authorization";
const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const managePath = resolve(repositoryRoot, "src/support/task-workflow/cli/manage.ts");
const tsxLoader = pathToFileURL(
  resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs")
).href;
const caseId = "AUTH-CASE-001";

function relationFixture(): { plan: string; cases: string } {
  const plan = [
    "# Authorization plan",
    "",
    "结构版本：case-relation-projection-v1",
    "结构版本：rule-design-matrix-v1",
    "",
    "## 基本信息",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    `| 测试请求 | \`${requestId}\` |`,
    "| 测试类型 | Web |",
    "| 目标环境 | test |",
    "| 状态 | 已确认 |",
    "",
    "## 测试范围",
    "",
    "### 包含",
    "",
    "- query only",
    "",
    "## 输入资料",
    "",
    `- manifest \`authorization-prd\`；sectionId \`query\`；SHA-256 \`${"a".repeat(64)}\`。`,
    "",
    "## 用例包目录",
    "",
    "| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 特殊门禁 |",
    "| --- | --- | --- | --- | --- |",
    "| `cases-core.md` | query | query | 手工值 | 无 |",
    "",
    "## 覆盖矩阵",
    "",
    "| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |",
    "| --- | --- | --- | --- | --- |",
    "| 业务功能与规则 | requirement | query | 已覆盖 | 手工值 |",
    "",
    "## 需求追溯矩阵",
    "",
    "| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| REQ-AUTH-001 | Authorization PRD | P0 | query response | 适用 | query | 手工值 | 已覆盖 | no_write |",
    "",
    "## 规则覆盖台账",
    "",
    "| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| RULE-AUTH-001 | REQ-AUTH-001 | Authorization PRD | 业务规则 | query request | visible query response | scenario | 适用 | 已覆盖 | ${caseId} | no_write |`,
    "",
    "## 规则设计矩阵",
    "",
    "| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| RULE-AUTH-001 | query | 必填 | valid query request | visible query response | isolated read data | no_write | ${caseId} | 已覆盖 |`,
    ""
  ].join("\n");
  const cases = `# Core cases

## 用例目录

| 用例编号 | 标题 |
| --- | --- |
| ${caseId} | query |

## 测试用例：query
## 基本信息
| 用例编号 | ${caseId} |
| 数据策略 | no_write |
| 风险等级 | 低 |
## 来源
- manifest \`authorization-prd\`；sectionId \`query\`；SHA-256 \`${"a".repeat(64)}\`
## 前置条件
- ready
## 操作步骤
- query
## 预期结果
- visible
## 覆盖关联
- RULE-AUTH-001
## 合理推断
- none
## 待补充信息
- none
## 评审与演进回链
- pending
`;
  const projected = projectRelationProjection(plan, { "cases-core.md": cases });
  assert.deepEqual(projected.issues, []);
  return { plan: projected.plan, cases: projected.packages["cases-core.md"]! };
}

async function createVNextHarness(options: {
  publishAuthorization?: boolean;
  writesData?: boolean;
  environmentCapability?: {
    id: string;
    variable: string;
    pattern: string;
  };
} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-authorization-"));
  const requestRoot = resolve(root, "testcases/web/project/authorization");
  const planPath = resolve(requestRoot, "plan.md");
  const scriptPath = resolve(root, "tests/web/project/authorization/example.formal.spec.ts");
  const formalManifestPath = resolve(
    root,
    "tests/web/project/authorization/execution.manifest.ts"
  );
  const selectorEvidencePath = resolve(
    root,
    "tests/web/project/authorization/selector-contract.json"
  );
  const casePackagePath = resolve(requestRoot, "cases-core.md");
  await mkdir(dirname(scriptPath), { recursive: true });
  await mkdir(requestRoot, { recursive: true });
  const fixture = relationFixture();
  await writeFile(planPath, fixture.plan, "utf8");
  await writeFile(
    scriptPath,
    `declare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const verifyResult: () => Promise<void>;\nformalCase("${caseId}", "query", async () => { await verifyResult(); });\n`,
    "utf8"
  );
  const environmentCapability = options.environmentCapability;
  await writeFile(formalManifestPath, `export const formalExecutionManifest = ${JSON.stringify({
    schemaVersion: "formal-execution-manifest-v2",
    requestId,
    projectId: "project",
    environment: "test",
    cases: [{
      caseId,
      title: "query",
      requiredCapabilities: environmentCapability ? [environmentCapability.id] : [],
      requiredResources: [],
      producesResources: [],
      consumesResources: [],
      requiredOperations: ["query_postcondition"],
      dataWritePolicy: "no_write",
      permissionProfile: "read_only",
      implementation: { status: "source_complete" }
    }],
    capabilities: [
      ...(environmentCapability ? [{
        id: environmentCapability.id,
        requiredForCaseIds: [caseId],
        source: {
          kind: "environment",
          variable: environmentCapability.variable,
          pattern: environmentCapability.pattern
        },
        unavailableReason: "Environment capability unavailable.",
        unblockCondition: "Configure the test environment."
      }] : [])
    ],
    buildEvidence: [{
      kind: "selector_contract",
      path: "tests/web/project/authorization/selector-contract.json"
    }]
  }, null, 2)};\n`, "utf8");
  await writeFile(selectorEvidencePath, JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId,
    targetBuildDigest: "f".repeat(64),
    runtimeValidation: "runtime_verified"
  }), "utf8");
  await writeFile(casePackagePath, fixture.cases, "utf8");
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({
    capabilities: ["web"],
    writesData: options.writesData ?? false,
    casePackages: ["cases-core.md"],
    reviewerRoles: ["requirements"]
  });
  await succeed(manager, "source-selection");
  await succeed(manager, "plan-validation");
  await acceptCallback(manager, "plan-confirmation", "a".repeat(64), "plan-confirmation");
  await succeed(manager, "case-generation-cases-core-md");
  await succeed(manager, "relation-sync");
  await succeed(manager, "completeness-validation");
  const initialReviewIds = Object.values((await manager.gate()).activities)
    .filter((activity) => activity.definition.kind === "review")
    .map((activity) => activity.id);
  for (const activityId of initialReviewIds) await succeed(manager, activityId);
  await succeed(manager, "case-review-resolution", "converged");
  await acceptCallback(manager, "case-confirmation", "b".repeat(64), "case-confirmation");
  await succeed(manager, "build");

  const manifest = buildExecutionAuthorizationManifest({
    schemaVersion: "execution-authorization-v4",
    requestId,
    environment: "test",
    scriptPaths: ["tests/web/project/authorization/example.formal.spec.ts"],
    caseIds: [caseId],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [{ resourceType: "query", maxCreates: 0 }],
    dataWritePolicy: "no_write",
    targetBuildDigest: "f".repeat(64),
    runnableCaseIds: [caseId],
    deferredCases: [],
    capabilityEvidence: [],
    selectorEvidenceDigests: ["e".repeat(64)],
    scriptReview: { level: "light", evidenceDigests: [] },
    caseScopes: [{
      caseId,
      permissionProfile: "read_only",
      requiredOperations: ["query_postcondition"],
      dataWritePolicy: "no_write",
      consumesResources: [],
      producesResources: []
    }],
    resourcePoolBudgets: [],
    resourcePoolEvidence: [],
    externalTransitions: [{
      caseId,
      stageId: "submit-once",
      transitionId: "review-approved",
      actionSummary: "Complete the test-environment review and confirm its result.",
      allowedOutcomes: ["approved"],
      requiredAttestationKeys: ["review_result_confirmed"]
    }],
    workspaceRoot: root,
    createdAt: "2026-07-28T00:00:00.000Z"
  });
  if (options.publishAuthorization !== false) {
    const scriptReview = await manager.startActivity("readiness", "authorization-test");
    const publisher = new ArtifactPublisher(manager.requestId, {
      workspaceRoot: manager.workspaceRoot,
      runtimeStore: manager.runtime
    });
    const publication = await publisher.publish({
      publishId: `fixture-readiness-${manifest.digest.slice(0, 12)}`,
      activityId: "readiness",
      lease: {
        requestId: manager.requestId,
        activityId: "readiness",
        owner: "authorization-test",
        leaseId: scriptReview.claimToken,
        fencingToken: scriptReview.fencingToken,
        expiresAt: scriptReview.leaseExpiresAt
      },
      artifacts: [{
        targetPath: `testcases/${requestId}/${EXECUTION_AUTHORIZATION_ARTIFACT}`,
        content: `${JSON.stringify(manifest, null, 2)}\n`
      }]
    }, async (event) => {
      await manager.recordArtifactPublishPrepared(event);
    });
    await manager.succeedActivity("readiness", {
      claimToken: scriptReview.claimToken,
      verification: "scripts and immutable execution manifest reviewed",
      outputRefs: publication.artifacts.map((artifact) => artifact.targetPath),
      outputDigests: publication.artifacts.map((artifact) => ({
        path: artifact.targetPath,
        digest: artifact.digest
      }))
    });
  }
  return { root, requestRoot, planPath, scriptPath, casePackagePath, manager, manifest };
}

async function writeScriptReviewEvidence(
  root: string,
  role: ScriptReviewRole,
  inputDigest: string
): Promise<string> {
  const path = resolve(
    root,
    ".local/test-task-runtime/web/project/authorization/review-evidence",
    `${role}.json`
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    schemaVersion: SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION,
    role,
    inputDigest,
    verdict: "approved",
    findingIds: []
  }, null, 2)}\n`, "utf8");
  return path;
}

async function succeed(
  manager: DurableWorkflowManager,
  activityId: string,
  outcome?: string
): Promise<void> {
  const before = await manager.gate();
  const activity = before.activities[activityId];
  if (!activity) throw new Error(`Missing fixture activity ${activityId}.`);
  if (activity.definition.kind === "review") {
    const role = String(activity.definition.metadata?.role ?? activityId);
    const batchId = `TEST-${activity.definition.phase}`;
    if (!(await manager.events()).some((event) =>
      event.type === "ReviewBatchStarted" && event.payload.batchId === batchId
    )) {
      await manager.startReviewBatch({
        batchId,
        inputPaths: [manager.planPath, resolve(manager.requestRoot, "cases-core.md")]
      });
    }
    await manager.dispatchReviewer({
      activityId,
      batchId,
      role,
      agentTaskId: `${batchId}-${role}`
    });
    await manager.submitReviewer({
      activityId,
      batchId,
      role,
      planEvidenceRef: manager.planPath,
      agentTaskId: `${batchId}-${role}`
    });
    return;
  }
  const owner = "authorization-test";
  const started = await manager.startActivity(activityId, owner);
  if (activity.definition.publishesArtifacts) {
    const publishId = `fixture-${activityId}-attempt-${activity.attempt + 1}`;
    const planArtifactPath = `testcases/${manager.requestId}/plan.md`;
    const caseArtifactPath = `testcases/${manager.requestId}/cases-core.md`;
    const artifactPaths = activityId === "relation-sync"
      ? [planArtifactPath, caseArtifactPath]
      : activity.definition.kind === "case_generation"
        ? [caseArtifactPath]
        : [planArtifactPath];
    await manager.publishArtifactsAndSucceed(activityId, {
      claimToken: started.claimToken,
      publishId,
      artifacts: await Promise.all(artifactPaths.map(async (path) => ({
        targetPath: path,
        content: await readFile(resolve(manager.workspaceRoot, path))
      }))),
      verification: "contract verified",
      outcome
    });
    return;
  }
  await manager.succeedActivity(activityId, {
    claimToken: started.claimToken,
    verification: "contract verified",
    outcome
  });
}

async function acceptCallback(
  manager: DurableWorkflowManager,
  activityId: string,
  subjectDigest: string,
  callbackId: string
): Promise<void> {
  const currentSubject = activityId === "plan-confirmation" || activityId === "case-confirmation"
    ? await manager.callbackSubjectDigest(activityId)
    : subjectDigest;
  await manager.requestCallback({
    activityId,
    subjectDigest: currentSubject,
    callbackId,
    kind: "test-confirmation"
  });
  await recordFormalDecision(manager, activityId, currentSubject, "accepted");
  await manager.resolveCallback({
    activityId,
    subjectDigest: currentSubject,
    callbackId,
    resolution: "accepted"
  });
}

test("public CLI atomically publishes the v4 execution manifest from readiness", async (context) => {
  const harness = await createVNextHarness({ publishAuthorization: false });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  const started = await harness.manager.startActivity("readiness", "cli-publisher");
  const attemptEvent = [...await harness.manager.events()].reverse().find((event) =>
    event.type === "ActivityAttemptStarted"
    && event.payload.activityId === "readiness"
  );
  assert.ok(attemptEvent);

  await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "execution-readiness-publish",
    "--request",
    requestId,
    "--claim",
    started.claimToken,
    "--environment",
    "test",
    "--target-build-digest",
    "f".repeat(64),
    "--script",
    "tests/web/project/authorization/example.formal.spec.ts",
    "--case-id",
    caseId,
    "--operation",
    "query_postcondition",
    "--budget",
    "query:0",
    "--data-write-policy",
    "no_write",
    "--verified",
    "script review passed"
  ], { cwd: harness.root });

  const published = JSON.parse(
    await readFile(
      resolve(harness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT),
      "utf8"
    )
  ) as { createdAt: string; digest: string };
  assert.equal(published.createdAt, attemptEvent.occurredAt);
  assert.equal(
    (await harness.manager.gate()).activities.readiness?.state,
    "SUCCEEDED"
  );
  assert.equal(
    await harness.manager.callbackSubjectDigest("execution-authorization"),
    published.digest
  );
});

test("readiness CLI loads local .env capabilities without exposing their values", async (context) => {
  const variable = "AUTOMATION_TEST_DOTENV_PROBE";
  const value = "local-readiness-secret-probe";
  const harness = await createVNextHarness({
    publishAuthorization: false,
    environmentCapability: {
      id: "dotenv-probe",
      variable,
      pattern: `^${value}$`
    }
  });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await writeFile(resolve(harness.root, ".env"), `${variable}=${value}\n`, "utf8");
  const started = await harness.manager.startActivity("readiness", "dotenv-readiness");
  const childEnvironment = { ...process.env };
  delete childEnvironment[variable];

  const result = await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "execution-readiness-publish",
    "--request",
    requestId,
    "--claim",
    started.claimToken,
    "--environment",
    "test",
    "--target-build-digest",
    "f".repeat(64),
    "--script",
    "tests/web/project/authorization/example.formal.spec.ts",
    "--case-id",
    caseId,
    "--operation",
    "query_postcondition",
    "--budget",
    "query:0",
    "--data-write-policy",
    "no_write",
    "--verified",
    "dotenv capability detected",
    "--json"
  ], {
    cwd: harness.root,
    env: childEnvironment
  });

  const published = JSON.parse(
    await readFile(resolve(harness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT), "utf8")
  ) as {
    runnableCaseIds: string[];
    deferredCases: Array<{ caseId: string }>;
    capabilityEvidence: Array<{ capabilityId: string; available: boolean }>;
  };
  assert.deepEqual(published.runnableCaseIds, [caseId]);
  assert.deepEqual(published.deferredCases, []);
  assert.equal(
    published.capabilityEvidence.find((item) => item.capabilityId === "dotenv-probe")?.available,
    true
  );
  assert.doesNotMatch(result.stdout, new RegExp(value));
  assert.doesNotMatch(result.stderr, new RegExp(value));
});

test("public CLI assesses standard review and rejects missing or stale reviewer evidence", async (context) => {
  const harness = await createVNextHarness({ publishAuthorization: false });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  const helperPath = resolve(harness.root, "tests/web/project/authorization/helper.ts");
  await writeFile(helperPath, "export const helper = true;\n", "utf8");
  await writeFile(
    resolve(harness.root, "tests/web/project/authorization/example.formal.spec.ts"),
    `import { helper } from "./helper.js";\ndeclare const formalCase: (caseId: string, title: string, body: (runtime: { addAssertion(assertion: { name: string; passed: boolean }): void }) => Promise<void>) => void;\nformalCase("${caseId}", "query", async (runtime) => { runtime.addAssertion({ name: "helper available", passed: helper }); });\n`,
    "utf8"
  );
  const started = await harness.manager.startActivity("readiness", "standard-review");
  const scopeArgs = [
    "--request",
    requestId,
    "--environment",
    "test",
    "--target-build-digest",
    "f".repeat(64),
    "--script",
    "tests/web/project/authorization/example.formal.spec.ts",
    "--script",
    "tests/web/project/authorization/helper.ts",
    "--case-id",
    caseId,
    "--operation",
    "query_postcondition",
    "--budget",
    "query:0",
    "--data-write-policy",
    "no_write"
  ];
  const assessed = await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "script-review-assess",
    ...scopeArgs,
    "--json"
  ], { cwd: harness.root });
  const assessment = JSON.parse(assessed.stdout) as {
    enforced: boolean;
    level: string;
    inputDigest: string;
    reviewerInputDigests: { script_quality: string };
    requiredReviewerRoles: string[];
  };
  assert.equal(assessment.enforced, true);
  assert.equal(assessment.level, "standard");
  assert.deepEqual(assessment.requiredReviewerRoles, ["script_quality"]);

  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      tsxLoader,
      managePath,
      "execution-readiness-publish",
      ...scopeArgs,
      "--claim",
      started.claimToken,
      "--verified",
      "static review passed"
    ], { cwd: harness.root }),
    /requires reviewer evidence for: script_quality/
  );

  const evidencePath = await writeScriptReviewEvidence(
    harness.root,
    "script_quality",
    assessment.reviewerInputDigests.script_quality
  );
  await writeFile(helperPath, "export const helper = false;\n", "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      tsxLoader,
      managePath,
      "execution-readiness-publish",
      ...scopeArgs,
      "--claim",
      started.claimToken,
      "--review-evidence",
      evidencePath,
      "--verified",
      "isolated review passed"
    ], { cwd: harness.root }),
    /stale/
  );
});

test("public CLI strict review requires quality and execution-safety evidence", async (context) => {
  const harness = await createVNextHarness({
    publishAuthorization: false,
    writesData: true
  });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  const started = await harness.manager.startActivity("readiness", "strict-review");
  const scopeArgs = [
    "--request",
    requestId,
    "--environment",
    "test",
    "--target-build-digest",
    "f".repeat(64),
    "--script",
    "tests/web/project/authorization/example.formal.spec.ts",
    "--case-id",
    caseId,
    "--case-risk",
    `${caseId}:strict`,
    "--operation",
    "query_postcondition",
    "--budget",
    "query:0",
    "--data-write-policy",
    "no_write"
  ];
  const assessed = await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "script-review-assess",
    ...scopeArgs,
    "--json"
  ], { cwd: harness.root });
  const assessment = JSON.parse(assessed.stdout) as {
    level: string;
    inputDigest: string;
    reviewerInputDigests: {
      script_quality: string;
      execution_safety: string;
    };
    requiredReviewerRoles: string[];
  };
  assert.equal(assessment.level, "strict");
  assert.deepEqual(assessment.requiredReviewerRoles, [
    "script_quality",
    "execution_safety"
  ]);
  const qualityEvidence = await writeScriptReviewEvidence(
    harness.root,
    "script_quality",
    assessment.reviewerInputDigests.script_quality
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      tsxLoader,
      managePath,
      "execution-readiness-publish",
      ...scopeArgs,
      "--claim",
      started.claimToken,
      "--review-evidence",
      qualityEvidence,
      "--verified",
      "quality review passed"
    ], { cwd: harness.root }),
    /requires reviewer evidence for: script_quality, execution_safety/
  );
  const safetyEvidence = await writeScriptReviewEvidence(
    harness.root,
    "execution_safety",
    assessment.reviewerInputDigests.execution_safety
  );
  await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "execution-readiness-publish",
    ...scopeArgs,
    "--claim",
    started.claimToken,
    "--review-evidence",
    qualityEvidence,
    "--review-evidence",
    safetyEvidence,
    "--verified",
    "strict reviewers converged"
  ], { cwd: harness.root });
  assert.equal(
    (await harness.manager.gate()).activities.readiness?.state,
    "SUCCEEDED"
  );
});

test("v5 formal authorization is derived from the accepted v4 manifest callback", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );

  const snapshot = await loadConfirmedExecutionAuthorization(
    requestId,
    "test",
    ["query_postcondition"],
    harness.root
  );
  assert.equal(snapshot.schemaVersion, "execution-authorization-v4");
  assert.equal(snapshot.status, "confirmed");
  assert.equal(snapshot.digest, harness.manifest.digest);
  assert.deepEqual(snapshot.externalTransitions, [{
    caseId,
    stageId: "submit-once",
    transitionId: "review-approved",
    actionSummary: "Complete the test-environment review and confirm its result.",
    allowedOutcomes: ["approved"],
    requiredAttestationKeys: ["review_result_confirmed"]
  }]);
  assert.equal(snapshot.confirmationId, harness.manifest.callbackId);
  const gate = await harness.manager.gate();
  assert.equal(gate.activities["plan-confirmation"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["case-confirmation"]?.state, "SUCCEEDED");
  assert.equal(gate.activities["execution-authorization"]?.state, "SUCCEEDED");
  const head = gate.head;
  const duplicate = await harness.manager.resolveCallback({
    activityId: "execution-authorization",
    callbackId: harness.manifest.callbackId,
    subjectDigest: harness.manifest.digest,
    resolution: "accepted"
  });
  assert.deepEqual(duplicate.head, head);
});

test("rejected or revision-requested authorization is never accepted", async (context) => {
  for (const resolution of ["rejected", "revision_requested"] as const) {
    const harness = await createVNextHarness();
    context.after(() => rm(harness.root, { recursive: true, force: true }));
    await harness.manager.requestCallback({
      activityId: "execution-authorization",
      subjectDigest: harness.manifest.digest,
      callbackId: harness.manifest.callbackId,
      kind: "execution-authorization"
    });
    await recordFormalDecision(
      harness.manager,
      "execution-authorization",
      harness.manifest.digest,
      resolution
    );
    await harness.manager.resolveCallback({
      activityId: "execution-authorization",
      subjectDigest: harness.manifest.digest,
      callbackId: harness.manifest.callbackId,
      resolution
    });
    const runtime = await harness.manager.runtime.read();
    assert.equal(
      Object.values(runtime?.stagingRefs ?? {})
        .filter((staging) => staging.activityId === "execution-authorization")
        .length,
      0
    );
    assert.ok(runtime?.leases["execution-authorization"]?.releasedAt);
    await assert.rejects(
      loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
      /accepted execution-authorization callback/
    );
  }
});

test("subject or manifest digest drift cannot reuse an old accepted callback", async (context) => {
  const subjectHarness = await createVNextHarness();
  context.after(() => rm(subjectHarness.root, { recursive: true, force: true }));
  await assert.rejects(
    subjectHarness.manager.requestCallback({
      activityId: "execution-authorization",
      subjectDigest: "f".repeat(64),
      callbackId: subjectHarness.manifest.callbackId,
      kind: "execution-authorization"
    }),
    /subject digest does not match current repository evidence/
  );

  const driftHarness = await createVNextHarness();
  context.after(() => rm(driftHarness.root, { recursive: true, force: true }));
  await acceptCallback(
    driftHarness.manager,
    "execution-authorization",
    driftHarness.manifest.digest,
    driftHarness.manifest.callbackId
  );
  const drifted = { ...driftHarness.manifest, caseIds: [caseId, "AUTH-CASE-002"] };
  await writeFile(
    resolve(driftHarness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT),
    `${JSON.stringify(drifted)}\n`,
    "utf8"
  );
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], driftHarness.root),
    /(?:digest does not match|caseIds must equal runnableCaseIds)/
  );
  const driftGate = await driftHarness.manager.gate();
  assert.equal(driftGate.reply.kind, "none");
  assert.equal(driftGate.continuation.kind, "continue_now");
  assert.equal(driftGate.continuation.reason, "callback_subject_drift");
  const reopened = await driftHarness.manager.resume("manifest subject changed");
  assert.equal(reopened.activities["execution-authorization"]?.state, "READY");
});

test("execution callback rejects a self-consistent manifest not owned by latest readiness publication", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  const replaced = {
    ...harness.manifest,
    callbackId: "execution-authorization-replaced"
  };
  await writeFile(
    resolve(harness.requestRoot, EXECUTION_AUTHORIZATION_ARTIFACT),
    `${JSON.stringify(replaced, null, 2)}\n`,
    "utf8"
  );
  await assert.rejects(
    harness.manager.requestCallback({
      activityId: "execution-authorization",
      subjectDigest: replaced.digest,
      callbackId: replaced.callbackId,
      kind: "execution-authorization"
    }),
    /latest readiness publication digest/
  );
});

test("explicit scope reopen invalidates the previously accepted authorization", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root);
  await harness.manager.invalidateActivities({
    activityIds: ["execution-authorization"],
    reason: "formal scope changed",
    subjectDigest: harness.manifest.digest
  });
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /accepted execution-authorization callback/
  );
});

test("execution scope reopen restarts engineering while preserving confirmed cases", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );

  const reopened = await harness.manager.reopenExecutionScope(
    "reviewed script or immutable scope changed"
  );
  assert.equal(reopened.activities["case-confirmation"]?.state, "SUCCEEDED");
  assert.equal(reopened.activities.build?.state, "READY");
  assert.equal(reopened.activities.readiness?.state, "PENDING");
  assert.equal(reopened.activities["execution-authorization"]?.state, "PENDING");
});

test("execution scope reopen also recovers a zero-runnable readiness blocker", async (context) => {
  const harness = await createVNextHarness({ publishAuthorization: false });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await harness.manager.raiseBlocker({
    blockerId: "readiness-zero-runnable-test",
    affectedActivityIds: ["readiness"],
    category: "execution_readiness",
    detail: "No runnable cases.",
    resolutionCondition: "Rebuild complete candidates and rerun readiness."
  });

  const reopened = await harness.manager.reopenExecutionScope(
    "candidate implementation changed before authorization publication"
  );
  assert.equal(reopened.activities["case-confirmation"]?.state, "SUCCEEDED");
  assert.equal(reopened.activities.build?.state, "READY");
  assert.equal(reopened.activities.readiness?.state, "PENDING");
  assert.equal(reopened.activities["execution-authorization"]?.state, "PENDING");
});

test("formal plan or script drift invalidates authorization", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const originalPlan = await readFile(harness.planPath, "utf8");
  await writeFile(
    harness.planPath,
    (await readFile(harness.planPath, "utf8")).replace("- query only", "- expanded formal scope"),
    "utf8"
  );
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /plan\.md changed/
  );
  let gate = await harness.manager.gate();
  assert.equal(gate.reply.kind, "none");
  assert.equal(gate.continuation.reason, "callback_subject_drift");

  await writeFile(harness.planPath, originalPlan, "utf8");
  await writeFile(harness.scriptPath, "export const formal = false;\n", "utf8");
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /Script changed/
  );
  gate = await harness.manager.gate();
  assert.equal(gate.continuation.referenceId, "execution-authorization");
});

test("removing accepted plan or case decisions invalidates the matching callback only", async (context) => {
  for (const [activityId, decisionType] of [
    ["plan-confirmation", "计划确认"],
    ["case-confirmation", "用例确认"]
  ] as const) {
    const harness = await createVNextHarness();
    context.after(() => rm(harness.root, { recursive: true, force: true }));
    const plan = await readFile(harness.planPath, "utf8");
    await writeFile(
      harness.planPath,
      plan.split("\n")
        .filter((line) => !line.startsWith(`| ${decisionType} |`))
        .join("\n"),
      "utf8"
    );
    const gate = await harness.manager.gate();
    assert.equal(gate.reply.kind, "none");
    assert.equal(gate.continuation.kind, "continue_now");
    assert.equal(gate.continuation.referenceId, activityId);
    assert.equal(gate.activities[activityId]?.state, "BLOCKED");
  }
});

test("formal decision rows are outside plan scope but remain mandatory for execution", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );

  const confirmed = await loadConfirmedExecutionAuthorization(
    requestId,
    "test",
    [],
    harness.root
  );
  assert.equal(confirmed.digest, harness.manifest.digest);

  const plan = await readFile(harness.planPath, "utf8");
  await writeFile(
    harness.planPath,
    plan.replace(
      /^\| 执行清单确认 \| .+ \| accepted \| test fixture \| continue \|\n/m,
      ""
    ),
    "utf8"
  );
  await assert.rejects(
    loadConfirmedExecutionAuthorization(requestId, "test", [], harness.root),
    /accepted execution-authorization callback/
  );
});

test("Runner-discovered formal scripts must all be authorized and current", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const snapshot = await loadConfirmedExecutionAuthorization(
    requestId,
    "test",
    [],
    harness.root
  );
  assert.doesNotThrow(() =>
    assertCurrentAuthorizedScripts(snapshot, [harness.scriptPath], harness.root)
  );

  const extraPath = resolve(
    harness.root,
    "tests/web/project/authorization/unreviewed.formal.spec.ts"
  );
  await writeFile(extraPath, "export const unreviewed = true;\n", "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts(snapshot, [harness.scriptPath, extraPath], harness.root),
    /outside the confirmed authorization/
  );

  await writeFile(harness.scriptPath, "export const formal = false;\n", "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts(snapshot, [harness.scriptPath], harness.root),
    /Script changed/
  );
});

test("v5 report success atomically completes the workflow without a completion activity", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const run = await harness.manager.startActivity("run", "formal-runner");
  await harness.manager.succeedActivity("run", {
    claimToken: run.claimToken,
    verification: "runnable scope completed",
    testOutcome: "passed"
  });
  const report = await harness.manager.startActivity("report", "report-generator");
  const summaryPath = `artifacts/test-results/formal/${harness.manifest.digest.slice(0, 12)}/run-summary.json`;
  const markdownPath = `artifacts/test-results/formal/${harness.manifest.digest.slice(0, 12)}/execution-summary.md`;
  const completed = await harness.manager.publishArtifactsAndSucceed("report", {
    claimToken: report.claimToken,
    publishId: "fixture-final-report",
    verification: "deterministic report generated from formal results",
    testOutcome: "passed",
    artifacts: [
      {
        targetPath: summaryPath,
        content: `${JSON.stringify({ schemaVersion: "formal-run-summary-v1" })}\n`
      },
      {
        targetPath: markdownPath,
        content: "# 自动化测试执行摘要\n"
      }
    ]
  });
  assert.equal(completed.workflowState, "SUCCEEDED");
  assert.equal(completed.reply.kind, "final");
  assert.equal(completed.activities["workflow-completion"], undefined);
  assert.ok((await harness.manager.events()).some((event) =>
    event.type === "WorkflowCompleted"
  ));
});

test("v5 run parks for an external transition and resumes with a fresh fenced lease", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const first = await harness.manager.startActivity("run", "formal-runner");
  const parked = await harness.manager.parkRunForExternalTransition({
    activityId: "run",
    claimToken: first.claimToken,
    blockerId: "external-transition-review-approved",
    detail: "Complete the test-environment review.",
    resolutionCondition: "Resolve review-approved with the frozen attestation keys."
  });
  assert.equal(parked.activities.run?.state, "BLOCKED");
  assert.deepEqual(parked.activities.run?.blockerIds, ["external-transition-review-approved"]);

  const resumed = await harness.manager.resumeRunAfterExternalTransition({
    activityId: "run",
    blockerId: "external-transition-review-approved",
    evidenceDigest: "c".repeat(64),
    owner: "formal-runner"
  });
  assert.equal(resumed.projection.activities.run?.state, "RUNNING");
  assert.notEqual(resumed.claimToken, first.claimToken);
  const duplicate = await harness.manager.resumeRunAfterExternalTransition({
    activityId: "run",
    blockerId: "external-transition-review-approved",
    evidenceDigest: "c".repeat(64),
    owner: "formal-runner"
  });
  assert.equal(duplicate.claimToken, resumed.claimToken);
});
