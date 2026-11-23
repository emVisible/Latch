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

/** Exclusive create. A dead pid is removed and retried once. */
export async function acquireLease(repo: string): Promise<() => Promise<void>> {
  const file = repoLatch(repo, "lease.json");
  await fs.mkdir(repoLatch(repo, ""), { recursive: true });
  const body = `${JSON.stringify({
    pid: process.pid,
    snapshotHash: "",
    acquiredAt: new Date().toISOString(),
  })}\n`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(file, "wx");
      await fh.writeFile(body);
      await fh.close();
      return async () => {
        await fs.rm(file, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let pid = 0;
      try {
        pid = Number(JSON.parse(await fs.readFile(file, "utf8")).pid);
      } catch {
        pid = 0;
      }
      if (alive(pid)) {
        throw new LeaseError(`目标仓库已有租约（pid ${pid}），另一个 agent 还在跑`);
      }
      await fs.rm(file, { force: true });
    }
  }
  throw new LeaseError("无法取得租约");
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
