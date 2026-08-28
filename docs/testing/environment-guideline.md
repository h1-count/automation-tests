# 测试环境与配置规范

<!-- owns: automation.environment -->

## 1. 目的与适用范围

本文规定自动化测试的环境命名、地址管理、选择审批、生产保护、健康检查和测试数据隔离方式，适用于开放平台 Web、H5、App、WebView、API、MQTT 和 IoT 链路测试。

项目强制规则以 [AGENTS.md](../../AGENTS.md) 为准；环境变量名称与地址目录以 [.env.example](../../.env.example) 为准。

## 2. 环境定义

本项目只使用以下标准环境名称：

| 环境 | `TEST_ENV` 值 | 适用场景 | 默认可执行性 |
| --- | --- | --- | --- |
| 测试环境 | `test` | 功能验证、日常回归、测试数据准备。 | 可执行，仍需已确认测试计划。 |
| 预发环境 | `pre` | 发布前验证、环境兼容性和关键回归。 | 可执行，需确认影响范围。 |
| 生产环境 | `prod` | 仅限经审批的只读或低风险验证。 | 默认禁止。 |

`staging` 可作为 `pre` 的别名，`production` 可作为 `prod` 的别名；脚本内部会统一解析为标准环境名称。新环境不得自行增加，除非同步更新环境解析、`.env.example`、测试计划和本规范。

## 3. 地址与配置管理

### 3.1 配置文件职责

| 位置 | 可保存内容 | 是否提交 Git |
| --- | --- | --- |
| `.env.example` | 环境变量名称、非敏感地址示例、配置说明和空占位符。 | 是 |
| `.env` / `.env.*` | 本机实际地址、测试账号引用、设备标识和本地配置。 | 否 |
| CI Secret / 配置中心 | 密码、Token、密钥和 CI 专用敏感配置。 | 否 |
| `src/env/` | 环境名解析、变量校验和受控读取逻辑。 | 是 |

禁止将密码、Token、密钥、真实用户信息或未脱敏的设备标识写入测试代码、测试用例、报告、截图、Trace 或 Git 仓库。

### 3.1.1 测试身份命名

测试身份按“系统 + 角色 + 环境”命名，而不是按单个 URL 命名。例如：

```text
OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST
CENTRAL_ADMIN_OPERATOR_USERNAME_PRE
MOBILE_APP_USER_USERNAME_TEST
OPEN_PLATFORM_API_TOKEN_TEST
MQTT_USERNAME_TEST
```

同一个 SSO、相同角色和相同环境可以在本地 `.env` 或 CI Secret 中映射为同一组实际凭据；变量名仍保留业务语义，避免权限变化后无法拆分。不同系统、角色、租户、环境或鉴权方式必须使用独立测试身份。

### 3.2 地址变量

地址按“系统 + 地址类型 + 环境后缀”命名，例如：

```text
OPEN_PLATFORM_WEB_BASE_URL_TEST
OPEN_PLATFORM_WEB_BASE_URL_PRE
OPEN_PLATFORM_WEB_BASE_URL_PROD

OPEN_PLATFORM_ADMIN_LOGIN_URL_TEST
CENTRAL_ADMIN_LOGIN_URL_TEST

OPEN_PLATFORM_API_BASE_URL_TEST
MQTT_BROKER_URL_TEST
```

已配置的开放平台和管理后台地址见 `.env.example`。API 和 MQTT 地址未提供前必须保持为空，不能从页面 URL 推测或替换为生产地址。

### 3.3 App 配置

原生 App 不使用页面 URL 作为启动目标。App 测试需要配置：

- Appium Server：`APPIUM_HOST`、`APPIUM_PORT`。
- 设备：平台、自动化引擎、设备名和可选 UDID。
- App 目标：`APPIUM_APP_PATH`，或已安装 App 的 `APPIUM_APP_PACKAGE` 与 `APPIUM_APP_ACTIVITY`。
- 后端环境：由已确认的 `TEST_ENV` 和测试 App 包/远程配置共同确定。

`APPIUM_APP_PATH` 与 `APPIUM_APP_PACKAGE`/`APPIUM_APP_ACTIVITY` 必须二选一；包名和 Activity 必须同时填写。具体值保留在本地 `.env` 或 CI 配置中。

计划阶段可从 `test-assets/manifest.yaml` 选择已登记的 App 安装包候选，并以 `npm run check:environment -- --plan --asset <assetId>` 验证文件与 SHA-256。该选择不写入 `.env`，也不代表包名、Activity、Appium Server、设备兼容性或安装状态已验证；这些条件只在工程设计和执行前检查。即使缺少这些工程条件，业务测试计划和用例生成仍可继续。

### 3.4 凭据、验证码与认证会话

测试所需的账号、密码、Token、验证码和认证会话均属于敏感配置；它们的使用边界如下：

- 缺少账号、密码、Token 或验证码时，暂停在执行前或安全等待点，向用户说明所需字段、用途、目标环境和本次影响；不得猜测、复用其他环境凭据或绕过认证。
- 长期测试凭据仅保存于本地 `.env` 或 CI Secret。用户在对话中临时提供的凭据或一次性验证码只用于当前已确认任务，不得写入代码、测试用例、脚本、命令行参数、日志、报告、截图、Trace、视频或项目文件，也不得在回复中回显。
- 获取或提交验证码可能触发短信、限流或风控，必须先获得本次操作的明确确认。认证相关产物必须关闭可能回显输入的 Trace、截图、视频和调试日志；无法脱敏时停止执行。

登录受到滑块或其他人机验证保护时，认证策略按以下优先级选择：

1. **测试环境受控能力**：测试账号/IP 白名单、测试模式、测试 Token 或非生产环境的受控服务端豁免。这是首选方案；不得在脚本中模拟、绕过或破解人机验证。
2. **人工初始化会话**：用户在测试环境人工完成一次安全挑战，运行 `npm run auth:open-platform:initialize` 保存本地 Playwright `storageState`，后续使用 `npm run test:web:authenticated` 执行已登录业务测试。

会话文件路径由以下变量按环境配置：

```text
OPEN_PLATFORM_AUTH_STATE_PATH_TEST
OPEN_PLATFORM_AUTH_STATE_PATH_PRE
OPEN_PLATFORM_AUTH_STATE_PATH_PROD
```

会话文件包含 Cookie 和 Local Storage，等同敏感凭据：只允许保存在被 Git 忽略的 `.auth/` 或 CI Secret；不得提交、分享、放入报告或用于生产环境。会话失效、环境切换、账号/权限变更后必须删除并重新人工初始化。

认证初始化遵循“自动化 → 人工安全挑战 → 自动化继续”：脚本自动完成账号填写、协议勾选、普通登录提交、状态检查和后续确定性操作；用户只完成滑块、验证码、人机验证或设备确认。具体阻碍恢复状态机和探索要求见 [automation-guideline.md](./automation-guideline.md)。

正式用例包含人工安全挑战时，必须在不可变执行清单中声明覆盖该挑战和前后自动步骤的有界用例超时；输入点自身的长等待不能被外层默认超时提前终止。安全等待仍不得记录或回显验证码。

## 4. 环境选择与审批

### 4.1 选择优先级

```text
用户在已确认测试计划或对话中明确指定的环境
    ↓
已确认测试用例的 targetEnvironment
    ↓
DEFAULT_TEST_ENV
```

用户未明确环境时，测试计划一律将 **`test`** 作为默认候选环境，并在同一轮计划确认中与范围、业务预期、风险和数据影响一并展示；额外用一句话提示“未指定环境，已默认使用 test 待确认”，不得单独要求用户确认是否使用 `test`。用户明确指定环境、已确认计划或已确认用例另有目标环境时，才覆盖这一默认值。

### 4.1.1 测试计划安全环境预检

生成或更新测试计划时，运行 `npm run check:environment -- --plan`。未明确环境时该模式固定预检 `test`，不受本地 `DEFAULT_TEST_ENV` 覆盖；该模式只读取本地 `.env` 的**配置存在性和可解析性**，检查目标环境、开放平台测试账号引用和认证会话文件；不访问业务服务，不读取或输出地址、账号、密码、Token、Cookie 或会话内容。

测试计划的环境表记录“本地配置状态”“预检状态”“正式决定引用”和“未闭合项”；环境选择本身只在“正式用户决定”表记录一次：

- **已配置**：变量存在或地址可解析；不表示账号可登录、环境可访问或允许执行。
- **已预检**：本地配置结构与会话文件已完成检查；不表示业务服务可用。
- **正式决定引用**：指向用户明确选择目标环境的正式决定；这是进入后续执行门禁的必要条件，不能由 `.env` 自动推导。

未执行预检时写“未读取”或“未预检”，不得因未读取敏感配置而写“未提供”。

### 4.2 运行时切换

确认环境后，通过 `TEST_ENV` 切换：

```env
TEST_ENV=test
```

或：

```env
TEST_ENV=pre
```

`src/env/testEnvironment.ts` 会读取同名后缀的地址变量。切换环境只修改 `TEST_ENV` 或由 CI 注入该值，不得修改测试脚本中的 `baseURL`、API 地址或 MQTT Broker 地址。

### 4.3 生产环境保护

生产环境必须同时满足：

1. 测试计划明确选择 `prod`，并经用户审核确认。
2. 用例和执行方案已审核，操作范围为只读或已批准的低风险范围。
3. 运行时显式设置：

```env
TEST_ENV=prod
ALLOW_PRODUCTION_TESTS=true
```

4. 不涉及删除真实数据、批量设备操作、硬件控制、断网、刷固件或其他高风险动作。

任一条件不满足时，Runner 应停止执行。`ALLOW_PRODUCTION_TESTS=true` 不是生产测试授权的替代品，而是防止误执行的第二道技术保护。

## 5. 环境健康检查

执行测试前，按测试类型检查以下项目：

| 测试类型 | 必查项 |
| --- | --- |
| Web / H5 | 已确认 URL 可访问、登录入口正常、测试账号可用、页面加载无阻塞错误。 |
| App | Appium Server 可用、设备/模拟器在线、App 包或已安装 App 配置完整、App 后端环境已确认。 |
| API | Base URL、鉴权方式、测试账号或 Token 引用、关键依赖服务可用。 |
| MQTT / IoT | Broker 连通、Topic 和权限正确、测试设备可用、消费/入库路径可观测。 |

健康检查脚本应放在 `scripts/check-environment.ts`。在该脚本实现前，执行方案必须列明人工检查项和未验证风险。

## 6. 测试数据与账号隔离

- 使用专用测试账号、测试设备和可识别的测试数据前缀，不复用真实用户或真实设备。
- 每次创建产品、设备、告警或其他数据前，确认唯一命名规则和本次数据策略；不得承诺没有后端能力支撑的事务回滚。
- 测试数据准备与清理必须随当前已确认测试请求设计：可复用初始化放在 `src/fixtures/`，可复用清理放在 `src/support/cleanup/`，仅当前请求使用的受控操作放在 `scripts/`。不得假设存在固定的 `prepare-test-data.ts` 或 `cleanup-test-data.ts`。
- 并发执行时，账号、设备和数据必须隔离，避免共享状态污染结果。
- 不得创建真实个人信息、凭据、验证码、Token、真实通知/计费记录、不可逆设备动作或无法识别归属的数据；生产环境始终不允许受控残留。

### 6.1 运行模式

Web 自动化每次运行必须选择且只能选择一种模式：

| 模式 | 目的 | 浏览器与会话 | 业务写入预算 |
| --- | --- | --- | --- |
| `explore` | 对真实页面候选和源码推导的 selector 做零写入验证，并在证据不足时通过 Inspector 补齐 ARIA/DOM、页面结构、安全导航和网络结构证据。 | Web/H5 可先使用隔离 Chrome 的只读探索适配器；最终验证和交互 fallback 仍由 Playwright Inspector 完成。 | 固定为 `0`。 |
| `execute` | 在 readiness 和统一执行清单确认后形成正式测试结果。 | 默认无头；可共享 Runner 持有的 BrowserServer，但每个 case 使用独立 Context/Page，只有受控 `PageSessionGroup` 可复用。 | 只允许执行清单中的资源类型和数量。 |

- `explore` 内部顺序固定为资格检查后的只读真实页面候选探索、源码契约补齐、`test:web:verify-selectors` 无头验证、必要时可见 Inspector fallback；探索适配器不可用时直接跳过首步。它们都不形成新的工作流状态或用户确认。
- 只读真实页面探索仅适用于 Web/H5 的 test/pre 环境、匿名且无敏感数据的页面；它使用临时 profile、loopback CDP、Service Worker 阻断和网络写 guard。不得连接普通浏览器、认证会话、正式 Runner 或生产环境；它只产生候选证据，不能产生 `runtime_verified`、正式结果或能力证据。
- `explore` 默认阻止 `POST`、`PUT`、`PATCH`、`DELETE`。只有明确登记且整条 URL 精确匹配的无副作用查询接口可例外放行。
- 探索时不得点击或触发保存、注册、提交、发送验证码、上传文件、创建或删除资源、控制设备；网络 guard 只是防御措施，不能把这些操作作为页面探测手段。无头验证仅允许 locator 查询、断言和 `trial` actionability。
- 本地 mock、组件 fixture 和预置只读状态可以用于探索；会创建远端状态的 API/fixture 必须留在执行清单确认后的正式 setup。零写入无法穿越的边界只记录为 `reachableBoundary`，不能把下游写成已验证。
- `execute` 中 UI 负责验证被测业务行为；API Client 只用于准备独立数据、后台状态验证和清理，不得替代需要验证的 UI 主路径。
- 受控写入只适用于 `test` 环境的合成测试账号、企业、产品及同等可识别测试资源：每项必须同时具备唯一合成标识、授权 `caseId`、资源与操作预算、当前本机台账归属、已评审的 UI 操作证据和清理/基线恢复策略。`test_write` 不是对任意业务数据的豁免；真实、未知归属或台账外资源一律拒绝。
- 正式执行由 Runner 事务组织 `能力复核 → 惰性 setup → test/postcondition → finally cleanup/reconcile → report`。未被 runnable case 引用的 fixture 不初始化；每个 case 默认使用独立 Context，每个并行 worker 使用独立账号或数据命名空间。
- waiting external transition 属于可恢复的 park，不是 terminal teardown。park 时不得运行资源 cleanup、结束 test-data run、改变业务资源状态或登记伪清理结论；解除转换后必须复用同一授权、run、预算、CreateIntent 和已确认资源继续。只有不存在 waiting transition 时才允许 terminal settlement。
- 只有 `no_write` 用例且每个 worker 的 Browser Context、账号、设备和数据命名空间完全隔离时，正式执行才可并行，最多使用 2 个 worker；存在业务写入、设备动作、共享账号/资源或无法证明隔离时必须使用单 worker。文件发布不属于用例 worker 并发范围，始终串行提交。
- Web 正式 Runner 在一次授权运行内只启动一个 BrowserServer，默认无头，只有显式 `--headed` 调试时可见。普通原子用例不得逐条重启浏览器；Context/Page 默认按 case 新建，复用必须由下述场景组契约明确允许。
- worker 超时或被中断时，teardown 必须关闭已开始但未提交的原子尝试，并由同一授权的恢复入口继续；结果状态由[报告规范](./report-guideline.md#4-执行结果标准)判定。
- `readiness` 通过 Capability Provider 生成不含敏感值的能力证据，只保存能力是否可用、证据摘要、受影响 `caseId` 和解除条件；正式 `run` 仅复核清单内 runnable case 的能力。能力不足不得改变无关用例的环境前置。
- 公开任务 CLI（包括 `task:manage` 的 readiness）启动时自动加载当前工作区 `.env`；已由 shell 或 CI Secret 导出的同名变量保持优先，不被 `.env` 覆盖。需要环境专用文件时使用 `DOTENV_CONFIG_PATH` 指向受控 `.env.*`；能力证据和诊断仍只允许输出变量名摘要与配置布尔值，不得输出原值。
- 新候选脚本通过 manifest 声明自己依赖的 capability；脚本只能调用 `runtime.useCapability(capabilityId)` 取得当前 case 已声明、且 readiness 评定可用的 provider 值。已注册 provider 在当前环境不可用时，Runner 在启动 Playwright 前将该 case 标记为 deferred；未注册 provider 在 readiness 直接作为 invalid build input。脚本正文不得保留固定阻断占位。
- 可编译、可评审的浏览器响应解析契约、`test-assets/manifest.yaml` 中 active 的 Git 静态资产及本地确定性生成器属于 `build`，不得用布尔环境变量伪装成 Capability Provider，也不得要求 `.env` 重复配置资产 ID 或可由需求直接确定的参数。新 manifest 通过 `requiredTestAssetIds` 和 `test_asset` 构建证据冻结资产身份、路径与实际 SHA-256；缺失、范围不匹配或摘要漂移是 `invalid build`。账号、OTP、远端 fixture、异步状态查询、cleanup 和真实 adapter 才是 readiness 检查的运行时能力；`runtime-validation-pending` 只是一种实现状态，不得注册为永久 unavailable 的哨兵 provider，`pendingCapabilityIds` 必须引用真实能力。
- `requiredCapabilities` 只允许声明 case 当前阶段启动必需的能力。参数矩阵中的可选精确样本、仅影响一个等价类的输入或后续阶段能力必须单独记录，不得把整条 case 延期。资料未定义 KB/MB 等换算口径时，使用对十进制和二进制口径都明确成立的代表值；不执行精确等号与一字节相邻断言，也不增加环境变量索取该口径。
- Provider 必须在 Runner 注册表中有真实 `check`，脚本需要取值时还必须有 `use`；仅在 manifest 填写名称或 TypeScript 接口不算实现。未注册 Provider 是构建输入错误，readiness 将受影响 case 标为 `invalid`，不输出解除环境条件后可自愈的 `deferred`。
- UI 可见的结果直接在 Playwright 用例中判断：先用 role/name、label、文本、属性、列表数量、路由和精确浏览器响应；只有纯布局、图表、图像或无稳定结构的组合状态才使用脱敏局部截图和宿主模型 rubric 兜底。截图不得包含密码、OTP、Token、Cookie、手机号或真实业务数据，模型结论不得用于证明不可见的服务端事实。
- 写入结果优先使用已冻结的业务响应契约；只有异步最终一致性、响应丢失/漂移后的单次 fallback、清理核对或浏览器无法判定结果时才调用后置查询。UI 仍需在存在稳定可见状态时验证前端已消费响应，但视觉、截图和 ARIA 只证明外观或语义，不能证明服务端保存。
- 密码、OTP、Token 或禁止图像采集的正式 case 必须在执行 manifest 声明 `evidencePolicy: "sensitive"`；runnable 范围只要包含一个敏感 case，Runner 即对整批关闭 screenshot 与 Trace，使用结构化步骤、脱敏断言及安全前后状态替代。
- 跨用例前置以命名运行资源声明生产者和消费者。依赖关系只允许由 `producesResources → requiredResources` 推导，不得使用 case 编号、文件顺序或平行 `dependsOnCaseIds`；下游只依据资源是否已精确确认决定是否执行，不要求生产者整个 case 已终态，依赖图必须无环。
- Web 候选在 `build` 只声明命名资源、创建意图、UI 身份绑定和 UI 清理步骤，不要求已有 PID、产品 ID 或远端基线。`readiness` 复核人工初始化的本地认证会话、正式授权、预算和已评审的 UI 清理路径；它们缺失时仅阻塞运行，不得回退为构建失败或搜索旧数据目录。
- 本机运行键由请求、环境和统一授权摘要稳定派生。worker 或进程重启时复用同一 run、预算、CreateIntent 和已确认资源；已通过用例不重复执行，`creation_unknown` 必须先精确对账。
- 验证码优先使用测试白名单、固定测试码或已实现的测试通道。项目没有该通道时，用例可将 `send_test_otp` 声明为 `ui_state` 证据：正式 Runner 必须以 `--headed` 启动同一可见会话，脚本最多发送一次并等待发送成功的倒计时状态，用户只在页面内输入本次验证码，输入完成后脚本自动继续。不得通过对话、命令行、`.env`、Provider、history 或报告传递一次性验证码；等待必须有界，超时后冻结同一 intent 且禁止自动重发。滑块或其他安全挑战仍只能在该可见会话中最小人工接管，禁止绕过。
- 输入密码、验证码、Cookie、Token 或真实个人数据的步骤必须暂停或遮罩图像类采集，并禁止将原始值写入网络或控制台摘要。证据类型、完整性和通过资格只见 [report-guideline.md](./report-guideline.md#41-逐用例可审计证据包)。

#### 6.1.1 `PageSessionGroup` 与 Context 隔离

新 Web/H5 的 `formal-execution-manifest-v1` 必须为每个正式 `caseId` 记录一个 `PageSessionGroup` 映射；请求候选使用 `scope=request`，晋升后的稳定套件使用 `scope=stable_suite`。该契约只描述会话与复位事实，不复制业务步骤或报告证据：

```text
sessionGroupId
targetRoute
caseIds
resetStrategy
isolationReason
executionOrder
```

- `resetStrategy` 只允许 `preserve_unrelated_fields`、`reload_route` 或 `new_context_per_case`。前两者只适用于 `read_only + no_write`；manifest 只要声明分组，就必须恰好覆盖全部 case，且共享组强制单 worker 顺序执行。
- 同一路由、同一角色/租户、无远端写入且存在可验证 `resetStrategy` 的字段校验可以组成同一场景组，并顺序复用一个 Context/Page。
- `preserve_unrelated_fields` 下，每个 case 只需主动设置并验证自己的目标字段；其他输入框的残值和错误提示不得参与本 case 结论。存在跨字段联动时必须改用 `reload_route` 或独立 Context。
- 远端写入、认证或验证码、角色/租户切换、跨域状态流以及无法可靠复位的场景必须使用新的 Context/Page，但仍连接同一个 BrowserServer。一个已确认的单 case 端到端旅程可以在其自身 Context/Page 内连续完成。
- 共享 Page 意外关闭、路由偏离或 Playwright 因失败重启 worker 时，仅当前场景组在同一个 BrowserServer 中重建 Context/Page 并继续尚未执行的独立 case；失败现场不承诺长期保留，不得重复已通过 case 或把污染扩散为批量失败。
- 跨 case 的企业、账号状态、上传或其他业务前置只通过命名运行资源和台账传递；禁止依赖前一页面对象、表单残值或断言结果。
- `PageSessionGroup` 只影响调度和隔离，不改变“一条正式测试只绑定一个 `caseId`”以及每条 case 独立形成结果和证据的要求。
- 页面复用只发生在同一拓扑波次和 worker 生命周期内；跨人工转换、进程重启或不同依赖波次必须重新建立页面。Runner 只按当前波次决定是否降为单 worker。
- OTP、上传、提交和人工输入所在的写入组仍使用独立 Context；但脚本必须在进入这些不可无成本重放的边界前，先验证后续确定性控件与定位契约，避免用户完成验证码输入后才暴露本可提前发现的脚本错误。

### 6.2 数据写入策略与跨请求资源池

新正式用例按 case 选择当前 `DataWritePolicy`：

| 策略 | 适用范围 | 运行后处理 |
| --- | --- | --- |
| `no_write` | 页面、查询、本地校验和不会创建远端状态的动作。 | 不建立远端资源记录。 |
| `ephemeral_cleanup` | 用例临时创建或修改的合成资源。 | 在 `finally` 中删除或恢复基线并保存结果证据。 |
| `reusable_fixture` | 需要供后续请求复用的合成测试企业、账号或子资源。 | 校验基线后晋升资源池；租用结束后恢复基线或隔离。 |
| `tracked_residual` | `test` 环境中少量、合成、可唯一识别但暂时没有删除能力的资源。 | 状态记为 `retained`，保存到期时间并持续纳入预算和报告。 |

- `managed_cleanup` 不是当前策略；任何该标识都必须被拒绝，不做映射、迁移或回放。
- `tracked_residual` 只允许 `test` 环境，默认 TTL 为 72 小时；生产和真实用户数据不适用。
- 每个请求必须按资源类型声明正整数上限。预算耗尽或存在已过期且未处理的残留时冻结新的写入用例，只读用例可继续。
- 资源类型预算之外，正式 manifest 还必须用 `operationBudgets` 冻结每个 case 的登录、OTP、上传、提交、查询等最大次数；参数化循环不得只依赖请求级总预算。
- 没有删除接口不等于执行异常：已确认的限额残留记为 `retained`；归属、创建结果或风险未知时才记为 `manual_required` 或阻塞。
- 稳定 suite 只复用已评审的数据策略、操作上限和资源池预算设计；每个 `runRequestId` 必须创建独立 run 台账、CreateIntent、lease/fencing、能力证据、cleanup 结论和 completion seal。旧 run 的数据、结果、授权或能力有效期不得复用。
- `policy_auto_no_write_v1` 在 readiness 后按实际 case 与脚本动态判定，不使用初始化时的空 plan 推断。它仅适用于 `test/pre`、全部 runnable case 均为 `read_only + no_write`、无 deferred、能力全部通过且脚本操作与 case 策略一致的本轮授权。允许预配专用测试账号、CI Secret 或已保存会话，但不得回显敏感值、发送 OTP 或创建新认证副作用。生产、OTP、上传、提交、数据写入、设备动作、权限提升或任一无法证明的条件都降级为用户确认执行清单。
- 本机测试数据生命周期只管理 `.local/test-ledger/` 中 owner 为 `local-automation-test`，且 machineId、projectId、envId、runId、`caseId` 均明确的资源。台账外、其他机器、未知归属、生产或真实用户数据不得自动复用、修改或清理。
- 资源池唯一键为 `projectId + environment + resourceType + baselineContractId`。复用只允许 `available`、未污染、未过期且经 validator 确认可用的同机资源；不得按名称、时间、数据库或设备列表模糊匹配。
- 只读用例可取得 `shared_read` 租约，任何修改必须取得 `exclusive` 租约。浏览器 Context、Cookie、storage 和 page 仍按用例隔离，共享的只是已校验服务端 fixture。
- 资源状态按 `available → leased → used → available` 流转；基线恢复或校验失败时转为 `quarantined`，恢复失败或资源丢失时转为 `retired`。只有执行清单已授权创建预算时才能惰性补充替代资源。
- terminal cleanup 必须按返回的完整摘要判定，不得以调用未抛异常视为成功。无资源为 `not_required/clean`；全部临时资源已清理为 `passed/clean`；未污染、未过期且已归还为 `available` 的可复用资源为 `passed/reusable`；未过期且符合已确认预算与 TTL 的受控残留为 `passed/retained`。存在 `cleanup_failed`、`manual_required`、`quarantined`、`retired`、过期残留、dirty 标记或任何非终态资源时必须失败，并且失败理由只保存状态与数量，不保存资源 ID 或业务值。
- cleanup 失败只改变 `dataHygieneStatus`，不得覆盖已经形成的 `functionalStatus`；立即冻结同一资源类型及其依赖链的后续写入，但无关 `no_write` 用例可继续。test-data run 保持未闭环，待同一 request 的确定性 UI 恢复完成后重新 settlement；不得新建后继请求或盲目重放写入。只有数据卫生被接受后才结束 run，结束接口必须显式接收功能状态，不能从 cleanup 结果反推产品结果。
- 注册成功测试每次仍使用唯一合成数据创建新企业；满足稳定脱敏身份、版本化基线、池容量和退役策略后才可晋升。登录和查询可租用已校验企业；修改后必须恢复基线；删除用例优先创建一次性资源，不得删除标准共享企业。
- 任何 CRUD 请求必须可独立运行：从资源池校验并租用，或按已确认预算创建。禁止依赖另一请求或前一用例恰好执行成功。
- 同一已授权 run 内的显式生产者—消费者关系不属于偶然顺序依赖：生产者创建唯一合成资源并写入台账，消费者只通过命名资源和基线契约取得它。审核中的资源是合法阶段中间态，不记为脏数据；审核通过后必须再经登录或基线校验才能晋升 `reusable_fixture`。
- CRUD 集成链路使用命名资源按 `新增 → 查询 → 修改 → 删除` 拓扑执行；修改和删除只能取得本次创建并登记的合成资源句柄。独立删除用例必须由已授权 setup 创建专用一次性资源，不能依赖其他用例碰巧成功；删除断言失败后允许 cleanup fallback 处理残留，但清理成功不得覆盖产品删除失败。
- 审核驳回资源只用于验证按反馈重新发起注册，不得解释成修改已注册企业。外部转换后的账号、通知和状态能力采用延迟检查；账号值只从本地 `.env` 或 CI Secret 读取，转换证明、history、台账和报告只保存布尔结论及摘要。

### 6.3 创建意图与中断恢复

远端创建前必须先在 `.local/test-ledger/` 登记 `CreateIntent`，状态只按 `planned → creating → created`、`failed`、`creation_unknown → reconciled` 迁移。

- `reserveCreateIntent()` 在远端动作前登记唯一测试标识、`caseId`、资源类型、预算、TTL 和统一授权摘要。
- `markIntentCreating()` 后才允许发起创建；成功用 `confirmCreatedResource()` 记录脱敏资源引用，明确失败或结果未知分别使用对应状态。
- 中断恢复只能用唯一测试标识执行 `reconcileCreateIntent()` 精确对账；禁止扫描相似名称后猜测匹配或直接重复创建。
- `assertManagedWriteAllowed()` 同时校验环境、授权摘要、策略、预算和过期残留；任一项不满足时停止新的写入。
- 清理与恢复仅遍历本机台账。UI 主路径套件的 `ephemeral_cleanup` 必须由同一正式 UI 脚本执行、记录响应/界面证据并验证完成；风险或归属不明时不得猜测业务删除方式。
- 功能结论与数据卫生结论的报告字段及合并规则只见[报告规范](./report-guideline.md#5-报告最小字段)。
- 活跃台账位于 Git 忽略的 `.local/test-ledger/`；正式报告只引用脱敏摘要路径、数量、状态和残留风险。旧 `.local/test-data/` 仅作只读历史证据。

## 7. 访问、日志与报告

- Web、App、API、MQTT 地址只能从环境变量或受控配置读取，禁止硬编码。
- 日志仅记录脱敏后的 URL、请求摘要、设备别名和必要上下文；不得输出密码、Token、密钥或完整敏感 Payload。
- 报告、截图、Trace、视频和原始结果写入 `artifacts/`，并由 `.gitignore` 排除。
- 出现环境不可用、认证失败、Broker 不通或 Appium 连接失败时，优先归类为环境问题，不应直接修改产品或 selector 脚本。

## 8. 环境变更流程

新增、修改或下线环境时：

1. 更新 `.env.example` 中的变量名称、地址目录和说明，不提交真实密钥。
2. 更新 `src/env/` 中的环境解析与保护规则。
3. 更新本规范、README 和相关测试计划模板。
4. 补充或更新环境健康检查。
5. 审核所有受影响测试用例的 `targetEnvironment`、脚本和 CI 配置。

不得只修改单个测试脚本中的 URL 来绕过环境配置与审核流程。
