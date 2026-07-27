# 测试计划：开放平台登录与注册功能

> 本计划遵循[流程规范](../../../../docs/testing/automation-guideline.md)、[用例规范](../../../../docs/testing/testcase-guideline.md)、[环境规范](../../../../docs/testing/environment-guideline.md)、[定位规范](../../../../docs/testing/selector-guideline.md)和[报告规范](../../../../docs/testing/report-guideline.md)。

> 结构版本：case-relation-projection-v1。原子用例的“用例编号”是身份来源；仅“规则覆盖台账”的“关联 caseId”可人工维护，其他关系视图由同步命令生成。

> 结构版本：web-script-governance-v1。

> 结构版本：page-session-group-v1。

> 结构版本：case-evidence-policy-v1。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 计划编号 | OPEN-PLATFORM-ACCOUNT-ACCESS-20260727-2 |
| 状态 | 已确认 |
| 测试类型 | Web |
| 目标环境 | test（用户未指定环境，按本机长期偏好默认选择，待计划确认） |

## 任务执行清单

<!-- testcase-standard: task-execution-list-v1 -->

| 序号 | 阶段 | 任务 | 进入条件 | 完成标志 | 状态 | 当前结论 / 需要动作 | 证据或输出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 计划 | 资料、静态资产与环境预检 | 用户提出开放平台登录和注册测试需求 | 测试计划形成并通过静态检查 | 已完成 | 已读取需求文档、命中原型页和注册 FAQ；合成营业执照与 test 配置预检通过 | 本计划“输入资料”“测试资产选择”“环境选择”区块 |
| 2 | 计划确认 | 确认范围、环境、推断与数据策略 | 测试计划已生成 | 用户确认计划 | 已完成 | 用户已确认本计划；本次确认只开放用例生成与评审，不授权发送验证码、上传、注册提交或正式执行 | `CNF-STX-03` 用户确认记录；本计划“基本信息”状态 |
| 3 | 用例 | 生成全部用例包与追溯 | 测试计划已确认 | 登录、注册用例包和 `REQ ↔ RULE ↔ caseId` 闭环 | 已完成 | 已生成 2 个用例包、40 条原子用例、19 项 REQ 和 43 条 RULE；关系同步及规则、Markdown、架构和环境预检通过 | `cases-login.md`、`cases-registration.md`；关系同步、规则设计、Markdown、架构与环境检查结果 |
| 4 | 评审 | 多角色评审、自动演进与复审 | 用例草案完整且静态检查通过 | 资料明确的缺口关闭，最终复审收敛 | 进行中 | `REV-20260727-ACCOUNT-02` 的确定性缺口已自动修订并通过静态检查；正在登记下一轮最终复审 | 本计划“多角色评审记录”区块 |
| 5 | 用例确认 | 确认用例集与剩余业务裁决 | 最终复审收敛 | 用户确认用例 | 待开始 | 等待评审闭环 | 用户确认记录 |
| 6 | 工程设计 | 仓库、Graphify、数据、探索与脚本方案定位 | 用例已确认 | 工程设计完成自动校验 | 待开始 | 等待用例确认；此阶段才读取被测代码并进行零写入可见探索 | 本计划“工程层：代码定位与自动化设计”区块 |
| 7 | 脚本与执行 | 生成脚本、确认不可变清单并执行 | 工程设计完成 | 正式报告与复盘完成 | 待开始 | 等待工程设计、脚本评审和独立执行授权 | 正式脚本与 `artifacts/` 脱敏报告 |

## 测试范围

### 包含

- 官网“立即使用”或“登录/注册”入口到账号页的导航，以及登录与注册页签切换。
- 手机号与密码登录主链路、登录成功后进入 AIoT 控制台的可观察结果。
- 原型展示的手机号与验证码登录入口、获取验证码、协议勾选、登录按钮和“账号登录”模式切换；资料未定义的验证码发送反馈、有效期和重发间隔不生成通过或失败断言。
- “忘记密码”入口的可见性与跳转；重置流程和验收规则在资料补齐前保持适用待补充。
- 企业注册字段、输入边界、唯一性提示、手机号验证、协议确认、合成营业执照上传和注册提交。
- 企业申请审核中的待审核、审核不通过后重新申请、审核通过后接收账号密码并使用平台资源的完整业务链路；由于审核耗时和后台可观察能力未确认，执行层按受控执行或适用待补充处理。
- 注册账号的企业管理员身份，以及每个企业一个企业管理员账号、一个用户账号可加入多个企业组的规则。
- 默认桌面视口下的关键表单可见性、可操作性、错误反馈和基本语义定位。

### 不包含

- 生产环境访问或验证。
- 企业成员添加、编辑、删除、系统权限申请、产品开发和其他登录后的业务模块；这些超出本次账号访问请求。
- 绕过、破解、模拟或伪造滑块、短信验证码、人机验证和权限控制。
- 性能压测、全浏览器兼容矩阵、移动端适配、渗透测试和法规认证；当前资料未定义这些验收范围。
- 未获独立执行授权的验证码发送、文件上传、企业注册提交、真实账号变更或其他业务写入。

## 输入资料

> 结构版本：source-reference-links-v1

| manifest id / sectionId | 资料类型 | 可点击资料链接 | 页码、标题或页面定位 | 版本 / SHA-256 | 本次用途 |
| --- | --- | --- | --- | --- | --- |
| aiot-platform-project-document / platform-home-and-registration | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | “官网改造”下“注册”“登录”“AIoT控制台” | 版本待确认；SHA-256 `64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b` | 登录主规则、注册字段与边界、唯一性提示、管理员身份和登录后目标 |
| open-platform-axure-prototype / prototype-account-login | 原型 | [登录页面.html](../../../../sources/prototypes/open-platform/登录页面.html) | 登录页面 | 版本待确认；受控索引目录 SHA-256 `d4e823a2b1c2c81d899ce3f1d00baee640257f9fc6c0cdc77d0e0493506a13cd` | 验证码登录、账号登录切换、协议、忘记密码和页面布局 |
| open-platform-axure-prototype / prototype-account-registration | 原型 | [注册页面.html](../../../../sources/prototypes/open-platform/注册页面.html) | 注册页面 | 版本待确认；受控索引目录 SHA-256 `d4e823a2b1c2c81d899ce3f1d00baee640257f9fc6c0cdc77d0e0493506a13cd` | 注册字段布局、验证码、协议和提交入口 |
| iot-platform-help / account-registration-faq | 平台帮助文档 | [iot平台帮助文档.pdf](../../../../sources/knowledge-base/open-platform/iot平台帮助文档.pdf) | 受控索引标注第 9–15 页；实际注册入口与字段位于 PDF 物理第 8–9 页 | 版本待确认；SHA-256 `4473657d25751ae2ac06b03c1abea533749cf07353dde1d0c2daa350423e038e` | 注册入口、字段含义、营业执照属性、审核时限、短信结果和企业账号关系 |

## 测试资产选择

<!-- testcase-standard: test-asset-selection-v1 -->

| assetId | 类型 | 可点击资产链接 | 选择依据 | 选择状态 | 工程验证项 |
| --- | --- | --- | --- | --- | --- |
| open-platform-synthetic-business-license | test-document | [合成营业执照](../../../../test-assets/documents/open-platform/synthetic-business-license.png.b64) | open-platform、Web、registration 范围下唯一 active 且默认候选 | 已选择候选；文件与 SHA-256 预检通过 | 正式执行时仅在内存中解码；校验 PNG、文件大小、上传控件与产物脱敏 |

## 环境选择

> 结构版本：environment-status-v1

| 候选环境 | 选择依据 | 本地配置状态 | 预检状态 | 用户确认状态 | 未闭合项 |
| --- | --- | --- | --- | --- | --- |
| test | 用户未指定环境；按本机长期偏好默认使用 test | 已配置：开放平台 Web 地址和测试账号引用可解析，未读取敏感值 | 已预检：3 项通过、2 项警告、0 项失败；合成营业执照完整性通过 | 已确认 | 本地认证会话文件不存在；业务可访问性、账号可登录性和验证码通道未验证；Appium 警告不适用于本 Web 请求 |

## 测试方式

- 业务层采用需求文档、命中原型页和注册 FAQ 建立 `REQ → RULE` 追溯。
- 用例确认后，Web 工程层使用 Playwright；先进行业务写入预算为 0 的可见探索，再生成正式脚本。
- 正式执行只允许通过绑定不可变执行清单的仓库 Runner，登录和注册分别使用隔离的页面场景组。

## 测试数据策略与残留台账

> 结构版本：test-data-policy-v1

| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 用户确认状态 |
| --- | --- | --- | --- | --- | --- |
| no_write | test | 不创建持久业务对象；允许的远端副作用另见下表 | 0 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 已确认 |
| tracked_residual | test | 首次企业注册申请 | 1 | OPEN-PLATFORM-REGISTRATION-014 | 已确认 |
| tracked_residual | test | 驳回后重新提交的企业注册申请 | 1 | OPEN-PLATFORM-REGISTRATION-016 | 待用户确认 |

### 写入策略明细

- `no_write`：只表示不创建持久业务对象；它不自动授权短信请求、认证会话、临时上传或其他远端副作用。只读审核分支使用预先登记且彼此隔离的待审核、驳回和通过状态资源，当前请求不负责创建这些前置资源；唯一合成标识和 `cleanupActionId` 均不适用。
- 首次 `tracked_residual`：最多创建 1 条企业注册申请；唯一合成标识为 `OPEN-PLATFORM-ACCOUNT-ACCESS-<runId>`，并绑定合成企业名称、企业标识、统一社会信用代码和合成营业执照；`cleanupActionId` 不适用；默认 TTL 72 小时。
- 重提 `tracked_residual`：在一条预先登记的驳回隔离申请上最多重新提交 1 次，唯一合成标识为原申请标识加 `-RESUBMIT-<runId>`；`cleanupActionId` 不适用；属于独立写入预算，只有用户另行确认后才可进入不可变执行清单，不能占用或扩大已确认的首次申请预算。
- 包级持久写入上限为 2：首次提交最多 1 条、驳回重提最多 1 条；两类写入不得进入同一不可变执行批次，各自独立登记台账、授权、失败恢复与 72 小时复核。重跑不得重复创建，预算耗尽后只允许只读恢复。
- 验证码使用本机环境变量 `OPEN_PLATFORM_REGISTRATION_PHONE_TEST` 引用的专用测试手机号，原值不得写入计划、用例、日志、截图、Trace、视频或回复。
- 台账或数据策略引用：正式执行前在 `.local/test-ledger/` 登记 `CreateIntent`；本计划和正式报告只保留脱敏摘要。
- 残留风险与处理期限：企业注册申请当前没有已登记的幂等清理能力，若获执行授权则按各自 `tracked_residual` 预算登记并在 72 小时内复核；不得扫描或删除台账外数据。认证会话必须退出或关闭隔离上下文；短信只记录脱敏请求事实；上传临时对象的清理能力待工程设计确认。

### 非持久副作用与授权明细

| caseId | 副作用类型 | 最大次数 | 持久业务对象 | 残留或恢复 | 授权状态 |
| --- | --- | --- | --- | --- | --- |
| OPEN-PLATFORM-LOGIN-003 | 登录短信请求 | 1 | 无 | 不记录验证码或短信正文；频控恢复待确认 | 待独立执行授权 |
| OPEN-PLATFORM-LOGIN-004 | 有效凭据认证提交 | 1 | 无 | 用例结束退出或关闭隔离浏览器上下文 | 待独立执行授权 |
| OPEN-PLATFORM-LOGIN-005 | 无效凭据认证提交 | 1 | 无 | 不保存凭据或会话；仅在用户纳入正式验收后执行 | 待用户裁决及独立执行授权 |
| OPEN-PLATFORM-REGISTRATION-009 | 合成文件上传校验 | 每个明确文件等价类 1 次 | 无企业申请 | 可能产生临时上传对象；清理能力待工程设计确认 | 待独立执行授权 |
| OPEN-PLATFORM-REGISTRATION-011 | 注册短信请求 | 1 | 无 | 不记录验证码或短信正文；频控恢复待确认 | 待独立执行授权 |
| OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 预登记有效表单基线夹具只读复位 | 0 | 无 | 每个 caseId 使用彼此隔离夹具；不得依赖前例页面状态；夹具不可用则阻塞该 caseId | 已确认零当前副作用；工程能力待补 |
| OPEN-PLATFORM-REGISTRATION-014 | 注册短信请求、有效证照上传、首次企业申请提交 | 各 1 | 企业注册申请 1 条 | 同一授权场景组内完成；台账登记、TTL 72 小时、无已登记自动清理 | 已确认持久预算；全部副作用仍待独立执行授权 |
| OPEN-PLATFORM-REGISTRATION-016 | 驳回申请认证访问与重新提交 | 各 1 | 重提申请 1 条 | 独立台账和会话上下文；TTL 72 小时、无已登记自动清理 | 待用户确认预算及独立执行授权 |
| OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-028 | 既有隔离账号认证提交 | 每个 caseId 1 | 无 | 每个 caseId 独立会话，结束时退出或关闭上下文，不跨 caseId 复用 | 待独立执行授权 |

### 执行清单映射

| caseId | 正式脚本 | 允许操作 | 资源类型 | 数量预算 | 后台验证 | 敏感产物策略 |
| --- | --- | --- | --- | --- | --- | --- |
| OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-030 | 待工程设计 | 零持久写入导航、输入、本地或提交前服务校验；不发送短信、不上传、不认证、不提交申请 | 无 | 0 | 不适用或待确认只读入口 | 常规脱敏 |
| OPEN-PLATFORM-LOGIN-003 | 待工程设计 | 最多请求 1 次登录验证码，不提交登录 | 短信请求 | 1 | 不适用 | 暂停或遮罩敏感采集，不记录短信正文 |
| OPEN-PLATFORM-LOGIN-004 | 待工程设计 | 最多提交 1 次有效凭据登录，随后退出或关闭隔离会话 | 临时认证会话 | 1 | 控制台目标只读核验 | 密码、Cookie、Token 和会话不进入产物 |
| OPEN-PLATFORM-LOGIN-005 | 待工程设计 | 最多提交 1 次无效凭据；用户裁决前不执行 | 认证尝试 | 1 | 不适用 | 不记录凭据和响应敏感字段 |
| OPEN-PLATFORM-REGISTRATION-009 | 待工程设计 | 上传脱敏合成文件并验证类型、大小边界，不提交申请 | 临时上传对象待确认 | 每个明确等价类 1 | 不适用 | Trace、视频和网络摘要按上传阶段暂停或遮罩 |
| OPEN-PLATFORM-REGISTRATION-011 | 待工程设计 | 最多请求 1 次注册验证码并由用户完成最小安全挑战，不提交申请 | 短信请求 | 1 | 不适用 | 不记录验证码、手机号原值或短信正文 |
| OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 待工程设计 | 分别读取并复位预登记的独立有效表单基线夹具，只改变一个决策条件；不发送短信、不上传、不提交申请 | 预登记表单夹具 | 0 | 需证明夹具身份、独立恢复和未提交事实 | 夹具不可用时阻塞对应 caseId 并重开授权，禁止复用前例残留 |
| OPEN-PLATFORM-REGISTRATION-014 | 待工程设计 | 在同一授权场景组内最多请求 1 次注册验证码、上传 1 个有效合成证照并提交 1 次首次企业申请 | 首次企业注册申请 | 各 1 | 按唯一合成标识只读证明平台接受且进入审核链路 | 台账登记；敏感采集暂停或遮罩；失败按 CreateIntent 精确恢复 |
| OPEN-PLATFORM-REGISTRATION-016 | 待工程设计 | 独立认证访问已驳回申请，修改后重新提交 1 次并关闭会话 | 重提企业注册申请 | 认证与重提各 1 | 需可恢复驳回状态和重新进入审核链路的只读入口 | 独立预算待确认；台账登记；敏感采集暂停或遮罩 |
| OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 待工程设计 | 读取预先登记且彼此隔离的已提交、待审核、通过、驳回、关系或证照审核夹具，不创建或迁移状态 | 既有隔离状态资源 | 0 | 需要只读 API、管理页或稳定 UI；证照夹具必须与输入摘要和结果精确绑定 | 审核、短信和证照内容仅作脱敏事实记录 |
| OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-028 | 待工程设计 | 每个 caseId 最多独立认证 1 次，读取既有通过或关系状态，随后退出或关闭隔离上下文 | 临时认证会话 | 每个 caseId 1 | 账号身份、企业组关系或名称展示只读核验 | 凭据、Cookie、Token 和会话不进入产物 |

## 用例集生成状态

> 结构版本：testcase-generation-v1

| 字段 | 内容 |
| --- | --- |
| 用例集状态 | 待评审 |
| 已完成用例包 | `cases-login.md`：6 条；`cases-registration.md`：34 条 |
| 待生成或待补齐用例包 | 无；40 条 caseId 与 43 条 RULE 已完成关系同步 |
| 当前阻塞项 | 仅 `OPEN-PLATFORM-LOGIN-005` 的业务验收口径待用户裁决，不阻塞其余用例自动演进 |
| 下一门禁 | 登记并完成下一轮五角色最终复审；收敛后进入用户用例确认 |

## 覆盖基准与拆分清单

> 结构版本：coverage-inventory-v1

### 基准资料与模块映射

| 基准资料 | 层级或模块/流程 | 可验证场景或规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 差异、不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| AIoT 平台项目需求 | 官网与账号访问 / 登录 | 登录入口、手机号密码登录、登录后进入控制台 | 入口、密码登录主链路、登录后目标；无效凭据结果隔离待裁决 | RULE-NAV-001、RULE-LOGIN-004、RULE-LOGIN-005、RULE-LOGIN-007 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005 | 密码格式、失败提示和会话规则未定义；LOGIN-005 不作为已确认验收 |
| 登录原型 | 登录页面 / 验证码登录与账号登录 | 手机号、验证码、协议、登录、忘记密码、账号登录切换 | 页面交互、模式切换、验证码受控执行、忘记密码入口 | RULE-LOGIN-001、RULE-LOGIN-002、RULE-LOGIN-003、RULE-LOGIN-006 | OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-006 | 验证码有效期、重发间隔和重置流程未定义 |
| AIoT 平台项目需求 | 企业注册 / 字段与唯一性 | 企业资料、联系人、联系方式、简介、邮箱、唯一性提示和手机号多企业关系 | 字段等价类、边界、唯一性、提示和关系 | RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-009、RULE-REG-010、RULE-REG-013、RULE-REG-014、RULE-REG-016、RULE-REG-025、RULE-REG-031、RULE-REG-034 | OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-030 | 信用代码字符集和校验位算法未定义，不生成对应断言 |
| 注册原型 | 企业注册 / 入口、验证码与提交 | 注册页签、验证码、协议、提交按钮和字段布局 | 注册入口、关键交互、提交前置条件和零持久写入探索 | RULE-NAV-002、RULE-REG-015、RULE-REG-018、RULE-REG-026 | OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 验证码发送反馈和成功页未定义 |
| IoT 平台帮助文档 | 企业注册 / 申请与审核 | 营业执照、审核、短信结果、驳回重提、字段一致性和账号关系 | 文件边界、申请状态机、管理员身份和多企业关系 | RULE-REG-011、RULE-REG-012、RULE-REG-017、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-023、RULE-REG-024、RULE-REG-027、RULE-REG-028、RULE-REG-029、RULE-REG-030、RULE-REG-032、RULE-REG-033 | OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 后台只读查询能力、可控审核分支和审核时点未确认 |

### 拆分清单

| 类别 | 拆分项与适用规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用、待补充或合并依据 |
| --- | --- | --- | --- | --- | --- |
| 输入字段 | 登录手机号、验证码、密码；注册企业名称、信用代码、地址、标识、营业执照、申请人、联系方式、简介、邮箱、验证码 | 必填、格式、长度、唯一性、文件属性、字段一致性和未定义边界 | RULE-LOGIN-002、RULE-LOGIN-004、RULE-LOGIN-007、RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-009、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-016、RULE-REG-025、RULE-REG-028、RULE-REG-031、RULE-REG-032、RULE-REG-033 | OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033 | 只对资料明确的格式和边界生成断言；LOGIN-005 待用户裁决 |
| 枚举与状态 | 验证码登录、账号登录；申请未提交、已提交、待审核、审核不通过、重新提交、审核通过 | 模式切换和申请状态迁移 | RULE-LOGIN-001、RULE-REG-008、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-029、RULE-REG-030 | OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-034 | 登录会话过期和锁定状态未定义；审核状态使用隔离资源 |
| 关键交互 | 立即使用、登录/注册入口、页签切换、获取验证码、协议、登录、忘记密码、上传、注册提交和重提 | 入口、阻断、跳转、提交和恢复路径 | RULE-NAV-001、RULE-NAV-002、RULE-LOGIN-001、RULE-LOGIN-002、RULE-LOGIN-003、RULE-LOGIN-004、RULE-LOGIN-005、RULE-LOGIN-006、RULE-LOGIN-007、RULE-REG-011、RULE-REG-012、RULE-REG-015、RULE-REG-018、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-026 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-034 | 安全挑战只允许最小人工接管 |
| 角色与权限 | 注册人作为企业管理员；一个企业一个管理员账号；一个用户可加入多个企业组；一个手机号可注册多个企业；系统权限需申请 | 账号身份、企业组展示与登录后可见范围 | RULE-LOGIN-005、RULE-REG-017、RULE-REG-023、RULE-REG-024、RULE-REG-027、RULE-REG-030、RULE-REG-034 | OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-029 | 企业成员管理超出范围；系统权限审批不执行 |

### 测试设计技术与依据

| 适用场景 | 设计技术与最小记录 | 需求追溯编号 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 多条件业务规则 | 决策表：必填项、唯一性、手机号验证、协议四项均有效才允许提交；分别令必填项缺失、唯一性失败、手机号未验证、协议未勾选，其他三项保持有效并在场景后复位 | REQ-REG-010 | 注册提交允许与四类独立阻断 | RULE-REG-018、RULE-REG-025、RULE-REG-026 | OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 负向场景以提交入口不可激活且无提交请求为稳定判据；精确禁用样式待探索，不得提交申请 |
| 生命周期与状态机 | 状态迁移：未提交到已提交；待审核在 1–2 个工作日产生结果；驳回后重新提交；通过后管理员登录并核验名称状态 | REQ-REG-001、REQ-REG-003、REQ-REG-011、REQ-REG-012 | 注册申请审核状态机与字段后置状态 | RULE-REG-008、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-029、RULE-REG-030 | OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-034 | 审核耗时 1–2 个工作日，正式执行需隔离资源和可恢复观察 |
| 复杂输入 | 等价类与边界：企业名称 2/50、信用代码 18/19 上边界、标识 3/6、地址 50、姓名 20、手机号 11、简介 300、邮箱 50、营业执照类型和小于/等于/大于 10MB；另验证名称和代码与合成证照一致性 | REQ-REG-001、REQ-REG-002、REQ-REG-003、REQ-REG-004、REQ-REG-005、REQ-REG-006、REQ-REG-007、REQ-REG-008 | 注册字段有效、无效、边界和跨字段一致性输入 | RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-009、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-016、RULE-REG-028、RULE-REG-031、RULE-REG-032、RULE-REG-033 | OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033 | 信用代码最小长度、字符集和校验位、部分字符空格规则未定义；不生成对应断言 |
| 核心用户旅程 | 场景法：账号入口、登录模式切换、密码登录、验证码请求受控路径、注册入口、注册提交、审核时限与短信、驳回重提、审核通过后登录、忘记密码入口 | REQ-NAV-001、REQ-LOGIN-001、REQ-LOGIN-002、REQ-LOGIN-003、REQ-LOGIN-004、REQ-REG-009、REQ-REG-010、REQ-REG-011、REQ-REG-012 | 主成功、受控失败、回退和恢复 | RULE-NAV-001、RULE-NAV-002、RULE-LOGIN-001、RULE-LOGIN-002、RULE-LOGIN-003、RULE-LOGIN-004、RULE-LOGIN-005、RULE-LOGIN-006、RULE-REG-015、RULE-REG-017、RULE-REG-018、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-023、RULE-REG-024、RULE-REG-026、RULE-REG-027、RULE-REG-030、RULE-REG-034 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-034 | 忘记密码正文和验证码反馈缺少验收；LOGIN-005 待用户裁决 |

## 覆盖矩阵

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用：登录和注册是本次核心请求 | 入口、认证模式、注册字段、独立阻断、提交、审核和账号身份 | 已覆盖；LOGIN-005 待裁决 | OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 |
| 输入与数据校验 | 适用：需求明确多个字段边界、格式、唯一性和证照一致性 | 登录输入和全部注册字段的已定义等价类、边界与跨字段一致性 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-032 |
| 状态与生命周期 | 适用：注册存在已提交、待审核、审核不通过、重提和审核通过 | 互斥隔离申请状态机、字段后置状态与后续登录 | 已覆盖；执行能力待补 | OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-027 |
| 数据完整性与一致性 | 适用：名称、标识、信用代码唯一；名称和信用代码需匹配证照；手机号与账号存在多企业关系 | 唯一性、跨字段一致性、重复提交风险和账号企业关系 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 |
| 异常、容错与恢复 | 适用待补充：审核不通过可重提；网络、会话和验证码错误恢复未定义 | 已定义的审核驳回恢复与独立重提预算；其他失败仅风险登记 | 适用待补充 | OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-034 |
| 权限、身份与审计 | 适用：注册人为管理员，手机号可注册多个企业，账号可加入多个企业组，系统权限独立申请 | 管理员身份、企业组名称和登录后目标；成员管理和权限申请不执行 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-029 |
| 安全与隐私 | 适用：账号、密码、验证码、营业执照和联系方式敏感 | 产物脱敏、安全挑战人工接管、禁止真实个人数据 | 已覆盖 | 无 |
| 接口、集成与契约 | 适用待补充：短信、注册审核、账号下发和证照内容审核涉及外部服务 | UI 主路径与后台只读状态核验；查询能力待工程设计 | 适用待补充 | OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 |
| 兼容性与可移植性 | 不适用：资料未声明浏览器、操作系统或移动端支持矩阵 | 默认 Playwright Chromium 桌面代表项 | 不适用 | 无 |
| 交互、视觉与无障碍 | 适用：原型明确表单、页签、按钮和关键布局 | 默认桌面视口可见性、可操作性、反馈和语义定位 | 已覆盖 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-REGISTRATION-020 |
| 性能、容量与稳定性 | 不适用：本次资料未定义 SLO、并发或容量阈值 | 不执行性能与容量测试 | 不适用 | 无 |
| 配置、部署与可运维性 | 不适用：本次不是配置或发布变更验证 | 仅执行环境预检，不形成产品运维断言 | 不适用 | 无 |
| 本地化与法规要求 | 不适用：资料未定义多语言、区域或合规验收 | 不生成本地化或法规断言 | 不适用 | 无 |

## 需求追溯矩阵

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-NAV-001 | AIoT 平台项目需求“官网改造”；平台帮助文档第 8 页 | P0 | 官网“立即使用”进入登录页面；官网“登录/注册”进入可切换到注册表单的账号访问路径 | 适用 | 两条入口路径分别验证 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-REGISTRATION-020 | 已覆盖 | 正式执行前需确认目标页面可访问 |
| REQ-LOGIN-001 | 登录原型“登录页面” | P0 | 用户可在验证码登录与账号登录入口之间切换 | 适用 | 模式切换与字段组可见性 | OPEN-PLATFORM-LOGIN-002 | 已覆盖 | 只断言原型明确的交互 |
| REQ-LOGIN-002 | 登录原型“登录页面” | P0 | 验证码登录展示手机号、验证码、获取验证码、协议和登录入口 | 适用 | 表单结构与受控验证码请求；不提交验证码登录 | OPEN-PLATFORM-LOGIN-003 | 受控执行 | 发送验证码需独立执行授权；完整登录结果、成功反馈与重发规则未定义 |
| REQ-LOGIN-003 | AIoT 平台项目需求“登录” | P0 | 使用手机号和密码登录 | 适用 | 正确账号登录和资料未定义的失败分支 | OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005 | 已覆盖 | 密码规则、错误提示、锁定与会话策略未定义 |
| REQ-LOGIN-004 | AIoT 平台项目需求“AIoT控制台” | P0 | 统一登录验证后默认进入 AIoT 控制台 | 适用 | 登录后路由和控制台入口 | OPEN-PLATFORM-LOGIN-004 | 已覆盖 | 需测试账号和登录会话；安全挑战不得绕过 |
| REQ-LOGIN-005 | 登录原型“登录页面” | P1 | 登录页提供忘记密码入口 | 适用 | 入口可见性与跳转 | OPEN-PLATFORM-LOGIN-006 | 适用待补充 | 重置步骤、身份校验和成功结果未定义 |
| REQ-REG-001 | AIoT 平台项目需求“注册”；帮助文档物理第 9 页 | P0 | 企业名称必填、2–50 字符、仅中文英文数字且唯一；须与营业执照名称一致，提交后不可修改，审核通过登录后作为企业组名称展示 | 适用 | 输入、唯一性、跨字段一致性和后置状态 | OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-033 | 已覆盖 | 唯一性、证照内容和后置状态需受控能力 |
| REQ-REG-002 | AIoT 平台项目需求“注册”；帮助文档物理第 8–9 页 | P0 | 企业信用代码必填、最多 18 字符、不可重复且须与营业执照一致 | 适用 | 必填、长度上界、唯一性和跨字段一致性 | OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-031 | 已覆盖 | 最小长度、字符集与校验位算法未定义 |
| REQ-REG-003 | AIoT 平台项目需求与帮助文档注册章节 | P0 | 企业地址必填、最多 50 字符，提交后不可修改 | 适用 | 必填、上界和提交后状态 | OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-006 | 受控执行 | 不创建第二次修改写入；通过审核前的修改入口未定义 |
| REQ-REG-004 | AIoT 平台项目需求与帮助文档注册章节 | P0 | 企业标识必填、3–6 位小写字母或数字、唯一，并常驻提示其用作产品 Model 的组成部分 | 适用 | 必填、常驻提示、格式、长度和重复提示 | OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008 | 已覆盖 | 产品 Model 下游使用超出本次请求 |
| REQ-REG-005 | AIoT 平台项目需求与帮助文档第 8–9 页 | P0 | 营业执照必传，为最新三证合一扫描件或照片，PNG、JPEG 或 JPG 且不超过 10MB | 适用 | 必填、文件类型、大小和合成资产上传 | OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-032 | 受控执行 | 上传需独立执行授权；不得使用真实营业执照 |
| REQ-REG-006 | AIoT 平台项目需求与帮助文档注册章节 | P0 | 申请人姓名必填、最多 20 字符、支持中文英文，空值提示“请输入联系人名称”；审核通过后成为企业管理员并作为账号名称 | 适用 | 必填、精确提示、长度、字符、身份和账号名称映射 | OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-017 | 已覆盖 | 混合字符、空格和特殊符号规则未定义 |
| REQ-REG-007 | AIoT 平台项目需求与帮助文档注册章节 | P0 | 联系方式必填且为 11 位手机号，作为企业管理员账号并进行手机号验证 | 适用 | 必填、11 位格式、验证码和账号关联 | OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-021 | 受控执行 | 使用专用本机测试手机号；验证码不得记录或绕过 |
| REQ-REG-008 | AIoT 平台项目需求“注册”；帮助文档物理第 8 页 | P1 | 企业简介选填且最多 300 字符；企业邮箱选填、满足格式且最多 50 字符 | 适用 | 简介与邮箱分别覆盖选填、上界和格式 | OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-022 | 已覆盖 | 邮箱字符集采用页面可观察的最小规则 |
| REQ-REG-009 | AIoT 平台项目需求与帮助文档注册章节 | P0 | 同一手机号可注册多个企业；同一用户账号可加入多个企业组；每个企业只能申请一个企业管理员账号 | 适用 | 三类账号企业关系分别判定 | OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-029 | 受控执行 | 不批量创建；使用既有隔离关系或只读后台证据 |
| REQ-REG-010 | 注册原型与帮助文档注册章节 | P0 | 完成必填信息、手机号验证并勾选协议后，通过“同意条款并注册”提交申请 | 适用 | 提交决策表和单次受控写入 | OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 受控执行 | 发送验证码、上传和提交必须在不可变执行清单中单独确认 |
| REQ-REG-011 | 帮助文档第 9 页 | P0 | 平台在 1–2 个工作日完成企业信息审核并以短信通知结果 | 适用 | 待审核状态、时间窗和短信结果 | OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-034 | 适用待补充 | 后台查询方式和可等待执行机制未确认；不回显短信内容 |
| REQ-REG-012 | 帮助文档第 9 页 | P0 | 审核不通过时可按反馈重新申请；审核通过时额外发送账号密码并可使用已开通资源 | 适用 | 审核分支、驳回重提和通过后登录 | OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-034 | 适用待补充 | 需要可控审核结果、脱敏账号接收和独立恢复授权 |
| REQ-REG-013 | AIoT 平台项目需求“注册唯一性提示” | P1 | 企业名称、企业标识和统一社会信用代码重复时展示资料定义的提示 | 适用 | 三类重复反馈 | OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-023 | 已覆盖 | 需要已存在的隔离测试数据，禁止扫描或借用真实企业 |

## 规则覆盖台账

> 结构版本：rule-coverage-v1

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-NAV-001 | REQ-NAV-001 | AIoT 需求“立即使用” | 页面交互 | 从官网选择“立即使用” | 进入可辨识的登录页面 | 场景法与交互断言 | 适用 | 已覆盖 | OPEN-PLATFORM-LOGIN-001 | 零写入导航 |
| RULE-NAV-002 | REQ-NAV-001 | 帮助文档第 8 页与注册原型 | 页面交互 | 从官网选择“登录/注册”，再选择注册入口并返回登录 | 展示企业注册字段组和提交入口；可返回登录表单 | 场景法与交互断言 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-020 | 与“立即使用”路径独立，不断言字段保留或动画时序 |
| RULE-LOGIN-001 | REQ-LOGIN-001 | 登录原型“登录页面” | 页面交互 | 选择验证码登录或账号登录入口 | 对应字段组与操作入口可见 | 交互断言 | 适用 | 已覆盖 | OPEN-PLATFORM-LOGIN-002 | 不由代码反推默认模式 |
| RULE-LOGIN-002 | REQ-LOGIN-002 | 登录原型“登录页面” | 业务规则 | 检查手机号、验证码、协议和登录控件并最多请求一次验证码 | 表单与获取验证码入口可见；请求事实可记录 | 场景法 | 受控执行 | 受控执行 | OPEN-PLATFORM-LOGIN-003 | 只授权短信请求，不提交验证码登录 |
| RULE-LOGIN-003 | REQ-LOGIN-002 | 登录原型“登录页面” | 页面交互 | 检查获取验证码、协议和登录控件 | 对应控件可见可操作；资料未定义的反馈不生成断言 | 交互断言 | 待补充 | 待补充 | OPEN-PLATFORM-LOGIN-003 | 缺少验证码反馈、重发间隔、协议阻断和验证码登录结果验收 |
| RULE-LOGIN-004 | REQ-LOGIN-003 | AIoT 需求“手机号、密码登录” | 业务规则 | 输入有效测试手机号和密码并提交 | 完成统一登录；遇安全挑战时仅人工完成挑战 | 场景法 | 受控执行 | 受控执行 | OPEN-PLATFORM-LOGIN-004 | 需要测试账号、执行授权和可能的安全挑战 |
| RULE-LOGIN-005 | REQ-LOGIN-004 | AIoT 需求“验证后默认进入AIoT控制台” | 状态流转 | 登录验证成功 | 当前会话进入 AIoT 控制台或可观察到等价目标 | 状态迁移 | 受控执行 | 受控执行 | OPEN-PLATFORM-LOGIN-004 | 依赖 RULE-LOGIN-004 |
| RULE-LOGIN-006 | REQ-LOGIN-005 | 登录原型“忘记密码” | 页面交互 | 选择忘记密码 | 进入密码恢复入口 | 交互断言 | 待补充 | 待补充 | OPEN-PLATFORM-LOGIN-006 | 恢复流程和成功验收未定义 |
| RULE-LOGIN-007 | REQ-LOGIN-003 | 现有资料仅定义有效手机号密码登录 | 异常与恢复 | 提交一次无效凭据 | 业务验收结果待用户裁决；裁决前只记录脱敏观察 | 场景法 | 待用户裁决 | 用户裁决 | OPEN-PLATFORM-LOGIN-005 | 最小问题：是否将无效凭据不得建立认证会话作为本次正式验收 |
| RULE-REG-001 | REQ-REG-001 | AIoT 需求“企业名称” | 输入边界 | 企业名称为空 | 阻止提交并提示“请输入集团名称” | 等价类 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-001 | 零写入本地校验优先 |
| RULE-REG-002 | REQ-REG-001 | AIoT 需求“企业名称长度” | 输入边界 | 企业名称长度为 1、2、50、51 字符 | 2–50 字符有效，越界被拒绝 | 边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-001 | 使用合成文本 |
| RULE-REG-003 | REQ-REG-001 | AIoT 需求“企业名称内容” | 输入边界 | 输入中文、英文、数字或特殊符号、表情 | 中文英文数字有效；特殊符号和表情被拒绝 | 等价类 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-001 | 空格规则未定义 |
| RULE-REG-004 | REQ-REG-001 | AIoT 需求“企业名称唯一性” | 集成与数据一致性 | 输入已注册的隔离测试企业名称 | 作为重复名称被拒绝 | 决策表 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-002 | 精确重复提示由 RULE-REG-025 负责 |
| RULE-REG-005 | REQ-REG-002 | AIoT 需求“企业信用代码必填” | 输入边界 | 企业信用代码为空 | 阻止提交 | 等价类 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-003 | 资料未定义空值提示正文 |
| RULE-REG-006 | REQ-REG-002 | AIoT 需求“企业信息用代码唯一性” | 集成与数据一致性 | 输入已注册的隔离测试统一社会信用代码 | 作为重复信用代码被拒绝 | 决策表 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-004 | 精确重复提示由 RULE-REG-025 负责 |
| RULE-REG-007 | REQ-REG-003 | AIoT 需求“企业地址” | 输入边界 | 地址为空或长度为 50、51 字符 | 空值提示“请输入企业地址”；最多 50 字符有效 | 等价类与边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-005 | 地址有效性语义未定义 |
| RULE-REG-008 | REQ-REG-003 | 帮助文档第 9 页“企业地址” | 状态流转 | 企业申请已提交 | 企业地址不可修改 | 状态迁移 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-006 | 只在可观察入口存在时验证，不追加修改写入 |
| RULE-REG-009 | REQ-REG-004 | AIoT 需求与帮助文档“企业标识” | 输入边界 | 检查常驻提示；输入空值、2、3、6、7 位，或含大写和特殊字符 | 持续展示“请输入3-6 位小写字母或数字，用作产品Model的组成部分”的完整语义；必填，3–6 位小写字母或数字有效，其他被拒绝 | 等价类与边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-007 | 产品 Model 下游使用不在本次执行 |
| RULE-REG-010 | REQ-REG-004 | AIoT 需求“企业标识唯一性” | 集成与数据一致性 | 输入已存在的隔离企业标识 | 作为重复企业标识被拒绝 | 决策表 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-008 | 精确重复提示由 RULE-REG-025 负责 |
| RULE-REG-011 | REQ-REG-005 | 帮助文档第 9 页“上传营业执照” | 输入边界 | 未上传营业执照 | 阻止提交 | 等价类 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-009 | 资料未定义空值提示正文 |
| RULE-REG-012 | REQ-REG-005 | 帮助文档第 9 页“上传营业执照” | 输入边界 | 上传 PNG、JPEG、JPG 或其他格式，大小不超过或超过 10MB | 允许指定格式且不超过 10MB；拒绝其他格式或超限文件 | 等价类与边界值 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-009 | 使用合成文件；上传需执行授权 |
| RULE-REG-013 | REQ-REG-006 | AIoT 需求“申请人姓名” | 输入边界 | 姓名为空、20、21 字符，或中英文、其他字符 | 空值提示“请输入联系人名称”；最多 20 字符；中英文有效 | 等价类与边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-010 | 其他字符和空格预期未定义，不生成断言 |
| RULE-REG-014 | REQ-REG-007 | AIoT 需求“联系方式” | 输入边界 | 联系方式为空、10、11、12 位或非数字 | 必填且仅 11 位手机号进入有效路径 | 等价类与边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-021 | 使用专用本机测试手机号引用 |
| RULE-REG-015 | REQ-REG-007、REQ-REG-010 | 注册原型“获取验证码”；帮助文档“进行手机号验证” | 业务规则 | 对有效专用测试手机号请求验证码并完成验证 | 手机号完成验证后可继续注册路径 | 场景法 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-011 | 不绕过验证码；敏感采集暂停 |
| RULE-REG-016 | REQ-REG-008 | AIoT 需求与帮助文档“企业简介、企业邮箱” | 输入边界 | 简介为空、300、301；邮箱为空、有效/无效、50、51 字符 | 两字段选填；简介最多 300，邮箱满足格式且最多 50 字符 | 等价类与边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-022 | 两字段由独立 caseId 报告 |
| RULE-REG-017 | REQ-REG-006、REQ-REG-007 | AIoT 需求与帮助文档“申请人姓名、公司联系人、联系方式” | 权限/身份 | 以申请人和联系方式提交注册并审核通过 | 申请人成为企业管理员，申请人姓名成为账号名称，联系方式成为管理员账号 | 角色矩阵 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-017 | 需后台状态或审核结果证据 |
| RULE-REG-018 | REQ-REG-010 | 注册原型与帮助文档第 9 页 | 分支/决策 | 必填项、唯一性、手机验证、协议状态组成提交条件 | 仅满足全部已定义条件时进入“同意条款并注册”提交路径；任一条件无效时提交入口不可激活且无提交请求 | 决策表 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 四类负向条件和有效提交独立报告 |
| RULE-REG-019 | REQ-REG-010 | 帮助文档第 9 页“同意条款并注册” | 状态流转 | 提交一次有效合成企业申请 | 唯一合成标识只解析为 1 条平台已接受且进入审核链路的申请；即时状态名称不作断言 | 状态迁移 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-014 | 首次 tracked_residual 最大 1 条；只读结果证据缺失时不得通过 |
| RULE-REG-020 | REQ-REG-011 | 帮助文档第 9 页“1–2个工作日” | 状态流转 | 企业申请处于待审核状态 | 在 1–2 个工作日内产生审核结果 | 状态迁移 | 待补充 | 待补充 | OPEN-PLATFORM-REGISTRATION-015 | 需要可恢复等待与后台状态查询能力 |
| RULE-REG-021 | REQ-REG-011 | 帮助文档第 9 页“短信通知” | 集成与数据一致性 | 彼此隔离的申请分别审核通过或驳回 | 通过与驳回结果分别通过短信通知专用测试联系方式 | 集成路径 | 待补充 | 待补充 | OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-034 | 不记录短信原文、验证码、反馈原文或账号密码 |
| RULE-REG-022 | REQ-REG-012 | 帮助文档第 9 页“审核不通过、审核通过” | 异常与恢复 | 彼此隔离的申请审核不通过或审核通过 | 不通过收到结果通知并可按反馈重提；通过收到结果和账号密码通知并可登录资源 | 状态迁移与恢复路径 | 待补充 | 待补充 | OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-034 | 需要可控审核分支、独立通知证据和恢复授权 |
| RULE-REG-023 | REQ-REG-009 | 帮助文档第 9 页“一个用户账号可加入多个企业组” | 权限/身份 | 同一用户账号关联多个企业组 | 每个用户账号可加入多个企业组 | 角色矩阵 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-018 | 使用既有隔离关系只读验证 |
| RULE-REG-024 | REQ-REG-009 | 帮助文档第 9 页“每个企业只能申请一个企业管理员账号” | 权限/身份 | 同一企业重复申请管理员账号 | 每个企业仅有一个企业管理员账号 | 角色矩阵 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-019 | 需要隔离数据或后台查询，不创建批量申请 |
| RULE-REG-025 | REQ-REG-013 | AIoT 需求“注册唯一性提示” | 集成与数据一致性 | 企业名称、企业标识或统一社会信用代码与隔离既有数据重复 | 分别展示资料定义的三类重复提示，提交入口不可激活且无提交请求 | 决策表 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-023 | 精确提示契约与字段唯一性规则职责分离 |
| RULE-REG-026 | REQ-REG-010 | 注册原型与帮助文档第 9 页“进行手机号验证” | 分支/决策 | 其他注册条件有效但手机号未完成验证 | 提交入口不可激活且无提交请求；验证完成后才满足该项提交条件 | 决策表 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-024 | 手机验证路径与提交条件分别报告 |
| RULE-REG-027 | REQ-REG-007 | AIoT 需求与帮助文档“联系方式作为企业管理员账号” | 权限/身份 | 企业申请审核通过 | 注册联系方式对应企业管理员账号 | 角色矩阵 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-017 | 单一主 REQ 关系规则，用于保持联系方式与管理员账号追溯 |
| RULE-REG-028 | REQ-REG-001 | 帮助文档第 9 页“企业名称与营业执照一致” | 集成与数据一致性 | 合成企业名称与证照名称一致或不一致 | 一致满足业务条件；不一致不能进入可通过审核的结果 | 等价类与跨字段一致性 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-033 | 前端不解析时依赖受控审核证据 |
| RULE-REG-029 | REQ-REG-001 | 帮助文档第 9 页“提交后不可修改” | 状态流转 | 企业申请已提交 | 企业名称无修改入口或为只读 | 状态迁移 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-027 | 使用已提交隔离申请只读核验 |
| RULE-REG-030 | REQ-REG-001 | 帮助文档第 9 页“登录后显示企业组名称” | 集成与数据一致性 | 企业审核通过并以管理员登录 | 企业组名称与注册企业名称一致 | 后置一致性 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-028 | 需企业组名称稳定展示入口 |
| RULE-REG-031 | REQ-REG-002 | 帮助文档第 8 页“0/18” | 输入边界 | 信用代码长度为 18、19 字符 | 18 字符通过长度上界校验；19 字符被截断或拒绝 | 边界值 | 适用 | 已覆盖 | OPEN-PLATFORM-REGISTRATION-030 | 不推断最小长度、字符集和校验位算法 |
| RULE-REG-032 | REQ-REG-002 | 帮助文档第 9 页“与营业执照一致” | 集成与数据一致性 | 合成信用代码与证照代码一致或不一致 | 一致满足条件；不一致不能进入可通过审核的结果 | 跨字段一致性 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-031 | 前端不解析时依赖受控审核证据 |
| RULE-REG-033 | REQ-REG-005 | 帮助文档第 9 页“最新三证合一营业执照扫描件或照片” | 输入边界 | 合成三证合一扫描件或照片、非证照图片 | 证照内容类别满足资料要求；格式可上传不等于内容有效 | 等价类 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-032 | 使用脱敏合成资产，内容审核能力待补 |
| RULE-REG-034 | REQ-REG-009 | AIoT 需求“一个手机号可以注册多个企业” | 权限/身份 | 同一专用手机号关联多个企业注册关系 | 同一手机号可注册多个企业 | 角色矩阵 | 受控执行 | 受控执行 | OPEN-PLATFORM-REGISTRATION-029 | 与账号加入多个企业组独立判定 |

## 规则设计矩阵

> 结构版本：rule-design-matrix-v1

| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-NAV-001 | 官网立即使用入口 | 不适用 | 选择“立即使用” | 进入可辨识登录页面 | 不需要远端业务数据 | 零写入页面导航 | OPEN-PLATFORM-LOGIN-001 | 已覆盖 |
| RULE-NAV-002 | 官网登录/注册入口与注册页签 | 不适用 | 选择“登录/注册”、选择注册、返回登录 | 注册字段组与提交入口可见且可返回登录 | 不需要远端业务数据 | 零写入路径与页签切换 | OPEN-PLATFORM-REGISTRATION-020 | 已覆盖 |
| RULE-LOGIN-001 | 登录模式 | 不适用 | 验证码登录、账号登录 | 对应字段组与操作入口可见 | 不需要远端业务数据 | 零写入模式切换 | OPEN-PLATFORM-LOGIN-002 | 已覆盖 |
| RULE-LOGIN-002 | 验证码登录表单 | 必填 | 专用测试手机号与一次验证码请求 | 表单与请求入口可见；请求事实可观察，不提交登录 | 专用测试手机号与验证码通道 | 最多 1 次短信请求、独立执行授权 | OPEN-PLATFORM-LOGIN-003 | 受控执行 |
| RULE-LOGIN-003 | 验证码控件 | 不适用 | 获取验证码、协议与登录控件 | 仅验证控件可见可操作，不断言未定义反馈 | 不需要远端业务数据；请求步骤另授权 | 不发送时零写入；发送时独立授权；不认证 | OPEN-PLATFORM-LOGIN-003 | 待补充 |
| RULE-LOGIN-004 | 手机号密码登录 | 必填 | 有效测试手机号和密码 | 有效凭据完成统一登录；安全挑战不绕过 | 开放平台测试账号 | 最多 1 次认证提交与安全挑战 | OPEN-PLATFORM-LOGIN-004 | 受控执行 |
| RULE-LOGIN-005 | 登录会话目标 | 不适用 | 登录验证成功 | 当前会话进入 AIoT 控制台或等价目标 | 已成功建立隔离会话 | 只读目标核验并关闭会话 | OPEN-PLATFORM-LOGIN-004 | 受控执行 |
| RULE-LOGIN-006 | 忘记密码入口 | 不适用 | 选择忘记密码 | 进入密码恢复入口 | 不需要远端业务数据 | 零写入入口导航 | OPEN-PLATFORM-LOGIN-006 | 待补充 |
| RULE-LOGIN-007 | 无效凭据 | 必填 | 提交一次无效凭据 | 裁决前仅记录观察，不形成正式通过失败 | 独立无效测试凭据 | 用户裁决后再独立授权 | OPEN-PLATFORM-LOGIN-005 | 用户裁决 |
| RULE-REG-001 | 企业名称必填 | 必填 | 空值、有效合成名称 | 空值被拒绝并显示资料提示 | 不需要既有远端数据 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-001 | 已覆盖 |
| RULE-REG-002 | 企业名称长度 | 必填 | 1、2、50、51 字符 | 2–50 字符有效，越界被拒绝 | 合成企业名称 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-001 | 已覆盖 |
| RULE-REG-003 | 企业名称字符 | 必填 | 中文、英文、数字、特殊符号、表情 | 中文英文数字有效；特殊符号和表情被拒绝 | 合成企业名称 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-001 | 已覆盖 |
| RULE-REG-004 | 企业名称唯一性 | 必填 | 已登记重复名称、合成唯一名称 | 重复名称被拒绝 | 已登记隔离企业名称 | 唯一性服务校验与执行授权 | OPEN-PLATFORM-REGISTRATION-002 | 受控执行 |
| RULE-REG-005 | 企业信用代码必填 | 必填 | 空值、合成唯一值 | 空值被拒绝 | 合成统一社会信用代码 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-003 | 已覆盖 |
| RULE-REG-006 | 企业信用代码唯一性 | 必填 | 已登记重复代码、合成唯一代码 | 重复代码被拒绝 | 已登记隔离统一社会信用代码 | 唯一性服务校验与执行授权 | OPEN-PLATFORM-REGISTRATION-004 | 受控执行 |
| RULE-REG-007 | 企业地址 | 必填 | 空值、50、51 字符、合成有效地址 | 空值和超限被拒绝，50 字符内可继续 | 合成企业地址 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-005 | 已覆盖 |
| RULE-REG-008 | 企业地址提交后状态 | 不适用 | 已提交隔离申请、修改入口 | 企业地址无修改入口或只读 | 已登记已提交隔离申请 | 后置只读核验 | OPEN-PLATFORM-REGISTRATION-006 | 受控执行 |
| RULE-REG-009 | 企业标识提示、必填、格式和长度 | 必填 | 常驻提示、空值、2、3、6、7 位及非法字符 | 完整提示持续可见；空值被拒绝；3–6 位小写字母或数字有效 | 合成企业标识 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-007 | 已覆盖 |
| RULE-REG-010 | 企业标识唯一性 | 必填 | 已登记重复标识、合成唯一标识 | 重复标识被拒绝 | 已登记隔离企业标识 | 唯一性服务校验与执行授权 | OPEN-PLATFORM-REGISTRATION-008 | 受控执行 |
| RULE-REG-011 | 营业执照必填 | 必填 | 未上传、合成营业执照 | 未上传时阻止提交 | 合成营业执照候选 | 不提交申请；上传另授权 | OPEN-PLATFORM-REGISTRATION-009 | 已覆盖 |
| RULE-REG-012 | 营业执照文件属性 | 必填 | PNG/JPEG/JPG、其他格式、小于/等于/大于 10MB | 指定格式且不超过 10MB 可上传，其他被拒绝 | 合成营业执照与边界文件 | 每类最多 1 次上传并脱敏 | OPEN-PLATFORM-REGISTRATION-009 | 受控执行 |
| RULE-REG-013 | 申请人姓名 | 必填 | 空、20、21 字符、中文、英文 | 空值提示“请输入联系人名称”；最多 20 字符且中英文有效 | 合成申请人姓名 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-010 | 已覆盖 |
| RULE-REG-014 | 联系方式格式 | 必填 | 空、10、11、12 位、非数字 | 仅有效 11 位手机号进入验证路径 | 专用测试手机号脱敏引用 | 零写入格式校验优先 | OPEN-PLATFORM-REGISTRATION-021 | 已覆盖 |
| RULE-REG-015 | 注册手机号验证 | 必填 | 有效专用测试手机号与验证码 | 完成验证后可继续注册路径 | 专用测试手机号与验证码通道 | 最多 1 次短信请求与人工挑战 | OPEN-PLATFORM-REGISTRATION-011 | 受控执行 |
| RULE-REG-016 | 企业简介和邮箱 | 选填 | 简介空/300/301；邮箱空/有效/无效/50/51 | 简介最多 300，邮箱满足格式且最多 50 | 合成简介与邮箱 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-022 | 已覆盖 |
| RULE-REG-017 | 注册人管理员身份 | 不适用 | 审核通过的隔离申请 | 申请人成为管理员，申请人姓名成为账号名称，联系方式成为管理员账号 | 已通过隔离申请与账号 | 后台只读、每例 1 次脱敏登录并关闭会话 | OPEN-PLATFORM-REGISTRATION-017 | 受控执行 |
| RULE-REG-018 | 注册提交决策 | 必填 | 全部有效及四类单项无效 | 仅全部有效时进入提交路径；单项无效时提交入口不可激活且无提交请求 | 每个负向场景绑定彼此隔离、可恢复的预登记有效表单夹具 | 负向不新增副作用；夹具不可用时阻塞单例并重开授权；正向最多 1 条申请 | OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 受控执行 |
| RULE-REG-019 | 首次申请提交 | 不适用 | 单次有效合成注册提交 | 唯一合成标识只解析为 1 条平台已接受且进入审核链路的申请 | CreateIntent、全套合成数据与稳定只读结果入口 | 首次申请预算 1 与独立授权；证据缺失不通过 | OPEN-PLATFORM-REGISTRATION-014 | 受控执行 |
| RULE-REG-020 | 审核时限 | 不适用 | 待审核隔离申请 | 1–2 个工作日内产生结果 | 预登记待审核隔离申请 | 可恢复等待与后台只读 | OPEN-PLATFORM-REGISTRATION-015 | 待补充 |
| RULE-REG-021 | 审核短信 | 不适用 | 审核通过、审核驳回 | 两种互斥结果分别送达专用联系方式 | 预登记通过与驳回隔离申请及通知事实 | 只记录脱敏送达事实 | OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-034 | 待补充 |
| RULE-REG-022 | 审核分支与恢复 | 不适用 | 驳回或通过的隔离申请 | 驳回收到通知并可重提；通过收到账号信息并可登录 | 独立驳回与通过状态资源 | 重提预算另确认；通过分支每例独立登录并关闭会话 | OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-034 | 待补充 |
| RULE-REG-023 | 用户账号多企业关系 | 不适用 | 同一隔离账号关联多个企业组 | 账号可加入多个企业组 | 既有隔离账号与关系 | 后台只读 | OPEN-PLATFORM-REGISTRATION-018 | 受控执行 |
| RULE-REG-024 | 企业管理员唯一性 | 不适用 | 同一企业重复申请管理员 | 重复关系被提交前阻断或约束证据成立 | 隔离企业与管理员关系 | 不创建第二条申请 | OPEN-PLATFORM-REGISTRATION-019 | 受控执行 |
| RULE-REG-025 | 三类唯一性提示 | 必填 | 重复名称、标识、信用代码 | 分别显示资料提示；提交入口不可激活且无提交请求 | 已登记隔离重复数据 | 唯一性服务校验与执行授权 | OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-023 | 受控执行 |
| RULE-REG-026 | 手机号验证提交条件 | 必填 | 未验证、完成受控验证 | 未验证时提交入口不可激活且无提交请求；验证后满足该条件 | 专用手机号与验证码通道 | 验证请求独立授权；负向不发送 | OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-024 | 受控执行 |
| RULE-REG-027 | 联系方式管理员账号映射 | 不适用 | 审核通过 | 注册联系方式对应管理员账号 | 已通过隔离申请与账号 | 后台只读与脱敏登录授权 | OPEN-PLATFORM-REGISTRATION-017 | 受控执行 |
| RULE-REG-028 | 企业名称与证照一致 | 必填 | 名称一致、不一致 | 一致获接受，不一致被拒绝 | 与输入精确绑定的匹配/不匹配只读审核夹具 | 不上传或提交；夹具绑定无法证明时不通过 | OPEN-PLATFORM-REGISTRATION-033 | 受控执行 |
| RULE-REG-029 | 企业名称提交后状态 | 不适用 | 已提交隔离申请 | 企业名称无修改入口或只读 | 已提交隔离申请 | 后置只读核验 | OPEN-PLATFORM-REGISTRATION-027 | 受控执行 |
| RULE-REG-030 | 企业组名称 | 不适用 | 审核通过并登录 | 企业组名称与注册名称一致 | 已通过隔离申请与会话 | 登录与展示入口只读核验 | OPEN-PLATFORM-REGISTRATION-028 | 受控执行 |
| RULE-REG-031 | 信用代码长度上界 | 必填 | 18、19 字符 | 18 字符通过长度上界校验；19 字符被截断或拒绝 | 合成统一社会信用代码 | 零写入本地校验优先 | OPEN-PLATFORM-REGISTRATION-030 | 已覆盖 |
| RULE-REG-032 | 信用代码与证照一致 | 必填 | 代码一致、不一致 | 一致获接受，不一致被拒绝 | 与输入精确绑定的匹配/不匹配只读审核夹具 | 不上传或提交；夹具绑定无法证明时不通过 | OPEN-PLATFORM-REGISTRATION-031 | 受控执行 |
| RULE-REG-033 | 三证合一证照内容 | 必填 | 最新三证合一扫描件/照片、非证照图片 | 指定证照类别获接受；普通图片被拒绝 | 与文件摘要及结果精确绑定的只读审核夹具 | 不上传或提交；夹具绑定无法证明时不通过 | OPEN-PLATFORM-REGISTRATION-032 | 受控执行 |
| RULE-REG-034 | 同手机号多企业 | 不适用 | 同一专用手机号关联多个企业 | 同一手机号可注册多个企业 | 既有隔离手机号企业关系 | 后台只读，不批量创建 | OPEN-PLATFORM-REGISTRATION-029 | 受控执行 |

## 规则邻域复核

| 触发发现项 | 邻域 RULE | 共同依据 | 修订 caseId | 关系同步与规则设计预检结果 |
| --- | --- | --- | --- | --- |
| REV-20260727-ACCOUNT-01 初审自动演进 | RULE-NAV-001、RULE-NAV-002、RULE-LOGIN-001、RULE-LOGIN-002、RULE-LOGIN-003、RULE-LOGIN-004、RULE-LOGIN-005、RULE-LOGIN-006、RULE-LOGIN-007、RULE-REG-001、RULE-REG-002、RULE-REG-003、RULE-REG-004、RULE-REG-005、RULE-REG-006、RULE-REG-007、RULE-REG-008、RULE-REG-009、RULE-REG-010、RULE-REG-011、RULE-REG-012、RULE-REG-013、RULE-REG-014、RULE-REG-015、RULE-REG-016、RULE-REG-017、RULE-REG-018、RULE-REG-019、RULE-REG-020、RULE-REG-021、RULE-REG-022、RULE-REG-023、RULE-REG-024、RULE-REG-025、RULE-REG-026、RULE-REG-027、RULE-REG-028、RULE-REG-029、RULE-REG-030、RULE-REG-031、RULE-REG-032、RULE-REG-033、RULE-REG-034 | 同一账号访问请求、字段邻域、提交决策、审核状态、证照一致性与账号企业关系 | OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-REGISTRATION-001 至 OPEN-PLATFORM-REGISTRATION-033 | 关系同步通过；规则设计与 Markdown 通过；架构 108 通过、2 警告、0 失败；环境 3 通过、2 警告、0 失败 |
| REV-20260727-ACCOUNT-02 最终复审自动演进 | RULE-NAV-001、RULE-NAV-002、RULE-LOGIN-002、RULE-LOGIN-003、RULE-REG-009、RULE-REG-013、RULE-REG-017、RULE-REG-018、RULE-REG-019、RULE-REG-021、RULE-REG-022、RULE-REG-025、RULE-REG-026、RULE-REG-028、RULE-REG-032、RULE-REG-033 | 两条官网入口、验证码请求边界、企业标识与申请人姓名、独立提交基线、证照审核夹具、通过与驳回短信、认证与写入隔离 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 关系同步、规则设计与 Markdown 通过；架构 108 通过、2 警告、0 失败；环境 3 通过、2 警告、0 失败 |

## 用例包目录

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 生成状态 | 特殊门禁 |
| --- | --- | --- | --- | --- | --- |
| `cases-login.md` | 登录入口与认证 | 官网入口、登录注册切换、验证码登录、手机号密码登录、登录后控制台和忘记密码入口 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-LOGIN-006 | 草案完整 | 验证码、账号登录和安全挑战需执行授权 |
| `cases-registration.md` | 企业注册与审核 | 注册入口、字段、边界、唯一性、验证码、协议、合成文件上传、提交、互斥审核状态、字段后置状态和账号关系 | OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 草案完整 | 首次申请预算 1 已确认；重提预算 1 待确认且不得同批；总持久写入上限 2；短信、上传、认证和审核分支需独立执行授权 |

## 变更影响分析

| 变更编号 | 来源与版本 | 受影响需求追溯编号 | 影响判定与依据 | 受影响 caseId | 脚本/工程设计影响 | 数据/环境影响 | 是否复测与结论 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IMP-20260727-001 | `REV-20260727-ACCOUNT-01` 初审、`REV-20260727-ACCOUNT-02` 最终复审；当前受控资料基线 | REQ-NAV-001、REQ-LOGIN-001、REQ-LOGIN-002、REQ-LOGIN-003、REQ-LOGIN-004、REQ-LOGIN-005、REQ-REG-001、REQ-REG-002、REQ-REG-003、REQ-REG-004、REQ-REG-005、REQ-REG-006、REQ-REG-007、REQ-REG-008、REQ-REG-009、REQ-REG-010、REQ-REG-011、REQ-REG-012、REQ-REG-013 | 新请求无既有正式脚本迁移；两轮评审补齐入口、字段提示、状态隔离、证照审核证据、通过与驳回通知，并拆分原聚合用例 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-028、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-030、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 关系同步与 43 条规则设计需以当前 40 条 caseId 为工程输入；后续脚本按副作用边界和场景组唯一绑定 | 首次申请、重提、短信、认证、上传、决策基线和互斥审核资源分别隔离；重提预算待确认 | 是；两轮缺口自动演进后需完成静态校验与下一轮最终复审 | 自动演进中 |

## 合理推断

- 用户所称“开放平台”唯一匹配当前仓库已登记的 `open-platform` Web 项目，因此使用该项目的需求、原型、帮助文档和项目经验。
- 用户未指定环境，按已记录的长期偏好把 `test` 作为候选；环境选择不构成验证码、登录、文件上传、注册提交或正式执行授权。
- 登录原型中的验证码登录和账号登录入口都属于本次登录覆盖；AIoT 需求明确的“手机号、密码登录”仍是可判定主规则，原型未定义的验证码反馈和协议阻断不被推断为业务事实。
- 注册 FAQ 的受控索引页码与 PDF 物理页存在一页定位差异；以实际视觉核对到的第 8–9 页内容作为引用，索引 SHA-256 已通过校验。

## 待补充信息

- 验证码登录和注册验证码的成功提示、有效期、重发间隔、频控和失败反馈未定义；在补充资料或用户裁决前不生成这些精确断言。
- 登录密码策略、错误次数锁定、会话有效期、退出和失效恢复未定义；无效凭据是否“不得建立认证会话”作为正式业务验收待用户裁决，裁决前只记录观察且不猜测提示正文。
- 忘记密码的身份校验、验证码、密码规则、完成页和返回登录流程未定义；当前只覆盖入口与跳转。
- 企业信用代码最小长度、字符集和校验位算法、企业地址“有效”的具体判定、申请人姓名的空格与特殊字符规则未定义；信用代码最大 18 字符已由资料的 `0/18` 计数器明确。
- 注册成功页或提交反馈正文未定义；首次提交用例只记录单次提交事实，资料明确的最终结果由后续审核与短信证据闭环。
- 企业审核结果的后台查询入口、可控通过或驳回方式，以及 1–2 个工作日等待期间的恢复机制未确认。
- `tracked_residual` 企业申请没有已登记清理能力；首次申请最多 1 条已获计划预算确认，驳回后重提最多 1 条仍待单独确认，二者都需 72 小时复核和独立执行授权。

## 风险与审核事项

- 计划确认只允许进入用例生成；不授权读取或输出凭据值，也不授权访问业务服务、发送短信、上传文件、提交注册或执行测试。
- 密码、验证码、联系方式、营业执照、Cookie、会话和审核短信均为敏感信息；任何阶段不得写入 Git、计划、用例、日志、截图、Trace、视频或回复。
- 注册执行的首次提交最多产生 1 条企业申请；驳回重提最多再产生 1 条且仍待单独确认。两类写入总上限为 2、不得进入同一执行批次，均无已登记自动清理能力，并可能伴随短信、上传或认证副作用；正式执行前必须分别绑定不可变清单、台账和独立授权。
- 安全挑战不得绕过。正式执行遇到滑块、验证码或人机验证时，仅请求用户完成最小挑战，随后自动恢复确定性步骤。
- 帮助文档受控索引把注册 FAQ 标为第 9–15 页，实际注册入口从物理第 8 页开始；该定位差异不改变文档 SHA-256 或规则正文，但评审时必须引用实际页。

## 多角色评审记录

> 结构版本：multi-role-review-v1

> 结构版本：evidence-driven-evolution-v1

> 结构版本：reviewer-execution-v1

> 结构版本：auto-evolution-loop-v1

> 结构版本：knowledge-decision-v1

`REV-20260727-ACCOUNT-01` 五角色初审已完成；资料明确缺口已自动演进并通过静态检查。下方 canonical 记录是 reviewer 运行事实、结论与发现项的唯一正式来源。

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/req_review_r1 | fork_turns=none | 原始资料、计划和完整用例包 | 已完成 | 阻塞 | MRR-REQ-001 至 MRR-REQ-007 | 6 项自动修订；1 项待用户裁决 |
| 测试设计评审 | 真实子智能体 | /root/design_review_r1 | fork_turns=none | 原始资料、计划、完整用例包和用例规范 | 已完成 | 需演进 | MRR-DES-001 至 MRR-DES-007 | 自动修订已完成 |
| 追溯审计 | 真实子智能体 | /root/trace_review_r1 | fork_turns=none | 计划、完整用例包和静态检查 | 已完成 | 需演进 | MRR-TRC-001 至 MRR-TRC-006 | 5 项自动修订；1 项非阻塞质量建议 |
| 交互与状态专项评审 | 真实子智能体 | /root/interaction_review_r1 | fork_turns=none | 原型、需求、计划和完整用例包 | 已完成 | 需演进 | MRR-INT-001 至 MRR-INT-008 | 自动修订已完成 |
| 变更影响评审 | 真实子智能体 | /root/impact_review_r1 | fork_turns=none | 计划、完整用例包和资料清单 | 已完成 | 需演进 | MRR-IMP-001 至 MRR-IMP-003 | 自动修订已完成 |

<!-- review-batch:REV-20260727-ACCOUNT-01:start -->
### 评审批次：REV-20260727-ACCOUNT-01

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 初审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md；sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 0 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/req_review_r1 | fork_turns=none | testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md；sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf | 已完成 | 阻塞 | MRR-REQ-001、MRR-REQ-002、MRR-REQ-003、MRR-REQ-004、MRR-REQ-005、MRR-REQ-006、MRR-REQ-007 | 自动演进 |
| 测试设计评审 | 真实子智能体 | /root/design_review_r1 | fork_turns=none | testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md；docs/testing/testcase-guideline.md | 已完成 | 需演进 | MRR-DES-001、MRR-DES-002、MRR-DES-003、MRR-DES-004、MRR-DES-005、MRR-DES-006、MRR-DES-007 | 自动演进 |
| 追溯审计 | 真实子智能体 | /root/trace_review_r1 | fork_turns=none | testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-TRC-001、MRR-TRC-002、MRR-TRC-003、MRR-TRC-004、MRR-TRC-005、MRR-TRC-006 | 自动演进 |
| 交互与状态专项评审 | 真实子智能体 | /root/interaction_review_r1 | fork_turns=none | testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/requirements/open-platform/AIoT平台项目.docx；sources/knowledge-base/open-platform/iot平台帮助文档.pdf | 已完成 | 需演进 | MRR-INT-001、MRR-INT-002、MRR-INT-003、MRR-INT-004、MRR-INT-005、MRR-INT-006、MRR-INT-007、MRR-INT-008 | 自动演进 |
| 变更影响评审 | 真实子智能体 | /root/impact_review_r1 | fork_turns=none | testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md；sources/manifest.yaml | 已完成 | 需演进 | MRR-IMP-001、MRR-IMP-002、MRR-IMP-003 | 自动演进 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-DES-001 | 测试设计评审 | REGISTRATION-013 聚合必填项缺失、唯一性失败、手机号未验证、协议未勾选四类独立失败原因，且前置无法独立建立其余有效条件；plan.md 的多条件决策表映射也遗漏 RULE-REG-018 与该 caseId。 | 资料明确的设计缺口 | REQ-REG-010、RULE-REG-018、OPEN-PLATFORM-REGISTRATION-013、plan.md#测试设计技术与依据 | 高 | 自动演进 | REGISTRATION-013、023、024、025 分别覆盖四类阻断；REGISTRATION-014 覆盖全有效提交；决策表已关联 RULE-REG-018、025、026。 | 已关闭 |
| MRR-DES-002 | 测试设计评审 | REGISTRATION-016 需要已驳回申请，REGISTRATION-017 需要已通过申请，当前最多 1 条 tracked_residual 申请无法同时提供互斥终态；驳回用例也未验证重新提交结果。 | 资料明确的设计缺口 | REQ-REG-011、REQ-REG-012、RULE-REG-020、RULE-REG-021、RULE-REG-022、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、plan.md#测试数据策略与残留台账 | 高 | 自动演进 | REGISTRATION-015、016、017、026 使用待审核、驳回、通过的独立预登记资源；REGISTRATION-016 已包含重新提交，独立预算 1 待确认。 | 已关闭 |
| MRR-DES-003 | 测试设计评审 | LOGIN-003 至 005、REGISTRATION-009、011、018 存在短信、认证会话或上传副作用却标记 no_write，计划未统一定义副作用类型、数量预算、残留或清理结论。 | 资料明确的设计缺口 | OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-011、OPEN-PLATFORM-REGISTRATION-018、plan.md#测试数据策略与残留台账、plan.md#执行清单映射 | 高 | 自动演进 | “非持久副作用与授权明细”逐 caseId 区分短信、认证、上传与申请；执行清单分别登记次数、授权和残留恢复。 | 已关闭 |
| MRR-DES-004 | 测试设计评审 | REGISTRATION-010 聚合申请人姓名和联系方式，REGISTRATION-012 聚合企业简介和邮箱，独立字段失败无法分别报告。 | 资料明确的设计缺口 | REQ-REG-006、REQ-REG-007、REQ-REG-008、RULE-REG-013、RULE-REG-014、RULE-REG-016、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-012 | 中 | 自动演进 | REGISTRATION-010、021、012、022 分别覆盖姓名、联系方式、简介与邮箱，RULE 关系已同步。 | 已关闭 |
| MRR-DES-005 | 测试设计评审 | REGISTRATION-015 同时验证 1–2 个工作日审核结果与短信送达，分别对应 RULE-REG-020、021，两个独立失败原因无法分别报告。 | 资料明确的设计缺口 | REQ-REG-011、RULE-REG-020、RULE-REG-021、OPEN-PLATFORM-REGISTRATION-015 | 中 | 自动演进 | REGISTRATION-015 仅覆盖审核时限，REGISTRATION-026 独立覆盖短信结果；RULE-REG-020、021 已分开映射。 | 已关闭 |
| MRR-DES-006 | 测试设计评审 | REQ-REG-005 明确营业执照为最新三证合一扫描件或照片、指定格式且不超过 10MB；REGISTRATION-009 未覆盖证照内容类别，且未把恰好 10MB 写成明确输入与独立断言。 | 需求覆盖缺口 | REQ-REG-005、RULE-REG-011、RULE-REG-012、OPEN-PLATFORM-REGISTRATION-009 | 高 | 自动演进 | REGISTRATION-009 明确小于、等于和大于 10MB；新增 RULE-REG-033 与 REGISTRATION-032 覆盖最新三证合一内容类别。 | 已关闭 |
| MRR-DES-007 | 测试设计评审 | REGISTRATION-019 只观察当前已有一个管理员，未触发唯一性校验或读取能够证明约束的后台状态，不能证明系统阻止第二个管理员申请。 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-024、OPEN-PLATFORM-REGISTRATION-019 | 高 | 自动演进 | REGISTRATION-019 改为提交前唯一性触发或权威只读约束证据，并断言前后管理员关系不增加。 | 已关闭 |

| MRR-TRC-001 | 追溯审计 | 覆盖基准与拆分清单使用 RULE 范围简写，但派生器只解析范围端点，导致多行派生 caseId 语义不完整而静态检查形式通过。 | 资料明确的设计缺口 | plan.md#覆盖基准与拆分清单、RULE-REG-001 至 RULE-REG-024、OPEN-PLATFORM-REGISTRATION-002 至 OPEN-PLATFORM-REGISTRATION-018 | 高 | 自动演进 | 覆盖基准、拆分清单和测试设计技术均已展开逐条 RULE；关系同步、规则设计和架构检查通过。 | 已关闭 |
| MRR-TRC-002 | 追溯审计 | 测试设计技术的多条件业务规则行误关联 RULE-REG-015、016、019，遗漏真正定义提交决策的 RULE-REG-018、026 与负向用例。 | 资料明确的设计缺口 | REQ-REG-010、RULE-REG-015、RULE-REG-016、RULE-REG-018、RULE-REG-019、RULE-REG-026、OPEN-PLATFORM-REGISTRATION-011 至 OPEN-PLATFORM-REGISTRATION-014 | 高 | 自动演进 | 决策表改为 RULE-REG-018、025、026，并关联 REGISTRATION-013、014、023、024、025。 | 已关闭 |
| MRR-TRC-003 | 追溯审计 | 规则设计矩阵 29 行中有 26 行关联 caseId 仍为待阶段二生成，仅新增 RULE-REG-025 至 027 已回填，矩阵无法形成有效反向追溯。 | 资料明确的设计缺口 | RULE-NAV-001、RULE-LOGIN-001 至 RULE-LOGIN-005、RULE-REG-001 至 RULE-REG-024、plan.md#规则设计矩阵 | 高 | 自动演进 | 43 条 RULE 均已在规则设计矩阵回填实际 caseId；规则设计与架构检查通过。 | 已关闭 |
| MRR-TRC-004 | 追溯审计 | 测试范围包含登录与注册页签切换，但 RULE-NAV-001 与 LOGIN-001 只验证入口可见可操作，未选择注册入口或断言进入注册页；注册用例均从已进入注册页开始。 | 需求覆盖缺口 | 测试范围：登录与注册页签切换、REQ-NAV-001、RULE-NAV-001、OPEN-PLATFORM-LOGIN-001、cases-registration.md | 高 | 自动演进 | 新增 RULE-NAV-002 与 REGISTRATION-020，实际选择注册入口、断言字段组并返回登录表单。 | 已关闭 |
| MRR-TRC-005 | 追溯审计 | LOGIN-003 至 005、REGISTRATION-009、011 标为 no_write，但执行清单混合验证码、登录、文件上传和企业申请创建，无法按 caseId 判定真实副作用与授权范围。 | 资料明确的设计缺口 | OPEN-PLATFORM-LOGIN-003 至 OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-011、plan.md#测试数据策略与残留台账、plan.md#执行清单映射 | 高 | 自动演进 | 执行清单按 caseId 拆分短信、认证、上传、首次申请和重提；各项次数、授权与残留边界已登记。 | 已关闭 |
| MRR-TRC-006 | 追溯审计 | RULE-REG-025 与 RULE-REG-004、006、010 定义并映射相同唯一性行为，未增加新可验证行为，形成重复语义和重复边。 | 质量建议 | REQ-REG-013、RULE-REG-004、RULE-REG-006、RULE-REG-010、RULE-REG-025、OPEN-PLATFORM-REGISTRATION-002、004、008 | 低 | 风险登记 | 非本次验收阻塞；建议明确聚合规则与字段规则的唯一追溯职责或去除重复边。 | 不适用 |

| MRR-REQ-001 | 需求一致性评审 | 帮助文档物理第9页明确企业名称须与营业执照名称一致、登录后作为企业组名称展示且提交后不可修改；当前仅覆盖必填、长度、字符和唯一性。 | 需求覆盖缺口 | REQ-REG-001、RULE-REG-001 至 RULE-REG-004、OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002 | 高 | 自动演进 | REQ-REG-001 已扩充；RULE-REG-028、029、030 与 REGISTRATION-033、027、028 分别覆盖一致性、不可改和企业组展示。 | 已关闭 |
| MRR-REQ-002 | 需求一致性评审 | 帮助文档物理第8页企业信用代码显示 0/18，第9页明确须与营业执照统一社会信用代码一致且不得重复；当前错误记录长度未定义并仅验证非空。 | 需求覆盖缺口 | REQ-REG-002、RULE-REG-005、RULE-REG-006、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004 | 高 | 自动演进 | REQ-REG-002 已补 18 字符与证照一致；RULE-REG-031、032 和 REGISTRATION-030、031 覆盖 17/18/19 与一致性。 | 已关闭 |
| MRR-REQ-003 | 需求一致性评审 | 帮助文档物理第8页企业邮箱显示 0/50，当前只覆盖选填与格式并把长度登记为未定义。 | 需求覆盖缺口 | REQ-REG-008、RULE-REG-016、OPEN-PLATFORM-REGISTRATION-012 | 中 | 自动演进 | REQ-REG-008、RULE-REG-016 与 REGISTRATION-022 已补邮箱 50/51 字符边界。 | 已关闭 |
| MRR-REQ-004 | 需求一致性评审 | 帮助文档物理第9页明确上传最新三证合一营业执照扫描件或照片；当前只验证必传、格式和大小，任意合成图片即可通过。 | 资料明确的设计缺口 | REQ-REG-005、RULE-REG-011、RULE-REG-012、OPEN-PLATFORM-REGISTRATION-009、OPEN-PLATFORM-REGISTRATION-014 | 中 | 自动演进 | RULE-REG-033 与 REGISTRATION-032 独立覆盖脱敏三证合一扫描件或照片内容类别；REGISTRATION-009 保留文件属性。 | 已关闭 |
| MRR-REQ-005 | 需求一致性评审 | 需求文档明确一个手机号可以注册多个企业，帮助文档另行明确一个用户账号可加入多个企业组；当前将两项合并，只验证既有账号加入多个企业组。 | 需求覆盖缺口 | REQ-REG-009、RULE-REG-023、OPEN-PLATFORM-REGISTRATION-018 | 高 | 自动演进 | REQ-REG-009 拆分三类关系；RULE-REG-023、024、034 与 REGISTRATION-018、019、029 分别覆盖。 | 已关闭 |
| MRR-REQ-006 | 需求一致性评审 | 帮助文档物理第9页明确审核不通过后根据反馈重新发起申请；当前只进入重提路径并修改数据，明确不再次提交。 | 需求覆盖缺口 | REQ-REG-012、RULE-REG-022、OPEN-PLATFORM-REGISTRATION-016 | 高 | 自动演进 | REGISTRATION-016 已补修改后重新提交和回到审核链路的断言；独立预算 1 明确待用户确认。 | 已关闭 |
| MRR-REQ-007 | 需求一致性评审 | 资料只定义手机号密码登录主链路，未定义无效凭据验收；当前 LOGIN-005 将无效凭据不得进入成功态作为正式通过失败断言。 | 业务裁决/资料冲突 | REQ-LOGIN-003、RULE-LOGIN-004、OPEN-PLATFORM-LOGIN-005 | 中 | 用户裁决 | 最小裁决：确认无效凭据不得建立认证会话是否作为本次正式业务验收；未确认前仅登记为非阻塞质量建议。 | 待用户裁决 |

| MRR-IMP-001 | 变更影响评审 | 这是独立新请求且无既有脚本迁移，但规则邻域只到 RULE-REG-024，新增 RULE-REG-025 至 027 后变更影响分析仍记录无变更、无受影响 caseId。 | 资料明确的设计缺口 | RULE-REG-025、RULE-REG-026、RULE-REG-027、OPEN-PLATFORM-REGISTRATION-002、004、008、011、017、plan.md#规则邻域复核、plan.md#变更影响分析 | 中 | 自动演进 | 规则邻域已扩展到 RULE-REG-034；IMP-20260727-001 记录受影响 REQ/caseId、后续脚本绑定和复测。 | 已关闭 |
| MRR-IMP-002 | 变更影响评审 | LOGIN-003 至 005、REGISTRATION-009、011 定义为 no_write 和零预算，但执行清单允许验证码、登录和上传并统一写成企业注册申请预算 1，无法逐 caseId 判定授权和残留影响。 | 资料明确的设计缺口 | RULE-LOGIN-002、RULE-LOGIN-004、RULE-LOGIN-005、RULE-REG-012、RULE-REG-015、RULE-REG-026、OPEN-PLATFORM-LOGIN-003 至 005、OPEN-PLATFORM-REGISTRATION-009、011、plan.md#测试数据策略与残留台账、plan.md#执行清单映射 | 高 | 自动演进 | “非持久副作用与授权明细”和执行清单逐 caseId 登记短信、认证、上传和申请预算、授权及残留。 | 已关闭 |
| MRR-IMP-003 | 变更影响评审 | REGISTRATION-006、014 至 017 共用最多一条申请却依赖已提交、待审核、驳回和通过等互斥状态，变更影响分析和场景组未记录状态准备、顺序、恢复和重跑隔离。 | 资料明确的设计缺口 | REQ-REG-003、REQ-REG-010 至 012、RULE-REG-008、RULE-REG-019 至 022、OPEN-PLATFORM-REGISTRATION-006、014 至 017、plan.md#测试数据策略与残留台账、plan.md#页面场景组映射、plan.md#变更影响分析 | 高 | 自动演进 | 首次申请、已提交、待审核、驳回、通过状态分别登记；只读分支不迁移状态，REGISTRATION-016 独立重提预算和恢复点。 | 已关闭 |

| MRR-INT-001 | 交互与状态专项评审 | 帮助文档和计划范围包含登录与注册入口切换，但现有用例未实际选择注册页签或断言注册字段组出现。 | 需求覆盖缺口 | REQ-NAV-001、RULE-NAV-001、OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-REGISTRATION-001 至 019 | 高 | 自动演进 | RULE-NAV-002 与 REGISTRATION-020 覆盖注册入口选择、字段组和提交入口可见及返回登录。 | 已关闭 |
| MRR-INT-002 | 交互与状态专项评审 | 帮助文档明确企业名称提交后不可修改，当前仅覆盖名称输入和唯一性，地址不可修改用例不能替代名称状态迁移。 | 需求覆盖缺口 | REQ-REG-001、RULE-REG-001 至 004、OPEN-PLATFORM-REGISTRATION-001、002、006 | 高 | 自动演进 | RULE-REG-029 与 REGISTRATION-027 使用已提交隔离申请独立核验企业名称只读状态。 | 已关闭 |
| MRR-INT-003 | 交互与状态专项评审 | LOGIN-003 断言获取验证码控件产生可观察状态变化，但资料只定义入口，计划也明确反馈、有效期和重发规则未定义。 | 资料明确的设计缺口 | REQ-LOGIN-002、RULE-LOGIN-003、OPEN-PLATFORM-LOGIN-003 | 中 | 自动演进 | LOGIN-003 已删除未定义状态变化断言，仅记录控件可操作和获授权后的短信请求事实。 | 已关闭 |
| MRR-INT-004 | 交互与状态专项评审 | REGISTRATION-013 聚合四类失败状态且未定义组合间复位；前置又不发送验证码、不上传文件，无法建立其余条件有效的基线。 | 资料明确的设计缺口 | REQ-REG-010、RULE-REG-018、RULE-REG-026、OPEN-PLATFORM-REGISTRATION-011、013、014 | 高 | 自动演进 | REGISTRATION-013、023、024、025 分别声明独立有效基线、单一无效条件、复位与未提交证据。 | 已关闭 |
| MRR-INT-005 | 交互与状态专项评审 | REGISTRATION-014 以已提交或待审核二选一状态作为通过断言，但资料未定义即时页面状态名称，只定义后续审核和短信链路。 | 资料明确的设计缺口 | REQ-REG-010、REQ-REG-011、RULE-REG-019 至 021、OPEN-PLATFORM-REGISTRATION-014、015 | 高 | 自动演进 | REGISTRATION-014 已移除即时状态名称断言；REGISTRATION-015 与 026 通过可恢复审核和短信证据闭环。 | 已关闭 |
| MRR-INT-006 | 交互与状态专项评审 | REGISTRATION-006、014 至 017 共用一条申请却要求已提交、待审核、驳回和通过互斥状态，未定义隔离资源、状态准备、恢复、顺序或清理。 | 资料明确的设计缺口 | REQ-REG-003、REQ-REG-010 至 012、RULE-REG-008、RULE-REG-019 至 022、OPEN-PLATFORM-REGISTRATION-006、014 至 017 | 高 | 自动演进 | 数据策略与执行清单已分别登记首次申请及已提交、待审核、驳回、通过隔离资源、恢复点、预算和残留。 | 已关闭 |
| MRR-INT-007 | 交互与状态专项评审 | 帮助文档明确驳回后重新发起申请，REGISTRATION-016 只进入编辑并修改数据，不再次提交，标题与覆盖结论超过实际步骤。 | 需求覆盖缺口 | REQ-REG-012、RULE-REG-022、OPEN-PLATFORM-REGISTRATION-016 | 高 | 自动演进 | REGISTRATION-016 已增加受控重新提交和回到审核链路的预期；独立预算 1 明确待确认。 | 已关闭 |
| MRR-INT-008 | 交互与状态专项评审 | REGISTRATION-019 只复述平台不允许第二个管理员，未提供可执行动作、可观察阻断或前后关系状态。 | 资料明确的设计缺口 | REQ-REG-009、RULE-REG-024、OPEN-PLATFORM-REGISTRATION-019 | 高 | 自动演进 | REGISTRATION-019 已定义提交前触发或权威只读约束证据，并核验前后管理员关系不增加。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-DES-001 | 需求事实 | REQ-REG-010 → RULE-REG-018 → caseId | 资料已确认 | 待回链 |
| MRR-DES-002 | 需求事实 | REQ-REG-011、REQ-REG-012 → RULE-REG-020 至 RULE-REG-022 → caseId | 资料已确认 | 待回链 |
| MRR-DES-003 | 通用规则 | docs/testing/testcase-guideline.md#5.3、#5.7 | 资料已确认 | 已引用 |
| MRR-DES-004 | 需求事实 | REQ-REG-006 至 REQ-REG-008 → RULE-REG-013、014、016 → caseId | 资料已确认 | 待回链 |
| MRR-DES-005 | 需求事实 | REQ-REG-011 → RULE-REG-020、RULE-REG-021 → caseId | 资料已确认 | 待回链 |
| MRR-DES-006 | 需求事实 | REQ-REG-005 → RULE → caseId | 资料已确认 | 待回链 |
| MRR-DES-007 | 需求事实 | REQ-REG-009 → RULE-REG-024 → OPEN-PLATFORM-REGISTRATION-019 | 资料已确认 | 待回链 |
<!-- review-batch:REV-20260727-ACCOUNT-01:end -->

<!-- review-batch:REV-20260727-ACCOUNT-02:start -->
### 评审批次：REV-20260727-ACCOUNT-02

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 1 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/req_review_r2 | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-REQ2-001、MRR-REQ2-002、MRR-REQ2-003 | 自动演进 |
| 测试设计评审 | 真实子智能体 | /root/design_review_r2 | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；docs/testing/testcase-guideline.md；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-DES2-001、MRR-DES2-002、MRR-DES2-003、MRR-DES2-004 | 自动演进 |
| 追溯审计 | 真实子智能体 | /root/trace_review_r2 | fork_turns=none | sources/manifest.yaml；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-TRA2-001、MRR-TRA2-002 | 自动演进 |
| 交互与状态专项评审 | 真实子智能体 | /root/interaction_review_r2 | fork_turns=none | sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/requirements/open-platform/AIoT平台项目.docx；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-UX2-001、MRR-UX2-002 | 自动演进 |
| 变更影响评审 | 真实子智能体 | /root/impact_review_r2 | fork_turns=none | sources/manifest.yaml；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-CHG2-001、MRR-CHG2-002、MRR-CHG2-003、MRR-CHG2-004、MRR-CHG2-005 | 自动演进 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-TRA2-001 | 追溯审计 | plan.md 的测试数据策略与执行清单仍使用 caseId 起点至终点简写；逐范围展开后 OPEN-PLATFORM-REGISTRATION-006 同时落入零写入本地校验与读取既有隔离状态资源，导致授权范围重复且语义冲突。 | 资料明确的设计缺口 | plan.md#测试数据策略与残留台账、plan.md#执行清单映射、OPEN-PLATFORM-REGISTRATION-006，以及范围简写隐藏的中间 caseId | 高 | 自动演进 | 数据策略逐条列出 40 个 caseId；执行清单按导航、本地校验、短信、认证、上传、首次申请、重提、决策夹具与只读状态资源互斥映射，REGISTRATION-006 仅保留在只读状态资源组。 | 已关闭 |
| MRR-TRA2-002 | 追溯审计 | 计划前部与只读审计确认 39 个唯一 caseId、19 个 REQ、43 个 RULE，但用例集评审与演进仍写成 34 条规则、25 条用例及注册 19 条，属于过期计数。 | 资料明确的设计缺口 | plan.md#用例集生成状态、plan.md#用例包目录、plan.md#用例集评审与演进、cases-login.md、cases-registration.md | 中 | 自动演进 | 新增 REGISTRATION-034 后统一为 19 项 REQ、43 条 RULE、40 条 caseId，其中登录 6 条、注册 34 条；关系和静态检查复跑。 | 已关闭 |

| MRR-DES2-001 | 测试设计评审 | 企业标识必填，但 RULE-REG-009 与 REGISTRATION-007 未覆盖空值，却标为已覆盖。 | 资料明确的设计缺口 | REQ-REG-004、RULE-REG-009、OPEN-PLATFORM-REGISTRATION-007 | 中 | 自动演进 | REQ-REG-004、RULE-REG-009、规则设计矩阵和 REGISTRATION-007 已覆盖常驻提示、空值、3/6 边界及非法字符，并断言空值时阻止继续注册。 | 已关闭 |
| MRR-DES2-002 | 测试设计评审 | REGISTRATION-013、014、023、024、025 的独立决策基线需要已验证手机号和有效营业执照，但现有计划仅为 REGISTRATION-011 预算一次短信、为 REGISTRATION-009 预算上传，并把负向场景归入不发送不上传组，导致依赖前例残留或突破预算。 | 资料明确的设计缺口 | REQ-REG-010、RULE-REG-015、RULE-REG-018、RULE-REG-026、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 高 | 自动演进 | REGISTRATION-013、023、024、025 分别绑定可独立恢复、彼此隔离且预先登记的有效表单夹具，当前请求不发送短信或上传；REGISTRATION-014 单独登记短信、上传和首次申请各 1 次。 | 已关闭 |
| MRR-DES2-003 | 测试设计评审 | REGISTRATION-031、032、033 依赖证照内容审核却统一为 no_write 和既有隔离状态，未绑定能证明匹配、不匹配、通过或驳回的互斥资源；真实提交则超预算，只读则缺资源身份与结果。 | 资料明确的设计缺口 | REQ-REG-001、REQ-REG-002、REQ-REG-005、RULE-REG-028、RULE-REG-032、RULE-REG-033、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033 | 高 | 自动演进 | REGISTRATION-031、032、033 改为只读审计，分别绑定不可变且互斥的输入摘要、申请标识和审核结果夹具；无法证明身份、输入和结果绑定时不得判定通过。 | 已关闭 |
| MRR-DES2-004 | 测试设计评审 | REGISTRATION-014 仅记录提交尝试和 CreateIntent，把业务结果交给后续用例，未在本用例内证明服务器接受且只创建一条申请，P0 主成功用例缺少独立最终结果。 | 资料明确的设计缺口 | REQ-REG-010、RULE-REG-019、OPEN-PLATFORM-REGISTRATION-014 | 高 | 自动演进 | REGISTRATION-014 增加按唯一合成标识的稳定只读 UI、API 或后台核验，必须证明平台接受且审核链路恰有一条申请；证据不可用时本用例不能通过。 | 已关闭 |

| MRR-REQ2-001 | 需求一致性评审 | 资料明确立即使用跳转登录和登录/注册两条入口路径，但 RULE-NAV-001 与 LOGIN-001 只选择任一入口，单一路径正常即可通过。 | 资料明确的设计缺口 | REQ-NAV-001、RULE-NAV-001、RULE-NAV-002、OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-REGISTRATION-020 | 中 | 自动演进 | LOGIN-001 独立验证官网“立即使用”进入登录页；REGISTRATION-020 独立从官网“登录/注册”进入注册页并验证返回登录，RULE-NAV-001、002 分开映射。 | 已关闭 |
| MRR-REQ2-002 | 需求一致性评审 | 需求和注册原型明确企业标识常驻提示请输入3-6位小写字母或数字，用作产品Model组成部分；现有 REQ、RULE 和用例未断言该提示。 | 需求覆盖缺口 | REQ-REG-004、RULE-REG-009、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-020 | 低 | 自动演进 | REQ-REG-004、RULE-REG-009 与 REGISTRATION-007 已写入完整常驻提示及其作为产品 Model 组成部分的语义，并断言持续可见。 | 已关闭 |
| MRR-REQ2-003 | 需求一致性评审 | 需求明确申请人姓名为账号名称，空值提示为请输入联系人名称；当前仅覆盖必填、长度、字符与管理员角色，缺少精确提示和姓名到账户名称的后置一致性。 | 需求覆盖缺口 | REQ-REG-006、RULE-REG-013、RULE-REG-017、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-017 | 中 | 自动演进 | REGISTRATION-010 已精确断言空值提示“请输入联系人名称”；REGISTRATION-017 在审核通过只读分支核验申请人姓名成为账号名称且联系方式成为管理员账号。 | 已关闭 |

| MRR-UX2-001 | 交互与状态专项评审 | REGISTRATION-031、032、033 依赖证照内容审核，但既有只读隔离状态未与各合成输入精确绑定，缺少可观察的通过或失败判据。 | 资料明确的设计缺口 | REQ-REG-001、REQ-REG-002、REQ-REG-005、RULE-REG-028、RULE-REG-032、RULE-REG-033、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033 | 高 | 自动演进 | 三个证照用例均绑定相互隔离的不可变审核记录、合成输入摘要和脱敏结果证据，不额外上传或提交；证据链不完整即不能通过。 | 已关闭 |
| MRR-UX2-002 | 交互与状态专项评审 | 审核通过与驳回两种互斥结果未分别绑定隔离资源和短信通知事实；驳回分支的短信反馈缺少覆盖。 | 需求覆盖缺口 | REQ-REG-011、REQ-REG-012、RULE-REG-021、RULE-REG-022、OPEN-PLATFORM-REGISTRATION-016、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-026 | 中 | 自动演进 | REGISTRATION-026 独立绑定审核通过申请和通知事实；新增 REGISTRATION-034 独立绑定审核驳回申请和通知事实，二者不得共用资源且只保留脱敏送达证据。 | 已关闭 |

| MRR-CHG2-001 | 变更影响评审 | 变更影响行遗漏部分受影响 REQ，演进摘要仍为旧计数，工程层待办仍写待阶段二生成，导致来源到 REQ、caseId、工程输入和复测范围不一致。 | 资料明确的设计缺口 | IMP-20260727-001、REQ-LOGIN-002、REQ-LOGIN-003、REQ-REG-003、REQ-REG-004、plan.md#用例集评审与演进、plan.md#工程层 | 高 | 自动演进 | IMP-20260727-001 已逐条列出 19 项 REQ 和 40 条 caseId；演进摘要、工程输入、场景组和证据策略均改用当前实际用例范围。 | 已关闭 |
| MRR-CHG2-002 | 变更影响评审 | LOGIN-003 步骤包含验证码登录提交，但执行清单只允许一次验证码请求不登录；REGISTRATION-017、018、028 也建立登录会话却未登记认证副作用和退出策略。 | 资料明确的设计缺口 | REQ-LOGIN-002、REQ-REG-001、REQ-REG-006、REQ-REG-007、REQ-REG-009、REQ-REG-012、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-028 | 高 | 自动演进 | LOGIN-003 限定为表单与单次验证码请求且不提交登录；REGISTRATION-016、017、018、028 均使用独立认证授权与会话，并在结束时退出或关闭上下文。 | 已关闭 |
| MRR-CHG2-003 | 变更影响评审 | REGISTRATION-031、032、033 的证照审核判定与 no_write、数量0和未登记互斥资源矛盾，可能产生未授权申请或无法判定。 | 资料明确的设计缺口 | REQ-REG-001、REQ-REG-002、REQ-REG-005、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033 | 高 | 自动演进 | 三个用例明确为预登记互斥审核资源的只读核验，不上传、不提交、不迁移状态；未绑定输入摘要和审核结果时阻塞对应 caseId。 | 已关闭 |
| MRR-CHG2-004 | 变更影响评审 | REGISTRATION-013、014、023、025 依赖手机号验证与文件选择，但副作用清单未说明如何独立建立、复用或恢复这些状态。 | 资料明确的设计缺口 | REQ-REG-010、RULE-REG-018、RULE-REG-025、RULE-REG-026、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-025 | 高 | 自动演进 | 负向决策用例逐条绑定预登记、彼此隔离且可复位的有效表单夹具；REGISTRATION-014 单独绑定各 1 次短信、上传、提交及 CreateIntent 恢复，不复用前例残留。 | 已关闭 |
| MRR-CHG2-005 | 变更影响评审 | 用例包和风险摘要仍称最多一条申请，但计划允许首次申请1和驳回重提1，包级总预算与分类型预算不一致。 | 资料明确的设计缺口 | OPEN-PLATFORM-REGISTRATION-014、OPEN-PLATFORM-REGISTRATION-016、cases-registration.md#包信息、plan.md#测试数据策略与残留台账、plan.md#风险与审核事项 | 中 | 自动演进 | 计划、注册包与风险摘要统一为首次提交最多 1、重提最多 1 且待单独确认、总上限 2；两类写入不得同批，各自台账、授权、恢复和 72 小时复核。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-TRA2-001 | 测试资产设计 | plan.md 的数据与执行范围映射 | 当前计划和只读解析已验证 | 仅修订正式计划资产 |
| MRR-TRA2-002 | 测试资产追溯统计 | plan.md#用例集评审与演进 | 当前用例包、规则台账和只读检查已验证 | 同步正式计划派生统计 |
<!-- review-batch:REV-20260727-ACCOUNT-02:end -->

<!-- review-batch:REV-20260727-ACCOUNT-03:start -->
### 评审批次：REV-20260727-ACCOUNT-03

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 2 |
| 综合结论 | 需演进 |
| 收敛状态 | 继续自动演进 |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/req_review_r3 | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-REQ3-001 | 自动演进 |
| 测试设计评审 | 真实子智能体 | /root/design_review_r3 | fork_turns=none | docs/testing/testcase-guideline.md；sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |
| 追溯审计 | 真实子智能体 | /root/trace_review_r3 | fork_turns=none | sources/manifest.yaml；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |
| 交互与状态专项评审 | 真实子智能体 | /root/interaction_review_r3 | fork_turns=none | sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/requirements/open-platform/AIoT平台项目.docx；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 需演进 | MRR-UX3-001、MRR-UX3-002、MRR-UX3-003 | 自动演进 |
| 变更影响评审 | 真实子智能体 | /root/impact_review_r3 | fork_turns=none | sources/manifest.yaml；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已完成 | 通过 | 无 | 已关闭 |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| MRR-REQ3-001 | 需求一致性评审 | AIoT平台项目.docx仅规定企业信用代码必填；帮助文档物理第8页及注册原型仅以0/18计数器证明最多18字符，未定义必须恰好18字符。当前REQ-REG-002、RULE-REG-031和REGISTRATION-030却断言17字符无效、仅18字符有效；REGISTRATION-003的missingInfo同时仍称长度未定义，资产内部亦不一致。 | 资料明确的设计缺口 | REQ-REG-002、RULE-REG-031、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-030 | 中 | 自动演进 | REQ-REG-002、RULE-REG-031、规则设计矩阵与 REGISTRATION-030 已修正为“最多 18 字符”的 18/19 上边界；REGISTRATION-003 明确最小长度、字符集和校验位未定义，不再拒绝 17 字符。 | 已关闭 |

| MRR-UX3-001 | 交互与状态专项评审 | REGISTRATION-020 声明支持登录与注册表单切换及返回登录，但步骤仅从官网登录/注册进入注册表单并检查字段，没有执行返回登录页签或断言登录字段组恢复；原型明确展示两个可切换页签。 | 资料明确的设计缺口 | RULE-NAV-002、OPEN-PLATFORM-REGISTRATION-020 | 中 | 自动演进 | REGISTRATION-020 第 4 步明确从注册表单选择登录页签或入口，并断言登录字段组出现、注册字段组退出当前激活态。 | 已关闭 |
| MRR-UX3-002 | 交互与状态专项评审 | REGISTRATION-013、023、024、025 将单项失败预期写成阻止注册，但步骤既未尝试提交也未检查 disabled 等提交前状态，存在未执行提交即可通过的空验证。帮助文档明确全部信息、手机号验证和协议满足后才能点击注册。 | 资料明确的设计缺口 | RULE-REG-018、RULE-REG-025、RULE-REG-026、OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 高 | 自动演进 | 四个负向决策用例均增加提交入口不可激活且没有注册提交请求的稳定判据；RULE-REG-018、025、026 与设计矩阵同步，仍保持零申请。 | 已关闭 |
| MRR-UX3-003 | 交互与状态专项评审 | plan.md 的副作用清单、执行映射和 login-auth 场景组均要求有效登录用例结束时退出或关闭隔离上下文，但 LOGIN-004 在进入控制台后结束，没有会话收尾步骤。 | 资料明确的设计缺口 | RULE-LOGIN-004、RULE-LOGIN-005、OPEN-PLATFORM-LOGIN-004 | 高 | 自动演进 | LOGIN-004 增加退出登录或关闭隔离浏览器上下文步骤，并断言后续 caseId 不复用当前认证会话。 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-REQ3-001 | 需求事实 | REQ-REG-002 → RULE-REG-031 → OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-030 | 资料已确认 | 已回链当前正式资产 |
| MRR-UX3-001 | 需求与交互设计 | REQ-NAV-001 → RULE-NAV-002 → OPEN-PLATFORM-REGISTRATION-020 | 原型与当前计划已确认 | 已回链当前正式资产，不沉淀项目经验 |
| MRR-UX3-002 | 需求与测试设计 | REQ-REG-010、REQ-REG-013 → RULE-REG-018、RULE-REG-025、RULE-REG-026 → 四个负向决策 caseId | 帮助文档与当前决策表已确认 | 已回链当前正式资产，不沉淀项目经验 |
| MRR-UX3-003 | 测试请求会话隔离设计 | plan.md 会话隔离约束 → OPEN-PLATFORM-LOGIN-004 | 当前计划已确认 | 已修订当前用例，不新增项目知识 |
<!-- review-batch:REV-20260727-ACCOUNT-03:end -->

<!-- review-batch:REV-20260727-ACCOUNT-04:start -->
### 评审批次：REV-20260727-ACCOUNT-04

| 字段 | 内容 |
| --- | --- |
| 批次类型 | 最终复审 |
| 触发类型 | 自动评审 |
| 输入基线版本 | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md |
| 隔离规则 | fork_turns=none |
| 自动演进轮次 | 3 |
| 综合结论 | 评审中 |
| 收敛状态 | 等待 reviewer |
| 人工确认状态 | 未请求 |

#### reviewer 执行记录

| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 需求一致性评审 | 真实子智能体 | /root/req_review_r4 | fork_turns=none | sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已启动 | 评审中 | 无 | 等待 reviewer |
| 测试设计评审 | 真实子智能体 | /root/design_review_r4 | fork_turns=none | docs/testing/testcase-guideline.md；sources/requirements/open-platform/AIoT平台项目.docx；sources/prototypes/open-platform/登录页面.html；sources/prototypes/open-platform/注册页面.html；sources/knowledge-base/open-platform/iot平台帮助文档.pdf；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已启动 | 评审中 | 无 | 等待 reviewer |
| 追溯审计 | 真实子智能体 | /root/trace_review_r4 | fork_turns=none | sources/manifest.yaml；testcases/web/open-platform/account-access-20260727-2/plan.md；testcases/web/open-platform/account-access-20260727-2/cases-login.md；testcases/web/open-platform/account-access-20260727-2/cases-registration.md | 已启动 | 评审中 | 无 | 等待 reviewer |
| 交互与状态专项评审 | 真实子智能体 | — | fork_turns=none | 等待资源 | 等待资源 | 评审中 | 无 | 等待 reviewer |
| 变更影响评审 | 真实子智能体 | — | fork_turns=none | 等待资源 | 等待资源 | 评审中 | 无 | 等待 reviewer |

#### 发现项

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| 无 | 无 | 无 | 无 | 无 |
<!-- review-batch:REV-20260727-ACCOUNT-04:end -->

## 用例集评审与演进

- 需求追溯统计：19 项 REQ 均至少关联 1 条实际 caseId。
- 规则覆盖统计：43 条 RULE 均已关联实际 caseId；40 条原子用例均有 RULE 反向关联。
- 覆盖域复核：业务、输入、状态、数据一致性、身份、安全、集成和交互等适用域均已回填原子用例；资料未定义项保持适用待补充。
- 覆盖基准与拆分复核：`cases-login.md` 6 条、`cases-registration.md` 34 条，包级清单与 40 条实际 caseId 一致。
- 测试设计技术复核：决策表、状态迁移、等价类与边界、场景法均已关联实际 caseId。
- 变更影响复核：新测试请求，无活跃既有正式脚本迁移；两轮演进影响已由 `IMP-20260727-001` 回链到 19 项 REQ、40 条 caseId、数据授权边界与后续工程输入。
- 多角色评审复核：`REV-20260727-ACCOUNT-01` 初审和 `REV-20260727-ACCOUNT-02` 最终复审均已由五个真实隔离 reviewer 完成。
- 发现的缺口与演进：两轮资料明确缺口已自动修订并关闭；新增 REGISTRATION-034 拆分审核驳回短信分支，当前等待下一轮最终复审验证收敛。
- 评审结论：需演进。

## 工程层：代码定位与自动化设计

| 项目 | 内容 |
| --- | --- |
| 工程层状态 | 未开始 |
| 代码仓库 | 待用例确认后从 `.local/repositories/` 唯一定位 |
| 仓库确认依据 | 待用例确认后使用已确认项目、URL 和需求定位 |
| 分支/提交标识 | 未获取；业务层禁止提前读取源码 |
| Graphify 图谱 | 未检查；待用例确认后在读取源码前检查 |
| 图谱新鲜度 | 无法判断；尚未进入工程层 |
| 源码确认范围 | 用例确认后仅围绕当前 40 条实际 caseId 定位登录、注册、路由、认证、短信、上传、审核查询及其直接依赖 |

| caseId | 需求追溯编号 | 源码路径与定位依据 | 可复用能力 | 自动化结论 | 脚本与断言方案 | 数据/环境前置条件 | 风险或待确认项 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cases-login.md` 所列 6 条与 `cases-registration.md` 所列 34 条实际 caseId | REQ-NAV-001、REQ-LOGIN-001、REQ-LOGIN-002、REQ-LOGIN-003、REQ-LOGIN-004、REQ-LOGIN-005、REQ-REG-001、REQ-REG-002、REQ-REG-003、REQ-REG-004、REQ-REG-005、REQ-REG-006、REQ-REG-007、REQ-REG-008、REQ-REG-009、REQ-REG-010、REQ-REG-011、REQ-REG-012、REQ-REG-013 | 待用例确认后逐 caseId 定位 | 待检查现有 action、fixture、support 和正式 Runner | 待工程设计 | Playwright 脚本与断言待可见探索证据卡，并按下方场景组和副作用清单拆分 | test 配置、专用账号、合成数据、受控验证码、预登记隔离夹具和独立写入授权 | 认证会话缺失；注册残留、审核链路、稳定只读入口与重提预算待确认 |

### 规范差异与用户告知

| 差异编号 | 问题类别 | 具体事实与证据 | 受影响 caseId | 自动化影响 | 最小处理建议或待确认项 | 自动化结论 | 用户已告知 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 无 | 不适用 | 尚未进入工程层，未读取代码或正式页面证据 | 当前 40 条实际 caseId | 无工程结论 | 用例确认后再进行零写入可见探索 | 待工程设计 | 是；本计划明确阶段边界 |

### 脚本与证据方案

- 拟修改或新增文件：待工程设计确定。
- 执行命令与目标环境：正式入口拟使用 `npm run test:web:execute -- --request web/open-platform/account-access-20260727-2`；目标环境 test，尚未授权。
- 可见探索：用例确认后先运行 Inspector 门禁；探索业务写入预算固定为 0。
- 预期报告位置与逐用例证据：`artifacts/` 下的 Playwright HTML、Allure、Trace、视频和中文摘要；具体策略待工程设计。
- 差异与审核事项：当前不以代码、Graphify 或旧脚本作为业务需求依据。

#### 页面场景组映射

| sessionGroupId | targetRoute | caseIds | resetStrategy | isolationReason | executionOrder |
| --- | --- | --- | --- | --- | --- |
| login-readonly | 官网与登录页 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-006 | 每例新上下文并恢复登录模式 | 纯导航、模式与恢复入口不混入认证副作用 | 可并行只读 |
| login-sms | 登录页验证码模式 | OPEN-PLATFORM-LOGIN-003 | 独立上下文；单次请求后关闭 | 短信预算和敏感采集独立 | 独立授权后执行 |
| login-auth | 登录页账号模式与控制台 | OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005 | 每例独立凭据引用和上下文，结束退出或关闭 | 有效、无效认证互不复用；LOGIN-005 还需业务裁决 | 分别授权、串行执行 |
| registration-local | 官网注册入口与注册表单 | OPEN-PLATFORM-REGISTRATION-001、OPEN-PLATFORM-REGISTRATION-002、OPEN-PLATFORM-REGISTRATION-003、OPEN-PLATFORM-REGISTRATION-004、OPEN-PLATFORM-REGISTRATION-005、OPEN-PLATFORM-REGISTRATION-007、OPEN-PLATFORM-REGISTRATION-008、OPEN-PLATFORM-REGISTRATION-010、OPEN-PLATFORM-REGISTRATION-012、OPEN-PLATFORM-REGISTRATION-020、OPEN-PLATFORM-REGISTRATION-021、OPEN-PLATFORM-REGISTRATION-022、OPEN-PLATFORM-REGISTRATION-030 | 每例恢复空白表单、页签和协议基线 | 输入、唯一性与导航场景不发送短信、不上传、不认证、不提交申请 | 异常、边界、正常 |
| registration-decision-fixtures | 注册表单 | OPEN-PLATFORM-REGISTRATION-013、OPEN-PLATFORM-REGISTRATION-023、OPEN-PLATFORM-REGISTRATION-024、OPEN-PLATFORM-REGISTRATION-025 | 每例绑定并复位彼此隔离的预登记有效表单夹具 | 每例只改变一个决策条件，不依赖前例残留 | 独立恢复后执行 |
| registration-upload | 注册表单证照字段 | OPEN-PLATFORM-REGISTRATION-009 | 独立上下文和合成文件等价类 | 临时上传与产物脱敏单独授权 | 独立授权后执行 |
| registration-sms | 注册表单联系方式字段 | OPEN-PLATFORM-REGISTRATION-011 | 独立上下文和专用联系方式 | 注册短信预算单独授权 | 独立授权后执行 |
| registration-first-write | 注册提交与审核链路 | OPEN-PLATFORM-REGISTRATION-014 | 唯一 CreateIntent、独立上下文、台账和 72 小时复核 | 唯一允许首次申请、短信和上传各 1 次的组合场景 | 单独批次，预算未消耗时执行 |
| registration-resubmit | 驳回申请重提 | OPEN-PLATFORM-REGISTRATION-016 | 独立驳回资源、认证上下文、CreateIntent 和台账 | 独立重提预算待确认，不复用首次申请批次 | 单独批次且在用户确认后执行 |
| registration-state-readonly | 申请、审核、关系与通知只读入口 | OPEN-PLATFORM-REGISTRATION-006、OPEN-PLATFORM-REGISTRATION-015、OPEN-PLATFORM-REGISTRATION-019、OPEN-PLATFORM-REGISTRATION-026、OPEN-PLATFORM-REGISTRATION-027、OPEN-PLATFORM-REGISTRATION-029、OPEN-PLATFORM-REGISTRATION-031、OPEN-PLATFORM-REGISTRATION-032、OPEN-PLATFORM-REGISTRATION-033、OPEN-PLATFORM-REGISTRATION-034 | 每例绑定彼此隔离且不可变的状态夹具 | 不创建或迁移状态；证照夹具精确绑定输入摘要与结果 | 只读，可按夹具独立执行 |
| registration-auth-readonly | 审核通过账号与企业组资源 | OPEN-PLATFORM-REGISTRATION-017、OPEN-PLATFORM-REGISTRATION-018、OPEN-PLATFORM-REGISTRATION-028 | 每例独立账号引用与上下文，结束退出或关闭 | 认证会话不跨 caseId 复用 | 分别授权后执行 |

#### 证据策略映射

| caseId / 场景组 | 证据策略 | 关键截图 | 视频或 Trace | 网络/控制台摘要 | 敏感步骤处理 |
| --- | --- | --- | --- | --- | --- |
| 当前 40 条实际 caseId / 上述 10 个场景组 | 审计均衡；待工程设计按风险和副作用细化 | 基线、关键状态与最终断言，敏感页不保留原值 | 失败 Trace 和必要视频区间；写入及敏感步骤按规则暂停 | 仅保留脱敏状态、错误类型、请求方法和唯一合成标识摘要 | 密码、验证码、联系方式、营业执照、短信、Cookie、Token 和会话输入期间暂停或遮罩采集 |

## 预计交付物

- 测试用例：`cases-login.md`、`cases-registration.md`。
- 工程层设计：用例确认后补充到本计划的仓库、Graphify、探索证据、数据、场景组和脚本方案。
- 自动化脚本：工程设计完成后生成，与每个已确认 caseId 唯一关联。
- 执行报告：脚本评审和不可变执行清单确认后生成脱敏的 Playwright HTML、Allure 和中文摘要。
