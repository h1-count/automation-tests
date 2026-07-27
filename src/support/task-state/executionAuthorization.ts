import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TestTaskStateManager } from "./testTaskStateManager.js";
import type { ExecutionAuthorizationSnapshot, ExecutionOperationKind } from "./types.js";

export async function loadConfirmedExecutionAuthorization(
  requestId: string,
  expectedEnvironment?: string,
  requiredOperations: ExecutionOperationKind[] = []
): Promise<ExecutionAuthorizationSnapshot> {
  const manager = new TestTaskStateManager(requestId);
  const state = await manager.read();
  const snapshot = state?.executionAuthorization;
  if (!state || !snapshot || snapshot.status !== "confirmed") {
    throw new Error("Formal execution requires a confirmed immutable execution authorization.");
  }
  if (expectedEnvironment && snapshot.environment !== expectedEnvironment) {
    throw new Error("Execution environment differs from the confirmed authorization.");
  }
  if (requiredOperations.some((operation) => !snapshot.allowedOperations.includes(operation))) {
    throw new Error("The formal script requests an operation outside the confirmed authorization.");
  }
  if (!state.planPath || digestFile(resolve(state.planPath)) !== snapshot.planDigest) {
    throw new Error("plan.md changed after execution authorization; reopen engineering design and review.");
  }
  for (const script of snapshot.scriptDigests) {
    if (digestFile(resolve(script.path)) !== script.digest) {
      throw new Error(`Script changed after execution authorization: ${script.path}`);
    }
  }
  return snapshot;
}

function digestFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
