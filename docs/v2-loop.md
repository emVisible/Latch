# Latch v2 · 自循环

日期：2026-11-22  
地位：在 v1 静态域与全链接路由之上增加四件东西。不替换 [v1-research-plan.md](v1-research-plan.md)。  
不做：打开 App、点击、截屏；域内 if；模型填写原子或批改考卷；把每个功能或每个错误变成路由原子；激活 live hook。

## 1. 什么算闩住

一张错误要成为以后每次都会生效的 skill，目录里必须同时有三样：

- `card.json`：身份。`lock` 只能是 `architecture`、`assert` 或 `test`。
- 注册表里的一个检查原子。`atom(snapshot) -> { value, hits }`，签名与 `library/atoms/index.mjs` 相同。
- `SKILL.md`，且 `disable-model-invocation: true`。它只解释这张卡。doctor 要求它和原子成对。没有原子的 skill 不是闩。

`latch exam` 只读 `card.json`、`exam.json`、原子和读回执，不读 `SKILL.md`。

一次性要求（`durability: once`）只留在当次任务里。`latch exam` 与 `latch card promote` 对它直接退出 1，不写入原子、不改路由。

长期要求（`lasting`）第一次只是候选。次数不看 `card.json` 里的 `seen`。一条路由在某个快照里观察到这张卡的原子，就往目标仓库 `.latch/sightings.json` 追加一条；不同 `snapshotHash` 满 2 次才算。另一条路是当前快照上的 `card-promote=pass`，而且这条回执的路由必须声明了该 slot（`card-gate`），`routeHash` 与 `atomsHash` 也要一致。写到别的路由上、或快照变了之后，这条 pass 不算。

三题全过之后，`promote` 还要在某条路由的 `scope` 里找到这个原子，才把 `status` 写成 `latched`。找不到就退出 1，标签保持候选。doctor 对已经标成 `latched` 但原子不在任何 scope 里的卡报红。

## 2. 任务契约

目标仓库 `.latch/task.json`（不进 git，沿用 `.git/info/exclude`）：

```json
{
  "intent": "看图表刻度",
  "returns": [{ "fact": "刻度字号是 12", "path": "shot.txt", "sha256": "<64 hex>" }],
  "writable": [],
  "durability": "once"
}
```

空的 `writable` 就是只读。三条检查原子，任一为真则路由 `task` 退出 1：

| 原子 | 为真 |
| --- | --- |
| `task.present` | 任务单存在且合法 |
| `claim.unsourced` | 某条回传没有 `path` |
| `claim.unresolved` | 有 `path`，但缺少哈希、文件不在证据或仓库里、或哈希对不上 |
| `write.undeclared` | `changedPaths` 里有路径不在 `writable`，且不是 `.latch/` |

没有任务单时，后三条为假，路由命中 `absent` 并退出 1。约束是 `claim.* => task.present` 与 `write.undeclared => task.present`，这样「没有任务单却又报某条违约」在编译期就不可行。

观察窗口增加 `evidence:<dir>`。目录里是已经拿到的截屏或导出文件，Latch 只计算路径和 sha256。这些文件不算写入。Git 改动仍走原来的 `changedPaths`。没有可核对文件时，带来源的回传会被 `claim.unresolved` 拦住。

## 3. 功能地图

`library/maps/<app>/map.json` 的一条条目：说法别名、位置、怎样算观察到、命中后要跑的直线步骤。

解析只产生三个互斥布尔：`map.hit`、`map.miss`、`map.ambiguous`。命中的条目放进 journal 的 `payload.map`，不进入 `2^n`。约束 `A => !B` 用来排除「两个布尔同时为真」。全假留给编译表上的 `unset`；运行时没有解析文件则视为 `map.miss`。

未命中或歧义追加到目标仓库 `.latch/map-candidates.json`，不改 `map.json`，也不改已编译路由。

唯一命中后，路由 `desk` 跑域 `map-follow`。runner 按该条目的 `steps` 顺序执行，模型不另选域。

## 4. 考卷

`exam.json` 恰好三题，角色是两道 `routine` 加一道 `trap`。每题有：

- `expect`：原子应返回的布尔
- `fixture`：交给原子的快照（`added` / `removed` / `changedPaths`）
- `source`：`{ path, sha256 }`，作者读过的数据源

批改规则：

- 三份夹具两两不同。
- 陷阱题的 `expect` 必须不同于卡片上的 `naiveExpect`。
- 每题的 `source` 必须出现在 `.latch/reads.json`。这份回执只由 `read` 步骤写入，并与磁盘上的文件哈希一致。
- 原子在夹具上的 `value` 必须等于 `expect`。三题都中才算这张修复通过。

`read` 步骤即使不把正文打进提示词，也会记下路径和 sha256。现在路由默认 `emitReadContent: false`，门禁是回执，不是把全文倒进对话。

## 5. 租约

`latch route` 在采集快照之前，对 **git 根目录** 独占创建 `.latch/lease.json`（pid、`snapshotHash`、时间）。从子目录启动也会锁到同一个根。同一根上第二个 route 退出 1。pid 已死的租约删掉重试。`--print` 和编译失败不占租约。进程正常返回时删除租约。

日常入口是 `daily`：先走任务契约，契约通过后才看功能地图，唯一命中后才跑该条目的步骤。agent 侧是六份 skill，不是一份总说明：入口 [`daily-loop`](../library/skills/daily-loop/SKILL.md) 只判断时效并点名 [`on-site`](../library/skills/on-site/SKILL.md)、[`function-map`](../library/skills/function-map/SKILL.md)、[`hard-lock`](../library/skills/hard-lock/SKILL.md)、[`error-card`](../library/skills/error-card/SKILL.md)、[`exam-pass`](../library/skills/exam-pass/SKILL.md)。`latch hooks install` 不写 `--route` 时生成的是 `daily`。本轮不在 live 仓库执行安装。`task` 与 `desk` 仍可单独调试。

代码关卡仍用 v1 的阶段：上一阶段的 `run.*.ok` 为假时，下一阶段只有 `stop`。顺序由路由表固定，不由提示词固定。

## 6. 命令与退出码

```text
latch route daily --cwd <repo>
latch task open --cwd <repo> --intent <text> --durability once|lasting [--writable <path>] [--fact <text> --source <path> --sha256 <hex>]
latch task check --cwd <repo> [--window <w>]
latch map <app> --query <text> --cwd <repo>
latch exam <card> --cwd <repo>
latch card promote <card> --cwd <repo>
latch slot card-gate card-promote=pass --cwd <repo>
```

路由退出码不变：0 通过 / 1 被闩住 / 2 编译失败 / 3 快照不可用 / 4 超出 maxRounds / 5 等待 slot。`exam` 与 `promote` 用 0 通过、1 拒绝、2 卡片或考卷不合法。`map` 唯一命中为 0，未命中或歧义为 1。

## 7. 状态

```text
候选 card.status=candidate
  once ────────────────────────────────► 留在任务里（exam / promote 退出 1）
  lasting 且快照次数<2 且无有效 slot ─► 拒绝进考卷
  lasting 且（两个不同快照，或当前快照上的 card-gate pass）
        exam 任一题不符 ───────────────► 仍是候选
        三题全过但原子不在任何 scope ──► 仍是候选
        三题全过且原子已在某条 scope ──► status=latched
```

`latched` 表示这张卡的原子已经进了某条路由的 `scope`，并且考卷通过。晋升不替你改 `route.json`；原子还没进 scope，就不能标成 latched。
