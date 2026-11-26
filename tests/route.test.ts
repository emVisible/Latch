import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readJournal, verifyChain } from "../shared/journal.js";
import {
  answerSlot,
  explainRoute,
  runRoute,
} from "../shared/routeRunner.js";
import { writeResolution } from "../shared/map.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { cleanup, coverSession, fixtureWindow, makeRepo, writePolicy } from "./helpers.js";

const ROUTE = "change-discipline";

test("clean fixture waits for the slot, then passes once answered", async () => {
  const repo = await makeRepo();
  try {
    const window = fixtureWindow("clean");
    const first = await runRoute(ROUTE, repo, { window });
    assert.equal(first.exitCode, 5, first.log.join("\n"));
    assert.equal(first.status, "awaiting-slot");
    assert.equal(first.pendingSlot, "style-drift");
    assert.ok(first.log.some((l) => l.includes("--window")));

    const answer = await answerSlot(ROUTE, "style-drift", "pass", repo, window);
    assert.equal(answer.ok, true);

    const second = await runRoute(ROUTE, repo, { window });
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
    const result = await runRoute(ROUTE, repo, { window: fixtureWindow("breach") });
    assert.equal(result.exitCode, 1, result.log.join("\n"));
    assert.equal(result.status, "blocked");
    assert.equal(result.linkId, "stop-discipline");
    assert.ok(!result.log.some((l) => l.includes("ok assert")));
    assert.deepEqual(result.journal.runResults, {});
  } finally {
    await cleanup(repo);
  }
});

test("no policy blocks the explicit route; no changes pass without a slot", async () => {
  const repo = await makeRepo();
  try {
    const missing = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(missing.exitCode, 1, missing.log.join("\n"));
    assert.equal(missing.linkId, "inactive");
    assert.ok(missing.log.some((l) => l.includes("未配置或未启用")));
    assert.ok(missing.log.some((l) => l.includes("init --cwd")));

    await writePolicy(repo, {
      version: 1,
      changeDiscipline: { enabled: false },
    });
    const disabled = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(disabled.exitCode, 1, disabled.log.join("\n"));
    assert.equal(disabled.linkId, "inactive");

    await writePolicy(repo);
    execFileSync("git", ["-C", repo, "add", "latch.policy.json"]);
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.email=p@l.test", "-c", "user.name=p", "commit", "-qm", "policy"],
      { stdio: "ignore" },
    );
    const quiet = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(quiet.exitCode, 0, quiet.log.join("\n"));
    assert.equal(quiet.linkId, "no-changes");
    assert.equal(quiet.pendingSlot, undefined);
  } finally {
    await cleanup(repo);
  }
});

test("changing the snapshot invalidates a previously answered slot", async () => {
  const repo = await makeRepo();
  try {
    const clean = fixtureWindow("clean");
    await answerSlot(ROUTE, "style-drift", "pass", repo, clean);
    const passed = await runRoute(ROUTE, repo, { window: clean });
    assert.equal(passed.exitCode, 0);

    const changed = await runRoute(ROUTE, repo, {
      window: fixtureWindow("scoped"),
    });
    assert.equal(changed.exitCode, 1, changed.log.join("\n"));
    assert.equal(changed.linkId, "stop-discipline");
    assert.ok(changed.log.some((l) => l.includes("回执作废")));
    assert.deepEqual(changed.journal.slotAnswers, {});
  } finally {
    await cleanup(repo);
  }
});

test("worktree snapshot changes when a file changes, forcing a new slot answer", async () => {
  const repo = await makeRepo();
  try {
    await writePolicy(repo);
    await fs.writeFile(path.join(repo, "note.ts"), "// note\n");
    await answerSlot(ROUTE, "style-drift", "pass", repo, "worktree");
    const first = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(first.exitCode, 0, first.log.join("\n"));

    await fs.writeFile(path.join(repo, "AGENTS.md"), "# Rules\nKeep it cleaner.\n");
    const second = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(second.exitCode, 5, second.log.join("\n"));
  } finally {
    await cleanup(repo);
  }
});

test("changing policy invalidates a previously answered slot", async () => {
  const repo = await makeRepo();
  try {
    await writePolicy(repo);
    await fs.writeFile(path.join(repo, "note.ts"), "// note\n");
    await answerSlot(ROUTE, "style-drift", "pass", repo, "worktree");
    const passed = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(passed.exitCode, 0, passed.log.join("\n"));

    await writePolicy(repo, {
      version: 1,
      changeDiscipline: { enabled: true, moduleConstCase: "camel" },
    });
    const changed = await runRoute(ROUTE, repo, { window: "worktree" });
    assert.equal(changed.exitCode, 5, changed.log.join("\n"));
    assert.ok(changed.log.some((l) => l.includes("回执作废")));
  } finally {
    await cleanup(repo);
  }
});

test("a fail answer blocks the route", async () => {
  const repo = await makeRepo();
  try {
    const window = fixtureWindow("clean");
    await answerSlot(ROUTE, "style-drift", "fail", repo, window);
    const result = await runRoute(ROUTE, repo, { window });
    assert.equal(result.exitCode, 1);
    assert.equal(result.linkId, "slot-failed");
  } finally {
    await cleanup(repo);
  }
});

test("print mode compiles without executing or writing a journal", async () => {
  const repo = await makeRepo();
  try {
    const result = await runRoute(ROUTE, repo, {
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
    const text = await explainRoute(ROUTE, repo, fixtureWindow("breach"));
    assert.ok(text.includes("diff.useEffect=1"));
    assert.ok(text.includes("disciplineBreach=1"));
    assert.ok(text.includes("stop-discipline"));
  } finally {
    await cleanup(repo);
  }
});

test("daily skips discipline without a policy and blocks a breach when enabled", async () => {
  const repo = await makeRepo();
  try {
    await writeTaskFile(repo, {
      intent: "看笔记",
      durability: "once",
      writable: ["NOTES.md", "bad.tsx", "latch.policy.json"],
      returns: [],
    });
    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    await writeResolution(repo, {
      app: "desk",
      query: "笔记",
      state: "hit",
      entryId: "notes",
      entryIds: ["notes"],
    });
    await coverSession(repo, "NOTES.md", "NOTES.md");
    const skipped = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(skipped.exitCode, 0, skipped.log.join("\n"));
    assert.equal(skipped.linkId, "done");
    assert.equal(skipped.pendingSlot, undefined);

    await writePolicy(repo);
    await fs.writeFile(path.join(repo, "bad.tsx"), "const x = useEffect(() => {});\n");
    const blocked = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(blocked.exitCode, 1, blocked.log.join("\n"));
    assert.equal(blocked.linkId, "stop-discipline");
    assert.equal(blocked.journal.runResults["change-discipline"], undefined);
  } finally {
    await cleanup(repo);
  }
});

test("daily with a harmless change waits for style-drift, then finishes the map", async () => {
  const repo = await makeRepo();
  try {
    await writePolicy(repo);
    await writeTaskFile(repo, {
      intent: "看笔记",
      durability: "once",
      writable: ["NOTES.md", "note.ts", "latch.policy.json"],
      returns: [],
    });
    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    await fs.writeFile(path.join(repo, "note.ts"), "// note\n");
    await writeResolution(repo, {
      app: "desk",
      query: "笔记",
      state: "hit",
      entryId: "notes",
      entryIds: ["notes"],
    });
    await coverSession(repo, "NOTES.md", "NOTES.md");
    const waiting = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(waiting.exitCode, 5, waiting.log.join("\n"));
    assert.equal(waiting.pendingSlot, "style-drift");
    assert.equal(waiting.log.join("\n").includes("npm run latch"), false);

    await answerSlot("daily", "style-drift", "pass", repo, "worktree");
    const done = await runRoute("daily", repo, { window: "worktree" });
    assert.equal(done.exitCode, 0, done.log.join("\n"));
    assert.equal(done.linkId, "done");
  } finally {
    await cleanup(repo);
  }
});
