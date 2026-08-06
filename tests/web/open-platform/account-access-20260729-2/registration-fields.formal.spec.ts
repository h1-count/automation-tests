import type { Locator, Page, Request } from "@playwright/test";
import {
  configureFormalSuite,
  expect,
  formalCase,
  FormalBlockedError,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import type {
  FormalCaseDefinition,
  FormalCaseRuntime
} from "../../../../src/support/formal-execution/types.js";
import { formalExecutionManifest } from "./execution.manifest.js";

const registrationPath = "/login?tab=register";
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

configureFormalSuite(formalExecutionManifest);

formalCase("OPEN-REG-001", "企业名称必填、字符集与长度边界", async ({ page }) => {
  requireManifestCapabilities("OPEN-REG-001", ["registration-page-selector-contract"]);
  const panel = await openRegistrationPanel(page);
  const companyName = panel.getByPlaceholder("请输入企业名称", { exact: true });

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

formalCase("OPEN-REG-002", "已注册企业名称拦截", async ({ page }, runtime) => {
  requireManifestCapabilities("OPEN-REG-002", [
    "registration-page-selector-contract",
    "registered-company-name-fixture",
    "registration-application-readonly-query"
  ]);
  requireAuthorizedOperation(runtime, "query_postcondition", "OPEN-REG-002");
  const registeredName = requireRuntimeValue(
    "OPEN_PLATFORM_REGISTERED_COMPANY_NAME_TEST",
    "OPEN-REG-002 的可控已注册合成企业名称"
  );
  const panel = await openRegistrationPanel(page);

  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(
      panel.getByPlaceholder("请输入企业名称", { exact: true }),
      registeredName
    );
    await requireUniqueVisible(
      panel.getByText("该企业名称已存在，请确认是否已注册或更换其他名称", { exact: true }),
      "企业名称重复提示"
    );
  });

  throw new FormalBlockedError(
    "OPEN-REG-002：当前仓库没有经审查的注册申请只读查询适配器；页面文案不能替代“未创建新申请”的后置核对。"
  );
});

formalCase("OPEN-REG-003", "企业标识必填、字符集与长度边界", async ({ page }, runtime) => {
  requireManifestCapabilities("OPEN-REG-003", ["registration-page-selector-contract"]);
  const panel = await openRegistrationPanel(page);
  const identifier = panel.getByPlaceholder("请输入企业标识", { exact: true });
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
      await expectRejectedFieldValue(
        identifier,
        overMaximumIdentifier,
        "7 位企业标识应被阻断"
      );

      const invalidIdentifier = `${stableSeed.slice(0, 2)}#`;
      await replaceAsUser(identifier, invalidIdentifier);
      await expectRejectedFieldValue(
        identifier,
        invalidIdentifier,
        "含非法字符的企业标识应被阻断"
      );
    });
  });
});

formalCase("OPEN-REG-004", "已注册企业标识拦截", async ({ page }, runtime) => {
  requireManifestCapabilities("OPEN-REG-004", [
    "registration-page-selector-contract",
    "registered-company-identifier-fixture",
    "registration-application-readonly-query"
  ]);
  requireAuthorizedOperation(runtime, "query_postcondition", "OPEN-REG-004");
  const registeredIdentifier = requireRuntimeValue(
    "OPEN_PLATFORM_REGISTERED_COMPANY_IDENTIFIER_TEST",
    "OPEN-REG-004 的可控已注册合成企业标识",
    /^[a-z0-9]{3,6}$/
  );
  const panel = await openRegistrationPanel(page);

  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(
      panel.getByPlaceholder("请输入企业标识", { exact: true }),
      registeredIdentifier
    );
    await requireUniqueVisible(
      panel.getByText("该企业标识已存在，请更改为其他标识", { exact: true }),
      "企业标识重复提示"
    );
  });

  throw new FormalBlockedError(
    "OPEN-REG-004：当前仓库没有经审查的注册申请只读查询适配器；页面文案不能替代“未创建新申请”的后置核对。"
  );
});

formalCase("OPEN-REG-005", "统一社会信用代码必填与重复拦截", async ({ page }, runtime) => {
  requireManifestCapabilities("OPEN-REG-005", [
    "registration-page-selector-contract",
    "registered-credit-code-fixture",
    "registration-application-readonly-query"
  ]);
  requireAuthorizedOperation(runtime, "query_postcondition", "OPEN-REG-005");
  const registeredCreditCode = requireRuntimeValue(
    "OPEN_PLATFORM_REGISTERED_CREDIT_CODE_TEST",
    "OPEN-REG-005 的可控已注册合成统一社会信用代码",
    /^[A-Z0-9]{18}$/
  );
  const panel = await openRegistrationPanel(page);
  const creditCode = panel.getByPlaceholder("企业信用代码", { exact: true });

  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(creditCode, "");
    await expectRejectedFieldValue(creditCode, "", "空统一社会信用代码应被阻断");

    await replaceAsUser(creditCode, registeredCreditCode);
    await requireUniqueVisible(
      panel.getByText("该统一社会信用代码已注册，请确认是否已提交过申请", { exact: true }),
      "统一社会信用代码重复提示"
    );
  });

  throw new FormalBlockedError(
    "OPEN-REG-005：当前仓库没有经审查的注册申请只读查询适配器；页面文案不能替代“未创建新申请”的后置核对。"
  );
});

formalCase("OPEN-REG-006", "联系方式 11 位与手机号验证入口", async ({ page }) => {
  requireManifestCapabilities("OPEN-REG-006", [
    "registration-page-selector-contract",
    "registration-phone-secret-reference",
    "sensitive-input-artifact-redaction"
  ]);
  const phone = requireRuntimeValue(
    "OPEN_PLATFORM_REGISTRATION_PHONE_TEST",
    "OPEN-REG-006 的脱敏合成手机号秘密引用",
    /^1[0-9]{10}$/
  );
  const panel = await openRegistrationPanel(page);
  const phoneInput = panel.getByPlaceholder("请输入联系方式", { exact: true });

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
      panel.getByPlaceholder("请输入验证码", { exact: true }),
      "注册验证码输入框"
    );
    await requireUniqueVisible(
      panel.getByRole("button", { name: "获取验证码", exact: true }),
      "注册获取验证码按钮"
    );

    const overMaximumPhone = `${phone}0`;
    await replaceAsUser(phoneInput, overMaximumPhone);
    await expectRejectedFieldValue(phoneInput, overMaximumPhone, "12 位联系方式应被阻断");
  });
});

formalCase("OPEN-REG-011", "企业地址必填与 50 字符边界", async ({ page }) => {
  requireManifestCapabilities("OPEN-REG-011", ["registration-page-selector-contract"]);
  const panel = await openRegistrationPanel(page);
  const address = panel.getByPlaceholder("请输入企业地址", { exact: true });

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

formalCase("OPEN-REG-012", "申请人姓名必填、字符集与 20 字符边界", async ({ page }) => {
  requireManifestCapabilities("OPEN-REG-012", ["registration-page-selector-contract"]);
  const panel = await openRegistrationPanel(page);
  const applicantName = panel.getByPlaceholder("请输入您的姓名", { exact: true });

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

formalCase("OPEN-REG-013", "企业简介选填与 300 字符边界", async ({ page }) => {
  requireManifestCapabilities("OPEN-REG-013", ["registration-page-selector-contract"]);
  const panel = await openRegistrationPanel(page);
  const introduction = panel.getByPlaceholder("请输入企业简介", { exact: true });

  await assertNoMutationRequests(page, async () => {
    await replaceAsUser(introduction, "");
    await expectAcceptedFieldValue(introduction, "");

    const maximumIntroduction = "介".repeat(300);
    await replaceAsUser(introduction, maximumIntroduction);
    await expectAcceptedFieldValue(introduction, maximumIntroduction);

    const overMaximumIntroduction = "介".repeat(301);
    await replaceAsUser(introduction, overMaximumIntroduction);
    await expectRejectedFieldValue(
      introduction,
      overMaximumIntroduction,
      "301 字符企业简介应被阻断"
    );
  });
});

formalCase("OPEN-REG-014", "企业邮箱选填与格式校验", async ({ page }) => {
  requireManifestCapabilities("OPEN-REG-014", ["registration-page-selector-contract"]);
  const panel = await openRegistrationPanel(page);
  const email = panel.getByPlaceholder("请输入企业邮箱", { exact: true });

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

async function openRegistrationPanel(page: Page): Promise<Locator> {
  await page.goto(registrationPath);
  const registrationTab = page.getByRole("tab", { name: "注册", exact: true });
  await requireUniqueVisible(registrationTab, "注册页签");
  await expect(registrationTab).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "注册", exact: true });
  await requireUniqueVisible(panel, "注册表单面板");
  return panel;
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
  if (await locator.count() !== 1 || !(await locator.isVisible())) {
    throw new FormalBlockedError(`${label}不可用或不唯一；需补齐同版本可见探索证据。`);
  }
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
  let mutationCount = 0;
  const observe = (request: Request) => {
    if (!safeMethods.has(request.method().toUpperCase())) {
      mutationCount += 1;
    }
  };
  page.on("request", observe);
  try {
    await body();
    expect(mutationCount, "字段校验不得触发远端写请求").toBe(0);
  } finally {
    page.off("request", observe);
  }
}

function requireManifestCapabilities(caseId: string, capabilityIds: string[]): void {
  const definition = formalExecutionManifest.cases.find(
    (item: FormalCaseDefinition) => item.caseId === caseId
  );
  const missing = capabilityIds.filter((id) => !definition?.requiredCapabilities.includes(id));
  if (missing.length > 0) {
    throw new FormalBlockedError(
      `${caseId} 的 formal manifest 未声明必要能力：${missing.join("、")}。`
    );
  }
}

function requireAuthorizedOperation(
  runtime: FormalCaseRuntime,
  operation: "query_postcondition",
  caseId: string
): void {
  if (!runtime.snapshot.allowedOperations.includes(operation)) {
    throw new FormalBlockedError(`${caseId} 未获不可变执行清单授权 ${operation}。`);
  }
}

function requireRuntimeValue(name: string, purpose: string, pattern?: RegExp): string {
  const value = process.env[name]?.trim();
  if (!value || (pattern && !pattern.test(value))) {
    throw new FormalBlockedError(`${purpose}不可用或格式不符合受控约定。`);
  }
  return value;
}
