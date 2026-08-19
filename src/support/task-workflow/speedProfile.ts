/**
 * Review speed profiles.
 *
 * The candidate gate derives `reviewMode` from risk markers in the plan and
 * cases (e.g. mere mentions of 验证码/OTP push a no_write suite to
 * `combined_with_impact`, doubling isolated reviewer sessions and easily
 * adding 20+ minutes). Speed profiles cap that derivation:
 *
 * - `fast`: design-only speed. no_write runs skip reviewers entirely
 *   (deterministic gates only); any effective data write still gets one
 *   `combined` reviewer. SEMANTIC findings go straight into the single user
 *   confirmation as decision rows; the (single) evolution cycle may be used
 *   only to apply deterministic structural fixes.
 * - `balanced`: one `combined` reviewer maximum (impact reviewer dropped
 *   unless… still dropped; writes surface through the combined scope).
 * - `strict`: today's behavior — full role derivation, one evolution cycle.
 *
 * Default selection: `testcase_only` + `writesData === false` → `fast`;
 * everything else → `strict`. Explicit `--speed` always wins.
 */
export const REVIEW_SPEEDS = ["fast", "balanced", "strict"] as const;
export type ReviewSpeed = (typeof REVIEW_SPEEDS)[number];

export function parseReviewSpeed(value: string | undefined): ReviewSpeed | undefined {
  if (value === undefined || value === "") return undefined;
  if (!(REVIEW_SPEEDS as readonly string[]).includes(value)) {
    throw new Error(`--speed must be one of: ${REVIEW_SPEEDS.join(", ")}.`);
  }
  return value as ReviewSpeed;
}

export function defaultReviewSpeed(input: {
  deliveryTarget?: string;
  writesData: boolean;
}): ReviewSpeed {
  return input.deliveryTarget === "testcase_only" && !input.writesData
    ? "fast"
    : "strict";
}

export function resolveReviewSpeed(input: {
  requested?: ReviewSpeed;
  deliveryTarget?: string;
  writesData: boolean;
}): ReviewSpeed {
  return input.requested ?? defaultReviewSpeed(input);
}

/**
 * Cap a risk-derived review mode by speed. `fast` keeps one combined reviewer
 * only when the suite effectively writes data; `balanced` keeps at most one
 * combined reviewer; `strict` (and legacy undefined) keeps the derivation.
 */
export function capReviewMode(
  speed: ReviewSpeed | undefined,
  derived: "combined_with_impact" | "combined" | "deterministic_only",
  effectiveWritesData: boolean
): "combined_with_impact" | "combined" | "deterministic_only" {
  if (speed === undefined || speed === "strict") return derived;
  if (speed === "fast") {
    return effectiveWritesData ? "combined" : "deterministic_only";
  }
  // balanced: at most one combined reviewer, regardless of writes.
  return derived === "deterministic_only" && !effectiveWritesData
    ? "deterministic_only"
    : "combined";
}
