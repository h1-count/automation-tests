import assert from "node:assert/strict";
import test from "node:test";
import { resolveFormalRunnerAdapter } from "../../../src/support/formal-execution/runnerAdapters.js";

test("unified formal runner exposes only implemented Web and H5 adapters", () => {
  assert.deepEqual(resolveFormalRunnerAdapter("web/example/request"), {
    type: "web",
    implemented: true,
    runnerScript: "scripts/run-formal-web-tests.ts",
    runtime: "playwright"
  });
  assert.equal(resolveFormalRunnerAdapter("h5/example/request").implemented, true);
  for (const type of ["app", "api", "mqtt", "iot"]) {
    assert.equal(resolveFormalRunnerAdapter(`${type}/example/request`).implemented, false);
  }
  assert.throws(
    () => resolveFormalRunnerAdapter("desktop/example/request"),
    /Unsupported formal runner type/
  );
});
