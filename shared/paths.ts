import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev: shared/paths.ts -> <repo>. Compiled: dist/shared/paths.js -> <repo>/dist.
 * library/ and settings.json live at the repo root in both cases.
 */
function findRoot(): string {
  const candidates = [path.resolve(here, ".."), path.resolve(here, "..", "..")];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "settings.json")) ||
      fs.existsSync(path.join(candidate, "library", "skills"))
    ) {
      return candidate;
    }
  }
  return candidates[0];
}

export const LATCH_ROOT = findRoot();
export const LIBRARY_DIR = path.join(LATCH_ROOT, "library");
export const SKILLS_DIR = path.join(LIBRARY_DIR, "skills");
export const DOMAINS_DIR = path.join(LIBRARY_DIR, "domains");
export const ROUTES_DIR = path.join(LIBRARY_DIR, "routes");
export const ATOMS_DIR = path.join(LIBRARY_DIR, "atoms");
export const SETTINGS_PATH = path.join(LATCH_ROOT, "settings.json");

/** Reject anything that could escape library/ via an API or CLI parameter. */
export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSafeName(name: string): string {
  if (!NAME_RE.test(name)) {
    throw new Error(`非法名称「${name}」：只允许小写字母、数字与单个连字符`);
  }
  return name;
}

export function resolveWithin(base: string, ...parts: string[]): string {
  const full = path.resolve(base, ...parts);
  const root = path.resolve(base) + path.sep;
  if (full !== path.resolve(base) && !full.startsWith(root)) {
    throw new Error(`路径越界：${full}`);
  }
  return full;
}

export function routeDir(name: string): string {
  return resolveWithin(ROUTES_DIR, assertSafeName(name));
}

export function routeFile(name: string): string {
  return path.join(routeDir(name), "route.json");
}

export function linkmapFile(name: string): string {
  return path.join(routeDir(name), "linkmap.json");
}

export function domainDir(name: string): string {
  return resolveWithin(DOMAINS_DIR, assertSafeName(name));
}

export function domainFile(name: string): string {
  return path.join(domainDir(name), "domain.json");
}

export function skillDir(name: string): string {
  return resolveWithin(SKILLS_DIR, assertSafeName(name));
}

export function routeFixturesDir(name: string): string {
  return path.join(routeDir(name), "fixtures");
}
