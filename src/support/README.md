# 测试支持能力

`support/` 存放与具体业务无关的公共能力。

| 子目录 | 职责 |
| --- | --- |
| `assertions/` | 通用断言与错误提示。 |
| `polling/` | 异步状态轮询与超时控制。 |
| `logging/` | 脱敏日志和诊断摘要。 |
| `cleanup/` | 测试数据清理与恢复工具。 |
| `testcase/` | 与业务无关的测试用例治理校验，例如评审发现项的沉淀判定；只校验结构和归属，不读取需求正文、项目经验或敏感配置。 |
| `test-data/` | 本机测试数据生命周期：只管理本机 Runner 已登记的非生产资源；包含运行、复用、清理、恢复和脱敏摘要能力。 |
| `task-workflow/` | Durable Workflow：请求级事件历史、定义 DAG、纯 reducer、Activity 租约、原子产物发布、callback、评审策略、CLI 与派生门禁。业务运行状态只来自请求目录中的 `workflow-history.ndjson`；`.local/test-task-runtime/` 只保存可丢弃的本机句柄。 |
