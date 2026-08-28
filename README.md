# IoT 自动化测试工程（快速通道分支）

本项目用于 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。本分支（`workflow-simplification`）以**快速跑通**为目标，已停用正式流程仪式。

## 从这里开始

1. 复制 `.env.example` 为本地 `.env`，确认 `TEST_ENV` 与被测地址（本地默认 `http://127.0.0.1:3098/`）。
2. 启动本地被测服务（或用 `FAST_BASE_URL` 指向远程测试环境）。
3. 跑测试：

   ```bash
   npm run test:fast            # 全部用例
   npm run test:fast:headed     # 有头调试
   ```

完整说明见 [docs/FAST-TRACK.md](./docs/FAST-TRACK.md)，硬边界见 [AGENTS.md](./AGENTS.md)。

## 文档职责

| 需要了解的内容 | 查看位置 |
| --- | --- |
| 快速通道用法、地址解析、产物位置 | [docs/FAST-TRACK.md](./docs/FAST-TRACK.md) |
| 硬边界（生产、真实数据、凭据） | [AGENTS.md](./AGENTS.md) |
| 旧正式流程规范（本分支仅参考） | [docs/testing/](./docs/testing/README.md) |
| 环境变量说明 | [.env.example](./.env.example) |
| 命令登记 | [scripts/README.md](./scripts/README.md)、`package.json` |

## 本地配置

凭据只放本地 `.env`，不提交 Git。环境通过 `TEST_ENV` 切换：

```env
TEST_ENV=test
ALLOW_PRODUCTION_TESTS=false
```

## 目录概览

- `tests/<type>/<project>/`：可执行测试脚本，普通 `*.spec.ts` 被 `npm run test:fast` 自动发现。
- `src/`：fixtures、actions、clients、env、support 等公共能力。
- `scripts/`：环境检查、认证初始化、报告等脚本（含停用的正式通道入口）。
- `artifacts/`：Git 忽略的执行产物（报告、trace）。
- `docs/testing/`、`skills/`：旧正式流程文档，本分支仅参考。
