---
name: daily-loop
description: >-
  Order a daily task: decide whether the instruction lasts, then follow
  on-site, function-map, hard-lock, and, for a new lasting mistake, error-card
  and exam-pass. Use when the user asks for a daily check, a click-through, a
  screenshot proof, or a fix that must stick.
---

# 日常回路

先判断这句话活多久。会改变以后另一天的决定：长期，交给 `error-card`。只约束这一轮：一次性，`latch task open` 的 `durability` 写 `once`，不建卡。

然后按名字进入下一份，这里不写它们的步骤：

1. `on-site`
2. 说法对不上位置时，`function-map`
3. `hard-lock`
4. 出现新的长期错误时，`error-card`，然后 `exam-pass`

某一份的命令退出码不是 0，就停。日志里的「下一步」是下一句该跑的命令。
