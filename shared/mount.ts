import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SKILLS_DIR, LATCH_ROOT, skillDir } from "./paths.js";

export type MountTarget = {
  id: string;
  label: string;
  path: string;
  skillDir: string;
};

export type MountRecord = {
  skillName: string;
  targetId: string;
  dest: string;
  mode: "symlink" | "copy";
  sourceRelative: string;
};

export type MountStatus = MountRecord & {
  exists: boolean;
  valid: boolean;
  owned: boolean;
  discovered: boolean;
};

export class MountConflictError extends Error {
  constructor(public dest: string, reason: string) {
    super(`目标不是 Latch 管理的挂载，拒绝操作：${dest}（${reason}）`);
    this.name = "MountConflictError";
  }
}

async function hashDir(dir: string): Promise<string> {
  const h = crypto.createHash("sha256");
  async function walk(rel: string) {
    const full = path.join(dir, rel);
    // lstat, never stat: do not follow symlinks out of the library.
    const st = await fs.lstat(full);
    if (st.isSymbolicLink()) {
      h.update(rel);
      h.update("[symlink]");
      return;
    }
    if (st.isDirectory()) {
      h.update(rel);
      const kids = await fs.readdir(full);
      for (const k of kids.sort()) await walk(path.join(rel, k));
    } else {
      h.update(rel);
      h.update(await fs.readFile(full));
    }
  }
  await walk("");
  return h.digest("hex").slice(0, 16);
}

type SourceMeta = {
  sourceRelative: string;
  digest: string;
  from: string;
};

async function readSourceMeta(dest: string): Promise<SourceMeta | null> {
  try {
    const meta = JSON.parse(
      await fs.readFile(path.join(dest, ".latch-source"), "utf8"),
    ) as SourceMeta;
    return meta;
  } catch {
    return null;
  }
}

function metaPointsIntoLibrary(meta: SourceMeta | null): boolean {
  if (!meta || typeof meta.sourceRelative !== "string") return false;
  if (meta.from !== LATCH_ROOT) return false;
  const rel = meta.sourceRelative.replace(/\\/g, "/");
  if (!rel.startsWith("library/skills/") || rel.includes("..")) return false;
  return true;
}

/** Only Latch-created mounts may be removed or overwritten. */
export async function inspectOwnership(
  dest: string,
  source: string,
): Promise<{ exists: boolean; owned: boolean; mode: "symlink" | "copy" }> {
  let st;
  try {
    st = await fs.lstat(dest);
  } catch {
    return { exists: false, owned: false, mode: "copy" };
  }
  if (st.isSymbolicLink()) {
    let owned = false;
    try {
      const resolved = await fs.realpath(dest);
      const expected = await fs.realpath(source);
      owned = resolved === expected || resolved.startsWith(expected + path.sep);
    } catch {
      owned = false;
    }
    return { exists: true, owned, mode: "symlink" };
  }
  if (st.isDirectory()) {
    const meta = await readSourceMeta(dest);
    return { exists: true, owned: metaPointsIntoLibrary(meta), mode: "copy" };
  }
  return { exists: true, owned: false, mode: "copy" };
}

async function removeOwned(dest: string, mode: "symlink" | "copy") {
  if (mode === "symlink") await fs.unlink(dest);
  else await fs.rm(dest, { recursive: true, force: true });
}

async function copySkill(source: string, dest: string, sourceRelative: string) {
  await fs.cp(source, dest, { recursive: true });
  const digest = await hashDir(source);
  await fs.writeFile(
    path.join(dest, ".latch-source"),
    JSON.stringify({ sourceRelative, digest, from: LATCH_ROOT }, null, 2),
    "utf8",
  );
}

export async function mountSkill(
  skillName: string,
  target: MountTarget,
  preferSymlink = true,
): Promise<MountRecord> {
  const source = skillDir(skillName);
  const dest = path.join(target.path, target.skillDir, skillName);
  const sourceRelative = path.relative(LATCH_ROOT, source);

  await fs.mkdir(path.dirname(dest), { recursive: true });
  const existing = await inspectOwnership(dest, source);
  if (existing.exists && !existing.owned) {
    throw new MountConflictError(dest, "可能是用户手工放置的 skill 目录");
  }
  if (existing.exists) await removeOwned(dest, existing.mode);

  if (preferSymlink) {
    try {
      await fs.symlink(source, dest, "dir");
      return {
        skillName,
        targetId: target.id,
        dest,
        mode: "symlink",
        sourceRelative,
      };
    } catch {
      /* fall through to copy */
    }
  }

  await copySkill(source, dest, sourceRelative);
  return {
    skillName,
    targetId: target.id,
    dest,
    mode: "copy",
    sourceRelative,
  };
}

export async function unmountSkill(
  skillName: string,
  target: MountTarget,
): Promise<void> {
  const source = skillDir(skillName);
  const dest = path.join(target.path, target.skillDir, skillName);
  const existing = await inspectOwnership(dest, source);
  if (!existing.exists) return;
  if (!existing.owned) {
    throw new MountConflictError(dest, "不是 Latch 创建的挂载");
  }
  await removeOwned(dest, existing.mode);
}

export async function scanMounts(
  skillName: string,
  targets: MountTarget[],
): Promise<MountStatus[]> {
  const source = skillDir(skillName);
  let sourceHash = "";
  try {
    sourceHash = await hashDir(source);
  } catch {
    sourceHash = "";
  }

  const out: MountStatus[] = [];
  for (const target of targets) {
    const dest = path.join(target.path, target.skillDir, skillName);
    const own = await inspectOwnership(dest, source);
    let valid = own.owned;
    let sourceRelative = path.relative(LATCH_ROOT, source);
    let discovered = false;

    if (own.exists && own.mode === "copy") {
      const meta = await readSourceMeta(dest);
      if (meta) {
        sourceRelative = meta.sourceRelative ?? sourceRelative;
        valid = meta.digest === sourceHash && metaPointsIntoLibrary(meta);
      } else {
        valid = false;
      }
    }
    if (own.exists) {
      try {
        await fs.access(path.join(dest, "SKILL.md"));
        discovered = true;
      } catch {
        discovered = false;
      }
    }

    out.push({
      skillName,
      targetId: target.id,
      dest,
      mode: own.mode,
      sourceRelative,
      exists: own.exists,
      valid,
      owned: own.owned,
      discovered,
    });
  }
  return out;
}
