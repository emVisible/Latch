import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
    "openstrat",
    "fixtures",
    `${name}.json`,
  );
}

export function fixtureWindow(name: string): string {
  return `fixture:${fixture(name)}`;
}
