import type { Locator, Page } from "@playwright/test";
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

const registrationPath = "/login?tab=register";
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

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-20260807-001", "企业名称必填、字符集与 2–50 字符边界", async ({ page }) => {
  const panel = await openRegistrationPanel(page);
  const companyName = panel.getByLabel("注册企业名称", { exact: true });

  await test.step("核对企业名称必填提示", async () => {
    await assertNoMutationRequests(page, async () => {
      await replaceAsUser(companyName, "");
      await requireUniqueVisible(
        panel.getByText("请输入集团名称", { exact: true }),
        "企业名称空值提示"
      );
    });
  });

  await test.step("核对 2–50 字符与字符集边界", async () => {
    await assertNoMutationRequests(page, async () => {
      await replaceAsUser(companyName, "测");
      await expectRejectedFieldValue(companyName, "测", "1 字符企业名称应被阻断");

      const minimumName = "测试";
      await replaceAsUser(companyName, minimumName);
      await expectAcceptedFieldValue(companyName, minimumName);

      const maximumName = "测".repeat(50);
      await replaceAsUser(companyName, maximumName);
      await expectAcceptedFieldValue(companyName, maximumName);

      const overMaximumName = "测".repeat(51);
      await replaceAsUser(companyName, overMaximumName);
      await expectRejectedFieldValue(companyName, overMaximumName, "51 字符企业名称应被阻断");

      const invalidName = "测试@";
      await replaceAsUser(companyName, invalidName);
      await expectRejectedFieldValue(companyName, invalidName, "含特殊字符的企业名称应被阻断");
    });
  });
});

formalCase("OPEN-REG-20260807-002", "已存在企业名称的精确唯一性提示", async ({ page }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const registeredName = approved.corpName;
  runtime.classifyFailure("SCRIPT");
  const panel = await openRegistrationPanel(page);

  runtime.classifyFailure("PRODUCT");
  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(panel.getByLabel("注册企业名称", { exact: true }), registeredName);
    await requireUniqueVisible(
      panel.getByText("该企业名称已存在，请确认是否已注册或更换其他名称", { exact: true }),
      "企业名称重复提示"
    );
  });
  runtime.addAssertion("duplicate company-name validation remained UI-only and sent no mutation request");
});

formalCase("OPEN-REG-20260807-003", "企业信用代码必填与重复唯一性提示", async ({ page }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const registeredCreditCode = approved.corpCode;
  runtime.classifyFailure("SCRIPT");
  const panel = await openRegistrationPanel(page);
  const creditCode = panel.getByLabel("注册企业信用代码", { exact: true });

  runtime.classifyFailure("PRODUCT");
  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(creditCode, "");
    await expectRejectedFieldValue(creditCode, "", "空统一社会信用代码应被阻断");

    await replaceAsUser(creditCode, registeredCreditCode);
    await requireUniqueVisible(
      panel.getByText("该统一社会信用代码已注册，请确认是否已提交过申请", { exact: true }),
      "统一社会信用代码重复提示"
    );
  });
  runtime.addAssertion("duplicate credit-code validation remained UI-only and sent no mutation request");
});

formalCase("OPEN-REG-20260807-004", "企业地址必填与 50 字符边界", async ({ page }) => {
  const panel = await openRegistrationPanel(page);
  const address = panel.getByLabel("注册企业地址", { exact: true });

  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(address, "");
    await requireUniqueVisible(
      panel.getByText("请输入企业地址", { exact: true }),
      "企业地址空值提示"
    );

    const maximumAddress = "址".repeat(50);
    await replaceAsUser(address, maximumAddress);
    await expectAcceptedFieldValue(address, maximumAddress);

    const overMaximumAddress = "址".repeat(51);
    await replaceAsUser(address, overMaximumAddress);
    await expectRejectedFieldValue(address, overMaximumAddress, "51 字符企业地址应被阻断");
  });
});

formalCase("OPEN-REG-20260807-005", "企业标识必填、字符集、3–6 位边界与唯一性", async ({ page }, runtime) => {
  const panel = await openRegistrationPanel(page);
  const identifier = panel.getByLabel("注册企业标识", { exact: true });
  const stableSeed = `t${runtime.snapshot.digest.slice(0, 5)}`;

  await test.step("核对企业标识常驻提示", async () => {
    await requireUniqueVisible(
      panel.getByText("请输入3-6 位小写字母或数字，用作产品Model的组成部分", { exact: true }),
      "企业标识常驻提示"
    );
  });

  await test.step("核对 3–6 位小写字母或数字边界", async () => {
    await assertNoMutationRequests(page, async () => {
      await replaceAsUser(identifier, "");
      await expectRejectedFieldValue(identifier, "", "空企业标识应被阻断");

      await replaceAsUser(identifier, stableSeed.slice(0, 2));
      await expectRejectedFieldValue(identifier, stableSeed.slice(0, 2), "2 位企业标识应被阻断");

      await replaceAsUser(identifier, stableSeed.slice(0, 3));
      await expectAcceptedFieldValue(identifier, stableSeed.slice(0, 3));

      await replaceAsUser(identifier, stableSeed);
      await expectAcceptedFieldValue(identifier, stableSeed);

      const overMaximumIdentifier = `${stableSeed}0`;
      await replaceAsUser(identifier, overMaximumIdentifier);
      await expectRejectedFieldValue(identifier, overMaximumIdentifier, "7 位企业标识应被阻断");

      const invalidIdentifier = `${stableSeed.slice(0, 2)}#`;
      await replaceAsUser(identifier, invalidIdentifier);
      await expectRejectedFieldValue(identifier, invalidIdentifier, "含非法字符的企业标识应被阻断");
    });
  });

  runtime.classifyFailure("TEST_DATA");
  const approved = await approvedEnterpriseMetadata(runtime);
  const registeredIdentifier = approved.corpIdentifier;
  runtime.classifyFailure("PRODUCT");
  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(identifier, registeredIdentifier);
    await requireUniqueVisible(
      panel.getByText("该企业标识已存在，请更改为其他标识", { exact: true }),
      "企业标识重复提示"
    );
  });
  runtime.addAssertion("duplicate company-identifier validation remained UI-only and sent no mutation request");
});

formalCase("OPEN-REG-20260807-006", "申请人姓名必填、中英文与 20 字符边界", async ({ page }) => {
  const panel = await openRegistrationPanel(page);
  const applicantName = panel.getByLabel("注册联系人姓名", { exact: true });

  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(applicantName, "");
    await requireUniqueVisible(
      panel.getByText("请输入联系人名称", { exact: true }),
      "联系人名称空值提示"
    );

    await replaceAsUser(applicantName, "测试申请人");
    await expectAcceptedFieldValue(applicantName, "测试申请人");

    await replaceAsUser(applicantName, "SyntheticApplicant");
    await expectAcceptedFieldValue(applicantName, "SyntheticApplicant");

    const maximumName = "测".repeat(20);
    await replaceAsUser(applicantName, maximumName);
    await expectAcceptedFieldValue(applicantName, maximumName);

    const overMaximumName = "测".repeat(21);
    await replaceAsUser(applicantName, overMaximumName);
    await expectRejectedFieldValue(applicantName, overMaximumName, "21 字符申请人姓名应被阻断");

    const nameWithDigit = "测试1";
    await replaceAsUser(applicantName, nameWithDigit);
    await expectRejectedFieldValue(applicantName, nameWithDigit, "含数字的申请人姓名应被阻断");
  });
});

formalCase("OPEN-REG-20260807-007", "联系方式必填与 11 位手机号格式", async ({ page }, runtime) => {
  runtime.classifyFailure("TEST_DATA");
  const phone = requireRuntimeValue(
    "OPEN_PLATFORM_REGISTRATION_PHONE_TEST",
    "OPEN-REG-20260807-007 的脱敏合成手机号秘密引用",
    /^1[0-9]{10}$/
  );
  runtime.classifyFailure("SCRIPT");
  const panel = await openRegistrationPanel(page);
  const phoneInput = panel.getByLabel("注册联系电话", { exact: true });

  runtime.classifyFailure("PRODUCT");
  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(phoneInput, "");
    await expectRejectedFieldValue(phoneInput, "", "空联系方式应被阻断");

    await replaceAsUser(phoneInput, phone.slice(0, 10));
    await expectRejectedFieldValue(phoneInput, phone.slice(0, 10), "10 位联系方式应被阻断");

    await replaceAsUser(phoneInput, phone);
    const retainedPhoneLength = await phoneInput.evaluate(
      (element) => (element as HTMLInputElement).value.length
    );
    expect(retainedPhoneLength).toBe(11);
    await requireUniqueVisible(
      panel.getByLabel("注册短信验证码", { exact: true }),
      "注册验证码输入框"
    );

    const overMaximumPhone = `${phone}0`;
    await replaceAsUser(phoneInput, overMaximumPhone);
    await expectRejectedFieldValue(phoneInput, overMaximumPhone, "12 位联系方式应被阻断");
  });
});

formalCase("OPEN-REG-20260807-008", "企业简介与邮箱选填、长度与格式", async ({ page }) => {
  const panel = await openRegistrationPanel(page);
  const introduction = panel.getByLabel("注册企业简介", { exact: true });
  const email = panel.getByLabel("注册企业邮箱", { exact: true });

  await test.step("企业简介选填与 100 字符边界（源码契约）", async () => {
    await assertNoMutationRequests(page, async () => {
      await replaceAsUser(introduction, "");
      await expectAcceptedFieldValue(introduction, "");

      const maximumIntroduction = "介".repeat(100);
      await replaceAsUser(introduction, maximumIntroduction);
      await expectAcceptedFieldValue(introduction, maximumIntroduction);

      const overMaximumIntroduction = "介".repeat(101);
      await replaceAsUser(introduction, overMaximumIntroduction);
      await expectRejectedFieldValue(introduction, overMaximumIntroduction, "101 字符企业简介应被阻断");
    });
  });

  await test.step("企业邮箱选填与格式校验", async () => {
    await assertNoMutationRequests(page, async () => {
      await replaceAsUser(email, "");
      await expectAcceptedFieldValue(email, "");

      const validEmail = "automation@example.test";
      await replaceAsUser(email, validEmail);
      await expectAcceptedFieldValue(email, validEmail);

      const invalidEmail = "automation.invalid";
      await replaceAsUser(email, invalidEmail);
      await expectRejectedFieldValue(email, invalidEmail, "非法格式企业邮箱应被阻断");
    });
  });
});

async function openRegistrationPanel(page: Page): Promise<Locator> {
  if (!isRegistrationRoute(page.url())) {
    await page.goto(registrationPath);
  }
  const registrationTab = page.getByRole("tab", { name: "注册", exact: true });
  await requireUniqueVisible(registrationTab, "注册页签");
  await expect(registrationTab).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "注册", exact: true });
  await requireUniqueVisible(panel, "注册表单面板");
  return panel;
}

function isRegistrationRoute(url: string): boolean {
  try {
    const current = new URL(url);
    return current.pathname === "/login"
      && current.searchParams.get("tab") === "register";
  } catch {
    return false;
  }
}

async function replaceAsUser(locator: Locator, value: string): Promise<void> {
  await requireUniqueVisible(locator, "注册字段候选定位");
  await locator.fill("");
  if (value) {
    await locator.pressSequentially(value);
  }
  await locator.press("Tab");
}

async function requireUniqueVisible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}应在客户端渲染完成后唯一`).toHaveCount(1);
  await expect(locator, `${label}应在客户端渲染完成后可见`).toBeVisible();
}

async function approvedEnterpriseMetadata(runtime: FormalCaseRuntime): Promise<{
  corpName: string;
  corpIdentifier: string;
  corpCode: string;
}> {
  const handle = await runtime.consumeResource("pending-enterprise-OPEN-REG-20260807-010");
  const resource = await runtime.manager.store.readResource(handle.resourceId);
  const corpName = resource?.metadata.corpName;
  const corpIdentifier = resource?.metadata.corpIdentifier;
  const corpCode = resource?.metadata.corpCode;
  if (typeof corpName !== "string" || typeof corpIdentifier !== "string" || typeof corpCode !== "string") {
    throw new FormalBlockedError("审核通过企业资源缺少已登记的名称、标识或信用代码基线。");
  }
  return { corpName, corpIdentifier, corpCode };
}

async function expectAcceptedFieldValue(locator: Locator, expectedValue: string): Promise<void> {
  await expect(locator).toHaveValue(expectedValue);
  await expect.poll(() => hasSemanticInvalidState(locator), {
    message: "字段应保持可继续的语义校验状态"
  }).toBe(false);
}

async function expectRejectedFieldValue(
  locator: Locator,
  attemptedValue: string,
  message: string
): Promise<void> {
  await expect.poll(async () => {
    const retainedValue = await locator.inputValue();
    return retainedValue !== attemptedValue || await hasSemanticInvalidState(locator);
  }, { message }).toBe(true);
}

async function hasSemanticInvalidState(locator: Locator): Promise<boolean> {
  if (await locator.getAttribute("aria-invalid") === "true") {
    return true;
  }
  const references = [
    await locator.getAttribute("aria-errormessage"),
    await locator.getAttribute("aria-describedby")
  ]
    .flatMap((value) => value?.split(/\s+/) ?? [])
    .filter(Boolean);
  if (references.length === 0) {
    return false;
  }
  return locator.evaluate((element, ids) => ids.some((id) => {
    const message = element.ownerDocument.getElementById(id);
    if (!message?.textContent?.trim()) {
      return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(message);
    return style?.display !== "none" && style?.visibility !== "hidden";
  }), references);
}

async function assertNoMutationRequests(page: Page, body: () => Promise<void>): Promise<void> {
  await assertNoUnauthorizedWriteRequests(page, noWriteNetworkPolicy, body);
}

function requireRuntimeValue(name: string, purpose: string, pattern?: RegExp): string {
  const value = process.env[name]?.trim();
  if (!value || (pattern && !pattern.test(value))) {
    throw new FormalBlockedError(`${purpose}不可用或格式不符合受控约定。`);
  }
  return value;
}
