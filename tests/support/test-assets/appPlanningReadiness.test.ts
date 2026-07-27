import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppPlanningReadiness } from "../../../src/env/appPlanningReadiness.js";

test("selected APK with no Appium configuration remains an engineering prerequisite", () => {
  const readiness = evaluateAppPlanningReadiness({ selectedStaticAsset: true });
  assert.equal(readiness.status, "engineering-pending");
  assert.match(readiness.detail, /静态 App 包已选择/);
});

test("a complete app target is ready for later engineering validation", () => {
  const readiness = evaluateAppPlanningReadiness({ selectedStaticAsset: true, appPath: "/tmp/demo.apk", appPathExists: true });
  assert.equal(readiness.status, "ready");
});

test("invalid Appium target configuration is an engineering-pending plan result", () => {
  const readiness = evaluateAppPlanningReadiness({ selectedStaticAsset: true, appPackage: "com.example.demo" });
  assert.equal(readiness.status, "engineering-pending");
  assert.match(readiness.detail, /缺少包名或启动 Activity/);
});
