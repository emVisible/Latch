import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { draftExam } from "../shared/examDraft.js";
import { authoringSplitIssue } from "../shared/examSplit.js";
import { LATCH_ROOT } from "../shared/paths.js";
import { endSession } from "../shared/session.js";
import { runRoute } from "../shared/routeRunner.js";
import { cleanup, makeRepo } from "./helpers.js";

test("an exam draft does not consult the atom registry", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "shared/examDraft.ts"), "utf8");
  assert.equal(source.includes("atoms.js"), false);
  assert.equal(source.includes("SKILL.md"), false);
  const repo = await makeRepo();
  try {
    const text = await draftExam("diff-use-effect", repo);
    assert.match(text, /"role": "trap"/);
  } finally {
    await cleanup(repo);
  }
});

test("the shipped exam and atom share one commit, so that pair cannot promote", () => {
  const issue = authoringSplitIssue(
    path.join(LATCH_ROOT, "library/cards/diff-use-effect/exam.json"),
  );
  assert.match(issue ?? "", /同一次提交/);
});

test("a session lease blocks the next route until the session ends", async () => {
  const repo = await makeRepo();
  try {
    const first = await runRoute("task", repo, { window: "worktree", session: "sess-a" });
    assert.equal(first.exitCode, 1, first.log.join("\n"));
    const second = await runRoute("task", repo, { window: "worktree" });
    assert.match(second.log.join("\n"), /租约/);
    await endSession(repo);
    const third = await runRoute("task", repo, { window: "worktree" });
    assert.equal(third.log.some((line) => line.includes("租约")), false);
  } finally {
    await cleanup(repo);
  }
});
