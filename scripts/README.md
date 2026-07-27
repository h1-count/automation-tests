# 工程脚本

`scripts/` 存放不属于具体测试用例的工程脚本，例如环境检查、认证初始化、测试数据准备/清理和报告生成。

| 脚本类别 | 职责 |
| --- | --- |
| 认证初始化 | 创建本机受控认证会话，例如 `capture-open-platform-auth-state.ts`。 |
| 环境检查 | `check-environment.ts`：无参数时执行完整本地预检；`--plan [--asset <assetId>]` 检查目标环境、开放平台测试账号引用、认证会话与已选静态资产的脱敏状态。计划模式中 Appium、设备、包名和 Activity 缺失只标记工程待验证，不阻塞计划或用例生成；两种模式均不访问业务服务或输出敏感值。 |
| 静态资产 | `check-test-assets.ts` 校验 `test-assets/manifest.yaml`、文件路径和 SHA-256；`select-test-asset.ts` 按项目、类型、平台和范围选择唯一 `active` 候选，不按文件名或时间猜测。 |
| Markdown 格式门禁 | `npm run check:markdown -- <仓库内 Markdown 路径>` 校验实际文件的表头、分隔行、数据行列数及字面量换行；仅分隔行列数错误可加 `--fix` 确定性修复，数据行或正文问题必须修订生成内容后复检。 |
| Web 受控探索 | `test:web:inspect -- <spec>` 启动可见 Chrome 与 Inspector；`test:web:explore:reuse:inspect -- <spec>` 连接由 `playwright:explore-session start/status/stop` 管理的会话；`test:web:explore -- <spec>` 执行可见确定性重放。配置只发现非 `*.formal.spec.ts` 脚本，不保留正式结果产物。 |
| Web 正式执行 | `npm run test:web:execute -- --request <type/project/request>` 执行清单绑定的完整范围；`--resume` 恢复同一授权运行。其他参数、文件路径和 `--grep` 被拒绝。输出为 Playwright/Allure 原始结果及 `artifacts/test-results/formal/<摘要>/formal-case-results.{json,md}`。 |
| 本机台账恢复 | `npm run test-data:recover`：只遍历 `.local/test-ledger/` 中本机、当前项目、指定非生产环境且归属明确的资源；未注册清理动作或风险不明时只标记人工处理，不扫描业务数据。它只用于恢复，不是清理或重置命令。 |
| 本机任务进度 | 初始化：`task:initialize`；查询：`task:gate --json`、`task:resume`；领取与租约：`transaction-claim --owner`、`transaction-renew --claim`；完成或异常：`transaction-commit --claim`、`transaction-retry --claim`、`transaction-block --claim`、`transaction-resolve`；确认：`task:confirm-plan`、`transaction-confirm-request`、`transaction-confirm`；执行范围：`execution-authorization-request`、`execution-scope-reopen`；宿主：`host-bind`、`host-block`、`host-update`、`wake-list`、`wake-dispatch`、`wake-fail`；评审：`review-transaction-start`、`review-agent-start`、`review-agent-submit`、`review-transaction-reconcile`、`review-transaction-evolve`、`review-transaction-finalize`。参数由 `--help` 与流程规范定义。 |
| 项目经验候选 | `npm run knowledge:manage -- candidate-add --project <project> ...` 登记本地候选；`candidate-promote` 在受控探索或正式执行验证后写入同项目经验库并标记候选已提升；`experience-add` 可直接写入已验证经验；`candidate-abandon` 与 `candidate-reconcile` 用于复盘。候选队列位于 Git 忽略的 `.local/project-knowledge-candidates/`，不得存放敏感信息或需求事实。 |
| 完整测试状态重置 | `reset-full-test-state.ts` 是“完整重置 / 清除所有测试数据 / 从头测试”的唯一入口。先运行 `npm run reset:full-test-state -- --dry-run` 查看范围；用户确认完整范围后再运行正式命令。它清理 `artifacts/`、根目录遗留的 `allure-results/`、已清理本机台账资源和 `.auth/`，再将未处理的 `.local/test-ledger/`、旧 `.local/test-data/` 只读证据、与活跃请求关联的 `.local/test-task-state/`、活跃测试请求，以及 `tests/<type>/<project>/<request>/` 下的请求专属测试脚本归档；无关联任务状态只读归档，不会删除远端业务数据。`scripts/`、`src/actions/`、`src/clients/`、`src/fixtures/`、`src/support/`、`tests/support/` 和 `tests/` 下划线开头的目录统一视为共享基础能力，不进入归档候选；同时保留 sources、test-assets、项目测试经验、用户偏好、环境基础设施、代码仓库和已有归档。 |
| 报告脚本 | 聚合或转换 Runner 产生的报告。 |

脚本命令入口由 `package.json` 维护；新增命令时必须同步新增对应脚本和说明。
