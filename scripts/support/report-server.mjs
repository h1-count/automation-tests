// 报告服务生命周期管理（运行器自动拉起/关闭，2026-09-09 修订）：
// - 每轮测试结束后由 run-fast-tests 自动启动 serve-report 静态服务，
//   并在请求归档目录写入 report-server.json（pid + port）；
// - 下一轮同 --report-id 复测启动前检查该文件，若上一轮服务仍在运行则先关闭（幂等防端口堆积）；
// - 若状态文件丢失但端口仍被占用（如手动起过服务），自动右移端口兜底，链接以 stdout 输出为准。
// 归属判定不依赖 ps（部分受限环境 spawnSync ps 会被 EPERM 拒绝，实测 2026-09-09）：
// 存活用 kill(pid,0)；归属用 HTTP 探测——该端口确实在服务报告页才视为我们的报告服务。
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
    if ((await isHttpReady(summaryUrl)) && isProcessAlive(child.pid)) {
      // 探测命中 + 子进程存活：本子进程成功绑定（若端口被旧服务占用，子进程会绑定失败退出，走下一端口）。
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
