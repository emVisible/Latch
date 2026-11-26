import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readMapForRepo, resolveMap, writeResolution } from "../shared/map.js";
import { runRoute } from "../shared/routeRunner.js";
import { addSessionStep, endSession, openSession } from "../shared/session.js";
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

test("session step rejects a checklist missing the opened target, position, observe, or evidence", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "shot.txt"), "frame\n");
    await openSession(repo, "desk");
    await assert.rejects(
      () => addSessionStep(repo, "shot.txt", "shot.txt", { target: "", position: "shot.txt", observe: "看见" }),
      /打开的目标/,
    );
    await assert.rejects(
      () => addSessionStep(repo, "shot.txt", "shot.txt", { position: "", observe: "看见" }),
      /点中的位置/,
    );
    await assert.rejects(
      () => addSessionStep(repo, "shot.txt", "shot.txt", { position: "shot.txt", observe: "" }),
      /observe/,
    );
    await assert.rejects(
      () => addSessionStep(repo, "shot.txt", "", { position: "shot.txt", observe: "看见" }),
      /evidence/,
    );
  } finally {
    await cleanup(repo);
  }
});

test("a matching session list passes and a miss on target, position, observe, or hash stays unresolved", async () => {
  const repo = await makeRepo();
  try {
    const body = "notes\n";
    await fs.writeFile(path.join(repo, "NOTES.md"), body);
    const sha = crypto.createHash("sha256").update(body).digest("hex");
    const observe = "打开笔记文件";
    await writeResolution(repo, {
      app: "desk",
      query: "笔记",
      state: "hit",
      entryId: "notes",
      entryIds: ["notes"],
    });

    async function grade(
      fields: { target: string; position: string; observe: string },
      hash = sha,
    ) {
      await endSession(repo);
      await openSession(repo, fields.target);
      await addSessionStep(repo, "NOTES.md", "NOTES.md", fields);
      await writeTaskFile(repo, {
        intent: "看笔记",
        durability: "once",
        writable: ["NOTES.md"],
        returns: [{ fact: "打开了笔记", path: "NOTES.md", sha256: hash }],
      });
      return runRoute("task", repo, { window: "worktree" });
    }

    const ok = await grade({ target: "desk", position: "NOTES.md", observe });
    assert.equal(ok.exitCode, 0, ok.log.join("\n"));
    assert.equal(ok.linkId, "clean");

    const misses = [
      ["target", { target: "other", position: "NOTES.md", observe }, sha],
      ["position", { target: "desk", position: "src/charts/", observe }, sha],
      ["observe", { target: "desk", position: "NOTES.md", observe: "没看见" }, sha],
      ["hash", { target: "desk", position: "NOTES.md", observe }, "ab".repeat(32)],
    ] as const;
    for (const [label, fields, hash] of misses) {
      const bad = await grade(fields, hash);
      assert.equal(bad.exitCode, 1, `${label}\n${bad.log.join("\n")}`);
      assert.equal(bad.linkId, "breach", label);
    }
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
