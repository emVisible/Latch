import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repoLatch } from "../shared/paths.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { cleanup, makeRepo } from "./helpers.js";

const CLI = path.join(process.cwd(), "cli/run.ts");

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", CLI, ...args],
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

test("latch map add records one feature and a later lookup hits it", async () => {
  const repo = await makeRepo();
  try {
    const added = await runCli([
      "map",
      "add",
      "--cwd",
      repo,
      "--id",
      "notes",
      "--aliases",
      "笔记, notes",
      "--location",
      "NOTES.md",
      "--observe",
      "打开笔记",
    ]);
    assert.equal(added.code, 0, added.stderr);
    assert.deepEqual(added.stdout.trimEnd().split("\n"), ["notes", "NOTES.md"]);

    const kept = await runCli([
      "map",
      "add",
      "--cwd",
      repo,
      "--id",
      "charts",
      "--aliases",
      "图表",
      "--location",
      "src/charts/",
      "--observe",
      "图表刻度",
    ]);
    assert.equal(kept.code, 0, kept.stderr);

    const map = JSON.parse(await fs.readFile(repoLatch(repo, "map.json"), "utf8")) as {
      name: string;
      entries: {
        id: string;
        aliases: string[];
        location: string;
        observe: string;
        steps: { id: string; kind: string; paths: string[] }[];
      }[];
    };
    assert.equal(map.name, path.basename(repo).toLowerCase());
    assert.deepEqual(map.entries, [
      {
        id: "notes",
        aliases: ["笔记", "notes"],
        location: "NOTES.md",
        observe: "打开笔记",
        steps: [{ id: "read", kind: "read", paths: ["NOTES.md"] }],
      },
      {
        id: "charts",
        aliases: ["图表"],
        location: "src/charts/",
        observe: "图表刻度",
        steps: [{ id: "read", kind: "read", paths: ["src/charts/"] }],
      },
    ]);

    const hit = await runCli(["map", "笔记", "--cwd", repo]);
    assert.equal(hit.code, 0, hit.stderr);
    assert.equal(hit.stdout.trimEnd().split("\n")[0], "NOTES.md");
  } finally {
    await cleanup(repo);
  }
});

test("a second latch map add with the same id does not write", async () => {
  const repo = await makeRepo();
  try {
    const first = await runCli([
      "map",
      "add",
      "--cwd",
      repo,
      "--id",
      "notes",
      "--aliases",
      "笔记",
      "--location",
      "NOTES.md",
      "--observe",
      "打开笔记",
    ]);
    assert.equal(first.code, 0, first.stderr);
    const before = await fs.readFile(repoLatch(repo, "map.json"), "utf8");

    const second = await runCli([
      "map",
      "add",
      "--cwd",
      repo,
      "--id",
      "notes",
      "--aliases",
      "笔记",
      "--location",
      "OTHER.md",
      "--observe",
      "另一处",
    ]);
    assert.equal(second.code, 2, second.stdout);
    assert.match(second.stderr, /重复「notes」/);
    assert.equal(await fs.readFile(repoLatch(repo, "map.json"), "utf8"), before);
  } finally {
    await cleanup(repo);
  }
});

test("an empty map's bot next line is latch map add", async () => {
  const repo = await makeRepo();
  try {
    await fs.mkdir(path.join(repo, ".latch"));
    await fs.writeFile(
      repoLatch(repo, "map.json"),
      `${JSON.stringify({ name: "desk", entries: [] }, null, 2)}\n`,
    );
    await writeTaskFile(repo, {
      intent: "看笔记",
      durability: "once",
      writable: [],
      returns: [],
    });
    const run = await runCli(["bot", "next", "--cwd", repo]);
    assert.equal(run.code, 1, run.stderr);
    const [jsonLine, nextLine] = run.stdout.replace(/\n$/, "").split("\n");
    const json = JSON.parse(jsonLine) as { action: string; next: string };
    assert.equal(json.action, "resolve-map");
    assert.equal(json.next, "latch map add");
    assert.equal(nextLine, "下一步：latch map add");
    const map = JSON.parse(await fs.readFile(repoLatch(repo, "map.json"), "utf8")) as {
      entries: unknown[];
    };
    assert.equal(map.entries.length, 0);
  } finally {
    await cleanup(repo);
  }
});
