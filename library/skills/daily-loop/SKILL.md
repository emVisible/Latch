---
name: daily-loop
description: >-
  Order a daily task: decide whether the instruction lasts, then follow
  on-site, function-map, hard-lock, and, for a new lasting mistake, error-card
  and exam-pass. Use when the user asks for a daily check, a click-through, a
  screenshot proof, or a fix that must stick.
---

# 日常回路

先判断这句话活多久，再按名字进入下一份 skill。这里不写它们的步骤。

- 会改变以后另一天、另一个会话里的决定：长期。交给 `error-card`。已经闩住的长期规则直接做，不要再问。
- 只约束这一轮的范围、数字或例外：一次性。`latch task open` 的 `durability` 写 `once`，不建卡。
- 长期任务单写 `durability lasting`。不要把这次判断写成永远的 `once`。

顺序：

1. `on-site`
2. 说法对不上位置时，`function-map`
3. `hard-lock`
4. 出现新的长期错误时，`error-card`，然后 `exam-pass`

某一份的命令退出码不是 0，就停在那一份，不要用后一份的说明把结果说成完成。
