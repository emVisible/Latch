import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { examCard, noteSightings } from "../shared/card.js";
import { draftExam } from "../shared/examDraft.js";
import { authoringSplitIssue } from "../shared/examSplit.js";
import { LATCH_ROOT } from "../shared/paths.js";
import { endSession } from "../shared/session.js";
import { runStepList } from "../shared/runner.js";
import { runRoute } from "../shared/routeRunner.js";
import { cleanup, makeRepo } from "./helpers.js";

test("an exam draft does not consult the atom registry", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "shared/examDraft.ts"), "utf8");
  assert.equal(source.includes("atoms.js"), false);
  assert.equal(source.includes("SKILL.md"), false);
  assert.equal(source.includes("index.mjs"), false);
  assert.equal(source.includes("naive.json"), false);
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

test("grading that can read the card skill or the atom source does not pass", async () => {
  const split = await fs.readFile(path.join(LATCH_ROOT, "shared/examSplit.ts"), "utf8");
  const card = await fs.readFile(path.join(LATCH_ROOT, "shared/card.ts"), "utf8");
  assert.equal(split.includes("user.name"), false);
  assert.equal(split.includes("user.email"), false);
  assert.equal(card.includes("user.name"), false);
  const gradeStart = card.indexOf("export async function gradeExam");
  const gradeEnd = card.indexOf("export async function cardProblems");
  const grade = card.slice(gradeStart, gradeEnd);
  assert.equal(grade.includes("SKILL.md"), false);
  assert.equal(grade.includes("index.mjs"), false);
  const graded = await examCard("diff-use-effect", LATCH_ROOT);
  assert.notEqual(graded.exitCode, 0);
  assert.match(graded.message, /SKILL\.md|原子源码/);
});

test("a trap needs the recorded naive capture, not only naiveExpect", async () => {
  const repo = await makeRepo();
  try {
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "panel.tsx"), "export const panel = 1;\n");
    const read = await runStepList(
      "map-follow",
      [{ id: "read-panel", kind: "read", paths: ["src/panel.tsx"] }],
      repo,
    );
    assert.equal(read.ok, true, read.log.join("\n"));
    await noteSightings(repo, { "diff.useEffect": true }, "naive-sight-1");
    await noteSightings(repo, { "diff.useEffect": true }, "naive-sight-2");
    const graded = await examCard("diff-use-effect", repo);
    assert.notEqual(graded.exitCode, 0);
    assert.match(graded.message, /天真/);
    const raw = JSON.parse(
      await fs.readFile(path.join(LATCH_ROOT, "library/cards/diff-use-effect/card.json"), "utf8"),
    ) as { naiveExpect: boolean };
    assert.equal(typeof raw.naiveExpect, "boolean");
  } finally {
    await cleanup(repo);
  }
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
