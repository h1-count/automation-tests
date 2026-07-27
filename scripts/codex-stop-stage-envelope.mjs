import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

let hookInput = {};
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) hookInput = JSON.parse(raw);
} catch {
  process.stdout.write(`${JSON.stringify({ systemMessage: "Automation Stop Hook could not parse its Codex input; host continuation is not trusted." })}\n`);
  process.exit(0);
}

const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
const cwd = rootResult.status === 0 ? rootResult.stdout.trim() : process.cwd();
const stateRoot = resolve(cwd, ".local/test-task-state");
const sessionId = typeof hookInput.session_id === "string" ? hookInput.session_id : undefined;

function stateFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return stateFiles(path);
    return entry.name === "state.json" ? [path] : [];
  });
}

const activeRequests = stateFiles(stateRoot).flatMap((path) => {
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return state.hostContinuation?.status === "active"
      && state.hostContinuation?.sessionId === sessionId
      && typeof state.requestId === "string"
      ? [state.requestId]
      : [];
  } catch {
    return [];
  }
});

const denied = [];
for (const requestId of activeRequests) {
  const result = spawnSync(
    resolve(cwd, "node_modules/.bin/tsx"),
    ["src/support/task-state/gate.ts", "--request", requestId, "--json", "--assert-final"],
    { cwd, encoding: "utf8" }
  );
  if (result.status === 2) {
    try {
      const envelope = JSON.parse(result.stdout.trim());
      denied.push(`${requestId}: ${envelope.nextAction?.action ?? envelope.state}`);
    } catch {
      denied.push(`${requestId}: 非终态执行信封拒绝结束`);
    }
  }
}

if (denied.length > 0) {
  process.stdout.write(`${JSON.stringify({
    decision: "block",
    reason: `测试阶段仍有唯一下一动作：${denied.join("；")}。继续执行；若宿主强制抢占，由已绑定 heartbeat 恢复。`
  })}\n`);
} else {
  process.stdout.write("{}\n");
}
