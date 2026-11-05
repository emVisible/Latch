#!/usr/bin/env node
import { fail, gitDiffLines } from "./lib/git-diff.mjs";

const { added } = gitDiffLines();
const hits = added.filter((line) => {
  if (/\bvisitedTabs\b/.test(line)) return true;
  if (/display:\s*["']none["']/.test(line)) return true;
  if (/style=\{\{[^}]*display:\s*["']none["']/.test(line)) return true;
  return false;
});
if (hits.length === 0) process.exit(0);
fail("diff 中新增了 tab 保活（visitedTabs 或 display:none），未经要求不得添加：", hits);
