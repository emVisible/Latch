import type { Expr } from "./route.js";

export class MoleculeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoleculeError";
  }
}

export type MoleculeTable = Record<string, Expr>;

export function collectRefs(expr: Expr, out: Set<string> = new Set()): Set<string> {
  if (typeof expr === "string") {
    out.add(expr);
    return out;
  }
  if ("all" in expr) expr.all.forEach((e) => collectRefs(e, out));
  else if ("any" in expr) expr.any.forEach((e) => collectRefs(e, out));
  else if ("not" in expr) collectRefs(expr.not, out);
  return out;
}

export function evalExpr(
  expr: Expr,
  values: Record<string, boolean>,
  molecules: MoleculeTable,
  stack: string[] = [],
): boolean {
  if (typeof expr === "string") {
    if (expr in molecules) {
      if (stack.includes(expr)) {
        throw new MoleculeError(`分子循环引用：${[...stack, expr].join(" -> ")}`);
      }
      return evalExpr(molecules[expr], values, molecules, [...stack, expr]);
    }
    return values[expr] === true;
  }
  if ("all" in expr) return expr.all.every((e) => evalExpr(e, values, molecules, stack));
  if ("any" in expr) return expr.any.some((e) => evalExpr(e, values, molecules, stack));
  if ("not" in expr) return !evalExpr(expr.not, values, molecules, stack);
  throw new MoleculeError(`无法识别的表达式：${JSON.stringify(expr)}`);
}

/** Validate that molecules form a DAG and only reference declared names. */
export function validateMolecules(
  molecules: MoleculeTable,
  knownNames: Set<string>,
): string[] {
  const issues: string[] = [];
  const names = new Set(Object.keys(molecules));
  const allKnown = new Set([...knownNames, ...names]);

  for (const [name, expr] of Object.entries(molecules)) {
    for (const ref of collectRefs(expr)) {
      if (!allKnown.has(ref)) {
        issues.push(`molecules.${name} 引用了未声明的「${ref}」`);
      }
    }
    try {
      evalExpr(expr, {}, molecules, [name]);
    } catch (e) {
      if (e instanceof MoleculeError) issues.push(e.message);
    }
  }
  return issues;
}
