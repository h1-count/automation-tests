import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { loadFormalExecutionManifestFromPath } from "./manifest.js";
import { candidateScriptManifestPath } from "../task-workflow/runRoots.js";

export interface ReadinessPreflightReport {
  schemaVersion: "readiness-preflight-v1";
  complete: boolean;
  category?: "immutable_input_incompatible";
  issues: string[];
  checklist: string[];
  authorizationOutputPath: string;
  digest: string;
}

interface RunIntentShape {
  suiteId?: unknown;
  selectedCaseIds?: unknown;
}

function digest(value: Omit<ReadinessPreflightReport, "digest">): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/** Validates immutable v12 execution inputs without probing capabilities or writing state. */
export async function assessReadinessPreflight(input: {
  workspaceRoot: string;
  requestId: string;
  requestRoot: string;
  runRootMode: "local-test-runs";
  suiteRoot?: string;
  definitionVersion: string;
}): Promise<ReadinessPreflightReport> {
  const issues: string[] = [];
  const checklist: string[] = [];
  if (input.definitionVersion !== "v12") {
    issues.push("当前运行不是 v12，不能使用 v12 readiness 预检。");
  }
  if (input.runRootMode !== "local-test-runs") {
    issues.push("运行档案不是 .local/test-runs，无法证明 v12 授权产物边界。");
    checklist.push("从稳定套件重新发起新的 v12 request，不迁移旧 history。");
  }
  const expectedRequestRoot = resolve(input.workspaceRoot, ".local", "test-runs", ...input.requestId.split("/"));
  const authorizationOutput = resolve(input.requestRoot, "execution-authorization.json");
  if (resolve(input.requestRoot) !== expectedRequestRoot
    || !authorizationOutput.startsWith(`${expectedRequestRoot}/`)) {
    issues.push("执行授权产物路径不在当前 v12 运行档案内。");
    checklist.push("重新初始化 request，使用 .local/test-runs 下的本轮授权产物路径。");
  }
  if (!input.suiteRoot) {
    issues.push("缺少 suite binding，无法绑定稳定设计资产。");
    checklist.push("重新初始化 request 并提供稳定 suite。");
  }

  let selectedCaseIds: string[] | undefined;
  try {
    const intent = JSON.parse(await readFile(resolve(input.requestRoot, "run-intent.json"), "utf8")) as RunIntentShape;
    if (typeof intent.suiteId !== "string" || !Array.isArray(intent.selectedCaseIds)
      || intent.selectedCaseIds.some((value) => typeof value !== "string") || !intent.selectedCaseIds.length) {
      issues.push("缺少或损坏 run-intent.json。");
    } else {
      selectedCaseIds = intent.selectedCaseIds;
      const boundSuite = input.suiteRoot ? basename(input.suiteRoot) : undefined;
      if (boundSuite && !intent.suiteId.endsWith(`/${boundSuite}`)) {
        issues.push("run-intent suiteId 与 suite binding 不一致。");
      }
    }
  } catch {
    issues.push("缺少或损坏 run-intent.json。");
  }
  if (!selectedCaseIds) checklist.push("重新派生 run intent 后再执行 readiness。");

  try {
    const manifest = await loadFormalExecutionManifestFromPath(
      candidateScriptManifestPath(input.workspaceRoot, input.requestId),
      { workspaceRoot: input.workspaceRoot, expectedRequestId: input.requestId }
    );
    for (const kind of ["source_contract", "selector_contract", "browser_response_contract"]) {
      const evidence = manifest.buildEvidence?.filter((item) => item.kind === kind) ?? [];
      if (evidence.length !== 1) {
        issues.push(`formal manifest 必须恰有一项 ${kind} build evidence。`);
        continue;
      }
      const path = resolve(input.workspaceRoot, evidence[0]!.path);
      if (!existsSync(path)) {
        issues.push(`${kind} build evidence 文件不存在：${evidence[0]!.path}`);
      } else if (evidence[0]!.sha256) {
        const actual = createHash("sha256").update(await readFile(path)).digest("hex");
        if (actual !== evidence[0]!.sha256) issues.push(`${kind} build evidence 摘要漂移：${evidence[0]!.path}`);
      }
    }
    if (selectedCaseIds) {
      const manifestCaseIds = new Set(manifest.cases.map((item) => item.caseId));
      const missing = selectedCaseIds.filter((caseId) => !manifestCaseIds.has(caseId));
      if (missing.length) issues.push(`selectedCaseIds 未被 formal manifest 覆盖：${missing.join(", ")}`);
    }
  } catch (error) {
    issues.push(`formal manifest 不可验证：${error instanceof Error ? error.message : String(error)}`);
    checklist.push("完成 build 并发布当前 request 的 formal execution manifest 与三类来源证据。");
  }
  const report: Omit<ReadinessPreflightReport, "digest"> = {
    schemaVersion: "readiness-preflight-v1",
    complete: issues.length === 0,
    ...(issues.length ? { category: "immutable_input_incompatible" as const } : {}),
    issues,
    checklist: checklist.length ? checklist : ["执行 readiness。"],
    authorizationOutputPath: relative(input.workspaceRoot, authorizationOutput)
  };
  return { ...report, digest: digest(report) };
}
