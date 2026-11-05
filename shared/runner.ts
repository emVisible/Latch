import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DOMAINS_DIR } from "./paths.js";
import type { DomainDefinition, DomainStep } from "./domain.js";
import { readDomain } from "./domain.js";

export type RunResult = {
  domain: string;
  cwd: string;
  ok: boolean;
  log: string[];
};

function runAssert(domainName: string, step: DomainStep, cwd: string): boolean {
  if (step.kind !== "assert") return true;
  const scriptPath = path.join(DOMAINS_DIR, domainName, step.script);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    env: { ...process.env, LATCH_CWD: cwd },
    encoding: "utf8",
  });
  if (result.status === 0) return true;
  const err = result.stderr || result.stdout || "assert 失败";
  process.stderr.write(err);
  return false;
}

export async function runDomain(
  domainName: string,
  cwd: string,
): Promise<RunResult> {
  const domain = await readDomain(domainName);
  const log: string[] = [];

  for (const step of domain.steps) {
    if (step.kind === "read") {
      log.push(`[read] 必须阅读：${step.paths.join(", ")}`);
      for (const rel of step.paths) {
        const full = path.join(cwd, rel);
        try {
          await fs.access(full);
        } catch {
          log.push(`[read] 缺失文件：${rel}`);
          return { domain: domainName, cwd, ok: false, log };
        }
      }
      continue;
    }

    if (step.kind === "assert") {
      log.push(`[assert] ${step.id}`);
      if (!runAssert(domainName, step, cwd)) {
        log.push(`[assert] 失败：${step.id}`);
        return { domain: domainName, cwd, ok: false, log };
      }
      continue;
    }

    if (step.kind === "slot") {
      log.push(`[slot] 问题：${step.question}`);
      log.push(`[slot] 作答：仅允许 pass 或 fail`);
      log.push(
        `[slot] 若 fail → ${step.onFail}（停止后续 plan / edit / commit）`,
      );
      continue;
    }

    if (step.kind === "tool") {
      log.push(`[tool] ${step.command}`);
      const result = spawnSync(step.command, {
        shell: true,
        cwd,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        log.push(`[tool] 失败`);
        return { domain: domainName, cwd, ok: false, log };
      }
    }
  }

  return { domain: domainName, cwd, ok: true, log };
}

export function formatRunOutput(result: RunResult): string {
  const lines = [
    `Latch · ${result.domain}`,
    `cwd: ${result.cwd}`,
    "",
    ...result.log,
    "",
    result.ok ? "结果：通过（slot 须由 agent 自行确认）" : "结果：未通过",
  ];
  return lines.join("\n");
}
