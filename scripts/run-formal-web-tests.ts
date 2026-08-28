import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  formalCapabilityId,
  loadFormalExecutionManifest,
  loadFormalExecutionManifestFromPath
} from "../src/support/formal-execution/manifest.js";
import { evaluateCapabilitiesWithProviders } from "../src/support/formal-execution/manifest.js";
import { createDefaultCapabilityProviderRegistry } from "../src/support/formal-execution/capabilityProvider.js";
import { sanitizeFormalArtifactTrees } from "../src/support/formal-execution/artifactRedaction.js";
import { FormalExecutionStore } from "../src/support/formal-execution/formalExecutionStore.js";
import { finalizeFormalExecution } from "../src/support/formal-execution/finalize.js";
import {
  formalRunnerExitCode,
  runFormalTeardown
} from "../src/support/formal-execution/runnerLifecycle.js";
import {
  assertCurrentAuthorizedScripts,
  loadConfirmedExecutionAuthorization
} from "../src/support/formal-execution/authorization.js";
import {
  assertFormalSpecSources,
  formalWorkerCount,
  interactiveOtpCaseIds
} from "../src/support/formal-execution/runnerPolicy.js";
import { DurableWorkflowManager } from "../src/support/task-workflow/workflowManager.js";
import { buildExecutionDependencyPlan } from "../src/support/formal-execution/dependencyPlan.js";
import { selectNextExecutionWave } from "../src/support/formal-execution/executionScheduler.js";
import { pageSessionGroupsRequireSingleWorker } from "../src/support/formal-execution/pageSessionGroups.js";
import {
  assertFormalBuildAuthorization,
  verifyFrozenBuildIdentity
} from "../src/support/formal-execution/selectorBuildIdentity.js";
import { resolveTestEnvironment } from "../src/env/testEnvironment.js";

const { requestId, resume, headed } = parseArgs(process.argv.slice(2));
const snapshot = await loadConfirmedExecutionAuthorization(requestId);
const [requestType] = requestId.split("/");
if (!["web", "h5"].includes(requestType!)) {
  throw new Error("Formal Playwright runner accepts only web or h5 requests.");
}
const manifestPath = snapshot.mode === "stable_suite"
  ? snapshot.formalManifestPath!
  : snapshot.scriptDigests.find((item) => item.path.endsWith("/execution.manifest.ts"))?.path;
if (!manifestPath) {
  throw new Error(`Formal Runner found no authorized execution manifest for ${requestId}.`);
}
const formalSpecPaths = snapshot.mode === "stable_suite"
  ? (snapshot.entryScriptPaths ?? []).filter((path) => path.endsWith(".formal.spec.ts"))
  : snapshot.scriptDigests
      .map((item) => item.path)
      .filter((path) => path.endsWith(".formal.spec.ts"))
      .sort();
if (!formalSpecPaths.length) {
  throw new Error(`Formal Runner found no *.formal.spec.ts files for ${requestId}.`);
}
assertCurrentAuthorizedScripts(snapshot, [manifestPath, ...formalSpecPaths]);
const reviewedCaseIds = [
  ...snapshot.caseIds,
  ...(snapshot.deferredCases ?? []).map((item) => item.caseId)
];
const manifest = snapshot.mode === "stable_suite"
  ? await loadFormalExecutionManifestFromPath(manifestPath, {
      expectedSuiteId: snapshot.suiteId
    })
  : await loadFormalExecutionManifest(requestId);
if (snapshot.mode === "stable_suite"
  && manifest.scope === "stable_suite"
  && manifest.suiteId !== snapshot.suiteId) {
  throw new Error("Formal manifest suite identity differs from execution-authorization-v1.");
}
assertFormalBuildAuthorization({
  manifest,
  authorizationSchemaVersion: snapshot.schemaVersion
});
assertFormalSpecSources(
  await Promise.all(formalSpecPaths.map(async (path) => ({
    path,
    source: await readFile(resolve(process.cwd(), path), "utf8")
  }))),
  reviewedCaseIds,
  {
    manifestSchemaVersion: manifest.schemaVersion,
    ...(manifest.scope === "stable_suite"
      ? { allowedCaseIds: manifest.cases.map((item) => item.caseId) }
      : {})
  }
);
if (snapshot.environment !== manifest.environment) {
  throw new Error("Execution environment differs from the confirmed authorization.");
}
{
  await verifyFrozenBuildIdentity({
    manifest,
    workspaceRoot: process.cwd(),
    targetBuildDigest: snapshot.targetBuildDigest!,
    selectorEvidenceDigests: snapshot.selectorEvidenceDigests ?? []
  });
}
const declared = new Set(manifest.cases.map((item) => item.caseId));
if (snapshot.caseIds.some((caseId) => !declared.has(caseId))) {
  throw new Error("The formal manifest must declare every authorized runnable caseId.");
}
const dependencyPlan = buildExecutionDependencyPlan(manifest, snapshot.caseIds);
const manualOtpCases = interactiveOtpCaseIds(manifest, snapshot.caseIds);
if (manualOtpCases.length > 0 && !headed) {
  throw new Error(
    `Cases ${manualOtpCases.join(", ")} require manual OTP entry in the visible browser; rerun with --headed.`
  );
}
const containsSensitiveEvidenceCase = manifest.cases.some((item) =>
  snapshot.caseIds.includes(item.caseId) && item.evidencePolicy === "sensitive"
);
const capabilityContext = {
  requestId,
  environment: snapshot.environment,
  targetBuildDigest: snapshot.targetBuildDigest,
  workspaceRoot: process.cwd()
};
const capabilityRegistry = createDefaultCapabilityProviderRegistry();
const store = new FormalExecutionStore();
const existing = await store.read(snapshot.digest);
if (existing && !resume) {
  throw new Error("This authorization already has a formal run; use --resume to restore the same run.");
}
if (!existing && resume) {
  throw new Error("--resume requires an existing formal run for the same authorization.");
}
if (existing?.cleanup?.status === "failed") {
  throw new Error(
    "Formal case execution is already terminal and only data hygiene remains; recover test data, then use execution-run-finalize instead of --resume."
  );
}
if (existing && resume) {
  const reopenedCaseIds = await store.reopenSafeRetryableCases(snapshot.digest);
  if (reopenedCaseIds.length > 0) {
    process.stdout.write(
      `[正式执行] 已恢复 ${reopenedCaseIds.length} 条无业务副作用的非通过或未定案用例；既有写入意图、资源和阶段检查点均未重放。\n`
    );
  }
}
const currentCapabilities = await evaluateCapabilitiesWithProviders(
  manifest.capabilities,
  capabilityContext,
  capabilityRegistry
);
const runnableCapabilityIds = new Set(manifest.cases
  .filter((item) => snapshot.caseIds.includes(item.caseId))
  .flatMap((item) => item.requiredCapabilities.flatMap((requirement) => {
    if (typeof requirement === "string") return [requirement];
    return Object.values(existing?.stageProgress ?? {}).some((progress) =>
      progress.transitions[requirement.checkAfterTransitionId]?.status === "resolved"
    )
      ? [formalCapabilityId(requirement)]
      : [];
  })));
const unavailableCapabilities = currentCapabilities.filter((item) =>
  runnableCapabilityIds.has(item.capabilityId) && !item.available
);
if (unavailableCapabilities.length > 0) {
  throw new Error(
    `Execution readiness changed before run: ${unavailableCapabilities.map((item) => item.capabilityId).join(", ")} unavailable. Republish readiness and execution authorization.`
  );
}
{
  const frozenEvidence = new Map(
    (snapshot.capabilityEvidence ?? []).map((item) => [item.capabilityId, item.evidenceDigest])
  );
  const changedEvidence = currentCapabilities.filter((item) =>
    runnableCapabilityIds.has(item.capabilityId)
    && frozenEvidence.has(item.capabilityId)
    && frozenEvidence.get(item.capabilityId) !== item.evidenceDigest
  );
  if (changedEvidence.length > 0) {
    throw new Error(
      `Capability evidence changed after authorization: ${changedEvidence.map((item) => item.capabilityId).join(", ")}. Republish readiness.`
    );
  }
}
const workflow = new DurableWorkflowManager(requestId);
const defaultWorkers = formalWorkerCount(await workflow.projection(), snapshot);

const executable = resolve(process.cwd(), "node_modules/.bin/playwright");
if (!existsSync(executable)) throw new Error("The local Playwright executable is unavailable.");
let preparedCapabilities = manifest.capabilities.slice(0, 0);
let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
let playwrightFailed = false;
let runnerError: Error | undefined;
let requestedSettlement: "terminal" | "park" = "terminal";
let teardownResult: Awaited<ReturnType<typeof runFormalTeardown>> | undefined;
try {
  preparedCapabilities = await capabilityRegistry.setupForCases(
    manifest.capabilities.filter((definition) => runnableCapabilityIds.has(definition.id)),
    snapshot.caseIds,
    capabilityContext
  );
  if (manualOtpCases.length > 0) {
    process.stdout.write(
      `[正式执行] ${manualOtpCases.join(", ")} 含人工安全挑战/验证码环节：点选验证码与短信验证码由用户直接在可见浏览器内完成；凭据与验证码不会进入终端、Secret 或测试产物。\n`
    );
  }
  browserServer = await chromium.launchServer({
    headless: !headed,
    channel: headed ? "chrome" : undefined
  });
  // 已捕获登录态注入：显式变量优先，其次回退到环境解析出的开放平台认证态文件。
  // 文件不存在时不注入，让依赖登录态的用例以可见的登录页重定向失败，而不是静默跳过。
  // 匿名会话请求（登录/注册链路）不注入任何已捕获登录态，保证未登录前置成立。
  const anonymousSession = manifest.sessionAuthentication === "anonymous";
  const formalStorageState = process.env.PLAYWRIGHT_FORMAL_STORAGE_STATE?.trim()
    ?? (anonymousSession
      ? undefined
      : (() => {
          try {
            const authStatePath = resolveTestEnvironment().openPlatformAuthStatePath;
            return authStatePath && existsSync(authStatePath) ? authStatePath : undefined;
          } catch {
            return undefined;
          }
        })());
  if (formalStorageState) {
    process.env.PLAYWRIGHT_FORMAL_STORAGE_STATE = formalStorageState;
    process.stdout.write(`[正式执行] 已声明登录态 storageState（路径不回显）供正式会话注入。\n`);
  } else if (anonymousSession) {
    delete process.env.PLAYWRIGHT_FORMAL_STORAGE_STATE;
    process.stdout.write("[正式执行] 本请求声明匿名会话策略，未登录态运行全部用例。\n");
  }
  process.stdout.write(
    `[正式执行] Runner 已持有浏览器进程 PID ${browserServer.process()?.pid ?? "unknown"}；worker 失败时只重连该进程。\n`
  );
  let currentRecord = await store.read(snapshot.digest);
  let nextCaseIds = currentRecord
    ? selectNextExecutionWave(dependencyPlan, currentRecord).runnableCaseIds
    : dependencyPlan.initialCaseIds;
  while (nextCaseIds.length > 0) {
    const artifactWaveNumber = executionBatchNumber(currentRecord);
    const waveWorkers = pageSessionGroupsRequireSingleWorker(manifest, nextCaseIds)
      ? 1
      : defaultWorkers;
    const waveExitCode = await run(executable, ["test", "--config=playwright.config.ts"], {
      ...process.env,
      AUTOMATION_REQUEST_ID: requestId,
      FORMAL_EXECUTION_RUN_REQUEST_ID: requestId,
      PLAYWRIGHT_FORMAL_SCRIPT_SCOPE: dirname(manifestPath).replace(/^tests\//u, ""),
      FORMAL_EXECUTION_RESUME: resume || currentRecord ? "1" : "0",
      PLAYWRIGHT_FORMAL_WORKERS: String(waveWorkers),
      PLAYWRIGHT_FORMAL_BROWSER_WS_ENDPOINT: browserServer.wsEndpoint(),
      PLAYWRIGHT_AUTHORIZATION_DIGEST: snapshot.digest,
      PLAYWRIGHT_AUTHORIZED_CASE_IDS: nextCaseIds.join(","),
      PLAYWRIGHT_EXECUTION_WAVE: String(artifactWaveNumber),
      PLAYWRIGHT_HAS_SENSITIVE_CASES: containsSensitiveEvidenceCase ? "1" : "0",
      PLAYWRIGHT_CAPABILITY_RESULTS: JSON.stringify(currentCapabilities)
    });
    if (waveExitCode !== 0) playwrightFailed = true;
    currentRecord = await store.read(snapshot.digest);
    if (!currentRecord) {
      throw new Error("Formal dependency wave ended without durable execution state.");
    }
    let decision = selectNextExecutionWave(dependencyPlan, currentRecord);
    for (const blocked of decision.blockedCases) {
      await store.markBlocked(
        snapshot.digest,
        blocked.caseId,
        blocked.reason,
        {
          cause: "required_resource_unavailable",
          resourceName: blocked.resourceName
        }
      );
    }
    if (decision.blockedCases.length > 0) {
      currentRecord = await store.read(snapshot.digest);
      decision = selectNextExecutionWave(dependencyPlan, currentRecord!);
    }
    nextCaseIds = decision.runnableCaseIds;
    if (nextCaseIds.length === 0 && decision.waitingTransitionIds.length > 0) {
      process.stdout.write(
        `[正式执行] 当前可执行波次已完成；等待外部转换：${decision.waitingTransitionIds.join(", ")}。\n`
      );
      requestedSettlement = "park";
      break;
    }
    if (nextCaseIds.length === 0 && !decision.complete) {
      throw new Error("Formal dependency scheduler made no progress and has no pending external transition.");
    }
  }
} catch (error) {
  runnerError = error instanceof Error ? error : new Error("Unknown formal runner failure.");
} finally {
  teardownResult = await runFormalTeardown({
    closeBrowser: async () => {
      const server = browserServer;
      browserServer = undefined;
      if (server) await server.close();
    },
    settle: async () => {
      if (await store.read(snapshot.digest)) {
        return finalizeFormalExecution(requestId, {
          requested: requestedSettlement,
          snapshot,
          manifest
        });
      }
      if (!runnerError) {
        throw new Error("Formal Runner ended without initializing structured execution state.");
      }
      return undefined;
    },
    cleanupCapabilities: () => capabilityRegistry.cleanup(preparedCapabilities, capabilityContext),
    sanitizeArtifacts: () => sanitizeFormalArtifactTrees([
      resolve(process.cwd(), "artifacts/playwright-report"),
      resolve(process.cwd(), "artifacts/test-results"),
      resolve(process.cwd(), "artifacts/allure-results")
    ])
  });
}
if (runnerError) {
  process.stderr.write(`[正式执行] ${runnerError.message}\n`);
}
for (const failure of teardownResult.errors) {
  process.stderr.write(`[正式执行] ${failure.phase} teardown failed: ${failure.error.message}\n`);
}
if (teardownResult.removedArtifacts.length > 0) {
  process.stderr.write(
    `[正式执行] 已删除 ${teardownResult.removedArtifacts.length} 个未通过敏感信息泄漏检查的附件。\n`
  );
}
process.exitCode = formalRunnerExitCode({
  settlement: teardownResult.settlement,
  runnerError,
  playwrightFailed,
  teardownErrors: teardownResult.errors
});

function executionBatchNumber(
  record: Awaited<ReturnType<FormalExecutionStore["read"]>>
): number {
  if (!record) return 0;
  return Object.values(record.cases).reduce(
    (count, formalCase) => count + formalCase.attempts.length,
    0
  );
}

function parseArgs(args: string[]): {
  requestId: string;
  resume: boolean;
  headed: boolean;
} {
  let parsedRequest = "";
  let parsedResume = false;
  let parsedHeaded = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--request") {
      parsedRequest = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--resume") {
      parsedResume = true;
    } else if (arg === "--headed") {
      parsedHeaded = true;
    } else {
      throw new Error(`Unsupported formal execution argument: ${arg}. Only --request, --resume and --headed are allowed.`);
    }
  }
  if (!parsedRequest) {
    throw new Error(
      "Usage: npm run test:web:execute -- --request <web|h5>/<project>/<request> [--resume] [--headed]"
    );
  }
  return { requestId: parsedRequest, resume: parsedResume, headed: parsedHeaded };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Playwright was interrupted by ${signal}.`));
      else accept(code ?? 1);
    });
  });
}
