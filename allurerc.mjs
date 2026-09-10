// 每次运行由 run-fast-tests 注入按请求标识隔离的本地历史文件。
// 完整报告只写入 artifacts/current/<report-id>/，历史仅保留 Allure 的紧凑 JSONL 数据。
export default {
  historyPath: process.env.ALLURE_HISTORY_PATH
};
