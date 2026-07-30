# 工程脚本

`scripts/` 存放不属于具体测试用例的工程脚本，例如环境检查、认证初始化、测试数据准备/清理和报告生成。

| 脚本类别 | 职责 |
| --- | --- |
| 认证初始化 | 创建本机受控认证会话，例如 `capture-open-platform-auth-state.ts`。 |
| 环境检查 | `check-environment.ts`：无参数时执行完整本地预检；`--plan [--asset <assetId>]` 检查目标环境、开放平台测试账号引用、认证会话与已选静态资产的脱敏状态。计划模式中 Appium、设备、包名和 Activity 缺失只标记工程待验证，不阻塞计划或用例生成；两种模式均不访问业务服务或输出敏感值。 |
| 静态资产 | `check-test-assets.ts` 校验 `test-assets/manifest.yaml`、文件路径和 SHA-256；`select-test-asset.ts` 按项目、类型、平台和范围选择唯一 `active` 候选，不按文件名或时间猜测。 |
| Markdown 格式门禁 | `npm run check:markdown -- <仓库内 Markdown 路径>` 校验实际文件的表头、分隔行、数据行列数及字面量换行；仅分隔行列数错误可加 `--fix` 确定性修复，数据行或正文问题必须修订生成内容后复检。 |
| 用例关系同步 | `npm run testcases:sync-relations -- <runtime 暂存请求目录>` 只更新暂存的 `REQ → RULE → caseId` 派生视图，再由工作流原子发布；`--check <最终请求目录>` 仅验证最终文件，不写入。 |
| Web 受控探索 | 存在页面语义、状态变化、定位稳定性或证据不足风险时，使用 `test:web:inspect -- <spec>` 启动可见 Chrome 与 Inspector；需要复用现场时使用 `test:web:explore:reuse:inspect -- <spec>`；`test:web:explore -- <spec>` 执行可见确定性重放。配置只发现非 `*.formal.spec.ts` 脚本，不保留正式结果产物。 |
| Web 正式执行 | `npm run test:web:execute -- --request <type/project/request>` 执行清单绑定的完整范围；`--resume` 恢复同一授权运行。其他参数、文件路径和 `--grep` 被拒绝。输出为 Playwright/Allure 原始结果及 `artifacts/test-results/formal/<摘要>/formal-case-results.{json,md}`。 |
| 本机台账恢复 | `npm run test-data:recover`：只遍历 `.local/test-ledger/` 中本机、当前项目、指定非生产环境且归属明确的资源；未注册清理动作或风险不明时只标记人工处理，不扫描业务数据。它只用于恢复，不是清理或重置命令。 |
| Durable Workflow | 请求目录中的 `workflow-history.ndjson` 是唯一运行事实；`.local/test-task-runtime/` 只保存可丢弃的租约、session/reviewer 绑定和暂存引用，不保存 Goal 状态。公开入口只有 `task:initialize`、`task:resume`、`task:status`、`task:gate` 和 `task:manage`；Activity、callback、阻塞、恢复、核对和 history 校验均通过 `task:manage` 子命令执行。`task:resume` 会清理失效 runtime 绑定，并通过 gate 暴露需要宿主补建的 reviewer 绑定；补建复用 `reviewer-dispatch`，不提供独立 `reviewer-bind` 入口。请求用户动作、结束当前测试工作回合或输出完成/失败结论前使用 `task:gate --assert-safe-reply`；用户主动索要状态时仅可复述只读 gate/status 投影。参数与 Gate v2 语义由流程规范和各命令 `--help` 定义。 |
| 项目经验候选 | `npm run knowledge:manage -- candidate-add --project <project> ...` 登记本地候选；`candidate-promote` 在受控探索或正式执行验证后写入同项目经验库并标记候选已提升；`experience-add` 可直接写入已验证经验；`candidate-abandon` 与 `candidate-reconcile` 用于复盘。候选队列位于 Git 忽略的 `.local/project-knowledge-candidates/`，不得存放敏感信息或需求事实。 |
| 完整测试状态重置 | `reset-full-test-state.ts` 是“完整重置 / 清除所有测试数据 / 从头测试”的唯一入口。先运行 `npm run reset:full-test-state -- --dry-run` 查看范围；用户确认完整范围后再运行正式命令。它清理运行产物、认证会话和可丢弃 runtime，将活跃请求连同 history 归档到 `testcases/archive/`，并把请求专属脚本放入对应归档请求的 `automation/` 子目录。未清理的外部资源台账必须先恢复或取得明确残留决定，不能被静默归档。共享能力、sources、test-assets、项目经验、用户偏好、代码仓库和已有正式历史不进入清理范围；规则测试入口为 `npm run test:maintenance`。 |
| 报告脚本 | 聚合或转换 Runner 产生的报告。 |

脚本命令入口由 `package.json` 维护；新增命令时必须同步新增对应脚本和说明。
