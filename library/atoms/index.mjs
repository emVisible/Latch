import { matchAdded, matchPaths, result } from "./lib/diff.mjs";

/*
 * Shared atom registry.
 * Every atom is a pure function atom(snapshot) -> { value, hits }.
 * `value: true` means the fact is present (for discipline atoms: a breach).
 * Snapshot is produced once by shared/snapshot.ts; atoms never shell out to git.
 */
export const atoms = {
  "diff.useEffect": (snapshot) => {
    const hits = matchAdded(snapshot, /\buseEffect\s*\(/);
    return result(hits.length > 0, hits);
  },

  "diff.tabKeepalive": (snapshot) => {
    const hits = matchAdded(snapshot, (line) =>
      /\bvisitedTabs\b/.test(line) ||
      /display:\s*["']none["']/.test(line) ||
      /style=\{\{[^}]*display:\s*["']none["']/.test(line),
    );
    return result(hits.length > 0, hits);
  },

  "diff.earlyReturnToTernary": (snapshot) => {
    const hits = matchAdded(snapshot, (line) =>
      /^\+\s*const \w+ = .+&&.+ \? .+ :/.test(line) ||
      /^\+\s*const \w+ = .+\? .+ : \[\]/.test(line) ||
      /^\+\s*return .+ \? .+ : null;/.test(line),
    );
    return result(hits.length > 0, hits);
  },

  "diff.moduleConstCamel": (snapshot) => {
    const hits = matchAdded(snapshot, (line) => {
      const m = line.match(
        /^\+\s*(?:export\s+)?const ([a-z][a-zA-Z0-9]*) = ([\d"'`]|true|false)/,
      );
      if (!m) return false;
      const name = m[1];
      if (name.startsWith("use") || name.endsWith("Ref")) return false;
      return !/^(default|async)$/.test(name);
    });
    return result(hits.length > 0, hits);
  },

  "paths.charts": (snapshot) => {
    const hits = matchPaths(snapshot, /(?:^|\/)components\/charts\/|OptionAnalysisCard/i);
    return result(hits.length > 0, hits);
  },

  "task.present": (snapshot) => result(Boolean(snapshot.task), []),

  "claim.unsourced": (snapshot) => {
    const returns = snapshot.task?.returns ?? [];
    const hits = returns.filter((item) => !item.path).map((item) => item.fact);
    return result(Boolean(snapshot.task) && hits.length > 0, hits);
  },

  "claim.unresolved": (snapshot) => {
    const returns = snapshot.task?.returns ?? [];
    const files = snapshot.files ?? {};
    const hits = [];
    for (const item of returns) {
      if (!item.path) continue;
      const actual = files[item.path];
      if (!item.sha256 || !actual || actual !== item.sha256) hits.push(item.path);
    }
    return result(Boolean(snapshot.task) && hits.length > 0, hits);
  },

  "write.undeclared": (snapshot) => {
    if (!snapshot.task) return result(false, []);
    const allow = new Set(snapshot.task.writable ?? []);
    const hits = (snapshot.changedPaths ?? []).filter(
      (p) => p && !p.startsWith(".latch/") && !allow.has(p),
    );
    return result(hits.length > 0, hits);
  },

  "map.hit": (snapshot) =>
    result(snapshot.map?.state === "hit", snapshot.map?.entryId ? [snapshot.map.entryId] : []),

  "map.miss": (snapshot) => result(!snapshot.map || snapshot.map.state === "miss", []),

  "map.ambiguous": (snapshot) => result(snapshot.map?.state === "ambiguous", []),
};
