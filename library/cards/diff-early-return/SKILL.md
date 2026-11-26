---
name: diff-early-return
description: >-
  Stop a diff that rewrites an early return into a longer ternary. Use when
  reviewing a change that reshapes control flow to fit a hook.
disable-model-invocation: true
---

# diff.earlyReturnToTernary

把早返回改成 `return cond ? value : null`，或改成 `const x = a && b ? c : d` / `cond ? value : []`，即违约。普通的一行赋值不算。这张卡由原子批改，本文不参与打分。
