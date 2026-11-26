import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { noteSightings } from "../shared/card.js";
import { acquireLease, releaseSessionLease } from "../shared/lease.js";
import { captureNaive } from "../shared/naive.js";
import { repoLatch } from "../shared/paths.js";
import { answerSlot } from "../shared/routeRunner.js";
import { runStepList } from "../shared/runner.js";
import { addSessionStep, openSession } from "../shared/session.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { cleanup, makeRepo, writePolicy } from "./helpers.js";

const CLI = path.join(process.cwd(), "cli/run.ts");
const DAILY_ROUTE = path.join(process.cwd(), "library/routes/daily/route.json");

function runBot(repo: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", CLI, "bot", "next", "--cwd", repo],
      { cwd: process.cwd() },
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

function parseBot(stdout: string): { action: string; exitCode: number; next: string; reason: string } {
  const trimmed = stdout.replace(/\n$/, "");
  const nl = trimmed.indexOf("\n");
  const json = JSON.parse(nl === -1 ? trimmed : trimmed.slice(0, nl)) as {
    action: string;
    exitCode: number;
    next: string;
    reason: string;
  };
  const nextLine = nl === -1 ? "" : trimmed.slice(nl + 1);
  assert.equal(nextLine, `下一步：${json.next}`);
  assert.equal(Object.keys(json).join(","), "action,exitCode,next,reason");
  return json;
}

test("bot next asks for durability when the task is missing", async () => {
  const repo = await makeRepo();
  try {
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, run.stderr);
    assert.equal(json.action, "ask-durability");
    assert.equal(json.exitCode, 1);
    assert.match(json.next, /latch task/);
    assert.equal(json.next.includes("--cwd"), false);
    assert.equal(json.next.includes("npm run latch"), false);
    assert.match(json.next, /once/);
    assert.match(json.next, /lasting/);
    assert.equal(json.next.includes("--durability once") && !json.next.includes("<once|lasting>"), false);
    await assert.rejects(fs.access(repoLatch(repo, "task.json")));
    await assert.rejects(fs.access(repoLatch(repo, "lease.json")));
  } finally {
    await cleanup(repo);
  }
});

test("bot next stops on an empty writable when code changed", async () => {
  const repo = await makeRepo();
  try {
    const file = path.join(repo, "extra.ts");
    const body = "export const extra = 1;\n";
    await fs.writeFile(file, body);
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "once",
      writable: [],
      returns: [],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, run.stderr);
    assert.equal(json.action, "declare-writable");
    assert.equal(json.reason, "write.undeclared");
    assert.equal(json.exitCode, 1);
    assert.equal(await fs.readFile(file, "utf8"), body);
  } finally {
    await cleanup(repo);
  }
});

test("bot next does not guess a location when the map misses", async () => {
  const repo = await makeRepo();
  try {
    await writeTaskFile(repo, {
      intent: "没有这个功能",
      durability: "once",
      writable: [],
      returns: [],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, run.stderr);
    assert.equal(json.action, "resolve-map");
    assert.match(json.next, /map /);
    assert.equal(json.next.includes("NOTES.md"), false);
    assert.equal(json.next.includes("--at"), false);
    await assert.rejects(fs.access(repoLatch(repo, "map-resolution.json")));
  } finally {
    await cleanup(repo);
  }
});

test("a fact with no feature hit fails", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    await writeTaskFile(repo, {
      intent: "没有这个功能",
      durability: "once",
      writable: ["NOTES.md"],
      returns: [{ fact: "有笔记", path: "NOTES.md" }],
    });
    await openSession(repo, "desk");
    await addSessionStep(repo, "NOTES.md", "NOTES.md");
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "resolve-map");
    assert.equal(json.exitCode, 1);
    await assert.rejects(fs.access(repoLatch(repo, "map-resolution.json")));
  } finally {
    await cleanup(repo);
  }
});

test("a fact whose evidence hash was not computed by the session step fails", async () => {
  const repo = await makeRepo();
  try {
    const body = "notes\n";
    await fs.writeFile(path.join(repo, "NOTES.md"), body);
    const sha = crypto.createHash("sha256").update(body).digest("hex");
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "once",
      writable: ["NOTES.md"],
      returns: [{ fact: "有笔记", path: "NOTES.md", sha256: sha }],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "collect-evidence");
    assert.match(json.next, /latch prove/);
    assert.equal(json.next.includes("--cwd"), false);
    await assert.rejects(fs.access(repoLatch(repo, "session.json")));
  } finally {
    await cleanup(repo);
  }
});

test("a session step that is not on the feature location fails", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "once",
      writable: ["NOTES.md"],
      returns: [{ fact: "打开了笔记", path: "NOTES.md" }],
    });
    await openSession(repo, "desk");
    await addSessionStep(repo, "src/charts/", "NOTES.md");
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "collect-evidence");
    assert.match(json.next, /latch prove/);
    assert.match(json.next, /NOTES\.md/);
    assert.equal(json.next.includes("--cwd"), false);
  } finally {
    await cleanup(repo);
  }
});

test("a fact tied to the feature location and a session hash passes", async () => {
  const repo = await makeRepo();
  try {
    await fs.writeFile(path.join(repo, "NOTES.md"), "notes\n");
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "once",
      writable: ["NOTES.md"],
      returns: [{ fact: "打开了笔记", path: "NOTES.md" }],
    });
    await openSession(repo, "desk");
    await addSessionStep(repo, "NOTES.md", "NOTES.md");
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 0, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "done");
    assert.equal(json.exitCode, 0);
    assert.equal(json.next, "");
  } finally {
    await cleanup(repo);
  }
});

test("bot next asks to open a card for a lasting task that names none", async () => {
  const repo = await makeRepo();
  try {
    const before = await fs.readFile(DAILY_ROUTE, "utf8");
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "lasting",
      writable: [],
      returns: [],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "open-card");
    assert.match(json.next, /latch task/);
    assert.match(json.next, /--lasting/);
    assert.equal(json.next.includes("--cwd"), false);
    assert.equal(await fs.readFile(DAILY_ROUTE, "utf8"), before);
  } finally {
    await cleanup(repo);
  }
});

test("bot next is done for a once task with no code change and no facts", async () => {
  const repo = await makeRepo();
  try {
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "once",
      writable: [],
      returns: [],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 0, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "done");
    assert.equal(json.exitCode, 0);
    const resolution = JSON.parse(await fs.readFile(repoLatch(repo, "map-resolution.json"), "utf8"));
    assert.equal(resolution.state, "hit");
    assert.equal(resolution.entryId, "notes");
    assert.equal(resolution.location, "NOTES.md");
    const lease = JSON.parse(await fs.readFile(repoLatch(repo, "lease.json"), "utf8"));
    assert.equal(typeof lease.session, "string");
    assert.ok(lease.session.length > 0);
    const again = await runBot(repo);
    const second = parseBot(again.stdout);
    assert.equal(again.code, 0, `${again.stderr}\n${again.stdout}`);
    assert.equal(second.action, "done");
    assert.ok(await fs.readFile(repoLatch(repo, "lease.json"), "utf8"));
  } finally {
    await cleanup(repo);
  }
});

test("bot next reports discipline hits before the style-drift slot", async () => {
  const repo = await makeRepo();
  try {
    await writePolicy(repo);
    await fs.writeFile(path.join(repo, "bad.tsx"), "const x = useEffect(() => {});\n");
    await writeTaskFile(repo, {
      intent: "笔记",
      durability: "once",
      writable: ["bad.tsx"],
      returns: [],
    });
    const breach = await runBot(repo);
    const hit = parseBot(breach.stdout);
    assert.equal(breach.code, 1, `${breach.stderr}\n${breach.stdout}`);
    assert.equal(hit.action, "fix-discipline");
    assert.match(hit.reason, /diff\.useEffect/);
    assert.match(hit.reason, /useEffect/);

    await fs.writeFile(path.join(repo, "bad.tsx"), "export const FINE = 1;\n");
    const pending = await runBot(repo);
    const slot = parseBot(pending.stdout);
    assert.equal(pending.code, 5, `${pending.stderr}\n${pending.stdout}`);
    assert.equal(slot.action, "answer-slot");
    assert.equal(slot.exitCode, 5);
    assert.match(slot.next, /style-drift=<pass\|fail>/);

    const answered = await answerSlot("daily", "style-drift", "fail", repo);
    assert.equal(answered.ok, true, answered.message);
    const failed = await runBot(repo);
    const refusal = parseBot(failed.stdout);
    assert.equal(failed.code, 1, `${failed.stderr}\n${failed.stdout}`);
    assert.equal(refusal.action, "fix-discipline");
    assert.equal(refusal.reason, "style-drift=fail");
  } finally {
    await cleanup(repo);
  }
});

test("bot next sends a named lasting card to the exam", async () => {
  const repo = await makeRepo();
  try {
    const before = await fs.readFile(DAILY_ROUTE, "utf8");
    await writeTaskFile(repo, {
      intent: "笔记 diff-use-effect",
      durability: "lasting",
      writable: [],
      returns: [],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "pass-exam");
    assert.match(json.next, /exam diff-use-effect/);
    assert.equal(await fs.readFile(DAILY_ROUTE, "utf8"), before);
  } finally {
    await cleanup(repo);
  }
});

test("bot next asks to promote a card whose exam passed but is not latched", async () => {
  const repo = await makeRepo();
  try {
    const before = await fs.readFile(DAILY_ROUTE, "utf8");
    const cardPath = path.join(process.cwd(), "library/cards/diff-use-effect/card.json");
    const cardBefore = await fs.readFile(cardPath, "utf8");
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "panel.tsx"), "export const panel = 1;\n");
    const read = await runStepList(
      "map-follow",
      [{ id: "read-panel", kind: "read", paths: ["src/panel.tsx"] }],
      repo,
    );
    assert.equal(read.ok, true, read.log.join("\n"));
    await captureNaive(repo, "diff-use-effect", "src/panel.tsx");
    await noteSightings(repo, { "diff.useEffect": true }, "bot-sight-1");
    await noteSightings(repo, { "diff.useEffect": true }, "bot-sight-2");
    await writeTaskFile(repo, {
      intent: "笔记 diff-use-effect",
      durability: "lasting",
      writable: ["src/panel.tsx"],
      returns: [],
    });
    const run = await runBot(repo);
    const json = parseBot(run.stdout);
    assert.equal(run.code, 1, `${run.stderr}\n${run.stdout}`);
    assert.equal(json.action, "promote-card", json.reason);
    assert.match(json.next, /card promote diff-use-effect/);
    assert.equal(await fs.readFile(DAILY_ROUTE, "utf8"), before);
    assert.equal(await fs.readFile(cardPath, "utf8"), cardBefore);
  } finally {
    await cleanup(repo);
  }
});

test("a live session lease blocks bot next and a dead pid is recovered", async () => {
  const repo = await makeRepo();
  try {
    await writeTaskFile(repo, {
      intent: "没有这个功能",
      durability: "once",
      writable: [],
      returns: [],
    });
    await acquireLease(repo, "other-agent");
    const blocked = await runBot(repo);
    const held = parseBot(blocked.stdout);
    assert.equal(blocked.code, 1, blocked.stderr);
    assert.equal(held.action, "hold-lock");
    const lease = JSON.parse(await fs.readFile(repoLatch(repo, "lease.json"), "utf8"));
    assert.equal(lease.session, "other-agent");
    assert.equal(lease.pid, process.pid);
    await releaseSessionLease(repo);

    await fs.mkdir(repoLatch(repo, ""), { recursive: true });
    await fs.writeFile(
      repoLatch(repo, "lease.json"),
      `${JSON.stringify({ pid: 2147483646, session: "ghost", snapshotHash: "" })}\n`,
    );
    const recovered = await runBot(repo);
    const next = parseBot(recovered.stdout);
    assert.equal(next.action, "resolve-map", `${recovered.stderr}\n${recovered.stdout}`);
    const after = JSON.parse(await fs.readFile(repoLatch(repo, "lease.json"), "utf8"));
    assert.notEqual(after.pid, 2147483646);
    assert.ok(after.session.length > 0);
  } finally {
    await releaseSessionLease(repo);
    await cleanup(repo);
  }
});
