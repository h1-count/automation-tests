import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 通过 npm run test:fast 运行：TEST_PACK_DIR 指向本功能包，产物写入包内 runtime/ 与 artifacts/（不入 Git）。
const packDirectory = process.env.TEST_PACK_DIR;
if (!packDirectory) {
  throw new Error("请通过 npm run test:fast 运行，以便将产物写入对应功能测试包。");
}
const authStatePath = join(packDirectory, "runtime", "auth-state.json");
// 跨包登录态复用：优先本包，其次 console-home / account-center / create-product 维护的有效会话。
const sharedAuthPaths = [
  join(packDirectory, "runtime", "auth-state.json"),
  join(packDirectory, "..", "account-center", "runtime", "auth-state.json"),
  join(packDirectory, "..", "console-home", "runtime", "auth-state.json"),
  join(packDirectory, "..", "create-product", "runtime", "auth-state.json"),
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

// 生成成员 M1（合成值，可入记录/报告/Trace；非凭据）。
const MEMBER_PHONE = "13000000002";
const MEMBER_NAME = "自动化成员M1";
const MEMBER_NOTES = "企业中心功能包生成（enterprise-center OP-ENT-006）";
const RESTRICTED_COMPANY = "自动化测试企业1788231909019b";
const FULL_COMPANY = "自动化测试企业1788160280635";

test.describe("开放平台企业中心", () => {
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

  test.beforeEach(async () => {
    await test.info().attach("功能包结论与已知差异.md", { path: join(packDirectory, "conclusion.md") });
  });

  async function gotoWithRetry(page: Page, path: string) {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      console.log(`[重试] ${path} 导航 20s 未完成（疑似 dev server 卡顿窗口），重载一次`);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
  }

  // 等待成员数据表渲染（SearchableFrame 第二个 table 为数据表）。
  async function expectMemberTableReady(page: Page) {
    await page.locator("table").nth(1).waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1_000);
  }

  const dialog = (page: Page) => page.locator(".dialog-triger-modal");
  async function closeDialog(page: Page) {
    const cancel = dialog(page).getByRole("button", { name: "取消", exact: true }).first();
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await dialog(page).waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
  }

  async function collectNotices(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        const t = (n.textContent ?? "").trim();
        if (t && t.length <= 60 && /请输入|请选择|至少|成功|失败/u.test(t)) out.push(t);
        n = walker.nextNode();
      }
      return Array.from(new Set(out));
    });
  }
  function noteCopy(step: string, expectedList: string[], notices: string[]) {
    const hit = expectedList.filter((e) => notices.some((t) => t.includes(e)));
    if (hit.length === expectedList.length && expectedList.length > 0) {
      console.log(`[文案一致] ${step}：${notices.join("；")}`);
      return;
    }
    test.info().annotations.push({
      type: "文案差异",
      description: `${step}：预期提示「${expectedList.join("、")}」，实际页面提示「${notices.join("；") || "（未捕获）"}」`
    });
  }

  // 企业切换（头部 .company-switch → option），并等待切换后上下文刷新。
  async function switchCompany(page: Page, target: string) {
    await page.locator(".company-switch").first().click();
    await page.getByRole("option", { name: target }).first().waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("option", { name: target }).first().click();
    await page.waitForTimeout(2_500);
  }

  // 在添加成员弹窗中勾选权限树叶子节点（el-tree 配置 check-on-click-node，点击节点文本即勾选；
  // 原生 checkbox input 隐藏，不可用 check()）。
  async function checkTreeLeaf(page: Page, leafName: string) {
    const leaf = dialog(page).getByRole("treeitem", { name: new RegExp(leafName) }).last();
    await leaf.getByText(leafName, { exact: true }).click();
    await expect(leaf.getByRole("checkbox")).toBeChecked();
  }

  // 填写并提交添加成员弹窗（OP-ENT-006/010 复用）。
  async function addMember(page: Page, phone: string, name: string, notes: string, leafName: string) {
    await page.getByRole("button", { name: "添加成员", exact: true }).first().click();
    await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(1_000);
    const nameInput = dialog(page).getByRole("textbox", { name: "姓名" });
    await nameInput.fill(name);
    await dialog(page).getByRole("textbox", { name: "手机号" }).fill(phone);
    await checkTreeLeaf(page, leafName);
    await dialog(page).getByRole("textbox", { name: "备注" }).fill(notes);
    await attachShot(page, `添加成员表单-${name}`);
    await dialog(page).getByRole("button", { name: "确定", exact: true }).click();
    await expect(page.locator('[role="alert"], .ep-message, .el-message').first()).toBeVisible({ timeout: 20_000 });
    const toastText = (await page.locator('[role="alert"], .ep-message, .el-message').first().innerText().catch(() => "")).trim();
    return toastText;
  }

  // 台账（硬边界：数据写入只经 src/support/recordGeneratedData.ts；台账只增不删，删除/重添以同 runId 覆盖标记）。
  // 各写入用例内按需动态 import 该模块。

  async function restoreSession(page: Page): Promise<boolean> {
    for (const candidate of sharedAuthPaths) {
      if (!existsSync(candidate)) continue;
      try {
        const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
        if (!state.cookies?.length) continue;
        await page.context().addCookies(state.cookies);
        await gotoWithRetry(page, "/console/company/info");
        if (!/\/login/u.test(page.url())) {
          const ready = await page
            .getByText("企业信息", { exact: true })
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

  test.describe("登录态就绪", () => {
    // 覆盖 OP-ENT-001：企业信息回显与系统权限状态（完整权限企业）。
    test("OP-ENT-001 企业信息回显与系统权限状态", async ({ page }) => {
      test.setTimeout(360_000);

      if (await restoreSession(page)) {
        test.info().annotations.push({
          type: "登录态复用",
          description: "检测到本地有效会话，跳过短信登录（不发送短信、无需人工点选验证码）"
        });
        await page.context().storageState({ path: authStatePath });
      } else {
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
        await gotoWithRetry(page, "/console/company/info");
        await page.getByText("企业信息", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
        await page.context().storageState({ path: authStatePath });
        console.log("[登录态] 短信登录成功，会话已保存到本包 runtime/auth-state.json");
      }

      // 步骤 1：页面标题「企业信息」。
      await expect(page).toHaveURL(/\/console\/company\/info/u);
      await expect(page.getByText("企业信息", { exact: true }).first()).toBeVisible();

      // 步骤 2：字段回显（探索实证：标识 at0635、地址 自动化测试地址）。
      const body = page.locator("main");
      await expect(body.getByText(FULL_COMPANY)).toBeVisible();
      await expect(body.getByText("at0635")).toBeVisible();
      await expect(body.getByText("自动化测试地址")).toBeVisible();

      // 步骤 3+4：三系统均「已开通」（2026-09-03 探索实证 ✓）。
      for (const sys of ["产品接入系统", "产品运营系统", "产品服务系统"]) {
        const item = body.locator(".permission-item", { hasText: sys });
        await expect(item).toBeVisible();
        await expect(item.locator(".status")).toHaveText("已开通");
      }
      await attachShot(page, "企业信息-完整权限企业");
    });
  });

  test.describe("企业信息联动与成员管理", () => {
    test.use({ storageState: authStatePath });

    // 覆盖 OP-ENT-002：受限企业系统权限状态联动（切换后恢复）。
    test("OP-ENT-002 受限企业系统权限状态联动", async ({ page }) => {
      test.setTimeout(120_000);
      await gotoWithRetry(page, "/console/company/info");
      await page.getByText("企业信息", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });

      // 步骤 1+2：切换到受限企业，权限区仅产品接入系统已开通。
      await switchCompany(page, RESTRICTED_COMPANY);
      const body = page.locator("main");
      await expect(body.getByText(RESTRICTED_COMPANY)).toBeVisible({ timeout: 20_000 });
      await expect(body.locator(".permission-item", { hasText: "产品接入系统" }).locator(".status")).toHaveText("已开通");
      await expect(body.locator(".permission-item", { hasText: "产品运营系统" }).locator(".status")).toHaveText("未开通");
      await expect(body.locator(".permission-item", { hasText: "产品服务系统" }).locator(".status")).toHaveText("未开通");
      // 步骤 3：企业标识联动（实证 b9019）。
      await expect(body.getByText("b9019")).toBeVisible();
      await attachShot(page, "企业信息-受限企业");

      // 步骤 4：切回完整权限企业，三系统恢复已开通（会话上下文还原）。
      await switchCompany(page, FULL_COMPANY);
      await expect(body.getByText(FULL_COMPANY)).toBeVisible({ timeout: 20_000 });
      await expect(body.locator(".permission-item", { hasText: "产品接入系统" }).locator(".status")).toHaveText("已开通");
      await attachShot(page, "企业信息-切回完整权限");
    });

    // 覆盖 OP-ENT-003：成员列表结构与管理员行形态。
    test("OP-ENT-003 成员列表结构与管理员行形态", async ({ page }) => {
      test.setTimeout(60_000);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);

      // 步骤 1：表头六列（el-table 固定列拆分渲染，表头在第一个 table）。
      const header = page.locator("table").nth(0).locator("thead");
      for (const col of ["成员ID", "手机号", "成员姓名", "备注", "成员权限", "操作"]) {
        await expect(header.getByText(col, { exact: true })).toBeVisible();
      }

      // 步骤 2：管理员行——权限「管理员」、操作「-」；勾选框渲染但禁用（探索实证：isSelectable=false → disabled）。
      const adminRow = page.locator("table").nth(1).locator("tbody tr").first();
      await expect(adminRow).toContainText("管理员");
      await expect(adminRow).toContainText("-");
      await expect(adminRow.locator("input[type='checkbox']").first()).toBeDisabled();

      // 步骤 3：管理操作入口可见（管理员视角）。「批量删除成员」为选中行后的选择操作插槽，
      // 单管理员状态无可选中行（管理员行勾选框禁用），不渲染——以注解记录形态。
      await expect(page.getByRole("button", { name: "添加成员", exact: true })).toBeVisible();
      const batchBtnVisible = await page.getByRole("button", { name: "批量删除成员", exact: true }).isVisible().catch(() => false);
      test.info().annotations.push({
        type: "探索注解",
        description: batchBtnVisible
          ? "「批量删除成员」按钮在未选中状态下可见"
          : "「批量删除成员」为选中行后的选择操作（SearchableFrame selection-action 插槽），当前无可选中成员（管理员行勾选框禁用）故未渲染，与源码实现一致"
      });

      // 步骤 4：搜索区（关键字输入 + 权限下拉——标签视觉隐藏但 ARIA 关联仍在，按角色+名称定位）。
      await expect(page.getByPlaceholder("姓名 / 手机号")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "权限" })).toBeVisible();
      await attachShot(page, "成员列表-管理员行形态");
    });

    // 覆盖 OP-ENT-004：成员搜索与权限筛选。
    test("OP-ENT-004 成员搜索与权限筛选", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);
      const kw = page.getByPlaceholder("姓名 / 手机号");
      const queryBtn = page.getByRole("button", { name: "查询", exact: true }).first();
      const dataRows = () => page.locator("table").nth(1).locator("tbody tr");

      // 步骤 1：手机号命中当前账号行（探索实证：手机号列脱敏 130****0000）。
      await kw.fill(process.env.TEST_PHONE ?? "13000000000");
      await queryBtn.click();
      await page.waitForTimeout(1_500);
      expect(await dataRows().count(), "手机号查询应命中账号行").toBeGreaterThanOrEqual(1);
      await expect(page.locator("table").nth(1)).toContainText("自动化测试");

      // 步骤 2：不存在手机号 → 列表为空。
      await kw.fill("19999999999");
      await queryBtn.click();
      await page.waitForTimeout(1_500);
      expect(await dataRows().count(), "不存在手机号查询应为空列表").toBe(0);

      // 步骤 3：权限筛选「管理员」→ 仅管理员行（按角色+名称定位下拉）。
      await kw.fill("");
      const permSelect = page.getByRole("combobox", { name: "权限" });
      await expect(permSelect).toBeVisible();
      // ep-select 的 placeholder 层拦截指针事件，点击 placeholder 文本冒泡打开下拉。
      await page.getByText("请选择成员权限", { exact: true }).first().click();
      const adminOption = page.getByRole("option", { name: "管理员", exact: true }).first();
      await adminOption.waitFor({ state: "visible", timeout: 10_000 });
      await adminOption.click();
      await queryBtn.click();
      await page.waitForTimeout(1_500);
      expect(await dataRows().count(), "管理员筛选应命中管理员行").toBeGreaterThanOrEqual(1);
      await expect(page.locator("table").nth(1)).toContainText("管理员");

      // 步骤 4：重置恢复全量。
      await page.getByRole("button", { name: "重置", exact: true }).first().click();
      await page.waitForTimeout(1_500);
      expect(await dataRows().count(), "重置后应恢复全量列表").toBeGreaterThanOrEqual(1);
      await attachShot(page, "成员搜索与筛选");
    });

    // 覆盖 OP-ENT-005：添加成员弹窗校验（空提交/格式/截断；不提交成功）。
    test("OP-ENT-005 添加成员弹窗校验", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);

      await page.getByRole("button", { name: "添加成员", exact: true }).click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(1_000);

      // 步骤 1：字段与权限树（探索实证：0/20、0/11、0/64 + 全展开树）。
      await expect(dialog(page).getByRole("textbox", { name: "姓名" })).toBeVisible();
      await expect(dialog(page).getByRole("textbox", { name: "手机号" })).toBeVisible();
      await expect(dialog(page).getByRole("textbox", { name: "备注" })).toBeVisible();
      await expect(dialog(page).getByRole("treeitem", { name: /iKinglink AIoT平台/u })).toBeVisible();
      await expect(dialog(page).getByRole("treeitem", { name: /产品开发/u })).toBeVisible();

      // 步骤 2：空提交 → 必填与权限必选提示（探索实证文案）。
      await dialog(page).getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForTimeout(1_500);
      const notices = await collectNotices(page);
      expect(notices.some((t) => /请输入姓名/u.test(t)), "应出现姓名必填提示").toBeTruthy();
      expect(notices.some((t) => /请输入手机号/u.test(t)), "应出现手机号必填提示").toBeTruthy();
      expect(notices.some((t) => /请至少选择一项权限/u.test(t)), "应出现权限必选提示").toBeTruthy();
      noteCopy("添加成员空提交", ["请输入姓名", "请输入手机号", "请至少选择一项权限。"], notices);
      await expect(dialog(page)).toBeVisible();
      await attachShot(page, "添加成员空提交拦截");

      // 步骤 3：手机号非数字剔除（行为断言：仅数字、≤11 位）。
      const phoneInput = dialog(page).getByRole("textbox", { name: "手机号" });
      await phoneInput.fill("130abc00000123");
      const phoneValue = await phoneInput.inputValue();
      expect(phoneValue, "手机号应仅含数字").toMatch(/^\d+$/u);
      expect(phoneValue.length, "手机号长度应不超过 11 位").toBeLessThanOrEqual(11);

      // 步骤 4+5：长度截断（姓名 20、备注 64——探索实证备注 64）。
      const nameInput = dialog(page).getByRole("textbox", { name: "姓名" });
      await nameInput.fill("测".repeat(25));
      expect((await nameInput.inputValue()).length, "姓名应截断为 20 位").toBeLessThanOrEqual(20);
      const notes = dialog(page).getByRole("textbox", { name: "备注" });
      await notes.fill("字".repeat(70));
      expect((await notes.inputValue()).length, "备注应截断为 64 位").toBe(64);
      await attachShot(page, "添加成员字段截断");
      await closeDialog(page);
    });

    // 覆盖 OP-ENT-006：添加成员成功（受限企业，写入台账）。
    test("OP-ENT-006 添加成员成功（受限企业）", async ({ page }) => {
      test.setTimeout(120_000);
      const { recordGeneratedMemberData } = await import("../../../../src/support/recordGeneratedData");

      await gotoWithRetry(page, "/console/company/info");
      await page.getByText("企业信息", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });

      // 步骤 1：切换到受限企业，进入成员管理页（手机号列脱敏，行定位以成员姓名为准）。
      await switchCompany(page, RESTRICTED_COMPANY);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);

      // 前置幂等化：上次运行结束时 M1 可能仍为成员（006→008→010 链路结束态），先清理再执行添加。
      const existingRow = page.locator("table").nth(1).locator("tbody tr", { hasText: MEMBER_NAME });
      if (await existingRow.count()) {
        console.log("[前置清理] 检测到上次运行遗留的成员 M1，先删除再执行添加（合成数据，台账有记录）");
        await existingRow.getByText("删除", { exact: true }).click();
        await page.getByText("确定删除该成员吗？").first().waitFor({ state: "visible", timeout: 10_000 });
        await page.getByRole("button", { name: "确定", exact: true }).last().click();
        await page.waitForTimeout(1_500);
        await expect(page.locator("table").nth(1)).not.toContainText(MEMBER_NAME);
      }

      // 步骤 2+3+4：填写并提交（勾选最小权限集：产品开发）。
      const toast = await addMember(page, MEMBER_PHONE, MEMBER_NAME, MEMBER_NOTES, "产品开发");
      if (/新增成员成功/u.test(toast)) {
        console.log(`[文案一致] 新增成员成功提示：${toast}`);
      } else {
        test.info().annotations.push({
          type: "文案差异",
          description: `预期「新增成员成功」，实际提示「${toast || "（未捕获）"}」`
        });
      }
      await page.waitForTimeout(1_500);
      await expect(page.locator("table").nth(1)).toContainText(MEMBER_NAME);
      const memberRow = page.locator("table").nth(1).locator("tbody tr", { hasText: MEMBER_NAME });
      await expect(memberRow).toContainText("成员");
      await attachShot(page, "新增成员成功-列表回显");

      // 步骤 5：台账记录（只增不删）。
      await recordGeneratedMemberData({
        runId: 1,
        memberName: MEMBER_NAME,
        memberPhone: MEMBER_PHONE,
        memberNotes: MEMBER_NOTES,
        companyName: RESTRICTED_COMPANY,
        grantedPermissions: ["产品开发"],
      });
      test.info().annotations.push({
        type: "写入台账",
        description: `受限企业新增成员 M1（${MEMBER_NAME}/${MEMBER_PHONE}，权限：产品开发），已记入本包台账 runId=1`
      });
    });

    // 覆盖 OP-ENT-007：修改成员弹窗仅权限可编辑（取消不保存）。
    test("OP-ENT-007 修改成员弹窗仅权限可编辑", async ({ page }) => {
      test.setTimeout(90_000);
      const { readLatestGeneratedData } = await import("../../../../src/support/recordGeneratedData");
      const latest = await readLatestGeneratedData<{ runId: number; memberPhone: string; memberName: string }>("web", "open-platform", "enterprise-center");
      if (!latest) throw new Error("台账无成员记录，请先执行 OP-ENT-006");

      await gotoWithRetry(page, "/console/company/info");
      await page.getByText("企业信息", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await switchCompany(page, RESTRICTED_COMPANY);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);

      // 手机号列脱敏，行定位以成员姓名为准。
      const memberRow = page.locator("table").nth(1).locator("tbody tr", { hasText: latest.memberName });
      await expect(memberRow).toBeVisible();

      // 步骤 1：打开修改弹窗。
      await memberRow.getByText("修改", { exact: true }).click();
      await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(1_000);

      // 步骤 2：姓名/手机号/备注禁用（编辑态仅权限可改）。
      await expect(dialog(page).getByRole("textbox", { name: "姓名" })).toBeDisabled();
      await expect(dialog(page).getByRole("textbox", { name: "手机号" })).toBeDisabled();
      await expect(dialog(page).getByRole("textbox", { name: "备注" })).toBeDisabled();

      // 步骤 3：权限树按已授予权限回显（产品开发勾选）。
      const leaf = dialog(page).getByRole("treeitem", { name: /产品开发/u }).last();
      await expect(leaf.getByRole("checkbox")).toBeChecked();
      await attachShot(page, "修改成员弹窗-仅权限可编辑");

      // 步骤 4：取消关闭，列表不变。
      await closeDialog(page);
      await expect(page.locator("table").nth(1)).toContainText(latest.memberName);
    });

    // 覆盖 OP-ENT-008：删除成员成功（二次确认，写入）。
    test("OP-ENT-008 删除成员成功", async ({ page }) => {
      test.setTimeout(90_000);
      const { readLatestGeneratedData, recordGeneratedMemberData } = await import("../../../../src/support/recordGeneratedData");
      const latest = await readLatestGeneratedData<{ runId: number; memberPhone: string; memberName: string; memberNotes: string; companyName: string; grantedPermissions: string[] }>("web", "open-platform", "enterprise-center");
      if (!latest) throw new Error("台账无成员记录，请先执行 OP-ENT-006");

      await gotoWithRetry(page, "/console/company/info");
      await page.getByText("企业信息", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await switchCompany(page, RESTRICTED_COMPANY);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);

      // 手机号列脱敏，行定位以成员姓名为准。
      const memberRow = page.locator("table").nth(1).locator("tbody tr", { hasText: latest.memberName });
      await expect(memberRow).toBeVisible();

      // 步骤 1：点击删除出现二次确认（需求参考文案）。
      await memberRow.getByText("删除", { exact: true }).click();
      const confirmText = page.getByText("确定删除该成员吗？");
      await expect(confirmText.first()).toBeVisible({ timeout: 10_000 });
      await attachShot(page, "删除成员二次确认");

      // 步骤 2：确认删除 → 成功提示、行消失。
      await page.getByRole("button", { name: "确定", exact: true }).last().click();
      await expect(page.locator('[role="alert"], .ep-message, .el-message').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);
      await expect(page.locator("table").nth(1)).not.toContainText(latest.memberName);
      await attachShot(page, "删除成员成功");

      // 步骤 3：台账同 runId 覆盖标记 deletedAt（只增不删）。
      await recordGeneratedMemberData({ ...latest, deletedAt: new Date().toISOString() });
      test.info().annotations.push({
        type: "写入台账",
        description: `成员 M1（${latest.memberPhone}）已删除出受限企业，台账 runId=${latest.runId} 追加 deletedAt`
      });
    });

    // 覆盖 OP-ENT-010：同手机号重新添加（成员已有账号分支；结束后 M1 留存供补测轮）。
    test("OP-ENT-010 同手机号重新添加（成员已有账号分支）", async ({ page }) => {
      test.setTimeout(120_000);
      const { readLatestGeneratedData, recordGeneratedMemberData } = await import("../../../../src/support/recordGeneratedData");
      const latest = await readLatestGeneratedData<{ runId: number; memberPhone: string; memberName: string; memberNotes: string; companyName: string; grantedPermissions: string[]; deletedAt?: string }>("web", "open-platform", "enterprise-center");
      if (!latest?.deletedAt) throw new Error("台账显示成员尚未删除（缺 deletedAt），请先按序执行 OP-ENT-006→008");

      await gotoWithRetry(page, "/console/company/info");
      await page.getByText("企业信息", { exact: true }).first().waitFor({ state: "visible", timeout: 45_000 });
      await switchCompany(page, RESTRICTED_COMPANY);
      await gotoWithRetry(page, "/console/company/member");
      await expectMemberTableReady(page);

      // 步骤 1+2：同手机号再添加（需求：已有账号不新建、开通企业权限）。
      const toast = await addMember(page, latest.memberPhone, latest.memberName, latest.memberNotes, latest.grantedPermissions[0] ?? "产品开发");
      if (/成功/u.test(toast)) {
        console.log(`[文案一致] 重新添加成功提示：${toast}`);
      } else {
        test.info().annotations.push({
          type: "文案差异",
          description: `预期成功类提示（不新建账号、开通权限分支），实际提示「${toast || "（未捕获）"}」`
        });
      }
      await page.waitForTimeout(1_500);

      // 步骤 3：列表回显 + 台账 readdedAt（手机号列脱敏，按姓名断言）。
      await expect(page.locator("table").nth(1)).toContainText(latest.memberName);
      await attachShot(page, "同手机号重新添加成功");
      await recordGeneratedMemberData({ ...latest, readdedAt: new Date().toISOString() });
      test.info().annotations.push({
        type: "写入台账",
        description: `同手机号重新添加成功（成员已有账号分支），台账 runId=${latest.runId} 追加 readdedAt；M1 留存受限企业供补测轮（OP-ACCT-008 / OP-CONS-010）`
      });
    });

    // 覆盖 OP-ENT-009：头部企业入口与企业中心侧边菜单组。
    test("OP-ENT-009 头部企业入口与企业中心侧边菜单组", async ({ page }) => {
      test.setTimeout(90_000);
      await gotoWithRetry(page, "/console/home");
      await page.locator(".console-home").first().waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});

      // 步骤 1：头部「企业」链接跳转。
      const entLink = page.getByRole("link", { name: "企业", exact: true }).first();
      await expect(entLink).toBeVisible();
      await entLink.click();
      await page.waitForURL(/\/console\/company\/info/u, { timeout: 30_000 });
      await expect(page).toHaveURL(/\/console\/company\/info/u);

      // 步骤 2：侧边显示企业管理组（探索实证组名「企业管理」：企业信息/成员管理）+ 当前页高亮。
      const sideNav = page.locator(".app-sidenav");
      await expect(sideNav.getByText("企业信息", { exact: true })).toBeVisible();
      await expect(sideNav.getByText("成员管理", { exact: true })).toBeVisible();
      // 开发演示菜单组仍在（同 account-center 缺陷候选，注解记录）。
      const devMenuVisible = await sideNav.getByText("UI组件示例<开发>", { exact: true }).isVisible().catch(() => false);
      if (devMenuVisible) {
        test.info().annotations.push({
          type: "缺陷候选",
          description: "侧边导航出现开发演示菜单组「UI组件示例<开发>」（与 account-center 包同一发现，跨页面均可见）"
        });
      }
      await attachShot(page, "企业中心侧边菜单");

      // 步骤 3：点击侧边「成员管理」跳转。
      await sideNav.getByText("成员管理", { exact: true }).click();
      await expect(page).toHaveURL(/\/console\/company\/member/u, { timeout: 20_000 });
      await expectMemberTableReady(page);
    });
  });
});
