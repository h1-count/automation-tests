import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { assertNoUnauthorizedWriteRequests } from "../../../../src/support/web/networkOperationGuard.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const registrationPath = "/login?tab=register";
const submitPath = "/official/website/application/for/registration";
const uploadPath = "/company/file-upload";
const rejectedTransitionId = "open-platform-registration-rejected";

const noWriteNetworkPolicy = {
  forbiddenMutationPaths: [
    "/company/file-upload",
    "/get/msg/code",
    "/login/msg/verify",
    "/mcode/login",
    "/official/website/application/for/registration",
    "/official/website/send/register/msg"
  ]
};

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

interface RegistrationApplication {
  applicationId: string;
  state: string;
  corpName: string;
  corpAddress: string;
  ledgerResourceId: string;
}

type EditableRegistrationField = Exclude<keyof RegistrationCandidate, "license" | "syntheticKey">;

interface RejectedReapplication {
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

configureFormalSuite(formalExecutionManifest);

formalCase(
  "OPEN-REG-20260807-010",
  "合成企业申请单次受控提交（含一次 OTP）",
  async ({ page }, runtime) => {
    const candidate = buildRegistrationCandidate("approved-primary");
    if (await runtime.stageCompleted("registration-submitted")) {
      runtime.addAssertion("已从持久化提交受理结果恢复，未重复提交注册申请");
      return;
    }
    const application = await submitRegistrationCandidate(
      page,
      runtime,
      "OPEN-REG-20260807-010",
      candidate
    );
    await runtime.publishResource(
      "pending-enterprise-OPEN-REG-20260807-010",
      application.ledgerResourceId,
      "Synthetic registration reached the reviewed pending route."
    );
    await runtime.completeStage("registration-submitted");
    runtime.addAssertion("注册申请已被受理并跳转 register-pending 路由；审核通过不在本批次范围内");
  }
);

formalCase(
  "OPEN-REG-20260807-011",
  "协议与必填条件对提交资格的阻断",
  async ({ browser }, runtime) => {
    runtime.classifyFailure("TEST_DATA");
    const pending = await runtime.consumeResource("pending-enterprise-OPEN-REG-20260807-010");
    const pendingRecord = await runtime.manager.store.readResource(pending.resourceId);
    expect(pendingRecord?.metadata.syntheticKey).toBe(
      buildRegistrationCandidate("approved-primary").syntheticKey
    );
    runtime.addAssertion("011 与 010 属同一 headed 注册事务；011 不重发 OTP 也不发出注册提交请求");

    await test.step("初始态提交控件结构性阻断（未发送 OTP）", async () => {
      await withIsolatedRegistrationPage(browser, async (page, panel) => {
        await assertSubmitBlockedWithoutMutation(page, panel, runtime, "initial_state", async () => {
          // 初始态：不填写任何字段、不发送 OTP、不勾选协议，仅观察提交控件。
          const agreement = panel.getByRole("checkbox", {
            name: "同意注册用户协议",
            exact: true
          });
          await expect(agreement, "初始态协议不得处于已勾选状态").not.toBeChecked();
        });
      });
    });

    await test.step("已建立 verified 会话后仅取消协议时阻断", async () => {
      await withIsolatedRegistrationPage(browser, async (page, panel) => {
        await assertSubmitBlockedWithoutMutation(
          page,
          panel,
          runtime,
          "agreement_missing",
          async () => {
            // 011 无 OTP 预算，不重新发送验证码；此处填写全部字段并模拟
            // “仅缺少协议同意”的决策表条件，验证提交控件仍被阻断。
            const candidate = buildRegistrationCandidate("decision-agreement-missing");
            await fillRegistrationCandidate(panel, candidate);
            const agreement = panel.getByRole("checkbox", {
              name: "同意注册用户协议",
              exact: true
            });
            await checkVisibleElementPlusCheckbox(agreement, "注册用户协议勾选框");
            const visibleAgreement = agreement.locator("xpath=ancestor::label[1]");
            await visibleAgreement.click();
            await expect(agreement, "取消勾选后协议必须回到未同意状态").not.toBeChecked();
          }
        );
      });
    });

    await test.step("已建立 verified 会话后仅清空一个必填字段时阻断", async () => {
      await withIsolatedRegistrationPage(browser, async (page, panel) => {
        await assertSubmitBlockedWithoutMutation(
          page,
          panel,
          runtime,
          "required_field_missing",
          async () => {
            const candidate = buildRegistrationCandidate("decision-required-field-missing");
            await fillRegistrationCandidate(panel, candidate);
            const addressField = panel.getByLabel("注册企业地址", { exact: true });
            await addressField.fill("");
            await addressField.press("Tab");
          }
        );
      });
    });

    runtime.classifyFailure("PRODUCT");
    runtime.addAssertion("协议与必填条件三类单缺失组合均未发出注册提交请求");
  }
);

formalCase(
  "OPEN-REG-20260807-014",
  "审核驳回后按反馈重新发起注册（复用同手机号）",
  async ({ page }, runtime) => {
    runtime.classifyFailure("TEST_DATA");
    const baseline = buildRegistrationCandidate("approved-primary");
    const input = buildRejectedReapplication();
    expect(
      input.originalCandidate.phone,
      "候选 B 必须复用 010 同一专用测试手机号"
    ).toBe(baseline.phone);
    expect(
      input.correctedCandidate.phone,
      "候选 C 必须复用 010 同一专用测试手机号"
    ).toBe(baseline.phone);
    expect(
      input.originalCandidate.corpName,
      "候选 B 必须与 010 审核通过企业名称不同"
    ).not.toBe(baseline.corpName);
    expect(
      input.originalCandidate.corpIdentifier,
      "候选 B 必须与 010 审核通过企业标识不同"
    ).not.toBe(baseline.corpIdentifier);
    runtime.addAssertion("前置企业、候选 B、候选 C 使用同一手机号且企业身份互不相同");

    if (!(await runtime.stageCompleted("rejected-registration-submitted"))) {
      const application = await submitRegistrationCandidate(
        page,
        runtime,
        "OPEN-REG-20260807-014",
        input.originalCandidate
      );
      await runtime.publishResource(
        "pending-enterprise-OPEN-REG-20260807-014",
        application.ledgerResourceId,
        "Synthetic rejection candidate B reached the reviewed pending route."
      );
      await runtime.completeStage("rejected-registration-submitted");
      await runtime.awaitExternalTransition(rejectedTransitionId);
    }
    const rejectedOutcome = await runtime.transitionOutcome(rejectedTransitionId);
    if (!rejectedOutcome) await runtime.awaitExternalTransition(rejectedTransitionId);

    runtime.classifyFailure("PRODUCT");
    expect(rejectedOutcome).toBe("rejected");
    const rejectedTransition = await runtime.transitionRecord(rejectedTransitionId);
    expect(rejectedTransition?.attestationDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      input.corrections.length,
      "重新注册前必须有至少一项与驳回反馈关联的修订"
    ).toBeGreaterThan(0);
    for (const correction of input.corrections) {
      expect(input.expectedFeedbackRefs).toContain(correction.feedbackRef);
      expect(correction.before).toBe(input.originalCandidate[correction.field]);
      expect(correction.after).toBe(input.correctedCandidate[correction.field]);
      expect(
        correction.after,
        `${correction.field} 必须按反馈发生变化`
      ).not.toBe(correction.before);
    }
    expect(
      new Set(input.corrections.map((correction) => correction.feedbackRef)),
      "每一条驳回反馈都必须至少对应一项重新注册修订"
    ).toEqual(new Set(input.expectedFeedbackRefs));
    const correctedFields = new Set(input.corrections.map((correction) => correction.field));
    for (const field of editableRegistrationFields) {
      if (!correctedFields.has(field)) {
        expect(
          input.correctedCandidate[field],
          `${field} 不在反馈修订范围内时应保持原值`
        ).toBe(input.originalCandidate[field]);
      }
    }
    expect(
      input.correctedCandidate.syntheticKey,
      "候选 C 必须使用独立 syntheticKey 以获得新的提交 intent"
    ).not.toBe(input.originalCandidate.syntheticKey);
    runtime.addAssertion(
      "候选 B 的驳回结果与冻结的合成反馈由外部转换确认，未发明不可用的驳回详情接口"
    );

    if (await runtime.stageCompleted("reapplication-submitted")) {
      runtime.addAssertion("已从持久化终段恢复，未重复提交驳回后的企业注册申请");
      return;
    }

    await submitRegistrationCandidate(
      page,
      runtime,
      "OPEN-REG-20260807-014",
      input.correctedCandidate
    );
    await runtime.confirmResource(
      "rejected-review-attestation-OPEN-REG-20260807-014",
      "Rejected review and notification were attested with frozen synthetic feedback."
    );
    await runtime.completeStage("reapplication-submitted");
    runtime.addAssertion("驳回后使用修订后的合成资料重新发起了一次新的企业注册");
  }
);

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

function buildRejectedReapplication(): RejectedReapplication {
  const originalCandidate = buildRegistrationCandidate("rejected-primary");
  const correctedCandidate: RegistrationCandidate = {
    ...originalCandidate,
    syntheticKey: `${originalCandidate.syntheticKey}-reapplication`,
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
  candidate: RegistrationCandidate
): Promise<void> {
  const values: Array<[string, string]> = [
    ["注册企业名称", candidate.corpName],
    ["注册企业标识", candidate.corpIdentifier],
    ["注册企业地址", candidate.corpAddress],
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

async function assertSubmitBlockedWithoutMutation(
  page: Page,
  panel: Locator,
  runtime: FormalCaseRuntime,
  scenario: string,
  setup: () => Promise<void>
): Promise<void> {
  await assertNoMutationRequests(page, async () => {
    await setup();
    const submit = panel.getByRole("button", {
      name: "同意条款并注册",
      exact: true
    });
    await requireUniqueVisible(submit, "注册提交按钮");
    const isDisabled = await submit.isDisabled().catch(() => true);
    if (isDisabled) {
      runtime.addAssertion(`${scenario}: submit control is structurally disabled before any request`);
    } else {
      await submit.click({ timeout: 2_000 }).catch(() => undefined);
      runtime.addAssertion(
        `${scenario}: enabled submit click produced no mutation request (form validation blocked)`
      );
    }
  });
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

async function assertNoMutationRequests(
  page: Page,
  body: () => Promise<void>
): Promise<void> {
  await assertNoUnauthorizedWriteRequests(page, noWriteNetworkPolicy, body);
}
