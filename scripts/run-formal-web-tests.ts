import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  formalCapabilityId,
  loadFormalExecutionManifest
} from "../src/support/formal-execution/manifest.js";
import { evaluateCapabilitiesWithProviders } from "../src/support/formal-execution/manifest.js";
import { createDefaultCapabilityProviderRegistry } from "../src/support/formal-execution/capabilityProvider.js";
import { sanitizeFormalArtifactTrees } from "../src/support/formal-execution/artifactRedaction.js";
import { FormalExecutionStore } from "../src/support/formal-execution/formalExecutionStore.js";
import { finalizeFormalExecution } from "../src/support/formal-execution/finalize.js";
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

const { requestId, resume, headed } = parseArgs(process.argv.slice(2));
const snapshot = await loadConfirmedExecutionAuthorization(requestId);
const [requestType, ...requestParts] = requestId.split("/");
if (!["web", "h5"].includes(requestType!)) {
  throw new Error("Formal Playwright runner accepts only web or h5 requests.");
}
const relativeRequest = requestParts.join("/");
const requestDirectory = resolve(process.cwd(), "tests", requestType!, relativeRequest);
const manifestPath = `tests/${requestType}/${relativeRequest}/execution.manifest.ts`;
const formalSpecPaths = (await readdir(requestDirectory))
  .filter((name) => name.endsWith(".formal.spec.ts"))
  .sort()
  .map((name) => `tests/${requestType}/${relativeRequest}/${name}`);
if (!formalSpecPaths.length) {
  throw new Error(`Formal Runner found no *.formal.spec.ts files for ${requestId}.`);
}
assertCurrentAuthorizedScripts(snapshot, [manifestPath, ...formalSpecPaths]);
const reviewedCaseIds = [
  ...snapshot.caseIds,
  ...(snapshot.deferredCases ?? []).map((item) => item.caseId)
];
assertFormalSpecSources(
  await Promise.all(formalSpecPaths.map(async (path) => ({
    path,
    source: await readFile(resolve(process.cwd(), path), "utf8")
  }))),
  reviewedCaseIds
);
const manifest = await loadFormalExecutionManifest(requestId);
if (snapshot.environment !== manifest.environment) {
  throw new Error("Execution environment differs from the confirmed authorization.");
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
if (existing && resume) {
  const reopenedCaseIds = await store.reopenSafeRetryableCases(snapshot.digest);
  if (reopenedCaseIds.length > 0) {
    process.stdout.write(
      `[正式执行] 已恢复 ${reopenedCaseIds.length} 条无业务副作用的失败/阻塞用例；既有写入意图、资源和阶段检查点均未重放。\n`
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
if (["execution-authorization-v3", "execution-authorization-v4"].includes(snapshot.schemaVersion)) {
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
const preparedCapabilities = await capabilityRegistry.setupForCases(
  manifest.capabilities.filter((definition) => runnableCapabilityIds.has(definition.id)),
  snapshot.caseIds,
  capabilityContext
);
let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
let exitCode = 0;
let playwrightFailed = false;
let runnerError: Error | undefined;
let summary: Awaited<ReturnType<typeof finalizeFormalExecution>> | undefined;
try {
  if (manualOtpCases.length > 0) {
    process.stdout.write(
      `[正式执行] ${manualOtpCases.join(", ")} 将在短信发送后等待用户直接在浏览器输入验证码；验证码不会进入终端、Secret 或测试产物。\n`
    );
  }
  browserServer = await chromium.launchServer({
    headless: !headed,
    channel: headed ? "chrome" : undefined
  });
  process.stdout.write(
    `[正式执行] Runner 已持有浏览器进程 PID ${browserServer.process()?.pid ?? "unknown"}；worker 失败时只重连该进程。\n`
  );
  try {
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
        await store.markBlocked(snapshot.digest, blocked.caseId, blocked.reason);
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
        exitCode = 2;
        break;
      }
      if (nextCaseIds.length === 0 && !decision.complete) {
        throw new Error("Formal dependency scheduler made no progress and has no pending external transition.");
      }
    }
  } catch (error) {
    runnerError = error instanceof Error ? error : new Error("Unknown formal runner failure.");
  } finally {
    await browserServer.close();
    browserServer = undefined;
  }
  const removedArtifacts = await sanitizeFormalArtifactTrees([
    resolve(process.cwd(), "artifacts/playwright-report"),
    resolve(process.cwd(), "artifacts/test-results"),
    resolve(process.cwd(), "artifacts/allure-results"),
  ]);
  if (removedArtifacts.length > 0) {
    process.stderr.write(
      `[正式执行] 已删除 ${removedArtifacts.length} 个未通过敏感信息泄漏检查的附件。\n`
    );
  }
  if (await store.read(snapshot.digest)) {
    summary = await finalizeFormalExecution(requestId);
  } else if (!runnerError) {
    throw new Error("Formal Runner ended without initializing structured execution state.");
  }
} finally {
  if (browserServer) await browserServer.close();
  await capabilityRegistry.cleanup(preparedCapabilities, capabilityContext);
}
if (runnerError) {
  process.stderr.write(`[正式执行] ${runnerError.message}\n`);
}
if (!summary || summary.counts.failed > 0 || playwrightFailed || runnerError) process.exitCode = 1;
else if (exitCode === 2 || !summary.complete || summary.counts.blocked > 0 || summary.cleanup.status === "failed") process.exitCode = 2;
else process.exitCode = 0;

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
