import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureLatchGitignore } from "./journal.js";
import { repoLatch } from "./paths.js";

export type NaiveCapture = { path: string; sha256: string };

type NaiveFile = { cards: Record<string, NaiveCapture> };

function fileOf(repo: string): string {
  return repoLatch(repo, "naive.json");
}

async function readAll(repo: string): Promise<NaiveFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(fileOf(repo), "utf8")) as NaiveFile;
    if (!parsed || typeof parsed !== "object" || !parsed.cards) return { cards: {} };
    return parsed;
  } catch {
    return { cards: {} };
  }
}

export async function readNaive(repo: string, card: string): Promise<NaiveCapture | null> {
  const all = await readAll(repo);
  return all.cards[card] ?? null;
}

export async function captureNaive(
  repo: string,
  card: string,
  source: string,
): Promise<NaiveCapture> {
  const rel = source.split(path.sep).join("/");
  const buf = await fs.readFile(path.join(repo, rel));
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await ensureLatchGitignore(repo);
  const all = await readAll(repo);
  all.cards[card] = { path: rel, sha256 };
  await fs.mkdir(path.dirname(fileOf(repo)), { recursive: true });
  await fs.writeFile(fileOf(repo), `${JSON.stringify(all, null, 2)}\n`, "utf8");
  return all.cards[card];
}
