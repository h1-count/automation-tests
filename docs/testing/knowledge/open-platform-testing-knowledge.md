# 开放平台项目测试经验

> 本文件只保存开放平台的当前项目经验记录；适用范围、格式、状态、证据资格、覆盖、锚点和授权边界统一遵循[项目测试经验规范](./README.md)。原始平台事实、正式规则、用例、报告、执行证据和用户偏好仍保留在各自事实源中。

<!-- project-experience:3C5F6D780B26:start -->
<a id="exp-3c5f6d780b26"></a>
## 2026-07-13：开放平台创建或配置 IoT 产品，特别是 WiFi 设备

- 经验编号：EXP-3C5F6D780B26
- 适用范围：开放平台创建或配置 IoT 产品，特别是 WiFi 设备
- 证据状态：待验证
- 观察：配网方式受芯片、固件、厂商和设备形态约束；页面右侧“查看详情”提供联网方式、配置项、配置选项及说明。仅因测试产品而选择 `mi-SoftAP`、`zennze-SoftAP` 等厂商专属方案没有依据。
- 判断：未知设备芯片、固件或厂商协议时，不能猜测或随意选择 SoftAP/BLE 专属方案。
- 当前优先策略：先查看配网方式详情，再检索可用知识库；仍无法确认设备约束时默认选择“设备二维码绑定”；已确认 ESP32、门锁、厂商协议或网关能力时才选择相应专属方案。
- 证据引用：开放平台产品创建/配置页受控探索
- 验证条件：一次受控的产品创建或配网操作中按此策略选择配网方式且未被平台拒绝。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:3C5F6D780B26:end -->

<!-- project-experience:6904ECA9CD6F:start -->
<a id="exp-6904eca9cd6f"></a>
## 2026-07-13：开放平台测试环境的账号密码登录会话初始化

- 经验编号：EXP-6904ECA9CD6F
- 适用范围：开放平台测试环境的账号密码登录会话初始化
- 证据状态：待验证
- 观察：登录提交后可能出现滑块安全挑战；挑战完成后还可能出现后续验证输入或需要再次提交的页面状态。
- 判断：不能将“滑块完成”直接等同于“登录成功”，也不能在单次人工操作后结束浏览器会话。
- 当前优先策略：使用“自动填写与提交 → 识别挑战或登录成功 → 人工仅完成安全挑战 → 自动重新观察 → 自动完成可确定的填写与提交 → 登录态校验”的状态机；仅在出现新的安全挑战时再次请求人工。
- 证据引用：开放平台账号登录受控探索与登录态初始化
- 验证条件：一次含安全挑战的登录态初始化中状态机完整闭环，且未在单次人工操作后错误结束会话。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:6904ECA9CD6F:end -->

<!-- project-experience:3F008609A5AF:start -->
<a id="exp-3f008609a5af"></a>
## 2026-07-13：开放协议接入产品完成基础配置后，进入“功能定义”阶段

- 经验编号：EXP-3F008609A5AF
- 适用范围：开放协议接入产品完成基础配置后，进入“功能定义”阶段
- 证据状态：待验证
- 观察：页面先要求选择该品类的产品功能模板，再编辑功能；模板中的必选功能不可编辑或删除，非必选和自定义功能可编辑或删除；“重新选择”模板会覆盖已有产品功能定义。
- 判断：功能模板会直接影响后续设备开发与高级配置；未知设备能力时随意选定模板或自定义功能点会留下错误基线与数据残留。
- 当前优先策略：先从设备功能、通信协议与实际能力确认模板；仅将已确认支持的开关状态、控制命令和事件定义为功能点；需要切换模板时先确认，因为“重新选择”会覆盖已有定义。
- 证据引用：开放协议产品功能定义受控探索
- 验证条件：一次受控的功能定义操作确认模板选择与“重新选择覆盖”行为。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:3F008609A5AF:end -->

<!-- project-experience:060057DA8EBE:start -->
<a id="exp-060057da8ebe"></a>
## 2026-07-13：开放协议直连产品的“设备开发 → 固件配置”

- 经验编号：EXP-060057DA8EBE
- 适用范围：开放协议直连产品的“设备开发 → 固件配置”
- 证据状态：待验证
- 观察：新建“含 SDK 固件”版本需要生产固件与测试 OTA 固件两份包及两套版本信息；测试 OTA 固件版本必须大于生产固件版本。页面字段明细与格式规则见知识库资料，不在此重复。
- 判断：不能把单一固件文件或设备端 OTA 流程误当作该页面的完整输入；固件上传是云端版本记录，不等于设备 OTA、设备控制、MQTT 上报或设备状态回归。
- 当前优先策略：用例设计按“生产包 + 测试 OTA 包 + 版本递增”建模；一次性测试产品、两份固件包路径和版本仅在实际执行时由用户提供；固件上传授权是逐请求确认事项，不复用历史授权；上传脚本保留显式环境门禁变量（如 `ALLOW_OPEN_PLATFORM_FIRMWARE_UPLOAD=true`）并限定 test 环境。
- 证据引用：开放平台固件配置受控探索
- 验证条件：一次获授权的固件版本创建成功，且版本递增规则被平台接受。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:060057DA8EBE:end -->

<!-- project-experience:B23E2F24E65D:start -->
<a id="exp-b23e2f24e65d"></a>
## 2026-07-14：测试环境中“含 SDK 固件”新增版本表单

- 经验编号：EXP-B23E2F24E65D
- 适用范围：测试环境中“含 SDK 固件”新增版本表单
- 证据状态：待验证
- 观察：两份稳定固件文件上传后页面显示文件与大小；生产版本 `1.0.1`、测试 OTA 版本 `1.0.2` 已满足已知递增规则。点击“确定”后对话框仍打开、无字段错误，重新进入页面的版本列表仍无数据。
- 判断：现有证据不足以区分前端未发起创建请求、服务端隐含兼容性规则或成功后的页面状态未同步；不能宣称版本创建成功，也不能仅据 HTTP 200 判定通过。
- 当前优先策略：保留为 UNKNOWN，确认新增版本接口契约、固件兼容性和发布状态；复测前继续使用字段标签范围内的上传 input 定位，避免依赖动态 input ID。
- 证据引用：正式执行（开放平台固件版本创建）
- 验证条件：确认接口契约与兼容性规则后复测，版本创建结果可确定性定案。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:B23E2F24E65D:end -->

<!-- project-experience:85A9877640A9:start -->
<a id="exp-85a9877640a9"></a>
## 2026-07-14：开放平台 `/integration/product/create` 的设备类型和通讯方式选择

- 经验编号：EXP-85A9877640A9
- 适用范围：开放平台 `/integration/product/create` 的设备类型和通讯方式选择
- 证据状态：待验证
- 观察：原生 `radio` 输入在可访问性树中可见，但 Playwright 直接对该输入执行 `check()` 时，可能被同一组件的可见 `span.ep-radio__inner` 遮挡并导致指针操作超时。
- 判断：此处不是业务前置条件或权限失败；应通过与单选项关联的可见父容器触发选择，再以 `radio` 的已选中状态断言结果，不能使用坐标点击或 `force` 绕过。
- 当前优先策略：按可访问名称定位目标 `radio`，点击其关联父容器，然后断言该 `radio` 为 checked；继续使用语义定位，不依赖动态 class、坐标或索引。
- 证据引用：开放平台产品创建页受控探索
- 验证条件：正式执行中产品创建单选稳定选中且无指针操作超时。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:85A9877640A9:end -->

<!-- project-experience:39AE74B1B823:start -->
<a id="exp-39ae74b1b823"></a>
## 2026-08-04：开放平台注册审核的多阶段自动化调度

- 经验编号：EXP-39AE74B1B823
- 适用范围：开放平台注册审核的多阶段自动化调度
- 证据状态：待验证
- 观察：注册提交后存在人工审核形成的外部状态边界，审核通过与驳回分支需要在同一执行授权下继续后续登录或重新注册验证。
- 判断：人工审核结果不能由自动化伪造；恢复时必须沿用同一执行意图和阶段检查点，避免重复提交或把人工决定误记为自动化结果。
- 当前优先策略：使用两个独立合成企业覆盖通过和驳回；提交成功后立即请求最小人工处理，冻结阶段检查点，随后恢复同一run并由脚本验证登录或重新注册，通知仅保存布尔收件证明。
- 证据引用：tests/web/open-platform/account-access-20260803/execution.manifest.ts
- 验证条件：完成一次受控正式执行，证明阶段暂停恢复不重复提交，两个分支均得到自动化终态验证且报告不含敏感值。
- 最近更新：2026-08-18T01:16:02.000Z
<!-- project-experience:39AE74B1B823:end -->

<!-- project-experience:9A6554D32CD4:start -->
<a id="exp-9a6554d32cd4"></a>
## 2026-08-04：开放平台注册短信验证码的页面内人工接管

- 经验编号：EXP-9A6554D32CD4
- 适用范围：开放平台注册短信验证码的页面内人工接管
- 证据状态：待验证
- 观察：开放平台注册发送短信前可能存在图形安全挑战，短信验证码只能由用户在同一可见浏览器会话内输入，脚本不得读取或持久化验证码。
- 判断：安全挑战和验证码均不能由脚本绕过、读取或持久化；自动化只能围绕一次发送和同一可见会话中的人工输入继续。
- 当前优先策略：正式脚本最多点击发送一次并等待倒计时成功状态，再有界等待用户直接在注册验证码输入框填写，填写完成后自动继续；Runner强制headed且超时禁止重发。
- 证据引用：tests/web/open-platform/account-access-20260803/registration-submit.formal.spec.ts
- 验证条件：完成一次受控正式注册执行，证明发送不重复、页面输入后自动继续、超时不重发且所有产物不含验证码。
- 最近更新：2026-08-18T01:16:02.000Z
<!-- project-experience:9A6554D32CD4:end -->

<!-- project-experience:633C0F015724:start -->
<a id="exp-633c0f015724"></a>
## 2026-08-12：开放平台登录页的语义定位与 selector 契约（test 环境 `/login` 与本地 dev `127.0.0.1:3098`）

- 经验编号：EXP-633C0F015724
- 适用范围：开放平台登录页的语义定位与 selector 契约（test 环境 `/login` 与本地 dev `127.0.0.1:3098`）
- 证据状态：待验证
- 观察：test 环境 `/login` 的登录和注册使用可访问的 `tab`/`tabpanel`；登录字段可按 ARIA 名称定位，注册字段可按 placeholder 定位，注册提交按钮的实际可访问名称为“同意条款并注册”。本地 dev 登录页真实 a11y 树与受控探索的简化契约存在偏差：登录提交按钮 accessible name 为「账号密码登录」（非「登录」），且未勾选「同意登录用户协议」checkbox 时为 disabled；模式切换按钮为「切换为账号密码登录」/「切换为短信验证码登录」（非「账号登录」/「验证码登录」）；手机号字段含 0/11 计数器。受控探索的 `getByRole(hasText)` 简化定位在真实页面不唯一/不精确，导致 002/003/005 `openAccountLogin` 切换失败 30s timeout。
- 判断：selector 证据必须来自真实页面的完整 a11y 快照而非简化 hasText；test 与本地 dev 环境的登录表单契约可能不同，需分别取证；提交按钮禁用状态可在不发送验证码、不上传文件或提交数据的前提下验证。
- 当前优先策略：登录提交用 `getByRole('button', { name: '账号密码登录' })`，提交前先勾选「同意登录用户协议」checkbox；模式切换用「切换为账号密码登录」/「切换为短信验证码登录」全称；注册提交按钮用「同意条款并注册」；优先 `getByRole('tab')`、`getByRole('textbox', { name })` 和 `getByPlaceholder()`；执行短信、上传或提交前仍需单独授权。
- 证据引用：artifacts/test-results/playwright/wave-8/*-LOGIN-002-*/error-context.md
- 验证条件：修正 selector 契约后完成一次 formal run，证明 001-005 用例 selector 稳定命中、不再 timeout。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:633C0F015724:end -->

<!-- project-experience:E4D0B1EA7582:start -->
<a id="exp-e4d0b1ea7582"></a>
## 2026-08-17：开放平台 Web 用例设计中，以 Axure 整页设计图（如 `sources/prototypes/open-platform/images/注册页面/u235.png`，manifest `open-platform-axure-prototype`）为唯一来源的页面结构类断言

- 经验编号：EXP-E4D0B1EA7582
- 适用范围：开放平台 Web 用例设计中，以 Axure 整页设计图（如 `sources/prototypes/open-platform/images/注册页面/u235.png`，manifest `open-platform-axure-prototype`）为唯一来源的页面结构类断言
- 证据状态：待验证
- 观察：同一张登录页整页设计图，主 Agent 与两名隔离 reviewer 的独立读图结论在“默认登录方式、切换入口文字、是否存在‘立即注册’文案”上冲突；正式评审裁定按多读者一致版本修正，且真实本地 dev 页面经验（EXP-633C0F015724）显示实现与原型也可能不一致。
- 判断：单一读图结论不足以作为断言事实；原型与实现的默认态和文案可能存在差异，从设计图直接编造具体文案会形成资料外断言。
- 当前优先策略：整页设计图衍生的结构断言至少经两个独立读图交叉验证后才写入用例；切换/默认态类断言使用中性表述（如“可在账号密码与短信验证码两种登录表单间切换”）并加“执行前以真实页面确认默认态”前置条件；不得从设计图推断并断言具体按钮或链接文案。
- 证据引用：`testcases/web/open-platform/login-register-product-cases-20260817-3/plan.md` 多角色评审记录 F-COMBINED-R2-02 与 R3 复核
- 验证条件：后续设计图来源的页面结构断言均经双读者交叉验证且未再出现文案类资料外断言。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:E4D0B1EA7582:end -->

<!-- project-experience:5C518CD31425:start -->
<a id="exp-5c518cd31425"></a>
## 2026-08-17：开放平台用例执行表按 reviewer 原子性发现做行拆分修订

- 经验编号：EXP-5C518CD31425
- 适用范围：开放平台用例执行表按 reviewer 原子性发现做行拆分修订
- 证据状态：受控探索已验证
- 观察：把“多字段、多实例合并行”改写为 D01-D0x 参数行时，若各行操作文本不同（如“触发企业信用代码字段校验”与“触发企业地址字段校验”）或与“—”固定行混用，评审批次完整性校验连续拒绝：参数实例步骤必须从 1 连续递增、步骤集合与操作须完全一致、不能混用数据编号与“—”。
- 判断：v6 参数化契约与逐实例原子性诉求的交集是：只有共享同一操作链的实例才能参数化；异构操作（每实例验证不同字段）必须用固定“—”行逐实例拆行，不存在折中写法。
- 当前优先策略：拆分前先判断实例是否共享同一操作文本——同操作链用 D01-D0x 参数行，异构操作用固定行，二者不混用；修订后先通过 `npm run testcases:sync-relations -- --check` 与评审批次完整性校验，再交给 reviewer。
- 证据引用：`testcases/web/open-platform/login-register-product-cases-20260817-3/workflow-history.ndjson` 批次 REV-LOGIN-REGISTER-PRODUCT-CASES-20260817-02 起始前的三次完整性校验失败及 plan.md 用例集评审与演进记录
- 验证条件：同请求内确定性校验三次复现后修正通过（已完成）；后续参数化拆行未再触发同类完整性拒绝。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:5C518CD31425:end -->

<!-- project-experience:C9B45A2EFBA5:start -->
<a id="exp-c9b45a2efba5"></a>
## 2026-08-17：开放平台注册、产品创建等表单字段校验类 no_write 用例

- 经验编号：EXP-C9B45A2EFBA5
- 适用范围：开放平台注册、产品创建等表单字段校验类 no_write 用例
- 证据状态：待验证
- 观察：需求资料只定义字段规则、不定义校验触发时机；若实现上唯一性或长度校验仅随提交触发，验证“通过校验”就必须点击提交，形成 no_write 用例的意外写入路径。
- 判断：no_write 策略不能仅靠声明成立，必须显式约束校验触发方式并给出升级路径，否则用例存在违反数据策略的可执行分支。
- 当前优先策略：此类用例统一附加安全边界句式——“校验触发方式限定为字段级（失焦或即时提示）；若唯一性或长度校验仅随提交触发，则停止执行、升级数据策略为 ephemeral_cleanup 并申请正式执行授权后再继续”；注册类用例另加“本用例不得使全部必填项（含营业执照、验证码）同时满足，杜绝提交成功”。
- 证据引用：`testcases/web/open-platform/login-register-product-cases-20260817-3/plan.md` 多角色评审记录 F-IMPACT-02、F-IMPACT-R2-02 及 cases.md OPEN-REG-001/002/003、OPEN-PRODUCT-003 安全边界行
- 验证条件：评审确认覆盖（已完成）；守卫对应的真实触发路径尚待正式执行检验。
- 最近更新：2026-08-17T10:01:02.000Z
<!-- project-experience:C9B45A2EFBA5:end -->

<!-- project-experience:54946563A2AB:start -->
<a id="exp-54946563a2ab"></a>
## 2026-08-19：开放平台用例集修订的评审路径选择与耗时控制

- 经验编号：EXP-54946563A2AB
- 适用范围：开放平台用例集修订的评审路径选择与耗时控制
- 证据状态：待验证
- 观察：create-product-20260819-r2 全程 141.8 分钟中有效 LLM 评审仅 13.6 分钟：40.3 分钟消耗在仅验证 2 个结构修复却被派发为全量复审（未带 affectedRef）的批次，64.4 分钟为 F-06 需求歧义拖到评审后才升级的中途用户等待；11 项评审发现中 8 项属可确定性拦截类别（计数漂移、模块归属错位、no_write 写动词、必填空值行、枚举口径）。
- 判断：评审-修订回路的主要浪费不是生成或 LLM 慢，而是三类结构问题：结构级缺陷漏进 LLM 评审、有界修正被派发为全量复审、需求歧义未在 plan 停点前置裁决。
- 当前优先策略：修订先跑 npm run testcases:revision-tier 对照已接受快照分级：structural 用 reviewer-dispatch/submit --deterministic 零 LLM 收口，scoped 用 --base-batch --affected-ref 定向单轮，substantive 才完整链；review-batch-start 必须声明 --activity/--affected-ref（同纪元全量复审有防呆警告）；plan 用「需求歧义与未定义预期」节把矛盾前移到 plan 确认回调一次裁决。
- 证据引用：.local/test-runs/web/open-platform/create-product-20260819-r2/workflow-history.ndjson（59 事件时间轴复盘）、commit 179c0c2 修订分层 fast-lane 与收敛断路器修复
- 验证条件：下一次 open-platform 修订轮按分层路径执行：structural 档零 LLM 收口、scoped 档单轮收敛，非用户等待相对 r2 显著缩短。
- 最近更新：2026-08-19T07:40:47.972Z
<!-- project-experience:54946563A2AB:end -->

<!-- project-experience:202EE3AA5748:start -->
<a id="exp-202ee3aa5748"></a>
## 2026-08-19：开放平台 cases.md 用例集的派生区维护与结构漂移修复

- 经验编号：EXP-202EE3AA5748
- 适用范围：开放平台 cases.md 用例集的派生区维护与结构漂移修复
- 证据状态：待验证
- 观察：r2 修订发布后计数行未更新、新用例块错位到其他模块段，直到下一轮复审才发现；一致性检查早已存在但只挂在生成时 candidate-gate，评审演进发布 cases.md 后无任何重验（事件流证实 evolution 发布后直接进评审）。
- 判断：统计行与快速索引是由用例体确定性派生的只读视图，手写必然漂移；结构校验必须在一切用例包发布边界强制，不能依赖生成时一次。重投影的模块归位依据只能是原始快速索引（reviewIndex）——解析器为正文块赋 module 用的是所在段头，先投影会销毁声明意图。
- 当前优先策略：永不手写计数行/快速索引；编辑 cases.md 后用 npm run testcases:reproject -- <cases.md>（--dry-run 预览）重投影派生区并按原始索引声明归位模块；引擎已在 candidate-gate 与发布边界确定性拒绝漂移（commit fded691），r2 缺陷重建验证修复产物与接受态逐字节一致。
- 证据引用：commit fded691 发布边界校验与派生视图漂移门禁、commit 1ba7e2f testcases:reproject 脚本、r2 REV-CP-R2-03 发现 R3-F-01/R3-F-02 缺陷重建与 BYTE-IDENTICAL 修复验证
- 验证条件：下一次真实修订中出现漂移时被发布边界拒绝，并经 reproject 一键修复后通过结构校验。
- 最近更新：2026-08-19T07:40:47.974Z
<!-- project-experience:202EE3AA5748:end -->

<!-- project-experience:FB8485518962:start -->
<a id="exp-fb8485518962"></a>
## 2026-08-19：开放平台评审员发现文件的提交契约

- 经验编号：EXP-FB8485518962
- 适用范围：开放平台评审员发现文件的提交契约
- 证据状态：待验证
- 观察：r2 第四批评审员运行约 40 分钟后未写发现文件，整轮返工重派；引擎此前不校验发现文件存在性与结论枚举，收口依赖代理自觉。
- 判断：reviewer 发现文件是评审轮收口的硬依赖，缺失或结论非法（非 converged/findings_present 枚举）应在提交时拒绝而非事后发现；引擎新事件字段必须同时过 prepareReviewLifecycleEvent 的输入接口、枚举断言与 payload 展开三处白名单，否则被静默剥离。
- 当前优先策略：所有 reviewer-submit（含 LLM 隔离评审员）必须带 --findings：骨架为「## 结论」（converged/findings_present）+ findings_present 时非空「## 发现项」表；引擎校验骨架并把 findingsDigest 与 conclusion 写入 ReviewerSubmitted 事件（commit fded691）。
- 证据引用：commit fded691 评审发现文件契约、r2 REV-CP-R2-04 丢产物返工事件（workflow-history.ndjson 05:56–06:37）
- 验证条件：后续评审轮按契约提交，未再出现发现文件缺失或结论非法的返工。
- 最近更新：2026-08-19T07:40:47.975Z
<!-- project-experience:FB8485518962:end -->

<!-- project-experience:537E38105527:start -->
<a id="exp-537e38105527"></a>
## 2026-08-19：开放平台已确认设计套件的再次测试路径

- 经验编号：EXP-537E38105527
- 适用范围：开放平台已确认设计套件的再次测试路径
- 证据状态：受控探索已验证
- 观察：create-product-20260819-r3 尝试 direct_execute 复验被复用评估判 full_replan（stable_suite_not_found）：stable 套件注册（suite.manifest.json）强制要求 entryScripts/scriptClosure/执行授权等 full_run 冻结证据，testcase_only 交付轮不可能产出；对未变更设计重跑生成会人为制造冻结资产漂移。
- 判断：设计类套件没有 direct_execute 复用路径；「仅复验设计」的正确语义是确定性校验（资产零漂移+需求源未变+追溯复验），不是重新生成或重新确认。
- 当前优先策略：设计复验三步：git diff <接受提交> -- testcases/.../suites/<feature>/ 验证零漂移；git diff <接受提交> -- sources/ 验证需求源未变；用 scripts/testcase-quality-gate.ts 导出的 parseRuleRecords/validateRuleCoverage 对 design.md+cases.md 实时复验 REQ→RULE→case 双向追溯。确需执行时另发起 full_run 轮走 build→授权→执行链，不混入复验请求。
- 证据引用：.local/test-runs/web/open-platform/create-product-20260819-r3 运行档案（reuseAssessment full_replan 与 cancel 记录）、src/support/test-suite/stableSuite.ts direct_execute 唯一分支与 promote 门槛
- 验证条件：已按此路径完成 create-product 设计复验（套件零漂移、11 规则全覆盖、0 追溯问题）；下次设计复验直接复用并复核结论仍成立。
- 最近更新：2026-08-19T07:40:47.975Z
<!-- project-experience:537E38105527:end -->

<!-- project-experience:AB8EC92B3BC8:start -->
<a id="exp-ab8ec92b3bc8"></a>
## 2026-08-19：开放平台 no_write 用例的写动词与必填空值覆盖

- 经验编号：EXP-AB8EC92B3BC8
- 适用范围：开放平台 no_write 用例的写动词与必填空值覆盖
- 证据状态：待验证
- 观察：r2 首轮评审 8 项发现中 4 项可机判：步骤含真实写动词但声明 no_write（OPEN-PROD-001 编辑后查看更新时间）、必填字段缺空值数据行（型号必填仅覆盖长度/字符无空值行）、枚举口径偏差、安全边界句式缺失。
- 判断：写动词×no_write 是数据策略矛盾，必须确定性阻断；必填→空值行的字段级精确映射是语义命题，只做 warning 提示交 reviewer/用户裁决，不做机械阻断。
- 当前优先策略：含写动作（创建/新增/提交/修改/编辑/更新/删除/上传/写入）的步骤一律拆分为 ephemeral_cleanup 用例并受执行授权约束；RULE 台账「条件/输入」含必填时，关联参数化用例须有空值数据行（留空/为空/不填/空值/清空）；两项均由 candidate-gate 强制（issue/warning，commit fded691）。
- 证据引用：r2 REV-CP-R2-01 F-01/F-02/F-03/F-07 发现记录、commit fded691 覆盖 lint（写动词阻断+必填空值 warning）
- 验证条件：下次生成轮的首轮评审不再出现上述可机判类别的发现。
- 最近更新：2026-08-19T07:40:47.976Z
<!-- project-experience:AB8EC92B3BC8:end -->
