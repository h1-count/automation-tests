import {
  DurableWorkflowManager,
  workflowStatusText
} from "../workflowManager.js";

function requestArgument(args: string[]): string {
  const index = args.indexOf("--request");
  const request = index >= 0 ? args[index + 1] : undefined;
  if (!request) throw new Error("Usage: task:status -- --request <type/project/test-request>");
  return request;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requestId = requestArgument(args);
  const manager = new DurableWorkflowManager(requestId);
  if (!manager.exists()) {
    throw new Error(
      `No workflow history exists for ${requestId}; initialize a new request first.`
    );
  }
  const view = await manager.gate();
  process.stdout.write(
    `${args.includes("--json") ? JSON.stringify(view, null, 2) : workflowStatusText(view)}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
