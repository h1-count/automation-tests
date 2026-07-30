import {
  DurableWorkflowManager,
  isSafeWorkflowReply,
  workflowStatusText,
  type WorkflowGateView
} from "../workflowManager.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function parseBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function stopHookEnvelope(
  gate: WorkflowGateView,
  stopHookActive: boolean
): Record<string, unknown> {
  if (isSafeWorkflowReply(gate)) return {};
  const reason = [
    `测试工作流 ${gate.requestId} 尚未到达安全回复点`,
    `state=${gate.workflowState}`,
    `continuation=${gate.continuation.kind}`,
    `checkpoint=${gate.checkpoint.reason}`,
    `next=${gate.nextActions.join(",") || "none"}`,
    "继续同一请求并先运行 task:resume；不得宣称工作流完成"
  ].join("；");
  if (stopHookActive) {
    return {
      continue: false,
      stopReason: `${reason}。Stop Hook continuation 已使用，本次保持只读并停止递归 continuation。`
    };
  }
  if (
    !gate.checkpoint.safe
    || ["continue_now", "await_event", "wait_until"].includes(gate.continuation.kind)
  ) {
    return { decision: "block", reason };
  }
  return {};
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requestId = required(args, "--request");
  const manager = new DurableWorkflowManager(requestId);
  if (!manager.exists()) {
    throw new Error(
      `No workflow history exists for ${requestId}; initialize a new request first.`
    );
  }
  const gate = await manager.gate();
  if (args.includes("--hook")) {
    const stopHookActive = parseBoolean(
      option(args, "--stop-hook-active"),
      "--stop-hook-active",
      false
    );
    process.stdout.write(`${JSON.stringify(stopHookEnvelope(gate, stopHookActive))}\n`);
  } else {
    process.stdout.write(
      `${args.includes("--json") ? JSON.stringify(gate) : workflowStatusText(gate)}\n`
    );
  }
  if (args.includes("--assert-safe-reply") && !isSafeWorkflowReply(gate)) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
