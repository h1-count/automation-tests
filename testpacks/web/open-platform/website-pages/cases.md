# 用例集：开放平台官网页面（website-pages）

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write（咨询表单提交会触发短信与后端写入——本包全部 no_write，表单仅校验到客户端拦截，**绝不点击获取验证码**）
>
> 上下文来源：`sources/open-platform/需求/产品接入系统功能需求说明/产品接入系统功能需求说明.md`（「官网/公开页」章节）、前端源码 `web-open-platform/src/routes/website.ts`（/、/consultation、/sitemap、/terms-of-use、/privacy-policy、/cookie-policy、/legal-statement 七公开路由，全部 auth:false/public）、`pages/website/Homepage.vue`（1852 行：hero+方案+运营板块）、`Consultation.vue` + `components/ConsulationForm.vue`（企业名称/地址/姓名/手机/验证码/诉求表单，createConsulationForm+sendSmsCodeFree 提交链路）、`Sitemap.vue`（**空组件**）、`experience/general.md`、`experience/open-platform.md`。
>
> 上下文结论：①官网首页：标题「Hommor Aura 平台」+ 定位描述（硬件开发、云服务、App 开发一体化工具链）+ 三大生态描述 + 「立即使用/立即咨询」按钮（2026-09-04 实证渲染正常）；②咨询表单 6 字段与规则（实证空表单提交 5 条错误：请输入企业名称/企业地址/姓名/手机号/验证码）：企业名称 required maxlen50 organizationName、企业地址 required maxlen50 address、姓名 required realname（minlength2 maxlength20）、手机号 required mobile maxlength11、验证码 required（ValidCodeInput——**获取验证码=发送真实短信，测试禁点**）、诉求 text maxlength100；③提交成功态：「提交成功，我们的技术人员会在12小时内联系您」；④协议页 4 个（terms-of-use/privacy-policy/cookie-policy/legal-statement）+ sitemap（源码为空组件 `<div></div>`——实证页面仅框架页脚无正文，疑似缺陷/未实现）。
>
> 范围外声明：**咨询表单提交写入**（createConsulationForm 后端写入+短信发送——红线禁点获取验证码，提交链路不覆盖，待产品明确测试号码池后另行评估）；**「立即使用」登录跳转**（登录链路已由 console-home 包覆盖）。
>
> 本表供测试范围审核。真实密码、Token、密钥、Cookie 等可复用凭据仅从本地 `.env` 或对应登录态存储读取；表单输入均为合成值，不发送短信、不提交。

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 官网首页 | OP-WEB-001 | 官网首页渲染 | P0 | 低 |
| 咨询表单 | OP-WEB-002 | 咨询表单校验（禁短信） | P1 | 中 |
| 公开协议页 | OP-WEB-003 | 协议页可达性与 sitemap 空组件实证 | P2 | 低 |

## 模块：官网首页

<details>
<summary>OP-WEB-001｜官网首页渲染｜P0｜低风险</summary>

> 前置条件：无（公开页）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 直达 /（官网首页） | 无 | 「Hommor Aura 平台」标题 + 平台定位描述可见 |
| — | 2 | 观察核心板块 | 无 | 「一站式硬件接入方案」「产品运营系统」等板块标题可见（实证注解板块清单） |
| — | 3 | 观察行动按钮 | 无 | 「立即使用」「立即咨询」按钮可见 |

</details>

## 模块：咨询表单

<details>
<summary>OP-WEB-002｜咨询表单校验（禁短信）｜P1｜中风险</summary>

> 前置条件：无（/consultation 公开页）。
>
> 是否写入数据：否（校验到客户端拦截即止；**禁点「获取验证码」——短信红线**）。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| D01 | 1 | 空表单点击提交 | 无 | 5 条字段级错误：请输入企业名称/企业地址/姓名/手机号/验证码（实证）；不触发短信、不发请求 |
| D02 | 2 | 企业名称输入含 # 字符 | 合成值「自动化测试#公司」 | organizationName 字符集提示（注解实际文案） |
| D03 | 3 | 手机号输入 10 位数字 | 合成值「1380013800」 | mobile 格式提示（11 位校验；maxlength=11 不触发截断——10 位保留并报格式错） |
| D04 | 4 | 姓名输入含 # 字符 | 合成值「张#三」 | realname 字符集提示（注解实际文案） |
| D05 | 5 | 恢复全部合法值（验证码留空） | 合成值 | 字段错误清空；验证码仍必填报错；**不提交、不获取验证码**，注解收尾 |

</details>

## 模块：公开协议页

<details>
<summary>OP-WEB-003｜协议页可达性与 sitemap 空组件实证｜P2｜低风险</summary>

> 前置条件：无（公开页）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 依次直达 terms-of-use/privacy-policy/cookie-policy/legal-statement | 无 | 4 页可达且含正文/页脚（页脚：服务热线 400-1077050、企业邮箱、版权与 ICP 备案注解） |
| — | 2 | 直达 /sitemap | 无 | 实证注解：源码为空组件，页面仅框架页脚无正文——疑似缺陷/未实现，待产品确认 |

</details>
