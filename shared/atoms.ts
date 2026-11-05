import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ATOMS_DIR } from "./paths.js";
import type { Snapshot } from "./snapshot.js";

export type AtomOutcome = { value: boolean; hits?: string[] };
export type AtomFn = (snapshot: Snapshot) => AtomOutcome | boolean;
export type AtomRegistry = Record<string, AtomFn>;

export type AtomEvaluation = {
  values: Record<string, boolean>;
  hits: Record<string, string[]>;
  unknown: string[];
};

type Cached = { stamp: string; atoms: AtomRegistry; hash: string };
const cache = new Map<string, Cached>();

async function atomStamp(dir: string): Promise<{ stamp: string; hash: string }> {
  const h = crypto.createHash("sha256");
  const parts: string[] = [];
  async function walk(rel: string) {
    const full = path.join(dir, rel);
    const st = await fs.lstat(full);
    if (st.isDirectory()) {
      for (const k of (await fs.readdir(full)).sort()) await walk(path.join(rel, k));
    } else if (full.endsWith(".mjs")) {
      const buf = await fs.readFile(full);
      h.update(rel);
      h.update(buf);
      parts.push(`${rel}:${buf.length}:${st.mtimeMs}`);
    }
  }
  await walk("");
  return { stamp: parts.join("|"), hash: h.digest("hex").slice(0, 16) };
}

export async function loadAtomRegistry(
  dir: string = ATOMS_DIR,
): Promise<{ atoms: AtomRegistry; hash: string }> {
  const { stamp, hash } = await atomStamp(dir);
  const cached = cache.get(dir);
  if (cached && cached.stamp === stamp) {
    return { atoms: cached.atoms, hash: cached.hash };
  }
  const url = pathToFileURL(path.join(dir, "index.mjs"));
  url.searchParams.set("v", crypto.createHash("sha1").update(stamp).digest("hex").slice(0, 10));
  const mod = (await import(url.href)) as { atoms?: AtomRegistry };
  if (!mod.atoms || typeof mod.atoms !== "object") {
    throw new Error(`原子注册表缺少 atoms 导出：${path.join(dir, "index.mjs")}`);
  }
  const atoms = mod.atoms;
  cache.set(dir, { stamp, atoms, hash });
  return { atoms, hash };
}

export function evaluateAtoms(
  names: string[],
  snapshot: Snapshot,
  registry: AtomRegistry,
): AtomEvaluation {
  const values: Record<string, boolean> = {};
  const hits: Record<string, string[]> = {};
  const unknown: string[] = [];
  for (const name of names) {
    const fn = registry[name];
    if (typeof fn !== "function") {
      unknown.push(name);
      values[name] = false;
      continue;
    }
    const outcome = fn(snapshot);
    if (typeof outcome === "boolean") {
      values[name] = outcome;
    } else {
      values[name] = Boolean(outcome.value);
      if (outcome.hits?.length) hits[name] = outcome.hits;
    }
  }
  return { values, hits, unknown };
}

export async function atomNames(dir: string = ATOMS_DIR): Promise<string[]> {
  const { atoms } = await loadAtomRegistry(dir);
  return Object.keys(atoms).sort();
}
