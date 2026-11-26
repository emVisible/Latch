---
name: error-card
description: >-
  Record one lasting mistake as one card with a check atom. Use when the same
  error should change a later session, not when the instruction is only for
  this turn.
---

# 一个错误一张卡

先分清这句话活多久。一次性要求只写在任务单的 `durability: once` 里，不建卡。长期要求才建一张卡，一张卡只记一个错误。

卡里要有检查原子，并且 `SKILL.md` 设 `disable-model-invocation: true`。只写说明不算修过。

原子还没出现在 `daily` 从入口走得到的 `scope` 里，就不能标成 `latched`。`promote` 不改路由。
