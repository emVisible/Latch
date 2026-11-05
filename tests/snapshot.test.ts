import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { collectSnapshot, snapshotFromFixture } from "../shared/snapshot.js";
import { loadAtomRegistry, evaluateAtoms } from "../shared/atoms.js";
import { cleanup, makeRepo } from "./helpers.js";

test("worktree window sees added lines in an untracked new file", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(
      path.join(repo, "newfile.tsx"),
      "const x = useEffect(() => {});\n",
    );
    const snap = await collectSnapshot(repo, "worktree");
    assert.ok(snap.added.some((l) => l.includes("+const x = useEffect")));
    assert.ok(snap.changedPaths.includes("newfile.tsx"));
    const { atoms } = await loadAtomRegistry();
    const evaluation = evaluateAtoms(Object.keys(atoms), snap, atoms);
    assert.equal(evaluation.values["diff.useEffect"], true);
  } finally {
    await cleanup(repo);
  }
});

test("staged window excludes untracked files and worktree changes", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "staged.tsx"), "const A = 1;\n");
    execFileSync("git", ["-C", repo, "add", "staged.tsx"]);
    await fs.writeFile(path.join(repo, "untracked.tsx"), "const b = useEffect(() => {});\n");
    const snap = await collectSnapshot(repo, "staged");
    assert.ok(snap.changedPaths.includes("staged.tsx"));
    assert.ok(!snap.changedPaths.includes("untracked.tsx"));
  } finally {
    await cleanup(repo);
  }
});

test("snapshot hash changes when HEAD changes even if the diff is empty", async () => {
  const repo = await makeRepo();
  try {
    const before = await collectSnapshot(repo, "worktree");
    await fs.writeFile(path.join(repo, "file.txt"), "hello\n");
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.email=p@l.test", "-c", "user.name=p", "commit", "-qm", "second"],
      { stdio: "ignore" },
    );
    const after = await collectSnapshot(repo, "worktree");
    assert.equal(before.added.length, 0);
    assert.equal(after.added.length, 0);
    assert.notEqual(before.hash, after.hash);
    const last = await collectSnapshot(repo, "last-commit");
    assert.ok(last.changedPaths.includes("file.txt"));
  } finally {
    await cleanup(repo);
  }
});

test("fixture snapshot is deterministic and window-sensitive", () => {
  const payload = { added: ["+x"], removed: [], changedPaths: ["a.tsx"] };
  const a = snapshotFromFixture(payload, "/tmp/repo", "fixture:one");
  const b = snapshotFromFixture(payload, "/tmp/repo", "fixture:one");
  const c = snapshotFromFixture(payload, "/tmp/repo", "fixture:two");
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
});
