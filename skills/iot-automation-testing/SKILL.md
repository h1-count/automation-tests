---
name: iot-automation-testing
description: 在本仓库中规划、设计、维护或分析 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。用于处理需求、截图、URL、接口资料、物模型、测试结果和失败证据。
---

# IoT 自动化测试工作流

本 Skill 只定义兼容 AI 测试 Agent 的阅读顺序、命令编排、reviewer 提示卡和宿主续跑适配。安全边界以 [AGENTS.md](../../AGENTS.md) 为准；状态机、测试设计、环境、定位和报告规则只引用[测试规范索引](../../docs/testing/README.md)中的责任文件。

## 开始与恢复

1. 用户提出独立本机维护（清理、重置、归档或测试数据恢复）时，先读取 `package.json` 与 `scripts/README.md`，使用已登记命令；范围不完整时只执行 `--dry-run`。恢复完整测试 workflow 不属于本条维护请求。
2. 阅读 `AGENTS.md`、`.local/testing-memory.md`（如存在）和当前请求的 `workflow-history.ndjson`（如存在）。识别项目后只读取对应项目经验库，并确定稳定的 `<type/project/request>`；无法唯一确定时先请求最小必要信息，不猜测 request ID。
3. 完整自动化测试请求在运行 workflow 命令前，先阅读[流程规范的宿主生命周期适配](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)。宿主提供长期任务能力时，查询并创建或复用绑定同一 request ID 的任务；绑定不同请求或无法确认归属时不得替换、清除或改写，只请求最小用户选择。状态查询、只读诊断和独立维护请求跳过宿主任务创建。能力不可用或调用失败时继续依赖仓库 workflow，但不得声称存在后台续跑保证。
4. 有 history 时运行 `npm run task:resume -- --request <type/project/request>`；没有时使用 `task:initialize`。不得从宿主任务、`plan.md`、runtime 或文件时间猜测运行状态。
5. 先扫描 `sources/` 目录结构和 `sources/manifest.yaml`，再按范围读取命中的受控章节；随后按需选择 `test-assets/manifest.yaml` 中的静态资产。
6. 按任务打开唯一责任规范：

   - 生命周期、事件与恢复：[automation-guideline.md](../../docs/testing/automation-guideline.md)
   - 环境、并发、认证和数据：[environment-guideline.md](../../docs/testing/environment-guideline.md)
   - 计划、用例完整度和评审业务标准：[testcase-guideline.md](../../docs/testing/testcase-guideline.md)
   - Inspector 风险和 selector：[selector-guideline.md](../../docs/testing/selector-guideline.md)
   - 报告与失败：[report-guideline.md](../../docs/testing/report-guideline.md)、[failure-classification.md](../../docs/testing/failure-classification.md)

当前没有活跃 `plan.md` 时按用户需求创建新请求；`testcases/archive/` 默认不参与上下文加载。用例确认后才定位 `.local/repositories/`、Graphify 和源码，并把工程设计补入同一 `plan.md`。

## Activity 操作

公开入口只有 `task:initialize`、`task:resume`、`task:status`、`task:gate` 和 `task:manage`。

1. 从 gate 读取 ready Activity，使用稳定 owner 执行 `task:manage activity-start`。
2. 文件先写入 runtime 暂存区，完成相应校验后再原子发布；关系同步也只修改该暂存副本，不直接改最终请求目录。只有最终文件 digest 匹配才执行 `activity-succeed`。`run/report` 不适用通用成功或普通 confirmed reconciliation，必须走下述 formal completion 专用入口。
3. 失败、callback、阻塞、恢复、核对和 history 校验都使用 `task:manage` 对应子命令，不手工改 history。
4. 外部写操作先记录 intent。lease 过期不证明操作未发生；结果未知时查询后置状态并进入 reconciliation，不盲目重试。
5. 每次状态变化后重新运行 gate，并严格执行流程规范定义的 `continuation` 与 `reply`：`continue_now` 仅要求在当前可用回合继续；等待已启动 reviewer、工具或外部结果时只等待本回合可取得的事件；`wait_until` 只是一次性退避时间，不创建定时器；只有 gate 放行时才能请求用户动作或结束。用户主动索要状态时，可只读复述 gate/status，不得把该摘要当成完成或后台续跑承诺。
6. 用户对 callback 作出决定后，在 runtime 暂存候选 `plan.md`，其“正式用户决定”表记录相同决定类型、`subjectDigest` 与结果，再执行 `callback-resolve --plan-source <暂存 plan.md>`；CLI 负责原子发布计划并追加解析事件，不得直接改最终计划、仅改 history 或把等待状态写成正式决定。

请求用户动作、结束当前测试工作回合或输出完成/失败结论前运行：

```bash
npm run task:gate -- --request <type/project/request> --assert-safe-reply
```

## 宿主生命周期与停止事件适配

完整自动化测试请求包括新建或恢复后的规划、评审、工程、执行、工作流内 cleanup/reconcile 和报告；仓库 Durable Workflow 始终是唯一事实源。宿主提供跨回合长期任务能力时，为完整请求创建或复用一个任务容器；独立状态查询、只读诊断、规则或代码维护、清理、重置、归档和测试数据恢复不创建宿主长期任务。objective、冲突处理和完成条件只按[流程规范](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)生成。

操作顺序固定为：稳定 request ID → 检查宿主是否提供长期任务能力 → 可用时创建或复用同请求任务 / 不同请求请求最小用户选择 → `task:initialize` 或 `task:resume`。宿主能力缺失或调用失败时不得声称已启用；改用当前会话继续或后续显式 `task:resume`。宿主长期任务的 ID、状态、预算和使用记录只属于宿主，不得写入 runtime、history、`plan.md` 或其他仓库文件。

请求运行中，`continue_now`、reconcile、reviewer 派发/重试、自动演进和复审必须继续执行。`await_event`/`wait_until` 使用宿主可用的等待能力取得已登记事件；等待窗口或墙钟时长本身不是 reviewer 失败依据，不得因此中断 reviewer 或发送最终回复。`WAITING_HUMAN` 和 workflow `BLOCKED` 只暂停同一请求，真实条件满足并执行 callback 解析或 `task:manage blocker-resolve` 后恢复，不把暂停直接映射为宿主任务终态。只有 workflow `SUCCEEDED` 且 `task:gate --assert-safe-reply` 通过后，才在宿主支持时标记其长期任务完成；产品结果为 failed/mixed 不阻止工作流完成。`FAILED`、`CANCELLED` 只按宿主自己的能力处理，不得改写 workflow history。

停止事件适配器只通过可丢弃的 session binding 定位请求并调用 gate。它不领取 Activity、不执行副作用、不写事件，也不管理或保存宿主长期任务字段；宿主最多生成一次 continuation，递归调用必须明确保持非终态。无 binding、无 session 或 gate 失败时，适配器不请求 continuation、不改 history，也不承诺后台运行。启用任何宿主专属配置前，都要在受信任工作区检查命令路径、当前文件摘要和权限；修改后必须重新检查。宿主专属配置只是可选兼容适配，不是本 Skill 的前置条件。

## 阶段操作顺序

1. 资料筛选和计划校验，发布 `plan.md`。
2. 请求计划确认 callback；`accepted` 后立即继续用例包生成，不等待用户再发送“继续”。
3. 并行生成适用用例包，运行关系同步和首稿 readiness：一次检查计划必填标记、包完整度、RULE 设计矩阵、关系投影、来源 manifest id/`sectionId`/SHA-256，并一次汇总写入安全 warnings。硬缺口先自动修订并复检；warnings 不单独创建 callback。
4. 首稿 readiness 通过后按 `caseId` 的数据策略与实际操作生成 `case-review-risk-v2`：`light` 只跑确定性门禁，`standard` 派发 combined，`strict` 并行派发 combined 与 impact。combined 只审查 standard/strict，impact 只审查 strict 及共享安全邻域。完成初审和最多两轮语义演进；确定性修正不消耗轮次。
5. 对最终收敛的用例集请求一次用例确认；确认后在单一 `build` Activity 内自动完成工程设计、完整候选脚本、selector 契约和差异化脚本评审。候选可标记 `runtime_validation_pending`，但不能用空 callback、固定 blocker 或仅 capability 检查代替业务实现。评审和授权必须使用与 Runner/finalize 相同的本地运行依赖闭包：递归纳入候选 helper，排除 `import type`，Formal Runner 基础设施按 byte-frozen runtime leaf 处理。
6. 启动 `readiness` 后运行 `execution-readiness-publish`：所有等级复核项目编译、`caseId` 映射、source gate、敏感信息、操作声明和 `operationEvidence`；只将账号、OTP、远端 fixture/动态数据、外部观察器、Runner adapter 和资源池当作运行依赖。ARIA、selector、源码、浏览器响应契约，以及 `test-assets/manifest.yaml` 中的 Git 静态资产和本地确定性生成器冻结为 `buildEvidence`，不创建同名 Provider 或要求 `.env` 重复指定资产。静态资产缺失、范围/摘要不匹配和未注册 Provider 是 `invalid`；已实现 Provider 或资源池在当前环境不可用且没有已授权替代预算时才是 `deferred`。只有 case 当前阶段启动必需的能力才进入 `requiredCapabilities`；可选参数或精确边界不能延期其他独立场景。readiness 必须以 `producesResources → requiredResources` 构建无环依赖图：生产者可启动时，消费者进入 `scheduledCaseIds` 而不是 deferred；执行清单同时展示第一波、后续波、依赖路径和 `graphDigest`。`standard` 验证 `script_quality`，只有 OTP、权限/安全挑战、设备动作、敏感凭据或结果未知才升为 `strict` 并验证 `execution_safety`。零 runnable 时登记 blocker，不请求执行确认。存在 runnable 时，新 run 发布 `execution-authorization-v4` 并请求一次确认；已冻结 v3 的历史 run 按原版本续写，不迁移 history。
7. 确认后运行单一 `run` 事务，按需完成能力复核、资源池校验/租约或授权内惰性创建、执行、外部 postcondition、`finally` 基线恢复/释放/cleanup/reconcile。新 readiness 必须使用 `formal-execution-manifest-v3`，在启动 Runner 前重算已授权的来源、build evidence 与业务 Oracle 契约；每个 runnable case 必须通过 `verifyBusinessOracle()` 为全部必需 Oracle 产生结构化结果。Runner 不能依赖脚本文件或 Playwright discovery 顺序，必须按冻结 manifest 动态计算拓扑波次；生产者用 `publishResource` 交接当前本地 run 的台账句柄，消费者用 `consumeResource` 取得句柄后才启动。多阶段 case 采用“运行当前波次 → `completeStage` 冻结检查点 → `awaitExternalTransition` → `execution-transition-park` 合并请求当前全部人工动作 → `execution-transition-resolve` 校验脱敏回复并恢复同一 lease → `--resume` 执行下一波次”；park 时只关闭进程能力，不执行业务 cleanup 或结束 test-data run。后续能力只在对应转换解析后检查，已完成写入不得重放。部分转换完成时先执行已满足分支，剩余分支再次 park；生产者失败只阻塞后代，无依赖分支继续。只读可用 `shared_read`，写入必须 `exclusive`；恢复失败立即隔离，不得返回池中。terminal settlement 只有结构化 cleanup 摘要已接受才能执行 `execution-run-finalize --claim <lease>` 建立正式 seal；数据卫生未闭环时登记 blocker，terminal `unknown` 时登记专用 outcome blocker，两者都禁止封印和普通解除。恢复后只重做必要的受控尝试与 settlement/finalize，不重放已完成写入。随后执行 `execution-report-finalize --claim <lease>`，只从同一 seal 生成 `formal-run-summary-v2` 的 `run-summary.json` 与 `execution-summary.md`，并原子闭合 report 与 workflow。

计划确认的 `subjectDigest` 只按流程规范的 `plan-confirmation-subject-v2` 从现有计划区块内部计算，不向计划添加“计划确认边界”表。顶层业务流程、测试类型/目标环境、高层数据写入类别和权限/安全上限未变化时，`REQ/RULE/caseId`、断言、追溯或 reviewer 记录的自动演进不得重开计划确认。只有 manager 判定为需要修订计划，或存在资料冲突、未定义验收时，才请求最小用户决定。

没有测试 OTP 通道且 `send_test_otp` 以 `ui_state` 声明时，正式 Web/H5 Runner 必须使用 `--headed`：脚本只发送一次，用户直接在页面输入验证码，输入完成后同一浏览器会话自动继续；不得把验证码传给 Agent、Provider、`.env` 或任何产物。这种有界页面等待不新增 callback，也不使用跨回合外部转换。

计划、用例包或关系文件更新后，依次运行：

```bash
npm run check:markdown -- <实际 Markdown 文件>
npm run check:architecture
```

Web/H5 先从已确认版本的源码、既有 action/Page Object 和 selector 契约生成候选，再使用 `test:web:verify-selectors` 做无头零写入验证；只有源码无法收敛、无头验证多匹配或不可达、源码与运行时漂移或动态语义无法确定时，才运行 `test:web:inspect` 或 `test:web:explore:reuse:inspect`。单纯状态迁移和 Web 类型本身都不能触发 Inspector。零写入无法跨越保存、注册、提交等边界时，记录 `reachableBoundary`，按源码和状态契约生成 `runtime_validation_pending` 脚本；远端状态准备与下游验证留在执行清单确认后的正式运行。

需求给出文件格式或数值阈值时直接生成相应参数矩阵。Git 静态资产通过 `requiredTestAssetIds` 与 `test_asset` 证据绑定 active/default 资产并校验实际 SHA-256；格式转换和合法大文件可由本地确定性生成器产生，不建立资产 ID 或精确字节环境变量。单位换算未定义时只执行对合理口径都明确成立的明显低于/明显高于样本，并披露精确等号边界未断言；该缺口不得延期格式、非法格式或明确区间样本。

流程中一旦形成可复用的项目级策略，立即通过 `knowledge:manage candidate-add` 同步写入 Git 管理的项目经验库和本地待验证元数据，不等待整轮测试成功。同一适用范围的新策略原位更新当前条目，旧版由 Git 历史保留；受控探索或正式执行完成后，`candidate-promote` 只更新该条目的证据状态。

## 多角色隔离评审提示卡

作者完成完整草案且 readiness 没有硬缺口后，只为 `review-policy-v2.requiredRoles` 中的适用角色启动真实、只读、隔离 reviewer 子 Agent；本 Skill 即为宿主创建这些子 Agent 的明确授权。`light` 没有适用角色，不启动子 Agent，也不提交伪造 reviewer 事件。combined 只读 standard/strict 用例，impact 只读 strict、关联 `REQ/RULE` 与共享安全邻域。输入只包含引用的 source section/page、当前语义计划、角色 scope 内用例和提示卡，不提供作者推理或其他 reviewer 结论。主 Agent 是唯一汇总和写入者，不能分角色自评替代 reviewer。

`reviewer-dispatch` 与 `reviewer-submit` 都必须传入宿主实际返回、且不同于主任务的 `--agent-task`；manager 验证相同 `batch + activity + role` 的 running binding 后才允许提交。任务标识只写 runtime，history 只保存隔离证明版本。派发、提交或 `task:resume` 发现输入漂移时，不得提交旧结果或手工复用旧摘要；manager 会失效旧批次并启动确定性新批次。gate 出现 `reviewer-rebind:<batch>:<activity>:<role>` 时，为该 Activity 取得真实 reviewer 工具句柄后，使用同一 `reviewer-dispatch` 补建绑定，不追加第二次派发。没有可用工具句柄时保持真实非终态。

自动演进后的批次优先定向复审：scope 必须绑定 `affectedRefs`、`baseBatchId`、复审原因、明确排除引用，以及每个未重审角色的原批次、输入摘要和正式计划证据摘要。缺少可复用证据时不跳过该角色；只有跨业务域、共享规则邻域、数据/执行边界或安全影响时才扩大 scope。reviewer 先按 `affectedRefs` 精读对应 `REQ/RULE/caseId` 和来源 `sectionId`、页码或标题定位，再读取必要直接邻域；冻结快照中的完整 PDF、Word 和其他源文件只是权威回退，不要求每轮全量精读，也不扫描未被计划引用的整个知识库。

定向批次通过 `task:manage review-batch-start` 的重复 `--activity`、`--affected-ref`、`--excluded-ref` 以及 `--base-batch`、`--reason` 参数登记；未传 `--activity` 时保持初审的完整 scope。未重审角色的证据由 manager 从 history 派生，调用方不得手工提供摘要。

收集 reviewer 后，`case-review-resolution` 的候选计划只能更新 reviewer 正式结论和发现项，夹带测试范围、`REQ/RULE`、设计矩阵、关系、用例或工程内容时不得发布。结论为“需演进”时，由 `case-review-evolution` 在已确认计划范围内修改草案、同步关系并自动启动适用复审；若候选修改使 `plan-confirmation-subject-v2` 实质变化，则停止自动发布并进入计划修订决定。

| 角色 | 允许输入 | 检查重点 | 固定输出 |
| --- | --- | --- | --- |
| `combined` | 引用的受控需求章节、语义计划、standard/strict 用例 | 需求覆盖、断言依据、原子拆分、边界、状态与 `REQ ↔ RULE ↔ caseId` | `MRR-COM-*`、证据、受影响引用、严重度、分类、处置、结论 |
| `impact` | 引用的安全章节、strict 用例、共享安全邻域 | OTP、权限、安全挑战、敏感信息、未知结果和恢复边界 | `MRR-IMP-*`、证据、受影响引用、严重度、分类、处置、结论 |

角色适用性、发现项分类和收敛标准只按[用例规范](../../docs/testing/testcase-guideline.md#510-用例集评审与草案演进)判断；并发、重试和无进展停止条件只按[流程规范](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)执行。资料明确的缺口自动修订；资料冲突或未定义验收才请求最小业务裁决。

## 分级脚本评审提示卡

用例阶段与脚本阶段分别评级为 `light`、`standard` 或 `strict`；脚本阶段按 `formalCase(caseId)` 继承对应用例风险，工程信号只升级不降级，请求级最高档只作摘要，不能作为所有脚本的 floor。`task:manage script-review-assess` 只用于预览；正式冻结由运行中的 `execution-readiness-publish` 单次完成。所有等级都必须通过项目感知的 TypeScript 编译、`caseId` 唯一映射、正式 source gate、敏感字面量、执行操作/预算和 cleanup/reconciliation 检查。静态失败直接阻断，不派 reviewer 猜测修复。

`script_quality` 必须核对源码能支持的步骤是否在候选中完整落地；空实现、固定阻断和只声明能力的脚本直接为 `changes_required`。`execution_safety` 只检查真实写入面、授权、预算、结果证据和 cleanup/受控残留；写入结果按 `response_contract`、`response_with_query_fallback`、`response_then_query`、`query_only` 分层，不得要求所有写入无条件 `query_postcondition`。已实现 provider 或部署尚未可用只导致 readiness deferred，未实现 provider 则是 invalid；两者都不得要求删除有业务依据的候选代码。

Web/H5 脚本必须把每个 case 映射到 manifest `pageSessionGroups`。同路由、同角色、`read_only + no_write` 且无跨字段联动的表单用例优先使用 `preserve_unrelated_fields`：同一波次、同一 worker 内复用 Context/Page，每条 case 只设置自己的目标字段，不要因其他输入框已有数据而重开页面。认证、OTP、上传、提交、跨域状态和不可恢复页面必须使用 `new_context_per_case`。共享组失败不合并 case 结果；页面关闭、路由偏离或 Playwright 重启 worker 时只重建该组，不承诺保留失败页面。

在发送 OTP、上传、提交或等待用户输入之前，先预检该阶段之后还会使用的 selector、可见交互容器和静态控件状态；预检不得触发业务写入。不得让本可在副作用前发现的脚本定位错误延迟到人工验证码输入之后才失败。

布局、图表、图像或其他无稳定结构断言的可见结果，可在不含敏感数据时截取最小局部图片，由主 Agent 使用宿主视觉能力按冻结 rubric 审查。这不是 reviewer 子 Agent Activity，不新增用户确认，也不建立虚构 Provider。宿主没有可编程图像输入时，不得伪造模型 verdict；密码、OTP、Token、Cookie、手机号和真实业务数据区域禁止截图。

- `light`：不派模型 reviewer；静态门禁通过后可发布执行清单。
- `standard`：派一个只读隔离 `script_quality` reviewer，核对用例映射、selector/接口契约、断言、确定性、失败分类和报告边界。
- `strict`：并行派 `script_quality` 与 `execution_safety`；后者核对授权操作、业务写入、副作用、资源预算、敏感信息、安全挑战、分层结果证据、cleanup 和 reconciliation。

reviewer 只读取冻结的计划工程层、自己 scope 内的正式脚本、静态门禁摘要和提示卡，不读取作者推理或另一 reviewer 结论。宿主把标准化证据写入当前请求 runtime 的 `review-evidence/`；证据不含任务标识或敏感值。`script_quality` 绑定 standard/strict 用例及共享质量代码，`execution_safety` 绑定 strict 用例及共享安全依赖；light 脚本变化不得使安全证据失效。风险分级只改变自动 reviewer 范围，不改变三个用户 callback。

## 资源

| 测试类型 | 技术与模板 |
| --- | --- |
| Web/H5 | Playwright；正式脚本 `templates/playwright.spec.template.ts`；执行契约 `templates/formal-execution-manifest.template.ts`；无头 selector 验证 `templates/playwright-selector-verification.spec.template.ts` |
| 原生 App/WebView | Appium + WebdriverIO；`templates/appium.spec.template.ts` |
| API | TypeScript API Client；复用 `src/clients/` 与 `tests/api/` |
| MQTT/IoT 链路 | mqtt.js 与已确认的组合 Runner；`templates/iot-chain.spec.template.ts` |

对外部可观测操作必须冻结每 case `operationBudgets`；Runner 在操作前以脱敏幂等 key 原子预留，恢复时不得重放旧 key 或超出数量上限。

`templates/` 只提供结构，`examples/` 只作参考；两者都不等同于已验证测试资产。
