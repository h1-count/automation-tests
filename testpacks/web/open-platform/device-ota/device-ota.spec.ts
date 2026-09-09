import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能包。");
}
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
const sharedAuthPaths = [
  join(packDirectory, "runtime", "auth-state.json"),
  join(packDirectory, "..", "console-home", "runtime", "auth-state.json"),
  join(packDirectory, "..", "enterprise-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "account-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "create-product", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-management", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-basic", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-function", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-develop", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-advanced", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-testing", "runtime", "auth-state.json"),
  join(packDirectory, "..", "procurement", "runtime", "auth-state.json"),
  join(packDirectory, "..", "authcode", "runtime", "auth-state.json"),
  join(packDirectory, "..", "cloud-bridge", "runtime", "auth-state.json"),
  join(packDirectory, "..", "debugging", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台固件升级", () => {
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

  async function restoreSession(page: Page): Promise<boolean> {
    for (const candidate of sharedAuthPaths) {
      if (!existsSync(candidate)) continue;
      try {
        const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
        if (!state.cookies?.length) continue;
        await page.context().addCookies(state.cookies);
        await gotoWithRetry(page, "/device/ota");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByRole("button", { name: "新增固件升级", exact: true })
            .first()
            .waitFor({ state: "visible", timeout: 45_000 })
            .then(() => true)
            .catch(() => false);
          if (ready) return true;
        }
      } catch {
        // 尝试下一个候选
      }
    }
    return false;
  }

  async function waitForSmsCountdownOrReject(page: Page) {
    const outcome = await page.waitForFunction(
      () => {
        if (/秒后重新获取|s后重新获取/u.test(document.body.innerText)) return "sent";
        const alert = document.querySelector('[role="alert"]');
        return alert && /频繁|超限/.test(alert.textContent ?? "") ? "rejected" : false;
      },
      null,
      { timeout: 240_000, polling: 1000 }
    );
    if ((await (await outcome).jsonValue()) === "rejected") {
      throw new Error("验证码发送被后端拒绝（疑似短信频控），请等待频控窗口后重跑该用例");
    }
    console.log("[自动捕获] 短信发送成功（倒计时已出现）");
  }

  async function smsLogin(page: Page) {
    const testPhone = process.env.TEST_PHONE;
    const testVerificationCode = process.env.TEST_VERIFICATION_CODE;
    if (!testPhone || !testVerificationCode) throw new Error("缺少 TEST_PHONE / TEST_VERIFICATION_CODE 环境变量");
    await page.goto("/login");
    const loginPanel = page.locator('[role="tabpanel"][aria-labelledby="tab-login"]');
    await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute("aria-selected", "true");
    await loginPanel.getByRole("textbox", { name: "短信登录手机号" }).fill(testPhone);
    const sendCodeButton = loginPanel.getByRole("button", { name: "获取登录短信验证码" });
    await expect(sendCodeButton).toBeEnabled();
    console.log("[人工步骤] 请在浏览器窗口完成点选文字图形验证码（最长等待 4 分钟），期间请勿关闭窗口");
    await sendCodeButton.click();
    await waitForSmsCountdownOrReject(page);
    await loginPanel.getByRole("textbox", { name: "登录短信验证码" }).fill(testVerificationCode);
    await loginPanel.getByText("我已阅读并已同意", { exact: true }).click();
    const smsSubmit = loginPanel.getByRole("button", { name: "短信验证码登录", exact: true });
    await expect(smsSubmit).toBeEnabled();
    await smsSubmit.click();
    await expect(page).toHaveURL(/\/console\/home/u, { timeout: 30_000 });
  }

  async function gotoOta(page: Page) {
    await gotoWithRetry(page, "/device/ota");
    await page.getByRole("button", { name: "新增固件升级", exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-DOTA-001：固件升级页渲染（no_write）。
    test("OP-DOTA-001 固件升级页渲染", async ({ page }) => {
      test.setTimeout(360_000);
      if (await restoreSession(page)) {
        test.info().annotations.push({
          type: "登录态复用",
          description: "检测到本地有效会话，跳过短信登录（不发送短信、无需人工点选验证码）"
        });
        await page.context().storageState({ path: authStatePath });
      } else {
        await smsLogin(page);
        await page.context().storageState({ path: authStatePath });
        console.log("[登录态] 短信登录成功，会话已保存到本包 runtime/auth-state.json");
      }

      // 步骤 1：标题与描述。
      await gotoOta(page);
      await expect(page.getByText("固件升级", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/远程在线升级/u).first()).toBeVisible();

      // 步骤 2：产品卡片。
      const card = page.locator(".toolbar .left");
      await expect(card).toBeVisible();
      const cardText = (await card.innerText()).replace(/\n+/g, " ");
      test.expect(cardText).toContain("Model");
      test.expect(cardText).toContain("设备类型");
      test.expect(cardText).toContain("通讯方式");
      test.info().annotations.push({ type: "探索注解", description: `产品卡片（实证）：${cardText.slice(0, 100)}` });

      // 步骤 3：表头与既有行注解。
      const header = page.locator(".ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["产品名称", "模型编码", "地址", "版本号", "升级设备占比", "状态", "更新时间", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rows = page.locator(".ep-table__body:visible").last().locator("tbody tr");
      const rowCount = await rows.count();
      if (rowCount > 0) {
        const firstRow = (await rows.first().innerText()).replace(/\n+/g, " | ").slice(0, 120);
        test.info().annotations.push({ type: "探索注解", description: `既有 ${rowCount} 行（首行实证）：${firstRow}——非本工程台账创建，保持只读，不做任何变更` });
      } else {
        test.info().annotations.push({ type: "探索注解", description: "列表 0 行（既有行已被清理，注解如实记录）" });
      }
      await attachShot(page, "固件升级页");
    });
  });

  test.describe("产品切换与表单校验", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-DOTA-002：切换产品弹窗与列表联动（no_write）。
    test("OP-DOTA-002 切换产品弹窗与列表联动", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoOta(page);

      // 步骤 1：打开切换产品弹窗。
      await page.locator(".toolbar .left .icon, .toolbar .left img.icon").first().click();
      const dlg = page.locator(".ep-dialog:visible").first();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg.getByText("切换产品").first()).toBeVisible();
      const items = dlg.locator(".product-item");
      const itemCount = await items.count();
      test.info().annotations.push({ type: "探索注解", description: `产品列表（实证）=${itemCount} 项（应仅非云云接入产品）` });

      // 步骤 2：关键字过滤。
      await dlg.getByPlaceholder("请输入关键字").fill("1788420748438");
      await page.waitForTimeout(800);
      const filtered = await items.count();
      test.expect(filtered, "关键字过滤后应仅剩匹配产品").toBeLessThanOrEqual(1);

      // 步骤 3：清空过滤并选择另一产品。
      await dlg.getByPlaceholder("请输入关键字").fill("");
      await page.waitForTimeout(500);
      const target = items.filter({ hasText: "1788321497426" }).first();
      await target.click();
      await page.waitForTimeout(2_000);
      const card = (await page.locator(".toolbar .left").innerText()).replace(/\n+/g, " ");
      test.expect(card, "产品卡片应切换为 7426 产品").toContain("1788321497426");
      const rowsAfter = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `切换后卡片=1788321497426，OTA 列表行数=${rowsAfter}` });

      // 步骤 4：切回原产品。
      await page.locator(".toolbar .left .icon, .toolbar .left img.icon").first().click();
      await page.locator(".ep-dialog:visible").first().waitFor({ state: "visible", timeout: 15_000 });
      await page.locator(".ep-dialog:visible .product-item").filter({ hasText: "1788420748438" }).first().click();
      await page.waitForTimeout(2_000);
      test.expect((await page.locator(".toolbar .left").innerText()), "应切回 8438 产品").toContain("1788420748438");
      await attachShot(page, "切换产品");
    });

    // 覆盖 OP-DOTA-003：新增固件升级表单校验（no_write，客户端拦截例外点击确定）。
    test("OP-DOTA-003 新增固件升级表单校验", async ({ page }) => {
      test.setTimeout(240_000);
      await gotoOta(page);

      // 步骤 1：打开弹窗，核对回显。
      await page.getByRole("button", { name: "新增固件升级", exact: true }).click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg.getByText("新增固件升级").first()).toBeVisible();
      const productName = await dlg.getByRole("textbox").first().inputValue();
      test.expect(productName, "产品名称应回显当前产品").toContain("自动化测试产品");
      const sizeText = (await dlg.innerText()).replace(/\n+/g, " ");
      test.expect(sizeText, "包大小应显示 '-'（未上传文件）").toContain("- MB");
      test.info().annotations.push({ type: "探索注解", description: `弹窗回显（实证）：产品=${productName.slice(0, 30)}，包大小区含「- MB」` });

      // D01 空表单确定 → 双拦截。
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      const urlErr = dlg.locator(".ep-form-item").filter({ hasText: "升级包" }).locator(".ep-form-item__error").first();
      await expect.poll(async () => urlErr.isVisible().catch(() => false), { timeout: 5_000 }).toBe(true);
      test.expect(await urlErr.innerText()).toContain("安装包");
      const verErr = dlg.locator(".ep-form-item").filter({ hasText: "固件版本号" }).locator(".ep-form-item__error").first();
      await expect(verErr).toBeVisible();
      test.expect(await verErr.innerText()).toContain("固件版本号");
      await expect(dlg).toBeVisible();
      test.info().annotations.push({ type: "探索注解", description: `D01 空表单双拦截（实证）：${await urlErr.innerText()} / ${await verErr.innerText()}` });

      // D02 版本号非法格式。
      const verInput = dlg.getByPlaceholder("请输入版本号");
      await verInput.fill("abc");
      await dlg.getByText("固件版本号").first().click();
      await page.waitForTimeout(1_500);
      const d02 = await verErr.innerText().catch(() => "");
      test.info().annotations.push({ type: "探索注解", description: `D02 版本号「abc」提示（实证）：${d02 || "（无字段错误——若为空则注解记录实际行为）"}` });

      // D03 恢复合法值 → 版本号错误清空（不上传文件、不提交）。
      await verInput.fill("9.9.9");
      await dlg.getByText("固件版本号").first().click();
      await page.waitForTimeout(1_500);
      const verErrGone = await verErr.isVisible().catch(() => false);
      test.expect(verErrGone, "版本号合法后错误应清空").toBe(false);
      test.info().annotations.push({ type: "探索注解", description: "D03 版本号恢复 9.9.9 后错误清空；升级包仍缺——不提交" });

      // 步骤 5：取消关闭。
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForTimeout(1_000);
      await expect(dlg).toBeHidden();
      const rows = await page.locator(".ep-table__body:visible").last().locator("tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `取消后列表行数=${rows}（无新增；全程无上传、无提交请求）` });
      await attachShot(page, "固件表单校验");
    });

    // 覆盖 OP-DOTA-004：状态列语义与操作控件核对（不点击，no_write）。
    test("OP-DOTA-004 状态列与操作控件核对", async ({ page }) => {
      test.setTimeout(180_000);
      await gotoOta(page);
      const rows = page.locator(".ep-table__body:visible").last().locator("tbody tr");
      const rowCount = await rows.count();
      if (rowCount === 0) {
        test.info().annotations.push({ type: "探索注解", description: "列表 0 行（既有行已被清理），状态/操作核对以注解记录并跳过" });
        return;
      }

      // 步骤 1：状态 tag 语义。
      const firstRow = rows.first();
      const statusTag = firstRow.locator(".ep-tag").first();
      await expect(statusTag).toBeVisible();
      const statusText = (await statusTag.innerText()).trim();
      const statusClass = await statusTag.getAttribute("class");
      if (statusText === "待生效") {
        test.expect(statusClass).toContain("danger");
      } else if (statusText === "生效" || statusText === "下架") {
        test.expect(statusClass).toContain("success");
      }
      test.info().annotations.push({ type: "探索注解", description: `状态 tag（实证）：${statusText}（class 含 ${statusClass?.includes("danger") ? "danger" : "success"}）` });

      // 步骤 2：操作列控件存在性（不点击）。
      const op = (await firstRow.innerText()).includes("取消下发") ? "取消下发" : "下发";
      await expect(firstRow.getByText(op, { exact: true })).toBeVisible();
      test.info().annotations.push({ type: "探索注解", description: `操作列控件「${op}」存在——下发/取消下发为高风险设备动作（刷固件类），范围外不点击` });
      await attachShot(page, "状态与操作");
    });
  });
});
