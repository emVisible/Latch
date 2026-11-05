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
};
