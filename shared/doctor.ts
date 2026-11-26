import fs from "node:fs/promises";
import path from "node:path";
import { atomNames, loadAtomRegistry } from "./atoms.js";
import { cardProblems, listCards } from "./card.js";
import { listDomains, readDomain } from "./domain.js";
import { hookStatus } from "./hooks.js";
import { hashRoute } from "./linkmap.js";
import { scanMounts } from "./mount.js";
import { readLinkmap, listRoutes, readRoute } from "./route.js";
import { checkRoute } from "./routeRunner.js";
import { validateDomain, validateRoute, validateSettings } from "./schema.js";
import { loadSettings } from "./settings.js";
import { inspectPolicy } from "./snapshot.js";
import { listSkills, readSkill } from "./skill.js";

export async function runDoctor(options: { cardsRoot?: string } = {}): Promise<string> {
  const lines: string[] = ["Latch · doctor", ""];
  let problems = 0;
  const note = (ok: boolean, text: string) => {
    if (!ok) problems++;
    lines.push(`${ok ? "ok " : "!! "} ${text}`);
  };

  const registry = await loadAtomRegistry();
  const names = await atomNames();
  note(names.length > 0, `原子注册表：${names.length} 个原子 · hash=${registry.hash}`);

  const settings = await loadSettings();
  const settingsIssues = validateSettings(settings);
  note(settingsIssues.length === 0, `settings.json：${settingsIssues.length ? settingsIssues.join("；") : "合法"}`);
  if (settings.targets.length === 0) {
    lines.push("--  还没有挂载目标：latch init --cwd <repo>");
  }

  const skills = await listSkills();
  for (const name of skills) {
    try {
      const record = await readSkill(name);
      note(record.issues.length === 0, `skill ${name}：${record.issues.length ? record.issues.join("；") : "规范通过"}`);
    } catch (e) {
      note(false, `skill ${name} 读取失败：${String(e)}`);
    }
  }

  const domains = await listDomains();
  for (const name of domains) {
    try {
      const def = await readDomain(name);
      const issues = validateDomain(def);
      note(issues.length === 0, `domain ${name}：${issues.length ? issues.join("；") : "结构合法"}`);
    } catch (e) {
      note(false, `domain ${name} 读取失败：${String(e)}`);
    }
  }

  for (const name of await listCards(options.cardsRoot)) {
    const issues = await cardProblems(name, options.cardsRoot);
    note(issues.length === 0, `card ${name}：${issues.length ? issues.join("；") : "原子与 skill 成对"}`);
  }

  const routes = await listRoutes();
  for (const name of routes) {
    try {
      const route = await readRoute(name);
      const schema = validateRoute(route);
      const check = await checkRoute(name);
      note(schema.length === 0 && check.report.ok, `route ${name}：${check.report.ok ? "编译通过" : `${check.report.issues.length} 个问题`}`);
      const linkmap = await readLinkmap(name);
      const fresh =
        linkmap !== null &&
        linkmap.routeHash === hashRoute(route) &&
        linkmap.atomsHash === registry.hash;
      note(fresh, `route ${name} linkmap：${fresh ? "与当前路由/原子一致" : "缺失或已过期，运行 latch check <name>"}`);
    } catch (e) {
      note(false, `route ${name} 读取失败：${String(e)}`);
    }
  }

  for (const target of settings.targets) {
    try {
      await fs.access(target.path);
      note(true, `target ${target.id} 路径存在：${target.path}`);
    } catch {
      note(false, `target ${target.id} 路径不存在：${target.path}`);
      continue;
    }
    const policy = await inspectPolicy(target.path);
    note(policy.ok, `target ${target.id} policy：${policy.text}`);
    if (policy.ok && policy.text.includes("无 latch.policy.json")) {
      lines.push(`    下一步：latch init --cwd ${target.path}`);
    }
    for (const skill of skills) {
      const [status] = await scanMounts(skill, [target]);
      if (!status.exists) continue;
      note(
        status.owned && status.valid && status.discovered,
        `挂载 ${skill}@${target.id}：owned=${status.owned} valid=${status.valid} discovered=${status.discovered}`,
      );
    }
    let isGit = false;
    try {
      await fs.stat(path.join(target.path, ".git"));
      isGit = true;
    } catch {
      isGit = false;
    }
    if (isGit) {
      let ignored = false;
      for (const rel of [".gitignore", ".git/info/exclude"]) {
        try {
          const text = await fs.readFile(path.join(target.path, rel), "utf8");
          if (text.split("\n").some((l) => l.trim() === ".latch/" || l.trim() === ".latch")) {
            ignored = true;
            break;
          }
        } catch {
          /* try the next location */
        }
      }
      lines.push(
        `    ${ignored ? "ok" : "--"}  回执排除：${ignored ? "已配置" : "未配置（首次 route 运行会自动写入 .git/info/exclude）"}`,
      );
      for (const h of await hookStatus(target.path)) lines.push(`    ${h}`);
    } else {
      lines.push(`    ${target.id} 不是 git 仓库，跳过 hook / 排除检查`);
    }
  }

  lines.push("", problems === 0 ? "结论：无阻塞项" : `结论：${problems} 项需要处理`);
  return lines.join("\n");
}
