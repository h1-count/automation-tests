# 开放平台文档中心：测试结论

## 当前结论（2026-09-04 首轮建立）

- 用例集 2 条（全 no_write），2/2 全部通过（2026-09-04）。上下文来源与范围外声明见 cases.md 顶部。
- 2026-09-04 实证：
  - **文档中心加载失败（实证缺陷）**：/service-support/home 页面可达但目录空、正文区「加载失败，请刷新页面重试」——`fetch('/service-support/content.json')` 返回 Vite SPA fallback（text/html）→ JSON 解析 SyntaxError。根因：`public/service-support/` 为空目录，content.json 与内容 md 均未部署/未提交。无 JS 崩溃白屏（应用根节点正常）。
  - 常见问题页（/service-support/faq）同款失败（FAQViewer 同 fetch 模式同根因）——查重结论：修复应同源生效。

## 实现差异与疑似缺陷

1. **疑似缺陷/待部署：文档内容静态资源缺失**——`public/service-support/` 空目录导致整个文档中心与 FAQ 不可用（前端代码逻辑正常，内容资源缺失）。**建议与研发/运维确认内容部署流程**（源码仓库未包含内容文件，疑部署侧生成）。

## 写入与数据说明

- 本包**无台账记录**（全 no_write）。

## 后续关注

- content.json 部署后：补目录导航、正文锚点跳转、markdown 渲染断言的内容级用例。
