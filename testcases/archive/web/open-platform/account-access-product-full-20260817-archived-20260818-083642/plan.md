# 测试设计索引：开放平台登录、注册与产品创建完整功能测试

> 结构版本：test-design-index-v3 / rule-design-ledger-v3 / case-relation-projection-v3。
> 用例格式：testcase-v6-layered。

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/open-platform/account-access-product-full-20260817 |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

- 重新测试开放平台登录、注册及其资料定义的相关功能，以及产品创建功能；完整范围、来源和执行边界将在来源选择后固化。

## 请求内来源

| 来源 ID | 可点击路径与精确定位 | 版本 / SHA-256 | 用途 |
| --- | --- | --- | --- |
| SRC-PENDING-001 | 待来源选择 | 待计算 | 待登记 |

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-PENDING-001 | SRC-PENDING-001 | 待来源选择 | 待确认 |

## 规则设计台账

> 本表是 `REQ → RULE → caseId` 的唯一作者关系源。

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-PENDING-001 | REQ-PENDING-001 | SRC-PENDING-001 | 待来源选择 | 待来源选择 | 待确定 | 阶段二生成 | 来源选择完成后生成 | 待确认 |

## 缺口与风险

- 待来源选择完成后登记。

## 评审与正式决定

| 类型 | subjectDigest / 输入摘要 | 结论或决定 | 说明 |
| --- | --- | --- | --- |
| 用户 | delivery-target | full_run | 用户要求重新开始完整功能测试；业务写入仍需独立执行授权。 |

## 多角色评审记录

待生成。

## 用例集评审与演进

待生成。
