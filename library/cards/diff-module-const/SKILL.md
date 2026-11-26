---
name: diff-module-const
description: >-
  Stop a module-level constant whose case fights the repo convention. Use when
  reviewing a new literal const and latch.policy.json sets moduleConstCase.
disable-model-invocation: true
---

# diff.moduleConstCase

方向来自目标仓库的 `moduleConstCase`。`screaming-snake` 拒绝新增的小写模块常量；`camel` 拒绝新增大写下划线常量；`off` 恒为假。`use*` 与 `*Ref` 在 screaming-snake 下除外。单个全大写缩写如 `URL` 在 camel 下不算。这张卡由原子批改，本文不参与打分。
