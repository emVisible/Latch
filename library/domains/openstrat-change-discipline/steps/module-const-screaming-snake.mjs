#!/usr/bin/env node
import { fail, gitDiffLines } from "./lib/git-diff.mjs";

const { added } = gitDiffLines();
const hits = added.filter((line) => {
  const m = line.match(
    /^\+\s*(?:export\s+)?const ([a-z][a-zA-Z0-9]*) = ([\d"'`]|true|false)/,
  );
  if (!m) return false;
  const name = m[1];
  if (name.startsWith("use") || name.endsWith("Ref")) return false;
  if (/^(default|async)$/.test(name)) return false;
  return true;
});
if (hits.length === 0) process.exit(0);
fail(
  "diff 中新增的模块级常量使用了 camelCase；请沿用文件内 AXIS_TICK_FONT_SIZE 这类全大写下划线：",
  hits,
);
