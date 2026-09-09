import { existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能测试包。");
}
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
const sharedAuthPaths = [
  join(packDirectory, "runtime", "auth-state.json"),
  join(packDirectory, "..", "console-home", "runtime", "auth-state.json"),
  join(packDirectory, "..", "enterprise-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "account-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "create-product", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-management", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

type ProductRecord = { runId: number; productName: string; productModel: string; assignedProductModel?: string };
type BasicEditRecord = { runId: number; productName: string; productModel: string; fields: string[]; savedAt: string };

async function readCreateProductLedger(): Promise<ProductRecord[]> {
  // packDirectory 已在模块顶层校验非空（函数声明不继承顶层收窄，此处显式断言）。
  const ledgerPath = join(packDirectory!, "..", "create-product", "runtime", "generated-data.json");
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as { records?: ProductRecord[] };
    return (parsed.records ?? []).filter((r) => r.productName && r.assignedProductModel);
  } catch {
    return [];
  }
}

/** 生成 1080x1080 透明底 PNG（合法 PNG 结构：IHDR/IDAT/IEND + CRC32）。 */
function makeTransparentPng(width = 1080, height = 1080): Buffer {
  const raw: number[] = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0); // filter: none
    for (let x = 0; x < width * 4; x += 1) raw.push(0);
  }
  const idat = deflateSync(Buffer.from(raw), { level: 9 });
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.describe("开放平台产品基本配置", () => {
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
        await gotoWithRetry(page, "/integration/product/management");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .locator(".product-center")
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

  const listRows = (page: Page) => page.locator(".ep-table__body:visible").last().locator("tbody tr");

  /** 从列表进入台账最新产品的基本配置页。 */
  async function gotoLatestBasic(page: Page, latest: ProductRecord) {
    await gotoWithRetry(page, "/integration/product/management");
    await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const row = listRows(page).filter({ hasText: latest.productName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByText(/继续开发|开发详情/u).click();
    await page.waitForURL(/\/integration\/product\/.+\/basic/u, { timeout: 30_000 });
    await page.waitForTimeout(2_500);
  }

  const basicForm = (page: Page) => page.locator(".basic-info-form").first();
  const formItem = (page: Page, label: string) => basicForm(page).locator(".ep-form-item").filter({ hasText: label }).first();

  async function collectNotices(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        const t = (n.textContent ?? "").trim();
        if (t && t.length <= 60 && /成功|失败|请|不能|丢失/u.test(t)) out.push(t);
        n = walker.nextNode();
      }
      return Array.from(new Set(out));
    });
  }

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PBSC-001：阶段容器渲染与产品信息条（no_write）。
    test("OP-PBSC-001 阶段容器渲染与产品信息条", async ({ page }) => {
      test.setTimeout(360_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];

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

      // 步骤 1：列表点击继续开发 → basic 页，标题=产品名。
      await gotoLatestBasic(page, latest);
      await expect(page.getByText(latest.productName, { exact: true }).first()).toBeVisible();

      // 步骤 2：状态 tag + MetaInfo 五项（探索实证：Model/开发方式/品类/通讯方式/更新时间）。
      await expect(page.getByText("开发中", { exact: true }).first()).toBeVisible();
      await expect(page.locator(".product-meta-info, [class*=meta-info]").first()).toBeVisible();
      const metaText = await page.locator("main").innerText();
      // 探索实证：label 与 value 为独立节点（冒号是 CSS 伪元素，innerText 不含），逐项存在性断言。
      test.expect(metaText).toContain("Model");
      test.expect(metaText).toContain(latest.assignedProductModel ?? "");
      test.expect(metaText).toContain("开发方式");
      test.expect(metaText).toContain("品类");
      test.expect(metaText).toContain("通讯方式");
      test.expect(metaText).toContain("更新时间");

      // 步骤 3：五步步骤条（探索实证文案：基本配置）+ 页脚保存/取消。
      const stepsText = metaText;
      for (const stepName of ["基本配置", "功能定义", "设备开发", "高级配置", "产品测试"]) {
        test.expect(stepsText).toContain(stepName);
      }
      await expect(page.getByRole("button", { name: "下一步", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "保存", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "取消", exact: true })).toBeVisible();
      // 首阶段无上一步（v-if configStepIndex > 0）。
      await expect(page.getByRole("button", { name: "上一步", exact: true })).toHaveCount(0);

      // 步骤 4：申请上线按钮存在且可点击（探索实证：未就绪产品也开放入口）。
      const pubBtn = page.getByRole("button", { name: "申请上线" }).first();
      await expect(pubBtn).toBeVisible();
      await expect(pubBtn).toBeEnabled();

      // 面包屑（探索实证：产品接入 > 产品开发 > 基本配置）。
      await expect(page.getByRole("navigation", { name: "面包屑" })).toContainText("基本配置");
      await attachShot(page, "基本配置页容器");
    });
  });

  test.describe("基本配置表单与守卫", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PBSC-002：只读字段与可编辑字段在位（no_write）。
    test("OP-PBSC-002 只读字段与可编辑字段在位", async ({ page }) => {
      test.setTimeout(120_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestBasic(page, latest);

      // 步骤 1：只读字段（disabled + 台账值）。
      await expect(formItem(page, "Model").getByRole("textbox")).toBeDisabled();
      await expect(formItem(page, "Model").getByRole("textbox")).toHaveValue(latest.assignedProductModel ?? "");
      await expect(formItem(page, "产品型号").getByRole("textbox")).toBeDisabled();
      await expect(formItem(page, "设备类型").getByRole("combobox")).toBeDisabled();
      await expect(formItem(page, "语音控制").getByRole("combobox")).toBeDisabled();

      // 步骤 2：可编辑字段在位（探索实证：新产品配网方式未选择）。
      const nameInput = formItem(page, "产品名称").getByRole("textbox");
      await expect(nameInput).toBeEnabled();
      await expect(nameInput).toHaveValue(latest.productName);
      const netPlaceholder = page.getByText("请选择配网方式", { exact: true }).first();
      const netEmpty = await netPlaceholder.isVisible().catch(() => false);
      test.info().annotations.push({
        type: "探索注解",
        description: `配网方式当前状态：${netEmpty ? "未选择（placeholder）" : "已选值（历史运行保存过）"}`
      });
      await expect(netPlaceholder.or(basicForm(page).locator(".ep-select__selected-item").filter({ hasNotText: "请选择" }).first())).toBeVisible();
      await expect(page.getByText("查看详情", { exact: true }).first()).toBeVisible();
      for (const label of ["厂商标识1", "厂商标识2", "详情页URL", "产品拟物图", "配网引导图", "配网文案"]) {
        await expect(formItem(page, label)).toBeVisible();
      }

      // 步骤 3：条件字段（配网方式未选择 → 隐藏；实证注解）。
      const wifiVisible = await formItem(page, "WiFi/蓝牙名称").isVisible().catch(() => false);
      const gwVisible = await formItem(page, "可挂载的网关").isVisible().catch(() => false);
      test.info().annotations.push({
        type: "探索注解",
        description: `新产品配网方式为空：WiFi/蓝牙名称 可见=${wifiVisible}，可挂载的网关 可见=${gwVisible}（预期均隐藏，条件字段按配网方式联动）`
      });
      await attachShot(page, "只读与可编辑字段");
    });

    // 覆盖 OP-PBSC-003：配网方式查看详情弹窗（no_write）。
    test("OP-PBSC-003 配网方式查看详情弹窗", async ({ page }) => {
      test.setTimeout(120_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      await gotoLatestBasic(page, records[records.length - 1]);

      // 步骤 1：打开弹窗（探索实证标题）。
      await page.getByText("查看详情", { exact: true }).first().click();
      const dlg = page.locator(".ep-dialog:visible").first();
      await dlg.waitFor({ state: "visible", timeout: 10_000 });
      await expect(dlg).toContainText("联网方式和配网方式对应关系表");

      // 步骤 2：表结构（探索实证 10 行，首行 wifi 分组）。
      await expect(dlg.locator("thead")).toContainText("联网方式");
      await expect(dlg.locator("thead")).toContainText("配置项");
      await expect(dlg.locator("thead")).toContainText("配置选项");
      await expect(dlg.locator("thead")).toContainText("说明");
      const rowCount = await dlg.locator("tbody tr").count();
      expect(rowCount, "对应关系表应有数据行").toBeGreaterThanOrEqual(8);
      await expect(dlg.locator("tbody")).toContainText("wifi");
      await expect(dlg.locator("tbody")).toContainText("4G/蜂窝");
      await attachShot(page, "配网方式对应关系表");

      // 步骤 3：关闭弹窗。
      await dlg.getByRole("button", { name: /关闭|确定|取消/ }).first().click();
      await expect(dlg).toBeHidden({ timeout: 10_000 });
    });

    // 覆盖 OP-PBSC-004：产品名称校验边界（no_write，还原不保存）。
    test("OP-PBSC-004 产品名称校验边界", async ({ page }) => {
      test.setTimeout(120_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestBasic(page, latest);
      const nameInput = formItem(page, "产品名称").getByRole("textbox");

      const nameError = () => formItem(page, "产品名称").locator(".ep-form-item__error");

      // D01：清空 → 必填错误（内联 .ep-form-item__error）。
      await nameInput.fill("");
      await nameInput.blur();
      await expect(nameError().first()).toBeVisible({ timeout: 10_000 });
      const errText1 = await nameError().first().innerText();
      test.info().annotations.push({ type: "探索注解", description: `D01 必填错误文案：${errText1}` });
      test.expect(/请输入|必填/u.test(errText1)).toBeTruthy();
      await attachShot(page, "名称必填错误");

      // D02：2 字 → 前端不强制最小长度（源码实证 productName 校验为空实现），不出现长度错误。
      await nameInput.fill("测试");
      await nameInput.blur();
      await page.waitForTimeout(1_200);
      const d2ErrCount = await nameError().count();
      const d2ErrText = d2ErrCount ? await nameError().first().innerText().catch(() => "") : "";
      test.info().annotations.push({
        type: "探索注解",
        description: `D02 两字输入：内联错误=${d2ErrCount ? `「${d2ErrText}」` : "无"}（源码 productName 长度校验为空实现，前端不拦 2 字）`
      });
      await expect(nameInput).toHaveValue("测试");

      // D03：61 字 → 截断至 60 或超长提示（maxlength=60 截断式，实证注解）。
      const longName = "测".repeat(61);
      await nameInput.fill(longName);
      const actualLen = (await nameInput.inputValue()).length;
      test.info().annotations.push({
        type: "探索注解",
        description: `61 字输入实际保留 ${actualLen} 字（maxlength=60 ${actualLen === 60 ? "截断生效" : "未截断，依赖校验提示"}）`
      });
      test.expect(actualLen).toBeLessThanOrEqual(60);

      // D04：还原原名（不保存）。
      await nameInput.fill(latest.productName);
      await expect(nameInput).toHaveValue(latest.productName);
      await attachShot(page, "名称还原");
    });

    // 覆盖 OP-PBSC-005：超长字段截断（no_write）。
    test("OP-PBSC-005 超长字段截断", async ({ page }) => {
      test.setTimeout(120_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      await gotoLatestBasic(page, records[records.length - 1]);

      // 步骤 1：厂商标识1 70 字符 → maxlength=64 截断。
      const third1 = formItem(page, "厂商标识1").getByRole("textbox");
      await third1.fill("a".repeat(70));
      const len1 = (await third1.inputValue()).length;
      expect(len1, "厂商标识1 应截断至 64").toBeLessThanOrEqual(64);
      test.info().annotations.push({ type: "探索注解", description: `厂商标识1 输入 70 字符实际保留 ${len1}` });

      // 步骤 2：详情页URL 260 字符 → maxlength=255 截断。
      const url = formItem(page, "详情页URL").getByRole("textbox");
      await url.fill("h".repeat(260));
      const len2 = (await url.inputValue()).length;
      expect(len2, "详情页URL 应截断至 255").toBeLessThanOrEqual(255);
      test.info().annotations.push({ type: "探索注解", description: `详情页URL 输入 260 字符实际保留 ${len2}` });

      // 步骤 3：还原清空（不保存）。
      await third1.fill("");
      await url.fill("");
      await expect(third1).toHaveValue("");
      await expect(url).toHaveValue("");
    });

    // 覆盖 OP-PBSC-006：切换产品弹窗与产品切换（no_write）。
    test("OP-PBSC-006 切换产品弹窗与产品切换", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestBasic(page, latest);

      // 步骤 1：打开切换产品弹窗（触发器为标题区 .ep-link.trigger 图标链接）。
      await page.locator(".ep-link.trigger").first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 10_000 });
      await expect(dlg).toContainText("切换产品");
      await expect(dlg.getByPlaceholder("请输入关键字")).toBeVisible();

      // 步骤 2：不存在关键字 → 空态。
      await dlg.getByPlaceholder("请输入关键字").fill("zzz-not-exist");
      await page.waitForTimeout(800);
      await expect(dlg.getByText("没有找到产品")).toBeVisible();
      await attachShot(page, "切换产品空态");

      // 步骤 3：清空后选择另一产品 → URL 切换。
      const keyword = dlg.getByPlaceholder("请输入关键字");
      await keyword.fill("");
      await page.waitForTimeout(800);
      const items = dlg.locator(".product-item");
      const itemCount = await items.count();
      expect(itemCount, "切换弹窗应列出产品").toBeGreaterThanOrEqual(2);
      const target = items.filter({ hasNotText: latest.productName }).first();
      const targetName = (await target.innerText()).split("\n")[0];
      await target.click();
      await page.waitForURL(new RegExp(`/integration/product/\\d+/basic$`.replace(/\/basic\$/, "/basic")), { timeout: 20_000 });
      await page.waitForTimeout(2_000);
      await expect(page.locator("main").getByText(targetName, { exact: true }).first()).toBeVisible();
      test.info().annotations.push({ type: "探索注解", description: `已切换到产品「${targetName}」：${page.url()}` });

      // 步骤 4：切回台账最新产品。
      await page.locator(".ep-link.trigger").first().click();
      const dlg2 = page.locator(".dialog-triger-modal:visible").last();
      await dlg2.waitFor({ state: "visible", timeout: 10_000 });
      await dlg2.locator(".product-item").filter({ hasText: latest.productName }).first().click();
      await page.waitForTimeout(2_000);
      await expect(page.getByText(latest.productName, { exact: true }).first()).toBeVisible();
      await attachShot(page, "切回最新产品");
    });

    // 覆盖 OP-PBSC-007：未保存守卫弹窗（no_write，非法值不会提交）。
    test("OP-PBSC-007 未保存守卫弹窗", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestBasic(page, latest);

      // 步骤 1：名称改 2 字非法值 → 「下一步」触发阶段切换守卫（源码：下一步→switchConfigStage→saveStage→confirm）。
      await formItem(page, "产品名称").getByRole("textbox").fill("测试");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      // 守卫弹窗两种文案：前端校验失败=您有修改还未保存…；前端放行+服务端拒绝=自动保存时发生错误: …（实证）。
      const guardText = page.getByText(/您有修改还未保存|自动保存时发生错误/u).first();
      await expect(guardText).toBeVisible({ timeout: 15_000 });
      const guardBody = await guardText.innerText();
      test.info().annotations.push({ type: "探索注解", description: `守卫弹窗文案（实证）：${guardBody}` });
      await expect(page.getByRole("button", { name: "留在页面" })).toBeVisible();
      await expect(page.getByRole("button", { name: "切换页面" })).toBeVisible();
      await attachShot(page, "未保存守卫弹窗");

      // 步骤 2：留在页面。
      await page.getByRole("button", { name: "留在页面" }).click();
      await page.waitForTimeout(1_000);
      await expect(guardText).toBeHidden();
      await expect(page).toHaveURL(/\/basic/u);

      // 步骤 3：再次触发 → 切换页面（丢弃修改继续；阶段未完成时被「请先完成…」toast 拦截停留，实证注解落点）。
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await expect(guardText).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "切换页面" }).click();
      await page.waitForTimeout(2_000);
      const notices = await collectNotices(page);
      test.info().annotations.push({
        type: "探索注解",
        description: `「切换页面」后落点：${page.url()}；页面提示=[${notices.join("；") || "（未捕获）"}]`
      });
      await attachShot(page, "切换页面落点");
    });

    // 覆盖 OP-PBSC-008：保存必填校验拦截（no_write）。
    test("OP-PBSC-008 保存必填校验拦截", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestBasic(page, latest);

      // 步骤 1：制造缺失态（清空配网文案，纯内存操作不保存；产品其他必填项现状注解）。
      const desInput = formItem(page, "配网文案").locator("textarea");
      const originalDes = await desInput.inputValue();
      await desInput.fill("");
      const figHasImg = (await formItem(page, "产品拟物图").locator("img").count()) > 0;
      const guideHasImg = (await formItem(page, "配网引导图").locator("img").count()) > 0;
      test.info().annotations.push({
        type: "探索注解",
        description: `已清空配网文案制造缺失态（原值 ${originalDes ? "有" : "空"}）；拟物图=${figHasImg ? "有" : "空"}，引导图=${guideHasImg ? "有" : "空"}`
      });

      // 步骤 2：保存 → toast 错误（瞬态，点击后立即捕获）+ 内联必填错误（持久），不弹守卫、无成功提示。
      await page.getByRole("button", { name: "保存", exact: true }).click();
      const notices = await collectNotices(page);
      await expect(basicForm(page).locator(".ep-form-item__error").filter({ hasText: "配网文案" }).first()).toBeVisible({ timeout: 15_000 });
      // 实证：toast 为第一条字段错误消息（alert role，如「请输入配网文案」），文案以行为断言+注解记录。
      test.expect(notices.some((t) => /请输入|请选择|请修改|请完成/u.test(t)), `应出现必填错误 toast，实际=[${notices.join("；")}]`).toBeTruthy();
      test.expect(notices.some((t) => /配置保存成功/u.test(t))).toBeFalsy();
      await attachShot(page, "保存必填拦截");

      // 步骤 3：无守卫弹窗，停留本页，无写入；还原文案输入框（内存态，不保存）。
      await expect(page.getByText(/您有修改还未保存/u).first()).toBeHidden();
      await expect(page).toHaveURL(/\/basic/u);
      if (originalDes) {
        await desInput.fill(originalDes);
      }
    });

    // 覆盖 OP-PBSC-009：补齐必填并保存成功（写入台账）。
    test("OP-PBSC-009 补齐必填并保存成功", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoLatestBasic(page, latest);

      const fields: string[] = [];

      // 步骤 0：选择配网方式（幂等：已选则跳过；placeholder span 拦截指针，点文本打开——已知经验）。
      const netPlaceholder = formItem(page, "配网方式").getByText("请选择配网方式", { exact: true });
      if (await netPlaceholder.isVisible().catch(() => false)) {
        await netPlaceholder.click();
        const options = page.getByRole("option");
        await options.first().waitFor({ state: "visible", timeout: 10_000 });
        const optionTexts = await options.allInnerTexts();
        const wifiOption = optionTexts.find((t) => /wifi/i.test(t)) ?? optionTexts[0];
        await page.getByRole("option").filter({ hasText: wifiOption }).first().click();
        await page.waitForTimeout(800);
        fields.push("配网方式");
        test.info().annotations.push({
          type: "探索注解",
          description: `配网方式选项=[${optionTexts.join(" / ")}]，已选「${wifiOption}」；WiFi/蓝牙名称字段可见=${await formItem(page, "WiFi/蓝牙名称").isVisible().catch(() => false)}`
        });
      } else {
        test.info().annotations.push({ type: "探索注解", description: "配网方式已由历史运行补齐，跳过选择" });
      }

      // 步骤 1：配网文案写入带运行标识的变体值（保证变更，可断言「配置保存成功」；not-change 时成功 toast 不出现）。
      const variant = `自动化测试配网文案（product-basic 写入用例 #${Math.floor(Date.now() / 1000) % 1_000_000}）`;
      await formItem(page, "配网文案").locator("textarea").fill(variant);
      fields.push("配网文案");

      // 步骤 2：补传 拟物图/引导图（缺失时）。
      const png = makeTransparentPng();
      const tmpDir = await mkdtemp(join(tmpdir(), "opbasic-"));
      const pngPath = join(tmpDir, "synthetic-1080.png");
      await writeFile(pngPath, png);
      for (const label of ["产品拟物图", "配网引导图"]) {
        if ((await formItem(page, label).locator("img").count()) === 0) {
          const fileInput = formItem(page, label).locator('input[type="file"]');
          await fileInput.setInputFiles(pngPath);
          await page.waitForTimeout(3_000);
          fields.push(label);
        }
      }

      // 步骤 3：保存 → toast「配置保存成功」（safeSaveConfig 成功分支），无守卫弹窗。
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page.waitForTimeout(1_000);
      await expect(page.getByText("配置保存成功", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      const guardVisible = await page.getByText(/您有修改还未保存/u).first().isVisible().catch(() => false);
      test.expect(guardVisible).toBeFalsy();
      const notices = await collectNotices(page);
      test.info().annotations.push({
        type: "探索注解",
        description: `保存后页面提示=[${notices.join("；") || "（未捕获）"}]；保存成功无守卫弹窗`
      });
      // 成功后仍在本页且表单无必填错误。
      await expect(page).toHaveURL(/\/basic/u);
      const formText = await basicForm(page).innerText();
      test.expect(/请选择配网方式/u.test(formText)).toBeFalsy();
      await attachShot(page, "保存成功");

      // 步骤 4：台账记录。
      const record: BasicEditRecord = {
        runId: Date.now(),
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        fields,
        savedAt: new Date().toISOString(),
      };
      const { recordGeneratedProductBasicEdit } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedProductBasicEdit(record);
      test.info().annotations.push({
        type: "写入台账",
        description: `已为 ${latest.productName}（${record.productModel}）补齐并保存 [${fields.join("、")}]，记入本包台账 runId=${record.runId}`
      });
    });
  });
});
