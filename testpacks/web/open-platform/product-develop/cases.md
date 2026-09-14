# 用例集：开放平台设备开发（product-develop）

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
>
> 上下文来源：
> - `sources/open-platform/需求/产品接入系统功能需求说明/产品接入系统功能需求说明.md`（「设备开发 P0——开放协议直连接入」「授权码管理 P0」章节，2026-09-11 重读）
> - 前端源码实现核对（本机 `~/Documents/ikingcity/workspace/front-end/web-open-platform`）：`src/pages/integration/product/ProductPhaseDevelop.vue`、`components/DevelopMethodProtocol.vue`（台账产品为开放协议接入→direct→协议直连分支）、`components/DevelopFirmareTable.vue`（canAllFirmware/canEdit/canDelete/canUpVersion）、`components/BtnEditFirmwareVersion.vue`（固件表单 rules 与固件类型映射）、`src/components/DialogTrigger.vue`（确认按钮请求期 loading 禁用）、`src/pages/integration/product/ProductIntegration.vue`（阶段条 switchConfigStage 与 stageRequireMap）、`src/routes/integration.ts`（develop 子路由注册）、`src/permission.ts`（未登录重定向登录）、`src/utils/ValidationRuleBuilder.ts`（text/version/versionNewer 规则）
> - `experience/general.md`、`experience/open-platform.md`
> - `node scripts/prepare-case-design.mjs --pack testpacks/web/open-platform/product-develop --work-order WO-B1-03`、`node scripts/load-test-context.mjs --project open-platform --scope product-develop`（2026-09-11 重新加载，重读需求文档「设备开发」章节与经验文件）
> - 查重比对：authcode 包（授权码申请写入在该包覆盖）、device-ota 包（设备侧 OTA 在批4覆盖）、create-product 包（创建产品链路与台账来源）。
>
> 上下文结论：
> - 用户指令（2026-09-11，最高优先级）：本轮测试「开放平台产品编辑链路」——**不创建产品**，直接使用 create-product 功能包台账中已创建的既有合成产品（`runtime/generated-data.json` records 最后一条：自动化测试产品1789026290672 / 型号 at0672 / model at0635.light.at0672，2026-09-10 创建）；「创建产品」相关对象一律按范围外声明或改为基于既有产品的场景；硬边界：不做断网、刷固件、控制硬件等高风险设备动作，固件/烧录类对象按范围外或只读观察设计。
> - ①设备开发页按 developType 分发，台账产品为 开放协议接入（direct）→ DevelopMethodProtocol：三个垂直步骤「开发资源及资料」（两个 DMStepBox：iKinglink MQTT 标准协议格式 / 设备接入规范，各带「下载文档」链接指向 /resource/docs/*.pdf，target=_blank）、「获取平台产品授权凭证，注册设备到云平台」（第一步 获取设备授权码[BtnApplyAuthCode + 剩余授权码数量：N个]；第二步 获取产品授权凭证[Model/Product Key/Product Secret/Vendor Code 四项 text-copy]；第三步 使用注册设备接口，激活设备验证[注册接口地址 text-copy + 提示 alert]）、「固件配置」（note「含 SDK 固件版本列表」+ 新建版本按钮 + 固件表：固件名称/固件key、固件版本、固件状态、测试OTA固件版本、版本说明、上传时间、操作[查看/编辑/固件升级/删除]）。
> - ②固件表单规则（源码 BtnEditFirmwareVersion.vue rules + ValidationRuleBuilder）：固件名称 required text（中英文数字常用标点）+ maxlength=32 截断（无长度下限校验，input minlength 属性不参与 async-validator）；固件类型 direct 固定 Sdk（选项唯一，下拉禁用）；固件版本号 required version 格式 `^\d+(\.\d+)+$`；上传生产固件 required upload；测试 OTA 固件版本 required version + versionNewer（须大于生产版本）；上传测试固件 required；版本说明非必填 text、maxlength=100 截断（show-word-limit）；③保存成功 toast「新增固件成功」；服务端实证固件名称仅接受纯中文（前端文案与后端规则不一致，疑似缺陷，见 conclusion.md 2026-09-03 实证）。
> - ④validate/autoSaveStage 恒成功（本页无表单守卫）；阶段条切换至设备开发恒放行（ProductIntegration.vue stageRequireMap[develop]=[Function] 且 Function 恒豁免，无「请先完成」拦截）；未登录访问任意 /integration/product/* 路由重定向登录页（permission.ts `next({ name: 'login' })`）。
> - ⑤写入目标为台账最新**既有**产品（2026-09-11 核对：at0672，固件数为 0，新建版本按钮按 canAllFirmware 规则可见，可完整执行写入；写入成功后按钮隐藏，后续轮次走幂等核验分支）。
> - 2026-09-11 对象矩阵核对（按 `skills/testcase-designer/SKILL.md`「划定范围——对象矩阵核对」最新规则逐类复核，一行对象必须有对应用例或范围外声明）：
>   - ①⑤ 主路径与跳转按「入口方式 × 路径正负 × 访问方式」核对：入口进入由 001 覆盖；「已登录绕过入口直达 /develop URL」缺行（源码核实：路由 `integration-product-phase-develop` 挂载 ProductIntegration 并 setProductId(route.params.id)，可直达）→ 补入 001 步骤 5；「未登录直达 /develop」缺行（源码核实 permission.ts 重定向登录）→ 新增 OP-PDEV-008；「无效产品ID直达」行以范围外声明（预期终态未经探索核实）。
>   - ②⑥ 字段与特殊控件按「表单 × 字段 × 取值类」核对：新增固件版本表单 7 字段逐字段列行——「空值必填提示」（名称/版本/OTA版本/生产固件/测试固件 5 字段必填 + 版本说明留空无提示）缺行 → 补 007 D06；「版本说明长度上限 100 截断」缺行 → 补 007 D07；「OTA 版本格式」与固件版本共用同一 version() 校验器，合并等价类；「固件类型固定 Sdk」无可变取值（下拉禁用），由 004/005 观察；「固件名称长度下限」不存在（源码无该校验）；合成固件上传（隐藏 input[type=file]）由 005/007 承载，类型/大小边界范围外。
>   - ③ 幂等与唯一性按「可重复动作 × 触发方式」核对：「新建固件确认按钮连点/慢网重复提交」行——源码核实 DialogTrigger 确认按钮请求期 loading 禁用（btnConfirmDisabled = disabled || loading），连点不产生重复提交，范围外声明；「固件名称唯一性」行——需求未定义唯一约束、验证需二次写入，范围外声明；「获取授权码重复提交」由 authcode 包覆盖；「重复打开弹窗」仅重置表单（doInit 置空）无业务状态变化，范围外声明。
>   - 2026-09-03 探索实证结论复核后仍然有效，全部保留：三步骤渲染完整、下载链接 target=_blank、授权凭证四项有值且与台账 Model 一致、授权码余量显示、固件写入全链路成功（合成 .bin 上传 KS3 → toast → 列表行）、查看抽屉回显、固件名称服务端仅纯中文。
>
> 范围外声明：
> - 创建产品流程：本轮**不创建产品**（用户指令），创建链路由 create-product 包覆盖；本包所有操作对象为 create-product 台账中的既有合成产品。
> - 获取授权码按钮提交：BtnApplyAuthCode 写入由 authcode 包同名组件覆盖，查重不重复设计。
> - 固件「编辑」操作：会变更台账已登记的固件记录（破坏 OP-PDEV-005 的幂等核验链），属固件/烧录类对象，按只读观察原则不做写入设计（「查看」只读链路由 006 覆盖）。
> - 固件「删除」操作：删除不可逆且会使 canAllFirmware 状态翻转（按钮复现），干扰既有写入核验与后续用例状态，无独立验证价值。
> - 固件「升级」（OTA）及升级按钮出现条件（canUpVersion 依赖多固件+测试通过状态）：依赖已激活真实设备并下发升级，属高风险设备动作红线（断网/刷固件/控制硬件类）。
> - 注册设备接口实际调用与设备烧录激活：需真实设备，范围外。
> - DevelopMethodCloud/DevelopMethodModule 分支：台账产品均为 direct，无 cloud/module 数据。
> - 固件名称唯一性：需求未定义唯一约束；验证需二次写入（新建按钮提交成功后按规则隐藏），违背最少写入原则。
> - 新建固件确认按钮连点/慢网重复提交：DialogTrigger 确认按钮请求期 loading 禁用（源码 btnConfirmDisabled = disabled || loading），连点无法产生重复提交；重复打开弹窗仅重置表单（doInit 置空），均无独立断言对象。
> - 服务端拒绝路径（固件名称非纯中文等）：构造需额外写入尝试，2026-09-03 实证结论（前后端规则不一致）已记录于 conclusion.md，不设计写入类负向用例。
> - 上传文件类型/大小边界：accept="*" 无前端类型限制（源码），需求未定义大小阈值；选择文件即触发对象存储上传，为收敛写入不做负向上传用例。
> - 阶段切换前置校验负路径（「请先完成…」拦截）：切换至设备开发恒放行（前置 Function 恒豁免，源码核实），basic/function 阶段的拦截行为属相应功能包范围。
> - 菜单/权限差异（develop 路由 permission: '/integration'）：需多权限测试账号，依赖企业成员管理模块。
> - 无效产品ID直达 /develop：预期终态（空态/报错形态）未经页面探索核实，不做无依据断言；探索轮确认后再补。
>
> 本表供测试范围审核。真实密码、Token、密钥、Cookie 等可复用凭据仅从本地 `.env` 或对应登录态存储读取；测试固件为本测试体系生成的合成 bin 文件。

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 协议直连开发页 | OP-PDEV-001 | 页面三步骤渲染与资料下载链接 | P0 | 低 |
| 协议直连开发页 | OP-PDEV-002 | 产品授权凭证与注册接口信息 | P1 | 中 |
| 协议直连开发页 | OP-PDEV-003 | 授权码数量显示 | P2 | 低 |
| 协议直连开发页 | OP-PDEV-008 | 未登录直达设备开发页重定向登录 | P1 | 低 |
| 固件配置 | OP-PDEV-004 | 固件列表结构与新建入口 | P1 | 低 |
| 固件配置 | OP-PDEV-005 | 新建固件版本（写入） | P1 | 高 |
| 固件配置 | OP-PDEV-006 | 固件版本详情查看 | P2 | 低 |
| 固件配置 | OP-PDEV-007 | 固件表单字段校验（必填/边界/格式） | P1 | 中 |

## 模块：协议直连开发页

<details>
<summary>OP-PDEV-001｜页面三步骤渲染与资料下载链接｜P0｜低风险</summary>

> 前置条件：已登录；操作对象为 create-product 台账最新**既有**产品（不创建产品，当前为 自动化测试产品1789026290672 / at0672 / at0635.light.at0672，开放协议接入 direct）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核（2026-09-11 对象矩阵核对新增步骤 5，脚本待同步）。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 进入台账最新既有产品设备开发页（产品列表「继续开发/开发详情」→ 配置页 → 设备开发阶段） | 台账最新既有产品（at0672） | URL 含 /develop，页面容器渲染 |
| — | 2 | 观察三步骤标题 | 无 | 「开发资源及资料」「获取平台产品授权凭证，注册设备到云平台」「固件配置」可见 |
| — | 3 | 观察下载文档链接 | 无 | 「iKinglink MQTT 标准协议格式」「iKinglink MQTT 设备接入规范」两个盒子各带「下载文档」链接（target=_blank，指向 /resource/docs/*.pdf） |
| — | 4 | 观察注册三小步 | 无 | 「获取设备授权码」「获取产品授权凭证」「使用注册设备接口，激活设备验证」可见，注册接口地址有值 |
| — | 5 | 已登录状态直接访问该产品 /develop URL（绕过产品列表入口） | 台账最新既有产品 URL | 页面渲染与入口进入一致：三步骤与固件配置区可见（源码核实：develop 子路由挂载 ProductIntegration 并按路由参数加载产品上下文） |

</details>

<details>
<summary>OP-PDEV-002｜产品授权凭证与注册接口信息｜P1｜中风险</summary>

> 前置条件：已登录，位于台账最新既有产品（at0672）设备开发页。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 观察授权凭证四项 | 无 | Model/Product Key/Product Secret/Vendor Code 均有值（与台账 Model 一致性注解），各带复制形态（text-copy） |
| — | 2 | 观察注册接口地址 | 无 | 注册接口地址有值（与环境配置一致，注解记录域名） |

</details>

<details>
<summary>OP-PDEV-003｜授权码数量显示｜P2｜低风险</summary>

> 前置条件：已登录，位于设备开发页。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 观察第一步授权码区 | 无 | 「剩余授权码数量：N个」可见（N≥0，数值注解）；「获取授权码」按钮存在且可点击（提交链路由 authcode 包覆盖，本包不点击提交） |

</details>

<details>
<summary>OP-PDEV-008｜未登录直达设备开发页重定向登录｜P1｜低风险</summary>

> 前置条件：测试环境开放平台可访问；浏览器无已登录会话（未加载/清空登录态）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核（2026-09-11 对象矩阵核对新增用例，脚本待同步）。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 未登录状态直接访问台账产品的 /develop URL | 台账产品 ID 段（合成占位值） | 重定向到登录页，出现登录表单（permission.ts 未登录守卫） |
| — | 2 | 未登录状态直接访问 /integration/product/management（对照） | 无 | 同样重定向到登录页 |

</details>

## 模块：固件配置

<details>
<summary>OP-PDEV-004｜固件列表结构与新建入口｜P1｜低风险</summary>

> 前置条件：已登录，位于台账最新既有产品（at0672，固件数=0）设备开发页。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 观察固件配置区 | 无 | note「含 SDK 固件版本列表」可见；「新建版本」按钮按规则显示（实证：canAllFirmware=固件数为0 或 产品已上线；固件数>0 且未上线时隐藏，此时注解说明） |
| — | 2 | 观察固件表头 | 无 | 固件名称/固件key、固件版本、固件状态、测试OTA固件版本、版本说明、上传时间、操作 列齐全（列表为空态或有数据行，注解） |

</details>

<details>
<summary>OP-PDEV-005｜新建固件版本（写入）｜P1｜高风险</summary>

> 前置条件：已登录，位于台账最新**既有**产品设备开发页（不创建产品；当前为 at0672，固件数=0，新建版本按钮可见）；准备合成固件文件（本地生成的 .bin，<1MB）。写入对象仅限该台账既有合成产品。
>
> 是否写入数据：是（createFirmwareVersion 新增 1 条固件版本并上传合成固件文件；成功后记入本包台账 kind=open-platform-firmware-version，只增不删）。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 点击「新建版本」，填表 | 名称=纯中文合成名（自动化测试固件+中文数字时间戳，实证服务端仅接受纯中文）；固件类型=Sdk（唯一默认）；版本=1.0.0；生产固件=合成 .bin；OTA 版本=1.0.1 + 上传同一合成 .bin；版本说明=合成文案 | 表单填写成功，生产/测试固件大小回显 |
| — | 2 | 确定 | 无 | toast「新增固件成功」出现，列表出现该固件行（名称+版本 1.0.0） |
| — | 3 | 台账记录 | — | 本包 runtime/generated-data.json 追加固件版本记录（产品名/Model/固件名/版本/时间）。幂等：固件已存在（新建按钮隐藏）时改为核验台账固件与列表一致并注解跳过 |

</details>

<details>
<summary>OP-PDEV-006｜固件版本详情查看｜P2｜低风险</summary>

> 前置条件：已登录，固件列表有数据（依赖 OP-PDEV-005 或历史写入）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 点击合成固件行「查看」 | 台账固件行 | 抽屉/弹窗打开，回显固件信息（名称/版本/说明） |
| — | 2 | 关闭查看 | 无 | 抽屉面板隐藏，列表正常 |

</details>

<details>
<summary>OP-PDEV-007｜固件表单字段校验（必填/边界/格式）｜P1｜中风险</summary>

> 前置条件：已登录，位于新建固件版本弹窗（依赖固件数=0 或产品已上线；台账最新既有产品 at0672 当前固件数=0、按钮可见，可完整执行；若 OP-PDEV-005 已先行写入则按钮隐藏，本用例转跳注解）。2026-09-03 实证：固件名称 text 校验仅「中英文数字常用标点」（`#` 被拒、`-` 通过），服务端进一步仅允许纯中文（前后端规则不一致，疑似缺陷）；版本号 version 格式 `^\d+(\.\d+)+$`；OTA 版本须大于生产版本。全程不产生提交写入（D06 依托客户端校验拦截：弹窗不关闭、无网络写入）。
>
> 是否写入数据：否（逐字段喂非法值断言字段级提示；D06 点击确定被客户端表单校验拦截，无网络写入）。
>
> 脚本状态：待审核（2026-09-11 对象矩阵核对新增 D06/D07，脚本待同步）。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| D01 | 1 | 固件名称输入含 `#` | 合成值「固件#1」 | 字段级提示（只能包含中英文、数字和常用标点符号） |
| D02 | 2 | 固件名称输入 33 个字符 | 合成值「固」×33 | maxlength=32 截断为 32 字（实证注解） |
| D03 | 3 | 固件版本输入「1」 | 合成值「1」 | 字段级提示（版本格式：数字+点分段，如 1.0.2） |
| D04 | 4 | OTA 版本输入不大于生产版本 | 生产=1.0.0，OTA=1.0.0 | 字段级提示（版本号必须大于 1.0.0） |
| D05 | 5 | 恢复合法值 | 名称=纯中文合成名；版本=1.0.0；OTA=1.0.1 | 字段错误清空（不实际提交） |
| D06 | 6 | 清空全部字段后点击「确定」（客户端校验拦截场景） | 合成值：全部留空（固件类型保持默认 Sdk） | 弹窗不关闭且无「新增固件成功」提示；固件名称、固件版本、上传生产固件、测试 OTA 固件版本、上传测试固件出现必填字段级提示，版本说明无提示（非必填实证） |
| D07 | 7 | 版本说明输入 101 个字符 | 合成值「测」×101 | 输入截断为 100 字（maxlength，show-word-limit 计数 100/100） |

</details>
