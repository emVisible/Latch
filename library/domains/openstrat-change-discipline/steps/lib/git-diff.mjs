import { execSync } from "node:child_process";

export function gitDiffLines(cwd = process.env.LATCH_CWD || process.cwd()) {
  let diff = "";
  try {
    diff = execSync("git diff HEAD", {
      cwd,
      encoding: "utf8",
      maxBuffer: 4_000_000,
    });
  } catch {
    try {
      diff = execSync("git diff", {
        cwd,
        encoding: "utf8",
        maxBuffer: 4_000_000,
      });
    } catch {
      return { diff: "", added: [], removed: [] };
    }
  }
  const lines = diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
  return { diff, added, removed };
}

export function fail(title, hits, limit = 8) {
  console.error(`Latch: ${title}`);
  for (const line of hits.slice(0, limit)) {
    console.error(line);
  }
  if (hits.length > limit) {
    console.error(`… 另有 ${hits.length - limit} 行`);
  }
  process.exit(1);
}
