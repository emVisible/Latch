import { addSessionStep, openSession, readSession } from "../shared/session.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ENABLED_POLICY = {
  version: 1,
  changeDiscipline: { enabled: true, moduleConstCase: "screaming-snake" as const },
};

export async function coverSession(
  repo: string,
  at: string,
  evidence: string,
  fields: { target?: string; position?: string; observe?: string } = {},
): Promise<void> {
  const target = fields.target ?? "desk";
  if (!(await readSession(repo))) await openSession(repo, target);
  await addSessionStep(repo, at, evidence, {
    target,
    position: fields.position ?? at,
    observe: fields.observe ?? "打开笔记文件",
  });
}

export async function writePolicy(
  repo: string,
  policy: unknown = ENABLED_POLICY,
): Promise<void> {
  await fs.writeFile(
    path.join(repo, "latch.policy.json"),
    `${JSON.stringify(policy, null, 2)}\n`,
  );
}

export async function makeRepo(options: { agents?: boolean } = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "latch-test-"));
  if (options.agents !== false) {
    await fs.writeFile(path.join(dir, "AGENTS.md"), "# Rules\nKeep it clean.\n");
  } else {
    await fs.writeFile(path.join(dir, ".gitkeep"), "");
  }
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.email=probe@latch.test",
      "-c",
      "user.name=latch",
      "commit",
      "-qm",
      "init",
    ],
    { stdio: "ignore" },
  );
  return dir;
}

export async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export function fixture(name: string): string {
  return path.join(
    process.cwd(),
    "library",
    "routes",
    "change-discipline",
    "fixtures",
    `${name}.json`,
  );
}

export function fixtureWindow(name: string): string {
  return `fixture:${fixture(name)}`;
}
