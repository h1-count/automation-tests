import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { FormalExecutionStore } from "../../../src/support/formal-execution/formalExecutionStore.js";
import { resolveSelectorBuildIdentity } from "../../../src/support/formal-execution/selectorBuildIdentity.js";
import {
  finalizeFormalReportWorkflow,
  finalizeFormalRunWorkflow
} from "../../../src/support/formal-execution/workflowCompletion.js";
import {
  deriveFormalReportCompletion,
  deriveFormalRunCompletion,
  loadFormalCompletionContext
} from "../../../src/support/formalCompletionService.js";
import type { FormalExecutionManifest } from "../../../src/support/formal-execution/types.js";
import { ArtifactPublisher } from "../../../src/support/task-workflow/artifactPublisher.js";
import { canonicalJson } from "../../../src/support/task-workflow/canonicalJson.js";
import {
  activitiesExpandedPayload,
  buildWorkflowDefinition,
  workflowStartedPayload
} from "../../../src/support/task-workflow/definition.js";
import { GENESIS_DIGEST } from "../../../src/support/task-workflow/historyStore.js";
import type {
  SafeJsonValue,
  WorkflowDefinition
} from "../../../src/support/task-workflow/types.js";
import {
  SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION,
  type ScriptReviewRole
} from "../../../src/support/formal-execution/scriptReviewPolicy.js";
import {
  DurableWorkflowManager,
  formalDataHygieneBlockerId,
  formalDeterministicOutcomeBlockerId
} from "../../../src/support/task-workflow/workflowManager.js";
import { TestDataManager } from "../../../src/support/test-data/testDataManager.js";
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
const sourceContent = "Reviewed query response business requirement.\n";
const sourceDigest = createHash("sha256").update(sourceContent).digest("hex");

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
    `- manifest \`authorization-prd\`；sectionId \`query\`；SHA-256 \`${sourceDigest}\`。`,
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
| 需求追溯编号 | REQ-AUTH-001 |
| 规则覆盖编号 | RULE-AUTH-001 |
| 数据策略 | no_write |
| 风险等级 | 低 |
## 来源
| 资料类型 | 路径或链接 | 版本/说明 |
| --- | --- | --- |
| 需求文档 | requirements/authorization.txt | manifest \`authorization-prd\`；sectionId \`query\`；SHA-256 \`${sourceDigest}\` |
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

function withoutFormalCompletionMarkers(current: WorkflowDefinition): WorkflowDefinition {
  const activities = current.activities.map((activity) => {
    if (activity.kind !== "run" && activity.kind !== "report") return activity;
    const { completionContract: _completionContract, ...metadata } = activity.metadata ?? {};
    return { ...activity, metadata };
  });
  const unsigned: Omit<WorkflowDefinition, "graphDigest"> = {
    schemaVersion: current.schemaVersion,
    definitionId: current.definitionId,
    definitionVersion: current.definitionVersion,
    requestId: current.requestId,
    planDigest: current.planDigest,
    capabilities: current.capabilities,
    writesData: current.writesData,
    reviewPolicy: current.reviewPolicy,
    activities
  };
  return {
    ...unsigned,
    graphDigest: createHash("sha256")
      .update(canonicalJson(unsigned as unknown as SafeJsonValue), "utf8")
      .digest("hex")
  };
}

async function createVNextHarness(options: {
  publishAuthorization?: boolean;
  writesData?: boolean;
  legacyUnmarkedFormalCompletion?: boolean;
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
  const sourceContractPath = resolve(root, "contracts/formal-source.json");
  const sourcePath = resolve(root, "sources/requirements/authorization.txt");
  const sourceIndexPath = resolve(root, "sources/indexes/project.yaml");
  const scriptContent = `declare const formalCase: (caseId: string, title: string, body: (fixtures: unknown, runtime: { verifyBusinessOracle(oracleId: string, evaluator: () => Promise<void>): Promise<string> }) => Promise<void>) => void;\ndeclare const verifyResult: () => Promise<void>;\nformalCase("${caseId}", "query", async (_fixtures, runtime) => { await runtime.verifyBusinessOracle("query-visible", async () => { await verifyResult(); }); });\n`;
  const scriptDigest = createHash("sha256").update(scriptContent).digest("hex");
  const selectorEvidenceContent = JSON.stringify({
    schemaVersion: "selector-contract-evidence-v1",
    requestId,
    targetBuildDigest: "f".repeat(64),
    runtimeValidation: "runtime_verified"
  });
  const selectorEvidenceDigest = createHash("sha256")
    .update(selectorEvidenceContent)
    .digest("hex");
  const sourceContractContent = JSON.stringify({
    schemaVersion: "source-contract-evidence-v3",
    requestId,
    projectId: "project",
    targetBuildDigest: "f".repeat(64),
    contracts: [{
      caseId,
      oracleId: "query-visible",
      ruleRef: "RULE-AUTH-001",
      observationKind: "dom",
      authorities: [{
        kind: "registered_source",
        materialId: "authorization-prd",
        sectionId: "query",
        sourceSha256: sourceDigest,
        sourceFiles: [{
          path: "tests/web/project/authorization/example.formal.spec.ts",
          sha256: scriptDigest
        }]
      }]
    }]
  });
  const sourceContractDigest = createHash("sha256")
    .update(sourceContractContent)
    .digest("hex");
  const casePackagePath = resolve(requestRoot, "cases-core.md");
  await mkdir(dirname(scriptPath), { recursive: true });
  await mkdir(requestRoot, { recursive: true });
  await mkdir(dirname(sourceContractPath), { recursive: true });
  await mkdir(dirname(sourcePath), { recursive: true });
  await mkdir(dirname(sourceIndexPath), { recursive: true });
  const fixture = relationFixture();
  await writeFile(planPath, fixture.plan, "utf8");
  await writeFile(scriptPath, scriptContent, "utf8");
  const environmentCapability = options.environmentCapability;
  await writeFile(formalManifestPath, `export const formalExecutionManifest = ${JSON.stringify({
    schemaVersion: "formal-execution-manifest-v3",
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
      implementation: { status: "source_complete" },
      businessOracles: [{
        oracleId: "query-visible",
        ruleRef: "RULE-AUTH-001",
        observationKind: "dom",
        authorities: [{
          kind: "registered_source",
          materialId: "authorization-prd",
          sectionId: "query",
          sourceSha256: sourceDigest
        }]
      }]
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
      kind: "source_contract",
      path: "contracts/formal-source.json",
      sha256: sourceContractDigest
    }, {
      kind: "selector_contract",
      path: "tests/web/project/authorization/selector-contract.json",
      sha256: selectorEvidenceDigest
    }]
  }, null, 2)};\n`, "utf8");
  await writeFile(sourceContractPath, sourceContractContent, "utf8");
  await writeFile(selectorEvidencePath, selectorEvidenceContent, "utf8");
  await writeFile(sourcePath, sourceContent, "utf8");
  await writeFile(resolve(root, "sources/manifest.yaml"), `version: 3
knowledge_indexes:
  - id: project-index
    project: project
    path: indexes/project.yaml
    status: reviewed
    covered_material_ids: [authorization-prd]
materials:
  - id: authorization-prd
    path: requirements/authorization.txt
    applicable_projects: [project]
    status: active
`, "utf8");
  await writeFile(sourceIndexPath, `project: project
index_status: reviewed
documents:
  - material_id: authorization-prd
    source_path: requirements/authorization.txt
    source_sha256: ${sourceDigest}
    sections:
      - section_id: query
`, "utf8");
  await writeFile(casePackagePath, fixture.cases, "utf8");
  const manager = new DurableWorkflowManager(requestId, root);
  const workflowInput = {
    capabilities: ["web" as const],
    writesData: options.writesData ?? false,
    casePackages: ["cases-core.md"],
    reviewerRoles: ["requirements"]
  };
  if (options.legacyUnmarkedFormalCompletion) {
    const current = buildWorkflowDefinition({
      requestId,
      planDigest: createHash("sha256").update(fixture.plan).digest("hex"),
      planText: fixture.plan,
      ...workflowInput
    });
    const definition = withoutFormalCompletionMarkers(current);
    const runId = randomUUID();
    const startedEventId = randomUUID();
    await manager.history.appendBatch([{
      runId,
      requestId,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      eventId: startedEventId,
      type: "WorkflowStarted",
      actorType: "system",
      idempotencyKey: `${runId}/workflow-started`,
      payload: workflowStartedPayload(definition)
    }, {
      runId,
      requestId,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      type: "ActivitiesExpanded",
      actorType: "system",
      idempotencyKey: `${runId}/activities-expanded/${definition.graphDigest}`,
      payload: activitiesExpandedPayload(definition),
      causationId: startedEventId
    }], { seq: 0, digest: GENESIS_DIGEST });
  } else {
    await manager.initialize(workflowInput);
  }
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
  const formalModule = await import(
    `${pathToFileURL(formalManifestPath).href}?build-identity=${Date.now()}`
  ) as { formalExecutionManifest: FormalExecutionManifest };
  const buildIdentity = await resolveSelectorBuildIdentity({
    manifest: formalModule.formalExecutionManifest,
    workspaceRoot: root
  });

  const manifest = buildExecutionAuthorizationManifest({
    schemaVersion: "execution-authorization-v4",
    requestId,
    environment: "test",
    scriptPaths: [
      "tests/web/project/authorization/example.formal.spec.ts",
      "tests/web/project/authorization/execution.manifest.ts"
    ],
    caseIds: [caseId],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [{ resourceType: "query", maxCreates: 0 }],
    dataWritePolicy: "no_write",
    targetBuildDigest: buildIdentity.targetBuildDigest,
    runnableCaseIds: [caseId],
    deferredCases: [],
    capabilityEvidence: [],
    selectorEvidenceDigests: buildIdentity.evidenceDigests,
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
  return {
    root,
    requestRoot,
    planPath,
    scriptPath,
    formalManifestPath,
    sourceContractPath,
    casePackagePath,
    manager,
    manifest
  };
}

type VNextHarness = Awaited<ReturnType<typeof createVNextHarness>>;

async function refreshHarnessScriptSourceContract(harness: VNextHarness): Promise<void> {
  const sourceContract = JSON.parse(
    await readFile(harness.sourceContractPath, "utf8")
  ) as {
    contracts: Array<{
      authorities: Array<{
        kind: string;
        sourceFiles?: Array<{ path: string; sha256: string }>;
      }>;
    }>;
  };
  const scriptDigest = createHash("sha256")
    .update(await readFile(harness.scriptPath))
    .digest("hex");
  const sourceFile = sourceContract.contracts
    .flatMap((contract) => contract.authorities)
    .filter((authority) => authority.kind === "registered_source")
    .flatMap((authority) => authority.sourceFiles ?? [])
    .find((item) => item.path === "tests/web/project/authorization/example.formal.spec.ts");
  if (!sourceFile) throw new Error("Authorization harness source contract is missing its formal script.");
  sourceFile.sha256 = scriptDigest;
  const sourceContractContent = JSON.stringify(sourceContract);
  await writeFile(harness.sourceContractPath, sourceContractContent, "utf8");

  const manifestSource = await readFile(harness.formalManifestPath, "utf8");
  const manifest = JSON.parse(
    manifestSource.replace(/^export const formalExecutionManifest = /u, "").replace(/;\s*$/u, "")
  ) as FormalExecutionManifest;
  const sourceEvidence = manifest.buildEvidence?.find((item) => item.kind === "source_contract");
  if (!sourceEvidence) throw new Error("Authorization harness manifest is missing source_contract evidence.");
  sourceEvidence.sha256 = createHash("sha256").update(sourceContractContent).digest("hex");
  await writeFile(
    harness.formalManifestPath,
    `export const formalExecutionManifest = ${JSON.stringify(manifest, null, 2)};\n`,
    "utf8"
  );
}

async function initializeHarnessFormalRecord(
  harness: VNextHarness,
  selectedCaseIds: string[] = [caseId],
  testDataRunId = "formal-completion-run",
  recordAcceptedCleanup = true
): Promise<FormalExecutionStore> {
  const formalModule = await import(
    `${pathToFileURL(resolve(
      harness.root,
      "tests/web/project/authorization/execution.manifest.ts"
    )).href}?formal-record=${Date.now()}-${selectedCaseIds.length}`
  ) as { formalExecutionManifest: FormalExecutionManifest };
  const store = new FormalExecutionStore(
    resolve(harness.root, ".local/test-ledger"),
    resolve(harness.root, "artifacts/test-results/formal")
  );
  if (!("targetBuildDigest" in harness.manifest)) {
    throw new Error("The terminal-unknown harness requires a v3/v4 authorization manifest.");
  }
  await store.initialize({
    manifest: formalModule.formalExecutionManifest,
    authorizationDigest: harness.manifest.digest,
    testDataRunId,
    capabilities: [],
    caseIds: selectedCaseIds,
    deferredCases: [],
    targetBuildDigest: "targetBuildDigest" in harness.manifest
      ? harness.manifest.targetBuildDigest
      : undefined
  });
  for (const selectedCaseId of selectedCaseIds) {
    const attempt = await store.beginCase(harness.manifest.digest, selectedCaseId);
    await store.verifyBusinessOracle({
      authorizationDigest: harness.manifest.digest,
      caseId: selectedCaseId,
      attempt,
      oracleId: "query-visible",
      evaluator: async () => undefined,
      evidenceRefs: [`artifacts/oracle/${selectedCaseId}.json`]
    });
    await store.finishCase(harness.manifest.digest, selectedCaseId, attempt, "passed");
  }
  await store.recordDataEvidence(
    harness.manifest.digest,
    Object.fromEntries(selectedCaseIds.map((selectedCaseId) => [
      selectedCaseId,
      { intents: [], resources: [] }
    ]))
  );
  if (recordAcceptedCleanup) {
    await store.recordCleanup(
      harness.manifest.digest,
      "passed",
      undefined,
      { dataHygieneStatus: "clean" }
    );
  }
  return store;
}

async function expireActivityLease(
  manager: DurableWorkflowManager,
  activityId: "run" | "report"
): Promise<void> {
  const runtime = await manager.runtime.read();
  assert.ok(runtime?.leases[activityId]);
  runtime.leases[activityId]!.expiresAt = "2000-01-01T00:00:00.000Z";
  await writeFile(manager.runtime.runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
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
    `import { helper } from "./helper.js";\ndeclare const formalCase: (caseId: string, title: string, body: (fixtures: unknown, runtime: { verifyBusinessOracle(oracleId: string, evaluator: () => void): Promise<string> }) => Promise<void>) => void;\ndeclare const assertHelperAvailable: (value: boolean) => void;\nformalCase("${caseId}", "query", async (_fixtures, runtime) => { await runtime.verifyBusinessOracle("query-visible", () => { assertHelperAvailable(helper); }); });\n`,
    "utf8"
  );
  await refreshHarnessScriptSourceContract(harness);
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
  await refreshHarnessScriptSourceContract(harness);

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
    assertCurrentAuthorizedScripts(
      snapshot,
      [harness.formalManifestPath, harness.scriptPath],
      harness.root
    )
  );

  const extraPath = resolve(
    harness.root,
    "tests/web/project/authorization/unreviewed.formal.spec.ts"
  );
  await writeFile(extraPath, "export const unreviewed = true;\n", "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts(
      snapshot,
      [harness.formalManifestPath, harness.scriptPath, extraPath],
      harness.root
    ),
    /differs from the exact local dependency closure/
  );

  await writeFile(harness.scriptPath, "export const formal = false;\n", "utf8");
  assert.throws(
    () => assertCurrentAuthorizedScripts(
      snapshot,
      [harness.formalManifestPath, harness.scriptPath],
      harness.root
    ),
    /Script changed/
  );
});

test("formal completion rejects added or deleted formal specs before importing the manifest", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const extraPath = resolve(
    harness.root,
    "tests/web/project/authorization/new.formal.spec.ts"
  );
  await writeFile(extraPath, "export const newlyDiscovered = true;\n", "utf8");
  await assert.rejects(
    loadFormalCompletionContext(requestId, harness.root),
    /differs from the exact local dependency closure/
  );

  await rm(extraPath);
  await rm(harness.scriptPath);
  await assert.rejects(
    loadFormalCompletionContext(requestId, harness.root),
    /(?:authorized script|formal script entry) must reference an existing regular file/
  );
});

test("v5 run and report completion are bound to one sealed formal execution record", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const formalModule = await import(
    `${pathToFileURL(resolve(
      harness.root,
      "tests/web/project/authorization/execution.manifest.ts"
    )).href}?formal-completion=${Date.now()}`
  ) as { formalExecutionManifest: FormalExecutionManifest };
  const store = new FormalExecutionStore(
    resolve(harness.root, ".local/test-ledger"),
    resolve(harness.root, "artifacts/test-results/formal")
  );
  await store.initialize({
    manifest: formalModule.formalExecutionManifest,
    authorizationDigest: harness.manifest.digest,
    testDataRunId: "formal-completion-run",
    capabilities: [],
    caseIds: [caseId],
    deferredCases: [],
    targetBuildDigest: "targetBuildDigest" in harness.manifest
      ? harness.manifest.targetBuildDigest
      : undefined
  });
  const attempt = await store.beginCase(harness.manifest.digest, caseId);
  await store.verifyBusinessOracle({
    authorizationDigest: harness.manifest.digest,
    caseId,
    attempt,
    oracleId: "query-visible",
    evaluator: async () => undefined,
    evidenceRefs: [`artifacts/oracle/${caseId}.json`]
  });
  await store.finishCase(harness.manifest.digest, caseId, attempt, "passed");
  await store.recordDataEvidence(harness.manifest.digest, {
    [caseId]: { intents: [], resources: [] }
  });
  await store.recordCleanup(
    harness.manifest.digest,
    "passed",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  const run = await harness.manager.startActivity("run", "formal-runner");
  const runFinalized = await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  assert.equal(runFinalized.kind, "completed");
  const report = await harness.manager.startActivity("report", "report-generator");
  const reportFinalized = await finalizeFormalReportWorkflow({
    manager: harness.manager,
    claimToken: report.claimToken
  });
  const completed = reportFinalized.workflow;
  assert.equal(completed.workflowState, "SUCCEEDED");
  assert.equal(completed.testOutcome, "passed");
  assert.equal(completed.reply.kind, "final");
  assert.equal(completed.activities["workflow-completion"], undefined);
  assert.ok((await harness.manager.events()).some((event) =>
    event.type === "WorkflowCompleted"
  ));
  const runEvent = (await harness.manager.events()).find((event) =>
    event.type === "ActivitySucceeded" && event.payload.activityId === "run"
  );
  const reportEvent = (await harness.manager.events()).find((event) =>
    event.type === "ActivitySucceeded" && event.payload.activityId === "report"
  );
  assert.deepEqual(
    reportEvent?.payload.formalExecutionEvidence,
    runEvent?.payload.formalExecutionEvidence
  );
});

test("generic success, artifact publication and confirmed reconciliation cannot close run", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const run = await harness.manager.startActivity("run", "generic-bypass");
  await assert.rejects(
    harness.manager.succeedActivity("run", {
      claimToken: run.claimToken,
      verification: "untrusted success",
      testOutcome: "passed"
    }),
    /dedicated formal execution completion path/
  );
  await assert.rejects(
    harness.manager.publishArtifactsAndSucceed("run", {
      claimToken: run.claimToken,
      publishId: "untrusted-report",
      verification: "untrusted publication",
      artifacts: []
    }),
    /dedicated formal execution completion path/
  );
  await rm(resolve(harness.root, ".local/test-task-runtime"), {
    recursive: true,
    force: true
  });
  const recovered = new DurableWorkflowManager(requestId, harness.root);
  const resumed = await recovered.resume("recover generic bypass test");
  assert.equal(resumed.activities.run?.state, "RECONCILING");
  await assert.rejects(
    recovered.reconcileActivity("run", "confirmed", "untrusted reconciliation"),
    /dedicated formal execution completion path/
  );
});

test("generic success, artifact publication and confirmed reconciliation cannot close report", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "generic-report-run");
  await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  const report = await harness.manager.startActivity("report", "generic-report-bypass");
  await assert.rejects(
    harness.manager.succeedActivity("report", {
      claimToken: report.claimToken,
      verification: "untrusted report success",
      testOutcome: "passed"
    }),
    /dedicated formal execution completion path/
  );
  await assert.rejects(
    harness.manager.publishArtifactsAndSucceed("report", {
      claimToken: report.claimToken,
      publishId: "untrusted-formal-report",
      verification: "untrusted report publication",
      artifacts: []
    }),
    /dedicated formal execution completion path/
  );
  await rm(resolve(harness.root, ".local/test-task-runtime"), {
    recursive: true,
    force: true
  });
  const recovered = new DurableWorkflowManager(requestId, harness.root);
  const resumed = await recovered.resume("recover generic report bypass test");
  assert.equal(resumed.activities.report?.state, "RECONCILING");
  await assert.rejects(
    recovered.reconcileActivity("report", "confirmed", "untrusted report reconciliation"),
    /dedicated formal execution completion path/
  );
});

test("formal run bridge cannot append success without a matching execution record", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const run = await harness.manager.startActivity("run", "missing-formal-record");
  const before = (await harness.manager.gate()).head;

  await assert.rejects(
    finalizeFormalRunWorkflow({
      manager: harness.manager,
      claimToken: run.claimToken
    }),
    /Formal execution state is not initialized/
  );

  assert.deepEqual((await harness.manager.gate()).head, before);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );
});

test("formal finalize validates the active claim before sealing or materializing reports", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const store = await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "claim-ordering-run");

  await assert.rejects(
    finalizeFormalRunWorkflow({
      manager: harness.manager,
      claimToken: "wrong-run-claim"
    }),
    /requires the current claim token/
  );
  assert.equal((await store.read(harness.manifest.digest))?.completionSeal, undefined);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );

  await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  await harness.manager.startActivity("report", "claim-ordering-report");
  const reportDirectory = resolve(
    harness.root,
    "artifacts/test-results/formal",
    harness.manifest.digest.slice(0, 12)
  );
  await assert.rejects(
    finalizeFormalReportWorkflow({
      manager: harness.manager,
      claimToken: "wrong-report-claim"
    }),
    /requires the current claim token/
  );
  await assert.rejects(
    () => readFile(resolve(reportDirectory, "run-summary.json"), "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );
  await assert.rejects(
    () => readFile(resolve(reportDirectory, "execution-summary.md"), "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "report"
    ),
    false
  );
});

test("manager formal completion cannot be forged with caller-supplied evidence", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const run = await harness.manager.startActivity("run", "manager-injection-gate");
  const forged = {
    claimToken: run.claimToken,
    evidence: {
      schemaVersion: "formal-execution-workflow-evidence-v1",
      executionSubjectDigest: harness.manifest.digest,
      manifestDigest: "a".repeat(64),
      resultDigest: "b".repeat(64)
    }
  } as unknown as { claimToken: string };

  await assert.rejects(
    harness.manager.completeFormalRun(forged),
    /Formal execution state is not initialized/
  );
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );
});

test("formal run bridge cannot append success when the sealed case scope drifts", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness, []);
  const run = await harness.manager.startActivity("run", "drifted-formal-scope");
  const before = (await harness.manager.gate()).head;

  await assert.rejects(
    finalizeFormalRunWorkflow({
      manager: harness.manager,
      claimToken: run.claimToken
    }),
    /runnable case set differs/
  );

  assert.deepEqual((await harness.manager.gate()).head, before);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );
});

test("formal run bridge rejects a Store summary whose outcome contradicts its counts", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "contradictory-formal-summary");
  const before = (await harness.manager.gate()).head;
  const original = FormalExecutionStore.prototype.sealForWorkflow;
  FormalExecutionStore.prototype.sealForWorkflow = async function (input) {
    const sealed = await original.call(this, input);
    return {
      ...sealed,
      summary: {
        ...sealed.summary,
        testOutcome: "failed"
      }
    };
  };

  try {
    await assert.rejects(
      finalizeFormalRunWorkflow({
        manager: harness.manager,
        claimToken: run.claimToken
      }),
      /summary testOutcome failed differs from derived passed/
    );
  } finally {
    FormalExecutionStore.prototype.sealForWorkflow = original;
  }

  assert.deepEqual((await harness.manager.gate()).head, before);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );
});

test("formal report bridge rejects post-materialization tampering before workflow success", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "tamper-run");
  const runFinalized = await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  assert.equal(runFinalized.kind, "completed");
  const report = await harness.manager.startActivity("report", "tamper-report");
  const before = (await harness.manager.gate()).head;
  const original = FormalExecutionStore.prototype.materializeSealedReport;
  FormalExecutionStore.prototype.materializeSealedReport = async function (authorizationDigest) {
    const materialized = await original.call(this, authorizationDigest);
    await writeFile(
      resolve(harness.root, materialized.artifacts[0]!.path),
      "tampered after materialization\n",
      "utf8"
    );
    return materialized;
  };

  try {
    await assert.rejects(
      finalizeFormalReportWorkflow({
        manager: harness.manager,
        claimToken: report.claimToken
      }),
      /Sealed formal report digest mismatch/
    );
  } finally {
    FormalExecutionStore.prototype.materializeSealedReport = original;
  }

  assert.deepEqual((await harness.manager.gate()).head, before);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "report"
    ),
    false
  );
});

test("a sealed run recovers from an expired worker without re-running cases", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const store = await initializeHarnessFormalRecord(harness);
  const attemptsBefore = (await store.read(harness.manifest.digest))!
    .cases[caseId]!.attempts.length;
  const run = await harness.manager.startActivity("run", "seal-crash-run");
  await deriveFormalRunCompletion(requestId, harness.root);
  assert.ok((await store.read(harness.manifest.digest))?.completionSeal);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );

  await expireActivityLease(harness.manager, "run");
  const resumed = await harness.manager.resume("recover after run seal crash");
  assert.equal(resumed.activities.run?.state, "RECONCILING");
  const completed = await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });

  assert.equal(completed.kind, "completed");
  assert.equal(completed.workflow.activities.run?.state, "SUCCEEDED");
  assert.equal(
    (await store.read(harness.manifest.digest))!.cases[caseId]!.attempts.length,
    attemptsBefore
  );
  assert.equal(
    (await harness.manager.events()).filter((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ).length,
    1
  );
});

test("a published formal report recovers atomically after the worker expires", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "report-crash-run");
  await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  const report = await harness.manager.startActivity("report", "report-publication-crash");
  const derived = await deriveFormalReportCompletion(requestId, harness.root);
  const publisher = new ArtifactPublisher(harness.manager.requestId, {
    workspaceRoot: harness.manager.workspaceRoot,
    runtimeStore: harness.manager.runtime
  });
  await publisher.publish({
    publishId: derived.publishId,
    activityId: "report",
    lease: {
      requestId: harness.manager.requestId,
      activityId: "report",
      owner: "report-publication-crash",
      leaseId: report.claimToken,
      fencingToken: report.fencingToken,
      expiresAt: report.leaseExpiresAt
    },
    artifacts: derived.artifacts.map((artifact) => ({
      targetPath: artifact.targetPath,
      content: artifact.content
    }))
  }, async (event) => {
    await harness.manager.recordArtifactPublishPrepared(event);
  });
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "report"
    ),
    false
  );

  await expireActivityLease(harness.manager, "report");
  const resumed = await harness.manager.resume("recover after report publication crash");
  assert.equal(resumed.activities.report?.state, "RECONCILING");
  const completed = await finalizeFormalReportWorkflow({
    manager: harness.manager,
    claimToken: report.claimToken
  });

  assert.equal(completed.workflow.workflowState, "SUCCEEDED");
  assert.equal(completed.workflow.activities.report?.state, "SUCCEEDED");
  assert.equal(
    (await harness.manager.events()).filter((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "report"
    ).length,
    1
  );
  assert.equal(
    (await harness.manager.events()).filter((event) =>
      event.type === "WorkflowCompleted"
    ).length,
    1
  );
});

test("an unfinished unmarked v5 report uses the dedicated finalize recovery path", async (context) => {
  const harness = await createVNextHarness({ legacyUnmarkedFormalCompletion: true });
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "legacy-unmarked-run");
  await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  const report = await harness.manager.startActivity("report", "legacy-unmarked-report");
  assert.equal(
    (await harness.manager.gate()).activities.report?.definition.metadata?.completionContract,
    undefined
  );

  await expireActivityLease(harness.manager, "report");
  const resumed = await harness.manager.resume("recover unmarked v5 report worker");
  assert.equal(resumed.activities.report?.state, "RECONCILING");
  const completed = await finalizeFormalReportWorkflow({
    manager: harness.manager,
    claimToken: report.claimToken
  });

  assert.equal(completed.workflow.workflowState, "SUCCEEDED");
  assert.equal(completed.workflow.activities.report?.state, "SUCCEEDED");
  assert.equal(
    (await harness.manager.events()).filter((event) =>
      event.type === "WorkflowCompleted"
    ).length,
    1
  );
});

test("formal finalize CLI rejects caller-supplied verdict, file and digest fields", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const run = await harness.manager.startActivity("run", "cli-injection-gate");
  const before = (await harness.manager.gate()).head;
  const injected = [
    "--verified", "caller verdict",
    "--outcome", "passed",
    "--test-outcome", "passed",
    "--file", "forged.json",
    "--digest", "a".repeat(64),
    "--output-digest", "a".repeat(64)
  ];

  for (const command of ["execution-run-finalize", "execution-report-finalize"]) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        "--import",
        tsxLoader,
        managePath,
        command,
        "--request",
        requestId,
        "--claim",
        run.claimToken,
        ...injected
      ], { cwd: harness.root }),
      /does not accept --verified, --test-outcome, --outcome, --file, --digest, --output-digest/
    );
  }

  assert.deepEqual((await harness.manager.gate()).head, before);
});

test("execution-run-finalize parks unsettled hygiene and resumes the same attempts with a new fence", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const dataManager = new TestDataManager({
    projectId: "project",
    envId: "test",
    ledgerRoot: resolve(harness.root, ".local/test-ledger"),
    artifactRoot: resolve(harness.root, "artifacts/test-results")
  });
  const dataRun = await dataManager.startRun({
    projectId: "project",
    envId: "test",
    suiteId: requestId,
    caseIds: [caseId],
    dataWritePolicy: "no_write",
    authorizationDigest: harness.manifest.digest
  });
  const store = await initializeHarnessFormalRecord(
    harness,
    [caseId],
    dataRun.runId,
    false
  );
  await store.recordCleanup(
    harness.manifest.digest,
    "failed",
    "cleanup_failed=1",
    { dataHygieneStatus: "cleanup_failed" }
  );
  const attemptsBefore = (await store.read(harness.manifest.digest))!
    .cases[caseId]!.attempts.length;
  const run = await harness.manager.startActivity("run", "hygiene-parking");
  const blockerId = formalDataHygieneBlockerId(harness.manifest.digest);

  await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "execution-run-finalize",
    "--request",
    requestId,
    "--claim",
    run.claimToken,
    "--json"
  ], { cwd: harness.root });

  const parkedGate = await harness.manager.gate();
  assert.equal(parkedGate.activities.run?.state, "BLOCKED");
  assert.deepEqual(parkedGate.activities.run?.blockerIds, [blockerId]);
  assert.equal(
    (await harness.manager.events()).some((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ),
    false
  );
  const raised = (await harness.manager.events()).find((event) =>
    event.type === "BlockerRaised" && event.payload.blockerId === blockerId
  );
  assert.equal(raised?.payload.category, "data_hygiene_incomplete");
  const parkedRuntime = await harness.manager.runtime.read();
  assert.ok(parkedRuntime?.leases.run?.releasedAt);
  assert.equal(
    (await store.read(harness.manifest.digest))!.cases[caseId]!.attempts.length,
    attemptsBefore
  );

  await execFileAsync(process.execPath, [
    "--import",
    tsxLoader,
    managePath,
    "execution-run-finalize",
    "--request",
    requestId,
    "--claim",
    run.claimToken,
    "--json"
  ], { cwd: harness.root });

  const completedGate = await harness.manager.gate();
  assert.equal(completedGate.activities.run?.state, "SUCCEEDED");
  assert.deepEqual(completedGate.activities.run?.blockerIds, []);
  const completedRuntime = await harness.manager.runtime.read();
  assert.ok(completedRuntime?.leases.run?.releasedAt);
  assert.ok(completedRuntime!.leases.run!.fencingToken > run.fencingToken);
  assert.equal(
    (await store.read(harness.manifest.digest))!.cases[caseId]!.attempts.length,
    attemptsBefore
  );
  const endedDataRun = await dataManager.store.readRun(dataRun.runId);
  assert.equal(endedDataRun?.status, "passed");
  assert.equal(endedDataRun?.functionalStatus, "passed");
  assert.equal(
    (await harness.manager.events()).filter((event) =>
      event.type === "ActivitySucceeded" && event.payload.activityId === "run"
    ).length,
    1
  );
});

test("data hygiene blocker resolution and run success share one atomic history append", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  await initializeHarnessFormalRecord(harness);
  const run = await harness.manager.startActivity("run", "atomic-hygiene-run");
  await harness.manager.parkRunForDataHygiene({
    claimToken: run.claimToken,
    executionSubjectDigest: harness.manifest.digest,
    dataHygieneStatus: "cleanup_failed"
  });

  const batches: string[][] = [];
  const history = harness.manager.history;
  const originalAppendBatch = history.appendBatch.bind(history);
  history.appendBatch = async (...args) => {
    batches.push(args[0].map((event) => event.type));
    return originalAppendBatch(...args);
  };
  try {
    const completed = await finalizeFormalRunWorkflow({
      manager: harness.manager,
      claimToken: run.claimToken
    });
    assert.equal(completed.kind, "completed");
  } finally {
    history.appendBatch = originalAppendBatch;
  }

  assert.ok(batches.some((types) =>
    types.length === 2
    && types[0] === "BlockerResolved"
    && types[1] === "ActivitySucceeded"
  ));
  const gate = await harness.manager.gate();
  assert.equal(gate.activities.run?.state, "SUCCEEDED");
  assert.deepEqual(gate.activities.run?.blockerIds, []);
});

test("terminal unknown parks deterministically and a trusted retry atomically seals and clears it", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  if (harness.manifest.schemaVersion === "execution-authorization-v2") {
    throw new Error("The terminal-unknown harness requires a readiness authorization manifest.");
  }
  const readinessManifest = harness.manifest;
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    harness.manifest.digest,
    harness.manifest.callbackId
  );
  const formalModule = await import(
    `${pathToFileURL(resolve(
      harness.root,
      "tests/web/project/authorization/execution.manifest.ts"
    )).href}?terminal-unknown=${Date.now()}`
  ) as { formalExecutionManifest: FormalExecutionManifest };
  const store = new FormalExecutionStore(
    resolve(harness.root, ".local/test-ledger"),
    resolve(harness.root, "artifacts/test-results/formal")
  );
  await store.initialize({
    manifest: formalModule.formalExecutionManifest,
    authorizationDigest: harness.manifest.digest,
    testDataRunId: "terminal-unknown-run",
    capabilities: [],
    caseIds: [caseId],
    deferredCases: [],
    targetBuildDigest: readinessManifest.targetBuildDigest
  });
  const unknownAttempt = await store.beginCase(harness.manifest.digest, caseId);
  await store.verifyBusinessOracle({
    authorizationDigest: harness.manifest.digest,
    caseId,
    attempt: unknownAttempt,
    oracleId: "query-visible",
    evaluator: async () => ({
      kind: "indeterminate",
      reason: "The reviewed query state was indeterminate."
    }),
    evidenceRefs: [`artifacts/oracle/${caseId}-unknown.json`]
  });
  await store.finishCase(
    harness.manifest.digest,
    caseId,
    unknownAttempt,
    "unknown",
    "The reviewed query state was indeterminate.",
    undefined
  );
  await store.recordDataEvidence(harness.manifest.digest, {
    [caseId]: { intents: [], resources: [] }
  });
  await store.recordCleanup(
    harness.manifest.digest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  const run = await harness.manager.startActivity("run", "terminal-unknown-runner");
  const blockerId = formalDeterministicOutcomeBlockerId(harness.manifest.digest);

  const parked = await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  assert.equal(parked.kind, "parked");
  if (parked.kind !== "parked") throw new Error("Expected terminal unknown parking.");
  assert.equal(parked.parkReason, "deterministic_outcome");
  assert.equal(parked.outcomeAssessment.terminalUnknownCount, 1);
  assert.equal(parked.blockerId, blockerId);
  assert.equal(parked.workflow.activities.run?.state, "BLOCKED");
  assert.deepEqual(parked.workflow.activities.run?.blockerIds, [blockerId]);
  assert.equal((await store.read(harness.manifest.digest))?.completionSeal, undefined);
  assert.equal((await harness.manager.events()).some((event) =>
    event.type === "ActivitySucceeded" && event.payload.activityId === "run"
  ), false);
  await assert.rejects(
    harness.manager.resolveBlocker(blockerId, "d".repeat(64)),
    /dedicated formal finalize/
  );

  assert.deepEqual(
    await store.reopenSafeRetryableCases(harness.manifest.digest),
    [caseId]
  );
  const trustedAttempt = await store.beginCase(harness.manifest.digest, caseId);
  await store.verifyBusinessOracle({
    authorizationDigest: harness.manifest.digest,
    caseId,
    attempt: trustedAttempt,
    oracleId: "query-visible",
    evaluator: async () => undefined,
    evidenceRefs: [`artifacts/oracle/${caseId}-trusted.json`]
  });
  await store.finishCase(harness.manifest.digest, caseId, trustedAttempt, "passed");
  await store.recordCleanup(
    harness.manifest.digest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );

  const batches: string[][] = [];
  const originalAppendBatch = harness.manager.history.appendBatch.bind(harness.manager.history);
  harness.manager.history.appendBatch = async (...args) => {
    batches.push(args[0].map((event) => event.type));
    return originalAppendBatch(...args);
  };
  const completed = await (async () => {
    try {
      return await finalizeFormalRunWorkflow({
        manager: harness.manager,
        claimToken: run.claimToken
      });
    } finally {
      harness.manager.history.appendBatch = originalAppendBatch;
    }
  })();
  assert.equal(completed.kind, "completed");
  assert.ok((await store.read(harness.manifest.digest))?.completionSeal);
  assert.ok(batches.some((types) =>
    types.length === 2
    && types[0] === "BlockerResolved"
    && types[1] === "ActivitySucceeded"
  ));
  const completedGate = await harness.manager.gate();
  assert.equal(completedGate.activities.run?.state, "SUCCEEDED");
  assert.deepEqual(completedGate.activities.run?.blockerIds, []);

  const report = await harness.manager.startActivity("report", "terminal-unknown-report");
  const reported = await finalizeFormalReportWorkflow({
    manager: harness.manager,
    claimToken: report.claimToken
  });
  assert.equal(reported.workflow.workflowState, "SUCCEEDED");
  const reportDirectory = resolve(
    harness.root,
    "artifacts/test-results/formal",
    harness.manifest.digest.slice(0, 12)
  );
  const runSummary = JSON.parse(
    await readFile(resolve(reportDirectory, "run-summary.json"), "utf8")
  ) as {
    businessOracleContractDigest?: string;
    cases?: Array<{
      attemptFinality?: string;
      oracleResults?: Array<{ outcome?: string; evaluationBasis?: string }>;
    }>;
  };
  assert.match(runSummary.businessOracleContractDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(runSummary.cases?.[0]?.attemptFinality, "terminal");
  assert.deepEqual(runSummary.cases?.[0]?.oracleResults?.map((item) => ({
    outcome: item.outcome,
    evaluationBasis: item.evaluationBasis
  })), [{ outcome: "satisfied", evaluationBasis: "normal_return" }]);
});

test("settled retry atomically replaces the deterministic blocker when cleanup remains unsafe", async (context) => {
  const harness = await createVNextHarness();
  context.after(() => rm(harness.root, { recursive: true, force: true }));
  if (harness.manifest.schemaVersion === "execution-authorization-v2") {
    throw new Error("The terminal-unknown harness requires a readiness authorization manifest.");
  }
  const readinessManifest = harness.manifest;
  await acceptCallback(
    harness.manager,
    "execution-authorization",
    readinessManifest.digest,
    readinessManifest.callbackId
  );
  const formalModule = await import(
    `${pathToFileURL(resolve(
      harness.root,
      "tests/web/project/authorization/execution.manifest.ts"
    )).href}?outcome-to-hygiene=${Date.now()}`
  ) as { formalExecutionManifest: FormalExecutionManifest };
  const store = new FormalExecutionStore(
    resolve(harness.root, ".local/test-ledger"),
    resolve(harness.root, "artifacts/test-results/formal")
  );
  await store.initialize({
    manifest: formalModule.formalExecutionManifest,
    authorizationDigest: readinessManifest.digest,
    testDataRunId: "missing-cleanup-run",
    capabilities: [],
    caseIds: [caseId],
    deferredCases: [],
    targetBuildDigest: readinessManifest.targetBuildDigest
  });
  const unknownAttempt = await store.beginCase(readinessManifest.digest, caseId);
  await store.verifyBusinessOracle({
    authorizationDigest: readinessManifest.digest,
    caseId,
    attempt: unknownAttempt,
    oracleId: "query-visible",
    evaluator: async () => ({
      kind: "indeterminate",
      reason: "The reviewed query state was indeterminate."
    }),
    evidenceRefs: [`artifacts/oracle/${caseId}-replace-unknown.json`]
  });
  await store.finishCase(
    readinessManifest.digest,
    caseId,
    unknownAttempt,
    "unknown",
    "The reviewed query state was indeterminate.",
    undefined
  );
  await store.recordDataEvidence(readinessManifest.digest, {
    [caseId]: { intents: [], resources: [] }
  });
  await store.recordCleanup(
    readinessManifest.digest,
    "not_required",
    undefined,
    { dataHygieneStatus: "clean" }
  );
  const run = await harness.manager.startActivity("run", "outcome-to-hygiene-runner");
  const deterministicBlockerId = formalDeterministicOutcomeBlockerId(
    readinessManifest.digest
  );
  const hygieneBlockerId = formalDataHygieneBlockerId(readinessManifest.digest);
  const unknownParked = await finalizeFormalRunWorkflow({
    manager: harness.manager,
    claimToken: run.claimToken
  });
  assert.equal(unknownParked.kind, "parked");
  if (unknownParked.kind !== "parked") throw new Error("Expected terminal unknown parking.");
  assert.equal(unknownParked.blockerId, deterministicBlockerId);

  assert.deepEqual(
    await store.reopenSafeRetryableCases(readinessManifest.digest),
    [caseId]
  );
  const trustedAttempt = await store.beginCase(readinessManifest.digest, caseId);
  await store.verifyBusinessOracle({
    authorizationDigest: readinessManifest.digest,
    caseId,
    attempt: trustedAttempt,
    oracleId: "query-visible",
    evaluator: async () => undefined,
    evidenceRefs: [`artifacts/oracle/${caseId}-replace-trusted.json`]
  });
  await store.finishCase(readinessManifest.digest, caseId, trustedAttempt, "passed");
  await store.recordCleanup(
    readinessManifest.digest,
    "failed",
    "cleanup_failed=1",
    { dataHygieneStatus: "cleanup_failed" }
  );

  const batches: Array<Array<{ type: string; blockerId?: unknown }>> = [];
  const history = harness.manager.history;
  const originalAppendBatch = history.appendBatch.bind(history);
  history.appendBatch = async (...args) => {
    batches.push(args[0].map((event) => ({
      type: event.type,
      blockerId: event.payload?.blockerId
    })));
    return originalAppendBatch(...args);
  };
  const hygieneParked = await (async () => {
    try {
      return await finalizeFormalRunWorkflow({
        manager: harness.manager,
        claimToken: run.claimToken
      });
    } finally {
      history.appendBatch = originalAppendBatch;
    }
  })();

  assert.equal(hygieneParked.kind, "parked");
  if (hygieneParked.kind !== "parked") throw new Error("Expected data hygiene parking.");
  assert.equal(hygieneParked.parkReason, "data_hygiene");
  assert.equal(hygieneParked.blockerId, hygieneBlockerId);
  assert.equal(hygieneParked.dataHygieneStatus, "cleanup_failed");
  assert.equal(hygieneParked.outcomeAssessment.status, "settled");
  assert.deepEqual(hygieneParked.workflow.activities.run?.blockerIds, [hygieneBlockerId]);
  assert.ok(batches.some((events) =>
    events.length === 2
    && events[0]?.type === "BlockerResolved"
    && events[0]?.blockerId === deterministicBlockerId
    && events[1]?.type === "BlockerRaised"
    && events[1]?.blockerId === hygieneBlockerId
  ));
  assert.equal((await store.read(readinessManifest.digest))?.completionSeal, undefined);
  assert.equal((await harness.manager.events()).some((event) =>
    event.type === "ActivitySucceeded" && event.payload.activityId === "run"
  ), false);
  await assert.rejects(
    harness.manager.resolveBlocker(hygieneBlockerId, "f".repeat(64)),
    /dedicated formal finalize/
  );
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
