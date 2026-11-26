import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initRepo } from "../shared/init.js";
import { repoLatch } from "../shared/paths.js";
import { validateSettings } from "../shared/schema.js";
import { cleanup, makeRepo } from "./helpers.js";

const CLI = path.join(process.cwd(), "cli/run.ts");
const TSX = path.join(process.cwd(), "node_modules/tsx/dist/loader.mjs");

function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.NO_COLOR;
  delete next.FORCE_COLOR;
  return next;
}

function commitAll(repo: string) {
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.email=probe@latch.test", "-c", "user.name=latch", "commit", "-qm", "latch init"],
    { stdio: "ignore" },
  );
}

function runCli(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", TSX, CLI, ...args],
      { cwd, env: childEnv(env) },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

async function isolatedSettings(): Promise<{
  dir: string;
  file: string;
  env: NodeJS.ProcessEnv;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "latch-settings-"));
  const file = path.join(dir, "settings.json");
  await fs.writeFile(file, `${JSON.stringify({ targets: [] }, null, 2)}\n`);
  return { dir, file, env: { ...process.env, LATCH_SETTINGS: file } };
}

function nextLine(stdout: string): string {
  const line = stdout.split("\n").find((item) => item.startsWith("下一步："));
  assert.ok(line, stdout);
  return line;
}

test("settings current must be an absolute path when present", () => {
  assert.deepEqual(validateSettings({ targets: [] }), []);
  assert.deepEqual(validateSettings({ targets: [], current: "/tmp/latch-repo" }), []);
  assert.ok(validateSettings({ targets: [], current: "repo" }).length > 0);
});

test("latch in an inited repo asks for a task, then advances", async () => {
  const repo = await makeRepo();
  const settings = await isolatedSettings();
  try {
    await initRepo(repo, { settingsPath: settings.file });
    commitAll(repo);
    const first = await runCli(repo, [], settings.env);
    assert.equal(first.code, 1, `${first.stderr}\n${first.stdout}`);
    const lines = first.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    assert.ok(path.isAbsolute(lines[0]));
    assert.match(lines[0], new RegExp(path.basename(repo)));
    assert.match(lines[1], /没有合法任务/);
    const asked = nextLine(first.stdout);
    assert.match(asked, /latch task/);
    assert.equal(asked.includes("--cwd"), false);

    const refused = await runCli(
      repo,
      ["task", "看笔记", "--once", "--sha256", "ab".repeat(32)],
      settings.env,
    );
    assert.equal(refused.code, 2, refused.stderr);
    await assert.rejects(fs.access(repoLatch(repo, "task.json")));

    const opened = await runCli(repo, ["task", "看笔记", "--once"], settings.env);
    assert.equal(opened.code, 0, opened.stderr);
    const task = JSON.parse(await fs.readFile(repoLatch(repo, "task.json"), "utf8")) as {
      intent: string;
      durability: string;
      returns: { sha256?: string }[];
    };
    assert.equal(task.intent, "看笔记");
    assert.equal(task.durability, "once");
    assert.equal(task.returns.some((item) => item.sha256), false);

    const second = await runCli(repo, [], settings.env);
    assert.equal(second.code, 1, `${second.stderr}\n${second.stdout}`);
    assert.equal(second.stdout.includes("没有合法任务"), false);
    assert.equal(nextLine(second.stdout), "下一步：latch map add");
    const map = JSON.parse(await fs.readFile(repoLatch(repo, "map.json"), "utf8")) as {
      entries: unknown[];
    };
    assert.equal(map.entries.length, 0);

    const daily = await runCli(repo, ["daily"], settings.env);
    assert.match(daily.stdout, /退出码/);
    assert.ok([0, 1, 2, 3, 4, 5].includes(daily.code), daily.stderr);
  } finally {
    await fs.rm(settings.dir, { recursive: true, force: true });
    await cleanup(repo);
  }
});

test("latch use is what a command outside any repo uses", async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "latch-outside-"));
  const repo = await makeRepo();
  const plain = await makeRepo();
  const settings = await isolatedSettings();
  try {
    await initRepo(repo, { settingsPath: settings.file });
    const missing = await runCli(outside, ["next"], settings.env);
    assert.equal(missing.code, 2, missing.stdout);
    assert.deepEqual(missing.stderr.trim().split("\n"), [
      "先运行 latch use <path>，或这次加上 --cwd",
    ]);

    const unmarked = await runCli(plain, ["task", "看笔记", "--once"], settings.env);
    assert.equal(unmarked.code, 2, unmarked.stdout);
    assert.match(unmarked.stderr, /latch use <path>/);
    assert.match(unmarked.stderr, /--cwd/);
    assert.equal(unmarked.stderr.trim().split("\n").length, 1);

    const used = await runCli(outside, ["use", repo], settings.env);
    assert.equal(used.code, 0, used.stderr);
    const saved = JSON.parse(await fs.readFile(settings.file, "utf8")) as {
      current?: string;
      targets: unknown[];
    };
    assert.equal(saved.current, await fs.realpath(repo));
    assert.equal(path.isAbsolute(saved.current), true);
    assert.equal(saved.targets.length, 1);

    const next = await runCli(outside, ["next", "--json"], settings.env);
    assert.equal(next.code, 1, next.stderr);
    const json = JSON.parse(next.stdout.split("\n")[0]) as { action: string; next: string };
    assert.equal(json.action, "ask-durability");
    assert.match(nextLine(next.stdout), /latch task/);
    assert.equal(json.next.includes("--cwd"), false);
  } finally {
    await fs.rm(settings.dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
    await cleanup(repo);
    await cleanup(plain);
  }
});

test("latch help prints the repo flow and bare latch without a repo prints it", async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "latch-outside-"));
  const settings = await isolatedSettings();
  try {
    const help = await runCli(outside, ["help"], settings.env);
    const bare = await runCli(outside, [], settings.env);
    assert.equal(help.code, 0, help.stderr);
    assert.equal(bare.code, 0, bare.stderr);
    assert.equal(bare.stdout, help.stdout);
    assert.equal(help.stdout.includes("latch route"), false);
    for (const command of ["latch use", "latch task", "latch map", "latch prove", "latch next", "latch daily", "latch help all"]) {
      assert.match(help.stdout, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const all = await runCli(outside, ["help", "all"], settings.env);
    assert.equal(all.code, 0, all.stderr);
    for (const command of ["latch route", "latch slot", "latch exam", "latch card", "latch doctor", "latch hooks"]) {
      assert.match(all.stdout, new RegExp(command));
    }
  } finally {
    await fs.rm(settings.dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("bot next --cwd still prints one JSON object", async () => {
  const repo = await makeRepo();
  try {
    const bot = await runCli(process.cwd(), ["bot", "next", "--cwd", repo]);
    const next = await runCli(os.tmpdir(), ["next", "--cwd", repo, "--json"]);
    const bare = await runCli(os.tmpdir(), ["--cwd", repo, "--json"]);
    assert.equal(bot.code, 1, bot.stderr);
    assert.equal(next.stdout, bot.stdout);
    assert.equal(next.code, bot.code);
    assert.equal(bare.stdout, bot.stdout);
    const lines = bot.stdout.replace(/\n$/, "").split("\n");
    assert.equal(lines.length, 2);
    const json = JSON.parse(lines[0]) as { action: string; exitCode: number; next: string; reason: string };
    assert.equal(lines[1], `下一步：${json.next}`);
    assert.deepEqual(Object.keys(json), ["action", "exitCode", "next", "reason"]);
    assert.equal(json.action, "ask-durability");
    assert.match(json.next, /latch task/);
    assert.equal(json.next.includes("--cwd"), false);
    assert.equal(json.next.includes("npm run latch"), false);
  } finally {
    await cleanup(repo);
  }
});

test("latch map does not guess and prove hashes the open task", async () => {
  const repo = await makeRepo();
  const settings = await isolatedSettings();
  const notes = "notes\n";
  try {
    await initRepo(repo, { settingsPath: settings.file });
    await fs.writeFile(path.join(repo, "NOTES.md"), notes);
    const both = {
      name: "desk",
      entries: [
        {
          id: "notes",
          aliases: ["笔记"],
          location: "NOTES.md",
          observe: "打开笔记",
          steps: [{ id: "read-notes", kind: "read", paths: ["NOTES.md"] }],
        },
        {
          id: "charts",
          aliases: ["笔记", "图表"],
          location: "src/charts/",
          observe: "图表刻度",
          steps: [{ id: "read-charts", kind: "read", paths: ["AGENTS.md"] }],
        },
      ],
    };
    await fs.writeFile(repoLatch(repo, "map.json"), `${JSON.stringify(both, null, 2)}\n`);
    const opened = await runCli(repo, ["task", "看笔记", "--once"], settings.env);
    assert.equal(opened.code, 0, opened.stderr);

    const ambiguous = await runCli(repo, ["map", "看笔记"], settings.env);
    assert.equal(ambiguous.code, 1, ambiguous.stderr);
    assert.equal(ambiguous.stdout.trim(), "ambiguous");
    assert.equal(ambiguous.stdout.includes("NOTES.md"), false);

    const provedEarly = await runCli(repo, ["prove", "--evidence", "NOTES.md"], settings.env);
    assert.equal(provedEarly.code, 1, provedEarly.stderr);
    assert.equal(provedEarly.stderr.trim(), "ambiguous");
    await assert.rejects(fs.access(repoLatch(repo, "session.json")));

    both.entries = [both.entries[0]];
    await fs.writeFile(repoLatch(repo, "map.json"), `${JSON.stringify(both, null, 2)}\n`);
    const hit = await runCli(repo, ["map", "看笔记"], settings.env);
    assert.equal(hit.code, 0, hit.stderr);
    assert.deepEqual(hit.stdout.trimEnd().split("\n"), ["NOTES.md", "打开笔记"]);

    const missed = await runCli(repo, ["map", "没有这个功能"], settings.env);
    assert.equal(missed.code, 1);
    assert.equal(missed.stdout.trim(), "miss");

    const legacy = await runCli(repo, ["map", "desk", "--query", "笔记", "--cwd", repo]);
    assert.equal(legacy.code, 0, legacy.stderr);
    assert.match(legacy.stdout, /^hit notes/);

    const proved = await runCli(repo, ["prove", "--evidence", "NOTES.md"], settings.env);
    assert.equal(proved.code, 0, proved.stderr);
    const hash = crypto.createHash("sha256").update(notes).digest("hex");
    assert.match(proved.stdout, new RegExp(hash));
    const session = JSON.parse(await fs.readFile(repoLatch(repo, "session.json"), "utf8")) as {
      target: string;
      steps: { at: string; evidence: string; sha256: string }[];
    };
    assert.equal(session.target, "desk");
    assert.equal(session.steps[0].at, "NOTES.md");
    assert.equal(session.steps[0].sha256, hash);
  } finally {
    await fs.rm(settings.dir, { recursive: true, force: true });
    await cleanup(repo);
  }
});
