# 改动纪律

Latch 不内置任何一个具体仓库。改动纪律是一组固定检查，开关在目标仓库自己的根目录。

## policy

`latch.policy.json`：

```json
{
  "version": 1,
  "changeDiscipline": {
    "enabled": true,
    "moduleConstCase": "screaming-snake"
  }
}
```

- 文件不存在，或 `enabled` 不是 true：`daily` 跳过这组检查。显式 `latch route change-discipline` 退出码 1，原因是未配置或未启用。
- 文件存在但写错：快照采集失败，路由退出码 3。写错不能被当成「没开」。
- `moduleConstCase` 只能是 `screaming-snake`、`camel` 或 `off`。它只决定模块常量那一条的方向，不能增删另外三条。
- policy 计入快照哈希。改 policy 会让已经答过的 `style-drift` 作废。
- `.latch/` 里的任务单和回执不算代码改动。没有代码改动时不询问槽位。

四条规则是一组，不在 policy 里写正则。要加第五条，走错误卡和原子晋升。

## 四条检查与一个槽

policy 启用且这次快照里有代码改动时：

| 原子 | 为真 |
| --- | --- |
| `diff.useEffect` | 新增行里有 `useEffect(` |
| `diff.tabKeepalive` | 新增 `visitedTabs`，或 `display: "none"` 保活。纯注释不算 |
| `diff.earlyReturnToTernary` | 新增把早返回改成更长的三元 |
| `diff.moduleConstCase` | 新的模块常量不符合 `moduleConstCase`。`off` 时恒为假 |

任一为真，路由在进入域之前停下，退出码 1。四条都为假时，域先读目标仓库的 `AGENTS.md`，再跑同样的断言，然后询问 `style-drift`：新代码的命名和控制流是否与所在文件一致，且没有把已经符合规范的写法改差。未答退出码 5，fail 退出码 1，pass 之后 `daily` 才进入功能地图。

`screaming-snake` 沿用「新增的小写模块常量算违约」，`use*` 和 `*Ref` 除外。`camel` 把新增大写下划线常量算违约，单个全大写缩写如 `URL` 不算。

## 优先级

当前用户指令，然后是目标仓库的 `AGENTS.md` 与 `.cursorrules`，然后是 `change-discipline` 这份说明，然后才是社区 skill。社区习惯不能覆盖仓库已经写明的约定。plan、build、commit 过的是同一组检查。原文已经满足需求时只改差额。

## 目标仓库的 AGENTS.md 可以怎么写

下面是一份 React Native 仓库的示例。它属于那个仓库，Latch 运行时不读这篇文档。

```md
# 仓库约定

- 数据请求只用 useSWR。不要用 useEffect 拉数。
- 普通点击用 Pressable。不要为了社区动画规则把现有 Pressable 改成 Gesture.Tap。
- 样式用 React Native 原语加 NativeWind 的 className。不要新引入另一套样式库。
- 不要把列表改成 FlashList，除非用户要求。
- 图表刻度字号沿用仓库里已经写死的 12 / 18 / 400。
```

对应的 policy 把模块常量设成该仓库文件里已经在用的写法，例如 `screaming-snake`。
