import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
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
  join(packDirectory, "..", "product-basic", "runtime", "auth-state.json"),
  join(packDirectory, "..", "product-function", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

type ProductRecord = { runId: number; productName: string; productModel: string; assignedProductModel?: string };
type FirmwareRecord = {
  runId: number; productName: string; productModel: string;
  firmwareName: string; firmwareVersion: string; firmwareTestOtaVersion: string; savedAt: string;
};

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

/** 生成合成固件 bin（确定性伪随机字节，约 64KB）。 */
function makeSyntheticFirmware(seed = 42, size = 64 * 1024): Buffer {
  const buf = Buffer.alloc(size);
  let s = seed;
  for (let i = 0; i < size; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = s & 0xff;
  }
  return buf;
}

test.describe("开放平台设备开发", () => {
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

  /** 从列表进入台账最新产品的 /develop 页（继续开发先落 basic）。 */
  async function gotoDevelop(page: Page, latest: ProductRecord) {
    await gotoWithRetry(page, `/integration/product/management`);
    await page.locator(".product-center").waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    // 2026-09-14 平台产品数增长突破单页 10 条（共 19 条）：台账最新产品可能落在第 2 页。
    // 第 1 页未命中时用列表搜索（只读动作）定位，不改变用例断言语义。
    let row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    if (!(await row.isVisible().catch(() => false))) {
      await page.getByPlaceholder(/Model\/名称\/型号/u).fill(latest.productName);
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page.waitForTimeout(3_000);
      row = page.locator(".ep-table__body:visible").last().locator("tbody tr").filter({ hasText: latest.productName }).first();
    }
    await expect(row, `台账最新产品 ${latest.productName} 应经列表（必要时搜索）可见`).toBeVisible({ timeout: 20_000 });
    await row.getByText(/继续开发|开发详情/u).click();
    await page.waitForURL(/\/integration\/product\/\d+\/basic/u, { timeout: 30_000 });
    if (!page.url().endsWith("/develop")) {
      await gotoWithRetry(page, page.url().replace(/\/basic$/, "/develop"));
    }
    await page.locator(".develop-method-protocol, .development-method").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000);
  }

  test.describe("入口与权限（无登录态）", () => {
    // 覆盖 OP-PDEV-008：未登录直达设备开发页重定向登录（no_write）。
    // 写法参照 create-product 包 OP-PROD-001：本 describe 不声明 storageState，
    // 独立浏览器上下文不加载任何登录态（permission.ts 未登录守卫 next({ name: 'login' })）。
    test("OP-PDEV-008 未登录直达设备开发页重定向登录", async ({ page }) => {
      test.setTimeout(120_000);
      // 步骤 1：未登录直达台账产品 /develop URL（产品 ID 段为 cases.md 约定的合成占位值：
      // 未登录守卫先于产品数据加载，任意 /integration/product/* 路由均先重定向登录）。
      await gotoWithRetry(page, "/integration/product/1/develop");
      await expect(page).toHaveURL(/\/login/u, { timeout: 15_000 });
      await expect(page.getByRole("form", { name: "短信验证码登录表单" })).toBeVisible({ timeout: 15_000 });

      // 步骤 2（对照）：未登录直达产品管理页，同样重定向登录页。
      await gotoWithRetry(page, "/integration/product/management");
      await expect(page).toHaveURL(/\/login/u, { timeout: 15_000 });
      await attachShot(page, "未登录重定向登录页");
    });
  });

  test.describe("登录态就绪", () => {
    // 覆盖 OP-PDEV-001：页面三步骤渲染与资料下载链接（no_write）。
    test("OP-PDEV-001 页面三步骤渲染与资料下载链接", async ({ page }) => {
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

      // 步骤 1：进入设备开发页。
      await gotoDevelop(page, latest);
      await expect(page.url()).toContain("/develop");

      // 步骤 2：三步骤标题。
      const main = page.locator("main");
      await expect(main).toContainText("开发资源及资料");
      await expect(main).toContainText("获取平台产品授权凭证，注册设备到云平台");
      await expect(main).toContainText("固件配置");

      // 步骤 3：下载文档链接（探索实证：两个盒子的 target=_blank）。
      const docLinks = page.getByRole("link", { name: "下载文档" });
      await expect(docLinks.first()).toBeVisible();
      const linkCount = await docLinks.count();
      expect(linkCount, "应有 2 个下载文档链接").toBe(2);
      for (let i = 0; i < linkCount; i += 1) {
        await expect(docLinks.nth(i)).toHaveAttribute("target", "_blank");
        const href = await docLinks.nth(i).getAttribute("href");
        test.expect(href ?? "").toContain("/resource/docs/");
      }

      // 步骤 4：注册三小步 + 注册接口地址有值。
      await expect(main).toContainText("获取设备授权码");
      await expect(main).toContainText("获取产品授权凭证");
      await expect(main).toContainText("使用注册设备接口，激活设备验证");

      // 步骤 5：已登录绕过入口、地址栏直达该产品 /develop URL（2026-09-11 对象矩阵核对新增；
      // 源码核实：develop 子路由挂载 ProductIntegration 并按路由参数加载产品上下文，可直达）。
      const developUrl = page.url();
      await gotoWithRetry(page, developUrl);
      await expect(page).toHaveURL(/\/develop/u, { timeout: 15_000 });
      await page.locator(".develop-method-protocol, .development-method").first().waitFor({ state: "visible", timeout: 30_000 });
      await expect(main).toContainText("开发资源及资料");
      await expect(main).toContainText("获取平台产品授权凭证，注册设备到云平台");
      await expect(main).toContainText("固件配置");
      await expect(main).toContainText("含 SDK 固件版本列表");
      test.info().annotations.push({
        type: "探索注解",
        description: `步骤5：已登录地址栏直达 ${new URL(developUrl).pathname} 渲染与入口进入一致，无重定向（URL 宽松匹配 /develop 段）`
      });

      await attachShot(page, "设备开发页");
    });
  });

  test.describe("凭证与固件配置", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-PDEV-002：产品授权凭证与注册接口信息（no_write）。
    test("OP-PDEV-002 产品授权凭证与注册接口信息", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoDevelop(page, latest);

      // 步骤 1：授权凭证四项有值。
      const main = page.locator("main");
      // 探索实证：meta-field label 文本带全角冒号（如「Product Key：」），用包含匹配。
      for (const label of ["Model", "Product Key", "Product Secret", "Vendor Code"]) {
        await expect(main.getByText(label, { exact: false }).first()).toBeVisible();
      }
      await expect(main).toContainText(latest.assignedProductModel ?? "");
      test.info().annotations.push({
        type: "探索注解",
        description: `授权凭证四项均渲染（text-copy 形态）；Model 与台账一致=${(await main.innerText()).includes(latest.assignedProductModel ?? "")}`
      });

      // 步骤 2：注册接口地址有值（alert 提示在位）。
      await expect(main).toContainText("注册接口地址");
      await expect(main).toContainText("产品授权凭证烧录完成后");
      await attachShot(page, "授权凭证区");
    });

    // 覆盖 OP-PDEV-003：授权码数量显示（no_write）。
    test("OP-PDEV-003 授权码数量显示", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoDevelop(page, latest);

      // 步骤 1：剩余授权码数量 + 获取授权码按钮（不点击提交——authcode 包覆盖）。
      const main = page.locator("main");
      const quotaText = main.getByText(/剩余授权码数量/u).first();
      await expect(quotaText).toBeVisible();
      const quota = await quotaText.innerText();
      test.expect(/\d/u.test(quota)).toBeTruthy();
      test.info().annotations.push({ type: "探索注解", description: `授权码余量显示（实证）：${quota}` });
      const applyBtn = page.getByRole("button", { name: "获取授权码" }).first();
      await expect(applyBtn).toBeVisible();
      await expect(applyBtn).toBeEnabled();
      await attachShot(page, "授权码数量");
    });

    // 覆盖 OP-PDEV-004：固件列表结构与新建入口（no_write）。
    test("OP-PDEV-004 固件列表结构与新建入口", async ({ page }) => {
      test.setTimeout(150_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoDevelop(page, latest);

      // 步骤 1：note + 新建版本按钮（实证规则：canAllFirmware = 固件数为0 或 产品已上线；
      // 固件数>0 且未上线时按钮隐藏，注解说明）。
      const main = page.locator("main");
      await expect(main).toContainText("含 SDK 固件版本列表");
      const createBtn = page.getByRole("button", { name: "新建版本", exact: true }).first();
      const btnVisible = await createBtn.isVisible().catch(() => false);
      const fwRows = await page.locator(".develop-firmware-table .ep-table__body:visible tbody tr").count();
      if (fwRows > 0 && !btnVisible) {
        test.info().annotations.push({ type: "探索注解", description: "新建版本按钮隐藏（实证：固件数>0 且产品未上线，canAllFirmware 规则）" });
      } else {
        await expect(createBtn).toBeVisible();
      }
      test.info().annotations.push({ type: "探索注解", description: `direct 开发方式固件类型唯一为 Sdk（源码 firmwareTypeMap）；固件行数=${fwRows}，按钮可见=${btnVisible}` });

      // 步骤 2：固件表头。
      const header = page.locator(".develop-firmware-table .ep-table__header:visible").last();
      await header.waitFor({ state: "visible", timeout: 20_000 });
      for (const col of ["固件名称/固件key", "固件版本", "固件状态", "测试 OTA 固件版本", "版本说明", "上传时间", "操作"]) {
        await expect(header).toContainText(col);
      }
      const rowTotal = await page.locator(".develop-firmware-table .ep-table__body:visible tbody tr").count();
      test.info().annotations.push({ type: "探索注解", description: `固件列表当前行数=${rowTotal}` });
      await attachShot(page, "固件配置区");
    });

    // 覆盖 OP-PDEV-005：新建固件版本（写入）。
    test("OP-PDEV-005 新建固件版本（写入）", async ({ page }) => {
      test.setTimeout(240_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoDevelop(page, latest);

      const fwTable = page.locator(".develop-firmware-table").first();
      const existingRows = fwTable.locator(".ep-table__body:visible tbody tr");
      const existingCount = await existingRows.count();

      // 幂等：固件已存在（canAllFirmware 规则：固件数>0 且产品未上线时隐藏新建按钮）。
      if (existingCount > 0) {
        const tableText = (await fwTable.innerText()).replace(/\s+/g, " ");
        test.info().annotations.push({
          type: "探索注解",
          description: `固件已存在（行数=${existingCount}，新建按钮按规则隐藏：固件数>0 且产品未上线），跳过新建，断言台账固件在列表`
        });
        let rec: FirmwareRecord | undefined;
        try {
          const ledgerPath = join(packDirectory!, "runtime", "generated-data.json");
          const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as { records?: FirmwareRecord[] };
          rec = (parsed.records ?? []).filter((r) => r.firmwareName).pop();
        } catch {
          // 台账尚未建立（首次写入前的幂等核验轮），仅注解列表现状
        }
        if (rec) {
          await expect(fwTable).toContainText(rec.firmwareName.slice(0, 6));
          await expect(fwTable).toContainText(rec.firmwareVersion);
          test.info().annotations.push({
            type: "写入台账",
            description: `历史固件「${rec.firmwareName}」${rec.firmwareVersion} 在列表核验一致（台账 runId=${rec.runId}），本列为幂等核验轮`
          });
        }
        await attachShot(page, "固件已存在核验");
        return;
      }

      // 服务端实证规则：固件名称只能包含中文（前端文案「只能包含中英文、数字和常用标点符号」与
      // 服务端实际校验不一致）；唯一性用时间戳数字的中文小写表达。
      const CJK_DIGITS = "〇一二三四五六七八九";
      const toCjk = (n: number): string => String(n).split("").map((d) => CJK_DIGITS[Number(d)]).join("");
      const fwName = `自动化测试固件${toCjk(Math.floor(Date.now() / 1000) % 1_000_000_000)}`;
      const tmpDir = await mkdtemp(join(tmpdir(), "opfw-"));
      const binPath = join(tmpDir, "synthetic-firmware.bin");
      await writeFile(binPath, makeSyntheticFirmware());

      // 步骤 1：新建版本填表。
      await page.getByRole("button", { name: "新建版本", exact: true }).first().click();
      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg).toContainText("新增固件版本");
      await dlg.getByRole("textbox", { name: "固件名称" }).fill(fwName);
      // 固件类型：2026-09-14 复测实证——组件在打开时自动填充 firmwareType（BtnEditFirmwareVersion.vue
      // L155: !theForm.firmwareType → firmwareTypeOpts[0]），下拉呈 disabled +「含SDK固件」选中渲染
      //（Element Plus 单选选中值也挂 ep-select__placeholder 类）。不可交互也无需选择，只做实证注解。
      const typeWrapper = dlg.locator(".ep-form-item").filter({ hasText: "固件类型" }).locator(".ep-select__wrapper").first();
      const typeDisabled = await typeWrapper.getAttribute("class").then((c) => (c ?? "").includes("is-disabled")).catch(() => true);
      const typeText = (await typeWrapper.innerText().catch(() => "")) || "";
      test.info().annotations.push({
        type: "探索注解",
        description: `固件类型下拉 disabled=${typeDisabled}，渲染值「${typeText.trim() || "（空）"}」（组件自动填充，无需选择）`
      });
      await dlg.getByRole("textbox", { name: "* 固件版本", exact: true }).fill("1.0.0");
      // 上传生产固件（file-uploader 隐藏 input[type=file]，第一个为生产固件）
      const fileInputs = dlg.locator('input[type="file"]');
      await fileInputs.first().setInputFiles(binPath);
      await page.waitForTimeout(2_500);
      // OTA 版本（必须大于生产版本）
      await dlg.getByRole("textbox", { name: "* 测试 OTA 固件版本", exact: true }).fill("1.0.1");
      await fileInputs.nth(1).setInputFiles(binPath);
      await page.waitForTimeout(2_500);
      await dlg.locator("textarea").fill("自动化测试固件版本（product-develop 写入用例）");
      await attachShot(page, "新建固件版本表单");

      // 步骤 2：确定 → toast + 列表出现固件行。
      // 2026-09-14 复测实证（R6）：表单字段全部填写完整仍偶发「请检查表单错误」前端校验 reject
      //（无 is-error 内联提示、无网络请求，弹窗保持打开）——间歇性竞态，失败时重试一次确定。
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      const successToast = page.getByText("新增固件成功", { exact: true }).first();
      const rejected = await page
        .getByText("请检查表单错误", { exact: true })
        .first()
        .isVisible({ timeout: 4_000 })
        .catch(() => false);
      if (rejected) {
        await page.waitForTimeout(1_500);
        test.info().annotations.push({ type: "探索注解", description: "首次确定偶发「请检查表单错误」校验竞态，已重试一次确定" });
        await dlg.getByRole("button", { name: "确定", exact: true }).click();
      }
      await expect(successToast).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2_500);
      // 2026-09-14 复测实证：固件表格对长名称做「头4+尾3+省略号」的中间截断渲染
      //（如「自动化测...八五六」）——断言改为截断容忍正则（头4+尾3，未截断的全名同样命中）。
      await expect(fwTable).toContainText(new RegExp(`${fwName.slice(0, 4)}[\\s\\S]*${fwName.slice(-3)}`, "u"));
      test.info().annotations.push({
        type: "探索注解",
        description: `固件行按「头4+尾3+省略号」截断口径断言（全名=${fwName}，R5 实证表格中间截断渲染）`
      });
      await expect(fwTable).toContainText("1.0.0");
      await attachShot(page, "固件列表新增成功");

      // 步骤 3：台账记录。
      const record: FirmwareRecord = {
        runId: Date.now(),
        productName: latest.productName,
        productModel: latest.assignedProductModel ?? latest.productModel,
        firmwareName: fwName,
        firmwareVersion: "1.0.0",
        firmwareTestOtaVersion: "1.0.1",
        savedAt: new Date().toISOString(),
      };
      const { recordGeneratedFirmwareVersion } = await import("../../../../src/support/recordGeneratedData");
      await recordGeneratedFirmwareVersion(record);
      test.info().annotations.push({
        type: "写入台账",
        description: `已新增固件版本 ${fwName} 1.0.0（OTA 1.0.1），记入本包台账 runId=${record.runId}`
      });
    });

    // 覆盖 OP-PDEV-007：固件表单字段校验（必填/边界/格式）（no_write；固件按钮隐藏时转跳）。
    test("OP-PDEV-007 固件表单字段校验（必填/边界/格式）", async ({ page }) => {
      test.setTimeout(300_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoDevelop(page, latest);

      // 前置：新建版本按钮可用（固件数=0 或已上线）；当前台账产品固件已存在 → 按约定转跳。
      const createBtn = page.getByRole("button", { name: "新建版本", exact: true }).first();
      const btnVisible = await createBtn.isVisible().catch(() => false);
      if (!btnVisible) {
        test.info().annotations.push({
          type: "探索注解",
          description: "新建版本按钮隐藏（固件数>0 且产品未上线），本用例转跳；待新合成产品（固件数为 0）产出后可完整执行"
        });
        test.skip();
      }

      const dlg = page.locator(".dialog-triger-modal:visible").last();
      await createBtn.click();
      await dlg.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_000);

      const errInField = async (label: string) => {
        const item = dlg.locator(".ep-form-item").filter({ hasText: label }).first();
        let found = "";
        await test.expect
          .poll(
            async () => {
              found = await item
                .locator(".ep-form-item__error")
                .first()
                .innerText()
                .catch(() => "");
              return found ? "y" : "n";
            },
            { timeout: 5_000, message: `字段错误(${label})应出现` }
          )
          .toBe("y");
        return found;
      };

      const nameInput = dlg.getByRole("textbox", { name: "固件名称" });
      const verInput = dlg.getByRole("textbox", { name: "* 固件版本", exact: true });
      const otaInput = dlg.getByRole("textbox", { name: "* 测试 OTA 固件版本", exact: true });

      // D01 名称含 # → text 校验提示。
      await nameInput.fill("固件#1");
      await nameInput.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("固件名称")).toContain("只能包含");
      // D02 名称 33 字 → maxlength=32 截断。
      await nameInput.fill("固".repeat(33));
      await nameInput.press("Tab");
      await page.waitForTimeout(600);
      const d02 = await nameInput.inputValue();
      test.expect(d02.length, "maxlength=32 应截断为 32 字").toBe(32);
      // D03 版本「1」→ version 格式提示。
      await verInput.fill("1");
      await verInput.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("固件版本")).toContain("格式");
      // D04 OTA 不大于生产版本。
      await verInput.fill("1.0.0");
      await otaInput.fill("1.0.0");
      await otaInput.press("Tab");
      await page.waitForTimeout(600);
      test.expect(await errInField("测试 OTA 固件版本")).toContain("大于");
      // D05 恢复合法值 → 错误清空（不提交）。
      await nameInput.fill("自动化测试固件校验恢复");
      await verInput.fill("1.0.0");
      await otaInput.fill("1.0.1");
      await dlg.getByText("版本说明").click();
      await page.waitForTimeout(1_200);
      const restErrs = await dlg.locator(".ep-form-item__error").count();
      test.expect(restErrs, "恢复合法值后字段错误应清空").toBe(0);

      // D06 空表单提交必填拦截（客户端校验拦截场景）：清空全部字段后点击确定——
      // 源码核实 doConfirm 先 eleForm.validate()，失败即 return false：弹窗不关闭、不发起网络写入。
      await nameInput.fill("");
      await verInput.fill("");
      await otaInput.fill("");
      await dlg.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      await expect(dlg).toBeVisible();
      await expect(page.getByText("新增固件成功", { exact: true })).toHaveCount(0);
      test.expect(await errInField("固件名称")).toContain("请输入");
      test.expect(await errInField("固件版本")).toContain("请输入");
      test.expect(await errInField("上传生产固件")).toContain("请上传");
      test.expect(await errInField("测试 OTA 固件版本")).toContain("请输入");
      test.expect(await errInField("上传测试固件")).toContain("请上传");
      const noteItem = dlg.locator(".ep-form-item").filter({ hasText: "版本说明" }).first();
      test.expect(await noteItem.locator(".ep-form-item__error").count(), "版本说明非必填：留空不应有字段级提示").toBe(0);
      test.info().annotations.push({
        type: "探索注解",
        description: "D06 空表单提交被客户端表单校验拦截：弹窗未关闭、无「新增固件成功」；5 个必填字段（名称/版本/生产固件/OTA版本/测试固件）字段级提示，版本说明留空无提示；固件类型保持默认 Sdk"
      });

      // D07 版本说明 101 字 → maxlength=100 截断（show-word-limit）。
      const noteInput = dlg.getByRole("textbox", { name: "版本说明" });
      await noteInput.fill("测".repeat(101));
      const noteValue = await noteInput.inputValue();
      test.expect(noteValue.length, "maxlength=100 应截断为 100 字").toBe(100);
      const noteCount = await noteItem.locator(".ep-input__count").first().innerText().catch(() => "");
      test.info().annotations.push({
        type: "探索注解",
        description: `D07 版本说明 101 字被 maxlength=100 截断为 100 字；字数计数显示=${noteCount.replace(/\s+/g, "") || "未捕获"}`
      });

      test.info().annotations.push({
        type: "探索注解",
        description: "OP-PDEV-007 全程无数据写入：D01~D05/D07 未点击提交；D06 点击确定被客户端表单校验拦截（弹窗未关闭、无网络写入）"
      });
      await attachShot(page, "固件表单校验");
      await dlg.getByRole("button", { name: "取消", exact: true }).click();
    });

    // 覆盖 OP-PDEV-006：固件版本详情查看（no_write）。
    test("OP-PDEV-006 固件版本详情查看", async ({ page }) => {
      test.setTimeout(180_000);
      const records = await readCreateProductLedger();
      test.expect(records.length).toBeGreaterThan(0);
      const latest = records[records.length - 1];
      await gotoDevelop(page, latest);

      // 依赖：固件列表有数据（005 或历史运行）。
      const fwTable = page.locator(".develop-firmware-table").first();
      const firstRow = fwTable.locator(".ep-table__body:visible tbody tr").first();
      const hasRow = await firstRow.isVisible().catch(() => false);
      if (!hasRow) {
        test.info().annotations.push({ type: "探索注解", description: "固件列表无数据（005 未执行），跳过查看详情断言（转跳）" });
        test.skip();
      }

      // 步骤 1：点击首行「查看」。
      await firstRow.getByText("查看", { exact: true }).click();
      const drawer = page.locator(".ep-drawer:visible").last();
      const drawerVisible = await drawer.isVisible().catch(() => false);
      const dlg = drawerVisible ? drawer : page.locator(".dialog-triger-modal:visible").last();
      await dlg.waitFor({ state: "visible", timeout: 15_000 });
      await expect(dlg).toContainText("查看固件版本");
      await attachShot(page, "固件版本查看");

      // 步骤 2：关闭（取消/关闭按钮，Escape 兜底）。
      const closeBtn = dlg.getByRole("button", { name: /取消|关闭/ }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(1_200);
      await attachShot(page, "固件查看关闭");
    });
  });
});
