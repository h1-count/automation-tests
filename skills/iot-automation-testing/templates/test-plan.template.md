<!-- role: structure-only -->

# 测试设计索引：<请求标题>

> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。
> 用例格式：testcase-v1-layered。
> 默认采用 lean；只有流程规范定义的高风险事实才自动升级 strict。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 测试请求 | <type/project/request> |
| 测试类型 | Web / H5 / App / WebView / API / MQTT / IoT 链路 |
| 目标环境 | test / pre / local |

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | <type/project/request> |
| 测试类型 | Web / H5 / App / WebView / API / MQTT / IoT 链路 |
| 目标环境 | test / pre / local |
| 数据策略 | no_write / ephemeral_cleanup / reusable_fixture / tracked_residual |

## 测试范围

### 包含

- <顶层业务范围>

### 不包含

- <用户明确排除项；没有则填写“无”>

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-<模块>-001 | [资料](<绝对路径或仓库路径>)；<章节/页面/字段> | <版本或 SHA-256> | <范围、规则或预期> |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-<模块>-001 | SRC-<模块>-001；<章节/字段> | <单一可验证需求> | 适用 / 待确认 / 不适用 |

## 规则设计台账

> 本表是 `REQ → RULE → caseId` 的唯一作者关系源。

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-<模块>-001 | REQ-<模块>-001 | SRC-<模块>-001；<章节/字段> | <触发条件、有效/无效/边界输入> | <页面、接口、消息或数据结果> | <场景法/等价类/边界值/决策表/状态迁移> | <caseId> | <无/写入/权限/安全/设备/待确认> | 已覆盖 / 受控执行 / 待确认 / 不适用 |

## 显式事实覆盖

| 事实引用 | 处置 | RULE | 理由 |
| --- | --- | --- | --- |
| SRC-<模块>-001#L<n>:<enum/limit/conditional_enum> | modeled / excluded / ambiguous | RULE-<模块>-001 / — | <映射说明或可审计例外理由> |

## 编译子约束分解

| 子约束 | RULE | caseId | 来源范围 | 显式事实引用 | 摘要 |
| --- | --- | --- | --- | --- | --- |
| CLAUSE-<模块>-001 | RULE-<模块>-001 | <caseId> | SRC-<模块>-001#L<n> | SRC-<模块>-001#L<n>:<category> / — | <单一可渲染或模型语义约束> |

## 缺口与风险

- <资料冲突、未定义验收、执行风险；没有则填写“无”>

## 评审与正式决定

| 类型 | subjectDigest / 输入摘要 | 结论或决定 | 说明 |
| --- | --- | --- | --- |
| reviewer / 用例确认 / 执行清单确认 | <摘要> | <结论；accepted / revision_requested / cancelled> | <风险、修订或适用 caseIds> |
