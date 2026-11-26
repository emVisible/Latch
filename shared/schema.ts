import { NAME_RE } from "./paths.js";
import type { Expr, RouteDefinition } from "./route.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateExpr(expr: unknown, path = "when"): string[] {
  const issues: string[] = [];
  if (typeof expr === "string") {
    if (expr.trim().length === 0) issues.push(`${path}: 空引用`);
    return issues;
  }
  if (!isRecord(expr)) {
    issues.push(`${path}: 必须是字符串或 {all|any|not} 对象`);
    return issues;
  }
  const keys = ["all", "any", "not"].filter((k) => k in expr);
  if (keys.length !== 1) {
    issues.push(`${path}: 必须且只能含一个 all / any / not`);
    return issues;
  }
  const key = keys[0];
  if (key === "not") {
    issues.push(...validateExpr(expr.not, `${path}.not`));
  } else {
    const list = expr[key];
    if (!Array.isArray(list) || list.length === 0) {
      issues.push(`${path}.${key}: 需要非空数组`);
    } else {
      list.forEach((child, i) =>
        issues.push(...validateExpr(child, `${path}.${key}[${i}]`)),
      );
    }
  }
  return issues;
}

export function validateDomain(def: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(def)) return ["domain: 必须是对象"];
  if (typeof def.name !== "string" || !NAME_RE.test(def.name)) {
    issues.push("domain.name: 非法名称");
  }
  if (typeof def.description !== "string") {
    issues.push("domain.description: 必须是字符串");
  }
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    issues.push("domain.steps: 需要非空数组");
    return issues;
  }
  const ids = new Set<string>();
  def.steps.forEach((raw, i) => {
    const p = `steps[${i}]`;
    if (!isRecord(raw)) {
      issues.push(`${p}: 必须是对象`);
      return;
    }
    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      issues.push(`${p}.id: 必填`);
    } else if (ids.has(raw.id)) {
      issues.push(`${p}.id: 重复「${raw.id}」`);
    } else {
      ids.add(raw.id);
    }
    switch (raw.kind) {
      case "read":
        if (!isStringArray(raw.paths) || raw.paths.length === 0) {
          issues.push(`${p}.paths: 需要非空字符串数组`);
        }
        break;
      case "assert": {
        const hasAtom = typeof raw.atom === "string" && raw.atom.length > 0;
        const hasScript = typeof raw.script === "string" && raw.script.length > 0;
        if (!hasAtom && !hasScript) {
          issues.push(`${p}: assert 需要 atom 或 script 之一`);
        }
        if (hasAtom && hasScript) {
          issues.push(`${p}: atom 与 script 不能同时存在`);
        }
        if (hasScript && String(raw.script).includes("..")) {
          issues.push(`${p}.script: 不允许含 .. 路径`);
        }
        if ("expect" in raw && typeof raw.expect !== "boolean") {
          issues.push(`${p}.expect: 必须是布尔值`);
        }
        break;
      }
      case "slot":
        if (typeof raw.question !== "string" || !raw.question.trim()) {
          issues.push(`${p}.question: 必填`);
        }
        if (raw.answer !== "pass-fail") {
          issues.push(`${p}.answer: 目前只支持 pass-fail`);
        }
        break;
      case "tool":
        if (
          !(typeof raw.command === "string" && raw.command.trim()) &&
          !isStringArray(raw.command)
        ) {
          issues.push(`${p}.command: 需要字符串或字符串数组`);
        }
        break;
      default:
        issues.push(`${p}.kind: 未知步骤类型「${String(raw.kind)}」`);
    }
  });
  return issues;
}

export function validateRoute(def: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(def)) return ["route: 必须是对象"];
  if (typeof def.name !== "string" || !NAME_RE.test(def.name)) {
    issues.push("route.name: 非法名称");
  }
  if (def.version !== 1) issues.push("route.version: 必须是 1");
  if (!["unique", "first", "priority"].includes(String(def.policy))) {
    issues.push("route.policy: 只支持 unique / first / priority");
  }
  if (
    typeof def.maxRounds !== "number" ||
    !Number.isInteger(def.maxRounds) ||
    def.maxRounds < 1 ||
    def.maxRounds > 16
  ) {
    issues.push("route.maxRounds: 需要 1–16 的整数");
  }
  if (!isStringArray(def.routingAtoms) || def.routingAtoms.length === 0) {
    issues.push("route.routingAtoms: 需要非空字符串数组");
  }
  if (!isRecord(def.resultAtoms)) {
    issues.push("route.resultAtoms: 必须是对象");
  } else {
    for (const [key, spec] of Object.entries(def.resultAtoms)) {
      if (!isRecord(spec)) {
        issues.push(`resultAtoms.${key}: 必须是对象`);
        continue;
      }
      if (spec.from === "domain") {
        if (typeof spec.domain !== "string" || spec.field !== "ok") {
          issues.push(`resultAtoms.${key}: domain 规格需要 domain + field=ok`);
        }
      } else if (spec.from === "slot") {
        if (
          typeof spec.slot !== "string" ||
          !["answered", "pass"].includes(String(spec.field))
        ) {
          issues.push(`resultAtoms.${key}: slot 规格需要 slot + field=answered|pass`);
        }
      } else {
        issues.push(`resultAtoms.${key}: from 只支持 domain / slot`);
      }
    }
  }
  if (!Array.isArray(def.constraints)) {
    issues.push("route.constraints: 必须是数组");
  } else {
    def.constraints.forEach((c, i) => {
      if (typeof c !== "string" || !/^\s*[\w.]+\s*=>\s*!?[\w.]+\s*$/.test(c)) {
        issues.push(`constraints[${i}]: 只支持形如 A => B 或 A => !B 的蕴含式`);
      }
    });
  }
  if (!isRecord(def.molecules)) {
    issues.push("route.molecules: 必须是对象");
  } else {
    for (const [key, expr] of Object.entries(def.molecules)) {
      issues.push(...validateExpr(expr, `molecules.${key}`));
    }
  }
  if (!isRecord(def.stages) || !("entry" in def.stages)) {
    issues.push("route.stages: 必须是对象且包含 entry 阶段");
    return issues;
  }
  for (const [stageId, stage] of Object.entries(def.stages)) {
    if (!isRecord(stage)) {
      issues.push(`stages.${stageId}: 必须是对象`);
      continue;
    }
    if (!isStringArray(stage.scope) || stage.scope.length === 0) {
      issues.push(`stages.${stageId}.scope: 需要非空字符串数组`);
    }
    if (!Array.isArray(stage.links) || stage.links.length === 0) {
      issues.push(`stages.${stageId}.links: 需要非空数组`);
      continue;
    }
    stage.links.forEach((link, i) => {
      const p = `stages.${stageId}.links[${i}]`;
      if (!isRecord(link)) {
        issues.push(`${p}: 必须是对象`);
        return;
      }
      if (typeof link.id !== "string" || !link.id.trim()) {
        issues.push(`${p}.id: 必填`);
      }
      issues.push(...validateExpr(link.when, `${p}.when`));
      if (!isRecord(link.to)) {
        issues.push(`${p}.to: 必须是对象`);
        return;
      }
      if (!["run", "ask", "stop", "goto"].includes(String(link.to.kind))) {
        issues.push(`${p}.to.kind: 只支持 run / ask / stop / goto`);
      }
      if (link.to.kind === "run" && typeof link.to.domain !== "string") {
        issues.push(`${p}.to.domain: 必填`);
      }
      if (link.to.kind === "ask" && typeof link.to.slot !== "string") {
        issues.push(`${p}.to.slot: 必填`);
      }
      if (link.to.kind === "stop" && ![0, 1].includes(Number(link.to.exit))) {
        issues.push(`${p}.to.exit: 只能是 0 或 1`);
      }
      if (link.to.kind !== "stop" && typeof link.to.then !== "string") {
        issues.push(`${p}.to.then: 必填`);
      }
    });
  }
  return issues;
}

export const MODULE_CONST_CASES = ["screaming-snake", "camel", "off"] as const;
export type ModuleConstCase = (typeof MODULE_CONST_CASES)[number];

export type LatchPolicy = {
  version: 1;
  changeDiscipline: {
    enabled: boolean;
    moduleConstCase?: ModuleConstCase;
  };
};

export function validatePolicy(value: unknown): string[] {
  if (!isRecord(value)) return ["policy: 必须是对象"];
  const issues: string[] = [];
  if (value.version !== 1) issues.push("policy.version: 必须是 1");
  const discipline = value.changeDiscipline;
  if (!isRecord(discipline)) {
    issues.push("policy.changeDiscipline: 必须是对象");
    return issues;
  }
  if (typeof discipline.enabled !== "boolean") {
    issues.push("policy.changeDiscipline.enabled: 必须是布尔值");
  }
  const mode = discipline.moduleConstCase;
  const known = (MODULE_CONST_CASES as readonly string[]).includes(String(mode));
  if (mode !== undefined && !known) {
    issues.push("policy.changeDiscipline.moduleConstCase: 只能是 screaming-snake / camel / off");
  }
  if (discipline.enabled === true && !known) {
    issues.push("policy.changeDiscipline.moduleConstCase: 启用时必填");
  }
  return issues;
}

export function canonicalPolicy(value: LatchPolicy): LatchPolicy {
  const discipline: LatchPolicy["changeDiscipline"] = {
    enabled: value.changeDiscipline.enabled,
  };
  if (value.changeDiscipline.moduleConstCase) {
    discipline.moduleConstCase = value.changeDiscipline.moduleConstCase;
  }
  return { version: 1, changeDiscipline: discipline };
}

export function validateSettings(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value) || !Array.isArray(value.targets)) {
    return ["settings: 需要 { targets: [...] }"];
  }
  value.targets.forEach((t, i) => {
    if (!isRecord(t)) {
      issues.push(`targets[${i}]: 必须是对象`);
      return;
    }
    for (const key of ["id", "label", "path", "skillDir"]) {
      if (typeof t[key] !== "string" || !String(t[key]).trim()) {
        issues.push(`targets[${i}].${key}: 必填字符串`);
      }
    }
    if (typeof t.path === "string" && !t.path.startsWith("/")) {
      issues.push(`targets[${i}].path: 必须是绝对路径`);
    }
  });
  if ("current" in value && value.current !== undefined) {
    if (typeof value.current !== "string" || !value.current.startsWith("/")) {
      issues.push("settings.current: 必须是绝对路径");
    }
  }
  return issues;
}

const SHA256_RE = /^[a-f0-9]{64}$/;

export type TaskReturn = { fact: string; path?: string; sha256?: string };

export type TaskDocument = {
  intent: string;
  returns: TaskReturn[];
  writable: string[];
  durability: "once" | "lasting";
};

export function validateTask(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["task: 必须是对象"];
  if (typeof value.intent !== "string" || !value.intent.trim()) {
    issues.push("task.intent: 必填");
  }
  if (!["once", "lasting"].includes(String(value.durability))) {
    issues.push("task.durability: 只能是 once 或 lasting");
  }
  if (!isStringArray(value.writable)) {
    issues.push("task.writable: 需要字符串数组");
  }
  if (!Array.isArray(value.returns)) {
    issues.push("task.returns: 需要数组");
    return issues;
  }
  value.returns.forEach((item, i) => {
    const p = `task.returns[${i}]`;
    if (!isRecord(item)) {
      issues.push(`${p}: 必须是对象`);
      return;
    }
    if (typeof item.fact !== "string" || !item.fact.trim()) {
      issues.push(`${p}.fact: 必填`);
    }
    if ("path" in item && typeof item.path !== "string") {
      issues.push(`${p}.path: 必须是字符串`);
    }
    if ("sha256" in item && (typeof item.sha256 !== "string" || !SHA256_RE.test(item.sha256))) {
      issues.push(`${p}.sha256: 必须是 64 位十六进制`);
    }
  });
  return issues;
}

export type CardDocument = {
  name: string;
  atom: string;
  durability: "once" | "lasting";
  seen: number;
  lock: "architecture" | "assert" | "test";
  naiveExpect: boolean;
  status: "candidate" | "latched";
};

export function validateCard(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["card: 必须是对象"];
  if (typeof value.name !== "string" || !NAME_RE.test(value.name)) {
    issues.push("card.name: 非法名称");
  }
  if (typeof value.atom !== "string" || !value.atom.trim()) {
    issues.push("card.atom: 必填");
  }
  if (!["once", "lasting"].includes(String(value.durability))) {
    issues.push("card.durability: 只能是 once 或 lasting");
  }
  if (typeof value.seen !== "number" || !Number.isInteger(value.seen) || value.seen < 0) {
    issues.push("card.seen: 需要大于等于 0 的整数");
  }
  if (!["architecture", "assert", "test"].includes(String(value.lock))) {
    issues.push("card.lock: 只能是 architecture / assert / test，散文不能单独晋升");
  }
  if (typeof value.naiveExpect !== "boolean") {
    issues.push("card.naiveExpect: 必须是布尔值");
  }
  if (!["candidate", "latched"].includes(String(value.status))) {
    issues.push("card.status: 只能是 candidate 或 latched");
  }
  return issues;
}

export type ExamQuestion = {
  role: "routine" | "trap";
  expect: boolean;
  source: { path: string; sha256: string };
  naive?: { path: string; sha256: string };
  fixture: {
    added: string[];
    removed: string[];
    changedPaths: string[];
    policy?: LatchPolicy;
  };
};

export type ExamDocument = { questions: ExamQuestion[] };

function fixtureKey(fixture: ExamQuestion["fixture"]): string {
  return JSON.stringify({
    added: fixture.added,
    removed: fixture.removed,
    changedPaths: [...fixture.changedPaths].sort(),
    policy: fixture.policy ? canonicalPolicy(fixture.policy) : null,
  });
}

export function validateExam(card: { naiveExpect?: boolean }, value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    return ["exam.questions: 需要数组"];
  }
  if (value.questions.length !== 3) {
    issues.push("exam: 必须恰好三题");
  }
  const questions: ExamQuestion[] = [];
  value.questions.forEach((raw, i) => {
    const p = `exam.questions[${i}]`;
    if (!isRecord(raw)) {
      issues.push(`${p}: 必须是对象`);
      return;
    }
    if (raw.role !== "routine" && raw.role !== "trap") {
      issues.push(`${p}.role: 只能是 routine 或 trap`);
    }
    if (typeof raw.expect !== "boolean") issues.push(`${p}.expect: 必须是布尔值`);
    if (
      !isRecord(raw.source) ||
      typeof raw.source.path !== "string" ||
      !raw.source.path.trim() ||
      typeof raw.source.sha256 !== "string" ||
      !SHA256_RE.test(raw.source.sha256)
    ) {
      issues.push(`${p}.source: 需要 { path, sha256 }`);
    }
    if (
      !isRecord(raw.fixture) ||
      !isStringArray(raw.fixture.added) ||
      !isStringArray(raw.fixture.removed) ||
      !isStringArray(raw.fixture.changedPaths)
    ) {
      issues.push(`${p}.fixture: 需要 added / removed / changedPaths 字符串数组`);
      return;
    }
    let policy: LatchPolicy | undefined;
    if (raw.fixture.policy !== undefined) {
      const policyIssues = validatePolicy(raw.fixture.policy);
      if (policyIssues.length) {
        issues.push(...policyIssues.map((item) => `${p}.fixture.${item}`));
        return;
      }
      policy = canonicalPolicy(raw.fixture.policy as LatchPolicy);
    }
    let naive: ExamQuestion["naive"];
    if (raw.role === "trap") {
      if (
        !isRecord(raw.naive) ||
        typeof raw.naive.path !== "string" ||
        !raw.naive.path.trim() ||
        typeof raw.naive.sha256 !== "string" ||
        !SHA256_RE.test(raw.naive.sha256)
      ) {
        issues.push(`${p}.naive: 陷阱题需要已记录的 { path, sha256 }`);
        return;
      }
      naive = { path: raw.naive.path, sha256: raw.naive.sha256 };
    }
    questions.push({
      role: raw.role as ExamQuestion["role"],
      expect: raw.expect as boolean,
      source: raw.source as ExamQuestion["source"],
      ...(naive ? { naive } : {}),
      fixture: {
        added: raw.fixture.added as string[],
        removed: raw.fixture.removed as string[],
        changedPaths: raw.fixture.changedPaths as string[],
        ...(policy ? { policy } : {}),
      },
    });
  });
  const routines = questions.filter((q) => q.role === "routine").length;
  const traps = questions.filter((q) => q.role === "trap").length;
  if (questions.length === 3 && (routines !== 2 || traps !== 1)) {
    issues.push("exam: 角色必须是两道 routine 加一道 trap");
  }
  if (questions.length === 3 && new Set(questions.map((q) => fixtureKey(q.fixture))).size !== 3) {
    issues.push("exam: 三份夹具必须两两不同");
  }
  return issues;
}

export function validateMap(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["map: 必须是对象"];
  if (typeof value.name !== "string" || !NAME_RE.test(value.name)) {
    issues.push("map.name: 非法名称");
  }
  if (!Array.isArray(value.entries)) {
    issues.push("map.entries: 需要数组");
    return issues;
  }
  const ids = new Set<string>();
  value.entries.forEach((raw, i) => {
    const p = `entries[${i}]`;
    if (!isRecord(raw)) {
      issues.push(`${p}: 必须是对象`);
      return;
    }
    if (typeof raw.id !== "string" || !NAME_RE.test(raw.id)) {
      issues.push(`${p}.id: 非法名称`);
    } else if (ids.has(raw.id)) {
      issues.push(`${p}.id: 重复「${raw.id}」`);
    } else {
      ids.add(raw.id);
    }
    if (!isStringArray(raw.aliases) || raw.aliases.length === 0) {
      issues.push(`${p}.aliases: 需要非空字符串数组`);
    }
    if (typeof raw.location !== "string" || !raw.location.trim()) {
      issues.push(`${p}.location: 必填`);
    }
    if (typeof raw.observe !== "string" || !raw.observe.trim()) {
      issues.push(`${p}.observe: 必填`);
    }
    issues.push(
      ...validateDomain({
        name: typeof raw.id === "string" && NAME_RE.test(raw.id) ? raw.id : "entry",
        description: "map entry",
        steps: raw.steps,
      }).map((msg) => `${p}.${msg}`),
    );
  });
  return issues;
}

export function asRoute(value: unknown): RouteDefinition {
  return value as RouteDefinition;
}
