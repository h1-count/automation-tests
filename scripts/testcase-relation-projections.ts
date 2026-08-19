import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  CASE_RELATION_PROJECTION_MARKER_V3,
  projectRelationProjection,
  validateRelationProjection,
  type RelationIssue
} from "../src/support/testcase/relationProjection.ts";

export {
  CASE_RELATION_PROJECTION_MARKER_V3
};
export type ProjectionIssue = RelationIssue;
export type SyncResult = { changedFiles: string[]; issues: ProjectionIssue[]; strict: boolean };

/** File-system adapter for the pure testcase relation projection. */
export function synchronizeRequest(requestDirectory: string, options: { check?: boolean } = {}): SyncResult {
  const directory = resolve(requestDirectory);
  const planPath = join(directory, "plan.md");
  const designPath = join(directory, "design.md");
  // Suite layout keeps the rule ledger in design.md; request layout uses plan.md.
  const ledgerPath = existsSync(planPath) ? planPath : designPath;
  const originalPlan = readFileSync(ledgerPath, "utf8");
  const strict = originalPlan.includes(CASE_RELATION_PROJECTION_MARKER_V3);
  if (!strict) return { changedFiles: [], strict: false, issues: [{ name: "关系投影契约", detail: `${directory} 不是当前 case-relation-projection-v3 资产，拒绝同步。` }] };
  const packagePaths = readdirSync(directory, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile()
      && /^(?:cases|cases-[a-z0-9][a-z0-9-]*)\.md$/.test(entry.name)
    )
    .map((entry) => entry.name);
  const packages = Object.fromEntries(packagePaths.map((name) => [name, readFileSync(join(directory, name), "utf8")]));
  const sourceIssues = options.check ? validateRelationProjection(originalPlan, packages) : [];
  if (sourceIssues.length) return { changedFiles: [], strict, issues: sourceIssues };
  const projection = projectRelationProjection(originalPlan, packages);
  if (projection.issues.length) return { changedFiles: [], strict, issues: projection.issues };
  const changedFiles = [ledgerPath, ...packagePaths.map((name) => join(directory, name))]
    .filter((path) => path === ledgerPath ? projection.plan !== originalPlan : projection.packages[basename(path)] !== packages[basename(path)]);
  if (options.check && changedFiles.length) return { changedFiles: [], strict, issues: changedFiles.map((path) => ({ name: "派生视图未同步", detail: `${basename(path)} 与 RULE → caseId 关系源不一致；运行 testcases:sync-relations 修复。` })) };
  if (!options.check) {
    if (projection.plan !== originalPlan) writeFileSync(ledgerPath, projection.plan, "utf8");
    for (const name of packagePaths) if (projection.packages[name] !== packages[name]) writeFileSync(join(directory, name), projection.packages[name]!, "utf8");
  }
  return { changedFiles, strict, issues: [] };
}
