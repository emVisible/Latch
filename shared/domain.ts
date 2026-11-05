import fs from "node:fs/promises";
import path from "node:path";
import { DOMAINS_DIR } from "./paths.js";

export type DomainStep =
  | { id: string; kind: "read"; paths: string[] }
  | { id: string; kind: "assert"; script: string }
  | {
      id: string;
      kind: "slot";
      question: string;
      answer: "pass-fail";
      onFail: "stop";
    }
  | { id: string; kind: "tool"; command: string };

export type DomainDefinition = {
  name: string;
  description: string;
  mount?: { repos?: string[]; when?: string[] };
  steps: DomainStep[];
};

export async function listDomains(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function readDomain(name: string): Promise<DomainDefinition> {
  const file = path.join(DOMAINS_DIR, name, "domain.json");
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as DomainDefinition;
}

export async function writeDomain(def: DomainDefinition): Promise<void> {
  const dir = path.join(DOMAINS_DIR, def.name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "domain.json"),
    `${JSON.stringify(def, null, 2)}\n`,
    "utf8",
  );
}

export function compileAlwaysApplyRule(domain: DomainDefinition): string {
  return `---
description: 运行 Latch 静态域 ${domain.name}，不要自行重排步骤
alwaysApply: true
---

# ${domain.name}

在本仓库 plan、edit、commit 前，在仓库根目录运行：

\`\`\`bash
cd <本仓库根>
npm run latch -- run ${domain.name} --cwd .
\`\`\`

（Latch 安装在 \`~/Company/latch\` 时也可 \`latch run ${domain.name}\`。）

assert 未通过必须修完再继续。slot 只许答 \`pass\` 或 \`fail\`；\`fail\` 则停止。不要自行重排或跳过步骤。
`;
}
