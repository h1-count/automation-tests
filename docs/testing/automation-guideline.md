# AI 自动化测试工作流规范

<!-- owns: task.lifecycle -->

## 1. 目的与适用范围

本文定义 AI 测试 Agent 参与自动化测试时的协作流程，适用于 Web、H5、App、App 内 WebView、API、MQTT 和 IoT 端到端链路。

目标是将用户输入的资料转化为可审核、可追溯、可重复执行的测试资产，避免 AI 基于未确认信息直接生成、执行或修改正式测试脚本。

项目强制规则以 [AGENTS.md](../../AGENTS.md) 为准。本文是生命周期、事件状态机、阶段编排和工程层进入条件的唯一正文来源；测试设计与评审标准见 [testcase-guideline.md](./testcase-guideline.md)，环境与数据生命周期见 [environment-guideline.md](./environment-guideline.md)，运行结果见 [report-guideline.md](./report-guideline.md)。

<!-- delegates: automation.contracts -->
本文使用的专有契约标识、当前版本和仅回放版本统一登记在[契约注册表](./contract-registry.md)；本文只解释生命周期契约的业务语义，不另建版本清单。
<!-- end-delegates -->

## 2. 角色与职责

| 角色 | 职责 |
| --- | --- |
| 用户 / 测试负责人 | 提供资料与业务目标；确认完整测试用例和独立执行清单，处理必要的修订或取消。 |
| 主 Agent / 编排者 | 解析资料，维护测试设计索引和用例，收齐 reviewer 结论后演进草案，并在确认后生成脚本和报告。 |
| 隔离 reviewer | 仅以本角色允许的原始资料、当前 `plan.md` 和用例包进行只读审查，独立输出发现项和结论；不得修改测试资产或代替业务批准。 |
| 确定性 Runner | 使用 Playwright、Appium/WebdriverIO、API Client 或 MQTT Client 执行已确认的测试。 |
| CI/CD | 提供受控环境、Secret、定时或发布前执行能力，并归档执行结果。 |

任何 Agent 都不自动合并、不自动发布、不默认访问生产环境，也不执行未经确认的高风险操作。

## 3. 总体流程

新测试请求必须在任何资料正文读取、受控探索和 `task:initialize` 之前完成一次交付目标选择。用户已明确“只生成用例”“交付脚本”或“完整执行”时直接映射，否则只询问一次：

- `testcase_only`：完整用例集经门禁、reviewer 和用例确认后结束；不读取被测代码仓库，不生成脚本。
- `script_only`：用例确认后继续 `build`，完成候选脚本、selector/接口契约证据和静态门禁后结束；不创建 readiness、执行清单或正式运行。
- `full_run`：执行完整的用例、脚本、readiness、执行授权、run 和 report 闭环。

目标使用 `task:initialize -- --delivery-target <testcase_only|script_only|full_run>` 固定到 definition 与 `graphDigest`。内部 Activity 按选定目标自动连续，不在每一步后再询问“是否继续”。同 `requestId` 已有 history 时必须恢复原图，不得重选目标或改写历史。

```text
测试请求 → 启动前选择 deliveryTarget
  ↓
同 run history 恢复；无 history 时确定性 suite 复用评估 → direct_execute / affected_rebuild / full_replan
  ↓
affected/full 分支上下文加载：读取用户偏好 → 按测试需求确认被测项目 → 读取项目测试经验库 → manifest 与章节索引筛选 → 读取命中原始资料
  ↓
用例设计：读取命中资料 → 自动生成完整候选用例集（REQ、RULE、用例、来源追溯、风险与待确认项） → 自动门禁与评审演进 → 一次用例确认
  ↓ testcase_only：WorkflowCompleted
  ↓
工程层：定位代码仓库 → 检查 Graphify 图谱 → 自动化可行性与脚本设计
  ↓
Web/H5：可选的只读真实页面候选探索 → 源码契约补齐 → 自动无头 selector 验证 → 必要时可见 Inspector 兜底
  ↓
正式脚本 diff → 静态检查与脚本评审
  ↓ script_only：build 完成后 WorkflowCompleted
  ↓ full_run：readiness
  ↓ 风险自适应授权：可证明零写入时自动，其他一次确认不可变执行清单
setup → 正式测试 → teardown → 报告
  ↓
范围完成判定、失败分析与 WorkflowCompleted
```

报告后的资产修改、缺陷修复或重新执行必须由用户另行提出，或进入相应的条件性决定流程。v7 固定只有一次用例确认；执行阶段在完全符合 `policy_auto_no_write_v2` 时自动授权，否则保留一次执行清单确认。用例确认不授权业务写入、设备动作或生产执行。

### 3.1 测试上下文加载

每次测试任务开始时，主 Agent 必须先完成以下上下文加载，再进入资料输入、受控探索或测试设计：

1. 无条件读取 `.local/USER-PREFERENCES.md`（如存在），加载当前用户的长期协作与行为偏好。
2. 根据用户测试需求、目标 URL、资料来源、活跃套件（`testcases/<type>/<project>/suites/<feature>/`）或已关联资产确认被测项目与目标套件；此时不得扫描业务源码来替代需求理解。目标套件不存在时创建新套件；单次运行意图记录在运行档案 `plan.md`，不得单独请求计划确认。
3. 被测项目已识别时，只读取对应项目测试经验库 `docs/testing/knowledge/<project>-testing-knowledge.md`（如存在）；不得读取或套用其他项目的测试经验。
4. 用户直接指定的 Word、PDF、原型或附件直接作为本请求来源：读取后在 `plan.md` 的“请求内来源”记录稳定 SRC、可点击路径、章节/页码/字段、用途和一次 SHA-256，不要求预先登记 `sources/manifest.yaml`。只有确需跨请求复用时才晋升全局 manifest。
5. 需要从仓库补充资料时，在读取 `sources/` 正文前先读取 `sources/manifest.yaml` 和相关受控章节索引；不得以全量打开资料库代替选择。
6. 仅读取用户直接指定的资料、与当前请求命中的 active 仓库资料，以及解释已确认需求所必需的上级资料。**索引命中只表示候选，不表示已读取或已引用。**实际引用资料统一记录到“请求内来源”；manifest `id/sectionId` 只在该来源本已受全局索引管理时补充。
7. 在资料筛选后读取 `test-assets/manifest.yaml`，按项目、类型、平台和范围选择 `active` 静态资产。静态资产不是业务需求依据，不记入请求内来源。
8. 仓库 `sources/` 内的资料未登记、路径不存在、适用范围无法确认或存在多个同等候选时，记录最小 `missingInfo`；该要求不适用于用户已直接指定的外部附件。
9. 被测项目尚未能唯一确认时，记录为 `missingInfo` 并向用户确认；在确认前不得猜测项目专属流程、环境约束、配网方式或恢复策略。
10. 每次输出用例确认视图、评审结论或范围调整时，面向用户列出“本轮实际引用资料”：可点击链接、页码/标题/原型页面定位与用途；`manifest id / sectionId` 只在已登记时列出。不得把仅扫描到、仅索引命中或未打开的资料列为依据。

<!-- delegates: automation.project-knowledge -->
项目经验的适用范围、即时登记、候选状态、冲突覆盖、条目格式和事实优先级统一由[项目测试经验规范](./knowledge/README.md)定义；生命周期层只负责在确认被测项目后读取匹配经验，并在流程形成或验证经验时调用登记命令，不复制其规则正文。
<!-- end-delegates -->

### 3.1.1 本机维护命令发现与执行

“清理”“重置”“归档”“恢复”属于工程维护请求，不进入测试设计、用例或执行阶段。每个新对话处理此类请求时，必须先读取 `package.json` 的 scripts 与 `scripts/README.md`，按已登记命令的用途和边界选择操作；不得根据目录名、历史经验或扫描结果自行推断要删除的文件。每次发布新的 workflow definition version 后，可在独立的维护回合向用户提议一次非当前版本请求归档预演；仅在用户确认范围后执行，不得在测试工作流回合内自动触发。

| 用户意图 | 必须先做 | 允许的后续动作 |
| --- | --- | --- |
| “清理本地测试数据”等范围不完整表述 | 定位匹配命令并运行 `--dry-run` | 输出将清理/归档的类别，等待用户确认完整范围；不得手工删除目录。 |
| “完整重置”“清除所有测试数据”“从头测试” | 确认 `reset:full-test-state` 已登记 | 执行 `npm run reset:full-test-state`；它清理本地运行状态并归档活跃测试资产，不删除远端业务数据。 |
| “归档所有非当前版本请求” | 确认 `archive:noncurrent-requests` 已登记并运行 `--dry-run` | 【已停用增量】新模型下套件演进由 Git 历史承载，不再产生新归档；该命令仅保留对旧请求模型遗留目录的一次性迁移用途，日常不得再触发。 |
| 恢复已登记的本机资源 | 确认资源台账与恢复命令 | 使用 `npm run test-data:recover`；它不是清理命令。 |
| 用户要求的范围没有对应命令 | 比对命令边界与用户范围 | 报告没有安全匹配命令及最小补充指示；不得用目录扫描或 `rm` 模拟。 |

命令失败、预演结果与用户范围不一致，或涉及远端资源、凭据、生产环境时，保持不执行状态并报告原因。维护请求的产出仅记录命令、脱敏类别和结果；不得把 `.local`、`.auth` 或台账内容作为可预览产出链接。

### 3.1.2 动态状态与产出

运行级 `.local/test-runs/<type>/<project>/<request>/workflow-history.ndjson` 是唯一运行事实（本机运行档案，不进 Git；跨机器恢复等于从套件重新发起运行）。`.local/test-task-runtime/<type>/<project>/<test-request>/` 仅保存可丢弃的 claim token、lease、session/reviewer 工具绑定、暂存路径与在途操作引用；宿主长期任务只是外部实时状态，不写入 runtime、history 或计划。删除 runtime 不得改变 Activity、阶段、确认、阻塞或整体结果。运行档案中的 `plan.md` 只保存运行意图（范围、默认值、请求内来源、正式用户决定、reviewer 结论和发现项），不保存任务表、阶段进度、用例生成进度或 history head；稳定设计资产（cases.md/design.md）在套件目录维护。旧请求模型下 `testcases/<type>/<project>/<test-request>/workflow-history.ndjson` 的既有文件按 legacy 只读回放。

`task:status` 从 history、工作流定义和真实产物即时渲染阶段、完整度、等待项与下一动作。v7 面向用户只投影“用例设计、脚本、执行、报告”四个阶段；v5/v6 继续显示其原六阶段。该视图不新增确认，也不删除或改写底层 Activity、workflow state 和恢复事件。

安全产物引用随对应 `ActivitySucceeded.outputRefs` 和 digest 写入事件；用户需要状态时，可以从 `task:status` 与本轮成功事件生成只读的简短状态和产出摘要。该摘要只能陈述当前定义对应的用户阶段投影、等待、下一动作和已完成产物；底层 `workflowState` 与 `phase` 仅作为诊断字段，不得展开成额外用户阶段。摘要不能宣称完成、承诺后台续跑、创建 continuation 或推进 Activity。严禁展示 `sources/`、`.env`、`.auth/`、`.local/`、归档、工作区外路径或敏感文件；静态测试资产是输入引用，不是本轮产出。

### 3.1.3 阶段交接核验与中断恢复

每次推进阶段、宣告阶段结论或请求确认前，必须完成“阶段交接核验”：history 派生的 Activity 事实、`plan.md` 中的正式决定与评审结论、真实产物及其摘要必须在适用对象、证据和下游资格上相互一致。任一项缺失或冲突时，不得推进受影响的 Activity；追加 `ArtifactDriftDetected` 或 `BlockerRaised`，按实际风险进入 `RECONCILING` 或 `BLOCKED`。最终复审仍由唯一可恢复入口完成关系同步、把安全文件引用写入对应 `ActivitySucceeded.outputRefs`、校验 `plan.md` 正式 reviewer 记录与发现项闭环；最终成功只能追加对应 reviewer/Activity 事件，不能直接写父任务状态。

### 3.1.4 Durable Workflow、生命周期与恢复

#### 唯一事实源与事件契约

`workflow-history.ndjson` 是请求运行事实的唯一来源，采用语义 append-only 事件。追加时必须执行“读取并验证全部事件 → 校验预期 head → 追加事件 → 临时文件写入与 fsync → 原子替换”；每条事件以 `seq`、`prevDigest`、`digest` 构成 SHA-256 hash chain。截断、乱序、重复序号、摘要不匹配或 CAS 冲突必须安全失败，不能从 `plan.md`、runtime 或产物时间戳猜测成功。

事件至少包含 `schemaVersion`、`eventId`、`seq`、`runId`、`requestId`、`definitionId`、`definitionVersion`、`type`、`occurredAt`、`actorType`、`idempotencyKey`、`payload`、`prevDigest` 和 `digest`。核心类型包括：

- 工作流：`WorkflowStarted`、`ActivitiesExpanded`、`WorkflowSuspended`、`WorkflowResumed`、`WorkflowCompleted`、`WorkflowCancelled`。历史中已存在的 `LegacyStateImported` 只允许 replay，事件追加和 CLI 均不提供迁移入口。
- Activity：`ActivityAttemptStarted`、`ActivitySucceeded`、`ActivityFailed`、`RetryScheduled`、`ActivitiesInvalidated`。
- 产物与副作用：`ArtifactPublishPrepared`、`ArtifactDriftDetected`、`ExternalOperationStarted`、`ExternalOperationReconciled`。
- 人工与阻塞：`CallbackRequested`、`CallbackResolved`、`PlanConfirmationCarriedForward`、`BlockerRaised`、`BlockerResolved`。
- 评审：`ReviewBatchStarted`、`ReviewerDispatched`、`ReviewerSubmitted`、`ReviewBatchInvalidated`。

事件禁止保存密码、验证码、Cookie、Token、真实用户数据、宿主任务或会话 ID、reviewer/Agent 任务标识、claim token 与 lease。宿主 reviewer 绑定只写 `.local/test-task-runtime/`；history 只保存角色、Activity、输入摘要和派发/提交语义，`plan.md` 只保存设计索引、正式决定和评审结论。新请求使用 v7；已有 v5/v6 history 按其展开定义继续恢复，不迁移、不重写；v3、v4、`vnext-1` 和含 `LegacyStateImported` 的旧历史只读 replay。

#### Activity、工作流与测试结果

Activity 状态仅由事件归约为 `PENDING`、`READY`、`RUNNING`、`SUCCEEDED`、`RETRY_WAIT`、`WAITING_CALLBACK`、`RECONCILING`、`BLOCKED`、`FAILED` 或 `CANCELLED`。工作流状态仅由全部分支归约为：

| 状态 | 含义 |
| --- | --- |
| `RUNNING` | 存在可运行或运行中的 Activity。 |
| `WAITING_HUMAN` | 只剩绑定有效 subject digest 的人工 callback。 |
| `WAITING_EXTERNAL` | 等待已登记外部结果，不能盲目重复副作用。 |
| `RETRY_WAIT` | 等待已登记退避到期。 |
| `RECONCILING` | 产物或外部副作用结果不确定，必须先核对后置状态。 |
| `BLOCKED` | 真实解除条件尚未满足，且没有独立可运行分支。 |
| `SUSPENDED` | 已安全检查点停止，等待显式恢复或宿主能力恢复。 |
| `SUCCEEDED` | 全部适用流程及报告 Activity 已成功闭环。 |
| `FAILED` | 工作流出现不可恢复失败。 |
| `CANCELLED` | 用户或受控取消分支已提交。 |

父任务、阶段、整体进度和用例完整度都从事件历史与真实产物派生，不再独立持久化。上述 Activity 与 workflow state 是内部恢复契约，必须完整保留；用户可见阶段只是当前 definition 的只读投影，不能反向驱动状态迁移。无关 blocker、下游确认或 reviewer 容量等待不得冻结仍可运行的独立分支。测试结果与工作流结果分离：产品测试可以为 `failed`、`mixed` 或 `inconclusive`；只要执行、清理/残留登记和报告流程完成，工作流仍可成功闭环。

`run` 与 `report` 使用 `formal-execution-completion-seal-v1` 完成契约。通用 `activity-succeed`、`artifact-publish-succeed` 和普通 `reconcile --outcome confirmed` 均不得关闭这两个 Activity；只能分别使用 `task:manage execution-run-finalize --request <id> --claim <lease>` 与 `task:manage execution-report-finalize --request <id> --claim <lease>`。专用入口从已确认执行 subject、正式记录和 completion seal 派生结论，不接受调用方填写验证结果、测试结论、文件路径或摘要。新定义中的 completion marker 要求 `ActivitySucceeded` 携带 `formal-execution-workflow-evidence-v1`；旧 v5 history 没有 marker 时仍按原事件只读回放，v3/v4 继续只读，不升级定义或重写历史。

#### v7 稳定套件复用分支

v7 的第一个业务事实是确定性复用评估：先区分长期 `suiteId/suiteVersion` 与本轮 `runRequestId`，再从稳定 manifest、当前文件摘要、精确脚本依赖闭包、Oracle、selector/API 契约、静态资产、权限和数据策略派生 `direct_execute`、`affected_rebuild` 或 `full_replan`，调用方不得手填结论、digest、caseIds 或脚本路径。目标 build 只变化而契约语义不变时仍可直接复用；Provider、账号、设备或远端数据不可用只影响 readiness。

v7 分支固定为：

- `direct_execute → suite-validation → readiness → authorization → run → report`，不产生用例确认；
- `affected_rebuild → impact-location → targeted-evolution → targeted-review → case-confirmation → build → readiness → authorization → run → report`；
- `full_replan` 进入完整设计分支。

直接分支只引用 suite manifest，不复制或重新生成设计；定向分支只处理 `impactMap` 证明的受影响引用。全局范围、环境、数据写入或安全边界变化，以及映射不完整，必须回退 `full_replan`。

`npm run test:suite:assess -- --suite <type/project/feature> --environment <test|pre> [--profile <profile>]` 只读输出评估；`task:initialize -- --request <new-run> --delivery-target <target> --suite <suiteId> --reuse auto --environment <test|pre>` 会重算同一评估，不接受外部摘要或结论。直接分支只执行到选定终点；`full_run` 直接分支启动 readiness 后使用 `task:manage suite-readiness-publish --request <new-run> --claim <lease> --environment <test|pre>`。`no_write + test/pre + 完全匹配` 由 `policy_auto_no_write` 为本轮生成 `execution-authorization-v5`，其他写入、OTP、上传、提交、设备动作或提权仍须本轮新确认。设计复用不复用旧授权、正式记录、能力有效期、数据台账、cleanup 结论或报告。

`affected_rebuild` 初始化时把完整稳定设计确定性物化为本轮隔离工作副本，并将 suite-scoped v4 manifest 降为绑定本轮 `runRequestId` 的候选 v3；这只是复制，不重新生成未受影响资产。模型和 reviewer 只接收评估命中的 case/引用，readiness 必须精确使用同一 case 集。工作副本不得直接覆盖稳定目录；只有本轮正式执行、cleanup、seal 与报告收口后，`suite-promote` 才能合并已评审入口并保留未受影响资产。case 集或评估范围外 manifest 发生变化时拒绝局部晋升并要求 `full_replan`。

#### 完整设计分支、Activity 命令与恢复

v7 `full_replan` 的用户可见设计交互固定为：“读取资料 → 自动生成完整候选用例集 → 自动门禁与评审 → 一次用例确认”。新 v3 内部使用 `source-selection → candidate-generation → candidate-gate → 可选 reviewer/一次自动演进 → case-confirmation`；旧 v2 history 仍按原图回放。`case-confirmation` 前不得创建其他 callback、请求用户发送“继续”或分批确认 REQ、RULE、计划或用例包。

`build` 的产物是完整、可审查的候选脚本，不是环境可执行性证明。部署版本、运行时 selector、OTP、fixture/provider、资源预算和实际 cleanup 能力只由 `readiness` 决定 runnable/deferred，不得反向删除有源码依据的候选实现。

v7 `full_replan` 保留 `graphDigest` 与 `planDigest` 约束。新 v3 从请求默认值和 RULE 派生 case 的数据策略、REQ 与来源，`candidate-gate-v1` 生成 lean/strict 与语义 reviewer 选择；不因 REQ/case/模块数量升级。`review-policy-v3` 最多自动演进一轮，lean reviewer 失败告警放行，strict 允许一次重试。历史 run 按原策略回放。

用例阶段与脚本阶段分别评级为 `light`、`standard` 或 `strict`；脚本从 `formalCase(caseId)` 继承该用例的最低档，再按实际脚本操作只升级不降级。风险分级只调整自动评审强度，不增加用户 callback；v7 只分别确认用例和不可变执行清单。

公开入口只有 `task:initialize`、`task:resume`、`task:status`、`task:gate` 和 `task:manage`。Activity、callback、阻塞、恢复、核对与 history 校验都通过 `task:manage` 子命令执行；不提供旧事务别名或旧状态迁移命令。

claim、lease 和 fencing token 只写 runtime。lease 过期只说明执行者失联，不能证明 Activity 或副作用未发生；旧 fencing token 永远不能提交新结果。`task:resume` 先验证 history，再按 DAG 返回全部 `readyActivities` 与安全的 `nextActions`；已经成功的 Activity 不重做。

#### 产物发布、外部副作用与人工 callback

计划、用例、关系和评审文件先生成到同文件系统 `.local/test-task-runtime/.../staging/`，完成 Markdown、结构、追溯、敏感信息和专项检查后追加 `ArtifactPublishPrepared`；随后逐个原子 rename 并回读最终文件核对 digest。普通产物 Activity 最后追加 `ActivitySucceeded`；正式 callback 的计划发布则以显式绑定该 publication 的 `CallbackResolved` 作为 durable commit，四种 resolution 都不得再追加 `ActivitySucceeded`。尚未发布可重新生成；全部 digest 匹配可补记对应闭合事件；部分发布或冲突必须进入 `RECONCILING`。用例包完整度必须计算正文数量、必填区块、唯一 `caseId`、关系和 digest，不允许手填“草案完整”推进评审。

外部写操作使用稳定幂等键 `runId/activityId/operationKind/inputDigest`，操作前登记 intent，操作后登记脱敏结果。结果不确定时先查询后置状态或台账，禁止直接重发验证码、重复上传或重复提交。

callback 必须绑定 `callbackId + activityId + subjectDigest`。用户作出决定后，先在 runtime 暂存只追加正式决定行的候选 `plan.md`，再由 `callback-resolve --plan-source` 原子发布并追加事件；等待、重试和失效只写 history。

v7 用例确认使用 `case-confirmation-subject-v2`，实时绑定请求、full/affected 范围、suite 版本、有序 `caseIds` 及语义、全局边界、关联 `REQ/RULE`、来源、未决项和最新评审摘要，不新增平行摘要文件。正式决定表、运行状态和确认后的工程映射不进入 subject。

`full_replan` subject 覆盖全部用例；`affected_rebuild` 只覆盖受影响用例及关联规则，但必须绑定未变化的全局边界。用例、规则、边界、相关风险或评审变化使决定失效；无关用例变化不影响 affected subject。全局边界变化拒绝定向发布并要求 `full_replan`。

v7 用例确认只允许 `accepted`、`revision_requested` 和 `cancelled`。修订请求使 full 分支回到用例生成、affected 分支回到影响定位/定向演进，并重新校验、复审和生成 subject；`rejected` 只保留给旧定义回放。资料冲突和未定义验收使用同一用例确认，不创建 `case-review-conflict-decision`。

用例确认与执行授权保持独立 subject：前者批准测试设计，后者批准本轮清单内操作。任一 subject 的变化只失效自身及下游；用例确认不得被解释为写入或设备授权。

已有 v5/v6 的 `plan-confirmation`、业务冲突 callback 和 `PlanConfirmationCarriedForward` 只按固定历史图恢复；v7 不创建这些 Activity。

#### Gate v2、宿主生命周期与停止事件适配

`task:gate --json` 返回 `schemaVersion: "workflow-gate-v2"`、history `head`、`workflowState`、`phase`、`readyActivities`、`runningActivities`、`waits`、`nextActions`、`checkpoint`、`continuation` 和 `reply`。`continuation.kind` 只允许 `continue_now`、`await_event`、`wait_until`、`wait_user`、`stop`；`reply.kind` 只允许 `none`、`action_required`、`final`。

```ts
{
  schemaVersion: "workflow-gate-v2",
  head: { seq, digest },
  workflowState,
  phase,
  readyActivities,
  runningActivities,
  waits,
  nextActions,
  checkpoint,
  continuation: {
    kind: "continue_now" | "await_event" | "wait_until" | "wait_user" | "stop",
    referenceId?,
    notBefore?,
    reason
  },
  reply: {
    kind: "none" | "action_required" | "final",
    allowed,
    reason
  }
}
```

- 有可自动执行的 Activity 时返回 `continue_now + none`，Agent 必须在当前可用回合继续；计划 callback 为 `accepted` 后，必须立即展开并开始用例生成 Activity。它是当前回合义务，不是后台续跑承诺。
- 等待当前 reviewer、工具或已登记外部结果时返回 `await_event + none`；一次性退避使用 `wait_until + none` 和 `notBefore`。正式 callback 的计划 publication 在有效 lease 内也返回 `wait_until + none`，lease 到期后由 `task:resume` 核对发布结果；这两类等待都不是周期轮询、定时器或后台工作，也不能再次向用户索取同一决定。
- 真实用户决定或流程 blocker 返回 `wait_user + action_required`。
- 只有 `SUCCEEDED`、`FAILED`、`CANCELLED` 返回 `stop + final`。

请求用户动作、结束当前测试工作回合或输出完成/失败结论前使用 `task:gate --assert-safe-reply`。`none`、不安全 checkpoint、非终态完成话术或 reply/continuation 不一致都必须非零退出。用户主动请求的只读状态摘要不属于完成结论：它必须逐字受当前 gate/status 投影约束，且不能改变 workflow history。

完整自动化测试请求始终由仓库 Durable Workflow 覆盖新建或恢复后的规划、评审、工程、执行、清理/核对和报告流程；Activity 是其内部检查点。宿主若提供跨回合长期任务能力，可为整个请求创建或复用一个外部任务容器，但不为每个阶段重复创建。独立的状态查询、只读诊断、规则或代码维护、清理、重置、归档和测试数据恢复属于短任务，不创建宿主长期任务；完整测试工作流内部的 cleanup/reconcile 仍属于原请求。

稳定 `requestId` 的最小解析和可用宿主能力检查共同构成接管预检。`requestId` 无法唯一确定时只请求最小必要信息；确定后、执行 `task:initialize` 或 `task:resume` 前，主 Agent 若能查询宿主长期任务，则查询并创建或复用 objective 明确绑定同一 `requestId` 的任务，不重置其使用记录。已有宿主任务绑定不同请求或无法确认归属时不得替换、清除或改写，只请求用户作出最小选择。宿主没有等价能力或调用失败时仍可启动或恢复仓库 workflow，但必须依靠当前会话继续或显式 `task:resume`，不得声称存在后台续跑保证。

创建宿主长期任务时使用以下 objective 结构；可补充已确认范围，但不得删除其中任何完成条件或安全边界：

```text
完成自动化测试请求 <type/project/request>：从新建或恢复开始，持续推进规划、隔离评审与自动演进、工程与脚本、获授权后的执行、清理/核对和报告，直到完整工作流闭环。
遵守生产环境、业务数据写入、设备动作、安全挑战、凭据和审批边界，不扩大用户已确认的测试范围或权限。
仅在有效人工 callback、审批、安全挑战、业务裁决或真实 blocker 需要用户处理时暂停；处理后恢复同一请求。
完成条件：workflowState=SUCCEEDED，且 npm run task:gate -- --request <type/project/request> --assert-safe-reply 通过。
```

宿主长期任务状态只用于跨回合续跑，不能替代 gate 或决定工作流状态：

| workflow/gate 场景 | 宿主适配动作 |
| --- | --- |
| 新请求或恢复请求通过接管预检 | 宿主支持时创建或复用同一 `requestId` 的长期任务，再执行 `task:initialize` 或 `task:resume`；不支持时直接进入仓库 workflow。 |
| `continue_now`，或存在可自动执行的 reconcile、reviewer 派发/重试、草案演进与复审 | 宿主任务保持活动并立即继续，不请求用户发送“继续”；无宿主任务时同样在当前可用回合继续。 |
| `await_event` 或 `wait_until` | 使用宿主支持的等待/恢复机制取得已登记 reviewer、工具或外部事件；单次等待窗口或墙钟时长本身不构成 reviewer 失败，不得据此中断 reviewer、追加失败事件或发送最终回复。对派发后超过空闲阈值（默认 15 分钟，自 reviewer 绑定或派发事件的最近更新起算）仍无提交的 reviewer，gate 输出 `reviewer-rebind:<batch>:<activity>:<role>` 动作并以 `reviewer_idle_rebind_suggested` 把 `await_event` 提升为 `continue_now`；Agent 先 `task:resume`（清理过期绑定）再以新宿主任务 `reviewer-dispatch` 重派，原派发与输入快照不变，不追加失败事件，重派只重置空闲窗口。 |
| `WAITING_HUMAN` / callback 对应的 `wait_user + action_required` | 只暂停宿主长期任务，不把暂停写成 workflow 事件；callback 解析后恢复同一请求。 |
| workflow `BLOCKED` / blocker 对应的 `wait_user + action_required` | 暂停同一宿主任务并请求最小解除条件；只有真实条件满足并通过 `task:manage blocker-resolve` 后才恢复，不把 workflow blocker 等同于宿主任务终态。 |
| `SUCCEEDED` 且 `task:gate --assert-safe-reply` 通过 | 宿主支持时将长期任务标记为完成。产品测试结果为 `failed`、`mixed` 或 `inconclusive` 不改变该判断，只要执行、清理/残留登记和报告均已闭环。 |
| 不可恢复的 workflow `FAILED` | 不得标记完成；仅按当前宿主自己的阻塞语义处理，不得用宿主状态改写 workflow history。 |
| workflow `CANCELLED` | 不伪装为完成或阻塞；宿主任务的清除或归档由用户控制。 |

宿主长期任务能力缺失或调用失败时，Agent 不得声称能力已启用，也不得伪造 `BlockerRaised`、`WorkflowSuspended` 等业务事件；它应说明续跑能力边界，并以当前会话或后续显式 `task:resume` 推进。恢复时始终先读取 history 并运行 `task:resume`；宿主任务本身不能证明 Activity 已完成。`wait_until.notBefore` 只是可恢复退避时间，仓库不因此创建定时唤醒或周期轮询。

宿主长期任务的 ID、状态、预算和使用记录只属于宿主，不写入 `.local/test-task-runtime/`、`workflow-history.ndjson`、`plan.md` 或任何 task CLI/schema。具体宿主通过自身能力管理其生命周期，不新增 `task:*` 命令、workflow 事件或持久化字段。

项目级停止事件适配器不调度、不领取 Activity、不执行副作用、不写业务事件，也不管理或保存宿主长期任务；它只用可丢弃的 session binding 定位请求并委托 gate。宿主可以把 gate 的阻止结果映射为一次 continuation，但递归调用必须明确保持非终态。缺少 binding、输入无 session、gate 无法执行或输出无效时，适配器只能说明“未请求 continuation、history 未改变”，不能承诺后台续跑。只有主 Agent 通过显式 workflow 命令才能持久化 `WorkflowSuspended`。仓库不创建周期定时任务，也不把停止事件适配器作为工作流正确性的条件；每个宿主专属配置都只是可选兼容适配，必须在受信任工作区检查命令路径、当前文件摘要和权限，修改后重新复核。

评审恢复默认自动续跑：补齐正式区块、派发缺失角色、等待已启动角色、自动演进或启动后续复审均为内部 Activity。资料冲突和验收缺失并入最终用例确认；全局边界变化回退 `full_replan`，安全挑战和 reviewer 重试耗尽才使用各自最小解除条件。

### 3.2 双层模型与贯穿治理线

测试资产采用“业务层 + 工程层”的双层模型。业务层决定**测什么和为什么测**，工程层决定**怎样稳定、可重复地实现已确认用例**；环境、版本、数据、证据和变更影响分析作为贯穿治理线，不能由任何一层单独省略。

```mermaid
flowchart TD
    A[用户测试需求] --> B[业务层：确认项目与加载项目知识]
    B --> C[设计索引、需求追溯、用例、评审]
    C -->|已确认 caseId| D[工程层：仓库、Graphify、源码定位]
    D --> E[自动化设计：可行性、数据、脚本方案]
    E -->|执行清单 callback accepted| F[脚本、执行与报告]
    F --> G[治理线：版本、环境、证据、失败分类、项目经验]
    D -->|代码与需求不一致| H[业务层变更评审]
    H --> C
```

| 层级 | 主要输入 | 主要产物 | 不得替代的依据 |
| --- | --- | --- | --- |
| 业务层 | 用户需求、原始资料、项目知识、风险 | 设计索引、规则台账、已确认用例 | 不得以当前代码行为替代已确认业务规则。 |
| 工程层 | 已确认 `caseId`、代码仓库、图谱、源码、环境能力 | 自动化设计、脚本、运行证据 | 不得擅自改变用例的业务预期或范围。 |
| 治理线 | 两层产物与实际运行 | 版本关联、数据/环境审批、证据、影响分析、复盘 | 不得以口头说明替代可追溯记录。 |

代码、图谱或运行结果与已确认需求不一致时，工程层必须产出差异和证据，退回业务层评审；不得静默修改用例、放宽断言或把当前代码实现视为正确规则。

### 3.3 条件性探索与安全挑战

<!-- delegates: automation.selectors, automation.environment -->
Web/H5 在 `build` Activity 内按“资格满足时的只读真实页面候选探索 → 源码契约补齐 → 缓存命中或自动无头验证 → 可见 Inspector fallback”取得 selector 证据，充分条件、证据等级和 fallback 触发器只由[定位规范](./selector-guideline.md#8-候选-selector-的生成与修复流程)判定；运行模式、会话、零写入和人工安全挑战边界只由[环境规范](./environment-guideline.md)定义。探索适配器不可用不阻塞 build，也不作为 Capability Provider；状态迁移本身不触发 Inspector，源码和 Graphify 也不能替代业务资料或已确认业务预期。
<!-- end-delegates -->

## 4. 阶段一：资料输入与测试设计

### 4.1 可接受的输入

- 需求文档、产品说明书、研发设计文档。
- 页面 URL、原型地址、页面截图、App 截图。
- 接口文档、请求响应样例、已有人工测试用例。
- MQTT Topic、设备物模型、告警规则、失败报告。

资料应放入 `sources/` 对应目录，或在对话中明确提供文件路径、URL、版本和适用环境。

`sources/` 的读取顺序为“扫描目录与 manifest 元数据 → 读取当前项目受控章节索引 → 按本次需求筛选命中文档与章节 → 按需读取原始资料和视觉内容 → 在设计索引中回链”。原始资料变更导致索引 SHA-256 不一致时，索引视为过期，不得继续用于确认需求；重新索引后按变更影响规则复核。新增或直接提供的资料可先登记为带 SHA-256 的请求内来源；只有需要跨请求复用时才登记到 `sources/manifest.yaml`。仅浏览目录、manifest 或章节索引不等于已读取资料正文。

### 4.2 Agent 输出测试设计索引

<!-- delegates: automation.testcases -->
设计索引、追溯和正式决定字段只按[用例规范](./testcase-guideline.md)生成：运行意图与正式决定行保存为运行档案 `.local/test-runs/<type>/<project>/<request>/plan.md`，稳定设计资产（`cases.md` 用例与 `design.md` 台账）保存在套件目录并随 Git 提交演进。一次运行的 `candidate-generation` 产出运行 `plan.md`、套件 `cases.md` 与 `design.md` 增量，流程层不得创建计划确认或在 REQ/RULE/case 之间等待用户。Excel 只在 reviewer 收敛后由宿主按需生成到运行档案，不属于候选事实或工作流历史。
<!-- end-delegates -->

### 4.3 环境处理

<!-- delegates: automation.environment -->
环境候选、优先级、预检、生产保护和数据授权只按[环境规范](./environment-guideline.md)处理。设计期未决事实进入用例确认，执行权限进入执行清单确认，不创建额外固定环境确认阶段。
<!-- end-delegates -->

### 4.4 阶段审核门槛

`candidate-generation` 后由 `candidate-gate-v1` 一次完成结构、关系、完整度、敏感值与数据词汇检查。确定性门禁失败时回到生成分支自动修订，不把格式、字段、来源摘要或关系缺口交给 reviewer 或用户。只有收敛后的 `case-confirmation` 可以请求用户决定。

## 5. 阶段二：测试用例

按[用例规范](./testcase-guideline.md)的单一 `cases.md`、原子用例和 `REQ ↔ RULE ↔ caseId` 标准，一次生成覆盖当前请求全范围的候选用例集。对用户的确认视图必须同时包含全部用例编号与标题、实际来源、范围和数据/安全边界、待确认项及最新评审结论。用例确认前不得进入工程层；评审质量、缺口处置和变更影响只由用例规范定义。

### 5.1 多角色隔离评审

新精简流程冻结 `candidate-gate-v1` 和 `review-policy-v3`。`deterministic_only` 不创建 reviewer 事件；`combined/impact` 只由语义风险触发。硬缺口在 reviewer 派发前一次性返回。适用角色、发现项和可提交标准只由[用例规范](./testcase-guideline.md)定义。

批次输入由 manager 从 `plan.md`、定义声明的用例集和计划实际引用的受控/请求内来源读取并计算，调用方不得注入摘要。`review-input-snapshot-v2` 同时冻结完整资产摘要、语义输入摘要和角色输入摘要；`review-batch-scope-v3` 冻结 epoch、语义演进轮次和角色 scope。reviewer 记录、workflow、工程和报告区块不进入语义输入。新 v3 的 `combined` 读取语义触发的相关 case，包括因冲突或待确认而触发的 light case；`impact` 读取写入/strict case 及安全邻域。旧 v2 批次保留原风险筛选规则。

每次 `reviewer-dispatch` 和 `reviewer-submit` 都必须携带宿主创建真实只读子 Agent 后返回的 `agentTaskId`。该标识必须与主 session/thread 不同，只写 runtime；提交前 manager 必须验证同一 `batchId + activityId + role` 的 running binding。新 `ReviewerSubmitted` 只持久化不含标识的隔离证明版本。缺少绑定、runtime 丢失或绑定不一致时不写提交事件，gate 输出 rebind；durable 派发已成功但 runtime 写入失败时仍只保留一次派发。旧 history 继续回放，但缺少新隔离证明的旧批次不能冒充修复后的真实隔离证据。

初审批次默认覆盖当前草案的完整适用范围；自动演进后的批次优先使用定向复审。每个定向 scope 必须绑定 `affectedRefs`、`baseBatchId`、复审原因、明确排除引用，以及所有未重审角色的可复用 `ReviewerSubmitted` 证据；缺少任一未重审角色证据时安全失败，不能把“未派发”视为沿用通过。只有变更跨业务域、触及共享规则邻域、数据/执行边界或安全影响，或者无法证明局部影响时，才扩大受影响引用或回到完整适用评审。

`case-review-resolution` 只登记 reviewer 正式结论和发现项，不得修改测试范围、`REQ/RULE`、规则台账关系、用例正文或工程内容；越权候选必须在原子发布前拒绝。resolution 汇总发现项时按[用例规范](./testcase-guideline.md#5-候选门禁与评审)把处置分为结构修复、语义演进和需用户裁决：结构/确定性发现走确定性修正并重跑门禁校验，不消耗语义演进轮次，也不扩大批次作废范围；只有语义发现驱动演进与定向作废。需要修订时，`case-review-evolution` 只在当前设计范围内自动修订；步骤、前置、预期、`REQ/RULE` 或业务语义变化只失效 `combined`，操作、权限、数据策略、OTP、cleanup、reconciliation 或未知结果变化只失效 `impact`，同时改变场景语义时才两者失效。新 v3 同一 epoch 最多一轮自动语义演进；lean reviewer 一次失败后登记告警并进入同一次用例确认，strict reviewer 可重试一次，仍失败则阻止执行。旧 v2 history 仍按其原有最多两轮策略回放。工具失败重试和确定性修正不消耗语义演进轮次；新正式决定或来源证据建立新 epoch。资料冲突或验收未定义并入同一次用例确认，不创建独立 callback。评审批次在途时不得变更其输入快照覆盖的 `plan.md`/`cases.md` 产物（包括派生索引重建与决定行追加）；确需变更时先显式作废当前批次并立即重派，不得等待在途 reviewer 被输入漂移作废形成空窗。

## 6. 阶段三：自动化可行性、脚本设计与代码定位

本阶段仅在用例集已确认后开始。主 Agent 根据已确认用例选择对应技术实现：

| 测试类型 | 实现方式 |
| --- | --- |
| Web / H5 | Playwright |
| 原生 App / WebView | Appium + WebdriverIO |
| API | TypeScript API Client |
| MQTT | mqtt.js Client |
| IoT 链路 | API、MQTT 与 Web/App 组合 |

请求专属历史脚本只允许保存在对应 `testcases/archive/.../automation/` 子目录，默认不得读取、编译、执行或作为新脚本生成参考。共享 action、client、fixture、support 和 Runner 不归档；需求资料、运行产物、凭据和 `.local/repositories/` 中的被测代码不得进入归档。

先将 `.local/repositories/` 作为本机代码仓库根目录，根据已确认项目和用例定位对应仓库；不得以名称相似为由扫描无关仓库。仓库路径、Graphify 图谱和源码定位依据只能写入当前测试请求的 `plan.md` 工程层，不得写入 `sources/manifest.yaml`，也不得作为业务需求或验收规则来源。选定仓库后，**在读取业务源码前**检查是否存在有效 Graphify 图谱：`graphify-out/` 与其中相互关联的 `.graphify_root`、`GRAPH_REPORT.md`、`graph.json`、`.graphify_analysis.json` 或带 Graphify 标识的清单文件。通用 `manifest.json` 不是单独的图谱证据。

有效图谱存在时，先读取报告、清单和源文件路径/实体/关系索引，以已确认需求、页面路径、接口、模块或领域名定位候选源码；再读取候选源码及必要直接依赖确认实现。图谱缺失、损坏、过期或无法唯一定位时，记录原因，回退到仓库结构、项目文档、路由/API 定义和受限文本检索。图谱只用于缩小检索范围，源码和已确认需求才是事实依据；不得读取或回显 `.env`、凭据、会话或其他敏感配置。

在生成正式脚本前，必须在同一测试请求的 `plan.md` 补充“工程层：代码定位与自动化设计”区块，并检查已有的 `src/actions/`、`src/clients/`、`src/fixtures/`、相似测试脚本和可用执行命令。工程设计和预检属于自动 Activity，不额外增加人工门禁。该区块至少包含：

- 每个 `caseId` 对应的需求追溯编号、代码仓库、分支/提交标识、图谱路径及其新鲜度判断、源码路径和定位依据。
- 可复用 action、client、fixture、selector/接口契约，以及按 [environment-guideline.md](./environment-guideline.md) 确认的数据策略、台账引用、准备和清理方案。
- 自动化可行性结论：`可实现`、`部分自动化`、`受阻` 或 `需求/代码差异待确认`，以及依据和恢复条件。
- 拟修改或新增的脚本文件、执行命令、目标环境、预期报告位置、风险、假设及仍未满足的前置条件。

用例已确认，且已确认版本的源码、组件状态或接口契约足以推导业务步骤时，即可登记完整的正式候选脚本。零写入无法穿越保存、注册、提交等边界时，允许生成 `runtime_validation_pending` 脚本：正文必须包含边界前完整步骤和边界后明确候选实现，manifest 必须登记 `reachableBoundary` 和 `pendingCapabilityIds`。目标环境部署、运行时 selector、OTP/fixture、已实现 provider、资源预算和实际 cleanup 能力当前不可用时，应在 `readiness` 将受影响 case 标记为 `deferred`；引用未实现 provider 则是 `invalid` 并返回 build 修复。两者都不得将候选脚本改成固定阻断占位。只有缺少真正生成依据，例如无法确定 UI 主路径、业务动作或可观察预期时，才保持 `build` blocker。

`build` 的确定性门禁包括项目感知的 TypeScript 编译、完整且唯一的 `caseId` 映射、敏感字面量扫描、每个 case 的 `requiredOperations`/`operationBudgets`/`dataWritePolicy`/`implementation` 声明及正式 source gate。新生成的请求级候选只接受 `formal-execution-manifest-v3`；受控晋升会将其物化为带 `suiteId` 和不可变来源请求的 `formal-execution-manifest-v4`，稳定套件直跑只接受该 v4。两者的每个 runnable case 都必须声明与已登记资料或正式用户决定绑定的业务 Oracle，并以 `verifyBusinessOracle()` 产生结构化结果。参数化用例必须为每个 `dataId` 冻结一个 `instance-dNN` Oracle，source contract 绑定该数据行的独立预期；父 `caseId` 仍是唯一 runnable 与统计单位。source gate 必须拒绝空 callback、纯 guard、固定 `blockForMissingContracts`、仅 capability 检查、action-only、`addAssertion()`-only、人工构造 Oracle 结果或无条件结束的实现。每个外部操作的数量上限必须按 case 冻结，Runner 在真实操作前以脱敏幂等 key 原子预留；同 key 恢复不得重放，超出上限必须停止。条件性运行时保护可以保留，但不能代替可审查的业务正文。真实写入与下游验证仍只能进入执行清单确认后的正式 `run`。

正式脚本身份必须使用同一候选依赖闭包解析器贯穿脚本评审、授权发布、Runner 和 completion finalize：入口 manifest 与全部 `*.formal.spec.ts`、同请求 helper 以及递归导入的 `actions/clients/env/web/test-assets` 等本地运行依赖都进入 reviewer 输入和 `scriptDigests`；`import type` 不属于运行闭包。直接导入的 `src/support/formal-execution/` Runner 模块按 runtime leaf 冻结其文件字节但不递归展开基础设施全图，避免把共享治理实现重复计入每次业务评审。候选闭包中的未解析依赖、非字面量动态导入、路径或 realpath 越界，以及授权后新增、删除、遗漏或摘要漂移的 formal spec/helper/runtime leaf 都是 invalid input；finalize 必须在动态加载 manifest 前完成同一精确闭包校验。

### 6.1 统一执行清单与范围重开

`direct_execute` 的 readiness 使用 `suite-readiness-publish` 重新检查真实能力和资源池，并从 suite manifest 派生 `execution-authorization-v5`。`affected_rebuild/full_replan` 使用 `execution-readiness-publish` 执行项目编译、source gate、敏感信息、reviewer 证据和真实运行依赖检查，并发布 `execution-authorization-v4`。新 v3 重建分支只在环境为 test/pre、全部 runnable case 均为 `read_only + no_write`、无 deferred、无上传/提交/OTP/安全挑战/权限/设备动作、脚本操作与 case 策略一致且能力全部通过时，由 `policy_auto_no_write_v2` 自动授权。预配专用测试账号、CI Secret 或已保存会话可用，但不得回显敏感值、发送 OTP 或创建新认证副作用。任一条件无法证明时自动降级为用户确认清单；生产和业务写入永不自动授权。两种授权都必须绑定目标构建、readiness 摘要、每 case 权限/操作/数据策略/资源依赖、脚本闭包与能力证据。

`readiness` 只复核真实运行条件：账号、OTP 通道、远端 fixture/动态测试数据、外部观察器、Runner adapter、资源池租约与已授权替代预算。ARIA、selector、浏览器响应解析、源码契约，以及已纳入 Git 的静态测试资产与本地确定性生成器都属于冻结 `buildEvidence`，不是 Capability Provider。新 manifest 使用 `requiredTestAssetIds` 关联资产，并用 `test_asset` 证据冻结 `assetId`、路径和实际 SHA-256；资产缺失、非 active、项目/平台/范围不匹配或摘要漂移直接作为 `invalid build` 返回，不能降级为 capability unavailable。资源池暂时为空但清单已授权惰性创建时可 runnable；既无合格资源又无创建预算时才 deferred。这些状态不得将已有实现的 case 改为空脚本或固定 blocker。

请求级 v3 build identity 同时冻结 Oracle 契约、来源索引与全部 build evidence 内容摘要。请求内来源 SHA 变化时，先通过 `SRC → RULE → caseId` 计算局部失效；映射完整时只重建关联 RULE/case，映射不完整或全局边界漂移时才 `full_replan`。稳定 v4 对 JSON build evidence 使用去除 `targetBuildDigest`、采集时间等易变字段后的语义摘要；静态测试资产始终使用原始文件摘要。evidence 路径与 `sourceFiles[]` 必须在 `realpath` 后仍位于工作区，且声明摘要与真实文件一致。`formal-execution-manifest-v3` 只与 `execution-authorization-v3/v4` 组合，稳定 v4 只与绑定 `suiteId/suiteVersion` 的 `execution-authorization-v5` 组合。Runner 在启动和封印前都必须重算身份。脚本、Oracle、相关来源或 build evidence 语义漂移仍为受影响范围的 `invalid input`，不得降级为 deferred，也不得从 CLI 接受人工摘要覆盖。历史授权只读回放，不得用来启动或封印新执行。

只有整条 case 从第一阶段启动就必需的真实运行能力才能放入用例级 `requiredCapabilities`；某个可选参数、精确边界样本或后续分支专用条件不得延期同一 case 的其他独立等价类。资料给出数值阈值但未定义十进制/二进制等单位换算时，优先使用对所有合理口径都成立的明显低于与明显高于代表值；精确等号、相邻一单位等无法定案的边界只记录为未断言，不得虚构口径，也不得阻塞格式、非法值和明确区间场景。

多阶段用例的 readiness 只判断第一阶段能否开始。后续阶段才需要的审核状态、测试账号、通知确认或状态 fixture 必须在 manifest 中绑定 `checkAfterTransitionId`，不得提前把整条用例延期。`buildExecutionDependencyPlan(manifest, selectedCaseIds)` 只从 `producesResources → requiredResources` 和同一基线的唯一资源池生产者推导有向无环图，不允许再声明 `dependsOnCaseIds` 或依赖文件发现顺序；未知生产者、多生产者歧义、未授权生产者和循环均是 `invalid build`。当前清单内存在可启动生产者时，消费者与生产者一同进入 `runnableCaseIds`，并分别展示 `initialRunnableCaseIds`、`scheduledCaseIds`、`executionWaves` 和确定性 `graphDigest`；只有生产者、资源池和已授权创建预算均不存在时才 deferred。执行清单必须展示依赖路径和外部转换摘要，但转换仍属于同一次执行授权，不新增 callback。

`run` 遇到真实外部状态转换时，先完成当前波次并持久化新执行使用的 `formal-execution-record-v3` 阶段检查点，再以 `external_transition_required` 的 `BlockerRaised` 释放 Runner lease。旧 v1/v2 record 只读回放，不能追加检查点或封印。用户只提交 manifest 允许的结果和布尔脱敏证明；`execution-transition-resolve` 验证检查点摘要后用 `BlockerResolved` 恢复同一 Activity、同一授权和同一测试数据 run。已完成阶段和外部写入不得重放。一次只解除部分转换时先执行已满足分支，其他转换在下一波次继续等待。等待审核属于可恢复暂停，不得把宿主长期任务标记为阻塞终态。

等待中的 external transition 一律使 settlement 返回 `parked`：Runner 只能关闭进程级 BrowserServer 和 Capability Provider，不得调用业务资源 cleanup、结束 test-data run 或把未知清理写成成功。转换解析后，Store 只为同一 case 建立新的 pending attempt，并从冻结 checkpoint 继续；不得恢复为旧 blocked 终态、重复已完成阶段或重放写入。没有等待转换时才进入 terminal settlement，并以 cleanup 返回的结构化资源摘要判定数据卫生，不能用“没有抛异常”代替成功。清理未闭环时保持已经形成的功能结果，自动为 `run` 登记确定性数据卫生 blocker；恢复后只重做 settlement/finalize，不重跑已完成 case、阶段或写入。BrowserServer 关闭、settlement、Capability Provider 清理和制品扫描按此顺序分别捕获错误，任一阶段失败都不得跳过后续阶段。

短信 OTP 的页面内人工输入不等同于跨回合外部状态转换：当用例以 `ui_state` 声明 `send_test_otp` 时，Runner 在一个显式 `--headed` 会话内保持 Context/Page，用户直接在受控页面输入，脚本通过输入状态自动继续。该等待不新增 callback、不释放浏览器、不轮询模型，也不将验证码持久化。未以 `--headed` 启动时必须在发送前失败关闭。

Provider 只能表示已有真实可调用实现的外部运行时依赖，例如受控 OTP 通道、惰性 fixture setup、无 UI 可观测面的异步终态查询或幂等 cleanup。用户在页面上可直接观察的字段值、只读性、角色、路由、消息、列表和已消费响应必须由正式脚本使用 DOM/ARIA、文本、页面状态或浏览器响应直接断言，不建 Provider。注册表中不存在的 `providerId` 是 manifest/build 配置错误，受影响用例为 `invalid`；只有 Provider 已实现但当前环境证据不可用时才是 `deferred`。

无法用稳定结构断言表达的布局、图表、图像或组合可见状态，可截取脱敏的最小元素区域交给宿主模型按冻结 rubric 审查。这是 UI 证据的最后兜底，不是 readiness Capability，也不能替代 OTP、fixture、异步后台终态、短信送达、唯一资源身份或 cleanup 证据。当前宿主没有可编程图像审查工具时，不得声称模型已自动判定；应先使用 DOM/ARIA 或确定性视觉基线，否则保留真实 build blocker。

Web/H5 的 `targetBuildDigest` 必须直接读取 manifest 引用的冻结 selector 证据；调用方可传入同名参数作为兼容校验，但必须与证据中的完整 SHA-256 严格相等。来源缺失、多个证据互相冲突或参数不一致属于 readiness 的 `invalid input`，必须在 Capability Provider 评估前停止，不能把所有 case 降级为 deferred。诊断必须同时输出证据路径、证据完整摘要和调用方完整摘要，禁止只显示相同的短前缀。

每个实际外部写操作由 manifest 冻结 `operationEvidence`：能以稳定可见终态定案时使用 `ui_state`；同步最终响应使用 `response_contract`；响应通常可定案但允许一次异常查询使用 `response_with_query_fallback`；只代表受理的异步响应使用 `response_then_query`；其他情形使用 `query_only`。截图和 ARIA 不单独证明后端写入，但已评审的 UI 最终状态可以作为用户可见结果证据。响应缺失、重复、契约漂移或稳定身份缺失时结果为 `unknown`，冻结相同 intent 并进入 reconciliation；`ephemeral_cleanup` 需删除或基线恢复证据，`reusable_fixture` 需晋升/租约/归还证据，`tracked_residual` 仍需稳定脱敏身份、正数预算和 TTL。

- 确认后的清单内操作不再逐项询问；Runner 启动时重新校验摘要、环境、能力证据和预算。
- 计划、脚本、环境、允许操作、资源类型或数量发生实质变化时，旧清单摘要不再有效，必须重开工程范围并重新发布，不能继续执行。
- 已到执行确认门禁或已进入其下游执行/报告分支的请求需要扩大或修复范围时，只能通过 `execution-scope-reopen` 使 `build` 及其下游失效并重新进入工程设计；history 保留旧确认、旧 blocker 的解除记录、需求、用例与 reviewer 结论，不持久化平行的 `superseded` 状态，也不允许手工改 history 或派生状态。
- 切换生产环境、使用真实用户数据、执行不可逆高风险动作或超出清单上限必须重新确认；安全挑战进入绑定当前执行事务的阻塞，解除后恢复同一运行。
- API 或管理页面仅用于后台状态验证。二者都不可用时，只阻塞对应后台断言，不得把已执行的 UI 注册路径伪装成未执行或成功。

运行模式、数据策略、创建意图、TTL 和残留状态的唯一规则见 [environment-guideline.md](./environment-guideline.md#61-运行模式)，本节不重复维护。

### 6.2 定位漂移回退、重新授权与续跑

<!-- delegates: automation.selectors -->
哪些 Web/H5 定位差异属于可自动修复漂移、候选如何零写入验证以及哪些策略必须拒绝，只按[定位规范](./selector-guideline.md#81-正式执行中的定位漂移识别)判断；本节只定义满足资格后的 workflow 回退、恢复、重新授权和结果沿用。
<!-- end-delegates -->

v7 正式 Runner 遇到受控定位失败时，将脱敏的 `selector-repair-incident-v1` 写入当前执行的 Git 忽略产物目录，并把 attempt 终结为 `unknown`，而不是产品 `failed`。Runner 继续执行无依赖的其他用例，最后完成 cleanup 和数据卫生收口。只有全部 terminal `unknown` 都一一对应合格 incident、旧执行摘要/目标 build/冻结源码仍一致且数据卫生为 `clean/reusable/retained` 时，`task:resume` 才派生 `continue_now`，自动回退脚本阶段并应用最小 AST 补丁；混入其他 unknown、incident 或源码漂移、候选冲突、未决转换或数据卫生未收口时保持 `action_required`，不得改脚本。

显式恢复使用现有入口，不创建平行命令：

```bash
npm run task:manage -- execution-scope-reopen \
  --request <runRequestId> \
  --selector-repair <incident-path>
```

该入口先校验 incident、旧 formal record、原授权摘要、目标 build、脚本摘要、源码位置和副作用状态，再以 `ActivitiesInvalidated` 写入脱敏修复摘要，使 engineering/build 及其全部下游失效；适用的用例确认、需求关系和 reviewer 事实保持不变。源码修改只允许发生在 incident 冻结的 AST 字符串字面量；修改后必须重新完成源码门禁、唯一性/可操作性零写入验证、脚本 reviewer、build 和 readiness。补丁后摘要保证恢复幂等；已应用、重复回调或过期 incident 不得造成二次修改。

脚本摘要变化必然生成新的 `execution-authorization-v4`。新清单的 `repairContext` 纳入确认摘要，展示修复原因、incident 摘要、原/新定位、完整 case 范围、`affectedCaseIds`、依赖闭包形成的 `retryCaseIds`、可沿用结果以及操作/预算/环境/安全边界是否变化；旧清单和 callback 不再有效。用户重新接受执行清单后才能续跑，取消则停止；定位修复不重新确认测试用例。

新 `formal-execution-record-v3` 始终覆盖新清单的完整 case 集合。仅可沿用未受影响且终态为 `passed`，或已有确定产品结论的 `failed`：用例、Oracle、formal manifest、执行边界和脱敏证据摘要必须未变化，旧数据卫生必须已接受，且不存在 waiting transition。`unknown/blocked/skipped` 不沿用；资源生产者与待重跑消费者位于同一命名资源连通分量时一起重跑。沿用只复制结论、最终 attempt、数据证据和来源摘要，不复制旧租约、operation reservation、运行句柄、阶段进度、资源句柄或 cleanup 状态。

`direct_execute` 没有可变 build，定位漂移必须创建后续 `affected_rebuild`；需要改变步骤、预期、Oracle、业务规则、权限或写入边界时退出定位修复，回到适用的用例确认。v5/v6 历史仍按原 definition 恢复，不应用本节的自动回退。

v7 `task:status` 仍只显示“用例设计、脚本、执行、报告”四个用户阶段；定位恢复期间额外派生“incident 已记录，待安全回退 / 脚本修复中 / 等待新执行清单确认”子状态。该子状态从 history 和 Activity 计算，不新增状态文件或写回 `plan.md`。

### 6.3 自动化规范差异的简短告知

代码仓库、页面、接口、环境或现有测试能力不符合本工程规范时，主 Agent 必须在本轮回复中向用户给出简短、具体的告知，并在同一 `plan.md` 的工程层“规范差异与用户告知”表留下可追溯记录。不得只说“代码不规范”“无法自动化”或“需要优化”。

告知固定为一至三句，按以下顺序说明：**问题类别和具体事实 → 受影响 `caseId` 与自动化影响 → 最小处理建议或需用户确认项**。事实必须来自已读取的代码、DOM/ARIA 树、接口契约、配置或运行证据；无法观察时明确写“证据不足”，不得猜测研发原因或归责。

| 问题类别 | 必须明确的事实示例 | 自动化处理 |
| --- | --- | --- |
| 可访问性/定位 | “提交按钮没有可用的 ARIA role/name 或关联 label，且没有稳定 `data-testid`；当前候选定位不唯一。” | 记录受影响 `caseId`；建议补充语义或 `data-testid`，或说明受限 XPath 的风险；结论为“部分自动化”或“受阻”。 |
| 测试契约/接口 | “接口响应未提供已确认断言所需字段，或字段语义与资料不一致。” | 记录契约证据，标为“需求/代码差异待确认”，退回业务层确认。 |
| 复用能力 | “现有 action/client/fixture 无法覆盖该已确认流程，且新增实现依赖未确认的业务操作。” | 说明缺少的能力和最小新增范围，待用户确认设计后再实现。 |
| 数据、环境或权限 | “缺少隔离测试账号、设备状态或非生产环境，无法满足用例前置条件。” | 标为“受阻”，说明需要提供或恢复的最小条件；不以生产或真实数据替代。 |
| 仓库或代码定位 | “未能将已确认项目唯一映射到 `.local/repositories/` 下的仓库”，或“图谱和受限检索均无法定位候选实现”。 | 记录确认依据和已排除范围，请用户确认仓库或补充模块/路由/接口信息。 |

示例：`问题：可访问性/定位不符合规范——创建按钮缺少唯一 ARIA 名称和 data-testid，DOM 中有 2 个同名按钮。影响：OPEN-PRODUCT-001 暂不能形成稳定脚本。建议：为目标按钮补充 data-testid="product-create-submit"；确认前自动化结论为“受阻”。`

## 7. 阶段四：测试执行与报告

正式执行前必须确认：

- 测试用例已确认，脚本评审已通过，统一执行清单已确认且摘要仍有效。
- API、MQTT Broker、测试账号、测试设备或 Appium 服务可用。
- 已按 [environment-guideline.md](./environment-guideline.md) 确认环境、数据策略和执行前置条件。
- 所需敏感配置来自本地 `.env`、环境专用 `.env.*` 或 CI Secret，未写入代码和日志。

Web 正式执行默认复用 Runner 持有的 browser process，但每个 case 使用独立 Browser Context/Page；只有 manifest 声明且通过校验的 `PageSessionGroup` 可以复用会话。共享组由 worker 级 session pool 持有，每条 `formalCase` 仍独立开始/收口证据；通过的组内 case 连续复用页面，页面关闭、路由偏离或 Playwright 因失败重启 worker 时重建该组，不能承诺保留失败现场。Runner 按冻结 manifest 动态计算拓扑波次，只向 Playwright 传入当前已解锁的 `caseId`；仅当前波次包含同一共享组的多个 case 时强制单 worker，不得因后续波次可能复用页面而把整个 run 永久串行化。写入或独占资源链保持串行；互不依赖且隔离成立的只读节点最多使用两个 worker。fixture 按 runnable case 惰性加载，cleanup 在 Runner 的 `finally` 中按本次 ledger 实际创建资源执行；普通断言在 case 内完成，只有写入、异步事件、设备状态或最终一致性场景执行外部 postcondition。安全挑战和已声明的真实外部业务状态转换允许在同一运行中暂停人工接管，解除后从持久化阶段检查点继续，不重新创建资源或重复业务操作。

发送 OTP、上传、提交或等待人工输入前，脚本必须先完成该阶段之后仍会使用的确定性控件预检：唯一性、可见性、可操作容器和已知静态状态均须在副作用发生前验证。预检不得执行真实写入，也不得把尚未满足业务前置条件造成的按钮禁用误判为脚本失败。这样，定位或组件封装错误应在验证码发送、文件上传和提交 intent 之前暴露；已进入人工输入阶段后，不得因尚可提前发现的 selector 错误关闭页面并要求用户重做。

每一波结束后，Runner 只从当前 `formal-execution-record-v3` 读取已完成阶段和已确认命名资源：阶段资源一旦由生产者使用 `publishResource(name, ledgerResourceId, evidence)` 登记，即可解锁消费者，不必等待生产者整个 case 终态；无身份的兼容证据仅可用 `confirmResource`，不得向需要本地资源句柄的消费者伪造身份。`consumeResource(name)` 只能返回当前授权、当前环境、当前 run 且由本机 Runner 登记的句柄，真实 ID、手机号、OTP 和凭据不得进入 history、授权或报告。生产者失败只阻塞其后代并保存根因路径，其他分支继续；没有可执行节点时合并全部当前可达外部转换一次请求，既无转换又有未完成节点才判定依赖死锁。

正式 Runner 不启用失败即停；worker 并发与隔离只按[环境规范](./environment-guideline.md#61-运行模式)决定。一个 `caseId` 失败后继续执行所有无依赖用例；只有缺少已声明能力或未精确确认前置资源的消费者进入 `blocked`。v3 case 只有在全部必需 Oracle 为 `satisfied` 时才能 `passed`，任一 `violated` 形成产品 `failed`；观察不可定案、未类型化异常或 worker 中断形成 terminal `unknown`，不得伪装为产品失败。产品 Oracle 失败不得批量改写为 `skipped`，也不得阻止执行事务汇总所有可执行用例；仍有 `blocked` 或 `unknown` 时，执行事务保持可恢复阻塞。

terminal settlement 完成后，`execution-run-finalize` 只有在正式记录的 request、环境、manifest、目标构建、执行 subject、runnable/deferred case 集一致，且不存在 `unknown`、等待转换或未接受的数据卫生状态时，才建立幂等 completion seal 并关闭 `run`。`failed`、`blocked` 或 `deferred` 是可封印的真实产品/范围结果，不得伪装为全范围通过。`execution-report-finalize` 只能由同一 seal 确定性重建并发布授权摘要目录中的 `run-summary.json` 与 `execution-summary.md`；其 evidence 必须与 `run` 一致，`report` 的 `ActivitySucceeded` 与 `WorkflowCompleted` 在同一次原子追加中提交。seal 后正式 case、cleanup、能力、资源与证据均不可继续写入；需要改变结果时必须建立新的授权运行。

terminal `unknown` 是“尝试已结束但业务结果无法可靠定案”，与尚未结束的 pending attempt 分开保存。它仍禁止 seal 和 Workflow 完成；专用 finalize 必须为 `run` 登记绑定当前 execution subject 的确定性 outcome blocker 并 park。通用 success、普通 reconciliation、手工 blocker resolve 或 CLI 结论参数不得清除该 blocker；只有同一冻结授权下的新可信 attempt，或重新 readiness/授权后的新 run 才能进入专用 finalize。阻塞、unknown 或数据卫生未闭环退出码为 `2`；产品 Oracle 失败或已证明的脚本/基础设施失败为 `1`；全部正常为 `0`。

统一正式入口为 `npm run test:execute -- --request <type/project/request>`；Web/H5 兼容入口为 `npm run test:web:execute -- --request <type/project/request>`。两者仅接受同一授权的 `--resume` 和显式调试用 `--headed`，拒绝用户提供 `--grep` 或文件路径；case 子集只能来自不可变执行清单。尚未实现正式 adapter 的 App/API/MQTT/IoT 必须在 readiness 保持 deferred，不得回退到未治理的普通命令。

执行产物统一保存到 `artifacts/`；目录、逐用例证据强度、脱敏和结果资格只按 [report-guideline.md](./report-guideline.md) 判定，不在流程规范重复定义。

执行失败不等同于产品缺陷；需要进入失败分析阶段。

### 7.1 报告交接

<!-- delegates: automation.reporting -->
执行结束后，将实际脚本结果、环境与数据处理结果交给 [report-guideline.md](./report-guideline.md) 完成范围判定、正式证据、结果统计、最终进度展示和复盘；流程规范不重复定义结果或证据资格。
<!-- end-delegates -->

## 8. 阶段五：失败分析与持续改进

失败类别和判定只按[失败分类规范](./failure-classification.md)执行，证据、结果统计、修复建议和复盘字段只按[报告规范](./report-guideline.md)执行。流程层只保证测试失败仍进入报告 Activity；清理失败、残留未知或副作用不确定时进入 reconciliation，不能直接完成工作流。报告后的实施或复测属于新的明确请求，不是本 run 的固定确认门禁。

## 9. 停止条件与升级处理

出现以下情况时，默认只阻塞直接受影响的 Activity 或能力分支；只要仍有依赖已满足且不受影响的自动 Activity，就必须继续执行。只有不确定性决定整个请求的范围、共享验收基线、公共环境或安全授权，或者继续任何分支都会造成未授权或不可逆风险时，才能阻塞整个请求：

- 目标环境、业务预期或关键前置条件无法确认：阻塞依赖该事实的用例或能力分支；只有目标环境或验收基线对全请求共享时才升级为全局阻塞。
- 缺少测试账号、测试设备、APK、接口鉴权或 MQTT 连接信息：仅阻塞使用该资源的执行分支。
- 推断内容会影响断言、环境选择、数据写入或高风险操作，但用户尚未确认：仅阻塞依赖该推断的 Activity。
- 目标为生产环境，或可能删除真实数据、控制硬件、批量修改设备：阻塞相关执行分支；若授权或安全边界无法隔离，再阻塞整个请求。

暂停时由 gate 返回实际受影响范围、已完成内容、`assumptions`、`missingInfo`、风险和最小解除条件。动态阶段与进度只由 `task:status` 展示，不写回 `plan.md`。

## 10. 最小交付清单

`full_replan` 确认全部用例和不可变执行清单；`affected_rebuild` 只确认受影响用例，再确认本轮执行清单；`direct_execute` 不重复确认设计。资料冲突、未定义验收和用户修订统一进入用例确认，安全挑战仍按执行事务的最小人工接管处理。动态状态只由 `task:status` 展示。
