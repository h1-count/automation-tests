# 测试规范索引

本目录按“一个主题，一个责任文件”维护。规则的完整定义只写在对应责任文件中；其他文档通过链接引用，避免复制后产生不一致。

| 主题 | 责任文件 | 负责内容 | 不负责内容 |
| --- | --- | --- | --- |
| 任务生命周期与执行门禁 | [automation-guideline.md](./automation-guideline.md) | v7 复用分支与生命周期、Activity、callback、恢复、Gate、执行清单、定位修复回退与结果沿用、运行和封印门禁。 | 用例字段与质量、定位候选条件、环境并发、报告字段。 |
| 环境、运行模式与测试数据 | [environment-guideline.md](./environment-guideline.md) | 环境审批、生产保护、凭据与会话、执行并发、`explore/execute`、Context 隔离、数据策略、预算、台账、清理和恢复。 | 页面 selector、用例覆盖、生命周期门禁、证据包字段。 |
| 测试设计与用例 | [testcase-guideline.md](./testcase-guideline.md) | v3 精简设计索引、`testcase-v6-layered` 单一 `cases.md`、只读 Excel 评审视图、请求内来源、`REQ ↔ RULE ↔ caseId`、候选门禁、语义 reviewer 和一次用例确认。 | 生命周期、reviewer 运行事实、环境/数据生命周期、工程运行和报告字段。 |
| UI 定位 | [selector-guideline.md](./selector-guideline.md) | 真实页面候选探索、源码补齐、无头 selector 验证、可见 Inspector fallback、运行时定位漂移资格与禁止项、Web/App/WebView 定位优先级。 | 修复回退与重新授权、业务步骤、环境选择、报告字段。 |
| 报告与复盘 | [report-guideline.md](./report-guideline.md) | `CaseEvidenceBundle`、定位 incident 与沿用/重跑展示、运行结果、正式证据、范围完成判定、最终进度展示、残留风险和复盘。 | 任务状态机、定位修复资格、Context 隔离、测试数据生命周期、失败责任判定细节。 |
| 项目制测试知识 | [knowledge/README.md](./knowledge/README.md) | 项目经验的适用范围、即时登记、候选状态、冲突覆盖、固定格式、证据状态与事实优先级。 | 当前用户行为偏好、原始需求事实、正式测试证据。 |
| 专有契约与版本 | [contract-registry.md](./contract-registry.md) | 全部专有契约标识、当前/仅回放/归档证据状态和语义责任索引。 | 各契约的业务字段、状态机或执行算法。 |
| 失败分类 | [failure-classification.md](./failure-classification.md) | PRODUCT、SCRIPT、ENVIRONMENT、TEST_DATA、INFRASTRUCTURE、UNKNOWN 的受控依据与最小证据。 | 报告版式与产物目录。 |

使用顺序由 [技能工作流](../../skills/iot-automation-testing/SKILL.md) 定义；项目强制门禁和安全边界由 [AGENTS.md](../../AGENTS.md) 定义；安装、配置和命令入口见 [README.md](../../README.md)。
