import {
  assertExactFormalWebCoverage,
  assertFormalWebCoveragePlan,
  type FormalWebCoveragePlan
} from "./webScriptCoverage.js";
import type { FormalWebScriptSpec } from "./webScriptCompiler.js";

export type WebScriptCoverageGateCategory =
  | "coverage_gap"
  | "oracle_gap"
  | "asset_gap"
  | "operation_evidence_gap";

export interface WebScriptCoverageGateIssue {
  category: WebScriptCoverageGateCategory;
  coverageId: string;
  message: string;
}

export interface WebScriptCoverageGateReport {
  schemaVersion: "web-script-coverage-gate-v1";
  coveragePlanDigest: string;
  coveredCount: number;
  issues: WebScriptCoverageGateIssue[];
}

/**
 * Verifies the build's actual contract: a confirmed execution row is not
 * considered implemented merely because its parent formalCase exists.
 */
export function assessWebScriptCoverageGate(input: {
  spec: FormalWebScriptSpec;
  coveragePlan: FormalWebCoveragePlan;
}): WebScriptCoverageGateReport {
  const { spec, coveragePlan } = input;
  assertFormalWebCoveragePlan(coveragePlan);
  assertExactFormalWebCoverage({
    plan: coveragePlan,
    coveragePlanDigest: spec.coveragePlanDigest,
    steps: spec.cases.flatMap((entry) => entry.steps.map((step) => ({
      caseId: entry.caseId,
      coverageId: step.coverageId
    })))
  });
  const entries = new Map(coveragePlan.entries.map((entry) => [entry.coverageId, entry]));
  const issues: WebScriptCoverageGateIssue[] = [];
  for (const testCase of spec.cases) {
    for (const step of testCase.steps) {
      const coverage = entries.get(step.coverageId)!;
      const hasInteraction = step.actions.some((action) => ![
        "goto",
        "expect_role_visible",
        "expect_role_text",
        "expect_role_value",
        "expect_validation_message",
        "expect_url"
      ].includes(action.kind));
      const hasBusinessCheck = step.oracle.checks.some((check) => ![
        "role_visible",
        "url"
      ].includes(check.kind));
      if (hasInteraction && !hasBusinessCheck) {
        issues.push({
          category: "oracle_gap",
          coverageId: coverage.coverageId,
          message: `${coverage.coverageId} has an interactive action but only a generic container/navigation oracle.`
        });
      }
      // 「未上传/无文件」等否定式状态描述不是上传操作；与 isFinalOperationAction 同理，
      // 不从用例文字中的名词推断动作，只有肯定式上传/文件操作才要求冻结资产动作。
      const operativeActionText = coverage.action.replace(/(?:未|不|无)上传/gu, "");
      if (/上传|文件/u.test(operativeActionText)
        && !step.actions.some((action) => action.kind === "set_files_label")) {
        issues.push({
          category: "asset_gap",
          coverageId: coverage.coverageId,
          message: `${coverage.coverageId} requires a frozen file asset action.`
        });
      }
      if (isFinalOperationAction(coverage.action)
        && testCase.dataWritePolicy === "no_write") {
        issues.push({
          category: "operation_evidence_gap",
          coverageId: coverage.coverageId,
          message: `${coverage.coverageId} describes a final operation but the case is frozen as no_write.`
        });
      }
    }
  }
  return {
    schemaVersion: "web-script-coverage-gate-v1",
    coveragePlanDigest: coveragePlan.digest,
    coveredCount: coveragePlan.entries.length,
    issues
  };
}

/** Do not infer a mutation merely from a product/API noun in testcase prose. */
function isFinalOperationAction(action: string): boolean {
  return /(?:点击|调用|发送|执行).{0,24}(?:提交|保存|创建|删除|上传)|(?:提交|保存|创建|删除|上传).{0,24}(?:请求|接口|表单|操作)/u.test(action);
}

export function assertWebScriptCoverageGate(report: WebScriptCoverageGateReport): void {
  if (report.issues.length) {
    const details = report.issues.map((item) => `${item.category}:${item.coverageId}`).join(", ");
    throw new Error(`web_script_coverage_gate_failed: ${details}`);
  }
}
