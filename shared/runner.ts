import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { domainDir } from "./paths.js";
import type { DomainStep } from "./domain.js";
import { readDomain } from "./domain.js";
import { rememberRead, type ReadReceipt } from "./journal.js";

const READ_CONTENT_LIMIT = 1200;

export type StepResult = {
  id: string;
  kind: string;
  ok: boolean;
  detail?: string;
};

export type SlotState = {
  id: string;
  state: "pending" | "pass" | "fail";
  question: string;
};

export type RunResult = {
  domain: string;
  cwd: string;
  ok: boolean;
  log: string[];
  steps: StepResult[];
  slots: SlotState[];
  reads: ReadReceipt[];
  failure?: { stepId: string; reason: string };
};

export type RunOptions = {
  atomValues?: Record<string, boolean>;
  slots?: Record<string, string>;
  /** strict: standalone `latch run` fails on an unanswered slot.
   *  defer: route engine owns the slot decision via its `ask` transition. */
  slotPolicy?: "strict" | "defer";
  emitReadContent?: boolean;
};

function runAssertScript(domainName: string, script: string, cwd: string): boolean {
  const scriptPath = path.join(domainDir(domainName), script);
  if (!scriptPath.startsWith(domainDir(domainName) + path.sep)) return false;
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

function runTool(command: string | string[], cwd: string): boolean {
  const result =
    typeof command === "string"
      ? spawnSync(command, { shell: true, cwd, encoding: "utf8" })
      : spawnSync(command[0], command.slice(1), {
          shell: false,
          cwd,
          encoding: "utf8",
        });
  return result.status === 0;
}

export async function runDomain(
  domainName: string,
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const domain = await readDomain(domainName);
  return runStepList(domainName, domain.steps, cwd, options);
}

export async function runStepList(
  domainName: string,
  stepList: DomainStep[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const slotPolicy = options.slotPolicy ?? "strict";
  const log: string[] = [];
  const steps: StepResult[] = [];
  const slots: SlotState[] = [];
  const reads: ReadReceipt[] = [];
  let failure: RunResult["failure"];

  function fail(stepId: string, reason: string): RunResult {
    log.push(`[失败] ${stepId}: ${reason}`);
    failure = { stepId, reason };
    return { domain: domainName, cwd, ok: false, log, steps, slots, reads, failure };
  }

  for (const step of stepList) {
    if (step.kind === "read") {
      log.push(`[read] 必须阅读：${step.paths.join(", ")}`);
      for (const rel of step.paths) {
        const full = path.join(cwd, rel);
        try {
          await fs.access(full);
        } catch {
          steps.push({ id: step.id, kind: step.kind, ok: false, detail: `缺失 ${rel}` });
          return fail(step.id, `缺失文件 ${rel}`);
        }
        try {
          const buf = await fs.readFile(full);
          const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
          reads.push({ path: rel, sha256 });
          await rememberRead(cwd, rel, sha256);
          if (step.emit && options.emitReadContent !== false) {
            const text = buf.toString("utf8");
            const clipped = text.slice(0, READ_CONTENT_LIMIT);
            log.push(`[read] ${rel}（前 ${clipped.length} 字符）`);
            log.push(clipped);
            if (text.length > READ_CONTENT_LIMIT) log.push("… 已截断");
          }
        } catch (e) {
          return fail(step.id, `读取 ${rel} 失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      steps.push({ id: step.id, kind: step.kind, ok: true });
      continue;
    }

    if (step.kind === "assert") {
      let ok: boolean;
      let detail: string;
      if (step.atom) {
        const expected = step.expect ?? false;
        const present = step.atom in (options.atomValues ?? {});
        const value = options.atomValues?.[step.atom] ?? false;
        ok = present && value === expected;
        detail = present
          ? `${step.atom}=${value}，期望 ${expected}`
          : `原子 ${step.atom} 未求值`;
      } else if (step.script) {
        ok = runAssertScript(domainName, step.script, cwd);
        detail = `script ${step.script} 退出码 ${ok ? 0 : 1}`;
      } else {
        ok = false;
        detail = "assert 缺少 atom / script";
      }
      log.push(`[assert] ${step.id} · ${detail}`);
      steps.push({ id: step.id, kind: step.kind, ok, detail });
      if (!ok) return fail(step.id, detail);
      continue;
    }

    if (step.kind === "slot") {
      const raw = options.slots?.[step.id];
      const state: SlotState["state"] =
        raw === "pass" ? "pass" : raw === "fail" ? "fail" : "pending";
      slots.push({ id: step.id, state, question: step.question });
      log.push(`[slot] ${step.id}: ${state} · ${step.question}`);
      const ok = state === "pass" || (slotPolicy === "defer" && state !== "fail");
      steps.push({ id: step.id, kind: step.kind, ok, detail: `slot=${state}` });
      if (!ok) {
        if (slotPolicy === "defer") continue;
        return fail(step.id, `slot ${step.id} 状态为 ${state}`);
      }
      continue;
    }

    if (step.kind === "tool") {
      const label = Array.isArray(step.command)
        ? step.command.join(" ")
        : step.command;
      const ok = runTool(step.command, cwd);
      log.push(`[tool] ${label} · ${ok ? "通过" : "失败"}`);
      steps.push({ id: step.id, kind: step.kind, ok, detail: label });
      if (!ok) return fail(step.id, `tool ${label} 失败`);
      continue;
    }
  }

  return { domain: domainName, cwd, ok: true, log, steps, slots, reads };
}

export function formatRunOutput(result: RunResult): string {
  const lines = [
    `Latch · ${result.domain}`,
    `cwd: ${result.cwd}`,
    "",
    ...result.log,
    "",
    `步骤：${result.steps.filter((s) => s.ok).length}/${result.steps.length} 通过`,
    ...result.slots.map((s) => `slot ${s.id}: ${s.state}`),
    result.failure ? `失败点：${result.failure.stepId} · ${result.failure.reason}` : "",
    result.ok ? "结果：通过" : "结果：未通过",
  ];
  return lines.filter(Boolean).join("\n");
}
