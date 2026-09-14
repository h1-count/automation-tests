// 报告服务生命周期管理（运行器自动拉起/关闭，2026-09-09 修订）：
// - 每轮测试结束后由 run-fast-tests 自动启动 serve-report 静态服务，
//   并在请求归档目录写入 report-server.json（pid + port）；
// - 任意下一轮测试启动前扫描 testpacks/ 下的状态文件并关闭全部已登记服务（幂等防端口堆积）；
// - 若状态文件丢失但端口仍被占用（如手动起过服务），自动右移端口兜底，链接以 stdout 输出为准。
// 归属判定不依赖 ps（部分受限环境 spawnSync ps 会被 EPERM 拒绝，实测 2026-09-09）：
// 存活用 kill(pid,0)；归属用 HTTP 探测——该端口确实在服务报告页、且 /manifest.json 的 reportId
// 与本请求一致才视为本子进程绑定成功（否则旧服务占端口时存在误判，链接会指向错误报告，实测 2026-09-10）。
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serveReportScript = path.join(rootDirectory, "scripts", "serve-report.mjs");

export const DEFAULT_REPORT_PORT = 4173;

function stateFilePath(requestDirectory) {
  return path.join(requestDirectory, "report-server.json");
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 归属校验：端口上的 /manifest.json 必须与本请求目录一致，才认定端口由本子进程绑定。
// 否则（端口被其他请求的旧服务或无关 HTTP 服务占用时，/index.html 探测会有响应、子进程尚未退出，
// 存在误判窗口，实测 2026-09-10）链接会指向错误报告，必须右移端口重试。
async function manifestReportId(directory) {
  try {
    return JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")).reportId ?? null;
  } catch {
    return null;
  }
}

async function isHttpReady(url, timeoutMs = 2_500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function stopReportServer(requestDirectory) {
  let state;
  try {
    state = JSON.parse(await fs.readFile(stateFilePath(requestDirectory), "utf8"));
  } catch {
    return { stopped: false };
  }
  const { pid, port } = state;
  let stopped = false;
  // 归属确认：进程存活，且该端口确实在服务报告页（双重条件，避免 PID 复用误杀无关进程）。
  if (Number.isFinite(pid) && isProcessAlive(pid) && (await isHttpReady(`http://127.0.0.1:${port}/index.html`))) {
    try {
      process.kill(pid, "SIGTERM");
      stopped = true;
    } catch {
      /* 进程已自行退出 */
    }
    // 等端口真正释放（最长 3s），避免复测新服务起在旧服务关闭的窗口期。
    for (let waited = 0; stopped && waited < 3_000; waited += 250) {
      if (!(await isHttpReady(`http://127.0.0.1:${port}/index.html`, 800))) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await fs.rm(stateFilePath(requestDirectory), { force: true });
  return { stopped, pid, port };
}

// 只扫描请求级 artifacts/current/<report-id>/，不会递归读取 Allure 媒体或运行台账。
export async function discoverReportServerDirectories(testpacksDirectory) {
  const directories = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (entry.name !== "artifacts") {
        await visit(child);
        continue;
      }
      const currentRoot = path.join(child, "current");
      let requests;
      try {
        requests = await fs.readdir(currentRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const request of requests) {
        if (!request.isDirectory()) continue;
        const requestDirectory = path.join(currentRoot, request.name);
        try {
          await fs.access(path.join(requestDirectory, "manifest.json"));
          await fs.access(stateFilePath(requestDirectory));
          directories.push(requestDirectory);
        } catch {
          // 没有服务状态文件的请求不需要关闭。
        }
      }
    }
  }
  await visit(testpacksDirectory);
  return directories.sort();
}

export async function stopAllReportServers(testpacksDirectory) {
  const directories = await discoverReportServerDirectories(testpacksDirectory);
  const results = await Promise.all(directories.map(async (directory) => ({
    directory,
    ...(await stopReportServer(directory))
  })));
  return results.filter((result) => result.stopped);
}

// 启动常驻报告服务（脱离父进程，运行器退出后继续存活）。
// 端口被占用（含状态文件丢失的旧服务）时自动右移，最多尝试 5 个端口。
export async function startReportServer(requestDirectory, options = {}) {
  const preferredPort = Number(options.port ?? DEFAULT_REPORT_PORT);
  for (let port = preferredPort; port < preferredPort + 5; port += 1) {
    const child = spawn(
      process.execPath,
      [serveReportScript, "--dir", requestDirectory, "--port", String(port), "--no-open"],
      { stdio: "ignore", detached: true }
    );
    child.unref();
    const summaryUrl = `http://127.0.0.1:${port}/index.html`;
    const expectedReportId = await manifestReportId(requestDirectory);
    // 子进程需要启动时间：轮询探测就绪（若端口被占，子进程会绑定失败立即退出，无需等满窗口）。
    let childReady = false;
    for (let waited = 0; waited < 5_000; waited += 250) {
      if (!isProcessAlive(child.pid)) break;
      if (await isHttpReady(summaryUrl, 800)) {
        childReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    // 归属校验：确认端口响应的是本请求报告（防止把占用端口的旧服务误认成本子进程，实测 2026-09-10）。
    let ownsPort = false;
    if (childReady) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/manifest.json`, { signal: AbortSignal.timeout(2_500) });
        const served = response.ok ? JSON.parse(await response.text()) : null;
        ownsPort = Boolean(served?.reportId) && served.reportId === expectedReportId;
      } catch {
        ownsPort = false;
      }
    }
    if (ownsPort) {
      await fs.writeFile(
        stateFilePath(requestDirectory),
        `${JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8"
      );
      return { pid: child.pid, port, summaryUrl, detailUrl: `http://127.0.0.1:${port}/allure-report/index.html` };
    }
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* 子进程已自行退出 */
    }
  }
  throw new Error(`端口 ${preferredPort}-${preferredPort + 4} 均无法启动报告服务`);
}

/**
 * 复用目录已登记且仍归属于自己的报告服务；不存在时才启动。
 * 共享首页会在每个请求完成后重建，因此不能为同一目录反复创建新的常驻服务。
 */
export async function ensureReportServer(requestDirectory, options = {}) {
  try {
    const state = JSON.parse(await fs.readFile(stateFilePath(requestDirectory), "utf8"));
    const expectedReportId = await manifestReportId(requestDirectory);
    if (
      Number.isFinite(state.pid) &&
      isProcessAlive(state.pid) &&
      (await isHttpReady(`http://127.0.0.1:${state.port}/index.html`))
    ) {
      const response = await fetch(`http://127.0.0.1:${state.port}/manifest.json`, { signal: AbortSignal.timeout(2_500) });
      const served = response.ok ? JSON.parse(await response.text()) : null;
      if (served?.reportId === expectedReportId) {
        return {
          pid: state.pid,
          port: state.port,
          summaryUrl: `http://127.0.0.1:${state.port}/index.html`,
          detailUrl: `http://127.0.0.1:${state.port}/allure-report/index.html`
        };
      }
    }
  } catch {
    // 无状态文件、状态文件损坏或旧服务已退出时，重新启动。
  }
  return startReportServer(requestDirectory, options);
}
