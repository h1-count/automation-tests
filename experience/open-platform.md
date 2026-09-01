# 开放平台专属经验

## 项目资料入口

- 需求资料：`sources/open-platform/需求/`
- 页面原型：`sources/open-platform/原型包/`
- 平台说明：`sources/open-platform/平台文档/`
- 接口资料：`sources/open-platform/接口/`

## 页面覆盖状态

- 已完成：登录与注册（`testpacks/web/open-platform/login-register/`，21 条用例，含密码重置入口互跳 017~021 待实现）；创建产品已完成用例设计与审核归档，待用户确认后页面探索（`testpacks/web/open-platform/create-product/`）。
- 候补：官网首页、控制台、用户中心与企业中心。
- 官网首页、控制台、用户中心与企业中心。
- 产品开发、设备接入、授权码和运营管理相关平台文档。

## 重建测试建议

先从无需账号、无需写入的页面可见性和导航用例开始；随后按实际可用的测试环境补充登录、表单和接口场景。每个场景独立保存为普通 Playwright `*.spec.ts` 文件。

## 登录与注册实操经验

- 获取短信验证码（登录、注册）与账号密码登录都会强制弹出点选文字图形验证码（`tacVerify()`，类型 `WORD_IMAGE_CLICK`），前端无测试旁路；测试采用“运行时人工协助”模式（见 `experience/general.md`）。
- 注册表单字段限制：企业标识 ≤6 字符、信用代码 ≤18 字符、联系电话 11 位手机号、营业执照图片必传（可在测试内用临时页面截图合成 PNG 样本）；企业名称、地址、邮箱、简介均有长度上限。
- 注册提交成功后跳转 `register-pending` 待审核页（URL 含 `register-pending`），以此作为写入成功的可观察信号。
- Element Plus 的 `el-checkbox` 原生 input 是隐藏元素，`check()` 会失败；用 `getByText("我已阅读并已同意").click()` 点击文字标签。
- 登录/注册页面语义化程度高：优先用 `getByRole("textbox", { name: <aria-label> })`、`getByRole("button", { name: ... })` 定位（如“注册企业名称”“获取注册短信验证码”“同意条款并注册”）。
- 登录成功后进入 `console-home`；产品开发首页与创建产品入口需登录态，受图形验证码前置约束。
