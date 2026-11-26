import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { MountTarget } from "./mount.js";
import { NAME_RE } from "./paths.js";
import { settingsFilePath } from "./settings.js";
import {
  MODULE_CONST_CASES,
  canonicalPolicy,
  validateSettings,
  type LatchPolicy,
  type ModuleConstCase,
} from "./schema.js";
import { readPolicy, SnapshotError } from "./snapshot.js";

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitError";
  }
}

const AGENTS_STUB = `# 仓库约定

把这个仓库自己的规则写在这里。改动纪律在动手前会读这份文件。

社区 skill 不能覆盖这里已经写明的约定。原文已经满足需求时，只改差额。
`;

type SettingsFile = { targets: MountTarget[]; current?: string };

function gitRoot(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function targetIdFromPath(repoPath: string): string {
  const id = path
    .basename(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!NAME_RE.test(id)) {
    throw new InitError(`无法从路径推出合法 id，请用 --id 指定：${repoPath}`);
  }
  return id;
}

async function readSettings(file: string): Promise<SettingsFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as SettingsFile;
    const issues = validateSettings(parsed);
    if (issues.length) throw new InitError(issues.join("；"));
    return parsed;
  } catch (e) {
    if (e instanceof InitError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { targets: [] };
    throw new InitError(`无法读取 ${file}：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function writeSettings(file: string, settings: SettingsFile): Promise<void> {
  const issues = validateSettings(settings);
  if (issues.length) throw new InitError(issues.join("；"));
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function addTarget(
  repoPath: string,
  options: { id?: string; skillDir?: string; settingsPath?: string } = {},
): Promise<{ target: MountTarget; created: boolean }> {
  const abs = path.resolve(repoPath);
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch {
    throw new InitError(`路径不存在：${abs}`);
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new InitError(`不是目录：${real}`);
  const id = options.id ?? targetIdFromPath(real);
  if (!NAME_RE.test(id)) throw new InitError(`非法 id：${id}`);
  const skillDir = options.skillDir ?? (gitRoot(real) ? ".agents/skills" : "skills");
  const file = options.settingsPath ?? settingsFilePath();
  const settings = await readSettings(file);
  const existing = settings.targets.find((t) => t.id === id);
  if (existing) {
    const existingReal = await fs.realpath(existing.path).catch(() => existing.path);
    if (existingReal !== real) {
      throw new InitError(`id ${id} 已指向 ${existing.path}`);
    }
    return { target: existing, created: false };
  }
  const target: MountTarget = { id, label: id, path: real, skillDir };
  settings.targets.push(target);
  await writeSettings(file, settings);
  return { target, created: true };
}

export async function useRepo(repoPath: string, settingsPath?: string): Promise<string> {
  const abs = path.resolve(repoPath);
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch {
    throw new InitError(`路径不存在：${abs}`);
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new InitError(`不是目录：${real}`);
  const file = settingsPath ?? settingsFilePath();
  const settings = await readSettings(file);
  settings.current = real;
  await writeSettings(file, settings);
  return real;
}

export type InitResult = {
  root: string;
  target: MountTarget;
  targetCreated: boolean;
  wrotePolicy: boolean;
  wroteAgents: boolean;
  wroteMap: boolean;
  lines: string[];
};

export async function initRepo(
  repoPath: string,
  options: { moduleConstCase?: ModuleConstCase; settingsPath?: string } = {},
): Promise<InitResult> {
  const abs = path.resolve(repoPath);
  const root = gitRoot(abs);
  if (!root) throw new InitError(`不是 git 仓库：${abs}`);
  const mode = options.moduleConstCase ?? "screaming-snake";
  if (!(MODULE_CONST_CASES as readonly string[]).includes(mode)) {
    throw new InitError("moduleConstCase 只能是 screaming-snake / camel / off");
  }

  const policyFile = path.join(root, "latch.policy.json");
  let wrotePolicy = false;
  let existing: LatchPolicy | null;
  try {
    existing = await readPolicy(root);
  } catch (e) {
    if (e instanceof SnapshotError) throw new InitError(e.message);
    throw e;
  }
  if (!existing) {
    const policy: LatchPolicy = {
      version: 1,
      changeDiscipline: { enabled: true, moduleConstCase: mode },
    };
    await fs.writeFile(
      policyFile,
      `${JSON.stringify(canonicalPolicy(policy), null, 2)}\n`,
      "utf8",
    );
    wrotePolicy = true;
  }

  const mapPath = path.join(root, ".latch", "map.json");
  let wroteMap = false;
  try {
    await fs.access(mapPath);
  } catch {
    await fs.mkdir(path.dirname(mapPath), { recursive: true });
    await fs.writeFile(
      mapPath,
      `${JSON.stringify({ name: targetIdFromPath(root), entries: [] }, null, 2)}\n`,
      "utf8",
    );
    wroteMap = true;
  }

  const agentsFile = path.join(root, "AGENTS.md");
  let wroteAgents = false;
  try {
    await fs.access(agentsFile);
  } catch {
    await fs.writeFile(agentsFile, AGENTS_STUB, "utf8");
    wroteAgents = true;
  }

  const { target, created } = await addTarget(root, {
    settingsPath: options.settingsPath,
  });
  const lines = [
    `已准备 ${root}`,
    wrotePolicy
      ? `policy：已写入 latch.policy.json（${mode}）`
      : "policy：已存在，未覆盖",
    wroteMap ? "地图：已写入 .latch/map.json 空模板" : "地图：已存在，未覆盖",
    wroteAgents ? "AGENTS.md：已写入一份空约定，把仓库自己的规则补进去" : "AGENTS.md：已存在，未覆盖",
    created
      ? `目标：已登记 settings.json，id=${target.id}`
      : `目标：settings.json 里已有 id=${target.id}`,
    "",
    "先提交刚写入的文件，避免它们被任务契约当成未声明的改动。然后：",
    `  npm run latch -- task open --cwd ${root} --intent "<要做什么>" --durability once --writable <path>`,
    `  npm run latch -- map desk --query "<说法>" --cwd ${root}`,
    `  npm run latch -- route daily --cwd ${root}`,
    "钩子先不要装。daily 的退出码符合预期之后：",
    `  npm run latch -- hooks install --target ${target.id}`,
  ];
  return { root, target, targetCreated: created, wrotePolicy, wroteAgents, wroteMap, lines };
}
