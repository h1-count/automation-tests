# 静态测试资产

本目录只存放可纳入版本控制、可复用的静态测试资产，例如 App 安装包、固件包和视觉基准图；不存放需求资料、运行产物、凭据或本机会话。

`manifest.yaml` 是资产身份、用途范围和完整性校验的唯一清单。新增、替换或删除资产时，必须同步更新对应条目的 SHA-256 和元数据，并执行：

```bash
npm run check:test-assets
```

计划阶段只可选择 `active` 资产；`inventory-only` 仅表示文件已盘点，未确认项目或用途前不得自动选择。使用 `npm run test-assets:select -- --project <项目> --kind <类型>` 查询候选资产。资产清单不属于业务需求资料，也不替代 `sources/manifest.yaml`。
