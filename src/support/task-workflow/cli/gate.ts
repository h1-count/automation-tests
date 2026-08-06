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

interface HostContinuationDirective {
  schemaVersion: "workflow-host-continuation-v1";
  action: "continue" | "allow_stop";
  reason: string;
  recursiveGuard?: boolean;
}

function legacyStopAdapterEnvelope(
  directive: HostContinuationDirective
): Record<string, unknown> {
  if (directive.action === "continue") {
    return { decision: "block", reason: directive.reason };
  }
  if (directive.recursiveGuard === true) {
    return { continue: false, stopReason: directive.reason };
  }
  return {};
}

function hostContinuationDirective(
  gate: WorkflowGateView,
  adapterActive: boolean
): HostContinuationDirective {
  if (isSafeWorkflowReply(gate)) {
    return {
      schemaVersion: "workflow-host-continuation-v1",
      action: "allow_stop",
      reason: gate.reply.reason
    };
  }
  const reason = [
    `测试工作流 ${gate.requestId} 尚未到达安全回复点`,
    `state=${gate.workflowState}`,
    `continuation=${gate.continuation.kind}`,
    `checkpoint=${gate.checkpoint.reason}`,
    `next=${gate.nextActions.join(",") || "none"}`,
    "继续同一请求并先运行 task:resume；不得宣称工作流完成"
  ].join("；");
  if (adapterActive) {
    return {
      schemaVersion: "workflow-host-continuation-v1",
      action: "allow_stop",
      recursiveGuard: true,
      reason: `${reason}。宿主 continuation 已使用，本次保持只读并停止递归 continuation。`
    };
  }
  if (
    !gate.checkpoint.safe
    || ["continue_now", "await_event", "wait_until"].includes(gate.continuation.kind)
  ) {
    return {
      schemaVersion: "workflow-host-continuation-v1",
      action: "continue",
      reason
    };
  }
  return {
    schemaVersion: "workflow-host-continuation-v1",
    action: "allow_stop",
    reason
  };
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
  const legacyStopAdapter = args.includes("--hook");
  if (args.includes("--host-continuation") || legacyStopAdapter) {
    const adapterActive = parseBoolean(
      option(
        args,
        legacyStopAdapter ? "--stop-hook-active" : "--host-continuation-active"
      ),
      legacyStopAdapter ? "--stop-hook-active" : "--host-continuation-active",
      false
    );
    const directive = hostContinuationDirective(gate, adapterActive);
    process.stdout.write(`${JSON.stringify(
      legacyStopAdapter ? legacyStopAdapterEnvelope(directive) : directive
    )}\n`);
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
