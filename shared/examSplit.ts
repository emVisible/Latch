import { spawnSync } from "node:child_process";
import path from "node:path";
import { LATCH_ROOT } from "./paths.js";

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
