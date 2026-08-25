import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { atomicWriteText } from "../test-data/ledgerStore.js";
import { canonicalJson } from "./canonicalJson.js";

export const RUN_INTENT_SCHEMA_VERSION = "run-intent-v1" as const;

export type RunIntentDecision = "direct_execute" | "design_reconfirm" | "affected_rebuild" | "full_replan";

/**
 * Request-scoped, machine-readable proof of a reuse decision. It deliberately
 * carries identities and policy summaries only: business requirement prose
 * remains in the stable suite, and candidate plan prose remains candidate-only.
 */
export interface RunIntent {
  schemaVersion: typeof RUN_INTENT_SCHEMA_VERSION;
  suiteId: string;
  suiteVersion?: string;
  reuseDecision: RunIntentDecision;
  assessmentDigest: string;
  environment: string;
  deliveryTarget: "testcase_only" | "script_only" | "full_run";
  selectedCaseIds: string[];
  affectedCaseIds: string[];
  sourceDigest: string;
  boundaryDigest: string;
  safeRefs: string[];
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function runIntentDigest(intent: RunIntent): string {
  return sha256(canonicalJson(intent as unknown as import("./types.js").SafeJsonValue));
}

export function runIntentPath(runRoot: string): string {
  return resolve(runRoot, "run-intent.json");
}

export async function writeRunIntent(path: string, intent: RunIntent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteText(path, `${JSON.stringify(intent, null, 2)}\n`);
}

export async function readRunIntent(path: string): Promise<RunIntent> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<RunIntent>;
  if (raw.schemaVersion !== RUN_INTENT_SCHEMA_VERSION
    || typeof raw.suiteId !== "string"
    || typeof raw.reuseDecision !== "string"
    || typeof raw.assessmentDigest !== "string"
    || typeof raw.environment !== "string"
    || typeof raw.deliveryTarget !== "string"
    || !Array.isArray(raw.selectedCaseIds)
    || !Array.isArray(raw.affectedCaseIds)
    || typeof raw.sourceDigest !== "string"
    || typeof raw.boundaryDigest !== "string"
    || !Array.isArray(raw.safeRefs)) {
    throw new Error(`Invalid ${RUN_INTENT_SCHEMA_VERSION} document: ${path}`);
  }
  return raw as RunIntent;
}
