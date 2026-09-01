# 测试知识库

`sources/` 存放需求、原型、接口和平台文档等原始测试依据。它不存放测试用例、脚本、审核表、运行产物、测试结论或本地生成数据。

```text
sources/
├── indexes/                 # 项目资料导航索引
├── _shared/                 # 跨项目共享资料
└── <project>/
    ├── 需求/
    ├── 原型包/
    ├── 平台文档/
    └── 接口/
```

每次生成用例或开始测试前，先读取 `indexes/<project>.yaml`，再按索引与功能范围读取对应原始资料。索引只用于定位资料、章节和关键词；用户指令与原始资料优先于索引、经验库和代码实现。

新上传资料放入 `.dsh-filess/<project>/`。下一次执行 `node scripts/load-test-context.mjs --project <project> --scope <feature>` 时会自动归档到 `sources/<project>/<类别>/`，并把一条待细化的资料条目追加到 `indexes/<project>.yaml`。不在默认暂存目录的资料可显式归档：

```bash
npm run sources:ingest -- --project open-platform --from /绝对路径/上传资料目录
```

自动归档只负责文件分类、复制和初始索引；用例生成前仍须阅读原文，并将初始索引条目的章节、关键词和摘要补充为实际内容。

快速通道不使用 `manifest.yaml`、哈希门禁或资料登记流程。资料发生变化时，更新对应项目索引，并复核受影响功能测试包的 `cases.md`。
