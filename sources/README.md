# 原始测试资料（含原始知识资料库）

`sources/` 存放用户、产品、研发或测试人员提供的原始资料，以及由原始资料导出的受控章节索引。这里的内容是“测试输入”和可追溯的业务事实，不是测试用例、脚本、运行日志或测试环境中创建的业务数据。`knowledge-base/` 是其中的**原始知识资料库**：保存原文协议、接口文档、平台文档等，不沉淀测试结论或执行经验。

使用 [manifest.yaml](./manifest.yaml) 登记资料身份、来源、版本、适用项目与范围、状态及必要说明；测试用例关联和运行追溯只在相应测试请求的 `plan.md`、用例包与报告中维护。敏感资料不得提交 Git，应只记录脱敏引用或受控访问位置。`manifest.yaml` 只登记本目录内的原始业务资料，不登记 `.local/repositories/` 中的源码、Graphify 图谱或源码定位信息。

## 读取与登记规则

开始测试任务时，先扫描 `sources/` 目录结构并读取 `manifest.yaml` 的元数据；被测项目存在 `knowledge_indexes` 登记时，再读取该项目的章节索引。章节索引只含主题、关键词、定位和简短摘要，不等于读取原文。按用户指定、被测项目、测试范围、章节主题、关键词、`reference_scopes` 和已有计划追溯筛选 `status: active` 的资料；只读取命中的原始资料章节，并在对应 `plan.md` 的“输入资料”中回链 manifest `id`、`sectionId`、路径、页码或标题定位、版本和 SHA-256。

除 `README.md`、`manifest.yaml`、`indexes/` 下的受控章节索引和受控引用外，目录中每一份原始资料都必须有一个 `materials` 条目。Axure 等导出的原型包可将**包根目录**作为一个 `prototype` 资料登记，入口和业务页面通过章节索引按需定位，包内 HTML、图片、脚本和样式不单独登记。章节索引通过 `knowledge_indexes` 登记，不是原始资料，不得作为需求事实或用例依据。新资料在用于正式计划、用例或评审前补登；版本、适用项目或范围未知时明确填 `unknown` 或空列表并记录待确认，不得默认适用。

原始 PDF/Word 变更导致 SHA-256 不一致时，对应章节索引立即视为过期；不得继续作为已确认需求依据，必须重新提取、审核索引，并按变更影响规则复核受影响的计划和用例。含截图、流程图或扫描页的章节仅在检索命中后按需视觉/OCR读取；不得预先 OCR 全库，也不得将图中文字视为未复核的事实。

代码仓库位置统一由 `.local/repositories/` 作为根目录，并只在用例确认后的 `plan.md`“工程层：代码定位与自动化设计”记录仓库、分支/提交、Graphify 图谱和源码定位依据。代码不是业务需求资料，不能写入 `manifest.yaml` 或作为用例需求基线。

## 版本管理与上传摄取

上传的文档落在会话暂存区（`.dsh-filess/session-*/`），不会自动进入本目录或 Git。摄取流水线（`npm run sources:ingest`）在会话开始时扫描暂存区，按内容 SHA-256 与文件名规约对每份文件分类，写入待审队列 `.local/upload-inbox/pending.json` 并向用户报告；**登记、换版与忽略都只在用户确认后**由 `apply` 子命令执行，禁止自动晋升。判定规则：

| 分类 | 判定 | 处置 |
| --- | --- | --- |
| duplicate | 哈希与某 active 材料一致 | no-op，仅告知 |
| new-version-candidate | 文件名规约匹配某材料但哈希不同 | 必须由用户 `--supersedes` 指认后换版 |
| ambiguous | 文件名与多份材料相近 | 必须由用户指认（`--supersedes` 或 `--force-new`） |
| new-material-candidate | 无匹配 | 默认按请求内来源使用；跨请求复用才晋升登记 |
| not-source-candidate | 本工程评审工作簿等产物 | 建议忽略 |
| belongs-to-test-assets | 安装包/固件二进制 | 转投 `test-assets/manifest.yaml` |

一次性附件按[流程规范 §3.1 第 4 条](../docs/testing/automation-guideline.md#31-测试上下文加载)默认作为请求内来源，不强制登记；晋升登记时元数据未知项必须显式 `unknown`/空列表，不得默认适用。文本类文件自动做敏感初筛（命中即拒绝登记、要求人工复核），二进制文档标记 manual-review。

**版本链与旧版本处置**：材料身份由 `id` 承载，永不被覆盖重用；当前版唯一存放于工作区 `path`。换版时旧版本的 `version`、`path`、`sha256`、`superseded_at`、`superseded_in_commit` 沉入该材料的 `version_history`，旧文件内容不删除——由 Git 历史承载（`git log`/`git show` 回溯），每次换版是一次显式提交。同名换版直接覆盖当前路径；换名换版新增文件并移除旧路径。覆盖 `covered_material_ids` 命中该材料的 `knowledge_indexes` 登记自动置 `stale`，重新提取审核前不得继续作为需求依据。仅当某旧版需要在本测试周期频繁对照阅读时，才允许把它显式复制到版本旁路目录（如 `sources/_versions/<id>/`）并登记说明，用完即清。`check:knowledge-index` 会校验 active 材料的材料级 `sha256` 与实际内容一致，哈希漂移即失败。

| 子目录 | 存放内容 |
| --- | --- |
| `requirements/` | 需求文档、产品说明、研发设计说明；也可存放随需求交付的原型包。 |
| `api-docs/` | API 文档、请求/响应样例、鉴权说明。 |
| `iot-models/` | 物模型、Topic、Payload、告警规则。 |
| `screenshots/` | 页面、App、错误提示等截图资料。 |
| `prototypes/` | 原型链接说明、页面地址与交互资料。 |
| `knowledge-base/` | **原始知识资料库**：外部平台、设备协议或研发提供的原文资料；仅在本次测试实际引用时登记到 `manifest.yaml`，不写入测试经验或从原文复制出的结论。 |
| `indexes/` | **受控章节索引**：按项目登记文件、章节、主题、关键词、定位和哈希；不属于 `materials`，不保存原文或测试结论。 |
