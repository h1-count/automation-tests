# 测试计划：开放平台登录与企业注册

> 填写结构以[流程规范](../../../../docs/testing/automation-guideline.md)、[用例规范](../../../../docs/testing/testcase-guideline.md)、[环境规范](../../../../docs/testing/environment-guideline.md)和[报告规范](../../../../docs/testing/report-guideline.md)为准。

> 结构版本：case-relation-projection-v1。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 计划编号 | OPEN-PLATFORM-ACCOUNT-ACCESS-20260723-RETEST |
| 状态 | 已确认 |
| 测试类型 | Web |
| 目标环境 | test（默认候选） |

## 任务执行清单

<!-- testcase-standard: task-execution-list-v1 -->

| 序号 | 阶段 | 任务 | 进入条件 | 完成标志 | 状态 | 当前结论 / 需要动作 | 证据或输出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 计划 | 资料、静态资产与环境预检 | 用户提出测试需求 | 测试计划形成 | 已完成 | 已引用需求文档和登录、注册原型；无匹配 Web 静态资产 | 本计划的输入资料、资产与环境区块 |
| 2 | 计划确认 | 确认范围、环境、推断与数据策略 | 测试计划已生成 | 用户确认计划 | 已完成 | 用户于 2026-07-23 确认 test 环境、当前范围和受控写入策略。 | 本计划 |
| 3 | 用例 | 生成全部用例包与追溯 | 测试计划已确认 | 用例包和 REQ ↔ RULE ↔ caseId 闭环 | 已完成 | 12 条草案已生成并完成关系同步和静态检查。 | cases-navigation.md、cases-registration.md、cases-login.md |
| 4 | 评审 | 多角色评审、自动演进与复审 | 用例草案完整 | 明确需求缺口关闭 | 进行中 | 已建立初审批次，等待隔离 reviewer。 | 评审批次 REV-20260723-RETEST-01 |
| 5 | 用例确认 | 确认用例集与剩余业务裁决 | 评审完成 | 用户确认用例 | 待开始 | 等待评审闭环 | 待确认 |
| 6 | 工程设计 | 仓库、图谱、数据与脚本方案定位 | 用例已确认 | 工程设计待审核 | 待开始 | 等待用例确认 | 待生成 |
| 7 | 脚本与执行 | 生成脚本、确认并执行 | 设计和执行授权完成 | 报告与复盘完成 | 待开始 | 等待工程设计与执行确认 | 待生成 |

## 测试范围

### 包含

- 官网注册入口、企业注册资料的已定义校验、重复提示、同手机号多企业和注册账号默认管理员。
- 手机号、密码登录及认证后默认进入 AIoT 控制台。

### 不包含

- 忘记密码、OAuth、弱网、性能、安全专项和兼容性专项；超出本次登录与注册功能范围。
- 成员管理中的“企业管理员只能有一个”约束；该规则属于成员管理，非本次注册默认管理员身份范围。

## 输入资料

> 结构版本：source-reference-links-v1

| manifest id / sectionId | 资料类型 | 可点击资料链接 | 页码、标题或页面定位 | 版本 / SHA-256 | 本次用途 |
| --- | --- | --- | --- | --- | --- |
| aiot-platform-project-document / platform-home-and-registration | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | 标题“官网改造”；注册、登录、AIoT控制台 | 未登记版本 / 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | 注册字段、唯一性、登录方式、控制台入口和管理员规则 |
| open-platform-axure-prototype / prototype-account-login | 原型 | [登录页面.html](../../../../sources/prototypes/open-platform/登录页面.html) | 原型页面“登录页面” | 未登记版本 / 8ce1373f5a4e9d73c2156eec667e124a8d1421e48c2bdfb185c9fd8fa546e79c | 登录页面与交互候选 |
| open-platform-axure-prototype / prototype-account-registration | 原型 | [注册页面.html](../../../../sources/prototypes/open-platform/注册页面.html) | 原型页面“注册页面” | 未登记版本 / b65ff8a0e437e4f979af719efc42bf4665c9d75eb5c2d72a391c5d19cce2cd52 | 注册入口、企业标识提示、营业执照和验证码交互候选 |

## 测试资产选择

<!-- testcase-standard: test-asset-selection-v1 -->

| assetId | 类型 | 可点击资产链接 | 选择依据 | 选择状态 | 工程验证项 |
| --- | --- | --- | --- | --- | --- |
| 不适用 | 不适用 | 不适用 | 本次为 Web 登录与注册，无匹配 active 静态资产 | 不适用 | 不适用 |

## 环境选择

> 结构版本：environment-status-v1

| 候选环境 | 选择依据 | 本地配置状态 | 预检状态 | 用户确认状态 | 未闭合项 |
| --- | --- | --- | --- | --- | --- |
| test | 用户未指定环境，按本机偏好默认选择 test | 未读取 | 未预检 | 待用户确认 | 账号、认证会话、滑块或短信验证码人工接管 |

## 测试方式

- 业务层基于需求文档与原型生成可追溯 Web 用例；用例确认后才以 Playwright 进入工程层。

## 测试数据策略与残留台账

> 结构版本：test-data-policy-v1

<!-- testcase-standard: test-data-policy-v1 -->

| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 用户确认状态 |
| --- | --- | --- | --- | --- | --- |
| 无写入 | 不适用 | 登录和注册表单未提交校验 | 0 | 不适用 | 待用户确认 |
| 受控残留 | test | 企业注册申请及合成营业执照 | 1 | RULE-REG-008、RULE-REG-009 | 待用户确认 |

### 写入策略明细

- 无写入：不发送验证码、不上传文件、不提交注册，用于页面交互和字段校验。
- 受控残留：仅在用户确认后创建最多一条使用唯一合成标识的注册申请，并登记 `.local/test-ledger/`；当前没有 `cleanupActionId`，不承诺自动清理，后续处理为台账标记人工处理。

## 用例集生成状态

> 结构版本：testcase-generation-v1

| 字段 | 内容 |
| --- | --- |
| 用例集状态 | 待评审 |
| 已完成用例包 | cases-navigation.md、cases-registration.md、cases-login.md |
| 待生成或待补齐用例包 | 无；待关系同步与静态检查 |
| 当前阻塞项 | 无 |
| 下一门禁 | 多角色隔离评审 |

## 覆盖基准与拆分清单

> 结构版本：coverage-inventory-v1

### 基准资料与模块映射

| 基准资料 | 层级或模块/流程 | 可验证场景或规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 差异、不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| AIoT平台项目.docx | 企业注册 | 必填、长度、内容、格式、唯一性、手机号多企业、管理员 | 有效、无效与受控提交路径 | RULE-REG-001 至 RULE-REG-009 | OPEN-REG-001、OPEN-REG-009 | 密码、验证码时效和审核结果未定义 |
| AIoT平台项目.docx | 手机号密码登录 | 登录并进入控制台 | 主认证链路与安全挑战后恢复 | RULE-LOG-001 | OPEN-LOG-001 | 密码策略、失败提示和锁定规则未定义 |
| AIoT平台项目.docx、原型 | 官网入口 | 注册、登录、立即使用与控制台入口 | 入口跳转与落地页 | RULE-NAV-001 至 RULE-NAV-002 | OPEN-NAV-001、OPEN-NAV-002 | 原型只作为交互候选，不增补业务规则 |

### 拆分清单

| 类别 | 拆分项与适用规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用、待补充或合并依据 |
| --- | --- | --- | --- | --- | --- |
| 输入字段 | 名称、地址、标识、信用代码、营业执照、申请人、手机号、简介、邮箱 | 等价类、已明示边界、格式和必填 | RULE-REG-001 至 RULE-REG-007 | OPEN-REG-001、OPEN-REG-007 | 信用代码格式和营业执照文件规则待补充 |
| 枚举与状态 | 未注册、三类重复、已提交、已登录、管理员 | 唯一性、认证和身份状态 | RULE-REG-003、RULE-REG-008、RULE-REG-009、RULE-LOG-001 | OPEN-LOG-001、OPEN-REG-003、OPEN-REG-008、OPEN-REG-009 | 注册审核状态未定义 |
| 关键交互 | 三类官网入口、获取验证码、提交注册、登录 | 页面落地与受控执行 | RULE-NAV-001、RULE-NAV-002、RULE-REG-008、RULE-LOG-001 | OPEN-LOG-001、OPEN-NAV-001、OPEN-NAV-002、OPEN-REG-008 | 验证码和提交需单独授权 |
| 角色与权限 | 注册账号在新注册企业中的管理员身份 | 注册后所属企业视图 | RULE-REG-009 | OPEN-REG-009 | 仅在受控注册成功后执行 |

### 测试设计技术与依据

| 适用场景 | 设计技术与最小记录 | 需求追溯编号 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 多条件业务规则 | 决策表：字段有效性、唯一性和必填条件 | REQ-REG-001 至 REQ-REG-008 | 注册有效与无效组合 | RULE-REG-001 至 RULE-REG-008 | OPEN-REG-001、OPEN-REG-008 | 不虚构信用代码或验证码规则 |
| 生命周期与状态机 | 未登录经认证进入控制台；注册成功后获得管理员身份 | REQ-LOG-001、REQ-REG-009 | 主状态迁移 | RULE-LOG-001、RULE-REG-009 | OPEN-LOG-001、OPEN-REG-009 | 认证挑战仅可人工最小接管 |
| 复杂输入 | 名称 2–50、地址最多 50、申请人最多 20、手机号 11 位、简介最多 300、邮箱格式、标识 3–6 位小写字母或数字 | REQ-REG-001 至 REQ-REG-007 | 边界与等价类 | RULE-REG-001 至 RULE-REG-007 | OPEN-REG-001、OPEN-REG-007 | 标识格式来自常驻提示，需以服务端可观察结果验证 |
| 核心用户旅程 | 企业注册、手机号密码登录、安全挑战后恢复 | REQ-REG-008、REQ-REG-009、REQ-LOG-001 | 受控主成功路径 | RULE-REG-008、RULE-REG-009、RULE-LOG-001 | OPEN-LOG-001、OPEN-REG-008、OPEN-REG-009 | 写入、认证和验证码需授权 |

## 覆盖矩阵

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用：资料定义注册和登录 | 注册、登录和控制台入口 | 待阶段二 | 无 |
| 输入与数据校验 | 适用：资料明确字段规则 | 必填、长度、格式、唯一性 | 待阶段二 | OPEN-REG-001、OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007、OPEN-REG-010 |
| 状态与生命周期 | 适用：资料定义登录后入口和默认管理员 | 登录、注册后身份 | 适用待补充 | OPEN-LOG-001 |
| 数据完整性与一致性 | 适用：资料明确唯一性和多企业规则 | 名称、标识、信用代码、手机号 | 待阶段二 | OPEN-REG-003、OPEN-REG-008 |
| 异常、容错与恢复 | 适用：认证挑战后自动恢复 | 合法人工接管后的恢复 | 受控执行 | 无 |
| 权限、身份与审计 | 适用：注册账号默认管理员 | 注册后身份 | 受控执行 | OPEN-REG-009 |
| 安全与隐私 | 适用：密码、验证码、营业执照敏感 | 脱敏与安全挑战边界 | 适用待补充 | 无 |
| 接口、集成与契约 | 适用待补充：未提供认证或注册接口资料 | 页面可观察结果 | 适用待补充 | OPEN-REG-003、OPEN-REG-008 |
| 兼容性与可移植性 | 超出本次请求 | 不适用 | 不适用 | 无 |
| 交互、视觉与无障碍 | 适用：原型定义关键页面和入口 | 页面可见交互与反馈 | 待阶段二 | OPEN-NAV-001、OPEN-NAV-002 |
| 性能、容量与稳定性 | 超出本次请求 | 不适用 | 不适用 | 无 |
| 配置、部署与可运维性 | 超出本次请求 | 不适用 | 不适用 | 无 |
| 本地化与法规要求 | 适用待补充：营业执照隐私规则未定义 | 不记录敏感值 | 适用待补充 | 无 |

## 需求追溯矩阵

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-NAV-001 | AIoT平台项目.docx；官网改造 | P1 | 顶部注册入口进入注册页面 | 适用 | 入口与落地页 | OPEN-NAV-001 | 待阶段二 | 无写入 |
| REQ-NAV-002 | AIoT平台项目.docx；官网改造 | P0 | 登录、立即使用和控制台入口进入统一登录 | 适用 | 三类入口和登录落地页 | OPEN-NAV-002 | 待阶段二 | 无写入 |
| REQ-REG-001 | AIoT平台项目.docx；官网改造注册企业名称 | P0 | 企业名称必填、2–50 字符且仅允许中文、英文、数字 | 适用 | 名称校验 | OPEN-REG-001 | 待阶段二 | 不发送验证码、不上传、不提交 |
| REQ-REG-002 | AIoT平台项目.docx；官网改造注册企业地址 | P0 | 企业地址必填且最多 50 字符 | 适用 | 地址校验 | OPEN-REG-002 | 待阶段二 | 不发送验证码、不上传、不提交 |
| REQ-REG-003 | AIoT平台项目.docx；官网改造注册唯一性 | P0 | 企业名称、标识和信用代码重复时显示对应提示 | 适用 | 重复数据校验 | OPEN-REG-003 | 受控执行 | 需预置隔离重复数据 |
| REQ-REG-004 | AIoT平台项目.docx；官网改造注册企业标识 | P0 | 企业标识必填、唯一，常驻提示为 3–6 位小写字母或数字 | 适用 | 标识校验 | OPEN-REG-004 | 待阶段二 | 服务端格式验收待受控观察 |
| REQ-REG-005 | AIoT平台项目.docx；官网改造营业执照与申请人 | P0 | 营业执照必填；申请人必填、最多 20 且仅中英文 | 适用 | 必填与申请人校验 | OPEN-REG-005 | 待阶段二 | 文件类型和大小未定义 |
| REQ-REG-006 | AIoT平台项目.docx；官网改造联系方式 | P0 | 联系方式必填且手机号为 11 位 | 适用 | 手机号校验 | OPEN-REG-006 | 待阶段二 | 不发送验证码 |
| REQ-REG-007 | AIoT平台项目.docx；官网改造简介与邮箱 | P1 | 简介选填最多 300；邮箱选填且符合格式 | 适用 | 可选字段校验 | OPEN-REG-007 | 待阶段二 | 不提交 |
| REQ-REG-010 | AIoT平台项目.docx；官网改造企业信用代码 | P0 | 企业信用代码必填 | 适用 | 空值校验 | OPEN-REG-010 | 待阶段二 | 不提交 |
| REQ-REG-008 | AIoT平台项目.docx；官网改造注册 | P1 | 一个手机号可注册多个企业 | 适用 | 受控提交 | OPEN-REG-008 | 受控执行 | 需写入确认、验证码和台账 |
| REQ-REG-009 | AIoT平台项目.docx；官网改造及控制台 | P0 | 注册企业账号默认为管理员 | 适用 | 注册后所属企业身份 | OPEN-REG-009 | 受控执行 | 依赖注册成功与认证授权 |
| REQ-LOG-001 | AIoT平台项目.docx；官网改造登录及控制台 | P0 | 手机号、密码登录后默认进入 AIoT 控制台 | 适用 | 登录主链路 | OPEN-LOG-001 | 受控执行 | 需专用账号、认证授权和人工挑战接管 |

## 规则覆盖台账

> 结构版本：rule-coverage-v1

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-NAV-001 | REQ-NAV-001 | 官网改造；顶部导航 | 页面交互 | 点击注册 | 进入注册页面 | 交互断言 | 适用 | 已覆盖 | OPEN-NAV-001 | 无写入 |
| RULE-NAV-002 | REQ-NAV-002 | 官网改造；立即使用、登录、AIoT控制台 | 页面交互 | 点击任一入口 | 进入统一登录页面 | 交互断言 | 适用 | 已覆盖 | OPEN-NAV-002 | 无写入 |
| RULE-REG-001 | REQ-REG-001 | 官网改造；企业名称 | 输入边界 | 名称为空、2–50 字符或含非法字符 | 空值提示“请输入集团名称”，合法范围可继续 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-001 | 字符集仅中文、英文、数字 |
| RULE-REG-002 | REQ-REG-002 | 官网改造；企业地址 | 输入边界 | 地址为空、50 或 51 字符 | 空值提示且最多 50 字符 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-002 | 无 |
| RULE-REG-003 | REQ-REG-003 | 官网改造；唯一性提示 | 集成与数据一致性 | 名称、标识或信用代码重复 | 显示各自定义的重复提示 | 决策表 | 受控执行 | 受控执行 | OPEN-REG-003 | 需预置隔离重复数据；不创建未授权数据 |
| RULE-REG-004 | REQ-REG-004 | 官网改造；企业标识 | 输入边界 | 标识为空或不符合 3–6 位小写字母或数字提示 | 必填并拒绝不符合格式 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-004 | 唯一性由 RULE-REG-003 统一覆盖 |
| RULE-REG-005 | REQ-REG-005 | 官网改造；营业执照和申请人 | 输入边界 | 未上传营业执照、申请人为空或超长/非中英文 | 必填被拦截；申请人空值提示“请输入联系人名称”、最多 20 且仅中英文 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-005 | 营业执照类型和大小未定义 |
| RULE-REG-006 | REQ-REG-006 | 官网改造；联系方式 | 输入边界 | 手机号非 11 位 | 被格式校验拦截 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-006 | 一个手机号可注册多个企业另由 RULE-REG-008 覆盖 |
| RULE-REG-007 | REQ-REG-007 | 官网改造；简介、邮箱 | 输入边界 | 简介为空、300 或 301 字符；邮箱为空、合法或非法 | 简介可选且最多 300；填写邮箱时符合格式 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-007 | 无 |
| RULE-REG-010 | REQ-REG-010 | 官网改造；企业信用代码 | 输入边界 | 企业信用代码为空 | 被必填校验拦截 | 等价类 | 适用 | 待阶段二 | OPEN-REG-010 | 不虚构信用代码格式 |
| RULE-REG-008 | REQ-REG-008 | 官网改造；手机号多企业 | 集成与数据一致性 | 使用已有关联企业的手机号提交另一企业 | 不因手机号已关联企业而拒绝注册 | 决策表 | 受控执行 | 受控执行 | OPEN-REG-008 | 需最多一条受控残留、验证码和台账 |
| RULE-REG-009 | REQ-REG-009 | 官网改造；控制台所属企业 | 权限/身份 | 新注册企业账号认证后查看所属企业 | 对新注册企业显示管理员 | 状态迁移 | 受控执行 | 受控执行 | OPEN-REG-009 | 依赖 RULE-REG-008 成功且需认证授权 |
| RULE-LOG-001 | REQ-LOG-001 | 官网改造；登录、AIoT控制台 | 状态流转 | 有效手机号和密码认证 | 默认进入 AIoT 控制台 | 状态迁移 | 受控执行 | 受控执行 | OPEN-LOG-001 | 专用测试账号；安全挑战仅人工最小接管 |

## 用例包目录

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 生成状态 | 特殊门禁 |
| --- | --- | --- | --- | --- | --- |
| `cases-navigation.md` | 官网认证入口 | 注册、登录、立即使用和控制台入口 | OPEN-NAV-001、OPEN-NAV-002 | 草案完整 | 无写入 |
| `cases-registration.md` | 企业注册 | 字段校验、唯一性、多企业和管理员身份 | OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010 | 草案完整 | 写入、验证码、上传和台账 |
| `cases-login.md` | 手机号密码登录 | 认证与控制台入口 | OPEN-LOG-001 | 草案完整 | 专用账号、认证授权和安全挑战 |

## 变更影响分析

| 变更编号 | 来源与版本 | 受影响需求追溯编号 | 影响判定与依据 | 受影响 caseId | 脚本/工程设计影响 | 数据/环境影响 | 是否复测与结论 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 无 | 无 | 无 | 新建测试请求，尚无基线变更 | 无 | 无 | 无 | 不适用 | 草案 |

## 合理推断

- 用户未指定环境，按本机偏好将 test 作为默认候选；这不构成对认证、短信、上传或注册写入的授权。
- 原型用于确认页面和交互候选，业务断言仅以需求文档和后续明确裁决为准。

## 待补充信息

- 密码格式、错误认证提示、锁定和重试规则。
- 验证码有效期、发送频率、失败恢复与注册审核/成功页规则。
- 企业信用代码格式、营业执照的文件类型和大小限制，以及注册申请清理能力。

## 风险与审核事项

- 密码、验证码、营业执照和认证会话均为敏感信息；日志、报告和产物不得回显。
- 注册提交会创建业务数据，须先确认用例、环境、写入范围、验证码人工接管和残留台账策略。

## 用例集评审与演进

| 字段 | 内容 |
| --- | --- |
| 当前结论 | 12 条草案已生成，等待初审 |
| 下一动作 | 启动真实隔离 reviewer 并回填正式批次记录 |

## 多角色评审记录

> 结构版本：multi-role-review-v1。

> 结构版本：evidence-driven-evolution-v1。

> 结构版本：reviewer-execution-v1。

> 结构版本：auto-evolution-loop-v1。

> 结构版本：knowledge-decision-v1。

| 评审批次 | 状态 | 说明 |
| --- | --- | --- |
| 无 | 未开始 | 用例草案尚未生成；计划确认后按规范启动真实隔离 reviewer |

<!-- review-batch:REV-20260723-RETEST-01:start -->
### 评审批次：REV-20260723-RETEST-01

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 初审 |
| 自动演进轮次 | 0 |
| 综合结论 | 评审中 |
| 收敛状态 | 等待 reviewer |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/req_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；testcases/web/open-platform/account-access-20260723-retest/plan.md；testcases/web/open-platform/account-access-20260723-retest/cases-navigation.md；testcases/web/open-platform/account-access-20260723-retest/cases-registration.md；testcases/web/open-platform/account-access-20260723-retest/cases-login.md | 已完成 | 评审中 | 无 | 等待 reviewer |
| 测试设计评审 | 真实子智能体 | /root/design_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；testcases/web/open-platform/account-access-20260723-retest/plan.md；testcases/web/open-platform/account-access-20260723-retest/cases-navigation.md；testcases/web/open-platform/account-access-20260723-retest/cases-registration.md；testcases/web/open-platform/account-access-20260723-retest/cases-login.md | 已完成 | 评审中 | 无 | 等待 reviewer |
| 追溯审计 | 真实子智能体 | /root/trace_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；testcases/web/open-platform/account-access-20260723-retest/plan.md；testcases/web/open-platform/account-access-20260723-retest/cases-navigation.md；testcases/web/open-platform/account-access-20260723-retest/cases-registration.md；testcases/web/open-platform/account-access-20260723-retest/cases-login.md | 已完成 | 评审中 | 无 | 等待 reviewer |
| 交互与状态专项评审 | 真实子智能体 | /root/ux_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；testcases/web/open-platform/account-access-20260723-retest/plan.md；testcases/web/open-platform/account-access-20260723-retest/cases-navigation.md；testcases/web/open-platform/account-access-20260723-retest/cases-registration.md；testcases/web/open-platform/account-access-20260723-retest/cases-login.md | 已完成 | 评审中 | 无 | 等待 reviewer |
| 变更影响评审 | 真实子智能体 | /root/impact_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；testcases/web/open-platform/account-access-20260723-retest/plan.md；testcases/web/open-platform/account-access-20260723-retest/cases-navigation.md；testcases/web/open-platform/account-access-20260723-retest/cases-registration.md；testcases/web/open-platform/account-access-20260723-retest/cases-login.md | 已完成 | 评审中 | 无 | 等待 reviewer |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| 无 | 无 | 无 | 无 | 无 |
<!-- review-batch:REV-20260723-RETEST-01:end -->
