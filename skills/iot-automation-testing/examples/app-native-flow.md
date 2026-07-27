# App 示例：原生页面流程

状态：示例，未作为当前环境的已验证执行结果。

## 输入

- 已确认的 `test` 或 `pre` 环境。
- App 安装包，或已安装 App 的包名与 Activity。
- 目标页面、业务预期和测试账号。

## 流程示例

1. 在测试计划中确认 App 包所连接的后端环境、设备或模拟器和账号权限。
2. 配置 `APPIUM_APP_PATH`，或同时配置 `APPIUM_APP_PACKAGE` 与 `APPIUM_APP_ACTIVITY`。
3. 用例确认后，使用 accessibility ID 生成 Appium/WebdriverIO 脚本。
4. 脚本确认后运行 `npm run test:app`。
5. 失败时保留截图、Appium 错误摘要、设备信息和必要的视频。

## 仍需由项目补充的信息

- APK/IPA 路径或包名与 Activity。
- 可用设备、UDID 和 Appium Driver。
- 稳定 accessibility ID、账号和业务预期。
