import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildHookPlan, compileCursorHooks, installHooks } from "../shared/hooks.js";
import { writeResolution } from "../shared/map.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { cleanup, coverSession, makeRepo } from "./helpers.js";

function env(repo: string) {
  return { ...process.env, CURSOR_PROJECT_DIR: repo };
}

test("Cursor hooks are generated with failClosed and a deny decision", async () => {
  const parsed = JSON.parse(compileCursorHooks("daily"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.hooks.preToolUse[0].failClosed, true);
  assert.equal(parsed.hooks.beforeSubmitPrompt[0].matcher, "UserPromptSubmit");
  const repo = await makeRepo();
  try {
    const { written, warnings } = await installHooks(repo, "daily");
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

test("a daily task with no policy is allowed through", async () => {
  const repo = await makeRepo();
  try {
    await installHooks(repo, "daily");
    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    const status = execFileSync(
      "git",
      ["-C", repo, "status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8" },
    );
    const writable = status
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter((p) => p && !p.startsWith(".latch/"));
    await writeTaskFile(repo, {
      intent: "看笔记",
      durability: "once",
      writable,
      returns: [],
    });
    await writeResolution(repo, {
      app: "desk",
      query: "笔记",
      state: "hit",
      entryId: "notes",
      entryIds: ["notes"],
    });
    await coverSession(repo, "NOTES.md", "NOTES.md");
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
    await installHooks(repo, "daily");
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
    const plan = await buildHookPlan(repo, "daily");
    assert.ok(plan.warnings.some((w) => w.includes("pre-commit")));
    assert.ok(plan.files.some((f) => f.path.endsWith("pre-commit.latch")));
    assert.ok(!plan.files.some((f) => f.path === hook));
    assert.equal(await fs.readFile(hook, "utf8"), "#!/bin/sh\necho custom\n");
  } finally {
    await cleanup(repo);
  }
});
