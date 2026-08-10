import { createHash } from "node:crypto";
import type { SafeJsonValue } from "../task-workflow/types.js";
import { sha256Canonical } from "../task-workflow/canonicalJson.js";
import type { FormalBuildEvidenceDefinition } from "./types.js";

const volatileBuildKeys = new Set([
  "targetBuildDigest",
  "verifiedAt",
  "checkedAt",
  "generatedAt",
  "capturedAt",
  "observedAt"
]);

export function semanticBuildEvidenceDigest(
  kind: FormalBuildEvidenceDefinition["kind"],
  content: Buffer
): string {
  if (kind === "test_asset") {
    return createHash("sha256").update(content).digest("hex");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    return createHash("sha256").update(content).digest("hex");
  }
  return sha256Canonical(semanticBuildEvidenceValue(parsed) as SafeJsonValue);
}

export function semanticBuildEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticBuildEvidenceValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !volatileBuildKeys.has(key))
      .map(([key, item]) => [key, semanticBuildEvidenceValue(item)])
  );
}
