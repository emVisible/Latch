---
name: function-map
description: >-
  Match a vague report to one feature entry in the repo map. Use when the
  request names a feature but not the screen, command, or file that holds it.
---

# 功能地图

地图是目标仓库里的代码 `.latch/map.json`，不是 wiki。本地地图盖过库里的示例。空模板一条都命中不了。

一条功能条目含这些字段：`id`，`aliases`（用户会怎么说），`location`（用户落到哪里），`observe`（必须看得见什么），`steps`（harness 要读哪些路径）。

能接受的证据只有一种：会话步骤的 `--at` 等于这条 `location`，证据文件盖住回传事实的路径，sha256 由 `latch session step` 读盘写入。手写在任务上的哈希不算。只打开屏幕、看不见 `observe`，也不算。证明细则在 `on-site`。

## Sub-features

- 唯一命中：用户的说法里只含一条条目的别名。记下它的 `location` 和 `observe`。
- 未命中：没有任何别名被包含。
- 歧义：不止一条条目的别名被包含。

## How to get to it (user POV)

用用户自己的话去对 `aliases`，不要换成一个听起来接近的入口。对上之后，用户要走到那条 `location`，并让 `observe` 里写的东西出现在眼前。屏幕开着、要看的东西没出现，这条功能不算走到。

## Driving it with the harness

```bash
latch map "<用户的说法>"
```

记一条功能，运行 `latch map add`。

查询先转成小写。一条别名被包含在查询里，且全图只有这一条，才是命中。没有命中或不止一条，不要猜，也不要改地图。候选只追加在 `.latch/map-candidates.json`。

## Gotchas

别名是子串包含。「数据」会同时打到图表和表格。空的本地 `.latch/map.json` 会盖过库里的示例，于是什么都命中不了。
