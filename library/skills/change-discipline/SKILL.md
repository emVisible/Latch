---
name: change-discipline
description: >-
  Gate a code change against the repo's own rules and four negative-diff
  checks, then answer one style-drift slot. Use when planning, implementing,
  reviewing, or committing any diff that rewrites working code.
---

# 改动纪律

模型在 plan、build、commit 时没打开仓库自己的规则，才会把已经干净的代码改差。这份 skill 只解释那道门。执行层是 `latch route daily`（目标仓库放了 `latch.policy.json` 且 `changeDiscipline.enabled` 为 true）或显式的 `latch route change-discipline`。

## 优先级

1. 用户当前指令
2. 仓库根目录 `AGENTS.md` 与 `.cursorrules`
3. 本 skill
4. 其他 skill

冲突时停在更高优先级。不要用社区习惯覆盖这个仓库已经写明的约定。社区规则只在任务确实命中时读一条，不要通读整份规则库。

## 三个节点，同一组检查

动手前、写完后、提交前各过一遍。任一条失败就改掉。

**Plan**

- 先读 `AGENTS.md` 里和这次改动相关的段落，再读将被改动的函数原文。
- 原文已经满足需求时，只改差额。不重排控制流，不换抽象。

**Build**

- 新代码的命名、分支、抽象层级和所在文件已有代码一致。
- 模块常量跟该文件已有的约定走。约定由目标仓库的 `latch.policy.json` 写成 `screaming-snake`、`camel` 或 `off`。

**Commit 前**

- 把 diff 当成别人的 review 再读一遍。
- 解释自己代码的注释删掉，让代码自己说明。

## 四类负优化

这些是断言，不是散文。policy 没开时它们不生效。

**不要新增 `useEffect(`。** 派生状态在 render 里算。用户操作写在事件处理函数里。注释里出现这个词、或没有调用括号，不算。

不要为了塞进 hook，把早返回改成三元再包一层 effect。

**不要加没人要求的保活。** 新增 `visitedTabs`，或用 `display: "none"` 把已经卸载的面板留在树上，都算违约。纯注释不算。

**不要把早返回改成更长的三元。** 原来更短、更好读，就留着。

**模块常量跟仓库约定走。** `screaming-snake` 时，新增的小写模块常量（字面量赋值）违约；`use*`、`*Ref` 除外。`camel` 时，新增大写下划线常量违约；单个全大写缩写如 `URL` 不算。`off` 关闭这一条。
