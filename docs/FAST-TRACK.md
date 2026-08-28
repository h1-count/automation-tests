# 快速通道（Fast Track）

唯一目标：**一条命令跑通自动化测试**。不经过授权快照、manifest、能力 Provider、波次调度、评审与门禁。

## 三步上手

1. **准备环境**：本地 `.env` 里 `TEST_ENV=test` + `OPEN_PLATFORM_WEB_BASE_URL_TEST` 指向被测地址（默认本地 `http://127.0.0.1:3098/`）。本地服务没起时，临时指远程：

   ```bash
   FAST_BASE_URL=https://open-platform-test.ikingcity.com/ npm run test:fast
   ```

   > 远程测试环境页面加载较慢（约 20 秒），快速通道导航超时已放宽到 60 秒；本地环境几秒即完。

2. **写用例**：新建 `tests/web/<project>/<feature>.spec.ts`，普通 Playwright 写法即可：

   ```ts
   import { expect, test } from "@playwright/test";

   test("首页未登录入口可见", async ({ page }) => {
     await page.goto("/");
     await expect(page.getByRole("link", { name: "登录/注册" })).toBeVisible();
   });
   ```

   需要零写入探索守卫等既有能力时，可继续从 `src/fixtures/webAutomationFixture.js` 导入，与快速通道兼容。

3. **跑**：

   ```bash
   npm run test:fast                      # 全部
   npm run test:fast -- tests/web/xx.spec.ts   # 指定文件
   npm run test:fast:headed               # 有头调试
   ```

## 地址解析顺序

`FAST_BASE_URL` > `.env` 按 `TEST_ENV` 解析（`OPEN_PLATFORM_WEB_BASE_URL_TEST/PRE/PROD`）> 远程测试环境默认值。

## 产物位置

| 产物 | 位置 |
| --- | --- |
| HTML 报告 | `artifacts/fast-report/`（`npm run report` 打开） |
| 失败 trace | `artifacts/fast-results/<case>/trace.zip` |
| 运行输出 | `artifacts/fast-results/` |

以上均在 `artifacts/`（Git 忽略），不产生 `plan.md`、`workflow-history.ndjson` 或任何 `.local/test-runs` 档案。

## 与正式通道的关系

- 正式通道（`npm run test:web:execute`、`task:*` 系列）代码原样保留，本分支只是不再要求走它。
- `*.formal.spec.ts` 为正式通道专用命名，快速通道自动忽略；普通 `*.spec.ts` 只被快速通道发现（`playwright.config.ts` 的非正式模式同样忽略 formal 命名），互不干扰。
- 回切 `testcase-generation-refactor` 分支即完整恢复原流程与规范。
