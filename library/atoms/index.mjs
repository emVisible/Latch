import { matchAdded, result } from "./lib/diff.mjs";

function evidenceCovers(evidence, returnPath) {
  return (
    evidence === returnPath ||
    evidence.endsWith(`/${returnPath}`) ||
    returnPath.endsWith(`/${evidence}`)
  );
}

/*
 * Shared atom registry.
 * Every atom is a pure function atom(snapshot) -> { value, hits }.
 * Discipline atoms are false unless latch.policy.json enables them, so a
 * runtime assignment stays inside the route compiler's constraints.
 * Snapshot is produced once by shared/snapshot.ts; atoms never shell out to git.
 */

function enabled(snapshot) {
  return snapshot.policy?.changeDiscipline?.enabled === true;
}

function commentLine(line) {
  return /^\+\s*(?:\/\/|\/\*|\*)/.test(line);
}

function moduleConstName(line, pattern) {
  const match = line.match(pattern);
  return match ? match[1] : null;
}

const CAMEL_CONST =
  /^\+\s*(?:export\s+)?const ([a-z][a-zA-Z0-9]*) = ([\d"'`]|true|false)/;
const SNAKE_CONST =
  /^\+\s*(?:export\s+)?const ([A-Z][A-Z0-9_]*) = ([\d"'`]|true|false)/;

export const atoms = {
  "policy.active": (snapshot) => result(enabled(snapshot), []),

  "changes.present": (snapshot) => {
    const paths = (snapshot.changedPaths ?? []).filter(
      (p) => p && !p.startsWith(".latch/"),
    );
    const lines =
      (snapshot.added ?? []).length + (snapshot.removed ?? []).length > 0;
    const knownPaths = (snapshot.changedPaths ?? []).length > 0;
    // .latch bookkeeping is not a code change. Lines with no path (fixtures) still count.
    const present = paths.length > 0 || (lines && !knownPaths);
    return result(present, paths);
  },

  "diff.useEffect": (snapshot) => {
    if (!enabled(snapshot)) return result(false, []);
    const hits = matchAdded(snapshot, /\buseEffect\s*\(/);
    return result(hits.length > 0, hits);
  },

  "diff.tabKeepalive": (snapshot) => {
    if (!enabled(snapshot)) return result(false, []);
    const hits = matchAdded(snapshot, (line) => {
      if (commentLine(line)) return false;
      return (
        /\bvisitedTabs\b/.test(line) ||
        /display:\s*["']none["']/.test(line) ||
        /style=\{\{[^}]*display:\s*["']none["']/.test(line)
      );
    });
    return result(hits.length > 0, hits);
  },

  "diff.earlyReturnToTernary": (snapshot) => {
    if (!enabled(snapshot)) return result(false, []);
    const hits = matchAdded(snapshot, (line) =>
      /^\+\s*const \w+ = .+&&.+ \? .+ :/.test(line) ||
      /^\+\s*const \w+ = .+\? .+ : \[\]/.test(line) ||
      /^\+\s*return .+ \? .+ : null;/.test(line),
    );
    return result(hits.length > 0, hits);
  },

  "diff.moduleConstCase": (snapshot) => {
    if (!enabled(snapshot)) return result(false, []);
    const mode = snapshot.policy.changeDiscipline.moduleConstCase;
    if (mode === "off" || !mode) return result(false, []);
    const hits = matchAdded(snapshot, (line) => {
      if (mode === "screaming-snake") {
        const name = moduleConstName(line, CAMEL_CONST);
        if (!name) return false;
        if (name.startsWith("use") || name.endsWith("Ref")) return false;
        return !/^(default|async)$/.test(name);
      }
      const name = moduleConstName(line, SNAKE_CONST);
      return Boolean(name && name.includes("_"));
    });
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
    const steps = snapshot.session?.steps ?? [];
    const hits = [];
    for (const item of returns) {
      if (!item.path) continue;
      const actual = files[item.path];
      const inSession = steps.some(
        (step) => evidenceCovers(step.evidence, item.path) && step.sha256 === item.sha256,
      );
      if (!item.sha256 || !actual || actual !== item.sha256 || !inSession) hits.push(item.path);
    }
    if (snapshot.map?.state === "hit") {
      const location = snapshot.map.location || "";
      const observe = snapshot.map.observe || "";
      const target = snapshot.map.app || "";
      const listed = steps.some(
        (step) =>
          step.target === target &&
          step.position === location &&
          step.at === location &&
          step.observe === observe &&
          step.sha256,
      );
      if (snapshot.session?.target !== target || !location || !observe || !listed) {
        hits.push(location || snapshot.map.entryId || "map");
      }
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
