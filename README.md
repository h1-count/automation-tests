# 自动化测试（快速通道）

唯一目标：快速编写并运行 Playwright 自动化测试。

```bash
npm run test:fast
npm run test:fast:repair -- --report-id <请求报告标识>
npm run report:request -- <请求报告标识>
npm run report:allure -- --report-id <请求报告标识> --pack <功能包>
```

在 `.env` 设置 `TEST_ENV` 和对应的 Web 地址，或临时指定：

```bash
FAST_BASE_URL=https://open-platform-test.ikingcity.com/ npm run test:fast
```

新功能先创建 `testpacks/<type>/<project>/<feature>/` 功能测试包：在包内维护 `cases.md`，审核后编写同包的 `<feature>.spec.ts`，并更新 `conclusion.md`。长期结论归档为公共目录下、可提交的 `test-reports/<请求标识>.md`；当前请求的 Allure 保留全部用例的最终状态，补测只替换命中用例，最终失败才保留诊断媒体；下一次新请求会回收已完成的旧临时目录。

默认以有头浏览器运行。

编写或排查页面时，测试代理会按照已审核的用例表格使用 MCP 探索真实页面——Chrome DevTools MCP 做只读探索、快照与排错，需要生成定位代码时辅以 Playwright MCP（工具分工见 [docs/FAST-TRACK.md](./docs/FAST-TRACK.md)「MCP 接入」）；确认稳定后，把定位和步骤写进 Playwright 脚本，再通过 `npm run test:fast` 重复执行。

## 目录职责

| 目录 | 职责 | 是否提交 Git |
| --- | --- | --- |
| `sources/` | 知识库：原始资料及 `indexes/<project>.yaml` 导航索引 | 是 |
| `experience/` | 经验库：已验证的测试实践、项目页面范围与排错经验 | 是 |
| `testpacks/` | 按类型、平台、功能聚合的测试包；包含 `scope.json`、用例、脚本、结论和 `test-reports/`；本地目录为 `review/`、`artifacts/current/<请求标识>/`、`runtime/` | 是（本地目录不提交） |
| `src/` | 环境解析、测试数据台账记录等跨功能共享测试能力（含 `src/support/recordGeneratedData.ts`） | 是 |
| `skills/` | 技能包：可复用的任务指令与配套脚本（如 `testcase-designer` 用例设计） | 是 |

## 测试流程

1. 涉及 3 个及以上功能包时，先运行 `npm run request:plan -- --report-id <标识> --pack <功能包> ...`；确认候选依赖后运行 `npm run request:dispatch -- --plan <request-plan.json>`，只按输出的功能包工作单分派子智能体。1–2 包由主智能体串行处理。
2. 加载并阅读知识库与经验库：`node scripts/load-test-context.mjs --project <project> --scope <feature>` 会先归档 `.dsh-filess/<project>/` 的新资料、更新索引；随后读取索引和命中资料，确认需求、原型或其他测试依据，并默认选择 test 环境。
3. 运行 `node scripts/prepare-case-design.mjs --pack <功能包> --work-order <工作单编号>`，维护 `scope.json`（七类对象、依据、归宿）并通过范围审计；1–2 包省略 `--work-order`。
4. 在功能测试包生成 `cases.md`，记录实际读取的上下文来源及结论。
5. 从用例表和范围契约导出含“范围矩阵”的 Excel 审核工作簿，等待用户确认。
6. 重新加载上下文，按确认后的用例探索真实页面并更新 Playwright 脚本。
7. 运行 `npm run test:fast -- --request-plan <request-plan.json> <多个功能包脚本>`；执行仍串行，同一请求的复测/补测复用计划中的标识，最后用 `npm run report:request -- <请求报告标识>` 查看长期 Markdown，用 `npm run report:allure -- --report-id <请求报告标识> --pack <功能包>` 查看该请求的诊断明细。

脚本修复后使用 `npm run test:fast:repair -- --report-id <请求报告标识>`：先复测失败、未执行用例及其 `execution.json` 声明的同包前置；仅全部通过后，才自动全量回归受影响功能包和已确认依赖下游包。

详细用法见 [docs/FAST-TRACK.md](./docs/FAST-TRACK.md)。
