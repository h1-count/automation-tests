import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveFormalRunnerAdapter } from "../src/support/formal-execution/runnerAdapters.js";

const args = process.argv.slice(2);
const requestIndex = args.indexOf("--request");
const requestId = requestIndex >= 0 ? args[requestIndex + 1]?.trim() : "";
if (!requestId) {
  throw new Error(
    "Usage: npm run test:execute -- --request <web|h5|app|api|mqtt|iot>/<project>/<request> [--resume] [--headed]"
  );
}
const adapter = resolveFormalRunnerAdapter(requestId);
if (!adapter.implemented || !adapter.runnerScript) {
  throw new Error(
    `Formal ${adapter.type} runner adapter is not implemented; readiness must keep this request deferred instead of invoking an ungoverned command.`
  );
}
const runner = resolve(process.cwd(), "node_modules/.bin/tsx");
if (!existsSync(runner)) throw new Error("The local tsx executable is unavailable.");
const exitCode = await run(runner, [
  adapter.runnerScript,
  ...args
]);
process.exitCode = exitCode;

function run(command: string, commandArgs: string[]): Promise<number> {
  return new Promise((accept, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Formal runner was interrupted by ${signal}.`));
      else accept(code ?? 1);
    });
  });
}
