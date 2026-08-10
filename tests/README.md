# 可执行测试脚本

`tests/` 只存放可由 Runner 直接执行的测试脚本，回答“如何测”。请求级脚本必须关联同一请求中已确认的用例编号和 `plan.md` 工程设计；稳定脚本必须关联同一 `suiteId` 的 suite manifest、稳定用例与 plan。公共业务动作和协议访问不得重复写在脚本中。

| 子目录 | Runner / 场景 |
| --- | --- |
| `web/` | Playwright Web/H5 测试。 |
| `app/` | Appium + WebdriverIO App/WebView 测试。 |
| `api/` | TypeScript API Runner 测试。 |
| `iot-chain/` | MQTT 与 API/Web/App 的组合链路测试。 |

脚本目录必须与用例目录镜像对应，便于从一次测试请求直接定位其实现和运行结果：

```text
testcases/<test-type>/<project>/<test-request>/
tests/<test-type>/<project>/<test-request>/
testcases/<test-type>/<project>/suites/<feature>/
tests/<test-type>/<project>/suites/<feature>/
```

- 同一 `<test-request>` 下的脚本只关联该目录中已确认的用例编号。
- `suites/<feature>/` 只保存经 `suite-promote` 物化的当前稳定 formal manifest、`*.formal.spec.ts` 与请求专属契约/helper；共享 `src/` 能力和 `test-assets/` 仍按摘要引用，不复制。
- 脚本文件可以按业务模块或流程拆分；每个文件在测试标题中保留关联用例编号。
- 不为目录整理而迁移历史脚本；发生相关脚本改造时，迁移脚本、更新执行方案和命令引用。
