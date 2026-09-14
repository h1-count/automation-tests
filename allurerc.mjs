// 每次运行由 run-fast-tests 注入历史文件和展示名称。
// 请求级报告与共享首页共用生成配置，但标题必须能区分“单次请求”和“最近五个请求”的首页。
export default {
  name: process.env.ALLURE_REPORT_NAME ?? "开放平台自动化测试报告",
  historyPath: process.env.ALLURE_HISTORY_PATH,
  appendHistory: process.env.ALLURE_APPEND_HISTORY !== "false",
  plugins: {
    awesome: {
      options: {
        reportName: process.env.ALLURE_REPORT_NAME ?? "开放平台自动化测试报告"
      }
    }
  }
};
