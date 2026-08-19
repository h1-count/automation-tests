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
- 证据引用：commit fded691 发布边界校验与派生视图漂移门禁、commit 1ba7e2f testcases:reproject 脚本、tests/support/testcase-document-v6-layered.test.ts、tests/support/task-workflow/manager.test.ts（漂移拒绝与归位测试）
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
