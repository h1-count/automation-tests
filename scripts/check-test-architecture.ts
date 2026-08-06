import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  inspectPublicTaskCommands,
  PUBLIC_TASK_COMMANDS
} from "./public-task-command-contract.js";
import {
  inspectRuleResponsibilities,
  RULE_OWNER_PATHS
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
  const inspection = inspectRuleResponsibilities(documents);

  record(
    inspection.ownerViolations.length === 0 ? "PASS" : "FAIL",
    "规范事实所有权",
    inspection.ownerViolations.length === 0
      ? `${Object.keys(RULE_OWNER_PATHS).length} 类规范责任在 docs/testing 全量 Markdown 中均有唯一 owner。`
      : inspection.ownerViolations.join("；")
  );
  record(
    inspection.delegationViolations.length === 0 ? "PASS" : "FAIL",
    "流程规范职责委托",
    inspection.delegationViolations.length === 0
      ? "流程规范的专项摘要均立即链接唯一 owner，并保持为无子标题的单段短委托。"
      : inspection.delegationViolations.join("；")
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
    "src/support/formal-execution/authorization.ts"
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
  const hookPath = resolve(projectRoot, "scripts/codex-stop-stage-envelope.mjs");
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
    && stopCommands[0]!.command.includes("scripts/codex-stop-stage-envelope.mjs");
  record(
    valid ? "PASS" : "FAIL",
    "可选宿主停止适配",
    valid
      ? "已启用的宿主停止事件配置唯一且指向现存兼容脚本。"
      : "已启用的宿主停止事件配置必须包含唯一 command adapter，并指向现存兼容脚本。"
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
checkWorkflowFiles();
checkPublicCommands();
checkImportBoundaries();
checkOptionalHostAdapterConfiguration();
printResults();
