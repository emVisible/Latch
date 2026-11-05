import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SKILLS_DIR, LATCH_ROOT } from "./paths.js";

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
};

async function hashDir(dir: string): Promise<string> {
  const h = crypto.createHash("sha256");
  async function walk(rel: string) {
    const full = path.join(dir, rel);
    const st = await fs.stat(full);
    if (st.isDirectory()) {
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

async function copySkill(source: string, dest: string, sourceRelative: string) {
  await fs.rm(dest, { recursive: true, force: true });
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
  const source = path.join(SKILLS_DIR, skillName);
  const dest = path.join(target.path, target.skillDir, skillName);
  const sourceRelative = path.relative(LATCH_ROOT, source);

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rm(dest, { recursive: true, force: true });

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
  const dest = path.join(target.path, target.skillDir, skillName);
  await fs.rm(dest, { recursive: true, force: true });
}

export async function scanMounts(
  skillName: string,
  targets: MountTarget[],
): Promise<MountStatus[]> {
  const source = path.join(SKILLS_DIR, skillName);
  let sourceHash = "";
  try {
    sourceHash = await hashDir(source);
  } catch {
    sourceHash = "";
  }

  const out: MountStatus[] = [];
  for (const target of targets) {
    const dest = path.join(target.path, target.skillDir, skillName);
    let exists = false;
    let valid = false;
    let mode: "symlink" | "copy" = "copy";
    let sourceRelative = path.relative(LATCH_ROOT, source);

    try {
      const st = await fs.lstat(dest);
      exists = true;
      if (st.isSymbolicLink()) {
        mode = "symlink";
        const resolved = await fs.realpath(dest);
        valid = resolved === (await fs.realpath(source));
      } else {
        mode = "copy";
        try {
          const meta = JSON.parse(
            await fs.readFile(path.join(dest, ".latch-source"), "utf8"),
          ) as { digest?: string; sourceRelative?: string };
          sourceRelative = meta.sourceRelative ?? sourceRelative;
          valid = meta.digest === sourceHash;
        } catch {
          valid = false;
        }
      }
    } catch {
      exists = false;
    }

    out.push({
      skillName,
      targetId: target.id,
      dest,
      mode,
      sourceRelative,
      exists,
      valid,
    });
  }
  return out;
}
