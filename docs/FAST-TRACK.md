# 快速通道

唯一入口是 Playwright：

```bash
npm run test:fast
npm run test:fast -- testpacks/web/open-platform/login-register/login-register.spec.ts
npm run report -- testpacks/web/open-platform/login-register/artifacts/report
```

## 环境

地址解析顺序为 `FAST_BASE_URL`、`.env` 中按 `TEST_ENV` 选择的地址、远程测试环境默认地址。默认以有头浏览器运行（机制见 `playwright.fast.config.ts`）。默认本地地址为 `http://127.0.0.1:3098/`：未运行时，Playwright 会自动在本机开放平台前端项目中以 test 模式启动 Vite；已运行时直接复用。

```bash
FAST_BASE_URL=https://open-platform-test.ikingcity.com/ npm run test:fast
```

## 生成测试用例并写脚本

完整流程链（权威定义，AGENTS.md 只保留闸门义务）：加载上下文 → 确认测试依据与 test 环境 → 生成 `cases.md` 并记录上下文 → 导出 Excel 并等待用户确认 → 重新加载复核 → MCP 按已确认用例探索 → 编写/更新 `<feature>.spec.ts` 与 `conclusion.md` → `npm run test:fast` → 查看包内报告与 trace。

### 功能测试包结构

功能资产按功能测试包聚合在 `testpacks/<type>/<project>/<feature>/`，目录与文件布局如下（权威定义；`review-id` 用功能标识、不带日期如 `review/login-review/`，一个功能一份工作簿、重新审核时覆盖更新）：

| 路径（`<feature>` 包内） | 内容 | Git |
| --- | --- | --- |
| `<feature>.spec.ts` | Playwright 测试脚本（怎么执行） | 提交 |
| `cases.md` | 分层用例表（测什么，供审核） | 提交 |
| `conclusion.md` | 当前结论、断言策略说明与已知差异 | 提交 |
| `review/<review-id>/` | 审核 Excel 工作簿 + 预览图 | 不提交 |
| `runtime/` | 本地运行数据：台账（见「数据写入与台账」）、评审模型、探索脚本等 | 不提交 |
| `artifacts/report/` | HTML 运行报告（查看命令见文首） | 不提交 |
| `artifacts/results/` | 失败 trace 与运行输出（排错完毕后清理，台账除外） | 不提交 |

### 加载测试上下文

生成用例前，以及用户确认 Excel 后、开始页面探索或执行测试前，都先加载知识库与经验库：

```bash
node scripts/load-test-context.mjs --project open-platform --scope login-register
```

该命令会先自动归档 `.dsh-filess/<project>/` 中的新上传资料并更新资料索引，再列出 `sources/indexes/<project>.yaml`、索引命中的 `indexedSections`、`sources/<project>/` 中与范围匹配的文本资料、需要人工阅读的二进制资料，以及 `experience/general.md`、`experience/<project>.md`。先读索引和索引命中章节，再读原始资料；命令用于定位，不能代替阅读和判断。实际使用的资料路径与影响范围的结论必须写入用例文件顶部。例如：

```md
> 上下文来源：`sources/open-platform/原型包/登录页面.html`、`sources/open-platform/原型包/注册页面.html`、`experience/general.md`、`experience/open-platform.md`。
>
> 上下文结论：登录和注册页面均在本次范围内；涉及短信、登录态或注册提交的场景为写入风险，须在 Excel 确认后才可探索和执行。
```

还必须检查同项目已有的功能测试包，避免重复或矛盾（优先级与待确认规则见 AGENTS.md「用例表与审核」）。

用例表（`cases.md`）的分层格式与模板以 `skills/testcase-designer/SKILL.md`「输出格式（cases.md 模板）」为唯一权威——顶部声明（测试类型/默认环境/默认数据策略、上下文来源与结论）、五列快速索引、折叠详情与“数据编号、步骤、操作、测试数据、预期结果”五列表格均在其模板中定义，本文件不重复维护模板；步骤表每行只描述一个操作和一个可观察预期。用例范围完整性按同一 SKILL.md「工作流——划定范围（七类提取）」逐类核对，不得只写主流程；范围外场景在用例表头部显式声明理由。

### Excel 审核工作簿

用例文件生成后，必须导出 Excel 审核工作簿，不能以对话 Markdown 表替代。工作簿沿用 `testcase-generation-refactor` 的三工作表结构，但不携带已停用正式流程的 RULE、来源追溯或运行档案字段：

| 工作表 | 固定内容 |
| --- | --- |
| `说明` | 功能名称、测试类型、默认环境、默认数据策略、用例总数、P0 数量、高风险数量、审核说明和用例文件路径。 |
| `用例索引` | `模块、用例编号、用例标题、优先级、风险`；冻结表头便于审核。 |
| `用例详情` | `模块、用例、优先级、风险、RULE / 差异、前置条件、数据编号、步骤 / 操作、测试数据、预期结果`；按每个执行步骤展开一行。快速通道不维护 RULE 时，在“RULE / 差异”填写是否写入数据与脚本状态。 |

审核工作簿必须由 `scripts/build-testcase-review-workbook.mjs` 生成，输出到 `testpacks/<type>/<project>/<feature>/review/<review-id>/`，不提交 Git。用户确认前，不得发送验证码、登录、提交注册或执行其他外部写操作。用户确认后，先重新运行上下文加载命令，复核资料、环境、写入风险和已审核用例仍一致；随后才使用 Chrome DevTools MCP 按审核工作簿逐条探索真实页面。页面事实与用例不一致时，先更新用例表并重新导出审核工作簿，再编写脚本。

审核后，使用 Chrome DevTools MCP 按表格逐条探索真实页面、确认定位或排查问题，再生成 Playwright 脚本。

脚本使用原生 Playwright，并放在功能测试包 `testpacks/<type>/<project>/<feature>/<feature>.spec.ts`：

```ts
import { expect, test } from "@playwright/test";

test("首页登录入口可见", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "登录/注册" })).toBeVisible();
});
```

### 定位与断言

定位优先 ARIA（`getByRole`、可访问名称、`aria-*` 属性），无 ARIA 时依次降级为可访问文本、placeholder、项目自有业务类，不依赖第三方组件库内部类名（排错案例见 `experience/general.md` 稳定锚点）。

### 提示类断言（权威定义）

字段校验、后端拒绝等场景执行"行为成立即通过 + 文案差异记录"：动作前收集基线提示快照、动作后只捕获新出现提示（关键词子串宽匹配），文案一致打日志、差异以"文案差异"注解写入报告，不得以提示文案精确匹配作为通过条件；捕获等待用单次竞速（跳转 / role=alert / toast 谁先出现处理谁），预期出现提示时未出现即秒级失败并说明，预期无提示场景以短窗口未出现为通过。竞速返回的结果只是捕获而非通过依据，须再与用例预期终态比对（语义关键词 / 跳转 URL / 字段相关性），无关提示不得作为通过依据。仅文案本身是被测对象时（字数计数器、maxlength 截断值）才精确断言。

### 数据写入与台账（权威定义）

允许脚本生成唯一测试数据并执行正常业务写入（注册、创建、提交）。记录统一走 `src/support/recordGeneratedData.ts`（存储结构等机制以该实现为准），只记实际写入：no_write 不调用、失败尝试不留痕、确认写入成功后才记录。`runtime/generated-data.json` 是增量累积台账：只追加、不删除、不清空（同 `runId` 覆盖除外），任何报告/trace/运行产物清理不得波及 `runtime/` 下的台账文件；测试数据均为合成值，记录文件明文全量存储，安全边界是 `runtime/` 不提交 Git（真实凭据红线见 AGENTS.md 硬边界）。AGENTS.md「定位与写入」只保留义务与红线指针。

## MCP 接入（页面探索与排错）

探索与排错使用两个 MCP 服务。服务本身与 harness 无关，启动命令通用；各工具只是配置文件的位置与格式不同：

| 服务 | 通用启动命令 | 用途 | 约束 |
| --- | --- | --- | --- |
| chrome-devtools-mcp | `npx -y chrome-devtools-mcp@1.6.0` | 只读页面探索、快照与排错 | 版本与启动参数以 `config/browser-exploration/chrome-devtools-mcp-policy.json` 为准 |
| @playwright/mcp | `npx -y @playwright/mcp@latest --codegen typescript` | 按已审核用例探索并生成 Playwright 代码 | 探索保持只读；稳定步骤写入 `<feature>.spec.ts` |

版本约定：chrome-devtools-mcp 由策略文件钉板（当前 `1.6.0`），各 harness 实例与本节保持一致；@playwright/mcp 暂跟随 `@latest`，如需钉板先在本节定版再同步实例。升级时同步三处：策略文件、本节、各 harness 实例配置。

各 harness 的接入位置：

- **Codex**：`.codex/config.toml` 的 `[mcp_servers.*]`（本仓库已配置，chrome-devtools 已钉板并按策略带启动参数）。
- **Claude Code**：项目根 `.mcp.json`；Claude Desktop 为 `claude_desktop_config.json`。
- **Cursor**：`.cursor/mcp.json`；**VS Code**：`.vscode/mcp.json`。
- **DSH**：通过官方插件 `@deepseek-ai/dsh-mcp-client` 接入（支持 stdio 与 streamable-http 两种 transport），已在本机 DSH 的 `~/.dsh/profiles/web/cordis.patch.yml` 中按 `serverName + command + args` 注册上述两个服务（`chrome_devtools` / `playwright`），改动该文件后需重启 DSH 生效。

JSON 形态的通用配置（Claude Code / Cursor / VS Code 等均为该结构）：

```json
{
  "mcpServers": {
    "chrome-devtools": { "command": "npx", "args": ["-y", "chrome-devtools-mcp@1.6.0"] },
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--codegen", "typescript"] }
  }
}
```

无论哪种 harness，被验证的定位与步骤最终固化到功能包 `*.spec.ts`，由 `npm run test:fast` 重复执行。

**MCP 缺失时先询问**：开始探索或排错前，先确认当前环境里工程所需的 MCP 是否可用；不可用时应主动询问用户是否需要帮忙安装或接入（按本节口径配置），经用户确认后才允许降级到无头 Playwright 等替代手段，不得默认跳过 MCP。

本节是 MCP 接入的唯一事实源；各 harness 目录下的配置（如 `.codex/config.toml`，属其固定读取路径）只是照抄本节的薄实例，调整服务或参数时先改本节，再同步各实例。
