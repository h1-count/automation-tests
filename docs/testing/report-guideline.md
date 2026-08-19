# 测试报告与失败分析规范

<!-- owns: automation.reporting -->

## 1. 目的与适用范围

本文规范 Web、App、API、MQTT 和 IoT 链路自动化测试的结果采集、报告生成、失败证据、脱敏和 Agent 失败分析流程。

测试报告用于说明“执行了什么、在哪个环境执行、结果如何、证据在哪里、下一步做什么”。报告不是产品问题结论本身；失败必须结合证据进行分类和审核。

项目强制规则以 [AGENTS.md](../../AGENTS.md) 为准；整体 AI 工作流见 [automation-guideline.md](./automation-guideline.md)。

## 2. 报告原则

- 每次执行形成一个测试运行快照，必须可追溯到已确认的测试计划及其工程层设计区块、原子用例编号、用例包路径、目标环境、脚本版本和执行命令；运行快照不得改写用例定义。
- 稳定套件复测的报告必须同时记录 `suiteId`、`suiteVersion`、本轮 `runRequestId`、目标 build 与环境。设计复用不复用旧测试结果；每轮都从自己的 formal record、completion seal 和数据卫生结论重建报告。
- 测试结果、截图、Trace、视频、日志和协议摘要统一放在 `artifacts/`，不得提交到 Git。
- 失败证据必须足以支持失败分类；证据不足时分类为“未知问题”，不能猜测为产品问题。
- 报告和日志必须满足[环境规范的敏感采集边界](./environment-guideline.md#61-运行模式)，只保存完成审核所需的脱敏信息。
- 主 Agent 可读取报告并输出分析、修复建议和 diff。只有流程规范已接受的 v7 定位漂移才能自动回退脚本阶段；其他正式脚本修改或重新执行仍须按适用确认门禁处理。
- 报告必须基于“测试范围完成判定”，不能仅转述 Runner 的通过数。存在阻塞、未知或未执行范围时，结论必须标记为“部分完成”或“未完成”。

<!-- delegates: automation.project-knowledge -->
项目经验的正文归属、登记时机、证据状态、候选关系、覆盖和格式统一由[项目测试经验规范](./knowledge/README.md)定义；报告层只汇总本轮经验处理状态和脱敏原因，不重新定义或延迟其登记流程。
<!-- end-delegates -->

- Playwright 受控探索记录不是正式测试结果；可在报告“测试依据”中以脱敏形式引用，但不得写为通过、失败、跳过或执行证据。
- 报告完成时，面向用户的执行摘要可引用 `task:status` 即时渲染的最终阶段与未闭合项；不得把该视图写回 `plan.md`，也不得用它替代用例结果统计或正式执行证据。

## 3. 报告产物与目录

| 目录 | 内容 | 生成方 |
| --- | --- | --- |
| `artifacts/test-results/formal/<摘要>/run-summary.json` | `formal-run-summary-v2`：逐 case 状态、Oracle 契约/结果摘要、受控分类、范围、测试结论、能力和数据卫生事实。旧 v1 和已封印的 legacy 投影只读保留。 | completion seal 报告生成器。 |
| `artifacts/test-results/formal/<摘要>/execution-summary.md` | 从同一 completion seal 确定性生成的中文摘要。 | completion seal 报告生成器。 |
| `artifacts/test-results/formal/<摘要>/case-evidence/` | 每个已执行 case 的结构化证据索引。 | 正式 Runner。 |
| `artifacts/test-results/formal/<摘要>/selector-repair/` | `selector-repair-incident-v1`：定位失败、唯一候选、副作用证明、影响范围和脱敏证据引用。 | 受控 Web/H5 定位包装器。 |
| `artifacts/playwright-report/` | Web 本地默认可视化报告。 | Playwright。 |
| `artifacts/test-results/junit.xml` | CI 需要时生成的 JUnit 结果。 | CI report profile。 |
| `artifacts/allure-results/`、`artifacts/allure-report/` | 只有趋势分析 profile 才生成的 Allure 产物。 | `AUTOMATION_REPORT_PROFILE=trend`。 |
| `artifacts/screenshots/`、`artifacts/traces/` | 失败、首次重试或明确审计需要的非敏感附件。 | Runner。 |

路径由 Runner 配置统一控制；测试脚本不得自行写入临时目录、用户桌面或仓库外的未受控路径。

## 4. 执行结果标准

每个测试用例必须对应以下结果之一：

| 状态 | 含义 | 报告处理 |
| --- | --- | --- |
| `passed` | v3 用例的全部必需业务 Oracle 都产生 `satisfied`，证据包完整且脱敏状态有效。 | 记录执行时间、环境、Oracle 契约摘要、关联用例和逐 case 证据索引。 |
| `failed` | 执行完成且至少一个已绑定业务 Oracle 产生 `violated`。 | 附 Oracle、失败步骤、安全原因码、证据和 `PRODUCT` 分类；前置、脚本或基础设施失败不得伪装为该状态。 |
| `skipped` | 仅供旧记录回放或已在授权前批准为不适用的历史投影。 | v3 runnable case 禁止由 Runner 写成 `skipped`；应在授权范围形成前通过正式决定移出 runnable 集。能力、数据、依赖或 Oracle 不足必须分别形成 `blocked`、`deferred` 或 `unknown`。 |
| `blocked` | 已持久化且可校验的能力不可用、命名资源不可用或 waiting transition 使执行无法继续。 | 必须绑定对应的非业务事实；调用方原因、普通异常或无事实的 `FormalBlockedError` 不能直接写入该状态，而应保守形成 `unknown`。不得记为产品失败。 |
| `unknown` | attempt 可以已终结，但 Oracle 缺失、`indeterminate`、观察存在歧义、未类型化异常或执行中断，Runner 无法可靠定案业务结果。 | 保留安全证据和分类依据，标记范围部分完成；不得封印或完成 Workflow。 |

禁止通过吞掉异常、无断言结束、默认重试成功或把失败标记为 `skipped` 的方式提高通过率。
任一 attempt 一旦形成 `violated` Oracle，该 case 必须归为 `failed`，即使其他 Oracle 尚未执行；后续 attempt、环境 blocker 或手工分类不得覆盖这一产品结论。公开 `beginCase()` 不能重开任何 terminal attempt，只有受控的安全 retry 或已解析 external transition 可以建立新的 pending attempt。

正式中文摘要以原子结果存储为分类依据，Allure/Playwright 保留原始 Runner 结果。统一授权中的每个 runnable `caseId` 必须在 runner 结果中恰好出现一次；缺失、重复或仍为 `unknown` 都使范围完成检查失败。deferred `caseId` 只出现在 readiness 与确定性报告的延期清单中。依赖框架在运行层显示的跳过不得覆盖运行时能力漂移形成的原子 `blocked`。

### 4.1 逐用例可审计证据包

每个实际进入 runner 的 `caseId` 必须形成一个 `CaseEvidenceBundle`；readiness 已判定为 `deferred` 的 case 不启动 runner，也不伪造证据包，而是在执行摘要中单列 blocker 与解除条件。证据包是报告证据索引，不保存业务凭据或测试数据原文：

```text
caseId
startedAt / endedAt
businessSteps
assertionResults
businessOracleContractDigest
oracleResults (oracleId / ruleRef / observationKind / outcome / evaluationBasis / safe reason / evidenceRefs)
checkpointScreenshots
videoReference
traceReference
sanitizedNetworkSummary
operationEvidence (operation / source / contractId / method / path / status / outcome / finality / fallback / reconciliation)
stageProgress (completedStages / waitingTransitions / resolvedTransitions)
selectorRepairIncident (incidentId / digest / eligibility / safe path)
carriedFrom (source execution / result digest / evidence digest)
sanitizedConsoleSummary
redactionStatus
```

证据按结果和风险按需采集：

- 每个业务操作和断言都用可读的 `test.step` 或等价 Runner 步骤记录；步骤名描述业务动作或可观察结果，不记录输入值、凭据或内部实现细节。
- v3 证据包必须绑定当前 `businessOracleContractDigest`，并为每个必需 Oracle 保存唯一结构化结果。JSON 与中文摘要只展示 Oracle/Rule 标识、观察类型、outcome、平台派生的 `evaluationBasis`、固定安全原因和 evidence refs，不保存 evaluator 提交的原始说明或观察到的业务原值。`addAssertion()` 与手写 operation evidence 不能代替 Oracle 结果。
- 普通 `passed` 只要求结构化步骤、断言结果、耗时和环境/构建摘要，不强制截图、视频或 Trace。
- DOM/ARIA、文本或浏览器响应可稳定判断时，不额外使用模型识图。需模型判断的 UI 证据只保留脱敏最小局部截图、截图 SHA-256、冻结 rubric、结论和不含敏感值的理由摘要；不得保存提示词推理过程，不得将该结论计为后端写入、短信送达或 cleanup 证据。
- 首次失败或重试使用 Playwright `on-first-retry` Trace 和失败截图；`flaky` 同时保留首次失败与最终结果。证据不足时状态只能为 `unknown`，不得猜测失败分类。
- 高风险写入必须保留脱敏的操作 intent 与结构化 `operationEvidence`；根据 manifest 策略记录浏览器响应、响应加查询或后置查询，不强制每次都调用后台查询。证据只保存方法、无查询参数路径、状态码、契约 ID、业务结论、稳定身份是否已观察、fallback 和 reconciliation 状态，不保存响应正文、资源 ID、手机号或凭据。
- Runner 不得把缺少终态结构化操作证据的已执行写入 case 标记为 `passed`。同步最终响应足以定案时不重复查询；异步受理、清理、最终一致性或未知结果仍必须查询或 reconciliation。
- 多阶段 case 在等待外部转换时必须报告已完成阶段、冻结检查点摘要和最小用户动作，不得统计为最终失败或重新执行已完成写入。恢复后报告同一授权下的最终结果；人工证明只登记允许结果、布尔证明摘要和恢复次数，不保存通知正文、账号或业务标识。
- 正式 manifest 中包含密码、OTP、Token 或其他禁止采集区间的 case 必须声明 `evidencePolicy: "sensitive"`；同一批次存在此类 runnable case 时，Runner 对整批关闭截图和 Trace，以安全性优先于混合批次的附件完整度。
- 对[环境规范](./environment-guideline.md#61-运行模式)标记为禁止图像或正文采集的步骤，分割录制并使用步骤前后安全截图、步骤日志和脱敏接口/后台摘要作为替代证据；替代情况必须写入 `redactionStatus`。
- 正式 Playwright reporter 只把通过泄漏检查且位于 `artifacts/` 的附件关联到 `CaseEvidenceBundle`；HTML、JUnit、Allure 和附件在报告收口前统一执行文本清洗与泄漏扫描，无法安全清洗的二进制附件直接删除且不得保留引用。
- `redactionStatus` 只能为“已验证脱敏”“使用安全替代证据”或“脱敏未确认”。值为“脱敏未确认”时不得发布产物，也不得将 case 标记为 `passed`。
- `run-summary.json`、中文摘要和启用的 Runner 报告必须引用同一 `CaseEvidenceBundle`；未启用的 JUnit、Allure、视频或 Trace 不构成证据缺口。
- 定位 incident 只保存原定位、唯一候选、role/容器/状态标识、摘要、计数型副作用证明、影响 case 和脱敏证据路径；禁止保存完整 DOM、带参数 URL、输入值、Cookie、凭据、响应正文或真实用户数据。
- 定位修复后的报告以新执行清单为完整统计范围，每个 case 只统计一次；分别标记 `carriedFrom` 的沿用结果和本次 retry 结果，不把旧 run 与新 run 的同一 case 重复计数。

## 5. 报告最小字段

正式摘要必须分别输出以下三个维度，不能再用一个“已完成”文案互相替代：

| 字段 | 值 | 判定 |
| --- | --- | --- |
| `scopeStatus` | `complete` / `partial` | `failed` 是已完成的产品结果，不降低范围完整度；`blocked`、`skipped`、`deferred`、`unknown` 或 waiting transition 均为 `partial`。 |
| `testOutcome` | `passed` / `failed` / `mixed` / `inconclusive` | 完整范围按已判定的通过/失败组合派生；部分范围只要已有可判定结果即为 `mixed`，完全无法判定才为 `inconclusive`。 |
| `dataHygieneStatus` | `clean` / `reusable` / `retained` / `cleanup_failed` / `manual_required` / `unknown` | 只反映 terminal cleanup 与受控残留，不覆盖功能结论。 |

兼容字段 `complete` 只在 `scopeStatus=complete` 且数据卫生为 `clean`、`reusable` 或 `retained` 时派生为 `true`。completion seal 要求没有 `unknown`、没有 waiting transition、数据卫生已接受，并且每个 runnable case 都有 teardown 后的数据证据；`failed`、`blocked` 与 `deferred` 可以如实封印，但必须展示部分范围或失败结论。Workflow 是否闭环只由 workflow gate 与 `WorkflowCompleted` 表达，报告中的 `complete` 不得替代该事实。

每次测试执行的报告或 CI 摘要至少包含：

- 运行标识、开始/结束时间、执行人或触发来源。
- 关联的测试计划、原子 `caseId` 列表、用例包路径和脚本路径。
- `plan.md` 工程层设计区块、代码仓库路径、分支/提交标识，以及 Graphify 图谱路径与新鲜度判断；图谱未使用时记录原因。
- `TEST_ENV`、环境名称和非敏感目标系统标识。
- 执行命令、Runner、浏览器/设备信息和脚本版本或提交标识。
- 通过、失败、跳过、阻塞和未知的数量。
- 每个失败/阻塞用例的失败步骤、错误摘要、证据路径和分类。
- 每个已运行 `caseId` 的 `CaseEvidenceBundle` 索引、证据完整性和脱敏状态；通过用例也不得省略。延期用例单列 readiness blocker 和解除条件。
- 存在定位修复时，记录 incident 摘要、原/新定位、受影响与重跑 case、沿用 case、原授权摘要和新执行清单摘要；不得展示定位之外的页面正文。
- 多阶段用例的已完成阶段、当前等待转换、恢复次数及最终自动验证结果；待审核、审核通过后晋升、驳回后重新发起和受控残留分别统计。
- 按 [environment-guideline.md](./environment-guideline.md) 汇总测试数据准备、清理结果、台账脱敏摘要与残留风险；不得在报告正文回显资源 ID、合成值或敏感数据。
- 分别输出 `testOutcome` 与 `dataHygieneStatus`：前者只依据可靠的功能断言和范围状态，后者分类汇总已清理的临时资源、已晋升或归还的可复用 fixture、已隔离或退役的异常资源、受控残留、过期和未知归属。逐 run 的 `functionalStatus` 保留为功能事实，不参与数据卫生反推。已登记且基线合格的 `reusable_fixture` 结论为“已登记且可复用”，不记为未清理残留。不得用清理或恢复失败覆盖已判定的功能结果，也不得把功能通过表述为数据卫生通过。
- 最终工作流摘要：引用 `task:status` 的阶段、未完成或受阻 Activity、等待项及最小下一动作。

面向用户的摘要还必须包含：

- 总体结论：已完成 / 部分完成 / 未完成，以及结论适用的测试范围。
- 测试对象或接口数量、计划用例数、已执行用例数。
- 通过、失败、跳过、阻塞和未知数量；通过率与失败率。
- 每个失败、阻塞、未知或未执行项的通俗原因和下一步最小操作。
- 若存在可复用 fixture、数据残留或清理/恢复异常：按 [environment-guideline.md](./environment-guideline.md) 说明关联 `caseId`、脱敏台账摘要位置、晋升/归还/隔离/退役/到期状态和后续路径；分别陈述功能结论与数据卫生结论。
- 确定性 JSON/Markdown 摘要路径，以及本次 profile 实际启用的 Playwright HTML、JUnit 或 Allure 入口。
- 本次复盘状态：用户偏好、项目经验分别为“已更新 / 待验证 / 已验证 / 已覆盖 / 无需更新”，并附不含敏感信息的原因摘要和证据定位。未完成验证不得延迟经验登记，只影响证据状态。
- 正式执行来源：例如 Playwright Chromium、Playwright Chrome、Appium、API Client 或 MQTT Client；并明确列出不计入统计的探索依据。
- 若发生定位修复，明确区分“沿用结果”和“本次重跑”，并说明最终统计已按新执行清单去重。

通过率使用 `passed ÷ (passed + failed)`，失败率使用 `failed ÷ (passed + failed)`。`skipped`、`blocked` 和 `unknown` 不进入通过率分母，但必须单独列出；分母为零时显示“不适用”。Web 测试对象统计页面或用户旅程，API 统计接口，App 统计页面或功能流，IoT 统计已验证链路。

对于生产环境验证，还必须记录审批依据、允许的操作范围和 `ALLOW_PRODUCTION_TESTS` 的启用原因；不得在报告中记录生产凭据。

## 6. 失败证据要求

### 6.1 Web 与 H5

失败时至少保留：

- 失败截图。
- Playwright Trace；环境规范禁止采集的敏感区间按第 4.1 节使用安全替代证据。
- 失败步骤、页面 URL（脱敏后）和浏览器控制台/网络错误摘要（如适用）。

通过时按第 4.1 节保留关键检查点、步骤日志及视频区间或安全替代证据；本节的失败证据是额外要求，不替代逐用例证据包。

### 6.2 原生 App 与 WebView

失败时至少保留：

- 当前页面截图。
- 设备、系统、App 版本、Appium Server 和 context 信息。
- Appium 错误摘要；必要时保留视频。
- WebView 场景额外记录 context 切换结果和 Web 侧证据。

### 6.3 API、MQTT 与 IoT 链路

失败时至少保留：

- 脱敏后的请求方法、路径、状态码、关键响应字段和错误摘要。
- 脱敏后的 MQTT Topic、QoS、消息时间、关键 Payload 字段和消费/入库结果。
- 测试设备别名、等待条件、超时配置和最终断言结果。
- 涉及 UI 展示时，同时保留 API/MQTT 与页面/应用侧的关联证据。

不得记录完整 Authorization Header、Cookie、密码、Token、密钥或未经脱敏的业务敏感数据。

## 7. 失败分类

| 分类 | 判定依据 | 建议后续动作 |
| --- | --- | --- |
| 产品问题 | 环境、数据和脚本前置条件满足，实际业务结果违反已确认预期。 | 提交缺陷或通知研发，附最小复现与证据。 |
| 脚本问题 | 产品行为符合预期，但 selector、等待、断言、测试实现或数据处理不正确。 | 合格 v7 定位漂移按流程规范回退并重新确认执行清单；其他问题输出修复 diff，按适用门禁处理。 |
| 环境问题 | 服务、网络、认证、设备、Appium、Broker 或依赖不可用。 | 修复或恢复环境后复测。 |
| 测试数据问题 | 测试账号、设备、数据前置、清理或隔离不满足要求。 | 调整 fixture、准备/清理脚本或测试数据。 |
| 未知问题 | 证据不足、现象无法稳定复现或多个分类都无法确认。 | 补充日志/Trace/观测点后继续排查。 |

同一失败可提出多个候选分类，但最终报告必须说明主分类、置信度和待确认项。

## 8. Agent 失败分析输出

主 Agent 分析失败报告时，输出应采用以下结构：

```text
执行摘要
- 环境、用例、结果和影响范围

证据
- 报告、日志、截图、Trace、API/MQTT 摘要路径

初步归因
- 分类：产品问题 / 脚本问题 / 环境问题 / 测试数据问题 / 未知问题
- 置信度：高 / 中 / 低
- 判断依据与反证

建议动作
- 复现、补充观测、环境恢复、用例调整或脚本修复建议
- 预计修改文件和风险

待确认项
- 无法确认的信息与需要用户审核的操作
```

当建议涉及正式脚本、环境配置、测试数据或测试面板修改时，必须先输出 diff 或结构化建议，等待用户审核后再实施。

## 9. 报告审核清单

- 是否先完成测试计划、用例与实际结果的范围核对，并给出“已完成 / 部分完成 / 未完成”结论。
- 是否完成复盘：用户偏好仅在存在新偏好时更新 `.local/USER-PREFERENCES.md`；项目经验按唯一责任规范处理，并逐项报告“待验证 / 已验证 / 已覆盖 / 无需更新”及原因。
- 是否提供确定性 JSON/Markdown 摘要，并只引用本次 profile 实际生成的 HTML、JUnit 或 Allure。
- 是否以友好格式给出测试对象/接口数、用例数量、通过率、失败率和未覆盖项。
- 是否关联了正确的测试计划、确认用例、目标环境和脚本版本。
- 是否关联 `plan.md` 中已确认的工程层设计、代码提交和图谱新鲜度判断，且未把图谱作为唯一事实依据。
- 是否完整记录了通过、失败、跳过、阻塞和未知结果。
- 是否为每个已运行 `caseId` 建立完整且可打开的 `CaseEvidenceBundle`；通过用例是否同时满足断言、证据完整性和脱敏资格；延期用例是否只出现在 readiness 与报告的延期清单中。
- `failed`、首次重试和高风险写入是否具备对应强度的非敏感证据；敏感区间是否具备安全替代证据及明确的 `redactionStatus`。
- 失败是否附有足够证据，且分类未超出证据范围。
- 是否泄露密码、Token、密钥、真实用户信息或敏感 Payload。
- 是否区分产品问题、环境问题、测试数据问题和脚本问题。
- 定位修复是否展示 incident、沿用与重跑来源，且每个 case 在最终统计中只出现一次。
- 是否记录测试数据清理结果和残留风险。
- 是否从 `task:status` 获取最终阶段、未完成项、阻断原因或待确认项，并确保这些动态信息没有写回 `plan.md`。
- 主 Agent 的建议是否包含依据、置信度、风险和待审核操作。

## 10. 用户偏好与项目测试经验

`.local/USER-PREFERENCES.md` 是 Git 忽略的当前用户持续偏好文件，不共享、不用于 CI。项目经验的完整规则见[项目测试经验规范](./knowledge/README.md)；本节只定义报告如何呈现偏好和经验复盘结果。

- `.local/USER-PREFERENCES.md` 只记录用户明确的长期协作与行为偏好，例如自动化优先、人工接管边界和信息呈现习惯。用户明确表达且不依赖单次任务上下文时，应在确认含义后即时写入并立即生效；模型推断、一次性范围决定和敏感信息不得沉淀。报告复盘只合并重复项或记录本次未更新原因。
- 报告只读取本轮经验处理结果并呈现“即时更新 / 待验证 / 已验证 / 已覆盖或失效 / 无需更新”及脱敏原因；没有新增内容时不为生成报告而改写偏好或经验文件。
- 偏好与经验的报告内容继续遵守本仓库敏感信息禁记边界。

## 11. 保留与清理

- `artifacts/` 默认不提交 Git，由 CI 或团队存储策略负责归档和保留期限。
- 对失败、发布验证和生产审批相关执行，保留足以复现和审计的报告与关键证据。
- 对包含敏感数据风险的产物，优先脱敏；无法脱敏时按团队安全策略限制访问或及时清理。
- 清理执行产物不得删除仍被缺陷、审批、复测或审计流程引用的证据。
