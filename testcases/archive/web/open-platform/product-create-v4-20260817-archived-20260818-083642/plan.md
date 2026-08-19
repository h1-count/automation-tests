# 测试设计索引：开放平台创建产品

> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。
> 用例格式：testcase-v6-layered。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/open-platform/product-create-v4-20260817 |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

- 覆盖产品开发首页的创建入口、三步创建流程、产品品类与智能化方式、产品名称/型号/描述/设备类型校验、创建结果、开发中状态、容量限制和创建后检索。
- 覆盖 `/api/aiot-open-plat/product/create` 已定义的请求字段与成功响应契约；页面流程与 API 提交的关系未定义，不将其作为同一交易断言。
- 不包含基础配置、功能定义、交互配置、设备开发、高级配置、产品测试、申请上线及产品删除业务流程；仅在容量规则中记录删除后的可创建结果。
- 交付终点为 `testcase_only`：不创建、删除或修改任何产品，不调用创建接口，不上传图片，不读取真实企业资料。

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-PRODUCT-001 | [产品接入系统功能需求说明](../../../../sources/requirements/open-platform/产品接入系统功能需求说明%20.docx)；“产品开发首页 P0”“创建产品 P0”，段落 75-82、108-136 | V1.2 / `5e429d9900d04c8c277c734700c9dd9373da5db99a03d27ee9e856dc0c92a5b4` | 页面创建流程、字段规则、容量、状态与创建结果 |
| SRC-PRODUCT-002 | [开放平台接口文档](../../../../sources/requirements/open-platform/开放平台接口文档.docx)；“产品开发 > 创建产品”与“查询产品列表”，`/api/aiot-open-plat/product/create`、`/api/aiot-open-plat/product/list` 参数及响应表 | `56b7f5bbcd0d02f4283df910f434780dce9c76ab8c3b42d245ab98409a8dc0b3` | 创建 API 请求字段与响应契约；列表结果中的 `productId`（PID）查询 |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-PRODUCT-001 | SRC-PRODUCT-001；创建产品入口 | 点击“创建产品”进入创建流程。 | 适用 |
| REQ-PRODUCT-002 | SRC-PRODUCT-001；创建产品 P0 | 创建流程依次为选择产品类别、选择产品智能化方式、完善产品信息。 | 适用 |
| REQ-PRODUCT-003 | SRC-PRODUCT-001；产品类别 | 平台开放 105 个产品品类，按一级、二级产品类别分组；产品类别为必选单选项。 | 适用 |
| REQ-PRODUCT-004 | SRC-PRODUCT-001；智能化方式 | 已选品类后展示支持的开发方式；智能化方式为单选，四种方式具有资料定义说明。 | 适用 |
| REQ-PRODUCT-005 | SRC-PRODUCT-001；完善产品信息 | 页面根据已选品类与智能化方式展示特定待完善信息。 | 适用 |
| REQ-PRODUCT-006 | SRC-PRODUCT-001；产品名称 | 产品名称必填、60 字符内、仅中文/英文/数字、无空格和标点、企业内唯一。 | 适用 |
| REQ-PRODUCT-007 | SRC-PRODUCT-001；产品型号 | 产品型号必填、最多 6 位小写字母或数字；同企业同品类唯一，创建成功后不可修改。 | 适用 |
| REQ-PRODUCT-008 | SRC-PRODUCT-001；设备类型 | 不同开发方式仅可选择资料定义的设备类型集合。 | 适用 |
| REQ-PRODUCT-009 | SRC-PRODUCT-001；产品描述 | 产品描述最多 200 字符。 | 适用 |
| REQ-PRODUCT-010 | SRC-PRODUCT-001；创建结果；SRC-PRODUCT-002；查询产品列表 | 三步完成后创建成功，获取 PID 与由企业标识、二级品类英文、产品型号组成的 product model；列表响应中的 `productId` 为 PID。 | 适用；不同页面的 PID 展示范围冲突，页面断言待确认 |
| REQ-PRODUCT-011 | SRC-PRODUCT-001；开发状态 | 创建完成并产生 model 后处于“开发中”，可修改配置、删除，首页显示“继续开发”。 | 适用 |
| REQ-PRODUCT-012 | SRC-PRODUCT-001；企业产品数量 | 未上线过产品的企业最多创建 40 个；删除无用产品后可继续创建；上线过 1 个产品后无数量限制。 | 适用 |
| REQ-PRODUCT-013 | SRC-PRODUCT-001；搜索产品 | 产品开发列表支持按产品 model、产品名称、产品型号模糊搜索。 | 适用 |
| REQ-PRODUCT-014 | SRC-PRODUCT-002；创建产品 API | 创建 API 定义必传字段和 `code=200`、成功消息的响应契约。 | 适用；与页面流程关系待确认 |

## 规则设计台账

> 本表是 `REQ → RULE → caseId` 的唯一作者关系源。

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-PRODUCT-001 | REQ-PRODUCT-001 | SRC-PRODUCT-001；创建产品入口 | 在产品开发首页点击创建入口 | 进入创建产品流程 | 场景法 | OPEN-PRODUCT-001 | no_write | 已覆盖 |
| RULE-PRODUCT-002 | REQ-PRODUCT-002 | SRC-PRODUCT-001；创建产品步骤 | 查看创建流程 | 页面依次展示产品类别、产品智能化方式、产品信息三步 | 场景法 | OPEN-PRODUCT-002 | no_write；资料未定义跳转、返回或导航限制 | 已覆盖 |
| RULE-PRODUCT-003 | REQ-PRODUCT-003 | SRC-PRODUCT-001；产品类别 | 查看品类分组、数量、未选择和改选状态 | 105 个品类按一级、二级分组；未选不可推进；改选后仅一项选中 | 等价类/状态迁移 | OPEN-PRODUCT-003、OPEN-PRODUCT-004、OPEN-PRODUCT-005 | no_write | 已覆盖 |
| RULE-PRODUCT-004 | REQ-PRODUCT-004 | SRC-PRODUCT-001；智能化方式 | 已选品类后查看可用方式或说明 | 展示该品类支持方式；当前可见方式的说明与资料一致 | 等价类 | OPEN-PRODUCT-006、OPEN-PRODUCT-007 | no_write；完整品类—方式矩阵待补充，不能预设同品类有两种方式 | 待确认 |
| RULE-PRODUCT-005 | REQ-PRODUCT-005 | SRC-PRODUCT-001；完善产品信息 | 选择一个由环境提供的可用品类—方式组合 | 展示该组合的待完善信息 | 场景法 | OPEN-PRODUCT-008 | no_write；完整字段矩阵待补充 | 待确认 |
| RULE-PRODUCT-006 | REQ-PRODUCT-006 | SRC-PRODUCT-001；产品名称 | 合法边界、非法格式、企业内重复 | 仅合法且企业内唯一的名称可通过字段校验或创建前校验 | 等价类/边界值 | OPEN-PRODUCT-009、OPEN-PRODUCT-010、OPEN-PRODUCT-011 | ephemeral_cleanup；唯一性基线与清理仅在正式执行授权后处理 | 受控执行 |
| RULE-PRODUCT-007 | REQ-PRODUCT-007 | SRC-PRODUCT-001；产品型号 | 合法/非法格式、同企业同品类重复、创建后查看 | 仅 1-6 位小写字母或数字合法；重复不可创建；创建后不可编辑 | 等价类/边界值/状态迁移 | OPEN-PRODUCT-012、OPEN-PRODUCT-013、OPEN-PRODUCT-014、OPEN-PRODUCT-015 | ephemeral_cleanup；写入结果和清理仅在正式执行授权后处理 | 受控执行 |
| RULE-PRODUCT-008 | REQ-PRODUCT-008 | SRC-PRODUCT-001；设备类型 | 对资料或环境提供的方式组合查看设备类型 | 各方式仅可选资料定义的设备类型集合 | 决策表 | OPEN-PRODUCT-016 | no_write；各方式可用品类待补充 | 待确认 |
| RULE-PRODUCT-009 | REQ-PRODUCT-009 | SRC-PRODUCT-001；产品描述 | 输入 199、200 与 201 字符描述 | 199、200 字符可通过字段校验，201 字符不可通过 | 边界值 | OPEN-PRODUCT-017 | no_write | 已覆盖 |
| RULE-PRODUCT-010 | REQ-PRODUCT-010 | SRC-PRODUCT-001；创建结果与 model | 三步均填入有效信息并提交 | 经批准查询确认创建后，页面展示符合三段组成的 model | 场景法 | OPEN-PRODUCT-018 | ephemeral_cleanup；创建写入、结果查询与清理待正式执行授权 | 受控执行 |
| RULE-PRODUCT-011 | REQ-PRODUCT-010 | SRC-PRODUCT-002；查询产品列表 | 使用目标产品完整名称调用批准的列表查询 | 唯一目标记录返回非空 `productId`（PID） | 场景法 | OPEN-PRODUCT-019 | ephemeral_cleanup；认证、隔离、结果查询与清理待正式执行授权；页面 PID 展示冲突不作为通过断言 | 受控执行 |
| RULE-PRODUCT-012 | REQ-PRODUCT-011 | SRC-PRODUCT-001；开发状态 | 创建成功后进入首页或详情 | 状态为开发中；显示继续开发 | 状态迁移 | OPEN-PRODUCT-020 | ephemeral_cleanup；创建结果核对与清理待正式执行授权 | 受控执行 |
| RULE-PRODUCT-013 | REQ-PRODUCT-012 | SRC-PRODUCT-001；40 个上限 | 未上线企业为 39、40 个产品；删除确认后再创建；已上线企业 | 40 个可创建、超过 40 个不可创建、目标删除后可继续创建、已上线企业不受限 | 边界值/状态迁移 | OPEN-PRODUCT-021、OPEN-PRODUCT-022、OPEN-PRODUCT-023、OPEN-PRODUCT-024、OPEN-PRODUCT-025 | reusable_fixture；正式执行授权后使用隔离企业、台账、租约和清理；创建或删除结果无法判定时冻结同一 intent，经批准查询确认目标资源状态后再决定后续操作 | 受控执行 |
| RULE-PRODUCT-014 | REQ-PRODUCT-013 | SRC-PRODUCT-001；产品搜索 | 使用已创建隔离产品的 model、名称、型号部分值搜索 | 三种模糊搜索均返回目标产品 | 等价类 | OPEN-PRODUCT-026 | ephemeral_cleanup；创建结果核对与清理待正式执行授权 | 受控执行 |
| RULE-PRODUCT-015 | REQ-PRODUCT-014 | SRC-PRODUCT-002；创建 API 参数表与响应 | 独立调用创建 API，传入全部必传字段 | 请求包含 13 个必传字段；响应满足 `code=200` 与成功消息契约，但不单独证明后台已创建 | 接口契约 | OPEN-PRODUCT-027 | ephemeral_cleanup；API 与页面关系、结果查询、认证和清理待确认 | 待确认 |

## 缺口与风险

- 资料未定义完整的“品类—开发方式—待完善字段”矩阵；OPEN-PRODUCT-006 至 OPEN-PRODUCT-008 只使用当前可见或由环境提供的组合，不预设同品类多种方式、四种方式均可选或未提供字段集合。
- 页面三步创建和创建 API 的同一性、以及 API 图片/详情页/配网字段是否由页面三步提供未定义；OPEN-PRODUCT-027 独立验证创建 API 契约，不与页面流程互相推断。
- 资料对 PID 页面可见范围存在冲突：产品开发首页说明不展示 PID，产品信息统一显示又包含 PID。当前不生成页面 PID 显示断言；OPEN-PRODUCT-019 仅验证已定义列表接口中的 `productId`，页面范围需用户或新增来源确认。
- 创建、容量、删除、后台查询及清理均为业务写入或外部状态操作。本请求不执行；正式执行前必须采用隔离企业、唯一资源、结果判定契约、数据台账、清理证明和独立执行清单授权。创建结果未知时冻结同一创建 intent，经查询确认未创建后才可受控重试；删除结果未知时冻结同一删除 intent，先查询确认目标已删除，才可继续创建。资料未定义独立的“计数释放”查询契约，不以计数查询作为业务 Oracle。

## 多角色评审记录

### 评审批次 `REV-PRODUCT-CREATE-V4-20260817-01`

| 评审 | 结论 | 自动演进处置 |
| --- | --- | --- |
| combined | 需演进 | PCR-V4-01 至 PCR-V4-04：补齐已定义 PID 列表查询、移除未定义矩阵假设、拆分独立可判定用例、收窄步骤导航断言。 |
| impact | 需演进 | IMP-PCV4-01：创建/删除结果未知时冻结同一 intent，经查询确认后再决定后续操作。 |

### 评审批次 `REV-PRODUCT-CREATE-V4-20260817-02`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 存在需修订项 | PCR-V4-R2-01、R2-03 自动补齐可观察能力与 PID 原子用例；PCR-V4-R2-02 需要需求方补充品类—方式—字段验收矩阵，纳入最终用例确认。 |
| impact | 通过 | 容量、写入结果判定、隔离和当前 no-write 边界均通过。 |

### 评审批次 `REV-PRODUCT-CREATE-V4-20260817-03`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 需修订 | 收窄 PID 页面范围并拆开 UI/API 语义；修正接口检索条件；使参数实例确定、互斥并补齐 `max-1 / max / max+1`；移除无来源的计数释放业务断言；修正创建 API 用例引用。 |
| impact | 需修订 | 将创建 API 契约引用由 OPEN-PRODUCT-019 修正为 OPEN-PRODUCT-027，保持查询与写入授权边界分离。 |

### 评审批次 `REV-PRODUCT-CREATE-V4-20260817-04`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 存在非结构性待确认项 | 上一批问题均已收敛；OPEN-PRODUCT-012 已覆盖 1、5、6 位边界，但合法实例未单列纯数字等价类。已达到本 epoch 一轮自动修订上限，将该项并入本次用例确认。 |
| impact | 通过 | 参数实例保持同一风险、环境、数据、清理与授权边界；只读查询和创建/删除写入边界、未知结果冻结及 019/027 引用均通过。 |

### 评审批次 `REV-PRODUCT-CREATE-V5-FLAT-20260817-01`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 通过 | 27 个父用例、7 个参数化用例、14 个 REQ 与 15 个 RULE 关系闭合；扁平继承未丢失语义，OPEN-PRODUCT-012/D04 已补齐纯数字合法实例。 |
| impact | 需演进 | IMP-V5-FLAT-01：解析器和门禁已将首行差异 / 风险展开到同 caseId 全部执行行，但冻结用例文件未直接说明该契约；在文件顶部补充继承说明后复核，不重复治理字段、不改变用例语义。 |


### 评审批次 `REV-PRODUCT-CREATE-V5-FLAT-20260817-02`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 复用上一批通过证据 | 本批仅复核受继承契约影响的写入与清理边界；业务范围、REQ/RULE/case 关系和用例内容未变化。 |
| impact | 通过 | IMP-V5-FLAT-01 已收敛：文件明确同一 caseId 的后续空白“差异 / 风险”继承首行；OPEN-PRODUCT-026 D02/D03 与 OPEN-PRODUCT-027 步骤 2/3 均保持 ephemeral_cleanup、高风险及授权、结果判定和清理边界。 |

### 评审批次 `REV-PRODUCT-CREATE-V6-LAYERED-20260817-01`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 已演进，待复核 | V6-COMB-01：OPEN-PRODUCT-022 已移除无来源的产品总数查询断言，仅核对目标未创建；V6-COMB-02：OPEN-PRODUCT-003、020 已将独立 Oracle 拆为顺序步骤。 |
| impact | 通过 | 27 个父用例的有效风险、数据策略、来源、写入/删除、未知结果冻结、清理和文件级授权边界完整。 |

### 评审批次 `REV-PRODUCT-CREATE-V6-LAYERED-20260817-02`

| 评审 | 结论 | 处置 |
| --- | --- | --- |
| combined | 通过 | Targeted 复核确认 OPEN-PRODUCT-003、020 已按独立 Oracle 拆步，OPEN-PRODUCT-022 已移除无来源的企业产品总数断言并保留未知结果冻结；未扩大业务范围。 |
| impact | 复用上一批通过证据 | 本轮仅拆分或收窄三个既有 Oracle，有效风险、数据策略、来源、授权、清理与未知结果边界未变化。 |

## 评审与正式决定

| 类型 | subjectDigest / 输入摘要 | 结论或决定 | 说明 |
| --- | --- | --- | --- |
| 用户 | delivery-target | testcase_only | 新建独立请求；仅生成、校验和评审用例。 |

## 正式用户决定

| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |
| --- | --- | --- | --- | --- |
| 用例确认 | f2850ebc23c4917b8ea471fb9f58d5f16c68e528fe0ec713a7e80590ebe048f0 | revision_requested | 为 testcase-v4 增加参数化数据实例，并修订指定的产品创建用例；不扩大原测试范围。 | 重新生成、门禁、评审并提交新的用例确认。 |
| 用例确认 | 062bf6dc7f1adec9d6307b81138dc8105a960124a5ae2dc4fd1e3a85ba960fd7 | revision_requested | 将用例集转换为 testcase-v5-flat 按模块扁平表和逻辑合并，并补齐 OPEN-PRODUCT-012 纯数字合法实例；不扩大原测试范围。 | 重新生成、门禁、评审并提交新的用例确认。 |
| 用例确认 | 989efb601cc468feba2b4bfaf25b1b91113d61426651378a7ed592b15c021213 | revision_requested | 将用例集升级为 testcase-v6-layered 分层 Markdown，并生成与当前确认摘要绑定的只读 Excel 评审版；不扩大原测试范围。 | 重新生成、门禁、评审并提交新的用例确认。 |
