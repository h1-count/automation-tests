# 自动化测试契约注册表

<!-- owns: automation.contracts -->

> 注册表版本：contract-registry-v1。

本文是仓库专有工程契约标识的唯一登记表。其他规范只解释其负责契约的语义并链接本表，不得另建版本清单。代码中的常量是实现引用，新增或改名必须先更新本表并通过架构检查。

状态含义：

- **当前**：允许新请求生成或当前运行路径消费；每个契约族只有一个 `*-v1` 标识。
- **无**：该族当前没有对应状态的标识。

## 调试期版本治理

1. 当前工程资产（`src/`、`scripts/`、`tests/`、`docs/testing/`、Skill、模板与当前 suite）只允许登记并生成 `*-v1` 工程契约；任何非 v1 标识、无标识或拼写变体都必须硬失败。
2. 调试期不提供旧契约的解析、迁移、回放、降级默认值或兼容别名。历史证据只存在于 Git 历史与 `testcases/archive/`，不得被当前运行链路读取。
3. 版本号不得表达业务分支或资产归属。请求级与稳定套件级 Manifest 必须使用 `scope: "request" | "stable_suite"`；执行授权必须使用 `mode: "request" | "stable_suite"`。Validator 必须拒绝 scope/mode 与字段组合不一致的输入。
4. 当前结构的字段演进在调试期直接修改 v1 定义、构造器、夹具和规则；不增加 `v2`、`legacy`、`compat` 或多版本联合类型。
5. `sources/` 中的资料版本、章节版本和产品版本是业务事实，不是工程契约，不受本规则改名；`testcases/archive/` 保持原样。
6. 架构检查必须扫描所有当前工程资产，禁止出现 `*-v2` 及以上工程契约、旧版本联合类型或基于 `schemaVersion` 选择业务路径的分支。

| 契约族 | 当前标识 | 非当前标识及状态 | 语义责任 | 用途或适用范围 |
| --- | --- | --- | --- | --- |
| 注册表 | `contract-registry-v1` | 无 | 本文件 | 本注册表自身结构 |
| 候选发布 | `artifact-publish-manifest-v1` | 无 | 流程规范 | 候选资产原子发布清单 |
| 浏览器探索资格 | `browser-exploration-eligibility-v1` | 无 | 定位规范 | 受控探索资格判定 |
| 浏览器探索证据 | `browser-exploration-evidence-v1`、`browser-response-contract-evidence-v1` | 无 | 定位规范 | 页面与响应探索证据 |
| 浏览器探索宿主协议 | `browser-exploration-host-setup-v1`、`browser-exploration-host-status-v1`、`browser-exploration-host-remove-v1`、`browser-exploration-managed-v1` | 无 | 定位规范 | 宿主探索环境生命周期 |
| 浏览器探索策略 | `browser-exploration-policy-v1` | 无 | 定位规范 | 探索安全策略 |
| 候选门禁 | `candidate-gate-v1` | 无 | 用例规范 | 候选结构、关系与风险门禁 |
| 候选生成策略 | `candidate-generation-policy-v1` | 无 | 用例规范 | 专用领取同时登记模型开始事件，发布前必须有当前 attempt 的计时记录 |
| 候选计划预检 | `candidate-plan-preflight-v1` | 无 | 用例规范 | compiler 前的计划、来源、显式事实与冻结 clause→RULE→case 分解阻断契约 |
| 候选计划暂存 | `candidate-plan-staging-v1` | 无 | 流程规范 | full_replan 初始化的本机无业务事实骨架；不得发布为正式 plan.md |
| 候选规则编译提议 | `candidate-compiler-spec-v1` | 无 | 用例规范 | 受控模型提议；只声明 clause 的方式与确定性事实，RULE/case/source/模块归属由冻结计划派生 |
| 候选分片清单 | `candidate-fragment-manifest-v1` | 无 | 用例规范 | 从 RULE—case 闭包派生的不可变模块，并冻结按 case 的确定性/模型 clause 归属 |
| 能力证据 | `capability-evidence-v1` | 无 | 环境规范 | readiness 能力证明 |
| 用例确认 subject | `case-confirmation-subject-v1` | 无 | 流程规范 | 当前一次性用例确认摘要 |
| 用例证据包 | `case-evidence-bundle-v1` | 无 | 报告规范 | 父用例正式结果证据 |
| 用例关系投影 | `case-relation-projection-v1` | 无 | 用例规范 | 当前唯一运行时契约 |
| 用例评审风险 | `case-review-risk-v1` | 无 | 用例规范 | 当前 reviewer 语义风险评估 |
| 执行授权 | `execution-authorization-v1` | 无 | 流程规范 | 以 `mode=request/stable_suite` 区分请求级重建与稳定套件直跑 |
| readiness 评估 | `execution-readiness-assessment-v1`、`execution-readiness-v1` | 无 | 流程规范 | 执行前能力与清单评估 |
| readiness 前置兼容校验 | `readiness-preflight-v1` | 无 | 流程规范 | 在领取 readiness 前验证不可变执行输入 |
| 业务 Oracle 权威 | `formal-business-oracle-authority-v1`、`formal-business-oracle-contract-v1` | 无 | 流程规范 | 正式业务判定来源与契约 |
| 沿用结果 | `formal-carried-case-origin-v1`、`formal-carried-case-result-v1` | 无 | 报告规范 | 定位修复后的结果沿用 |
| 确定性结果 | `formal-deterministic-outcome-settled-v1` | 无 | 报告规范 | 可封印结果判定 |
| 完成封印 | `formal-execution-completion-seal-v1` | 无 | 报告规范 | 正式执行完成封印 |
| 执行依赖图 | `formal-execution-dependency-plan-v1` | 无 | 流程规范 | 命名资源拓扑波次 |
| 正式执行 manifest | `formal-execution-manifest-v1` | 无 | 流程规范 | 以 `scope=request/stable_suite` 区分候选与稳定套件资产 |
| Web 候选脚本规格 | `formal-web-script-spec-v1` | 无 | 流程规范 | Web build 的唯一受控输入；每个步骤必须绑定冻结 coverageId，工具确定性渲染字面量 `formalCase`、manifest 与来源证据，不接受宿主提交 TypeScript 或手写 case 范围 |
| Web 脚本覆盖计划 | `formal-web-coverage-plan-v1` | 无 | 流程规范 | 从已确认用例的每条执行数据行派生 coverageId；候选规格、静态编译与评审必须对该集合完整且唯一覆盖 |
| Web 脚本覆盖门禁 | `web-script-coverage-gate-v1` | 无 | 流程规范 | 发布候选脚本前阻断漏行、泛化 Oracle、文件资产和操作证据缺口 |
| Web 脚本编译器 | `formal-web-script-compiler-v1` | 无 | 流程规范 | 生成静态 Web `formalCase`、manifest 与覆盖工件的确定性渲染器标识 |
| Web 脚本受限修复 | `formal-web-script-repair-proposal-v1`、`formal-web-script-repair-report-v1` | 无 | 流程规范 | 宿主只能为遗漏 coverageId 提交结构化步骤；工具记录已修复与未收口范围 |
| 本地生成上传资产 | `generated-upload-asset-manifest-v1` | 无 | 流程规范 | 每个请求本地生成的合成上传边界文件、生成器与摘要；大文件不入 Git，必须位于当前运行档案并在 build 校验 |
| 正式执行记录 | `formal-execution-record-v1` | 无 | 报告规范 | 当前正式执行记录 |
| 正式执行结果 | `formal-execution-result-v1`、`formal-execution-workflow-evidence-v1` | 无 | 报告规范 | 执行结果与 workflow 证据 |
| 正式运行摘要 | `formal-run-summary-v1` | 无 | 报告规范 | 当前运行摘要 |
| 定位修复引用 | `formal-selector-repair-reference-v1` | 无 | 定位规范 | 正式结果中的定位修复引用 |
| 计划确认 subject | `plan-confirmation-subject-v1` | 无 | 流程规范 | 当前计划确认摘要 |
| 项目经验候选 | `project-knowledge-candidates-v1` | 无 | 项目经验规范 | 本地候选控制元数据 |
| 请求内来源 | `request-local-source-v1` | 无 | 用例规范 | 请求级来源登记 |
| 请求策略 | `request-policy-v1` | 无 | 工作流基线 | 每个 v1 request 冻结复用入口、交付目标、评审策略、写入边界与选中范围 |
| 请求成本分析 | `request-cost-analysis-v1` | 无 | 研究文档 | 事件模型调用、模型计时、token 遥测、clause/case 编译覆盖及 Excel 缓存可观测性 |
| 运行意图 | `run-intent-v1` | 无 | 流程规范 | 复用分支的本轮机器可读输入证明；history 只记录安全路径、摘要和复用结论 |
| 影响闭包与设计增量 | `impact-closure-v1`、`design-delta-v1` | 无 | 用例规范 | affected 重建冻结的 SRC→REQ→RULE→caseId 范围与受控设计增量 |
| reviewer 定向读取图 | `review-reading-map-v1` | 无 | 用例规范 | reviewer 必读区间与交叉对照配对 |
| reviewer 批次范围 | `review-batch-scope-v1` | 无 | 流程规范 | 当前定向复审范围 |
| reviewer epoch | `review-epoch-v1` | 无 | 流程规范 | 评审演进 epoch |
| reviewer 发现与修订证据 | `review-findings-evidence-v1`、`review-revision-evidence-v1` | 无 | 用例规范 | 评审发现和修订证明 |
| reviewer 输入快照 | `review-input-snapshot-v1`、`review-role-input-v1`、`reviewer-input-packet-v1`、`review-input-digest-v1` | 无 | 流程规范 | 冻结原件、角色摘要、只读分片包与摘要算法 |
| reviewer 策略 | `review-policy-v1` | 无 | 用例规范 | 当前风险自适应评审策略 |
| reviewer 执行预算 | `reviewer-execution-policy-v1` | 无 | 流程规范 | 每 attempt 一主一补充模型调用、10 分钟墙钟和完成事件边界 |
| 需求事实预提取 | `requirement-facts-v1` | 无 | 用例规范 | 骨架阶段零推理候选事实与覆盖闭包审计 |
| 修订分层 | `revision-tier-v1` | 无 | 用例规范 | 用例集修订影响面分级与确定性收口 |
| reviewer readiness | `review-readiness-v1` | 无 | 流程规范 | reviewer 可派发性与冻结输入可用性 |
| 规则设计台账 | `rule-design-ledger-v1` | 无 | 用例规范 | 当前 RULE 唯一作者台账 |
| 脚本评审证据 | `script-review-evidence-v1` | 无 | 流程规范 | 当前脚本评审证据 |
| 脚本评审策略 | `script-review-policy-v1` | 无 | 流程规范 | 当前脚本风险分级策略 |
| 脚本评审聚合回执 | `script-review-receipt-v1` | 无 | 流程规范 | 隔离 reviewer 的冻结输入、角色回执与发现收口绑定 |
| selector 证据 | `selector-contract-evidence-v1`、`selector-evidence-cache-v1` | 无 | 定位规范 | selector 契约与缓存证据 |
| selector 修复 | `selector-repair-context-v1`、`selector-repair-incident-v1`、`selector-repair-reopen-v1` | 无 | 定位规范 | 定位漂移修复链路 |
| 来源契约证据 | `source-contract-evidence-v1` | 无 | 流程规范 | 当前正式来源契约证据 |
| 稳定套件 | `stable-test-suite-manifest-v1`、`stable-script-assets-v1`、`test-suite-reuse-assessment-v1` | 无 | 流程规范 | 冻结设计与 verified execution 证据；脚本资产记录 reviewed/verified 绑定、闭包与评审/执行摘要；评估契约用于复用判定 |
| 测试设计索引 | `test-design-index-v1` | 无 | 用例规范 | 当前内部设计索引 |
| workflow 定义与事件 | `test-workflow-definition-v1`、`test-workflow-event-v1` | 无 | 流程规范 | Durable Workflow 定义与事件 |
| workflow runtime | `test-workflow-runtime-v1` | 无 | 流程规范 | 当前可丢弃的协调与逻辑绑定结构 |
| Excel 评审导出 | `testcase-review-model-v1`、`testcase-review-export-v1`、`testcase-review-workbook-receipt-v1`、`testcase-review-cache-v1` | 无 | 用例规范 | 内容摘要可跨请求复用；绑定摘要、回执与发布事件只属于本轮请求 |
| Excel 评审渲染器 | `testcase-review-renderer-v1` | 无 | 用例规范 | 内容摘要包含的确定性布局与渲染器版本；升级即缓存失效 |
| 用例文档 | `testcase-v1-layered` | 无 | 用例规范 | 当前唯一运行时格式 |
| 视觉评审 | `visual-review-request-v1` | 无 | 定位规范 | 最小局部视觉审查请求 |
| workflow gate | `workflow-gate-v1`、`workflow-host-continuation-v1` | 无 | 流程规范 | Gate 输出与宿主继续协议 |
| 自动只读授权策略 | `policy_auto_no_write_v1` | 无 | 环境规范 | test/pre 可证明零写入范围的自动授权 |

## 变更规则

1. 新契约名先登记，再修改代码、模板或规范；调试期不得新增新版本号，架构检查拒绝未登记标识。
2. 调试期只允许当前 v1 标识进入解析、校验、评审或执行代码；旧标识只存在于 Git 历史与 archive。
3. 新请求、候选发布、readiness 和正式执行遇到缺失、未知或拼写错误的契约名必须硬失败。
4. 无 marker 的资产不能进入当前运行；若需产生新事实，必须新建使用当前契约的请求。
