import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoLatch } from "./paths.js";
import { validateTask, type TaskDocument } from "./schema.js";

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export type EvidenceFile = { path: string; sha256: string };

export type SnapshotMap = {
  app: string;
  query: string;
  state: "hit" | "miss" | "ambiguous";
  entryId: string | null;
  entryIds: string[];
};

export type Snapshot = {
  version: 1;
  repo: string;
  window: string;
  gitHead: string | null;
  added: string[];
  removed: string[];
  changedPaths: string[];
  task: TaskDocument | null;
  evidence: EvidenceFile[];
  /** sha256 of files the task points at, plus evidence files. */
  files: Record<string, string>;
  map: SnapshotMap | null;
  hash: string;
  capturedAt: string;
};

export type SnapshotInput = {
  added: string[];
  removed: string[];
  changedPaths: string[];
};

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8_000_000,
  });
  if (r.status !== 0) return null;
  return r.stdout ?? "";
}

function gitOrThrow(cwd: string, args: string[]): string {
  const out = git(cwd, args);
  if (out === null) throw new SnapshotError(`git ${args.join(" ")} 执行失败`);
  return out;
}

function sha256(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function stableFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(files).sort()) out[key] = files[key];
  return out;
}

export function snapshotHash(snapshot: {
  repo: string;
  window: string;
  gitHead: string | null;
  added: string[];
  removed: string[];
  changedPaths: string[];
  task: TaskDocument | null;
  evidence: EvidenceFile[];
  files: Record<string, string>;
  map: SnapshotMap | null;
}): string {
  return sha256({
    repo: snapshot.repo,
    window: snapshot.window,
    gitHead: snapshot.gitHead,
    added: snapshot.added,
    removed: snapshot.removed,
    changedPaths: [...snapshot.changedPaths].sort(),
    task: snapshot.task,
    evidence: [...snapshot.evidence].sort((a, b) => a.path.localeCompare(b.path)),
    files: stableFiles(snapshot.files),
    map: snapshot.map,
  });
}

function parseDiff(diff: string): Pick<SnapshotInput, "added" | "removed"> {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line);
    else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line);
  }
  return { added, removed };
}

function statusPaths(status: string): string[] {
  const out: string[] = [];
  for (const line of status.split("\n")) {
    if (line.length < 4) continue;
    let p = line.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    if (p.startsWith('"') && p.endsWith('"')) {
      try {
        p = JSON.parse(p) as string;
      } catch {
        p = p.slice(1, -1);
      }
    }
    if (p) out.push(p);
  }
  return out;
}

function diffPaths(diff: string): string[] {
  const out: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) out.push(line.slice(6));
    else if (line.startsWith("--- a/") && line.slice(6) !== "/dev/null") {
      out.push(line.slice(6));
    }
  }
  return out;
}

async function readUntracked(repo: string, paths: string[]): Promise<string[]> {
  const added: string[] = [];
  for (const rel of paths) {
    const full = path.join(repo, rel);
    let buf: Buffer;
    try {
      buf = await fs.readFile(full);
    } catch {
      continue;
    }
    if (buf.includes(0) || buf.length > 1_000_000) continue; // binary / too large
    for (const line of buf.toString("utf8").split("\n")) added.push(`+${line}`);
  }
  return added;
}

function makeSnapshot(
  repo: string,
  window: string,
  gitHead: string | null,
  input: SnapshotInput,
  extra: {
    task?: TaskDocument | null;
    evidence?: EvidenceFile[];
    files?: Record<string, string>;
    map?: SnapshotMap | null;
  } = {},
): Snapshot {
  const draft = {
    version: 1 as const,
    repo,
    window,
    gitHead,
    added: input.added,
    removed: input.removed,
    changedPaths: [...new Set(input.changedPaths)].sort(),
    task: extra.task ?? null,
    evidence: extra.evidence ?? [],
    files: extra.files ?? {},
    map: extra.map ?? null,
    capturedAt: new Date().toISOString(),
  };
  return { ...draft, hash: snapshotHash(draft) };
}

/** Build a snapshot from a fixture payload (used by --window=fixture:<file> and tests). */
export function snapshotFromFixture(
  payload: SnapshotInput,
  repo: string,
  window = "fixture",
): Snapshot {
  return makeSnapshot(path.resolve(repo), window, null, {
    added: payload.added ?? [],
    removed: payload.removed ?? [],
    changedPaths: payload.changedPaths ?? [],
  });
}

/**
 * Collect a single immutable fact snapshot. `git diff HEAD` alone misses
 * untracked new files; the worktree window reads them directly (read-only,
 * no `git add -N` on the user's index).
 */
async function hashFile(full: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(full);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

async function listEvidence(dir: string): Promise<EvidenceFile[]> {
  const out: EvidenceFile[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const sha = await hashFile(full);
      if (!sha) continue;
      out.push({ path: path.relative(dir, full).split(path.sep).join("/"), sha256: sha });
    }
  }
  await walk(dir);
  return out;
}

async function readTask(repo: string): Promise<TaskDocument | null> {
  const file = repoLatch(repo, "task.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SnapshotError(`无法读取任务单：${String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new SnapshotError(`任务单不是 JSON：${String(e)}`);
  }
  const issues = validateTask(parsed);
  if (issues.length) throw new SnapshotError(issues.join("；"));
  return parsed as TaskDocument;
}

async function readResolution(repo: string): Promise<SnapshotMap | null> {
  const file = repoLatch(repo, "map-resolution.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SnapshotError(`无法读取地图解析：${String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new SnapshotError(`地图解析不是 JSON：${String(e)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { app?: unknown }).app !== "string" ||
    !["hit", "miss", "ambiguous"].includes(String((parsed as { state?: unknown }).state))
  ) {
    throw new SnapshotError("地图解析不合法");
  }
  const rec = parsed as {
    app: string;
    query?: string;
    state: SnapshotMap["state"];
    entryId?: string | null;
    entryIds?: string[];
  };
  return {
    app: rec.app,
    query: rec.query ?? "",
    state: rec.state,
    entryId: rec.entryId ?? null,
    entryIds: Array.isArray(rec.entryIds) ? rec.entryIds : [],
  };
}

export async function writeTaskFile(repo: string, task: TaskDocument): Promise<void> {
  const issues = validateTask(task);
  if (issues.length) throw new SnapshotError(issues.join("；"));
  const file = repoLatch(repo, "task.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

async function attachContext(snapshot: Snapshot): Promise<Snapshot> {
  const task = await readTask(snapshot.repo);
  const map = await readResolution(snapshot.repo);
  const files = { ...snapshot.files };
  for (const item of snapshot.evidence) files[item.path] = item.sha256;
  for (const item of task?.returns ?? []) {
    if (!item.path || files[item.path]) continue;
    const hashed = await hashFile(path.join(snapshot.repo, item.path));
    if (hashed) files[item.path] = hashed;
  }
  return makeSnapshot(
    snapshot.repo,
    snapshot.window,
    snapshot.gitHead,
    snapshot,
    { task, evidence: snapshot.evidence, files, map },
  );
}

export async function collectSnapshot(
  cwd: string,
  windowSpec = "worktree",
): Promise<Snapshot> {
  const repo = path.resolve(cwd);

  if (windowSpec.startsWith("fixture:")) {
    const file = windowSpec.slice("fixture:".length);
    const target = path.isAbsolute(file) ? file : path.join(repo, file);
    let payload: SnapshotInput;
    try {
      payload = JSON.parse(await fs.readFile(target, "utf8")) as SnapshotInput;
    } catch (e) {
      throw new SnapshotError(`无法读取夹具 ${target}: ${String(e)}`);
    }
    return attachContext(snapshotFromFixture(payload, repo, windowSpec));
  }

  if (windowSpec.startsWith("evidence:")) {
    const rel = windowSpec.slice("evidence:".length);
    if (!rel) throw new SnapshotError("evidence: 窗口缺少目录");
    const dir = path.isAbsolute(rel) ? rel : path.join(repo, rel);
    let evidence: EvidenceFile[];
    try {
      evidence = await listEvidence(dir);
    } catch (e) {
      throw new SnapshotError(`无法读取证据目录 ${dir}: ${String(e)}`);
    }
    const top = git(repo, ["rev-parse", "--show-toplevel"])?.trim();
    const gitRoot = top || repo;
    const head = top ? git(repo, ["rev-parse", "HEAD"])?.trim() || null : null;
    let changedPaths: string[] = [];
    if (top) {
      const nameOnly = git(repo, ["diff", "--name-only", "HEAD"]) ?? "";
      const diff = git(repo, ["diff", "HEAD"]) ?? "";
      changedPaths = [...nameOnly.split("\n").filter(Boolean), ...diffPaths(diff)];
    }
    return attachContext(
      makeSnapshot(gitRoot, windowSpec, head, {
        added: [],
        removed: [],
        changedPaths,
      }, { evidence }),
    );
  }

  const rootOut = gitOrThrow(repo, ["rev-parse", "--show-toplevel"]);
  const gitRoot = rootOut.trim();
  const head = git(repo, ["rev-parse", "HEAD"])?.trim() || null;
  const status = gitOrThrow(repo, ["status", "--porcelain", "--untracked-files=all"]);
  const statusList = statusPaths(status);
  const untracked = status
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => statusPaths(l)[0])
    .filter((p): p is string => Boolean(p));

  let diff = "";
  let nameOnly = "";
  if (windowSpec === "worktree") {
    diff =
      git(repo, ["diff", "HEAD"]) ??
      gitOrThrow(repo, ["diff"]);
    nameOnly = git(repo, ["diff", "--name-only", "HEAD"]) ?? "";
  } else if (windowSpec === "staged") {
    diff = gitOrThrow(repo, ["diff", "--cached"]);
    nameOnly = gitOrThrow(repo, ["diff", "--cached", "--name-only"]);
  } else if (windowSpec === "last-commit") {
    const hasParent = git(repo, ["rev-parse", "--verify", "HEAD~1"]) !== null;
    diff = hasParent
      ? gitOrThrow(repo, ["diff", "HEAD~1", "HEAD"])
      : gitOrThrow(repo, ["show", "--format=", "--patch", "HEAD"]);
    nameOnly = hasParent
      ? gitOrThrow(repo, ["diff", "--name-only", "HEAD~1", "HEAD"])
      : "";
  } else if (windowSpec.startsWith("range:")) {
    const ref = windowSpec.slice("range:".length);
    if (!ref) throw new SnapshotError("range: 窗口缺少 ref");
    diff = gitOrThrow(repo, ["diff", ref]);
    nameOnly = gitOrThrow(repo, ["diff", "--name-only", ref]);
  } else {
    throw new SnapshotError(
      `未知窗口「${windowSpec}」：worktree / staged / last-commit / range:<ref> / fixture:<file> / evidence:<dir>`,
    );
  }

  const parsed = parseDiff(diff);
  const changedPaths =
    windowSpec === "worktree"
      ? [...statusList, ...diffPaths(diff)]
      : [...nameOnly.split("\n").filter(Boolean), ...diffPaths(diff)];

  if (windowSpec === "worktree" && untracked.length > 0) {
    parsed.added.push(...(await readUntracked(gitRoot, untracked)));
  }

  return attachContext(
    makeSnapshot(gitRoot, windowSpec, head, {
      ...parsed,
      changedPaths,
    }),
  );
}
