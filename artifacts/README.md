# 执行过程与结果产物

`artifacts/` 只存放 Runner 在测试过程中或结束后生成的证据和报告；它不是用户上传资料、测试用例、脚本或测试环境业务数据的存储位置。该目录默认不提交 Git。

| 子目录 | 内容 |
| --- | --- |
| `test-results/` | JUnit XML、原始 Runner 结果、中文执行摘要。 |
| `playwright-report/` | Playwright HTML 报告。 |
| `allure-results/` | Allure 原始结果。 |
| `allure-report/` | 可查看的 Allure 报告。 |
| `screenshots/` | 失败或关键步骤截图。 |
| `traces/` | Playwright Trace 等调试证据。 |
| `videos/` | 失败录屏。 |

认证、验证码或敏感输入场景的产物必须遵守报告规范的脱敏要求；真实业务数据仅记录脱敏别名、残留风险和清理状态，不复制到本目录。
