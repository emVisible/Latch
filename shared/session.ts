import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureLatchGitignore } from "./journal.js";
import { releaseSessionLease } from "./lease.js";
import { repoLatch } from "./paths.js";

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export type SessionStep = {
  at: string;
  evidence: string;
  sha256: string;
  /** App opened for this step. Latch does not launch it. */
  target: string;
  /** Position the caller says they hit. Latch does not read the pointer. */
  position: string;
  /** What the caller says was visible. Compared with the map entry's observe. */
  observe: string;
};

export type SessionFields = {
  target?: string;
  position?: string;
  observe?: string;
};

export type SessionDocument = {
  target: string;
  steps: SessionStep[];
};

function sessionFile(repo: string): string {
  return repoLatch(repo, "session.json");
}

async function hashFile(full: string): Promise<string> {
  const buf = await fs.readFile(full);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function relativeEvidence(repo: string, evidence: string): string {
  const abs = path.resolve(repo, evidence);
  const root = path.resolve(repo) + path.sep;
  if (abs !== path.resolve(repo) && !abs.startsWith(root)) {
    throw new SessionError(`证据路径越界：${evidence}`);
  }
  const rel = path.relative(repo, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) throw new SessionError(`证据路径越界：${evidence}`);
  return rel;
}

export async function openSession(repo: string, target: string): Promise<SessionDocument> {
  if (!target.trim()) throw new SessionError("session open 需要 --target");
  await ensureLatchGitignore(repo);
  const doc: SessionDocument = { target: target.trim(), steps: [] };
  await fs.mkdir(repoLatch(repo, ""), { recursive: true });
  await fs.writeFile(sessionFile(repo), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return doc;
}

/**
 * Writes the session checklist. The sha256 is of the screenshot or export the
 * caller already saved. Latch does not capture the screen, start an app, or
 * record the pointer. A missing target, position, observe, or evidence file is refused.
 */
export async function addSessionStep(
  repo: string,
  at: string,
  evidence: string,
  fields: SessionFields = {},
): Promise<SessionStep> {
  if (!at.trim()) throw new SessionError("session step 需要 --at");
  if (!evidence.trim()) throw new SessionError("session step 需要 --evidence");
  const raw = await fs.readFile(sessionFile(repo), "utf8").catch((e) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SessionError("还没有会话，先 latch session open");
    }
    throw new SessionError(`无法读取会话：${String(e)}`);
  });
  const doc = JSON.parse(raw) as SessionDocument;
  const target = (fields.target !== undefined ? fields.target : doc.target).trim();
  if (!target) throw new SessionError("session step 需要打开的目标");
  const position = (fields.position ?? "").trim();
  if (!position) throw new SessionError("session step 需要点中的位置");
  const observe = (fields.observe ?? "").trim();
  if (!observe) throw new SessionError("session step 需要 --observe");
  const rel = relativeEvidence(repo, evidence);
  let sha256: string;
  try {
    sha256 = await hashFile(path.join(repo, rel));
  } catch {
    throw new SessionError(`证据文件不存在：${rel}`);
  }
  const step: SessionStep = {
    at: at.trim(),
    evidence: rel,
    sha256,
    target,
    position,
    observe,
  };
  doc.steps.push(step);
  await fs.writeFile(sessionFile(repo), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return step;
}

function isStep(step: unknown): step is SessionStep {
  if (typeof step !== "object" || step === null) return false;
  const item = step as SessionStep;
  return (
    typeof item.at === "string" &&
    typeof item.evidence === "string" &&
    typeof item.sha256 === "string" &&
    typeof item.target === "string" &&
    item.target.trim() !== "" &&
    typeof item.position === "string" &&
    item.position.trim() !== "" &&
    typeof item.observe === "string" &&
    item.observe.trim() !== ""
  );
}

/** Missing file is an empty session. A stored hash that no longer matches the file fails the snapshot. */
export async function readSession(repo: string): Promise<SessionDocument | null> {
  let raw: string;
  try {
    raw = await fs.readFile(sessionFile(repo), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SessionError(`无法读取会话：${String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new SessionError(`会话不是 JSON：${String(e)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { target?: unknown }).target !== "string" ||
    !(parsed as { target: string }).target.trim() ||
    !Array.isArray((parsed as { steps?: unknown }).steps)
  ) {
    throw new SessionError("会话不合法");
  }
  const steps: SessionStep[] = [];
  for (const step of (parsed as { steps: unknown[] }).steps) {
    if (!isStep(step)) throw new SessionError("会话步骤不合法");
    let actual: string;
    try {
      actual = await hashFile(path.join(repo, step.evidence));
    } catch {
      throw new SessionError(`会话证据已变：${step.evidence}`);
    }
    if (actual !== step.sha256) {
      throw new SessionError(`会话证据已变：${step.evidence}`);
    }
    steps.push({
      at: step.at,
      evidence: step.evidence,
      sha256: step.sha256,
      target: step.target,
      position: step.position,
      observe: step.observe,
    });
  }
  return { target: (parsed as { target: string }).target, steps };
}

export async function endSession(repo: string): Promise<void> {
  await fs.rm(sessionFile(repo), { force: true });
  await fs.rm(repoLatch(repo, "hook-session"), { force: true });
  await releaseSessionLease(repo);
}

export function evidenceCovers(evidence: string, returnPath: string): boolean {
  return (
    evidence === returnPath ||
    evidence.endsWith(`/${returnPath}`) ||
    returnPath.endsWith(`/${evidence}`)
  );
}
