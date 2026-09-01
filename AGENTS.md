# 自动化测试项目规则（快速通道分支）

## 跑测试

- 全部：`npm run test:fast`（默认有头）；指定功能：`npm run test:fast -- testpacks/web/<project>/<feature>/<feature>.spec.ts`。
- 地址解析与本地 Vite 自动启动的机制细节以 `docs/FAST-TRACK.md`「环境」为准（机制本体在 `playwright.fast.config.ts`），此处不重复维护。

## 硬边界（仅三条，不可去掉）

1. 生产环境测试需用户明确点名并显式设置 `ALLOW_PRODUCTION_TESTS=true`，否则一律按 test/pre 环境执行。
2. 不删除真实数据、不做批量操作、不做高风险设备动作（断网、刷固件、控制硬件）。
3. 真实密码、Token、密钥、Cookie 等可复用凭据不写入 Git、日志、报告、Trace 或回复；可复用凭据只放本地 `.env` 或其对应存储位置（如登录态文件）。测试手机号、固定测试验证码等合成值不是凭据，可正常出现在用例、记录、报告与 Trace 中。

## 功能包与工程边界

- 测试资产按功能测试包聚合，目录与文件布局（含各目录 Git 边界、`review-id` 命名与覆盖更新约定）以 `docs/FAST-TRACK.md`「功能测试包结构」为准，此处不重复维护。
- `src/`、`scripts/`、`skills/`、`sources/`、`experience/` 为跨功能共享目录，不移动到测试包。
- 不保留测试请求、评审、门禁、manifest、运行档案或正式执行链路；提交信息沿用 `type(scope): 中文摘要` 格式。

## 用例表与审核

- 用例生成遵循 `skills/testcase-designer`（分层用例表格式、参数化 `D01…` 编号、pairwise 方法的权威定义在其 SKILL.md 与 references）；审核必须用 `scripts/build-testcase-review-workbook.mjs` 从评审模型导出 Excel，不得以对话 Markdown 表替代。
- 用例范围完整性：生成或补全用例集时，按 `skills/testcase-designer/SKILL.md`「工作流——划定范围（七类提取）」逐类核对，不得只写主流程；缺失类别补用例或在用例表头部显式声明范围外理由。清单的权威定义在 SKILL.md，此处不重复维护。
- 用例文件顶部记录「上下文来源」（实际阅读的资料与经验文件）和「上下文结论」（影响用例的约束）；用户指令与 `sources/` 优先于经验；资料冲突或缺失时标明待确认范围，只生成无外部写操作的用例。

## 上下文与流程

- 生成用例与测试前必须先加载上下文、开始探索/写脚本/执行前必须重新加载复核（范围、环境、写入风险、已审核用例一致性），完整流程链、命令用法与上下文记录格式以 `docs/FAST-TRACK.md` 为准，此处不重复维护。
- 不可逾越的闸门：Excel 未经用户确认不得发送验证码、登录、提交注册或执行其他外部写操作；页面事实与已审核用例不一致时，先更新用例表并重新导出 Excel 再继续。

## 定位与写入

- 定位与断言、提示类断言、数据写入的**完整规则与实现模式**以 `docs/FAST-TRACK.md`「生成测试用例并写脚本」（含 `experience/general.md` 的模式沉淀）为权威，此处只保留义务与红线：
- 定位优先 ARIA（`getByRole`、可访问名称、`aria-*`），不依赖第三方组件库内部类名；
- 提示类断言不得以文案精确匹配作为通过条件，捕获结果必须与用例预期终态一致，无关提示不得让用例误通过（方法细节见权威文件）；
- 数据写入只经 `src/support/recordGeneratedData.ts`，台账 `runtime/generated-data.json` 只增不删、任何清理不得波及；测试数据均为合成值（凭据红线见硬边界第 3 条）。
