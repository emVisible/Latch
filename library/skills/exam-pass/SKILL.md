---
name: exam-pass
description: >-
  Pass two routine questions and one trap taken from a recorded naive edit
  before a fix counts. Use when a card claims a lasting mistake is fixed.
---

# 三题考卷

先用路由里的 `read` 读数据源。没有 `.latch/reads.json` 里的回执，考卷拒绝。

恰好两道 `routine`、一道 `trap`。陷阱题的 `naive` 必须是 `latch card capture-naive` 记下来的路径和 sha256。没有这份记录，退出码 1。

```bash
latch card capture-naive <card> --cwd <repo> --source <path>
latch exam <card> --cwd <repo>
```

出题不读原子实现，也不读这张卡的说明。批改只跑原子对夹具。原子和 `exam.json` 在同一次提交里，`promote` 退出码 1。
