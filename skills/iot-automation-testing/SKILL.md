---
name: iot-automation-testing
description: 在本仓库中规划、设计、维护或分析 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。
---

<!-- role: orchestration-only -->

# IoT 自动化测试工作流

本 Skill 只定义读取顺序、命令编排和 reviewer 提示卡。安全边界、生命周期、测试设计、环境、定位和报告规则分别引用其唯一责任文件，不在此复制正文。

## 读取顺序

1. 读取 `AGENTS.md`、`.local/testing-memory.md`（如存在）和当前请求的 `workflow-history.ndjson`（如存在）。
2. 确定 `suiteId=<type/project/feature>` 与 `runRequestId=<type/project/request>`；无法唯一确定时只询问最小必要信息。
3. 有同一 `runRequestId` history：运行 `task:resume`，按固定 definition 恢复，不重评 suite、不迁移 v5/v6。
4. 无 history：先运行 `test:suite:assess`，再以 `--reuse auto` 初始化 v7。
5. 需要设计时，先扫描 `sources/manifest.yaml` 和受控章节索引，只读取命中资料；再按需选择 `test-assets/manifest.yaml` 中的静态资产。
6. 按任务读取唯一责任规范：

   - 生命周期和恢复：[automation-guideline.md](../../docs/testing/automation-guideline.md)
   - 设计、用例和评审：[testcase-guideline.md](../../docs/testing/testcase-guideline.md)
   - 环境和数据：[environment-guideline.md](../../docs/testing/environment-guideline.md)
   - selector：[selector-guideline.md](../../docs/testing/selector-guideline.md)
   - 报告和失败：[report-guideline.md](../../docs/testing/report-guideline.md)、[failure-classification.md](../../docs/testing/failure-classification.md)

独立清理、重置、归档或数据恢复请求先读 `package.json` 和 `scripts/README.md`，只使用登记命令；不进入测试 workflow。

## 初始化与分支

```bash
npm run test:suite:assess -- --suite <suiteId> --environment <test|pre> [--profile <profile>]
npm run task:initialize -- --request <runRequestId> --suite <suiteId> --reuse auto --environment <env>
npm run task:resume -- --request <runRequestId>
```

- `direct_execute`：`suite-validation → readiness → authorization → run → report`，不生成或确认设计。
- `affected_rebuild`：只处理评估给出的 affected 引用，完成定向评审后确认受影响用例，再 `build → readiness`。全局边界变化回退 `full_replan`。
- `full_replan`：使用模板创建内部设计索引和用例；校验、评审收敛后只请求一次完整用例确认。

用例确认后才读取 `.local/repositories/`、Graphify 和源码，并把实现映射写入同一 `plan.md`。用例确认不代替执行清单确认。

## Activity 命令编排

公开入口只有 `task:initialize`、`task:resume`、`task:status`、`task:gate` 和 `task:manage`。

1. 从 gate 读取 `readyActivities`，用稳定 owner 执行 `activity-start`。
2. 文件先写 runtime 暂存区；完成对应门禁后原子发布。最终文件 digest 匹配才关闭 Activity。
3. callback 决定只向候选 `plan.md` 追加同 subject 的正式决定行，再执行 `callback-resolve --plan-source`。
4. 每次状态变化后重新运行 gate；`continue_now` 在当前回合继续，`await_event` 等待已登记事件，`wait_user` 才请求用户动作。
5. `run/report` 使用 formal completion 专用入口，不使用普通 `activity-succeed`。

请求用户动作、结束工作回合或输出完成/失败前运行：

```bash
npm run task:gate -- --request <runRequestId> --assert-safe-reply
```

文件门禁：

```bash
npm run check:markdown -- <变更 Markdown 路径>
npm run testcases:sync-relations -- --check <请求目录>
npm run check:rule-design -- <请求目录>/plan.md
npm run check:architecture
```

## v7 设计推进顺序

1. `source-selection`：登记本轮实际来源。
2. `plan-validation`：发布 `test-design-index-v2`，不请求计划确认。
3. `case-generation-*`：生成 `testcase-v2` 用例包。
4. `relation-sync` 与 `completeness-validation`：一次关闭结构、来源、规则和双向关系问题。
5. 按 definition 中的 review Activity 派发真实隔离 reviewer；自动演进后只复审受影响引用。
6. `case-confirmation`：只使用 `accepted / revision_requested / cancelled`。修订后自动回到相应设计分支并重新提交同一种确认。
7. `build → readiness → execution-authorization → run → report`。

## v7 定位修复命令编排

1. `execution-run-finalize` 显示全部 terminal unknown 都是可修复定位 incident 时，执行 `npm run task:resume -- --request <runRequestId>`；它自动回退并应用补丁，最终停在新的执行清单确认。
2. 指定 incident 处理时使用 `npm run task:manage -- execution-scope-reopen --request <runRequestId> --selector-repair <incident-path>`；不另建修复命令或手改 history。
3. 回退后按 gate 依次推进 `build → readiness → execution-authorization`；用例确认保持原结果，新的执行清单仍由用户决定。
4. `direct_execute` 遇到定位漂移时创建 `affected_rebuild`，不在稳定 suite 中修改脚本。

## 用例 reviewer 提示卡

只为 definition 声明的 reviewer Activity 创建真实、只读、隔离子 Agent。输入只包含冻结来源、当前设计索引、角色 scope 内用例和确定性门禁摘要；不提供作者推理或其他 reviewer 结论。

| 角色 | 允许输入 | 检查重点 | 固定输出 |
| --- | --- | --- | --- |
| `combined` | 引用来源、设计索引、standard/strict 用例 | 需求忠实性、原子性、边界、状态、`REQ ↔ RULE ↔ caseId` | 发现编号、证据、受影响引用、严重度、处置和结论 |
| `impact` | 安全来源、strict 用例、共享安全邻域 | 数据写入、OTP、权限、安全挑战、设备、cleanup、未知结果 | 发现编号、证据、受影响引用、严重度、处置和结论 |

`deterministic_only` 不创建 reviewer Activity 或伪造提交。宿主 reviewer 任务标识只写 runtime。角色适用性和收敛标准见[用例规范](../../docs/testing/testcase-guideline.md#510-用例集评审与草案演进)，运行和恢复见[流程规范](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)。

## 脚本 reviewer 提示卡

| 角色 | 检查重点 |
| --- | --- |
| `script_quality` | `caseId` 映射、业务步骤落地、selector/API 契约、断言、失败边界和可维护性 |
| `execution_safety` | 清单授权、真实写入面、操作预算、结果证据、敏感信息、cleanup 和 reconciliation |

所有脚本先通过确定性编译、source gate、敏感字面量和 manifest 检查；静态失败不交给 reviewer 猜测修复。风险分级只改变 reviewer 范围，不改变用户确认数量。

## 资源

| 测试类型 | 技术与模板 |
| --- | --- |
| 设计索引与用例 | `templates/test-plan.template.md`、`templates/testcase.template.md` |
| Web/H5 | Playwright；`templates/playwright.spec.template.ts`、`templates/formal-execution-manifest.template.ts` |
| 原生 App/WebView | Appium + WebdriverIO；`templates/appium.spec.template.ts` |
| API | TypeScript API Client；复用 `src/clients/` 与 `tests/api/` |
| MQTT/IoT 链路 | mqtt.js 与组合 Runner；`templates/iot-chain.spec.template.ts` |

`templates/` 只提供结构，`examples/` 只作参考；都不是业务事实或已验证资产。
