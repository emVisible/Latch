---
name: diff-use-effect
description: >-
  Stop a diff that adds a useEffect( call. Use when reviewing a change that
  might fetch data or sync state in an effect.
disable-model-invocation: true
---

# diff.useEffect

新增 `useEffect(` 即违约。注释或没有调用括号的 `useEffect` 不算。这张卡由原子批改，本文不参与打分。
