---
name: function-map
description: >-
  Resolve a user's words to one map entry before acting. Use when the request
  names a feature but not the screen, command, or file that holds it.
---

# 功能地图

用户的说法对不上具体位置时再用。不要猜一个看起来像的入口。

```bash
latch map <app> --query "<用户的说法>" --cwd <repo>
```

- 退出码 0，`hit`：用 journal 里 `payload.map` 的那一条。
- 退出码 1，`miss` 或 `ambiguous`：停。候选只追加在 `.latch/map-candidates.json`。

不改 `library/maps/`。
