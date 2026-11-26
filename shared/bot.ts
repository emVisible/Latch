import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateAtoms, loadAtomRegistry } from "./atoms.js";
import { atomReachableOnDaily, examCard, listCards, readCard } from "./card.js";
import { readDomain } from "./domain.js";
import { isJournalValid, readJournal } from "./journal.js";
import { LeaseError, acquireLease, gitRoot } from "./lease.js";
import { hashRoute } from "./linkmap.js";
import { readMapForRepo, resolveMap, writeResolution } from "./map.js";
import { repoLatch } from "./paths.js";
import { readRoute } from "./route.js";
import { validateTask, type TaskDocument } from "./schema.js";
import { evidenceCovers, type SessionDocument } from "./session.js";
import { SnapshotError, collectSnapshot, type Snapshot } from "./snapshot.js";

export type BotAction =
  | "ask-durability"
  | "hold-lock"
  | "declare-writable"
  | "resolve-map"
  | "collect-evidence"
  | "fix-discipline"
  | "answer-slot"
  | "open-card"
  | "pass-exam"
  | "promote-card"
  | "done";

export type BotResult = {
  action: BotAction;
  exitCode: 0 | 1 | 5;
  next: string;
  reason: string;
};

function stop(
  action: BotAction,
  exitCode: 0 | 1 | 5,
  next: string,
  reason: string,
): BotResult {
  return { action, exitCode, next, reason };
}

function latch(args: string): string {
  return `latch ${args}`;
}

const EMPTY_MAP_NEXT = latch("map add");

async function repoMapEmpty(repo: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(repoLatch(repo, "map.json"), "utf8")) as {
      entries?: unknown;
    };
    return Array.isArray(parsed.entries) && parsed.entries.length === 0;
  } catch {
    return false;
  }
}

async function mapStop(
  repo: string,
  query: string,
  reason: string,
): Promise<{ next: string; reason: string }> {
  if (await repoMapEmpty(repo)) {
    return { next: EMPTY_MAP_NEXT, reason: "地图还没有条目" };
  }
  return { next: latch(`map ${q(query)}`), reason };
}

function q(value: string): string {
  return JSON.stringify(value);
}

async function readValidTask(repo: string): Promise<TaskDocument | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(repoLatch(repo, "task.json"), "utf8"));
    if (validateTask(parsed).length) return null;
    return parsed as TaskDocument;
  } catch {
    return null;
  }
}

/** Session lease stays until `latch session end`. The release handle is intentionally dropped. */
async function takeBotLease(repo: string): Promise<BotResult | null> {
  const file = repoLatch(repo, "hook-session");
  let session = "";
  try {
    session = (await fs.readFile(file, "utf8")).trim();
  } catch {
    session = "";
  }
  const created = session.length === 0;
  if (!session) session = crypto.randomBytes(16).toString("hex");
  try {
    await acquireLease(repo, session);
  } catch (e) {
    if (e instanceof LeaseError) {
      return stop(
        "hold-lock",
        1,
        "另一个还活着的 agent 持有这个 git 根的会话锁。请等对方结束会话，不要抢锁。",
        e.message,
      );
    }
    throw e;
  }
  if (created) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, session, { flag: "wx" }).catch(() => {});
  }
  return null;
}

function namedCard(intent: string, names: string[]): string | null {
  const hits = names.filter((name) => intent.includes(name));
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.length - a.length);
  const top = hits[0];
  const others = hits.slice(1).filter((name) => !top.includes(name));
  return others.length === 0 ? top : null;
}

/** A hand-written task.sha256 is not evidence. The step must match the opened target, the map location, and observe, and Latch must have hashed the file. */
function missingFact(
  task: TaskDocument,
  session: SessionDocument | null,
  entry: { location: string; observe: string },
  app: string,
): { reason: string; evidence: string } | null {
  if (task.returns.length === 0) return null;
  for (const item of task.returns) {
    if (!item.path) return { reason: item.fact, evidence: "<file>" };
    const covered = session?.steps.some(
      (step) =>
        session?.target === app &&
        step.target === app &&
        step.at === entry.location &&
        step.position === entry.location &&
        step.observe === entry.observe &&
        evidenceCovers(step.evidence, item.path!) &&
        step.sha256.length > 0,
    );
    if (!covered) return { reason: item.path, evidence: item.path };
  }
  return null;
}

export async function botNext(cwd: string): Promise<BotResult> {
  const repo = gitRoot(path.resolve(cwd));
  const task = await readValidTask(repo);
  if (!task) {
    return stop(
      "ask-durability",
      1,
      `latch task "<要做什么>" --once 或 latch task "<要做什么>" --lasting`,
      "没有合法任务：需要 intent，以及 durability once 或 lasting",
    );
  }

  const held = await takeBotLease(repo);
  if (held) return held;

  let snapshot: Snapshot;
  try {
    snapshot = await collectSnapshot(repo, "worktree");
  } catch (e) {
    const message = e instanceof SnapshotError ? e.message : String(e);
    if (message.includes("会话") || message.includes("证据")) {
      return stop(
        "collect-evidence",
        1,
        latch(`prove --evidence "<file>"`),
        message,
      );
    }
    return stop("declare-writable", 1, message, message);
  }

  const registry = await loadAtomRegistry();
  const gate = evaluateAtoms(
    ["write.undeclared", "policy.active", "changes.present"],
    snapshot,
    registry.atoms,
  );
  if (task.writable.length === 0 && gate.values["write.undeclared"]) {
    const paths = gate.hits["write.undeclared"] ?? [];
    return stop(
      "declare-writable",
      1,
      `不要修改这些文件（${paths.join(", ")}）。运行 ${latch(`task ${q(task.intent)} --${task.durability} --writable <path>`)}`,
      "write.undeclared",
    );
  }

  let map;
  try {
    map = await readMapForRepo(repo, "desk");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stopped = await mapStop(repo, task.intent, message);
    return stop("resolve-map", 1, stopped.next, stopped.reason);
  }
  const resolved = resolveMap(map, task.intent);
  const entry =
    resolved.state === "hit"
      ? map.entries.find((item) => item.id === resolved.entryIds[0])
      : undefined;
  if (resolved.state !== "hit" || !entry?.location) {
    const stopped = await mapStop(repo, task.intent, resolved.state);
    return stop("resolve-map", 1, stopped.next, stopped.reason);
  }
  await writeResolution(repo, {
    app: map.name,
    query: task.intent,
    state: "hit",
    entryId: entry.id,
    entryIds: [entry.id],
    location: entry.location,
    observe: entry.observe,
  });

  const missing = missingFact(task, snapshot.session, entry, map.name);
  if (missing) {
    const next = latch(
      `prove --evidence ${q(missing.evidence)} --at ${q(entry.location)}`,
    );
    return stop("collect-evidence", 1, next, missing.reason);
  }

  if (gate.values["policy.active"] && gate.values["changes.present"]) {
    const domain = await readDomain("change-discipline");
    const atomNames = domain.steps.flatMap((step) =>
      step.kind === "assert" && step.atom ? [step.atom] : [],
    );
    const discipline = evaluateAtoms(atomNames, snapshot, registry.atoms);
    const breached = atomNames.filter((name) => discipline.values[name]);
    if (breached.length > 0) {
      const hits = breached
        .map((name) => `${name}: ${(discipline.hits[name] ?? []).join(" | ")}`)
        .join("; ");
      return stop("fix-discipline", 1, `按这些命中改掉违纪后再继续：${hits}`, hits);
    }
    const slot = domain.steps.find((step) => step.kind === "slot");
    const slotId = slot?.kind === "slot" ? slot.id : "style-drift";
    const question = slot?.kind === "slot" ? slot.question : slotId;
    const route = await readRoute("daily");
    const journal = await readJournal(repo);
    const bound =
      journal &&
      isJournalValid(journal, {
        route: "daily",
        repo: snapshot.repo,
        window: snapshot.window,
        snapshotHash: snapshot.hash,
        routeHash: hashRoute(route),
        atomsHash: registry.hash,
      })
        ? journal.slotAnswers[slotId]
        : undefined;
    if (bound !== "pass" && bound !== "fail") {
      return stop(
        "answer-slot",
        5,
        `回答：${question} 然后运行 ${latch(`slot daily ${slotId}=<pass|fail>`)}`,
        slotId,
      );
    }
    if (bound === "fail") {
      return stop(
        "fix-discipline",
        1,
        `${slotId} 已答 fail。改掉风格漂移后再继续，不要把答案改成 pass 来绕过。`,
        `${slotId}=fail`,
      );
    }
  }

  if (task.durability === "lasting") {
    const cardName = namedCard(task.intent, await listCards());
    if (!cardName) {
      return stop(
        "open-card",
        1,
        `问用户这张长期卡的名字，建好卡，并把卡名写进任务 intent。然后运行 ${latch(`task "<含卡名>" --lasting`)}`,
        "任务没有点名一张卡",
      );
    }
    const exam = await examCard(cardName, repo);
    if (exam.exitCode !== 0) {
      return stop(
        "pass-exam",
        1,
        latch(`exam ${cardName}`),
        exam.message,
      );
    }
    const card = await readCard(cardName);
    const onDaily = await atomReachableOnDaily(card.atom);
    if (card.status !== "latched" || !onDaily) {
      return stop(
        "promote-card",
        1,
        latch(`card promote ${cardName}`),
        onDaily ? "考卷已过，原子还没有闩上" : `原子 ${card.atom} 不在 daily 走得到的 scope 里`,
      );
    }
  }

  return stop("done", 0, "", "");
}
