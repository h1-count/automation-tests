import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  inspectPublicTaskCommands,
  PUBLIC_TASK_COMMANDS
} from "./public-task-command-contract.js";
import {
  inspectContractRegistry
} from "./contract-registry-contract.js";
import {
  inspectRootRuleBoundary,
  inspectRuleResponsibilities,
  RULE_OWNER_PATHS,
  SUPPORTING_DOCUMENT_ROLES
} from "./rule-responsibility-contract.js";

type CheckStatus = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
}

const projectRoot = resolve(import.meta.dirname, "..");
const results: CheckResult[] = [];

function record(status: CheckStatus, name: string, detail: string): void {
  results.push({ status, name, detail });
}

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function listFiles(directory: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      files.push(path);
    }
  }
  return files.sort();
}

function importSpecifiers(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const staticImports = [...source.matchAll(
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
  )].map((match) => match[1]!);
  const dynamicImports = [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => match[1]!);
  return [...staticImports, ...dynamicImports];
}

function checkResponsibilityOwnership(): void {
  const documents = listFiles(
    resolve(projectRoot, "docs/testing"),
    (path) => path.endsWith(".md")
  ).map((path) => ({
    path: relative(projectRoot, path).split(sep).join("/"),
    content: readFileSync(path, "utf8")
  }));
  const supportingDocuments = Object.keys(SUPPORTING_DOCUMENT_ROLES)
    .map((path) => ({ path, content: read(path) }));
  const inspection = inspectRuleResponsibilities(documents, supportingDocuments);
  const rootRuleViolations = inspectRootRuleBoundary(read("AGENTS.md"));

  record(
    inspection.ownerViolations.length === 0 ? "PASS" : "FAIL",
    "规范事实所有权",
    inspection.ownerViolations.length === 0
      ? `${Object.keys(RULE_OWNER_PATHS).length} 类规范责任在 docs/testing 全量 Markdown 中均有唯一 owner。`
      : inspection.ownerViolations.join("；")
  );
  record(
    inspection.delegationViolations.length === 0 ? "PASS" : "FAIL",
    "规范间职责委托",
    inspection.delegationViolations.length === 0
      ? "引用专项规则的规范均链接唯一 owner，并保持为无子标题的单段短委托。"
      : inspection.delegationViolations.join("；")
  );
  record(
    inspection.supportingViolations.length === 0 ? "PASS" : "FAIL",
    "入口文档、Skill 与模板职责边界",
    inspection.supportingViolations.length === 0
      ? "项目入口、命令索引、目录索引、Skill 与模板均符合声明角色，且未复制责任规范正文。"
      : inspection.supportingViolations.join("；")
  );
  record(
    rootRuleViolations.length === 0 ? "PASS" : "FAIL",
    "根规则职责边界",
    rootRuleViolations.length === 0
      ? "AGENTS.md 仅保留全局边界，并将流程与用例细节委托给唯一责任规范。"
      : rootRuleViolations.join("；")
  );
}

function checkContractRegistry(): void {
  const registryPath = "docs/testing/contract-registry.md";
  const scanRoots = ["docs/testing", "skills/iot-automation-testing", "scripts", "src/support"];
  const documents = [
    { path: "AGENTS.md", content: read("AGENTS.md") },
    { path: "README.md", content: read("README.md") },
    ...scanRoots.flatMap((root) => listFiles(
      resolve(projectRoot, root),
      (path) => /\.(?:md|ts|mjs)$/u.test(path)
    ).map((path) => ({
      path: relative(projectRoot, path).split(sep).join("/"),
      content: readFileSync(path, "utf8")
    })))
  ].filter((document) => document.path !== registryPath);
  const inspection = inspectContractRegistry(read(registryPath), documents);
  const violations = inspection.violations;
  record(
    violations.length === 0 ? "PASS" : "FAIL",
    "专有契约注册表",
    violations.length === 0
      ? `已登记 ${inspection.activeIds.length} 个当前标识和 ${inspection.retiredIds.length} 个入口拒绝的已退役标识；扫描范围无未登记契约。`
      : violations.join("；")
  );
}

function checkWorkflowFiles(): void {
  const required = [
    "src/support/task-workflow/types.ts",
    "src/support/task-workflow/historyStore.ts",
    "src/support/task-workflow/reducer.ts",
    "src/support/task-workflow/definition.ts",
    "src/support/task-workflow/reviewPolicy.ts",
    "src/support/task-workflow/runtimeLeaseStore.ts",
    "src/support/task-workflow/artifactPublisher.ts",
    "src/support/task-workflow/packageCompleteness.ts",
    "src/support/task-workflow/reviewInputSnapshot.ts",
    "src/support/task-workflow/callbackDecision.ts",
    "src/support/task-workflow/reviewLifecycle.ts",
    "src/support/task-workflow/resumeRecovery.ts",
    "src/support/task-workflow/workflowManager.ts",
    "src/support/task-workflow/cli/manage.ts",
    "src/support/task-workflow/cli/gate.ts",
    "src/support/task-workflow/cli/status.ts",
    "src/support/formal-execution/authorization.ts",
    "src/support/formal-execution/buildEvidenceIdentity.ts",
    "src/support/test-suite/stableSuite.ts",
    "src/support/test-suite/scriptAssets.ts",
    "scripts/manage-test-suite.ts"
  ];
  const forbidden = [
    "src/support/task-state",
    "src/support/task-workflow/legacyMigration.ts",
    "src/support/task-workflow/planProjection.ts",
    "tests/support/task-state",
    "tests/support/task-workflow/heartbeat-runtime.test.ts",
    "skills/iot-automation-testing/templates/thread-heartbeat.prompt.md",
    "archive/automation"
  ];
  const missing = required.filter((path) => !existsSync(resolve(projectRoot, path)));
  const retained = forbidden.filter((path) => existsSync(resolve(projectRoot, path)));

  record(
    missing.length === 0 ? "PASS" : "FAIL",
    "Durable Workflow 模块",
    missing.length === 0 ? "事件工作流、CLI 和执行授权模块完整。" : `缺少：${missing.join("、")}。`
  );
  record(
    retained.length === 0 ? "PASS" : "FAIL",
    "旧状态与调度实现退役",
    retained.length === 0 ? "旧状态引擎、迁移写入口、进度写回和周期调度文件均已移除。" : `仍存在：${retained.join("、")}。`
  );
}

function checkPublicCommands(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const { mismatches, unexpected } = inspectPublicTaskCommands(scripts);
  const oldTargets = Object.entries(scripts)
    .filter(([, command]) => command.includes("src/support/task-state/"))
    .map(([name]) => name);

  record(
    mismatches.length === 0 && unexpected.length === 0 ? "PASS" : "FAIL",
    "工作流公开命令",
    mismatches.length === 0 && unexpected.length === 0
      ? `公开 task:* 精确限定为 ${Object.keys(PUBLIC_TASK_COMMANDS).join("、")}。`
      : [
          mismatches.join("；"),
          unexpected.length > 0 ? `不允许的 task:* 命令：${unexpected.join("、")}` : ""
        ].filter(Boolean).join("；")
  );
  record(
    oldTargets.length === 0 ? "PASS" : "FAIL",
    "旧 CLI 目标",
    oldTargets.length === 0
      ? "package scripts 未指向旧状态入口。"
      : `旧目标=${oldTargets.join("、")}。`
  );
}

function checkImportBoundaries(): void {
  const codeFiles = [
    ...listFiles(resolve(projectRoot, "src"), (path) => /\.tsx?$/.test(path)),
    ...listFiles(resolve(projectRoot, "scripts"), (path) => /\.tsx?$/.test(path))
  ].filter((path) => !path.endsWith("check-test-architecture.ts"));
  const oldImports = codeFiles.flatMap((path) =>
    importSpecifiers(path)
      .filter((specifier) => /(?:^|\/)task-state(?:\/|$)/.test(specifier))
      .map((specifier) => `${relative(projectRoot, path)} -> ${specifier}`)
  );
  const workflowLayerViolations = listFiles(
    resolve(projectRoot, "src/support/task-workflow"),
    (path) => /\.tsx?$/.test(path)
  ).filter((path) => !relative(
    resolve(projectRoot, "src/support/task-workflow"),
    path
  ).startsWith(`cli${sep}`)).flatMap((path) =>
    importSpecifiers(path)
      .filter((specifier) => specifier.includes("../formal-execution") || specifier.includes("../task-state") || /(?:^|\/)scripts(?:\/|$)/.test(specifier))
      .map((specifier) => `${relative(projectRoot, path)} -> ${specifier}`)
  );

  record(
    oldImports.length === 0 ? "PASS" : "FAIL",
    "旧状态导入边界",
    oldImports.length === 0 ? "活跃源码未导入 src/support/task-state。" : oldImports.join("；")
  );
  record(
    workflowLayerViolations.length === 0 ? "PASS" : "FAIL",
    "工作流内核依赖方向",
    workflowLayerViolations.length === 0
      ? "工作流内核未反向依赖执行适配层或旧状态层。"
      : workflowLayerViolations.join("；")
  );
}

function checkOptionalHostAdapterConfiguration(): void {
  const hookPath = resolve(projectRoot, "scripts/harness-stop-stage-envelope.mjs");
  const configPath = resolve(projectRoot, ".codex/hooks.json");
  if (!existsSync(configPath) && !existsSync(hookPath)) {
    record("PASS", "可选宿主停止适配", "未启用宿主专属停止事件适配；仓库 workflow 仍可显式恢复。");
    return;
  }
  if (!existsSync(configPath) || !existsSync(hookPath)) {
    record("FAIL", "可选宿主停止适配", "宿主适配配置与脚本必须同时存在或同时省略。");
    return;
  }
  let commands: unknown[] = [];
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ type?: unknown; command?: unknown }> }> };
    };
    commands = (config.hooks?.Stop ?? []).flatMap((group) => group.hooks ?? []);
  } catch {
    record("FAIL", "可选宿主停止适配", "已启用的宿主适配配置不是有效 JSON。");
    return;
  }
  const stopCommands = commands.filter((entry): entry is { type: string; command: string } =>
    typeof (entry as { type?: unknown }).type === "string"
    && typeof (entry as { command?: unknown }).command === "string"
  );
  const valid = stopCommands.length === 1
    && stopCommands[0]!.type === "command"
    && stopCommands[0]!.command.includes("scripts/harness-stop-stage-envelope.mjs");
  record(
    valid ? "PASS" : "FAIL",
    "可选宿主停止适配",
    valid
      ? "已启用的宿主停止事件配置唯一且指向现存兼容脚本。"
      : "已启用的宿主停止事件配置必须包含唯一 command adapter，并指向现存兼容脚本。"
  );
}

function checkCurrentTestcaseFormatBoundary(): void {
  const runtimePaths = [
    "src/support/task-workflow/candidateGate.ts",
    "src/support/task-workflow/workflowManager.ts",
    "src/support/task-workflow/packageCompleteness.ts",
    "src/support/task-workflow/reviewReadiness.ts",
    "src/support/task-workflow/reviewInputSnapshot.ts",
    "src/support/task-workflow/callbackDecision.ts",
    "src/support/testcase/testcaseDocument.ts",
    "src/support/testcase/relationProjection.ts",
    "src/support/formal-execution/sourceContract.ts",
    "src/support/test-suite/stableSuite.ts",
    "skills/iot-automation-testing/templates/test-plan.template.md",
    "skills/iot-automation-testing/templates/testcase-package.template.md"
  ];
  const retiredDependency = new RegExp([
    "testcase-v[234]",
    "testcase" + "-v1-" + "flat",
    "TESTCASE_V[2345]",
    "validateTestcaseV[2345]",
    "projectTestcaseV[2345]",
    "renderTestcaseV[2345]",
    "testcaseV[2345]",
    "legacy_replay"
  ].join("|"), "u");
  const violations = runtimePaths.filter((path) => retiredDependency.test(read(path)));
  if (/\bDEFAULT_REQUIRED_CASE_SECTIONS\b/u.test(
    read("src/support/task-workflow/packageCompleteness.ts")
  )) {
    violations.push("src/support/task-workflow/packageCompleteness.ts:ambiguous-default");
  }
  record(
    violations.length === 0 ? "PASS" : "FAIL",
    "当前用例格式边界",
    violations.length === 0
      ? "当前解析、门禁、评审、关系、稳定套件和正式执行只消费 testcase-v1-layered；旧格式仅保留归档原文。"
      : `当前运行时引用了已归档用例格式：${violations.join("、")}。`
  );
}

function checkCurrentRelationContractBoundary(): void {
  const runtimePaths = [
    "scripts/testcase-quality-gate.ts",
    "src/support/task-workflow/candidateGate.ts",
    "src/support/task-workflow/reviewReadiness.ts",
    "src/support/testcase/relationContract.ts",
    "src/support/testcase/relationProjection.ts",
    "src/support/formal-execution/sourceContract.ts",
    "skills/iot-automation-testing/templates/test-plan.template.md"
  ];
  const retiredMarker = /\b(?:rule-coverage-v[2-9]\d*|rule-design-matrix-v\d+|rule-design-ledger-v[2-9]\d*|case-relation-projection-v[2-9]\d*|legacy_replay)\b/u;
  const violations = runtimePaths.filter((path) => retiredMarker.test(read(path)));
  const contractSource = read("src/support/testcase/relationContract.ts");
  for (const marker of [
    "rule-design-ledger-v1",
    "case-relation-projection-v1"
  ]) {
    if (!contractSource.includes(`\"${marker}\"`)) violations.push(`relationContract.ts:missing-${marker}`);
  }
  record(
    violations.length === 0 ? "PASS" : "FAIL",
    "当前规则台账与关系投影边界",
    violations.length === 0
      ? "v1 是唯一运行时规则台账与关系投影契约；旧 marker 只允许出现在归档原文和拒绝性测试中。"
      : `当前运行时重新持有已归档规则契约：${violations.join("、")}。`
  );
}

function checkRetiredWorkflowCompatibilityBoundary(): void {
  const roots = [
    "src/support/task-workflow",
    "tests/support/task-workflow"
  ];
  const retired = /\b(?:PlanConfirmationCarriedForward|LegacyStateImported|reconcileSupersededPlanConfirmation)\b|\b(?:Legacy|Compat)[A-Z][A-Za-z0-9_]*\b|\b[A-Za-z][A-Za-z0-9_]*V[2-9]\d*\b|\b[A-Za-z][A-Za-z0-9_-]*-v[2-9]\d*\b|\btest\.skip\s*\(/u;
  const violations = roots.flatMap((root) => listFiles(
    resolve(projectRoot, root),
    (path) => path.endsWith(".ts")
  )).filter((path) => retired.test(readFileSync(path, "utf8")))
    .map((path) => relative(projectRoot, path).split(sep).join("/"));
  record(
    violations.length === 0 ? "PASS" : "FAIL",
    "旧工作流兼容边界",
    violations.length === 0
      ? "工作流源码与公共夹具均未保留旧事件、旧回调实现或跳过的历史夹具。"
      : `仍保留旧工作流兼容实现或夹具：${violations.join("、")}。`
  );
}

function checkCurrentWorkflowNarrative(): void {
  const path = "docs/testing/automation-guideline.md";
  const content = read(path);
  const prohibited = [
    /\bv(?:[5-9]|1[0-3])\s*(?:的|批次|请求|定义|正式\s*Runner|full_replan|design_reconfirm)/u,
    /(?:旧|历史)\s*(?:v\d+|workflow|定义|批次|request).{0,48}(?:回放|兼容|迁移|恢复)/u,
    /testcases\/archive\/.*automation/u
  ];
  const violations = prohibited
    .filter((pattern) => pattern.test(content))
    .map((pattern) => pattern.toString());
  record(
    violations.length === 0 ? "PASS" : "FAIL",
    "流程规范当前 v1 叙述",
    violations.length === 0
      ? "流程规范只描述当前 v1 路径；契约版本号仅作为登记标识出现。"
      : `${path} 仍包含历史 workflow 叙述：${violations.join("、")}。`
  );
}

function checkRequestScriptBoundary(): void {
  const runtimeFiles = [
    ...listFiles(resolve(projectRoot, "src"), (path) => /\.tsx?$/u.test(path)),
    ...listFiles(resolve(projectRoot, "scripts"), (path) => /\.tsx?$/u.test(path))
  ];
  const violations = runtimeFiles
    .filter((path) => /tests\/\$\{(?:requestId|runRequestId|manager\.requestId)\}/u.test(readFileSync(path, "utf8")))
    .map((path) => relative(projectRoot, path).split(sep).join("/"));
  record(
    violations.length === 0 ? "PASS" : "FAIL",
    "请求候选脚本目录边界",
    violations.length === 0
      ? "运行时代码不再把候选脚本写入 tests/<request>；候选输出仅位于本轮 .local/test-runs/<request>/candidate-scripts。"
      : `仍按 request 写入 tests/ 的运行时代码：${violations.join("、")}。`
  );
}

function printResults(): void {
  console.log("自动化工程架构静态边界检查（不读取请求数据或本机运行状态）");
  for (const result of results) {
    console.log(`[${result.status}] ${result.name}：${result.detail}`);
  }
  const failed = results.filter((result) => result.status === "FAIL").length;
  const warned = results.filter((result) => result.status === "WARN").length;
  console.log(`汇总：通过 ${results.length - failed - warned}，警告 ${warned}，失败 ${failed}。`);
  if (failed > 0) process.exitCode = 1;
}

checkResponsibilityOwnership();
checkContractRegistry();
checkWorkflowFiles();
checkPublicCommands();
checkImportBoundaries();
checkCurrentTestcaseFormatBoundary();
checkCurrentRelationContractBoundary();
checkRetiredWorkflowCompatibilityBoundary();
checkCurrentWorkflowNarrative();
checkRequestScriptBoundary();
checkOptionalHostAdapterConfiguration();
printResults();
