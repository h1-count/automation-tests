import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Locator, Page, Response } from "@playwright/test";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment.js";
import {
  configureFormalSuite,
  expect,
  formalCase,
  FormalBlockedError,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import type { FormalCaseRuntime } from "../../../../src/support/formal-execution/types.js";
import type {
  CreateIntentRecord,
  TestResourceType
} from "../../../../src/support/test-data/types.js";
import { captureWebOperationOutcome } from "../../../../src/support/formal-execution/operationEvidence.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const registrationPath = "/login?tab=register";
const submitPath = "/official/website/application/for/registration";
const uploadPath = "/company/file-upload";
const approvedTransitionId = "open-platform-registration-approved";
const rejectedTransitionId = "open-platform-registration-rejected";

interface RegistrationCandidate {
  syntheticKey: string;
  corpName: string;
  corpIdentifier: string;
  corpAddress: string;
  corpMail?: string;
  corpCode: string;
  contactName: string;
  phone: string;
  briefIntroduction?: string;
  license: {
    name: string;
    mimeType: string;
    buffer: Buffer;
  };
}

interface NegativeRegistrationRow {
  id:
    | "required_field_missing"
    | "agreement_missing"
    | "uniqueness_unsatisfied"
    | "license_missing"
    | "phone_unverified";
  candidate: RegistrationCandidate;
  conditionStates: Record<NegativeRegistrationRow["id"], "satisfied" | "unsatisfied">;
  expectedDuplicateMessage?: string;
}

interface NegativeRegistrationFixtureProvider {
  rows(): Promise<NegativeRegistrationRow[]>;
}

interface RegistrationFixtureProvider {
  candidate(): Promise<RegistrationCandidate>;
}

interface ExistingPhoneEnterpriseFixtureProvider {
  scenario(): Promise<{
    existing: {
      phone: string;
      corpName: string;
      corpIdentifier: string;
    };
    candidate: RegistrationCandidate;
  }>;
}

interface RegistrationCleanupContract {
  cleanupSyntheticEffects(input: {
    caseId: string;
    syntheticKey: string;
  }): Promise<{ uploadsRemoved: number; otpRequestAccounted: boolean }>;
}

interface RegistrationCleanupResult {
  uploadsRemoved: number;
  otpRequestAccounted: boolean;
}

interface RegistrationPostconditionQuery {
  findBySyntheticKey(syntheticKey: string): Promise<RegistrationApplication[]>;
}

interface RegistrationApplication {
  applicationId: string;
  state: string;
  corpName: string;
  corpAddress: string;
  ledgerResourceId: string;
}

interface RejectedRegistrationFixtureProvider {
  reapplication(): Promise<{
    rejectedApplicationId: string;
    expectedFeedback: string;
    expectedFeedbackRefs: string[];
    originalCandidate: RegistrationCandidate;
    correctedCandidate: RegistrationCandidate;
    corrections: Array<{
      field: EditableRegistrationField;
      feedbackRef: string;
      before: string | undefined;
      after: string | undefined;
    }>;
  }>;
}

type EditableRegistrationField = Exclude<keyof RegistrationCandidate, "license" | "syntheticKey">;

interface ReviewStateQuery {
  findByApplicationId(applicationId: string): Promise<{
    applicationId: string;
    state: string;
    feedback?: string;
    feedbackRefs: string[];
  }>;
}

interface RegistrationReapplicationQuery {
  findByOrigin(input: {
    rejectedApplicationId: string;
    newApplicationId: string;
  }): Promise<Array<{
    applicationId: string;
    originApplicationId: string;
  }>>;
}

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-20260803-008", "注册提交条件组合阻断", async ({ browser }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const approvedRecord = await runtime.manager.store.readResource(approved.resourceId);
  expect(approvedRecord?.metadata.syntheticKey).toBe(buildRegistrationCandidate("approved-primary").syntheticKey);
  const rows = buildNegativeRegistrationRows();
  const expectedRows = new Set<NegativeRegistrationRow["id"]>([
    "required_field_missing",
    "agreement_missing",
    "uniqueness_unsatisfied",
    "license_missing",
    "phone_unverified"
  ]);
  expect(new Set(rows.map((row) => row.id))).toEqual(expectedRows);

  for (const row of rows) {
    await test.step(`独立核对 ${row.id}`, async () => {
      const stageId = `negative-registration-${row.id}-completed`;
      if (await runtime.stageCompleted(stageId)) {
        runtime.addAssertion(`${row.id} restored from its durable parameter checkpoint`);
        return;
      }
      assertExactlyOneUnsatisfiedCondition(row);
      let submitIntentId: string | undefined;
      await withIsolatedRegistrationPage(browser, async (page, panel) => {
        try {
        runtime.classifyFailure("SCRIPT");
        await fillRegistrationCandidate(panel, row.candidate, row.id);
        const agreement = panel.getByRole("checkbox", {
          name: "同意注册用户协议",
          exact: true
        });
        const submit = await prepareRegistrationSubmissionControls(
          panel,
          agreement,
          row.id !== "agreement_missing"
        );
        if (row.id !== "license_missing") {
          await uploadLicense(panel, runtime, row.candidate, "OPEN-REG-20260803-008");
        }
        if (row.id !== "phone_unverified") {
          await completeOtp(panel, runtime, row.candidate, "OPEN-REG-20260803-008");
        }
        await assertNegativeRowIsolation(panel, row);
        let responsePromise: Promise<Response | undefined> | undefined;
        if (await submit.isEnabled()) {
          const submitIntent = await reserveOperationIntent(
            runtime,
            "OPEN-REG-20260803-008",
            `${row.candidate.syntheticKey}-${row.id}-submit`,
            "reject",
            `Authorized one-shot negative registration submit for ${row.id}.`,
            "tenant"
          );
          submitIntentId = submitIntent.intentId;
          const disposition = await prepareIntentOperation(
            runtime,
            submitIntent,
            "submit_registration",
            `OPEN-REG-20260803-008-${row.id}-submit`,
            `${row.id} 负向注册提交`
          );
          if (disposition === "settled") {
            if (submitIntent.resourceId) {
              throw new Error(`${row.id} 的既有负向提交意外创建了注册资源。`);
            }
            runtime.addAssertion(`${row.id} restored from its settled rejected intent without replay`);
          } else {
            responsePromise = waitForRegistrationResponse(page, 3_000);
            await submit.click();
          }
        }
        const response = await responsePromise;
        if (response) {
          if (submitIntentId) {
            await runtime.manager.markCreationUnknown(
              submitIntentId,
              `Negative row ${row.id} unexpectedly reached the registration endpoint.`
            );
          }
          throw new FormalBlockedError(
            `${row.id} 的负向条件触发了未知注册结果；已冻结相同 intent，禁止重传。`
          );
        }
        if (submitIntentId && responsePromise) {
          await runtime.manager.markCreationFailed(
            submitIntentId,
            `Expected negative registration condition ${row.id} produced no request.`
          );
        }
        runtime.classifyFailure("PRODUCT");
        runtime.addOperationEvidence({
          operation: "submit_registration",
          source: "ui_state",
          contractId: "open-platform-registration-submit-blocked-v1",
          outcome: "rejected",
          finality: "final",
          stableIdentity: "not_required",
          fallbackUsed: false,
          reconciliation: "not_required"
        });
        runtime.addAssertion(`${row.id}: the page blocked registration before any submit request`);
        await runtime.completeStage(stageId);
        } catch (error) {
        const latest = submitIntentId
          ? await runtime.manager.store.readIntent(submitIntentId)
          : undefined;
        if (latest?.status === "creating") {
          await runtime.manager.markCreationUnknown(
            latest.intentId,
            `Negative registration transaction ${row.id} requires exact reconciliation.`
          );
        }
        throw error;
        }
      });
    });
  }
});

formalCase("OPEN-REG-20260803-009", "合成企业申请受控提交与后置核对", async ({ page }, runtime) => {
  const candidate = buildRegistrationCandidate("approved-primary");
  if (!(await runtime.stageCompleted("registration-submitted"))) {
    const application = await submitRegistrationCandidate(
      page,
      runtime,
      "OPEN-REG-20260803-009",
      candidate
    );
    await runtime.publishResource(
      "pending-enterprise-OPEN-REG-20260803-009",
      application.ledgerResourceId,
      "Synthetic registration reached the reviewed pending route."
    );
    await runtime.completeStage("registration-submitted");
    await runtime.awaitExternalTransition(approvedTransitionId);
  }
  const outcome = await runtime.transitionOutcome(approvedTransitionId);
  if (!outcome) await runtime.awaitExternalTransition(approvedTransitionId);
  expect(outcome).toBe("approved");
  const pending = await runtime.consumeResource("pending-enterprise-OPEN-REG-20260803-009");
  await runtime.publishResource(
    "approved-enterprise-OPEN-REG-20260803-009",
    pending.resourceId,
    "Synthetic enterprise approval was attested; downstream login must still verify the account."
  );
  await runtime.confirmResource(
    "approved-review-attestation-OPEN-REG-20260803-009",
    "Review, review SMS and credential SMS attestations were frozen without message contents."
  );
  await runtime.completeStage("approved-baseline-verified");
  runtime.addAssertion("审核通过分支已恢复；后续登录和企业页面仍需自动验证");
});

formalCase("OPEN-REG-20260803-015", "同一手机号可申请不同企业", async ({ page }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const approvedRecord = await runtime.manager.store.readResource(approved.resourceId);
  const existing = buildRegistrationCandidate("approved-primary");
  expect(approvedRecord?.metadata.syntheticKey).toBe(existing.syntheticKey);
  const candidate = buildRegistrationCandidate("same-phone-secondary");
  expect(candidate.phone).toBe(existing.phone);
  expect(candidate.corpName).not.toBe(existing.corpName);
  expect(candidate.corpIdentifier).not.toBe(existing.corpIdentifier);
  runtime.addAssertion("前置企业与新申请使用同一号码且企业身份不同");
  await submitRegistrationCandidate(
    page,
    runtime,
    "OPEN-REG-20260803-015",
    candidate
  );
});

formalCase("OPEN-REG-20260803-017", "已提交企业名称和地址权威值基线核对", async ({ browser }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const approvedRecord = await runtime.manager.store.readResource(approved.resourceId);
  const companyName = requireSubmittedBaseline(
    "OPEN_PLATFORM_SUBMITTED_COMPANY_NAME_TEST",
    "已提交合成企业名称"
  );
  const companyAddress = requireSubmittedBaseline(
    "OPEN_PLATFORM_SUBMITTED_COMPANY_ADDRESS_TEST",
    "已提交合成企业地址"
  );
  expect(companyName).toBe(approvedRecord?.metadata.corpName);
  expect(companyAddress).toBe(approvedRecord?.metadata.corpAddress);
  runtime.classifyFailure("PRODUCT");
  await withSubmittedCompanyPage(browser, async (page) => {
    await page.goto("/console/company/info");
    const companyNameField = companyInfoValue(page, "企业名称");
    await requireAuthenticatedLanding(
      page,
      companyNameField,
      "已提交合成企业的只读会话已失效。"
    );
    await expect(companyNameField).toHaveText(companyName);
    await expect(companyInfoValue(page, "企业地址")).toHaveText(companyAddress);
  });
  runtime.addAssertion("企业信息页直接显示的名称和地址与冻结合成提交基线一致");
});

formalCase("OPEN-REG-20260803-021", "审核不通过后按反馈重新申请", async ({ page }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const input = buildRejectedReapplication();

  if (!(await runtime.stageCompleted("original-registration-submitted"))) {
    const application = await submitRegistrationCandidate(
      page,
      runtime,
      "OPEN-REG-20260803-021",
      input.originalCandidate
    );
    await runtime.publishResource(
      "pending-enterprise-OPEN-REG-20260803-021",
      application.ledgerResourceId,
      "Synthetic rejection candidate reached the reviewed pending route."
    );
    await runtime.completeStage("original-registration-submitted");
    await runtime.awaitExternalTransition(rejectedTransitionId);
  }
  const rejectedOutcome = await runtime.transitionOutcome(rejectedTransitionId);
  if (!rejectedOutcome) await runtime.awaitExternalTransition(rejectedTransitionId);

  runtime.classifyFailure("PRODUCT");
  expect(rejectedOutcome).toBe("rejected");
  const rejectedTransition = await runtime.transitionRecord(rejectedTransitionId);
  expect(rejectedTransition?.attestationDigest).toMatch(/^[a-f0-9]{64}$/u);
  expect(input.corrections.length, "重新注册前必须有至少一项与驳回反馈关联的修订").toBeGreaterThan(0);
  for (const correction of input.corrections) {
    expect(input.expectedFeedbackRefs).toContain(correction.feedbackRef);
    expect(correction.before).toBe(input.originalCandidate[correction.field]);
    expect(correction.after).toBe(input.correctedCandidate[correction.field]);
    expect(correction.after, `${correction.field} 必须按反馈发生变化`).not.toBe(correction.before);
  }
  expect(
    new Set(input.corrections.map((correction) => correction.feedbackRef)),
    "每一条驳回反馈都必须至少对应一项重新注册修订"
  ).toEqual(new Set(input.expectedFeedbackRefs));
  const correctedFields = new Set(input.corrections.map((correction) => correction.field));
  for (const field of editableRegistrationFields) {
    if (!correctedFields.has(field)) {
      expect(input.correctedCandidate[field], `${field} 不在反馈修订范围内时应保持原值`)
        .toBe(input.originalCandidate[field]);
    }
  }
  runtime.addAssertion(
    "the original registration rejection and the frozen address-feedback category were confirmed by the external transition without inventing an unavailable detail API"
  );

  if (await runtime.stageCompleted("reapplication-submitted")) {
    runtime.addAssertion("已从持久化终段恢复，未重复提交驳回后的企业注册申请");
    return;
  }

  await submitRegistrationCandidate(
    page,
    runtime,
    "OPEN-REG-20260803-021",
    input.correctedCandidate
  );
  await runtime.confirmResource(
    "rejected-review-attestation-OPEN-REG-20260803-021",
    "Rejected review and notification were attested with frozen synthetic feedback."
  );
  await runtime.completeStage("reapplication-submitted");
  runtime.addAssertion("驳回后使用修订后的合成资料重新发起了一次新的企业注册");
});

async function submitRegistrationCandidate(
  page: Page,
  runtime: FormalCaseRuntime,
  caseId: string,
  candidate: RegistrationCandidate
): Promise<RegistrationApplication> {
  runtime.classifyFailure("TEST_DATA");
  const stableApplicationId = createHash("sha256")
    .update(`${formalExecutionManifest.requestId}:${candidate.syntheticKey}`)
    .digest("hex")
    .slice(0, 24);
  const stableResourceId = `open-platform-registration-${stableApplicationId}`;
  const submitIntent = await reserveRegistrationSubmitIntent(
    runtime,
    caseId,
    candidate.syntheticKey
  );
  const submitIntentId = submitIntent.intentId;
  if (["created", "reconciled"].includes(submitIntent.status)) {
    if (submitIntent.resourceId !== stableResourceId) {
      throw new FormalBlockedError(
        `${caseId} 的既有注册 intent 缺少匹配资源，必须先完成精确 reconciliation。`
      );
    }
    runtime.addAssertion("已从持久化注册结果恢复，未重复上传、发送验证码或提交");
    return {
      applicationId: stableApplicationId,
      state: "pending",
      corpName: candidate.corpName,
      corpAddress: candidate.corpAddress,
      ledgerResourceId: stableResourceId
    };
  }
  if (submitIntent.status !== "planned") {
    throw new FormalBlockedError(
      `${caseId} 的注册 intent ${submitIntent.intentId} 已处于 ${submitIntent.status}，必须先 reconciliation，禁止重放。`
    );
  }
  try {
    runtime.classifyFailure("SCRIPT");
    await page.goto(registrationPath);
    const panel = await registrationPanel(page);
    await fillRegistrationCandidate(panel, candidate);
    const agreement = panel.getByRole("checkbox", {
      name: "同意注册用户协议",
      exact: true
    });
    const submit = await prepareRegistrationSubmissionControls(panel, agreement, true);
    await uploadLicense(panel, runtime, candidate, caseId);
    await completeOtp(panel, runtime, candidate, caseId);
    await expect(agreement, "验证码输入完成后协议勾选状态不得丢失").toBeChecked();
    await expect(submit).toBeEnabled();
    runtime.classifyFailure("UNKNOWN");
    const submitDisposition = await prepareIntentOperation(
      runtime,
      submitIntent,
      "submit_registration",
      `${caseId}-${candidate.syntheticKey}-submit`,
      `${caseId} 注册提交`
    );
    if (submitDisposition !== "execute") {
      throw new FormalBlockedError(`${caseId} 的既有注册结果尚未通过顶层恢复分支定案。`);
    }
    const captured = await captureWebOperationOutcome({
      page,
      operation: "submit_registration",
      method: "POST",
      path: submitPath,
      contractId: "open-platform-registration-submit-response-v1",
      timeoutMs: 60_000,
      trigger: () => submit.click(),
      parse: async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok() || !payload || typeof payload !== "object") {
          throw new Error("Registration response does not match the reviewed JSON contract.");
        }
        const record = payload as Record<string, unknown>;
        if (
          record.code !== 200
          || (record.data !== undefined && typeof record.data !== "boolean")
        ) {
          throw new Error("Registration business result was not accepted by the reviewed contract.");
        }
        return { outcome: "succeeded", finality: "final" };
      }
    });
    runtime.addOperationEvidence(captured.evidence);
    if (!captured.parsed) {
      await runtime.manager.markCreationUnknown(
        submitIntent.intentId,
        "Registration response was missing, duplicated, or outside the reviewed contract."
      );
      throw new FormalBlockedError(
        "Registration response is unknown; the same intent and unique fields must not be retried."
      );
    }
    runtime.classifyFailure("PRODUCT");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/register-pending");
    const resource = await runtime.manager.confirmCreatedResource({
      intentId: submitIntent.intentId,
      resourceId: stableResourceId,
      reusable: false,
      metadata: {
        syntheticKey: candidate.syntheticKey,
        state: "pending",
        corpName: candidate.corpName,
        corpAddress: candidate.corpAddress,
        corpIdentifier: candidate.corpIdentifier,
        corpCode: candidate.corpCode,
        contactName: candidate.contactName
      },
      evidence: [{
        type: "web",
        summary: "The reviewed response was accepted and the UI reached the pending route for a unique synthetic key."
      }]
    });
    if (formalExecutionManifest.cases.find((item) => item.caseId === caseId)?.dataWritePolicy
      !== "reusable_fixture") {
      await runtime.manager.retainTrackedResidual(
        resource.resourceId,
        "Registration application is pending an explicit external review transition."
      );
    }
    runtime.addOperationEvidence({
      operation: "submit_registration",
      source: "browser_response",
      contractId: "open-platform-registration-submit-response-v1",
      outcome: "succeeded",
      finality: "final",
      method: "POST",
      path: submitPath,
      stableIdentity: "observed",
      fallbackUsed: false,
      reconciliation: "not_required"
    });
    runtime.addAssertion("registration response was accepted and the UI consumed it by reaching the pending route");
    return {
      applicationId: stableApplicationId,
      state: "pending",
      corpName: candidate.corpName,
      corpAddress: candidate.corpAddress,
      ledgerResourceId: resource.resourceId
    };
  } catch (error) {
    const latest = await runtime.manager.store.readIntent(submitIntentId);
    if (latest?.status === "creating") {
      await runtime.manager.markCreationUnknown(
        latest.intentId,
        "Registration outcome requires exact reconciliation."
      );
    }
    throw error;
  }
}

const editableRegistrationFields: EditableRegistrationField[] = [
  "corpName",
  "corpIdentifier",
  "corpAddress",
  "corpMail",
  "corpCode",
  "contactName",
  "phone",
  "briefIntroduction"
];

function buildRegistrationCandidate(seed: string): RegistrationCandidate {
  const digest = createHash("sha256")
    .update(`${formalExecutionManifest.requestId}:${seed}`)
    .digest("hex");
  const phone = process.env.OPEN_PLATFORM_REGISTRATION_PHONE_TEST?.trim();
  if (!phone || !/^1\d{10}$/u.test(phone)) {
    throw new FormalBlockedError("专用测试手机号未通过本地 Secret 校验。");
  }
  const assetPath = resolve(
    process.cwd(),
    "test-assets/documents/open-platform/synthetic-business-license.png.b64"
  );
  const encodedLicense = readFileSync(assetPath, "utf8").trim();
  const license = Buffer.from(encodedLicense, "base64");
  if (!license.length) throw new FormalBlockedError("Git 管理的合成证照资产为空。");
  return {
    syntheticKey: `open-platform-${seed}-${digest.slice(0, 12)}`,
    corpName: `自动化企业${digest.slice(0, 8)}`,
    corpIdentifier: `a${digest.slice(0, 5)}`,
    corpAddress: `测试地址${digest.slice(0, 12)}`,
    corpMail: `auto-${digest.slice(0, 10)}@example.test`,
    corpCode: `AUTO${digest.slice(0, 14).toUpperCase()}`,
    contactName: "测试申请人",
    phone,
    briefIntroduction: `自动化测试企业${digest.slice(0, 12)}`,
    license: {
      name: `synthetic-business-license-${digest.slice(0, 8)}.png`,
      mimeType: "image/png",
      buffer: license
    }
  };
}

function buildNegativeRegistrationRows(): NegativeRegistrationRow[] {
  const ids: NegativeRegistrationRow["id"][] = [
    "required_field_missing",
    "agreement_missing",
    "uniqueness_unsatisfied",
    "license_missing",
    "phone_unverified"
  ];
  const approved = buildRegistrationCandidate("approved-primary");
  return ids.map((id) => {
    const candidate = buildRegistrationCandidate(`negative-${id}`);
    if (id === "uniqueness_unsatisfied") candidate.corpIdentifier = approved.corpIdentifier;
    return {
      id,
      candidate,
      conditionStates: Object.fromEntries(ids.map((condition) => [
        condition,
        condition === id ? "unsatisfied" : "satisfied"
      ])) as NegativeRegistrationRow["conditionStates"],
      ...(id === "uniqueness_unsatisfied"
        ? { expectedDuplicateMessage: "该企业标识已存在，请更改为其他标识" }
        : {})
    };
  });
}

function buildRejectedReapplication(): {
  rejectedApplicationId: string;
  expectedFeedback: string;
  expectedFeedbackRefs: string[];
  originalCandidate: RegistrationCandidate;
  correctedCandidate: RegistrationCandidate;
  corrections: Array<{
    field: EditableRegistrationField;
    feedbackRef: string;
    before: string | undefined;
    after: string | undefined;
  }>;
} {
  const originalCandidate = buildRegistrationCandidate("rejected-primary");
  const correctedCandidate = {
    ...originalCandidate,
    corpAddress: `${originalCandidate.corpAddress}修订`
  };
  const feedbackRef = "synthetic-feedback-address";
  return {
    rejectedApplicationId: createHash("sha256")
      .update(originalCandidate.syntheticKey)
      .digest("hex")
      .slice(0, 24),
    expectedFeedback: "请修订合成企业地址",
    expectedFeedbackRefs: [feedbackRef],
    originalCandidate,
    correctedCandidate,
    corrections: [{
      field: "corpAddress",
      feedbackRef,
      before: originalCandidate.corpAddress,
      after: correctedCandidate.corpAddress
    }]
  };
}

async function registrationPanel(page: Page): Promise<Locator> {
  const panel = page.getByRole("form", { name: "企业注册申请表单", exact: true });
  await requireUniqueVisible(panel, "企业注册申请表单");
  return panel;
}

async function fillRegistrationCandidate(
  panel: Locator,
  candidate: RegistrationCandidate,
  omitted?: NegativeRegistrationRow["id"]
): Promise<void> {
  const values: Array<[string, string]> = [
    ["注册企业名称", candidate.corpName],
    ["注册企业标识", omitted === "uniqueness_unsatisfied"
      ? candidate.corpIdentifier
      : candidate.corpIdentifier],
    ["注册企业地址", omitted === "required_field_missing" ? "" : candidate.corpAddress],
    ["注册企业信用代码", candidate.corpCode],
    ["注册联系人姓名", candidate.contactName],
    ["注册联系电话", candidate.phone]
  ];
  if (candidate.corpMail) values.push(["注册企业邮箱", candidate.corpMail]);
  if (candidate.briefIntroduction) {
    values.push(["注册企业简介", candidate.briefIntroduction]);
  }
  for (const [name, value] of values) {
    const field = panel.getByLabel(name, { exact: true });
    await requireUniqueVisible(field, name);
    await field.fill(value);
  }
}

async function uploadLicense(
  panel: Locator,
  runtime: FormalCaseRuntime,
  candidate: RegistrationCandidate,
  caseId: string
): Promise<void> {
  const intent = await reserveOperationIntent(
    runtime,
    caseId,
    `${candidate.syntheticKey}-upload`,
    "create",
    "Authorized one-shot synthetic registration upload.",
    "custom",
    transientWritePolicy(caseId)
  );
  const disposition = await prepareIntentOperation(
    runtime,
    intent,
    "upload_synthetic_file",
    `${caseId}-${candidate.syntheticKey}-upload`,
    `${caseId} 营业执照上传`
  );
  if (disposition === "settled") {
    throw new FormalBlockedError(
      `${caseId} 的营业执照上传结果已定案，但当前注册表单没有持久化的上传引用；禁止跳过 UI 状态恢复后继续提交。`
    );
  }
  const trigger = panel.locator('button[aria-label="上传注册营业执照"]');
  await requireUniqueVisible(trigger, "注册营业执照上传按钮");
  try {
    runtime.classifyFailure("UNKNOWN");
    const page = trigger.page();
    const captured = await captureWebOperationOutcome({
      page,
      operation: "upload_synthetic_file",
      method: "POST",
      path: uploadPath,
      contractId: "open-platform-upload-response-v1",
      timeoutMs: 60_000,
      trigger: async () => {
        const chooserPromise = page.waitForEvent("filechooser");
        await trigger.click();
        const chooser = await chooserPromise;
        await chooser.setFiles(candidate.license);
      },
      parse: parseUploadResponse
    });
    runtime.addOperationEvidence(captured.evidence);
    if (!captured.parsed || captured.parsed.outcome !== "succeeded"
      || !captured.parsed.stableResourceId) {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        "Synthetic registration upload lacks one final response and stable non-sensitive identity."
      );
      throw new FormalBlockedError("营业执照上传响应无法定案，已冻结重传并要求 reconciliation。");
    }
    const resource = await runtime.manager.confirmCreatedResource({
      intentId: intent.intentId,
      resourceId: `open-platform-registration-upload-${captured.parsed.stableResourceId}`,
      reusable: false,
      metadata: { syntheticKey: candidate.syntheticKey, operation: "upload" },
      evidence: [{ type: "web", summary: "Synthetic upload response provided a stable identity." }]
    });
    if (resource.dataWritePolicy === "tracked_residual") {
      await runtime.manager.retainTrackedResidual(
        resource.resourceId,
        "Synthetic upload is retained only within the authorized TTL."
      );
    }
    runtime.classifyFailure("PRODUCT");
    await expect(trigger).toHaveAttribute("aria-busy", "false");
    if (!captured.parsed.runtimeUiValue) {
      throw new FormalBlockedError("上传响应缺少仅用于本回合 UI 消费断言的值。");
    }
    await expect(trigger).toHaveText(captured.parsed.runtimeUiValue);
  } catch (error) {
    const latest = await runtime.manager.store.readIntent(intent.intentId);
    if (latest?.status === "creating") {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        "Synthetic registration upload requires exact reconciliation."
      );
    }
    throw error;
  }
}

async function completeOtp(
  panel: Locator,
  runtime: FormalCaseRuntime,
  candidate: RegistrationCandidate,
  caseId: string
): Promise<void> {
  const requestCode = panel.getByRole("button", {
    name: "获取注册短信验证码",
    exact: true
  });
  const otpInput = panel.getByLabel("注册短信验证码", { exact: true });
  await requireUniqueVisible(requestCode, "获取注册短信验证码按钮");
  await requireUniqueVisible(otpInput, "注册短信验证码输入框");

  const intent = await reserveOperationIntent(
    runtime,
    caseId,
    `${candidate.syntheticKey}-otp`,
    "create",
    "Authorized one-shot controlled OTP request.",
    "custom",
    transientWritePolicy(caseId)
  );
  const disposition = await prepareIntentOperation(
    runtime,
    intent,
    "send_test_otp",
    `${caseId}-${candidate.syntheticKey}-otp`,
    `${caseId} 注册短信验证码发送`
  );
  try {
    if (disposition === "execute") {
      runtime.classifyFailure("UNKNOWN");
      await requestCode.click();
      await expect(requestCode).toBeDisabled({ timeout: 180_000 });
      const resource = await runtime.manager.confirmCreatedResource({
        intentId: intent.intentId,
        resourceId: `open-platform-registration-otp-${intent.intentId}`,
        reusable: false,
        metadata: { syntheticKey: candidate.syntheticKey, operation: "otp" },
        evidence: [{
          type: "web",
          summary: "The authorized OTP action entered its visible resend countdown without storing the code."
        }]
      });
      if (resource.dataWritePolicy === "tracked_residual") {
        await runtime.manager.retainTrackedResidual(
          resource.resourceId,
          "Synthetic OTP request is retained only within the authorized TTL."
        );
      }
    } else if (!intent.resourceId) {
      throw new Error(`${caseId} 的既有 OTP 请求已定案为失败。`);
    }
    runtime.addOperationEvidence({
      operation: "send_test_otp",
      source: "ui_state",
      contractId: "open-platform-otp-resend-countdown-v1",
      outcome: "succeeded",
      finality: "final",
      stableIdentity: "not_required",
      fallbackUsed: false,
      reconciliation: disposition === "execute" ? "not_required" : "completed"
    });
    if (disposition === "settled") {
      runtime.addAssertion(`${caseId} OTP request restored from its settled intent without resend`);
    }
    runtime.classifyFailure("PRODUCT");
    await expect.poll(
      async () => /^\d{6}$/u.test(await otpInput.inputValue()),
      {
        timeout: 360_000,
        message: "请在可见浏览器中输入本次 6 位注册短信验证码。"
      }
    ).toBe(true);
    runtime.addAssertion("用户已在可见浏览器内完成验证码输入，原始值未进入测试证据");
  } catch (error) {
    const latest = await runtime.manager.store.readIntent(intent.intentId);
    if (latest?.status === "creating") {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        "Controlled OTP request requires exact reconciliation."
      );
    }
    throw error;
  }
}

async function parseUploadResponse(response: Response): Promise<{
  outcome: "succeeded";
  finality: "final";
  stableResourceId: string;
  runtimeUiValue: string;
}> {
  const payload = await response.json() as unknown;
  if (!response.ok() || !payload || typeof payload !== "object") {
    throw new Error("Upload response does not match the reviewed contract.");
  }
  const record = payload as Record<string, unknown>;
  if (record.code !== 200 || typeof record.data !== "string") {
    throw new Error("Upload business result is not successful.");
  }
  const url = new URL(record.data, "https://synthetic.invalid");
  const stableResourceId = url.pathname.split("/").filter(Boolean).at(-1);
  if (!stableResourceId || !/^[A-Za-z0-9._-]{1,128}$/u.test(stableResourceId)) {
    throw new Error("Upload response lacks a safe stable resource identity.");
  }
  return {
    outcome: "succeeded",
    finality: "final",
    stableResourceId,
    runtimeUiValue: record.data as string
  };
}

async function reserveRegistrationSubmitIntent(
  runtime: FormalCaseRuntime,
  caseId: string,
  syntheticKey: string
) {
  const reusableCandidate = formalExecutionManifest.cases
    .find((item) => item.caseId === caseId)?.dataWritePolicy === "reusable_fixture";
  return runtime.manager.reserveCreateIntent({
    runId: runtime.runId,
    projectId: formalExecutionManifest.projectId,
    envId: runtime.snapshot.environment,
    caseId,
    resourceType: "tenant",
    syntheticKey: `${syntheticKey}-submit`,
    expectedOutcome: "create",
    ...(reusableCandidate
      ? { expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString() }
      : {}),
    evidence: [{
      type: "web",
      summary: "Authorized one-shot synthetic registration submission."
    }]
  });
}

async function reserveOperationIntent(
  runtime: FormalCaseRuntime,
  caseId: string,
  syntheticKey: string,
  expectedOutcome: "create" | "reject",
  summary: string,
  resourceType: TestResourceType = "custom",
  dataWritePolicy?: "ephemeral_cleanup" | "tracked_residual"
) {
  const intent = await runtime.manager.reserveCreateIntent({
    runId: runtime.runId,
    projectId: formalExecutionManifest.projectId,
    envId: runtime.snapshot.environment,
    caseId,
    resourceType,
    syntheticKey,
    expectedOutcome,
    ...(dataWritePolicy ? { dataWritePolicy } : {}),
    evidence: [{ type: "web", summary }]
  });
  return intent;
}

async function prepareIntentOperation(
  runtime: FormalCaseRuntime,
  intent: CreateIntentRecord,
  operation: Parameters<FormalCaseRuntime["reserveOperation"]>[0],
  operationKey: string,
  label: string
): Promise<"execute" | "settled"> {
  if (intent.status === "planned") {
    await runtime.manager.markIntentCreating(intent.intentId);
    let reservation: "reserved" | "existing";
    try {
      reservation = await runtime.reserveOperation(operation, operationKey);
    } catch (error) {
      await runtime.manager.markCreationFailed(
        intent.intentId,
        `${label} did not start because its immutable operation budget was unavailable.`
      );
      throw error;
    }
    if (reservation === "existing") {
      await runtime.manager.markCreationUnknown(
        intent.intentId,
        `${label} found a prior reservation without a durable remote-start checkpoint.`
      );
      throw new FormalBlockedError(`${label} 存在旧 reservation，已冻结并要求只读 reconciliation。`);
    }
    return "execute";
  }
  if (intent.status === "creating") {
    await runtime.manager.markCreationUnknown(
      intent.intentId,
      `${label} was interrupted after remote execution started.`
    );
    throw new FormalBlockedError(`${label} 结果未知，已冻结重放并要求精确 reconciliation。`);
  }
  if (intent.status === "creation_unknown") {
    throw new FormalBlockedError(`${label} 结果未知，必须先完成精确 reconciliation。`);
  }
  return "settled";
}

function transientWritePolicy(caseId: string): "tracked_residual" | undefined {
  return formalExecutionManifest.cases.find((item) => item.caseId === caseId)?.dataWritePolicy
    === "reusable_fixture"
    ? "tracked_residual"
    : undefined;
}

function assertExactlyOneUnsatisfiedCondition(row: NegativeRegistrationRow): void {
  const unsatisfied = Object.entries(row.conditionStates)
    .filter(([, state]) => state === "unsatisfied")
    .map(([condition]) => condition);
  expect(new Set(unsatisfied), `${row.id} 必须且只能有一个未满足条件`)
    .toEqual(new Set([row.id]));
}

async function assertNegativeRowIsolation(
  panel: Locator,
  row: NegativeRegistrationRow
): Promise<void> {
  const requiredFields = [
    "注册企业名称",
    "注册企业标识",
    "注册企业地址",
    "注册企业信用代码",
    "注册联系人姓名",
    "注册联系电话"
  ];
  for (const label of requiredFields) {
    const field = panel.getByLabel(label, { exact: true });
    const value = await field.inputValue();
    if (row.id === "required_field_missing" && label === "注册企业地址") {
      expect(value, "required_field_missing 只能缺少企业地址").toBe("");
    } else {
      expect(value, `${row.id} 的非目标必填字段 ${label} 必须已满足`).not.toBe("");
      if (!(row.id === "uniqueness_unsatisfied" && label === "注册企业标识")) {
        await assertRuntimeFieldValid(field, `${row.id} 的非目标字段 ${label}`);
      }
    }
  }
  for (const optionalLabel of ["注册企业邮箱", "注册企业简介"]) {
    const field = panel.getByLabel(optionalLabel, { exact: true });
    if (await field.inputValue()) {
      await assertRuntimeFieldValid(field, `${row.id} 的非目标可选字段 ${optionalLabel}`);
    }
  }
  const agreement = panel.getByRole("checkbox", {
    name: "同意注册用户协议",
    exact: true
  });
  expect(await agreement.isChecked()).toBe(row.id !== "agreement_missing");
  const otpValue = await panel.getByLabel("注册短信验证码", { exact: true }).inputValue();
  if (row.id === "phone_unverified") expect(otpValue).toBe("");
  else expect(otpValue, `${row.id} 的手机号验证条件必须已满足`).not.toBe("");
  if (row.id === "uniqueness_unsatisfied") {
    if (!row.expectedDuplicateMessage) {
      throw new FormalBlockedError("唯一性负向行缺少冻结的重复提示契约。");
    }
    await requireUniqueVisible(
      panel.getByText(row.expectedDuplicateMessage, { exact: true }),
      "唯一性阻断提示"
    );
    await requireUniqueVisible(
      panel.getByRole("status").filter({ hasText: "企业标识已被使用" }),
      "企业标识已占用状态"
    );
  } else {
    await expect(
      panel.getByRole("status").filter({ hasText: "企业标识可用" })
    ).toHaveText("企业标识可用", { timeout: 10_000 });
  }
  const duplicateMessages = [
    "该企业名称已存在，请确认是否已注册或更换其他名称",
    "该企业标识已存在，请更改为其他标识",
    "该统一社会信用代码已注册，请确认是否已提交过申请"
  ];
  for (const message of duplicateMessages) {
    if (row.id === "uniqueness_unsatisfied" && message === row.expectedDuplicateMessage) continue;
    expect(
      await panel.getByText(message, { exact: true }).isVisible().catch(() => false),
      `${row.id} 的非目标唯一性条件不得被阻断：${message}`
    ).toBe(false);
  }
}

async function assertRuntimeFieldValid(field: Locator, label: string): Promise<void> {
  await field.focus();
  await field.blur();
  const formItem = field.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ep-form-item ')][1]"
  );
  await expect(formItem, `${label} 的 Element Plus 校验必须完成并进入成功状态`)
    .toHaveClass(/(?:^|\s)is-success(?:\s|$)/, { timeout: 10_000 });
  const validity = await field.evaluate((element) => ({
    ariaInvalid: element.getAttribute("aria-invalid"),
    nativeValid: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.checkValidity()
      : true
  }));
  expect(validity.ariaInvalid, `${label} 不得声明 aria-invalid=true`).not.toBe("true");
  expect(validity.nativeValid, `${label} 必须通过浏览器原生 validity 检查`).toBe(true);
}

async function waitForRegistrationResponse(
  page: Page,
  timeout: number
): Promise<Response | undefined> {
  return page.waitForResponse((response) =>
    response.request().method().toUpperCase() === "POST"
    && new URL(response.url()).pathname === submitPath,
  { timeout }).catch(() => undefined);
}

async function withIsolatedRegistrationPage<T>(
  browser: Browser,
  body: (page: Page, panel: Locator) => Promise<T>
): Promise<T> {
  const environment = resolveTestEnvironment();
  const context = await browser.newContext({ baseURL: environment.openPlatformWebBaseUrl });
  try {
    const page = await context.newPage();
    await page.goto(registrationPath);
    return await body(page, await registrationPanel(page));
  } finally {
    await context.close();
  }
}

async function requireUniqueVisible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}的源码契约应在客户端渲染完成后唯一`).toHaveCount(1);
  await expect(locator, `${label}的运行时语义应在客户端渲染完成后可见`).toBeVisible();
}

async function checkVisibleElementPlusCheckbox(
  checkbox: Locator,
  label: string
): Promise<void> {
  await expect(checkbox, `${label}的 ARIA 契约应唯一`).toHaveCount(1);
  const visibleControl = checkbox.locator("xpath=ancestor::label[1]");
  await requireUniqueVisible(visibleControl, `${label}的可见交互容器`);
  await visibleControl.click();
  await expect(checkbox, `${label}点击后应进入已勾选状态`).toBeChecked();
}

async function prepareRegistrationSubmissionControls(
  panel: Locator,
  agreement: Locator,
  shouldAgree: boolean
): Promise<Locator> {
  await expect(agreement, "注册用户协议勾选框的 ARIA 契约应唯一").toHaveCount(1);
  const visibleAgreement = agreement.locator("xpath=ancestor::label[1]");
  await requireUniqueVisible(visibleAgreement, "注册用户协议勾选框的可见交互容器");
  if (shouldAgree) {
    await checkVisibleElementPlusCheckbox(agreement, "注册用户协议勾选框");
  } else {
    await expect(agreement, "协议缺失负向场景必须保持未勾选").not.toBeChecked();
  }

  const submit = panel.getByRole("button", {
    name: "同意条款并注册",
    exact: true
  });
  await requireUniqueVisible(submit, "注册提交按钮");
  return submit;
}

async function requireAuthenticatedLanding(
  page: Page,
  authenticatedSurface: Locator,
  blockedMessage: string
): Promise<void> {
  await expect.poll(async () => {
    if (new URL(page.url()).pathname === "/login") return "login";
    if (await authenticatedSurface.count() !== 1) return "pending";
    return await authenticatedSurface.isVisible() ? "authenticated" : "pending";
  }, {
    message: "等待认证后页面完成客户端路由守卫和语义渲染"
  }).toMatch(/^(?:authenticated|login)$/u);
  if (new URL(page.url()).pathname === "/login") {
    throw new FormalBlockedError(blockedMessage);
  }
}

function requireSubmittedBaseline(variable: string, purpose: string): string {
  const value = process.env[variable]?.trim();
  if (!value || /[\r\n|]/u.test(value) || value.length > 100) {
    throw new FormalBlockedError(`${purpose}不可用或不符合脱敏合成数据约定。`);
  }
  return value;
}

async function withSubmittedCompanyPage(
  browser: Browser,
  body: (page: Page) => Promise<void>
): Promise<void> {
  const environment = resolveTestEnvironment();
  const storageState = environment.openPlatformAuthStatePath;
  if (!storageState || !existsSync(storageState)) {
    throw new FormalBlockedError("已提交合成企业的只读会话不可用。");
  }
  const expectedDigest = process.env.OPEN_PLATFORM_APPROVED_AUTH_STATE_SHA256_TEST?.trim();
  const actualDigest = createHash("sha256").update(readFileSync(storageState)).digest("hex");
  if (!expectedDigest || expectedDigest !== actualDigest) {
    throw new FormalBlockedError("已提交合成企业的只读会话与冻结摘要不一致。");
  }
  const context = await browser.newContext({
    baseURL: environment.openPlatformWebBaseUrl,
    storageState
  });
  const page = await context.newPage();
  try {
    await body(page);
  } finally {
    await context.close();
  }
}

function companyInfoValue(page: Page, label: "企业名称" | "企业地址"): Locator {
  return page.locator(".company-content-right .meta-field")
    .filter({ has: page.locator(".label", { hasText: `${label}：` }) })
    .locator(":scope > .content");
}
