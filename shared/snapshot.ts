import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export type Snapshot = {
  version: 1;
  repo: string;
  window: string;
  gitHead: string | null;
  added: string[];
  removed: string[];
  changedPaths: string[];
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

export function snapshotHash(
  repo: string,
  window: string,
  gitHead: string | null,
  input: SnapshotInput,
): string {
  return sha256({
    repo,
    window,
    gitHead,
    added: input.added,
    removed: input.removed,
    changedPaths: [...input.changedPaths].sort(),
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
): Snapshot {
  const changedPaths = [...new Set(input.changedPaths)].sort();
  const normalized = { ...input, changedPaths };
  return {
    version: 1,
    repo,
    window,
    gitHead,
    added: input.added,
    removed: input.removed,
    changedPaths,
    hash: snapshotHash(repo, window, gitHead, normalized),
    capturedAt: new Date().toISOString(),
  };
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
    return snapshotFromFixture(payload, repo, windowSpec);
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
      `未知窗口「${windowSpec}」：worktree / staged / last-commit / range:<ref> / fixture:<file>`,
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

  return makeSnapshot(gitRoot, windowSpec, head, {
    ...parsed,
    changedPaths,
  });
}
