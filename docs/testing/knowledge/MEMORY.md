# 自动化工程经验（MEMORY）

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
## 2026-08-19：测试工程用例集修订的评审路径选择与耗时控制

- 经验编号：EXP-D481E5946181
- 适用范围：测试工程用例集修订的评审路径选择与耗时控制
- 证据状态：待验证
- 观察：create-product-20260819-r2 全程 141.8 分钟中有效 LLM 评审仅 13.6 分钟：40.3 分钟消耗在仅验证 2 个结构修复却被派发为全量复审（未带 affectedRef）的批次，64.4 分钟为需求歧义（F-06）拖到评审后才升级的中途用户等待；11 项评审发现中 8 项属可确定性拦截类别（计数漂移、模块归属错位、no_write 写动词、必填空值行、枚举口径）。
- 判断：评审-修订回路的主要浪费不是生成或 LLM 慢，而是三类结构问题：结构级缺陷漏进 LLM 评审、有界修正被派发为全量复审、需求歧义未在 plan 停点前置裁决。
- 当前优先策略：修订先跑 npm run testcases:revision-tier 对照已接受快照分级：structural 用 reviewer-dispatch/submit --deterministic 零 LLM 收口，scoped 用 --base-batch --affected-ref 定向单轮，substantive 才完整链；review-batch-start 必须声明 --activity/--affected-ref（同纪元全量复审有防呆警告）；plan 用「需求歧义与未定义预期」节把矛盾前移到 plan 确认回调一次裁决。
- 证据引用：commit 179c0c2 修订分层 fast-lane 与收敛断路器修复（含 r2 时间轴复盘依据的测试）、tests/support/task-workflow/revision-tiers.test.ts
- 验证条件：下一次修订轮按分层路径执行：structural 档零 LLM 收口、scoped 档单轮收敛，非用户等待相对 r2 显著缩短。
- 最近更新：2026-08-19T07:44:12.325Z
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
- 判断：评审发现分两类：可对照/可机判类（应前置到生成与门禁，发现成本低）与纯语义判断类（保留给隔离评审）；前置后 r1 发现数下降、演进小、复审快，整链缩短且不牺牲验证——隔离评审仍是『需求忠实性』审计的必要环节，不可跳过。
- 当前优先策略：生成阶段执行 SKILL.md「v7 生成阶段质量检查」5 项：平行段落交叉对照、边界完整性、状态机完整性、写入后置行为、可机判项预自查；lint 已强制的项（写动词×no_write、必填空值）生成时预自查使门禁一次通过；发现的矛盾登记歧义表并随用例确认一次裁决，不单边采信。
- 证据引用：skills/iot-automation-testing/SKILL.md（v7 生成阶段质量检查节）、commit 347750e、testcases/web/open-platform/suites/delete-product/design.md（需求歧义表）
- 验证条件：已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新
- 最近更新：2026-08-20T01:09:24.402Z
<!-- project-experience:97D550F7E7F1:end -->
