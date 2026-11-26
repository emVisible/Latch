import fs from "node:fs/promises";
import path from "node:path";
import type { DomainStep } from "./domain.js";
import { ensureLatchGitignore } from "./journal.js";
import { mapFile, NAME_RE, repoLatch } from "./paths.js";
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

/** Target repo map wins. The library map is only the sample. */
export async function readMapForRepo(repo: string, app: string): Promise<MapDocument> {
  const local = repoLatch(repo, "map.json");
  try {
    const doc = JSON.parse(await fs.readFile(local, "utf8")) as MapDocument;
    const issues = validateMap(doc);
    if (issues.length) throw new Error(issues.join("；"));
    return doc;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return readMap(app);
    throw e;
  }
}

export async function enrichResolution(
  repo: string,
  map: SnapshotMap | null,
): Promise<SnapshotMap | null> {
  if (!map || map.state !== "hit" || !map.entryId) return map;
  let doc: MapDocument;
  try {
    doc = await readMapForRepo(repo, map.app);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
  const entry = doc.entries.find((item) => item.id === map.entryId);
  return {
    ...map,
    location: entry?.location ?? null,
    observe: entry?.observe ?? null,
  };
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
  const def = await readMapForRepo(snapshot.repo, map.app);
  const issues = validateMap(def);
  if (issues.length) return fail(issues.join("；"));
  const entry = def.entries.find((item) => item.id === map.entryId);
  if (!entry) return fail(`条目 ${map.entryId} 不在地图里`);
  return runStepList("map-follow", entry.steps, snapshot.repo, options);
}

export const MAP_ADD_PROMPTS = {
  id: "id：",
  aliases: "aliases（逗号分隔）：",
  location: "location：",
  observe: "observe：",
} as const;

export type MapAddResult = { id: string; location: string } | { issues: string[] };

function legalMapName(repo: string): string {
  const name = path
    .basename(repo)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!NAME_RE.test(name)) throw new Error(`无法从路径推出合法地图名：${repo}`);
  return name;
}

function splitAliases(raw: string): string[] {
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

export async function addMapEntry(
  repo: string,
  fields: { id: string; aliases: string; location: string; observe: string },
): Promise<MapAddResult> {
  const file = repoLatch(repo, "map.json");
  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const issues = validateMap(parsed);
      return { issues: issues.length ? issues : ["map: 必须是对象"] };
    }
    doc = parsed as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    doc = { name: legalMapName(repo), entries: [] };
  }
  if (!Array.isArray(doc.entries)) {
    const issues = validateMap(doc);
    return { issues: issues.length ? issues : ["map.entries: 需要数组"] };
  }
  const location = fields.location.trim();
  const entry: MapEntry = {
    id: fields.id.trim(),
    aliases: splitAliases(fields.aliases),
    location,
    observe: fields.observe.trim(),
    steps: [{ id: "read", kind: "read", paths: [location] }],
  };
  const next = { ...doc, entries: [...doc.entries, entry] };
  const issues = validateMap(next);
  if (issues.length) return { issues };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { id: entry.id, location: entry.location };
}
