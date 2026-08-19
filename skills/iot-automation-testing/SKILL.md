---
name: iot-automation-testing
description: 在本仓库中规划、设计、维护或分析 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。
---

<!-- role: orchestration-only -->

# IoT 自动化测试工作流

本 Skill 只定义读取顺序、命令编排和 reviewer 提示卡。安全边界、生命周期、测试设计、环境、定位和报告规则分别引用其唯一责任文件，不在此复制正文。

## 读取顺序

1. 读取 `AGENTS.md`、`.local/USER-PREFERENCES.md`（如存在）、[docs/testing/knowledge/MEMORY.md](../../docs/testing/knowledge/MEMORY.md)（自动化工程经验：引擎编排、文档契约、工具链踩坑——每次任务开始必读，按当前任务阶段取相关 scope 条目）和当前请求的 `workflow-history.ndjson`（如存在）。
2. 确认被测项目后，读取 `docs/testing/knowledge/<project>-testing-knowledge.md`（如存在；产品测试经验：环境约束、定位策略、失败归因）。
3. 在新测试开始前让用户选择 `testcase_only / script_only / full_run`；用户已明确目标时直接采用，不重复询问。同 `runRequestId` 已有 history 时不重选。
4. 确定 `suiteId=<type/project/feature>` 与 `runRequestId=<type/project/request>`；无法唯一确定时只询问最小必要信息。
5. 有同一 `runRequestId` history：运行 `task:resume`，按现有 history 的固定 definition 恢复，不重新评估 suite。
6. 无 history：先运行 `test:suite:assess`，再以 `--delivery-target <target> --reuse auto` 初始化 v7。
7. 需要设计时，用户直接指定的 Word/PDF/原型/附件先读取并登记为请求内来源，不要求全局 manifest；未直接指定资料时再从 `sources/manifest.yaml` 和受控章节索引筛选。静态执行资产按需从 `test-assets/manifest.yaml` 选择。
8. 按任务读取唯一责任规范：

   - 生命周期和恢复：[automation-guideline.md](../../docs/testing/automation-guideline.md)
   - 设计、用例和评审：[testcase-guideline.md](../../docs/testing/testcase-guideline.md)
   - 环境和数据：[environment-guideline.md](../../docs/testing/environment-guideline.md)
   - selector：[selector-guideline.md](../../docs/testing/selector-guideline.md)
   - 报告和失败：[report-guideline.md](../../docs/testing/report-guideline.md)、[failure-classification.md](../../docs/testing/failure-classification.md)
   - 专有契约名与版本：[contract-registry.md](../../docs/testing/contract-registry.md)

独立清理、重置、归档或数据恢复请求先读 `package.json` 和 `scripts/README.md`，只使用登记命令；不进入测试 workflow。

## 初始化与分支

```bash
npm run test:suite:assess -- --suite <suiteId> --environment <test|pre> [--profile <profile>]
npm run task:initialize -- --request <runRequestId> --delivery-target <testcase_only|script_only|full_run> --suite <suiteId> --reuse auto --environment <env> [--speed <fast|balanced|strict>]
npm run task:resume -- --request <runRequestId>
```

评审速度档 `--speed`（缺省推导：`testcase_only` 且不写数据 → `fast`；其余 → `strict`）：`fast` 对 no_write 运行跳过 reviewer（仅确定性门禁）；语义发现直接进入用例确认由用户裁决，演进活动仅用于应用确定性结构修正（至多一轮）；`balanced` 至多保留 1 名 combined reviewer；`strict` 为完整双角色评审与一轮演进。涉及写入或执行时不要使用 fast。

修订分层（revision tiering）：用户裁决/评审修正引发的用例集修订，先用 `npm run testcases:revision-tier` 对照「已被接受的冻结快照」分级，再按档走评审路径，不默认重开完整评审链：

- `structural`（仅格式/计数/枚举级变化）：开新批次后 `reviewer-dispatch/submit --deterministic --classifier-digest <sha> --findings <分级器产物>` 确定性收口（零 LLM 评审轮），resolution 以 converged 结束，直接回用例确认。
- `scoped`（≤8 个用例块语义行变化；规则台账变化须有新增正式用户决定覆盖）：`--base-batch + --affected-ref` 定向批次，仅受影响用例单轮 LLM 复审。
- `substantive`（安全边界/数据策略语义、无用户决定覆盖的台账行集变化、>8 用例块）：完整评审链。
- 同一评审纪元的收敛断路器只解除一次；再次触发必须先刷新纪元（新增正式用户决定或受控来源），引擎会显式报错而非静默失败。

评审与生成的结构不变量（引擎强制）：

- 任何 `reviewer-submit`（含 LLM 隔离评审员）必须带 `--findings` 发现文件：`## 结论` 为 converged/findings_present 枚举，findings_present 必须伴随非空「## 发现项」表；引擎在提交时校验并记录 findingsDigest 与 conclusion，缺失或非法直接拒绝收口。
- cases.md 的统计行与快速索引是**派生区**，只能由 `projectTestcaseV6DerivedView` 生成；手写计数/索引会在 candidate-gate 与一切用例包发布边界被「派生视图漂移」确定性拒绝。
- 结构漂移（陈旧计数、模块归属错位）用 `npm run testcases:reproject -- <cases.md>` 一键重投影修复（`--dry-run` 预览；按原始快速索引的模块声明归位正文块）。
- no_write 用例的操作列不得含业务写动词（创建/新增/提交/修改/编辑/更新/删除/上传/写入）；需要写动作的步骤拆分为 ephemeral_cleanup 用例。
- RULE 台账「条件/输入」含「必填」但关联参数化用例无空值数据行 → gate warning，交 reviewer/用户裁决。
- plan.md 必须含「## 需求歧义与未定义预期」节（无歧义显式写「无」）；需求矛盾在 plan 确认回调一次裁决，不留到评审后升级。
- 同纪元已有前导批次时，`review-batch-start` 不带 `--activity/--affected-ref` 会触发全量复审防呆警告；验证有界修正集优先走修订分层或 targeted 范围。

- `direct_execute`：只验证稳定 suite，不重新生成或确认设计；`testcase_only/script_only` 在 `suite-validation` 后完成，`full_run` 才继续 readiness、authorization、run 和 report。
- `affected_rebuild`：只处理评估给出的 affected 引用，完成定向评审后确认受影响用例，再按交付目标停在用例、`build` 或完整执行终点。全局边界变化回退 `full_replan`。
- `full_replan`：使用模板创建内部设计索引和用例；校验、评审收敛后只请求一次完整用例确认，再按交付目标决定是否进入 `build` 或执行链。

`testcase_only` 在用例确认后完成，`script_only` 在 `build` 发布候选脚本并通过静态门禁后完成，`full_run` 才继续 readiness、执行授权、run 和 report。

用例确认后才读取 `.local/repositories/`、Graphify 和源码，并把实现映射写入同一 `plan.md`。用例确认不代替执行清单确认。

## Activity 命令编排

公开入口只有 `task:initialize`、`task:resume`、`task:status`、`task:gate` 和 `task:manage`。

1. 从 gate 读取 `readyActivities`，用稳定 owner 执行 `activity-start`。
2. 文件先写 runtime 暂存区；完成对应门禁后原子发布。最终文件 digest 匹配才关闭 Activity。
3. callback 决定只向候选 `plan.md` 追加同 subject 的正式决定行，再执行 `callback-resolve --plan-source`。
4. 每次状态变化后重新运行 gate；`continue_now` 在当前回合继续，`await_event` 等待已登记事件，`wait_user` 才请求用户动作。gate 输出 `reviewer-rebind:*` 动作时，先 `task:resume` 清理过期 reviewer 绑定，再以新宿主任务重派同名 reviewer；不追加失败事件，也不把等待时长当作 reviewer 失败。
5. `run/report` 使用 formal completion 专用入口，不使用普通 `activity-succeed`。

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

## v7 设计推进顺序

对用户只呈现四个连续步骤：

1. 读取命中资料。
2. 自动生成完整候选用例集，内部同时产出 `REQ`、`RULE`、原子用例、来源追溯、风险与待确认项。
3. 自动执行确定性门禁、隔离 reviewer 评审和受影响内容演进，直到收敛或形成需用户裁决的明确项。
4. 通过 `case-confirmation` 一次性提交完整用例集及所有待确认项，只使用 `accepted / revision_requested / cancelled`。

设计阶段只按 gate 给出的 `readyActivities` 推进。`candidate-generation` 使用仓库模板同步产出运行档案 `plan.md` 与套件资产：先产出 plan 草案并冻结模块清单与 `REQ/RULE` 骨架，再按模块并行发起独立生成请求，各请求只产出本模块的用例详情片段，最后按骨架顺序拼装为单一套件 `cases.md`（设计台账增量并入 `design.md`），并在 runtime staging 目录运行 `npm run testcases:sync-relations -- <staging 目录>` 重建派生索引、统计与规则投影。这些生成请求只是 Activity 内部的模型调用，不新增 Activity、不写 history、不改变 workflow definition 与 graphDigest；骨架冻结、片段输入边界、拼装与重建契约统一读取[用例规范 §3.1](../../docs/testing/testcase-guideline.md#31-candidate-generation-内部分段并行)，字段、展示、参数化、默认值继承、追溯和历史兼容契约统一读取[用例规范 §4.2](../../docs/testing/testcase-guideline.md#42-testcase-v6-layered)，不在本 Skill 展开。

reviewer 收敛后，若 gate 允许生成 Excel 评审版且宿主具有 Spreadsheets 运行时，则依次运行 `task:manage testcase-review-prepare --output <temp-model.json>`、`scripts/build-testcase-review-workbook.mjs --model <temp-model.json> --output <staged.xlsx> --preview-dir <temp-previews> --receipt <temp-receipt.json>`，完成规范要求的视觉检查后，再运行 `task:manage testcase-review-publish --model <temp-model.json> --workbook <staged.xlsx> --receipt <temp-receipt.json> --output <运行档案目录>/cases-review.xlsx`。工作簿结构、校验、发布和失败回退契约统一读取[用例规范 §4.3](../../docs/testing/testcase-guideline.md#43-excel-只读评审版)。

用例确认后重新读取 gate，并按初始化时固定的交付目标推进；各终点和执行授权判定统一读取[流程规范](../../docs/testing/automation-guideline.md)。

## v7 定位修复命令编排

1. `execution-run-finalize` 显示全部 terminal unknown 都是可修复定位 incident 时，执行 `npm run task:resume -- --request <runRequestId>`；它自动回退并应用补丁，最终停在新的执行清单确认。
2. 指定 incident 处理时使用 `npm run task:manage -- execution-scope-reopen --request <runRequestId> --selector-repair <incident-path>`；不另建修复命令或手改 history。
3. 回退后按 gate 依次推进 `build → readiness → execution-authorization`；用例确认保持原结果，新的执行清单仍由用户决定。
4. `direct_execute` 遇到定位漂移时创建 `affected_rebuild`，不在稳定 suite 中修改脚本。

## 用例 reviewer 提示卡

只为 definition 声明的 reviewer Activity 创建真实、只读、隔离子 Agent。输入只包含冻结来源、当前设计索引、角色 scope 内用例和确定性门禁摘要；不提供作者推理或其他 reviewer 结论。

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
