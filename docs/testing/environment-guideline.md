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
| `explore` | 通过 Inspector、ARIA/DOM、页面结构、安全导航和网络结构补齐定位与可执行性证据。 | 本机交互式探索同时显示专用 Chrome 与 Playwright Inspector；允许复用专用调试会话。 | 固定为 `0`。 |
| `execute` | 在脚本评审和统一执行清单确认后形成正式测试结果。 | 使用与探索隔离的唯一可见 BrowserServer；按 `PageSessionGroup` 复用或隔离 Context/Page。 | 只允许执行清单中的资源类型和数量。 |

- `explore` 默认阻止 `POST`、`PUT`、`PATCH`、`DELETE`。只有明确登记且整条 URL 精确匹配的无副作用查询接口可例外放行。
- 探索时不得发送验证码、上传文件、提交表单、创建或删除资源、控制设备；探索产物的结果资格只按[报告规范](./report-guideline.md#2-报告原则)判定。
- `execute` 中 UI 负责验证被测业务行为；API Client 只用于准备独立数据、后台状态验证和清理，不得替代需要验证的 UI 主路径。
- 正式执行使用 Playwright project dependencies 组织 `setup → test → teardown → report`。每个 worker 使用独立账号或数据命名空间。
- 只有 `no_write` 用例且每个 worker 的 Browser Context、账号、设备和数据命名空间完全隔离时，正式执行才可并行，最多使用 2 个 worker；存在业务写入、设备动作、共享账号/资源或无法证明隔离时必须使用单 worker。文件发布不属于用例 worker 并发范围，始终串行提交。
- Web 正式 Runner 在一次授权运行内只启动一个可见 Chrome BrowserServer。普通原子用例不得逐条重启 Chrome；Context/Page 的复用和重建必须由下述场景组契约决定。
- worker 超时或被中断时，teardown 必须关闭已开始但未提交的原子尝试，并由同一授权的恢复入口继续；结果状态由[报告规范](./report-guideline.md#4-执行结果标准)判定。
- 正式 setup 生成不含敏感值的能力清单，只保存能力是否可用、受影响 `caseId` 和解除条件。能力不足不得改变无关用例的环境前置；受影响用例的结果分类由报告规范判定。
- 跨用例前置以命名运行资源声明生产者和消费者。下游只依据资源是否已精确确认决定是否执行，不依据生产者用例最终是 `passed` 还是 `failed`；依赖图必须无环。
- 本机运行键由请求、环境和统一授权摘要稳定派生。worker 或进程重启时复用同一 run、预算、CreateIntent 和已确认资源；已通过用例不重复执行，`creation_unknown` 必须先精确对账。
- 验证码优先使用测试白名单、固定测试码或测试通道。真实验证码、滑块或其他安全挑战只能最小人工接管，禁止绕过。
- 输入密码、验证码、Cookie、Token 或真实个人数据的步骤必须暂停或遮罩图像类采集，并禁止将原始值写入网络或控制台摘要。证据类型、完整性和通过资格只见 [report-guideline.md](./report-guideline.md#41-逐用例可审计证据包)。

#### 6.1.1 `PageSessionGroup` 与 Context 隔离

未来 Web/H5 工程设计必须为每个正式 `caseId` 记录一个 `PageSessionGroup` 映射；该契约只描述会话与复位事实，不复制业务步骤或报告证据：

```text
sessionGroupId
targetRoute
caseIds
resetStrategy
isolationReason
executionOrder
```

- 同一路由、同一角色/租户、无远端写入且存在可验证 `resetStrategy` 的字段校验可以组成同一场景组，并顺序复用一个 Context/Page。
- 同一字段的场景默认按“异常 → 边界 → 正常”排序。每个原子 case 开始前执行并验证复位：清空目标字段、关闭临时提示、恢复依赖字段和页面基线；复位结果不得依赖前一 case 是否通过。
- 远端写入、认证或验证码、角色/租户切换、跨域状态流以及无法可靠复位的场景必须使用新的 Context/Page，但仍连接同一个 BrowserServer。一个已确认的单 case 端到端旅程可以在其自身 Context/Page 内连续完成。
- 页面复位失败时，仅当前场景组进入恢复：在同一个 BrowserServer 中重建 Context/Page、重新建立基线并继续尚未执行的独立 case；不得重启 Chrome、重复已通过 case 或把污染扩散为批量失败。
- 跨 case 的企业、账号状态、上传或其他业务前置只通过命名运行资源和台账传递；禁止依赖前一页面对象、表单残值或断言结果。
- `PageSessionGroup` 只影响调度和隔离，不改变“一条正式测试只绑定一个 `caseId`”以及每条 case 独立形成结果和证据的要求。

### 6.2 数据写入策略

每次正式执行选择一个 `DataWritePolicy`：

| 策略 | 适用范围 | 运行后处理 |
| --- | --- | --- |
| `no_write` | 页面、查询、本地校验和不会创建远端状态的动作。 | 不建立远端资源记录。 |
| `managed_cleanup` | 有已登记、幂等清理能力的合成资源。 | teardown 自动清理并验证；失败记录为 `cleanup_failed`。 |
| `tracked_residual` | `test` 环境中少量、合成、可唯一识别但暂时没有删除能力的资源。 | 状态记为 `retained`，保存到期时间并持续纳入预算和报告。 |

- `tracked_residual` 只允许 `test` 环境，默认 TTL 为 72 小时；生产和真实用户数据不适用。
- 每个请求必须按资源类型声明正整数上限。预算耗尽或存在已过期且未处理的残留时冻结新的写入用例，只读用例可继续。
- 没有删除接口不等于执行异常：已确认的限额残留记为 `retained`；归属、创建结果或风险未知时才记为 `manual_required` 或阻塞。
- 本机测试数据生命周期只管理 `.local/test-ledger/` 中 owner 为 `local-automation-test`，且 machineId、projectId、envId、runId、`caseId` 均明确的资源。台账外、其他机器、未知归属、生产或真实用户数据不得自动复用、修改或清理。
- 复用只允许 `available`、未污染、未过期且经 validator 确认可用的同机同项目同环境同类型资源；不得按名称、时间、数据库或设备列表模糊匹配。

### 6.3 创建意图与中断恢复

远端创建前必须先在 `.local/test-ledger/` 登记 `CreateIntent`，状态只按 `planned → creating → created`、`failed`、`creation_unknown → reconciled` 迁移。

- `reserveCreateIntent()` 在远端动作前登记唯一测试标识、`caseId`、资源类型、预算、TTL 和统一授权摘要。
- `markIntentCreating()` 后才允许发起创建；成功用 `confirmCreatedResource()` 记录脱敏资源引用，明确失败或结果未知分别使用对应状态。
- 中断恢复只能用唯一测试标识执行 `reconcileCreateIntent()` 精确对账；禁止扫描相似名称后猜测匹配或直接重复创建。
- `assertManagedWriteAllowed()` 同时校验环境、授权摘要、策略、预算和过期残留；任一项不满足时停止新的写入。
- 清理与恢复仅遍历本机台账。`managed_cleanup` 必须绑定已注册且幂等的 `cleanupActionId`；风险或归属不明时不得猜测业务删除方式。
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
