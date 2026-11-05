import fs from "node:fs/promises";
import { linkmapFile, routeDir, routeFile, ROUTES_DIR } from "./paths.js";

export type Expr =
  | string
  | { all: Expr[] }
  | { any: Expr[] }
  | { not: Expr };

export type RouteAction =
  | { kind: "run"; domain: string; then: string }
  | { kind: "ask"; slot: string; then: string }
  | { kind: "stop"; exit: 0 | 1; reason: string };

export type RouteLink = {
  id: string;
  when: Expr;
  to: RouteAction;
  priority?: number;
};

export type RouteStage = {
  scope: string[];
  links: RouteLink[];
};

export type ResultAtomSpec =
  | { from: "domain"; domain: string; field: "ok" }
  | { from: "slot"; slot: string; field: "answered" | "pass" };

export type RouteDefinition = {
  name: string;
  version: number;
  policy: "unique" | "first" | "priority";
  maxRounds: number;
  routingAtoms: string[];
  resultAtoms: Record<string, ResultAtomSpec>;
  constraints: string[];
  molecules: Record<string, Expr>;
  stages: Record<string, RouteStage>;
};

export type LinkmapStage = {
  scope: string[];
  feasible: number;
  links: {
    id: string;
    satisfying: number;
    minimalAssignment: Record<string, boolean> | null;
  }[];
};

export type Linkmap = {
  version: 1;
  route: string;
  generatedAt: string;
  routeHash: string;
  atomsHash: string;
  policy: string;
  stages: Record<string, LinkmapStage>;
  issueCount: number;
};

export async function listRoutes(): Promise<string[]> {
  try {
    const entries = await fs.readdir(ROUTES_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export async function readRoute(name: string): Promise<RouteDefinition> {
  const raw = await fs.readFile(routeFile(name), "utf8");
  return JSON.parse(raw) as RouteDefinition;
}

export async function writeRoute(def: RouteDefinition): Promise<void> {
  await fs.mkdir(routeDir(def.name), { recursive: true });
  await fs.writeFile(
    routeFile(def.name),
    `${JSON.stringify(def, null, 2)}\n`,
    "utf8",
  );
}

export async function readLinkmap(name: string): Promise<Linkmap | null> {
  try {
    return JSON.parse(await fs.readFile(linkmapFile(name), "utf8")) as Linkmap;
  } catch {
    return null;
  }
}

export async function writeLinkmap(name: string, linkmap: Linkmap): Promise<void> {
  await fs.mkdir(routeDir(name), { recursive: true });
  await fs.writeFile(
    linkmapFile(name),
    `${JSON.stringify(linkmap, null, 2)}\n`,
    "utf8",
  );
}
