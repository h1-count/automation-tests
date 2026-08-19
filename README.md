# IoT 自动化测试工程

<!-- role: project-entry-only -->

本项目用于 Web、H5、App、WebView、API、MQTT 和 IoT 链路自动化测试。

## 从这里开始

1. 阅读 [AGENTS.md](./AGENTS.md) 了解强制门禁与安全边界。
2. 阅读 [测试规范索引](./docs/testing/README.md)，按任务打开唯一责任规范。
3. 复制 `.env.example` 为本地 `.env`，填写当前环境所需的非公开配置。
4. 提供需求、URL、截图、接口资料或物模型；AI 测试 Agent 会直接生成、校验和评审完整用例，用户确认用例后再进入脚本和执行清单确认。

工程按“业务层 → 工程层 → 治理线”推进；完整流程、Graphify 定位和审核门禁以 [automation-guideline.md](./docs/testing/automation-guideline.md#32-双层模型与贯穿治理线) 为准。

## 文档职责

| 需要了解的内容 | 查看位置 |
| --- | --- |
| 强制门禁与安全边界 | [AGENTS.md](./AGENTS.md) |
| 生命周期、统一执行清单与人工挑战恢复 | [automation-guideline.md](./docs/testing/automation-guideline.md) |
| 环境、运行模式、账号、验证码和测试数据 | [environment-guideline.md](./docs/testing/environment-guideline.md) |
| 测试设计索引与用例格式 | [testcase-guideline.md](./docs/testing/testcase-guideline.md) |
| selector、报告、失败分类 | [docs/testing/](./docs/testing/README.md) |
| Agent 执行步骤、模板和示例 | [SKILL.md](./skills/iot-automation-testing/SKILL.md) |

规则正文只在责任文件维护；本 README 只提供项目入口。完整命令唯一登记在[工程脚本入口](./scripts/README.md)。

## 本地配置

真实地址、账号、密码、Token、设备标识和认证会话只能保存于本地 `.env`、CI Secret 或受控的 Git 忽略目录，不能提交到 Git。

环境通过 `TEST_ENV` 切换，无需修改测试脚本的 `baseURL`：

```env
TEST_ENV=test
ALLOW_PRODUCTION_TESTS=false
```

完整变量说明见 [.env.example](./.env.example)，环境选择和生产保护见 [environment-guideline.md](./docs/testing/environment-guideline.md)。

## 命令入口

按用途查找命令请使用[工程脚本入口](./scripts/README.md)；可执行脚本名和参数以 `package.json` 及命令自身帮助为准。本文件不复制命令表。

## 目录概览

目录职责、提交边界和敏感数据约束以 [AGENTS.md 的“目录边界”](./AGENTS.md#目录边界) 为准；用例目录导航见 [testcases/README.md](./testcases/README.md)，脚本目录导航见 [tests/README.md](./tests/README.md)。
