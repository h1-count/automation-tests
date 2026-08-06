export const formalRunnerTypes = ["web", "h5", "app", "api", "mqtt", "iot"] as const;
export type FormalRunnerType = (typeof formalRunnerTypes)[number];

export interface FormalRunnerAdapter {
  type: FormalRunnerType;
  implemented: boolean;
  runnerScript?: string;
  runtime: string;
}

const adapters: Record<FormalRunnerType, FormalRunnerAdapter> = {
  web: {
    type: "web",
    implemented: true,
    runnerScript: "scripts/run-formal-web-tests.ts",
    runtime: "playwright"
  },
  h5: {
    type: "h5",
    implemented: true,
    runnerScript: "scripts/run-formal-web-tests.ts",
    runtime: "playwright"
  },
  app: { type: "app", implemented: false, runtime: "appium" },
  api: { type: "api", implemented: false, runtime: "typescript_api" },
  mqtt: { type: "mqtt", implemented: false, runtime: "mqtt_js" },
  iot: { type: "iot", implemented: false, runtime: "composite_iot" }
};

export function resolveFormalRunnerAdapter(requestId: string): FormalRunnerAdapter {
  const [type] = requestId.split("/");
  if (!formalRunnerTypes.includes(type as FormalRunnerType)) {
    throw new Error(`Unsupported formal runner type: ${type || "missing"}.`);
  }
  return adapters[type as FormalRunnerType];
}
