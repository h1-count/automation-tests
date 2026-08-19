# 测试设计索引：开放平台创建产品

> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/open-platform/product-create-20260814 |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | ephemeral_cleanup |

## 测试范围

- 覆盖产品开发首页的创建入口、三步创建流程、产品品类与智能化方式选择、产品名称与型号规则、企业产品数量上限，以及创建后的 PID、产品 model 和开发中状态。
- 覆盖创建接口资料已明确的必填字段与创建成功响应，作为独立于页面三步创建的 API 自动化候选范围。
- 不包含创建完成后的基础配置、功能定义、设备开发、产品测试、申请上线及删除产品业务流程；仅记录它们与创建结果的前置关系。
- 本请求为 `testcase_only`：不创建产品、不调用创建接口、不上传图片、不读取真实企业资料。

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-PRODUCT-001 | [产品接入系统功能需求说明](../../../../sources/requirements/open-platform/产品接入系统功能需求说明%20.docx)；“产品开发流程”“创建产品 P0”，段落 43-47、75-82、108-136 | V1.2 / `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4` | Web 创建流程、字段规则、数量上限、创建结果和状态 |
| SRC-PRODUCT-002 | [开放平台接口文档](../../../../sources/requirements/open-platform/开放平台接口文档.docx)；“产品开发 > 创建产品”，`/api/aiot-open-plat/product/create` 参数表与成功响应 | `56b7f5bbcd0d02f4283df910f434780dce9c76ab8c3b42d245ab98409a8dc0b3` | 创建 API 的必填字段与成功响应契约 |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-PRODUCT-001 | SRC-PRODUCT-001；产品开发首页、创建入口 | 点击“创建产品”进入创建流程。 | 适用 |
| REQ-PRODUCT-002 | SRC-PRODUCT-001；创建产品 P0 | 创建流程固定为选择产品品类、选择智能化方式、完善产品信息三步。 | 适用 |
| REQ-PRODUCT-003 | SRC-PRODUCT-001；选择智能化方式 | 智能化方式为单选；模组 SDK 接入适用于采用金云硬件模组和 SDK 接入金云 IoT。 | 适用 |
| REQ-PRODUCT-004 | SRC-PRODUCT-001；完善产品信息 | 页面按已选择的产品品类和智能化方式展示特定需完善信息。 | 适用 |
| REQ-PRODUCT-005 | SRC-PRODUCT-001；产品名称 | 产品名称必填、60 字符内，仅允许中文/英文/数字，不允许标点或空格，且企业内唯一。 | 适用 |
| REQ-PRODUCT-006 | SRC-PRODUCT-001；产品型号 | 产品型号必填、最多 6 字符、仅允许小写字母或数字；企业内同品类不可重复；创建成功后不可更改。 | 适用 |
| REQ-PRODUCT-007 | SRC-PRODUCT-001；创建成功与产品 model | 三步完成后创建成功，产生产品 PID 与由企业标识、二级品类英文、产品型号组成的产品 model。 | 适用 |
| REQ-PRODUCT-008 | SRC-PRODUCT-001；开发状态 | 产品创建完成并产生 model 号后，产品处于“开发中”；该状态可修改配置、删除，首页显示“继续开发”。 | 适用 |
| REQ-PRODUCT-009 | SRC-PRODUCT-001；企业产品数量 | 从未上线产品的企业最多创建 40 个产品；删除无用产品后可继续创建；企业上线过 1 个产品后无数量限制。 | 适用 |
| REQ-PRODUCT-010 | SRC-PRODUCT-001；产品开发列表 | 产品开发列表支持以产品 model、产品名称或产品型号模糊搜索。 | 适用；只验证创建后可检索，不覆盖完整列表筛选功能。 |
| REQ-PRODUCT-011 | SRC-PRODUCT-002；创建产品 API | 创建接口要求 `productCreateType`、`productTypeId`、`protocol`、`developType`、`name`、`deviceType`、`productType` 等字段；成功响应为 code 200 与成功消息。 | 适用；接口字段与三步页面资料存在范围差异。 |
| REQ-PRODUCT-012 | SRC-PRODUCT-001；选择产品品类 | 产品类别为单选且必选项。 | 适用 |
| REQ-PRODUCT-013 | SRC-PRODUCT-001；设备类型 | 免开发/模组 SDK 仅可选普通设备、网关子设备；开放协议/云云接入可选普通设备、网关设备、网关子设备。 | 适用 |
| REQ-PRODUCT-014 | SRC-PRODUCT-001；产品描述 | 产品描述最多 200 字符。 | 适用 |
| REQ-PRODUCT-015 | SRC-PRODUCT-001；产品 ID 与创建结果 | 创建成功可获取 PID；产品 ID 不在页面展示，产品开发列表以产品 model 显示。 | 适用；PID 可观察渠道需区分页面与批准查询。 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-PRODUCT-001 | REQ-PRODUCT-001 | SRC-PRODUCT-001；创建入口 | 在产品开发首页点击入口 | 进入创建产品流程 | 场景法 | OPEN-PRODUCT-001 | no_write | 已覆盖 |
| RULE-PRODUCT-002 | REQ-PRODUCT-002 | SRC-PRODUCT-001；创建产品三步 | 进入创建流程并按步骤前进 | 按品类、智能化方式、产品信息的顺序展示步骤 | 状态迁移 | OPEN-PRODUCT-002 | no_write | 已覆盖 |
| RULE-PRODUCT-003 | REQ-PRODUCT-003 | SRC-PRODUCT-001；智能化方式 | 选择不同智能化方式 | 同一时刻仅一项被选中；模组 SDK 选项说明与资料一致 | 决策表 | OPEN-PRODUCT-003 | no_write | 已覆盖 |
| RULE-PRODUCT-004 | REQ-PRODUCT-004 | SRC-PRODUCT-001；产品信息 | 选择一个已定义的品类与智能化方式组合 | 展示该组合所需完善的信息项 | 决策表 | OPEN-PRODUCT-004 | no_write；组合枚举待资料补充 | 待确认 |
| RULE-PRODUCT-005 | REQ-PRODUCT-005 | SRC-PRODUCT-001；产品名称 | 空值、60 字符有效值、超过 60 字符、含空格或标点 | 仅满足规则的名称可通过字段校验；企业内重复名称不可创建 | 等价类/边界值 | OPEN-PRODUCT-005、OPEN-PRODUCT-006 | ephemeral_cleanup；重复基线及创建结果需查询和清理 | 受控执行 |
| RULE-PRODUCT-006 | REQ-PRODUCT-006 | SRC-PRODUCT-001；产品型号 | 空值、1-6 位小写字母/数字、超过 6 位、含大写或其他字符 | 仅符合格式的型号可通过字段校验 | 等价类/边界值 | OPEN-PRODUCT-007、OPEN-PRODUCT-008 | no_write | 已覆盖 |
| RULE-PRODUCT-007 | REQ-PRODUCT-006 | SRC-PRODUCT-001；型号唯一性与不可更改 | 同企业同品类重复型号；创建成功后查看型号 | 重复型号不可创建；已创建产品型号不可编辑 | 场景法/状态迁移 | OPEN-PRODUCT-009 | ephemeral_cleanup；每次创建均按批准查询核对，结果不确定时冻结 intent；隔离企业、查询与清理 | 受控执行 |
| RULE-PRODUCT-008 | REQ-PRODUCT-007 | SRC-PRODUCT-001；创建成功 | 三步信息有效且完成提交 | 经批准查询核对实际创建结果后，页面展示产品 model；model 三段组成符合资料 | 场景法 | OPEN-PRODUCT-010 | ephemeral_cleanup；每次创建均按批准查询核对，结果不确定时冻结 intent、唯一命名、清理、独立执行授权 | 受控执行 |
| RULE-PRODUCT-009 | REQ-PRODUCT-008 | SRC-PRODUCT-001；开发中状态 | 成功创建后进入产品开发首页或详情 | 状态为开发中，存在“继续开发”；配置可修改、产品可删除 | 状态迁移 | OPEN-PRODUCT-011 | ephemeral_cleanup；查询与清理 | 受控执行 |
| RULE-PRODUCT-010 | REQ-PRODUCT-009 | SRC-PRODUCT-001；40 个上限 | 未上线企业为 39、40 个产品；删除后再次创建；已上线企业 | 每次创建均经批准查询核对实际结果；40 个时阻止新增；登记的可删隔离产品删除并经查询确认计数释放后可创建；已上线企业不受该上限约束 | 边界值/状态迁移 | OPEN-PRODUCT-012、OPEN-PRODUCT-013 | reusable_fixture 或 ephemeral_cleanup；结果不确定时冻结 intent、企业基线、容量、删除核对、台账、退役与独立授权 | 受控执行 |
| RULE-PRODUCT-011 | REQ-PRODUCT-010 | SRC-PRODUCT-001；产品搜索 | 成功创建后以产品 model、名称、型号的非空部分值分别搜索 | 三种模糊检索键均返回目标产品 | 等价类 | OPEN-PRODUCT-014 | ephemeral_cleanup；创建查询与清理 | 受控执行 |
| RULE-PRODUCT-012 | REQ-PRODUCT-011 | SRC-PRODUCT-002；创建 API 参数表 | 作为独立 API 提交，构造包含全部已定义必填字段的创建请求 | 接口接受完整必填字段；code 200 与成功消息仅为响应契约，实际创建结果须经批准查询核对 | 场景法/接口契约 | OPEN-PRODUCT-015 | ephemeral_cleanup；每次创建均按批准查询核对，结果不确定时冻结 intent、响应结果查询、清理与独立授权 | 受控执行 |
| RULE-PRODUCT-013 | REQ-PRODUCT-012 | SRC-PRODUCT-001；产品类别 | 未选择、选择 A 后改选 B | 未选择不能进入下一步；改选后仅 B 被选中 | 等价类/状态迁移 | OPEN-PRODUCT-016 | no_write | 已覆盖 |
| RULE-PRODUCT-014 | REQ-PRODUCT-013 | SRC-PRODUCT-001；设备类型 | 分别选择四种开发方式 | 各方式仅提供资料定义的设备类型集合 | 决策表 | OPEN-PRODUCT-017 | no_write | 已覆盖 |
| RULE-PRODUCT-015 | REQ-PRODUCT-014 | SRC-PRODUCT-001；产品描述 | 200 字符、201 字符 | 200 字符通过，201 字符不能通过字段校验 | 边界值 | OPEN-PRODUCT-018 | no_write | 已覆盖 |
| RULE-PRODUCT-016 | REQ-PRODUCT-015 | SRC-PRODUCT-001；PID 与页面展示 | 创建成功后查看页面并通过批准查询核对 | 页面不展示 PID；批准查询可返回 PID；页面以产品 model 显示 | 场景法 | OPEN-PRODUCT-019 | ephemeral_cleanup；查询契约与清理 | 受控执行 |

## 缺口与风险

- 页面资料已明确设备类型和开发方式的兼容关系、产品描述 200 字符上限；仍未提供完整品类枚举及每个“品类—智能化方式—字段”矩阵，OPEN-PRODUCT-004 仅对已确认组合判定。
- 正式用户决定已明确 API 创建与页面三步创建不是同一业务提交。OPEN-PRODUCT-015 仅以接口资料验证 API 字段与响应契约，页面用例不推断这些 API 字段的页面归属。
- 资料同时规定创建成功“获取 PID”与产品 ID 不在页面展示；OPEN-PRODUCT-019 以批准查询核对 PID，页面仅断言产品 model 展示。
- 创建产品会写入企业产品数据。每次创建均须使用批准查询核对实际结果；结果不确定时冻结同一 intent，仅确认未创建后才可受控重试。正式执行前还必须具备隔离企业、唯一资源标识、产品—企业资源台账、清理证明和独立执行清单授权；本请求不执行。

## 评审与正式决定

| 类型 | subjectDigest / 输入摘要 | 结论或决定 | 说明 |
| --- | --- | --- | --- |
| 用户 | delivery-target | testcase_only | 仅生成、校验和评审用例；不生成脚本或执行。 |

## 正式用户决定

| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |
| --- | --- | --- | --- | --- |
| 用例确认 | `82416a6eb5e8f64ca8b3cc167752a5a18554a1157b8d5cc7c4c24755f7d08d00` | revision_requested | 页面三步创建与 `/api/aiot-open-plat/product/create` 为不同业务提交；所有创建动作均须使用批准查询核对实际结果，结果不确定时冻结同一 intent，仅确认未创建后才可受控重试。 | 修订页面创建与 API 创建的边界、写入结果判定和相关用例后重新校验与评审。 |
| 用例确认 | `b41923f7f00f1784552c58102f7b691e26a7016bb08f4d46e698fea952c108c3` | revision_requested | 按当前正式范围重新生成完整开放平台创建产品用例；保留页面三步创建与 API 创建为不同业务提交，以及所有创建动作的批准查询核对和受控重试契约。 | 重新生成、校验并复审用例，不执行产品创建、删除或接口调用。 |
