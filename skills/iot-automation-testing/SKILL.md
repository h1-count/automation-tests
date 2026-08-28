---
name: iot-automation-testing
description: 在本仓库中规划、设计、维护或分析 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。
---

<!-- role: orchestration-only -->

# IoT 自动化测试工作流

本 Skill 只定义读取顺序、命令编排和 reviewer 提示卡。安全边界、生命周期、测试设计、环境、定位和报告规则分别引用其唯一责任文件，不在此复制正文。

## 读取顺序

测试上下文加载（USER-PREFERENCES、EXPERIENCE.md 工程经验、项目确认后读取项目经验库、来源与静态资产筛选）统一按[流程规范 §3.1](../../docs/testing/automation-guideline.md#31-测试上下文加载)执行，本节不复述；以下只列编排顺序：

1. 在新测试开始前让用户选择 `testcase_only / script_only / full_run`；用户已明确目标时直接采用，不重复询问。同 `runRequestId` 已有 history 时不重选。
2. 确定 `suiteId=<type/project/feature>` 与 `runRequestId=<type/project/request>`；无法唯一确定时只询问最小必要信息。
3. 有同一 `runRequestId` history：运行 `task:resume`，按现有 history 的固定 definition 恢复，不重新评估 suite。
4. 无 history：先运行 `test:suite:assess`，再以 `--delivery-target <target> --reuse auto` 初始化当前 v1。
5. 按任务读取唯一责任规范：

   - 生命周期和恢复：[automation-guideline.md](../../docs/testing/automation-guideline.md)
   - 设计、用例和评审：[testcase-guideline.md](../../docs/testing/testcase-guideline.md)
   - 环境和数据：[environment-guideline.md](../../docs/testing/environment-guideline.md)
   - selector：[selector-guideline.md](../../docs/testing/selector-guideline.md)
   - 报告和失败：[report-guideline.md](../../docs/testing/report-guideline.md)、[failure-classification.md](../../docs/testing/failure-classification.md)
   - 专有契约名与版本：[contract-registry.md](../../docs/testing/contract-registry.md)

独立清理、重置、归档或数据恢复请求先读 `package.json` 和 `scripts/README.md`，只使用登记命令；不进入测试 workflow。

## 初始化与分支

```bash
npm run test:suite:assess -- --suite <suiteId> --environment <test|pre> [--profile <profile>] [--source <sources/...>]
npm run task:initialize -- --request <runRequestId> --delivery-target <testcase_only|script_only|full_run> --suite <suiteId> --reuse auto --environment <env> [--speed <fast|balanced|strict>] [--source <sources/...>]
npm run task:resume -- --request <runRequestId>
```

评审速度档 `--speed`（缺省推导：`testcase_only` 且不写数据 → `fast`，其余 → `strict`）：各档封顶规则、写入时的行为与「确定性门禁不随速度档放宽」统一读取[用例规范 §5](../../docs/testing/testcase-guideline.md#5-候选门禁与评审)，不在本 Skill 复述；涉及写入或执行时不主动选择 fast。

修订分层（revision tiering）：已确认用例集的修订先用 `npm run testcases:revision-tier` 对照「已被接受的冻结快照」分级，再按 `structural / scoped / substantive` 三档走评审路径（零 LLM 收口 / 定向单轮 / 完整链），不默认重开完整评审链。各档判定边界、CLI 参数、语义行定义与收敛断路器规则统一读取[用例规范 §5](../../docs/testing/testcase-guideline.md#5-候选门禁与评审)。

评审与生成的结构不变量（评审发现文件契约、cases.md 派生区唯一作者与 reproject 结构修复、no_write 写动词阻断、必填空值 warning、plan 歧义节、全量复审防呆）由引擎强制，规则统一读取[用例规范 §5](../../docs/testing/testcase-guideline.md#5-候选门禁与评审)。

- `direct_execute`：只验证稳定 suite，不重新生成或确认设计；`testcase_only/script_only` 在 `suite-validation` 后完成，`full_run` 才继续 readiness、authorization、run 和 report。
- `affected_rebuild`：只处理评估给出的 affected 引用，完成定向评审后确认受影响用例，再按交付目标停在用例、`build` 或完整执行终点。全局边界变化回退 `full_replan`。
- `full_replan`：工具自动创建仅含请求元数据的本地 staging 骨架；宿主仍须准备通过候选预检的正式计划。校验、评审收敛后只请求一次完整用例确认，再按交付目标决定是否进入 `build` 或执行链。

`testcase_only` 在用例确认后完成，`script_only` 在 `build` 发布本轮 `.local/test-runs/<request>/candidate-scripts/` 并完成 `script-review` 后才结束；通过评审的脚本可 `suite-promote --level reviewed` 写入稳定套件。只有封印执行记录验证过的 `verified` 脚本可用于 `direct_execute`；`full_run` 才继续 readiness、执行授权、run、report 与 verified promotion。

Web build 的输入只能是冻结的 `formal-web-script-spec-v1` 与工具派生的 `formal-web-coverage-plan-v1`。每个已确认执行数据行都有唯一 coverageId，规格中的每个步骤必须恰好覆盖一个 coverageId，并配套具体的字段/选择/文件/导航或受控写入动作以及可观察 Oracle；交互 case 不得只验证页面或表单可见。`web-script-coverage-gate-v1` 必须在候选脚本发布前通过。`no_write` case 必须冻结默认拒绝网络策略，守卫覆盖整个 case；文件必须引用 active `test-assets` 清单项，上传或提交必须绑定预算、证据契约和授权，不能用注释、`trial` 点击或 `addAssertion()` 代替运行时约束。

Web build 先生成并原子发布候选脚本，再运行只读 `task:manage script-static-preflight` 收集并行静态检查结果，最后才进入 reviewer；同一轮所有缺口必须一次处理，复验仍失败则停止并报告完整清单。不要对同一脚本使用 `sleep` 轮询 reviewer 或反复检查已冻结的源码。相互独立的 `script_quality` 与 `execution_safety` reviewer 同时派发，等待宿主事件或 gate 的 rebind 动作。

用例确认后才读取 `.local/repositories/`、Graphify 和源码，并把实现映射写入同一 `plan.md`。用例确认不代替执行清单确认。

## Activity 命令编排

公开入口只有 `task:initialize`、`task:resume`、`task:status`、`task:gate` 和 `task:manage`。

1. 从 gate 读取 `readyActivities`，用稳定 owner 执行 `activity-start`。
2. 文件先写 runtime 暂存区；完成对应门禁后原子发布。最终文件 digest 匹配才关闭 Activity。
3. 正式 callback 默认先向候选 `plan.md` 追加同 subject 的正式决定行，再执行 `callback-resolve --plan-source`。v1 `design_reconfirm → case-confirmation` 没有 `plan.md`，直接执行 `callback-resolve`；决定由 `run-intent-v1`、冻结 suite/version、`case-confirmation-subject-v1` 及本轮 `TestcaseReviewWorkbookPublished` 共同绑定，不发布替代计划文件。
4. 每次状态变化后重新运行 gate；`continue_now` 在当前回合继续，`await_event` 等待已登记事件，`wait_user` 才请求用户动作。gate 输出 `reviewer-rebind:*` 动作时，先 `task:resume` 清理过期 reviewer 绑定，再以新宿主任务重派同名 reviewer；不追加失败事件，也不把等待时长当作 reviewer 失败。
5. `run/report` 使用 formal completion 专用入口，不使用普通 `activity-succeed`。
6. `activity-fail` 只记录本次 attempt 的失败事实，不关闭 request。补齐源码、配置、selector 等无副作用工程条件后，用 `task:manage activity-retry --request <id> --activity <id> --reason <修复说明>` 在同一 request 创建下一 attempt；有外部操作、暂存产物、blocker 或有效 lease 时先按 gate 指定的对账/解除入口处理。`run/report` 不得使用通用重试，必须走正式执行的 reconciliation、定位修复或范围重开链路。

请求用户动作、结束工作回合或输出完成/失败前运行：

```bash
npm run task:gate -- --request <runRequestId> --assert-safe-reply
```

文件门禁：

```bash
npm run check:markdown -- <变更 Markdown 路径>
npm run testcases:sync-relations -- --check <套件目录>
npm run check:rule-design -- <套件目录>/design.md
npm run task:manage -- candidate-gate --request <runRequestId> --claim <lease>
npm run check:architecture
```

## v1 设计推进顺序

对用户只呈现四个连续步骤：

1. 读取命中资料。
2. 自动生成完整候选用例集，内部同时产出 `REQ`、`RULE`、原子用例、来源追溯、风险与待确认项。
3. 自动执行确定性门禁、隔离 reviewer 评审和受影响内容演进，直到收敛或形成需用户裁决的明确项。
4. 通过 `case-confirmation` 一次性提交完整用例集及所有待确认项，只使用 `accepted / revision_requested / cancelled`。

设计阶段只按 gate 给出的 `readyActivities` 推进。v1 的 `plan.md` 是 `REQ → RULE → caseId → sourceRef` 与 `clause → RULE → caseId` 的唯一关系事实源：`candidate-compiler` 仅提交每条冻结 clause 的生成方式和必要确定性事实，严禁提交模块、RULE、case、来源、前缀或片段路径。工具将共享任一 caseId 的 RULE 自动闭包成不可变分片，再按 case 的 clause 归属派发；确定性分片使用 `candidate-fragment-compile`，模型分片使用 `candidate-fragment-publish`，混合分片使用 `candidate-fragment-merge`。READY 只表示前台宿主可领取，仓库没有后台模型执行器。片段正文不写 history，最后由 `candidate-assemble` 按冻结清单重建 `cases.md`、索引、统计和规则投影。生成与拼装契约统一读取[用例规范 §3.1](../../docs/testing/testcase-guideline.md#31-candidate-generation-分片并行)，生成阶段逐条自检的首轮红线统一读取[用例规范 §3.2](../../docs/testing/testcase-guideline.md#32-首轮生成红线)，字段、展示、参数化、默认值继承和追溯契约统一读取[用例规范 §4.2](../../docs/testing/testcase-guideline.md#42-testcase-v1-layered)，不在本 Skill 展开。

v1 的所有设计确认分支在 callback 前运行 `task:manage testcase-review-render-publish --request <id>`。该入口复用经摘要校验的本机工作簿主体或完整渲染，并原子发布本轮 `cases-review.xlsx` 与 `TestcaseReviewWorkbookPublished`；`direct_execute` 不运行该入口。工作簿结构、校验、发布和失败回退契约统一读取[用例规范 §4.3](../../docs/testing/testcase-guideline.md#43-excel-只读评审版)。

用例确认后重新读取 gate，并按初始化时固定的交付目标推进；各终点和执行授权判定统一读取[流程规范](../../docs/testing/automation-guideline.md)。

v1 `full_run` 在 `build` 后先完成独立 `script-review`，再执行 `task:manage readiness-preflight --request <id>`；前者派发并收口隔离脚本评审，后者只验证冻结 manifest、三类 build evidence、suite binding、run intent、case 范围和本地授权输出边界。只有两者均通过才能领取 `readiness`。长时间前台 `build`、`script-review` 与 `readiness` 使用管理器通用 lease keepalive，每三分之一租约续约；保活不启动后台工作，失败后停止新的发布并按 gate 对账。

## v1 定位修复命令编排

1. `execution-run-finalize` 显示全部 terminal unknown 都是可修复定位 incident 时，执行 `npm run task:resume -- --request <runRequestId>`；它自动回退并应用补丁，最终停在新的执行清单确认。
2. 指定 incident 处理时使用 `npm run task:manage -- execution-scope-reopen --request <runRequestId> --selector-repair <incident-path>`；不另建修复命令或手改 history。
3. 回退后按 gate 依次推进 `build → script-review → readiness-preflight → readiness → execution-authorization`；用例确认保持原结果，新的执行清单仍由用户决定。
4. `direct_execute` 遇到定位漂移时创建 `affected_rebuild`，不在稳定 suite 中修改脚本。

## 用例 reviewer 提示卡

只为 definition 声明的 reviewer Activity 创建真实、只读、隔离子 Agent。输入只包含冻结来源、当前设计索引、角色 scope 内用例和确定性门禁摘要；不提供作者推理或其他 reviewer 结论。派发前用 `npx tsx scripts/build-review-reading-map.ts --design <套件 design.md>`（定向批次加 `--only-rules`）生成定向读取图随派发提示附上：按图必读区间精读、交叉对照配对两侧一起读、与资料矛盾或边界存疑时回退来源全文；读取图不改变输入文件集与冻结快照。

| 角色 | 允许输入 | 检查重点 | 固定输出 |
| --- | --- | --- | --- |
| `combined` | 引用来源、设计索引、语义触发的相关用例 | 需求忠实性、原子性、边界、状态、`REQ ↔ RULE ↔ caseId` | 发现编号、证据、受影响引用、严重度、处置（结构修复/语义演进/需用户裁决）和结论 |
| `impact` | 安全来源、写入/严格用例、共享安全邻域 | 数据写入、OTP、权限、安全挑战、设备、cleanup、未知结果 | 发现编号、证据、受影响引用、严重度、处置（结构修复/语义演进/需用户裁决）和结论 |

是否创建 reviewer、如何收敛以及如何保存运行绑定，统一读取[用例规范](../../docs/testing/testcase-guideline.md#5-候选门禁与评审)和[流程规范](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)；本节只提供 reviewer 的输入与输出提示卡。

## 脚本 reviewer 提示卡

| 角色 | 检查重点 |
| --- | --- |
| `script_quality` | `caseId` 映射、业务步骤落地、selector/API 契约、断言、失败边界和可维护性 |
| `execution_safety` | 清单授权、真实写入面、操作预算、结果证据、敏感信息、cleanup 和 reconciliation |

所有脚本先通过确定性编译、source gate、敏感字面量和 manifest 检查；静态失败不交给 reviewer 猜测修复。风险分级只改变 reviewer 范围，不改变用户确认数量。
参数化 case 的脚本必须对每个 `dataId` 实现独立业务步骤，并使用 `instance-d01、instance-d02…` Oracle；运行与统计仍按父 `formalCase(caseId)` 收口。

## 资源

| 测试类型 | 技术与模板 |
| --- | --- |
| 设计索引与用例 | `templates/test-plan.template.md`、`templates/testcase-package.template.md`、`templates/testcase.template.md` |
| Web/H5 | Playwright；`templates/playwright.spec.template.ts`、`templates/formal-execution-manifest.template.ts` |
| 原生 App/WebView | Appium + WebdriverIO；`templates/appium.spec.template.ts` |
| API | TypeScript API Client；复用 `src/clients/` 与 `tests/api/` |
| MQTT/IoT 链路 | mqtt.js 与组合 Runner；`templates/iot-chain.spec.template.ts` |

`templates/` 只提供结构，`examples/` 只作参考；都不是业务事实或已验证资产。
