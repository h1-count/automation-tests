---
name: testcase-designer
description: 快速通道测试用例设计器。为 automation-tests 工程生成“上下文来源可追溯、参数取值有依据、写入风险分级明确”的分层用例表（testpacks/<type>/<project>/<feature>/cases.md），并导出同包 Excel 审核工作簿交用户确认。当用户要求“生成测试用例、设计用例、建用例表、补充/更新 cases.md、做参数组合或 pairwise 设计、导出用例审核工作簿/Excel”或提出对新功能做自动化测试时使用。本 skill 只产出设计与审核材料，不触发任何外部写操作。
---

# 测试用例设计器（快速通道）

> 权威边界：AGENTS.md 是本工程唯一权威；本 skill 与其冲突时以 AGENTS.md 为准。
> 适用流程段：`加载知识库与经验库 → 划定范围（七类提取）→ 参数与取值设计 → 生成分层用例表 → 导出 Excel 审核工作簿`。
> 审核通过后的探索、脚本编写与执行不归本 skill，但第 5 节给出交接要点。

## 概述

给定一个功能范围（`--project` + `--scope`），本 skill 完成三件事：

1. **可追溯的上下文**：从 `sources/` 与 `experience/` 实际阅读资料，把来源路径和影响用例的结论写进用例文件顶部；
2. **有依据的参数设计**：用等价类划分、边界值和成对组合（pairwise）识别参数、取值与业务约束，参数化数据落为 `D01`、`D02`；
3. **可审核的标准产物**：分层用例表 `*.cases.md` + 由 `scripts/build-testcase-review-workbook.mjs` 导出的 Excel 审核工作簿。

产物停留在"设计"层：不打开被测页面、不发验证码、不登录、不提交任何表单。

## 何时使用本 skill

- 用户点名要为新功能、新页面或新接口"生成/设计/补充测试用例"；
- 需求或原型资料更新，需要同步修订某个 `*.cases.md`；
- 功能含 3 个以上输入参数、配置项或环境因子，需要压缩组合规模（pairwise）；
- 用例审核通过后资料又发生变化，需要重新导出审核工作簿。

不适用：直接写 Playwright 脚本、跑测试、排查失败——走 `docs/FAST-TRACK.md` 与 `experience/general.md`。

## 工作流

### 1. 加载上下文（必经，不可跳过）

```bash
node scripts/load-test-context.mjs --project <project> --scope <feature>
# 可选追加检索词：--query "登录,验证码"
```

按输出清单依次完成：

- **先阅读资料导航索引**（`indexFiles`）与索引命中章节（`indexedSections`），再阅读命中的文本资料（`matchedSources`）与 `experience/general.md`、`experience/<project>.md`；命令会自动归档 `.dsh-filess/<project>/` 中的新资料，并通过 `ingestion` 返回归档结果；
- **按范围打开二进制资料**（`manuallyReviewedSources`：docx/pdf）——清单只定位，不替代阅读；
- **查重**：检查同项目既有 `testpacks/<type>/<project>/<feature>/` 功能包，避免重复或矛盾；
- **冲突处理**：用户指令与 `sources/` 优先于经验库；资料冲突或缺关键资料时，在用例里标注"待确认"，且只生成不触发外部写操作的场景。

### 2. 划定范围（七类提取，先于参数识别）

生成或补全用例集时，按以下类别逐项提取核对，不得只写主流程（本清单是七类提取的权威定义，AGENTS.md 与 docs/FAST-TRACK.md 仅保留指针）：

① 页面/接口可达性与核心主路径；② 必填、空值、长度上下限、字符集、格式、默认值；③ 唯一性、重复提交、幂等；④ 正常、异常、边界与错误提示；⑤ 权限、协议勾选、状态流转、跳转结果；⑥ 验证码、登录态、上传文件等特殊约束；⑦ 数据写入风险、成功判定信号和后续处置。

- 提取依据落到实际资料与实现：参考资料（需求、原型、平台文档等任一）用于理解业务意图，原型不是必须；**前端源码是硬前提**——本地环境启动、脚本定位与七类提取的实现核对都依赖它，用源码（路由、表单校验规则、按钮防重复、终态页面）核对实现事实，发现参考资料未覆盖的完整实现（如密码重置页）一并纳入范围；
- **前端代码缺失时向用户提供**：本地仓库路径或仓库访问方式（clone 地址与权限），拿到前不得进入脚本阶段，已生成的用例预期一律标注"未经实现核对"；强实现依赖类别（②校验规则、③幂等实现、⑤状态流转/跳转）的预期按参考资料编写并在用例表头部声明，待拿到源码后逐类核对修正；
- 每个类别：有对象就补用例；确属范围外（依赖外部动作、破坏凭据链路、跨模块、分钟级等待）在用例表头部显式声明理由，不得沉默遗漏；
- **类别打勾前先做对象矩阵核对**：七类是核对维度，不是对象清单——"该类有用例"不等于"该类下每个对象都覆盖"。逐类列出对象矩阵，一行对象必须有对应用例或范围外声明，二者必有其一：
    - ①⑤ 主路径与跳转：按"入口方式 × 路径正负 × 访问方式（从入口进入 / 绕过入口直达）"列行——绕过页面的直达路径（如未登录访问受保护页、已登录回访登录页）不会出现在任何页面的操作序列里，必须单独成行；
    - ②⑥ 字段与特殊控件：按"表单 × 字段 × 取值类"列行——同一控件在多个表单出现时各表单分别成行，不得由另一表单"同理"默认覆盖；
    - ③ 幂等与唯一性：按"可重复动作 × 触发方式"列行（连点、慢网重试等触发方式按实现事实核对）；
    - 数据可得性不消灭用例行：因缺少凭据、账号、环境而无法实现的对象，保留该行并标注"待确认：<缺什么>"，不得从清单上消失；
    - 成本高的行（多次人工点选、分钟级等待、可能锁定共享账号）同样只允许"用例"或"范围外声明"两种归宿，跳过必须留声明。

### 3. 识别参数、取值与约束

从参考资料（需求、原型、平台文档，任一即可）中提炼四类信息（示例：登录功能）：

| 要素 | 含义 | 示例 |
| --- | --- | --- |
| 参数 | 输入项、配置项、方式开关、环境因子 | 登录方式、凭证有效性、协议勾选 |
| 取值 | 用等价类+边界值压缩后的值域 | 凭证：有效 / 无效（而非罗列每个错误串） |
| 约束 | 参数间的业务依赖 | 短信登录时不出现密码框 |
| 预期 | 每种组合的可观察结果 | 按钮可用、出现字段级提示、跳转 |

**组合规模判断**：

- 参数 ≤ 2 个或全组合 ≤ 12 条：直接枚举，每个组合一条数据；
- 参数 ≥ 3 个且全组合明显膨胀（例如 4 参数 × 4 取值 = 256）：用 pairwise 压缩到 12~20 条。写模型 JSON，跑本 skill 自带脚本：

```bash
node skills/testcase-designer/scripts/pict-pairwise.mjs --model testpacks/<type>/<project>/<feature>/runtime/pairwise/pict-model.json --format md
```

模型写法、约束语法与压缩策略见 `references/pairwise-design.md`。生成结果逐一映射为数据编号 `D01`、`D02`……写入步骤表的"测试数据"列。

✅ 参数用业务名命名（`登录方式`、`凭证有效性`），取值用等价类压缩（`凭证：有效/无效`而非罗列错误串），边界值显式列出（`长度: 0, 5, 6, 7` 当上限为 6），必含空值/超限等负向取值；❌ `参数A`、`v1` 式命名、罗列具体字符串。
✅ 约束写明业务理由（`# 短信登录不出现密码框`），从真实业务规则推导，先少后多；❌ 过度约束（把合法组合排除光）或引用不存在的取值。

典型设计模式：

- **表单前置校验（no_write）**：填全部必填 → 逐个字段喂非法值（超长、非法字符、空）→ 断言字段级提示与提交按钮状态，**不点击提交**；
- **向导式流程（分步用例）**：每个向导步骤一条用例，前置条件链上一步，最后的"提交成功"单列高风险用例；
- **参数化组合（pairwise）**：3+ 参数先跑 `pict-pairwise.mjs`，输出行映射为 `D01`~`Dnn`，在"是否写入数据"或折叠正文说明数据来源；脚本阶段用 `for...of` 遍历数据数组实现。详见 `references/pairwise-design.md`。

### 4. 生成分层用例表

路径 `testpacks/<type>/<project>/<feature>/cases.md`，格式**严格**沿用第 4 节模板。硬性要求：

- 顶部三段引用块：默认信息（类型/环境/数据策略）、**上下文来源**（实际读过的路径）、**上下文结论**（影响用例的约束与待确认项）；
- 快速索引五行列；每个用例一个 `<details>` 折叠，标题格式 `编号｜标题｜优先级｜风险`；
- 折叠正文三行元信息：前置条件、是否写入数据（含写入内容说明）、脚本状态（初始一律"待审核"）；
- 步骤表五列：`数据编号、步骤、操作、测试数据、预期结果`；每行**只写一个操作**和**一个可观察预期**；非参数化用例数据编号为 `—`；
- 测试数据列只允许：合成值描述、`D01` 式编号、`.env` 变量名（如 `TEST_PHONE`）。**禁止**出现真实密码、Token、密钥、Cookie 等可复用凭据的实际值（测试手机号、固定测试验证码属合成值，不受此限）；
- 优先级口径：核心路径/资金/数据写入 = P0；风险口径：涉及短信、登录态、提交、生产数据 = 高。发短信、创建登录态、提交表单 = 写入，在"是否写入数据"里写明内容与记录去向；探索类、校验类用例尽量设计成 no_write（填表不提交、验证码不请求），把写入集中到最少的"提交成功"用例。验证码/登录态场景前置条件写明 `.env` 已配置 `TEST_PHONE`、`TEST_VERIFICATION_CODE`，步骤里测试数据只写变量名；图形验证码按 `experience/general.md` 的"人工协助点选"模式设计，预期写倒计时文案等同步信号；
- 预期结果必须可观察、可断言（"出现字段级提示"、"跳转 URL 含 `register-pending`"、"按钮进入倒计时"），❌ "成功"、"报错"、"页面正常"；
- 提示文案写进用例表时，语义是"该场景应出现的提示（需求参考文案）"而非逐字断言依据：脚本阶段按 AGENTS.md 断言"出现提示"这一行为，实际文案与用例表文案的差异以"文案差异"注解进报告，不阻断测试；捕获到的提示仍须与用例预期终态一致（与该字段/拒绝语义相关、跳转 URL 正确），无关提示不得作为通过依据。

### 5. 构建评审模型并导出 Excel 审核工作簿

Excel 必须由脚本生成，不得以对话 Markdown 表替代：

1. 按 `references/review-model.md` 的契约写构建脚本（模板可直接复制），产出到 `testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-model.json`；
2. 先校验再导出：

```bash
node scripts/build-testcase-review-workbook.mjs --model testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-model.json --validate-only
node scripts/build-testcase-review-workbook.mjs \
  --model testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-model.json \
  --output testpacks/<type>/<project>/<feature>/review/<review-id>/<功能>用例审核.xlsx \
  --preview-dir testpacks/<type>/<project>/<feature>/review/<review-id>/previews \
  --receipt testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-receipt.json
```

3. 把功能包 `review/<review-id>/` 下的 xlsx 交给用户，**明确等待确认**。

### 6. 审核后的交接（本 skill 的收尾）

- 用户确认前：不发送验证码、不登录、不提交注册、不做任何外部写操作；
- 用户确认后：先**重新运行第 1 步**的上下文加载，复核范围、环境、写入风险与已审核用例仍一致；资料或结论有变 → 回到第 4 步更新用例表并重新导出 Excel，不得以经验库替代审核；
- 一致才交棒：Chrome DevTools MCP 按审核工作簿逐条探索 → 同功能包写 `<feature>.spec.ts` 并维护 `conclusion.md` → `npm run test:fast`。写入类用例的数据记录一律经 `src/support/recordGeneratedData.ts`，约定以 AGENTS.md 为准。

## 输出格式（cases.md 模板）

```md
# 用例集：<功能名称>

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
>
> 上下文来源：`sources/<project>/<实际阅读路径>`、`experience/general.md`、`experience/<project>.md`。
>
> 上下文结论：<影响用例范围的判断；写入风险点；待确认项>。
>
> 本表供测试范围审核。真实密码、Token、密钥、Cookie 等可复用凭据仅从本地 `.env` 或对应登录态存储读取；测试手机号、测试验证码为合成值，可正常出现在记录、报告与 trace 中。

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| <模块> | <PROJ>-<SUBJ>-001 | <标题> | P0 | 中 |

## 模块：<模块名>

<details>
<summary><编号>｜<标题>｜P0｜<中/高>风险</summary>

> 前置条件：<环境、账号、上一用例依赖>。
>
> 是否写入数据：否。 / 是（<写入内容>；生成数据全量明文记录到本功能包 `runtime/` 台账）。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | <单一操作> | 无 / 合成值 / `D01` / `.env` 变量名 | <单一可观察预期> |

</details>
```

## 排错

| 症状 | 处置 |
| --- | --- |
| `--validate-only` 报 digest/结构错误 | 模型与导出层的五个摘要必须一致；按 `references/review-model.md` 的构建模板重新生成，不要手改 JSON |
| 上下文清单命中为空 | 检查 `--scope` 拼写与 `load-test-context.mjs` 里的 scopeAliases；用 `--query` 补检索词；确无资料则在用例顶部标"待确认"并只出 no_write 用例 |
| pairwise 退出码为 2（"可覆盖取值对未被覆盖"） | 属模型或用法异常：核对参数、取值拼写与约束引用；"被约束整体排除（属预期）"的提示不是错误，是业务约束的如实反映 |
| 全组合超脚本上限 | 先用等价类压缩取值；仍超限则按业务把参数拆成多个独立模型 |
| 与既有用例重复/矛盾 | 以本次 `sources/` 与用户指令为准更新旧表；更新后必须重新导出 Excel 审核 |

## 参考

- `references/review-model.md` —— 评审模型 JSON 契约、摘要计算约定、构建脚本模板、workbook 命令；
- `references/pairwise-design.md` —— 参数建模、约束语法、pairwise 策略与 D01 映射；
- `scripts/pict-pairwise.mjs` —— 零依赖成对组合生成器（`--model` 必填，`--format md|json`）；
- 工程级权威：`AGENTS.md`、`docs/FAST-TRACK.md`、`experience/general.md`、`experience/<project>.md`；
- 方法论源头：[microsoft/pict](https://github.com/microsoft/pict)、[pypict](https://github.com/kmaehashi/pypict)（本 skill 的组合设计写法借鉴 [pypict-claude-skill](https://github.com/omkamal/pypict-claude-skill)）。
