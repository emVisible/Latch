import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { LATCH_ROOT } from "./paths.js";

function under(root: string, file: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(file);
  return target === base || target.startsWith(base + path.sep);
}

/**
 * Grading from a tree that contains this card's SKILL.md or the atom source
 * is the author grading their own paper. Identity is the files on disk, not the git committer.
 */
export async function authorGradeIssue(cwd: string, cardName: string): Promise<string | null> {
  const files = [
    path.join(cwd, "library", "cards", cardName, "SKILL.md"),
    path.join(cwd, "library", "atoms", "index.mjs"),
  ];
  for (const file of files) {
    if (!under(cwd, file)) continue;
    try {
      await fs.access(file);
      return "作者不能批自己的卷：批改读得到这张卡的 SKILL.md 或原子源码";
    } catch {
      /* this cwd cannot see that file */
    }
  }
  return null;
}

function lastCommit(cwd: string, file: string): string | null {
  const result = spawnSync("git", ["log", "-1", "--format=%H", "--", file], {
    cwd,
    encoding: "utf8",
  });
  const hash = result.stdout?.trim();
  return hash || null;
}

/** Null when the exam is outside this Latch checkout, or the two files were last touched by different commits. */
export function authoringSplitIssue(examFile: string): string | null {
  const exam = path.resolve(examFile);
  const root = path.resolve(LATCH_ROOT);
  if (exam !== root && !exam.startsWith(root + path.sep)) return null;
  const examCommit = lastCommit(root, exam);
  const atomCommit = lastCommit(root, path.join(root, "library", "atoms", "index.mjs"));
  if (!examCommit || !atomCommit || examCommit === atomCommit) {
    return "考卷和原子在同一次提交里，不能晋升";
  }
  return null;
}
