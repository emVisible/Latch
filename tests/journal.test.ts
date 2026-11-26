import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  appendEntry,
  ensureLatchGitignore,
  isJournalValid,
  journalPath,
  newJournal,
  readJournal,
  verifyChain,
  writeJournal,
} from "../shared/journal.js";
import { cleanup, makeRepo } from "./helpers.js";

const binding = {
  route: "daily",
  repo: "/tmp/repo",
  window: "worktree",
  snapshotHash: "snap1",
  routeHash: "route1",
  atomsHash: "atoms1",
};

test("journal entries form a verifiable hash chain", () => {
  const j = newJournal(binding);
  appendEntry(j, { stage: "entry", atomValues: { a: true }, linkId: "x", action: "stop" });
  appendEntry(j, { stage: "after", atomValues: { a: false }, linkId: "y", action: "stop" });
  assert.equal(j.entries.length, 2);
  assert.equal(verifyChain(j), true);
  j.entries[0].linkId = "tampered";
  assert.equal(verifyChain(j), false);
});

test("binding invalidates a journal on snapshot, route, atom or window changes", () => {
  const j = newJournal(binding);
  assert.equal(isJournalValid(j, binding), true);
  assert.equal(isJournalValid(j, { ...binding, snapshotHash: "snap2" }), false);
  assert.equal(isJournalValid(j, { ...binding, routeHash: "route2" }), false);
  assert.equal(isJournalValid(j, { ...binding, atomsHash: "atoms2" }), false);
  assert.equal(isJournalValid(j, { ...binding, window: "staged" }), false);
  assert.equal(isJournalValid(null, binding), false);
});

test("writeJournal is readable and excludes .latch/ via .git/info/exclude", async () => {
  const repo = await makeRepo({ agents: false });
  try {
    const j = newJournal({ ...binding, repo });
    appendEntry(j, { stage: "entry", atomValues: {}, linkId: "x", action: "stop" });
    await writeJournal(repo, j);
    const loaded = await readJournal(repo);
    assert.ok(loaded);
    assert.equal(loaded.entries.length, 1);
    const exclude = await fs.readFile(path.join(repo, ".git", "info", "exclude"), "utf8");
    assert.ok(exclude.includes(".latch/"));
    // The tracked .gitignore must stay untouched.
    await assert.rejects(fs.readFile(path.join(repo, ".gitignore"), "utf8"));
    await writeJournal(repo, j);
    const content = await fs.readFile(path.join(repo, ".git", "info", "exclude"), "utf8");
    assert.equal(content.split(".latch/").length - 1, 1);
    assert.ok((await fs.stat(journalPath(repo))).isFile());
  } finally {
    await cleanup(repo);
  }
});

test("ensureLatchGitignore is additive and idempotent", async () => {
  const repo = await makeRepo({ agents: false });
  try {
    const excludeFile = path.join(repo, ".git", "info", "exclude");
    await fs.writeFile(excludeFile, "custom-ignore\n");
    assert.equal(await ensureLatchGitignore(repo), true);
    const text = await fs.readFile(excludeFile, "utf8");
    assert.ok(text.includes("custom-ignore"));
    assert.ok(text.includes(".latch/"));
    assert.equal(await ensureLatchGitignore(repo), false);
  } finally {
    await cleanup(repo);
  }
});
