import { resolve } from "node:path";
import { TaskStateStore } from "./taskStateStore.js";
import { renderCompactStatusCard, renderTaskOutputCard } from "./render.js";

function readRequestArgument(args: string[]): string {
  const index = args.indexOf("--request");
  const request = index >= 0 ? args[index + 1] : undefined;
  if (!request) throw new Error("Usage: test-task:status -- --request <type/project/test-request>");
  return request;
}

async function main(): Promise<void> {
  const requestId = readRequestArgument(process.argv.slice(2));
  const store = new TaskStateStore(requestId, resolve(process.cwd(), ".local/test-task-state"));
  const state = await store.read();
  if (!state) throw new Error(`No local task state exists for ${requestId}.`);
  process.stdout.write(`${renderCompactStatusCard(state)}\n\n${renderTaskOutputCard(state, process.cwd())}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
