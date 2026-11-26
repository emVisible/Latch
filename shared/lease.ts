import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { repoLatch } from "./paths.js";

export class LeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaseError";
  }
}

/** Git toplevel when cwd is inside a repo; otherwise the resolved cwd. */
export function gitRoot(cwd: string): string {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return path.resolve(cwd);
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type LeaseFile = { pid?: number; session?: string; snapshotHash?: string; acquiredAt?: string };

async function readLease(file: string): Promise<LeaseFile> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as LeaseFile;
  } catch {
    return {};
  }
}

/**
 * Exclusive create. A dead pid is removed and retried once.
 * A session lease stays after the command returns until `latch session end`.
 */
export async function acquireLease(
  repo: string,
  session?: string,
): Promise<() => Promise<void>> {
  const file = repoLatch(repo, "lease.json");
  await fs.mkdir(repoLatch(repo, ""), { recursive: true });
  const body = `${JSON.stringify({
    pid: process.pid,
    session: session ?? "",
    snapshotHash: "",
    acquiredAt: new Date().toISOString(),
  })}\n`;
  const keep = Boolean(session);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(file, "wx");
      await fh.writeFile(body);
      await fh.close();
      return async () => {
        if (!keep) await fs.rm(file, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const cur = await readLease(file);
      const pid = Number(cur.pid ?? 0);
      if (session && cur.session === session) {
        await fs.writeFile(
          file,
          `${JSON.stringify({ ...cur, pid: process.pid, session })}\n`,
        );
        return async () => {};
      }
      if (alive(pid)) {
        throw new LeaseError(`目标仓库已有租约（pid ${pid}），另一个 agent 还在跑`);
      }
      await fs.rm(file, { force: true });
    }
  }
  throw new LeaseError("无法取得租约");
}

export async function releaseSessionLease(repo: string): Promise<void> {
  await fs.rm(repoLatch(repo, "lease.json"), { force: true });
}

export async function stampLease(repo: string, snapshotHash: string): Promise<void> {
  const file = repoLatch(repo, "lease.json");
  try {
    const cur = JSON.parse(await fs.readFile(file, "utf8")) as { pid?: number };
    if (cur.pid !== process.pid) return;
    await fs.writeFile(
      file,
      `${JSON.stringify({ ...cur, snapshotHash })}\n`,
      "utf8",
    );
  } catch {
    /* released already */
  }
}
