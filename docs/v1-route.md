# Latch v1 调研：原子状况、条件分支、域的导向

日期：2026-11-04  
地位：**已被 [v1-research-plan.md](v1-research-plan.md) 取代**（2026-11-04 复审）。当时的具体仓库实例已经收成 `change-discipline`，并由目标仓库的 `latch.policy.json` 开关。本文保留为设计草稿；新文档修正了入口强制（hook 分层）、事实采集（快照与未跟踪文件）、状态变更（分阶段状态机 + 追加式 journal）与编译校验（七项体检）四部分。不替代 `PLAN.md` 里「静态域是闩、skill 是说明」的结论。  
范围：只设计路由这一层。不新增工作流运行时，不把控制台做成图编辑器。

## 1. 现在缺的不是又一个 skill

现有静态域是一条直线：`read → assert → slot → tool`，失败即停。`latch run <domain>` 能复现这条线。

已经够用的部分：

- 步骤顺序写在 `domain.json`，模型不能调换
- `assert` 用退出码，不靠模型判断 diff
- `slot` 只许 `pass` / `fail`
- always-apply 规则把「先跑 latch」钉在仓库上
- skill 库、挂载、三屏控制台是旁边的书架

还没钉住的部分：

- 模型仍要自己决定「这次该跑哪个域」。规则里写死一个域名，多个域时就会漏跑或多跑
- `mount.when`（plan / edit / commit）只写在 JSON 里，runner 不读
- 域与域之间没有边。一个域不能、也不应该在散文里「接着去做另一个域」
- 同一次 diff 被每个 assert 脚本各扫一遍，原子事实没有名字，无法复用
- `slot` 的答案不落盘。跑完退出码仍是 0，下一次运行不知道上次人答了什么
- `read` 只检查文件在不在，不把内容交给模型。模型仍可能不打开那个文件

这三件事是同一件事：进入哪条链路、链路上下一站是谁、这一站的结果是什么。skill 管理解决不了。

## 2. 两个词，不要混

### 原子状况

一个可以被 runner 单独判定真假的事实。判定不经过模型。

例子（都来自一次返工，不是新业务）：

| 原子 | 真值从哪来 |
| --- | --- |
| `diff.useEffect` | diff 新增行里有 `useEffect(` |
| `diff.tabKeepalive` | 新增 `visitedTabs` 或 `display: "none"` 保活 |
| `diff.earlyReturnToTernary` | 新增把早返回改成三元 |
| `diff.moduleConstCase` | 新增模块常量不符合仓库约定的大小写 |
| `paths.charts` | 曾用来表示 diff 碰到某个目录；两条 link 跑的是同一个域，后来没有保留 |

原子只回答「是不是」。它不说下一步做什么。

组合：若干原子用 `all` / `any` / `not` 合成一个有名字的状况，下面叫**分子**。分子仍是真假，仍由 runner 算。Tailwind 的类比只用在这一步：原子像工具类，叠在一起才成为一个可指认的状况。不要把「样式可以同时生效」理解成「两条链路可以同时走」。

现有 `steps/*.mjs` 已经是匿名原子。v1 要做的是给它们名字，并让多个域引用同一个名字，而不是每个域复制一份 `git diff`。

### 条件分支

一条链路：一组分子为真时，**有且只有这一条**下一步。

下一步只允许三种：

- `run`：按给定顺序执行一个或多个已有静态域（域内部仍是直线，域内不加 if）
- `stop`：退出码 1，打印是哪一个原子/哪一条 assert 把它停住
- `ask`：打印一个 slot，答案只能是 `pass` 或 `fail`；答案写入本次回执后再决定 `run` 或 `stop`

分支之间必须互斥。这是和 git 当前分支的对应，不是和 Tailwind 的对应：工作区同一时刻只在一个分支上。两条 `when` 若能同时为真，就是路由写错了，不是「优先级高的赢」。

「全链接」在 v1 的可执行定义：

- 路由声明参与分叉的原子集合（建议不超过 8 个）
- 每条 link 的 `when` 是这些原子上的布尔式
- 编译时穷举 `2^n` 种赋值，每种必须命中**恰好一条** link
- 命中 0 条：这组事实没有去处
- 命中 2 条：两条分支重叠

n ≤ 8 时穷举是 256 次，不需要 SAT，也不需要图数据库。

域内部保持直线。分叉只发生在路由层。否则每个 `domain.json` 都会长出第二套控制流，模型和人都没法对账。

## 3. 导向怎么接上 agent

模型不选域。模型只做两件已有的事：跑 latch 打印出来的命令，以及回答 slot。

### 入口只有一个

仓库的 always-apply 不再写死 `latch run change-discipline`。改成：

```bash
cd <latch> && npm run latch -- route change-discipline --cwd <repo>
```

`latch route` 的 stdout 是固定文本，不是建议：

```text
Latch route · change-discipline
atoms:
  diff.useEffect=0
  diff.tabKeepalive=0
  paths.charts=1
link: charts
next:
  latch run change-discipline --cwd <repo>
```

agent 从上到下执行 `next`，不得插入别的域，不得跳过。`stop` 链路没有 `next`，进程退出码 1。

phase（plan / edit / commit）不作为原子。模型口头说「我在 plan」不可信，runner 也分不清。规则文本仍然写「plan、edit、commit 之前都要跑 route」。分叉只看仓库里的 diff 和文件。`mount.when` 在 v1 保持为给人看的说明，不参与判定。

### 域和域怎么连

域不引用域。边写在路由上。

```text
route change-discipline
  link stop-discipline  when disciplineBreach     -> stop
  link charts           when paths.charts
                        and not disciplineBreach  -> run discipline, chart-axis
  link default          when not paths.charts
                        and not disciplineBreach  -> run discipline
```

`change-discipline` 仍是现在的直线（read、四条 assert、一个 slot）。它不知道 chart 域存在。chart 域以后如果要加，也只是另一条直线，由路由在分子匹配时排在它后面。

这样加一个域不会改旧域的步骤，也不会让 skill 的 description 变成路由器。

### 状态变更落在回执上，不落在对话里

一次 `latch route` 写一份回执，路径固定：目标仓库的 `.latch/last-route.json`（进该仓库 `.gitignore`）。内容只有：

- 原子真值表
- 命中的 link id
- `next` 里每个域的结果：`ok`、失败的 step id、slot 是否已作答

slot 的作答方式：agent 再跑一次

```bash
latch route change-discipline --cwd <repo> --slot style-drift=pass
```

runner 把该 slot 写入回执。未作答的 slot 视为这条链路未完成，退出码非 0。现在的实现是 slot 只打印、进程照样 0，等于没闩住。

回执是这次运行的全部状态。不在 Latch 进程里做会话，不做检查点服务。下次 plan/edit/commit 再跑 route，原子按当时的 diff 重算，不继承上一次的原子真值。继承的只有「这个 slot 在这一轮是否答过」——若 diff 变了，回执作废，slot 必须重答。作废规则：回执里记录 `git diff HEAD` 的哈希，哈希变了就丢弃 slot。

## 4. 建议的文件（v1 就这些）

不把原子再拆成一套产品对象。一个路由目录：

```text
library/routes/change-discipline/
  route.json          # atoms 引用、molecules、links
  atoms/*.mjs         # 从现有 steps 抽出来的判定，退出码 0/1
```

`route.json` 形状：

```json
{
  "name": "change-discipline",
  "atoms": {
    "diff.useEffect": "atoms/diff-use-effect.mjs",
    "diff.tabKeepalive": "atoms/diff-tab-keepalive.mjs",
    "diff.earlyReturnToTernary": "atoms/diff-early-return-to-ternary.mjs",
    "diff.moduleConstCamel": "atoms/diff-module-const-camel.mjs",
    "paths.charts": "atoms/paths-charts.mjs"
  },
  "molecules": {
    "disciplineBreach": {
      "any": [
        "diff.useEffect",
        "diff.tabKeepalive",
        "diff.earlyReturnToTernary",
        "diff.moduleConstCamel"
      ]
    }
  },
  "links": [
    { "id": "stop-discipline", "when": "disciplineBreach", "to": { "kind": "stop" } },
    {
      "id": "charts",
      "when": { "all": ["paths.charts", { "not": "disciplineBreach" }] },
      "to": { "kind": "run", "domains": ["change-discipline"] }
    },
    {
      "id": "default",
      "when": { "not": "disciplineBreach" },
      "to": { "kind": "run", "domains": ["change-discipline"] }
    }
  ]
}
```

上面的 `charts` / `default` 在 `paths.charts=1` 且没有违纪时会重叠。这正是编译器要拒绝的。v1 第一条真实路由应写成完备互斥，例如 default 显式 `{ "all": [{ "not": "paths.charts" }, { "not": "disciplineBreach" }] }`。在 chart 域还不存在时，两条 `run` 可以暂时指向同一个纪律域，但 `when` 仍必须互斥，避免以后加上 chart 域时静默分叉错。

域内 assert 改为引用原子名，而不是再挂一份脚本：

```json
{ "id": "no-new-useeffect", "kind": "assert", "atom": "diff.useEffect" }
```

原子脚本的查找顺序：路由目录的 `atoms/`，这样纪律域和路由共用同一判定。域私有的 `steps/` 留到该检查还没提升为原子时再用。

## 5. v1 做 / 不做

做：

1. `route.json` 解析、分子求值、`2^n` 互斥且覆盖的编译检查（`latch route --check`）
2. `latch route <name> --cwd`：算原子、选唯一 link、打印 `next`、写回执、按序跑域（或 `--print` 只打印不跑）
3. `--slot id=pass|fail` 写入回执；slot 未答则整次 route 失败
4. diff 哈希变化则丢弃旧 slot
5. 把现有四条纪律 assert 收成原子；`change-discipline` 改为引用原子
6. 目标仓库的 always-apply 改成只调用 `latch route change-discipline`
7. 编译失败（重叠或遗漏）时 exit 2，文案指出哪两条 link、哪组赋值

不做：

- 域内 if/else、循环、子图
- 模型填写原子
- 用 skill description 做路由
- 可视化连线编辑器（控制台最多只读打印编译结果）
- LangGraph、队列、常驻进程
- 把 phase 做成原子
- 在这一轮迁移无关社区 skill

chart 专用域也不在这一轮新建。路由里可以先留出互斥的 `paths.charts` 分支，两边都先跑纪律域。等轴/网格规则被写成 assert 或 slot，再把该 link 的 `domains` 加上第二个名字。这是加一条 link 的目标，不是再抄一套组件代码。

## 6. 和改动纪律的对应

| 现在 | v1 之后 |
| --- | --- |
| 四条 `steps/*.mjs` 各算各的 diff | 四个原子，route 与 domain 共用 |
| 域是唯一入口 | route 是唯一入口，域是 link 上的站点 |
| slot 打印完即通过 | slot 写入回执后才算这条 link 完成 |
| 规则点名一个域 | 规则只点名 `latch route change-discipline` |
| 卡顿、tab 保活等产品问题 | 不进路由。路由只表达「碰到哪类 diff 必须走哪条闩」 |

## 7. 其余基础功能（辅助，不挡 v1 路由）

按「不挡路由 / 值得顺手收」分开。

不挡 v1，保持现状：

- skill 的列表、原文编辑、name/description 校验
- 符号链接挂载、拷贝回退、`.latch-source`、库页上的挂载状态
- 三屏控制台的视觉和信息架构

路由落地时顺手收，改动面小：

- `PLAN.md` 末尾仍写「library 是空的」。与仓库不符，易让后续实现照旧阶段表重做。v1 文档合并进 PLAN 时改掉这句
- `settings.json` 里是本机绝对路径。换机器会挂错。v1 可继续用绝对路径，但在 README 写明「路径是本机配置，不进路由判定」
- 目标仓库 `.gitignore` 增加 `.latch/`，否则回执会被提交
- `read` 步骤：v1 路由不改造它。已知缺口是「文件在，模型可以不读」。若要补，只做一件事：把 `paths` 里的文件打进 `latch run` 的 stdout，并设字数上限。这是导向的补强，不是新域类型

明确不做的优化：

- 为某个界面的卡顿在 Latch 里加步骤
- 把某个界面的业务判断抽进 Latch
- 控制台里编辑分子和连线

## 8. 验收

用目标仓库当前工作区（或一份夹具 diff）跑 `latch route change-discipline --check` 与 `latch route change-discipline --cwd …`：

- 四条纪律原子全假、且没碰到 charts：只命中 default，`next` 只有纪律域
- 只把 `diff.useEffect` 设为真：只命中 stop，退出码 1，不打印第二个域
- 手工把两条 link 改成可同时为真：`--check` 退出码 2，并打印冲突赋值
- 删掉覆盖某种赋值的 link：`--check` 退出码 2，并打印未覆盖赋值
- 纪律域 slot 未答：route 失败；`--slot style-drift=fail` 后仍失败；`pass` 且 assert 已过才成功
- 改动任意已跟踪文件使 diff 哈希变化：旧 slot 作废

通过以上六条，再把目标仓库的 always-apply 从「点名一个域」改成「只跑 route」。在此之前不要改规则文案，避免 agent 接到一条还不存在的命令。
