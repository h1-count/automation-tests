# 自动化测试项目规则

## 适用范围与优先级

本仓库用于 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。

- 用户当前明确要求优先于本文件；涉及生产、数据写入、设备动作或安全挑战时，仍须遵守安全边界。
- 本文件只定义所有任务必须遵守的安全边界、事实所有权和最终回复门禁。流程细节、模板和专项规则以 `docs/testing/` 中的唯一责任文件为准，不在本文件重复维护。
- 规范唯一职责见[测试规范索引](docs/testing/README.md)，实际操作顺序见 [IoT 自动化测试 Skill](skills/iot-automation-testing/SKILL.md)。

## 事实所有权与回复门禁

- `plan.md` 唯一维护范围、需求依据、正式用户决定、reviewer 结论和发现项；请求目录中的 `workflow-history.ndjson` 唯一维护 Activity、重试、等待、阻塞、恢复和工作流终态。
- `.local/test-task-runtime/` 只保存可丢弃的宿主执行元数据；任务、阶段、整体进度和用例完整度必须从事件与真实产物计算，不能另行写入 `plan.md` 或本机状态文件。
- 已引用资料能够证明的缺口按[用例规范](docs/testing/testcase-guideline.md)自动修订和复审；资料未定义的行为不得作为通过/失败断言。
- 计划确认一旦 `accepted`，在顶层业务范围、测试类型与目标环境、高层数据写入类别和权限/安全上限不变时，必须贯穿后续用例生成、隔离评审、自动演进与复审。`plan.md` 正文、`REQ/RULE/caseId`、断言、追溯关系或 reviewer 记录的证据驱动变化不得单独触发重复计划确认；只有上述确认事项发生实质变化，或出现资料冲突、未定义验收，才允许请求计划修订或最小业务裁决。
- 完整自动化测试请求（新建或恢复，范围覆盖规划、评审、工程、执行、清理和报告）一旦确定稳定 `requestId`，若宿主提供跨回合长期任务能力，必须在执行 `task:initialize` 或 `task:resume` 前查询并创建或复用绑定同一 `requestId` 的宿主任务；发现宿主已有任务绑定不同请求或无法判定归属时，不得静默替换、清除或改写，必须请求最小用户选择。宿主没有等价能力时仍以 workflow history 继续，但不得声称已启用后台续跑。状态查询、只读诊断、规则或代码维护以及清理、重置、归档、恢复等独立维护请求不创建宿主长期任务。
- 完整请求的接管预检包括稳定 `requestId` 的最小解析和可用宿主能力检查；`requestId` 无法唯一确定时只请求最小必要信息。宿主长期任务能力不可用或调用失败不改变仓库工作流事实，也不得写入伪造的宿主状态；Agent 必须改用当前会话持续推进或显式 `task:resume` 恢复，并诚实说明不具备后台续跑保证。宿主生命周期适配、完成和阻塞规则见[流程规范](docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)。
- 存在 `continue_now` 的 Activity 时，Agent 必须在当前可用回合继续执行，不得要求用户发送“继续”或把它表述为后台已续跑。只有流程规范定义的人工决定、真实阻塞或显式挂起才能结束为 `action_required`；只有工作流终态才能结束为 `final`。
- 适用的 reviewer Activity 必须由 Skill 要求的真实只读子 Agent 执行；`review-policy-v2` 的 `deterministic_only` 不创建 reviewer Activity 或伪造 `ReviewerSubmitted`。宿主返回的 reviewer 任务标识只绑定 `.local/test-task-runtime/`，不得写入 history 或 `plan.md`；缺少、丢失或与主任务相同的绑定时保持非终态，主 Agent 不得分角色自评并提交 `ReviewerSubmitted`。
- 请求用户动作、结束当前测试工作回合或输出完成/失败结论前，必须运行 `npm run task:gate -- --request <type/project/request> --assert-safe-reply`。用户主动索要的只读状态答复可直接复述 gate/status 的已派生字段，但不得宣称完成、承诺后台续跑、重复索取已有决定或写入任何事件；完整语义只见[流程规范](docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)。

## 安全与数据边界

- 默认禁止生产环境访问和操作。生产测试必须经单独确认，并满足 [环境与测试数据规范](docs/testing/environment-guideline.md) 的保护条件。
- 禁止绕过、破解、模拟或伪造滑块、验证码、人机验证、权限控制和设备确认。安全挑战仅允许最小人工接管，后续确定性步骤由主 Agent 按同一工作流自动恢复。
- 禁止提交未获确认的业务数据，删除真实数据或设备，批量操作，修改配置，控制硬件、断网、刷固件或其他高风险设备动作。
- 禁止在代码、测试用例、日志、报告、截图、Trace、视频、Git 或回复中记录、回显或提交密码、验证码、Token、密钥、Cookie、会话、真实用户信息或敏感业务数据。
- 环境变量和敏感配置只能来自本地 `.env`、环境专用文件或 CI Secret；`.env.example` 只能保存变量名、非敏感样例和说明。
- 清理、重置、归档和恢复必须使用 `package.json` 与 `scripts/README.md` 登记的入口；范围不明确时只允许 `--dry-run`。完整重置使用 `npm run reset:full-test-state`，未处理台账、预演范围冲突或命令失败时必须停止，不能手工扩大删除范围。
- 所有正式变更必须可审查；不得自动合并、发布或扩大已确认的测试范围。
- 候选脚本完整性与执行可用性必须分离：有源码/状态契约依据的写入步骤可在 `build` 生成但未授权执行；部署、OTP、provider、预算和清理能力只在 `readiness` 决定 runnable/deferred。禁止用空 callback、固定 blocker 或仅 capability 检查冒充完整候选脚本。
- 同一授权内的用例顺序只能由 manifest 的命名资源生产/消费契约推导。生产者第一阶段可启动时，其消费者必须进入同一执行清单的后续拓扑波次，不得因执行前尚无资源而延期；Runner 不得依赖 caseId、文件名、Playwright discovery 顺序或偶然残留决定先后。
- 纳入 Git 且登记在 `test-assets/manifest.yaml` 的静态测试资产、其 SHA-256 以及本地确定性生成器属于 `buildEvidence`，不得建模为环境 Capability 或要求 `.env` 重复指定资产。资产缺失、非 active、项目/平台/范围不匹配或摘要漂移属于 `invalid build`；只有账号、OTP、远端 fixture、外部状态和 adapter 等真实运行依赖才能使 case `deferred`。
- 已确认执行清单可授权 Runner 在非生产测试环境执行清单内的新增、修改、上传、提交和删除，不再逐项确认。明确创建并登记的唯一合成资源可在容量、基线、租约和退役策略约束下晋升为跨请求 `reusable_fixture`；不得自动发现、接管或复用系统中既有企业与真实数据。
- 写入结果按操作可判定性选择 `response_contract`、`response_with_query_fallback`、`response_then_query` 或 `query_only`；不得把所有写入一律绑定 `query_postcondition`，也不得仅凭 HTTP 2xx、页面提示、截图、视觉或 ARIA 宣称后端写入成功。结果未知时必须冻结同一 intent，禁止盲目重传。
- 用户可见的功能结果必须优先在正式脚本中直接使用 DOM/ARIA、文本、页面状态和已评审的浏览器响应判断，不得为此虚构 Capability Provider。只有定位、布局、图表或其他无法由稳定结构断言表达的可见结果，才允许截取不含敏感数据的最小局部图片交给宿主模型审查；该结论只证明 UI 呈现，不证明后端写入、短信送达或清理成功。清单引用未注册、无可调用实现的 Provider 属于 `invalid`，不得伪装为可等待的 `deferred`。

## 目录边界

- `sources/`：原始需求、接口、物模型、截图、原型、原始知识资料库及受控章节索引；用 `manifest.yaml` 维护原始资料与项目索引的来源、关联和有效性。
- `testcases/`：测试计划和结构化用例；`tests/`：可执行脚本，分类与用例一致。
- `src/actions/`：业务级公共动作；`src/clients/`：协议访问；`src/fixtures/`：测试引用与数据初始化；`src/env/`：环境解析；`src/support/`：断言、轮询、脱敏和清理。
- `scripts/`：环境检查、数据准备/清理、认证初始化和报告脚本；`artifacts/`：被 Git 忽略的执行产物。
- `test-assets/`：纳入 Git 的可复用静态测试资产，例如 App 安装包、测试固件和视觉基准；`test-assets/manifest.yaml` 是资产身份、完整性和可选择范围的唯一清单，不属于原始需求资料，也不混入 `sources/manifest.yaml`；不存放运行产物或敏感配置。
- `.auth/`：被 Git 忽略的本地认证会话。
- `.local/repositories/`：本机被测代码仓库根目录；每个直接子目录为一个候选仓库，不提交测试工程。仓库、Graphify 图谱和源码定位只在用例确认后的 `plan.md` 工程层记录，不得登记到 `sources/manifest.yaml` 或充当业务需求资料。
- `.local/testing-memory.md`：被 Git 忽略的当前用户长期协作与行为偏好，不记录项目测试经验。
- `.local/project-knowledge-candidates/`：被 Git 忽略的按项目候选队列，保存未验证但可复用的项目级观察；不得存放需求事实、正式评审正文、凭据或敏感数据。
- `testcases/<type>/<project>/<test-request>/workflow-history.ndjson`：纳入 Git 的请求级运行事件历史，是 Activity 完成、重试、等待、阻塞、恢复和工作流终态的唯一事实源；只保存可回放的脱敏语义事件，不保存凭据、线程标识、claim token、租约或真实用户数据。
- `.local/test-task-runtime/`：被 Git 忽略且可丢弃的本机执行元数据，只保存 claim/fencing、lease、session/reviewer 工具绑定、暂存路径和未收口工具句柄；任何宿主长期任务及其 ID、状态、预算和使用记录只属于对应宿主，不写入此目录、`plan.md` 或 workflow history。删除 runtime 不得改变或丢失业务状态。
- `.local/test-ledger/`：被 Git 忽略的本机测试数据台账；其创建、复用、清理与恢复规则由 `docs/testing/environment-guideline.md` 定义。
- `docs/testing/knowledge/<project>-testing-knowledge.md`：纳入 Git 的项目测试经验库；按被测项目分别维护。可复用策略一经形成就必须立即写入并标注“待验证 / 已验证”；同一适用范围的新经验原位更新当前条目，旧版由 Git 历史保留。经验库不替代或复制原始资料、正式规则、用例、报告或执行证据。
- `testcases/archive/`：纳入 Git 的只读历史测试证据；请求专属历史脚本统一放在对应归档请求的 `automation/` 子目录，不另建平行归档根。

## 提交信息规范

提交信息使用 `type(scope): 中文描述` 格式（英文 type、英文 scope、中文描述），描述本次提交实际做了什么，避免空泛措辞。

- **type** 表示改动性质，取 `feat`（新增能力、模块或契约）、`refactor`（重构或统一现有结构）或 `test`（测试工程内容）。
- **scope** 表示改动主体所在的模块或被测对象，如 `formal-execution`、`execution`、`workflow`、`governance`、`maintenance`、`testcases`、`open-platform`，与受影响的主要目录或被测产品对应。
- 关键区分：执行引擎与基础设施本身的改动用 `feat`/`refactor` 加模块 scope（如 `feat(formal-execution)`、`refactor(execution)`）；面向某个被测产品的测试请求、用例与资产层改动才用 `test(<产品>)`（如 `test(open-platform)`）。不要把引擎改动标成 `test(open-platform)`。

| 示例 | 含义 |
| --- | --- |
| `feat(formal-execution): 引入业务 Oracle 契约与完成封印并完善正式执行终态` | 新增执行引擎能力 |
| `refactor(execution): 将任务命令和正式执行切换到第四版工作流` | 重构执行编排 |
| `test(open-platform): 归档旧请求并记录第四版评审证据` | open-platform 的测试资产或请求层改动 |
