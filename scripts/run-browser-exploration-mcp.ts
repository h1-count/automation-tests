import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { resolveTestEnvironment } from "../src/env/testEnvironment.js";
import {
  isSupportedChromeDevtoolsNodeVersion,
  loadBrowserExplorationPolicy
} from "../src/support/web/browserExploration.js";
import { installExploreMutationGuard } from "../src/support/web/automationMode.js";

interface RuntimeResources {
  profilePath: string;
  context?: BrowserContext;
  mcp?: ChildProcess;
}

const resources: RuntimeResources = { profilePath: "" };
let shuttingDown = false;

async function main(): Promise<void> {
  if (!isSupportedChromeDevtoolsNodeVersion()) {
    throw new Error("Browser exploration MCP requires Node ^20.19.0, ^22.12.0, or >=23.");
  }
  const environment = resolveTestEnvironment();
  if (environment.name === "prod") {
    throw new Error("Browser exploration MCP is unavailable for production environments.");
  }
  if (environment.openPlatformAuthStatePath) {
    throw new Error("Browser exploration MCP does not attach authenticated browser state.");
  }
  const allowedUrlPattern = resolveAllowedUrlPattern(environment.openPlatformWebBaseUrl);
  const policy = await loadBrowserExplorationPolicy();
  resources.profilePath = await mkdtemp(resolve(tmpdir(), "browser-exploration-"));

  resources.context = await chromium.launchPersistentContext(resources.profilePath, {
    channel: "chrome",
    headless: true,
    serviceWorkers: "block",
    args: [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions"
    ]
  });
  const blockedCounts = new Map<string, number>();
  await installExploreMutationGuard(resources.context, {
    onBlocked: (attempt) => {
      blockedCounts.set(attempt.method, (blockedCounts.get(attempt.method) ?? 0) + 1);
    }
  });
  if (resources.context.pages().length === 0) await resources.context.newPage();

  const endpoint = await waitForDebugEndpoint(resources.profilePath);
  const mcp = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "--yes",
      policy.package,
      `--browser-url=${endpoint}`,
      ...policy.mcpArguments,
      `--allowed-url-pattern=${allowedUrlPattern}`
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1" },
      stdio: ["inherit", "pipe", "pipe"]
    }
  );
  resources.mcp = mcp;
  mcp.stdout?.pipe(process.stdout);
  mcp.stderr?.pipe(process.stderr);
  const result = await waitForProcess(mcp);
  if (blockedCounts.size > 0) {
    process.stderr.write(`[browser-exploration] blocked write attempts: ${[...blockedCounts.entries()].map(([method, count]) => `${method}=${count}`).join(", ")}\n`);
  }
  if (result.code !== 0 && !shuttingDown) {
    throw new Error(`Browser exploration MCP stopped with exit code ${result.code}.`);
  }
}

async function waitForDebugEndpoint(profilePath: string): Promise<string> {
  const activePortPath = resolve(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/u);
      if (port && /^[1-9][0-9]{0,4}$/u.test(port) && Number(port) <= 65535) {
        return `http://127.0.0.1:${port}`;
      }
    } catch {
      // Chrome has not yet created its local debugging endpoint.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Browser exploration Chrome did not publish a loopback debugging endpoint within 15 seconds.");
}

function resolveAllowedUrlPattern(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Browser exploration requires a credential-free HTTP(S) test or pre-production base URL.");
  }
  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${pathname}*`;
}

function waitForProcess(child: ChildProcess): Promise<{ code: number }> {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal && !shuttingDown) reject(new Error(`Browser exploration MCP was interrupted by ${signal}.`));
      else resolveExit({ code: code ?? (signal ? 1 : 0) });
    });
  });
}

async function teardown(): Promise<void> {
  const cleanup: Array<Promise<unknown>> = [];
  if (resources.mcp && resources.mcp.exitCode === null && !resources.mcp.killed) {
    resources.mcp.kill("SIGTERM");
  }
  if (resources.context) cleanup.push(resources.context.close());
  if (resources.profilePath) cleanup.push(rm(resources.profilePath, { recursive: true, force: true }));
  await Promise.allSettled(cleanup);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shuttingDown = true;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    if (resources.mcp && resources.mcp.exitCode === null && !resources.mcp.killed) {
      resources.mcp.kill("SIGTERM");
    }
  });
}

try {
  await main();
} finally {
  await teardown();
}
