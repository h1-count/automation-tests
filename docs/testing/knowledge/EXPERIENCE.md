# 自动化工程经验（EXPERIENCE）

> 测试工程自身经验的唯一事实源。被测产品的产品测试经验见对应 `<project>-testing-knowledge.md`，沉淀与分工规则见 [README.md](./README.md)。

## 经验沉淀规则

**写入判据（唯一标准）**：该经验换一个被测项目（open-platform 换成 App、MQTT 或任何产品）是否仍然成立——成立即工程经验，写入本文件；不成立（依赖被测产品的环境、定位、行为）则属于产品经验，写入对应项目文件。授权决定（生产访问、业务写入、OTP、安全挑战、设备动作）永远按请求单独确认，不沉淀为任何经验。

**什么写入这里**：工作流引擎编排与耗时归因（修订分层、评审批次范围、收敛断路器）、用例文档契约（testcase-v6-layered 结构、派生区唯一作者、参数化拆行）、评审产物契约（发现文件骨架、事件字段白名单）、套件模型与复用评估（stable 注册门槛、设计复验路径）、工具链入口（reproject、revision-tier、quality-gate 脚本语义）及其踩坑与修复验证。

**什么不写入这里**：被测系统行为与定位策略（→ 项目文件）；引擎规范性不变量——已在 SKILL.md / docs/testing 规范文件中作为规则维护的，不在此重复（本文件记「为什么」与「怎么验证」，规则文件记「是什么」）；用户协作偏好（→ `.local/USER-PREFERENCES.md`）。

**写入方式**：通过 `scripts/manage-project-knowledge.ts` 的官方 upsert 入口（`--project automation-engineering` 或直接调用 `upsertProjectExperience`），保证 EXP 编号（scope 哈希派生）、九字段结构与敏感信息扫描。同一 scope 原位覆盖，旧内容只由 Git 历史保留；标题与「适用范围」必须使用同一 scope 文字。

**证据要求**：证据引用只指向 Git 内可审查产物（引擎提交哈希、测试文件、规范文件章节），不引用 `.local/` 本机运行档案（跨机器不可恢复）。

**证据状态生命周期**：`待验证`（策略形成即写入）→ `受控探索已验证`（确定性校验/缺陷重建/离线验证通过，如设计复验三步路径）→ `正式执行已验证`（真实测试运行中命中并复核）。同 scope 出现新观察时原位覆盖并更新状态；被证伪时以最新记录覆盖并在正文说明被证伪的事实。

## 经验条目

<!-- project-experience:D481E5946181:start -->
<a id="exp-d481e5946181"></a>
## 2026-08-24：测试工程用例集修订的评审路径选择与耗时控制

- 经验编号：EXP-D481E5946181
- 适用范围：测试工程用例集修订的评审路径选择与耗时控制
- 证据状态：正式执行已验证
- 观察：r2-0824 域补全按分层路径完整执行一轮：substantive 全链评审（combined 5+impact 5=10 项发现）→ 修复演进 → --base-batch --affected-ref 定向复审（9 用例+4 规则切片，combined 4+impact 3=7 项）→ 口径闭合轮以 structural 档 --deterministic --classifier-digest 零 LLM 收口收敛。有效性实证：定向复审输入冻结无漂移、口径闭合未再派发 LLM 即收敛。残余缺口：首轮修复自身引入的跨请求视角问题（reusable_fixture 复用与「本请求造数」删除口径冲突、企业B 上线写入授权未闭合）仍需一轮 LLM 定向复审才暴露——「修复引入面」的新口径缝隙无法纯机判。
- 判断：分层路径把收敛成本从「每轮全量 LLM」降为「首轮全链 + 定向复审 + 确定性收口」三级；结构类可机判项应在作者自检阶段拦截（本轮 sourceRef 行号漂移即冻结时转录失准，本可 sed 对照机验）；修复引入面必须再定向复审一轮，但纯口径闭合（不动断言主句）可确定性收口。
- 当前优先策略：保持三级分层：结构类（计数漂移、行号对照、no_write 动词、参数化契约）进作者自检脚本化前置；修复演进后按「修复引入面」声明 affected-ref 定向复审一轮；复审员输入裁剪时把可机判项（基线重叠 git diff+sync-relations、原文自包含 grep）显式留给委托方确定性工具核验，避免评审员因输入不全报「无法机判」；纯口径闭合走 structural 零 LLM 收口。
- 证据引用：commit 179c0c2（修订分层 fast-lane 与收敛断路器）；commit a8f02b3（r2-0824 套件演进产物，26 例含参数化）；tests/support/task-workflow/revision-tiers.test.ts
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-24T06:28:52.135Z
<!-- project-experience:D481E5946181:end -->

<!-- project-experience:EC6FEBC23D0C:start -->
<a id="exp-ec6febc23d0c"></a>
## 2026-08-19：测试工程 cases.md 用例集的派生区维护与结构漂移修复

- 经验编号：EXP-EC6FEBC23D0C
- 适用范围：测试工程 cases.md 用例集的派生区维护与结构漂移修复
- 证据状态：待验证
- 观察：r2 修订发布后计数行未更新、新用例块错位到其他模块段，直到下一轮复审才发现；一致性检查早已存在但只挂在生成时 candidate-gate，评审演进发布 cases.md 后无任何重验（事件流证实 evolution 发布后直接进评审）。
- 判断：统计行与快速索引是由用例体确定性派生的只读视图，手写必然漂移；结构校验必须在一切用例包发布边界强制，不能依赖生成时一次。重投影的模块归位依据只能是原始快速索引（reviewIndex）——解析器为正文块赋 module 用的是所在段头，先投影会销毁声明意图。
- 当前优先策略：永不手写计数行/快速索引；编辑 cases.md 后用 npm run testcases:reproject -- <cases.md>（--dry-run 预览）重投影派生区并按原始索引声明归位模块；引擎已在 candidate-gate 与发布边界确定性拒绝漂移，r2 缺陷重建验证修复产物与接受态逐字节一致。
- 证据引用：commit fded691 发布边界校验与派生视图漂移门禁、commit 1ba7e2f testcases:reproject 脚本、`tests/support/` 的 v6 分层文档校验测试与 `tests/support/task-workflow/manager.test.ts`（漂移拒绝与归位测试）
- 验证条件：下一次真实修订中出现漂移时被发布边界拒绝，并经 reproject 一键修复后通过结构校验。
- 最近更新：2026-08-19T07:44:12.326Z
<!-- project-experience:EC6FEBC23D0C:end -->

<!-- project-experience:C54F18BC7F74:start -->
<a id="exp-c54f18bc7f74"></a>
## 2026-08-19：测试工程评审员发现文件的提交契约

- 经验编号：EXP-C54F18BC7F74
- 适用范围：测试工程评审员发现文件的提交契约
- 证据状态：待验证
- 观察：r2 第四批评审员运行约 40 分钟后未写发现文件，整轮返工重派；引擎此前不校验发现文件存在性与结论枚举，收口依赖代理自觉。
- 判断：reviewer 发现文件是评审轮收口的硬依赖，缺失或结论非法（非 converged/findings_present 枚举）应在提交时拒绝而非事后发现；引擎新事件字段必须同时过 prepareReviewLifecycleEvent 的输入接口、枚举断言与 payload 展开三处白名单，否则被静默剥离。
- 当前优先策略：所有 reviewer-submit（含 LLM 隔离评审员）必须带 --findings：骨架为「## 结论」（converged/findings_present）+ findings_present 时非空「## 发现项」表；引擎校验骨架并把 findingsDigest 与 conclusion 写入 ReviewerSubmitted 事件。
- 证据引用：commit fded691 评审发现文件契约（reviewLifecycle.assertReviewerFindingsShape）、tests/support/task-workflow/manager.test.ts 发现文件契约拒绝/通过测试
- 验证条件：后续评审轮按契约提交，未再出现发现文件缺失或结论非法的返工。
- 最近更新：2026-08-19T07:44:12.327Z
<!-- project-experience:C54F18BC7F74:end -->

<!-- project-experience:2727BBB6BF2D:start -->
<a id="exp-2727bbb6bf2d"></a>
## 2026-08-19：测试工程已确认设计套件的再次测试路径

- 经验编号：EXP-2727BBB6BF2D
- 适用范围：测试工程已确认设计套件的再次测试路径
- 证据状态：受控探索已验证
- 观察：create-product-20260819-r3 尝试 direct_execute 复验被复用评估判 full_replan（stable_suite_not_found）：stable 套件注册（suite.manifest.json）强制要求 entryScripts/scriptClosure/执行授权等 full_run 冻结证据，testcase_only 交付轮不可能产出；对未变更设计重跑生成会人为制造冻结资产漂移。
- 判断：设计类套件没有 direct_execute 复用路径；「仅复验设计」的正确语义是确定性校验（资产零漂移+需求源未变+追溯复验），不是重新生成或重新确认。
- 当前优先策略：设计复验三步：git diff <接受提交> -- testcases/.../suites/<feature>/ 验证零漂移；git diff <接受提交> -- sources/ 验证需求源未变；用 scripts/testcase-quality-gate.ts 导出的 parseRuleRecords/validateRuleCoverage 对 design.md+cases.md 实时复验 REQ→RULE→case 双向追溯。确需执行时另发起 full_run 轮走 build→授权→执行链，不混入复验请求。
- 证据引用：src/support/test-suite/stableSuite.ts direct_execute 唯一分支与 promote 门槛、tests/support/task-workflow/manager.test.ts 套件复用相关测试
- 验证条件：已按此路径完成 create-product 设计复验（套件零漂移、11 规则全覆盖、0 追溯问题）；下次设计复验直接复用并复核结论仍成立。
- 最近更新：2026-08-19T07:44:12.328Z
<!-- project-experience:2727BBB6BF2D:end -->

<!-- project-experience:6AEFB8B03CB4:start -->
<a id="exp-6aefb8b03cb4"></a>
## 2026-08-19：测试工程 no_write 用例的写动词与必填空值覆盖

- 经验编号：EXP-6AEFB8B03CB4
- 适用范围：测试工程 no_write 用例的写动词与必填空值覆盖
- 证据状态：待验证
- 观察：r2 首轮评审 8 项发现中 4 项可机判：步骤含真实写动词但声明 no_write（编辑后查看更新时间）、必填字段缺空值数据行（型号必填仅覆盖长度/字符无空值行）、枚举口径偏差、安全边界句式缺失。
- 判断：写动词×no_write 是数据策略矛盾，必须确定性阻断；必填→空值行的字段级精确映射是语义命题，只做 warning 提示交 reviewer/用户裁决，不做机械阻断。
- 当前优先策略：含写动作（创建/新增/提交/修改/编辑/更新/删除/上传/写入）的步骤一律拆分为 ephemeral_cleanup 用例并受执行授权约束；RULE 台账「条件/输入」含必填时，关联参数化用例须有空值数据行（留空/为空/不填/空值/清空）；两项均由 candidate-gate 强制（issue/warning）。
- 证据引用：commit fded691 覆盖 lint（candidateGate 写动词阻断+必填空值 warning）、tests/support/task-workflow/candidate-gate.test.ts lint 单测
- 验证条件：下次生成轮的首轮评审不再出现上述可机判类别的发现。
- 最近更新：2026-08-19T07:44:12.328Z
<!-- project-experience:6AEFB8B03CB4:end -->

<!-- project-experience:0B6E3865EA05:start -->
<a id="exp-0b6e3865ea05"></a>
## 2026-08-19：v7 活动 owned artifacts 发布契约（发布集与部分发布收敛）

- 经验编号：EXP-0B6E3865EA05
- 适用范围：v7 活动 owned artifacts 发布契约（发布集与部分发布收敛）
- 证据状态：受控探索已验证
- 观察：delete-product 首轮 candidate-generation 把 design.md 混入发布集被引擎拒绝（只允许 plan.md+cases.md），且首次失败留下部分发布清单，后续发布进入 requires reconciliation 状态。
- 判断：v7 各活动 owned artifacts 是固定契约：candidate_generation=plan+case 包、review_resolution=plan、automatic_evolution=plan+全部 case 包；design.md 是套件 Git 资产，不经工作流发布；发布失败可能留下部分清单，盲目重试会继续触发 reconciliation。
- 当前优先策略：发布前先按活动 kind 核对 owned 产物集（只发布契约内产物）；遇到 requires reconciliation 错误时用 task:manage reconcile --activity <id> --publish <publishId> --evidence <摘要> 收敛，不重试原命令。
- 证据引用：src/support/task-workflow/workflowManager.ts（owned artifacts 校验）、src/support/task-workflow/artifactPublisher.ts（recover/reconcilePrepared）、src/support/task-workflow/cli/manage.ts（artifact-publish-succeed/reconcile）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-19T08:52:02.011Z
<!-- project-experience:0B6E3865EA05:end -->

<!-- project-experience:1A703C7F925D:start -->
<a id="exp-1a703c7f925d"></a>
## 2026-08-19：candidate-gate no_write 用例写动词 lint：否定句也命中

- 经验编号：EXP-1A703C7F925D
- 适用范围：candidate-gate no_write 用例写动词 lint：否定句也命中
- 证据状态：受控探索已验证
- 观察：delete-product 首轮 OPEN-DEL-005 操作文本「记录该状态产品删除入口的呈现事实（不点击删除）」因含「删除」字样被 candidate-gate 以 no_write 写动词阻断，即使语义是否定句。
- 判断：businessWriteVerb 正则（创建|新增|提交|修改|编辑|更新|删除|上传|写入）无否定感知，操作列出现写动词字面即触发 no_write 阻断；这是确定性契约而非引擎缺陷。
- 当前优先策略：no_write 用例的操作列编写前自查零写动词（含否定句与引述）；确实需触发写路径的观察统一升级 ephemeral_cleanup 并受执行授权约束，或改用中性措辞。
- 证据引用：src/support/task-workflow/candidateGate.ts（businessWriteVerb lint）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-19T08:52:05.837Z
<!-- project-experience:1A703C7F925D:end -->

<!-- project-experience:260F23257EEE:start -->
<a id="exp-260f23257eee"></a>
## 2026-08-19：v7 单 review 活动工作流演进后重开评审的标准序列

- 经验编号：EXP-260F23257EEE
- 适用范围：v7 单 review 活动工作流演进后重开评审的标准序列
- 证据状态：受控探索已验证
- 观察：delete-product 为 combined-only（无 impact 活动），评审演进后定向批次被解析为 full 模式（requiredActivityIds=全部 review 活动）→ scope 不写 baseBatchId → activateEvolvedReviewBatch 自动激活不触发，review 停在 SUCCEEDED，dispatch 被 reducer requireState(READY/RETRY_WAIT) 拒绝，评审循环断点（浪费约 3.7 分钟排查）。
- 判断：单 reviewer 场景下 v7 自动激活路径（依赖 targeted 批次的 baseBatchId）不可达，属引擎缺陷；activity-invalidate 是公开入口，其语义与自动激活等价，可安全完成同一重置；该缺陷已修复。
- 当前优先策略：引擎已修复：activateEvolvedReviewBatch 对单 review 活动（full 模式、无 baseBatchId）以『本批次之前最近的 v3 批次』为输入比较基准自动激活，无需手工 activity-invalidate；历史 workaround（task:manage activity-invalidate --activity <review-id> --reason activate_evolved_review_batch:...）仍向后兼容。
- 证据引用：commit cf865ba（feat(formal-execution) 评审演进闭环修复）、src/support/task-workflow/workflowManager.ts（activateEvolvedReviewBatch）、tests/support/task-workflow/candidate-gate.test.ts（single-reviewer 自动激活测试）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-19T09:52:46.312Z
<!-- project-experience:260F23257EEE:end -->

<!-- project-experience:7F8B47B767DB:start -->
<a id="exp-7f8b47b767db"></a>
## 2026-08-19：正式回调决定刷新评审纪元（review epoch）

- 经验编号：EXP-7F8B47B767DB
- 适用范围：正式回调决定刷新评审纪元（review epoch）
- 证据状态：受控探索已验证
- 观察：delete-product 轮 r3 定向复审批次以 r2 为 base 被『同纪元语义演进 cycle 超限 + 收敛断路器只解除一次』拒绝（blocker review-convergence-failed），被迫改写正式决定、resolve blocker、再改用 r1 为 base 绕过；根因是 reviewEpochDigest 的 planSubjectDigest 取 WorkflowStarted 冻结的 planDigest（reducer 只校验不更新），正式决定不刷新纪元，与 blocker resolutionCondition 声明的『新增正式用户决定或受控来源』刷新语义不符。
- 判断：评审纪元应随正式回调决定刷新：CallbackResolved 事件（v6/v7 非 execution_authorization 的正式 callback）已携带发布后 plan 的 digest（reducer 校验并记录），可直接作为 planSubjectDigest 来源；只有用户真实回调决定（有 subject 校验）刷新纪元，评审记录/台账/歧义表修改不刷新，cycle 上限安全阀不被绕过。
- 当前优先策略：引擎已修复：startReviewBatch 计算 reviewEpochDigest 时，planSubjectDigest 取最新正式回调决定（plan-confirmation/case-confirmation/case-review-conflict-decision）的 planDigest，缺省回退 WorkflowStarted 冻结值；正式决定（accepted/revision_requested）后同受控来源下可开新纪元批次，cycle 重新计数，不再出现『breaker 只解除一次后同纪元批次被永久拒绝』。
- 证据引用：commit cf865ba（feat(formal-execution) 评审演进闭环修复）、src/support/task-workflow/workflowManager.ts（reviewEpochDigest 计算）、tests/support/task-workflow/candidate-gate.test.ts（v7 formal decision refreshes the review epoch 测试）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-19T09:52:51.486Z
<!-- project-experience:7F8B47B767DB:end -->

<!-- project-experience:97D550F7E7F1:start -->
<a id="exp-97d550f7e7f1"></a>
## 2026-08-20：评审发现的可对照可机判类别前移到生成阶段

- 经验编号：EXP-97D550F7E7F1
- 适用范围：评审发现的可对照可机判类别前移到生成阶段
- 证据状态：受控探索已验证
- 观察：delete-product 轮 r1 五项发现（F-01 需求段口径冲突、F-02 覆盖缺口、F-03 边界不清晰、F-04 推导后验、F-05 状态证据缺失）全部可由生成阶段对照/自检拦截；F-01 类平行段落矛盾按章节提取正文无法暴露，只有跨段对照能发现（离线演示程序化命中『统一说明段重新开发 vs P0 段继续开发』）。
- 判断：评审发现分两类：可对照/可机判类（应前置到生成与门禁，发现成本低）与纯语义判断类（保留给隔离评审）；前置后 r1 发现数下降、演进小、复审快，整链缩短且不牺牲验证——隔离评审仍是『需求忠实性』审计的必要环节，不可跳过。该类前置自检的规范正文唯一责任源是用例规范 §3.2 首轮生成红线（既有 4 条同类先例），SKILL.md 只保留编排引用。
- 当前优先策略：生成阶段执行用例规范 §3.2 首轮生成红线第 5-9 条：平行需求段交叉对照、边界完整性、状态机完整性、写入后置行为、可机判项预自查；lint 已强制的项（写动词×no_write、必填空值）生成时预自查使门禁一次通过；发现的矛盾登记歧义表并随用例确认一次裁决，不单边采信。
- 证据引用：docs/testing/testcase-guideline.md（§3.2 首轮生成红线第 5-9 条）、commit 347750e/a06c83c、testcases/web/open-platform/suites/delete-product/design.md（需求歧义表）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-20T01:22:17.918Z
<!-- project-experience:97D550F7E7F1:end -->

<!-- project-experience:8930A9E44C21:start -->
<a id="exp-8930a9e44c21"></a>
## 2026-08-21：同路径产物发布与 plan 共有节同步的踩坑序列

- 经验编号：EXP-8930A9E44C21
- 适用范围：同路径产物发布与 plan 共有节同步的踩坑序列
- 证据状态：受控探索已验证
- 观察：registration-review 轮复现并扩展四类坑：①lease 默认 2 分钟窗口内无法完成核对→发布链，publish 时 claim 已过期，失败的 artifact-publish-succeed 会把活动推入 RECONCILING（部分产物集）或留下失败发布，需 task:resume + reconcile --outcome retry 后重新领取；②评审工作簿 testcase-review-publish 强制发布到仓库外（pathInside workspaceRoot 拒绝），沙箱 workspace-write 下仓库外目录只能在平台临时区（/tmp 可写）；③callback 决定行三个精确要求：决定类型列必须写中文「用例确认」（decisionTypeForActivity 映射），占位行「（本轮正式用户决定待…）」必须保留并只追加一行，subjectDigest 用 CallbackRequested 事件值；④套件 testcases/<type>/<project>/suites/<feature>/ 下文件的来源相对链接需 5 个 ../（上轮记录「套件目录 4 层」按 feature 子目录内文件应更正为 5 层），既有套件的 4 层链接是未被机器校验的历史笔误，review-batch-start 以「input must be controlled source」拒绝。
- 判断：四类坑同源：引擎发布/回调契约以磁盘当前内容与事件内摘要为唯一基准，任何中间态（过期租约、占位行、错误层级、仓库内路径）都确定性拒绝；恢复路径统一是 resume→reconcile→重新领取，不应重试原命令。
- 当前优先策略：①发布链在单个 bash 命令内连续执行领取+发布，避免租约窗口耗尽；②lease expired 先 task:resume 再 reconcile --outcome retry，部分产物集用 reconcile --publish <publishId>；③工作簿发布到 /tmp 仓库外目录再 cp 回运行档案留副本；④决定行模板：保留占位行+追加一行「| 用例确认 | <subjectDigest> | accepted | 说明 |」；⑤新套件来源链接从 feature 目录起算 5 个 ../ 并用 normpath 预验存在性。
- 证据引用：本轮 Git 提交（registration-review 套件）、.local/test-runs/web/open-platform/registration-review-20260821/workflow-history.ndjson 事件 13-18/25-31 与本轮处置过程
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-21T09:10:03.756Z
<!-- project-experience:8930A9E44C21:end -->

<!-- project-experience:BCB78D753769:start -->
<a id="exp-bcb78d753769"></a>
## 2026-08-20：测试工程 §4.3 用例评审工作簿生成依赖与预览契约

- 经验编号：EXP-BCB78D753769
- 适用范围：测试工程 §4.3 用例评审工作簿生成依赖与预览契约
- 证据状态：待验证
- 观察：build-testcase-review-workbook.mjs 依赖的 @oai/artifact-tool（宿主表格运行时）在本机与 npm 均不可得，历史所有运行均未生成 cases-review.xlsx（静默走 Markdown 回退），§4.3 强制评审界面实际从未落地
- 判断：评审工作簿的可契约部分（三表版式、统计公式、合并、回执、发布校验）全部可由 exceljs 确定性生成；真正依赖表格运行时的只有 PNG 渲染预览，可用逐表确定性文本预览（进 digest 链）等价满足「缺少预览或摘要不一致视为失败」的门禁
- 当前优先策略：直接运行 node scripts/build-testcase-review-workbook.mjs（exceljs 为 devDependency）；预览为逐表 .md 文本导出；公式正确性由确定性公式审计（生成串精确匹配 + 模型统计交叉核对）替代渲染错误扫描；Univer 导入可实时求值公式作视觉复核
- 证据引用：commit ff538d0；tests/support/testcase-review-workbook.test.ts 端到端测试（无宿主表格运行时生成可发布工作簿）
- 验证条件：下一次 v7 评审收敛轮实际生成并发布 cases-review.xlsx，不再 Markdown 回退
- 最近更新：2026-08-20T07:35:25.779Z
<!-- project-experience:BCB78D753769:end -->

<!-- project-experience:C926826E8034:start -->
<a id="exp-c926826e8034"></a>
## 2026-08-20：测试工程用例评审链路的耗时归因与子代理模型档位路由

- 经验编号：EXP-C926826E8034
- 适用范围：测试工程用例评审链路的耗时归因与子代理模型档位路由
- 证据状态：待验证
- 观察：对 6 个历史运行 workflow-history 事件时间戳做 Activity 时长与事件间隔分析：candidate-generation 仅占 1.7-2.9 分钟且 3-6 模块已全并行；时间大头是评审批次（ReviewerDispatched→ReviewerSubmitted，单批 3.7-28.8 分钟，每轮 2-4 批）与用户确认等待（3.7-17.9 分钟）；演进二批（activate_evolved_review_batch）是最长批次
- 判断：片段生成换快档位上限只省 1-2 分钟且是生成红线高发区，ROI 为负；真正的路由靶点是评审批次，但评审是审计质量环节，降档必须小范围试点带对照度量；dsh-tool-subagent 支持 agentOptions（provider/model）挂载级路由且子代理先继承父路由再被行配置覆盖，maxDepth 0 可禁止子代理再派生
- 当前优先策略：测试模式 preset 增加 tool-subagent-fast 行（toolName=subagent_fast，agentOptions 固定 zai-coding-cn/glm-5-turbo，maxDepth 0）：试点期仅 activate_evolved_review_batch 触发的演进二批可用 fast 档，骨架冻结、片段生成、首批评审与 resolution 保持默认档；在评审结论回复中对照两批时长与发现数（时长从事件间隔派生）；不达标删行即回退，模型名映射只存在于 preset 不进仓库规范
- 证据引用：EXP-D481E5946181（r2 时间轴复盘基线）；耗时分析方法为本轮对 workflow-history.ndjson 事件时间戳的 Activity 时长与 gap 提取（.local 本机运行档案仅作分析输入，不作证据链接）；路由机制核实自 deepseek-harness 源码 resolveChildAgentOptions 与 dsh-tool-subagent Config
- 验证条件：下一次出现演进二批的真实请求：fast 档批次时长显著低于同轮首批且发现数与有效率不降，则扩大试点；发现质量下降则删除 preset 行回退
- 最近更新：2026-08-20T07:54:14.294Z
<!-- project-experience:C926826E8034:end -->

<!-- project-experience:AEE6B7BA0667:start -->
<a id="exp-aee6b7ba0667"></a>
## 2026-08-24：需求解析的成本计量与降本护栏

- 经验编号：EXP-AEE6B7BA0667
- 适用范围：需求解析的成本计量与降本护栏
- 证据状态：受控探索已验证
- 观察：DSH 会话日志在 assistant/message 记录逐调用 usage（assistant/chunk 携带重复值，去重后才是真值）；registration-review-20260821 实测：主会话 198 次调用累计 29.96M cacheRead 占全请求 89%，4 片段子代理+两轮 reviewer 合计仅 1.5%；时间大头是重试/租约空闲（8.8min）与串行预工作，评审本身 r1 6.9min+r2 3.7min。跨请求基线：cacheRead 30M~258M/请求。
- 判断：无计量不动成本旋钮：token 大头是长主会话逐调用重读累积上下文而非评审输入，优化方向是把工作下沉到子代理与确定性脚本；砍读取广度必须同时买完整度保险——行覆盖闭包审计让漏覆盖从信任模型变成机判。
- 当前优先策略：每请求收尾跑 npm run cost:analyze 出双口径报告；骨架阶段消费 preflight-requirement-facts 零推理候选表（边界/必填/格式/枚举句式逐字引用+行号）并强制间隙区间显式登记；reviewer 派发携带 build-review-reading-map 读取图（必读区间+交叉对照配对，矛盾/存疑回退全文）；片段与 reviewer 提示稳定前缀在前命中缓存。发现率或覆盖审计劣化即回退全量上下文。
- 证据引用：scripts/analyze-request-cost.ts、scripts/preflight-requirement-facts.ts、scripts/build-review-reading-map.ts、tests/support/task-workflow/request-cost-analysis.test.ts、tests/support/testcase-review-reading-map.test.ts、tests/support/testcase-requirement-facts.test.ts、docs/research/requirement-parsing-cost-accuracy.md（含 5 请求基线表）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-24T01:49:38.297Z
<!-- project-experience:AEE6B7BA0667:end -->

<!-- project-experience:A85DA02E135C:start -->
<a id="exp-a85da02e135c"></a>
## 2026-08-24：测试工程 Durable 工作流手动推进的操作契约与产物所有权

- 经验编号：EXP-A85DA02E135C
- 适用范围：测试工程 Durable 工作流手动推进的操作契约与产物所有权
- 证据状态：受控探索已验证
- 观察：r2-0824 域补全请求手动推进中反复命中六类拒绝：等待回调期间编辑 plan 边界区导致主题漂移链（append-only 断言→subject changed→reopen 无子流→幂等冲突→请求作废重开）；向活动发布其不拥有的产物（case-generation 仅 cases.md，relation-sync/automatic_evolution 仅运行档案 plan+cases，套件文件只读）；120s 活动租约在修复+门禁耗时后过期；正式用户决定写入评审决定表被拒（需专属「## 正式用户决定」节：决定类型/subjectDigest/正式决定三列）；resolution=evolve 后 case-confirmation 因 activation 仅认 converged 保持 CANCELLED，必须再跑定向复审；确定性收口一员提交后批次轮转（新 id 带 r<hash> 后缀），旧批次 id 再派发触发幂等冲突。
- 判断：手动推进的失败几乎都不是引擎缺陷而是契约未读：每类活动有封闭的产物所有权集合；回调等待期等于主题冻结期；正式决定区与评审记录区是两张表；evolve 是「再评审」信号而非「通过」信号；批次轮转后旧 id 即失效。
- 当前优先策略：等待回调期间绝不编辑 plan 边界区，决定只经 callback-resolve 候选文件追加；发布前核对活动 owned artifacts 清单，套件文件仅在确认后手动落位；activity-start 与 artifact-publish-succeed 放同一命令串防租约过期，过期则 resume→reconcile retry→重领；正式决定先查先例 plan 的「## 正式用户决定」三列表；resolution=evolve 后按 --base-batch --affected-ref 规划定向复审，converged 才激活确认；批次轮转后从 workflow-history 尾部取最新批次 id 重绑评审员；纯口径闭合走 structural 档 --deterministic --classifier-digest 零 LLM 收口。
- 证据引用：src/support/task-workflow/callbackDecision.ts（正式决定区校验）；src/support/task-workflow/definition.ts（activation 契约）；docs/testing/automation-guideline.md §3.14（Durable 生命周期与恢复）；commit 179c0c2（分层与断路器）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-24T06:28:28.333Z
<!-- project-experience:A85DA02E135C:end -->

<!-- project-experience:0B78341B637A:start -->
<a id="exp-0b78341b637a"></a>
## 2026-08-24：测试工程参数化用例拆行的数据编号与操作列契约

- 经验编号：EXP-0B78341B637A
- 适用范围：测试工程参数化用例拆行的数据编号与操作列契约
- 证据状态：受控探索已验证
- 观察：新增参数化用例首次以 D1/D2 编号、两实例各占不同步骤号且操作列文本各异，被发布边界结构校验连续三次拒绝：数据编号须 D01-D99 两位定长；每数据实例步骤必须从 1 连续递增且步骤集合跨实例一致；同步骤号在不同数据实例中的操作列必须逐字一致。修正为 D01/D02、统一操作列、差异只落数据列后通过。
- 判断：参数化拆行的机判契约是「编号两位定长 + 每实例独立且同构的步骤序列 + 操作列跨实例恒等 + 差异仅允许在数据与预期列」，这是派生区与执行行展开确定性的前提；手工拼装参数化块时最易在操作列顺手改写。
- 当前优先策略：生成参数化块先写操作骨架，复制实例后只改数据列与预期列；两实例操作确需不同时拆为独立用例而非参数化；发布前依赖 artifact publish 内置结构校验拦截（勿试图绕过）。
- 证据引用：tests/support/task-workflow 的 v6 分层文档校验测试；scripts/sync-testcase-relations.ts（派生区同步）；docs/testing/testcase-guideline.md 参数化拆行规范；commit a8f02b3（含合规参数化块 OPEN-LIST-004 的套件演进）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-24T06:28:38.852Z
<!-- project-experience:0B78341B637A:end -->
