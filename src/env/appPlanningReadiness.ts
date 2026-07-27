export interface AppPlanningReadinessInput {
  selectedStaticAsset: boolean;
  appPath?: string;
  appPackage?: string;
  appActivity?: string;
  appPathExists?: boolean;
}

export interface AppPlanningReadiness {
  status: "ready" | "engineering-pending" | "not-applicable";
  detail: string;
}

export function evaluateAppPlanningReadiness(input: AppPlanningReadinessInput): AppPlanningReadiness {
  const hasAnyConfiguredTarget = Boolean(input.appPath || input.appPackage || input.appActivity);
  if (!hasAnyConfiguredTarget) {
    return input.selectedStaticAsset
      ? { status: "engineering-pending", detail: "静态 App 包已选择；Appium、设备、包名和启动 Activity 留待工程设计验证。" }
      : { status: "not-applicable", detail: "未配置 App 目标；当前不检查 Appium 与设备。" };
  }
  if (input.appPath && (input.appPackage || input.appActivity)) {
    return { status: "engineering-pending", detail: "App 目标配置互斥；工程设计前必须只保留安装包路径或包名与 Activity。" };
  }
  if (!input.appPath && (!input.appPackage || !input.appActivity)) {
    return { status: "engineering-pending", detail: "已开始配置已安装 App，但缺少包名或启动 Activity。" };
  }
  if (input.appPath && input.appPathExists === false) {
    return { status: "engineering-pending", detail: "APPIUM_APP_PATH 指向的安装包不存在。" };
  }
  return { status: "ready", detail: "App 目标配置完整；Appium Server 与设备连通性仍需在已确认 App 测试前检查。" };
}
