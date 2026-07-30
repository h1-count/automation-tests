# 测试规范索引

本目录按“一个主题，一个责任文件”维护。规则的完整定义只写在对应责任文件中；其他文档通过链接引用，避免复制后产生不一致。

| 主题 | 责任文件 | 负责内容 | 不负责内容 |
| --- | --- | --- | --- |
| 任务生命周期与执行门禁 | [automation-guideline.md](./automation-guideline.md) | 上下文加载、事件状态机、Activity、callback、评审编排、恢复、Gate v2、宿主 Goal 生命周期、Stop Hook 边界和统一执行清单。 | selector 风险判定、执行并发、用例完整度、报告证据字段。 |
| 环境、运行模式与测试数据 | [environment-guideline.md](./environment-guideline.md) | 环境审批、生产保护、凭据与会话、执行并发、`explore/execute`、Context 隔离、数据策略、预算、台账、清理和恢复。 | 页面 selector、用例覆盖、生命周期门禁、证据包字段。 |
| 计划与测试用例 | [testcase-guideline.md](./testcase-guideline.md) | 计划内容与正式决定、用例业务状态、用例包完整度、原子用例、覆盖基准、`REQ ↔ RULE ↔ caseId`、reviewer 角色适用性、评审结论与变更影响。 | 任务状态机、reviewer 运行事实、会话实现、测试数据生命周期、报告证据字段。 |
| UI 定位 | [selector-guideline.md](./selector-guideline.md) | Web Inspector 风险判定、ARIA 探索、Web/App/WebView 定位优先级与 selector 审核。 | 探索生命周期、业务步骤、环境选择。 |
| 报告与复盘 | [report-guideline.md](./report-guideline.md) | `CaseEvidenceBundle`、运行结果、正式证据、范围完成判定、最终进度展示、残留风险和复盘。 | 任务状态机、Context 隔离、测试数据生命周期、失败责任判定细节。 |
| 项目制测试知识 | [knowledge/README.md](./knowledge/README.md) | 按被测项目维护并纳入 Git 的流程、环境约束、恢复策略与脱敏经验。 | 当前用户行为偏好、正式测试证据。 |
| 失败分类 | [failure-classification.md](./failure-classification.md) | PRODUCT、SCRIPT、ENVIRONMENT、TEST_DATA、UNKNOWN 分类和最小证据。 | 报告版式与产物目录。 |

使用顺序由 [技能工作流](../../skills/iot-automation-testing/SKILL.md) 定义；项目强制门禁和安全边界由 [AGENTS.md](../../AGENTS.md) 定义；安装、配置和命令入口见 [README.md](../../README.md)。
