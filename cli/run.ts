#!/usr/bin/env npx tsx
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateAtoms, loadAtomRegistry } from "../shared/atoms.js";
import { examCard, promoteCard } from "../shared/card.js";
import { readMap, resolveMap, writeResolution } from "../shared/map.js";
import { validateMap, validateTask, type TaskDocument } from "../shared/schema.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { compileAlwaysApplyRule, readDomain } from "../shared/domain.js";
import { runDoctor } from "../shared/doctor.js";
import { installHooks } from "../shared/hooks.js";
import { formatCompileReport } from "../shared/linkmap.js";
import { collectSnapshot } from "../shared/snapshot.js";
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
  latch run <domain> [--cwd <repo>]        单域调试（slot 未答即失败）
  latch rule <domain> [--write --target <id>] [--route <name>]
  latch atoms [--cwd] [--window]          打印当前快照的原子真值
  latch task open --cwd <repo> --intent <text> --durability once|lasting
                   [--writable <path>] [--fact <text> --source <path> --sha256 <hex>]
  latch task check --cwd <repo> [--window <w>]
  latch map <app> --query <text> --cwd <repo>
  latch exam <card> --cwd <repo>
  latch card promote <card> --cwd <repo>

窗口 window：
  worktree（默认）| staged | last-commit | range:<ref> | fixture:<file> | evidence:<dir>

退出码：0 通过 / 1 被闩住 / 2 编译失败 / 3 快照或原子不可用 / 4 超出 maxRounds / 5 等待 slot
`);
}

type Args = { positional: string[]; flags: Record<string, string | boolean> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
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
  const text = compileAlwaysApplyRule(def, str(args.flags, "route", "openstrat"));
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
  output("提示：激活前先跑 `latch doctor` 与 14 条验收；hook 会阻断操作。");
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

async function cmdTask(args: Args): Promise<number> {
  const action = args.positional[0];
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
  if (action !== "open") {
    console.error("用法：latch task open|check --cwd <repo>");
    return 2;
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

async function cmdMap(args: Args): Promise<number> {
  const app = args.positional[0];
  const query = str(args.flags, "query");
  if (!app || !query) {
    console.error("用法：latch map <app> --query <text> --cwd <repo>");
    return 2;
  }
  const cwd = path.resolve(str(args.flags, "cwd", process.cwd()));
  const map = await readMap(app);
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
  const name = args.positional[0];
  if (!name) return 2;
  const res = await examCard(name, path.resolve(str(args.flags, "cwd", process.cwd())));
  output(res.message);
  return res.exitCode;
}

async function cmdCard(args: Args): Promise<number> {
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

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
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
    case "atoms":
      return cmdAtoms(args);
    case "task":
      return cmdTask(args);
    case "map":
      return cmdMap(args);
    case "exam":
      return cmdExam(args);
    case "card":
      return cmdCard(args);
    case "summary": {
      const name = args.positional[0];
      if (!name) return 2;
      output(await routeSummary(name));
      return 0;
    }
    default:
      usage();
      return cmd ? 2 : 0;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
