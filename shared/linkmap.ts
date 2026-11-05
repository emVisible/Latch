import crypto from "node:crypto";
import { collectRefs, evalExpr, validateMolecules } from "./molecule.js";
import { validateRoute } from "./schema.js";
import type {
  Linkmap,
  LinkmapStage,
  RouteDefinition,
  RouteLink,
} from "./route.js";

export type CompileIssue = {
  code: string;
  severity: "error" | "warning";
  stage?: string;
  message: string;
};

export type CompileContext = {
  domainNames: string[];
  atomNames: string[];
  routeHash?: string;
  atomsHash?: string;
};

export type CompileReport = {
  ok: boolean;
  route: string;
  issues: CompileIssue[];
  stages: Record<string, LinkmapStage>;
  masks: Record<string, Record<string, number[]>>;
  linkmap: Linkmap;
};

export function hashRoute(route: RouteDefinition): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(route))
    .digest("hex")
    .slice(0, 16);
}

function parseConstraint(c: string): [string, string] | null {
  const m = c.match(/^\s*([\w.]+)\s*=>\s*([\w.]+)\s*$/);
  return m ? [m[1], m[2]] : null;
}

function feasible(
  values: Record<string, boolean>,
  constraints: [string, string][],
): boolean {
  for (const [a, b] of constraints) {
    if (!(a in values) || !(b in values)) continue;
    if (values[a] && !values[b]) return false;
  }
  return true;
}

function sameMask(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function findCycles(edges: Record<string, { to: string; ask: boolean }[]>): string[][] {
  const cycles: string[][] = [];
  const visiting: string[] = [];
  const done = new Set<string>();
  function dfs(node: string) {
    if (done.has(node)) return;
    if (visiting.includes(node)) {
      cycles.push([...visiting.slice(visiting.indexOf(node)), node]);
      return;
    }
    visiting.push(node);
    for (const e of edges[node] ?? []) {
      // A monotone `ask` self-loop is explicitly allowed by the design.
      if (e.to === node && e.ask) continue;
      dfs(e.to);
    }
    visiting.pop();
    done.add(node);
  }
  for (const node of Object.keys(edges)) dfs(node);
  return cycles;
}

export function compileRoute(
  route: RouteDefinition,
  ctx: CompileContext,
): CompileReport {
  const issues: CompileIssue[] = [];
  for (const message of validateRoute(route)) {
    issues.push({ code: "schema", severity: "error", message });
  }

  const resultAtomNames = Object.keys(route.resultAtoms ?? {});
  const knownNames = new Set([
    ...ctx.atomNames,
    ...resultAtomNames,
    ...(route.routingAtoms ?? []),
  ]);
  for (const message of validateMolecules(route.molecules ?? {}, knownNames)) {
    issues.push({ code: "molecule", severity: "error", message });
  }

  const allScopes = new Set(
    Object.values(route.stages ?? {}).flatMap((s) => s.scope ?? []),
  );
  const domainSet = new Set(ctx.domainNames);
  const slotNames = new Set(
    Object.values(route.resultAtoms ?? {})
      .filter((s) => s.from === "slot")
      .map((s) => ("slot" in s ? s.slot : "")),
  );
  const stageIds = new Set(Object.keys(route.stages ?? {}));
  const referencedDomains = new Set<string>();
  const edges: Record<string, { to: string; ask: boolean }[]> = {};
  const masks: Record<string, Record<string, number[]>> = {};
  const stages: Record<string, LinkmapStage> = {};

  for (const [stageId, stage] of Object.entries(route.stages ?? {})) {
    edges[stageId] = [];
    const scope = stage.scope ?? [];
    const constraints = (route.constraints ?? [])
      .map(parseConstraint)
      .filter((c): c is [string, string] => c !== null);
    const linkMasks: Record<string, number[]> = {};
    for (const link of stage.links ?? []) linkMasks[link.id] = [];

    for (const ref of collectRefs({ all: (stage.links ?? []).map((l) => l.when) })) {
      if (!(ref in (route.molecules ?? {})) && !scope.includes(ref)) {
        issues.push({
          code: "reference",
          severity: "error",
          stage: stageId,
          message: `${ref} 既不是已声明分子，也不在 ${stageId}.scope 中`,
        });
      }
    }

    if (scope.length > 16) {
      issues.push({
        code: "scope",
        severity: "error",
        stage: stageId,
        message: `scope 有 ${scope.length} 个原子，超过 2^16 穷举上限；请改用 BDD/SMT（v1.1）`,
      });
      stages[stageId] = { scope, feasible: 0, links: [] };
      masks[stageId] = linkMasks;
      continue;
    }

    let feasibleCount = 0;
    const gaps: number[] = [];
    const overlaps: { mask: number; ids: string[] }[] = [];
    const total = 1 << scope.length;

    for (let mask = 0; mask < total; mask++) {
      const values: Record<string, boolean> = {};
      scope.forEach((name, i) => {
        values[name] = (mask & (1 << i)) !== 0;
      });
      if (!feasible(values, constraints)) continue;
      feasibleCount++;
      const hits: string[] = [];
      for (const link of stage.links ?? []) {
        let hit = false;
        try {
          hit = evalExpr(link.when, values, route.molecules ?? {});
        } catch {
          hit = false;
        }
        if (hit) {
          hits.push(link.id);
          linkMasks[link.id].push(mask);
        }
      }
      if (hits.length === 0) gaps.push(mask);
      if (hits.length > 1) overlaps.push({ mask, ids: hits });
    }

    if (gaps.length > 0) {
      const vals: Record<string, boolean> = {};
      scope.forEach((name, i) => (vals[name] = (gaps[0] & (1 << i)) !== 0));
      issues.push({
        code: "coverage",
        severity: "error",
        stage: stageId,
        message: `${gaps.length} 种可行赋值没有命中任何 link，例如 ${JSON.stringify(vals)}`,
      });
    }
    if (overlaps.length > 0) {
      const first = overlaps[0];
      const vals: Record<string, boolean> = {};
      scope.forEach((name, i) => (vals[name] = (first.mask & (1 << i)) !== 0));
      issues.push({
        code: "overlap",
        severity: route.policy === "unique" ? "error" : "warning",
        stage: stageId,
        message: `${overlaps.length} 种赋值同时命中 ${first.ids.join(" 与 ")}，例如 ${JSON.stringify(vals)}`,
      });
    }

    const links = stage.links ?? [];
    for (const link of links) {
      if (linkMasks[link.id].length === 0) {
        issues.push({
          code: "reachability",
          severity: "error",
          stage: stageId,
          message: `link ${link.id} 永假（没有任何可行赋值命中）`,
        });
      }
      const to = link.to;
      if (to.kind === "run") {
        referencedDomains.add(to.domain);
        if (!domainSet.has(to.domain)) {
          issues.push({
            code: "reference",
            severity: "error",
            stage: stageId,
            message: `link ${link.id} 引用了不存在的域 ${to.domain}`,
          });
        }
      }
      if (to.kind === "ask" && !slotNames.has(to.slot)) {
        issues.push({
          code: "reference",
          severity: "error",
          stage: stageId,
          message: `link ${link.id} 询问了未声明的 slot ${to.slot}`,
        });
      }
      if (to.kind !== "stop") {
        if (!stageIds.has(to.then)) {
          issues.push({
            code: "reference",
            severity: "error",
            stage: stageId,
            message: `link ${link.id} 的 then 指向不存在的阶段 ${to.then}`,
          });
        }
        edges[stageId].push({ to: to.then, ask: to.kind === "ask" });
      }
    }

    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        if (sameMask(linkMasks[links[i].id], linkMasks[links[j].id])) {
          issues.push({
            code: "minimality",
            severity: "error",
            stage: stageId,
            message: `link ${links[i].id} 与 ${links[j].id} 语义等价（真值表相同）`,
          });
        }
      }
    }

    stages[stageId] = {
      scope,
      feasible: feasibleCount,
      links: links.map((link: RouteLink) => {
        const first = linkMasks[link.id][0];
        let minimal: Record<string, boolean> | null = null;
        if (first !== undefined) {
          minimal = {};
          scope.forEach((name, i) => (minimal![name] = (first & (1 << i)) !== 0));
        }
        return {
          id: link.id,
          satisfying: linkMasks[link.id].length,
          minimalAssignment: minimal,
        };
      }),
    };
    masks[stageId] = linkMasks;
  }

  // Stage graph: reachability from entry, and cycles other than monotone ask self-loops.
  if (stageIds.has("entry")) {
    const seen = new Set<string>(["entry"]);
    const queue = ["entry"];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges[cur] ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    for (const id of stageIds) {
      if (!seen.has(id)) {
        issues.push({
          code: "connectivity",
          severity: "error",
          message: `阶段 ${id} 从 entry 不可达`,
        });
      }
    }
  }
  for (const cycle of findCycles(edges)) {
    issues.push({
      code: "termination",
      severity: "error",
      message: `阶段转移存在环：${cycle.join(" -> ")}`,
    });
  }

  for (const spec of Object.values(route.resultAtoms ?? {})) {
    if (spec.from === "domain" && !referencedDomains.has(spec.domain)) {
      issues.push({
        code: "orphan",
        severity: "error",
        message: `resultAtoms 声明了域 ${spec.domain}，但没有任何 link 执行它`,
      });
    }
  }
  for (const name of route.routingAtoms ?? []) {
    if (!allScopes.has(name) && !Object.values(route.molecules ?? {}).some((m) => collectRefs(m).has(name))) {
      issues.push({
        code: "orphan",
        severity: "error",
        message: `原子 ${name} 未参与任何阶段的判定`,
      });
    }
  }
  for (const name of resultAtomNames) {
    if (!allScopes.has(name)) {
      issues.push({
        code: "orphan",
        severity: "error",
        message: `结果原子 ${name} 未出现在任何 stage.scope`,
      });
    }
  }

  const routeHash = ctx.routeHash ?? hashRoute(route);
  const atomsHash = ctx.atomsHash ?? "";
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const linkmap: Linkmap = {
    version: 1,
    route: route.name,
    generatedAt: new Date().toISOString(),
    routeHash,
    atomsHash,
    policy: route.policy,
    stages,
    issueCount: errorCount,
  };
  return {
    ok: errorCount === 0,
    route: route.name,
    issues,
    stages,
    masks,
    linkmap,
  };
}

export function formatCompileReport(report: CompileReport): string {
  const lines = [
    `Latch · route ${report.route} --check`,
    `结果：${report.ok ? "通过" : "未通过"}（${report.issues.filter((i) => i.severity === "error").length} 个错误 / ${report.issues.filter((i) => i.severity === "warning").length} 个警告）`,
    "",
  ];
  for (const [id, st] of Object.entries(report.stages)) {
    lines.push(`  ${id}: ${st.scope.length} 原子 / ${st.feasible} 种可行赋值 / ${st.links.length} 条 link`);
    for (const l of st.links) lines.push(`    ${l.id}: ${l.satisfying} 种`);
  }
  if (report.issues.length) {
    lines.push("", "问题：");
    for (const i of report.issues) {
      lines.push(`  [${i.severity}] ${i.code}${i.stage ? `@${i.stage}` : ""}: ${i.message}`);
    }
  }
  lines.push("", `routeHash=${report.linkmap.routeHash} atomsHash=${report.linkmap.atomsHash}`);
  return lines.join("\n");
}
