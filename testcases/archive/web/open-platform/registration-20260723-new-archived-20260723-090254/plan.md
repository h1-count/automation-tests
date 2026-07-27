# 测试计划：开放平台注册

> 结构版本：case-relation-projection-v1。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 计划编号 | OPEN-PLATFORM-REGISTRATION-20260723-NEW |
| 状态 | 已确认 |
| 测试类型 | Web |
| 目标环境 | test |

## 任务执行清单

<!-- testcase-standard: task-execution-list-v1 -->

| 序号 | 阶段 | 任务 | 进入条件 | 完成标志 | 状态 | 当前结论 / 需要动作 | 证据或输出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 计划 | 资料、资产与环境预检 | 用户提出测试需求 | 测试计划形成 | 已完成 | 已读取注册需求、原型并完成 test 预检。 | 本计划输入资料与环境选择区块 |
| 2 | 计划确认 | 确认范围、环境和数据策略 | 计划已生成 | 用户确认计划 | 已完成 | 用户已确认注册范围与无写入优先策略。 | 本计划基本信息 |
| 3 | 用例 | 生成注册用例包与追溯 | 计划已确认 | REQ ↔ RULE ↔ caseId 闭环 | 已完成 | 已生成全部注册用例包，关系同步与静态检查通过。 | cases-registration.md |
| 4 | 评审 | 隔离评审与自动演进 | 用例草案完整 | 明确缺口关闭 | 进行中 | 正在派发隔离初审 reviewer。 | 本计划多角色评审记录 |
| 5 | 用例确认 | 确认用例集与裁决 | 评审完成 | 用户确认用例 | 待开始 | 等待评审闭环。 | 待确认 |
| 6 | 工程设计 | 定位、数据与脚本方案 | 用例已确认 | 工程设计待审核 | 待开始 | 等待用例确认。 | 待生成 |
| 7 | 脚本与执行 | 生成、确认并执行 | 设计和执行授权完成 | 报告完成 | 待开始 | 等待工程设计与执行授权。 | 待生成 |

## 测试范围

### 包含

- 企业名称、地址、企业标识、营业执照、申请人、手机号、简介、邮箱的已定义校验。
- 企业名称、企业标识、统一社会信用代码的唯一性提示；同手机号注册多个企业；注册账号默认管理员。

### 不包含

- 登录、成员管理、OAuth、性能、安全和兼容性专项。

## 输入资料

> 结构版本：source-reference-links-v1

| manifest id / sectionId | 资料类型 | 可点击资料链接 | 页码、标题或页面定位 | 版本 / SHA-256 | 本次用途 |
| --- | --- | --- | --- | --- | --- |
| aiot-platform-project-document / platform-home-and-registration | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | 官网改造 / 注册 | 待确认 / 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | 注册业务规则、唯一性与管理员规则 |
| open-platform-axure-prototype / prototype-account-registration | 原型 | [注册页面.html](../../../../sources/prototypes/open-platform/注册页面.html) | 注册页面 | 待确认 / d4e823a2b1c2c81d899ce3f1d00baee640257f9fc6c0cdc77d0e0493506a13cd | 字段与提交入口候选 |

## 测试资产选择

<!-- testcase-standard: test-asset-selection-v1 -->

| assetId | 类型 | 可点击资产链接 | 选择依据 | 选择状态 | 工程验证项 |
| --- | --- | --- | --- | --- | --- |
| 不适用 | 不适用 | 不适用 | Web 注册无静态资产需求 | 不适用 | 不适用 |

## 环境选择

> 结构版本：environment-status-v1

| 候选环境 | 选择依据 | 本地配置状态 | 预检状态 | 用户确认状态 | 未闭合项 |
| --- | --- | --- | --- | --- | --- |
| test | 用户偏好默认环境 | 已配置 | 已预检 | 已确认 | 登录会话、验证码和写入授权 |

## 测试数据策略与残留台账

> 结构版本：test-data-policy-v1

<!-- testcase-standard: test-data-policy-v1 -->

| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 用户确认状态 |
| --- | --- | --- | --- | --- | --- |
| 无写入 | 不适用 | 表单校验 | 0 | 不适用 | 已确认 |
| 受控残留 | test | 企业注册申请 | 1 | 同手机号与管理员路径 | 待用户确认 |

### 写入策略明细

- 无写入：不发送验证码、不上传营业执照、不提交注册。
- 受控残留：仅在用例、工程设计和执行授权后登记 `.local/test-ledger/`，使用唯一合成标识；`cleanupActionId` 未登记时标记人工处理。

## 用例集生成状态

> 结构版本：testcase-generation-v1

| 字段 | 内容 |
| --- | --- |
| 用例集状态 | 待评审 |
| 已完成用例包 | cases-registration.md |
| 待生成或待补齐用例包 | 无 |
| 当前阻塞项 | 无 |
| 下一门禁 | 多角色隔离评审与自动演进闭环 |

## 覆盖基准与拆分清单

> 结构版本：coverage-inventory-v1

### 基准资料与模块映射

| 基准资料 | 层级或模块/流程 | 可验证场景或规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 差异、不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| AIoT平台项目.docx | 企业注册 | 字段、唯一性、多企业、默认管理员 | 无写入校验与受控执行路径 | RULE-REG-001～RULE-REG-006 | OPEN-REG-001、OPEN-REG-006 | 验证码、审核和成功状态未定义 |

### 拆分清单

| 类别 | 拆分项与适用规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用、待补充或合并依据 |
| --- | --- | --- | --- | --- | --- |
| 输入字段 | 必填、长度、内容、手机号与邮箱格式 | 无写入字段校验 | RULE-REG-001 | OPEN-REG-001 | 信用代码格式和执照文件规则未定义 |
| 枚举与状态 | 三类重复提示、同手机号多企业、管理员身份 | 决策与状态路径 | RULE-REG-002～RULE-REG-006 | OPEN-REG-002、OPEN-REG-006 | 成功状态待业务定义 |
| 关键交互 | 注册入口、协议确认、验证码与提交 | 仅非破坏性观察 | RULE-REG-001 | OPEN-REG-001 | 验证码行为不作为断言 |

### 测试设计技术与依据

| 适用场景 | 设计技术与最小记录 | 需求追溯编号 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 多条件业务规则 | 决策表：字段、三类唯一性与手机号关系 | REQ-REG-001、REQ-REG-002 | 有效与无效组合 | RULE-REG-001、RULE-REG-002、RULE-REG-004、RULE-REG-005、RULE-REG-006 | OPEN-REG-001、OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 不推断未定义格式 |
| 生命周期与状态机 | 状态迁移：注册后管理员身份 | REQ-REG-003 | 受控身份验证 | RULE-REG-003 | OPEN-REG-003 | 成功状态待定义 |

## 覆盖矩阵

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用：资料定义注册规则 | 字段、唯一性和管理员 | 适用待补充 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 |
| 输入与数据校验 | 适用：字段规则明确 | 必填、长度、格式 | 适用待补充 | OPEN-REG-001 |
| 数据完整性与一致性 | 适用：手机号多企业与唯一性 | 受控提交 | 适用待补充 | 无 |
| 权限、身份与审计 | 适用：默认管理员 | 受控身份验证 | 适用待补充 | OPEN-REG-003 |
| 交互、视觉与无障碍 | 适用：注册原型 | 表单与提交入口 | 适用待补充 | 无 |
| 安全与隐私 | 适用：验证码和营业执照 | 脱敏、人工接管 | 适用待补充 | 无 |

## 需求追溯矩阵

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-REG-001 | AIoT平台项目.docx / 官网改造注册 | P0 | 企业名称、信用代码、营业执照、地址、标识、申请人、手机号、简介和邮箱规则 | 适用 | 无写入校验 | OPEN-REG-001 | 适用待补充 | 信用代码格式与营业执照文件规则未定义 |
| REQ-REG-002 | AIoT平台项目.docx / 官网改造注册 | P1 | 三类唯一性与同手机号多企业 | 适用 | 受控提交 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 适用待补充 | 验证码、写入和台账 |
| REQ-REG-003 | AIoT平台项目.docx / AIoT控制台 | P0 | 注册账号默认管理员 | 适用 | 受控身份验证 | OPEN-REG-003 | 适用待补充 | 成功状态、认证和写入授权 |

## 规则覆盖台账

> 结构版本：rule-coverage-v1

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | REQ-REG-001 | 官网改造注册 | 输入边界 | 空值、长度、内容或手机号格式 | 已定义提示或校验 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-001 | 不发送验证码、上传或提交 |
| RULE-REG-002 | REQ-REG-002 | 官网改造注册 | 分支/决策 | 重复企业名称 | 显示“该企业名称已存在，请确认是否已注册或更换其他名称” | 决策表 | 适用 | 受控执行 | OPEN-REG-002 | 提交路径需单独授权 |
| RULE-REG-003 | REQ-REG-003 | AIoT控制台 | 权限/身份 | 注册账号进入所属企业 | 显示管理员 | 状态迁移 | 受控执行 | 受控执行 | OPEN-REG-003 | 成功状态、认证和写入授权 |

| RULE-REG-004 | REQ-REG-002 | 官网改造注册 | 分支/决策 | 重复企业标识 | 显示“该企业标识已存在，请更改为其他标识” | 决策表 | 适用 | 受控执行 | OPEN-REG-004 | 提交路径需单独授权 |
| RULE-REG-005 | REQ-REG-002 | 官网改造注册 | 分支/决策 | 重复统一社会信用代码 | 显示“该统一社会信用代码已注册，请确认是否已提交过申请” | 决策表 | 适用 | 受控执行 | OPEN-REG-005 | 提交路径需单独授权 |
| RULE-REG-006 | REQ-REG-002 | 官网改造注册 | 分支/决策 | 同手机号提交另一唯一企业 | 不因手机号已有企业被拒绝 | 决策表 | 适用 | 受控执行 | OPEN-REG-006 | 提交路径需单独授权 |

## 规则设计矩阵

> 结构版本：rule-design-matrix-v1

> 此矩阵仅从本计划已引用 RULE 派生。信用代码格式、营业执照文件属性、注册成功页、验证码时效和失败恢复未由资料定义，均不生成断言。

| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | 注册字段组：企业名称、信用代码、营业执照、地址、标识、申请人、手机号、简介、邮箱 | 必填：企业名称、信用代码、营业执照、地址、标识、申请人、手机号；选填：简介、邮箱 | 必填字段留空；名称长度 2/3/50/51；地址内容仅空格或合法地址；标识 1/2/20/21 位；申请人 1/2/10/11 位；手机号 10/11/12 位及非数字；邮箱留空、合法邮箱、格式错误 | 对资料已定义的字段显示对应必填、长度、内容或格式反馈；简介与邮箱留空不触发必填反馈；信用代码格式与执照文件属性未定义，不生成断言 | 无写入表单校验；使用合成输入，不发送验证码、不上传文件 | 验证码、上传与提交均不触发 | OPEN-REG-001 | 已覆盖 |
| RULE-REG-002 | 企业名称唯一性提交路径 | 不适用 | 已存在企业名称与其余资料定义字段有效 | 显示“该企业名称已存在，请确认是否已注册或更换其他名称”全文 | test 环境存在或可创建受控重复名称；记录清理台账 | 验证码、认证、写入授权与台账登记 | OPEN-REG-002 | 受控执行 |
| RULE-REG-003 | 注册后所属企业的账号身份 | 不适用 | 完成资料定义的注册路径后进入所属企业 | 可观察到注册账号为管理员；成功页、审核流未定义，不生成断言 | 可回收 test 企业、可验证管理员身份的认证会话 | 写入、验证码、认证与清理授权 | OPEN-REG-003 | 受控执行 |
| RULE-REG-004 | 企业标识唯一性提交路径 | 不适用 | 已存在企业标识与其余资料定义字段有效 | 显示“该企业标识已存在，请更改为其他标识”全文 | test 环境存在或可创建受控重复标识；记录清理台账 | 验证码、认证、写入授权与台账登记 | OPEN-REG-004 | 受控执行 |
| RULE-REG-005 | 统一社会信用代码唯一性提交路径 | 不适用 | 已存在统一社会信用代码与其余资料定义字段有效 | 显示“该统一社会信用代码已注册，请确认是否已提交过申请”全文；格式规则未定义，不生成断言 | test 环境存在或可创建受控重复信用代码；记录清理台账 | 验证码、认证、写入授权与台账登记 | OPEN-REG-005 | 受控执行 |
| RULE-REG-006 | 同手机号注册多个企业路径 | 不适用 | 同一手机号配合另一组唯一企业资料提交 | 不因手机号已有企业被拒绝；资料未定义成功页或审核状态，不生成断言 | test 环境已有同手机号企业或可受控创建；记录清理台账 | 验证码、认证、写入授权与台账登记 | OPEN-REG-006 | 受控执行 |

## 规则邻域复核

| 触发发现项 | 邻域 RULE | 共同依据 | 修订 caseId | 关系同步与规则设计预检结果 |
| --- | --- | --- | --- | --- |
| 初始严格预检 | RULE-REG-001 | REQ-REG-001 的同一注册字段组与无写入前置 | OPEN-REG-001 | 已补齐简介、邮箱选填空值及格式边界；待本轮关系同步与预检 |
| 初始严格预检 | RULE-REG-002、RULE-REG-004、RULE-REG-005、RULE-REG-006 | REQ-REG-002 的同一提交路径与受控写入前置 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 已核对三类唯一性全文与同手机号允许路径；待本轮关系同步与预检 |
| 初始严格预检 | RULE-REG-003 | REQ-REG-003 的注册后身份状态路径 | OPEN-REG-003 | 已明确成功页和审核流未定义，不生成断言；待本轮关系同步与预检 |

## 用例包目录

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 生成状态 | 特殊门禁 |
| --- | --- | --- | --- | --- | --- |
| `cases-registration.md` | 企业注册 | 字段、三类唯一性、多企业和管理员 | OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 草案完整 | 验证码、上传和写入 |

## 变更影响分析

| 变更编号 | 来源与版本 | 受影响需求追溯编号 | 影响判定与依据 | 受影响 caseId | 脚本/工程设计影响 | 数据/环境影响 | 是否复测与结论 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 无 | 无 | 无 | 全新隔离请求，无继承基线 | 无 | 无 | 无 | 不适用 | 草案 |

## 合理推断

- 原型只用于字段与交互候选；业务断言仅来自需求文档。

## 待补充信息

- 验证码发送、时效与失败恢复；注册审核、成功状态；信用代码格式与营业执照文件规则。

## 风险与审核事项

- 注册提交会创建业务数据；执行前必须确认写入、验证码和认证会话。

## 用例集评审与演进

| 字段 | 内容 |
| --- | --- |
| 当前结论 | 初审发现资料明确缺口，已自动演进，待最终复审 |
| 下一动作 | 同步关系与发起最终复审 |

## 多角色评审记录

> 结构版本：multi-role-review-v1。

> 结构版本：evidence-driven-evolution-v1。

> 结构版本：reviewer-execution-v1。

> 结构版本：auto-evolution-loop-v1。

> 结构版本：knowledge-decision-v1。

| 评审批次 | 状态 | 说明 |
| --- | --- | --- |
| 无 | 未开始 | 待登记注册用例草案初审批次 |

<!-- review-batch:REV-20260723-NEW-01:start -->
### 评审批次：REV-20260723-NEW-01

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 初审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 0 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 退回草案 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/registration_req_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已完成 | 需演进 | MRR-REQ-001、MRR-REQ-002、MRR-REQ-003 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/registration_design_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已完成 | 需演进 | MRR-DES-001、MRR-DES-002、MRR-DES-003 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/registration_trace_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已完成 | 需演进 | MRR-TRA-001、MRR-TRA-002 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-REQ-001 | 需求一致性评审 | 信用代码与营业执照必填已定义但遗漏 | 需求覆盖缺口 | REQ-REG-001 / OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001 | 已关闭 |
| MRR-REQ-002 | 需求一致性评审 | 已定义字段边界未逐项断言 | 资料明确的设计缺口 | REQ-REG-001 / OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001 | 已关闭 |
| MRR-REQ-003 | 需求一致性评审 | 三类唯一性与同手机号路径混合 | 资料明确的设计缺口 | REQ-REG-002 / OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 已关闭 |
| MRR-DES-001 | 测试设计评审 | 必填字段与决策表遗漏 | 资料明确的设计缺口 | REQ-REG-001 / OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001 | 已关闭 |
| MRR-DES-002 | 测试设计评审 | 唯一性分支未原子化 | 资料明确的设计缺口 | REQ-REG-002 / OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 已关闭 |
| MRR-DES-003 | 测试设计评审 | 管理员依赖重复提示用例 | 资料明确的设计缺口 | REQ-REG-003 / OPEN-REG-003 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-003 | 已关闭 |
| MRR-TRA-001 | 追溯审计 | 必填规则未完整回链 | 需求覆盖缺口 | REQ-REG-001 / OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001 | 已关闭 |
| MRR-TRA-002 | 追溯审计 | 基准映射投影落后于 RULE 台账 | 资料明确的设计缺口 | REQ-REG-001、REQ-REG-002、REQ-REG-003 / OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-REQ-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-REQ-002 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-REQ-003 | 需求事实 | REQ-REG-002 → RULE-REG-002、RULE-REG-004、RULE-REG-005、RULE-REG-006 → OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-DES-002 | 需求事实 | REQ-REG-002 → RULE-REG-002、RULE-REG-004、RULE-REG-005、RULE-REG-006 → OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-DES-003 | 需求事实 | REQ-REG-003 → RULE-REG-003 → OPEN-REG-003 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-TRA-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-TRA-002 | 需求事实 | REQ-REG-001、REQ-REG-002、REQ-REG-003 → RULE-REG-001～RULE-REG-006 → OPEN-REG-001～OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-NEW-01:end -->

<!-- review-batch:REV-20260723-NEW-02:start -->
### 评审批次：REV-20260723-NEW-02

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 1 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/registration_final_req | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已完成 | 需演进 | MRR-FINAL-REQ-001、MRR-FINAL-REQ-002、MRR-FINAL-REQ-003 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/registration_final_design | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已完成 | 需演进 | MRR-FINAL-DES-001、MRR-FINAL-DES-002 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/registration_final_trace | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-FINAL-REQ-001 | 需求一致性评审 | 三项必填提示全文遗漏 | 需求覆盖缺口 | REQ-REG-001 / OPEN-REG-001 | 高 | 自动演进 | 资料证据；已修订 OPEN-REG-001 | 已关闭 |
| MRR-FINAL-REQ-002 | 需求一致性评审 | 企业名称重复提示全文不一致 | 需求覆盖缺口 | REQ-REG-002 / OPEN-REG-002 | 高 | 自动演进 | 资料证据；已修订 OPEN-REG-002 | 已关闭 |
| MRR-FINAL-REQ-003 | 需求一致性评审 | 标识与信用代码提示全文不一致 | 需求覆盖缺口 | REQ-REG-002 / OPEN-REG-004、OPEN-REG-005 | 高 | 自动演进 | 资料证据；已修订 OPEN-REG-004、OPEN-REG-005 | 已关闭 |
| MRR-FINAL-DES-001 | 测试设计评审 | 必填提示全文遗漏 | 资料明确的设计缺口 | REQ-REG-001 / OPEN-REG-001 | 高 | 自动演进 | 资料证据；已修订 OPEN-REG-001 | 已关闭 |
| MRR-FINAL-DES-002 | 测试设计评审 | 唯一性提示全文不一致 | 资料明确的设计缺口 | REQ-REG-002 / OPEN-REG-002、OPEN-REG-004、OPEN-REG-005 | 高 | 自动演进 | 资料证据；已修订 OPEN-REG-002、OPEN-REG-004、OPEN-REG-005 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-FINAL-REQ-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-REQ-002 | 需求事实 | REQ-REG-002 → RULE-REG-002 → OPEN-REG-002 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-REQ-003 | 需求事实 | REQ-REG-002 → RULE-REG-004、RULE-REG-005 → OPEN-REG-004、OPEN-REG-005 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-DES-002 | 需求事实 | REQ-REG-002 → RULE-REG-002、RULE-REG-004、RULE-REG-005 → OPEN-REG-002、OPEN-REG-004、OPEN-REG-005 | 资料已确认 | 已回链，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-NEW-02:end -->

<!-- review-batch:REV-20260723-NEW-03:start -->
### 评审批次：REV-20260723-NEW-03

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 2 |
| 综合结论 | 评审中 |
| 收敛状态 | 等待 reviewer |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/registration_final_req_v4 | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-new/plan.md；testcases/web/open-platform/registration-20260723-new/cases-registration.md | 已启动 | 评审中 | 无 | 等待 reviewer |
| 测试设计评审 | 真实子智能体 | — | fork_turns=none | 等待资源 | 等待资源 | 评审中 | 无 | 等待 reviewer |
| 追溯审计 | 真实子智能体 | — | fork_turns=none | 等待资源 | 等待资源 | 评审中 | 无 | 等待 reviewer |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| 无 | 无 | 无 | 无 | 无 |
<!-- review-batch:REV-20260723-NEW-03:end -->
