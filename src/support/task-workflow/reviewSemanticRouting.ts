import type { ReviewBatchScopeV3 } from "./reviewBatchScope.js";

export interface SemanticReviewRoute {
  requiredActivityIds: string[];
  affectedRefs: string[];
}

/**
 * Routes a re-review from the frozen per-role semantic digests. A role whose
 * visible scope did not change keeps its prior durable evidence; no heuristic
 * text matching or model judgment participates in this decision.
 */
export function routeSemanticReview(input: {
  scope: ReviewBatchScopeV3;
  allActivityIds: string[];
  baselineRoleInputDigests: Record<string, string>;
  currentRoleInputDigests: Record<string, string>;
}): SemanticReviewRoute | undefined {
  const active = new Set(input.allActivityIds);
  const changed = input.scope.roleScopes.filter((roleScope) =>
    active.has(roleScope.activityId)
    && input.baselineRoleInputDigests[roleScope.activityId]
      !== input.currentRoleInputDigests[roleScope.activityId]
  );
  if (!changed.length) return undefined;
  return {
    requiredActivityIds: changed.map((roleScope) => roleScope.activityId).sort(),
    affectedRefs: [...new Set(changed.flatMap((roleScope) => [
      ...roleScope.caseIds,
      ...roleScope.requirementRefs,
      ...roleScope.ruleRefs
    ]))].sort()
  };
}
