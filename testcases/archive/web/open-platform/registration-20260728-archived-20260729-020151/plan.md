# 测试计划：开放平台企业注册

> 本计划遵循[流程规范](../../../../docs/testing/automation-guideline.md)、[用例规范](../../../../docs/testing/testcase-guideline.md)、[环境规范](../../../../docs/testing/environment-guideline.md)和[定位规范](../../../../docs/testing/selector-guideline.md)。

> 结构版本：case-relation-projection-v1、durable-workflow-projection-v1、web-script-governance-v1、page-session-group-v1、case-evidence-policy-v1、rule-coverage-v1。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 计划编号 | OPEN-PLATFORM-REGISTRATION-20260728 |
| 状态 | 已确认 |
| 测试类型 | Web |
| 目标环境 | test（计划已确认；不构成验证码、上传、提交、认证或正式执行授权） |

## 正式用户决定

| 决定编号 | 主题 | subjectDigest | 决定 | 记录依据 |
| --- | --- | --- | --- | --- |
| DEC-REG-PLAN-001 | 开放平台企业注册测试计划 | `e01388cb37a67ff75120b15425909ad0071f61d5f1d11f22d639015e2b9ea3a0` | accepted；确认计划范围和 test 候选环境，不构成写入或正式执行授权 | `workflow-history.ndjson` seq 9-10 的 CallbackRequested/CallbackResolved |

## 任务执行清单

<!-- workflow-projection:head seq=86 digest=7402b20d65e2593f969d12fc93197daaea62e5a120bd1488c42fa3da7d8aa56e -->

<!-- testcase-standard: task-execution-list-v1 -->

| 序号 | 阶段 | 任务 | 进入条件 | 完成标志 | 状态 | 当前结论 / 需要动作 | 证据或输出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 计划 | 资料、静态资产与环境预检 | 用户提出开放平台注册测试需求 | 测试计划形成并通过静态检查 | 已完成 | 由请求级事件历史派生；SUCCEEDED 2 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |
| 2 | 计划确认 | 确认范围、环境、推断与数据策略 | 测试计划已生成 | 用户确认计划 | 已完成 | 计划确认已由绑定计划摘要的 accepted callback 事件证明；不构成写入或执行授权 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |
| 3 | 用例 | 生成全部注册用例包与追溯 | 测试计划已确认 | 用例包和 `REQ ↔ RULE ↔ caseId` 闭环 | 已完成 | 由请求级事件历史派生；SUCCEEDED 3 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |
| 4 | 评审 | 多角色评审、自动演进与复审 | 用例完整性检查通过 | 明确需求缺口关闭 | 已完成 | 由请求级事件历史派生；SUCCEEDED 8、CANCELLED 1 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |
| 5 | 用例确认 | 确认用例集与剩余业务裁决 | 评审完成 | 用户确认用例 | 阻塞 | 原因：Automatic evolution reached round 3 and REV04 still required deterministic revisions; the corrected recovery draft is not a confirmed testcase baseline.；分类：review_non_convergence；解除条件：User explicitly authorizes one round-3 recovery review against a new immutable digest, requests a narrower scope, or cancels the request.；影响：仅阻止本任务分支；BLOCKED 1 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |
| 6 | 工程设计 | 图谱、页面语义、数据与脚本方案定位 | 用例已确认 | 工程设计待审核 | 待开始 | 由请求级事件历史派生；PENDING 2 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |
| 7 | 脚本与执行 | 生成脚本、确认并执行 | 设计和执行授权完成 | 报告与复盘完成 | 待开始 | 由请求级事件历史派生；PENDING 9 | [workflow-history.ndjson](workflow-history.ndjson) head 86:7402b20d65e2 |

## 测试范围

### 包含

- 官网顶部“注册”入口，以及企业名称、统一社会信用代码、企业地址、企业标识、营业执照、申请人、联系方式、企业简介和企业邮箱的资料明确规则。
- 企业名称、企业标识、统一社会信用代码的唯一性提示；申请人作为账号名称；注册账号默认管理员；同一手机号可注册多个企业。
- 注册页原型可证明企业标识提示、验证码和营业执照上传视觉区域；需求文档内嵌截图另可证明协议区与“同意条款并注册”精确视觉文案。真实控件、状态、提交动作与结果留待工程探索。
- 短信、上传、单次提交、账号/企业关系查询和幂等清理的受控执行设计；本计划不授予执行权限。

### 不包含

- 登录、忘记密码、企业成员管理、产品开发与工单；控制台只作为注册账号关系的只读后置核验入口。
- 已引用资料未定义的验证码时效/频率/错误文案、证照格式/大小、独立协议勾选语义、提交成功文案和审核状态机断言。
- 待审核、审核通过、审核驳回及其生效时点；它们不再作为本次通过/失败依据。

## 输入资料

> 结构版本：source-reference-links-v1

| manifest id / sectionId | 资料类型 | 可点击资料链接 | 页码、标题或页面定位 | 版本 / SHA-256 | 本次用途 |
| --- | --- | --- | --- | --- | --- |
| aiot-platform-project-document / platform-home-and-registration | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | 官网改造 → 注册 | unknown / `64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b` | 注册入口、字段规则、唯一性提示、申请人账号名和手机号多企业关系 |
| aiot-platform-project-document / console-account-and-enterprise | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | AIoT控制台 → 系统入口、所属企业 | unknown / `64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b` | 注册账号默认管理员及账号/企业关系后置核验 |
| open-platform-axure-prototype / prototype-account-registration | 原型 | [注册页面.html](../../../../sources/prototypes/open-platform/注册页面.html) | 注册页面 | unknown / `d4e823a2b1c2c81d899ce3f1d00baee640257f9fc6c0cdc77d0e0493506a13cd` | 企业标识提示、验证码和证照上传区域的视觉存在性 |

## 测试资产选择

<!-- testcase-standard: test-asset-selection-v1 -->

| assetId | 类型 | 可点击资产链接 | 选择依据 | 选择状态 | 工程验证项 |
| --- | --- | --- | --- | --- | --- |
| open-platform-synthetic-business-license | test-document | [合成营业执照资产](../../../../test-assets/documents/open-platform/synthetic-business-license.png.b64) | open-platform / registration 的 active 合成证照候选 | 已选择候选 | 仅在不可变执行清单确认后内存解码；上传 intent、结果对账和清理均须登记 |

## 环境选择

> 结构版本：environment-status-v1

| 候选环境 | 选择依据 | 本地配置状态 | 预检状态 | 用户确认状态 | 未闭合项 |
| --- | --- | --- | --- | --- | --- |
| test | 用户未指定环境时的默认偏好，计划已确认 | Web 地址与测试账号引用已配置；未读取敏感值 | 已预检：2 通过、1 警告、0 失败 | 已确认 | 已登录会话、页面可用性、短信、上传、后置查询与清理能力未验证；执行仍需独立授权 |

## 测试方式

- 计划和用例阶段只处理需求追溯与无副作用设计；正式 Web 脚本使用 Playwright。
- 受控探索的远端写入预算固定为 0；不得发送验证码、上传证照或触发注册提交。
- 原型只提供视觉证据；可点击性、原生控件、ARIA 和上传能力必须在用例确认后的可见 Inspector 探索中验证。

## 测试数据策略与残留台账

> 结构版本：test-data-policy-v1

| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 用户确认状态 |
| --- | --- | --- | --- | --- | --- |
| no_write | test | 字段校验、页面视觉基线与只读重复夹具 | 0 | OP-REG-001 至 OP-REG-010、OP-REG-014 至 OP-REG-019 | 已确认 |
| managed_cleanup | test | 单旅程的合成企业注册资源集合 | 1 | OP-REG-011 | 待用户确认 |
| no_write | test | 使用独立预登记关系进行管理员/账号名只读核验 | 0 | OP-REG-012 | 待用户确认 |
| managed_cleanup | test | 双旅程的合成企业注册资源集合 | 2 | OP-REG-013 | 待用户确认 |

### 外部操作预算

| caseId | 短信上限 | 上传上限 | 提交上限 | 后置查询 | 清理要求 |
| --- | --- | --- | --- | --- | --- |
| OP-REG-011 | 1 | 1 | 1 | 每个未知结果必须先查询 | 每类资源均绑定幂等 cleanupActionId 并验证删除/回收结果 |
| OP-REG-012 | 0 | 0 | 0 | 只读查询独立预登记账号、角色与企业关系 | 不创建新资源；独立 fixture 的归属与处理状态必须可审计 |
| OP-REG-013 | 2（每旅程 1） | 2（每旅程 1） | 2（每旅程 1） | 两条旅程独立查询 | 两组资源分别绑定 cleanupActionId 并独立验证 |

### 写入策略明细

- 当前不产生远端数据。稳定键至少包含 `runId/activityId/caseId/journeyId/operationKind/inputDigest`；同一旅程重试复用原键，A/B 旅程必然不同，结果引用和 cleanupActionId 也按旅程及资源类型隔离。
- 短信、上传和提交前分别登记 intent 并重新核对授权摘要、fencing、策略和剩余预算，完成后只记录脱敏结果摘要。任一失败、人工等待超时、取消或未知结果立即冻结全部后续写入，先按唯一合成标识或台账对账并进入 `RECONCILING`；不得自动重发、重传或重提。
- `managed_cleanup` 的每类可能创建资源必须在首次外部操作前绑定 `cleanupActionId`；查询、对账和清理由无条件 finalizer 执行，覆盖断言失败、超时、取消、lease 丢失与部分成功；清理失败进入 `cleanup_failed/RECONCILING/manual_required`，不得在运行后自动降级为 `tracked_residual`。
- `tracked_residual` 只有在执行前单独确认资源数量、TTL 和责任人后才可选择；计划确认或 test 环境选择均不构成该授权。
- 验证码只允许最小人工安全接管；不可变执行清单必须冻结正整数的总用例超时和每次人工等待上限。手机号、验证码、认证信息、证照内容与真实业务数据不得进入历史、用例、日志、截图、Trace 或报告。
- 每次人工挑战 callback 必须绑定 `requestId/runId/caseId/inputDigest/journeyId/handoffId/waitRevision` 与有效期。只有 current fencing owner 能以 CAS 将当前、未过期的 `HUMAN_CHALLENGE_WAIT` 转为 `HUMAN_CHALLENGE_VERIFIED`；迟到、重复、跨旅程、旧 revision、拒绝或错误 callback 均不得解锁写入，并由当前恢复 owner 忽略或收口。

### 外部操作状态域与存储边界

- `OperationResult = confirmed | failed | conflict | unknown | timeout`，只描述短信、上传、提交或清理调用；`QueryResult = confirmed_created | confirmed_absent | conflict | unknown | timeout`，只描述后置查询；`JourneyResult` 仅由操作与查询结果派生。企业 B 的唯一启动谓词是 `A.submit === confirmed && A.relationQuery === confirmed_created`，不得把三个状态域混写。

| 位置 | 允许字段 | 禁止字段 |
| --- | --- | --- |
| `.local/test-task-runtime/` | raw fencing/lease/handoff/tool handles、claim 与宿主续跑绑定 | 业务状态结论、验证码、真实用户数据 |
| `.local/test-ledger/` | 脱敏稳定键、预算、resource ref、reconcile/cleanup ID、脱敏结果与读回证据指针 | raw fencing/lease/handoff/tool handles、验证码、凭据 |
| `workflow-history.ndjson` | 可回放语义事件、状态枚举、subject/output digest 与安全证据引用 | raw fencing/lease/handoff/tool handles、线程或 automation ID、验证码、凭据、真实用户数据 |
| 报告 | 脱敏结果摘要、数据卫生结论与证据指针 | raw fencing/lease/handoff/tool handles、稳定键原值、验证码、凭据 |
| 脚本日志、截图、Trace、视频 | 仅最小脱敏诊断摘要 | raw fencing/lease/handoff/tool handles、reconcile/cleanup ID 原值、验证码、凭据、真实业务数据 |

## 用例集生成状态

> 结构版本：testcase-generation-v1

| 字段 | 内容 |
| --- | --- |
| 用例集状态 | 待评审 |
| 已完成用例包 | `cases-registration.md` |
| 待生成或待补齐用例包 | 无 |
| 当前阻塞项 | 存在受影响分支 blocker，详见 workflow-history |
| 下一门禁 | 派发全部适用 reviewer |
## 覆盖基准与拆分清单

> 结构版本：coverage-inventory-v1

### 基准资料与模块映射

| 基准资料 | 层级或模块/流程 | 可验证场景或规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 差异、不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| AIoT平台项目.docx | 官网与企业注册 | 注册入口、字段校验、唯一性、申请人账号名、手机号多企业，以及内嵌注册截图中的协议区和主按钮标签 | 输入边界、提示、入口、注册后关系与只读视觉文案 | RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-016、RULE-REG-017、RULE-REG-019 | OP-REG-001、OP-REG-002、OP-REG-003、OP-REG-004、OP-REG-005、OP-REG-006、OP-REG-007、OP-REG-008、OP-REG-010、OP-REG-011、OP-REG-012、OP-REG-013、OP-REG-014、OP-REG-015、OP-REG-016、OP-REG-017、OP-REG-019 | 内嵌截图证明精确视觉文案，不证明 DOM 类型、勾选阻断、按钮可点击性、启用态、真实提交结果或审核状态 |
| AIoT平台项目.docx | AIoT控制台 | 注册账号默认管理员 | 账号名、管理员与企业关系只读核验 | RULE-REG-012 | OP-REG-012 | 不要求或驱动资料未定义的审核动作 |
| 注册页面原型 | 注册页面 | 企业标识提示、验证码和证照上传视觉区域 | 视觉存在性 | RULE-REG-006、RULE-REG-009、RULE-REG-018 | OP-REG-006、OP-REG-009、OP-REG-018 | 原型不证明真实控件、ARIA、可点击性、提交标签或业务结果 |

### 拆分清单

| 类别 | 拆分项与适用规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用、待补充或合并依据 |
| --- | --- | --- | --- | --- | --- |
| 输入字段 | 名称、信用代码、地址、标识、证照、申请人、联系方式、简介、邮箱 | 每个字段/失败原因独立 caseId；明确边界逐值复位 | RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-010、RULE-REG-014、RULE-REG-015、RULE-REG-016 | OP-REG-001、OP-REG-002、OP-REG-003、OP-REG-004、OP-REG-005、OP-REG-006、OP-REG-007、OP-REG-008、OP-REG-010、OP-REG-014、OP-REG-015、OP-REG-016 | 验证码视觉 OP-REG-009 不属于输入字段；信用代码算法、证照属性和邮箱最大长度未定义 |
| 关键交互 | 注册入口、验证码区域、上传区域、协议区和主按钮视觉文案 | 仅断言资料或原型可证明的标签与视觉存在性 | RULE-REG-009、RULE-REG-017、RULE-REG-018、RULE-REG-019 | OP-REG-009、OP-REG-017、OP-REG-018、OP-REG-019 | DOM 语义、可点击性、勾选阻断、启用态与真实注册结果留待工程探索 |
| 注册写入 | 单旅程与双旅程的外部操作 | intent、稳定键、预算、后置查询、cleanup/reconcile | RULE-REG-011、RULE-REG-013 | OP-REG-011、OP-REG-013 | 不断言审核状态或资料未定义的生效时点 |
| 角色与权限 | 申请人作为账号名、注册账号默认管理员、同手机号多企业 | 已存在关系的只读后置核验 | RULE-REG-012、RULE-REG-013、RULE-REG-014 | OP-REG-012、OP-REG-013、OP-REG-014 | 需要隔离资源、认证与安全查询能力 |

### 测试设计技术与依据

| 适用场景 | 设计技术与最小记录 | 需求追溯编号 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 输入边界 | 名称 1/2/50/51；信用代码空/非空必填分区；地址 0/1/50/51；标识 2/3/6/7 与小写字母数字混合；申请人中英文各 1/19/20/21；联系方式 0/10/11/12；简介 0/1/300/301；邮箱空/有效/无效 | REQ-REG-001 至 REQ-REG-006 | 每一字段规则和代表值单独复位观察 | RULE-REG-001、RULE-REG-003、RULE-REG-005、RULE-REG-006、RULE-REG-010、RULE-REG-014 至 RULE-REG-016 | OP-REG-001、OP-REG-003、OP-REG-005、OP-REG-006、OP-REG-010、OP-REG-014、OP-REG-015、OP-REG-016 | 仅对资料明示规则生成断言；非空信用代码只用于证明未触发必填错误 |
| 提交决策 | 单失效条件保持其余资料明确条件有效；写入前逐操作预算与 intent | REQ-REG-001、REQ-REG-002、REQ-REG-003、REQ-REG-004、REQ-REG-005、REQ-REG-006、REQ-REG-007 | 必填、唯一性、格式、证照和外部操作门禁 | RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-010、RULE-REG-011、RULE-REG-014、RULE-REG-015、RULE-REG-016 | OP-REG-001、OP-REG-002、OP-REG-003、OP-REG-004、OP-REG-005、OP-REG-006、OP-REG-007、OP-REG-008、OP-REG-010、OP-REG-011、OP-REG-014、OP-REG-015、OP-REG-016 | OP-REG-019 只验证协议区与精确主按钮视觉文案；验证码验证、真实提交动作、协议阻断和启用态未定义 |
| 页面交互 | 零写入视觉检查，工程阶段再验证 DOM/ARIA/点击 | REQ-REG-004、REQ-REG-007、REQ-REG-011 | 注册入口、企业标识提示、验证码、上传区域、协议区和主按钮视觉文案 | RULE-REG-006、RULE-REG-009、RULE-REG-017、RULE-REG-018、RULE-REG-019 | OP-REG-006、OP-REG-009、OP-REG-017、OP-REG-018、OP-REG-019 | 视觉证据不等于真实交互能力，不证明控件类型、勾选阻断、启用态或点击结果 |
| 注册后关系 | 场景法与只读后置查询 | REQ-REG-005、REQ-REG-008、REQ-REG-009 | 账号名、默认管理员、同手机号多企业 | RULE-REG-012 至 RULE-REG-014 | OP-REG-012、OP-REG-013、OP-REG-014 | 不绑定资料未定义的审核状态或时点 |

### 提交前置决策表

| 组合 | 当前单一变化 | 其他资料明确字段 | 可观察结果 | caseId |
| --- | --- | --- | --- | --- |
| D01 | 企业名称无效或重复 | 有效 | 字段级拒绝或资料明确重复提示 | OP-REG-001、OP-REG-002 |
| D02 | 信用代码为空或重复 | 有效 | 字段级拒绝或资料明确重复提示 | OP-REG-003、OP-REG-004 |
| D03 | 企业地址无效 | 有效 | 字段级拒绝或明确空值提示 | OP-REG-005 |
| D04 | 企业标识无效或重复 | 有效 | 字段级拒绝、常驻提示或资料明确重复提示 | OP-REG-006、OP-REG-007 |
| D05 | 营业执照缺失 | 有效 | 必填条件不满足 | OP-REG-008 |
| D06 | 申请人无效 | 有效 | 明确空值提示或长度/内容拒绝 | OP-REG-014 |
| D07 | 联系方式无效 | 有效 | 11 位以外输入不满足资料规则 | OP-REG-015 |
| D08 | 简介或邮箱无效 | 有效 | 对应字段单独拒绝，不混合诊断 | OP-REG-010、OP-REG-016 |
| D09 | 所有资料明确字段有效 | 有效 | 仅可进入受控执行门禁；不据此断言验证码、提交或审核结果 | OP-REG-011 |

## 覆盖矩阵

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用：需求明确注册字段、账号名与企业关系 | 营业执照必填仍待工程冻结零写入观察量；单次注册另受不可变清单控制 | 工程待验证 | OP-REG-008 |
| 输入与数据校验 | 适用：多个必填、长度、格式、内容和唯一性规则 | 等价类、边界和重复提示已设计；正向/负向校验触发与观察量待工程冻结 | 工程待验证 | OP-REG-001、OP-REG-003、OP-REG-005、OP-REG-006、OP-REG-010、OP-REG-014、OP-REG-015、OP-REG-016 |
| 状态与生命周期 | 已引用资料未定义审核生命周期 | 不生成待审核/通过/驳回断言 | 不适用 | 无 |
| 数据完整性与一致性 | 适用：三类唯一性及账号企业关联 | 三类唯一性先验证零写入门禁；双企业关系使用受控执行 | 工程待验证（OP-REG-002/004/007）；受控执行（OP-REG-013） | OP-REG-002、OP-REG-004、OP-REG-007、OP-REG-013 |
| 异常、容错与恢复 | 适用：外部操作可能产生未知结果、人工挑战超时、lease 丢失或清理失败 | 冻结后续写入、恢复 owner 对账、reconciliation 与幂等清理 | 受控执行 | OP-REG-011 |
| 权限、身份与审计 | 适用：申请人作为账号名、注册账号默认管理员 | 账号名、角色与企业关系 | 受控执行 | OP-REG-012 |
| 安全与隐私 | 适用：手机号、验证码、营业执照和认证会话敏感 | 引用化、暂停采集和最小人工挑战 | 受控执行 | 无 |
| 接口、集成与契约 | 适用待补充：短信、上传、注册与后台查询接口未引用 | 外部操作 intent 与后置事实框架 | 适用待补充 | OP-REG-002、OP-REG-004、OP-REG-007、OP-REG-013 |
| 兼容性与可移植性 | 超出本次请求 | 不生成浏览器矩阵 | 不适用 | 无 |
| 交互、视觉与无障碍 | 适用：需求截图与原型提供注册入口、视觉区域、协议区和主按钮文案 | 视觉存在性；DOM/ARIA、控件状态与交互结果留待工程探索 | 已覆盖 | OP-REG-009、OP-REG-017、OP-REG-018、OP-REG-019 |
| 性能、容量与稳定性 | 资料未定义验收标准 | 仅记录质量建议 | 不适用 | 无 |
| 配置、部署与可运维性 | 适用：test 会话、数据台账与清理能力 | 执行前环境与数据门禁 | 受控执行 | 无 |
| 本地化与法规要求 | 资料未定义 | 不生成断言 | 不适用 | 无 |

## 需求追溯矩阵

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-REG-001 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 企业名称必填、2–50 字符、只允许中文英文数字，且平台唯一 | 适用 | 空值、边界、字符集与重复提示 | OP-REG-001、OP-REG-002 | 工程待验证 | 字段触发与唯一性零写入门禁均待 Inspector/网络证据 |
| REQ-REG-002 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 企业信用代码必填且平台唯一 | 适用 | 空值与重复提示 | OP-REG-003、OP-REG-004 | 工程待验证 | 格式、长度和校验算法未定义；唯一性触发待零写入证据 |
| REQ-REG-003 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 企业地址必填，最多 50 字符 | 适用 | 0/1/50/51 边界 | OP-REG-005 | 工程待验证 | 有效地址格式及零写入校验触发未定义 |
| REQ-REG-004 | AIoT平台项目.docx、注册页面原型；注册 | 未标注 | 企业标识必填、唯一，3–6 位小写字母或数字，并有常驻提示 | 适用 | 提示、空值、边界、字符集与重复提示 | OP-REG-006、OP-REG-007 | 工程待验证 | 字段触发与唯一性零写入门禁均待 Inspector/网络证据 |
| REQ-REG-005 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 营业执照必填；申请人必填、为空提示“请输入联系人名称”、最多 20 字符、支持中英文且作为账号名称；联系方式必填且为 11 位手机号 | 适用 | 三项分别独立覆盖 | OP-REG-008、OP-REG-012、OP-REG-014、OP-REG-015、OP-REG-018 | 工程待验证；OP-REG-012 受控执行；OP-REG-018 已覆盖 | 字段触发待工程冻结；证照属性和手机号号段未定义 |
| REQ-REG-006 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 企业简介选填且最多 300 字符；企业邮箱选填且符合邮箱格式 | 适用 | 简介和邮箱拆分原子覆盖 | OP-REG-010、OP-REG-016 | 工程待验证 | 邮箱最大长度及零写入校验触发未定义 |
| REQ-REG-007 | AIoT平台项目.docx、注册页面原型；注册 | 未标注 | 企业注册包含营业执照字段；注册原型呈现验证码和营业执照上传视觉区域；需求文档内嵌截图呈现“我已阅读并已同意《用户协议》”和“同意条款并注册” | 适用 | 四个视觉事实与工程确认动作后的单次受控旅程 | OP-REG-009、OP-REG-011、OP-REG-018、OP-REG-019 | 受控执行 | 真实控件、协议阻断、按钮启用/点击、注册结果、验证码规则和上传约束未定义 |
| REQ-REG-008 | AIoT平台项目.docx；AIoT控制台 → 系统入口 | 未标注 | 注册企业的账号默认管理员 | 适用 | 独立预登记关系的管理员角色查询 | OP-REG-012 | 受控执行 | 生效时点未定义；申请人作为账号名称由 REQ-REG-005 负责 |
| REQ-REG-009 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 一个手机号可以注册多个企业 | 适用 | 同一隔离手机号的两个企业关系 | OP-REG-013 | 受控执行 | 候选预算 2，仍需执行与清理授权 |
| REQ-REG-010 | AIoT平台项目.docx；官网改造 → 注册 | 未标注 | 三类唯一性分别给出企业名称、企业标识、信用代码的明确提示 | 适用 | 三个独立重复场景 | OP-REG-002、OP-REG-004、OP-REG-007 | 工程待验证 | 需要已登记隔离重复夹具及零写入触发证据 |
| REQ-REG-011 | AIoT平台项目.docx；官网结构 → 注册 | 未标注 | 官网顶部提供“注册”入口 | 适用 | 入口可见和资料可证明的导航触发 | OP-REG-017 | 已覆盖 | 跳转 URL 与加载成功标准留待工程探索 |

## 规则覆盖台账

> 结构版本：rule-coverage-v1

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | REQ-REG-001 | AIoT平台项目.docx：企业名称 | 输入边界 | 空、1、2、50、51；中文、英文、数字、中英数混合、特殊符号、表情 | 明确空值提示；2–50 且允许字符或其混合在已冻结校验触发后未出现本规则拒绝，其余拒绝 | 等价类与边界 | 待补充 | 工程待验证 | OP-REG-001 | 冻结无业务写入触发和正向观察量；有效值使用已知未占用合成值，无法证明未占用时单独记录唯一性结果 |
| RULE-REG-002 | REQ-REG-001、REQ-REG-010 | AIoT平台项目.docx：企业名称唯一性 | 集成与数据一致性 | 已登记重复名称；工程证据证明触发不产生业务写入 | 显示资料明确提示 | 决策表与副作用门禁 | 待补充 | 工程待验证 | OP-REG-002 | 先用可见 Inspector/网络证据冻结无提交触发；否则保持不可执行或转独立受控执行 |
| RULE-REG-003 | REQ-REG-002 | AIoT平台项目.docx：企业信用代码 | 输入边界 | 空值与非空代表值 | 已冻结校验触发后，空值不满足必填；非空值不出现必填错误 | 等价类 | 待补充 | 工程待验证 | OP-REG-003 | 冻结无业务写入触发和正向观察量；非空值不用于推断格式、长度、字符集或算法 |
| RULE-REG-004 | REQ-REG-002、REQ-REG-010 | AIoT平台项目.docx：信用代码唯一性 | 集成与数据一致性 | 已登记重复信用代码；工程证据证明触发不产生业务写入 | 显示资料明确提示 | 决策表与副作用门禁 | 待补充 | 工程待验证 | OP-REG-004 | 先用可见 Inspector/网络证据冻结无提交触发；否则保持不可执行或转独立受控执行 |
| RULE-REG-005 | REQ-REG-003 | AIoT平台项目.docx：企业地址 | 输入边界 | 空、1、50、51 | 已冻结校验触发后，空值提示“请输入企业地址”；1/50 无长度拒绝，51 拒绝 | 等价类与边界 | 待补充 | 工程待验证 | OP-REG-005 | 冻结无业务写入触发和正向观察量；不推断地址格式 |
| RULE-REG-006 | REQ-REG-004 | 需求与原型：企业标识 | 输入边界 | 空、2、3、6、7；小写字母、数字、小写字母数字混合、大写/特殊字符 | 常驻提示可见；已冻结校验触发后，仅 3–6 位小写字母或数字组合不出现本规则拒绝 | 等价类与边界 | 待补充 | 工程待验证 | OP-REG-006 | 有效值使用已知未占用合成标识；冻结无业务写入触发和正向观察量 |
| RULE-REG-007 | REQ-REG-004、REQ-REG-010 | AIoT平台项目.docx：企业标识唯一性 | 集成与数据一致性 | 已登记重复标识；工程证据证明触发不产生业务写入 | 显示资料明确提示 | 决策表与副作用门禁 | 待补充 | 工程待验证 | OP-REG-007 | 先用可见 Inspector/网络证据冻结无提交触发；否则保持不可执行或转独立受控执行 |
| RULE-REG-008 | REQ-REG-005 | AIoT平台项目.docx：上传营业执照 | 分支/决策 | 营业执照缺失，其余资料明确条件有效 | 工程阶段冻结零网络副作用的校验触发及字段错误/invalid 观察量 | 单失效决策 | 待补充 | 工程待验证 | OP-REG-008 | 若只有提交可触发，须转入受控执行；原型不证明触发方式或错误呈现 |
| RULE-REG-009 | REQ-REG-007 | 需求内嵌截图与注册页面原型：验证码区域 | 页面交互 | 零写入访问注册页面 | “请输入验证码”输入视觉区与“获取验证码”区域均可见 | 视觉检查 | 适用 | 已覆盖 | OP-REG-009 | 不声称真实 input/button、ARIA、可点击性、发送或验证能力 |
| RULE-REG-010 | REQ-REG-006 | AIoT平台项目.docx：企业简介 | 输入边界 | 0、1、300、301 字符 | 已冻结校验触发后，空值/1/300 无长度拒绝，301 拒绝 | 等价类与边界 | 待补充 | 工程待验证 | OP-REG-010 | 冻结无业务写入触发和正向观察量；与邮箱分离 |
| RULE-REG-011 | REQ-REG-007 | AIoT平台项目.docx：企业注册与执行安全规范 | 异常与恢复 | 工程探索确认真实注册动作；不可变清单精确授权单次短信、人工挑战、上传、提交、通道级对账及清理 | 每类创建/清理操作有稳定 intent/result、预算、当前 fencing 和读回证据；仅绑定当前 request/run/case/inputDigest/journey/handoff/waitRevision 且由 current fencing owner CAS 成功的未过期 verified callback 可继续；其他 callback 与未知结果冻结后续写入并由恢复 owner 对账 | 场景法、幂等恢复与人工 callback | 受控执行 | 受控执行 | OP-REG-011 | 每种 operationKind 冻结 reconcileActionId；未知不可逆短信以 manual_required 收口且永不重发 |
| RULE-REG-012 | REQ-REG-005、REQ-REG-008 | AIoT平台项目.docx：账号名称与默认管理员 | 权限/身份 | 独立预登记且可安全查询的隔离注册账号关系 | 账号名称等于申请人，角色为管理员 | 独立夹具只读核验 | 受控执行 | 受控执行 | OP-REG-012 | 新建预算 0；不得依赖当前 run 的 OP-REG-011 |
| RULE-REG-013 | REQ-REG-009 | AIoT平台项目.docx：一个手机号可注册多个企业 | 集成与数据一致性 | 同一隔离手机号执行 A/B 两条独立旅程，授权资源数量必须精确为 2 | A/B 稳定键、handoffId 与 waitRevision 隔离；callback 必须完整绑定当前旅程并由 current fencing owner CAS；只有 A 提交与关系均为 confirmed_created 才可启动 B；每条旅程独立人工挑战、通道对账和幂等清理 | 场景法 | 受控执行 | 受控执行 | OP-REG-013 | A 为 absent/failed/conflict/timeout/unknown 时禁止 B；迟到、重复、跨旅程或旧 revision callback 不得解锁写入 |
| RULE-REG-014 | REQ-REG-005 | AIoT平台项目.docx：申请人姓名 | 输入边界 | 空；中文与英文分别 1、19、20、21 | 已冻结校验触发后，空值提示“请输入联系人名称”；两类 1/19/20 无长度拒绝，21 拒绝 | 等价类与边界 | 待补充 | 工程待验证 | OP-REG-014 | 冻结无业务写入触发和正向观察量；数字、符号与其他字符的允许范围未定义 |
| RULE-REG-015 | REQ-REG-005 | AIoT平台项目.docx：联系方式 | 输入边界 | 空、10/11/12 位纯数字、11 位含字母或符号 | 已冻结校验触发后，仅 11 位纯数字不出现本规则拒绝 | 等价类与边界 | 待补充 | 工程待验证 | OP-REG-015 | 冻结无短信/业务写入触发和正向观察量；不推断号段、实名或短信结果 |
| RULE-REG-016 | REQ-REG-006 | AIoT平台项目.docx：企业邮箱 | 输入边界 | 空、保留测试域有效格式、缺少 @/本地部分/域名 | 已冻结校验触发后，空值和有效格式无本规则拒绝，三类无效格式分别拒绝 | 等价类 | 待补充 | 工程待验证 | OP-REG-016 | 冻结无业务写入触发和正向观察量；不推断最大长度 |
| RULE-REG-017 | REQ-REG-011 | AIoT平台项目.docx：官网结构 | 页面交互 | 访问官网顶部导航 | “注册”入口可见；导航结果只记录实际观察 | 交互断言 | 适用 | 已覆盖 | OP-REG-017 | 跳转 URL/成功标准留待工程探索 |
| RULE-REG-018 | REQ-REG-005、REQ-REG-007 | 注册页面原型：上传营业执照 | 页面交互 | 零写入访问注册页面 | 上传营业执照标签和区域视觉可见 | 视觉检查 | 适用 | 已覆盖 | OP-REG-018 | 不声称 file input、ARIA 或上传成功 |
| RULE-REG-019 | REQ-REG-007 | AIoT平台项目.docx 内嵌注册截图 | 页面交互 | 零写入访问注册页面 | “我已阅读并已同意《用户协议》”及“同意条款并注册”精确视觉文案可见 | 视觉检查 | 适用 | 已覆盖 | OP-REG-019 | 只证明视觉文案；不声称 checkbox/button DOM、勾选阻断、可点击性、启用态、真实提交或结果 |

## 规则设计矩阵

> 结构版本：rule-design-matrix-v1

| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | 企业名称 | 必填 | 0/1/2/50/51；中文、英文、数字、中英数混合及非法字符类 | 已冻结触发后的字段提示或目标规则状态 | 已知未占用合成值或受限 oracle | Inspector/网络证明无业务写入 | OP-REG-001 | 工程待验证 |
| RULE-REG-002 | 企业名称唯一性 | 必填 | 重复名称 | 明确重复提示 | 隔离重复夹具 | Inspector/网络证明无业务写入 | OP-REG-002 | 工程待验证 |
| RULE-REG-003 | 信用代码 | 必填 | 空/非空 required 分区 | 已冻结触发后的必填拒绝/必填错误不存在 | 无远端数据 | Inspector/网络证明无业务写入 | OP-REG-003 | 工程待验证 |
| RULE-REG-004 | 信用代码唯一性 | 必填 | 重复代码 | 明确重复提示 | 隔离重复夹具 | Inspector/网络证明无业务写入 | OP-REG-004 | 工程待验证 |
| RULE-REG-005 | 企业地址 | 必填 | 0/1/50/51 | 已冻结触发后的提示或长度状态 | 无远端数据 | Inspector/网络证明无业务写入 | OP-REG-005 | 工程待验证 |
| RULE-REG-006 | 企业标识 | 必填 | 0/2/3/6/7；小写、数字、混合及非法字符类 | 常驻提示及已冻结触发后的目标规则状态 | 已知未占用合成值或受限 oracle | Inspector/网络证明无业务写入 | OP-REG-006 | 工程待验证 |
| RULE-REG-007 | 企业标识唯一性 | 必填 | 重复标识 | 明确重复提示 | 隔离重复夹具 | Inspector/网络证明无业务写入 | OP-REG-007 | 工程待验证 |
| RULE-REG-008 | 营业执照 | 必填 | 缺失 | 待工程冻结字段错误/invalid 观察量 | 其余字段有效 | Inspector 证明零上传、零短信、零提交后方可执行 | OP-REG-008 | 工程待验证 |
| RULE-REG-009 | 验证码视觉区域 | 不适用 | 零写入页面访问 | 输入视觉区与获取验证码区域可见 | 无远端数据 | 禁止输入或点击 | OP-REG-009 | 已覆盖 |
| RULE-REG-010 | 企业简介 | 选填 | 0/1/300/301 | 已冻结触发后的长度状态 | 无远端数据 | Inspector/网络证明无业务写入 | OP-REG-010 | 工程待验证 |
| RULE-REG-011 | 单次外部操作旅程 | 不适用 | 短信/人工挑战/上传/提交/通道对账/清理 | 每个 intent/result、人工恢复、恢复 owner 与读回证据可审计 | reconcileActionId、cleanupActionId、台账和隔离 fixture | 不可变执行清单 | OP-REG-011 | 受控执行 |
| RULE-REG-012 | 账号名与管理员角色 | 不适用 | 独立预登记隔离关系 | 账号名等于申请人且角色为管理员 | 不依赖当前 run 的只读夹具 | 认证与只读查询授权 | OP-REG-012 | 受控执行 |
| RULE-REG-013 | 同手机号多企业 | 不适用 | 两条独立旅程；`A.submit=confirmed` 且 `A.relationQuery=confirmed_created` 才启动 B | OperationResult、QueryResult 与 JourneyResult 分域，两个企业关系分别可核验且部分成功可恢复 | 候选预算 2、reconcileActionId、cleanupActionId | 写入、人工挑战、查询与清理授权 | OP-REG-013 | 受控执行 |
| RULE-REG-014 | 申请人 | 必填 | 空；中文/英文各 1/19/20/21 | 已冻结触发后的明确提示和长度状态 | 无远端数据 | Inspector/网络证明无业务写入 | OP-REG-014 | 工程待验证 |
| RULE-REG-015 | 联系方式 | 必填 | 0/10/11/12 纯数字、11 位非数字 | 已冻结触发后的手机号格式状态 | 脱敏占位 | Inspector 证明零短信、零业务写入 | OP-REG-015 | 工程待验证 |
| RULE-REG-016 | 企业邮箱 | 选填 | 空/有效/缺少 @/本地部分/域名 | 已冻结触发后的邮箱格式状态 | 保留测试域 | Inspector/网络证明无业务写入 | OP-REG-016 | 工程待验证 |
| RULE-REG-017 | 注册入口 | 不适用 | 官网导航访问 | 入口可见；导航实际结果可记录 | 无远端数据 | 零写入 | OP-REG-017 | 已覆盖 |
| RULE-REG-018 | 证照上传视觉区域 | 不适用 | 注册页访问 | 标签/区域可见 | 无远端数据 | 禁止选择文件 | OP-REG-018 | 已覆盖 |
| RULE-REG-019 | 协议区与主按钮视觉文案 | 不适用 | 注册页零写入访问 | 精确协议文案和“同意条款并注册”可见 | 无远端数据 | 禁止勾选或点击 | OP-REG-019 | 已覆盖 |

## 规则邻域复核

| 触发发现项 | 邻域 RULE | 共同依据 | 修订 caseId | 关系同步与规则设计预检结果 |
| --- | --- | --- | --- | --- |
| MRR-REQ/DES/UX/TRA/CHG 初审及最终复审发现 | RULE-REG-001 至 RULE-REG-019 | 注册字段、页面视觉、人工挑战、外部操作和注册后关系 | OP-REG-001 至 OP-REG-019 | 已纠正内嵌截图漏读并补强输入、通道对账、恢复 owner 与清理副作用；待新摘要最终复审 |

## 用例包目录

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 生成状态 | 特殊门禁 |
| --- | --- | --- | --- | --- | --- |
| `cases-registration.md` | 企业注册 | 字段、唯一性、页面视觉、单次提交安全、账号关系和同手机号多企业 | OP-REG-001、OP-REG-002、OP-REG-003、OP-REG-004、OP-REG-005、OP-REG-006、OP-REG-007、OP-REG-008、OP-REG-009、OP-REG-010、OP-REG-011、OP-REG-012、OP-REG-013、OP-REG-014、OP-REG-015、OP-REG-016、OP-REG-017、OP-REG-018、OP-REG-019 | 完整度校验通过 | 由实际 19/19 正文、必填区块、唯一 caseId、关系和 digest 校验派生；外部操作仍须独立执行授权 |

## 变更影响分析

| 变更编号 | 来源与版本 | 受影响需求追溯编号 | 影响判定与依据 | 受影响 caseId | 脚本/工程设计影响 | 数据/环境影响 | 是否复测与结论 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CHG-REG-001 | REV-20260728-REG-01 初审 / round 1 | REQ-REG-001 至 REQ-REG-011 | 申请人、入口和视觉覆盖补齐；复合字段与交互拆分；删除无来源审核状态；补逐操作预算、幂等和清理恢复 | OP-REG-001 至 OP-REG-019 | 最终脚本必须按原子 caseId 生成；运行时 DOM/ARIA 探索后才冻结定位 | 创建预算 1/2、逐操作预算、台账与 managed_cleanup 互斥规则均变化 | REV-20260728-REG-02 已完成并要求继续演进 | 已复审 |
| CHG-REG-002 | REV-20260728-REG-02 最终复审 / round 2 | REQ-REG-005、REQ-REG-007、REQ-REG-008、REQ-REG-009 | 当轮删除精确主按钮标签与 OP-REG-019，另修复后置查询/清理冲突、等价类、来源投影和工程可执行门禁；删除视觉用例的证据判断后被 REV03 纠正 | OP-REG-008、OP-REG-011、OP-REG-012、OP-REG-013、OP-REG-014、OP-REG-015、OP-REG-016、当轮删除 OP-REG-019 | 工程阶段先证明零业务写入校验触发；写入脚本固定 caseId/journeyId、精确预算和冻结后续写入 | OP-REG-012 改用独立预登记 fixture；所有写入由无条件 finalizer 收口并冻结有界超时 | REV-20260728-REG-03 已证明内嵌截图正视觉证据并纠正删除结论 | 已复审，部分结论已纠正 |
| CHG-REG-003A | REV-20260728-REG-03 / 视觉恢复 | REQ-REG-007 | 恢复需求内嵌截图可证明的协议/主按钮视觉用例，并补验证码输入区 | OP-REG-009、OP-REG-019 | 只生成零写入视觉断言，不推断控件或提交行为 | no_write 数量 0 | REV-20260728-REG-04 已复审并识别计划策略投影遗漏 | 已复审 |
| CHG-REG-003B | REV-20260728-REG-03 / 字段与唯一性门禁 | REQ-REG-001、REQ-REG-002、REQ-REG-003、REQ-REG-004、REQ-REG-005、REQ-REG-006、REQ-REG-010 | 补完整输入代表值、唯一性干扰隔离、校验触发和零写入证明门禁 | OP-REG-001 至 OP-REG-008、OP-REG-010、OP-REG-014 至 OP-REG-016 | 字段脚本先冻结真实校验动作、观察量和零网络副作用 | 唯一性触发无法证明零写入时保持不可执行或转独立授权 | REV-20260728-REG-04 已复审并补中英数混合分区与最近门禁状态投影 | 已复审 |
| CHG-REG-003C | REV-20260728-REG-03 / 人工挑战与外部副作用 | REQ-REG-007、REQ-REG-009 | 补人工挑战、通道对账、恢复 owner、cleanup intent/result、A/B 启动谓词和 fencing | OP-REG-011、OP-REG-013 | 写入脚本显式 callback 绑定、CAS、OperationResult/QueryResult、reconcileActionId 和 current fencing | 短信未知按不可逆副作用收口；上传缺查询/清理阻塞；cleanup 具有独立 deadline、预算和读回 | REV-20260728-REG-04 已复审并补 callback 防重放、状态分域和字段路由 | 已复审 |
| CHG-REG-003D | REV-20260728-REG-03 / 关系与评审投影 | REQ-REG-001 至 REQ-REG-010 | 同步 REQ/RULE/caseId 状态、恢复域、需求归属与 REV02/REV03 finding 回链 | OP-REG-001 至 OP-REG-019 | 关系同步器和静态检查按完整受影响集合复核 | 不新增远端写入 | REV-20260728-REG-04 识别并修复状态与 backlink 差集，等待显式恢复复审 | 待恢复复审 |

## 合理推断

- “开放平台”匹配本仓库登记的 `open-platform` Web 项目；本计划只覆盖企业注册。
- `test` 是候选环境而非短信、上传、提交、认证、查询、清理或残留授权。
- 合成营业执照只是静态资产候选；文件选择与上传均属于需确认的外部操作。

## 待补充信息

- 验证码发送频率、有效期、错误提示和验证成功观察量未定义。
- 营业执照文件格式、大小、上传成功/失败反馈与真实控件类型未定义。
- 需求内嵌截图已证明协议区与“同意条款并注册”精确视觉文案；真实控件类型、勾选阻断、启用态、点击结果、成功反馈和关系生效时限仍未定义。
- 审核状态机、默认管理员与多企业关系的具体生效时点未定义；本计划不据此生成断言。
- 企业信用代码格式/长度/算法、企业邮箱最大长度、官网注册入口跳转 URL 和加载成功标准待工程探索。
- 后置查询入口、认证会话、短信/上传通道和幂等清理能力尚未验证。
- 字段与唯一性校验的真实触发方式、是否发生只读网络请求及校验已运行后的正向观察量尚待工程冻结。

## 风险与审核事项

- 任何创建型用例在不可变执行清单、逐操作预算、稳定键、后置查询与清理能力全部确认前保持执行阻塞。
- lease 过期不证明外部操作未发生；未知短信、上传、提交或清理结果必须按 operationKind 对账，旧 fencing token 不得调用外部动作或提交新结果，只有新 lease 恢复 owner 可接管。
- 每个外部 operationKind 必须冻结 `reconcileActionId`、查询键、结果判据和截止时间；短信无查询能力时按一次性不可逆副作用收口，上传无查询/清理能力时阻塞。
- cleanup 与创建操作同样使用稳定 intent/result、预算、current fencing、独立 deadline 和读回验证。
- managed_cleanup 失败必须进入 reconciliation，不能未经执行前授权改记受控残留。
- 短信验证码、营业执照和认证会话含敏感数据；只允许最小人工接管且暂停截图、视频、Trace 与敏感网络日志。

## 多角色评审记录

> 结构版本：multi-role-review-v1

> 结构版本：evidence-driven-evolution-v1

> 结构版本：reviewer-execution-v2

> 结构版本：auto-evolution-loop-v1

> 结构版本：knowledge-decision-v1

> `REV-20260728-REG-01` 绑定下表固定输入基线。当前迁移 run 的固定图只展开 requirements、design、traceability 三条 reviewer Activity；`initial-review-design` 汇合独立 design 与 interaction 结论，`initial-review-traceability` 汇合 traceability 与 impact 结论。正式表只记录稳定 Activity/角色与结论，具体 Agent 任务绑定仅保存在可丢弃 runtime；新 run 由 `vnext-2` 展开独立 Activity，并发上限仍为 3。

<!-- review-batch:REV-20260728-REG-01:start -->

### 评审批次：REV-20260728-REG-01

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 初审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | `plan.md` SHA-256 `a9420ad30e4853d076da778f12ef5d42cf62f0438ab5f96dc221eabd23dd3ff5`；`cases-registration.md` SHA-256 `332ae46dbf66e00863d6138d3aac9fa56dba914c87edef15fe6563c29c670bd4`；组合输入摘要 `df2643a36132c1cd9aea42fb702eb8a85488f04f49a75d04a6d3be2957b6c60e`；完整度实测 13/13 |
| 自动演进轮次 | 0 |
| 隔离规则 | 每条 Activity 仅接收受控资料、上述 digest 对应的 plan.md、cases-registration.md 与本角色检查清单；`fork_turns=none`；只读；不得读取作者推理、自评或其他 reviewer 结论 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 阶段交接核验 | 通过；13/13 正文、必填区块、唯一 caseId、双向关系与 digest 已完成候选门禁 |

#### reviewer 执行记录

| 角色 | 执行方式 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | fork_turns=none | 固定 plan/cases digest、受控需求资料与 requirements 检查清单 | 已完成 | 需演进 | MRR-REQ-001、MRR-REQ-002、MRR-REQ-003、MRR-REQ-004、MRR-REQ-005 | 已关闭 |
| 测试设计评审 | 真实子智能体 | fork_turns=none | 固定 plan/cases digest 与 design 检查清单；覆盖决策表、边界、主成功/失败/回退路径 | 已完成 | 需演进 | MRR-DES-001、MRR-DES-002、MRR-DES-003、MRR-DES-004、MRR-DES-005、MRR-DES-006 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体 | fork_turns=none | 固定 plan/cases digest、原型与 interaction 检查清单；专项覆盖页面交互与状态流转 | 已完成 | 需演进 | MRR-UX-001、MRR-UX-002、MRR-UX-003、MRR-UX-004 | 已关闭 |
| 追溯审计 | 真实子智能体 | fork_turns=none | 固定 plan/cases digest、关系同步结果、13/13 完整度结果与 traceability 检查清单 | 已完成 | 需演进 | MRR-TRA-001、MRR-TRA-002、MRR-TRA-003、MRR-TRA-004、MRR-TRA-005 | 已关闭 |
| 变更影响评审 | 真实子智能体 | fork_turns=none | 固定 plan/cases digest、写入边界、执行授权、幂等、清理与恢复检查清单 | 已完成 | 需演进 | MRR-CHG-001、MRR-CHG-002、MRR-CHG-003、MRR-CHG-004、MRR-CHG-005、MRR-CHG-006、MRR-CHG-007 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-REQ-001 | 需求一致性 | AIoT平台项目.docx 注册章节明确申请人为空提示、最多 20 字符并支持中英文；旧用例误记为未定义 | 需求覆盖缺口 | REQ-REG-005、RULE-REG-014、OP-REG-014 | 高 | 自动演进 | 资料证据已回链申请人规则；OP-REG-014 覆盖 0/19/20/21 与中英文，OP-REG-012 验证账号名关系 | 已关闭 |
| MRR-REQ-002 | 需求一致性 | 官网结构明确顶部导航存在“注册”，旧用例缺入口覆盖 | 需求覆盖缺口 | REQ-REG-011、RULE-REG-017、OP-REG-017 | 中 | 自动演进 | 资料证据已新增注册入口 REQ/RULE；OP-REG-017 零写入验证入口与实际导航观察 | 已关闭 |
| MRR-REQ-003 | 需求一致性 | 已引用资料未定义待审核、通过或驳回状态 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-008、OP-REG-011、OP-REG-012 | 高 | 自动演进 | 资料证据仅支持注册事实与关系；OP-REG-011、OP-REG-012 已删除审核状态断言 | 已关闭 |
| MRR-REQ-004 | 需求一致性 | 注册原型只证明视觉区域存在，不证明 DOM 语义 | 资料明确的设计缺口 | RULE-REG-009、OP-REG-009 | 中 | 自动演进 | 资料证据已将 OP-REG-009 限定为视觉可见，DOM/ARIA 留待工程探索 | 已关闭 |
| MRR-REQ-005 | 需求一致性 | 计划数量预算为 2，旧 OP-REG-013 正文仍称预算为 1 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-013、OP-REG-013 | 中 | 自动演进 | 资料证据与授权边界已统一；OP-REG-013 使用候选预算 2 且仍待执行清单确认 | 已关闭 |
| MRR-DES-001 | 测试设计 | 旧 OP-REG-008 合并证照、申请人和联系方式三种失败原因 | 资料明确的设计缺口 | RULE-REG-008、RULE-REG-014、RULE-REG-015 | 高 | 自动演进 | 资料证据已拆为 OP-REG-008、OP-REG-014、OP-REG-015，分别保持单一失败原因 | 已关闭 |
| MRR-DES-002 | 测试设计 | 旧 OP-REG-010 合并简介长度和邮箱格式 | 资料明确的设计缺口 | RULE-REG-010、RULE-REG-016 | 高 | 自动演进 | 资料证据已拆为 OP-REG-010 与 OP-REG-016，并分别覆盖来源明确的有效/无效类 | 已关闭 |
| MRR-DES-003 | 测试设计 | 旧计划建立资料未定义的审核状态迁移 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-012、OP-REG-011、OP-REG-012 | 高 | 自动演进 | 资料证据不支持审核状态；OP-REG-011、OP-REG-012 已删除该状态机及前置条件 | 已关闭 |
| MRR-DES-004 | 测试设计 | 旧计划声明决策表但没有单失效组合 | 资料明确的设计缺口 | RULE-REG-001 至 RULE-REG-016 | 高 | 自动演进 | 资料证据已形成 D01-D09 单一变化决策表并回链 OP-REG-001 至 OP-REG-016 | 已关闭 |
| MRR-DES-005 | 测试设计 | 多字段边界值曾合并观察且下边界不完整 | 资料明确的设计缺口 | RULE-REG-001、RULE-REG-005、RULE-REG-006、RULE-REG-010 | 中 | 自动演进 | 资料证据已补齐边界并要求逐值复位；OP-REG-001、OP-REG-005、OP-REG-006、OP-REG-010 独立观察 | 已关闭 |
| MRR-DES-006 | 测试设计 | 计划预算 2 与旧用例预算 1 冲突 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-013、OP-REG-013 | 中 | 自动演进 | 资料证据与授权投影已统一为候选预算 2；OP-REG-013 仍受执行与清理授权约束 | 已关闭 |
| MRR-UX-001 | 交互与状态 | 官网顶部“注册”入口未形成 RULE/caseId | 需求覆盖缺口 | REQ-REG-011、RULE-REG-017、OP-REG-017 | 中 | 自动演进 | 资料证据已新增入口覆盖；OP-REG-017 不推断资料未定义的目标 URL | 已关闭 |
| MRR-UX-002 | 交互与状态 | 原型中的验证码和上传区域不证明原生控件或 ARIA | 资料明确的设计缺口 | RULE-REG-009、RULE-REG-018、OP-REG-009、OP-REG-018 | 高 | 自动演进 | 资料证据仅支持视觉区域；OP-REG-009、OP-REG-018 已删除语义控件断言 | 已关闭 |
| MRR-UX-003 | 交互与状态 | 资料未定义验证码验证、可提交或审核状态 | 资料明确的设计缺口 | RULE-REG-011、OP-REG-011 | 高 | 自动演进 | 资料证据不足以断言状态机；OP-REG-011 仅保留受控外部操作和可观察事实 | 已关闭 |
| MRR-UX-004 | 交互与状态 | 申请人明确提示、长度和中英文规则未进入交互校验 | 需求覆盖缺口 | REQ-REG-005、RULE-REG-014、OP-REG-014 | 中 | 自动演进 | 资料证据已补齐提示与边界；OP-REG-014 独立验证申请人输入 | 已关闭 |
| MRR-TRA-001 | 追溯审计 | 申请人和联系方式规则未由原子 RULE/caseId 闭环 | 需求覆盖缺口 | REQ-REG-005、RULE-REG-014、RULE-REG-015 | 高 | 自动演进 | 资料证据已同步全部矩阵；OP-REG-014 与 OP-REG-015 分别闭环 | 已关闭 |
| MRR-TRA-002 | 追溯审计 | 受控资料未定义审核状态，旧计划却形成断言 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-012、OP-REG-011、OP-REG-012 | 高 | 自动演进 | 资料证据边界已恢复；OP-REG-011、OP-REG-012 不再断言审核状态 | 已关闭 |
| MRR-TRA-003 | 追溯审计 | 原型可证明验证码、上传和组合提交视觉区域，旧覆盖不完整 | 需求覆盖缺口 | REQ-REG-007、RULE-REG-009、RULE-REG-018、RULE-REG-019 | 中 | 自动演进 | 资料证据已回链 OP-REG-009、OP-REG-018、OP-REG-019；未推断独立协议控件 | 已关闭 |
| MRR-TRA-004 | 追溯审计 | REQ-REG-008 使用的 console-account-and-enterprise 章节未登记输入表 | 需求覆盖缺口 | REQ-REG-008、RULE-REG-012、OP-REG-012 | 中 | 自动演进 | 资料证据章节已登记并回链；OP-REG-012 只读验证账号名和管理员关系 | 已关闭 |
| MRR-TRA-005 | 追溯审计 | OP-REG-013 的计划预算与正文不一致 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-013、OP-REG-013 | 中 | 自动演进 | 资料证据与执行边界已统一为候选预算 2，OP-REG-013 保持未授权 | 已关闭 |
| MRR-CHG-001 | 变更影响 | 创建用例未分别约束短信、上传与提交次数 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 资料证据与安全边界已形成逐操作预算；OP-REG-011 每类 1 次、OP-REG-013 每类 2 次 | 已关闭 |
| MRR-CHG-002 | 变更影响 | 短信、上传、提交缺稳定键、intent 与未知结果对账 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 资料证据与恢复规范已要求逐 operationKind 稳定键、intent、脱敏结果和先查询；OP-REG-011/013 已回链 | 已关闭 |
| MRR-CHG-003 | 变更影响 | managed_cleanup 曾允许运行后降级为残留 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 资料证据与数据规范已明确互斥；OP-REG-011/013 清理失败进入 RECONCILING | 已关闭 |
| MRR-CHG-004 | 变更影响 | 资料未定义审核状态与关系生效时点 | 资料明确的设计缺口 | REQ-REG-007 至 REQ-REG-009、OP-REG-011 至 OP-REG-013 | 高 | 自动演进 | 资料证据仅支持可观察关系；OP-REG-011 至 OP-REG-013 已删除审核和生效时点断言 | 已关闭 |
| MRR-CHG-005 | 变更影响 | OP-REG-013 候选预算 2 与旧正文预算 1 矛盾 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-013、OP-REG-013 | 中 | 自动演进 | 资料证据与授权边界已统一；OP-REG-013 候选预算为 2 且待不可变清单确认 | 已关闭 |
| MRR-CHG-006 | 变更影响 | 申请人最多 20 字符和中英文事实未进入用例 | 需求覆盖缺口 | REQ-REG-005、RULE-REG-014、OP-REG-014 | 中 | 自动演进 | 资料证据已补 0/19/20/21、中英文与无效类；OP-REG-014 独立覆盖 | 已关闭 |
| MRR-CHG-007 | 变更影响 | 原型只证明“同意条款并注册”组合区域 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 中 | 自动演进 | 资料证据已按组合区域登记 OP-REG-019，删除独立勾选及阻断语义推断 | 已关闭 |

#### 阶段交接核验

| 交接点 | History 派生状态 | plan.md 正式记录 | 真实产物 | 结论 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 用例草案 → 初审 | `completeness-validation` 已由事件历史证明成功 | REV-20260728-REG-01 与固定输入基线已建立 | 13/13 用例包、双向关系与 digest 已校验 | 通过 | 已派发适用 reviewer；并发上限 3 |
| 初审 → 自动演进 | 五个适用 reviewer 已全部返回 | 五角色均为需演进，27 项资料可证明发现已正式登记 | 初审输入保持冻结 | 通过 | 自动演进并运行最终复审；不请求逐项许可 |
| 自动演进 → 最终复审 | `automatic-evolution` 运行中 | 27 项发现均有资料证据、修订 caseId 与关闭记录 | 19/19 正文、19 条 RULE、关系投影和预算边界已在暂存区校验 | 通过 | 原子发布后冻结输入并运行最终复审 |
| 最终复审 → 用例确认 | 尚未进入 | 最终批次将在冻结输入后启动 | 待 final reviewer 独立结论 | 不通过 | 不请求用户确认 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-REQ-001 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014；REQ-REG-005、REQ-REG-008 → RULE-REG-012 → OP-REG-012 | 资料已确认 | 已回链计划与用例 |
| MRR-REQ-002 | 需求事实 | REQ-REG-011 → RULE-REG-017 → OP-REG-017 | 资料已确认 | 已回链计划与用例 |
| MRR-REQ-003 | 需求事实 | REQ-REG-007、REQ-REG-008 → RULE-REG-011、RULE-REG-012 → OP-REG-011、OP-REG-012 | 资料已确认 | 已回链计划与用例 |
| MRR-REQ-004 | 需求事实 | REQ-REG-007 → RULE-REG-009 → OP-REG-009 | 资料已确认 | 已回链计划与用例 |
| MRR-REQ-005 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用逐操作预算与执行授权规范 |
| MRR-DES-001 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用原子用例单一失败原因规范 |
| MRR-DES-002 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用原子用例拆分规范 |
| MRR-DES-003 | 需求事实 | REQ-REG-007、REQ-REG-008 → RULE-REG-011、RULE-REG-012 → OP-REG-011、OP-REG-012 | 资料已确认 | 已回链计划与用例并删除无来源状态；OP-REG-013 仅由 REQ-REG-009 → RULE-REG-013 派生 |
| MRR-DES-004 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用决策表和单失效组合规范 |
| MRR-DES-005 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用逐边界独立观察规范 |
| MRR-DES-006 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用预算一致性与执行授权规范 |
| MRR-UX-001 | 需求事实 | REQ-REG-011 → RULE-REG-017 → OP-REG-017 | 资料已确认 | 已回链计划与用例 |
| MRR-UX-002 | 需求事实 | REQ-REG-007 → RULE-REG-009、RULE-REG-018 → OP-REG-009、OP-REG-018 | 资料已确认 | 已回链计划与用例并限定为视觉事实 |
| MRR-UX-003 | 需求事实 | REQ-REG-007 → RULE-REG-011 → OP-REG-011 | 资料已确认 | 已回链计划与用例 |
| MRR-UX-004 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014 | 资料已确认 | 已回链计划与用例 |
| MRR-TRA-001 | 需求事实 | REQ-REG-005 → RULE-REG-014、RULE-REG-015 → OP-REG-014、OP-REG-015 | 资料已确认 | 已回链全部申请人与联系方式关系 |
| MRR-TRA-002 | 需求事实 | REQ-REG-007、REQ-REG-008 → RULE-REG-011、RULE-REG-012 → OP-REG-011、OP-REG-012 | 资料已确认 | 已回链并删除无来源审核状态 |
| MRR-TRA-003 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用来源证据边界与显式 ID 集合规范 |
| MRR-TRA-004 | 需求事实 | REQ-REG-008 → RULE-REG-012 → OP-REG-012 | 资料已确认 | 已回链计划与用例 |
| MRR-TRA-005 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用预算一致性与执行授权规范 |
| MRR-CHG-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用逐操作预算规范 |
| MRR-CHG-002 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用稳定幂等键、intent 与对账规范 |
| MRR-CHG-003 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用 managed_cleanup 与 reconciliation 规范 |
| MRR-CHG-004 | 需求事实 | REQ-REG-007、REQ-REG-008、REQ-REG-009 → RULE-REG-011、RULE-REG-012、RULE-REG-013 → OP-REG-011、OP-REG-012、OP-REG-013 | 资料已确认 | 已回链全部关系并删除未定义生效时点 |
| MRR-CHG-005 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用预算一致性与不可变执行清单规范 |
| MRR-CHG-006 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014 | 资料已确认 | 已回链计划与用例 |
| MRR-CHG-007 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用受控来源与视觉证据边界规范 |

<!-- review-batch:REV-20260728-REG-01:end -->

<!-- review-batch:REV-20260728-REG-02:start -->

### 评审批次：REV-20260728-REG-02

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动演进后最终复审 |
| 输入基线版本 | `plan.md` SHA-256 `ffc2eb4b3fe23e45eed5e2cd0d625250aae14523f8aa97815168e527852c16ea`；`cases-registration.md` SHA-256 `711492a0e784edf754cd1e94ba8a3aca37521ebc438f3d1282ff5bca1972d880`；冻结快照 combined digest `b676eec1fb4477da1a367c2386b88399fafe24f4674e0c9a356506f85471e1bb`；完整度实测 19/19 |
| 自动演进轮次 | 1 |
| 隔离规则 | 每个 reviewer 仅接收冻结快照、受控资料与本角色检查清单；`fork_turns=none`；只读；不得读取其他 reviewer 结论 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 阶段交接核验 | 五个隔离 reviewer 均已返回；15 项资料可证明缺口已形成第二轮确定修订 |

#### reviewer 执行记录

| 角色 | 执行方式 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | fork_turns=none | 最终冻结 plan/cases digest 与受控需求资料 | 已完成 | 需演进 | MRR-FREQ-001、MRR-FREQ-002 | 已关闭 |
| 测试设计评审 | 真实子智能体 | fork_turns=none | 最终冻结 plan/cases digest 与设计检查清单 | 已完成 | 需演进 | MRR-FDES-001、MRR-FDES-002、MRR-FDES-003 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体 | fork_turns=none | 最终冻结 plan/cases digest、原型与交互检查清单 | 已完成 | 需演进 | MRR-FUX-001、MRR-FUX-002 | 已关闭 |
| 追溯审计 | 真实子智能体 | fork_turns=none | 最终冻结 plan/cases digest、关系与完整度结果 | 已完成 | 需演进 | MRR-FTRA-001、MRR-FTRA-002、MRR-FTRA-003、MRR-FTRA-004 | 已关闭 |
| 变更影响评审 | 真实子智能体 | fork_turns=none | 最终冻结 plan/cases digest、操作预算、幂等、清理与恢复边界 | 已完成 | 需演进 | MRR-FCHG-001、MRR-FCHG-002、MRR-FCHG-003、MRR-FCHG-004 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-FREQ-001 | 需求一致性 | 当轮认定固定注册 HTML 与需求文档均不包含精确“同意条款并注册”文案；REV03 复核证明该结论为历史误判 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 高 | 自动演进 | REV03 视觉复核定位到需求文档内嵌注册截图的正证据；RULE-REG-019 与 OP-REG-019 已按纯视觉边界恢复并回链 | 已关闭 |
| MRR-FREQ-002 | 需求一致性 | “支持中英文”不等于数字或符号必须被拒绝 | 资料明确的设计缺口 | REQ-REG-005、RULE-REG-014、OP-REG-014 | 中 | 自动演进 | 资料证据仅支持中英文有效类；OP-REG-014 已删除无来源的数字/符号拒绝断言 | 已关闭 |
| MRR-FDES-001 | 测试设计 | OP-REG-011 先清理资源而 OP-REG-012 又依赖同一关系查询，前后置冲突 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-008、OP-REG-011、OP-REG-012 | 高 | 自动演进 | 资料证据与原子隔离要求已落实：OP-REG-011 清理前完成只读后置查询，OP-REG-012 改用独立预登记只读 fixture | 已关闭 |
| MRR-FDES-002 | 测试设计 | 写入用例未把失败、超时、取消、lease 丢失与部分成功统一纳入清理 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 资料证据与环境规范已回链；OP-REG-011/OP-REG-013 由无条件 finalizer 覆盖全部退出路径 | 已关闭 |
| MRR-FDES-003 | 测试设计 | 联系方式和邮箱等价类描述不足以区分合法/非法输入 | 资料明确的设计缺口 | REQ-REG-005、REQ-REG-006、OP-REG-015、OP-REG-016 | 中 | 自动演进 | 资料证据已在 OP-REG-015 明确 11 位纯数字与含字母/符号类，在 OP-REG-016 明确有效及缺少各组成部分的无效类 | 已关闭 |
| MRR-FUX-001 | 交互与状态 | 当轮只读取原型并据此否定精确组合标签；REV03 复核证明遗漏了需求文档内嵌注册截图 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 中 | 自动演进 | REV03 已恢复精确视觉文案并回链，同时仍禁止推断控件语义、阻断、点击与提交结果 | 已关闭 |
| MRR-FUX-002 | 交互与状态 | OP-REG-008 未定义零副作用触发方式和具体可观察校验结果 | 资料明确的设计缺口 | REQ-REG-005、RULE-REG-008、OP-REG-008 | 高 | 自动演进 | 资料证据不足以直接判定交互；OP-REG-008 改为工程待验证，须先证明零网络触发和具体观察量，否则转受控执行 | 已关闭 |
| MRR-FTRA-001 | 追溯审计 | 初审 27 项沉淀表使用代表性单链，遗漏部分影响集合并误把治理规则都标为需求事实 | 资料明确的设计缺口 | REQ-REG-001 至 REQ-REG-011、OP-REG-001 至 OP-REG-018 | 高 | 自动演进 | 资料证据已按完整受影响集合重建沉淀判定；OP-REG-001 至 OP-REG-018 分离需求事实与通用规则 | 已关闭 |
| MRR-FTRA-002 | 追溯审计 | 当轮认定精确“同意条款并注册”无法由固定来源反向证明；REV03 复核证明该来源链存在 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 中 | 自动演进 | REV03 已建立需求文档视觉 → REQ-REG-007 → RULE-REG-019 → OP-REG-019 的可逆链并回链 | 已关闭 |
| MRR-FTRA-003 | 追溯审计 | 连续编号范围把只来自原型的 RULE/OP-REG-009 错归需求文档 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-009、OP-REG-009 | 中 | 自动演进 | 资料证据投影已改为显式 ID 集合；OP-REG-009 只保留在原型与页面视觉关系中 | 已关闭 |
| MRR-FTRA-004 | 追溯审计 | REQ-REG-008 只证明默认管理员，申请人账号名事实属于 REQ-REG-005 | 资料明确的设计缺口 | REQ-REG-005、REQ-REG-008、OP-REG-012、OP-REG-014 | 中 | 自动演进 | 资料证据已将 RULE/OP-REG-014 只回链 REQ-REG-005；REQ-REG-008 仅保留 RULE/OP-REG-012 | 已关闭 |
| MRR-FCHG-001 | 变更影响 | OP-REG-011 的提前清理与 OP-REG-012 关系消费互相冲突 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-008、OP-REG-011、OP-REG-012 | 高 | 自动演进 | 资料证据与清理规范已落实；OP-REG-012 使用独立预登记 fixture，OP-REG-011 资源由本用例 finalizer 独立闭合 | 已关闭 |
| MRR-FCHG-002 | 变更影响 | 外部操作未知结果后仍可能继续后续写入 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-009、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 资料证据与恢复规范已要求 OP-REG-011/OP-REG-013 任一未知结果冻结全部后续写入，对账并重新过门禁后才可恢复 | 已关闭 |
| MRR-FCHG-003 | 变更影响 | 双旅程稳定键未包含 caseId 与不可变 journeyId，授权数量也未要求精确匹配 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-013、OP-REG-013 | 高 | 自动演进 | 资料证据与环境规范已回链；OP-REG-013 键固定包含 caseId/journeyId=A/B，执行授权必须精确为 2 | 已关闭 |
| MRR-FCHG-004 | 变更影响 | 不可变执行清单缺少总用例与每次人工验证码等待的有界超时 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-009、OP-REG-011、OP-REG-013 | 中 | 自动演进 | 资料证据与安全挑战规范已回链；OP-REG-011/OP-REG-013 要求正整数总超时和逐次人工等待上限，超时即冻结写入并 finalizer | 已关闭 |

#### 阶段交接核验

| 交接点 | History 派生状态 | plan.md 正式记录 | 真实产物 | 结论 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 自动演进 → 最终复审 | 第一轮发布与冻结摘要均由 history 证明 | REV-20260728-REG-02 五角色结论已正式登记 | 冻结输入保持 19/19，不受第二轮暂存修改影响 | 通过 | 失效第一轮最终复审下游并进入第二轮自动演进 |
| 最终复审 → 用例确认 | REV-20260728-REG-02 结论为需演进 | 15 项缺口均已完成确定修订和关闭记录 | 第二轮暂存为 18/18 原子用例，待整体发布 | 不通过 | 原子发布后冻结 REV-20260728-REG-03 输入并复审 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-FREQ-001 | 需求事实 | 需求文档视觉 → REQ-REG-007 → RULE-REG-019 → OP-REG-019 | REV03 资料已确认 | 已回链纯视觉覆盖并保留当轮误判审计 |
| MRR-FREQ-002 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014 | 资料已确认 | 已回链中英文有效类 |
| MRR-FDES-001 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用原子用例独立前后置规范 |
| MRR-FDES-002 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用无条件 finalizer 规范 |
| MRR-FDES-003 | 需求事实 | REQ-REG-005、REQ-REG-006 → RULE-REG-015、RULE-REG-016 → OP-REG-015、OP-REG-016 | 资料已确认 | 已回链明确等价类 |
| MRR-FUX-001 | 需求事实 | 需求文档视觉 → REQ-REG-007 → RULE-REG-019 → OP-REG-019 | REV03 资料已确认 | 已回链协议区和主按钮视觉文案，不扩张交互语义 |
| MRR-FUX-002 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用工程可执行性与可观察量门禁 |
| MRR-FTRA-001 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新完整集合与事实归属投影 |
| MRR-FTRA-002 | 需求事实 | 需求文档视觉 → REQ-REG-007 → RULE-REG-019 → OP-REG-019 | REV03 资料已确认 | 已回链可逆视觉追溯并保留历史误判 |
| MRR-FTRA-003 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用显式 ID 集合与来源边界规范 |
| MRR-FTRA-004 | 需求事实 | REQ-REG-008 → RULE-REG-012 → OP-REG-012；REQ-REG-005 → RULE-REG-014 → OP-REG-014 | 资料已确认 | 已回链正确需求章节 |
| MRR-FCHG-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用生产者消费者与 cleanup 规范 |
| MRR-FCHG-002 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用未知结果冻结与对账规范 |
| MRR-FCHG-003 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用稳定幂等键与精确授权规范 |
| MRR-FCHG-004 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用有界人工等待与取消恢复规范 |

<!-- review-batch:REV-20260728-REG-02:end -->

<!-- review-batch:REV-20260728-REG-03:start -->

### 评审批次：REV-20260728-REG-03

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 第二轮自动演进后最终复审 |
| 输入基线版本 | `plan.md` SHA-256 `6aba50416bce74437d2fab1a2e4600ae7164030782126830ce63e84f5c743b3d`；`cases-registration.md` SHA-256 `7be8275b3a69436d4c3afea135d59010b882dbdf58ebfc844ea5da113896b1b5`；受控来源与索引共 4 项；冻结快照 combined digest `865b253710313a328d2d2c6533e664cb6be548e833c57ab1994ff5fc89c45378`；完整度实测 18/18 |
| 自动演进轮次 | 2 |
| 隔离规则 | requirements、design、traceability 首角色回合均为 `fork_turns=none`；宿主线程上限为 3，interaction 与 impact 分别复用 requirements/design reviewer 的第二角色回合。全部回合只读同一冻结快照，禁止读取 live 文件和其他 reviewer 输出 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 阶段交接核验 | 五类 reviewer 结论均已返回；23 条角色级 finding 均有确定修订路径，无资料冲突或用户业务裁决点 |

#### reviewer 执行记录

| 角色 | 执行方式 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | fork_turns=none | 固定 plan/cases、受控索引、需求文档与原型摘要 | 已完成 | 需演进 | MRR-R3REQ-001、MRR-R3REQ-002、MRR-R3REQ-003 | 已关闭 |
| 测试设计评审 | 真实子智能体 | fork_turns=none | 固定 plan/cases digest 与设计检查清单 | 已完成 | 需演进 | MRR-R3DES-001 至 MRR-R3DES-006 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体第二角色回合 | 同一冻结快照；禁止复用首角色结论 | 固定 plan/cases、文档内嵌视觉与原型 | 已完成 | 需演进 | MRR-R3UX-001 至 MRR-R3UX-004 | 已关闭 |
| 追溯审计 | 真实子智能体 | fork_turns=none | 固定 plan/cases、关系与完整度结果 | 已完成 | 需演进 | MRR-R3TRA-001 至 MRR-R3TRA-005 | 已关闭 |
| 变更影响评审 | 真实子智能体第二角色回合 | 同一冻结快照；禁止复用首角色结论 | 固定操作预算、幂等、人工挑战、清理与恢复边界 | 已完成 | 需演进 | MRR-R3CHG-001 至 MRR-R3CHG-005 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-R3REQ-001 | 需求一致性 | 需求文档内嵌注册截图明确显示协议区及“同意条款并注册”，REV02 漏读该视觉证据 | 需求覆盖缺口 | REQ-REG-007、RULE/OP-REG-019 | 高 | 自动演进 | 已恢复纯视觉 RULE/OP-REG-019；不推断控件、阻断、点击或提交结果 | 已关闭 |
| MRR-R3REQ-002 | 需求一致性 | RULE-REG-014 声称中英文边界均覆盖，OP-REG-014 只对中文执行 19/20/21 且遗漏非空下边界 1 | 需求覆盖缺口 | REQ-REG-005、RULE/OP-REG-014 | 中 | 自动演进 | 中文和英文分别覆盖 1/19/20/21，空值独立，逐值复位 | 已关闭 |
| MRR-R3REQ-003 | 需求一致性 | OP-REG-014 目录及演进回链仍残留 REQ-REG-008，正文与权威规则只属于 REQ-REG-005 | 资料明确的设计缺口 | REQ-REG-005、REQ-REG-008、OP-REG-014 | 中 | 自动演进 | 已移除旧链；REQ-REG-008 仅保留 RULE/OP-REG-012 | 已关闭 |
| MRR-R3DES-001 | 测试设计 | 短信请求后直接上传，缺少人工输入、等待、恢复和独立结果边界 | 资料明确的设计缺口 | RULE/OP-REG-011、RULE/OP-REG-013 | 高 | 自动演进 | 每旅程增加 HUMAN_CHALLENGE_WAIT；只有脱敏 handoff `verified` 可恢复 | 已关闭 |
| MRR-R3DES-002 | 测试设计 | lease 丢失后仍要求原 finalizer 执行，但旧 fencing token 禁止提交结果，恢复所有权未闭合 | 资料明确的设计缺口 | OP-REG-011、OP-REG-013、cleanup/reconciliation | 高 | 自动演进 | 旧 owner 禁止外部调用；新 lease 恢复 owner 按 intent、稳定键与 cleanupActionId 接管 | 已关闭 |
| MRR-R3DES-003 | 测试设计 | 企业 B 的启动谓词使用模糊 `confirmed/reconciled`，未排除 A 对账为不存在、失败或冲突 | 资料明确的设计缺口 | REQ-REG-009、RULE/OP-REG-013 | 高 | 自动演进 | 仅 A 提交与关系均为 `confirmed_created` 才允许 B；其他状态直接 finalizer | 已关闭 |
| MRR-R3DES-004 | 测试设计 | OP-REG-002/004/007 的唯一性触发时点未知，却固定按 no_write 设计 | 资料明确的设计缺口 | RULE/OP-REG-002、004、007 | 高 | 自动演进 | Inspector/网络证据先证明无业务写入；否则阻塞或另行转受控执行 | 已关闭 |
| MRR-R3DES-005 | 测试设计 | 信用代码缺非空 required 分区，企业标识缺小写字母数字混合类，申请人英文缺完整边界 | 需求覆盖缺口 | RULE/OP-REG-003、006、014 | 中 | 自动演进 | 已补独立代表值且不扩张资料未定义格式/字符断言 | 已关闭 |
| MRR-R3DES-006 | 测试设计 | 企业名称与标识有效类未隔离唯一性干扰 | 资料明确的设计缺口 | RULE/OP-REG-001、006 | 中 | 自动演进 | 使用已知未占用合成值；无法证明未占用时限制 oracle 并单独记录唯一性 | 已关闭 |
| MRR-R3UX-001 | 交互与状态 | 需求文档内嵌视觉证明协议区和精确主按钮文案，当前视觉覆盖缺失 | 需求覆盖缺口 | REQ-REG-007、RULE/OP-REG-019 | 高 | 自动演进 | 已恢复两项零写入视觉断言并保留交互语义边界 | 已关闭 |
| MRR-R3UX-002 | 交互与状态 | 需求视觉与 HTML 均显示验证码输入区及获取区域，OP-REG-009 只覆盖后者 | 需求覆盖缺口 | REQ-REG-007、RULE/OP-REG-009 | 中 | 自动演进 | OP-REG-009 已同时检查两项视觉区域，不推断 input/button 能力 | 已关闭 |
| MRR-R3UX-003 | 交互与状态 | OP-REG-011/013 缺少人工等待恢复，且 operationKind 的 confirmed/unknown 判据未冻结 | 资料明确的设计缺口 | RULE/OP-REG-011、013 | 高 | 自动演进 | 冻结每类结果判据、A/B 独立 handoffId、上限及失败恢复路径 | 已关闭 |
| MRR-R3UX-004 | 交互与状态 | 多个 no_write 字段用例用未冻结的“触发校验”和“接受/拒绝”宣告已覆盖 | 资料明确的设计缺口 | RULE/OP-REG-001、003、005、006、010、014、015、016 | 中 | 自动演进 | 全部改为工程待验证；先冻结无业务写入触发及校验已运行后的观察量 | 已关闭 |
| MRR-R3TRA-001 | 追溯审计 | OP-REG-014 目录和回链仍错误关联 REQ-REG-008 | 资料明确的设计缺口 | REQ-REG-005、REQ-REG-008、OP-REG-014 | 高 | 自动演进 | 目录、正文、RULE、需求矩阵和演进回链已同步为 REQ-REG-005 | 已关闭 |
| MRR-R3TRA-002 | 追溯审计 | RULE/OP-REG-008 在正文为工程待验证，规则设计矩阵却为不适用，覆盖矩阵又标已覆盖 | 资料明确的设计缺口 | REQ-REG-005、RULE/OP-REG-008 | 高 | 自动演进 | 规则设计与业务域统一投影为工程待验证，并与 OP-REG-011 受控执行拆分 | 已关闭 |
| MRR-R3TRA-003 | 追溯审计 | OP-REG-011 正文覆盖异常恢复，计划对应覆盖域却无派生 caseId | 资料明确的设计缺口 | REQ-REG-007、RULE/OP-REG-011 | 中 | 自动演进 | RULE-REG-011 明确为异常与恢复类型，覆盖域回链 OP-REG-011 | 已关闭 |
| MRR-R3TRA-004 | 追溯审计 | REV01 MRR-DES-003 沉淀链把 OP-REG-013 错挂到 RULE-REG-011/012 | 资料明确的设计缺口 | REQ-REG-009、RULE/OP-REG-013 | 高 | 自动演进 | 已从旧链移除；OP-REG-013 仅由 REQ-REG-009 → RULE-REG-013 派生 | 已关闭 |
| MRR-R3TRA-005 | 追溯审计 | 用例包级与逐用例回链缺少 REV02，无法回放第二轮修订 | 资料明确的设计缺口 | OP-REG-008、OP-REG-009、OP-REG-011、OP-REG-013、OP-REG-014、OP-REG-016、OP-REG-018 | 中 | 自动演进 | 已追加 REV02/REV03 包级摘要和受影响 OP-REG-008、OP-REG-009、OP-REG-011、OP-REG-013、OP-REG-014、OP-REG-016、OP-REG-018 的精确 finding 回链 | 已关闭 |
| MRR-R3CHG-001 | 变更影响 | 未知短信/上传只有笼统 RECONCILING，缺少通道级查询与状态协议 | 资料明确的设计缺口 | OP-REG-011、OP-REG-013 | 高 | 自动演进 | 每种 operationKind 冻结 reconcileActionId、查询键、结果判据和截止时间 | 已关闭 |
| MRR-R3CHG-002 | 变更影响 | cleanup 未纳入与创建操作同等级的 intent/result、预算、deadline 与 fencing | 资料明确的设计缺口 | cleanup、OP-REG-011、OP-REG-013 | 高 | 自动演进 | cleanup 按资源类型建模独立操作，记录 intent/result、尝试上限、current fencing 和读回 | 已关闭 |
| MRR-R3CHG-003 | 变更影响 | 验证码人工挑战没有持久等待、恢复和脱敏结果边界 | 资料明确的设计缺口 | OP-REG-011、OP-REG-013 | 高 | 自动演进 | 每旅程独立 HUMAN_CHALLENGE_WAIT；超时/取消/lease_lost 冻结并 finalizer | 已关闭 |
| MRR-R3CHG-004 | 变更影响 | 企业 B 未限定企业 A 对账成功 | 资料明确的设计缺口 | REQ-REG-009、OP-REG-013 | 高 | 自动演进 | B 仅由 A `confirmed_created` 谓词开启 | 已关闭 |
| MRR-R3CHG-005 | 变更影响 | 三个唯一性 no_write 场景缺少副作用证明门禁 | 资料明确的设计缺口 | OP-REG-002、004、007 | 高 | 自动演进 | 先证明无上传/短信/提交/业务写入，否则保持不可执行或转独立授权 | 已关闭 |

#### 阶段交接核验

| 交接点 | History 派生状态 | plan.md 正式记录 | 真实产物 | 结论 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 第二轮自动演进 → 最终复审 | `ArtifactPublishPrepared` 已持久化且最终文件读回摘要匹配 | REV-20260728-REG-03 已绑定冻结 combined digest | 18/18 正文、18 条 RULE、关系投影与受控来源快照已建立 | 通过 | 追加 `ActivitySucceeded` 后派发最多 3 个 reviewer |
| 最终复审 → 用例确认 | 五类 reviewer 已返回需演进 | 23 条 finding 均已正式登记 | 第三轮暂存为 19/19 原子用例与 19 条 RULE | 不通过 | 原子发布第三轮修订，冻结 REV-20260728-REG-04 新摘要并复审 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-R3REQ-001 | 需求事实 | 需求文档视觉 → REQ-REG-007 → RULE-REG-019 → OP-REG-019 | 资料已确认 | 已回链纯视觉覆盖并保留 REV02 误判审计 |
| MRR-R3REQ-002 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014 | 资料已确认 | 已回链中文与英文 1/19/20/21 边界 |
| MRR-R3REQ-003 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014；REQ-REG-008 → RULE-REG-012 → OP-REG-012 | 资料已确认 | 已回链正确需求边并移除过期关联 |
| MRR-R3DES-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用人工挑战等待与恢复边界 |
| MRR-R3DES-002 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用 lease、fencing 与恢复 owner 规范 |
| MRR-R3DES-003 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用后置事实确认与下游启动谓词 |
| MRR-R3DES-004 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用零写入证明和受控执行门禁 |
| MRR-R3DES-005 | 需求事实 | REQ-REG-002、REQ-REG-004、REQ-REG-005 → RULE-REG-003、RULE-REG-006、RULE-REG-014 → OP-REG-003、OP-REG-006、OP-REG-014 | 资料已确认 | 已回链非空、混合字符和中英文边界代表值 |
| MRR-R3DES-006 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用等价类隔离与单一 oracle 规范 |
| MRR-R3UX-001 | 需求事实 | 需求文档视觉 → REQ-REG-007 → RULE-REG-019 → OP-REG-019 | 资料已确认 | 已回链协议区和主按钮纯视觉文案 |
| MRR-R3UX-002 | 需求事实 | 需求文档视觉与原型 → REQ-REG-007 → RULE-REG-009 → OP-REG-009 | 资料已确认 | 已回链验证码输入区和获取区域 |
| MRR-R3UX-003 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用人工 callback 与外部操作恢复规范 |
| MRR-R3UX-004 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已引用可观察量和工程可执行门禁 |
| MRR-R3TRA-001 | 需求事实 | REQ-REG-005 → RULE-REG-014 → OP-REG-014 | 资料已确认 | 已回链 OP-REG-014 的唯一需求边 |
| MRR-R3TRA-002 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新规则、覆盖域和用例状态投影 |
| MRR-R3TRA-003 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新异常恢复覆盖域与 caseId 投影 |
| MRR-R3TRA-004 | 需求事实 | REQ-REG-009 → RULE-REG-013 → OP-REG-013 | 资料已确认 | 已回链双企业关系并移除错误旧链 |
| MRR-R3TRA-005 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新逐用例评审回链与批次可回放证据 |
| MRR-R3CHG-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用通道级 reconciliation 契约 |
| MRR-R3CHG-002 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用 cleanup intent/result、预算和 deadline 契约 |
| MRR-R3CHG-003 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用人工等待、取消和脱敏恢复契约 |
| MRR-R3CHG-004 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用 A confirmed_created 后才启动 B 的门禁 |
| MRR-R3CHG-005 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用唯一性场景的零写入证明门禁 |

<!-- review-batch:REV-20260728-REG-03:end -->

<!-- review-batch:REV-20260728-REG-04:start -->

### 评审批次：REV-20260728-REG-04

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 第三轮自动演进后最终复审 |
| 输入基线版本 | `plan.md` SHA-256 `b30fa6cd79fb90b739b0cffd219b5384afedaccb3344d9d3a17da2c097dd86f2`；`cases-registration.md` SHA-256 `b09492b7698a38e725184b747ae13010c7fbc7996755e3846b055fe5bf0e418c`；受控来源与索引共 4 项；冻结快照 combined digest `7b69fe5b4dd130dbbc18a7d6036afd4a24d5dbe9d84c65b737c213c8166c8559`；完整度实测 19/19 |
| 自动演进轮次 | 3 |
| 隔离规则 | 宿主全局线程硬上限为 3；全部 reviewer 受控回合只接收 REV04 同一冻结快照与本角色检查清单，禁止把既有结论、live 文件、其他 reviewer 输出或主 Agent 推理作为输入；该方式不是新的独立线程 |
| 综合结论 | 阻塞 |
| 收敛状态 | 阻塞 |
| 阶段交接核验 | 五类 reviewer 已完成；10 条资料明确 finding 已形成确定修订，但第 3 轮仍返回需演进，必须先追加 blocker，禁止静默创建第 4 轮或请求用例确认 |

#### reviewer 执行记录

| 角色 | 执行方式 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体受控回合 | 同一冻结快照；禁止复用既有结论 | REV04 plan/cases 与受控需求资料 | 已完成 | 需演进 | MRR-R4REQ-001 | 已关闭 |
| 测试设计评审 | 真实子智能体受控回合 | 同一冻结快照；禁止复用既有结论 | REV04 plan/cases 与设计检查清单 | 已完成 | 需演进 | MRR-R4DES-001、MRR-R4DES-002 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体受控回合 | 同一冻结快照；禁止复用既有结论 | REV04 plan/cases、需求视觉与原型 | 已完成 | 需演进 | MRR-R4UX-001 | 已关闭 |
| 追溯审计 | 真实子智能体受控回合 | 同一冻结快照；禁止复用既有结论 | REV04 关系与完整度结果 | 已完成 | 需演进 | MRR-R4TRA-001、MRR-R4TRA-002 | 已关闭 |
| 变更影响评审 | 真实子智能体受控回合 | 同一冻结快照；禁止复用既有结论 | REV04 外部副作用与恢复边界 | 已完成 | 需演进 | MRR-R4CHG-001、MRR-R4CHG-002、MRR-R4CHG-003、MRR-R4CHG-004 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-R4REQ-001 | 需求一致性 | OP-REG-019 正文为 no_write，但冻结计划的数据策略只覆盖其余 18 条用例 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 中 | 自动演进 | 已把 no_write 计划策略扩至 OP-REG-019，并保留最大数量 0 | 已关闭 |
| MRR-R4DES-001 | 测试设计 | 企业名称仅分别覆盖中文、英文、数字，未覆盖资料允许字符的混合有效分区 | 需求覆盖缺口 | REQ-REG-001、RULE-REG-001、OP-REG-001 | 中 | 自动演进 | OP-REG-001 已加入中英数混合未占用代表值 `企A1` 或同类值，并保持唯一性 oracle 隔离 | 已关闭 |
| MRR-R4DES-002 | 测试设计 | OP-REG-019 的 no_write 正文与计划级数据策略投影不一致 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 中 | 自动演进 | 已把数据策略范围扩至 OP-REG-019 并重算 19/19 覆盖 | 已关闭 |
| MRR-R4UX-001 | 交互与状态 | 人工挑战 callback 未绑定当前 request/run/case/inputDigest/journey/handoff/waitRevision，也未规定 current fencing owner 的原子消费 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-009、RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 已冻结 callback 关联字段、有效期与 CAS；迟到、重复、跨旅程、旧 revision、拒绝或错误均不解锁 upload/submit | 已关闭 |
| MRR-R4TRA-001 | 追溯审计 | REQ 和覆盖域仍写已覆盖/受控执行，但对应 RULE 与 case 的最近未满足门禁为工程待验证 | 资料明确的设计缺口 | REQ-REG-001 至 REQ-REG-006、REQ-REG-010；OP-REG-001 至 OP-REG-008、OP-REG-010、OP-REG-012、OP-REG-014 至 OP-REG-016、OP-REG-018 | 高 | 自动演进 | 已按最近未满足门禁统一需求与覆盖域投影，并显式保留 OP-REG-012 受控执行、OP-REG-018 已覆盖子状态 | 已关闭 |
| MRR-R4TRA-002 | 追溯审计 | OP-REG-009 缺 REV02/MRR-FTRA-003，OP-REG-013 缺 MRR-R3TRA-004，且 MRR-FTRA-001 未逐用例回链 | 资料明确的设计缺口 | OP-REG-001 至 OP-REG-018 | 中 | 自动演进 | 已按 finding 受影响集合机械重建批次与逐用例 backlink，并校验差集为 0 | 已关闭 |
| MRR-R4CHG-001 | 变更影响 | 冻结输入混用 OperationResult、QueryResult 与 JourneyResult，导致企业 B 启动谓词不可编码 | 资料明确的设计缺口 | REQ-REG-007、REQ-REG-009、RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 已冻结三个互斥状态域；B 仅在 `A.submit=confirmed` 且 `A.relationQuery=confirmed_created` 时启动 | 已关闭 |
| MRR-R4CHG-002 | 变更影响 | intent/result、fencing、handoff、reconcile/cleanup ID 缺少 runtime、ledger、history、report 和诊断产物的字段路由 | 资料明确的设计缺口 | RULE-REG-011、RULE-REG-013、OP-REG-011、OP-REG-013 | 高 | 自动演进 | 已补存储矩阵；raw fencing/lease/handoff/tool handles 只允许进入 runtime，禁止进入 ledger、history、报告和诊断产物 | 已关闭 |
| MRR-R4CHG-003 | 变更影响 | 恢复的 OP-REG-019 未绑定计划级 no_write 策略 | 资料明确的设计缺口 | REQ-REG-007、RULE-REG-019、OP-REG-019 | 中 | 自动演进 | 已扩展计划策略并重算 19/19 policy coverage | 已关闭 |
| MRR-R4CHG-004 | 变更影响 | CHG-REG-003 使用不完整 REQ 集合和“中受影响用例”占位，无法确定性重放复测范围 | 资料明确的设计缺口 | REQ-REG-001 至 REQ-REG-010、OP-REG-001 至 OP-REG-019 | 中 | 自动演进 | 已拆成视觉、字段门禁、外部副作用、关系投影四条变更记录，逐条枚举 REQ/RULE/caseId 与复测边界 | 已关闭 |

#### 阶段交接核验

| 交接点 | History 派生状态 | plan.md 正式记录 | 真实产物 | 结论 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 第三轮自动演进 → 最终复审 | `ArtifactPublishPrepared` 已持久化且最终文件读回摘要匹配 | REV-20260728-REG-04 已绑定冻结 combined digest | 19/19 正文、19 条 RULE、关系投影与受控来源快照已建立 | 通过 | 追加 `ActivitySucceeded` 后派发最多 3 个 reviewer |
| 最终复审 → 用例确认 | 五类 reviewer 均提交到同一冻结输入；第 3 轮仍需演进 | 10 条 finding 已修订并关闭，但 REV04 综合结论为阻塞 | 19/19 恢复草案已补正，尚无新冻结摘要的恢复复审 | 不通过 | 追加 `BlockerRaised`；只有用户明确允许一次同轮恢复复审后才能冻结新摘要，仍不得请求用例确认 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-R4REQ-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用 no_write 策略与 caseId 完整覆盖规则 |
| MRR-R4DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OP-REG-001 | 资料已确认 | 已回链中英数混合有效分区 |
| MRR-R4DES-002 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已更新 no_write 计划投影 |
| MRR-R4UX-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用人工 callback、CAS 与 fencing 恢复规则 |
| MRR-R4TRA-001 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新最近未满足门禁状态投影 |
| MRR-R4TRA-002 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新逐 finding 的双向评审回链 |
| MRR-R4CHG-001 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已引用外部操作、查询与旅程状态分域 |
| MRR-R4CHG-002 | 通用规则 | docs/testing/automation-guideline.md；docs/testing/environment-guideline.md；docs/testing/report-guideline.md | 资料已确认 | 已引用唯一事实所有者并更新字段存储矩阵 |
| MRR-R4CHG-003 | 通用规则 | docs/testing/environment-guideline.md | 资料已确认 | 已更新 OP-REG-019 的 no_write 策略投影 |
| MRR-R4CHG-004 | 通用规则 | docs/testing/testcase-guideline.md | 资料已确认 | 已更新变更影响集合与确定性复测范围 |

<!-- review-batch:REV-20260728-REG-04:end -->

## 用例集评审与演进

- 初审完整度门禁实测 13/13，第一轮演进形成 19/19；REV02 识别 15 项缺口并形成 18/18，REV03 又识别 23 条角色级 finding，其中纠正了内嵌视觉漏读。第三轮原子发布后，REV04 在 19/19 草案中识别 10 条确定缺口并已形成恢复草案；因自动演进已达第 3 轮，工作流必须以 blocker 等待显式恢复复审决定，不能静默开启第 4 轮或请求用例确认。

## 工程层：代码定位与自动化设计

| 项目 | 内容 |
| --- | --- |
| 工程层状态 | 未开始 |
| 代码仓库 | 待用例确认后按 `.local/repositories/` 定位 |
| Graphify 图谱 | 待用例确认后检查 |
| 源码确认范围 | 待用例确认后以需求和页面语义定位 |

## 预计交付物

- 测试用例：`cases-registration.md` 已原子发布 19 条完整原子用例与 `REQ ↔ RULE ↔ caseId` 追溯；正在执行 REV-20260728-REG-04。
- 工程层设计：用例确认后补充到本计划的代码/图谱定位、数据和脚本方案。
- 自动化脚本与执行报告：工程设计与统一执行授权完成后生成。
