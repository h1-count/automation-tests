import { createHash } from "node:crypto";
import type { SafeJsonValue } from "./types.js";

function canonicalize(value: SafeJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON does not support non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON does not support ${typeof value}.`);
}

export function canonicalJson(value: SafeJsonValue): string {
  return canonicalize(value);
}

export function sha256Canonical(value: SafeJsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
