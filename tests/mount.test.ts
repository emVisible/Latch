import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MountConflictError,
  mountSkill,
  scanMounts,
  unmountSkill,
} from "../shared/mount.js";
import { SKILLS_DIR } from "../shared/paths.js";
import { cleanup, makeRepo } from "./helpers.js";

const SKILL = "hard-lock";

function target(repo: string) {
  return {
    id: "tmp",
    label: "tmp",
    path: repo,
    skillDir: ".agents/skills",
  };
}

test("mounting over a hand-placed skill directory is refused", async () => {
  const repo = await makeRepo({ agents: false });
  try {
    const dir = path.join(repo, ".agents", "skills", SKILL);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "hand written\n");
    await assert.rejects(() => mountSkill(SKILL, target(repo)), MountConflictError);
    await assert.rejects(() => unmountSkill(SKILL, target(repo)), MountConflictError);
    assert.equal(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"), "hand written\n");
  } finally {
    await cleanup(repo);
  }
});

test("a Latch-owned symlink is discovered and can be unmounted", async () => {
  const repo = await makeRepo({ agents: false });
  try {
    const dir = path.join(repo, ".agents", "skills");
    await fs.mkdir(dir, { recursive: true });
    await fs.symlink(path.join(SKILLS_DIR, SKILL), path.join(dir, SKILL), "dir");
    const [status] = await scanMounts(SKILL, [target(repo)]);
    assert.equal(status.owned, true);
    assert.equal(status.discovered, true);
    assert.equal(status.valid, true);
    await unmountSkill(SKILL, target(repo));
    await assert.rejects(fs.lstat(path.join(dir, SKILL)));
  } finally {
    await cleanup(repo);
  }
});

test("mount creates a symlink and remount replaces it safely", async () => {
  const repo = await makeRepo({ agents: false });
  try {
    const first = await mountSkill(SKILL, target(repo));
    assert.equal(first.mode, "symlink");
    const second = await mountSkill(SKILL, target(repo));
    assert.equal(second.mode, "symlink");
    const [status] = await scanMounts(SKILL, [target(repo)]);
    assert.equal(status.valid, true);
  } finally {
    await cleanup(repo);
  }
});
