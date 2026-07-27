import { TestTaskStateManager } from "./testTaskStateManager.js";

function required(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requestId = required(args, "--request");
  const envelope = await new TestTaskStateManager(requestId).executionEnvelope();
  const output = args.includes("--json")
    ? JSON.stringify(envelope)
    : `${envelope.state}: ${envelope.nextAction?.action ?? envelope.reply.reason}`;
  process.stdout.write(`${output}\n`);
  if (args.includes("--assert-final") && !envelope.reply.allowed) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
