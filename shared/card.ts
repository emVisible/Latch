import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadAtomRegistry, type AtomFn } from "./atoms.js";
import { ensureLatchGitignore, readJournal, readReceipts, type ReadReceipt } from "./journal.js";
import { hashRoute } from "./linkmap.js";
import { CARDS_DIR, cardDir, repoLatch } from "./paths.js";
import { listRoutes, readRoute, type RouteDefinition } from "./route.js";
import {
  canonicalPolicy,
  validateCard,
  validateExam,
  type CardDocument,
  type ExamDocument,
  type LatchPolicy,
} from "./schema.js";
import { parseSkillMarkdown, validateSkill } from "./skill.js";
import { authoringSplitIssue } from "./examSplit.js";
import { readNaive } from "./naive.js";
import { collectSnapshot, snapshotFromFixture } from "./snapshot.js";

export type GradeResult = { ok: boolean; issues: string[] };

const EXAM_POLICY: LatchPolicy = {
  version: 1,
  changeDiscipline: { enabled: true, moduleConstCase: "screaming-snake" },
};

export async function listCards(root: string = CARDS_DIR): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readCard(
  name: string,
  root: string = CARDS_DIR,
): Promise<CardDocument> {
  const raw = await fs.readFile(path.join(cardDir(name, root), "card.json"), "utf8");
  return JSON.parse(raw) as CardDocument;
}

export async function readExam(
  name: string,
  root: string = CARDS_DIR,
): Promise<ExamDocument> {
  const raw = await fs.readFile(path.join(cardDir(name, root), "exam.json"), "utf8");
  return JSON.parse(raw) as ExamDocument;
}

async function writeCard(card: CardDocument, root: string): Promise<void> {
  const file = path.join(cardDir(card.name, root), "card.json");
  await fs.writeFile(file, `${JSON.stringify(card, null, 2)}\n`, "utf8");
}

/**
 * Grades fixtures with the atom only. SKILL.md is not an input.
 */
export async function gradeExam(
  card: CardDocument,
  exam: ExamDocument,
  atom: AtomFn,
  receipts: ReadReceipt[],
  cwd: string,
): Promise<GradeResult> {
  const issues = [...validateCard(card), ...validateExam(card, exam)];
  if (issues.length) return { ok: false, issues };
  for (const question of exam.questions) {
    const receipt = receipts.find(
      (item) => item.path === question.source.path && item.sha256 === question.source.sha256,
    );
    if (!receipt) {
      issues.push(`缺少读回执 ${question.source.path}`);
      continue;
    }
    try {
      const buf = await fs.readFile(path.join(cwd, question.source.path));
      const actual = crypto.createHash("sha256").update(buf).digest("hex");
      if (actual !== question.source.sha256) {
        issues.push(`数据源已变 ${question.source.path}`);
      }
    } catch {
      issues.push(`数据源不存在 ${question.source.path}`);
    }
    const policy = question.fixture.policy
      ? canonicalPolicy(question.fixture.policy)
      : EXAM_POLICY;
    const snapshot = snapshotFromFixture({ ...question.fixture, policy }, cwd, "exam");
    const outcome = atom(snapshot);
    const value = typeof outcome === "boolean" ? outcome : Boolean(outcome.value);
    if (value !== question.expect) {
      issues.push(
        `${question.role} 期望 ${question.expect}，原子返回 ${value}`,
      );
    }
    if (question.role === "trap") {
      const recorded = await readNaive(cwd, card.name);
      const naive = question.naive;
      if (!recorded || !naive || naive.path !== recorded.path || naive.sha256 !== recorded.sha256) {
        issues.push("陷阱题没有已记录的天真改法");
      } else {
        try {
          const buf = await fs.readFile(path.join(cwd, recorded.path));
          const actual = crypto.createHash("sha256").update(buf).digest("hex");
          if (actual !== recorded.sha256) issues.push("天真改法已变");
        } catch {
          issues.push("天真改法不存在");
        }
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export async function cardProblems(
  name: string,
  root: string = CARDS_DIR,
): Promise<string[]> {
  const issues: string[] = [];
  let card: CardDocument;
  try {
    card = await readCard(name, root);
  } catch (e) {
    return [`无法读取 card.json：${String(e)}`];
  }
  issues.push(...validateCard(card));
  if (card.name !== name) issues.push(`card.name「${card.name}」与目录「${name}」不一致`);
  try {
    issues.push(...validateExam(card, await readExam(name, root)));
  } catch (e) {
    issues.push(`无法读取 exam.json：${String(e)}`);
  }
  try {
    const raw = await fs.readFile(path.join(cardDir(name, root), "SKILL.md"), "utf8");
    const { frontmatter } = parseSkillMarkdown(raw);
    issues.push(...validateSkill(name, frontmatter));
    if (frontmatter["disable-model-invocation"] !== true) {
      issues.push("SKILL.md 必须设置 disable-model-invocation: true");
    }
  } catch (e) {
    issues.push(`缺少 SKILL.md：${String(e)}`);
  }
  const registry = await loadAtomRegistry();
  if (card.atom && typeof registry.atoms[card.atom] !== "function") {
    issues.push(`原子 ${card.atom} 不在注册表，散文不能单独晋升`);
  }
  if (card.status === "latched" && !(await atomReachableOnDaily(card.atom))) {
    issues.push(`原子 ${card.atom} 不在 daily 走得到的 scope 里`);
  }
  return issues;
}

type Sighting = { atom: string; snapshotHash: string };

async function readSightings(repo: string): Promise<Sighting[]> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(repoLatch(repo, "sightings.json"), "utf8"),
    ) as unknown;
    return Array.isArray(parsed) ? (parsed as Sighting[]) : [];
  } catch {
    return [];
  }
}

/** Count distinct snapshots where a route observed this atom. Ignores card.json seen. */
export async function seenCount(repo: string, atom: string): Promise<number> {
  const snapshot = await collectSnapshot(repo, "worktree");
  const hashes = new Set(
    (await readSightings(snapshot.repo))
      .filter((item) => item.atom === atom)
      .map((item) => item.snapshotHash),
  );
  return hashes.size;
}

export async function noteSightings(
  repo: string,
  values: Record<string, boolean>,
  snapshotHash: string,
): Promise<void> {
  if (!snapshotHash) return;
  const atoms = new Set<string>();
  for (const name of await listCards()) {
    try {
      const card = await readCard(name);
      if (values[card.atom]) atoms.add(card.atom);
    } catch {
      /* a broken card does not get a sighting */
    }
  }
  if (atoms.size === 0) return;
  await ensureLatchGitignore(repo);
  const list = await readSightings(repo);
  let changed = false;
  for (const atom of atoms) {
    if (list.some((item) => item.atom === atom && item.snapshotHash === snapshotHash)) continue;
    list.push({ atom, snapshotHash });
    changed = true;
  }
  if (!changed) return;
  const file = repoLatch(repo, "sightings.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

export function routeDeclaresSlot(route: RouteDefinition, slotId: string): boolean {
  return Object.values(route.resultAtoms).some(
    (spec) => spec.from === "slot" && spec.slot === slotId,
  );
}

export function reachableStageIds(route: RouteDefinition): Set<string> {
  const seen = new Set<string>(["entry"]);
  const queue = ["entry"];
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    const stage = route.stages[id];
    if (!stage) continue;
    for (const link of stage.links) {
      if (link.to.kind === "stop" || seen.has(link.to.then)) continue;
      seen.add(link.to.then);
      queue.push(link.to.then);
    }
  }
  return seen;
}

export async function atomReachableOnDaily(atom: string): Promise<boolean> {
  const route = await readRoute("daily");
  for (const id of reachableStageIds(route)) {
    if (route.stages[id]?.scope.includes(atom)) return true;
  }
  return false;
}

export async function routesReferencingAtom(atom: string): Promise<string[]> {
  const hits: string[] = [];
  for (const name of await listRoutes()) {
    const route = await readRoute(name);
    const inScope = Object.values(route.stages).some((stage) => stage.scope.includes(atom));
    if (inScope) hits.push(name);
  }
  return hits;
}

async function boundPromoteSlot(cwd: string): Promise<boolean> {
  const snapshot = await collectSnapshot(cwd, "worktree");
  const journal = await readJournal(snapshot.repo);
  if (!journal || journal.slotAnswers["card-promote"] !== "pass") return false;
  if (
    journal.snapshotHash !== snapshot.hash ||
    journal.window !== snapshot.window ||
    journal.repo !== snapshot.repo
  ) {
    return false;
  }
  let route: RouteDefinition;
  try {
    route = await readRoute(journal.route);
  } catch {
    return false;
  }
  if (!routeDeclaresSlot(route, "card-promote")) return false;
  const registry = await loadAtomRegistry();
  return journal.routeHash === hashRoute(route) && journal.atomsHash === registry.hash;
}

async function admitted(card: CardDocument, cwd: string): Promise<string | null> {
  if (card.durability === "once") {
    return "一次性要求只留在当次任务，不能进入考卷";
  }
  const seen = await seenCount(cwd, card.atom);
  if (seen >= 2 || (await boundPromoteSlot(cwd))) return null;
  return `原子 ${card.atom} 在 ${seen} 个不同快照里出现过，需要 2 个，或由声明了 card-promote 的路由在当前快照上答 pass`;
}

async function loadGrade(
  name: string,
  cwd: string,
  root: string,
): Promise<{ card: CardDocument; grade: GradeResult; gate: string | null }> {
  const card = await readCard(name, root);
  const exam = await readExam(name, root);
  const gate = await admitted(card, cwd);
  const registry = await loadAtomRegistry();
  const atom = registry.atoms[card.atom];
  if (typeof atom !== "function") {
    return {
      card,
      gate,
      grade: { ok: false, issues: [`原子 ${card.atom} 不在注册表，散文不能单独晋升`] },
    };
  }
  const grade = await gradeExam(card, exam, atom, await readReceipts(cwd), cwd);
  return { card, grade, gate };
}

export async function examCard(
  name: string,
  cwd: string,
  root: string = CARDS_DIR,
): Promise<{ exitCode: number; message: string }> {
  try {
    const { grade, gate } = await loadGrade(name, cwd, root);
    if (gate) return { exitCode: 1, message: gate };
    if (!grade.ok) {
      const structural = grade.issues.some((item) => item.startsWith("card.") || item.startsWith("exam"));
      return {
        exitCode: structural ? 2 : 1,
        message: grade.issues.join("\n"),
      };
    }
    return { exitCode: 0, message: `${name} 三题全过` };
  } catch (e) {
    return { exitCode: 2, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function promoteCard(
  name: string,
  cwd: string,
  root: string = CARDS_DIR,
): Promise<{ exitCode: number; message: string }> {
  const examResult = await examCard(name, cwd, root);
  if (examResult.exitCode !== 0) return examResult;
  const split = authoringSplitIssue(path.join(cardDir(name, root), "exam.json"));
  if (split) return { exitCode: 1, message: split };
  const card = await readCard(name, root);
  if (!(await atomReachableOnDaily(card.atom))) {
    return {
      exitCode: 1,
      message: `原子 ${card.atom} 不在 daily 走得到的 scope 里，不能标成 latched`,
    };
  }
  card.status = "latched";
  await writeCard(card, root);
  return { exitCode: 0, message: `已闩住 ${name}` };
}
