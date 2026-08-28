import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION,
  assessScriptReview,
  scriptReviewVerification,
  validateScriptReviewEvidenceFiles,
  type ScriptReviewAssessmentInput,
  type ScriptReviewRole
} from "../../../src/support/formal-execution/scriptReviewPolicy.js";

const requestId = "web/project/script-review";
const caseId = "DEMO-CASE-001";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "script-review-policy-"));
  const planPath = resolve(root, "testcases/web/project/script-review/plan.md");
  const specPath = resolve(root, "tests/web/project/script-review/example.formal.spec.ts");
  const utilityPath = resolve(root, "tests/web/project/script-review/helper.ts");
  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(dirname(specPath), { recursive: true });
  await writeFile(planPath, "# Plan\n", "utf8");
  await writeFile(
    specPath,
    `declare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const verifyNavigation: () => Promise<void>;\nformalCase("${caseId}", "read-only navigation", async () => { await verifyNavigation(); });\n`,
    "utf8"
  );
  await writeFile(utilityPath, "export const helper = true;\n", "utf8");
  return { root, planPath, specPath, utilityPath };
}

function baseInput(
  paths: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<ScriptReviewAssessmentInput> = {}
): ScriptReviewAssessmentInput {
  return {
    requestId,
    workspaceRoot: paths.root,
    planPath: paths.planPath,
    scriptPaths: [paths.specPath],
    caseIds: [caseId],
    environment: "test",
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [{ resourceType: "query", maxCreates: 0 }],
    dataWritePolicy: "no_write",
    residualTtlHours: 72,
    capabilities: ["web"],
    executionHasCleanupActivity: false,
    ...overrides
  };
}

test("script review selects levels from case and engineering risk without a request-wide floor", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));

  const light = await assessScriptReview(baseInput(paths));
  assert.equal(light.level, "light");
  assert.deepEqual(light.requiredReviewerRoles, []);
  assert.equal(light.publishable, true);
  assert.deepEqual(
    light.staticCheckResults.map((result) => result.check).sort(),
    [
      "formal_source_gate",
      "local_dependency_closure",
      "operation_outcome_evidence",
      "playwright_discovery",
      "project_typescript_compile",
      "sensitive_literal_scan"
    ]
  );
  assert.ok(light.staticCheckResults.every((result) => result.durationMilliseconds >= 0));
  assert.ok(light.staticCheckResults.every((result) => result.issues.length === 0));

  const standard = await assessScriptReview(baseInput(paths, {
    scriptPaths: [paths.specPath, paths.utilityPath]
  }));
  assert.equal(standard.level, "standard");
  assert.deepEqual(standard.requiredReviewerRoles, ["script_quality"]);
  assert.ok(standard.reasons.includes("script_count:2"));

  await writeFile(
    paths.specPath,
    `declare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const verifyNavigation: () => Promise<void>;\nconst storageState = process.env.AUTH_STATE;\nformalCase("${caseId}", "authenticated navigation", async () => { await verifyNavigation(); });\n`,
    "utf8"
  );
  const authenticatedRead = await assessScriptReview(baseInput(paths));
  assert.equal(authenticatedRead.level, "standard");
  assert.ok(authenticatedRead.reasons.includes("script_marker:authenticated_state"));

  await writeFile(
    paths.specPath,
    `declare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const sendTestOtp: () => Promise<void>;\nformalCase("${caseId}", "OTP flow", async () => { await sendTestOtp(); });\n`,
    "utf8"
  );
  const otp = await assessScriptReview(baseInput(paths));
  assert.equal(otp.level, "strict");
  assert.ok(otp.reasons.includes("script_marker:otp"));

  await writeFile(
    paths.specPath,
    `declare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const verifyNavigation: () => Promise<void>;\nformalCase("${caseId}", "read-only navigation", async () => { await verifyNavigation(); });\n`,
    "utf8"
  );
  const ordinaryWrite = await assessScriptReview(baseInput(paths, {
    allowedOperations: [
      "upload_synthetic_file",
      "query_postcondition",
      "cleanup_test_resource"
    ],
    resourceBudgets: [{ resourceType: "upload", maxCreates: 1 }],
    dataWritePolicy: "ephemeral_cleanup",
    executionHasCleanupActivity: true
  }));
  assert.equal(ordinaryWrite.level, "standard");
  assert.deepEqual(ordinaryWrite.requiredReviewerRoles, ["script_quality"]);
  assert.equal(ordinaryWrite.publishable, true);

  const ignoredRequestFloor = await assessScriptReview(baseInput(paths, {
  }));
  assert.equal(ignoredRequestFloor.level, "light");
  assert.ok(!ignoredRequestFloor.reasons.some((reason) => reason.startsWith("case_review_floor:")));

  const strictCase = await assessScriptReview(baseInput(paths, {
    caseRiskAssessments: [{
      caseId,
      level: "strict",
      reasons: ["case_operation:submit"]
    }]
  }));
  assert.equal(strictCase.level, "strict");
  assert.deepEqual(strictCase.requiredReviewerRoles, ["script_quality", "execution_safety"]);

  const production = await assessScriptReview(baseInput(paths, {
    environment: "production"
  }));
  assert.equal(production.level, "strict");
  assert.ok(production.reasons.includes("production_environment"));
});

test("script markers only upgrade the formalCase that performs the risky operation", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  const lightCaseId = "DEMO-CASE-LIGHT";
  const standardCaseId = "DEMO-CASE-STANDARD";
  const strictCaseId = "DEMO-CASE-STRICT";
  await writeFile(
    paths.specPath,
    [
      "declare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;",
      "declare const page: { getByLabel(name: string): unknown; getByRole(role: string, options: { name: string }): unknown };",
      "declare const send_test_otp: () => Promise<void>;",
      `formalCase("${lightCaseId}", "field", async () => { page.getByLabel("注册企业名称"); });`,
      `formalCase("${standardCaseId}", "OTP entrance", async () => { page.getByRole("button", { name: "获取注册短信验证码" }); });`,
      `formalCase("${strictCaseId}", "send OTP", async () => { await send_test_otp(); });`,
      "async function sharedUploadHelper(): Promise<void> { void \"upload\"; }"
    ].join("\n"),
    "utf8"
  );

  const assessment = await assessScriptReview(baseInput(paths, {
    caseIds: [lightCaseId, standardCaseId, strictCaseId],
    caseRiskAssessments: [
      { caseId: lightCaseId, level: "light", reasons: ["case_operation:field"] },
      { caseId: standardCaseId, level: "standard", reasons: ["case_operation:otp_entry"] },
      { caseId: strictCaseId, level: "strict", reasons: ["case_operation:send_otp"] }
    ]
  }));

  assert.deepEqual(
    assessment.caseRiskAssessments.map(({ caseId, level }) => ({ caseId, level })),
    [
      { caseId: lightCaseId, level: "light" },
      { caseId: standardCaseId, level: "standard" },
      { caseId: strictCaseId, level: "strict" }
    ]
  );
  assert.deepEqual(assessment.reviewerScopes.execution_safety?.caseIds, [strictCaseId]);
  assert.ok(!assessment.caseRiskAssessments[1]?.reasons.includes("script_marker:otp"));
});

test("script review blocks static failures instead of upgrading around them", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  await writeFile(
    paths.specPath,
    [
      `formalCase("${caseId}", "unsafe", async () => {`,
      '  const password = "literal-secret";',
      "  const broken = ;",
      "});"
    ].join("\n"),
    "utf8"
  );

  const assessment = await assessScriptReview(baseInput(paths));
  assert.equal(assessment.publishable, false);
  assert.match(assessment.blockingIssues.join("\n"), /TypeScript compile failed/);
  assert.match(assessment.blockingIssues.join("\n"), /sensitive-looking literal/);

  const cleanupMissing = await assessScriptReview(baseInput(paths, {
    allowedOperations: ["submit_registration"],
    resourceBudgets: [],
    dataWritePolicy: "ephemeral_cleanup",
    executionHasCleanupActivity: false
  }));
  assert.match(cleanupMissing.blockingIssues.join("\n"), /cleanup_test_resource/);
  assert.match(cleanupMissing.blockingIssues.join("\n"), /positive resource budget/);
});

test("response-contract evidence can finalize a tracked upload without a query provider", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  const assessment = await assessScriptReview(baseInput(paths, {
    allowedOperations: ["upload_synthetic_file", "retain_tracked_residual"],
    resourceBudgets: [{ resourceType: "upload", maxCreates: 1 }],
    dataWritePolicy: "tracked_residual",
    executionHasCleanupActivity: true,
    formalCases: [{
      caseId,
      title: "tracked upload",
      requiredCapabilities: [],
      requiredResources: [],
      producesResources: [],
      requiredOperations: ["upload_synthetic_file", "retain_tracked_residual"],
      operationBudgets: [{ operation: "upload_synthetic_file", maxExecutions: 1 }],
      dataWritePolicy: "tracked_residual",
      implementation: { status: "source_complete" },
      operationEvidence: [{
        operation: "upload_synthetic_file",
        strategy: "response_contract",
        responseContractId: "upload-response-v1",
        finality: "final",
        stableIdentityRequired: true
      }]
    }]
  }));
  assert.equal(assessment.publishable, true);
  assert.ok(!assessment.blockingIssues.some((issue) => issue.includes("query_postcondition")));
  assert.ok(assessment.staticChecks.includes("operation_outcome_evidence"));
});

test("light-only script changes do not invalidate strict reviewer evidence", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  const strictCaseId = "DEMO-CASE-STRICT";
  const lightCaseId = "DEMO-CASE-LIGHT";
  const strictSpec = resolve(paths.root, "tests/web/project/script-review/strict.formal.spec.ts");
  const lightSpec = resolve(paths.root, "tests/web/project/script-review/light.formal.spec.ts");
  await writeFile(
    strictSpec,
    `import { helper } from "./helper.js";\ndeclare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\nformalCase("${strictCaseId}", "strict", async () => { void helper; });\n`,
    "utf8"
  );
  await writeFile(
    lightSpec,
    `export {};\ndeclare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const verifyNavigation: () => Promise<void>;\nformalCase("${lightCaseId}", "light", async () => { await verifyNavigation(); });\n`,
    "utf8"
  );
  const input = baseInput(paths, {
    scriptPaths: [strictSpec, lightSpec],
    caseIds: [strictCaseId, lightCaseId],
    caseRiskAssessments: [
      { caseId: strictCaseId, level: "strict", reasons: ["case_operation:submit"] },
      { caseId: lightCaseId, level: "light", reasons: ["case_operation:navigate"] }
    ]
  });
  const before = await assessScriptReview(input);
  assert.deepEqual(before.reviewerScopes.execution_safety?.caseIds, [strictCaseId]);
  assert.deepEqual(before.reviewerScopes.execution_safety?.scriptPaths, [
    "tests/web/project/script-review/helper.ts",
    "tests/web/project/script-review/strict.formal.spec.ts"
  ]);
  await writeFile(
    lightSpec,
    `export {};\ndeclare const formalCase: (caseId: string, title: string, body: () => Promise<void>) => void;\ndeclare const verifyNavigation: () => Promise<void>;\nformalCase("${lightCaseId}", "light changed", async () => { await verifyNavigation(); });\n`,
    "utf8"
  );
  const after = await assessScriptReview(input);
  assert.equal(
    before.reviewerInputDigests.script_quality,
    after.reviewerInputDigests.script_quality
  );
  assert.equal(
    before.reviewerInputDigests.execution_safety,
    after.reviewerInputDigests.execution_safety
  );
  assert.notEqual(before.inputDigest, after.inputDigest);

  await writeFile(paths.utilityPath, "export const helper = false;\n", "utf8");
  const sharedDependencyChanged = await assessScriptReview(input);
  assert.notEqual(
    after.reviewerInputDigests.execution_safety,
    sharedDependencyChanged.reviewerInputDigests.execution_safety
  );
});

test("review evidence is role-complete, digest-bound and runtime-only", async (context) => {
  const paths = await fixture();
  context.after(() => rm(paths.root, { recursive: true, force: true }));
  const assessment = await assessScriptReview(baseInput(paths, {
    caseRiskAssessments: [{ caseId, level: "strict", reasons: ["case_operation:submit"] }]
  }));
  const runtimeRoot = resolve(
    paths.root,
    ".local/test-task-runtime/web/project/script-review"
  );
  const evidenceRoot = resolve(runtimeRoot, "review-evidence");
  await mkdir(evidenceRoot, { recursive: true });

  const evidencePaths = await Promise.all(
    assessment.requiredReviewerRoles.map(async (role) => {
      const path = resolve(evidenceRoot, `${role}.json`);
      await writeEvidence(
        path,
        role,
        assessment.reviewerInputDigests[role]!,
        SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION
      );
      return path;
    })
  );
  const evidence = await validateScriptReviewEvidenceFiles({
    assessment,
    evidencePaths,
    workspaceRoot: paths.root,
    runtimeRequestRoot: runtimeRoot
  });
  assert.deepEqual(evidence.map((item) => item.role), [
    "execution_safety",
    "script_quality"
  ]);
  assert.match(scriptReviewVerification({
    assessment,
    evidence,
    verification: "isolated reviewers converged"
  }), /level=strict.*evidence=execution_safety:[a-f0-9]{64},script_quality:[a-f0-9]{64}/);

  const stalePath = evidencePaths[0]!;
  const stale = JSON.parse(await readFile(stalePath, "utf8")) as Record<string, unknown>;
  stale.inputDigest = "a".repeat(64);
  await writeFile(stalePath, `${JSON.stringify(stale)}\n`, "utf8");
  await assert.rejects(
    validateScriptReviewEvidenceFiles({
      assessment,
      evidencePaths,
      workspaceRoot: paths.root,
      runtimeRequestRoot: runtimeRoot
    }),
    /stale/
  );

  const outside = resolve(paths.root, "outside.json");
  await writeEvidence(
    outside,
    "script_quality",
    assessment.reviewerInputDigests.script_quality!
  );
  await assert.rejects(
    validateScriptReviewEvidenceFiles({
      assessment,
      evidencePaths: [outside, evidencePaths[1]!],
      workspaceRoot: paths.root,
      runtimeRequestRoot: runtimeRoot
    }),
    /runtime directory/
  );
});

async function writeEvidence(
  path: string,
  role: ScriptReviewRole,
  inputDigest: string,
  schemaVersion: typeof SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION = SCRIPT_REVIEW_EVIDENCE_SCHEMA_VERSION
): Promise<void> {
  await writeFile(path, `${JSON.stringify({
    schemaVersion,
    role,
    inputDigest,
    verdict: "approved",
    findingIds: []
  }, null, 2)}\n`, "utf8");
}
