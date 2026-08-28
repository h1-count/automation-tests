import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  inspectPublicTaskCommands,
  PUBLIC_TASK_COMMANDS
} from "../../scripts/public-task-command-contract.js";
import {
  inspectContractRegistry
} from "../../scripts/contract-registry-contract.js";
import {
  inspectRootRuleBoundary,
  inspectRuleResponsibilities,
  RULE_OWNER_PATHS,
  SUPPORTING_DOCUMENT_ROLES
} from "../../scripts/rule-responsibility-contract.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const agents = read("AGENTS.md");
const automationGuideline = read("docs/testing/automation-guideline.md");
const environmentGuideline = read("docs/testing/environment-guideline.md");
const selectorGuideline = read("docs/testing/selector-guideline.md");
const testcaseGuideline = read("docs/testing/testcase-guideline.md");
const docsIndex = read("docs/testing/README.md");
const contractRegistry = read("docs/testing/contract-registry.md");
const skill = read("skills/iot-automation-testing/SKILL.md");
const taskManage = read("src/support/task-workflow/cli/manage.ts");
const workflowDefinition = read("src/support/task-workflow/definition.ts");
const reviewPolicy = read("src/support/task-workflow/reviewPolicy.ts");
const caseReviewRisk = read("src/support/task-workflow/caseReviewRisk.ts");
const reviewBatchScope = read("src/support/task-workflow/reviewBatchScope.ts");
const reviewInputSnapshot = read("src/support/task-workflow/reviewInputSnapshot.ts");
const planTemplate = read("skills/iot-automation-testing/templates/test-plan.template.md");
const testcaseTemplate = read("skills/iot-automation-testing/templates/testcase.template.md");
const selectorVerificationTemplate = read(
  "skills/iot-automation-testing/templates/playwright-selector-verification.spec.template.ts"
);
const selectorEvidenceCache = read("src/support/web/selectorEvidenceCache.ts");
const formalExecutionTypes = read("src/support/formal-execution/types.ts");
const stableSuite = read("src/support/test-suite/stableSuite.ts");
const capabilityProvider = read("src/support/formal-execution/capabilityProvider.ts");
const formalSourceGate = read("src/support/formal-execution/sourceGate.ts");
const dependencyPlan = read("src/support/formal-execution/dependencyPlan.ts");
const executionScheduler = read("src/support/formal-execution/executionScheduler.ts");
const pageSessionGroups = read("src/support/formal-execution/pageSessionGroups.ts");
const formalWebFixture = read("src/fixtures/formalWebFixture.ts");
const formalWebRunner = read("scripts/run-formal-web-tests.ts");
const formalRunner = read("scripts/run-formal-tests.ts");
const formalManifestTemplate = read(
  "skills/iot-automation-testing/templates/formal-execution-manifest.template.ts"
);
const hook = read("scripts/harness-stop-stage-envelope.mjs");
const hookPath = resolve(root, "scripts/harness-stop-stage-envelope.mjs");
const hookConfigText = read(".codex/hooks.json");
const hookConfig = JSON.parse(hookConfigText) as {
  hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
};
const goalIdentifierPattern = /goal/i;
const hookSchedulingPattern =
  /\b(?:heartbeat|wake)\b|automationId|workflowState|checkpoint\?\.safe/;

test("stable suite reuse is deterministic and cannot reuse run facts", () => {
  assert.match(stableSuite, /stable-test-suite-manifest-v1/);
  assert.match(stableSuite, /test-suite-reuse-assessment-v1/);
  assert.match(stableSuite, /direct_execute/);
  assert.match(stableSuite, /affected_rebuild/);
  assert.match(stableSuite, /full_replan/);
  assert.match(stableSuite, /resolveLocalScriptDependencyClosure/);
  assert.match(stableSuite, /impactMap/);
  assert.match(stableSuite, /completionSeal/);
  assert.match(workflowDefinition, /definitionVersion: CURRENT_WORKFLOW_VERSION/);
  assert.match(workflowDefinition, /policy_auto_no_write/);
  assert.match(taskManage, /suite-readiness-publish/);
  assert.match(taskManage, /suite-promote/);
  assert.doesNotMatch(stableSuite, /reuse(?:d)?(?:Result|Authorization|Cleanup|Ledger)/i);
});

function readTypeScriptTree(relativeDirectory: string): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  visit(resolve(root, relativeDirectory));
  return files.sort().map((path) => readFileSync(path, "utf8")).join("\n");
}

function lineContainingAll(
  document: string,
  markers: string[],
  label: string
): string {
  const line = document.split("\n").find((candidate) =>
    markers.every((marker) => candidate.includes(marker))
  );
  assert.ok(line, `${label} must contain one line with: ${markers.join(", ")}`);
  return line;
}

function fencedBlockAfter(document: string, marker: string): string {
  const markerIndex = document.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing block marker: ${marker}`);
  const start = document.indexOf("```text\n", markerIndex);
  assert.notEqual(start, -1, `missing text fence after: ${marker}`);
  const contentStart = start + "```text\n".length;
  const end = document.indexOf("\n```", contentStart);
  assert.notEqual(end, -1, `missing closing fence after: ${marker}`);
  return document.slice(contentStart, end);
}

function mutateDelegation(
  content: string,
  ownerDeclaration: string,
  mutate: (summary: string) => string
): string {
  const startMarker = `<!-- delegates: ${ownerDeclaration} -->`;
  const endMarker = "<!-- end-delegates -->";
  const start = content.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const summaryStart = start + startMarker.length;
  const end = content.indexOf(endMarker, summaryStart);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return `${content.slice(0, summaryStart)}${mutate(content.slice(summaryStart, end))}${content.slice(end)}`;
}

interface HarnessOptions {
  gateOutput?: Record<string, unknown> | string;
  gateExitCode?: number;
  requestId?: string;
  sessionId?: string;
  runtimeOverrides?: Record<string, unknown>;
}

function createStopHookHarness(options: HarnessOptions = {}) {
  const sandbox = mkdtempSync(resolve(tmpdir(), "stop-gate-adapter-"));
  const git = spawnSync("git", ["init", "-q"], { cwd: sandbox, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);

  const runtimeDirectory = resolve(sandbox, ".local/test-task-runtime/web/project/request");
  const loaderDirectory = resolve(sandbox, "node_modules/tsx/dist");
  const gateDirectory = resolve(sandbox, "src/support/task-workflow/cli");
  const historyDirectory = resolve(sandbox, "testcases/web/project/request");
  const historyPath = resolve(historyDirectory, "workflow-history.ndjson");
  const outputPath = resolve(sandbox, "gate-output.txt");
  const argsPath = resolve(sandbox, "gate-args.json");
  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(loaderDirectory, { recursive: true });
  mkdirSync(gateDirectory, { recursive: true });
  mkdirSync(historyDirectory, { recursive: true });
  writeFileSync(historyPath, "{\"seq\":1,\"type\":\"WorkflowStarted\"}\n", "utf8");

  const rawGateOutput = typeof options.gateOutput === "string"
    ? options.gateOutput
    : JSON.stringify(options.gateOutput ?? {});
  writeFileSync(outputPath, rawGateOutput, "utf8");

  writeFileSync(
    resolve(loaderDirectory, "loader.mjs"),
    `import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
`,
    "utf8"
  );
  writeFileSync(
    resolve(loaderDirectory, "hooks.mjs"),
    `import { readFile } from "node:fs/promises";
export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: await readFile(new URL(url), "utf8")
    };
  }
  return nextLoad(url, context);
}
`,
    "utf8"
  );
  writeFileSync(
    resolve(gateDirectory, "gate.ts"),
    `import { readFileSync, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(readFileSync(${JSON.stringify(outputPath)}, "utf8"));
process.exitCode = ${options.gateExitCode ?? 0};
`,
    "utf8"
  );

  const runtimePath = resolve(runtimeDirectory, "runtime.json");
  writeFileSync(runtimePath, JSON.stringify({
    schemaVersion: "test-workflow-runtime-v1",
    revision: 1,
    requestId: options.requestId ?? "web/project/request",
    sessionBinding: {
      sessionId: options.sessionId ?? "session-test",
      boundAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    },
    ...options.runtimeOverrides
  }), "utf8");

  return {
    runtimePath,
    historyPath,
    runHook(input: Record<string, unknown>) {
      const result = spawnSync(process.execPath, [hookPath], {
        cwd: sandbox,
        input: JSON.stringify(input),
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    },
    gateArgs() {
      return JSON.parse(readFileSync(argsPath, "utf8")) as string[];
    },
    gateWasCalled() {
      return existsSync(argsPath);
    },
    cleanup() {
      rmSync(sandbox, { recursive: true, force: true });
    }
  };
}

test("rule responsibility markers have exactly one owner and delegated rules stay concise", () => {
  const documents = Object.values(RULE_OWNER_PATHS).map((path) => ({
    path,
    content: read(path)
  }));
  const supportingDocuments = Object.keys(SUPPORTING_DOCUMENT_ROLES).map((path) => ({
    path,
    content: read(path)
  }));
  const current = inspectRuleResponsibilities(documents, supportingDocuments);
  assert.deepEqual(current, {
    ownerViolations: [],
    delegationViolations: [],
    supportingViolations: []
  });
  assert.deepEqual(inspectRootRuleBoundary(agents), []);
  assert.ok(
    inspectRootRuleBoundary(agents.replace("docs/testing/testcase-guideline.md", "missing.md"))
      .some((violation) => violation.includes("must delegate automation.testcases"))
  );
  assert.ok(
    inspectRootRuleBoundary(`${agents}\nsource-selection → candidate-generation → case-confirmation\n`)
      .some((violation) => violation.includes("testcase design activity chain"))
  );

  const duplicateOwner = inspectRuleResponsibilities([
    ...documents,
    {
      path: "docs/testing/extra.md",
      content: "<!-- owns: automation.environment -->"
    }
  ]);
  assert.ok(
    duplicateOwner.ownerViolations.some((violation) =>
      violation.includes("automation.environment")
      && violation.includes("docs/testing/extra.md")
    )
  );

  const automation = documents.find(
    (document) => document.path === RULE_OWNER_PATHS["task.lifecycle"]
  )!;
  const missingLink = inspectRuleResponsibilities(documents.map((document) =>
    document === automation
      ? {
          ...document,
          content: mutateDelegation(
            document.content,
            "automation.testcases",
            (summary) => summary.replace(/\]\([^)]+\)/g, "]")
          )
        }
      : document
  ));
  assert.ok(
    missingLink.delegationViolations.some((violation) =>
      violation.includes("automation.testcases")
      && violation.includes("must link")
    )
  );

  const report = documents.find(
    (document) => document.path === RULE_OWNER_PATHS["automation.reporting"]
  )!;
  const missingKnowledgeLink = inspectRuleResponsibilities(documents.map((document) =>
    document === report
      ? {
          ...document,
          content: mutateDelegation(
            document.content,
            "automation.project-knowledge",
            (summary) => summary.replace(/\]\([^)]+\)/g, "]")
          )
        }
      : document
  ));
  assert.ok(
    missingKnowledgeLink.delegationViolations.some((violation) =>
      violation.includes("automation.project-knowledge")
      && violation.includes("must link")
    )
  );

  const duplicatedKnowledgeRule = inspectRuleResponsibilities(documents.map((document) =>
    document === report
      ? { ...document, content: `${document.content}\n同一项目与适用范围的新经验必须原位覆盖旧经验。\n` }
      : document
  ));
  assert.ok(
    duplicatedKnowledgeRule.delegationViolations.some((violation) =>
      violation.includes("duplicates delegated rule details for automation.project-knowledge")
    )
  );

  const inflated = inspectRuleResponsibilities(documents.map((document) =>
    document === automation
      ? {
          ...document,
          content: mutateDelegation(
            document.content,
            "automation.testcases",
            (summary) => `${summary}${"x".repeat(601)}`
          )
        }
      : document
  ));
  assert.ok(
    inflated.delegationViolations.some((violation) =>
      violation.includes("exceeds one paragraph")
    )
  );

  const nestedHeading = inspectRuleResponsibilities(documents.map((document) =>
    document === automation
      ? {
          ...document,
          content: mutateDelegation(
            document.content,
            "automation.testcases",
            (summary) => `${summary}\n#### expanded rules\n`
          )
        }
      : document
  ));
  assert.ok(
    nestedHeading.delegationViolations.some((violation) =>
      violation.includes("contains a heading")
    )
  );

  const missingRole = inspectRuleResponsibilities(documents, supportingDocuments.map((document) =>
    document.path === "skills/iot-automation-testing/SKILL.md"
      ? { ...document, content: document.content.replace("<!-- role: orchestration-only -->", "") }
      : document
  ));
  assert.ok(
    missingRole.supportingViolations.some((violation) =>
      violation.includes("missing role marker orchestration-only")
    )
  );

  const missingSkillOwnerLink = inspectRuleResponsibilities(
    documents,
    supportingDocuments.map((document) =>
      document.path === "skills/iot-automation-testing/SKILL.md"
        ? {
            ...document,
            content: document.content.replaceAll(
              "../../docs/testing/testcase-guideline.md",
              "../../docs/testing/missing.md"
            )
          }
        : document
    )
  );
  assert.ok(
    missingSkillOwnerLink.supportingViolations.some((violation) =>
      violation.includes("must link delegated owner automation.testcases")
    )
  );

  const duplicatedSkillFormatRule = inspectRuleResponsibilities(
    documents,
    supportingDocuments.map((document) =>
      document.path === "skills/iot-automation-testing/SKILL.md"
        ? {
            ...document,
            content: `${document.content}\n顶部五列快速索引和折叠详情使用五列执行表。\n`
          }
        : document
    )
  );
  assert.ok(
    duplicatedSkillFormatRule.supportingViolations.some((violation) =>
      violation.includes("duplicates delegated testcase layered display contract")
    )
  );

  const duplicatedRootCommandCatalog = inspectRuleResponsibilities(
    documents,
    supportingDocuments.map((document) =>
      document.path === "README.md"
        ? { ...document, content: `${document.content}\n## 常用操作\n\nnpm run task:status\n` }
        : document
    )
  );
  assert.ok(
    duplicatedRootCommandCatalog.supportingViolations.some((violation) =>
      violation.includes("project-entry-only forbids embedded command catalog")
    )
  );

  const paraphrasedHistoryContract = inspectRuleResponsibilities(
    documents,
    supportingDocuments.map((document) =>
      document.path === "testcases/README.md"
        ? {
            ...document,
            content: `${document.content}\nworkflow-history.ndjson 保存等待、重试和恢复。\n`
          }
        : document
    )
  );
  assert.ok(
    paraphrasedHistoryContract.supportingViolations.some((violation) =>
      violation.includes("directory-index-only forbids request workflow fact contract")
    )
  );

  const paraphrasedPlanContract = inspectRuleResponsibilities(
    documents,
    supportingDocuments.map((document) =>
      document.path === "testcases/README.md"
        ? { ...document, content: `${document.content}\nplan.md 记录 RULE 和评审决定。\n` }
        : document
    )
  );
  assert.ok(
    paraphrasedPlanContract.supportingViolations.some((violation) =>
      violation.includes("directory-index-only forbids request plan fact contract")
    )
  );

  const duplicateTemplateSection = inspectRuleResponsibilities(
    documents,
    supportingDocuments.map((document) =>
      document.path === "skills/iot-automation-testing/templates/test-plan.template.md"
        ? { ...document, content: `${document.content}\n## 规则设计矩阵\n` }
        : document
    )
  );
  assert.ok(
    duplicateTemplateSection.supportingViolations.some((violation) =>
      violation.includes("forbidden duplicate section 规则设计矩阵")
    )
  );
});

test("proprietary contract identifiers have one version registry", () => {
  const current = inspectContractRegistry(contractRegistry, [{
    path: "sample.ts",
    content: 'const schema = "candidate-gate-v1"; const authorization = "execution-authorization-v1";'
  }]);
  assert.deepEqual(current.violations, []);
  assert.ok(current.activeIds.includes("testcase-review-export-v1"));
  assert.ok(current.activeIds.includes("formal-execution-manifest-v1"));
  assert.ok(current.activeIds.includes("execution-authorization-v1"));
  assert.deepEqual(current.retiredIds, []);

  const unknown = inspectContractRegistry(contractRegistry, [{
    path: "sample.ts",
    content: 'const schema = "unregistered-contract-v1";'
  }]);
  assert.ok(unknown.violations.some((violation) =>
    violation.includes("unregistered contract identifier unregistered-contract-v1")
  ));
});

test("public task commands are an exact allowlist", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};

  assert.deepEqual(inspectPublicTaskCommands(scripts), {
    mismatches: [],
    unexpected: []
  });
  assert.deepEqual(
    Object.keys(PUBLIC_TASK_COMMANDS).sort(),
    ["task:gate", "task:initialize", "task:manage", "task:resume", "task:status"]
  );

  assert.deepEqual(
    inspectPublicTaskCommands({
      ...scripts,
      "task:gate": "tsx scripts/other-gate.ts"
    }).mismatches,
    ["task:gate must be tsx src/support/task-workflow/cli/gate.ts"]
  );
});

test("current lifecycle exposes one design confirmation and risk-adaptive execution authorization", () => {
  lineContainingAll(
    automationGuideline,
    [
      "v1 固定只有一次用例确认",
      "`policy_auto_no_write_v1`",
      "自动授权",
      "执行清单确认"
    ],
    "risk-adaptive v1 confirmation lifecycle"
  );
  lineContainingAll(
    automationGuideline,
    [
      "`case-confirmation-subject-v1`",
      "有序 `caseIds`",
      "全局边界",
      "关联 `REQ/RULE`",
      "最新评审摘要"
    ],
    "case confirmation projection"
  );
  lineContainingAll(
    automationGuideline,
    [
      "`revision_requested`",
      "full 分支",
      "affected 分支",
      "重新校验",
      "生成 subject"
    ],
    "revision regeneration"
  );
  lineContainingAll(
    testcaseGuideline,
    [
      "顶层测试范围",
      "用户明确排除项"
    ],
    "top-level test scope boundary"
  );
  assert.match(skill, /设计、用例和评审：\[testcase-guideline\.md\]/);
  assert.match(
    automationGuideline,
    /用例确认与执行授权保持独立 subject/
  );
  assert.doesNotMatch(testcaseGuideline, /`rejected` 仅供旧定义回放/);
  assert.doesNotMatch(
    planTemplate,
    /覆盖基准与拆分清单|独立覆盖矩阵|规则设计矩阵|规则邻域复核表|用例集评审汇总/
  );
  assert.doesNotMatch(
    testcaseTemplate,
    /自动化状态|是否需要人工确认|覆盖关联|评审与演进回链/
  );
});

test("current workflow selects and pins one delivery endpoint before initialization", () => {
  lineContainingAll(
    automationGuideline,
    [
      "`task:initialize -- --delivery-target",
      "definition",
      "`graphDigest`",
      "不在每一步后再询问"
    ],
    "delivery target lifecycle"
  );
  assert.match(skill, /`testcase_only \/ script_only \/ full_run`/);
  assert.match(skill, /--delivery-target <testcase_only\|script_only\|full_run>/);
});

test("complete automation requests adapt to optional host lifecycle capabilities", () => {
  const lifecyclePreflight = lineContainingAll(
    automationGuideline,
    ["稳定 `requestId`", "task:initialize", "task:resume", "宿主没有等价能力"],
    "lifecycle host capability preflight"
  );
  assert.match(lifecyclePreflight, /仍可启动或恢复仓库 workflow/);
  assert.match(lifecyclePreflight, /不得声称存在后台续跑保证/);

  assert.match(skill, /有同一 `runRequestId` history：运行 `task:resume`/);
  assert.match(skill, /生命周期和恢复：\[automation-guideline\.md\]/);
  lineContainingAll(
    automationGuideline,
    ["稳定 `requestId` 的最小解析", "接管预检", "最小必要信息"],
    "lifecycle requestId preflight exception"
  );
  lineContainingAll(
    skill,
    ["独立清理", "重置", "归档", "数据恢复", "不进入测试 workflow"],
    "Skill maintenance versus workflow recovery"
  );

  for (const [name, document] of [["lifecycle", automationGuideline]] as const) {
    const shortTaskRule = lineContainingAll(
      document,
      ["状态查询", "只读诊断", "规则或代码维护", "清理", "重置", "归档", "恢复", "宿主长期任务"],
      `${name} short-task exclusion`
    );
    assert.match(shortTaskRule, /不创建宿主长期任务/);
    const conflictRule = lineContainingAll(
      document,
      ["同一", "复用", "不同", "替换", "清除", "改写", "最小"],
      `${name} active host-task conflict rule`
    );
    assert.match(conflictRule, /不得(?:静默)?替换、清除或改写/);
  }

  for (const document of [agents, automationGuideline, skill]) {
    assert.doesNotMatch(document, /get_goal|create_goal|update_goal|\/goal/);
  }
});

test("current build/readiness risk-grades script review without extra callbacks or activities", () => {
  lineContainingAll(
    automationGuideline,
    [
      "用例阶段与脚本阶段分别评级",
      "`light`",
      "`standard`",
      "`strict`",
      "只升级不降级"
    ],
    "script review stage risk policy"
  );
  lineContainingAll(
    automationGuideline,
    [
      "风险分级只调整自动评审强度",
      "不增加用户 callback",
      "v1",
      "用例确认",
      "不可变执行清单确认"
    ],
    "fixed callback count"
  );
  assert.match(skill, /`script_quality`[\s\S]*`execution_safety`/);
  assert.match(
    taskManage,
    /command === "script-review-assess"/
  );
  assert.match(
    taskManage,
    /command === "execution-readiness-publish"/
  );
  assert.match(
    taskManage,
    /return assessScriptReview\(/
  );
  assert.match(
    taskManage,
    /scriptReviewVerification\([\s\S]*assessment: scriptAssessment[\s\S]*evidence: reviewEvidence/
  );
  assert.match(
    workflowDefinition,
    /id: "build"[\s\S]*scriptReviewPolicyVersion: "script-review-policy-v1"[\s\S]*id: "readiness"[\s\S]*readinessPolicyVersion: "execution-readiness-v1"/
  );
  assert.match(workflowDefinition, /id: "script-review-quality"/);
  assert.match(workflowDefinition, /id: "script-review-safety"/);
  assert.match(workflowDefinition, /id: "script-review"/);
});

test("current case review keeps its bounded policy in the lifecycle implementation", () => {
  lineContainingAll(
    automationGuideline,
    ["`deterministic_only`", "不创建 reviewer 事件", "适用角色", "只由[用例规范]"],
    "lifecycle deterministic light review"
  );
  assert.match(reviewPolicy, /schemaVersion: "review-policy-v1"/);
  assert.match(reviewPolicy, /maxConcurrentReviewers: 2/);
  assert.match(reviewPolicy, /maxSemanticEvolutionCycles: 2/);
  assert.match(caseReviewRisk, /CASE_REVIEW_RISK_SCHEMA_VERSION = "case-review-risk-v1"/);
  assert.match(reviewBatchScope, /REVIEW_BATCH_SCOPE_SCHEMA_VERSION = "review-batch-scope-v1"/);
  assert.match(reviewInputSnapshot, /REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION = "review-input-snapshot-v1"/);
  assert.match(
    workflowDefinition,
    /reviewIds\.length \? reviewIds : \["completeness-validation"\]/
  );
});

test("current build delivers substantive candidates while readiness owns runtime availability", () => {
  lineContainingAll(
    automationGuideline,
    ["`build`", "完整、可审查", "`readiness`", "runnable/deferred"],
    "build and readiness separation"
  );
  lineContainingAll(
    automationGuideline,
    ["`runtime_validation_pending`", "`reachableBoundary`", "`pendingCapabilityIds`"],
    "runtime-pending candidate contract"
  );
  assert.match(formalExecutionTypes, /requiredOperations\?: ExecutionOperationKind\[\]/);
  assert.match(formalExecutionTypes, /operationBudgets\?: Array/);
  assert.match(formalExecutionTypes, /requiredTestAssetIds\?: string\[\]/);
  assert.match(formalExecutionTypes, /"test_asset"/);
  assert.match(formalExecutionTypes, /dataWritePolicy\?: FormalDataWritePolicy/);
  assert.match(formalExecutionTypes, /status: "source_complete" \| "runtime_validation_pending"/);
  assert.match(formalExecutionTypes, /useCapability<T = unknown>\(capabilityId: string\)/);
  assert.match(capabilityProvider, /async use<T = unknown>\(/);
  assert.match(formalSourceGate, /blockForMissingContracts/);
  assert.match(formalSourceGate, /has an empty formalCase implementation/);
  assert.match(formalSourceGate, /has no business action or assertion/);
  for (const field of [
    "requiredOperations",
    "operationBudgets",
    "requiredTestAssetIds",
    "test_asset",
    "dataWritePolicy",
    "implementation"
  ]) {
    assert.match(formalManifestTemplate, new RegExp(field));
  }
});

test("formal execution derives topological waves only from named resources", () => {
  lineContainingAll(
    automationGuideline,
    ["`producesResources → requiredResources`", "有向无环图", "`scheduledCaseIds`", "`executionWaves`", "`graphDigest`"],
    "dependency graph readiness contract"
  );
  lineContainingAll(
    environmentGuideline,
    ["`新增 → 查询 → 修改 → 删除`", "命名资源", "专用一次性资源"],
    "CRUD resource ordering"
  );
  assert.match(dependencyPlan, /buildExecutionDependencyPlan/);
  assert.match(dependencyPlan, /contains a cycle/);
  assert.match(formalExecutionTypes, /publishResource\(/);
  assert.match(formalExecutionTypes, /consumeResource\(/);
  assert.doesNotMatch(formalExecutionTypes, /dependsOnCaseIds/);
  assert.match(executionScheduler, /selectNextExecutionWave/);
  assert.match(formalWebRunner, /PLAYWRIGHT_AUTHORIZED_CASE_IDS: nextCaseIds\.join/);
  assert.match(formalWebRunner, /decision\.waitingTransitionIds/);
});

test("formal page reuse is wave-scoped, no-write only and failure-honest", () => {
  assert.match(formalExecutionTypes, /FormalPageSessionGroupDefinition/);
  assert.match(formalExecutionTypes, /"preserve_unrelated_fields"/);
  assert.match(pageSessionGroups, /pageSessionGroupsRequireSingleWorker/);
  assert.match(formalWebFixture, /formalSessionPool: \[async/);
  assert.match(formalWebFixture, /scope: "worker"/);
  assert.match(formalWebFixture, /group\.resetStrategy !== "new_context_per_case"/);
  assert.match(
    formalWebRunner,
    /pageSessionGroupsRequireSingleWorker\(manifest, nextCaseIds\)/
  );
  assert.doesNotMatch(
    formalWebRunner,
    /pageSessionGroupsRequireSingleWorker\(manifest, snapshot\.caseIds\)/
  );
  lineContainingAll(
    environmentGuideline,
    ["同一拓扑波次", "重新建立页面", "当前波次"],
    "wave-scoped page reuse"
  );
  lineContainingAll(
    environmentGuideline,
    ["Playwright", "重启 worker", "失败现场不承诺长期保留"],
    "page reuse failure recovery"
  );
});

test("formal execution entrypoints load the same local environment as readiness", () => {
  assert.match(formalRunner, /^import "dotenv\/config";/);
  assert.match(formalWebRunner, /^import "dotenv\/config";/);
});

test("web selector evidence uses optional read-only page candidates before source and Playwright verification", () => {
  lineContainingAll(
    automationGuideline,
    ["只读真实页面候选探索", "源码契约补齐", "自动无头 selector 验证", "可见 Inspector 兜底"],
    "runtime-first engineering flow"
  );
  lineContainingAll(
    selectorGuideline,
    ["Chrome DevTools MCP", "accessibility snapshot", "fallback", "deferred/invalid"],
    "optional read-only page candidate exploration"
  );
  lineContainingAll(
    selectorGuideline,
    [
      "`source_verified`",
      "业务容器",
      "accessible name",
      "iframe",
      "Shadow DOM",
      "Portal",
      "国际化",
      "权限"
    ],
    "source sufficiency contract"
  );
  lineContainingAll(
    selectorGuideline,
    ["`source_verified`", "test:web:verify-selectors", "`runtime_verified`"],
    "headless selector verification"
  );
  lineContainingAll(
    selectorGuideline,
    ["目标构建摘要", "路由/页面状态", "selector contract", "locale", "role"],
    "selector evidence cache identity"
  );
  lineContainingAll(
    selectorGuideline,
    ["单纯存在页面状态迁移", "不能触发可见 Inspector"],
    "state transition is not an inspector trigger"
  );
  lineContainingAll(
    selectorGuideline,
    ["真实页面候选和源码契约仍无法收敛", "多匹配", "源码与目标环境运行时不一致", "动态语义"],
    "visible inspector fallback conditions"
  );
  lineContainingAll(
    environmentGuideline,
    ["网络 guard", "防御措施", "无头验证", "`trial`"],
    "zero-write defense in depth"
  );
  lineContainingAll(
    selectorGuideline,
    ["`runtime_validation_pending`", "`reachableBoundary`", "正式执行"],
    "write-boundary pending validation"
  );
  assert.match(selectorVerificationTemplate, /click\(\{ trial: true \}\)/);
  assert.match(selectorVerificationTemplate, /webAutomationFixture/);
  for (const key of [
    "targetBuildDigest",
    "routeState",
    "selectorContractDigest",
    "locale",
    "role"
  ]) {
    assert.match(selectorEvidenceCache, new RegExp(key));
  }
  assert.match(workflowDefinition, /selectorEvidencePolicy: "mcp_candidate_playwright_verified"/);
  assert.match(workflowDefinition, /adapter: "chrome_devtools_mcp"/);
  assert.match(workflowDefinition, /headlessSelectorVerification: "required_for_runtime_verified"/);
  assert.match(workflowDefinition, /visibleExploration: "playwright_guarded_fallback"/);
  assert.doesNotMatch(
    workflowDefinition,
    /inspectorTriggers:\s*\[[^\]]*"state_transition"/
  );
  assert.doesNotMatch(
    workflowDefinition,
    /id: "(?:selector-verification|visible-exploration)"/
  );
});

test("optional host lifecycle follows workflow gate without replacing it", () => {
  const objective = fencedBlockAfter(
    automationGuideline,
    "创建宿主长期任务时使用以下 objective 结构"
  );
  for (const objectiveElement of [
    "完成自动化测试请求 <type/project/request>",
    "隔离评审与自动演进",
    "生产环境、业务数据写入、设备动作、安全挑战、凭据和审批边界",
    "仅在有效人工 callback、审批、安全挑战、业务裁决或真实 blocker",
    "workflowState=SUCCEEDED",
    "task:gate -- --request <type/project/request> --assert-safe-reply"
  ]) {
    assert.ok(
      objective.includes(objectiveElement),
      `host objective must include: ${objectiveElement}`
    );
  }

  lineContainingAll(
    automationGuideline,
    ["| `continue_now`", "reviewer 派发/重试", "宿主任务保持活动并立即继续"],
    "continue_now host action"
  );
  lineContainingAll(
    automationGuideline,
    ["| `await_event` 或 `wait_until`", "墙钟时长", "不得据此中断 reviewer", "发送最终回复"],
    "await_event host action"
  );
  lineContainingAll(
    automationGuideline,
    ["| `WAITING_HUMAN`", "只暂停宿主长期任务", "callback 解析后恢复同一请求"],
    "WAITING_HUMAN host action"
  );
  lineContainingAll(
    automationGuideline,
    ["| workflow `BLOCKED`", "task:manage blocker-resolve", "不把 workflow blocker 等同于宿主任务终态"],
    "BLOCKED host action"
  );
  lineContainingAll(
    automationGuideline,
    ["| `SUCCEEDED`", "task:gate --assert-safe-reply", "宿主支持时", "标记为完成", "产品测试结果为 `failed`、`mixed` 或 `inconclusive`"],
    "product outcome versus workflow success"
  );
  lineContainingAll(
    automationGuideline,
    ["| workflow `BLOCKED` / blocker 或失败 Activity", "task:manage activity-retry", "同一 request 恢复", "不把 workflow blocker 等同于宿主任务终态"],
    "failed activity host action"
  );
  lineContainingAll(
    automationGuideline,
    ["| workflow `CANCELLED`", "不伪装为完成或阻塞", "由用户控制"],
    "CANCELLED host action"
  );
  assert.match(skill, /`continue_now` 在当前回合继续，`await_event` 等待已登记事件/);
});

test("host lifecycle remains external and unavailable capability degrades honestly", () => {
  assert.match(
    automationGuideline,
    /宿主长期任务能力缺失或调用失败时[\s\S]*不得声称能力已启用[\s\S]*显式 `task:resume` 推进/
  );
  assert.match(docsIndex, /v1 复用分支与生命周期（含交付目标首轮确认）、Activity、callback、恢复、Gate/);

  for (const [name, document] of [
    ["AGENTS", agents],
    ["lifecycle", automationGuideline]
  ] as const) {
    const persistenceRule = lineContainingAll(
      document,
      ["宿主长期任务", "ID", "状态", "预算", "使用记录", "runtime", "history", "plan.md"],
      `${name} host lifecycle persistence boundary`
    );
    assert.match(persistenceRule, /不(?:得)?写入/);
    assert.match(persistenceRule, /只属于(?:对应)?宿主/);
  }
  assert.doesNotMatch(
    readTypeScriptTree("src/support/task-workflow"),
    goalIdentifierPattern
  );
});

test("core rules and session binding are provider-neutral", () => {
  for (const document of [agents, automationGuideline, docsIndex, skill]) {
    assert.doesNotMatch(document, /Codex|CODEX_|\.codex/);
  }

  const genericSession = taskManage.indexOf("process.env.TEST_WORKFLOW_HOST_SESSION_ID");
  assert.ok(genericSession >= 0, "generic host session environment variable must exist");
  assert.doesNotMatch(taskManage, /CODEX_THREAD_ID/);
  assert.doesNotMatch(taskManage, /TEST_WORKFLOW_HOST_CONTEXT_ID|--thread/);
});

test("Harness lifecycle adapter is a thin session-to-gate adapter", () => {
  const configuredCommand = hookConfig.hooks?.Stop?.[0]?.hooks?.[0]?.command ?? "";
  assert.match(configuredCommand, /scripts\/harness-stop-stage-envelope\.mjs/);
  assert.match(hook, /src\/support\/task-workflow\/cli\/gate\.ts/);
  assert.match(hook, /"--host-continuation"/);
  assert.match(hook, /"--host-continuation-active"/);
  assert.match(hook, /process\.execPath/);
  assert.match(hook, /node_modules\/tsx\/dist\/loader\.mjs/);
  assert.match(hook, /sessionBinding\?\.sessionId/);
  assert.match(hook, /\.local\/test-task-runtime/);
  assert.doesNotMatch(hook, /node_modules\/\.bin\/tsx/);
  assert.doesNotMatch(hook, /src\/support\/task-state/);
  assert.doesNotMatch(hook, hookSchedulingPattern);
  assert.doesNotMatch(hookConfigText, hookSchedulingPattern);
  assert.doesNotMatch(hook, /WorkflowSuspended|task:manage/);
  assert.doesNotMatch(hook, goalIdentifierPattern);
  assert.doesNotMatch(hookConfigText, goalIdentifierPattern);
});

test("Stop Hook forwards gate output without interpreting workflow fields", () => {
  const expected = {
    decision: "block",
    reason: "continue the ready activity"
  };
  const harness = createStopHookHarness({ gateOutput: expected, gateExitCode: 2 });
  try {
    assert.deepEqual(harness.runHook({ session_id: "session-test" }), expected);
    assert.deepEqual(harness.gateArgs(), [
      "--request",
      "web/project/request",
      "--json",
      "--host-continuation",
      "--host-continuation-active",
      "false"
    ]);
  } finally {
    harness.cleanup();
  }
});

test("Stop Hook delegates recursive invocations to gate with the active flag", () => {
  const expected = {
    continue: false,
    stopReason: "continuation already used"
  };
  const harness = createStopHookHarness({ gateOutput: expected });
  try {
    assert.deepEqual(
      harness.runHook({ session_id: "session-test", stop_hook_active: true }),
      expected
    );
    assert.equal(harness.gateArgs().at(-1), "true");
  } finally {
    harness.cleanup();
  }
});

test("Stop Hook ignores deleted or unrelated disposable bindings", () => {
  const harness = createStopHookHarness();
  try {
    const historyBefore = readFileSync(harness.historyPath, "utf8");
    rmSync(harness.runtimePath);
    assert.match(
      String(harness.runHook({ session_id: "session-test" }).systemMessage),
      /no matching disposable request binding; no continuation was requested and workflow history was not changed/
    );
    assert.equal(readFileSync(harness.historyPath, "utf8"), historyBefore);
  } finally {
    harness.cleanup();
  }
});

test("Harness lifecycle adapter ignores unsupported runtime bindings and does not call gate", () => {
  const harness = createStopHookHarness({
    runtimeOverrides: { schemaVersion: "unsupported-version" }
  });
  try {
    assert.match(
      String(harness.runHook({ session_id: "session-test" }).systemMessage),
      /no matching disposable request binding; no continuation was requested and workflow history was not changed/
    );
    assert.equal(harness.gateWasCalled(), false);
    assert.equal(readFileSync(harness.historyPath, "utf8"), "{\"seq\":1,\"type\":\"WorkflowStarted\"}\n");
  } finally {
    harness.cleanup();
  }
});

test("Stop Hook refuses continuation when gate output is unavailable or malformed", () => {
  for (const options of [
    { gateOutput: "", gateExitCode: 1 },
    { gateOutput: "not-json", gateExitCode: 0 }
  ]) {
    const harness = createStopHookHarness(options);
    try {
      const runtimeBefore = readFileSync(harness.runtimePath, "utf8");
      const historyBefore = readFileSync(harness.historyPath, "utf8");
      const result = harness.runHook({ session_id: "session-test" });
      assert.equal(result.continue, false);
      assert.match(String(result.stopReason), /Workflow gate.*no continuation was requested and workflow history was not changed/);
      assert.equal(readFileSync(harness.runtimePath, "utf8"), runtimeBefore);
      assert.equal(readFileSync(harness.historyPath, "utf8"), historyBefore);
    } finally {
      harness.cleanup();
    }
  }
});

test("Harness lifecycle adapter does not promise continuation without a session id", () => {
  const harness = createStopHookHarness();
  try {
    const before = readFileSync(harness.runtimePath, "utf8");
    const historyBefore = readFileSync(harness.historyPath, "utf8");
    const result = harness.runHook({});
    assert.match(String(result.systemMessage), /no continuation was requested and workflow history was not changed/);
    assert.equal(readFileSync(harness.runtimePath, "utf8"), before);
    assert.equal(readFileSync(harness.historyPath, "utf8"), historyBefore);
  } finally {
    harness.cleanup();
  }
});

test("Harness lifecycle adapter reports malformed input without changing workflow history", () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), "stop-gate-invalid-input-"));
  try {
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: sandbox,
      input: "{",
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /could not parse its Harness input/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
