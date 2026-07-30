---
name: iot-automation-testing
description: 在本仓库中规划、设计、维护或分析 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。用于处理需求、截图、URL、接口资料、物模型、测试结果和失败证据。
---

# IoT 自动化测试工作流

本 Skill 只定义 Codex 的阅读顺序、命令编排、reviewer 提示卡和宿主续跑适配。安全边界以 [AGENTS.md](../../AGENTS.md) 为准；状态机、测试设计、环境、定位和报告规则只引用[测试规范索引](../../docs/testing/README.md)中的责任文件。

## 开始与恢复

1. 用户提出独立本机维护（清理、重置、归档或测试数据恢复）时，先读取 `package.json` 与 `scripts/README.md`，使用已登记命令；范围不完整时只执行 `--dry-run`。恢复完整测试 workflow 不属于本条维护请求。
2. 阅读 `AGENTS.md`、`.local/testing-memory.md`（如存在）和当前请求的 `workflow-history.ndjson`（如存在）。识别项目后只读取对应项目经验库，并确定稳定的 `<type/project/request>`；无法唯一确定时先请求最小必要信息，不猜测 request ID。
3. 完整自动化测试请求在运行任何 workflow 命令前，先阅读[流程规范的 Goal 生命周期](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)，再依次调用宿主 `get_goal` 与必要的 `create_goal`：同一 request ID 复用；绑定不同请求或无法确认归属时不得替换、清除或改写，只请求最小用户选择。状态查询、只读诊断和独立维护请求跳过此步。能力不可用或预检失败时不执行 `task:initialize`/`task:resume`，只提供一次 `/goal` 回退及规范中的 objective 文本。
4. Goal 预检通过后，有 history 时运行 `npm run task:resume -- --request <type/project/request>`；没有时使用 `task:initialize`。不得从 `plan.md`、runtime 或文件时间猜测运行状态。
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
2. 文件先写入 runtime 暂存区，完成相应校验后再原子发布；关系同步也只修改该暂存副本，不直接改最终请求目录。只有最终文件 digest 匹配才执行 `activity-succeed`。
3. 失败、callback、阻塞、恢复、核对和 history 校验都使用 `task:manage` 对应子命令，不手工改 history。
4. 外部写操作先记录 intent。lease 过期不证明操作未发生；结果未知时查询后置状态并进入 reconciliation，不盲目重试。
5. 每次状态变化后重新运行 gate，并严格执行流程规范定义的 `continuation` 与 `reply`：`continue_now` 仅要求在当前可用回合继续；等待已启动 reviewer、工具或外部结果时只等待本回合可取得的事件；`wait_until` 只是一次性退避时间，不创建定时器；只有 gate 放行时才能请求用户动作或结束。用户主动索要状态时，可只读复述 gate/status，不得把该摘要当成完成或后台续跑承诺。
6. 用户对 callback 作出决定后，在 runtime 暂存候选 `plan.md`，其“正式用户决定”表记录相同决定类型、`subjectDigest` 与结果，再执行 `callback-resolve --plan-source <暂存 plan.md>`；CLI 负责原子发布计划并追加解析事件，不得直接改最终计划、仅改 history 或把等待状态写成正式决定。

请求用户动作、结束当前测试工作回合或输出完成/失败结论前运行：

```bash
npm run task:gate -- --request <type/project/request> --assert-safe-reply
```

## Codex Goal 与 Stop Hook

用户已通过本仓库规则授权：完整自动化测试请求默认创建或复用一个宿主 Goal，无需每次再次输入 `/goal`。完整请求包括新建或恢复后的规划、评审、工程、执行、工作流内 cleanup/reconcile 和报告；独立状态查询、只读诊断、规则或代码维护、清理、重置、归档和测试数据恢复不创建 Goal。Goal objective、冲突处理和完成条件只按[流程规范](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)生成。

操作顺序固定为：稳定 request ID → `get_goal` → 无未完成 Goal 时 `create_goal` / 同请求复用 / 不同请求请求最小用户选择 → `task:initialize` 或 `task:resume`。Goal 能力缺失或调用失败时不得声称已启用，也不得先创建 history；只提示一次手动 `/goal` 并附 objective。Goal 的 ID、状态、预算和使用记录只属于宿主，不得写入 runtime、history、`plan.md` 或其他仓库文件。

Goal 运行中，`continue_now`、reconcile、reviewer 派发/重试、自动演进和复审必须继续执行。`await_event`/`wait_until` 保持 Goal active 并等待已登记事件；等待窗口或墙钟时长本身不是 reviewer 失败依据，不得因此中断 reviewer 或发送最终回复。`WAITING_HUMAN` 只暂停同一 Goal，不调用 `update_goal`，callback 解析后恢复；workflow `BLOCKED` 也只暂停，真实条件满足并执行 `task:manage blocker-resolve` 后恢复，不把它标记为 Goal `blocked`。只有 workflow `SUCCEEDED` 且 `task:gate --assert-safe-reply` 通过后才调用 `update_goal(complete)`；产品结果为 failed/mixed 不阻止完成。不可恢复 `FAILED` 达到宿主连续阻塞阈值后调用 `update_goal(blocked)`，`CANCELLED` 由用户清除 Goal。

Stop Hook 只通过可丢弃的 session binding 定位请求并调用 gate。它不领取 Activity、不执行副作用、不写事件，也不调用 `get_goal`、`create_goal`、`update_goal` 或保存 Goal 字段；`decision: "block"` 由宿主最多生成一次 continuation prompt，`stop_hook_active=true` 表示该回合已由 Stop 续跑，`continue: false` 优先且第二次必须明确保持非终态。无 binding、无 session 或 gate 失败时，Hook 不请求 continuation、不改 history，也不承诺后台运行。启用前使用 `/hooks` 检查受信任工作区中的 `.codex/hooks.json` 命令路径、当前文件 hash 与信任状态；修改 Hook 后必须重新检查并信任。

## 阶段操作顺序

1. 资料筛选和计划校验，发布 `plan.md`。
2. 请求计划确认 callback；`accepted` 后立即继续用例包生成，不等待用户再发送“继续”。
3. 并行生成适用用例包，运行关系同步和首稿 readiness：一次检查计划必填标记、包完整度、RULE 设计矩阵、关系投影、来源 manifest id/`sectionId`/SHA-256，并一次汇总写入安全 warnings。硬缺口先自动修订并复检；warnings 不单独创建 callback。
4. 按用例规范选择最小风险 reviewer 集合：`light = combined`、`standard = requirements + design`、`strict = requirements + design + impact`；业务数据写入始终强制 `impact`。完成初审、证据驱动演进和定向复审，直至收敛。
5. 对最终收敛的用例集请求一次用例确认；确认后自动完成工程设计、脚本生成和脚本评审。
6. `script-review` 使用 `execution-authorization-publish` 原子发布不可变执行清单，再以清单摘要请求一次确认。
7. 运行 setup、execute、verify、cleanup/reconcile，随后生成报告并闭合工作流。

计划确认的 `subjectDigest` 只按流程规范的 `plan-confirmation-subject-v2` 从现有计划区块内部计算，不向计划添加“计划确认边界”表。顶层业务流程、测试类型/目标环境、高层数据写入类别和权限/安全上限未变化时，`REQ/RULE/caseId`、断言、追溯或 reviewer 记录的自动演进不得重开计划确认。只有 manager 判定为需要修订计划，或存在资料冲突、未定义验收时，才请求最小用户决定。

计划、用例包或关系文件更新后，依次运行：

```bash
npm run check:markdown -- <实际 Markdown 文件>
npm run check:architecture
```

只有定位规范判定 Web/H5 存在页面语义、状态、唯一性或证据风险时，才运行 `test:web:inspect` 或 `test:web:explore:reuse:inspect` 并生成探索证据卡；已有可校验证据时复用，不把 Web 类型本身作为 Inspector 门禁。

## 多角色隔离评审提示卡

作者完成完整草案且 readiness 没有硬缺口后，为 `ReviewPolicy.requiredRoles` 中的每个角色启动只读、隔离 reviewer。风险档固定为 `light = combined`、`standard = requirements + design`、`strict = requirements + design + impact`，写数据时无条件包含 `impact`；不再为简单只读请求机械启动三组 reviewer。输入只包含冻结的原始资料、当前 `plan.md`、用例包和该角色提示卡，不提供作者推理或其他 reviewer 结论。运行事实写 history，任务标识写 runtime，正式结论和发现项写 `plan.md`。

reviewer 派发、提交或 `task:resume` 发现输入漂移时，不得提交旧结果或手工复用旧摘要；manager 会失效旧批次并启动确定性新批次。gate 出现 `reviewer-rebind:<batch>:<activity>:<role>` 时，为该 Activity 取得当前 reviewer 工具句柄后，使用同一 `reviewer-dispatch --batch ... --activity ... --role ... --agent-task ...` 补建 runtime 绑定；该命令必须复用 durable 派发而不是再次派发 reviewer。没有可用工具句柄时保持真实非终态，不伪造绑定、失败或完成。

自动演进后的批次优先定向复审：scope 必须绑定 `affectedRefs`、`baseBatchId`、复审原因、明确排除引用，以及每个未重审角色的原批次、输入摘要和正式计划证据摘要。缺少可复用证据时不跳过该角色；只有跨业务域、共享规则邻域、数据/执行边界或安全影响时才扩大 scope。reviewer 先按 `affectedRefs` 精读对应 `REQ/RULE/caseId` 和来源 `sectionId`、页码或标题定位，再读取必要直接邻域；冻结快照中的完整 PDF、Word 和其他源文件只是权威回退，不要求每轮全量精读，也不扫描未被计划引用的整个知识库。

定向批次通过 `task:manage review-batch-start` 的重复 `--activity`、`--affected-ref`、`--excluded-ref` 以及 `--base-batch`、`--reason` 参数登记；未传 `--activity` 时保持初审的完整 scope。未重审角色的证据由 manager 从 history 派生，调用方不得手工提供摘要。

收集 reviewer 后，`case-review-resolution` 的候选计划只能更新 reviewer 正式结论和发现项，夹带测试范围、`REQ/RULE`、设计矩阵、关系、用例或工程内容时不得发布。结论为“需演进”时，由 `case-review-evolution` 在已确认计划范围内修改草案、同步关系并自动启动适用复审；若候选修改使 `plan-confirmation-subject-v2` 实质变化，则停止自动发布并进入计划修订决定。

| 角色 | 允许输入 | 检查重点 | 固定输出 |
| --- | --- | --- | --- |
| 轻量综合 | 受控需求、当前计划、用例包、readiness 摘要 | 同时核对需求一致性、设计完整性与 `REQ ↔ RULE ↔ caseId`；只用于 `light` | `MRR-COM-*`、证据、受影响引用、严重度、分类、处置、结论 |
| 需求一致性 | 原始需求、当前计划、用例包 | 范围、验收规则、`REQ/RULE`、遗漏与不适用依据 | `MRR-REQ-*`、证据、受影响引用、严重度、分类、处置、结论 |
| 测试设计 | 原始需求、当前计划、用例包 | 决策表、状态迁移、边界、权限、成功/失败/恢复路径 | `MRR-DES-*`、证据、受影响引用、严重度、分类、处置、结论 |
| 变更影响 | 变更来源、当前计划、用例包、关联设计/脚本 | 来源到需求、用例、脚本和复测范围的影响链 | `MRR-CHG-*`、证据、受影响引用、严重度、分类、处置、结论 |

角色适用性、发现项分类和收敛标准只按[用例规范](../../docs/testing/testcase-guideline.md#510-用例集评审与草案演进)判断；并发、重试和无进展停止条件只按[流程规范](../../docs/testing/automation-guideline.md#314-durable-workflow生命周期与恢复)执行。资料明确的缺口自动修订；资料冲突或未定义验收才请求最小业务裁决。

## 资源

| 测试类型 | 技术与模板 |
| --- | --- |
| Web/H5 | Playwright；`templates/playwright.spec.template.ts` |
| 原生 App/WebView | Appium + WebdriverIO；`templates/appium.spec.template.ts` |
| API | TypeScript API Client；复用 `src/clients/` 与 `tests/api/` |
| MQTT/IoT 链路 | mqtt.js 与已确认的组合 Runner；`templates/iot-chain.spec.template.ts` |

`templates/` 只提供结构，`examples/` 只作参考；两者都不等同于已验证测试资产。
