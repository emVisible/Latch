import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { SKILLS_DIR } from "./paths.js";

export type SkillFrontmatter = {
  name?: string;
  description?: string;
  [key: string]: unknown;
};

export type SkillRecord = {
  name: string;
  description: string;
  body: string;
  raw: string;
  path: string;
  issues: string[];
};

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseSkillMarkdown(raw: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatter = YAML.parse(match[1]) as SkillFrontmatter;
  return { frontmatter, body: match[2] ?? "" };
}

export function validateSkill(
  folderName: string,
  frontmatter: SkillFrontmatter,
): string[] {
  const issues: string[] = [];
  const name = frontmatter.name;
  if (!name || typeof name !== "string") {
    issues.push("缺少 frontmatter.name");
  } else {
    if (name.length > 64) issues.push("name 超过 64 字符");
    if (!NAME_RE.test(name)) issues.push("name 须为小写字母、数字、连字符");
    if (name !== folderName) {
      issues.push(`name「${name}」与目录名「${folderName}」不一致`);
    }
  }
  const desc = frontmatter.description;
  if (!desc || typeof desc !== "string" || desc.trim().length === 0) {
    issues.push("缺少 description");
  } else if (desc.length > 1024) {
    issues.push("description 超过 1024 字符");
  }
  return issues;
}

export async function listSkills(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function readSkill(name: string): Promise<SkillRecord> {
  const skillPath = path.join(SKILLS_DIR, name, "SKILL.md");
  const raw = await fs.readFile(skillPath, "utf8");
  const { frontmatter, body } = parseSkillMarkdown(raw);
  const issues = validateSkill(name, frontmatter);
  return {
    name: (frontmatter.name as string) ?? name,
    description: (frontmatter.description as string) ?? "",
    body,
    raw,
    path: skillPath,
    issues,
  };
}

export async function writeSkill(
  name: string,
  raw: string,
): Promise<SkillRecord> {
  const dir = path.join(SKILLS_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  await fs.writeFile(skillPath, raw, "utf8");
  return readSkill(name);
}

export function serializeSkill(
  frontmatter: SkillFrontmatter,
  body: string,
): string {
  const yaml = YAML.stringify(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n${body.replace(/^\n/, "")}`;
}
