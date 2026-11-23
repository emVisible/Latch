---
name: hard-lock
description: >-
  Run the daily route and stop when its exit code is not zero. Use when more
  than one person or agent can touch the same repo, or when a verbal promise
  is being offered instead of a gate.
---

# 硬锁

不用「请不要改」当锁。日常任务的入口命令是：

```bash
latch route daily --cwd <repo> --window evidence:<dir>
```

退出码不是 0 就停，先看 `.latch/last-route.json`。上一阶段没过，下一阶段只有停。

同一 git 根上同时只能有一个 `latch route`，锁文件是 `.latch/lease.json`。从子目录启动也锁在这个根上。人审留在考卷和不可逆动作。
