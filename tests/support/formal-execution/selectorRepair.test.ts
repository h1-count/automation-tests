import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import type { ExecutionAuthorizationSnapshot } from "../../../src/support/formal-execution/authorization.js";
import type {
  FormalExecutionManifest,
  FormalExecutionRecord
} from "../../../src/support/formal-execution/types.js";
import {
  applySelectorRepairIncident,
  assessSelectorRepairRecovery,
  loadSelectorRepairIncident,
  recordSelectorRepairIncident,
  selectorValuesRelated
} from "../../../src/support/formal-execution/selectorRepair.js";

const requestId = "web/project/selector-repair";
const scriptPath = "tests/web/project/selector-repair/login.formal.spec.ts";

function source(name = "登录", businessAssertion = false): string {
  return [
    "async function candidate(page: unknown, runtime: unknown) {",
    "  return guardedRoleLocator({",
    "    page,",
    "    runtime,",
    '    caseId: "LOGIN-001",',
    '    selectorId: "account-password-login",',
    `    sourcePath: "${scriptPath}",`,
    '    role: "button",',
    `    name: ${JSON.stringify(name)},`,
    '    scopeId: "login-form",',
    '    stateId: "account-password-mode",',
    '    action: "click",',
    `    businessAssertion: ${businessAssertion}`,
    "  });",
    "}",
    ""
  ].join("\n");
}

function snapshot(scriptDigest: string): ExecutionAuthorizationSnapshot {
  return {
    schemaVersion: "execution-authorization-v1",
    mode: "request",
    requestId,
    environment: "test",
    planDigest: "1".repeat(64),
    scriptDigests: [{ path: scriptPath, digest: scriptDigest }],
    caseIds: ["LOGIN-001", "LOGIN-002"],
    allowedOperations: ["authenticate_test_account"],
    resourceBudgets: [],
    dataWritePolicy: "no_write",
    residualTtlHours: 72,
    securityChallengePolicy: "test-channel-first-minimal-human",
    artifactPolicy: "retain-with-sensitive-step-redaction",
    targetBuildDigest: "2".repeat(64),
    runnableCaseIds: ["LOGIN-001", "LOGIN-002"],
    deferredCases: [],
    capabilityEvidence: [],
    selectorEvidenceDigests: ["3".repeat(64)],
    scriptReview: { level: "standard", evidenceDigests: ["4".repeat(64)] },
    readinessDigest: "5".repeat(64),
    caseScopes: [],
    resourcePoolBudgets: [],
    resourcePoolEvidence: [],
    digest: "6".repeat(64),
    status: "confirmed",
    createdAt: "2026-08-14T00:00:00.000Z",
    confirmedAt: "2026-08-14T00:01:00.000Z",
    confirmationId: "selector-repair-confirmation"
  };
}

const safeProof = {
  safe: true,
  completedStageCount: 0,
  transitionCount: 0,
  dataIntentCount: 0,
  dataResourceCount: 0,
  operationReservationCount: 0,
  producedResourceCount: 0
} as const;

test("records and applies one exact accessible-name selector repair without fallback action", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-repair-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const absoluteScript = resolve(root, scriptPath);
  await mkdir(dirname(absoluteScript), { recursive: true });
  const original = source();
  await writeFile(absoluteScript, original, "utf8");
  const authorization = snapshot(createHash("sha256").update(original).digest("hex"));

  const recorded = await recordSelectorRepairIncident({
    snapshot: authorization,
    caseId: "LOGIN-001",
    attempt: 1,
    sourcePath: scriptPath,
    selectorId: "account-password-login",
    candidateName: "账号密码登录",
    observedCandidateCount: 1,
    candidateActionable: true,
    failureCode: "accessible_name_drift",
    sideEffectProof: safeProof,
    workspaceRoot: root,
    recordedAt: "2026-08-14T00:02:00.000Z"
  });

  assert.equal(recorded.incident.eligibility.status, "eligible");
  assert.equal(recorded.incident.expected.value, "登录");
  assert.equal(recorded.incident.candidate?.value, "账号密码登录");
  const loaded = await loadSelectorRepairIncident(recorded.reference.path, root);
  assert.equal(loaded.digest, recorded.incident.digest);
  assert.equal(await applySelectorRepairIncident(loaded, root), "applied");
  const updated = await readFile(absoluteScript, "utf8");
  assert.equal(updated, source("账号密码登录"));
  assert.equal(await applySelectorRepairIncident(loaded, root), "already_applied");
});

test("rejects ambiguous, unsafe, semantic, and source-drift repairs", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-repair-reject-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const absoluteScript = resolve(root, scriptPath);
  await mkdir(dirname(absoluteScript), { recursive: true });
  const original = source();
  await writeFile(absoluteScript, original, "utf8");
  const authorization = snapshot(createHash("sha256").update(original).digest("hex"));

  const ambiguous = await recordSelectorRepairIncident({
    snapshot: authorization,
    caseId: "LOGIN-001",
    attempt: 1,
    sourcePath: scriptPath,
    selectorId: "account-password-login",
    observedCandidateCount: 2,
    candidateActionable: false,
    failureCode: "selector_not_unique",
    sideEffectProof: safeProof,
    workspaceRoot: root
  });
  assert.equal(ambiguous.incident.eligibility.status, "rejected");
  await assert.rejects(
    applySelectorRepairIncident(ambiguous.incident, root),
    /Only an eligible/
  );

  const unsafe = await recordSelectorRepairIncident({
    snapshot: authorization,
    caseId: "LOGIN-001",
    attempt: 1,
    sourcePath: scriptPath,
    selectorId: "account-password-login",
    candidateName: "账号密码登录",
    observedCandidateCount: 1,
    candidateActionable: true,
    failureCode: "accessible_name_drift",
    sideEffectProof: { ...safeProof, safe: false, operationReservationCount: 1 },
    workspaceRoot: root
  });
  assert.equal(unsafe.incident.eligibility.status, "rejected");

  await writeFile(absoluteScript, source("登录", true), "utf8");
  const semanticSnapshot = snapshot(
    createHash("sha256").update(source("登录", true)).digest("hex")
  );
  await assert.rejects(
    recordSelectorRepairIncident({
      snapshot: semanticSnapshot,
      caseId: "LOGIN-001",
      attempt: 1,
      sourcePath: scriptPath,
      selectorId: "account-password-login",
      candidateName: "账号密码登录",
      observedCandidateCount: 1,
      candidateActionable: true,
      failureCode: "accessible_name_drift",
      sideEffectProof: safeProof,
      workspaceRoot: root
    }),
    /unsupported repair contract/
  );
});

test("uses containment only and does not fuzzy-match unrelated selector names", () => {
  assert.equal(selectorValuesRelated("登录", "账号密码登录"), true);
  assert.equal(selectorValuesRelated("登录", "验证码登录"), true);
  assert.equal(selectorValuesRelated("登录", "登录"), false);
  assert.equal(selectorValuesRelated("登录", "提交"), false);
});

test("recovery accepts only a one-to-one terminal selector set and carries conclusive independent cases", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-repair-recovery-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const absoluteScript = resolve(root, scriptPath);
  const original = source();
  await mkdir(dirname(absoluteScript), { recursive: true });
  await writeFile(absoluteScript, original, "utf8");
  const authorization = snapshot(createHash("sha256").update(original).digest("hex"));
  const recorded = await recordSelectorRepairIncident({
    snapshot: authorization,
    caseId: "LOGIN-001",
    attempt: 1,
    sourcePath: scriptPath,
    selectorId: "account-password-login",
    candidateName: "账号密码登录",
    observedCandidateCount: 1,
    candidateActionable: true,
    failureCode: "accessible_name_drift",
    sideEffectProof: safeProof,
    workspaceRoot: root
  });
  const evidencePath = resolve(
    root,
    "artifacts/test-results/formal",
    authorization.digest.slice(0, 12),
    "case-evidence/LOGIN-002.json"
  );
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, '{"redacted":true}\n', "utf8");
  const record = {
    schemaVersion: "formal-execution-record-v1",
    requestId,
    projectId: "project",
    environment: "test",
    authorizationDigest: authorization.digest,
    manifestDigest: "7".repeat(64),
    businessOracleContractDigest: "8".repeat(64),
    targetBuildDigest: authorization.targetBuildDigest,
    testDataRunId: "selector-repair-run",
    startedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:02:00.000Z",
    cases: {
      "LOGIN-001": {
        caseId: "LOGIN-001",
        status: "unknown",
        attempts: [{
          attempt: 1,
          status: "unknown",
          finality: "terminal",
          startedAt: "2026-08-14T00:00:00.000Z",
          endedAt: "2026-08-14T00:01:00.000Z",
          selectorRepairIncident: recorded.reference
        }],
        updatedAt: "2026-08-14T00:01:00.000Z"
      },
      "LOGIN-002": {
        caseId: "LOGIN-002",
        status: "passed",
        attempts: [{
          attempt: 1,
          status: "passed",
          finality: "terminal",
          startedAt: "2026-08-14T00:00:00.000Z",
          endedAt: "2026-08-14T00:01:00.000Z"
        }],
        updatedAt: "2026-08-14T00:01:00.000Z"
      }
    },
    capabilities: {},
    deferredCases: [],
    caseEvidencePolicies: { "LOGIN-001": "standard", "LOGIN-002": "standard" },
    caseBusinessOracles: { "LOGIN-001": [], "LOGIN-002": [] },
    caseBlockContracts: {
      "LOGIN-001": { capabilityIds: [], resourceNames: [] },
      "LOGIN-002": { capabilityIds: [], resourceNames: [] }
    },
    cleanup: { status: "passed", dataHygieneStatus: "clean" },
    dataEvidence: {
      "LOGIN-001": { intents: [], resources: [] },
      "LOGIN-002": { intents: [], resources: [] }
    },
    resources: {},
    stageProgress: {
      "LOGIN-001": { completedStages: [], transitions: {} },
      "LOGIN-002": { completedStages: [], transitions: {} }
    },
    operationReservations: { "LOGIN-001": {}, "LOGIN-002": {} }
  } as FormalExecutionRecord;
  const manifest = {
    schemaVersion: "formal-execution-manifest-v1",
    scope: "request",
    requestId,
    projectId: "project",
    environment: "test",
    capabilities: [],
    buildEvidence: [],
    cases: ["LOGIN-001", "LOGIN-002"].map((caseId) => ({
      caseId,
      title: caseId,
      requiredCapabilities: [],
      requiredResources: [],
      consumesResources: [],
      producesResources: [],
      requiredOperations: [],
      dataWritePolicy: "no_write" as const,
      permissionProfile: "read_only" as const,
      implementation: { status: "source_complete" as const },
      businessOracles: []
    }))
  } as FormalExecutionManifest;

  const assessment = await assessSelectorRepairRecovery({
    requestId,
    snapshot: authorization,
    record,
    manifest,
    workspaceRoot: root
  });
  assert.equal(assessment.status, "eligible");
  assert.deepEqual(assessment.context?.affectedCaseIds, ["LOGIN-001"]);
  assert.deepEqual(assessment.context?.retryCaseIds, ["LOGIN-001"]);
  assert.deepEqual(assessment.context?.carriedCases.map((item) => item.caseId), ["LOGIN-002"]);

  const mixed = structuredClone(record);
  mixed.cases["LOGIN-002"]!.status = "blocked";
  assert.equal((await assessSelectorRepairRecovery({
    requestId,
    snapshot: authorization,
    record: mixed,
    manifest,
    workspaceRoot: root
  })).status, "rejected");
});
