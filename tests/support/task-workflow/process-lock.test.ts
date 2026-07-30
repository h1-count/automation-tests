import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import {
  processLockCanBeRecovered
} from "../../../src/support/task-workflow/processLock.ts";

test("process locks recover only from ESRCH or an unverifiable timed-out owner", async () => {
  assert.equal(processLockCanBeRecovered({
    owner: `${process.pid}:live`,
    expiresAt: 0
  }, true), false);

  const exited = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const exitedPid = exited.pid;
  assert.ok(exitedPid);
  await once(exited, "exit");
  assert.equal(processLockCanBeRecovered({
    owner: `${exitedPid}:exited`,
    expiresAt: Date.now() + 60_000
  }, false), true);

  assert.equal(processLockCanBeRecovered({
    owner: "unknown",
    expiresAt: Date.now() + 60_000
  }, false), false);
  assert.equal(processLockCanBeRecovered({
    owner: "unknown",
    expiresAt: Date.now() - 1
  }, false), true);
});
