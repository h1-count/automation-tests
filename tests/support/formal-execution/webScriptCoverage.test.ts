import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertExactFormalWebCoverage,
  deriveFormalWebCoveragePlan
} from "../../../src/support/formal-execution/webScriptCoverage.js";
import {
  assessWebScriptCoverageGate,
  assertWebScriptCoverageGate
} from "../../../src/support/formal-execution/webScriptCoverageGate.js";
import type { FormalWebScriptSpec } from "../../../src/support/formal-execution/webScriptCompiler.js";
import { applyFormalWebScriptRepairProposal } from "../../../src/support/formal-execution/webScriptCompiler.js";

const cases = readFileSync("testcases/web/open-platform/suites/login-register/cases.md", "utf8");

function specForCoverage(plan: ReturnType<typeof deriveFormalWebCoveragePlan>): FormalWebScriptSpec {
  const caseId = "OPEN-REG-001";
  return {
    schemaVersion: "formal-web-script-spec-v1",
    requestId: "web/open-platform/coverage-test",
    suiteId: "web/open-platform/login-register",
    projectId: "open-platform",
    environment: "test",
    selectedCaseIds: [caseId],
    sourceContract: { targetBuildDigest: "a".repeat(64) },
    coveragePlanDigest: plan.digest,
    resourceBudgets: [],
    cases: [{
      caseId,
      title: "企业名称字段校验",
      route: "/login?tab=register",
      ruleRef: "RULE-REG-001",
      permissionProfile: "read_only",
      dataWritePolicy: "no_write",
      requiredOperations: [],
      noWriteNetworkPolicy: { reviewedReadOnlyRequests: [], forbiddenMutationPaths: ["/registration"] },
      steps: plan.entries.map((entry, index) => ({
        coverageId: entry.coverageId,
        stepId: `D${String(index + 1).padStart(2, "0")}`,
        title: entry.expected,
        actions: [
          { kind: "fill_role" as const, role: "textbox", name: "企业名称", value: { kind: "frozen_data" as const, dataId: entry.dataId!, value: `样例${index}` } },
          { kind: "blur_role" as const, role: "textbox", name: "企业名称" }
        ],
        oracle: {
          oracleId: `ORACLE-${entry.coverageId}`,
          observationKind: "dom",
          authorities: [{ kind: "formal_user_decision", decisionType: "confirmed_testcase_set", subjectDigest: "b".repeat(64) }],
          checks: [{ kind: "validation_message", text: entry.expected }]
        }
      }))
    }]
  };
}

test("coverage plan freezes every execution data row for OPEN-REG-001", () => {
  const plan = deriveFormalWebCoveragePlan({ cases, selectedCaseIds: ["OPEN-REG-001"] });
  assert.deepEqual(plan.entries.map((entry) => entry.coverageId), [
    "OPEN-REG-001#D01-R01", "OPEN-REG-001#D02-R02", "OPEN-REG-001#D03-R03",
    "OPEN-REG-001#D04-R04", "OPEN-REG-001#D05-R05", "OPEN-REG-001#D06-R06",
    "OPEN-REG-001#D07-R07"
  ]);
});

test("coverage gate rejects a missing confirmed execution row before script publishing", () => {
  const plan = deriveFormalWebCoveragePlan({ cases, selectedCaseIds: ["OPEN-REG-001"] });
  const spec = specForCoverage(plan);
  spec.cases[0]!.steps.pop();
  assert.throws(() => assertExactFormalWebCoverage({
    plan,
    coveragePlanDigest: spec.coveragePlanDigest,
    steps: spec.cases[0]!.steps.map((step) => ({ caseId: "OPEN-REG-001", coverageId: step.coverageId }))
  }), /coverage_gap/);
});

test("coverage gate rejects a generic visible-container oracle after a field interaction", () => {
  const plan = deriveFormalWebCoveragePlan({ cases, selectedCaseIds: ["OPEN-REG-001"] });
  const spec = specForCoverage(plan);
  spec.cases[0]!.steps[0]!.oracle.checks = [{ kind: "role_visible", role: "form", name: "企业注册申请表单" }];
  const report = assessWebScriptCoverageGate({ spec, coveragePlan: plan });
  assert.throws(() => assertWebScriptCoverageGate(report), /oracle_gap:OPEN-REG-001#D01-R01/);
});

test("structured repair can add only a missing frozen coverage row", () => {
  const plan = deriveFormalWebCoveragePlan({ cases, selectedCaseIds: ["OPEN-REG-001"] });
  const spec = specForCoverage(plan);
  const missing = spec.cases[0]!.steps.pop()!;
  const repaired = applyFormalWebScriptRepairProposal({
    spec,
    coveragePlan: plan,
    proposal: {
      schemaVersion: "formal-web-script-repair-proposal-v1",
      coveragePlanDigest: plan.digest,
      steps: [{ caseId: "OPEN-REG-001", step: missing }]
    }
  });
  assert.deepEqual(repaired.report.repairedCoverageIds, [missing.coverageId]);
  assert.deepEqual(repaired.report.unresolved, []);
  assert.doesNotThrow(() => assessWebScriptCoverageGate({ spec: repaired.spec, coveragePlan: plan }));

  assert.throws(() => applyFormalWebScriptRepairProposal({
    spec,
    coveragePlan: plan,
    proposal: {
      schemaVersion: "formal-web-script-repair-proposal-v1",
      coveragePlanDigest: plan.digest,
      steps: [{ caseId: "OPEN-REG-001", step: { ...missing, coverageId: "OPEN-REG-018#D01-R01" } }]
    }
  }), /only add each missing frozen coverage row/);
});
