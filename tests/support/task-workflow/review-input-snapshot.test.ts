import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  ReviewInputSnapshotStore
} from "../../../src/support/task-workflow/index.js";

test("review input identity inspection is read-only", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-inspect-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-registration.md");
  await writeFile(planPath, "# plan\n", "utf8");
  await writeFile(casesPath, "# cases\n", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const identity = await store.inspectCurrent([casesPath, planPath]);
  assert.equal(identity.artifacts.length, 2);
  assert.match(identity.combinedDigest, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(resolve(workspaceRoot, ".local")), false);
});

test("review input snapshot freezes immutable plan, case, and controlled source bytes", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-snapshot-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  const planPath = resolve(requestRoot, "plan.md");
  const casesPath = resolve(requestRoot, "cases-registration.md");
  const sourcePath = resolve(workspaceRoot, "sources/requirements/demo/requirements.md");
  const knowledgePath = resolve(workspaceRoot, "sources/knowledge-base/demo/help.pdf");
  await mkdir(resolve(sourcePath, ".."), { recursive: true });
  await mkdir(resolve(knowledgePath, ".."), { recursive: true });
  await writeFile(planPath, "# plan v1\n", "utf8");
  await writeFile(casesPath, "# cases v1\n", "utf8");
  await writeFile(sourcePath, "# source v1\n", "utf8");
  await writeFile(knowledgePath, "controlled knowledge bytes", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const frozen = await store.freeze("REV-DEMO-01", [casesPath, planPath, sourcePath, knowledgePath]);
  assert.equal(frozen.artifacts.length, 4);
  assert.match(frozen.combinedDigest, /^[a-f0-9]{64}$/);
  assert.ok(frozen.artifacts.every((artifact) =>
    artifact.snapshotPath.includes(".local/test-task-runtime/")
  ));

  await writeFile(planPath, "# plan v2\n", "utf8");
  const verified = await store.verify("REV-DEMO-01");
  assert.equal(verified.combinedDigest, frozen.combinedDigest);
  const snapshotPlan = verified.artifacts.find((artifact) => artifact.sourcePath.endsWith("/plan.md"));
  assert.equal(await readFile(snapshotPlan!.snapshotPath, "utf8"), "# plan v1\n");
  await assert.rejects(
    store.verifyCurrentSources("REV-DEMO-01"),
    /input drifted/
  );
  await assert.rejects(
    store.freeze("REV-DEMO-01", [casesPath, planPath, sourcePath, knowledgePath]),
    /already exists with another input digest/
  );
});

test("review input snapshots share content blobs without coupling batch lifecycle", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-snapshot-dedup-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  const planPath = resolve(requestRoot, "plan.md");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(planPath, "# shared plan\n", "utf8");

  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });
  const first = await store.freeze("REV-DEMO-01", [planPath]);
  const second = await store.freeze("REV-DEMO-02", [planPath]);
  const digest = first.artifacts[0]!.digest;
  const blobDirectory = resolve(
    workspaceRoot,
    ".local/test-task-runtime/review-input-blobs/sha256",
    digest.slice(0, 2)
  );
  assert.deepEqual(await readdir(blobDirectory), [digest]);

  const firstStat = await stat(first.artifacts[0]!.snapshotPath);
  const secondStat = await stat(second.artifacts[0]!.snapshotPath);
  const blobStat = await stat(resolve(blobDirectory, digest));
  if (blobStat.ino !== 0 && blobStat.nlink > 1) {
    assert.equal(firstStat.ino, blobStat.ino);
    assert.equal(secondStat.ino, blobStat.ino);
  }

  await rm(resolve(first.artifacts[0]!.snapshotPath, ".."), { recursive: true, force: true });
  assert.equal((await store.verify("REV-DEMO-02")).combinedDigest, second.combinedDigest);

  await store.repair("REV-DEMO-01", [planPath]);
  assert.equal((await store.verify("REV-DEMO-02")).combinedDigest, second.combinedDigest);
  assert.deepEqual(await readdir(blobDirectory), [digest]);
});

test("review input snapshot rejects paths outside the request and detects corruption", async (context) => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "review-input-snapshot-safe-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const requestId = "web/demo/registration";
  const requestRoot = resolve(workspaceRoot, "testcases/web/demo/registration");
  await mkdir(requestRoot, { recursive: true });
  await writeFile(resolve(requestRoot, "plan.md"), "# plan\n", "utf8");
  await writeFile(resolve(workspaceRoot, "outside.md"), "# outside\n", "utf8");
  const store = new ReviewInputSnapshotStore(requestId, { workspaceRoot });

  await assert.rejects(
    store.freeze("REV-DEMO-01", [resolve(workspaceRoot, "outside.md")]),
    /Reviewer input must be/
  );
  const frozen = await store.freeze("REV-DEMO-01", [resolve(requestRoot, "plan.md")]);
  await writeFile(frozen.artifacts[0]!.snapshotPath, "# tampered\n", "utf8");
  await assert.rejects(store.verify("REV-DEMO-01"), /is corrupt/);
});
