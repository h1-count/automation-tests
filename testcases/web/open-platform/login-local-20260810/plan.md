# 测试计划：开放平台登录功能（本地开发环境）

> 填写结构以 [流程规范](../../../docs/testing/automation-guideline.md)、[用例规范](../../../docs/testing/testcase-guideline.md)、[环境规范](../../../docs/testing/environment-guideline.md)、[定位规范](../../../docs/testing/selector-guideline.md) 和 [报告规范](../../../docs/testing/report-guideline.md) 为准。

> 表格写入约束：同一张表的表头、分隔行和每条数据行保持相同列数；单元格内换行使用 `<br>`，字面量竖线写为 `\|`。生成后必须先对实际计划运行 `npm run check:markdown -- <计划路径>`，再通过 `npm run check:architecture`，才可展示或提交确认；仅分隔行不一致时可用 `--fix` 修复后复检。

> 结构版本：case-relation-projection-v1。原子用例的“用例编号”是身份来源；仅“规则覆盖台账”的“关联 caseId”可人工维护。其余 `caseId` 列由 `npm run testcases:sync-relations -- <runtime 暂存请求目录>` 生成并经 Activity 原子发布，请勿直接修改最终请求目录。

> 结构版本：web-script-governance-v1。新建或重新打开执行范围的 Web/H5 请求在工程层记录场景组和证据策略；历史请求不迁移。

> 结构版本：page-session-group-v1。

> 结构版本：case-evidence-policy-v1。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 计划编号 | PLAN-LOGIN-LOCAL-20260810 |
| 测试请求 | web/open-platform/login-local-20260810 |
| 测试类型 | Web |
| 目标环境 | 本地开发环境 http://127.0.0.1:3098（Hommor Aura 平台 dev 实例，用户指定） |

## 正式用户决定

> 本表是正式用户决定内容的唯一来源，只记录已作出的决定及其适用 `subjectDigest`；等待、重试、失效和 callback 生命周期只在 `workflow-history.ndjson` 中维护。没有决定时填写“无”，不得用“待确认”伪造一条决定。

| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |
| --- | --- | --- | --- | --- |
| 计划确认 | 无 | 无 | 无 | 无 |
| 计划确认 | 58dbd36e331f1ca3fc1d67d5f75e1f1a5b813b5cf33393a66ba254e3e449b1ea | accepted | 用户接受登录功能测试计划：账号登录正向与反向、模式与 tab 切换；目标环境本地 dev 3098 映射 test；.env test 账号本地可用 | 继续生成 cases-login.md 用例包、关系同步、readiness 与隔离评审 |
| 用例确认 | 4d62ede1902d68ee0f202265cc944430b344396ad643d40b89894429a7e0f37c | accepted | 用户接受 7 个登录用例；裁决 MRR-IMP-002：001 先于 004 执行以隔离锁定计数；裁决 MRR-IMP-005：反向/交互用例放宽为不含敏感原文的最小局部截图 | 进入 build 工程层：脚本生成、selector 证据、脚本评审、readiness |
| 用例确认 | 49e9dac9c5ce707a718f5f64f7fc117baaaaf82b52aeb4a7c2e084c77c696973 | accepted | 用户重新接受 7 个登录用例（prototype 目录 digest 修复 d4e823a2→0c21f0f7 致 cases/plan 来源 SHA 更新，业务语义未变，REV-2 复审 approved）；MRR-IMP-002/005 裁决不变 | 重新进入 readiness → execution-authorization |
| 执行清单确认 | ca71599fe798f7f1d7e29efa52a9d371f10cc53800cb77359f63fe6c3ea93452 | accepted | 用户授权在本地 dev 127.0.0.1:3098（映射 test）实跑 7 个登录用例（authenticate_test_account budget 1 仅 001/004；001 先于 004；凭据从 .env；Trace/截图/HAR 默认关闭；安全挑战人工接管） | 进入 run |

## 测试范围

> 这里只列注册、登录、产品管理等顶层业务流程及明确排除项；字段规则、验证码、断言文案、原子用例拆分和 `caseId` 分别写入需求追溯、规则设计、用例与评审区块，不得混入范围条目。

### 包含

- 账号登录（手机号 + 密码）正向登录成功路径。
- 账号登录常见反向校验：空手机号、空密码、错误密码，以及手机号格式非法时的页面行为。
- 登录页可达交互：账号登录与验证码登录模式切换、登录与注册 tab 切换的页面结构稳定性。

### 不包含

- 短信验证码登录的端到端提交执行：依赖 OTP 通道或固定测试码，本地 dev 环境未确认，保留为受控执行/待补充，不作为本次“登录功能”请求的默认正向路径。
- 注册流程、忘记密码/找回密码、第三方或 OAuth 登录：超出本次“登录功能”请求范围。
- 安全挑战（滑块/人机验证）的自动绕过、破解或伪造：安全边界禁止；仅在真实出现时由人工最小接管，后续步骤由脚本自动恢复。

## 输入资料

> 结构版本：source-reference-links-v1

> 本表是本次计划的**实际引用资料清单**，不是候选资料目录。仅记录已打开且用于范围、业务规则、推断或结论的资料；章节索引命中但未读取的资料不得写入。仓库内资料必须使用可点击的相对 Markdown 遾接；原型链接到精确页面，PDF/Word 在“页码、标题或页面定位”中保留定位信息。每次向用户输出计划、用例草案或评审结论时，同步展示本表中本轮实际使用的条目；未引用知识库资料时明确说明。对话附件未落盘时填写“仅对话附件，暂无持久链接”，不得伪造链接。

| manifest id / sectionId | 资料类型 | 可点击资料链接 | 页码、标题或页面定位 | 版本 / SHA-256 | 本次用途 |
| --- | --- | --- | --- | --- | --- |
| aiot-platform-project-document / platform-home-and-registration | 需求文档 | [AIoT平台项目.docx](../../../../sources/requirements/open-platform/AIoT平台项目.docx) | 章节“官网改造”：登录为手机号、密码登录；手机号11位格式验证；验证后默认进入 AIoT 控制台 | 64ed64b7e3c1c133d30c660ebb9eb5de5af1aed385d18e481ba18ee7b582d00b | 登录方式、手机号11位格式校验与登录后落地页的业务依据 |
| open-platform-axure-prototype / prototype-account-login | 原型 | [登录页面.html](../../../../sources/prototypes/open-platform/登录页面.html) | 登录页面原型；字段含手机号、密码、忘记密码、验证码 | 0c21f0f7c472d2fd0cf712201c46cfd584ec5607cfe6a4b01d778c5243bc08e6 | 登录页字段与按钮视觉原型；实际 DOM/ARIA 以本地真实页面复核 |
| iot-platform-help / account-registration-faq | 平台文档 | [iot平台帮助文档.pdf](../../../../sources/knowledge-base/open-platform/iot平台帮助文档.pdf) | 页码 9-15：平台账号注册与登录 FAQ | 章节索引登记，按需精读 | 账号体系与登录相关常见问题（补充） |
| 待补登 | 项目经验库 | [open-platform-testing-knowledge.md](../../../../docs/testing/knowledge/open-platform-testing-knowledge.md) | 登录与注册页语义定位；账号密码登录安全挑战恢复；登录认证产物脱敏 | 待验证（经验库标注） | 复用语义定位策略、安全挑战恢复状态机与脱敏策略；经验面向 test 环境，本地 dev 结构以本轮受控探索复核 |
| 待补登 | 受控页面探索（本轮生成） | http://127.0.0.1:3098/login | 账号登录手机号、登录密码字段；账号登录/验证码登录切换按钮；登录/注册 tab | 探索时间 2026-08-10 | 确认本地 dev 登录页 DOM/ARIA 结构与字段定位 |

> 本轮引用上述 `sources/` 正式资料与项目经验库；原型为 Axure 容器页（实际字段在 `data.js` 动态渲染），真实页面结构以本地 3098 受控探索为准。资料定义了登录方式（手机号+密码）、手机号11位格式校验与登录后进入控制台；资料未定义的精确校验/失败提示文案不作为硬断言，待 build 阶段 selector 探索确认后作为可选断言。

## 测试资产选择

<!-- testcase-standard: test-asset-selection-v1 -->

> 本表只记录从 `test-assets/manifest.yaml` 选择的静态资产，不是原始需求、输入资料或需求追溯。计划阶段可运行 `npm run test-assets:select -- --project <项目> --kind <类型>`；已选择 App 包时运行 `npm run check:environment -- --plan --asset <assetId>` 验证文件完整性。包名、Activity、Appium、设备和安装状态属于工程设计验证，不阻塞计划或用例生成。

| assetId | 类型 | 可点击资产链接 | 选择依据 | 选择状态 | 工程验证项 |
| --- | --- | --- | --- | --- | --- |
| 不适用 | visual-baseline | 不适用 | Web 登录页无视觉基线资产需求 | 不适用 | 不适用 |

## 环境选择

> 结构版本：environment-status-v1

> 计划阶段先运行 `npm run check:environment -- --plan`；已选择静态资产时追加 `--asset <assetId>`。本表只记录脱敏状态，不记录地址、账号、密码、Token、Cookie 或会话内容。“已配置”不等于已预检，“已预检”不等于用户已确认或业务服务可用。静态包已选但 Appium/设备未验证时，在工程任务记录待验证，不得阻塞用例生成。

| 候选环境 | 选择依据 | 本地配置状态 | 预检状态 | 正式决定引用 | 未闭合项 |
| --- | --- | --- | --- | --- | --- |
| 本地 dev（127.0.0.1:3098） | 用户明确指定该地址进行登录功能测试 | 已配置（本地服务可达，首页 HTTP 200；`baseUrl` 需执行时覆盖 `OPEN_PLATFORM_WEB_BASE_URL_TEST` 指向本地） | 预检受阻 | 无 | 本地 dev 测试账号可用性未确认（`.env` 现有账号面向线上 test 环境）；本地 dev 是否触发滑块安全挑战未确认 |

> 环境映射说明：工程标准环境为 test/pre/prod，本地开发实例不在标准目录中。本次以“本地 dev 映射为 test 用途”处理——执行时通过环境变量覆盖 `OPEN_PLATFORM_WEB_BASE_URL_TEST` 指向 `http://127.0.0.1:3098/`，环境标识沿用 `test`（非生产、`ALLOW_PRODUCTION_TESTS=false`），不新增自定义环境枚举。该映射属工程适配，不影响测试类型与目标环境的业务范围。

## 测试方式

- Web（Playwright）。

## 测试数据策略与残留台账

> 结构版本：test-data-policy-v2

> 按[环境规范](../../../docs/testing/environment-guideline.md)选择数据策略，并记录本请求的引用与确认结论。

| 数据策略 | 允许环境 | 资源类型 | 最大数量 | 关联覆盖范围 / caseId | 正式决定引用 |
| --- | --- | --- | --- | --- | --- |
| no_write | 本地 dev / test | 无 | 0 | 登录反向校验、模式/tab 切换、登录态观察 | 不适用 |
| ephemeral_cleanup | 本地 dev / test | 登录会话 | 1 | 账号登录正向成功用例（成功后产生本地会话，需登出或清理会话产物） | 不适用 |

### 写入策略明细

- `no_write`：关联覆盖范围为登录反向校验与页面交互用例；不触发真实业务写入，仅观察页面结构与校验/失败提示；唯一合成标识不适用；基线合约不适用；租约不适用；恢复/退役策略不适用；TTL 不适用。

- `ephemeral_cleanup`：关联覆盖范围为账号登录正向成功用例；成功登录后生成会话与 `.auth/` 本地会话文件；唯一合成标识为登录态校验后登出或关闭 Context；基线合约不适用；租约 `shared_read`；恢复/退役策略为登出并删除本轮会话产物；TTL 不适用（执行后立即清理）。

- 台账或数据策略引用：`.auth/` 本地会话目录（Git 忽略），不记录会话原文。
- 残留风险与处理期限：登录会话仅存本机 Git 忽略目录；执行后登出清理；认证产物脱敏见证据策略。

### 执行清单映射

| caseId | 正式脚本 | 允许操作 | 资源类型 | 数量预算 | 后台验证 | 敏感产物策略 |
| --- | --- | --- | --- | --- | --- | --- |
| 待阶段二生成 | tests/web/open-platform/login-local-20260810/*.formal.spec.ts | 登录提交（正向）/ 校验观察（反向） | 登录会话 / 无 | 1 / 0 | 无（本地 dev，无后台验证断言） | 暂停采集 Trace/截图/视频；会话仅存 `.auth/` |

## 覆盖基准与拆分清单

> 结构版本：coverage-inventory-v1

> 在生成用例草案前填写。本区块与需求追溯、覆盖矩阵和评审结论共同保存在当前 `plan.md`，不另建说明文档。按业务风险拆分，不使用固定用例数量配额，也不预分配或承诺最终 `caseId` 数量；无对应资料或场景时填写“不适用及依据”。

### 基准资料与模块映射

| 基准资料 | 层级或模块/流程 | 可验证场景或规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 差异、不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 本地页面受控探索 | 登录 / 账号登录 | 正确手机号+密码登录成功 | 正向登录成功路径 | RULE-LOGIN-003 | OPEN-PLATFORM-LOGIN-001 | 登录后落地页与登录态断言待 build 阶段确认 |
| 本地页面受控探索 | 登录 / 账号登录 | 空手机号、空密码阻止登录 | 反向校验 | RULE-LOGIN-004、RULE-LOGIN-005 | OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003 | 校验提示文案探索未捕获，先断言“停留登录页+不进入登录态” |
| 本地页面受控探索 | 登录 / 账号登录 | 错误密码登录失败 | 失败处理 | RULE-LOGIN-006 | OPEN-PLATFORM-LOGIN-004 | 受控执行，可能触发安全挑战，仅人工接管 |
| 本地页面受控探索 | 登录 / 页面交互 | 账号登录与验证码登录切换、登录与注册 tab | 交互稳定性 | RULE-LOGIN-001、RULE-LOGIN-002 | OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-LOGIN-007 | 切换后字段结构稳定性 |

### 拆分清单

| 类别 | 拆分项与适用规则 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用、待补充或合并依据 |
| --- | --- | --- | --- | --- | --- |
| 输入字段 | 手机号（必填、手机号格式）、密码（必填） | 必填校验、格式校验、错误凭据 | RULE-LOGIN-003、RULE-LOGIN-004、RULE-LOGIN-005、RULE-LOGIN-006、RULE-LOGIN-007 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005 | 格式校验文案未确认，RULE-LOGIN-007 受控 |
| 枚举与状态 | 登录模式（账号/验证码）、登录前/登录后状态 | 模式切换稳定性、登录态转移 | RULE-LOGIN-001、RULE-LOGIN-003 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-006 | 登录后状态转移待 build 确认 |
| 关键交互 | 登录按钮提交、模式切换按钮、登录/注册 tab | 提交动作、切换动作 | RULE-LOGIN-001、RULE-LOGIN-002、RULE-LOGIN-003 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-LOGIN-007 | 不适用 |
| 角色与权限 | 不适用 | 不适用 | 不适用 | 无 | 登录功能不区分平台角色，注册/找回权限不在本次范围 |

### 测试设计技术与依据

> 仅对适用场景填写；所有记录均在本 `plan.md` 中维护，不另建平行设计文档。

| 适用场景 | 设计技术与最小记录 | 需求追溯编号 | 计划覆盖范围 | 关联 RULE | 派生 caseId | 不适用或待补充依据 |
| --- | --- | --- | --- | --- | --- | --- |
| 多条件业务规则 | 决策表：手机号(空/格式错/正确) × 密码(空/错/正确) 的有效无效组合与登录结果 | REQ-LOGIN-001、REQ-LOGIN-002、REQ-LOGIN-003 | 待阶段二按组合拆分 | RULE-LOGIN-003 至 RULE-LOGIN-007 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-005 | 格式错误分支文案待确认 |
| 核心用户旅程 | 场景法：打开登录页 → 切换账号登录 → 填写 → 提交 → 成功/失败/校验 | REQ-LOGIN-001 | 待阶段二按场景拆分 | RULE-LOGIN-001、RULE-LOGIN-003 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-006 | 不适用 |

## 覆盖矩阵

> 先按需求、风险、变更和环境判断适用性，不要求每次测试覆盖全部通用域。仅“适用”的域需要生成关联用例；“不适用”和“适用待补充”必须说明依据或影响。

| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用：账号登录主流程与失败/校验路径 | 正向登录、反向校验、失败处理 | 适用待补充 | OPEN-PLATFORM-LOGIN-001 |
| 输入与数据校验 | 适用：手机号与密码必填、手机号格式 | 空值、格式非法、错误凭据 | 适用待补充 | OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-005 |
| 状态与生命周期 | 适用：登录前→登录后状态转移 | 登录成功态校验 | 适用待补充 | 无 |
| 数据完整性与一致性 | 不适用：登录功能不涉及跨实体数据一致性 | 不适用 | 不适用 | 无 |
| 异常、容错与恢复 | 适用：错误凭据、安全挑战恢复 | 错误密码失败、安全挑战人工接管 | 适用待补充 | OPEN-PLATFORM-LOGIN-004 |
| 权限、身份与审计 | 不适用：角色/权限区分不在本次登录功能范围 | 不适用 | 不适用 | 无 |
| 安全与隐私 | 适用：认证产物脱敏、会话最小权限 | 关闭回显输入的 Trace/截图/视频；会话仅存 `.auth/` | 已覆盖（策略层） | 无 |
| 接口、集成与契约 | 不适用：本次仅前端行为，不验证登录接口契约 | 不适用 | 不适用 | 无 |
| 兼容性与可移植性 | 不适用：本次单浏览器单环境 | 不适用 | 不适用 | 无 |
| 交互、视觉与无障碍 | 适用：模式切换、tab 切换、字段 ARIA 可达性 | 交互稳定性、ARIA 定位 | 适用待补充 | OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-LOGIN-007 |
| 性能、容量与稳定性 | 不适用：登录功能本次不做性能/容量验证 | 不适用 | 不适用 | 无 |
| 配置、部署与可运维性 | 不适用 | 不适用 | 不适用 | 无 |
| 本地化与法规要求 | 不适用 | 不适用 | 不适用 | 无 |

## 需求追溯矩阵

> 覆盖矩阵评估测试维度；本矩阵逐条映射需求。每项适用 P0 必须关联至少一条用例。高风险或资料不足的需求保留为“适用待补充”或“受控执行”，不得写入“不包含”。

| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-LOGIN-001 | docx platform-home-and-registration + 受控探索 | P0 | 账号登录使用正确手机号与密码可成功登录，验证后进入控制台 | 适用 | 正向登录成功 | OPEN-PLATFORM-LOGIN-001 | 适用待补充 | 登录态断言待 build 确认；账号可用性待执行验证 |
| REQ-LOGIN-002 | docx + 受控探索 | P1 | 账号登录对空手机号、空密码、非11位格式手机号阻止登录 | 适用 | 反向校验 | OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-005 | 适用待补充 | 校验提示文案待 build 确认（手机号11位格式有资料依据） |
| REQ-LOGIN-003 | 受控探索 + 经验库（安全挑战恢复） | P1 | 账号登录使用错误密码时登录失败并停留在登录页 | 适用 | 失败处理 | OPEN-PLATFORM-LOGIN-004 | 受控执行 | 可能触发安全挑战，仅人工接管；失败提示文案待确认 |
| REQ-LOGIN-004 | 受控探索（页面交互） | P2 | 登录页支持账号登录与验证码登录模式切换、登录与注册 tab 切换 | 适用 | 交互稳定性 | OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-LOGIN-007 | 适用待补充 | 切换后字段结构稳定性待 build 确认 |

## 规则覆盖台账

> 结构版本：rule-coverage-v1

> 每一行是来自实际读取资料的原子可测试规则，不由代码反推。“关联 caseId”是唯一人工维护的 RULE 覆盖关系源；不适用、待补充、待用户裁决和受控执行必须有业务依据、执行门禁或最小裁决问题。

| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-LOGIN-001 | REQ-LOGIN-004 | 本地探索 /login | 页面交互 | 点击“账号登录”/“验证码登录”按钮 | 对应登录模式字段出现且可定位 | 交互断言 | 适用 | 适用待补充 | OPEN-PLATFORM-LOGIN-006 | 切换后字段 ARIA 待 build 确认 |
| RULE-LOGIN-002 | REQ-LOGIN-004 | 本地探索 /login | 页面交互 | 点击登录/注册 tab | 对应 tab 面板内容切换 | 交互断言 | 适用 | 适用待补充 | OPEN-PLATFORM-LOGIN-007 | 注册面板不在本次执行范围，仅验证切换 |
| RULE-LOGIN-003 | REQ-LOGIN-001 | 本地探索 + 经验库 | 业务规则 | 账号登录填写正确手机号+密码并提交 | 进入登录后页面、出现登录态可观察元素 | 场景法 | 适用 | 适用待补充 | OPEN-PLATFORM-LOGIN-001 | 登录态断言与账号可用性待执行验证；会话按 ephemeral_cleanup 清理 |
| RULE-LOGIN-004 | REQ-LOGIN-002 | 本地探索 | 输入边界 | 账号登录手机号为空时提交 | 阻止登录、停留在登录页、不进入登录态 | 决策表 | 适用 | 适用待补充 | OPEN-PLATFORM-LOGIN-002 | 校验提示文案探索未捕获，先断言停留登录页 |
| RULE-LOGIN-005 | REQ-LOGIN-002 | 本地探索 | 输入边界 | 账号登录密码为空时提交 | 阻止登录、停留在登录页、不进入登录态 | 决策表 | 适用 | 适用待补充 | OPEN-PLATFORM-LOGIN-003 | 同上 |
| RULE-LOGIN-006 | REQ-LOGIN-003 | 本地探索 + 经验库 | 异常与恢复 | 账号登录正确手机号+错误密码提交 | 登录失败、停留在登录页、显示失败提示 | 决策表 | 适用 | 受控执行 | OPEN-PLATFORM-LOGIN-004 | 可能触发安全挑战，仅人工接管；失败提示文案待确认 |
| RULE-LOGIN-007 | REQ-LOGIN-002 | docx platform-home-and-registration | 输入边界 | 账号登录手机号非11位格式时提交 | 阻止登录或提示格式错误、停留登录页 | 等价类与边界 | 适用 | 适用待补充 | OPEN-PLATFORM-LOGIN-005 | 资料定义手机号11位格式验证；精确提示文案待本地 build 确认 |

## 规则设计矩阵

> 结构版本：rule-design-matrix-v1

> 仅从已引用 RULE 派生。资料未定义格式、文件属性、成功页或恢复语义时写“未定义，不生成断言”并保留资料定位；不得用泛化的“已定义校验”代替可观察预期。生成或修订用例后运行 `npm run check:rule-design -- <plan.md>`。

| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-LOGIN-001 | 模式切换按钮 | 必填 | 点击账号登录/验证码登录 | 对应模式字段可见可定位 | 本地 dev 登录页可达 | no_write，不提交登录 | OPEN-PLATFORM-LOGIN-006 | 已覆盖 |
| RULE-LOGIN-002 | 登录/注册 tab | 必填 | 点击登录/注册 tab | 对应面板切换 | 本地 dev 登录页可达 | no_write，不提交注册或登录 | OPEN-PLATFORM-LOGIN-007 | 已覆盖 |
| RULE-LOGIN-003 | 手机号、密码、登录态 | 必填 | 有效手机号+正确密码 | 进入登录后页面、登录态元素可见 | 可用测试账号 | 账号可用性 | OPEN-PLATFORM-LOGIN-001 | 受控执行 |
| RULE-LOGIN-004 | 手机号 | 必填 | 空手机号 | 停留登录页、不进入登录态 | 本地 dev 登录页可达、账号登录模式 | no_write，不提交有效登录 | OPEN-PLATFORM-LOGIN-002 | 已覆盖 |
| RULE-LOGIN-005 | 密码 | 必填 | 空密码 | 停留登录页、不进入登录态 | 本地 dev 登录页可达、账号登录模式 | no_write，不提交有效登录 | OPEN-PLATFORM-LOGIN-003 | 已覆盖 |
| RULE-LOGIN-006 | 密码 | 必填 | 正确手机号+错误密码 | 登录失败、停留登录页 | 可用测试账号 | 安全挑战人工接管 | OPEN-PLATFORM-LOGIN-004 | 受控执行 |
| RULE-LOGIN-007 | 手机号 | 必填 | 非11位手机号格式 | 阻止登录或格式提示；停留登录页、不进入登录态 | 本地 dev 登录页可达、账号登录模式 | no_write，不提交有效登录 | OPEN-PLATFORM-LOGIN-005 | 已覆盖 |

## 规则邻域复核

> 每次自动演进把触发发现项映射到 RULE 后，复核同一 REQ、字段或状态对象、提交/状态路径及数据前置组的全部适用规则；资料明确的遗漏一次性修订并复检。

| 触发发现项 | 邻域 RULE | 共同依据 | 修订 caseId | 关系同步与规则设计预检结果 |
| --- | --- | --- | --- | --- |
| 初始生成预检 | RULE-LOGIN-004、RULE-LOGIN-005、RULE-LOGIN-007 | 同属手机号/密码输入边界与提交路径 | 无 | 待阶段二生成后复检 |

## 用例包目录

> 用例包按业务模块或完整流程组织。计划阶段只定义包边界和覆盖范围；阶段二生成原子用例后才回填稳定 `caseId`，并以它而非文件路径作为追溯主键。

| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 特殊门禁 |
| --- | --- | --- | --- | --- |
| `cases-login.md` | 开放平台登录功能（账号登录为主） | 正向登录、空值校验、格式校验、错误密码失败、模式/tab 切换 | OPEN-PLATFORM-LOGIN-001、OPEN-PLATFORM-LOGIN-002、OPEN-PLATFORM-LOGIN-003、OPEN-PLATFORM-LOGIN-004、OPEN-PLATFORM-LOGIN-005、OPEN-PLATFORM-LOGIN-006、OPEN-PLATFORM-LOGIN-007 | 错误密码与正向登录受控执行；认证产物脱敏 |

## 变更影响分析

> 无变更时填写“无”；有变更时先全量复核需求追溯矩阵和覆盖基准与拆分清单，再记录受影响资产。局部变更仅将受影响用例退回草案；范围发生实质变化时建立新的测试请求。

| 变更编号 | 来源与版本 | 受影响需求追溯编号 | 影响判定与依据 | 受影响 caseId | 脚本/工程设计影响 | 数据/环境影响 | 是否复测与结论 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 无 | 无 | 无 | 无；新建请求 | 无 | 无 | 无 | 否；新建请求 | 草案 |

## 合理推断

- 本地 dev 实例（`[DEV]Hommor Aura 平台`）与线上开放平台为同一前端产物，登录页结构以本轮受控探索为准；经验库记录的 test 环境语义定位策略（`getByRole('textbox', { name })`、`getByPlaceholder()`）本地同样适用，已由探索验证账号/密码字段 ARIA 名称。

## 待补充信息

- 本地 dev 测试账号可用性：`.env` 现有 `OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST/_PASSWORD_TEST` 面向线上 test 环境，本地 dev 是否同一账号库未确认；正向登录与错误密码用例依赖可用账号。
- 登录页校验提示文案：空手机号、空密码、错误密码、格式非法的精确提示文本在受控探索中未稳定捕获，需 build 阶段 selector 探索确认后再补充为可选断言。
- 本地 dev 是否出现滑块安全挑战未确认；若出现，按经验库状态机人工接管。
- 短信验证码登录是否纳入本次执行，依赖本地 OTP 通道或固定测试码是否可用。

## 风险与审核事项

- 账号可用性是正向登录的硬依赖；若本地 dev 无可用账号，正向用例在 readiness 标记为 deferred，不阻塞计划与反向用例。
- 错误密码与正向登录可能触发安全挑战或账号锁定；限制单次受控尝试，失败即停，不重试。
- 认证产物脱敏：登录相关 Trace/截图/视频默认关闭，会话仅存 Git 忽略的 `.auth/` 目录，报告只记录脱敏结果与文件存在性。
- 本地 dev 环境稳定性（端口、服务持续可用）由用户保证；执行前需确认服务可达。

## 多角色评审记录

> 结构版本：multi-role-review-v1

> 结构版本：evidence-driven-evolution-v1

> 结构版本：auto-evolution-loop-v1

> 结构版本：knowledge-decision-v1

> 按[用例规范](../../../docs/testing/testcase-guideline.md)和 [Skill 评审提示卡](../SKILL.md#多角色隔离评审提示卡)填写输入基线、适用角色、正式结论与发现项。这里是结论和发现项正文的唯一正式来源；reviewer 派发、提交、等待与批次失效只写入 `workflow-history.ndjson`，宿主任务标识只写可丢弃 runtime。

> 阶段一计划暂不派发 reviewer；用例包生成后按 `case-review-risk-v2` 评级派发。

<!-- review-batch:REV-1:start -->

### 评审批次：REV-1

| 字段 | 内容 |
| --- | --- |
| 触发类型 | 常规（首稿评审） |
| 输入基线版本 | plan.md（含 cases-login.md 7 用例 + RULE-LOGIN-001~007 关系同步）；sources：aiot-platform-project-document/platform-home-and-registration、open-platform-axure-prototype/prototype-account-login、iot-platform-help/account-registration-faq；check:markdown/check:architecture/sync-relations/rule-design/testcase-quality 全通过 |
| 适用角色及依据 | combined（standard/strict 全部用例：需求覆盖与追溯）、impact（strict 用例 001/004 + 共享安全邻域：会话写入、安全挑战、敏感信息） |
| 复审来源 | 初审 |
| 隔离规则 | 仅向各角色提供引用资料 section、语义计划、scope 内用例与提示卡；未提供作者推理或另一 reviewer 结论；只读子 Agent（cc-combined-rev1、cc-impact-rev1） |
| 综合结论 | 可提交确认（自动演进项处置已定，build 工程层应用；2 项用户裁决与 1 项风险登记已记录，不阻塞用例确认） |

#### reviewer 正式结论

| 角色 | 角色输入基线 | 结论 | 发现项编号 | 正式结论摘要 |
| --- | --- | --- | --- | --- |
| 需求一致性(combined) | plan.md + cases-login.md(7) + docx §platform-home-and-registration + 原型 prototype-account-login | 需演进→处置已定 | MRR-COM-001~004 | 追溯完整性与断言纪律，低-中严重度，build 工程层应用 |
| 安全(impact) | plan.md + cases-login.md(001/004) + 安全邻域经验库 + AGENTS 安全边界 | 需演进→处置已定/记录 | MRR-IMP-001~007 | 账号事实、安全分支、脱敏在 build 工程层应用；执行顺序与截图策略 2 项待用户裁决，no_write 副作用风险已登记 |

| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRR-COM-001 | combined | 基准资料与模块映射表缺 RULE-LOGIN-007/005 行 | 需求覆盖缺口 | RULE-LOGIN-007/OPEN-PLATFORM-LOGIN-005 | 中 | 自动演进 | build 工程层补"手机号格式边界→RULE-LOGIN-007→005"映射行 | 已关闭 |
| MRR-COM-002 | combined | 覆盖矩阵状态与生命周期派生 caseId 缺 | 质量建议 | OPEN-PLATFORM-LOGIN-001 | 低 | 自动演进 | sync-relations 已回填派生列 | 已关闭 |
| MRR-COM-003 | combined | case 001 步骤 1 标题文案未由资料登记 | 资料明确的设计缺口 | OPEN-PLATFORM-LOGIN-001 | 低 | 自动演进 | build 阶段软化：标题精确文案待 selector 探索，不硬断言 | 已关闭 |
| MRR-COM-004 | combined | case 006 互斥方向未登记推断 | 质量建议 | OPEN-PLATFORM-LOGIN-006 | 低 | 自动演进 | build 阶段在 006 登记互斥方向推断 | 已关闭 |
| MRR-IMP-001 | impact | 账号可用性在正式决定与环境/REQ/RULE 三处不一致 | 业务裁决/资料冲突 | OPEN-PLATFORM-LOGIN-001/004 | 中 | 自动演进 | build 工程层以正式用户决定为准统一账号事实 | 已关闭 |
| MRR-IMP-002 | impact | 004 对共享真实账号错误密码提交，锁定计数可能波及 001 | 需求覆盖缺口 | OPEN-PLATFORM-LOGIN-001/004 | 中 | 用户裁决 | 待用户裁决：001 先于 004 执行 或 004 改用独立无效账号 | 待用户裁决 |
| MRR-IMP-003 | impact | 001/004 步骤未建模安全挑战后再观察分支 | 需求覆盖缺口 | OPEN-PLATFORM-LOGIN-001/004 | 中 | 自动演进 | build 阶段按经验库状态机写入再观察分支 | 已关闭 |
| MRR-IMP-004 | impact | 004 标 no_write 但错误密码提交有服务端锁定或审计副作用 | 质量建议 | OPEN-PLATFORM-LOGIN-004 | 低 | 风险登记 | build 工程层在脚本注释与计划风险补注 no_write 副作用 | 已关闭 |
| MRR-IMP-005 | impact | 全部用例一刀切关闭截图，反向用例可保留不含敏感原文证据 | 质量建议 | OPEN-PLATFORM-LOGIN-002/003/005/006/007 | 低 | 用户裁决 | 待用户裁决：是否对占位值用例放宽为最小局部截图 | 待用户裁决 |
| MRR-IMP-006 | impact | 001 成功定案仅凭前端状态 | 质量建议 | OPEN-PLATFORM-LOGIN-001 | 低 | 自动演进 | build 阶段以 URL+登录态元素为主断言，.auth 文件为佐证 | 已关闭 |
| MRR-IMP-007 | impact | 脱敏策略未覆盖 HAR/网络日志/控制台 | 质量建议 | OPEN-PLATFORM-LOGIN-001/004 | 低 | 自动演进 | build 工程层关闭或 redact HAR/网络日志/控制台认证响应 | 已关闭 |

#### 沉淀判定

| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |
| --- | --- | --- | --- | --- |
| MRR-COM-001~004 | 通用规则 | 当前 plan.md + build 工程层 | 资料已确认 | 已回链 |
| MRR-IMP-001 | 项目经验候选 | docs/testing/knowledge/open-platform-testing-knowledge.md | 待正式执行验证 | 已引用 |
| MRR-IMP-002 | 未验证推断 | 当前 plan.md（待补充信息） | 待用户裁决 | 待用户裁决 |
| MRR-IMP-003 | 通用规则 | 当前 plan.md（missingInfo）+ build | 待 build 验证 | 已引用 |
| MRR-IMP-004 | 项目经验候选 | docs/testing/knowledge/open-platform-testing-knowledge.md | 待正式执行验证 | 风险登记 |
| MRR-IMP-005 | 未验证推断 | 当前 plan.md（待补充信息） | 待用户裁决 | 待用户裁决 |
| MRR-IMP-006 | 通用规则 | 当前 plan.md（工程层待办） | 待 build 验证 | 已引用 |
| MRR-IMP-007 | 项目经验候选 | docs/testing/knowledge/open-platform-testing-knowledge.md | 待正式执行验证 | 风险登记 |

<!-- review-batch:REV-1:end -->

<!-- review-batch:REV-2:start -->

### 评审批次：REV-2

| 字段 | 内容 |
| --- | --- |
| 触发类型 | 变更（callback-reopen 后定向复审） |
| 输入基线版本 | plan.md（prototype 来源 SHA 0c21f0f7 修复后）；cases-login.md 来源 SHA 同步 |
| 适用角色及依据 | combined + impact（prototype SHA 影响 002/003/004/006/007 来源） |
| 复审来源 | REV-1（base-batch） |
| 隔离规则 | 只读子 Agent cc-combined-rev2、cc-impact-rev2；仅复审 prototype SHA 变化的受影响引用 |
| 综合结论 | 可提交确认（SHA 漂移修复，用例业务语义未变，无发现） |

#### reviewer 正式结论

| 角色 | 结论 | 发现项编号 | 正式结论摘要 |
| --- | --- | --- | --- |
| 需求一致性(combined) | 通过 | 无 | 7 用例语义与 SHA 更新前一致；来源 SHA 6 处引用一致，无残留 |
| 安全(impact) | 通过 | 无 | 数据策略、风险、门禁、安全处理未变；prototype 来源标注正确；无新风险 |

<!-- review-batch:REV-2:end -->

## 用例集评审与演进

> 用例草案完成后、用户确认前填写；每次修改用例集后重新评审。

- 需求追溯统计：4 条 REQ（001-004）全部适用，已关联 7 个 caseId（001-007）。
- 规则覆盖统计：7 条 RULE（001-007）全部适用且已覆盖；受控执行 2 条（RULE-LOGIN-003/006），无待用户裁决规则。
- 覆盖域复核：适用域（业务功能与规则、输入与数据校验、状态与生命周期、异常容错与恢复、安全与隐私、交互视觉与无障碍）均关联用例；不适用域已说明依据。
- 多角色评审复核：REV-1 combined+impact 初审完成，4+7 项发现；自动演进项处置已定（build 工程层应用），MRR-IMP-002/005 待用户裁决，MRR-IMP-004 风险登记。
- 发现的缺口与演进：MRR-COM-001 基准映射补行、MRR-IMP-001 账号事实统一等在 build 工程层应用；无资料冲突阻塞确认。
- 评审结论：可提交确认。

## 工程层：代码定位与自动化设计

> 仅在计划和适用用例均已确认后填写。该区块复用同一 `plan.md`，将 `caseId` 映射到代码、图谱、测试能力和脚本方案；不得改写业务层已确认的范围、步骤或预期。

> 阶段一不填写；用例确认后在 build Activity 内补充。

| 项目 | 内容 |
| --- | --- |
| 代码仓库 | 不适用（本地 dev 为远程运行实例，无本机被测源码仓库；`.local/repositories/` 未映射） |
| 仓库确认依据 | 用户指定本地 dev `http://127.0.0.1:3098`（`[DEV]Hommor Aura 平台`）为被测对象 |
| 分支/提交标识 | 不适用 |
| Graphify 图谱 | 不适用（远程实例，无源码图谱） |
| 图谱新鲜度 | 不适用 |
| 源码确认范围 | selector 契约以 Playwright 无头 runtime 验证为准（runtime_first_source_supplement）；selector-evidence.json 7/7 verified |

| caseId | 需求追溯编号 | 源码路径与定位依据 | 可复用能力 | 自动化结论 | 脚本与断言方案 | 数据/环境前置条件 | 风险或待确认项 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OPEN-PLATFORM-LOGIN-001 | REQ-LOGIN-001 | selector-evidence.json: account-login-phone/password/login-submit | formalCase 运行时 + getByRole ARIA | 可实现 | login.formal.spec.ts；URL 离开 /login + 登录态元素 | .env test 账号本地可用 | 安全挑战人工接管；登录态元素待 run 确认 |
| OPEN-PLATFORM-LOGIN-002 | REQ-LOGIN-002 | selector-evidence.json: account-login-phone/login-submit | formalCase | 可实现 | 留空手机号提交；停留 /login | 无 | 校验文案待确认 |
| OPEN-PLATFORM-LOGIN-003 | REQ-LOGIN-002 | selector-evidence.json: account-login-password/login-submit | formalCase | 可实现 | 留空密码提交；停留 /login | 无 | 校验文案待确认 |
| OPEN-PLATFORM-LOGIN-004 | REQ-LOGIN-003 | selector-evidence.json: account-login-phone/password/login-submit | formalCase | 可实现 | 正确手机号 + 错误密码；停留 /login | .env test 账号；001 先于 004 执行 | 安全挑战；服务端锁定计数（MRR-IMP-004） |
| OPEN-PLATFORM-LOGIN-005 | REQ-LOGIN-002 | selector-evidence.json: account-login-phone/login-submit | formalCase | 可实现 | 非11位手机号；停留 /login | 无 | 格式校验文案待确认 |
| OPEN-PLATFORM-LOGIN-006 | REQ-LOGIN-004 | selector-evidence.json: mode-switch-account/verifycode | formalCase | 可实现 | 模式切换字段可见可定位 | 无 | 互斥方向为探索推断 |
| OPEN-PLATFORM-LOGIN-007 | REQ-LOGIN-004 | selector-evidence.json: login-register-tab | formalCase | 可实现 | tab 切换 tabpanel | 无 | 无 |

### 规范差异与用户告知

| 差异编号 | 问题类别 | 具体事实与证据 | 受影响 caseId | 自动化影响 | 最小处理建议或待确认项 | 自动化结论 | 用户已告知 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-GAP-001 | 复用能力 | 本地 dev 无本机被测源码仓库；check:web-exploration status=fallback（chrome_devtools_mcp 适配器 node 版本不支持） | 全部 | selector 证据用 Playwright 无头 runtime 验证（非 MCP 适配器） | 可继续 build；适配器 fallback 不阻塞 | 部分自动化 | 是；本轮回复摘要 |

### 脚本与证据方案

- 拟修改或新增文件：`tests/web/open-platform/login-local-20260810/execution.manifest.ts`（v3）、`login.formal.spec.ts`（7 formalCase）、`selector-evidence.json`（source_contract buildEvidence）。
- 执行命令与目标环境：`npm run test:web:execute -- --request web/open-platform/login-local-20260810`；环境 test 映射本地 dev，baseUrl 覆盖 `OPEN_PLATFORM_WEB_BASE_URL_TEST=http://127.0.0.1:3098/`。
- 定位证据与可达边界：runtime_verified（selector-evidence.json 7/7）；001/004 真实登录提交为执行面，候选脚本 source_complete。
- 预期报告位置与逐用例证据：`artifacts/`；CaseEvidenceBundle 以 DOM 断言 + URL 状态为主，001 以 `.auth` 会话文件为佐证（MRR-IMP-006）。
- 差异与审核事项：无源码契约（远程实例），selector 以 runtime 为准；安全挑战仅人工接管。

#### 页面场景组映射

| sessionGroupId | targetRoute | caseIds | resetStrategy | isolationReason | executionOrder |
| --- | --- | --- | --- | --- | --- |
| GROUP-ACCOUNT-LOGIN | /login | OPEN-PLATFORM-LOGIN-001~007 | new_context_per_case | 认证与表单用例独立 Context | 001 → 006 → 007 → 002 → 003 → 005 → 004 |

#### 证据策略映射

| caseId / 场景组 | 证据策略 | 关键截图 | 视频或 Trace | 网络/控制台摘要 | 敏感步骤处理 |
| --- | --- | --- | --- | --- | --- |
| OPEN-PLATFORM-LOGIN-001/004 | 审计均衡 | 不采集（敏感） | 关闭 | HAR/控制台关闭或 redact（MRR-IMP-007） | 输入凭据遮罩；Trace/截图/视频关闭 |
| OPEN-PLATFORM-LOGIN-002/003/005/006/007 | 审计均衡 | 可选最小局部（不含输入敏感原文） | 关闭 | 关闭 | 占位值；按用户裁决 MRR-IMP-005 可最小局部截图 |

## 预计交付物

- 测试用例：`cases-login.md`（计划确认后生成）。
- 工程层设计：用例确认后补充到本 `plan.md`。
- 自动化脚本：`tests/web/open-platform/login-local-20260810/*.formal.spec.ts`（工程层确认后生成）。
- 执行报告：脚本审核与执行确认后生成。
