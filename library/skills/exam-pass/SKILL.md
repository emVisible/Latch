---
name: exam-pass
description: >-
  Read the data source, then pass two routine questions and one trap before a
  fix counts. Use when a card claims a mistake is fixed and needs promotion.
---

# 三题考卷

先用路由里的 `read` 步骤打开数据源。回执在 `.latch/reads.json`。没有这次读取，考卷拒绝。

`exam.json` 恰好三题：两道 `routine`，一道 `trap`。三份夹具两两不同。陷阱题的期望不同于 `naiveExpect`。每题的 `source` 是刚读过的路径和 sha256。

```bash
latch exam <card> --cwd <repo>
```

考卷只看原子和夹具，不看这张卡的说明。退出码不是 0，修复就不算通过。

同一原子还要在两个不同快照里被路由看见，或者当前快照上由声明了这个 slot 的路由答过 pass：

```bash
latch slot card-gate card-promote=pass --cwd <repo>
latch card promote <card> --cwd <repo>
```

原子不在任何路由的 `scope` 里，`promote` 不会把卡标成 `latched`。
