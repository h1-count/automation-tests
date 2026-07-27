import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { loadFormalExecutionManifest } from "../src/support/formal-execution/manifest.js";
import { FormalExecutionStore } from "../src/support/formal-execution/formalExecutionStore.js";
import { loadConfirmedExecutionAuthorization } from "../src/support/task-state/executionAuthorization.js";

const { requestId, resume } = parseArgs(process.argv.slice(2));
const manifest = await loadFormalExecutionManifest(requestId);
const snapshot = await loadConfirmedExecutionAuthorization(requestId, manifest.environment);
const manifestPath = `tests/web/${requestId.replace(/^web\//, "")}/execution.manifest.ts`;
if (!snapshot.scriptDigests.some((item) => item.path === manifestPath)) {
  throw new Error("The immutable authorization does not include the formal execution manifest.");
}
const authorized = [...snapshot.caseIds].sort();
const declared = manifest.cases.map((item) => item.caseId).sort();
if (JSON.stringify(authorized) !== JSON.stringify(declared)) {
  throw new Error("The formal manifest must contain every authorized caseId exactly once.");
}
const store = new FormalExecutionStore();
const existing = await store.read(snapshot.digest);
if (existing && !resume) {
  throw new Error("This authorization already has a formal run; use --resume to restore the same run.");
}
if (!existing && resume) {
  throw new Error("--resume requires an existing formal run for the same authorization.");
}

const executable = resolve(process.cwd(), "node_modules/.bin/playwright");
if (!existsSync(executable)) throw new Error("The local Playwright executable is unavailable.");
const visibleLocalRun = !process.env.CI;
const browserServer = await chromium.launchServer({
  headless: !visibleLocalRun,
  slowMo: visibleLocalRun ? 350 : 0,
  channel: visibleLocalRun ? "chrome" : undefined
});
process.stdout.write(
  `[正式执行] Runner 已持有浏览器进程 PID ${browserServer.process()?.pid ?? "unknown"}；worker 失败时只重连该进程。\n`
);
let exitCode: number;
try {
  exitCode = await run(executable, ["test", "--config=playwright.config.ts"], {
    ...process.env,
    AUTOMATION_REQUEST_ID: requestId,
    FORMAL_EXECUTION_RESUME: resume ? "1" : "0",
    PLAYWRIGHT_FORMAL_BROWSER_WS_ENDPOINT: browserServer.wsEndpoint()
  });
} finally {
  await browserServer.close();
}
const summary = await store.summarize(snapshot.digest);
if (!summary.complete || summary.counts.blocked > 0) process.exitCode = 2;
else if (summary.counts.failed > 0 || exitCode !== 0) process.exitCode = 1;
else process.exitCode = 0;

function parseArgs(args: string[]): { requestId: string; resume: boolean } {
  let parsedRequest = "";
  let parsedResume = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--request") {
      parsedRequest = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--resume") {
      parsedResume = true;
    } else {
      throw new Error(`Unsupported formal execution argument: ${arg}. Only --request and --resume are allowed.`);
    }
  }
  if (!parsedRequest) throw new Error("Usage: npm run test:web:execute -- --request web/<project>/<request> [--resume]");
  return { requestId: parsedRequest, resume: parsedResume };
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
