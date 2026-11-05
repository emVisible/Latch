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
      if (typeof c !== "string" || !/^\s*[\w.]+\s*=>\s*[\w.]+\s*$/.test(c)) {
        issues.push(`constraints[${i}]: 只支持形如 A => B 的蕴含式`);
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
      if (!["run", "ask", "stop"].includes(String(link.to.kind))) {
        issues.push(`${p}.to.kind: 只支持 run / ask / stop`);
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
  return issues;
}

export function asRoute(value: unknown): RouteDefinition {
  return value as RouteDefinition;
}
