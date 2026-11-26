---
name: on-site
description: >-
  Accept a returned fact only when the session list matches the feature map:
  opened target, screenshot or export sha256, clicked position, location, and
  observe. Use when a task needs a click-through, a screenshot, or a sourced number.
---

# 走到现场

证明要沿用户看得见的路径走完。只截一张已经打开的屏幕，不算证明。

功能条目在 `.latch/map.json`（代码，不是 wiki）里：`id`，`aliases`，`location`，`observe`，`steps`。模糊说法只按别名做子串包含。全图恰好一条才算命中。未命中或歧义时不要猜位置。匹配细则在 `function-map`。

## Sub-features

- 任务没有回传事实：这一关放过。
- 回传事实对上地图 `location` 和 `observe`，打开的目标、点中的位置、证据哈希都在这次会话清单里，且哈希是 Latch 读盘算出来的：通过。
- 目标、位置、observe 或哈希有一项对不上：停下。

## How to get to it (user POV)

先得到唯一命中的 `location`。用户从那里进入，做到 `observe` 要求看得见的结果。打开页面就停住，证据里没有那个结果，就不算走到现场。

## Driving it with the harness

```bash
latch session open --cwd <repo> --target <app>
latch session step --cwd <repo> --at <地图 location> --position <点中的位置> --observe "<地图 observe>" --evidence <文件>
```

`latch session step` 读证据文件并写入 sha256。它不截屏、不启动 App、不记录指针。缺了打开的目标、点中的位置、observe 或证据文件就拒绝。回传事实的 `path` 必须被这一步的证据盖住，这一步的目标、位置、observe 必须对上地图条目。

`latch bot next` 是硬门。回传事实没有同时绑上功能地图位置和 Latch 算出的会话证据哈希时，退出码 1。没有回传事实，或这两样都在，这一关才可以退出码 0。

## Gotchas

写在任务 `returns[].sha256` 上的哈希不算，哪怕它和文件内容一致。证据文件在步骤写入后又被改过，快照会拒绝这份会话。`writable` 为空就不改任何代码路径。不编造数字。
