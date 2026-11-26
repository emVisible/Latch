import fs from "node:fs/promises";
import path from "node:path";
import { evaluateAtoms, loadAtomRegistry, atomNames } from "./atoms.js";
import { listDomains, readDomain } from "./domain.js";
import {
  appendEntry,
  ensureLatchGitignore,
  isJournalValid,
  newJournal,
  readJournal,
  writeJournal,
  type Journal,
} from "./journal.js";
import { compileRoute, formatCompileReport, hashRoute } from "./linkmap.js";
import { evalExpr } from "./molecule.js";
import { readLinkmap, readRoute, writeLinkmap } from "./route.js";
import type { CompileReport } from "./linkmap.js";
import type { RouteDefinition, RouteLink } from "./route.js";
import { validateRoute } from "./schema.js";
import { collectSnapshot, SnapshotError, type Snapshot } from "./snapshot.js";
import { noteSightings, routeDeclaresSlot } from "./card.js";
import { LeaseError, acquireLease, gitRoot, stampLease } from "./lease.js";
import { runMapFollow } from "./map.js";
import { formatRunOutput, runDomain } from "./runner.js";
import { routeFixturesDir } from "./paths.js";

export type RouteRunResult = {
  route: string;
  cwd: string;
  repo: string;
  window: string;
  snapshotHash: string;
  exitCode: number;
  status: Journal["status"];
  ok: boolean;
  log: string[];
  linkId?: string;
  stage?: string;
  pendingSlot?: string;
  journal: Journal;
  compile?: CompileReport;
};

export type CheckResult = {
  report: CompileReport;
  linkmapWritten: boolean;
};

/**
 * The receipt writer adds `.latch/` to .gitignore on first use. That file is
 * itself part of the worktree snapshot, so create it BEFORE hashing; otherwise
 * the very first slot answer would be invalidated by the next route run.
 */
async function collectStableSnapshot(
  cwd: string,
  windowSpec: string,
): Promise<Snapshot> {
  let snapshot = await collectSnapshot(cwd, windowSpec);
  const changed = await ensureLatchGitignore(snapshot.repo);
  if (changed) snapshot = await collectSnapshot(cwd, windowSpec);
  return snapshot;
}

function resultValues(
  journal: Journal,
  route: RouteDefinition,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, spec] of Object.entries(route.resultAtoms ?? {})) {
    if (spec.from === "domain") {
      out[name] = journal.runResults[spec.domain]?.ok ?? false;
    } else {
      const answer = journal.slotAnswers[spec.slot];
      out[name] =
        spec.field === "answered" ? answer !== undefined : answer === "pass";
    }
  }
  return out;
}

async function loadCompile(
  route: RouteDefinition,
  atomsHash: string,
): Promise<CompileReport> {
  return compileRoute(route, {
    domainNames: await listDomains(),
    atomNames: await atomNames(),
    routeHash: hashRoute(route),
    atomsHash,
  });
}

export async function checkRoute(
  name: string,
  options: { write?: boolean; fixture?: string } = {},
): Promise<CheckResult> {
  const route = await readRoute(name);
  const registry = await loadAtomRegistry();
  const report = await loadCompile(route, registry.hash);
  let linkmapWritten = false;
  if (options.write && report.ok) {
    await writeLinkmap(name, report.linkmap);
    linkmapWritten = true;
  }
  return { report, linkmapWritten };
}

export async function explainRoute(
  name: string,
  cwd: string,
  windowSpec = "worktree",
): Promise<string> {
  const route = await readRoute(name);
  const registry = await loadAtomRegistry();
  const snapshot = await collectSnapshot(cwd, windowSpec);
  const evaluation = evaluateAtoms(route.routingAtoms, snapshot, registry.atoms);
  const values: Record<string, boolean> = { ...evaluation.values };
  const lines = [
    `Latch · explain ${name}`,
    `window=${snapshot.window} snapshotHash=${snapshot.hash}`,
    "",
    "原子真值：",
  ];
  for (const atom of route.routingAtoms) {
    lines.push(`  ${atom}=${values[atom] ? 1 : 0}${evaluation.hits[atom]?.length ? ` · ${evaluation.hits[atom][0]}` : ""}`);
  }
  lines.push("", "分子：");
  for (const [name, expr] of Object.entries(route.molecules ?? {})) {
    lines.push(`  ${name}=${evalExpr(expr, values, route.molecules ?? {}) ? 1 : 0}`);
  }
  const journal = await readJournal(snapshot.repo);
  const merged = { ...values, ...resultValues(journal ?? newJournal({
    route: name,
    repo: snapshot.repo,
    window: snapshot.window,
    snapshotHash: snapshot.hash,
    routeHash: hashRoute(route),
    atomsHash: registry.hash,
  }), route) };
  lines.push("", "当前状态下各阶段命中的 link：");
  for (const [stageId, stage] of Object.entries(route.stages)) {
    const hits = stage.links
      .filter((l) => evalExpr(l.when, merged, route.molecules ?? {}))
      .map((l) => l.id);
    lines.push(`  ${stageId}: ${hits.join(" 与 ") || "（无命中）"}`);
  }
  return lines.join("\n");
}

function pickLink(
  links: RouteLink[],
  values: Record<string, boolean>,
  molecules: RouteDefinition["molecules"],
  policy: RouteDefinition["policy"],
): { link?: RouteLink; error?: string } {
  const hits = links.filter((l) => evalExpr(l.when, values, molecules));
  if (hits.length === 1) return { link: hits[0] };
  if (hits.length === 0) {
    return { error: `没有 link 命中，原子真值 ${JSON.stringify(values)}` };
  }
  if (policy === "first") return { link: hits[0] };
  if (policy === "priority") {
    return {
      link: [...hits].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0],
    };
  }
  return { error: `${hits.length} 条 link 同时命中：${hits.map((h) => h.id).join(" 与 ")}` };
}

export async function runRoute(
  name: string,
  cwd: string,
  options: { window?: string; print?: boolean; session?: string } = {},
): Promise<RouteRunResult> {
  const windowSpec = options.window ?? "worktree";
  const route = await readRoute(name);
  const schemaIssues = validateRoute(route);
  const registry = await loadAtomRegistry();

  const compile = await loadCompile(route, registry.hash);
  const base = {
    route: name,
    cwd,
    repo: path.resolve(cwd),
    window: windowSpec,
    snapshotHash: "",
  };

  if (options.print) {
    return {
      ...base,
      exitCode: compile.ok ? 0 : 2,
      status: "passed",
      ok: compile.ok,
      log: [formatCompileReport(compile)],
      journal: newJournal({
        route: name,
        repo: base.repo,
        window: windowSpec,
        snapshotHash: "",
        routeHash: compile.linkmap.routeHash,
        atomsHash: registry.hash,
      }),
      compile,
    };
  }

  if (schemaIssues.length > 0 || !compile.ok) {
    return {
      ...base,
      exitCode: 2,
      status: "failed",
      ok: false,
      log: [formatCompileReport(compile), ...schemaIssues],
      journal: newJournal({
        route: name,
        repo: base.repo,
        window: windowSpec,
        snapshotHash: "",
        routeHash: compile.linkmap.routeHash,
        atomsHash: registry.hash,
      }),
      compile,
    };
  }

  let release = async () => {};
  try {
    release = await acquireLease(gitRoot(cwd), options.session || undefined);
  } catch (e) {
    if (e instanceof LeaseError) {
      return {
        ...base,
        exitCode: 1,
        status: "blocked",
        ok: false,
        log: [`[租约] ${e.message}`],
        journal: newJournal({
          route: name,
          repo: base.repo,
          window: windowSpec,
          snapshotHash: "",
          routeHash: compile.linkmap.routeHash,
          atomsHash: registry.hash,
        }),
        compile,
      };
    }
    throw e;
  }

  try {
  let snapshot: Snapshot;
  try {
    snapshot = await collectStableSnapshot(cwd, windowSpec);
  } catch (e) {
    const reason = e instanceof SnapshotError ? e.message : String(e);
    return {
      ...base,
      exitCode: 3,
      status: "failed",
      ok: false,
      log: [`[快照不可用] ${reason}`],
      journal: newJournal({
        route: name,
        repo: base.repo,
        window: windowSpec,
        snapshotHash: "",
        routeHash: compile.linkmap.routeHash,
        atomsHash: registry.hash,
      }),
      compile,
    };
  }

  const evaluation = evaluateAtoms(route.routingAtoms, snapshot, registry.atoms);
  const binding = {
    route: name,
    repo: snapshot.repo,
    window: snapshot.window,
    snapshotHash: snapshot.hash,
    routeHash: compile.linkmap.routeHash,
    atomsHash: registry.hash,
  };
  const log: string[] = [
    `Latch · route ${name}`,
    `cwd: ${snapshot.repo}`,
    `window=${snapshot.window} snapshotHash=${snapshot.hash.slice(0, 12)}`,
    "",
    ...route.routingAtoms.map((a) => `  ${a}=${evaluation.values[a] ? 1 : 0}`),
    "",
  ];

  await noteSightings(snapshot.repo, evaluation.values, snapshot.hash);

  if (evaluation.unknown.length > 0) {
    log.push(`[原子缺失] ${evaluation.unknown.join(", ")}`);
    return {
      ...base,
      repo: snapshot.repo,
      snapshotHash: snapshot.hash,
      exitCode: 3,
      status: "failed",
      ok: false,
      log,
      journal: newJournal(binding),
      compile,
    };
  }

  const previous = await readJournal(snapshot.repo);
  const reusable: boolean = previous ? isJournalValid(previous, binding) : false;
  await stampLease(snapshot.repo, snapshot.hash);
  const journal = newJournal(binding);
  journal.payload = snapshot.map ? { map: snapshot.map } : {};
  if (reusable && previous) {
    journal.slotAnswers = { ...previous.slotAnswers };
  } else if (previous) {
    log.push(`[回执作废] 上一次状态不适用于当前快照 / 路由（旧 ${previous.status}）`);
  }

  let exitCode = 4;
  let status: Journal["status"] = "failed";
  let lastLink: string | undefined;
  let lastStage: string | undefined;
  let pendingSlot: string | undefined;

  for (let round = 0; round < route.maxRounds; round++) {
    const stageId = journal.currentStage;
    const stage = route.stages[stageId];
    if (!stage) {
      log.push(`[编译失败] 未知阶段 ${stageId}`);
      exitCode = 2;
      status = "failed";
      break;
    }
    const values = { ...evaluation.values, ...resultValues(journal, route) };
    const { link, error } = pickLink(
      stage.links,
      values,
      route.molecules,
      route.policy,
    );
    if (!link) {
      log.push(`[路由失败] ${stageId}: ${error}`);
      exitCode = 2;
      status = "failed";
      break;
    }
    lastLink = link.id;
    lastStage = stageId;
    log.push(`  link ${stageId}/${link.id} → ${link.to.kind}`);
    appendEntry(journal, {
      stage: stageId,
      atomValues: values,
      linkId: link.id,
      action: JSON.stringify(link.to),
    });

    const to = link.to;
    if (to.kind === "stop") {
      log.push(`  ${to.reason}`);
      const hint = stopHint(link.id, snapshot.repo);
      if (hint && to.exit !== 0) log.push(`  ${hint}`);
      exitCode = to.exit;
      status = exitCode === 0 ? "passed" : "blocked";
      break;
    }

    if (to.kind === "ask") {
      if (journal.slotAnswers[to.slot] === undefined) {
        pendingSlot = to.slot;
        log.push(`  [待答 slot] ${to.slot}`);
        const domain = await findSlotQuestion(route, to.slot);
        if (domain) log.push(`  问题：${domain}`);
        const windowArg =
          windowSpec === "worktree" ? "" : ` --window ${windowSpec}`;
        log.push(
          `  作答：npm run latch -- slot ${name} ${to.slot}=pass --cwd ${snapshot.repo}${windowArg}`,
        );
        exitCode = 5;
        status = "awaiting-slot";
        break;
      }
      log.push(`  slot ${to.slot}=${journal.slotAnswers[to.slot]}`);
      if (to.then === stageId && round >= route.maxRounds - 1) {
        log.push("[终止] ask 自环达到 maxRounds 上限");
        exitCode = 4;
        status = "failed";
        break;
      }
      journal.currentStage = to.then;
      continue;
    }

    if (to.kind === "goto") {
      if (to.then === stageId && round >= route.maxRounds - 1) {
        log.push("[终止] goto 自环达到 maxRounds 上限");
        exitCode = 4;
        status = "failed";
        break;
      }
      journal.currentStage = to.then;
      continue;
    }

    if (to.kind === "run") {
      const runOptions = {
        atomValues: evaluation.values,
        slots: journal.slotAnswers,
        slotPolicy: "defer" as const,
        emitReadContent: false,
      };
      const result =
        to.domain === "map-follow"
          ? await runMapFollow(snapshot, runOptions)
          : await runDomain(to.domain, snapshot.repo, runOptions);
      journal.reads.push(...result.reads);
      journal.runResults[to.domain] = { ok: result.ok, log: result.log };
      for (const step of result.steps) {
        log.push(`    ${step.ok ? "ok" : "FAIL"} ${step.kind} ${step.id}${step.detail ? ` · ${step.detail}` : ""}`);
      }
      if (result.failure) log.push(`    ${formatRunOutput(result).split("\n").slice(-2, -1)[0]}`);
      journal.currentStage = to.then;
      continue;
    }
  }

  if (exitCode === 4) {
    log.push(`[终止] 超过 maxRounds=${route.maxRounds}，链路未到达 stop`);
  }
  journal.status = status;
  await writeJournal(snapshot.repo, journal);

  return {
    ...base,
    repo: snapshot.repo,
    snapshotHash: snapshot.hash,
    exitCode,
    status,
    ok: exitCode === 0,
    log,
    linkId: lastLink,
    stage: lastStage,
    pendingSlot,
    journal,
    compile,
  };
  } finally {
    await release();
  }
}

function stopHint(linkId: string, repo: string): string | null {
  if (linkId === "absent") {
    return `下一步：npm run latch -- task open --cwd ${repo} --intent "<要做什么>" --durability once --writable <path>`;
  }
  if (linkId === "breach") {
    return `下一步：要改的路径放进 --writable，或先提交不属于这次任务的文件`;
  }
  if (linkId === "inactive") {
    return `下一步：npm run latch -- init --cwd ${repo}`;
  }
  if (linkId === "miss" || linkId === "ambiguous" || linkId === "unset") {
    return `下一步：npm run latch -- map desk --query "<说法>" --cwd ${repo}`;
  }
  if (linkId === "stop-discipline") {
    return "下一步：按 diff 改掉违纪，再重跑同一条路由";
  }
  return null;
}

async function findSlotQuestion(
  route: RouteDefinition,
  slotId: string,
): Promise<string | null> {
  for (const stage of Object.values(route.stages)) {
    for (const link of stage.links) {
      if (link.to.kind !== "run") continue;
      try {
        const domain = await readDomain(link.to.domain);
        const step = domain.steps.find((s) => s.kind === "slot" && s.id === slotId);
        if (step && step.kind === "slot") return step.question;
      } catch {
        /* domain may be missing; compile would have caught this */
      }
    }
  }
  return null;
}

export async function answerSlot(
  routeName: string,
  slotId: string,
  answer: "pass" | "fail",
  cwd: string,
  windowSpec = "worktree",
): Promise<{ ok: boolean; message: string }> {
  const route = await readRoute(routeName);
  if (!routeDeclaresSlot(route, slotId)) {
    return { ok: false, message: `路由 ${routeName} 没有声明 slot ${slotId}` };
  }
  const registry = await loadAtomRegistry();
  const compile = await loadCompile(route, registry.hash);
  const snapshot = await collectStableSnapshot(cwd, windowSpec);
  const binding = {
    route: routeName,
    repo: snapshot.repo,
    window: snapshot.window,
    snapshotHash: snapshot.hash,
    routeHash: compile.linkmap.routeHash,
    atomsHash: registry.hash,
  };
  const existing = await readJournal(snapshot.repo);
  const journal: Journal = isJournalValid(existing, binding)
    ? existing
    : newJournal(binding);
  journal.slotAnswers[slotId] = answer;
  await writeJournal(snapshot.repo, journal);
  return {
    ok: true,
    message: `已写入 ${path.join(snapshot.repo, ".latch/last-route.json")}：${slotId}=${answer}（绑定 snapshotHash=${snapshot.hash.slice(0, 12)}）`,
  };
}

export async function routeSummary(name: string): Promise<string> {
  const route = await readRoute(name);
  const linkmap = await readLinkmap(name);
  const report = await checkRoute(name);
  const lines = [
    `Latch · ${name}`,
    `policy=${route.policy} maxRounds=${route.maxRounds}`,
    `阶段：${Object.keys(route.stages).join(" → ")}`,
    `原子：${route.routingAtoms.length} 个自由原子 / ${Object.keys(route.resultAtoms).length} 个结果原子`,
    `编译：${report.report.ok ? "通过" : "未通过"}${linkmap ? `（上次生成 ${linkmap.generatedAt}）` : "（尚无 linkmap.json）"}`,
    `夹具目录：${routeFixturesDir(name)}`,
  ];
  try {
    const fixtures = await fs.readdir(routeFixturesDir(name));
    if (fixtures.length) lines.push(`夹具：${fixtures.filter((f) => f.endsWith(".json")).join(", ")}`);
  } catch {
    /* no fixtures directory */
  }
  return lines.join("\n");
}
