import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const port = 9323;
const endpoint = `http://127.0.0.1:${port}`;
const statePath = resolve(".local/playwright-explore-session.json");
const profilePath = resolve(".local/playwright-explore-profile");
const command = process.argv[2];

interface ExploreSessionState {
  pid: number;
  endpoint: string;
  profilePath: string;
  createdAt: string;
}

async function endpointAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function readState(): Promise<ExploreSessionState | undefined> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as ExploreSessionState;
  } catch {
    return undefined;
  }
}

async function writeState(state: ExploreSessionState) {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function waitForEndpoint() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await endpointAvailable()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("探索会话在 15 秒内未就绪。请运行 status 查看状态，或重新执行 start。");
}

async function start() {
  if (await endpointAvailable()) {
    console.log(`探索会话已运行：${endpoint}`);
    return;
  }

  const executablePath = chromium.executablePath();
  await access(executablePath);
  const child = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profilePath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-extensions"
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  await waitForEndpoint();
  await writeState({ pid: child.pid!, endpoint, profilePath, createdAt: new Date().toISOString() });
  console.log(`探索会话已启动：${endpoint}`);
}

async function status() {
  const state = await readState();
  console.log(
    JSON.stringify(
      {
        running: await endpointAvailable(),
        endpoint,
        managedSession: state ?? null
      },
      null,
      2
    )
  );
}

async function stop() {
  const state = await readState();
  if (!state) throw new Error("未找到受管探索会话；不会终止任何未知 Chrome 进程。");
  if (state.endpoint !== endpoint || state.profilePath !== profilePath) {
    throw new Error("探索会话状态不匹配；不会终止任何进程。");
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ESRCH")) throw error;
  }
  await rm(statePath, { force: true });
  console.log("已请求停止受管探索会话。");
}

if (command === "start") await start();
else if (command === "status") await status();
else if (command === "stop") await stop();
else throw new Error("用法：npm run playwright:explore-session -- <start|status|stop>");
