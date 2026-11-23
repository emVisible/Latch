import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type SlotAnswer = "pass" | "fail";
export type JournalStatus =
  | "in-progress"
  | "awaiting-slot"
  | "passed"
  | "blocked"
  | "failed";

export type JournalEntry = {
  seq: number;
  at: string;
  stage: string;
  atomValues: Record<string, boolean>;
  linkId: string;
  action: string;
  detail?: string;
  prevHash: string;
  hash: string;
};

export type RunResultRecord = { ok: boolean; log: string[] };

export type ReadReceipt = { path: string; sha256: string };

export type JournalPayload = {
  map?: {
    app: string;
    query: string;
    state: "hit" | "miss" | "ambiguous";
    entryId: string | null;
    entryIds: string[];
  };
};

export type Journal = {
  version: 1;
  route: string;
  repo: string;
  window: string;
  snapshotHash: string;
  routeHash: string;
  atomsHash: string;
  slotAnswers: Record<string, SlotAnswer>;
  runResults: Record<string, RunResultRecord>;
  entries: JournalEntry[];
  reads: ReadReceipt[];
  payload: JournalPayload;
  status: JournalStatus;
  currentStage: string;
  updatedAt: string;
};

export type JournalBinding = {
  route: string;
  repo: string;
  window: string;
  snapshotHash: string;
  routeHash: string;
  atomsHash: string;
};

const GENESIS = "0".repeat(64);

function sha256(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function journalDir(repo: string): string {
  return path.join(repo, ".latch");
}

export function journalPath(repo: string): string {
  return path.join(journalDir(repo), "last-route.json");
}

/**
 * Idempotent: keep the receipt out of git status WITHOUT editing the tracked
 * .gitignore. `.git/info/exclude` is local to this clone, so Latch never
 * dirties the user's working tree (which would also change the snapshot hash).
 * Falls back to .gitignore for worktrees whose .git is a file.
 */
export async function ensureLatchGitignore(repo: string): Promise<boolean> {
  const gitDir = path.join(repo, ".git");
  let excludePath = path.join(gitDir, "info", "exclude");
  try {
    const st = await fs.stat(gitDir);
    if (!st.isDirectory()) excludePath = path.join(repo, ".gitignore");
  } catch {
    excludePath = path.join(repo, ".gitignore");
  }
  let raw = "";
  try {
    raw = await fs.readFile(excludePath, "utf8");
  } catch {
    raw = "";
  }
  const lines = raw.split("\n").map((l) => l.trim());
  if (lines.includes(".latch/") || lines.includes(".latch")) return false;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  const next = `${raw.replace(/\s*$/, "")}${raw.trim() ? "\n" : ""}# latch receipts\n.latch/\n`;
  await fs.writeFile(excludePath, next, "utf8");
  return true;
}

export function newJournal(binding: JournalBinding): Journal {
  return {
    version: 1,
    route: binding.route,
    repo: binding.repo,
    window: binding.window,
    snapshotHash: binding.snapshotHash,
    routeHash: binding.routeHash,
    atomsHash: binding.atomsHash,
    slotAnswers: {},
    runResults: {},
    entries: [],
    reads: [],
    payload: {},
    status: "in-progress",
    currentStage: "entry",
    updatedAt: new Date().toISOString(),
  };
}

export async function readJournal(repo: string): Promise<Journal | null> {
  try {
    const raw = await fs.readFile(journalPath(repo), "utf8");
    const j = JSON.parse(raw) as Journal;
    return j.version === 1 ? j : null;
  } catch {
    return null;
  }
}

/** Atomic replace so a hook and a manual invocation cannot clobber each other. */
export async function writeJournal(repo: string, journal: Journal): Promise<void> {
  const dir = journalDir(repo);
  await fs.mkdir(dir, { recursive: true });
  journal.updatedAt = new Date().toISOString();
  const tmp = path.join(dir, `.last-route.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  await fs.rename(tmp, journalPath(repo));
  await ensureLatchGitignore(repo);
}

export function isJournalValid(
  journal: Journal | null,
  binding: JournalBinding,
): journal is Journal {
  if (!journal) return false;
  return (
    journal.version === 1 &&
    journal.route === binding.route &&
    journal.repo === binding.repo &&
    journal.window === binding.window &&
    journal.snapshotHash === binding.snapshotHash &&
    journal.routeHash === binding.routeHash &&
    journal.atomsHash === binding.atomsHash
  );
}

export function appendEntry(
  journal: Journal,
  entry: Omit<JournalEntry, "seq" | "at" | "prevHash" | "hash">,
): JournalEntry {
  const prevHash =
    journal.entries.length > 0
      ? journal.entries[journal.entries.length - 1].hash
      : GENESIS;
  const base = {
    seq: journal.entries.length + 1,
    at: new Date().toISOString(),
    ...entry,
    prevHash,
  };
  const full: JournalEntry = { ...base, hash: sha256(base) };
  journal.entries.push(full);
  return full;
}

export function readsPath(repo: string): string {
  return path.join(journalDir(repo), "reads.json");
}

export async function rememberRead(
  repo: string,
  rel: string,
  sha256hex: string,
): Promise<void> {
  await ensureLatchGitignore(repo);
  const file = readsPath(repo);
  await fs.mkdir(path.dirname(file), { recursive: true });
  let list: ReadReceipt[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) list = parsed as ReadReceipt[];
  } catch {
    list = [];
  }
  const next = list.filter((item) => item.path !== rel);
  next.push({ path: rel, sha256: sha256hex });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function readReceipts(repo: string): Promise<ReadReceipt[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(readsPath(repo), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ReadReceipt[]) : [];
  } catch {
    return [];
  }
}

export function verifyChain(journal: Journal): boolean {
  let prev = GENESIS;
  for (const entry of journal.entries) {
    const { hash, ...rest } = entry;
    if (rest.prevHash !== prev) return false;
    if (sha256(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}
