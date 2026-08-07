# IoT 自动化测试工程

本项目用于 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。

## 从这里开始

1. 阅读 [AGENTS.md](./AGENTS.md) 了解强制门禁与安全边界。
2. 阅读 [测试规范索引](./docs/testing/README.md)，按任务打开唯一责任规范。
3. 复制 `.env.example` 为本地 `.env`，填写当前环境所需的非公开配置。
4. 提供需求、URL、截图、接口资料或物模型；AI 测试 Agent 会先输出测试计划，确认后再进入用例、脚本和执行。

工程按“业务层 → 工程层 → 治理线”推进；完整流程、Graphify 定位和审核门禁以 [automation-guideline.md](./docs/testing/automation-guideline.md#32-双层模型与贯穿治理线) 为准。

## 文档职责

| 需要了解的内容 | 查看位置 |
| --- | --- |
| 强制门禁与安全边界 | [AGENTS.md](./AGENTS.md) |
| 工程架构、组件与数据流 | [architecture-design.md](./docs/architecture-design.md) |
| 生命周期、统一执行清单与人工挑战恢复 | [automation-guideline.md](./docs/testing/automation-guideline.md) |
| 环境、运行模式、账号、验证码和测试数据 | [environment-guideline.md](./docs/testing/environment-guideline.md) |
| 测试计划与用例格式 | [testcase-guideline.md](./docs/testing/testcase-guideline.md) |
| selector、报告、失败分类 | [docs/testing/](./docs/testing/README.md) |
| Agent 执行步骤、模板和示例 | [SKILL.md](./skills/iot-automation-testing/SKILL.md) |

规则正文只在责任文件维护；本 README 只提供使用入口和命令。

## 本地配置

真实地址、账号、密码、Token、设备标识和认证会话只能保存于本地 `.env`、CI Secret 或受控的 Git 忽略目录，不能提交到 Git。

环境通过 `TEST_ENV` 切换，无需修改测试脚本的 `baseURL`：

```env
TEST_ENV=test
ALLOW_PRODUCTION_TESTS=false
```

完整变量说明见 [.env.example](./.env.example)，环境选择和生产保护见 [environment-guideline.md](./docs/testing/environment-guideline.md)。

## 常用命令

```bash
# 环境检查
npm run check:environment

# 测试计划阶段的安全环境预检：只输出脱敏配置状态
npm run check:environment -- --plan

# 校验与选择纳入 Git 的静态测试资产；不会安装或执行 App
npm run check:test-assets
npm run test-assets:select -- --project lazy-cat --kind app-package --platform android --scope login-register
npm run check:environment -- --plan --asset lazy-cat-android-dev-1-0-1

# 架构与目录约束检查
npm run check:architecture

# 对刚生成或更新的实际 Markdown 文件做格式门禁；仅分隔行列数错误可加 --fix 后复检
npm run check:markdown -- testcases/<type>/<project>/<request>/plan.md

# 原始资料与章节索引一致性检查
npm run check:knowledge-index

# 完整重置 / 清除所有测试数据 / 从头测试：先预演，确认完整范围后再执行
npm run reset:full-test-state -- --dry-run
npm run reset:full-test-state
# 验证重置与统一归档规则（不访问业务系统）
npm run test:maintenance

# 仅恢复本机已登记的 test 环境资源；不扫描业务数据
npm run test-data:recover

# 验证本机台账能力（使用模拟清理适配器，不访问业务系统）
npm run test:test-data

# 初始化或查看 Durable Workflow（history 纳入 Git；runtime 可丢弃）
npm run task:initialize -- --request web/<project>/<test-request> --plan testcases/web/<project>/<test-request>/plan.md
npm run task:status -- --request web/<project>/<test-request>
npm run task:gate -- --request web/<project>/<test-request> --json
# 仅在请求用户动作、结束当前测试工作回合或输出完成/失败结论前断言
npm run task:gate -- --request web/<project>/<test-request> --assert-safe-reply
npm run task:resume -- --request web/<project>/<test-request>
npm run task:manage -- --help

# 按范围与关键词检索开放平台章节（不读取全部原文）
npm run knowledge:search -- --project open-platform --scope account-login --query '账号登录 企业成员'

# Web 普通回归与 Chrome 兼容性执行
npm run test:web
npm run test:web:chrome

# Web explore：可见、零业务写入，只发现非 formal 脚本
npm run test:web:explore -- tests/web/<project>/<request>/<file>.spec.ts

# Web execute：需要已确认的不可变执行清单，只发现 formal 脚本并运行 setup/test/teardown
npm run test:web:execute -- --request web/<project>/<request>
# 同一授权中断恢复
npm run test:web:execute -- --request web/<project>/<request> --resume

# 跨失败/重试复用隔离 Chrome（仅本机受控探索，非正式回归）
npm run playwright:explore-session -- start
npm run test:web:explore:reuse -- tests/web/<project>/<request>/<file>.spec.ts
# 在同一会话中打开 Playwright Inspector 并单步查看定位器
npm run test:web:explore:reuse:inspect -- tests/web/<project>/<request>/<file>.spec.ts
npm run playwright:explore-session -- status
npm run playwright:explore-session -- stop

# Web Inspector 单步入口：仅在需要逐步查看时使用
npm run test:web:debug -- tests/web/<project>/<request>/<file>.spec.ts
npm run test:web:inspect -- tests/web/<project>/<request>/<file>.spec.ts

# 已登录 Web 测试：先按环境规范初始化本地会话
npm run auth:open-platform:initialize
npm run test:web:authenticated

# App、API、IoT 链路：对应类型的已确认脚本创建后使用
npm run test:app
npm run test:api
npm run test:iot-chain

# 报告
npm run report:playwright
npm run report:allure
```

创建新测试时，先按 `plan.md → 用例确认 → 工程设计与脚本评审 → 统一执行清单` 门禁生成资产，再使用对应 Runner。

完整自动化测试请求按[生命周期规范](docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)使用仓库 Durable Workflow 作为唯一事实源；宿主若提供长期任务或停止事件能力，只作为可选续跑适配，不写入仓库，也不扩大测试授权。任何宿主适配器都必须先在受信任工作区完成路径、文件摘要和权限检查；不能把适配器配置存在视为后台续跑保证。

## 目录概览

```text
automation-tests/
├── AGENTS.md                  # 强制门禁与安全边界
├── docs/testing/              # 每个主题的唯一规则文件
├── skills/iot-automation-testing/ # Agent 工作流、模板与示例
├── sources/                   # 原始测试资料
├── test-assets/               # 可复用静态测试资产
├── testcases/                 # 计划、结构化用例与请求级 workflow-history.ndjson
├── tests/                     # 可执行测试脚本
├── src/                       # action、client、fixture、env、support
├── scripts/                   # 工程脚本
├── artifacts/                 # Git 忽略的执行产物
├── .auth/                     # Git 忽略的本地认证会话
└── .local/                    # Git 忽略的本机元数据、偏好与台账；不是 workflow 事实源
    ├── repositories/          # 本机被测代码仓库
    ├── project-knowledge-candidates/ # 项目经验的待验证控制元数据（正文已同步入 Git 经验库）
    ├── test-task-runtime/     # 可丢弃的租约、session/reviewer 绑定与暂存引用；不保存宿主长期任务状态
    ├── test-ledger/           # 测试运行与受管资源台账
    └── testing-memory.md      # 当前用户的长期协作偏好
```

各目录的完整职责、提交边界和敏感数据约束以 [AGENTS.md 的“目录边界”](./AGENTS.md#目录边界) 为准。
