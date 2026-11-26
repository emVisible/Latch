import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { collectSnapshot, SnapshotError, snapshotFromFixture, writeTaskFile } from "../shared/snapshot.js";
import { loadAtomRegistry, evaluateAtoms } from "../shared/atoms.js";
import { cleanup, makeRepo, writePolicy } from "./helpers.js";

test("worktree window sees added lines in an untracked new file", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(
      path.join(repo, "newfile.tsx"),
      "const x = useEffect(() => {});\n",
    );
    const dormant = await collectSnapshot(repo, "worktree");
    const { atoms } = await loadAtomRegistry();
    assert.equal(
      evaluateAtoms(Object.keys(atoms), dormant, atoms).values["diff.useEffect"],
      false,
    );
    await writePolicy(repo);
    const snap = await collectSnapshot(repo, "worktree");
    assert.ok(snap.added.some((l) => l.includes("+const x = useEffect")));
    assert.ok(snap.changedPaths.includes("newfile.tsx"));
    const evaluation = evaluateAtoms(Object.keys(atoms), snap, atoms);
    assert.equal(evaluation.values["diff.useEffect"], true);
    assert.equal(evaluation.values["policy.active"], true);
    assert.notEqual(dormant.hash, snap.hash);
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

test("module const case follows policy and an invalid policy fails closed", async () => {
  const { atoms } = await loadAtomRegistry();
  const base = {
    added: ["+const padding = 8;", "+const PADDING_X = 8;", "+const URL = \"a\";"],
    removed: [] as string[],
    changedPaths: ["src/panel.tsx"],
  };
  const judge = (moduleConstCase: string) =>
    evaluateAtoms(["diff.moduleConstCase"], snapshotFromFixture({
      ...base,
      policy: { version: 1, changeDiscipline: { enabled: true, moduleConstCase } },
    }, "/tmp/repo"), atoms).values["diff.moduleConstCase"];
  assert.equal(judge("screaming-snake"), true);
  assert.equal(judge("camel"), true);
  assert.equal(judge("off"), false);

  const camelOnly = evaluateAtoms(
    ["diff.moduleConstCase"],
    snapshotFromFixture({
      added: ["+const padding = 8;", "+const URL = \"a\";"],
      removed: [],
      changedPaths: ["src/panel.tsx"],
      policy: { version: 1, changeDiscipline: { enabled: true, moduleConstCase: "camel" } },
    }, "/tmp/repo"),
    atoms,
  );
  assert.equal(camelOnly.values["diff.moduleConstCase"], false);

  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "latch.policy.json"), "{");
    await assert.rejects(() => collectSnapshot(repo, "worktree"), SnapshotError);
  } finally {
    await cleanup(repo);
  }
});

test("a latch task file alone is not a code change", async () => {
  const repo = await makeRepo();
  try {
    await writeTaskFile(repo, {
      intent: "只记任务",
      durability: "once",
      writable: [],
      returns: [],
    });
    const snap = await collectSnapshot(repo, "worktree");
    const { atoms } = await loadAtomRegistry();
    assert.equal(evaluateAtoms(["changes.present"], snap, atoms).values["changes.present"], false);
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
