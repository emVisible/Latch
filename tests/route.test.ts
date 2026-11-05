import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readJournal, verifyChain } from "../shared/journal.js";
import {
  answerSlot,
  explainRoute,
  runRoute,
} from "../shared/routeRunner.js";
import { cleanup, fixtureWindow, makeRepo } from "./helpers.js";

test("clean fixture waits for the slot, then passes once answered", async () => {
  const repo = await makeRepo();
  try {
    const window = fixtureWindow("clean");
    const first = await runRoute("openstrat", repo, { window });
    assert.equal(first.exitCode, 5);
    assert.equal(first.status, "awaiting-slot");
    assert.equal(first.pendingSlot, "style-drift");
    assert.ok(first.log.some((l) => l.includes("--window")));

    const answer = await answerSlot("openstrat", "style-drift", "pass", repo, window);
    assert.equal(answer.ok, true);

    const second = await runRoute("openstrat", repo, { window });
    assert.equal(second.exitCode, 0, second.log.join("\n"));
    assert.equal(second.status, "passed");
    assert.equal(second.linkId, "done");
    const journal = await readJournal(repo);
    assert.ok(journal);
    assert.equal(journal.slotAnswers["style-drift"], "pass");
    assert.equal(verifyChain(journal), true);
  } finally {
    await cleanup(repo);
  }
});

test("a discipline breach stops at entry without running any domain", async () => {
  const repo = await makeRepo();
  try {
    const result = await runRoute("openstrat", repo, { window: fixtureWindow("breach") });
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, "blocked");
    assert.equal(result.linkId, "stop-discipline");
    assert.ok(!result.log.some((l) => l.includes("ok assert")));
    assert.deepEqual(result.journal.runResults, {});
  } finally {
    await cleanup(repo);
  }
});

test("changing the snapshot invalidates a previously answered slot", async () => {
  const repo = await makeRepo();
  try {
    const clean = fixtureWindow("clean");
    await answerSlot("openstrat", "style-drift", "pass", repo, clean);
    const passed = await runRoute("openstrat", repo, { window: clean });
    assert.equal(passed.exitCode, 0);

    const changed = await runRoute("openstrat", repo, {
      window: fixtureWindow("charts"),
    });
    assert.equal(changed.exitCode, 5);
    assert.equal(changed.status, "awaiting-slot");
    assert.ok(changed.log.some((l) => l.includes("回执作废")));
    assert.deepEqual(changed.journal.slotAnswers, {});
  } finally {
    await cleanup(repo);
  }
});

test("worktree snapshot changes when a file changes, forcing a new slot answer", async () => {
  const repo = await makeRepo();
  try {
    await answerSlot("openstrat", "style-drift", "pass", repo, "worktree");
    const first = await runRoute("openstrat", repo, { window: "worktree" });
    assert.equal(first.exitCode, 0);

    await fs.writeFile(path.join(repo, "AGENTS.md"), "# Rules\nKeep it cleaner.\n");
    const second = await runRoute("openstrat", repo, { window: "worktree" });
    assert.equal(second.exitCode, 5);
  } finally {
    await cleanup(repo);
  }
});

test("a fail answer blocks the route", async () => {
  const repo = await makeRepo();
  try {
    const window = fixtureWindow("clean");
    await answerSlot("openstrat", "style-drift", "fail", repo, window);
    const result = await runRoute("openstrat", repo, { window });
    assert.equal(result.exitCode, 1);
    assert.equal(result.linkId, "slot-failed");
  } finally {
    await cleanup(repo);
  }
});

test("print mode compiles without executing or writing a journal", async () => {
  const repo = await makeRepo();
  try {
    const result = await runRoute("openstrat", repo, {
      window: fixtureWindow("clean"),
      print: true,
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.log[0].includes("--check"));
    assert.equal(await readJournal(repo), null);
  } finally {
    await cleanup(repo);
  }
});

test("explain prints atom values and the link each stage would hit", async () => {
  const repo = await makeRepo();
  try {
    const text = await explainRoute("openstrat", repo, fixtureWindow("breach"));
    assert.ok(text.includes("diff.useEffect=1"));
    assert.ok(text.includes("disciplineBreach=1"));
    assert.ok(text.includes("stop-discipline"));
  } finally {
    await cleanup(repo);
  }
});
