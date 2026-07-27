# 测试计划：开放平台注册

> 结构版本：case-relation-projection-v1。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 计划编号 | OPEN-PLATFORM-REGISTRATION-20260723-FRESH |
| 状态 | 已确认 |
| 测试类型 | Web |
| 目标环境 | test（用户未指定时的默认候选） |

## 任务执行清单

<!-- testcase-standard: task-execution-list-v1 -->

| 序号 | 阶段 | 任务 | 进入条件 | 完成标志 | 状态 | 当前结论 / 需要动作 | 证据或输出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 计划 | 资料、资产与环境预检 | 用户提出注册测试 | 计划草案形成 | 已完成 | 已读取注册需求、注册原型并完成 test 本地预检。 | 本计划输入资料、环境选择与覆盖基准区块 |
| 2 | 计划确认 | 确认范围、环境、推断与数据策略 | 计划草案已生成 | 用户确认计划 | 已完成 | 用户已确认范围、test 环境与受控写入策略。 | 本计划基本信息、风险与审核事项 |
| 3 | 用例 | 生成注册用例包与追溯 | 测试计划已确认 | REQ ↔ RULE ↔ caseId 闭环 | 已完成 | 用例包、关系同步、规则设计预检和架构检查已通过。 | cases-registration.md |
| 4 | 评审 | 隔离评审、自动演进与复审 | 用例草案完整 | 明确缺口关闭 | 已完成 | REV-20260723-FRESH-05 已收齐全部适用真实 reviewer，正式结论为可提交确认。 | REV-20260723-FRESH-05 |
| 5 | 用例确认 | 确认用例集与剩余业务裁决 | 评审完成 | 用户确认用例 | 已完成 | 用户已确认当前 29 条注册用例；当时未授权执行，现由受控范围重开后的统一执行清单独立承接。 | cases-registration.md |
| 6 | 工程设计 | 定位、数据与脚本方案 | 用例已确认 | 工程设计与映射检查通过 | 已完成 | Runner 持有唯一 BrowserServer；单 worker 的 case 顺序复用同一专用 Context/page，并在每条开始时清理 Cookie、Web Storage 和表单状态且将受管页面置前；失败 worker 才重连同一 PID。超时尝试回收、能力依赖、稳定运行键和预算映射均通过自动校验。 | 工程层：代码定位与自动化设计；STX-12、STX-12A |
| 7 | 脚本与执行 | 生成、确认并执行 | 设计与完整脚本评审完成 | 报告完成 | 等待确认 | 29 条正式脚本、单进程浏览器复用和原子结果回收已完成评审；最小问题：是否确认新的不可变执行清单。确认后执行完整原子范围，旧确认和旧运行证据保留但不复用。 | tests/web/open-platform/registration-20260723-fresh/registration.formal.spec.ts；tests/web/open-platform/registration-20260723-fresh/execution.manifest.ts；STX-13 |

## 测试范围

### 包含

- 企业名称、信用代码、地址、企业标识、营业执照、申请人、手机号、简介、邮箱的资料已定义规则。
- 企业名称、企业标识、统一社会信用代码的唯一性提示；同手机号注册多个企业；注册账号默认管理员。

### 不包含

- 登录、成员管理、OAuth、性能、安全和兼容性专项；未定义的注册审核、成功页、验证码时效、恢复语义、信用代码格式和营业执照文件属性不生成断言。

## 输入资料

> 结构版本：source-reference-links-v1

| manifest id / sectionId | 资料类型 | 可点击资料链接 | 页码、标题或页面定位 | 版本 / SHA-256 | 本次用途 |
| --- | --- | --- | --- | --- | --- |
| aiot-platform-project-document / platform-home-and-registration | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | 官网改造 / 注册；AIoT控制台 | unknown / 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | 注册字段、唯一性、手机号关系与管理员规则 |
| open-platform-axure-prototype / prototype-account-registration | 原型 | [注册页面.html](../../../../sources/prototypes/open-platform/注册页面.html) | 注册页面 | unknown / d4e823a2b1c2c81d899ce3f1d00baee640257f9fc6c0cdc77d0e0493506a13cd | 字段呈现、协议确认、验证码及提交入口候选 |

## 测试资产选择

<!-- testcase-standard: test-asset-selection-v1 -->

| assetId | 类型 | 可点击资产链接 | 选择依据 | 选择状态 | 工程验证项 |
| --- | --- | --- | --- | --- | --- |
| open-platform-synthetic-business-license | test-document | [synthetic-business-license.png.b64](../../../../test-assets/documents/open-platform/synthetic-business-license.png.b64) | 正式注册需上传不含真实企业信息的最小合成 PNG；清单中唯一 active 候选 | 已选择 | setup 校验资产清单和 SHA-256；正式运行只允许一次真实上传 |

## 环境选择

> 结构版本：environment-status-v1

| 候选环境 | 选择依据 | 本地配置状态 | 预检状态 | 用户确认状态 | 未闭合项 |
| --- | --- | --- | --- | --- | --- |
| test | 当前用户默认环境偏好 | 已配置 | 已预检 | 已确认 | 固定测试码或测试通道优先；不可自动处理的验证码/登录挑战仅最小人工接管 |

## 测试方式

- Web：Playwright。`explore` 使用可见专用调试会话且业务写入预算为 0；`execute` 使用与探索隔离的新专用 Context，并在单 worker 授权运行内复用同一页面；每条 case 开始时清理 Cookie、Web Storage 和表单状态，只执行不可变清单列明的完整注册操作。

## 测试数据策略与残留台账

> 结构版本：test-data-policy-v1

<!-- testcase-standard: test-data-policy-v1 -->

| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 用户确认状态 |
| --- | --- | --- | --- | --- | --- |
| no_write | 不适用 | 探索与字段预检 | 0 | 不适用 | 不适用 |
| tracked_residual | test | 企业 | 2 | OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007 | 待用户确认 |
| tracked_residual | test | 合成营业执照上传 | 1 | OPEN-REG-002～OPEN-REG-006 | 待用户确认 |

### 写入策略明细

- `no_write`：explore 由浏览器写请求保护拦截 POST/PUT/PATCH/DELETE，不发送验证码、不上传、不提交；唯一合成标识和 `cleanupActionId` 均不适用。
- `tracked_residual` 企业：最多两家同手机号、不同且唯一的合成企业，唯一合成标识为 `OPEN-REG-<执行摘要>`；企业 A 负责注册成功、管理员及唯一性，企业 B 负责同手机号多企业。`cleanupActionId` 不适用；无删除能力时状态为 `retained`，TTL 72 小时。
- `tracked_residual` 文件：只允许一次真实合成 PNG 上传，其余注册提交复用同一上传响应；唯一合成标识绑定本次 runId。`cleanupActionId` 不适用；最大数量 1、TTL 72 小时。
- 所有远端创建前先登记 `CreateIntent`；结果未知时按唯一合成标识精确对账，不重复提交。过期残留或预算耗尽只冻结新写入，不影响只读校验。

### 执行清单映射

| caseId | 正式脚本 | 允许操作 | 资源类型 | 数量预算 | 后台验证 | 敏感产物策略 |
| --- | --- | --- | --- | --- | --- | --- |
| OPEN-REG-001、OPEN-REG-008～OPEN-REG-029 | registration.formal.spec.ts | 字段输入与无写入负向校验 | 无 | 0 | UI 字段状态与资料定义提示 | 不发送验证码、不上传、不提交 |
| OPEN-REG-002～OPEN-REG-007 | registration.formal.spec.ts | 获取测试验证码、提交注册、创建企业、查询后置状态、登记受控残留 | tenant | 2 | 优先已登记 API；当前使用认证后的所属企业管理页 | 登录/验证码步骤关闭 Trace/截图/视频 |

## 用例集生成状态

> 结构版本：testcase-generation-v1

| 字段 | 内容 |
| --- | --- |
| 用例集状态 | 已确认 |
| 已完成用例包 | cases-registration.md |
| 待生成或待补齐用例包 | 无 |
| 当前阻塞项 | 无 |
| 下一门禁 | 用户一次确认不可变完整执行清单 |

## 覆盖基准与拆分清单

> 结构版本：coverage-inventory-v1

### 基准资料与模块映射

| 基准资料 | 层级或模块/流程 | 可验证场景或规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 差异、不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| AIoT平台项目.docx | 官网改造 / 企业注册；AIoT控制台 | 字段、唯一性、同手机号、管理员、注册表单关键控件与统一登录默认落点 | explore 零写入校验与 execute 完整注册路径 | RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-009、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-016、RULE-REG-017、RULE-REG-018、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-023、RULE-REG-024、RULE-REG-025、RULE-REG-026、RULE-REG-027、RULE-REG-028、RULE-REG-029 | OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015、OPEN-REG-016、OPEN-REG-017、OPEN-REG-018、OPEN-REG-019、OPEN-REG-020、OPEN-REG-021、OPEN-REG-022、OPEN-REG-023、OPEN-REG-024、OPEN-REG-025、OPEN-REG-026、OPEN-REG-027、OPEN-REG-028、OPEN-REG-029 | 邮箱错误提示全文、成功页、审核与验证码恢复未定义 |

### 拆分清单

| 类别 | 拆分项与适用规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用、待补充或合并依据 |
| --- | --- | --- | --- | --- | --- |
| 输入字段 | 必填、选填、长度、内容、手机号格式及用户裁决的邮箱接受/拒绝样例按失败原因拆分 | 无写入字段校验 | RULE-REG-001、RULE-REG-008、RULE-REG-009、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-023、RULE-REG-024、RULE-REG-025、RULE-REG-026、RULE-REG-027、RULE-REG-028、RULE-REG-029 | OPEN-REG-001、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015、OPEN-REG-019、OPEN-REG-020、OPEN-REG-021、OPEN-REG-022、OPEN-REG-023、OPEN-REG-024、OPEN-REG-025、OPEN-REG-026、OPEN-REG-027、OPEN-REG-028、OPEN-REG-029 | 邮箱错误提示全文、信用代码格式与执照文件属性未定义 |
| 枚举与状态 | 三类唯一性、同手机号多企业、注册后管理员、统一登录落点及 A/B 数据一致性 | 决策与状态路径 | RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-016 | OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007 | 成功页、审核状态未定义 |
| 关键交互 | 验证码输入/获取入口、协议确认和注册入口 | explore 验证可见状态；execute 在成功路径发送测试验证码、勾选协议并提交 | RULE-REG-017、RULE-REG-018、RULE-REG-019 | OPEN-REG-016、OPEN-REG-017、OPEN-REG-018 | 未定义的验证码时效、协议内容和成功页不生成断言 |

### 测试设计技术与依据

| 适用场景 | 设计技术与最小记录 | 需求追溯编号 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 输入字段 | 等价类与边界：按失败原因独立验证必填、选填、长度、内容、手机号格式与邮箱接受/拒绝样例 | REQ-REG-001 | 无写入校验 | RULE-REG-001、RULE-REG-008、RULE-REG-009、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-023、RULE-REG-024、RULE-REG-025、RULE-REG-026、RULE-REG-027、RULE-REG-028、RULE-REG-029 | OPEN-REG-001、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015、OPEN-REG-019、OPEN-REG-020、OPEN-REG-021、OPEN-REG-022、OPEN-REG-023、OPEN-REG-024、OPEN-REG-025、OPEN-REG-026、OPEN-REG-027、OPEN-REG-028、OPEN-REG-029 | 邮箱错误提示全文、信用代码格式与执照文件属性未定义 |
| 多条件规则 | 决策表：三类唯一性与同手机号关系 | REQ-REG-002 | 受控提交 | RULE-REG-002、RULE-REG-004、RULE-REG-005、RULE-REG-006 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 写入、验证码和台账门禁 |
| 身份状态 | 状态迁移：成功注册账号进入所属企业后显示管理员 | REQ-REG-003 | 受控身份验证 | RULE-REG-003 | OPEN-REG-003 | 成功页与审核流未定义 |
| 导航状态 | 状态迁移：控制台统一登录验证后进入默认落点 | REQ-REG-004 | 受控认证与落点观察 | RULE-REG-007 | OPEN-REG-007 | 认证字段与失败恢复未定义 |
| 页面交互 | 页面结构观察与完整成功路径：验证码、协议确认与注册入口 | REQ-REG-001 | explore 零写入可见性；execute 执行测试验证码、协议确认和提交 | RULE-REG-017、RULE-REG-018、RULE-REG-019 | OPEN-REG-016、OPEN-REG-017、OPEN-REG-018 | 只断言资料已定义的可见性与注册后业务状态 |
| 数据一致性 | 状态迁移与一致性：企业 A/B 同账号手机号关联及处理 | REQ-REG-002 | 受控状态观察 | RULE-REG-016 | OPEN-REG-006 | 固定联合顺序、台账 validator、写入和处理授权 |

## 覆盖矩阵

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用：需求定义注册与控制台规则 | 字段、三类唯一性、同手机号、管理员和统一登录落点 | 已覆盖/受控执行 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 |
| 输入与数据校验 | 适用：字段规则明确 | 必填、长度、内容、格式、选填 | 已覆盖 | OPEN-REG-001、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015、OPEN-REG-019、OPEN-REG-020、OPEN-REG-021、OPEN-REG-022、OPEN-REG-023、OPEN-REG-024、OPEN-REG-025、OPEN-REG-026、OPEN-REG-027、OPEN-REG-028、OPEN-REG-029 |
| 数据完整性与一致性 | 适用：唯一性与同手机号关系 | 受控提交与所属企业状态核对 | 受控执行 | OPEN-REG-006 |
| 权限、身份与审计 | 适用：默认管理员及所属企业关系 | 受控身份验证和台账归属 | 受控执行 | OPEN-REG-003 |
| 交互、视觉与无障碍 | 适用：注册原型 | 表单规则提示、协议和提交入口 | 已覆盖；视觉/无障碍专项不在范围 | OPEN-REG-016、OPEN-REG-017、OPEN-REG-018 |
| 安全与隐私 | 不单列业务断言：验证码、营业执照与认证会话形成执行门禁 | 脱敏、安全挑战最小人工接管；正式路径上传一次合成执照 | 不适用专项 | 无 |
| 状态与生命周期 | 适用：控制台统一登录默认落点 | 受控认证状态迁移 | 受控执行 | OPEN-REG-007 |
| 接口、集成与契约 | 适用：企业 A/B 的同账号手机号关联 | 所属企业状态与台账一致性 | 受控执行 | OPEN-REG-006 |

## 需求追溯矩阵

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-REG-001 | AIoT平台项目.docx / 官网改造注册；用户裁决（2026-07-24） | P0 | 注册字段的已定义必填、长度、内容、手机号格式、选填、关键控件可见性及企业邮箱明确接受/拒绝样例 | 适用 | 无写入校验 | OPEN-REG-001、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015、OPEN-REG-016、OPEN-REG-017、OPEN-REG-018、OPEN-REG-019、OPEN-REG-020、OPEN-REG-021、OPEN-REG-022、OPEN-REG-023、OPEN-REG-024、OPEN-REG-025、OPEN-REG-026、OPEN-REG-027、OPEN-REG-028、OPEN-REG-029 | 已覆盖 | 邮箱错误提示全文、信用代码格式、部分提示全文与营业执照文件属性未定义；未列邮箱语法边界不生成断言 |
| REQ-REG-002 | AIoT平台项目.docx / 官网改造注册 | P1 | 三类唯一性提示及同手机号可注册多个企业 | 适用 | 受控提交 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 受控执行 | 验证码、认证、写入、清理台账 |
| REQ-REG-003 | AIoT平台项目.docx / AIoT控制台 | P0 | 注册企业账号默认为管理员 | 适用 | 受控身份验证 | OPEN-REG-003 | 受控执行 | 成功注册状态、认证、写入与清理授权 |
| REQ-REG-004 | AIoT平台项目.docx / AIoT控制台 | P0 | 控制台入口进入账号统一登录，验证后默认进入 AIoT 控制台 | 适用 | 受控认证与落点观察 | OPEN-REG-007 | 受控执行 | 认证会话与安全挑战人工接管；不推断登录细节 |

## 规则覆盖台账

> 结构版本：rule-coverage-v1

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业名称空值 | 显示“请输入集团名称” | 等价类 | 适用 | 已覆盖 | OPEN-REG-001 | 不发送验证码、上传或提交 |
| RULE-REG-002 | REQ-REG-002 | 官网改造 / 注册 | 分支/决策 | 重复企业名称 | 显示“该企业名称已存在，请确认是否已注册或更换其他名称” | 决策表 | 受控执行 | 受控执行 | OPEN-REG-002 | 提交路径需验证码、认证、写入授权及台账 |
| RULE-REG-003 | REQ-REG-003 | AIoT控制台 | 权限/身份 | 注册账号进入所属企业 | 显示管理员 | 状态迁移 | 受控执行 | 受控执行 | OPEN-REG-003 | 成功注册、认证、写入授权及台账 |
| RULE-REG-004 | REQ-REG-002 | 官网改造 / 注册 | 分支/决策 | 重复企业标识 | 显示“该企业标识已存在，请更改为其他标识” | 决策表 | 受控执行 | 受控执行 | OPEN-REG-004 | 提交路径需验证码、认证、写入授权及台账 |
| RULE-REG-005 | REQ-REG-002 | 官网改造 / 注册 | 分支/决策 | 重复统一社会信用代码 | 显示“该统一社会信用代码已注册，请确认是否已提交过申请” | 决策表 | 受控执行 | 受控执行 | OPEN-REG-005 | 提交路径需验证码、认证、写入授权及台账 |
| RULE-REG-006 | REQ-REG-002 | 官网改造 / 注册 | 分支/决策 | 同手机号提交另一唯一企业 | 允许同一手机号关联两家不同且唯一企业 | 决策表 | 受控执行 | 受控执行 | OPEN-REG-006 | 提交路径需验证码、认证、写入授权、两项台账资源及处理动作 |
| RULE-REG-007 | REQ-REG-004 | AIoT控制台 | 状态流转 | 点击控制台入口并完成已授权统一登录验证 | 默认进入 AIoT 控制台；不推断认证字段、验证码或失败恢复 | 状态迁移 | 受控执行 | 受控执行 | OPEN-REG-007 | 认证会话与安全挑战人工接管；无写入 |
| RULE-REG-008 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业地址空值 | 显示“请输入企业地址” | 等价类 | 适用 | 已覆盖 | OPEN-REG-008 | 不发送验证码、上传或提交 |
| RULE-REG-009 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业标识空值 | 注册流程被非空规则阻断；常驻帮助文本可见但不作为错误提示 | 等价类 | 适用 | 已覆盖 | OPEN-REG-009 | 未定义错误提示全文；不发送验证码、上传或提交 |
| RULE-REG-010 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 申请人空值 | 显示“请输入联系人名称” | 等价类 | 适用 | 已覆盖 | OPEN-REG-010 | 不发送验证码、上传或提交 |
| RULE-REG-011 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 手机号空值 | 注册流程被手机号非空规则阻断；未定义提示全文不作断言 | 等价类 | 适用 | 已覆盖 | OPEN-REG-011 | 不获取验证码或提交 |
| RULE-REG-012 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业简介空值 | 不显示必填校验 | 等价类 | 适用 | 已覆盖 | OPEN-REG-012 | 选填；不发送验证码、上传或提交 |
| RULE-REG-013 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业邮箱空值 | 不显示必填校验 | 等价类 | 适用 | 已覆盖 | OPEN-REG-013 | 选填；具体格式口径见 RULE-REG-029 |
| RULE-REG-014 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 统一社会信用代码空值并触发表单校验 | 注册流程被必填规则阻断；不假设失焦或提示全文 | 等价类 | 适用 | 已覆盖 | OPEN-REG-014 | 不发送验证码、上传或提交有效完整资料 |
| RULE-REG-015 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 未选择营业执照并触发表单校验 | 注册流程被必填规则阻断；不假设失焦、提示全文或文件属性 | 等价类 | 适用 | 已覆盖 | OPEN-REG-015 | 不实际上传、不发送验证码或提交有效完整资料 |
| RULE-REG-016 | REQ-REG-002 | 官网改造 / 注册与所属企业 | 集成与数据一致性 | 企业 A 精确对账后创建企业 B，并进入所属企业视图 | 台账中的 A/B 与同一账号手机号关联且均可见；无清理能力时保留为限额、带 TTL 的受控残留 | 状态迁移与数据一致性 | 受控执行 | 受控执行 | OPEN-REG-006 | 固定联合执行顺序、统一执行清单、企业预算 2 与 TTL 72 小时 |
| RULE-REG-017 | REQ-REG-001 | 官网改造 / 注册表单图 | 页面交互 | 打开注册页 | 验证码输入控件与获取验证码入口可见 | 页面结构观察 | 受控执行 | 已覆盖 | OPEN-REG-016 | 仅无写入观察；不输入真实手机号、不获取或发送验证码 |
| RULE-REG-018 | REQ-REG-001 | 官网改造 / 注册表单图 | 页面交互 | 打开注册页 | 用户协议确认控件可见 | 页面结构观察 | 受控执行 | 已覆盖 | OPEN-REG-017 | 仅无写入观察；协议内容与勾选效果未定义，不生成断言 |
| RULE-REG-019 | REQ-REG-001 | 官网改造 / 注册表单图 | 页面交互 | 打开注册页 | “同意条款并注册”入口可见 | 页面结构观察 | 受控执行 | 已覆盖 | OPEN-REG-018 | 仅无写入观察；不点击提交，不断言成功页或审核状态 |
| RULE-REG-020 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业名称 1/2/50/51 字符 | 2 和 50 字符符合长度规则；1 和 51 字符触发校验 | 边界值 | 适用 | 已覆盖 | OPEN-REG-019 | 未定义长度提示全文 |
| RULE-REG-021 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业名称中文、英文、数字组合及特殊符号/表情 | 仅资料定义的中文、英文、数字组合符合内容规则 | 等价类 | 适用 | 已覆盖 | OPEN-REG-020 | 未定义内容提示全文 |
| RULE-REG-022 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业地址 50/51 字符 | 50 字符符合规则；51 字符触发长度校验 | 边界值 | 适用 | 已覆盖 | OPEN-REG-021 | 未定义长度提示全文 |
| RULE-REG-023 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业标识 2/3/6/7 位小写字母或数字 | 3 和 6 位符合规则；2 和 7 位触发长度校验 | 边界值 | 适用 | 已覆盖 | OPEN-REG-022 | 未定义长度错误提示全文 |
| RULE-REG-024 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业标识小写字母/数字组合及大写字母/符号 | 仅小写字母或数字符合内容规则；常驻帮助文本可见 | 等价类 | 适用 | 已覆盖 | OPEN-REG-023 | 未定义内容错误提示全文 |
| RULE-REG-025 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 申请人 20/21 字符 | 20 字符符合规则；21 字符触发长度校验 | 边界值 | 适用 | 已覆盖 | OPEN-REG-024 | 未定义长度错误提示全文 |
| RULE-REG-026 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 申请人中文与英文名称 | 中文与英文均符合资料定义内容规则 | 等价类 | 适用 | 已覆盖 | OPEN-REG-025 | 不推断其他字符集合 |
| RULE-REG-027 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 手机号 10/11/12 位与非数字合成输入 | 仅资料定义的 11 位数字形态符合规则 | 等价类与边界 | 适用 | 已覆盖 | OPEN-REG-026 | 不获取验证码；未定义格式提示全文 |
| RULE-REG-028 | REQ-REG-001 | 官网改造 / 注册 | 输入边界 | 企业简介 300/301 字符 | 300 字符符合规则；301 字符触发长度校验 | 边界值 | 适用 | 已覆盖 | OPEN-REG-027 | 未定义长度错误提示全文 |
| RULE-REG-029 | REQ-REG-001 | 用户裁决（2026-07-24）/ 企业邮箱 | 输入边界 | 本次验收仅采用常用企业邮箱接受/拒绝样例：接受 `contact+sales@example.com`；拒绝 `contact.example.com`、`contact@`、`contact@@example.com` | 输入后移出邮箱字段焦点；接受样例的该字段无格式错误，拒绝样例的该字段被格式校验阻断；不断言提示全文 | 等价类 | 适用 | 已覆盖 | OPEN-REG-028、OPEN-REG-029 | 用户明确“按照常用企业格式邮箱进行”；未列语法边界不生成断言；无写入、不发送验证码、不上传、不提交 |

## 规则设计矩阵

> 结构版本：rule-design-matrix-v1

| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-REG-001 | 企业名称必填 | 必填 | 空值 | 显示“请输入集团名称” | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-001 | 已覆盖 |
| RULE-REG-002 | 企业名称唯一性提交路径 | 不适用 | 已存在企业名称，其他已定义必填字段有效 | 显示资料定义的重复名称提示全文 | 受控重复名称与清理台账 | 验证码、认证、写入授权 | OPEN-REG-002 | 受控执行 |
| RULE-REG-003 | 注册后账号身份 | 不适用 | 使用 OPEN-REG-003 创建企业 A，并经确定性入口进入所属企业视图 | 显示管理员；成功页和审核流未定义，不生成断言 | A 在远端提交前登记 CreateIntent，管理页精确确认后记为 retained | 统一执行清单；认证安全挑战最小人工接管 | OPEN-REG-003 | 受控执行 |
| RULE-REG-004 | 企业标识唯一性提交路径 | 不适用 | 已存在企业标识，其他已定义必填字段有效 | 显示资料定义的重复标识提示全文 | 受控重复标识与清理台账 | 验证码、认证、写入授权 | OPEN-REG-004 | 受控执行 |
| RULE-REG-005 | 信用代码唯一性提交路径 | 不适用 | 已存在信用代码，其他已定义必填字段有效 | 显示资料定义的重复信用代码提示全文；格式未定义，不生成断言 | 受控重复信用代码与清理台账 | 验证码、认证、写入授权 | OPEN-REG-005 | 受控执行 |
| RULE-REG-006 | 同手机号业务决策 | 不适用 | 执行前仅企业 A；使用共享合成账号与手机号提交唯一企业 B | 允许同一手机号关联企业 A/B | A/B CreateIntent、企业预算 2 和 TTL 72 小时 | 统一执行清单；安全挑战最小人工接管 | OPEN-REG-006 | 受控执行 |
| RULE-REG-007 | 控制台统一登录落点 | 不适用 | 控制台入口、已授权统一登录会话 | 验证后默认进入 AIoT 控制台；认证详情和安全挑战恢复未定义，不生成断言 | 已授权合成账号与认证会话 | 安全挑战人工接管；不写入 | OPEN-REG-007 | 受控执行 |
| RULE-REG-008 | 企业地址必填 | 必填 | 空值 | 显示“请输入企业地址” | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-008 | 已覆盖 |
| RULE-REG-009 | 企业标识必填 | 必填 | 空值 | 注册流程被非空规则阻断；常驻文本不作为错误提示 | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-009 | 已覆盖 |
| RULE-REG-010 | 申请人必填 | 必填 | 空值 | 显示“请输入联系人名称” | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-010 | 已覆盖 |
| RULE-REG-011 | 手机号必填 | 必填 | 空值 | 注册流程被非空规则阻断；提示全文未定义 | 无写入表单与合成输入 | 不获取验证码、不提交 | OPEN-REG-011 | 已覆盖 |
| RULE-REG-012 | 企业简介选填 | 选填 | 空值 | 不显示必填校验 | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-012 | 已覆盖 |
| RULE-REG-013 | 企业邮箱选填 | 选填 | 空值 | 不显示必填校验 | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-013 | 已覆盖 |
| RULE-REG-014 | 统一社会信用代码必填 | 必填 | 空值并触发表单校验 | 注册流程被必填规则阻断；不假设失焦或提示全文 | 无写入表单与其他合成输入 | 不发送验证码、不上传、不提交有效完整资料 | OPEN-REG-014 | 已覆盖 |
| RULE-REG-015 | 营业执照必填 | 必填 | 未选择文件并触发表单校验 | 注册流程被必填规则阻断；不假设失焦、提示全文或文件属性 | 无写入表单 | 不实际上传、不发送验证码或提交有效完整资料 | OPEN-REG-015 | 已覆盖 |
| RULE-REG-016 | 同手机号 A/B 数据一致性 | 不适用 | A validator 通过后创建 B 并进入所属企业视图 | A/B 同账号手机号关联且均可见；按 B→A 处理并记录后置 validator | 与 OPEN-REG-003 共享 A、合成账号和 `.auth/` 脱敏会话 | 固定联合顺序；重跑异常先恢复；写入和处理授权 | OPEN-REG-006 | 受控执行 |
| RULE-REG-017 | 验证码区域 | 不适用 | 打开注册页 | 验证码输入控件与获取入口可见 | 注册页面 | 不输入真实手机号、不获取或发送验证码 | OPEN-REG-016 | 已覆盖 |
| RULE-REG-018 | 用户协议区域 | 不适用 | 打开注册页 | 用户协议确认控件可见 | 注册页面 | 不断言协议内容或勾选效果 | OPEN-REG-017 | 已覆盖 |
| RULE-REG-019 | 注册提交入口 | 不适用 | 打开注册页 | “同意条款并注册”入口可见 | 注册页面 | 不点击提交，不断言成功页或审核 | OPEN-REG-018 | 已覆盖 |
| RULE-REG-020 | 企业名称长度 | 必填 | 1/2/50/51 字符 | 2 和 50 符合；1 和 51 触发校验 | 无写入表单与合成输入 | 不提交 | OPEN-REG-019 | 已覆盖 |
| RULE-REG-021 | 企业名称内容 | 必填 | 中文、英文、数字组合与特殊符号/表情 | 仅资料定义字符组合符合规则 | 无写入表单与合成输入 | 不提交 | OPEN-REG-020 | 已覆盖 |
| RULE-REG-022 | 企业地址长度 | 必填 | 50/51 字符 | 50 符合；51 触发校验 | 无写入表单与合成输入 | 不提交 | OPEN-REG-021 | 已覆盖 |
| RULE-REG-023 | 企业标识长度 | 必填 | 2/3/6/7 位 | 3 和 6 符合；2 和 7 触发校验 | 无写入表单与合成输入 | 不提交 | OPEN-REG-022 | 已覆盖 |
| RULE-REG-024 | 企业标识内容 | 必填 | 小写字母/数字与大写字母/符号 | 仅小写字母或数字符合规则 | 无写入表单与合成输入 | 不提交 | OPEN-REG-023 | 已覆盖 |
| RULE-REG-025 | 申请人长度 | 必填 | 20/21 字符 | 20 符合；21 触发校验 | 无写入表单与合成输入 | 不提交 | OPEN-REG-024 | 已覆盖 |
| RULE-REG-026 | 申请人内容 | 必填 | 中文与英文名称 | 中文和英文均符合资料规则 | 无写入表单与合成输入 | 不提交 | OPEN-REG-025 | 已覆盖 |
| RULE-REG-027 | 手机号格式 | 必填 | 10/11/12 位与非数字 | 仅 11 位数字形态符合资料规则 | 无写入表单与合成输入 | 不获取验证码、不提交 | OPEN-REG-026 | 已覆盖 |
| RULE-REG-028 | 企业简介长度 | 选填 | 300/301 字符 | 300 符合；301 触发校验 | 无写入表单与合成输入 | 不提交 | OPEN-REG-027 | 已覆盖 |
| RULE-REG-029 | 企业邮箱格式 | 选填 | 接受：`contact+sales@example.com`；拒绝：`contact.example.com`、`contact@`、`contact@@example.com` | 输入后移出邮箱字段焦点；接受样例的该字段无格式错误，拒绝样例的该字段被格式校验阻断；不断言提示全文 | 无写入表单与合成输入 | 不发送验证码、不上传、不提交 | OPEN-REG-028、OPEN-REG-029 | 已覆盖 |

## 规则邻域复核

| 触发发现项 | 邻域 RULE | 共同依据 | 修订 caseId | 关系同步与规则设计预检结果 |
| --- | --- | --- | --- | --- |
| MRR-THIRD-DES-001、MRR-THIRD-REQ-002、MRR-THIRD-REQ-004、MRR-THIRD-DES-003、MRR-FOURTH-REQ-001、MRR-FOURTH-DES-001、MRR-FOURTH-DES-002 | RULE-REG-001、RULE-REG-008～RULE-REG-015、RULE-REG-020～RULE-REG-029 | REQ-REG-001 的字段规则与用户已裁决的邮箱样例 | OPEN-REG-001、OPEN-REG-008～OPEN-REG-029 | 已完成关系同步、规则设计预检与 Markdown 校验；REV-05 正在收敛 |
| MRR-THIRD-REQ-003 | RULE-REG-017、RULE-REG-018、RULE-REG-019 | REQ-REG-001 的注册表单关键控件可见性 | OPEN-REG-016、OPEN-REG-017、OPEN-REG-018 | 已完成关系同步、规则设计预检、Markdown 与架构检查 |
| MRR-THIRD-DES-002、MRR-THIRD-CHG-001、MRR-THIRD-CHG-002 | RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-016 | REQ-REG-002/003 的企业 A 统一复用、固定联合顺序、A/B 数据一致性和恢复 | OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006 | 已完成关系同步、规则设计预检、Markdown 与架构检查 |
| MRR-THIRD-REQ-001、MRR-THIRD-TRA-001、MRR-THIRD-TRA-002、MRR-THIRD-TRA-003、MRR-THIRD-TRA-004、MRR-THIRD-CHG-003、MRR-FIFTH-REQ-001、MRR-FIFTH-TRA-001 | RULE-REG-001～RULE-REG-029 | 全部派生投影、批次结构、静态证据和受控来源版本 | OPEN-REG-001～OPEN-REG-029 | 已完成关系同步、规则设计预检、Markdown 校验与架构检查；REV-05 全角色结论已收齐 |

## 用例包目录

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 生成状态 | 特殊门禁 |
| --- | --- | --- | --- | --- | --- |
| cases-registration.md | 企业注册与控制台统一登录落点 | 按字段原子拆分、三类唯一性、同手机号、管理员与控制台落点 | OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007、OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015、OPEN-REG-016、OPEN-REG-017、OPEN-REG-018、OPEN-REG-019、OPEN-REG-020、OPEN-REG-021、OPEN-REG-022、OPEN-REG-023、OPEN-REG-024、OPEN-REG-025、OPEN-REG-026、OPEN-REG-027、OPEN-REG-028、OPEN-REG-029 | 草案完整 | 验证码、上传、认证、写入与清理动作 |

## 变更影响分析

| 变更编号 | 来源与版本 | 受影响需求追溯编号 | 影响判定与依据 | 受影响 caseId | 脚本/工程设计影响 | 数据/环境影响 | 是否复测与结论 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CHG-OPEN-REG-001 | aiot-platform-project-document / platform-home-and-registration / SHA-256 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b；用户裁决（2026-07-24，常用企业邮箱格式）；open-platform-axure-prototype / prototype-account-registration / SHA-256 d4e823a2b1c2c81d899ce3f1d00baee640257f9fc6c0cdc77d0e0493506a13cd（仅交互候选） | REQ-REG-001 | 字段规则与注册表单关键控件影响无写入校验；邮箱格式业务口径由用户裁决 | OPEN-REG-001、OPEN-REG-008～OPEN-REG-029 | 为 RULE-REG-001、RULE-REG-008～RULE-REG-029 设计按失败原因的字段观察与关键控件可见性；邮箱格式有效/无效分离 | 无写入合成输入；不发送验证码、不上传、不提交 | 用例确认后复测已定义字段和三个关键控件 caseId | 已通过 REV-20260723-FRESH-05 最终复审 |
| CHG-OPEN-REG-005 | 用户裁决（2026-07-24，常用企业邮箱格式） | REQ-REG-001 | 邮箱裁决仅影响选填空值、接受样例和拒绝样例的字段级格式观察 | OPEN-REG-013、OPEN-REG-028、OPEN-REG-029 | RULE-REG-029 固定接受/拒绝样例；OPEN-REG-013 回归选填空值，OPEN-REG-028、OPEN-REG-029 在移出字段焦点后观察字段级格式状态 | 无写入；零验证码、零上传、零提交 | REV-20260723-FRESH-05 已复审 OPEN-REG-028、OPEN-REG-029，并回归 OPEN-REG-013 | 已通过最终复审 |
| CHG-OPEN-REG-002 | aiot-platform-project-document / platform-home-and-registration / SHA-256 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | REQ-REG-002 | 三类唯一性统一复用本次精确对账的企业 A，避免超过两项企业预算 | OPEN-REG-002、OPEN-REG-004、OPEN-REG-005 | RULE-REG-002、RULE-REG-004、RULE-REG-005 固定顺序复用 A；负向意图使用 expectedOutcome=reject，结果未知时冻结相关写入 | 企业 A CreateIntent、测试验证码、统一执行清单 | 按企业 A→002→004→005 复测 | 已映射完整正式脚本 |
| CHG-OPEN-REG-003 | aiot-platform-project-document / platform-home-and-registration / SHA-256 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | REQ-REG-002、REQ-REG-003 | 同手机号企业 A/B 与管理员共享账号、认证会话、所属企业观察和统一生命周期 | OPEN-REG-003、OPEN-REG-006 | RULE-REG-003、RULE-REG-006、RULE-REG-016 映射 A/B 的 CreateIntent、精确管理页对账、固定 003→006 顺序和 72 小时残留 | test 台账、测试验证码、认证挑战、企业预算 2 | 联合复测 OPEN-REG-003、OPEN-REG-006 | 已映射完整正式脚本 |
| CHG-OPEN-REG-004 | aiot-platform-project-document / platform-home-and-registration / SHA-256 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | REQ-REG-004 | 统一登录入口影响认证和默认落点观察 | OPEN-REG-007 | RULE-REG-007 映射脱敏认证会话、统一登录入口和 AIoT 默认落点观察项 | 安全挑战人工接管；无写入 | 用例确认并获认证授权后复测 OPEN-REG-007 | 已同步并通过预检 |

## 合理推断

- 原型仅用于字段呈现与交互入口候选；业务断言仅来自需求文档。
- 用户未指定环境，依当前偏好将 test 作为候选环境；该选择不授权认证、验证码、上传或写入。

## 待补充信息

- 验证码发送、时效、失败恢复；注册审核和成功页面；信用代码格式与营业执照文件属性。

## 风险与审核事项

- 唯一性、同手机号和管理员规则需要提交注册并产生业务数据；正式执行由一份不可变清单统一确认写入、测试验证码、认证会话、资源预算和残留策略，清单内普通动作不再逐项确认。

## 用例集评审与演进

| 字段 | 内容 |
| --- | --- |
| 当前结论 | REV-20260723-FRESH-05 已完成并收敛，29 条注册用例可提交用户确认 |
| 下一动作 | 浏览器进程复用与超时原子回收脚本评审已通过；等待一次新的不可变执行清单确认 |

## 多角色评审记录

> 结构版本：multi-role-review-v1。

> 结构版本：evidence-driven-evolution-v1。

> 结构版本：reviewer-execution-v1。

> 结构版本：auto-evolution-loop-v1。

> 结构版本：knowledge-decision-v1。

| 评审批次 | 状态 | 说明 |
| --- | --- | --- |
| 无 | 未开始 | 待用例草案、关系同步和严格规则设计预检通过后登记。 |

<!-- review-batch:REV-20260723-FRESH-01:start -->
### 评审批次：REV-20260723-FRESH-01

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 初审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 0 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/fresh_req_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-REQ-001、MRR-REQ-002、MRR-REQ-003 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/fresh_design_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-DES-001、MRR-DES-002、MRR-DES-003 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/fresh_trace_review | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-TRA-001、MRR-TRA-002 | 已关闭 |
| 变更影响评审 | 真实子智能体 | /root/fresh_impact_review | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-CHG-001、MRR-CHG-002 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-REQ-001 | 需求一致性评审 | 原始需求将企业标识的‘请输入3-6 位小写字母或数字，用作产品Model的组成部分’定义为常驻提示；RULE-REG-001与OPEN-REG-001仅覆盖长度和内容校验，未断言该常驻提示可见。 | 需求覆盖缺口 | REQ-REG-001,RULE-REG-001,OPEN-REG-001 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001。 | 已关闭 |
| MRR-REQ-002 | 需求一致性评审 | 原始需求明确空值提示全文：企业名称‘请输入集团名称’、企业地址‘请输入企业地址’、申请人‘请输入联系人名称’；RULE-REG-001和OPEN-REG-001未将三个已定义文本作为可执行观察点。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-001,OPEN-REG-001 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001。 | 已关闭 |
| MRR-REQ-003 | 需求一致性评审 | 原始需求在AIoT控制台明确点击后进入账号统一登录，验证后默认进入AIoT控制台；当前计划未给出该控制台入口与验证后默认落点的不适用依据。 | 需求覆盖缺口 | 新增REQ,新增RULE,新增caseId | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-007。 | 已关闭 |

| MRR-DES-001 | 测试设计评审 | 需求将企业名称、地址、企业标识、营业执照、申请人、手机号、简介、邮箱定义为不同的必填、长度、内容或格式规则；当前将不同失败原因合并为一个可报告单元。 | 资料明确的设计缺口 | RULE-REG-001,OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001。 | 已关闭 |
| MRR-DES-002 | 测试设计评审 | 资料明确一个手机号可以注册多个企业；当前预期仅为不因手机号已有企业被拒绝，缺少独立可观察后置状态。 | 资料明确的设计缺口 | RULE-REG-006,OPEN-REG-006 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-006。 | 已关闭 |
| MRR-DES-003 | 测试设计评审 | 多个用例需要基准企业，且同手机号多企业需要第二家企业；计划受控残留最大数量为1，且用例未引用可检查的数据准备、台账归属或已注册 cleanupActionId。 | 资料明确的设计缺口 | RULE-REG-002,RULE-REG-004,RULE-REG-005,RULE-REG-006,OPEN-REG-002,OPEN-REG-004,OPEN-REG-005,OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-002、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006。 | 已关闭 |

| MRR-TRA-001 | 追溯审计 | 需求追溯台账已将主要 REQ→RULE→caseId 关联正确；但覆盖矩阵未投影字段规则、默认管理员和同手机号多企业事实，且数据完整性与一致性投影为无。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-001,OPEN-REG-001,REQ-REG-003,RULE-REG-003,OPEN-REG-003,REQ-REG-002,RULE-REG-006,OPEN-REG-006 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001、OPEN-REG-003、OPEN-REG-006。 | 已关闭 |
| MRR-TRA-002 | 追溯审计 | 用例包已生成草案且 RULE 台账已关联 caseId，但用例包目录仍标记待生成，规则邻域复核仍为待阶段二分配或待生成后执行。 | 资料明确的设计缺口 | RULE-REG-001,RULE-REG-002,RULE-REG-003,RULE-REG-004,RULE-REG-005,RULE-REG-006,OPEN-REG-001,OPEN-REG-002,OPEN-REG-003,OPEN-REG-004,OPEN-REG-005,OPEN-REG-006 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-001、OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006。 | 已关闭 |

| MRR-CHG-001 | 变更影响评审 | 计划变更影响分析将本请求记录为无影响，但新增注册覆盖已引入三类唯一性、同手机号多企业与默认管理员；当前未形成来源→REQ→caseId→工程设计/下游模块→复测范围映射。 | 资料明确的设计缺口 | REQ-REG-002,REQ-REG-003,OPEN-REG-002～OPEN-REG-006,认证会话,所属企业,企业成员权限观察路径 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006、OPEN-REG-007。 | 已关闭 |
| MRR-CHG-002 | 变更影响评审 | 受控残留最大数量为1，但同手机号多企业路径需要同一手机号关联两家不同企业；未指定可复用资源的台账归属、validator 或创建数量，且未见已注册真实 cleanupActionId。 | 资料明确的设计缺口 | OPEN-REG-002,OPEN-REG-003,OPEN-REG-004,OPEN-REG-005,OPEN-REG-006,测试数据台账,注册提交,管理员验证路径 | 高 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-002、OPEN-REG-003、OPEN-REG-004、OPEN-REG-005、OPEN-REG-006。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-REQ-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-REQ-002 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-REQ-003 | 需求事实 | 新增 REQ/RULE/caseId | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-DES-002 | 需求事实 | REQ-REG-002 → RULE-REG-006 → OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-DES-003 | 需求事实 | REQ-REG-002 → RULE-REG-002 → OPEN-REG-002 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-TRA-001 | 需求事实 | REQ-REG-003 → RULE-REG-003 → OPEN-REG-003 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-TRA-002 | 需求事实 | REQ-REG-002 → RULE-REG-004 → OPEN-REG-004 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-CHG-001 | 需求事实 | REQ-REG-004 → RULE-REG-007 → OPEN-REG-007 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-CHG-002 | 需求事实 | REQ-REG-002 → RULE-REG-005 → OPEN-REG-005 | 资料已确认 | 已回链，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-FRESH-01:end -->

<!-- review-batch:REV-20260723-FRESH-02:start -->
### 评审批次：REV-20260723-FRESH-02

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 1 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/final_req_review | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FINAL-REQ-001、MRR-FINAL-REQ-002 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/final_design_review | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FINAL-DES-001、MRR-FINAL-DES-002 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/final_trace_review | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FINAL-TRA-001、MRR-FINAL-TRA-002、MRR-FINAL-TRA-003 | 已关闭 |
| 变更影响评审 | 真实子智能体 | /root/final_impact_review | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FINAL-CHG-001、MRR-FINAL-CHG-002、MRR-FINAL-CHG-003 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-FINAL-REQ-001 | 需求一致性评审 | OPEN-REG-001仍合并多个字段和失败原因，不能独立报告。 | 资料明确的设计缺口 | RULE-REG-001,OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；保留 OPEN-REG-001 为企业名称并新增 OPEN-REG-008、OPEN-REG-009、OPEN-REG-010、OPEN-REG-011、OPEN-REG-012、OPEN-REG-013、OPEN-REG-014、OPEN-REG-015，逐字段关联 RULE-REG-008～RULE-REG-015。 | 已关闭 |
| MRR-FINAL-REQ-002 | 需求一致性评审 | 覆盖矩阵仍遗漏同手机号关系及部分适用域的 caseId 投影。 | 资料明确的设计缺口 | RULE-REG-006,OPEN-REG-006 | 中 | 自动演进 | 资料证据已回链；已由 RULE 台账同步 OPEN-REG-001～OPEN-REG-015 至覆盖基准、拆分清单、覆盖矩阵和需求追溯矩阵，OPEN-REG-006 已投影到数据一致性与身份域。 | 已关闭 |

| MRR-FINAL-DES-001 | 测试设计评审 | OPEN-REG-001合并多个字段与失败原因，未形成可独立诊断的原子结果。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-001,OPEN-REG-001 | 高 | 自动演进 | 资料证据已回链；OPEN-REG-001、OPEN-REG-008～OPEN-REG-015 已按字段形成独立步骤、预期、RULE 和报告单元。 | 已关闭 |
| MRR-FINAL-DES-002 | 测试设计评审 | 同手机号两企业用例的数据基线、台账身份和清理顺序不明确。 | 资料明确的设计缺口 | REQ-REG-002,RULE-REG-006,OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；OPEN-REG-006 已定义执行前仅企业 A、提交企业 B、A/B 完整台账身份与 validator、所属企业观察和 B→A 处理；无 cleanupActionId 时禁止无人值守写入。 | 已关闭 |

| MRR-FINAL-TRA-001 | 追溯审计 | 覆盖基准、拆分清单和覆盖矩阵与 RULE 台账的完整关系投影不一致。 | 资料明确的设计缺口 | REQ-REG-001～REQ-REG-004,RULE-REG-001～RULE-REG-007,OPEN-REG-001～OPEN-REG-007 | 中 | 自动演进 | 资料证据已回链；已以 RULE-REG-001～RULE-REG-015 为关系源同步 OPEN-REG-001～OPEN-REG-015 的全部派生投影。 | 已关闭 |
| MRR-FINAL-TRA-002 | 追溯审计 | OPEN-REG-001～006未回填首轮评审与演进闭环。 | 资料明确的设计缺口 | OPEN-REG-001～OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；OPEN-REG-001～OPEN-REG-007 已逐用例回填 REV-20260723-FRESH-01/02、关联 MRR、修订证据和关闭状态。 | 已关闭 |
| MRR-FINAL-TRA-003 | 追溯审计 | 规则邻域复核仍写待同步和预检，与首轮关闭状态不一致。 | 资料明确的设计缺口 | RULE-REG-002～RULE-REG-007,OPEN-REG-002～OPEN-REG-007 | 高 | 自动演进 | 资料证据已回链；RULE-REG-001～RULE-REG-015 对应 OPEN-REG-001～OPEN-REG-015 已完成关系同步、规则设计预检、Markdown 和架构检查。 | 已关闭 |

| MRR-FINAL-CHG-001 | 变更影响评审 | OPEN-REG-006未定义企业A/B分别关联的caseId、runId、owner、状态及清理顺序和验证。 | 资料明确的设计缺口 | REQ-REG-002,RULE-REG-006,OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；OPEN-REG-006 已逐项定义 A/B 的 owner、machineId、projectId、envId、runId、caseId、status、validator 和 cleanupActionId/人工处理状态，并按 B→A 验证。 | 已关闭 |
| MRR-FINAL-CHG-002 | 变更影响评审 | OPEN-REG-006缺少合成账号认证会话来源、进入所属企业路径及安全挑战恢复，与OPEN-REG-003没有显式共享前置。 | 资料明确的设计缺口 | REQ-REG-002,REQ-REG-003,RULE-REG-003,RULE-REG-006,OPEN-REG-003,OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；OPEN-REG-003 与 OPEN-REG-006 已显式共享合成账号和 `.auth/` 脱敏会话，经确定性入口进入所属企业；安全挑战人工接管后自动恢复唯一下一步骤。 | 已关闭 |
| MRR-FINAL-CHG-003 | 变更影响评审 | 变更映射未闭合到逐项工程设计、关系同步/预检证据及明确复测对象。 | 资料明确的设计缺口 | CHG-OPEN-REG-001,REQ-REG-002～REQ-REG-004,RULE-REG-002～RULE-REG-007,OPEN-REG-002～OPEN-REG-007 | 中 | 自动演进 | 资料证据已回链；CHG-OPEN-REG-001～004 已闭合来源→REQ→RULE→OPEN-REG-001～OPEN-REG-015→数据/认证/观察工程项→复测对象，并记录关系同步和预检通过。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-FINAL-REQ-001 | 需求事实 | REQ-REG-001 → RULE-REG-001 → OPEN-REG-001 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-REQ-002 | 需求事实 | REQ-REG-002 → RULE-REG-006 → OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-008 → OPEN-REG-008 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-DES-002 | 需求事实 | REQ-REG-002 → RULE-REG-006 → OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-TRA-001 | 需求事实 | REQ-REG-001～REQ-REG-004 → RULE-REG-001～RULE-REG-029 → OPEN-REG-001～OPEN-REG-027 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-TRA-002 | 需求事实 | REQ-REG-002 → RULE-REG-002 → OPEN-REG-002 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-TRA-003 | 需求事实 | REQ-REG-001～REQ-REG-004 → RULE-REG-001～RULE-REG-029 → OPEN-REG-001～OPEN-REG-027 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-CHG-001 | 需求事实 | REQ-REG-002 → RULE-REG-006 → OPEN-REG-006 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-CHG-002 | 需求事实 | REQ-REG-003 → RULE-REG-003 → OPEN-REG-003 | 资料已确认 | 已回链，不沉淀为项目经验 |
| MRR-FINAL-CHG-003 | 需求事实 | REQ-REG-004 → RULE-REG-007 → OPEN-REG-007 | 资料已确认 | 已回链，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-FRESH-02:end -->

<!-- review-batch:REV-20260723-FRESH-03:start -->
### 评审批次：REV-20260723-FRESH-03

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 2 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 待用户确认 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/rev03_req | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-THIRD-REQ-001、MRR-THIRD-REQ-002、MRR-THIRD-REQ-003、MRR-THIRD-REQ-004 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/rev03_design | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 阻塞 | MRR-THIRD-DES-001、MRR-THIRD-DES-002、MRR-THIRD-DES-003 | 待用户裁决 |
| 追溯审计 | 真实子智能体 | /root/rev03_trace | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-THIRD-TRA-001、MRR-THIRD-TRA-002、MRR-THIRD-TRA-003、MRR-THIRD-TRA-004 | 已关闭 |
| 变更影响评审 | 真实子智能体 | /root/rev03_impact | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-THIRD-CHG-001、MRR-THIRD-CHG-002、MRR-THIRD-CHG-003 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-THIRD-DES-001 | 测试设计评审 | 规范要求不同失败原因或预期结果拆为独立 caseId；OPEN-REG-001 仍把必填、长度、内容合在一个报告单元，OPEN-REG-008～013 也分别合并必填或选填与长度、内容或格式，其中 OPEN-REG-009 只观察常驻提示，未独立验证非空校验。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-001,RULE-REG-008～RULE-REG-013,OPEN-REG-001,OPEN-REG-008～OPEN-REG-013 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：按必填或选填、长度边界、内容或格式等不同失败原因拆分稳定 caseId；为企业标识补独立空值校验并同步关系。 | 已关闭 |
| MRR-THIRD-DES-002 | 测试设计评审 | OPEN-REG-003 与 OPEN-REG-006 共享企业 A，但未规定 A 的准备者、两个 case 的执行顺序和共享资源释放时点；仅明确 B 使用本次 runId/OPEN-REG-006，A 的具体 runId/caseId 未赋值。 | 资料明确的设计缺口 | REQ-REG-002,REQ-REG-003,RULE-REG-003,RULE-REG-006,OPEN-REG-003,OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：定义企业 A 的创建或复用来源、完整台账身份、固定执行顺序、统一 B→A 处理、重跑基线恢复和前后置 validator 结果。 | 已关闭 |
| MRR-THIRD-DES-003 | 测试设计评审 | 需求只规定企业邮箱选填并做邮箱地址格式验证，未定义邮箱语法、合法或非法样例或边界；OPEN-REG-013 直接以未具体化的合法与非法格式作为输入和通过失败断言。 | 业务裁决/资料冲突 | REQ-REG-001,RULE-REG-013,RULE-REG-029,OPEN-REG-013 | 中 | 用户裁决 | 最小待确认问题：企业邮箱采用什么格式标准，或至少给出一组接受/拒绝样例？该问题尚未裁决；未裁决前 RULE-REG-029 维持适用待补充，OPEN-REG-013 仅覆盖选填空值，不生成具体格式断言。 | 待用户裁决 |

| MRR-THIRD-REQ-001 | 需求一致性评审 | 第二轮声称 OPEN-REG-001～015 已同步到全部派生视图，但当前覆盖基准、拆分清单和覆盖矩阵仍存在不完整映射，数据完整性、交互域和 OPEN-REG-007 的投影缺失。 | 资料明确的设计缺口 | REQ-REG-001～REQ-REG-004,RULE-REG-001～RULE-REG-015,OPEN-REG-001～OPEN-REG-015 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：以 RULE 台账为唯一源重新同步并逐项核对输入、唯一性、同手机号、管理员、控制台落点及关键交互投影。 | 已关闭 |
| MRR-THIRD-REQ-002 | 需求一致性评审 | 企业标识资料明确必填、非空、长度、内容和唯一性；当前 OPEN-REG-009 只检查常驻提示及长度或字符集合，不能证明非空校验生效。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-009,OPEN-REG-009 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：为企业标识增加可独立报告的空值阻断用例，不把常驻帮助文本当作必填校验，也不虚构提示全文。 | 已关闭 |
| MRR-THIRD-REQ-003 | 需求一致性评审 | 需求注册表单图明确展示验证码输入、获取验证码按钮、用户协议勾选框和注册入口；计划称覆盖其无写入可见状态，但现有 RULE 与 case 没有验证这些控件可见性。 | 需求覆盖缺口 | REQ-REG-001,缺失关键交互 RULE,缺失关键交互 caseId | 中 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：为验证码输入或获取入口、协议确认和注册入口补充独立可见性 RULE/caseId；不扩展到发送、时效、协议效果或提交状态。 | 已关闭 |
| MRR-THIRD-REQ-004 | 需求一致性评审 | 信用代码和营业执照只明确必填，未定义失焦触发或提示文本；当前用例断言移出焦点即触发必填校验。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-014,RULE-REG-015,OPEN-REG-014,OPEN-REG-015 | 中 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：改为验证资料明确的必填阻断语义，使用无写入受控校验动作证明缺失目标字段不能通过，不断言失焦、提示全文或文件属性。 | 已关闭 |

| MRR-THIRD-TRA-001 | 追溯审计 | 覆盖基准、拆分和技术表使用 RULE 区间但派生 caseId 只保留端点；覆盖矩阵遗漏多个 caseId，数据一致性仍为无；部分规则类型不属于同步器允许枚举，导致 RULE 无法正确派生到覆盖域。 | 资料明确的设计缺口 | REQ-REG-001～REQ-REG-004,RULE-REG-001～RULE-REG-015,OPEN-REG-001～OPEN-REG-015 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：改用同步器可识别的显式 RULE 编号，统一规则类型枚举，必要时拆分业务决策与后置一致性 RULE，重新同步并逐行确认全部覆盖域。 | 已关闭 |
| MRR-THIRD-TRA-002 | 追溯审计 | 计划记录 Markdown 和架构检查已通过，但新增 reviewer 执行表的分隔行列数不一致，当前静态检查会失败，关闭证据与磁盘事实不一致。 | 资料明确的设计缺口 | REV-20260723-FRESH-02,REV-20260723-FRESH-03,RULE-REG-001～RULE-REG-015 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：修复 reviewer 表结构并重新运行 Markdown、规则设计和架构检查，仅在实际通过后记录关闭证据。 | 已关闭 |
| MRR-THIRD-TRA-003 | 追溯审计 | REV-01、REV-02、REV-03 自动演进轮次未按批次顺序保持 0、1、2，当前架构检查会判定失败。 | 资料明确的设计缺口 | REV-20260723-FRESH-02,REV-20260723-FRESH-03 | 中 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：按真实批次顺序修正自动演进轮次，并复跑架构检查确保轮次、结论和收敛状态一致。 | 已关闭 |
| MRR-THIRD-TRA-004 | 追溯审计 | REV-02 的追溯发现影响广泛 REQ、RULE 和 caseId，但沉淀判定只指向单一关系链，未忠实覆盖发现项实际影响范围。 | 资料明确的设计缺口 | MRR-FINAL-TRA-001,MRR-FINAL-TRA-003,REQ-REG-001～REQ-REG-004,RULE-REG-001～RULE-REG-015,OPEN-REG-001～OPEN-REG-015 | 中 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：每个发现保留一行沉淀判定，但目标位置完整列明实际闭合的 REQ→RULE→caseId 范围，投影和检查通过后再维持已关闭。 | 已关闭 |

| MRR-THIRD-CHG-001 | 变更影响评审 | 企业 A 虽写完整台账身份和 B→A 处理，但未明确新建或复用来源、原 runId/caseId、完整 validator 结果、OPEN-REG-003→006 固定顺序、统一释放时点及重跑恢复路径。 | 资料明确的设计缺口 | CHG-OPEN-REG-003,REQ-REG-002,REQ-REG-003,RULE-REG-003,RULE-REG-006,OPEN-REG-003,OPEN-REG-006 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：建立 OPEN-REG-003/006 联合执行契约，明确 A 的新建或复用身份、前后 validator、固定顺序、B→A 统一处理和异常重跑恢复。 | 已关闭 |
| MRR-THIRD-CHG-002 | 变更影响评审 | 三条唯一性用例分别写存在或可创建重复名称、标识、信用代码，未说明是否共同复用企业 A、对应台账身份和 validator，也未闭合到最大两个资源的上限。 | 资料明确的设计缺口 | CHG-OPEN-REG-002,REQ-REG-002,RULE-REG-002,RULE-REG-004,RULE-REG-005,OPEN-REG-002,OPEN-REG-004,OPEN-REG-005 | 高 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：三条唯一性用例统一复用 validator 通过的企业 A，回链原 owner/runId/caseId/status；补充固定顺序、不新增成功资源观察和异常创建后的清理或 manual_required 阻断。 | 已关闭 |
| MRR-THIRD-CHG-003 | 变更影响评审 | 四条 CHG 的来源与版本只写全新隔离请求及需求主题，未回链 manifest id、sectionId、SHA，也未声明原型仅作交互候选，变更矩阵不能证明采用的受控来源版本。 | 资料明确的设计缺口 | CHG-OPEN-REG-001～CHG-OPEN-REG-004,REQ-REG-001～REQ-REG-004,RULE-REG-001～RULE-REG-015,OPEN-REG-001～OPEN-REG-015 | 中 | 自动演进 | 资料证据已回链；涉及的 OPEN-REG-001～OPEN-REG-027 已按受影响范围自动修订：每条 CHG 回链 aiot-platform-project-document/platform-home-and-registration 及 SHA；原型仅标注为字段呈现和交互入口候选，再同步预检。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-THIRD-DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-001/RULE-REG-008～013 → OPEN-REG-001/OPEN-REG-008～013 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-DES-002 | 需求事实 | REQ-REG-002/003 → RULE-REG-003/006 → OPEN-REG-003/006 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-DES-003 | 未验证推断 | plan.md / REQ-REG-001 / RULE-REG-029 / OPEN-REG-013 | 验收缺失 | 待用户裁决，不作为断言或项目经验 |
| MRR-THIRD-REQ-001 | 需求事实 | REQ-REG-001～004 → RULE-REG-001～029 → OPEN-REG-001～027 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-REQ-002 | 需求事实 | REQ-REG-001 → RULE-REG-009/RULE-REG-023/RULE-REG-024 → OPEN-REG-009/022/023 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-REQ-003 | 需求事实 | REQ-REG-001 → RULE-REG-017/018/019 → OPEN-REG-016/017/018 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-REQ-004 | 需求事实 | REQ-REG-001 → RULE-REG-014/015 → OPEN-REG-014/015 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-TRA-001 | 需求事实 | REQ-REG-001～004 → RULE-REG-001～029 → OPEN-REG-001～027 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-TRA-002 | 通用规则 | docs/testing/testcase-guideline.md 的 canonical 表结构与静态校验规则 | 资料已确认 | 已引用并回链本批次 |
| MRR-THIRD-TRA-003 | 通用规则 | docs/testing/automation-guideline.md 的自动演进轮次规则 | 资料已确认 | 已引用并回链本批次 |
| MRR-THIRD-TRA-004 | 需求事实 | REQ-REG-001～004 → RULE-REG-001～029 → OPEN-REG-001～027 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-CHG-001 | 需求事实 | REQ-REG-002/003 → RULE-REG-003/006/016 → OPEN-REG-003/006 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-CHG-002 | 需求事实 | REQ-REG-002 → RULE-REG-002/004/005 → OPEN-REG-002/004/005 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-THIRD-CHG-003 | 需求事实 | 受控来源 → REQ-REG-001～004 → RULE-REG-001～029 → OPEN-REG-001～027 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-FRESH-03:end -->

<!-- review-batch:REV-20260723-FRESH-04:start -->
### 评审批次：REV-20260723-FRESH-04

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 用户裁决后复审 |
| 输入基线版本 | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 2 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/rev04_req | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FOURTH-REQ-001 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/rev04_design | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FOURTH-DES-001、MRR-FOURTH-DES-002 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/rev04_trace | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FOURTH-TRA-001 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体 | /root/rev04_interaction | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FOURTH-UX-001、MRR-FOURTH-UX-002 | 已关闭 |
| 变更影响评审 | 真实子智能体 | /root/rev04_impact | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 需演进 | MRR-FOURTH-CHG-001、MRR-FOURTH-CHG-002、MRR-FOURTH-CHG-003 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-FOURTH-REQ-001 | 需求一致性评审 | 多个上游投影仍写邮箱格式待裁决，测试设计技术表遗漏 RULE-REG-029，和用户已确认的常用企业邮箱格式不一致。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据与用户裁决已回链；同步覆盖基准、拆分清单、测试设计技术表和需求追溯矩阵的 RULE-REG-029 与 OPEN-REG-028、OPEN-REG-029，保留仅提示全文未定义。 | 已关闭 |

| MRR-FOURTH-DES-001 | 测试设计评审 | RULE-REG-029 将常用企业邮箱扩展为完整字符集和域名语法，但当前用户裁决只给出常用格式，未定义该扩展语法的完整边界。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据与用户裁决已回链；将 RULE-REG-029 收敛为本次明确列出的接受/拒绝样例口径，OPEN-REG-028、OPEN-REG-029 不再对未列语法边界生成断言。 | 已关闭 |
| MRR-FOURTH-DES-002 | 测试设计评审 | OPEN-REG-028 和 OPEN-REG-029 未定义无写入的格式校验触发动作及字段级观察点。 | 资料明确的设计缺口 | RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-028、OPEN-REG-029：输入后移出焦点，以邮箱字段自身无格式错误或被格式校验阻断为观察点，不以整表单提交推断。 | 已关闭 |

| MRR-FOURTH-TRA-001 | 追溯审计 | REQ-REG-001 的可验证规则、覆盖状态和缺失信息仍写邮箱格式待裁决，与 RULE-REG-029 及 OPEN-REG-028、OPEN-REG-029 已登记的用户裁决不一致。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据与用户裁决已回链；已修订 OPEN-REG-028、OPEN-REG-029 并同步 REQ-REG-001、覆盖基准、拆分清单和测试设计技术表，移除待裁决表述，仅保留格式错误提示全文未定义。 | 已关闭 |

| MRR-FOURTH-CHG-001 | 变更影响评审 | RULE-REG-029 与 OPEN-REG-028 扩展为完整 ASCII 字符集合、域名标签和顶级域边界，超出用户已给出的常用格式样例口径。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据与用户裁决已回链；已修订 OPEN-REG-028、OPEN-REG-029，收敛为明确接受/拒绝样例，不对未获授权的完整邮箱语法边界生成断言。 | 已关闭 |
| MRR-FOURTH-CHG-002 | 变更影响评审 | OPEN-REG-028、OPEN-REG-029 缺少无写入的格式触发动作和邮箱字段级观察点，无法排除整表单必填阻断的干扰。 | 资料明确的设计缺口 | RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-028、OPEN-REG-029，统一为输入合成邮箱后移出邮箱字段焦点，仅观察该字段格式错误状态，零验证码、零上传、零提交。 | 已关闭 |
| MRR-FOURTH-CHG-003 | 变更影响评审 | CHG-OPEN-REG-001 将邮箱裁决混入全部字段和关键控件，缺少 RULE-REG-029 到 OPEN-REG-028、OPEN-REG-029 的最小复测映射。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-013,RULE-REG-029,OPEN-REG-013,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据已回链；新增邮箱裁决专属变更项，主复测 OPEN-REG-028、OPEN-REG-029，关联回归 OPEN-REG-013，明确无写入门禁。 | 已关闭 |

| MRR-FOURTH-UX-001 | 交互与状态专项评审 | RULE-REG-029 与 OPEN-REG-028 扩展为完整字符集、域名标签和顶级域长度语法，超出本次用户已列明的常用格式口径。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据与用户裁决已回链；已修订 OPEN-REG-028、OPEN-REG-029，收敛为本次明确接受/拒绝样例，未获得明确格式标准的其他语法边界不生成断言。 | 已关闭 |
| MRR-FOURTH-UX-002 | 交互与状态专项评审 | OPEN-REG-028、OPEN-REG-029 缺少输入后的无写入校验触发动作及邮箱字段自身的稳定观察点。 | 资料明确的设计缺口 | RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-028、OPEN-REG-029，两例明确输入后移出邮箱字段焦点，有效例观察该字段无格式错误，无效例观察该字段格式校验阻断；不以提交或整表单状态推断。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-FOURTH-REQ-001 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-DES-001 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-DES-002 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-TRA-001 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-CHG-001 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-CHG-002 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-CHG-003 | 需求事实 | REQ-REG-001 → RULE-REG-013/RULE-REG-029 → OPEN-REG-013/OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-UX-001 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FOURTH-UX-002 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-FRESH-04:end -->

<!-- review-batch:REV-20260723-FRESH-05:start -->
### 评审批次：REV-20260723-FRESH-05

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 3 |
| 综合结论 | 可提交确认 |
| 收敛状态 | 已收敛 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/rev05_req | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 通过 | MRR-FIFTH-REQ-001 | 已关闭 |
| 测试设计评审 | 真实子智能体 | /root/rev05_design | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/rev05_trace | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 通过 | MRR-FIFTH-TRA-001 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体 | /root/rev05_ux | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |
| 变更影响评审 | 真实子智能体 | /root/rev05_impact | fork_turns=none | testcases/web/open-platform/registration-20260723-fresh/plan.md；testcases/web/open-platform/registration-20260723-fresh/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-FIFTH-REQ-001 | 需求一致性评审 | 规则邻域复核仍标注邮箱规则待同步和待发起复审，和已启动 REV-05 不一致。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-029,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-028、OPEN-REG-029 的关系同步与规则邻域记录，并回填规则预检、Markdown、架构检查和 REV-05 进行中事实。 | 已关闭 |

| MRR-FIFTH-TRA-001 | 追溯审计 | 计划仍写待同步和待复审，但 REV-05 已启动，正式记录与追溯证据不一致。 | 资料明确的设计缺口 | REQ-REG-001,RULE-REG-013,RULE-REG-029,OPEN-REG-013,OPEN-REG-028,OPEN-REG-029 | 中 | 自动演进 | 资料证据已回链；已修订 OPEN-REG-013、OPEN-REG-028、OPEN-REG-029 的关系同步记录并回填规则预检、Markdown、架构检查证据，REV-05 全角色结论现已收齐。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-FIFTH-REQ-001 | 需求事实 | REQ-REG-001 → RULE-REG-029 → OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
| MRR-FIFTH-TRA-001 | 需求事实 | REQ-REG-001 → RULE-REG-013/RULE-REG-029 → OPEN-REG-013/OPEN-REG-028/OPEN-REG-029 | 资料已确认 | 已回链 plan.md，不沉淀为项目经验 |
<!-- review-batch:REV-20260723-FRESH-05:end -->

## 工程层：代码定位与自动化设计

| 项目 | 内容 |
| --- | --- |
| 工程层状态 | 三次原子正式运行证据均保留。授权 `094c84cf90ff` 的 Playwright 业务结果为 11 passed、13 failed、5 blocked；正式摘要因未同步软断言而错误记为 17 passed、7 failed、5 blocked，已作为基础设施缺陷重开。OPEN-REG-003 超时快照证明验证码字段已有 6 位 ASCII 数字，实际卡点是脚本对 Element Plus 隐藏 checkbox 执行 `check()`，协议未勾选且注册按钮持续禁用。当前恢复设计改为点击可见协议标签并断言隐藏 input 状态，同时在 `formalCase()` 完成前将软断言错误原子提交为 failed。正式 Runner 改为单 worker 复用同一专用 Context/page；每条 case 开始时清理 Cookie、Web Storage 和表单状态，失败 worker 才重建 Context。既有 360 秒安全挑战总超时、死亡 worker 锁接管和单一 BrowserServer 保持不变。 |
| 代码仓库 | `.local/repositories/web-open-platform` |
| 仓库确认依据 | 已确认项目为开放平台 Web；仓库含注册页面、开放平台注册接口与匹配的 Graphify 图谱。 |
| 分支/提交标识 | `307a959f962b164c5bf288f18b94a0734a9d651f` |
| Graphify 图谱 | `.local/repositories/web-open-platform/graphify-out/`；`GRAPH_REPORT.md`、`graph.json`、`.graphify_root`、`.graphify_analysis.json` 均存在。 |
| 图谱新鲜度 | 匹配：图谱报告记录 `307a959f`，与仓库当前 `HEAD` 一致。 |
| 源码确认范围 | 路由 `src/routes/common.ts` 的 `/login`；`src/pages/session/Login.vue` 的 `tab=register`；`src/pages/session/components/RegisterForm.vue`；验证码、协议和上传直接依赖；`src/api/website.ts` 的企业标识校验、短信和注册申请接口。 |

| caseId | 需求追溯编号 | 源码路径与定位依据 | 可复用能力 | 自动化结论 | 脚本与断言方案 | 数据/环境前置条件 | 风险或待确认项 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OPEN-REG-001、OPEN-REG-008～OPEN-REG-029 | REQ-REG-001 | `src/routes/common.ts` → `/login`；`Login.vue` 以 `tab=register` 渲染 `RegisterForm.vue`；表单 rules 与 `ValidationRuleBuilder` 提供字段校验。 | `formalCase()`、`formalWebFixture`、Playwright 配置和现有探索脚本。 | 可实现：23 个 caseId 各自独立执行，不依赖手机号、企业或认证资源；其中任一失败不停止其余用例。 | `registration.spec.ts` 保留为探索；正式脚本按字段必填、选填、边界、格式和控件拆为 23 条。OPEN-REG-027 独立保留 300/301 字规则。 | `TEST_ENV=test`；业务写入预算 0。 | 页面缺少稳定 `data-testid`/label；实际 maxlength=100 只使 OPEN-REG-027 失败，不影响其余 28 条。 |
| OPEN-REG-002、OPEN-REG-004、OPEN-REG-005 | REQ-REG-002 | `RegisterForm.vue` 的 `doVerifyCorpID` 调用 `verifyCorpIdentifier`；注册申请为 `companyRegisterApply`。 | CreateIntent、企业 A、认证状态与单次上传命名资源。 | 可实现：三条唯一性用例分别依赖已精确确认的企业 A，各自独立提交并记录结果；一条失败不阻断另外两条。 | 负向创建意图以 `expectedOutcome=reject` 登记，不计入成功企业预算；前置按资源状态判断，不按 OPEN-REG-003 最终断言状态判断。 | 专用测试手机号能力、`company-a`、`registration-auth`、`synthetic-upload`。 | 负向提交结果不确定时仅当前 caseId 进入 `blocked` 并精确对账，禁止重复提交。 |
| OPEN-REG-003 | REQ-REG-003 | 注册 UI 提交 `companyRegisterApply`；认证后所属企业页观察企业和管理员身份。 | CreateIntent、tracked residual、隔离认证 Context。 | 可实现：创建并精确确认企业 A、保存本机认证状态；资源确认后管理员断言即使失败，也不撤销可安全使用的 A。 | 生产 `company-a`、`registration-auth` 和 `synthetic-upload` 三个命名资源；管理员身份是本 caseId 的最终断言。 | 专用测试手机号；企业预算 1/2、上传预算 1、TTL 72 小时。 | 管理页不可用时 A 保持 `creation_unknown`，只阻塞依赖 A 的下游。 |
| OPEN-REG-006 | REQ-REG-002 | 注册 UI 与认证后的所属企业页。 | 已确认企业 A、认证状态、单次上传回放和 CreateIntent。 | 可实现：依赖 A 创建并精确确认企业 B，独立验证同手机号下 A/B 同时可见。 | 生产 `company-b`；不依赖三条唯一性断言是否通过。 | 专用测试手机号、`company-a`、`registration-auth`、`synthetic-upload`；企业预算累计 2。 | 结果未知时精确恢复，不重复上传或创建。 |
| OPEN-REG-007 | REQ-REG-004 | `/login` 与统一控制台入口；控制台默认落点 `/console/home`。 | `company-a` 与本机脱敏认证状态。 | 可实现：独立验证统一登录落点，不依赖企业 B 或唯一性断言结果。 | 敏感步骤关闭 Trace、截图与视频；不记录验证码、Cookie 或会话。 | 专用测试手机号能力、`company-a`、`registration-auth`。 | 不绕过滑块、验证码或权限；人工接管只发生在安全挑战输入点。 |

### 原子正式执行依赖

| caseId | 所需能力 | 所需命名资源 | 生产资源 | 独立结果边界 |
| --- | --- | --- | --- | --- |
| OPEN-REG-001、OPEN-REG-008～OPEN-REG-029 | 无 | 无 | 无 | 23 条各自 `passed / failed / blocked / skipped / unknown` |
| OPEN-REG-003 | registration-test-phone | 无 | company-a、registration-auth、synthetic-upload | A 或管理员断言只归属本用例 |
| OPEN-REG-002、OPEN-REG-004、OPEN-REG-005 | registration-test-phone | company-a、registration-auth、synthetic-upload | 无 | 三条唯一性互不传播失败 |
| OPEN-REG-006 | registration-test-phone | company-a、registration-auth、synthetic-upload | company-b | B 创建或多企业断言只归属本用例 |
| OPEN-REG-007 | registration-test-phone | company-a、registration-auth | 无 | 登录落点不依赖 B |

- Runner 固定单 worker、`maxFailures=0`，但不使用文件级 serial；每个正式测试只能由 `formalCase()` 绑定一个 caseId。
- Runner 在一次授权运行内持有唯一可见 Chrome BrowserServer。单 worker 的 29 条 case 顺序复用一个专用 Context/page：每条开始时清理 Cookie、Web Storage 并重新打开注册页，且将受管页面置前，保留同一可见窗口而不复用前一条表单或登录状态。失败后 Playwright 重建 worker 时才创建新 Context，但仍重连同一浏览器进程。
- 六条需要注册或认证安全挑战的正式用例由不可变清单声明 360 秒总超时，覆盖页面准备、人工图形验证、验证码输入和后续自动步骤；无写入用例保持默认超时。死亡 worker 遗留的台账锁按进程存活性立即接管，存活锁则有界等待，不把锁竞争扩散为整批快速失败。
- Element Plus 协议控件以可见 `.form-agreement .ep-checkbox` 为交互边界，点击后只通过其隐藏 input 的 checked 状态验证；不得直接对隐藏原生 checkbox 执行可见性动作。Playwright 软断言在用例回调结束前同步为原子 failed，正式摘要不得把 runner 已失败的 caseId 记为 passed。
- 请求、test 环境和新授权摘要形成稳定运行键。worker 重启复用同一 run、预算、CreateIntent、已确认资源和已通过结果；`creation_unknown` 先精确对账。teardown 将已开始但未提交的超时尝试保守记为 `failed`，未开始项保持 `unknown` 等待同一授权恢复。
- 缺少专用手机号时仅 OPEN-REG-002～OPEN-REG-007 为 `blocked`，其余 23 条实际执行。依赖资源缺失时只阻塞其消费者。

### 规范差异与用户告知

| 差异编号 | 问题类别 | 具体事实与证据 | 受影响 caseId | 自动化影响 | 最小处理建议或待确认项 | 自动化结论 | 用户已告知 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-GAP-001 | 可访问性/定位 | `RegisterForm.vue` 的输入项主要依赖 placeholder 和 Element Plus 结构，未见稳定 `data-testid` 或显式关联 label。 | OPEN-REG-001、OPEN-REG-008～OPEN-REG-029 | 当前候选定位已由可见探索验证，但前端结构变更时稳定性低于语义化 selector。 | 长期为字段、验证码入口、协议和注册按钮补充稳定 `data-testid`/label；本次使用局部表单范围降低歧义。 | 可实现 | 是；已记录。 |
| ENG-GAP-002 | 数据、环境或权限 | 无企业删除 API；管理员/多企业后置状态当前使用认证后的所属企业管理页。 | OPEN-REG-002～OPEN-REG-007 | 正式执行可在两个企业上限内完成，但会产生最长 72 小时的受控残留；管理页不可用时对应后置断言阻塞。 | 在统一执行清单中确认 `tracked_residual`、企业 2/文件 1 的预算和 TTL；后续补登记幂等删除 API 可切换为 managed_cleanup。 | 可实现但有受控残留 | 待统一执行清单确认。 |

### 脚本与证据方案

- 探索文件：`tests/web/open-platform/registration-20260723-fresh/registration.spec.ts`；只用于定位、ARIA/DOM 和零写入预检，不计入正式结果。
- 正式文件：`tests/web/open-platform/registration-20260723-fresh/registration.formal.spec.ts` 与同目录 `execution.manifest.ts`；清单声明 29 条原子结果、能力和命名资源依赖。
- 执行命令：`npm run test:web:execute -- --request web/open-platform/registration-20260723-fresh`；中断后只允许追加 `--resume`。入口拒绝 `--grep`、文件路径和其他过滤参数。
- 数据闭环：企业预算 2、上传预算 1、TTL 72 小时；每次远端创建前登记 CreateIntent，创建结果只由精确管理页/API 对账确认。无删除能力时登记 `retained`，不误报 `manual_required`。
- 预期产物：`artifacts/playwright-report/`、`artifacts/test-results/playwright/`、`artifacts/test-results/junit.xml`、`artifacts/test-results/formal/<授权摘要>/formal-case-results.{json,md}` 与脱敏 test-data summary；正式报告分别输出原子功能状态和数据卫生状态。
- 执行门禁：脚本静态检查和评审后生成新的不可变统一执行清单；用户只确认一次。脚本、计划、环境、操作或预算漂移时旧清单自动失效。
