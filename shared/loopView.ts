import fs from "node:fs/promises";
import { atomReachableOnDaily, listCards, readCard } from "./card.js";
import { enrichResolution, readMapForRepo } from "./map.js";
import { repoLatch } from "./paths.js";
import { readSession, SessionError, type SessionDocument } from "./session.js";
import type { SnapshotMap } from "./snapshot.js";
import type { TaskDocument } from "./schema.js";
import { validateTask } from "./schema.js";

export type LoopView = {
  cwd: string;
  task: { intent: string; durability: string } | null;
  session: SessionDocument | null;
  sessionError: string | null;
  map: {
    state: string;
    entryId: string | null;
    location: string | null;
    query: string;
  } | null;
  cards: { name: string; status: string; atom: string; onDaily: boolean }[];
  lease: { pid: number; session: string; alive: boolean } | null;
  mapApp: string;
  nextKind: "task" | "session-end" | "map" | "session-open" | "session-step" | "daily";
  next: string;
};

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readTask(cwd: string): Promise<TaskDocument | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(repoLatch(cwd, "task.json"), "utf8"));
    if (validateTask(parsed).length) return null;
    return parsed as TaskDocument;
  } catch {
    return null;
  }
}

async function readMap(cwd: string): Promise<LoopView["map"]> {
  try {
    const parsed = JSON.parse(await fs.readFile(repoLatch(cwd, "map-resolution.json"), "utf8"));
    const base: SnapshotMap = {
      app: String(parsed.app ?? "desk"),
      query: String(parsed.query ?? ""),
      state: parsed.state,
      entryId: parsed.entryId ?? null,
      entryIds: Array.isArray(parsed.entryIds) ? parsed.entryIds : [],
    };
    const enriched = await enrichResolution(cwd, base);
    return {
      state: enriched?.state ?? "miss",
      entryId: enriched?.entryId ?? null,
      location: enriched?.location ?? null,
      query: enriched?.query ?? "",
    };
  } catch {
    return null;
  }
}

async function readLease(cwd: string): Promise<LoopView["lease"]> {
  try {
    const parsed = JSON.parse(await fs.readFile(repoLatch(cwd, "lease.json"), "utf8"));
    const pid = Number(parsed.pid ?? 0);
    return { pid, session: String(parsed.session ?? ""), alive: alive(pid) };
  } catch {
    return null;
  }
}

function decide(view: Omit<LoopView, "next" | "nextKind">): { nextKind: LoopView["nextKind"]; next: string } {
  if (!view.task) {
    return {
      nextKind: "task",
      next: `npm run latch -- task open --cwd ${view.cwd} --intent "<要做什么>" --durability once --writable <path>`,
    };
  }
  if (view.sessionError) {
    return { nextKind: "daily", next: view.sessionError };
  }
  if (view.lease?.alive && view.lease.session) {
    return { nextKind: "session-end", next: `npm run latch -- session end --cwd ${view.cwd}` };
  }
  if (!view.map || view.map.state === "miss" || view.map.state === "ambiguous") {
    return {
      nextKind: "map",
      next: `npm run latch -- map ${view.mapApp} --query "<说法>" --cwd ${view.cwd}`,
    };
  }
  if (view.map.state === "hit") {
    const covered = view.session?.steps.some((step) => step.at === view.map?.location);
    if (!view.map.location || !covered) {
      if (!view.session) {
        return {
          nextKind: "session-open",
          next: `npm run latch -- session open --cwd ${view.cwd} --target ${view.mapApp}`,
        };
      }
      return {
        nextKind: "session-step",
        next: `npm run latch -- session step --cwd ${view.cwd} --at ${view.map.location ?? "<location>"} --evidence <file>`,
      };
    }
  }
  return { nextKind: "daily", next: `npm run latch -- route daily --cwd ${view.cwd}` };
}

export async function loopView(cwd: string): Promise<LoopView> {
  const taskDoc = await readTask(cwd);
  let session: SessionDocument | null = null;
  let sessionError: string | null = null;
  try {
    session = await readSession(cwd);
  } catch (e) {
    sessionError = e instanceof SessionError ? e.message : String(e);
  }
  const cards = [];
  for (const name of await listCards()) {
    try {
      const card = await readCard(name);
      cards.push({
        name: card.name,
        status: card.status,
        atom: card.atom,
        onDaily: await atomReachableOnDaily(card.atom),
      });
    } catch {
      /* skip a broken card; doctor reports it */
    }
  }
  let mapApp = "desk";
  try {
    mapApp = (await readMapForRepo(cwd, "desk")).name;
  } catch {
    mapApp = "desk";
  }
  const view = {
    cwd,
    task: taskDoc ? { intent: taskDoc.intent, durability: taskDoc.durability } : null,
    session,
    sessionError,
    map: await readMap(cwd),
    cards,
    lease: await readLease(cwd),
    mapApp,
  };
  return { ...view, ...decide(view) };
}
