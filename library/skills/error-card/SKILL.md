---
name: error-card
description: >-
  Record one lasting mistake as one card with a check atom. Use when the same
  error should change a later session, not when the instruction is only for
  this turn.
---

# 一个错误一张卡

只收长期错误。一次性错误留在当次任务里，不建卡。一张卡只记一个错误。

`library/cards/<id>/` 里三样一起在：

- `card.json`：`lock` 只能是 `architecture`、`assert` 或 `test`。
- 一个检查原子，签名与 `library/atoms/index.mjs` 相同。
- `SKILL.md`，并且 `disable-model-invocation: true`。它只解释这张卡。

只写说明不算修过。原子写进某条路由的 `scope` 之后：

```bash
latch check <route>
```

退出码不是 0，这张卡还不能往下考。
