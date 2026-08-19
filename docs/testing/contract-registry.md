# 自动化测试契约注册表

<!-- owns: automation.contracts -->

> 注册表版本：contract-registry-v1。

本文是仓库专有契约标识、当前版本与历史兼容状态的唯一登记表。其他规范只解释其负责契约的语义并链接本表，不得另建版本清单。代码中的常量是实现引用，新增或改名必须先更新本表并通过架构检查。

状态含义：

- **当前**：允许新请求生成或当前运行路径消费；同族存在多个当前标识时，其适用范围必须互斥。
- **仅回放**：运行时只允许读取既有 history，不得用于新请求生成、重新发布或新执行授权。
- **归档证据**：标识可能出现在归档原文或不可变 history 文本中，但当前运行时不解析对应资产。
- **无**：该族当前没有对应状态的标识。

| 契约族 | 当前标识 | 非当前标识及状态 | 语义责任 | 用途或适用范围 |
| --- | --- | --- | --- | --- |
| 注册表 | `contract-registry-v1` | 无 | 本文件 | 本注册表自身结构 |
| 候选发布 | `artifact-publish-manifest-v1` | 无 | 流程规范 | 候选资产原子发布清单 |
| 浏览器探索资格 | `browser-exploration-eligibility-v1` | 无 | 定位规范 | 受控探索资格判定 |
| 浏览器探索证据 | `browser-exploration-evidence-v1`、`browser-response-contract-evidence-v1` | 无 | 定位规范 | 页面与响应探索证据 |
| 浏览器探索宿主协议 | `browser-exploration-host-setup-v1`、`browser-exploration-host-status-v1`、`browser-exploration-host-remove-v1`、`browser-exploration-managed-v1` | 无 | 定位规范 | 宿主探索环境生命周期 |
| 浏览器探索策略 | `browser-exploration-policy-v1` | 无 | 定位规范 | 探索安全策略 |
| 候选门禁 | `candidate-gate-v1` | 无 | 用例规范 | v3 候选结构、关系与风险门禁 |
| 候选生成策略 | `candidate-generation-policy-v1` | 无 | 用例规范 | 候选生成约束 |
| 能力证据 | `capability-evidence-v1` | 无 | 环境规范 | readiness 能力证明 |
| 用例确认 subject | `case-confirmation-subject-v2` | 仅回放：`case-confirmation-subject-v1` | 流程规范 | 当前一次性用例确认摘要 |
| 用例证据包 | `case-evidence-bundle-v2` | 无 | 报告规范 | 父用例正式结果证据 |
| 用例关系投影 | `case-relation-projection-v3` | 归档证据：`case-relation-projection-v1`、`case-relation-projection-v2` | 用例规范 | v3 唯一运行时契约；旧版不提供解析适配器 |
| 用例评审风险 | `case-review-risk-v2` | 仅回放：`case-review-risk-v1` | 用例规范 | 当前 reviewer 语义风险评估 |
| 执行授权 | `execution-authorization-v4`、`execution-authorization-v5` | 仅回放：`execution-authorization-v2`、`execution-authorization-v3` | 流程规范 | v4 用于请求级重建，v5 用于稳定套件直跑 |
| readiness 评估 | `execution-readiness-assessment-v1`、`execution-readiness-v1` | 无 | 流程规范 | 执行前能力与清单评估 |
| 业务 Oracle 权威 | `formal-business-oracle-authority-v1`、`formal-business-oracle-contract-v1` | 无 | 流程规范 | 正式业务判定来源与契约 |
| 沿用结果 | `formal-carried-case-origin-v1`、`formal-carried-case-result-v1` | 无 | 报告规范 | 定位修复后的结果沿用 |
| 确定性结果 | `formal-deterministic-outcome-settled-v1` | 无 | 报告规范 | 可封印结果判定 |
| 完成封印 | `formal-execution-completion-seal-v1` | 无 | 报告规范 | 正式执行完成封印 |
| 执行依赖图 | `formal-execution-dependency-plan-v1` | 无 | 流程规范 | 命名资源拓扑波次 |
| 正式执行 manifest | `formal-execution-manifest-v3`、`formal-execution-manifest-v4` | 仅回放：`formal-execution-manifest-v1`、`formal-execution-manifest-v2` | 流程规范 | v3 请求级候选，v4 稳定套件资产 |
| 正式执行记录 | `formal-execution-record-v3` | 仅回放：`formal-execution-record-v1`、`formal-execution-record-v2` | 报告规范 | 当前正式执行记录 |
| 正式执行结果 | `formal-execution-result-v1`、`formal-execution-workflow-evidence-v1` | 无 | 报告规范 | 执行结果与 workflow 证据 |
| 正式运行摘要 | `formal-run-summary-v2` | 仅回放：`formal-run-summary-v1` | 报告规范 | 当前运行摘要 |
| 定位修复引用 | `formal-selector-repair-reference-v1` | 无 | 定位规范 | 正式结果中的定位修复引用 |
| 计划确认 subject | 无 | 仅回放：`plan-confirmation-subject-v1`、`plan-confirmation-subject-v2` | 流程规范 | 历史计划确认回放 |
| 项目经验候选 | `project-knowledge-candidates-v1` | 无 | 项目经验规范 | 本地候选控制元数据 |
| 请求内来源 | `request-local-source-v1` | 无 | 用例规范 | 请求级来源登记 |
| reviewer 批次范围 | `review-batch-scope-v3` | 仅回放：`review-batch-scope-v1`、`review-batch-scope-v2` | 流程规范 | 当前定向复审范围 |
| reviewer epoch | `review-epoch-v1` | 无 | 流程规范 | 评审演进 epoch |
| reviewer 发现与修订证据 | `review-findings-evidence-v1`、`review-revision-evidence-v1` | 无 | 用例规范 | 评审发现和修订证明 |
| reviewer 输入快照 | `review-input-snapshot-v2`、`review-role-input-v2` | 仅回放：`review-input-snapshot-v1` | 流程规范 | 当前冻结输入与角色投影 |
| reviewer 策略 | `review-policy-v3` | 仅回放：`review-policy-v1`、`review-policy-v2` | 用例规范 | 当前风险自适应评审策略 |
| 修订分层 | `revision-tier-v1` | 无 | 用例规范 | 用例集修订影响面分级与确定性收口 |
| reviewer readiness | `review-readiness-v1`、`reviewer-isolation-proof-v1` | 无 | 流程规范 | reviewer 可派发性与隔离证明 |
| 规则覆盖 | 无 | 归档证据：`rule-coverage-v1` | 用例规范 | 当前运行时不解析 |
| 规则设计台账 | `rule-design-ledger-v3` | 归档证据：`rule-design-ledger-v2` | 用例规范 | v3 是当前 RULE 唯一作者台账 |
| 规则设计矩阵 | 无 | 归档证据：`rule-design-matrix-v1` | 用例规范 | 当前运行时不解析 |
| 脚本评审证据 | `script-review-evidence-v2` | 仅回放：`script-review-evidence-v1` | 流程规范 | 当前脚本评审证据 |
| 脚本评审策略 | `script-review-policy-v3` | 无 | 流程规范 | 当前脚本风险分级策略 |
| selector 证据 | `selector-contract-evidence-v1`、`selector-evidence-cache-v1` | 无 | 定位规范 | selector 契约与缓存证据 |
| selector 修复 | `selector-repair-context-v1`、`selector-repair-incident-v1`、`selector-repair-reopen-v1` | 无 | 定位规范 | 定位漂移修复链路 |
| 来源契约证据 | `source-contract-evidence-v3` | 仅回放：`source-contract-evidence-v1` | 流程规范 | 当前正式来源契约证据 |
| 稳定套件 | `stable-test-suite-manifest-v1`、`test-suite-reuse-assessment-v1` | 无 | 流程规范 | 稳定套件与复用评估 |
| 测试设计索引 | `test-design-index-v3` | 归档证据：`test-design-index-v2` | 用例规范 | 当前内部设计索引 |
| workflow 定义与事件 | `test-workflow-definition-v1`、`test-workflow-event-v1` | 无 | 流程规范 | Durable Workflow 定义与事件 |
| workflow runtime | `test-workflow-runtime-v2` | 仅回放：`test-workflow-runtime-v1` | 流程规范 | 当前可丢弃宿主绑定结构 |
| Excel 评审导出 | `testcase-review-model-v1`、`testcase-review-export-v1`、`testcase-review-workbook-receipt-v1` | 无 | 用例规范 | 标准模型、导出封装和生成回执 |
| 用例文档 | `testcase-v6-layered` | 归档证据：`testcase-v2`、`testcase-v3`、`testcase-v4`、`testcase-v5-flat` | 用例规范 | v6 唯一运行时格式；重新启用必须新建当前格式请求 |
| 视觉评审 | `visual-review-request-v1` | 无 | 定位规范 | 最小局部视觉审查请求 |
| workflow gate | `workflow-gate-v2`、`workflow-host-continuation-v1` | 无 | 流程规范 | Gate 输出与宿主继续协议 |
| 自动只读授权策略 | `policy_auto_no_write_v2` | 无 | 环境规范 | test/pre 可证明零写入范围的自动授权 |

## 变更规则

1. 新契约名或新版本先登记，再修改代码、模板或规范；架构检查拒绝未登记标识。
2. 旧版本只有在“非当前标识及状态”单元格明确标为“仅回放”时才可由运行时兼容；“归档证据”不得进入解析、校验、评审或执行代码。
3. 新请求、候选发布、readiness 和正式执行遇到缺失、未知或拼写错误的契约名必须硬失败。
4. 无 marker 或归档资产只能作为原始文件查看；若需产生新事实，必须新建使用当前契约的请求。
