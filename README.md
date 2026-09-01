# 自动化测试（快速通道）

唯一目标：快速编写并运行 Playwright 自动化测试。

```bash
npm run test:fast
npm run report -- testpacks/web/open-platform/login-register/artifacts/report
```

在 `.env` 设置 `TEST_ENV` 和对应的 Web 地址，或临时指定：

```bash
FAST_BASE_URL=https://open-platform-test.ikingcity.com/ npm run test:fast
```

新功能先创建 `testpacks/<type>/<project>/<feature>/` 功能测试包：在包内维护 `cases.md`，审核后编写同包的 `<feature>.spec.ts`，并更新 `conclusion.md`。运行报告和失败 trace 也保存在同包的 `artifacts/`。

默认以有头浏览器运行。

编写或排查页面时，Codex 会按照已审核的用例表格使用 Chrome DevTools MCP 探索真实页面；确认稳定后，把定位和步骤写进 Playwright 脚本，再通过 `npm run test:fast` 重复执行。

## 目录职责

| 目录 | 职责 | 是否提交 Git |
| --- | --- | --- |
| `sources/` | 知识库：原始资料及 `indexes/<project>.yaml` 导航索引 | 是 |
| `experience/` | 经验库：已验证的测试实践、项目页面范围与排错经验 | 是 |
| `testpacks/` | 按类型、平台、功能聚合的测试包；包含用例、脚本、结论及本功能的 `review/`、`artifacts/`、`runtime/` | 是（后三者均不提交） |
| `src/` | 环境解析、测试数据台账记录等跨功能共享测试能力（含 `src/support/recordGeneratedData.ts`） | 是 |
| `skills/` | 技能包：可复用的任务指令与配套脚本（如 `testcase-designer` 用例设计） | 是 |

## 测试流程

1. 加载并阅读知识库与经验库：`node scripts/load-test-context.mjs --project <project> --scope <feature>` 会先归档 `.dsh-filess/<project>/` 的新资料、更新索引；随后读取索引和命中资料，确认需求、原型或其他测试依据，并默认选择 test 环境。
2. 在功能测试包生成 `cases.md`，记录实际读取的上下文来源及结论（用例设计遵循 `skills/testcase-designer/SKILL.md`，含参数组合设计与 pairwise 数据生成脚本）。
3. 从用例表导出同包 `review/` 下的 Excel 审核工作簿，等待用户确认；此时不发送验证码、不登录、不提交注册。
4. 重新加载上下文，确认资料、环境和写入风险未变化；按确认后的用例探索真实页面，在同包实现或更新 Playwright 脚本，并维护 `conclusion.md`。
5. 运行 `npm run test:fast`，检查对应功能包 `artifacts/report/` 和 `artifacts/results/`。

详细用法见 [docs/FAST-TRACK.md](./docs/FAST-TRACK.md)。
