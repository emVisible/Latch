import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { SKILLS_DIR, NAME_RE, skillDir } from "./paths.js";

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

/** Implements the Agent Skills spec frontmatter rules (agentskills.io/specification). */
export function validateSkill(
  folderName: string,
  frontmatter: SkillFrontmatter,
): string[] {
  const issues: string[] = [];
  const name = frontmatter.name;
  if (!name || typeof name !== "string") {
    issues.push("缺少 frontmatter.name");
  } else {
    if (name.length < 1 || name.length > 64) issues.push("name 长度须为 1–64 字符");
    if (!NAME_RE.test(name)) {
      issues.push("name 须为小写字母、数字、连字符，且不含连续或首尾连字符");
    }
    if (name !== folderName) {
      issues.push(`name「${name}」与目录名「${folderName}」不一致`);
    }
  }

  const desc = frontmatter.description;
  if (!desc || typeof desc !== "string" || desc.trim().length === 0) {
    issues.push("缺少 description");
  } else {
    if (desc.length > 1024) issues.push("description 超过 1024 字符");
    // The spec asks for both "what it does" and "when to use it".
    if (!/(use when|when to use|何时|用途|适用)/i.test(desc)) {
      issues.push("建议：description 同时写清「做什么」与「何时用」");
    }
  }

  if ("compatibility" in frontmatter) {
    const c = frontmatter.compatibility;
    if (typeof c !== "string") issues.push("compatibility 必须是字符串");
    else if (c.length > 500) issues.push("compatibility 超过 500 字符");
  }
  if ("license" in frontmatter && typeof frontmatter.license !== "string") {
    issues.push("license 必须是字符串");
  }
  if ("metadata" in frontmatter) {
    const m = frontmatter.metadata;
    if (typeof m !== "object" || m === null || Array.isArray(m)) {
      issues.push("metadata 必须是键值映射");
    } else if (
      Object.values(m as Record<string, unknown>).some((v) => typeof v !== "string")
    ) {
      issues.push("metadata 的值必须都是字符串");
    }
  }
  if ("allowed-tools" in frontmatter) {
    if (typeof frontmatter["allowed-tools"] !== "string") {
      issues.push("allowed-tools 必须是空格分隔的字符串（实验性字段）");
    }
  }
  return issues;
}

export async function listSkills(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readSkill(name: string): Promise<SkillRecord> {
  const skillPath = path.join(skillDir(name), "SKILL.md");
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
  const dir = skillDir(name);
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
