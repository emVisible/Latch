#!/usr/bin/env node
import { fail, gitDiffLines } from "./lib/git-diff.mjs";

const { added } = gitDiffLines();
const hits = added.filter((line) => /\buseEffect\s*\(/.test(line));
if (hits.length === 0) process.exit(0);
fail("diff 中新增了 useEffect，与本仓库纪律冲突：", hits);
