import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InitError, initRepo } from "../shared/init.js";
import { cleanup, makeRepo } from "./helpers.js";

test("init writes policy once, keeps AGENTS.md, and registers the repo", async () => {
  const repo = await makeRepo();
  const settings = path.join(os.tmpdir(), `latch-settings-${path.basename(repo)}.json`);
  const agentsBefore = await fs.readFile(path.join(repo, "AGENTS.md"), "utf8");
  try {
    const first = await initRepo(repo, { settingsPath: settings, moduleConstCase: "camel" });
    assert.equal(first.wrotePolicy, true);
    assert.equal(first.wroteAgents, false);
    assert.equal(first.targetCreated, true);
    assert.equal(first.target.skillDir, ".agents/skills");
    const policy = JSON.parse(await fs.readFile(path.join(repo, "latch.policy.json"), "utf8"));
    assert.equal(policy.changeDiscipline.moduleConstCase, "camel");
    assert.equal(await fs.readFile(path.join(repo, "AGENTS.md"), "utf8"), agentsBefore);

    const second = await initRepo(repo, { settingsPath: settings });
    assert.equal(second.wrotePolicy, false);
    assert.equal(second.targetCreated, false);
    const saved = JSON.parse(await fs.readFile(settings, "utf8"));
    assert.equal(saved.targets.length, 1);
    assert.ok(first.lines.some((line) => line.includes("task open")));
    assert.equal(first.lines.join("\n").includes("npm run latch"), false);
  } finally {
    await fs.rm(settings, { force: true });
    await cleanup(repo);
  }
});

test("init refuses a non-git directory and a broken policy", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "latch-not-git-"));
  const settings = path.join(dir, "settings.json");
  try {
    await assert.rejects(() => initRepo(dir, { settingsPath: settings }), InitError);
    const repo = await makeRepo();
    try {
      await fs.writeFile(path.join(repo, "latch.policy.json"), "{");
      await assert.rejects(() => initRepo(repo, { settingsPath: settings }), /JSON/);
    } finally {
      await cleanup(repo);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
