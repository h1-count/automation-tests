import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Browser, Locator, Page } from "@playwright/test";
import { resolveTestEnvironment } from "../../../../src/env/testEnvironment.js";
import {
  configureFormalSuite,
  expect,
  formalCase,
  FormalBlockedError,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import type { FormalCaseRuntime } from "../../../../src/support/formal-execution/types.js";
import { assertNoUnauthorizedWriteRequests } from "../../../../src/support/web/networkOperationGuard.js";
import { formalExecutionManifest } from "./execution.manifest.js";

interface ReviewFixture {
  fixtureRef: string;
  applicationId: string;
  expectedState: "approved" | "rejected";
  expectedRecipientRef: string;
  submittedAt: string;
}

interface ReviewFixtureProvider {
  rows(input: ProviderInput): Promise<ReviewFixture[]>;
}

interface ReviewStateQueryProvider {
  query(input: ProviderInput & { applicationId: string }): Promise<{
    state: "approved" | "rejected" | "pending";
    completedAt?: string;
    evidenceRef?: string;
  }>;
}

interface NotificationLedgerQueryProvider {
  list(input: ProviderInput & { applicationId: string }): Promise<Array<{
    noticeId: string;
    kind: "review_result" | "platform_credentials";
    recipientRef: string;
    sentAt: string;
  }>>;
}

interface BusinessCalendarProvider {
  businessDaysBetween(startedAt: string, completedAt: string): Promise<number>;
}

interface ApprovedEnterpriseFixture {
  fixtureRef: string;
  applicationId: string;
  contactRef: string;
  companyName: string;
}

interface ApprovedEnterpriseFixtureProvider {
  resolve(input: ProviderInput & { syntheticKey: string }): Promise<ApprovedEnterpriseFixture>;
}

interface ManagerLedgerQueryProvider {
  list(input: ProviderInput & { fixtureRef: string }): Promise<Array<{
    accountRef: string;
    role: string;
  }>>;
}

interface ProviderInput {
  requestId: string;
  caseId: string;
  environment: string;
}

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
const approvedTransitionId = "open-platform-registration-approved";
const rejectedTransitionId = "open-platform-registration-rejected";

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-20260803-010", "审核结果短信通知", async (_fixtures, runtime) => {
  runtime.classifyFailure("PRODUCT");
  const approved = await runtime.transitionRecord(approvedTransitionId);
  const rejected = await runtime.transitionRecord(rejectedTransitionId);
  expect(approved?.outcome).toBe("approved");
  expect(rejected?.outcome).toBe("rejected");
  expect(approved?.attestationDigest).toMatch(/^[a-f0-9]{64}$/u);
  expect(rejected?.attestationDigest).toMatch(/^[a-f0-9]{64}$/u);
  runtime.addAssertion("审核通过和驳回分支均取得不含短信正文的用户收件确认");
});

formalCase("OPEN-REG-20260803-018", "注册联系人默认企业管理员", async ({ browser }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const expectedContactName = requireExpectedCompanyValue(
    "OPEN_PLATFORM_SUBMITTED_CONTACT_NAME_TEST",
    "已提交合成注册联系人姓名"
  );
  expect(expectedContactName).toBe(approved.contactName);
  runtime.classifyFailure("PRODUCT");
  await withApprovedIsolatedPage(browser, async (page) => {
    await assertNoBusinessMutationRequests(page, async () => {
      await page.goto("/console");
      const contactName = page.locator(".console-home .user-info-name");
      await requireAuthenticatedLanding(
        page,
        contactName,
        "审核通过企业的只读认证会话已失效。"
      );
      await expect(contactName).toHaveText(expectedContactName);
      await expect(page.locator(".console-home .user-info-authority")).toHaveText("管理员");
    });
  });
  runtime.addAssertion("控制台直接显示合成注册联系人且角色为管理员");
});

formalCase("OPEN-REG-20260803-019", "企业信息审核在 1–2 个工作日内完成", async (_fixtures, runtime) => {
  runtime.classifyFailure("PRODUCT");
  const review = await runtime.transitionRecord(approvedTransitionId);
  expect(review?.status).toBe("resolved");
  expect(review?.resolvedAt).toBeTruthy();
  const calendar = await runtime.useCapability<BusinessCalendarProvider>("business-calendar-contract");
  const elapsed = await calendar.businessDaysBetween(review!.requestedAt, review!.resolvedAt!);
  expect(Number.isInteger(elapsed) && elapsed >= 0).toBe(true);
  expect(elapsed, "审核完成时间不得晚于提交后的第二个工作日").toBeLessThanOrEqual(2);
  runtime.addAssertion(`审核在 ${elapsed} 个工作日边界内完成；不设置错误的最短等待时间`);
});

formalCase("OPEN-REG-20260803-020", "审核通过后额外发送平台账号密码通知", async (_fixtures, runtime) => {
  runtime.classifyFailure("PRODUCT");
  await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const review = await runtime.transitionRecord(approvedTransitionId);
  expect(review?.outcome).toBe("approved");
  expect(review?.attestationDigest).toMatch(/^[a-f0-9]{64}$/u);
  runtime.addAssertion("用户已分别确认审核结果短信和凭证短信，未读取或保存短信正文");
});

formalCase("OPEN-REG-20260803-022", "已提交企业名称只读且与提交基线一致", async ({ browser }, runtime) => {
  await verifySubmittedReadonlyField(browser, runtime, {
    caseId: "OPEN-REG-20260803-022",
    label: "企业名称",
    property: "companyName"
  });
});

formalCase("OPEN-REG-20260803-023", "同一企业恰有一个企业管理员账号", async (_fixtures, runtime) => {
  await verifySingleEnterpriseManager(runtime, "OPEN-REG-20260803-023");
});

formalCase("OPEN-REG-20260803-024", "已提交企业地址只读且与提交基线一致", async ({ browser }, runtime) => {
  await verifySubmittedReadonlyField(browser, runtime, {
    caseId: "OPEN-REG-20260803-024",
    label: "企业地址",
    property: "companyAddress"
  });
});

formalCase("OPEN-REG-20260803-026", "登录后企业组名称与提交企业名称一致", async ({ browser }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const expectedCompanyName = requireExpectedCompanyValue(
    "OPEN_PLATFORM_SUBMITTED_COMPANY_NAME_TEST",
    "已提交合成企业名称基线"
  );
  expect(expectedCompanyName).toBe(approved.corpName);
  runtime.classifyFailure("PRODUCT");
  await withApprovedIsolatedPage(browser, async (page) => {
    await assertNoBusinessMutationRequests(page, async () => {
      await page.goto("/console");
      const displayedCompany = page.locator(".console-home .user-info-company");
      await requireAuthenticatedLanding(
        page,
        displayedCompany,
        "审核通过企业的只读认证会话已失效。"
      );
      await requireUniqueVisible(displayedCompany, "控制台企业组名称");
      await expect(displayedCompany).toHaveText(expectedCompanyName);
    });
  });
  runtime.addAssertion("控制台直接显示的企业组名称与冻结的合成提交基线一致");
});

async function verifySingleEnterpriseManager(
  runtime: FormalCaseRuntime,
  caseId: "OPEN-REG-20260803-023"
): Promise<void> {
  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const fixtureProvider = await runtime.useCapability<ApprovedEnterpriseFixtureProvider>("approved-enterprise-fixture");
  const managers = await runtime.useCapability<ManagerLedgerQueryProvider>("manager-ledger-query-contract");
  await runtime.reserveOperation(
    "query_postcondition",
    "OPEN-REG-20260803-023-manager-count"
  );
  const input = providerInput(runtime, caseId);
  const fixture = await fixtureProvider.resolve({ ...input, syntheticKey: approved.syntheticKey });
  const records = (await managers.list({ ...input, fixtureRef: fixture.fixtureRef }))
    .filter((record) => record.role === "enterprise_admin");
  runtime.addOperationEvidence({
    operation: "query_postcondition",
    source: "postcondition_query",
    contractId: "manager-ledger-query-contract",
    outcome: "succeeded",
    finality: "final",
    stableIdentity: "not_required",
    fallbackUsed: false,
    reconciliation: "completed"
  });
  runtime.classifyFailure("PRODUCT");
  expect(records, "同一企业必须恰有一个企业管理员").toHaveLength(1);
  runtime.addAssertion("the enterprise has exactly one manager account");
}

function providerInput(runtime: FormalCaseRuntime, caseId: string): ProviderInput {
  return {
    requestId: runtime.snapshot.requestId,
    caseId,
    environment: runtime.snapshot.environment
  };
}

function assertNotificationMetadataOnly(notice: object): void {
  const forbidden = Object.keys(notice).filter((key) =>
    /(?:password|secret|body|content|payload|messageText)/iu.test(key)
  );
  if (forbidden.length > 0) {
    throw new FormalBlockedError("通知查询返回了凭据正文或敏感载荷字段，已拒绝读取和记录。");
  }
}

function assertSafeReference(value: string): void {
  if (!/^[^|\r\n]{1,128}$/u.test(value)) {
    throw new FormalBlockedError("通知身份比对返回了空值、过长值或可能含敏感分隔符的引用。");
  }
}

async function verifySubmittedReadonlyField(
  browser: Browser,
  runtime: FormalCaseRuntime,
  input: {
    caseId: "OPEN-REG-20260803-022" | "OPEN-REG-20260803-024";
    label: "企业名称" | "企业地址";
    property: "companyName" | "companyAddress";
  }
): Promise<void> {
  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const expectedValue = requireExpectedCompanyValue(
    input.property === "companyName"
      ? "OPEN_PLATFORM_SUBMITTED_COMPANY_NAME_TEST"
      : "OPEN_PLATFORM_SUBMITTED_COMPANY_ADDRESS_TEST",
    `已提交合成${input.label}基线`
  );
  expect(expectedValue).toBe(
    input.property === "companyName" ? approved.corpName : approved.corpAddress
  );

  await test.step(`核对企业信息页【${input.label}】只读呈现`, async () => {
    runtime.classifyFailure("SCRIPT");
    await withApprovedIsolatedPage(browser, async (page) => {
      await assertNoBusinessMutationRequests(page, async () => {
        await page.goto("/console/company/info");
        const field = page.locator(".company-content-right .meta-field").filter({
          has: page.locator(".label", { hasText: `${input.label}：` })
        });
        await requireAuthenticatedLanding(
          page,
          field,
          "已提交合成申请的只读认证会话已失效。"
        );
        await requireUniqueVisible(field, `企业信息页【${input.label}】字段`);
        await expect(field.locator(":scope > .content")).toHaveText(expectedValue);
        await expect(
          field.locator('input, textarea, select, button, a, [contenteditable="true"]')
        ).toHaveCount(0);
      });
    });
    runtime.addAssertion(`${input.label}无可操作编辑或保存入口，页面值与提交基线一致`);
  });

  runtime.addAssertion(`${input.label}的 UI 值与冻结合成提交基线一致，且页面不存在编辑或保存入口`);
}

function requireExpectedCompanyValue(variable: string, purpose: string): string {
  const value = process.env[variable]?.trim();
  if (!value || /[\r\n|]/u.test(value) || value.length > 100) {
    throw new FormalBlockedError(`${purpose}不可用或不符合脱敏合成数据约定。`);
  }
  return value;
}

async function approvedEnterpriseMetadata(runtime: FormalCaseRuntime): Promise<{
  syntheticKey: string;
  corpName: string;
  corpAddress: string;
  contactName: string;
}> {
  const handle = await runtime.consumeResource("approved-enterprise-OPEN-REG-20260803-009");
  const resource = await runtime.manager.store.readResource(handle.resourceId);
  const syntheticKey = resource?.metadata.syntheticKey;
  const corpName = resource?.metadata.corpName;
  const corpAddress = resource?.metadata.corpAddress;
  const contactName = resource?.metadata.contactName;
  if ([syntheticKey, corpName, corpAddress, contactName].some((value) => typeof value !== "string")) {
    throw new FormalBlockedError("审核通过企业资源缺少已登记的合成基线。");
  }
  return {
    syntheticKey: syntheticKey as string,
    corpName: corpName as string,
    corpAddress: corpAddress as string,
    contactName: contactName as string
  };
}

async function withApprovedIsolatedPage(
  browser: Browser,
  body: (page: Page) => Promise<void>
): Promise<void> {
  const environment = resolveTestEnvironment();
  const storageState = requireApprovedStorageState();
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

function requireApprovedStorageState(): string {
  const environment = resolveTestEnvironment();
  const storageState = environment.openPlatformAuthStatePath;
  if (!storageState || !existsSync(storageState)) {
    throw new FormalBlockedError("已提交合成申请的本地只读认证会话不可用。");
  }
  const expectedDigest = process.env.OPEN_PLATFORM_APPROVED_AUTH_STATE_SHA256_TEST?.trim();
  const actualDigest = createHash("sha256").update(readFileSync(storageState)).digest("hex");
  if (!expectedDigest || actualDigest !== expectedDigest) {
    throw new FormalBlockedError("只读认证会话与审查摘要不一致。");
  }
  return storageState;
}

async function requireUniqueVisible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}的源码契约应在客户端渲染完成后唯一`).toHaveCount(1);
  await expect(locator, `${label}应在客户端渲染完成后可见`).toBeVisible();
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

async function assertNoBusinessMutationRequests(page: Page, body: () => Promise<void>): Promise<void> {
  await assertNoUnauthorizedWriteRequests(page, noWriteNetworkPolicy, body);
}
