#!/usr/bin/env node
import { fail, gitDiffLines } from "./lib/git-diff.mjs";

const { added } = gitDiffLines();
const hits = added.filter((line) => {
  if (/^\+\s*const \w+ = .+&&.+ \? .+ :/.test(line)) return true;
  if (/^\+\s*const \w+ = .+\? .+ : \[\]/.test(line)) return true;
  if (/^\+\s*return .+ \? .+ : null;/.test(line)) return true;
  return false;
});
if (hits.length === 0) process.exit(0);
fail("diff 中把早返回/直写分支改成了三元或 cond ? [] 写法：", hits);
