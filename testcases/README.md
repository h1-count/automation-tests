# 测试计划与测试用例

`testcases/` 存放经过审核的测试设计：测试计划、结构化用例、合理推断和待补充信息。这里回答“测什么、为何这样测”，不存放可执行代码和运行报告。每个测试请求只使用一份 `plan.md` 承载计划、覆盖基准与拆分、用例集评审以及用例确认后的工程层代码/图谱/脚本设计。

测试计划和用例格式见 [测试用例规范](../docs/testing/testcase-guideline.md)。正式脚本只能关联状态为“已确认”的用例；该状态必须由绑定当前用例集 digest 的有效 callback 与 `plan.md` 正式决定派生，不能在用例包中独立维护确认事实。

| 一级目录 | 测试类型 |
| --- | --- |
| `web/` | Web 管理后台与独立 H5。 |
| `app/` | 原生 App 与 App 内 WebView。 |
| `api/` | HTTP / RPC 等接口。 |
| `iot-chain/` | API、MQTT、设备与页面/应用组成的端到端链路。 |

新增用例按以下结构存放；一个目录对应一次独立的测试请求，同一次测试产生的计划和全部用例都保存在该目录中：

```text
testcases/<test-type>/<project>/<test-request>/
├── plan.md                    # 业务层计划、评审和工程层设计
├── workflow-history.ndjson    # 脱敏、可校验、可回放的请求级运行事件历史
├── cases-<module-a>.md        # 按模块组织的原子用例包
├── cases-<module-b>.md
└── ...
```

- `<test-request>` 是稳定的 kebab-case 测试主题，代表一次独立、可审核的测试请求，而不是一次执行记录或单条用例。
- `workflow-history.ndjson` 是 Activity、等待、重试、阻塞、恢复和工作流终态的唯一运行事实源；任务、阶段、整体进度和用例完整度都是派生视图。该文件不得包含凭据、验证码、Cookie、Token、线程标识、claim/lease 或真实用户数据。
- 同一请求的功能、校验、边界、异常、权限、体验等用例按稳定业务模块或完整流程写入 `cases-<module>.md`；原子用例通过稳定 `caseId` 和“覆盖关联”保持独立追溯。
- 不同测试请求使用不同目录；补充用例和复测仍归入原请求目录。范围实质变化、需要重新确认时，建立新的请求目录。
- `testcases/archive/<test-type>/<project>/<test-request>-archived-<YYYYMMDD-HHmmss>/` 存放只读历史测试证据，不是活跃请求；默认不参与上下文加载，仅在用户明确要求复盘、变更影响分析或引用历史时读取。保留 `plan.md`、用例、正式评审、报告摘要和 workflow history；请求专属历史脚本统一放在同目录的 `automation/` 子目录。运行缓存、旧本机状态和台账不得进入正式历史。
- 需要完整重新开始时，先执行 `npm run reset:full-test-state -- --dry-run` 审核范围；正式执行会将所有活跃测试请求归档到本目录，不删除历史证据。
- 跨项目通用测试设计可放在 `testcases/<test-type>/shared/<test-request>/`。历史平铺用例不为目录整理而批量迁移；在相关需求或脚本改造时同步迁移并更新链接。
- 对应的可执行脚本采用镜像目录 `tests/<test-type>/<project>/<test-request>/`；目录规则见 [tests/README.md](../tests/README.md)。
