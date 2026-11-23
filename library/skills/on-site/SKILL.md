---
name: on-site
description: >-
  Open the real app or repo, keep a sourced record of every step, and refuse
  unsourced numbers or edits outside the writable list. Use when a task needs
  a click-through, a screenshot, or a returned fact.
---

# 走到现场

自己打开 App 或仓库，自己点到要看的位置。不要把点击交回给用户。

每一步留下可核对的文件：截屏、导出，或带 sha256 的路径。没有这份文件，就没有这一步的结果。不编造数字。每条回传都要有 `path` 和 sha256。

`writable` 为空就不改任何路径。要改的路径写进任务单，别的不动。证据放在一个目录里，任务单的 `durability` 用入口已经判定的那一个。

```bash
latch task open --cwd <repo> --intent "<这一轮要看的>" --durability <once|lasting> --fact "<事实>" --source <path> --sha256 <hex> --writable <path>
latch task check --cwd <repo> --window evidence:<dir>
```

退出码不是 0 就停，先看 `.latch/last-route.json`。
