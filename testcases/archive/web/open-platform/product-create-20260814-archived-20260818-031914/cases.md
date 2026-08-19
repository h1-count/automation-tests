> 结构版本：testcase-v3。

# 完整候选用例集：开放平台创建产品

## 测试用例：进入创建产品流程

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-001 |
| 规则编号 | RULE-PRODUCT-001 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入产品开发首页。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 点击“创建产品”。 | 无 |

## 预期结果

- 进入创建产品流程。

## 测试用例：按三步顺序完成创建信息录入

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-002 |
| 规则编号 | RULE-PRODUCT-002 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入创建产品流程；存在至少一个可选产品品类与智能化方式。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 查看第一步并选择一个产品品类。 | 已定义品类 |
| 2 | 进入下一步并选择一个智能化方式。 | 已定义方式 |
| 3 | 进入下一步并查看信息完善页。 | 无 |

## 预期结果

- 步骤依次为“选择产品品类”“选择产品智能化方式”“完善产品信息”。
- 完成前一步后才进入相邻下一步。

## 测试用例：智能化方式为单选且展示模组 SDK 说明

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-003 |
| 规则编号 | RULE-PRODUCT-003 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已完成产品品类选择；页面存在两个及以上可选智能化方式。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 选择一个智能化方式。 | 方式 A |
| 2 | 再选择另一个智能化方式。 | 方式 B |
| 3 | 查看“模组 SDK 接入”选项的说明。 | 无 |

## 预期结果

- 任一时刻仅一个智能化方式处于选中状态。
- “模组 SDK 接入”说明其采用金云硬件模组和 SDK 将设备智能化并接入金云 IoT。

## 测试用例：按品类与智能化方式展示待完善信息

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-004 |
| 规则编号 | RULE-PRODUCT-004 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已取得资料或产品方确认的一组“品类—智能化方式—待完善信息”字段矩阵；本轮不假定未提供的完整枚举。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 选择字段矩阵中定义的产品品类和智能化方式组合。 | 一组已确认组合 |
| 2 | 进入完善产品信息页。 | 无 |

## 预期结果

- 页面展示该已确认组合需要完善的信息项。

## 测试用例：产品名称接受边界内的合法字符

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-005 |
| 规则编号 | RULE-PRODUCT-005 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入完善产品信息页；使用未在企业内登记的候选名称。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别输入 1 个字符和 60 个字符的中文、英文或数字组合名称。 | 非敏感候选值 |
| 2 | 触发字段校验。 | 无 |

## 预期结果

- 两个边界内名称均通过产品名称格式校验。

## 测试用例：产品名称拒绝空值、超长、空格和标点

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-006 |
| 规则编号 | RULE-PRODUCT-005 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入完善产品信息页。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别输入空值、61 个字符、含空格、含标点的产品名称。 | 非敏感无效候选值 |
| 2 | 对每种输入触发字段校验。 | 无 |

## 预期结果

- 每种不符合规则的名称均不能通过产品名称字段校验。

## 测试用例：产品型号接受六位内小写字母或数字

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-007 |
| 规则编号 | RULE-PRODUCT-006 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入完善产品信息页。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别输入 1 位和 6 位的小写字母或数字产品型号。 | 非敏感候选值 |
| 2 | 触发字段校验。 | 无 |

## 预期结果

- 两个边界内型号均通过产品型号格式校验。

## 测试用例：产品型号拒绝空值、超长和非法字符

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-008 |
| 规则编号 | RULE-PRODUCT-006 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |
| 数据策略覆盖 | no_write |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入完善产品信息页。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别输入空值、7 位字符、含大写字母或其他非小写字母/数字的产品型号。 | 非敏感无效候选值 |
| 2 | 对每种输入触发字段校验。 | 无 |

## 预期结果

- 每种不符合规则的型号均不能通过产品型号字段校验。

## 测试用例：同企业同品类重复型号不可创建且成功后不可修改

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-009 |
| 规则编号 | RULE-PRODUCT-007 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |
| 风险等级 | 高 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已有隔离企业和同品类已创建产品；已登记唯一资源标识、批准查询、清理方案和写入结果判定契约；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 使用同企业、同品类下已有的产品型号完成三步信息并尝试创建。 | 已存在型号 |
| 2 | 无论创建响应是否成功，均使用批准查询核对该次创建是否实际生成产品；结果不确定时冻结同一 intent。 | 脱敏产品标识 |
| 3 | 仅在核对确认未创建时受控重试；对实际创建成功的隔离产品查看产品型号编辑状态。 | 隔离产品标识 |

## 预期结果

- 重复产品型号不能完成创建；该结论以批准查询核对实际创建结果。
- 已创建产品的产品型号不可编辑。

## 测试用例：三步有效信息创建产品并生成 PID 和产品 model

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-010 |
| 规则编号 | RULE-PRODUCT-008 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |
| 风险等级 | 高 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已取得隔离企业、唯一产品名称/型号、产品创建操作预算、响应或查询判定契约和产品清理方案；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 依次选择有效产品品类、智能化方式并填写有效产品信息。 | 隔离唯一候选值 |
| 2 | 点击“创建产品”；不以页面提示或响应单独判定创建结果；结果不确定时冻结同一创建 intent，禁止直接重传。 | 无 |
| 3 | 无论响应是否成功，均使用已批准的产品名称、型号或 PID 查询契约核对是否已创建。 | 脱敏产品标识 |
| 4 | 仅在核对确认未创建时执行受控重试。 | 无 |

## 预期结果

- 经批准查询核对实际创建成功后，页面展示产品 model。
- 产品 model 由企业标识、二级品类英文和产品型号组成。

## 测试用例：创建产品后处于开发中并可继续开发

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-011 |
| 规则编号 | RULE-PRODUCT-009 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |
| 风险等级 | 高 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已有本请求创建的隔离产品及其查询、清理证据；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 返回产品开发首页或查看该产品详情。 | 隔离产品标识 |
| 2 | 查看产品状态、操作项及产品配置/删除可用性。 | 无 |

## 预期结果

- 产品状态为“开发中”，操作列显示“继续开发”。
- 产品配置可修改，产品可删除。

## 测试用例：未上线企业在四十个产品边界时受限且删除后可继续创建

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-012 |
| 规则编号 | RULE-PRODUCT-010 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | reusable_fixture |
| 风险等级 | 高 |
| 数据策略覆盖 | reusable_fixture |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已建立专用隔离企业基线：从未上线产品且拥有 39 或 40 个可识别测试产品；容量、租约、资源图、退役策略和每次创建的批准查询契约均已批准；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 在已有 39 个产品时创建第 40 个产品，并通过批准查询核对实际创建结果。 | 唯一隔离产品 |
| 2 | 在已有 40 个产品时尝试再创建一个产品，并通过批准查询核对未产生额外产品。 | 唯一隔离产品 |
| 3 | 删除已登记、状态允许删除的隔离产品，并查询核对其已删除及企业产品计数已释放。 | 隔离产品标识 |
| 4 | 仅在容量释放核对成功后再次创建产品，并通过批准查询核对实际创建结果；任何结果不确定均冻结同一 intent，仅确认未创建后才可受控重试。 | 唯一隔离产品 |

## 预期结果

- 第 40 个产品可以创建；超过 40 个时不能创建。
- 删除无用产品后可继续创建产品。

## 测试用例：已上线企业不受四十个产品上限约束

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-013 |
| 规则编号 | RULE-PRODUCT-010 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | reusable_fixture |
| 风险等级 | 高 |
| 数据策略覆盖 | reusable_fixture |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已建立至少上线过一个产品、且当前拥有 40 个可识别测试产品的专用隔离企业基线；容量、租约、资源图、退役策略和批准查询契约均已批准；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 在该企业当前已有 40 个产品时创建一个新产品，并通过批准查询核对实际创建结果；结果不确定时冻结同一 intent，仅确认未创建后才可受控重试。 | 唯一隔离产品 |

## 预期结果

- 经批准查询核对后，该企业不因 40 个产品数量限制而被阻止创建产品。

## 测试用例：创建后的产品可按 model、名称和型号检索

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-014 |
| 规则编号 | RULE-PRODUCT-011 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |
| 风险等级 | 高 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已有本请求创建的隔离产品及其产品 model、名称、型号；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别以该产品 model、名称和型号的非空部分值在产品开发列表搜索。 | 脱敏部分检索键 |

## 预期结果

- 三种模糊检索键均返回该隔离产品。

## 测试用例：独立创建 API 接受资料定义的必填字段并经查询核对结果

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-015 |
| 规则编号 | RULE-PRODUCT-012 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |
| 风险等级 | 高 |

## 来源

- SRC-PRODUCT-002；manifest id: open-platform-interface-document；sectionId: product-development-api；SHA-256: `56b7f5bbcd0d02f4283df910f434780dce9c76ab8c3b42d245ab98409a8dc0b3`。

## 前置条件

- 已确认创建 API 与页面三步创建为不同业务提交；具备隔离企业、已批准 API 认证、唯一资源、响应与查询判定契约、清理方案和独立执行授权；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 调用 `/api/aiot-open-plat/product/create`，传入资料定义的全部必填创建字段。 | 仅环境变量和非敏感隔离值 |
| 2 | 无论响应是否成功，均使用批准查询证据核对是否已创建；响应结果不确定时冻结同一创建 intent。 | 脱敏产品标识 |
| 3 | 仅在核对确认未创建时执行受控重试。 | 无 |

## 预期结果

- 请求包含资料定义的全部必填字段：`productCreateType`、`productTypeId`、`protocol`、`developType`、`name`、`deviceType`、`productType`、`imgUrl`、`detailPageType`、`detailPagePictureUrl`、`guidePagePictureUrl`、`guidePageDes`、`netConfig`。
- 成功响应的 code 为 200，消息为“成功,操作完成”；该响应不单独证明产品已创建，实际创建结果以批准查询为准。

## 测试用例：产品类别必选且改选后保持单选

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-016 |
| 规则编号 | RULE-PRODUCT-013 |
| 优先级 | P0 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入创建产品第一步；存在两个及以上产品类别。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 不选择产品类别，尝试进入下一步。 | 无 |
| 2 | 选择类别 A 后再选择类别 B。 | 两个已定义类别 |

## 预期结果

- 未选择类别不能进入下一步。
- 改选后仅类别 B 处于选中状态。

## 测试用例：设备类型与开发方式兼容

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-017 |
| 规则编号 | RULE-PRODUCT-014 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入完善产品信息页。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别选择免开发、模组 SDK、开放协议、云云接入。 | 四种已定义开发方式 |
| 2 | 查看每种方式可选择的设备类型。 | 无 |

## 预期结果

- 免开发和模组 SDK 仅提供普通设备、网关子设备。
- 开放协议和云云接入提供普通设备、网关设备、网关子设备。

## 测试用例：产品描述两百字符边界

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-018 |
| 规则编号 | RULE-PRODUCT-015 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | no_write |
| 风险等级 | 中 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已进入完善产品信息页。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 分别输入 200 字符和 201 字符的产品描述。 | 非敏感候选值 |
| 2 | 触发字段校验。 | 无 |

## 预期结果

- 200 字符产品描述通过字段校验。
- 201 字符产品描述不能通过字段校验。

## 测试用例：PID 通过批准查询获取且页面不展示

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | OPEN-PRODUCT-019 |
| 规则编号 | RULE-PRODUCT-016 |
| 优先级 | P1 |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |
| 风险等级 | 高 |

## 来源

- SRC-PRODUCT-001；manifest id: product-access-system-requirement；sectionId: product-access-create；SHA-256: `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4`。

## 前置条件

- 已有本请求创建的隔离产品、批准查询契约及清理方案；本轮不执行。

## 步骤

| 序号 | 操作 | 输入 |
| --- | --- | --- |
| 1 | 查看产品开发列表或创建后页面的产品标识展示。 | 隔离产品标识 |
| 2 | 通过批准查询获取该产品 PID。 | 脱敏产品标识 |

## 预期结果

- 页面不展示产品 PID，展示产品 model。
- 批准查询可获取该产品 PID。
