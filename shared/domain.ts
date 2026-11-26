import fs from "node:fs/promises";
import { DOMAINS_DIR, domainDir, domainFile } from "./paths.js";

export type DomainStep =
  | { id: string; kind: "read"; paths: string[]; emit?: boolean }
  | { id: string; kind: "assert"; atom?: string; expect?: boolean; script?: string }
  | {
      id: string;
      kind: "slot";
      question: string;
      answer: "pass-fail";
      onFail: "stop";
    }
  | { id: string; kind: "tool"; command: string | string[] };

export type DomainDefinition = {
  name: string;
  description: string;
  /** Display-only metadata; never used for routing decisions. */
  mount?: { repos?: string[]; when?: string[] };
  steps: DomainStep[];
};

export async function listDomains(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readDomain(name: string): Promise<DomainDefinition> {
  const raw = await fs.readFile(domainFile(name), "utf8");
  return JSON.parse(raw) as DomainDefinition;
}

export async function writeDomain(def: DomainDefinition): Promise<void> {
  const dir = domainDir(def.name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    domainFile(def.name),
    `${JSON.stringify(def, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Explanation layer only. Enforcement lives in hooks (see shared/hooks.ts);
 * a rule file is prose and must never be the thing that "latches" the agent.
 */
export function compileAlwaysApplyRule(
  domain: DomainDefinition,
  routeName: string,
): string {
  return `---
description: Latch 静态域 ${domain.name} 由 hook 强制执行，不要绕过
alwaysApply: true
---

# ${domain.name}

本仓库的改动纪律由 Latch 链路路由执行，入口是 \`.cursor/hooks.json\`、
\`.claude/settings.json\` 与 git \`pre-commit\`。**本规则只作说明，不是执行层。**

- 不要自行重排、跳过或用另一套写法替代 \`latch route ${routeName}\` 选出的步骤。
- 被闩住时先修代码，再重跑；不要注释掉 hook 或修改路由来放行。
- 运行细节与 slot 状态在目标仓库的 \`.latch/last-route.json\`。
- 需要人工判断的 slot 只许答 \`pass\` 或 \`fail\`，由 \`latch slot\` 写入。

（静态域正文与链路表都在 Latch 仓库 \`library/\`，此处不保存副本。）
`;
}
