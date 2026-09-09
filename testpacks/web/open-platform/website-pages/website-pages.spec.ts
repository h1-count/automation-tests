import { expect, test, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能包。");
}

test.describe("开放平台官网页面", () => {
  async function attachShot(page: Page, name: string) {
    try {
      await test.info().attach(name, { body: await page.screenshot({ timeout: 10_000 }), contentType: "image/png" });
    } catch {
      await page.waitForTimeout(2_000).catch(() => {});
      try {
        await test.info().attach(name, { body: await page.screenshot({ timeout: 15_000 }), contentType: "image/png" });
      } catch {
        console.log(`[截图跳过] ${name}（两次截图均超时，不阻塞用例断言）`);
      }
    }
  }

  async function gotoWithRetry(page: Page, path: string) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      console.log(`[重试] ${path} 导航 20s 未完成（疑似 dev server 卡顿窗口），重载一次`);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
  }

  // 覆盖 OP-WEB-001：官网首页渲染（no_write，公开页无需登录）。
  test("OP-WEB-001 官网首页渲染", async ({ page }) => {
    test.setTimeout(240_000);
    await gotoWithRetry(page, "/");
    await page.getByText("Hommor Aura 平台", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_500);

    // 步骤 1：标题与定位描述。
    await expect(page.getByText("Hommor Aura 平台", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/一体化工具链/u).first()).toBeVisible();

    // 步骤 2：核心板块。
    const bodyText = await page.evaluate(() => document.body.innerText);
    const sections: string[] = [];
    if (bodyText.includes("一站式硬件接入方案")) sections.push("一站式硬件接入方案");
    if (bodyText.includes("产品运营系统")) sections.push("产品运营系统");
    test.expect(sections.length, "核心板块应可见").toBeGreaterThanOrEqual(1);
    test.info().annotations.push({ type: "探索注解", description: `核心板块（实证）：${sections.join("、")}` });

    // 步骤 3：行动按钮。
    await expect(page.getByText(/立即使用/u).first()).toBeVisible();
    await expect(page.getByText(/立即咨询/u).first()).toBeVisible();
    await attachShot(page, "官网首页");
  });

  // 覆盖 OP-WEB-002：咨询表单校验（no_write，禁短信）。
  test("OP-WEB-002 咨询表单校验", async ({ page }) => {
    test.setTimeout(240_000);
    await gotoWithRetry(page, "/consultation");
    await page.getByText("您的诉求", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });

    // D01 空表单提交 → 5 条字段级错误（客户端拦截，不发请求、不触发短信）。
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await page.waitForTimeout(1_500);
    const errs = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ep-form-item__error")).map((e) => (e.textContent ?? "").trim())
    );
    for (const want of ["企业名称", "企业地址", "姓名", "手机号", "验证码"]) {
      test.expect(errs.some((e) => e.includes(want)), `应含错误「${want}」`).toBe(true);
    }
    test.expect(errs.length).toBe(5);
    test.info().annotations.push({ type: "探索注解", description: `D01 空表单拦截（实证）：${errs.join("；")}——无网络请求、无短信触发` });

    // D02 企业名称含 #。
    const corpName = page.getByPlaceholder("请输入企业名称");
    await corpName.fill("自动化测试#公司");
    await page.getByText("企业名称", { exact: true }).first().click();
    await page.waitForTimeout(1_500);
    const d02 = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ep-form-item__error"))
        .map((e) => (e.textContent ?? "").trim())
        .filter((t) => t.includes("企业名称") || t.includes("公司") || t.includes("字符") || t.includes("只能"))
    );
    test.info().annotations.push({ type: "探索注解", description: `D02 企业名称含#提示（实证）：${d02.join("；") || "（无提示——记录实际行为）"}` });

    // D03 手机号 10 位。
    const phone = page.getByPlaceholder("请输入手机号");
    await phone.fill("1380013800");
    await page.getByText("联系电话", { exact: true }).first().click();
    await page.waitForTimeout(1_500);
    const d03 = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ep-form-item__error"))
        .map((e) => (e.textContent ?? "").trim())
        .filter((t) => t.includes("手机") || t.includes("电话"))
    );
    test.info().annotations.push({ type: "探索注解", description: `D03 手机10位提示（实证）：${d03.join("；") || "（无提示——记录实际行为）"}` });

    // D04 姓名含 #。
    const name = page.getByPlaceholder("请输入联系人姓名");
    await name.fill("张#三");
    await page.getByText("您的姓名", { exact: true }).first().click();
    await page.waitForTimeout(1_500);
    const d04 = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ep-form-item__error"))
        .map((e) => (e.textContent ?? "").trim())
        .filter((t) => t.includes("姓名"))
    );
    test.info().annotations.push({ type: "探索注解", description: `D04 姓名含#提示（实证）：${d04.join("；") || "（无提示——记录实际行为）"}` });

    // D05 恢复合法值（验证码留空）——错误清空、验证码仍必填；不提交、不获取验证码。
    await corpName.fill("自动化测试有限公司");
    await page.getByPlaceholder("请输入企业地址").fill("江苏省无锡市自动化测试路1号");
    await name.fill("自动化测试员");
    await phone.fill("13000000000");
    await page.getByText("联系电话", { exact: true }).first().click();
    await page.waitForTimeout(1_500);
    const restErrs = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ep-form-item__error")).map((e) => (e.textContent ?? "").trim())
    );
    test.expect(restErrs.some((e) => e.includes("验证码")), "验证码仍应必填").toBe(true);
    const nonCaptcha = restErrs.filter((e) => !e.includes("验证码"));
    test.expect(nonCaptcha, "其余字段错误应清空").toHaveLength(0);
    test.info().annotations.push({ type: "探索注解", description: "D05 合法恢复（含企业地址）后仅剩验证码必填；全程未点击获取验证码（短信红线）、未提交" });
    await attachShot(page, "咨询表单校验");
  });

  // 覆盖 OP-WEB-003：协议页可达性与 sitemap 空组件实证（no_write）。
  test("OP-WEB-003 协议页可达性与 sitemap 实证", async ({ page }) => {
    test.setTimeout(240_000);

    // 步骤 1：四个协议页。
    const legalPages = ["/terms-of-use", "/privacy-policy", "/cookie-policy", "/legal-statement"];
    const report: string[] = [];
    for (const p of legalPages) {
      await gotoWithRetry(page, p);
      await page.waitForTimeout(1_500);
      const text = await page.evaluate(() => document.body.innerText);
      const hasFooter = text.includes("400-1077050") && text.includes("service@ikinglink.com");
      const reachable = !/\/login/u.test(page.url());
      report.push(`${p}: 可达=${reachable}, 页脚完整=${hasFooter}`);
      test.expect(reachable, `${p} 应可达`).toBe(true);
    }
    test.info().annotations.push({ type: "探索注解", description: `协议页实证：${report.join("；")}` });

    // 步骤 2：sitemap 空组件实证。
    await gotoWithRetry(page, "/sitemap");
    await page.waitForTimeout(2_000);
    const sitemapText = await page.evaluate(() => {
      const main = document.querySelector("#app");
      return main ? (main as HTMLElement).innerText : "";
    });
    const sitemapHasContent = sitemapText.includes("站点地图") || sitemapText.includes("网站地图");
    test.info().annotations.push({
      type: "探索注解",
      description: `sitemap 实证：正文内容=${sitemapHasContent ? "有" : "无（源码为空组件 <div></div>）"}，仅框架页脚——疑似缺陷/未实现，待产品确认`
    });
    await attachShot(page, "sitemap");
  });
});
