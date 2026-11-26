#!/usr/bin/env npx tsx
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { evaluateAtoms, loadAtomRegistry } from "../shared/atoms.js";
import { botNext } from "../shared/bot.js";
import { examCard, promoteCard } from "../shared/card.js";
import { draftExam } from "../shared/examDraft.js";
import { captureNaive } from "../shared/naive.js";
import { addMapEntry, MAP_ADD_PROMPTS, readMapForRepo, resolveMap, writeResolution, type MapDocument } from "../shared/map.js";
import { MODULE_CONST_CASES, validateMap, validateTask, type ModuleConstCase, type TaskDocument } from "../shared/schema.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { compileAlwaysApplyRule, readDomain } from "../shared/domain.js";
import { runDoctor } from "../shared/doctor.js";
import { installHooks } from "../shared/hooks.js";
import { formatCompileReport } from "../shared/linkmap.js";
import { collectSnapshot } from "../shared/snapshot.js";
import { addTarget, initRepo, InitError, useRepo } from "../shared/init.js";
import { gitRoot } from "../shared/lease.js";
import { addSessionStep, endSession, openSession, readSession, SessionError } from "../shared/session.js";
import { loadSettings } from "../shared/settings.js";
import { runDomain, formatRunOutput } from "../shared/runner.js";
import {
  answerSlot,
  checkRoute,
  explainRoute,
  routeSummary,
  runRoute,
} from "../shared/routeRunner.js";

function usage() {
  console.log(`Latch CLI · 静态域与链路路由

  latch route <name> [--cwd <repo>] [--window <w>] [--check] [--print] [--json]
  latch check <name>                       编译体检并写入 linkmap.json
  latch explain <name> [--cwd] [--window]  打印原子真值与各阶段命中
  latch slot <route> <slot>=pass|fail [--cwd] [--window]
  latch hooks install --target <id> [--route <name>] [--window <w>]
  latch doctor                            挂载、hook、编译、规范体检
  latch init --cwd <repo> [--case screaming-snake|camel|off]
                                          写 policy、补 AGENTS.md、登记目标。不装 hook
  latch target add <path> [--id <id>] [--skill-dir <dir>]
  latch session open --cwd <repo> --target <app>
  latch session step --cwd <repo> --at <location> --evidence <file>
  latch session end --cwd <repo>
  latch run <domain> [--cwd <repo>]        单域调试（slot 未答即失败）
  latch rule <domain> [--write --target <id>] [--route <name>]
  latch atoms [--cwd] [--window]          打印当前快照的原子真值
  latch task open --cwd <repo> --intent <text> --durability once|lasting
                   [--writable <path>] [--fact <text> --source <path> --sha256 <hex>]
  latch task check --cwd <repo> [--window <w>]
  latch map <app> --query <text> --cwd <repo>
  latch map add [--id <id> --aliases <a,b> --location <path> --observe <text>]
  latch exam <card> --cwd <repo>
  latch exam draft <card> --cwd <repo>
  latch card capture-naive <card> --cwd <repo> --source <path>
  latch card promote <card> --cwd <repo>
  latch bot next --cwd <repo>             一轮只给一个下一步。JSON 后接「下一步：」

窗口 window：
  worktree（默认）| staged | last-commit | range:<ref> | fixture:<file> | evidence:<dir>

退出码：0 通过 / 1 被闩住 / 2 编译失败 / 3 快照或原子不可用 / 4 超出 maxRounds / 5 等待 slot
`);
}

function usageShort() {
  console.log(`Latch

  latch use <path>
  latch task "<要做什么>" --once|--lasting [--writable <path>] [--fact <文字> --source <path>]
  latch map "<说法>"
  latch map add
  latch prove --evidence <file> [--at <location>]
  latch next
  latch daily
  latch help all    打印维护命令`);
}

type Args = { positional: string[]; flags: Record<string, string | boolean> };

const BOOLEAN_FLAGS = new Set(["once", "lasting"]);

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function str(flags: Args["flags"], key: string, fallback = ""): string {
  const v = flags[key];
  return typeof v === "string" ? v : fallback;
}

function flag(flags: Args["flags"], key: string): boolean {
  return flags[key] === true || typeof flags[key] === "string";
}

const NO_REPO = "先运行 latch use <path>，或这次加上 --cwd";

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoError";
  }
}

function gitTop(cwd: string): string | null {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

async function hasLatchMark(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, "latch.policy.json"));
    return true;
  } catch {
    // no policy file
  }
  try {
    const stat = await fs.stat(path.join(root, ".latch"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** --cwd, else a marked git root, else settings.current. */
export async function resolveRepo(flags: Args["flags"], cwd: string): Promise<string> {
  if ("cwd" in flags) {
    const explicit = flags.cwd;
    if (typeof explicit !== "string" || !explicit.trim()) throw new RepoError(NO_REPO);
    return gitRoot(path.resolve(cwd, explicit));
  }
  const top = gitTop(cwd);
  if (top && (await hasLatchMark(top))) return top;
  const settings = await loadSettings();
  if (typeof settings.current === "string" && path.isAbsolute(settings.current)) {
    return gitRoot(settings.current);
  }
  throw new RepoError(NO_REPO);
}

async function printNext(repo: string, asJson: boolean): Promise<number> {
  const result = await botNext(repo);
  if (asJson) {
    output(JSON.stringify(result));
    output(`下一步：${result.next}`);
    return result.exitCode;
  }
  const why =
    result.action === "done"
      ? "完成"
      : result.reason.replace(/\s+/g, " ").trim() || result.action;
  output(repo);
  output(why);
  output(`下一步：${result.next}`);
  return result.exitCode;
}

async function loadRepoMap(repo: string): Promise<MapDocument> {
  const file = path.join(repo, ".latch", "map.json");
  let app = "desk";
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as { name?: unknown };
    if (typeof raw.name === "string" && raw.name.trim()) app = raw.name.trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return readMapForRepo(repo, app);
}

async function readOpenTask(repo: string): Promise<TaskDocument | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(repo, ".latch", "task.json"), "utf8"));
    if (validateTask(parsed).length) return null;
    return parsed as TaskDocument;
  } catch {
    return null;
  }
}

function output(text: string) {
  process.stdout.write(`${text.replace(/\s*$/, "")}\n`);
}

async function cmdRun(args: Args): Promise<number> {
  const domain = args.positional[0];
  if (!domain) return 2;
  const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
  const { atoms } = await loadAtomRegistry();
  const snapshot = await collectSnapshot(cwd, str(args.flags, "window", "worktree"));
  const evaluation = evaluateAtoms(Object.keys(atoms), snapshot, atoms);
  const result = await runDomain(domain, cwd, {
    atomValues: evaluation.values,
    slotPolicy: "strict",
    emitReadContent: flag(args.flags, "emit-read"),
  });
  output(formatRunOutput(result));
  return result.ok ? 0 : 1;
}

async function cmdRule(args: Args): Promise<number> {
  const domain = args.positional[0];
  if (!domain) return 2;
  const def = await readDomain(domain);
  const routeName = str(args.flags, "route");
  if (!routeName) {
    console.error("latch rule 需要 --route <name>");
    return 2;
  }
  const text = compileAlwaysApplyRule(def, routeName);
  if (!flag(args.flags, "write")) {
    process.stdout.write(text);
    return 0;
  }
  const targetId = str(args.flags, "target");
  if (!targetId) {
    console.error("--write 需要 --target");
    return 2;
  }
  const settings = await loadSettings();
  const target = settings.targets.find((t) => t.id === targetId);
  if (!target) {
    console.error(`未知 target: ${targetId}`);
    return 2;
  }
  const dest = path.join(target.path, ".cursor", "rules", `latch-${domain}.mdc`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, text, "utf8");
  output(`已写入 ${dest}`);
  return 0;
}

async function cmdRoute(args: Args): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    usage();
    return 2;
  }
  if (flag(args.flags, "check")) {
    const { report, linkmapWritten } = await checkRoute(name, { write: true });
    output(formatCompileReport(report));
    if (linkmapWritten) output(`已写入 linkmap.json`);
    return report.ok ? 0 : 2;
  }
  const result = await runRoute(name, path.resolve(str(args.flags, "cwd", process.cwd())), {
    window: str(args.flags, "window", "worktree"),
    print: flag(args.flags, "print"),
    session: str(args.flags, "session") || undefined,
  });
  if (flag(args.flags, "json")) {
    output(JSON.stringify(result, null, 2));
  } else {
    output(result.log.join("\n"));
    output(`退出码 ${result.exitCode} · ${result.status}`);
  }
  return result.exitCode;
}

async function cmdCheck(args: Args): Promise<number> {
  const name = args.positional[0];
  if (!name) return 2;
  const { report, linkmapWritten } = await checkRoute(name, { write: true });
  output(formatCompileReport(report));
  if (linkmapWritten) output(`已写入 linkmap.json`);
  return report.ok ? 0 : 2;
}

async function cmdExplain(args: Args): Promise<number> {
  const name = args.positional[0];
  if (!name) return 2;
  output(
    await explainRoute(
      name,
      path.resolve(str(args.flags, "cwd", process.cwd())),
      str(args.flags, "window", "worktree"),
    ),
  );
  return 0;
}

async function cmdSlot(args: Args): Promise<number> {
  const route = args.positional[0];
  const assignment = args.positional[1] ?? "";
  const m = assignment.match(/^([\w-]+)=(pass|fail)$/);
  if (!route || !m) {
    console.error("用法：latch slot <route> <slot>=pass|fail [--cwd <repo>]");
    return 2;
  }
  const res = await answerSlot(
    route,
    m[1],
    m[2] as "pass" | "fail",
    path.resolve(str(args.flags, "cwd", process.cwd())),
    str(args.flags, "window", "worktree"),
  );
  output(res.message);
  return res.ok ? 0 : 3;
}

async function cmdHooks(args: Args): Promise<number> {
  if (args.positional[0] !== "install") {
    console.error("用法：latch hooks install --target <id> [--route <name>]");
    return 2;
  }
  const targetId = str(args.flags, "target");
  const settings = await loadSettings();
  const target = settings.targets.find((t) => t.id === targetId);
  if (!target) {
    console.error(`未知 target: ${targetId}`);
    return 2;
  }
  const routeName = str(args.flags, "route", "daily");
  const { written, warnings } = await installHooks(target.path, routeName, {
    window: str(args.flags, "window", "worktree"),
  });
  for (const f of written) output(`已写入 ${f}`);
  for (const w of warnings) output(`注意：${w}`);
  output("提示：hook 会阻断操作。先用 latch route daily --print 看它会拦什么，再安装。");
  return 0;
}

async function cmdAtoms(args: Args): Promise<number> {
  const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
  const window = str(args.flags, "window", "worktree");
  const snapshot = await collectSnapshot(cwd, window);
  const { atoms } = await loadAtomRegistry();
  const evaluation = evaluateAtoms(Object.keys(atoms), snapshot, atoms);
  const lines = [
    `Latch · atoms`,
    `window=${snapshot.window} snapshotHash=${snapshot.hash}`,
    `HEAD=${snapshot.gitHead ?? "(none)"}`,
    `changedPaths(${
      snapshot.changedPaths.length
    }): ${snapshot.changedPaths.slice(0, 12).join(", ") || "(none)"}${
      snapshot.changedPaths.length > 12 ? " …" : ""
    }`,
    "",
  ];
  for (const name of Object.keys(atoms)) {
    lines.push(`  ${name}=${evaluation.values[name] ? 1 : 0}`);
    for (const hit of evaluation.hits[name] ?? []) lines.push(`      ${hit}`);
  }
  output(lines.join("\n"));
  return 0;
}

async function cmdTaskShort(args: Args): Promise<number> {
  const repo = await resolveRepo(args.flags, process.cwd());
  const intent = args.positional[0] ?? "";
  const once = flag(args.flags, "once");
  const lasting = flag(args.flags, "lasting");
  if (!intent.trim() || once === lasting) {
    console.error(
      '用法：latch task "<要做什么>" --once|--lasting [--writable <path>] [--fact <文字> --source <path>]',
    );
    return 2;
  }
  if ("sha256" in args.flags) {
    console.error("不要手写 sha256。证据只来自 latch session step");
    return 2;
  }
  const writable = str(args.flags, "writable");
  const fact = str(args.flags, "fact");
  const source = str(args.flags, "source");
  const task: TaskDocument = {
    intent,
    durability: once ? "once" : "lasting",
    writable: writable ? writable.split(",").map((item) => item.trim()).filter(Boolean) : [],
    returns: fact ? [{ fact, ...(source ? { path: source } : {}) }] : [],
  };
  const issues = validateTask(task);
  if (issues.length) {
    console.error(issues.join("\n"));
    return 2;
  }
  await writeTaskFile(repo, task);
  output(`已写入 ${path.join(repo, ".latch", "task.json")}`);
  return 0;
}

async function cmdTask(args: Args): Promise<number> {
  const action = args.positional[0];
  if (action !== "check" && action !== "open") return cmdTaskShort(args);
  const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
  if (action === "check") {
    const result = await runRoute("task", cwd, {
      window: str(args.flags, "window", "worktree"),
      print: flag(args.flags, "print"),
    });
    output(result.log.join("\n"));
    output(`退出码 ${result.exitCode} · ${result.status}`);
    return result.exitCode;
  }
  const intent = str(args.flags, "intent");
  const durability = str(args.flags, "durability");
  if (!intent || (durability !== "once" && durability !== "lasting")) {
    console.error("task open 需要 --intent 与 --durability once|lasting");
    return 2;
  }
  const writable = str(args.flags, "writable");
  const fact = str(args.flags, "fact");
  const source = str(args.flags, "source");
  const sha256 = str(args.flags, "sha256");
  const task: TaskDocument = {
    intent,
    durability,
    writable: writable ? writable.split(",").map((item) => item.trim()).filter(Boolean) : [],
    returns: fact
      ? [{ fact, ...(source ? { path: source } : {}), ...(sha256 ? { sha256 } : {}) }]
      : [],
  };
  const issues = validateTask(task);
  if (issues.length) {
    console.error(issues.join("\n"));
    return 2;
  }
  await writeTaskFile(cwd, task);
  output(`已写入 ${path.join(cwd, ".latch/task.json")}`);
  return 0;
}

async function cmdMapShort(args: Args): Promise<number> {
  const query = args.positional[0] ?? "";
  if (!query.trim()) {
    console.error('用法：latch map "<说法>"');
    return 2;
  }
  const repo = await resolveRepo(args.flags, process.cwd());
  let map: MapDocument;
  try {
    map = await loadRepoMap(repo);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const issues = validateMap(map);
  if (issues.length) {
    console.error(issues.join("\n"));
    return 2;
  }
  const resolved = resolveMap(map, query);
  const entry =
    resolved.state === "hit"
      ? map.entries.find((item) => item.id === resolved.entryIds[0])
      : undefined;
  await writeResolution(repo, {
    app: map.name,
    query,
    state: resolved.state,
    entryId: entry?.id ?? null,
    entryIds: resolved.entryIds,
    ...(entry ? { location: entry.location, observe: entry.observe } : {}),
  });
  if (resolved.state !== "hit" || !entry?.location) {
    output(resolved.state === "hit" ? "miss" : resolved.state);
    return 1;
  }
  output(entry.location);
  output(entry.observe);
  return 0;
}

function fieldText(flags: Args["flags"], key: string): string {
  const value = flags[key];
  return typeof value === "string" ? value.trim() : "";
}

async function askMissingMapFields(fields: {
  id: string;
  aliases: string;
  location: string;
  observe: string;
}): Promise<{ id: string; aliases: string; location: string; observe: string }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const next = { ...fields };
    if (!next.id) next.id = (await rl.question(MAP_ADD_PROMPTS.id)).trim();
    if (!next.aliases) next.aliases = (await rl.question(MAP_ADD_PROMPTS.aliases)).trim();
    if (!next.location) next.location = (await rl.question(MAP_ADD_PROMPTS.location)).trim();
    if (!next.observe) next.observe = (await rl.question(MAP_ADD_PROMPTS.observe)).trim();
    return next;
  } finally {
    rl.close();
  }
}

async function cmdMapAdd(args: Args): Promise<number> {
  const repo = await resolveRepo(args.flags, process.cwd());
  let fields = {
    id: fieldText(args.flags, "id"),
    aliases: fieldText(args.flags, "aliases"),
    location: fieldText(args.flags, "location"),
    observe: fieldText(args.flags, "observe"),
  };
  if (!fields.id || !fields.aliases || !fields.location || !fields.observe) {
    if (!process.stdin.isTTY) {
      console.error(
        "用法：latch map add --id <id> --aliases <a,b> --location <path> --observe <text>",
      );
      return 2;
    }
    fields = await askMissingMapFields(fields);
  }
  const result = await addMapEntry(repo, fields);
  if ("issues" in result) {
    console.error(result.issues.join("\n"));
    return 2;
  }
  output(result.id);
  output(result.location);
  return 0;
}

async function cmdMap(args: Args): Promise<number> {
  if (args.positional[0] === "add") return cmdMapAdd(args);
  if (!str(args.flags, "query")) return cmdMapShort(args);
  const app = args.positional[0];
  const query = str(args.flags, "query");
  if (!app || !query) {
    console.error("用法：latch map <app> --query <text> --cwd <repo>");
    return 2;
  }
  const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
  const map = await readMapForRepo(cwd, app);
  const issues = validateMap(map);
  if (issues.length) {
    console.error(issues.join("\n"));
    return 2;
  }
  const resolved = resolveMap(map, query);
  await writeResolution(cwd, {
    app,
    query,
    state: resolved.state,
    entryId: resolved.state === "hit" ? resolved.entryIds[0] : null,
    entryIds: resolved.entryIds,
  });
  output(`${resolved.state} ${resolved.entryIds.join(", ") || "(none)"}`);
  return resolved.state === "hit" ? 0 : 1;
}

async function cmdExam(args: Args): Promise<number> {
  const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
  if (args.positional[0] === "draft") {
    const name = args.positional[1];
    if (!name) return 2;
    output(await draftExam(name, cwd));
    return 0;
  }
  const name = args.positional[0];
  if (!name) return 2;
  const res = await examCard(name, cwd);
  output(res.message);
  return res.exitCode;
}

async function cmdCard(args: Args): Promise<number> {
  if (args.positional[0] === "capture-naive" && args.positional[1]) {
    const source = str(args.flags, "source");
    const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
    if (!source) {
      console.error("用法：latch card capture-naive <card> --cwd <repo> --source <path>");
      return 2;
    }
    const captured = await captureNaive(cwd, args.positional[1], source);
    output(`${captured.path} ${captured.sha256}`);
    return 0;
  }
  if (args.positional[0] !== "promote" || !args.positional[1]) {
    console.error("用法：latch card promote <card> --cwd <repo>");
    return 2;
  }
  const res = await promoteCard(
    args.positional[1],
    path.resolve(str(args.flags, "cwd", process.cwd())),
  );
  output(res.message);
  return res.exitCode;
}

async function cmdSession(args: Args): Promise<number> {
  const action = args.positional[0];
  const cwd = str(args.flags, "cwd");
  if (!cwd) {
    console.error(
      "用法：latch session open --cwd <repo> --target <app> | step --cwd <repo> --at <location> --evidence <file> | end --cwd <repo>",
    );
    return 2;
  }
  try {
    if (action === "open") {
      const doc = await openSession(path.resolve(cwd), str(args.flags, "target"));
      output(`会话已打开：${doc.target}`);
      return 0;
    }
    if (action === "step") {
      const step = await addSessionStep(
        path.resolve(cwd),
        str(args.flags, "at"),
        str(args.flags, "evidence"),
      );
      output(`${step.at} ${step.evidence} ${step.sha256}`);
      return 0;
    }
    if (action === "end") {
      await endSession(path.resolve(cwd));
      output("会话已结束");
      return 0;
    }
  } catch (e) {
    console.error(e instanceof SessionError ? e.message : String(e));
    return e instanceof SessionError ? 2 : 1;
  }
  console.error(
    "用法：latch session open --cwd <repo> --target <app> | step --cwd <repo> --at <location> --evidence <file> | end --cwd <repo>",
  );
  return 2;
}

async function cmdProve(args: Args): Promise<number> {
  const repo = await resolveRepo(args.flags, process.cwd());
  const evidence = str(args.flags, "evidence");
  if (!evidence) {
    console.error("用法：latch prove --evidence <file> [--at <location>]");
    return 2;
  }
  let at = str(args.flags, "at");
  let target = "desk";
  if (!at) {
    const task = await readOpenTask(repo);
    if (!task) {
      console.error("没有打开的任务。先 latch task，或加上 --at");
      return 2;
    }
    let map: MapDocument;
    try {
      map = await loadRepoMap(repo);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 2;
    }
    const resolved = resolveMap(map, task.intent);
    const entry =
      resolved.state === "hit"
        ? map.entries.find((item) => item.id === resolved.entryIds[0])
        : undefined;
    if (resolved.state !== "hit" || !entry?.location) {
      console.error(resolved.state === "hit" ? "miss" : resolved.state);
      return 1;
    }
    at = entry.location;
    target = map.name;
  } else {
    try {
      target = (await loadRepoMap(repo)).name;
    } catch {
      target = "desk";
    }
  }
  try {
    const existing = await readSession(repo);
    if (!existing) await openSession(repo, target);
    const step = await addSessionStep(repo, at, evidence);
    output(`${step.at} ${step.evidence} ${step.sha256}`);
    return 0;
  } catch (e) {
    console.error(e instanceof SessionError ? e.message : e instanceof Error ? e.message : String(e));
    return e instanceof SessionError ? 2 : 1;
  }
}

async function cmdDaily(args: Args): Promise<number> {
  const repo = await resolveRepo(args.flags, process.cwd());
  const result = await runRoute("daily", repo, {
    window: str(args.flags, "window", "worktree"),
    print: flag(args.flags, "print"),
    session: str(args.flags, "session") || undefined,
  });
  if (flag(args.flags, "json")) {
    output(JSON.stringify(result, null, 2));
  } else {
    output(result.log.join("\n"));
    output(`退出码 ${result.exitCode} · ${result.status}`);
  }
  return result.exitCode;
}

async function cmdUse(args: Args): Promise<number> {
  const target = args.positional[0];
  if (!target) {
    console.error("用法：latch use <path>");
    return 2;
  }
  try {
    output(await useRepo(target));
    return 0;
  } catch (e) {
    console.error(e instanceof InitError ? e.message : String(e));
    return 2;
  }
}

async function cmdNext(args: Args): Promise<number> {
  const repo = await resolveRepo(args.flags, process.cwd());
  return printNext(repo, flag(args.flags, "json"));
}

async function cmdInit(args: Args): Promise<number> {
  const cwd = str(args.flags, "cwd");
  if (!cwd) {
    console.error("用法：latch init --cwd <repo> [--case screaming-snake|camel|off]");
    return 2;
  }
  const mode = str(args.flags, "case", "screaming-snake");
  if (!(MODULE_CONST_CASES as readonly string[]).includes(mode)) {
    console.error("moduleConstCase 只能是 screaming-snake / camel / off");
    return 2;
  }
  try {
    const result = await initRepo(cwd, { moduleConstCase: mode as ModuleConstCase });
    output(result.lines.join("\n"));
    return 0;
  } catch (e) {
    console.error(e instanceof InitError ? e.message : String(e));
    return 2;
  }
}

async function cmdBot(args: Args): Promise<number> {
  if (args.positional[0] !== "next" || !str(args.flags, "cwd")) {
    console.error("用法：latch bot next --cwd <repo>");
    return 2;
  }
  const result = await botNext(path.resolve(str(args.flags, "cwd")));
  output(JSON.stringify(result));
  output(`下一步：${result.next}`);
  return result.exitCode;
}

async function cmdTarget(args: Args): Promise<number> {
  if (args.positional[0] !== "add" || !args.positional[1]) {
    console.error("用法：latch target add <path> [--id <id>] [--skill-dir <dir>]");
    return 2;
  }
  try {
    const { target, created } = await addTarget(args.positional[1], {
      id: str(args.flags, "id") || undefined,
      skillDir: str(args.flags, "skill-dir") || undefined,
    });
    output(
      created
        ? `已登记 ${target.id} → ${target.path}（${target.skillDir}）`
        : `已有 ${target.id} → ${target.path}`,
    );
    return 0;
  } catch (e) {
    console.error(e instanceof InitError ? e.message : String(e));
    return 2;
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const lead = argv[0];
  const cmd = lead && !lead.startsWith("--") ? lead : undefined;
  const args = parseArgs(cmd ? argv.slice(1) : argv);
  switch (cmd) {
    case "run":
      return cmdRun(args);
    case "rule":
      return cmdRule(args);
    case "route":
      return cmdRoute(args);
    case "check":
      return cmdCheck(args);
    case "explain":
      return cmdExplain(args);
    case "slot":
      return cmdSlot(args);
    case "hooks":
      return cmdHooks(args);
    case "doctor":
      output(await runDoctor());
      return 0;
    case "init":
      return cmdInit(args);
    case "session":
      return cmdSession(args);
    case "target":
      return cmdTarget(args);
    case "atoms":
      return cmdAtoms(args);
    case "task":
      return cmdTask(args);
    case "map":
      return cmdMap(args);
    case "use":
      return cmdUse(args);
    case "prove":
      return cmdProve(args);
    case "daily":
      return cmdDaily(args);
    case "next":
      return cmdNext(args);
    case "help":
      if (args.positional[0] === "all") usage();
      else usageShort();
      return 0;
    case "exam":
      return cmdExam(args);
    case "card":
      return cmdCard(args);
    case "bot":
      return cmdBot(args);
    case "summary": {
      const name = args.positional[0];
      if (!name) return 2;
      output(await routeSummary(name));
      return 0;
    }
    default:
      if (!cmd) {
        try {
          const repo = await resolveRepo(args.flags, process.cwd());
          return printNext(repo, flag(args.flags, "json"));
        } catch (e) {
          if (e instanceof RepoError) {
            usageShort();
            return 0;
          }
          throw e;
        }
      }
      usage();
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof RepoError) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
