# 工程脚本入口

<!-- role: command-index-only -->

本文件只登记命令入口。规则正文见 [测试规范索引](../docs/testing/README.md)，参数以 `package.json` 和各命令 `--help` 为准。

| 用途 | 命令 |
| --- | --- |
| 环境预检 | `npm run check:environment`、`npm run check:environment -- --plan [--asset <assetId>]` |
| 静态资产 | `npm run check:test-assets`、`npm run test-assets:select -- ...` |
| Markdown | `npm run check:markdown -- <paths>` |
| 架构与职责 | `npm run check:architecture` |
| 规则设计 | `npm run check:rule-design -- <套件 design.md>` |
| 用例关系 | `npm run testcases:sync-relations -- <暂存套件目录>`、`npm run testcases:sync-relations -- --check <最终套件目录>` |
| 资料索引 | `npm run check:knowledge-index`、`npm run knowledge:search -- ...` |
| 项目经验 | `npm run knowledge:manage -- candidate-add --project <project> --scope <scope> --observation <observation> --judgment <judgment> --strategy <strategy> --evidence <ref> --validation <condition>`；验证后使用 `candidate-promote` |
| 稳定套件 | `npm run test:suite:assess -- ...`、`npm run test:suite:status -- ...` |
| Durable Workflow | `npm run task:initialize -- ...`、`npm run task:resume -- ...`、`npm run task:status -- ...`、`npm run task:gate -- ...`、`npm run task:manage -- --help` |
| 定位修复回退 | `npm run task:manage -- execution-scope-reopen --request <id> --selector-repair <incident-path>` |
| selector | `npm run check:web-exploration -- ...`、`npm run test:web:verify-selectors -- ...`、`npm run test:web:inspect -- ...` |
| 正式执行 | `npm run test:execute -- --request <id>`、`npm run test:web:execute -- --request <id>` |
| 报告 | `npm run report:playwright`、`npm run report:allure` |
| 本机资源恢复 | `npm run test-data:recover` |
| 完整重置 | `npm run reset:full-test-state -- --dry-run`、`npm run reset:full-test-state` |
| 归档非当前请求 | 【已停用增量，仅限旧请求模型遗留目录一次性迁移】`npm run archive:noncurrent-requests -- --dry-run`、`npm run archive:noncurrent-requests` |

新增、重命名或删除入口时，必须同步更新 `package.json` 与本表。
