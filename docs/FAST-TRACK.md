# 快速通道

唯一入口是 Playwright：

```bash
npm run test:fast
npm run test:fast -- testpacks/web/open-platform/login-register/login-register.spec.ts
npm run test:fast:repair -- --report-id <请求报告标识>
npm run report:request -- <请求报告标识>
npm run report:allure -- --report-id <请求报告标识> --pack <功能包>
```

## 环境

地址解析顺序为 `FAST_BASE_URL`、`.env` 中按 `TEST_ENV` 选择的地址、远程测试环境默认地址。默认以有头浏览器运行（机制见 `playwright.fast.config.ts`）。默认本地地址为 `http://127.0.0.1:3098/`：未运行时，Playwright 会自动在本机开放平台前端项目中以 test 模式启动 Vite；已运行时直接复用。

```bash
FAST_BASE_URL=https://open-platform-test.ikingcity.com/ npm run test:fast
```

## 生成测试用例并写脚本

完整流程链（流程正本，AGENTS.md 只保留闸门义务）：多包请求先创建并确认 `request-plan.json` → 生成并审计功能包级 `agent-dispatch.json` → 按工作单批次独立加载上下文 → 生成设计卡 → 判定组合策略并维护 `scope.json`（七类范围契约 + `combinationDesign`）→ 审计范围契约 → 生成 `cases.md` → Reduce 汇总 → 导出 Excel（先审核范围矩阵与组合策略摘要）并等待用户确认 → 重新加载复核并确认 MCP 可用 → MCP 按已确认用例探索 → 按计划顺序编写/更新 `<feature>.spec.ts` 与 `conclusion.md` → 串行 `npm run test:fast` → 查看请求级报告与 trace。

### 功能测试包结构

功能资产按功能测试包聚合在 `testpacks/<type>/<project>/<feature>/`，目录与文件布局如下（布局正本；`review-id` 用功能标识、不带日期如 `review/login-review/`，一个功能一份工作簿、重新审核时覆盖更新）：

| 路径（`<feature>` 包内） | 内容 | Git |
| --- | --- | --- |
| `<feature>.spec.ts` | Playwright 测试脚本（怎么执行） | 提交 |
| `cases.md` | 分层用例表（测什么，供审核） | 提交 |
| `scope.json` | 七类范围契约：对象、源码/资料依据、covered/out_of_scope/pending 归宿；另含每对象 `combinationDesign` 组合设计（见「组合设计门禁」） | 提交 |
| `execution.json` | 用例可执行性契约：每个用例的同包 `dependsOn` 前置关系；所有用例必须能在 `test()` 标题中定位 | 提交 |
| `conclusion.md` | 当前结论、断言策略说明与已知差异 | 提交 |
| `review/<review-id>/` | 审核 Excel 工作簿 + 预览图 | 不提交 |
| `runtime/` | 本地运行数据：台账（见「数据写入与台账」）、评审模型、探索脚本等 | 不提交 |
| `test-reports/<report-id>.md` | 唯一长期测试结论：请求范围、全局用例序号、最终状态、执行次数和失败摘要；单包在包内，多包在公共目录 | 提交 |
| `artifacts/current/<report-id>/` | 指定请求的请求级最终 Allure：全部用例的最后结果与最终失败诊断；补测只替换命中用例，不保留中间轮次 | 不提交 |
| `runtime/allure-history/<report-id>.jsonl` | 指定请求的 Allure 3 紧凑历史，自动限制最近 20 次，用于趋势和不稳定用例判断；不含完整 HTML 或媒体 | 不提交 |

跨请求的共享首页固定在 `testpacks/artifacts/allure-dashboard/`：其中 `allure-results/` 只保留首页展示的最近 5 个请求，`allure-history.jsonl` 独立保留最近 50 次完成快照，`report-server.json` 是该首页唯一可复用的本地服务登记文件；均为本地数据，不提交。

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

### 多功能包请求编排

一次请求涉及 3 个及以上功能包时，先创建请求计划；1–2 包仍按单批串行设计且不得创建测试子智能体。计划会机器生成 `agentWorkOrders`：每个功能包恰好一个工作单，按 `designBatches` 最多同时处理 3 包。工作单只允许绑定功能包，不接受页面、组件、上行/下行规则或源码文件作为任务粒度；设计、探索、脚本和排错均复用同一工作单。

```bash
npm run request:plan -- --report-id product-flow-001 \
  --pack testpacks/web/open-platform/create-product \
  --pack testpacks/web/open-platform/product-basic \
  --pack testpacks/web/open-platform/product-function
# 查看候选后，确认有效依赖；格式：上游包路径:下游包路径
npm run request:plan -- --report-id product-flow-001 \
  --pack testpacks/web/open-platform/create-product \
  --pack testpacks/web/open-platform/product-basic \
  --pack testpacks/web/open-platform/product-function \
  --confirm web/open-platform/create-product:web/open-platform/product-basic \
  --confirm web/open-platform/create-product:web/open-platform/product-function
npm run request:reduce -- --plan testpacks/web/open-platform/artifacts/current/product-flow-001/request-plan.json
npm run request:dispatch -- --plan testpacks/web/open-platform/artifacts/current/product-flow-001/request-plan.json
```

命令会从所选脚本读取跨包 `runtime/generated-data.json` 的事实并生成 `pending_confirmation` 候选；需求、源码和 `experience/<project>.md` 中识别的其他业务依赖也必须写为候选并确认，不能凭关键词静默决定。未确认候选、循环依赖、遗漏上游包、非法工作单和范围审计失败都会阻断 Reduce 与计划执行。`npm run request:dispatch` 只输出已审计的功能包工作单，供上层调度器分派；真实 ID 不写入计划，继续由上游包运行成功后的台账提供。

工作单进入探索、脚本或排错阶段前，先做阶段校验；例如：

```bash
npm run request:assert-work-order -- \
  --plan testpacks/web/open-platform/artifacts/current/product-flow-001/request-plan.json \
  --pack web/open-platform/create-product \
  --work-order WO-B1-01 \
  --stage script_authoring
```

允许阶段固定为 `case_design`、`page_exploration`、`script_authoring`、`failure_diagnosis`；工作单与功能包不匹配、组件级任务或越界上下文均拒绝。

用例表（`cases.md`）的分层格式与模板以 `skills/testcase-designer/SKILL.md`「输出格式（cases.md 模板）」为定义正本——顶部声明（测试类型/默认环境/默认数据策略、上下文来源与结论）、五列快速索引、折叠详情与“数据编号、步骤、操作、测试数据、预期结果”五列表格均在其模板中定义，本文件不重复维护模板；步骤表每行只描述一个操作和一个可观察预期。用例范围完整性按同一 SKILL.md「工作流——划定范围（七类提取）」逐类核对，不得只写主流程；范围外场景在用例表头部显式声明理由。

### Excel 审核工作簿

用例文件生成且范围契约通过后，必须导出 Excel 审核工作簿，不能以对话 Markdown 表替代。工作簿固定四张工作表，审核者先看“范围矩阵”：

| 工作表 | 固定内容 |
| --- | --- |
| `说明` | 功能名称、测试类型、默认环境、默认数据策略、用例总数、P0 数量、高风险数量、审核说明和用例文件路径。 |
| `范围矩阵` | 类别、对象、依据、归宿、关联用例、范围外理由；范围契约追加组合策略摘要五列：组合策略、有效组合数、组合模型、数据编号、人工补充。先审核这一页。 |
| `用例索引` | `模块、用例编号、用例标题、优先级、风险`；冻结表头便于审核。 |
| `用例详情` | `模块、用例、优先级、风险、RULE / 差异、前置条件、数据编号、步骤 / 操作、测试数据、预期结果`；按每个执行步骤展开一行。快速通道不维护 RULE 时，在“RULE / 差异”填写是否写入数据与脚本状态。 |

审核工作簿必须由 `scripts/build-testcase-review-workbook.mjs` 生成，输出到 `testpacks/<type>/<project>/<feature>/review/<review-id>/`，不提交 Git。用户确认前，不得发送验证码、登录、提交注册或执行其他外部写操作。用户确认后，先重新运行上下文加载命令，复核资料、环境、写入风险和已审核用例仍一致；随后才使用 MCP 按审核工作簿逐条探索真实页面——Chrome DevTools MCP 做只读探索、快照与排错（写操作被策略文件禁止，探索不得代行写操作），需要生成定位代码时辅以 Playwright MCP，工具分工见「MCP 接入」。页面事实与用例不一致时，先更新用例表并重新导出审核工作簿，再编写脚本。

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

### 用例-脚本完整性检查

`npm run test:fast` 在健康探测之后、执行之前先运行 `scripts/audit-case-completeness.mjs`，再运行 `scripts/audit-case-coverage.mjs`；两者均不可被环境变量跳过，任一缺口即非零退出、不启动 Playwright。前者校验 `scope.json` 七类契约与组合设计（见「组合设计门禁」）；后者做 cases.md 用例 ID ↔ spec 覆盖锚点的双向比对。也可单独运行：`node scripts/audit-case-completeness.mjs [功能包目录 ...]`、`node scripts/audit-case-coverage.mjs [功能包目录 ...]`。

### 组合设计门禁

每个功能包的 `scope.json` 中，每个范围对象声明 `combinationDesign`——策略及理由、参数与等价类取值依据、业务约束、有效组合数；pairwise 另含模型路径、模型摘要、生成的 D 编号范围与人工补充。触发规则统一（方法正本见 `skills/testcase-designer`「组合触发判定」）：

- 参数间无交叉影响：`not_applicable`；
- 参数 ≤ 2 个，或按业务约束过滤后的有效组合 ≤ 12 条：`direct_enumeration`；
- 参数 ≥ 3 个且有效组合 > 12 条：`pairwise`，必须建模并生成 `D01…` 数据映射。

完整性审计、Excel 导出与 `npm run test:fast` 都会阻断缺失或错误的判定；审计还会重放 pairwise 模型，模型缺失、摘要不一致、有效组合数不符、覆盖校验失败或 D 编号未落入 `cases.md` 均为失败。pairwise 只覆盖两两交互：高风险、写入与多负向叠加组合必须以 `manualSupplementCaseIds` 显式补充（只读 pairwise 对象可给 `manualSupplementReason` 范围外理由），C07 写入对象一律列出人工补充用例。模型保存在功能包 `runtime/pairwise/`（不入 Git），路径、摘要与 D 编号映射写入可提交的 `scope.json`。

### 报告证据

快速通道按一次用户请求生成一份可提交的 `test-reports/<标识>.md`。多包请求使用 `npm run test:fast -- --request-plan <request-plan.json> <多个功能包脚本>`；运行器校验功能包集合、已确认依赖与计划顺序后仍逐包执行。未使用请求计划时可继续用 `--report-id <标识>`。同一标识的复测或补测会合并更新 Markdown：保留此前已执行用例，更新最终状态与执行次数；Markdown 内嵌最小机器数据，只用于下一轮合并。

修复脚本后运行 `npm run test:fast:repair -- --report-id <标识>`。它从该报告的机器数据取出失败、非通过和未执行用例，递归补齐 `execution.json` 中的同包前置用例，再以 `--grep` 精确复测；复测失败立即结束。复测全部通过后，运行器依据报告中已确认的跨包依赖，全量回归命中功能包及其下游包。首次使用必须先用普通 `test:fast` 完整执行一次建立报告基线；旧报告仍可阅读，但不能作为局部复测来源。

Allure 原始结果、HTML、Trace、视频与截图存在公共目录的 `artifacts/current/<report-id>/`，但请求级明细始终是最终聚合：首次全量写入全部用例，补测只替换命中用例；通过补测会删除该用例此前失败的诊断材料，最终失败才保留其最后一次 Trace、视频和截图。中间 attempt 在合并后立即删除。每个请求结束后，运行器会把其最终结果复制到 `testpacks/artifacts/allure-dashboard/` 的共享首页输入池，重建首页并复用该目录唯一的 `report-server.json` 服务。

共享首页展示规则（生成器必须遵守）：

- 标题固定为“开放平台自动化测试报告（最近 5 个请求）”。
- 每条用例只使用四层：`执行日期：YYYY-MM-DD / report-id / 业务模块 / 业务场景`。必须剔除工程根目录、平台目录、功能目录、`.spec.ts` 文件名及其他技术路径；业务模块或场景已有的自然层级可以保留。
- 执行日期优先取 `manifest.finishedAt`，其次 `manifest.startedAt`，绝不从 report-id 推断。因此 `product-edit-chain-20260910` 在 2026-09-14 实际执行时，应归入“执行日期：2026-09-14”。
- 首页结果池按完成时间只保留最新 5 个请求；同一 report-id 的补测替换旧结果。`allure-history.jsonl` 独立保留最新 50 次请求完成快照，不含媒体；被展示池淘汰的请求不会令其历史快照失效。

合并与重建由锁串行保护，所以并行测试即使同时结束也不会相互覆盖。请求级临时目录可在后续请求启动时正常回收，不影响已复制到共享首页的结果。`npm run report:allure -- --report-id <标识> --pack <功能包> [--pack <功能包> ...]` 仍可单独启动并输出该请求完整最终 Allure 的本地链接。Allure 3 的 `runtime/allure-history/<report-id>.jsonl` 独立保留该请求最近 20 次紧凑历史，不包含媒体。`npm run report:request -- <标识>` 输出长期 Markdown 路径。同一标识被另一运行占用时会直接失败，避免并发复测写坏同一份 Markdown 报告。截图、视频、Trace 和报告不得包含真实密码、Token、密钥、Cookie 或其他可复用凭据；对外分享前必须人工检查媒体内容。

### 提示类断言（规则正本）

字段校验、后端拒绝等场景执行"行为成立即通过 + 文案差异记录"：动作前收集基线提示快照、动作后只捕获新出现提示（关键词子串宽匹配），文案一致打日志、差异以"文案差异"注解写入报告，不得以提示文案精确匹配作为通过条件；捕获等待用单次竞速（跳转 / role=alert / toast 谁先出现处理谁），预期出现提示时未出现即秒级失败并说明，预期无提示场景以短窗口未出现为通过。竞速返回的结果只是捕获而非通过依据，须再与用例预期终态比对（语义关键词 / 跳转 URL / 字段相关性），无关提示不得作为通过依据。仅文案本身是被测对象时（字数计数器、maxlength 截断值）才精确断言。

### 数据写入与台账（机制正本）

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

JSON 形态的通用配置（在这些 harness 中初始化时均为该结构；chrome-devtools 的启动参数必须带全策略要求的 5 项，缺参即为违规实例）：

```json
{
  "mcpServers": {
    "chrome-devtools": { "command": "npx", "args": ["-y", "chrome-devtools-mcp@1.6.0", "--no-usage-statistics", "--no-performance-crux", "--redact-network-headers=true", "--category-performance=false", "--category-emulation=false"] },
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--codegen", "typescript"] }
  }
}
```

无论哪种 harness，被验证的定位与步骤最终固化到功能包 `*.spec.ts`，由 `npm run test:fast` 重复执行。

**MCP 缺失时先询问**：开始探索或排错前，先确认当前环境里工程所需的 MCP 是否可用；不可用时应主动询问用户是否需要帮忙安装或接入（按本节口径配置），经用户确认后才允许降级到无头 Playwright 等替代手段，不得默认跳过 MCP。

本节是 MCP 接入的事实正本；各 harness 目录下的配置（如 `.codex/config.toml`，属其固定读取路径）只是照抄本节的薄实例，调整服务或参数时先改本节（含策略文件），再同步各实例。
