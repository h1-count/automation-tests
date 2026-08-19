# 测试用例目录索引

<!-- role: directory-index-only -->

本文件只说明 `testcases/` 的目录导航，不定义设计资产结构、运行事实或版本兼容。测试设计资产统一按[测试用例规范](../docs/testing/testcase-guideline.md)维护；请求生命周期与运行历史统一按[流程规范](../docs/testing/automation-guideline.md)处理。

| 一级目录 | 测试类型 |
| --- | --- |
| `web/` | Web 管理后台与独立 H5。 |
| `app/` | 原生 App 与 App 内 WebView。 |
| `api/` | HTTP / RPC 等接口。 |
| `iot-chain/` | API、MQTT、设备与页面或应用组成的端到端链路。 |

活跃请求使用 `testcases/<test-type>/<project>/<test-request>/`，跨项目共享设计使用 `testcases/<test-type>/shared/<test-request>/`，长期稳定设计放在项目的 `suites/<feature>/`，只读历史证据放在 `testcases/archive/`。各目录内部允许出现的资产、事实所有权和迁移规则只读取上述责任规范，不在本文件复述。

对应的可执行脚本使用镜像业务分类，目录导航见 [tests/README.md](../tests/README.md)。重置、归档和恢复只使用[工程脚本入口](../scripts/README.md)登记的命令。
