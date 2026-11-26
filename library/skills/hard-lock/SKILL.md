---
name: hard-lock
description: >-
  Hold a session lease so a second agent cannot write the same repo. Use when
  more than one agent can touch the repo, or a verbal promise is being offered
  instead of a gate.
---

# 硬锁

不用「请不要改」当锁。hook 会给这次会话一个编号，写进 `.latch/hook-session`，租约一直留到：

```bash
latch session end --cwd <repo>
```

会话没结束时，第二个 agent 跑 `latch route` 会退出码 1。进程已经死掉的租约可以回收。不带会话号的调试命令在命令结束时放锁。

日常入口仍是 `latch route daily --cwd <repo>`。退出码不是 0 就停。
