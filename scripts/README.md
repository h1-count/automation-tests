# 工程脚本入口

<!-- role: command-index-only -->

本文件只登记命令入口。规则正文见 [测试规范索引](../docs/testing/README.md)，参数以 `package.json` 和各命令 `--help` 为准。

| 用途 | 命令 |
| --- | --- |
| 环境预检 | `npm run check:environment`、`npm run check:environment -- --plan [--asset <assetId>]` |
| 静态资产 | `npm run check:test-assets`、`npm run test-assets:select -- ...`；开放平台注册执照上传边界文件使用 `npm run test-assets:prepare-registration-upload -- --request <type/project/request> [--dry-run]`。该命令只在本轮 `.local/test-runs/<request>/generated-test-assets/` 原子生成合成文件；小样本在 Git，大于 10MB 的边界文件不提交，随运行档案清理。 |
| Markdown | `npm run check:markdown -- <paths>` |
| 架构与职责 | `npm run check:architecture` |
| 规则设计 | `npm run check:rule-design -- <套件 design.md>` |
| 用例关系 | `npm run testcases:sync-relations -- <暂存套件目录>`、`npm run testcases:sync-relations -- --check <最终套件目录>` |
| 用例评审工作簿 | v1：`npm run task:manage -- testcase-review-render-publish --request <id>`（本机内容缓存命中时只刷新本轮绑定与回执） |
| 评审缓存清理 | `npm run cleanup:review-cache -- [maxEntries]` 或 `npm run cleanup:review-cache -- --all [--dry-run]`；只删除 `.local/test-review-cache/` 的派生工作簿主体，不触碰运行档案或稳定套件 |
| 交付 Excel | `npx tsx scripts/export-testcase-delivery-xlsx.ts --cases <cases.md> --design <design.md> --request <type/project/request> --output outputs/<request>/<套件业务名>测试用例.xlsx` |
| 请求成本分析 | `npm run cost:analyze -- --request <type/project/request> [--pre-slack-min <分钟>] [--post-slack-min <分钟>] [--sessions-dir <dir>] [--out <path>]`（时间+token 双口径，报告写入运行档案 `cost-report.md`） |
| 需求事实预提取 | `npx tsx scripts/preflight-requirement-facts.ts --design <design.md>` 或 `--source <file.md> --lines <a-b>`（零推理候选事实表 + 行覆盖闭包审计，骨架阶段校对输入） |
| reviewer 定向读取图 | `npx tsx scripts/build-review-reading-map.ts --design <design.md> [--only-rules <id,…>] [--out <path>]`（必读区间、交叉对照配对、可选抽查区间；定向读取指导，不改变评审快照） |
| 资料索引 | `npm run check:knowledge-index`、`npm run knowledge:search -- ...` |
| 上传摄取 | `npm run sources:ingest`（扫描上传暂存区并刷新待审队列，只读）、`npm run sources:ingest -- apply --item <id> --mode <register\|request-scoped\|ignore> [--dry-run] [--supersedes <materialId>] [--force-new] […]`（用户确认后登记/换版/忽略）、`npm run sources:ingest -- backfill`（为 manifest 存量材料补齐 sha256，幂等） |
| 项目经验 | `npm run knowledge:manage -- candidate-add --project <project> --scope <scope> --observation <observation> --judgment <judgment> --strategy <strategy> --evidence <ref> --validation <condition>`；验证后使用 `candidate-promote` |
| 稳定套件与脚本晋升 | `npm run test:suite:assess -- ...`、`npm run test:suite:status -- ...`、`npm run test:suite:register-design -- --suite <type/project/feature> --from-request <type/project/request>`（设计层注册：验证该请求用例确认已 accepted 后冻结设计证据）；格式级清单漂移先用 `npm run test:suite:refresh-design -- --suite <suite> --dry-run`，确认无语义/来源漂移后以 `--apply` 刷新；缺少语义基线仅可用 `--seed-design-baseline --confirm-current-design --apply` 显式建立。脚本经 `npm run task:manage -- suite-promote --request <id> --suite <suite> --level reviewed --case-script <caseId>:<.local candidate spec>` 晋升为可复用 reviewed，只有封印执行后才可用 `--level verified` 晋升为 direct_execute 基线。 |
| Durable Workflow | `npm run task:initialize -- ...`、`npm run task:resume -- ...`、`npm run task:status -- ...`、`npm run task:gate -- ...`；新请求固定为当前 v1，旧运行档案不提供迁移或回放。 |
| 定位修复回退 | `npm run task:manage -- execution-scope-reopen --request <id> --selector-repair <incident-path>` |
| selector | `npm run check:web-exploration -- ...`、`npm run test:web:verify-selectors -- ...`、`npm run test:web:inspect -- ...` |
| 正式执行 | `npm run test:execute -- --request <id>`、`npm run test:web:execute -- --request <id>` |
| 报告 | `npm run report:playwright`、`npm run report:allure` |
| 本机资源恢复 | `npm run test-data:recover` |
| 本机运行档案清理 | `npm run cleanup:local-runs -- --dry-run`（默认只清理已完成或已取消请求的 `.local/test-runs` 与对应 runtime）；淘汰一个已明确指定的中断请求使用 `--include-incomplete --request <type/project/request>`；批量清理仍使用 `--include-incomplete --keep <当前请求>`。两者都会拒绝有效租约或运行中的 reviewer；仅在没有保留请求时可追加 `--prune-unreferenced-blobs` 清除共享 reviewer 输入缓存。 |
| 完整重置 | `npm run reset:full-test-state -- --dry-run`、`npm run reset:full-test-state` |

新增、重命名或删除入口时，必须同步更新 `package.json` 与本表。
