import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readMapForRepo, resolveMap } from "../shared/map.js";
import { runRoute } from "../shared/routeRunner.js";
import { collectSnapshot, SnapshotError, writeTaskFile } from "../shared/snapshot.js";
import { repoLatch } from "../shared/paths.js";
import { cleanup, makeRepo } from "./helpers.js";

test("a sourced return without a session step is rejected", async () => {
  const repo = await makeRepo();
  try {
    const body = "hello\n";
    await fs.writeFile(path.join(repo, "shot.txt"), body);
    const sha = crypto.createHash("sha256").update(body).digest("hex");
    await writeTaskFile(repo, {
      intent: "报一个数",
      durability: "once",
      writable: ["shot.txt"],
      returns: [{ fact: "hello", path: "shot.txt", sha256: sha }],
    });
    const missing = await runRoute("task", repo, { window: "worktree" });
    assert.equal(missing.exitCode, 1, missing.log.join("\n"));
    assert.equal(missing.linkId, "breach");
  } finally {
    await cleanup(repo);
  }
});

test("a tampered session hash makes the snapshot unavailable", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "shot.txt"), "hello\n");
    await fs.mkdir(path.join(repo, ".latch"), { recursive: true });
    await fs.writeFile(
      repoLatch(repo, "session.json"),
      `${JSON.stringify({
        target: "desk",
        steps: [{ at: "shot.txt", evidence: "shot.txt", sha256: "ab".repeat(32) }],
      })}\n`,
    );
    await assert.rejects(() => collectSnapshot(repo, "worktree"), SnapshotError);
    const result = await runRoute("task", repo, { window: "worktree" });
    assert.equal(result.exitCode, 3, result.log.join("\n"));
  } finally {
    await cleanup(repo);
  }
});

test("a repo map replaces the sample map", async () => {
  const repo = await makeRepo();
  try {
    await fs.mkdir(path.join(repo, ".latch"), { recursive: true });
    await fs.writeFile(
      repoLatch(repo, "map.json"),
      `${JSON.stringify({
        name: "local",
        entries: [
          {
            id: "only",
            aliases: ["笔记"],
            location: "LOCAL.md",
            observe: "本地",
            steps: [{ id: "read-local", kind: "read", paths: ["LOCAL.md"] }],
          },
        ],
      })}\n`,
    );
    const map = await readMapForRepo(repo, "desk");
    assert.equal(map.name, "local");
    assert.equal(resolveMap(map, "笔记").entryIds[0], "only");
    assert.equal(resolveMap(map, "图表").state, "miss");
  } finally {
    await cleanup(repo);
  }
});
