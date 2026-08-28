import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import type { Locator, Page } from "@playwright/test";
import type {
  ExecutionAuthorizationSnapshot
} from "../../../src/support/formal-execution/authorization.js";
import type {
  FormalCaseRuntime
} from "../../../src/support/formal-execution/types.js";
import {
  FormalSelectorRepairError,
  guardedRoleLocator
} from "../../../src/support/web/guardedSelector.js";

const requestId = "web/project/guarded-selector";
const caseId = "LOGIN-CASE-001";
const sourcePath = "tests/web/project/guarded-selector/login.formal.spec.ts";

function source(): string {
  return `guardedRoleLocator({
  page,
  runtime,
  caseId: "${caseId}",
  selectorId: "account-password-login",
  sourcePath: "${sourcePath}",
  role: "button",
  name: "登录",
  scopeId: "login-form",
  stateId: "account-password-mode",
  action: "click",
  businessAssertion: false
});
`;
}

function snapshot(scriptDigest: string): ExecutionAuthorizationSnapshot {
  return {
    schemaVersion: "execution-authorization-v1",
    mode: "request",
    requestId,
    environment: "test",
    planDigest: "1".repeat(64),
    scriptDigests: [{ path: sourcePath, digest: scriptDigest }],
    caseIds: [caseId, "LOGIN-CASE-002"],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [],
    dataWritePolicy: "no_write",
    residualTtlHours: 72,
    securityChallengePolicy: "test-channel-first-minimal-human",
    artifactPolicy: "retain-with-sensitive-step-redaction",
    targetBuildDigest: "2".repeat(64),
    runnableCaseIds: [caseId, "LOGIN-CASE-002"],
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
    confirmationId: "guarded-selector-confirmation"
  };
}

test("guarded locator observes one related accessible name but never fallback-clicks it", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "guarded-selector-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = source();
  await mkdir(dirname(resolve(root, sourcePath)), { recursive: true });
  await writeFile(resolve(root, sourcePath), script, "utf8");
  const clickOptions: unknown[] = [];
  const candidate = {
    isVisible: async () => true,
    ariaSnapshot: async () => '- button "账号密码登录"',
    click: async (options: unknown) => { clickOptions.push(options); }
  } as unknown as Locator;
  const exact = {
    waitFor: async () => { throw new Error("not found"); },
    count: async () => 0
  } as unknown as Locator;
  const candidates = {
    count: async () => 1,
    nth: () => candidate
  } as unknown as Locator;
  const page = {
    getByRole: (_role: string, options?: unknown) => options ? exact : candidates
  } as unknown as Page;
  const runtime = {
    snapshot: snapshot(createHash("sha256").update(script).digest("hex")),
    attempt: 1,
    selectorRepairSafety: async () => ({
      safe: true,
      completedStageCount: 0,
      transitionCount: 0,
      dataIntentCount: 0,
      dataResourceCount: 0,
      operationReservationCount: 0,
      producedResourceCount: 0
    }),
    selectorRepairDependentCaseIds: () => ["LOGIN-CASE-002"]
  } as unknown as FormalCaseRuntime;

  await assert.rejects(
    guardedRoleLocator({
      page,
      runtime,
      caseId,
      selectorId: "account-password-login",
      sourcePath,
      role: "button",
      name: "登录",
      scopeId: "login-form",
      stateId: "account-password-mode",
      action: "click",
      businessAssertion: false,
      workspaceRoot: root
    }),
    (error: unknown) => {
      assert.ok(error instanceof FormalSelectorRepairError);
      assert.equal(error.incident.eligibility, "eligible");
      return true;
    }
  );
  assert.deepEqual(clickOptions, [{ trial: true, timeout: 2_000 }]);
});
