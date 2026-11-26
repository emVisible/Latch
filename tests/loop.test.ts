import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { atomReachableOnDaily, cardProblems, examCard, noteSightings, promoteCard } from "../shared/card.js";
import { runDoctor } from "../shared/doctor.js";
import { captureNaive } from "../shared/naive.js";
import { readMap, resolveMap, writeResolution } from "../shared/map.js";
import { acquireLease } from "../shared/lease.js";
import { readJournal } from "../shared/journal.js";
import { CARDS_DIR, repoLatch } from "../shared/paths.js";
import { answerSlot, checkRoute, runRoute } from "../shared/routeRunner.js";
import { runStepList } from "../shared/runner.js";
import { collectSnapshot, writeTaskFile } from "../shared/snapshot.js";
import { cleanup, coverSession, makeRepo, writePolicy } from "./helpers.js";

const PANEL = "export const panel = 1;\n";
const PANEL_SHA = "62a62c8a3952f92dfb70c5566330d1d1871e5428599e35d01fe09be8dd4613b5";

async function copyCard(name: string, root: string): Promise<void> {
  await fs.cp(path.join(CARDS_DIR, name), path.join(root, name), { recursive: true });
}

async function readPanel(repo: string): Promise<void> {
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(path.join(repo, "src", "panel.tsx"), PANEL);
  const result = await runStepList(
    "map-follow",
    [{ id: "read-panel", kind: "read", paths: ["src/panel.tsx"] }],
    repo,
  );
  assert.equal(result.ok, true, result.log.join("\n"));
  assert.equal(result.reads[0]?.sha256, PANEL_SHA, JSON.stringify(result.reads));
}

test("task route stops without a task file", async () => {
  const repo = await makeRepo();
  try {
    const result = await runRoute("task", repo, { window: "worktree" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.linkId, "absent");
  } finally {
    await cleanup(repo);
  }
});

test("task route rejects an unsourced return, a bad hash, and an undeclared write", async () => {
  const repo = await makeRepo();
  try {
    await writeTaskFile(repo, {
      intent: "报一个数",
      durability: "once",
      writable: [],
      returns: [{ fact: "刻度是 12" }],
    });
    const unsourced = await runRoute("task", repo, { window: "worktree" });
    assert.equal(unsourced.exitCode, 1);
    assert.equal(unsourced.linkId, "breach");

    const file = path.join(repo, "shot.txt");
    await fs.writeFile(file, "hello\n");
    const sha = crypto.createHash("sha256").update("hello\n").digest("hex");
    await writeTaskFile(repo, {
      intent: "报一个数",
      durability: "once",
      writable: [],
      returns: [{ fact: "hello", path: "shot.txt", sha256: "a".repeat(64) }],
    });
    const bad = await runRoute("task", repo, { window: "worktree" });
    assert.equal(bad.exitCode, 1, bad.log.join("\n"));
    assert.equal(bad.linkId, "breach");

    await writeTaskFile(repo, {
      intent: "报一个数",
      durability: "lasting",
      writable: [],
      returns: [{ fact: "hello", path: "shot.txt", sha256: sha }],
    });
    const undeclared = await runRoute("task", repo, { window: "worktree" });
    assert.equal(undeclared.exitCode, 1);
    assert.equal(undeclared.linkId, "breach");

    await writeTaskFile(repo, {
      intent: "报一个数",
      durability: "lasting",
      writable: ["shot.txt"],
      returns: [{ fact: "hello", path: "shot.txt", sha256: sha }],
    });
    await coverSession(repo, "shot.txt", "shot.txt");
    const clean = await runRoute("task", repo, { window: "worktree" });
    assert.equal(clean.exitCode, 0, clean.log.join("\n"));
    assert.equal(clean.linkId, "clean");
  } finally {
    await cleanup(repo);
  }
});

test("evidence window resolves a file hash and ignores the evidence path as a write", async () => {
  const repo = await makeRepo();
  try {
    const dir = path.join(repo, "evidence");
    await fs.mkdir(dir);
    const body = "frame\n";
    await fs.writeFile(path.join(dir, "shot.txt"), body);
    const sha = crypto.createHash("sha256").update(body).digest("hex");
    await writeTaskFile(repo, {
      intent: "看截屏",
      durability: "once",
      writable: [],
      returns: [{ fact: "有一帧", path: "shot.txt", sha256: sha }],
    });
    await coverSession(repo, "evidence", "evidence/shot.txt");
    const ok = await runRoute("task", repo, { window: `evidence:${dir}` });
    assert.equal(ok.exitCode, 0, ok.log.join("\n"));
    const snap = await collectSnapshot(repo, `evidence:${dir}`);
    assert.ok(snap.evidence.some((item) => item.path === "shot.txt" && item.sha256 === sha));
    assert.ok(!snap.changedPaths.includes("shot.txt"));
  } finally {
    await cleanup(repo);
  }
});

test("map resolves hit, miss, and ambiguity without rewriting the map", async () => {
  const repo = await makeRepo();
  try {
    const mapPath = path.join(process.cwd(), "library", "maps", "desk", "map.json");
    const before = await fs.readFile(mapPath, "utf8");
    const map = await readMap("desk");
    assert.equal(resolveMap(map, "打开图表").state, "hit");
    assert.deepEqual(resolveMap(map, "打开图表").entryIds, ["charts"]);
    assert.equal(resolveMap(map, "没有这个功能").state, "miss");
    assert.equal(resolveMap(map, "数据").state, "ambiguous");

    await writeResolution(repo, {
      app: "desk",
      query: "没有这个功能",
      state: "miss",
      entryId: null,
      entryIds: [],
    });
    const candidates = JSON.parse(await fs.readFile(repoLatch(repo, "map-candidates.json"), "utf8"));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].state, "miss");
    assert.equal(await fs.readFile(mapPath, "utf8"), before);

    const missed = await runRoute("desk", repo, { window: "worktree" });
    assert.equal(missed.exitCode, 1);
    assert.equal(missed.linkId, "miss");
    assert.equal(missed.journal.payload.map?.state, "miss");
  } finally {
    await cleanup(repo);
  }
});

test("a unique map hit runs that entry's steps in order", async () => {
  const repo = await makeRepo();
  try {
    await writeResolution(repo, {
      app: "desk",
      query: "笔记",
      state: "hit",
      entryId: "notes",
      entryIds: ["notes"],
    });
    const missing = await runRoute("desk", repo, { window: "worktree" });
    assert.equal(missing.exitCode, 1, missing.log.join("\n"));
    assert.equal(missing.linkId, "follow-failed");

    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    const hit = await runRoute("desk", repo, { window: "worktree" });
    assert.equal(hit.exitCode, 0, hit.log.join("\n"));
    assert.equal(hit.linkId, "done");
    assert.equal(hit.journal.payload.map?.entryId, "notes");
    const journal = await readJournal(repo);
    assert.equal(journal?.reads.some((item) => item.path === "NOTES.md"), true);
  } finally {
    await cleanup(repo);
  }
});

test("task, desk, daily, and card-gate routes compile", async () => {
  const task = await checkRoute("task");
  assert.equal(task.report.ok, true, task.report.issues.map((i) => i.message).join("\n"));
  assert.equal(task.report.stages.entry.feasible, 9);
  const desk = await checkRoute("desk");
  assert.equal(desk.report.ok, true, desk.report.issues.map((i) => i.message).join("\n"));
  assert.equal(desk.report.stages.entry.feasible, 4);
  const daily = await checkRoute("daily");
  assert.equal(daily.report.ok, true, daily.report.issues.map((i) => i.message).join("\n"));
    assert.equal(daily.report.stages.entry.feasible, 9);
    assert.equal(daily.report.stages.discipline.feasible, 38);
    assert.equal(daily.report.stages["after-discipline"].feasible, 6);
    assert.equal(daily.report.stages.map.feasible, 8);
  const gate = await checkRoute("card-gate");
  assert.equal(gate.report.ok, true, gate.report.issues.map((i) => i.message).join("\n"));
});

async function breach(repo: string, file: string): Promise<void> {
  await writePolicy(repo);
  await fs.writeFile(path.join(repo, file), "const x = useEffect(() => {});\n");
  const result = await runRoute("change-discipline", repo, { window: "worktree" });
  assert.equal(result.exitCode, 1, result.log.join("\n"));
}

test("daily runs the contract before the map", async () => {
  const repo = await makeRepo();
  try {
    const absent = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(absent.exitCode, 1);
    assert.equal(absent.linkId, "absent");
    assert.ok(absent.log.some((line) => line.includes("task open")));
    assert.equal(absent.log.join("\n").includes("npm run latch"), false);

    await writeTaskFile(repo, {
      intent: "看笔记",
      durability: "once",
      writable: ["NOTES.md"],
      returns: [],
    });
    const missed = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(missed.exitCode, 1, missed.log.join("\n"));
    assert.equal(missed.linkId, "miss");

    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    await writeResolution(repo, {
      app: "desk",
      query: "笔记",
      state: "hit",
      entryId: "notes",
      entryIds: ["notes"],
    });
    await coverSession(repo, "NOTES.md", "NOTES.md");
    const done = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(done.exitCode, 0, done.log.join("\n"));
    assert.equal(done.linkId, "done");
  } finally {
    await cleanup(repo);
  }
});

test("exam counts distinct snapshots, then requires a read receipt", async () => {
  const repo = await makeRepo();
  try {
    const early = await examCard("diff-use-effect", repo);
    assert.equal(early.exitCode, 1);
    assert.match(early.message, /不同快照/);

    await breach(repo, "a.tsx");
    await breach(repo, "b.tsx");
    const unread = await examCard("diff-use-effect", repo);
    assert.equal(unread.exitCode, 1, unread.message);
    assert.match(unread.message, /读回执/);

    await readPanel(repo);
    await captureNaive(repo, "diff-use-effect", "src/panel.tsx");
    await captureNaive(repo, "naive-use-effect", "src/panel.tsx");
    const passed = await examCard("diff-use-effect", repo);
    assert.equal(passed.exitCode, 0, passed.message);
    const still = JSON.parse(
      await fs.readFile(path.join(CARDS_DIR, "diff-use-effect", "card.json"), "utf8"),
    );
    assert.equal(still.status, "candidate");

    const trap = await examCard("naive-use-effect", repo);
    assert.equal(trap.exitCode, 1, trap.message);
    assert.match(trap.message, /trap/);
  } finally {
    await cleanup(repo);
  }
});

test("the other discipline cards pass their exams once sighted", async () => {
  const repo = await makeRepo();
  try {
    await readPanel(repo);
    for (const name of ["diff-tab-keepalive", "diff-early-return", "diff-module-const"]) {
      await captureNaive(repo, name, "src/panel.tsx");
    }
    for (const atom of ["diff.tabKeepalive", "diff.earlyReturnToTernary", "diff.moduleConstCase"]) {
      await noteSightings(repo, { [atom]: true }, `${atom}-1`);
      await noteSightings(repo, { [atom]: true }, `${atom}-2`);
    }
    for (const name of ["diff-tab-keepalive", "diff-early-return", "diff-module-const"]) {
      const result = await examCard(name, repo);
      assert.equal(result.exitCode, 0, result.message);
    }
  } finally {
    await cleanup(repo);
  }
});

test("once and an unbound slot cannot latch; a bound slot can, until the snapshot moves", async () => {
  const repo = await makeRepo();
  const root = await fs.mkdtemp(path.join(repo, "cards-"));
  try {
    await readPanel(repo);
    await captureNaive(repo, "diff-use-effect", "src/panel.tsx");
    await copyCard("diff-use-effect", root);
    const cardPath = path.join(root, "diff-use-effect", "card.json");
    const once = JSON.parse(await fs.readFile(cardPath, "utf8"));
    once.durability = "once";
    await fs.writeFile(cardPath, JSON.stringify(once));
    const refused = await examCard("diff-use-effect", repo, root);
    assert.equal(refused.exitCode, 1);
    assert.match(refused.message, /一次性/);

    once.durability = "lasting";
    await fs.writeFile(cardPath, JSON.stringify(once));
    await breach(repo, "a.tsx");
    const early = await promoteCard("diff-use-effect", repo, root);
    assert.equal(early.exitCode, 1);
    assert.match(early.message, /不同快照/);

    const foreign = await answerSlot("task", "card-promote", "pass", repo, "worktree");
    assert.equal(foreign.ok, false);

    const bound = await answerSlot("card-gate", "card-promote", "pass", repo, "worktree");
    assert.equal(bound.ok, true, bound.message);
    const slotted = await promoteCard("diff-use-effect", repo, root);
    assert.equal(slotted.exitCode, 0, slotted.message);
    const latched = JSON.parse(await fs.readFile(cardPath, "utf8"));
    assert.equal(latched.status, "latched");
    assert.ok(await atomReachableOnDaily("diff.useEffect"));

    latched.status = "candidate";
    await fs.writeFile(cardPath, JSON.stringify(latched));
    await fs.writeFile(path.join(repo, "moved.txt"), "x\n");
    const moved = await promoteCard("diff-use-effect", repo, root);
    assert.equal(moved.exitCode, 1, moved.message);
    assert.match(moved.message, /不同快照/);

    const fake = { ...latched, atom: "not-in-a-route", status: "latched" };
    await fs.writeFile(cardPath, JSON.stringify(fake));
    const problems = await cardProblems("diff-use-effect", root);
    assert.ok(problems.some((item) => item.includes("不在 daily")));
  } finally {
    await cleanup(repo);
  }
});

test("doctor fails when a latched card is outside the daily scope", async () => {
  const repo = await makeRepo();
  const root = path.join(repo, "cards");
  try {
    await copyCard("diff-use-effect", root);
    const cardPath = path.join(root, "diff-use-effect", "card.json");
    const card = JSON.parse(await fs.readFile(cardPath, "utf8"));
    card.atom = "not-on-daily";
    card.status = "latched";
    await fs.writeFile(cardPath, JSON.stringify(card));
    const text = await runDoctor({ cardsRoot: root });
    assert.match(text, /!!\s+card diff-use-effect：/);
    assert.match(text, /不在 daily 走得到的 scope 里/);
    assert.equal(text.includes("npm run latch"), false);
  } finally {
    await cleanup(repo);
  }
});

test("a dead lease is recovered and a live lease blocks the second route", async () => {
  const repo = await makeRepo();
  try {
    await fs.mkdir(path.join(repo, ".latch"), { recursive: true });
    await fs.writeFile(
      repoLatch(repo, "lease.json"),
      JSON.stringify({ pid: 2147483646, snapshotHash: "", acquiredAt: "t" }),
    );
    await writePolicy(repo);
    await fs.writeFile(path.join(repo, "note.ts"), "// note\n");
    const recovered = await runRoute("change-discipline", repo, { window: "worktree" });
    assert.equal(recovered.exitCode, 5, recovered.log.join("\n"));
    assert.ok(!recovered.log.some((line) => line.includes("租约")));

    const release = await acquireLease(repo);
    const nested = path.join(repo, "nested");
    await fs.mkdir(nested);
    const blocked = await runRoute("task", nested, { window: "worktree" });
    assert.equal(blocked.exitCode, 1);
    assert.match(blocked.log.join("\n"), /租约/);
    await release();
  } finally {
    await cleanup(repo);
  }
});
