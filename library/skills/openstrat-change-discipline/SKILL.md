---
name: openstrat-change-discipline
description: >-
  Gate every Openstrat change at plan, edit, and commit against AGENTS.md and
  the surrounding file's style. Use when planning, implementing, refactoring,
  reviewing, or committing in this repo, including charts, movement-alert,
  useEffect, useSWR, NativeWind, axis labels, or any diff that rewrites
  working code. Stops negative refactors and style drift before they land.
---

# Openstrat 改动纪律

本质上是 agent 在 plan、build、commit、review 的关键节点没有仔细审阅，导致犯了原则性问题，代码书写范式与 repo 本身的代码风格大差径庭。repo 本身强调干净、整洁、优雅的代码。如果原有的代码本身已经符合规范，那么就不要向更差的方向改动，不要进行负优化。

## 优先级

1. 用户当前指令
2. 仓库根目录 `AGENTS.md` 与 `.cursorrules`
3. 本 skill
4. 其他 skill（`.agents/skills/vercel-react-native-skills`、`code-comments`、Expo skills）

冲突时停在更高优先级。不要用社区 RN 习惯覆盖本仓库。

已知冲突：

- 数据请求只用 `useSWR`。不要用 `useEffect` 拉数。
- 普通点击用 `Pressable`，不要为了 Vercel 的 `animation-gesture-detector-press` 把现有 `Pressable` 改成 `Gesture.Tap`。
- 样式用 React Native 原语 + NativeWind `className`。不要新引入 Tamagui。
- 不要把列表改成 FlashList，除非用户要求。
- 图表刻度字号按 `AGENTS.md`：12 / 18 / 400。

只在任务确实命中时再读社区规则文件，一次读一条，不要通读整份规则库。

## 四个关卡

动手前、写完后、提交前各过一遍。任一条失败就改掉，不要留到 review。

**Plan**

- 先读 `AGENTS.md` 里和这次改动相关的段落，再读将被改动的函数原文。
- 原文已经满足需求时，只改差额。不重排控制流，不换抽象。

**Build**

- 新代码的命名、分支、抽象层级和所在文件已有代码一致。
- 文件里的模块常量是 `AXIS_TICK_FONT_SIZE` 这种全大写下划线，新增模块常量沿用同一套。计算出来的局部量用普通 camelCase，不要另起一套命名。

**Commit 前**

- 把 diff 当成别人的 review 再读一遍。对照下面的反例。
- 注释只保留 `code-comments` skill 允许的那几类。解释自己代码的注释删掉，让代码自己说明。

## 禁止的负优化

这些都在本仓库真实 review 里被打回。

**不要新增 `useEffect`。** 派生状态在 render 里算。用户操作写在事件处理函数里。`AGENTS.md` 已禁止用 `useEffect` 拉数；用 effect 去同步「访问过的 tab」同样不接受。

```tsx
if (error || !data?.gex) return null;

const availableTabs = data.tabs.filter((tab) => {
  if (tab.key === "volatility") return Boolean(data.volatility);
  if (tab.key === "gamma") return Boolean(data.gamma);
  return Boolean(data.gex);
});
```

不要为了塞进 hook，把这段改成 `data?.gex && !error ? filter : []` 再加 `useEffect`。

**条件渲染保持原来的样子。**

```tsx
{displayedTab === "gex" ? <GexPanel data={data} /> : null}
```

不要改成 `display: "none"` 保活、`visitedTabs`，或叠一层 `availableTabs.some(...)`。用户没有要求这个机制，就不要加。

**早返回不要改成三元。** 原来更短、更好读，就留着。

## 和社区 skill 怎么配合

- 列表、动画、图片、安全区：读 `vercel-react-native-skills/rules/` 里对应的一条。
- 要加或删注释：先读 `code-comments`。
- Expo 命令与目录：用已安装的 `expo-*` skills，不要另写一套。
