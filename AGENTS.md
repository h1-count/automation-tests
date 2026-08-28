# 自动化测试项目规则（快速通道分支）

本分支 `workflow-simplification` 的唯一目标：**快速跑通自动化测试**。正式流程的仪式（授权快照、manifest、评审、门禁、运行档案）在本分支全部停用，代码保留可随时回切。

## 跑测试（默认方式）

- 一条命令：`npm run test:fast`；有头调试：`npm run test:fast:headed`；跑指定文件：`npm run test:fast -- tests/web/xx.spec.ts`。
- 被测地址解析顺序：`FAST_BASE_URL` > `.env` 按 `TEST_ENV` 解析 > 远程测试环境默认值。本地服务没起时用 `FAST_BASE_URL` 指向远程测试环境即可。
- 新用例直接写 `tests/<type>/<project>/<feature>.spec.ts`，普通 `*.spec.ts` 会被自动发现；`*.formal.spec.ts` 是停用的正式通道命名，快速通道忽略。
- 报告：`artifacts/fast-report/`（`npm run report` 查看）；失败自动留 trace 在 `artifacts/fast-results/`。
- 快速通道细节见 [docs/FAST-TRACK.md](docs/FAST-TRACK.md)。

## 硬边界（仅三条，不可去掉）

1. 生产环境测试需用户明确点名并显式设置 `ALLOW_PRODUCTION_TESTS=true`，否则一律按 test/pre 环境执行。
2. 不删除真实数据、不做批量操作、不做高风险设备动作（断网、刷固件、控制硬件）。
3. 密码、验证码、Token、密钥、Cookie 不写入 Git、日志、报告、Trace 或回复；凭据只放本地 `.env`。

## 其余

- 旧的正式执行链路与规范文档（`docs/testing/`、`skills/iot-automation-testing/`）在本分支仅作参考，不构成流程要求；回切分支即恢复原流程。
- 提交信息沿用 `type(scope): 中文描述` 格式。
