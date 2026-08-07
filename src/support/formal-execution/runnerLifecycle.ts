import type { FormalSettlement } from "./finalize.js";

export type FormalTeardownPhase =
  | "browser"
  | "formal-settlement"
  | "capability"
  | "artifacts";

export interface FormalTeardownError {
  phase: FormalTeardownPhase;
  error: Error;
}

export interface FormalTeardownResult {
  settlement?: FormalSettlement;
  removedArtifacts: string[];
  errors: FormalTeardownError[];
}

export interface FormalTeardownActions {
  closeBrowser(): Promise<void>;
  settle(): Promise<FormalSettlement | undefined>;
  cleanupCapabilities(): Promise<void>;
  sanitizeArtifacts(): Promise<string[]>;
}

export async function runFormalTeardown(
  actions: FormalTeardownActions
): Promise<FormalTeardownResult> {
  const result: FormalTeardownResult = { removedArtifacts: [], errors: [] };
  await capture("browser", actions.closeBrowser, result.errors);
  result.settlement = await capture(
    "formal-settlement",
    actions.settle,
    result.errors
  );
  await capture("capability", actions.cleanupCapabilities, result.errors);
  result.removedArtifacts = await capture(
    "artifacts",
    actions.sanitizeArtifacts,
    result.errors
  ) ?? [];
  return result;
}

export function formalRunnerExitCode(input: {
  settlement?: FormalSettlement;
  runnerError?: Error;
  playwrightFailed: boolean;
  teardownErrors: FormalTeardownError[];
}): 0 | 1 | 2 {
  if (input.runnerError || input.playwrightFailed || input.teardownErrors.length > 0) return 1;
  if (!input.settlement) return 1;
  if (input.settlement.summary.counts.failed > 0) return 1;
  if (input.settlement.kind === "parked") return 2;
  if (
    !input.settlement.summary.complete
    || input.settlement.summary.counts.blocked > 0
    || input.settlement.summary.counts.unknown > 0
    || input.settlement.cleanup.status === "failed"
  ) {
    return 2;
  }
  return 0;
}

async function capture<T>(
  phase: FormalTeardownPhase,
  action: () => Promise<T>,
  errors: FormalTeardownError[]
): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    errors.push({
      phase,
      error: error instanceof Error ? error : new Error(`Unknown ${phase} teardown failure.`)
    });
    return undefined;
  }
}
