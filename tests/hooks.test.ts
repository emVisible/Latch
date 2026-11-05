import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildHookPlan, compileCursorHooks, installHooks } from "../shared/hooks.js";
import { answerSlot } from "../shared/routeRunner.js";
import { cleanup, makeRepo } from "./helpers.js";

function env(repo: string) {
  return { ...process.env, CURSOR_PROJECT_DIR: repo };
}

test("Cursor hooks are generated with failClosed and a deny decision", async () => {
  const parsed = JSON.parse(compileCursorHooks("openstrat"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.hooks.preToolUse[0].failClosed, true);
  assert.equal(parsed.hooks.beforeSubmitPrompt[0].matcher, "UserPromptSubmit");
  const repo = await makeRepo();
  try {
    const { written, warnings } = await installHooks(repo, "openstrat");
    assert.equal(warnings.length, 0);
    assert.ok(written.some((p) => p.endsWith(path.join(".git", "hooks", "pre-commit"))));
    await fs.writeFile(path.join(repo, "bad.tsx"), "const x = useEffect(() => {});\n");
    const script = path.join(repo, ".cursor", "hooks", "latch-route-prompt.sh");
    const r = spawnSync(script, [], { env: env(repo), encoding: "utf8" });
    assert.equal(r.status, 2, `${r.stdout} ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout.trim()).continue, false);
  } finally {
    await cleanup(repo);
  }
});

test("a clean repo with an answered slot is allowed through", async () => {
  const repo = await makeRepo();
  try {
    await installHooks(repo, "openstrat");
    await answerSlot("openstrat", "style-drift", "pass", repo, "worktree");
    const script = path.join(repo, ".cursor", "hooks", "latch-route-tool.sh");
    const r = spawnSync(script, [], { env: env(repo), encoding: "utf8" });
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout.trim()).permission, "allow");
  } finally {
    await cleanup(repo);
  }
});

test("git pre-commit blocks a staged discipline breach", async () => {
  const repo = await makeRepo();
  try {
    await installHooks(repo, "openstrat");
    await fs.writeFile(path.join(repo, "bad.tsx"), "const x = useEffect(() => {});\n");
    spawnSync("git", ["-C", repo, "add", "bad.tsx"], { encoding: "utf8" });
    const r = spawnSync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.email=p@l.test",
        "-c",
        "user.name=p",
        "commit",
        "-m",
        "breach",
      ],
      { env: env(repo), encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.ok(`${r.stdout}${r.stderr}`.includes("Latch"));
  } finally {
    await cleanup(repo);
  }
});

test("an existing non-Latch pre-commit hook is never overwritten", async () => {
  const repo = await makeRepo();
  try {
    const hook = path.join(repo, ".git", "hooks", "pre-commit");
    await fs.writeFile(hook, "#!/bin/sh\necho custom\n");
    const plan = await buildHookPlan(repo, "openstrat");
    assert.ok(plan.warnings.some((w) => w.includes("pre-commit")));
    assert.ok(plan.files.some((f) => f.path.endsWith("pre-commit.latch")));
    assert.ok(!plan.files.some((f) => f.path === hook));
    assert.equal(await fs.readFile(hook, "utf8"), "#!/bin/sh\necho custom\n");
  } finally {
    await cleanup(repo);
  }
});
