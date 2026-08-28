import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function writeHookResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

let hookInput = {};
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) hookInput = JSON.parse(raw);
} catch {
  writeHookResult({
    systemMessage: "Automation lifecycle adapter could not parse its Harness input; workflow history was not changed."
  });
  process.exit(0);
}

const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8"
});
const cwd = rootResult.status === 0 ? rootResult.stdout.trim() : process.cwd();
const runtimeRoot = resolve(cwd, ".local/test-task-runtime");
const sessionId = typeof hookInput.session_id === "string" ? hookInput.session_id : undefined;

if (!sessionId) {
  writeHookResult({
    systemMessage: "Automation lifecycle adapter did not receive a Harness session id; no continuation was requested and workflow history was not changed."
  });
  process.exit(0);
}

function runtimeFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return runtimeFiles(path);
    return entry.name === "runtime.json" ? [path] : [];
  });
}

const matchingBindings = runtimeFiles(runtimeRoot).flatMap((path) => {
  try {
    const runtime = JSON.parse(readFileSync(path, "utf8"));
    if (
      runtime.schemaVersion !== "test-workflow-runtime-v1"
      || runtime.sessionBinding?.sessionId !== sessionId
      || typeof runtime.requestId !== "string"
      || runtime.requestId.trim().length === 0
    ) {
      return [];
    }
    return [{
      requestId: runtime.requestId,
      revision: Number(runtime.revision ?? 0),
      updatedAt: String(runtime.sessionBinding?.updatedAt ?? "")
    }];
  } catch {
    // Runtime bindings are disposable. Malformed or unrelated files cannot
    // alter workflow history and are ignored while locating this session.
    return [];
  }
});

matchingBindings.sort((left, right) =>
  right.updatedAt.localeCompare(left.updatedAt)
  || right.revision - left.revision
  || left.requestId.localeCompare(right.requestId)
);
const requestId = matchingBindings[0]?.requestId;

if (!requestId) {
  writeHookResult({
    systemMessage: "Automation lifecycle adapter found no matching disposable request binding; no continuation was requested and workflow history was not changed."
  });
  process.exit(0);
}

const tsxLoaderPath = resolve(cwd, "node_modules/tsx/dist/loader.mjs");
const gateResult = spawnSync(
  process.execPath,
  [
    "--import",
    tsxLoaderPath,
    "src/support/task-workflow/cli/gate.ts",
    "--request",
    requestId,
    "--json",
    "--host-continuation",
    "--host-continuation-active",
    String(hookInput.stop_hook_active === true)
  ],
  { cwd, encoding: "utf8" }
);

const output = gateResult.stdout.trim();
if (![0, 2].includes(gateResult.status ?? -1) || output.length === 0) {
  writeHookResult({
    continue: false,
    stopReason: `Workflow gate could not validate the lifecycle request for ${requestId}; no continuation was requested and workflow history was not changed.`
  });
  process.exit(0);
}

try {
  JSON.parse(output);
} catch {
  writeHookResult({
    continue: false,
    stopReason: `Workflow gate returned invalid lifecycle-adapter output for ${requestId}; no continuation was requested and workflow history was not changed.`
  });
  process.exit(0);
}

process.stdout.write(`${output}\n`);
