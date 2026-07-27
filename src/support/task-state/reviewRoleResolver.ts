import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { baseReviewRoles, type ReviewRole } from "./types.js";

function section(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const end = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, end < 0 ? undefined : end);
}

/** Resolves roles only from auditable request assets. This avoids allowing an
 * orchestrator to omit a role that is required by the plan's own RULE data. */
export function resolveRequiredReviewRoles(planPath: string): ReviewRole[] {
  const resolvedPlanPath = resolve(planPath);
  const plan = readFileSync(resolvedPlanPath, "utf8");
  const ruleLedger = section(plan, "## 规则覆盖台账");
  const interactionRequired = ruleLedger.split("\n").some((line) =>
    line.trim().startsWith("|") && /\|\s*(页面交互|状态流转)\s*\|/.test(line) && !/\|\s*不适用\s*\|/.test(line)
  );
  const changeSection = section(plan, "## 变更影响分析");
  const changeRecorded = changeSection.split("\n").some((line) =>
    line.trim().startsWith("|") && !/^\|\s*-/.test(line) && !line.includes("变更编号") && !/^\|\s*无\s*\|/.test(line)
  );
  const requestDirectory = resolve(resolvedPlanPath, "..");
  const highRiskCase = readdirSync(requestDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^cases-.*\.md$/.test(entry.name))
    .some((entry) => /\|\s*风险等级\s*\|\s*高\s*\|/.test(readFileSync(join(requestDirectory, entry.name), "utf8")));
  const roles: ReviewRole[] = [...baseReviewRoles];
  if (interactionRequired) roles.push("交互与状态专项评审");
  if (changeRecorded || highRiskCase) roles.push("变更影响评审");
  return roles;
}
