import fs from "node:fs/promises";
import type { DomainStep } from "./domain.js";
import { ensureLatchGitignore } from "./journal.js";
import { mapFile, repoLatch } from "./paths.js";
import type { RunOptions, RunResult } from "./runner.js";
import { runStepList } from "./runner.js";
import { validateMap } from "./schema.js";
import type { Snapshot, SnapshotMap } from "./snapshot.js";

export type MapResolution = {
  state: "hit" | "miss" | "ambiguous";
  entryIds: string[];
};

export type MapEntry = {
  id: string;
  aliases: string[];
  location: string;
  observe: string;
  steps: DomainStep[];
};

export type MapDocument = {
  name: string;
  entries: MapEntry[];
};

export async function readMap(name: string): Promise<MapDocument> {
  return JSON.parse(await fs.readFile(mapFile(name), "utf8")) as MapDocument;
}

export function resolveMap(map: MapDocument, query: string): MapResolution {
  const q = query.trim().toLowerCase();
  if (!q) return { state: "miss", entryIds: [] };
  const hits = map.entries.filter((entry) =>
    entry.aliases.some((alias) => q.includes(alias.trim().toLowerCase())),
  );
  if (hits.length === 0) return { state: "miss", entryIds: [] };
  if (hits.length === 1) return { state: "hit", entryIds: [hits[0].id] };
  return { state: "ambiguous", entryIds: hits.map((entry) => entry.id) };
}

export async function writeResolution(
  repo: string,
  record: SnapshotMap,
): Promise<void> {
  await ensureLatchGitignore(repo);
  const file = repoLatch(repo, "map-resolution.json");
  await fs.mkdir(repoLatch(repo, ""), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  if (record.state === "hit") return;
  const cand = repoLatch(repo, "map-candidates.json");
  let list: unknown[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(cand, "utf8")) as unknown;
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = [];
  }
  list.push({
    at: new Date().toISOString(),
    app: record.app,
    query: record.query,
    state: record.state,
    entryIds: record.entryIds,
  });
  await fs.writeFile(cand, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

export async function runMapFollow(
  snapshot: Snapshot,
  options: RunOptions = {},
): Promise<RunResult> {
  const map = snapshot.map;
  const fail = (reason: string): RunResult => ({
    domain: "map-follow",
    cwd: snapshot.repo,
    ok: false,
    log: [`[失败] resolve: ${reason}`],
    steps: [],
    slots: [],
    reads: [],
    failure: { stepId: "resolve", reason },
  });
  if (!map || map.state !== "hit" || !map.entryId) {
    return fail("不是唯一命中");
  }
  const def = await readMap(map.app);
  const issues = validateMap(def);
  if (issues.length) return fail(issues.join("；"));
  const entry = def.entries.find((item) => item.id === map.entryId);
  if (!entry) return fail(`条目 ${map.entryId} 不在地图里`);
  return runStepList("map-follow", entry.steps, snapshot.repo, options);
}
