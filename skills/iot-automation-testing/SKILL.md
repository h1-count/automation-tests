---
name: iot-automation-testing
description: 在本仓库中规划、设计、维护或分析 Web、H5、App、API、MQTT 和 IoT 链路自动化测试。用于处理需求、截图、URL、接口资料、物模型、测试结果和失败证据。
---

# IoT 自动化测试工作流

本 Skill 只定义 Codex 的任务阅读顺序和阶段输出。强制门禁以 [AGENTS.md](../../AGENTS.md) 为准；规则正文以 [测试规范索引](../../docs/testing/README.md) 指向的责任文件为准。

## 开始前

0. 用户提出“清理”“重置”“归档”或“恢复”时，先读取 `package.json` 的 scripts 与 `scripts/README.md`，并按[流程规范的维护命令门禁](../../docs/testing/automation-guideline.md#311-本机维护命令发现与执行)选择已登记命令；范围不完整时只允许先执行 `--dry-run`，不得扫描目录后自行删除。
1. 阅读 `.local/testing-memory.md` 和当前请求的本机任务状态（如存在），再阅读 `AGENTS.md` 与相关资产；若状态已存在，先运行 `npm run task:resume -- --request <type/project/request>` 获取全生命周期唯一下一动作，再用 `task:manage transaction-claim` 领取并在产物与校验提交后用 `transaction-commit` 关闭该短事务。具体恢复规则见 [automation-guideline.md](../../docs/testing/automation-guideline.md)。
2. 按流程规范识别项目、筛选 `sources/manifest.yaml` 与受控章节索引，并只读取本次实际需要的原始资料；随后查询 `test-assets/manifest.yaml` 的 `active` 候选资产。将资料引用和资产选择分别记录到 `plan.md`。
3. 按任务类型阅读对应规范：
   - 流程、探索、阻碍恢复：[automation-guideline.md](../../docs/testing/automation-guideline.md)
   - 环境、凭据、认证和数据：[environment-guideline.md](../../docs/testing/environment-guideline.md)
   - 计划与用例：[testcase-guideline.md](../../docs/testing/testcase-guideline.md)
   - 定位：[selector-guideline.md](../../docs/testing/selector-guideline.md)
   - 报告与失败：[report-guideline.md](../../docs/testing/report-guideline.md)、[failure-classification.md](../../docs/testing/failure-classification.md)
4. 用例确认后才进入工程层：以 `.local/repositories/` 为代码仓库根目录定位对应仓库；扫描源码前先检查 Graphify 图谱，再在现有 `plan.md` 中补充代码定位、可行性、数据和脚本方案。不得将代码仓库或图谱登记到 `sources/manifest.yaml`，也不得将其作为业务需求依据。详细规则见 [automation-guideline.md](../../docs/testing/automation-guideline.md#6-阶段三自动化可行性脚本设计与代码定位)。
5. 复用已有 action、fixture、client、support 和模板；脚本必须基于已确认用例和已确认的计划工程层设计生成，不要为单一任务新增框架或平行实现。
6. 当前请求没有活跃 `plan.md` 时，按当前用户需求建立新计划；`testcases/archive/` 仅在用户明确要求时读取，不能作为新任务的范围、确认状态或阻塞原因。

## 审核式阶段

| 阶段 | Codex 产出 | 进入下一阶段的条件 |
| --- | --- | --- |
| 测试计划 | 范围、资料、环境候选、推断、缺失项、风险和交付物。 | 按流程规范获得用户确认。 |
| 测试用例 | 依用例规范生成完整用例包、追溯和覆盖资产；仅在 RULE 台账维护 `RULE → caseId`，随后运行 `npm run testcases:sync-relations -- <测试请求目录>` 与 `npm run check:rule-design -- <plan.md>` 生成并校验派生视图和规则设计矩阵。 | 完成评审与草案演进后提交用户确认。 |
| 用例集评审与演进 | 真实子智能体的需求、设计、追溯评审（高风险/变更时追加影响评审）、按证据自动修订草案与完整复审结论。 | 全部适用 reviewer 真实完成且用户确认用例。 |
| 自动化可行性与脚本设计 | `plan.md` 中的代码/图谱定位、`caseId` 映射、数据策略引用与风险。 | 自动校验通过。 |
| 正式脚本 | 已确认用例和设计关联的脚本 diff、静态检查及脚本评审。 | 生成统一执行清单并获得一次确认。 |
| 正式执行 | 使用清单绑定的 Runner 完整执行 setup、test 与 teardown。 | 运行结束并保留正式产物。 |
| 报告与分析 | 范围完成判定、用户摘要、失败分类、复盘结论和改进建议。 | 用户确认后才改正式资产或复测。 |

按 [automation-guideline.md](../../docs/testing/automation-guideline.md) 初始化和更新任务执行清单及本机状态。每次回复按下表输出完整、简短的阶段进度卡片：

| 阶段 | 任务 | 状态 | 当前结论 / 需要动作 |
| --- | --- | --- | --- |
| <阶段> | <任务> | <流程规范定义的状态> | <结论；无则写“无”；需要用户动作时写最小问题与下一步> |

完整任务清单和状态基线在 `plan.md`，本机状态用于恢复；两者均不替代正式资产状态。

### 续跑命令

初始化后为当前 Codex 任务创建一个 thread heartbeat，提示使用 [`templates/thread-heartbeat.prompt.md`](templates/thread-heartbeat.prompt.md)，再用 `task:manage host-bind --automation <id> --session <当前 Codex session id>` 登记去重绑定。若 Hook 未获信任、组织策略禁用或 heartbeat 创建失败，调用 `task:manage host-block --session <id> --reason <原因>`，不得宣称仍会后台续跑。每次动作前读取 `task:gate --json`，用稳定 owner 调用 `transaction-claim` 并保存返回的 claim token；执行期间用 `transaction-renew` 续租，提交、重试或阻塞时传回该 token。最终回复前调用 `task:gate --assert-final`。状态含义和宿主处理只引用[流程规范](../../docs/testing/automation-guideline.md#43-短事务闭环与生命周期恢复)。

生成或批量更新 `plan.md`、用例包后，先运行 `npm run check:markdown -- <实际文件路径>`，再运行 `npm run check:architecture`。若仅分隔行列数不一致，可运行 `npm run check:markdown -- --fix <实际文件路径>` 后复检；数据行列数不一致或字面量反斜杠加字母 n、r 必须修订生成正文。两项检查通过前，不得称计划/草案已生成，也不得请求用户确认。

新建或重新打开执行范围的 Web/H5 正式脚本，先运行 `npm run test:web:inspect -- <spec>`；需要保留跨失败现场时，先启动受管探索会话，再运行 `npm run test:web:explore:reuse:inspect -- <spec>`。确认专用 Chrome 与 Inspector 同时可见后，按[定位规范](../../docs/testing/selector-guideline.md#8-codex-生成与修复-selector-的流程)完成探索证据卡，再生成最小脚本 diff；`test:web:explore` 只用于该门禁后的确定性重放。不得以源码推断替代页面语义探索；不使用 Browser、Computer Use 或个人 Chrome 会话。正式 Web 执行调用 `npm run test:web:execute -- --request <type/project/request>`；恢复同一授权时追加 `--resume`，结束后生成 Playwright HTML/Allure 和中文摘要。阶段门禁、原子覆盖、会话分组和证据资格分别引用[流程规范](../../docs/testing/automation-guideline.md)、[用例规范](../../docs/testing/testcase-guideline.md)、[环境规范](../../docs/testing/environment-guideline.md)与[报告规范](../../docs/testing/report-guideline.md)，本 Skill 不复述。安全挑战只请求用户完成最小操作，随后自动恢复确定性步骤。

## 多角色隔离评审提示卡

作者完成完整用例草案后，按下列提示卡实际启动只读、隔离 reviewer。每张卡只提供表中最小资料路径，不提供作者推理、历史结论或写入指令。角色、触发条件、记录字段和闭环标准以 [testcase-guideline.md](../../docs/testing/testcase-guideline.md#510-用例集评审与草案演进) 为准；结论和发现项正文只写入 `plan.md`，本机任务状态只登记运行事实及正式记录定位/摘要；阻塞与阶段进入条件以 [automation-guideline.md](../../docs/testing/automation-guideline.md#51-多角色隔离评审) 为准。

| 角色提示卡 | 允许输入 | 禁止上下文与限制 | 检查重点 | 固定输出字段与结论 |
| --- | --- | --- | --- | --- |
| 需求一致性评审 | 原始需求/验收资料、当前 `plan.md`（含规则设计矩阵）、用例包、本卡 | 不接收作者推理、自评或其他结论；只读 | 先核对矩阵遗漏，再核对范围、验收规则、`REQ`、`RULE`、缺失项与不适用依据 | `MRR-REQ-序号`、证据、受影响 REQ/RULE/`caseId`、严重度、**发现项分类**、**处置方式**、处理建议；结论：通过 / 需演进 / 阻塞 |
| 测试设计评审 | 原始需求/验收资料、当前 `plan.md`（含规则设计矩阵）、用例包、本卡 | 不接收作者推理、自评或其他结论；只读 | 先核对矩阵中的必填/选填、边界、前置与可观察预期，再核对决策表、状态迁移、权限、主成功/失败/回退/重试 | `MRR-DES-序号`、证据、受影响 REQ/`caseId`、严重度、**发现项分类**、**处置方式**、处理建议；结论：通过 / 需演进 / 阻塞 |
| 追溯审计 | 原始需求资料、当前 `plan.md`、用例包、架构检查结果、本卡 | 不接收作者推理、自评或其他结论；只读 | `REQ ↔ RULE ↔ caseId`、用例包、覆盖关联、重复或孤儿编号 | `MRR-TRA-序号`、证据、受影响 REQ/RULE/`caseId`、严重度、**发现项分类**、**处置方式**、处理建议；结论：通过 / 需演进 / 阻塞 |
| 交互与状态专项评审（适用时追加） | 原型/需求、当前 `plan.md`、用例包、本卡 | 不接收作者推理、自评或其他结论；只读 | 跳转、返回、禁用态、焦点、反馈、确认/取消、自动提交与状态迁移的可观察断言 | `MRR-UX-序号`、证据、受影响 RULE/`caseId`、严重度、**发现项分类**、**处置方式**、处理建议；结论：通过 / 需演进 / 阻塞 |
| 变更影响评审（高风险/变更时追加） | 变更来源及版本、当前 `plan.md`、用例包、关联脚本/工程设计清单、本卡 | 不接收作者推理、自评或其他结论；只读 | 变更来源 → REQ → `caseId` → 脚本/工程设计 → 复测范围 | `MRR-CHG-序号`、证据、受影响 REQ/`caseId`、严重度、**发现项分类**、**处置方式**、处理建议；结论：通过 / 需演进 / 阻塞 |

主 Agent 为发现项追加唯一分类与处置方式：`需求覆盖缺口`、`资料明确的设计缺口`必须采用`自动演进`并在复审后关闭；`业务裁决/资料冲突`采用`用户裁决`并限定受影响场景；`质量建议`采用`风险登记`且标记“非本次验收阻塞”。发现项状态只允许为“待处理”“待用户裁决”“已关闭”或“不适用”；综合结论为“可提交确认”时不得存在待处理的自动演进项或范围未界定的用户裁决项。高风险争议或需要独立人类留痕时，改用独立任务或外部测试管理平台；无论 reviewer 结论如何，用户/测试负责人仍是唯一最终业务确认人。

当 reviewer 仅报告“需演进”而没有证据分类时，主 Agent 不得直接把该项写成用户待确认；应回读允许输入中的资料并补充分类。资料能证明的遗漏必须自动修订；修改后原评审批次失效，必须以新输入基线重新启动全部适用 reviewer 完成最终复审。只有冲突或缺失验收才向用户提最小裁决问题。

完成每个评审批次后，按用例规范在同一 `plan.md` 填写“沉淀判定”：需求事实回链 `REQ → RULE → caseId`，通用规则只引用其责任规范，未验证项目观察登记到本地候选队列且计划只引用 `CAND-<编号>`，未验证推断仅作风险登记或裁决上下文。已验证项目经验可直接写入项目经验库；报告阶段只复盘候选状态，Skill 不维护这四类规则的正文。

执行连续自动演进时，按提示卡并行 `spawn_agent`，固定使用 `fork_turns=none`；每个返回结果立即用 `review-agent-submit` 提交。随后按用例规范复核规则邻域并运行关系同步、规则设计预检与静态检查。轮次和交互语义只引用[流程规范](../../docs/testing/automation-guideline.md#连续自动演进与收敛)。

计划获用户确认后先执行 `npm run task:confirm-plan -- --request <type/project/request>`，再进入用例评审。每次恢复评审先执行 `task:resume` 返回的唯一动作，并让 `task:review` 同步同一 `REV-*` 正式区块；该区块必须唯一位于 `## 多角色评审记录` 内。不得手工新建平行“最终复审”标题或重复角色结论表。普通同步、补登记和下一轮复审均自动执行，只有真实阻塞才向用户提问。脚本评审通过后使用 `execution-authorization-request` 生成统一清单；范围变化只使用 `execution-scope-reopen`，不手工改本机状态。

### 评审编排不可跳过顺序

1. 完成全部用例包、`REQ → RULE → caseId` 同步和 `TASK-03` 状态更新。
2. 在启动 reviewer 前登记初审批次、`TASK-04`、输入基线和 `plan.md` 中的适用 reviewer 行。
3. 每个 reviewer 启动成功后立刻登记其真实 Agent 任务标识；并发槽不足时将未启动角色标为“等待资源”，待资源释放后再启动。
4. 收齐所有适用 reviewer 后，一次性回填角色结论、发现项、唯一分类、处置方式、沉淀判定和初审综合结论。
5. 对资料明确的缺口自动演进，登记修订产物和关系同步结果，使初审批次失效。
6. 使用新输入基线登记并启动全部适用 reviewer 的最终复审；仅最终复审可以形成“可提交确认”。
7. 只有最终复审收敛、正式记录与本机状态一致时，才输出用例确认请求。

## 资源

| 测试类型 | 技术与模板 |
| --- | --- |
| Web/H5 | Playwright；`templates/playwright.spec.template.ts` |
| 原生 App/WebView | Appium + WebdriverIO；`templates/appium.spec.template.ts` |
| API | TypeScript API Client；复用 `src/clients/` 与 `tests/api/` |
| MQTT/IoT 链路 | mqtt.js 与已确认的组合 Runner；`templates/iot-chain.spec.template.ts` |

`templates/` 只提供结构，`examples/` 只作参考；两者都不等同于已验证测试资产。

## 每次回复的最小信息

先输出完整的简短任务进度卡片，紧接着输出“本轮产出卡”：固定附当前 `plan.md` 的可点击预览入口，并列出本轮新增或更新的安全持久化文件及其预览方式；无文件时写“本轮无持久化文件变更”。先用 `npm run task:output` 登记产出；不得链接 `sources/`、`test-assets/`、`.env`、`.auth/`、`.local/`、归档或敏感文件。随后说明当前阶段、本轮实际引用资料、已确认内容、推断与缺失项、风险、改动文件（如有）和等待用户审核事项；已选静态资产另以“本轮测试资产引用”列出可点击路径，不计入产出卡。Appium、设备或 App 元数据缺失只影响工程设计与执行，不能阻塞用例生成。用例生成或更新时，在产出卡后继续按用例包展示完整“编号 + 概括标题”清单。涉及写入测试时，说明环境规范要求的脱敏数据结论和残留风险；无法继续时，说明阻塞原因、未验证范围和最小补充信息。
