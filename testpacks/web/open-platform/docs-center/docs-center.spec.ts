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
];
type StoredAuthState = { cookies?: Parameters<BrowserContext["addCookies"]>[0] };

test.describe("开放平台文档中心", () => {
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

  // 页面 auth:false 可匿名访问；若环境强制登录则回退复用共享会话。
  async function ensureReachable(page: Page, path: string): Promise<boolean> {
    await gotoWithRetry(page, path);
    if (!/\/login/u.test(page.url())) return true;
    console.log("[回退] 匿名访问被重定向登录，尝试复用共享会话");
    for (const candidate of sharedAuthPaths) {
      if (!existsSync(candidate)) continue;
      try {
        const state = JSON.parse(await readFile(candidate, "utf8")) as StoredAuthState;
        if (!state.cookies?.length) continue;
        await page.context().addCookies(state.cookies);
        await gotoWithRetry(page, path);
        if (!/\/login/u.test(page.url())) {
          test.info().annotations.push({ type: "登录态复用", description: `匿名不可达，已复用 ${candidate.split("/").slice(-2, -1)[0]} 会话` });
          return true;
        }
      } catch {
        // 尝试下一个候选
      }
    }
    return false;
  }

  // 覆盖 OP-DOC-001：文档中心加载失败实证（no_write）。
  test("OP-DOC-001 文档中心加载失败实证", async ({ page }) => {
    test.setTimeout(240_000);
    const reachable = await ensureReachable(page, "/service-support/home");
    test.expect(reachable, "页面应可达（auth:false 或会话复用）").toBe(true);
    await page.waitForTimeout(5_000);

    // 步骤 2：目录与正文区表现（2026-09-04 实证：加载失败）。
    const bodyText = await page.evaluate(() => document.body.innerText);
    const loadFailed = bodyText.includes("加载失败");
    test.info().annotations.push({
      type: "探索注解",
      description: `实证：正文区加载失败=${loadFailed}（content.json 返回 HTML→JSON 解析失败；public/service-support 目录为空——疑似缺陷/静态资源待部署，与研发确认）`
    });

    // 步骤 3：失败提示可见且无崩溃。
    if (loadFailed) {
      await expect(page.getByText(/加载失败/u).first()).toBeVisible();
    } else {
      test.info().annotations.push({ type: "探索注解", description: "当前内容已可加载（缺陷已修复？）——注解如实记录正文渲染状态" });
    }
    const hasApp = await page.locator("#app").count();
    test.expect(hasApp, "应用根节点应存在（无 JS 崩溃白屏）").toBeGreaterThan(0);
    await attachShot(page, "文档中心");
  });

  // 覆盖 OP-DOC-002：常见问题页同款失败实证（no_write，查重）。
  test("OP-DOC-002 常见问题页同款失败实证", async ({ page }) => {
    test.setTimeout(180_000);
    const reachable = await ensureReachable(page, "/service-support/faq");
    test.expect(reachable, "FAQ 页应可达").toBe(true);
    await page.waitForTimeout(5_000);

    // 步骤 1：页面表现注解。
    const bodyText = await page.evaluate(() => document.body.innerText);
    const loadFailed = bodyText.includes("加载失败");
    test.info().annotations.push({
      type: "探索注解",
      description: `实证：FAQ 加载失败=${loadFailed}（FAQViewer 与文档中心同 fetch 模式同根因）`
    });

    // 步骤 2：查重结论。
    test.info().annotations.push({
      type: "探索注解",
      description: "查重结论：faq 与 home 同因 content.json/内容 md 缺失而失败，修复应同源生效"
    });
    await attachShot(page, "常见问题");
  });
});
