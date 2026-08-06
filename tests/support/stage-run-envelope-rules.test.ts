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
  inspectRuleResponsibilities,
  RULE_OWNER_PATHS
} from "../../scripts/rule-responsibility-contract.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const agents = read("AGENTS.md");
const automationGuideline = read("docs/testing/automation-guideline.md");
const environmentGuideline = read("docs/testing/environment-guideline.md");
const selectorGuideline = read("docs/testing/selector-guideline.md");
const testcaseGuideline = read("docs/testing/testcase-guideline.md");
const docsIndex = read("docs/testing/README.md");
const skill = read("skills/iot-automation-testing/SKILL.md");
const taskManage = read("src/support/task-workflow/cli/manage.ts");
const workflowDefinition = read("src/support/task-workflow/definition.ts");
const reviewPolicy = read("src/support/task-workflow/reviewPolicy.ts");
const caseReviewRisk = read("src/support/task-workflow/caseReviewRisk.ts");
const reviewBatchScope = read("src/support/task-workflow/reviewBatchScope.ts");
const reviewInputSnapshot = read("src/support/task-workflow/reviewInputSnapshot.ts");
const planTemplate = read("skills/iot-automation-testing/templates/test-plan.template.md");
const selectorVerificationTemplate = read(
  "skills/iot-automation-testing/templates/playwright-selector-verification.spec.template.ts"
);
const selectorEvidenceCache = read("src/support/web/selectorEvidenceCache.ts");
const formalExecutionTypes = read("src/support/formal-execution/types.ts");
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
const hook = read("scripts/codex-stop-stage-envelope.mjs");
const hookPath = resolve(root, "scripts/codex-stop-stage-envelope.mjs");
const hookConfigText = read(".codex/hooks.json");
const hookConfig = JSON.parse(hookConfigText) as {
  hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
};
const goalIdentifierPattern = /goal/i;
const hookSchedulingPattern =
  /\b(?:heartbeat|wake)\b|automationId|workflowState|checkpoint\?\.safe/;

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
    schemaVersion: "test-workflow-runtime-v2",
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

test("workflow responsibility markers have exactly one owner", () => {
  const documents = Object.values(RULE_OWNER_PATHS).map((path) => ({
    path,
    content: read(path)
  }));
  const current = inspectRuleResponsibilities(documents);
  assert.deepEqual(current, {
    ownerViolations: [],
    delegationViolations: []
  });

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
      "task:legacy": "tsx src/support/task-state/legacy.ts"
    }).unexpected,
    ["task:legacy"]
  );
  assert.deepEqual(
    inspectPublicTaskCommands({
      ...scripts,
      "task:gate": "tsx scripts/other-gate.ts"
    }).mismatches,
    ["task:gate must be tsx src/support/task-workflow/cli/gate.ts"]
  );
});

test("confirmation lifecycle keeps plan acceptance stable through automatic case evolution", () => {
  lineContainingAll(
    automationGuideline,
    [
      "顶层阶段固定为",
      "一次计划确认 callback",
      "证据驱动演进与复审，直至收敛",
      "一次用例确认 callback",
      "一次不可变执行清单 callback",
      "报告"
    ],
    "fixed three-confirmation lifecycle"
  );
  lineContainingAll(
    agents,
    [
      "计划确认一旦 `accepted`",
      "顶层业务范围",
      "自动演进与复审",
      "不得单独触发重复计划确认"
    ],
    "AGENTS stable plan confirmation"
  );
  lineContainingAll(
    automationGuideline,
    [
      "`plan-confirmation-subject-v2`",
      "`plan.md` 文件 digest 分离",
      "顶层包含/排除业务流程",
      "数据策略",
      "权限上限"
    ],
    "plan confirmation projection"
  );
  lineContainingAll(
    automationGuideline,
    [
      "删除无依据断言",
      "拆分原子用例",
      "不得失效计划确认",
      "需要修订计划"
    ],
    "automatic evolution versus material plan revision"
  );
  lineContainingAll(
    testcaseGuideline,
    [
      "测试范围",
      "只写",
      "顶层业务流程",
      "字段规则",
      "`caseId`"
    ],
    "top-level test scope boundary"
  );
  lineContainingAll(
    skill,
    [
      "`case-review-resolution`",
      "reviewer 正式结论和发现项",
      "`case-review-evolution`",
      "修改草案"
    ],
    "review activity ownership"
  );
  assert.match(
    automationGuideline,
    /`case-review-resolution` 只登记 reviewer 正式结论和发现项[\s\S]*`case-review-evolution`[\s\S]*自动修订/
  );
  assert.match(
    automationGuideline,
    /用例确认与执行授权保持独立 subject/
  );
  assert.match(
    automationGuideline,
    /`PlanConfirmationCarriedForward`[\s\S]*不得伪造 `CallbackResolved`[\s\S]*重复 resume 必须幂等/
  );
  assert.doesNotMatch(
    planTemplate,
    /计划确认边界|plan-confirmation-subject-v2/
  );
});

test("complete automation requests adapt to optional host lifecycle capabilities", () => {
  const agentsPreflight = lineContainingAll(
    agents,
    ["完整自动化测试请求", "task:initialize", "task:resume", "宿主提供跨回合长期任务能力"],
    "AGENTS host lifecycle preflight"
  );
  assert.match(agentsPreflight, /创建或复用绑定同一 `requestId` 的宿主任务/);
  assert.match(agentsPreflight, /宿主没有等价能力时仍以 workflow history 继续/);

  const lifecyclePreflight = lineContainingAll(
    automationGuideline,
    ["稳定 `requestId`", "task:initialize", "task:resume", "宿主没有等价能力"],
    "lifecycle host capability preflight"
  );
  assert.match(lifecyclePreflight, /仍可启动或恢复仓库 workflow/);
  assert.match(lifecyclePreflight, /不得声称存在后台续跑保证/);

  const skillPreflight = lineContainingAll(
    skill,
    ["完整自动化测试请求", "宿主提供长期任务能力", "同一 request ID"],
    "Skill host capability preflight"
  );
  assert.match(skillPreflight, /能力不可用或调用失败时继续依赖仓库 workflow/);
  lineContainingAll(
    agents,
    ["接管预检", "稳定 `requestId` 的最小解析", "最小必要信息"],
    "AGENTS requestId preflight exception"
  );
  lineContainingAll(
    automationGuideline,
    ["稳定 `requestId` 的最小解析", "接管预检", "最小必要信息"],
    "lifecycle requestId preflight exception"
  );
  lineContainingAll(
    skill,
    ["独立本机维护", "清理", "重置", "归档", "测试数据恢复", "恢复完整测试 workflow 不属于"],
    "Skill maintenance versus workflow recovery"
  );

  for (const [name, document] of [
    ["AGENTS", agents],
    ["lifecycle", automationGuideline],
    ["Skill", skill]
  ] as const) {
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

test("v5 build/readiness risk-grades script review without extra callbacks or activities", () => {
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
      "计划",
      "用例集",
      "不可变执行清单",
      "确认一次"
    ],
    "fixed callback count"
  );
  lineContainingAll(skill, ["`light`", "不派模型 reviewer"], "Skill light script review");
  lineContainingAll(skill, ["`standard`", "`script_quality`"], "Skill standard script review");
  lineContainingAll(
    skill,
    ["`strict`", "`script_quality`", "`execution_safety`"],
    "Skill strict script review"
  );
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
    /validateScriptReviewEvidenceFiles[\s\S]*scriptReviewVerification/
  );
  assert.match(
    workflowDefinition,
    /id: "build"[\s\S]*scriptReviewPolicyVersion: "script-review-policy-v3"[\s\S]*id: "readiness"[\s\S]*readinessPolicyVersion: "execution-readiness-v1"/
  );
  assert.doesNotMatch(
    workflowDefinition,
    /id: "script-review(?:-(?:quality|safety|resolution))?"/
  );
});

test("v5 case review uses deterministic light and at most two isolated model roles", () => {
  lineContainingAll(
    automationGuideline,
    ["`deterministic_only`", "`combined`", "`combined_with_impact`"],
    "case review tier modes"
  );
  lineContainingAll(
    automationGuideline,
    ["最多同时运行 2 个", "最多 2 轮语义演进"],
    "case review bounded concurrency and evolution"
  );
  lineContainingAll(
    skill,
    ["`light`", "不启动子 Agent", "不提交伪造 reviewer 事件"],
    "Skill deterministic light review"
  );
  assert.match(reviewPolicy, /schemaVersion: "review-policy-v2"/);
  assert.match(reviewPolicy, /maxConcurrentReviewers: 2/);
  assert.match(reviewPolicy, /maxSemanticEvolutionCycles: 2/);
  assert.match(caseReviewRisk, /CASE_REVIEW_RISK_SCHEMA_VERSION = "case-review-risk-v2"/);
  assert.match(reviewBatchScope, /REVIEW_BATCH_SCOPE_V3_SCHEMA_VERSION = "review-batch-scope-v3"/);
  assert.match(reviewInputSnapshot, /REVIEW_INPUT_SNAPSHOT_V2_SCHEMA_VERSION = "review-input-snapshot-v2"/);
  assert.match(
    workflowDefinition,
    /reviewIds\.length \? reviewIds : \["completeness-validation"\]/
  );
});

test("v5 build delivers substantive candidates while readiness owns runtime availability", () => {
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
  lineContainingAll(
    skill,
    ["`script_quality`", "固定阻断", "`changes_required`"],
    "script quality fixed-blocker rejection"
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
    skill,
    ["生产者可启动", "`scheduledCaseIds`", "deferred", "`graphDigest`"],
    "Skill dependency graph readiness"
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
  lineContainingAll(
    skill,
    ["同一波次", "Playwright 重启 worker", "不承诺保留失败页面"],
    "Skill page reuse failure semantics"
  );
});

test("formal execution entrypoints load the same local environment as readiness", () => {
  assert.match(formalRunner, /^import "dotenv\/config";/);
  assert.match(formalWebRunner, /^import "dotenv\/config";/);
});

test("web selector evidence is source-first, headless-verified and visibly explored only as fallback", () => {
  lineContainingAll(
    automationGuideline,
    ["源码契约分析", "自动无头 selector 验证", "可见 Inspector 兜底"],
    "source-first engineering flow"
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
    ["源码契约无法收敛", "多匹配", "源码与目标环境运行时不一致", "动态语义"],
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
  assert.match(workflowDefinition, /selectorEvidencePolicy: "source_first_cached"/);
  assert.match(workflowDefinition, /headlessSelectorVerification: "cached_by_build_and_contract"/);
  assert.match(workflowDefinition, /visibleExploration: "fallback_only"/);
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
    ["| 不可恢复的 workflow `FAILED`", "不得标记完成", "宿主自己的阻塞语义", "不得用宿主状态改写 workflow history"],
    "FAILED host action"
  );
  lineContainingAll(
    automationGuideline,
    ["| workflow `CANCELLED`", "不伪装为完成或阻塞", "由用户控制"],
    "CANCELLED host action"
  );
  lineContainingAll(
    skill,
    ["`await_event`/`wait_until`", "等待窗口或墙钟时长本身不是 reviewer 失败依据", "task:manage blocker-resolve"],
    "Skill waiting and blocker recovery"
  );
});

test("host lifecycle remains external and unavailable capability degrades honestly", () => {
  assert.match(
    agents,
    /宿主长期任务能力不可用或调用失败不改变仓库工作流事实[\s\S]*显式 `task:resume` 恢复[\s\S]*不具备后台续跑保证/
  );
  assert.match(
    automationGuideline,
    /宿主长期任务能力缺失或调用失败时[\s\S]*不得声称能力已启用[\s\S]*显式 `task:resume` 推进/
  );
  assert.match(
    skill,
    /宿主能力缺失或调用失败时不得声称已启用[\s\S]*显式 `task:resume`/
  );
  assert.match(docsIndex, /宿主生命周期适配、停止事件适配边界/);

  for (const [name, document] of [
    ["AGENTS", agents],
    ["lifecycle", automationGuideline],
    ["Skill", skill]
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

test("core rules and session binding are provider-neutral with an explicit legacy fallback", () => {
  for (const document of [agents, automationGuideline, docsIndex, skill]) {
    assert.doesNotMatch(document, /Codex|CODEX_|\.codex/);
  }

  const genericSession = taskManage.indexOf("process.env.TEST_WORKFLOW_HOST_SESSION_ID");
  const legacySession = taskManage.indexOf("process.env.CODEX_THREAD_ID");
  assert.ok(genericSession >= 0, "generic host session environment variable must exist");
  assert.ok(legacySession > genericSession, "legacy provider session fallback must have lower priority");
  assert.match(taskManage, /process\.env\.TEST_WORKFLOW_HOST_CONTEXT_ID/);
});

test("Stop Hook is a thin session-to-gate adapter", () => {
  const configuredCommand = hookConfig.hooks?.Stop?.[0]?.hooks?.[0]?.command ?? "";
  assert.match(configuredCommand, /scripts\/codex-stop-stage-envelope\.mjs/);
  assert.match(hook, /src\/support\/task-workflow\/cli\/gate\.ts/);
  assert.match(hook, /"--hook"/);
  assert.match(hook, /"--stop-hook-active"/);
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
      "--hook",
      "--stop-hook-active",
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

test("Stop Hook ignores v1 runtime bindings and does not call gate", () => {
  const harness = createStopHookHarness({
    runtimeOverrides: { schemaVersion: "test-workflow-runtime-v1" }
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

test("Stop Hook does not promise continuation without a Codex session id", () => {
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

test("Stop Hook reports malformed input without changing workflow history", () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), "stop-gate-invalid-input-"));
  try {
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: sandbox,
      input: "{",
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /could not parse its Codex input/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
