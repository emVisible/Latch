#!/usr/bin/env npx tsx
import fs from "node:fs/promises";
import path from "node:path";
import { compileAlwaysApplyRule, readDomain } from "../shared/domain.js";
import { runDomain, formatRunOutput } from "../shared/runner.js";
import { loadSettings } from "../shared/settings.js";

function usage() {
  console.log(`Latch CLI

  latch run <domain> [--cwd <repo>]
  latch rule <domain> [--write --target <targetId>]

  --cwd     仓库根目录（默认 process.cwd()）
  --write   写入目标仓库 .cursor/rules/latch-<domain>.mdc
  --target  settings.json 里的 target id（--write 时必填）
`);
}

async function cmdRun(args: string[]) {
  let cwd = process.cwd();
  let domain = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1]) {
      cwd = path.resolve(args[++i]);
    } else if (!domain) {
      domain = args[i];
    }
  }
  if (!domain) {
    usage();
    process.exit(2);
  }
  const result = await runDomain(domain, cwd);
  console.log(formatRunOutput(result));
  process.exit(result.ok ? 0 : 1);
}

async function cmdRule(args: string[]) {
  let domain = "";
  let write = false;
  let targetId = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--write") write = true;
    else if (args[i] === "--target" && args[i + 1]) targetId = args[++i];
    else if (!domain) domain = args[i];
  }
  if (!domain) {
    usage();
    process.exit(2);
  }
  const def = await readDomain(domain);
  const text = compileAlwaysApplyRule(def);
  if (!write) {
    process.stdout.write(text);
    return;
  }
  if (!targetId) {
    console.error("--write 需要 --target");
    process.exit(2);
  }
  const settings = await loadSettings();
  const target = settings.targets.find((t) => t.id === targetId);
  if (!target) {
    console.error(`未知 target: ${targetId}`);
    process.exit(2);
  }
  const dest = path.join(target.path, ".cursor", "rules", `latch-${domain}.mdc`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, text, "utf8");
  console.log(`已写入 ${dest}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "run") await cmdRun(rest);
  else if (cmd === "rule") await cmdRule(rest);
  else {
    usage();
    process.exit(cmd ? 2 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
