# Latch v1 调研方案计划书 · 静态域 / 全链接 / 路由与状态

日期：2026-11-04  
地位：**v1 更进依据**。审阅并取代 `docs/v1-route.md` 的设计结论；`PLAN.md` 的三层定位（Skill 动态端 / 静态域 / MCP 静态端）不变。  
基线：`git log` 单提交 `a569508`，`npm run typecheck` 通过，`docs/` 目录尚未纳入 git。  
范围：路由层 + 它依赖的事实采集、状态、入口、编译校验；其余基础功能与优化列在第 5 节。

---

## 0. 先看结论

现有规划的方向是对的：**域内保持直线、边只写在路由上、模型不选域、分叉必须互斥**。这四条应当保留。

但有三处**结构性缺陷**，会让「静态域」在最需要它的时刻失效，必须在 v1 里补掉：

| # | 缺陷 | 后果 |
| --- | --- | --- |
| A | **入口仍然是散文**。always-apply 规则只是另一段 `AGENTS.md` | Openstrat 那次返工的原因就是「模型没打开说明」。用一条更短的说明去钉住另一条说明，是同一个失败模式的重演。静态域必须挂到工具链的强制事件上 |
| B | **事实采集不可信**。全部原子来自 `git diff HEAD` | 未跟踪新文件漏检（已本地实测）、暂存区与工作区混淆、plan 阶段无 diff、commit 后 diff 归零、每个原子各扫一遍 diff |
| C | **「全链接」只做了覆盖与互斥**，把状态变更压成了一次性回执 | 用户定义的「全分支/全链接」还要求：链路可达、域不孤立、域与域之间如何连接、执行结果如何决定下一跳。一次性预选 link 回答不了「静态域之间如何导向」 |

在此之上，`docs/v1-route.md` 还有内部矛盾（第 1 节）、仓库文档与实现脱节、若干安全与工程缺口（第 5 节）。

**本方案的补法**：把「全链接」定义成一张**分阶段的、编译期完备互斥的决策表 + 一次性有界状态机**，并用 **hook 分层**把入口从模型自觉改成工具链强制。仍然不引入 LangGraph / Temporal / 常驻编排服务。

---

## 1. 审阅：现有规划逐条结论

### 1.1 无需改动的部分

| 项 | 结论 |
| --- | --- |
| 名字 / 图标 / 三层定位 | Latch「闩」、`assets/icon.jpg`（黑底象牙环、蓝销），web 通过 `publicDir = ../assets` 使用，一致且已落地 |
| 「不是 agent 框架、不是 MCP 市场」 | 与调研结论一致：本地、短流程、失败即停，不需要持久化执行层 |
| 域内直线、四种 step、边不写在域里 | 保留。这是防止 `domain.json` 长出第二套控制流的关键 |
| `library/` 是唯一正文、挂载不落手改副本 | 保留，但挂载实现有破坏性风险，见 5.1 |
| 「编译产物是有序清单 + 本地 runner」 | 保留。升级为「分阶段链路表 + 一次性 runner」 |

### 1.2 文档与仓库不符

| 项 | 证据 | 处理 |
| --- | --- | --- |
| `PLAN.md:127` 仍写「当前仓库停在本方案、图标和空的 `library/`」 | 实际已有三屏 console、runner、mount、CLI、server、README「v1 核心」章节 | 改掉；阶段表整体重写为第 6 节 |
| `PLAN.md:52-58` 的挂载描述 | 实现里**没有发现检查**（只在 symlink 创建抛错时回退拷贝）；Cursor 官方 skills 文档现在**完全未提符号链接**，2.5 修复的说法无从核对 | 降级为「本地经验，需实测」，补 `latch doctor` 发现检查 |
| `PLAN.md:56` 把 `~/.agents/skills` 当作兼容目标 | Cursor 文档明确 `~/.agents/skills` **不会同步到 Cloud Agent**，且会加载 `.claude/skills`、`.codex/skills` 等兼容目录 | 目标清单扩到多 agent，并标注各自语义 |
| `PLAN.md:60` 说社区 skill 收进 `library/` | `openstrat_rn/.agents/skills/` 里 `code-comments`、`expo-*`、`vercel-react-native-skills` 仍是项目内独立副本 | 列入 P1 迁移 |
| `docs/v1-route.md` 本身 | `git status` 显示 `docs/` 未跟踪 | 计划文档先入 git，否则下次会话丢失 |

### 1.3 `docs/v1-route.md` 的内部矛盾

| 位置 | 问题 |
| --- | --- |
| §2「下一步只允许三种：run / stop / ask」 | `route.json` 示例里只有 `run` / `stop`，`ask` 的形状从未定义 |
| §3「agent 从上到下执行 `next`」 vs §5「按序跑域（或 `--print` 只打印不跑）」 | 默认行为自相矛盾。让 agent 执行列表 = 又回到模型自觉；默认必须由 runner 执行 |
| §3「`--slot style-drift=pass`」 | `style-drift` 是**域内** step，不是 route 的对象；route 层没有定义 slot 归属、重复执行时是否已跑过前面的域、答案如何传到域内 |
| §4 的 `charts` / `default` 示例 | 文档自己指出两者重叠，却把一条不完备不互斥的表当作示例。示例必须是可通过 `--check` 的 |
| §2「phase 不作为原子」 vs `domain.json` 的 `mount.when` | `when` 悬空。要么删掉，要么明确它是给人看的元数据 |
| §3「回执是这次运行的全部状态」 | 回执只记录结果，没有状态向量、没有转移日志、没有哈希链；「状态变更」被等同于「一次运行的产物」 |
| §3「原子按当时的 diff 重算，不继承」 | 没有处理 commit 后 `git diff HEAD` 为空、plan 阶段还没有 diff 这两种常见情形 |
| §4「原子脚本查找顺序：路由目录 `atoms/`」 | 现有四个脚本在 `library/domains/<name>/steps/`，且共用 `steps/lib/git-diff.mjs`。迁移路径、共用 lib 的新位置都没写 |

### 1.4 概念层面的收窄

| 用户原意 | 现有方案 | 需要补的 |
| --- | --- | --- |
| 「原子和分子」「Tailwind 原子化组合产生的**涌现**」 | 压成 `all/any/not` 的布尔式 | 分子要**有名字、可复用、可再被组合**（分子引用分子形成 DAG），命名本身才是涌现；还要处理 Tailwind 类比的另一半——组合冲突时的消解策略 |
| 「全分支考虑 / 全链接」 | 只查 `2^n` 的覆盖与互斥 | 还要查：可达性（永假 link）、连通性（孤立域 / 未被引用的原子）、引用完整性、终止性、语义重复、`explain` 反例 |
| 「静态域与静态域之间如何连接、如何确定状态变更」 | 运行前一次性选定 link，域的结果只影响 ok/fail | 域的执行结果必须能变成**结果原子**，驱动下一跳；状态是显式的、只由 runner 写、追加式、可审计 |
| 「agents 如何导向静态域」 | 模型读 always-apply 文本后自觉跑 route | hook 强制（见 2.4、3.7） |

### 1.5 实现层已确认的缺口

| 位置 | 事实 |
| --- | --- |
| `shared/runner.ts:60-67`、`formatRunOutput` | `slot` 只打印，`runDomain` 仍返回 `ok: true`，输出甚至写「通过（slot 须由 agent 自行确认）」。**等于没有闩住** |
| `library/domains/.../steps/lib/git-diff.mjs:6` | `git diff HEAD` 单一来源；实测：新增未跟踪文件 `newfile.tsx` 里的 `useEffect` 完全不出现在 diff 里；`git add -N` 后才出现 |
| 四个 `steps/*.mjs` | 每个脚本各自调 `gitDiffLines()` → 一次 route 跑 n 次 `git diff`，且无法保证同一快照 |
| `cli/run.ts` | 只有 `run` / `rule`，没有 `route`、`--check`、`--print`、`--slot` |
| `server/index.ts` | 无 route 端点；`PUT /api/skills/:name` 把 URL 参数直接拼进路径且不过滤；`PUT /api/domains/:name` 无 schema 校验；`serve({ port })` 未显式绑定 127.0.0.1 |
| `shared/mount.ts:63-64, 95-96` | 挂载前 `fs.rm(dest, recursive)`、卸载时同样无条件删。若目标位置是用户手工放的同名 skill 目录，会被静默删除 |
| `web/src/pages/DeployPage.tsx:12` | `domainName` 硬编码 `openstrat-change-discipline` |
| `web/src/pages/*.tsx` | 三屏里**看不到路由**、看不到编译结果、看不到回执 |
| 仓库整体 | 无测试脚本、无 schema 校验、无 fixture；`docs/v1-route.md` 的 6 条验收全部依赖手工 |
| `openstrat_rn/.gitignore` | 没有 `.latch/`，回执一旦生成就会被提交 |

---

## 2. 调研：外部依据与定位

### 2.1 两端：Skill 与 MCP

- **Agent Skills 规范**（[agentskills.io/specification](https://agentskills.io/specification)）：`SKILL.md` = YAML frontmatter + Markdown；`name` 1–64、小写连字符、**不允许连续 `--`、不允许首尾连字符、必须与父目录同名**；`description` 1–1024 且要同时写「做什么 / 何时用」；还有 `license`、`compatibility`(≤500)、`metadata`(string→string)、实验性 `allowed-tools`。渐进加载三级：启动时只有 name/description（约 100 tokens）→ 激活后读正文（建议 < 5000 tokens / < 500 行）→ `scripts/` `references/` `assets/` 按需。官方提供 `skills-ref validate` 做校验。
  - 对照 `shared/skill.ts`：现有 `NAME_RE` 允许 `-a`、`a--b`，未校验可选字段，未用官方校验库。P1 补齐。
- **Cursor Skills**（[cursor.com/docs/skills](https://cursor.com/docs/skills)）：自动发现 `.agents/skills/`、`.cursor/skills/`、`~/.agents/skills/`、`~/.cursor/skills/`，另兼容 `.claude/skills/`、`.codex/skills/` 等；**递归遍历**任意层级，嵌套目录下的 skill 自动按子树作用域生效；frontmatter 支持 `paths`（glob 作用域）、`disable-model-invocation: true`（只能被 `/` 显式调用）、`icon` / `color`；只有 `~/.cursor/skills/` 会同步到 Cloud Agent，且 automation 不加载同步 skill。文档**没有**任何关于符号链接的说明。
  - 两个可直接利用的点：`paths` 是「静态作用域」的现成机制；`disable-model-invocation: true` 可以让域配套 skill **不被模型自行激活**，只能被 runner 调用——这正好契合「模型不选域」。

### 2.2 「确定性外壳」是行业共识，不是自创

调研汇总（多源，见第 8 节）里与 Latch 直接相关的结论：

- **外层 FSM / 内层 LLM**：工作流拓扑已知时不该让模型每次重新发明路径；条件边是**纯函数**，不是一次模型调用。「编排正确性与 LLM 行为无关」是这类系统的中心不变量；CROA 一类的思路更直接——**不安全路径在构造上不可达**，而不是运行时才拒绝。
- **确定性是梯度不是开关**：条件分支、聚合器完全确定；带 schema 门控的 LLM 调用是有界随机；创意生成才刻意自由。设计工作是「把每个节点放在梯度的正确位置」。Latch 的 `slot` 就是那个有界随机节点。
- **不要把阈值写进 prompt**：prompt 里的阈值是一份没人能 diff、测试、签字的策略。Latch 的 `assert` / 原子脚本正是把它变成可 diff 的代码。
- **决策从流程里拆出来**：DMN 的定位就是「BPMN 画流程，DMN 装判断」，`hitPolicy` 决定多规则同时命中时的语义（UNIQUE 唯一命中、FIRST 按序、PRIORITY 按输出优先级、ANY/COLLECT 多命中）。把判断表从流程里拆出来，才能让同一判断被多处复用而不漂移——这正是「原子复用」的论据。
- **检查点不等于持久化执行**：LangGraph checkpointer 是原语，Temporal/Restate 那类 journal 重放是运行时。Latch v1 明确不碰这一层；但「一次性、可重放、追加式日志」的**思路**可以极简照搬。

### 2.3 「全」可以形式化，不必靠人海测试

- **DMN hit policy**：`UNIQUE` 是默认值（恰好一条规则命中），`FIRST` 依赖顺序，`PRIORITY` 依赖输出优先级。工程实践中「规则重叠检测 / 冲突检测工具链」「完备性校验」是决策表上线前的常规体检。
  - 对 Latch 的映射：v1 采用 `UNIQUE`（严格互斥，与 git「同一时刻只在一个分支」一致），但**格式里预留 `policy` 字段**，允许 v1.1 在确有需要时显式切换到 `FIRST` / `PRIORITY`。这补上了 Tailwind 类比里「原子叠加会冲突、需要消解」的那一半，而不是把它当成纯错误一拒了之。
- **CEL**（[cel.dev](https://cel.dev/)）：非图灵完备、只访问宿主提供的数据、可嵌入、纳秒到微秒级；官方 2026 年推出基于 Z3 的**形式化验证框架**，可以「证明策略正确性、AST 等价、跨全部输入空间的安全不变量」。
  - 对 Latch 的映射：n ≤ 8 时 `2^n` 穷举足够（256 次），无需 SAT；原子数增长后升级路径是 `2^n 枚举 → BDD → SMT/等价证明`。当前 `all/any/not` 的 JSON AST 恰好是布尔公式，可直接编译成 BDD，不必先引入 CEL 运行时。
- **决策表 / 规则引擎现状**：GoRules ZEN、Flowable、Camunda、Drools 一类都把「AI 起草、人来发布」作为治理边界；可审计的运行时证据是「一条阻断决策 + 一条日志」，而不是「prompt 里告诉模型要拒绝」。这印证了第 3.4 节的 journal。

### 2.4 入口：hook 才是「闩」，规则文本不是

| 平台 | 机制 | 确定性阻断 |
| --- | --- | --- |
| **Cursor** | 项目级 `<repo>/.cursor/hooks.json`，可入库；`preToolUse`（所有工具前）、`beforeSubmitPrompt`、`beforeShellExecution`、`beforeReadFile`、`afterFileEdit` 等 | `permission: "deny"` 或 **exit code 2**；其它非零退出默认 **fail-open**，必须设 `failClosed: true`；多个 hook 合并时 `deny` 优先；Cloud Agent 也跑项目级 command hook |
| **Claude Code** | `.claude/settings.json`，`PreToolUse` / `UserPromptSubmit` / `Stop` 等；skill frontmatter 也能声明 hook 并在会话内持续生效 | **exit 2** 或 JSON `permissionDecision: "deny"`；策略 hook 必须 `onFailure: "block"`（脚本缺失、超时、非法 JSON 默认不阻断）；文档明确 `additionalContext` / `systemMessage` / 纯 stdout **不是强制** |
| **git** | `pre-commit` / `pre-push` | 退出码即门禁，与 agent 无关 |

结论：`always-apply .mdc` 只能作**解释层**，不能作**执行层**。而且 Claude Code 文档里那句「`additionalContext` 不是 enforcement」值得原样抄进 Latch 的设计约束。

### 2.5 Latch 的定位（调研后仍成立）

| 借鉴 | 不借鉴 |
| --- | --- |
| 编译期决策表、hit policy、完备/互斥体检 | LangGraph / Temporal 的常驻运行时、检查点服务、集群 |
| 外层确定 / 内层有界 slot | 让模型参与路由、用 skill description 当路由器 |
| hook 作为强制入口、追加式日志作为证据 | 在图编辑器里画连线（控制台只读） |
| 布尔 AST → BDD → SMT 的渐进形式化 | 一开始引入 CEL / Z3 依赖 |

一句话：Latch 是「**stored-program / constrained-reachability 的本地极简版**」——程序（链路表）在执行前就已经存在并被穷举验证，模型只被允许填具名槽位。

---

## 3. 核心设计：把「全链接」说清楚

### 3.1 术语（一份，不再各写一套）

| 词 | 定义 |
| --- | --- |
| **原子状况 atom** | runner 可独立判定的**具名事实**，不经过模型。v1 判定结果只有真/假；payload（命中行、路径、数量）只进日志不进判定 |
| **分子 molecule** | 若干原子（或其它分子）用 `all` / `any` / `not` 组合成的**有名字的状况**。分子仍是布尔，仍由 runner 算；分子可被其它分子引用，形成 DAG。命名 + 复用 + 再组合 = Tailwind 类比里的「涌现」 |
| **阶段 stage** | **状态**。一个阶段声明本阶段可观测的原子集合，以及一张决策表。路由在阶段之间迁移，不靠对话记忆 |
| **条件分支 link** | 阶段内的一条规则：`when`（布尔式）+ `to`（动作）。同一阶段的所有 link 构成完备互斥的决策表 |
| **链路表 linkmap** | `route.json` 的编译产物：每个阶段的真值表、命中 link、反例、哈希。可入库、可 diff |
| **静态域 domain** | 一条直线：`read → assert → slot → tool`。域内无 if、不引用其它域 |
| **结果原子** | 域执行后由 runner 写入的事实，如 `run.<domain>.ok`、`slot.<id>=pass`。它们是**下一阶段**的原子，不是自由变量 |
| **回执 / journal** | 一次 route 的全部状态：原子真值、命中的 link、每个域/step 的结果、slot 答案、阶段转移、内容哈希。追加式，不原地改 |

### 3.2 观察窗口：先解决「事实从哪来」

`git diff HEAD` 不是一个可靠的观察窗口。route 必须显式声明 `--window`（默认由入口 hook 决定）：

| window | 覆盖 | 用途 |
| --- | --- | --- |
| `worktree` | 已跟踪修改 + **未跟踪新文件** + 暂存区 | 编辑中、preToolUse hook |
| `staged` | `git diff --cached` | pre-commit |
| `last-commit` | `git diff HEAD~1 HEAD` | commit 之后复核 |
| `range:<ref>` | 显式区间 | CI / 复盘 |
| `fixture:<file>` | 夹具 JSON | 测试与 `--check` |

实现要点（P0）：

1. **一次采集，生成一份不可变快照**：`git status --porcelain` + `git diff HEAD` + `git diff --cached`，对未跟踪文件用 `git diff --no-index /dev/null <file>` 或 `git add -N` 语义补进 added 行（本地已验证后者有效）；把 `{ added[], removed[], changedPaths[] }` 序列化并算 `snapshotHash`。
2. **所有原子从快照读**，不再各自 `git diff`。这既消除重复扫描，也是「原子化」真正的收益：判定变成纯函数 `atom(snapshot) -> bool`，可用夹具单测。
3. `snapshotHash` 进入回执；窗口不同、快照不同，回执即作废。
4. 兜底：不在 git 仓库 / 无 HEAD / detached / 空仓库时显式报错 exit 3，不静默当成「所有原子为假」。
5. `mount.when`（plan/edit/commit）降级为纯展示元数据，不参与判定——这点沿用 `v1-route.md` 的正确判断；真实阶段由 `--window` 与 hook 事件表达。

### 3.3 全链接：一张分阶段决策表

「全链接」在 v1 的**可执行定义**不只是「覆盖 + 互斥」，而是以下七项编译期体检（`latch route --check`）：

| # | 检查 | 失败含义 |
| --- | --- | --- |
| 1 | **覆盖性** 每个阶段穷举 `2^n`，排除 `constraints` 判定的不可能组合后，每种**可行**赋值至少命中 1 条 link | 存在「这组事实没有去处」 |
| 2 | **互斥性** 每种可行赋值至多命中 1 条 link | 两条分支重叠；打印冲突赋值与两条 link id |
| 3 | **可达性** 每条 link 的 `when` 至少存在一种可满足赋值 | 永假分支 / 死代码 |
| 4 | **引用完整性** `when` 里的原子/分子都已声明；分子 DAG 无环；`to.run` 的域存在；`to.then` 的阶段存在 | 拼写错误、悬空引用 |
| 5 | **阶段图连通与终止** 所有阶段从 `entry` 可达；`stop` 之外无出边；阶段转移图无环。唯一例外是 `ask` 自环：必须满足**单调性**（每次自环至少新增一个已答结果原子），并由 `maxRounds` 兜底 | 孤立域、跑不完的循环 |
| 6 | **域与原子不留孤儿** 每个域至少被一条 link 引用；每个声明原子至少参与一次判定 | 加了但永远不生效 |
| 7 | **语义最小性** 不存在两条等价 link，也不存在被另一条完全吸收的 link | 规则漂移、以后改一处漏一处 |

- n ≤ 8 → `2^n ≤ 256`，直接枚举；n > 8 → 编译成 BDD 再做等价/包含判断；n > 16 或引入类型化原子 → 交给 CEL + SMT（v1.1）。三类原子要分清：`routingAtoms`（自由原子，参与 `2^n`）、`resultAtoms`（由 runner 产生，带出处与时序约束）、`checkAtoms`（只在域 `assert` 里用，不参与分叉）。每阶段的 `scope` 声明本阶段用哪些原子，编译器只对 `scope` 做枚举。
- `constraints` 在 v1 只是一组形如 `A => B` 的蕴含式，用来排除不可能赋值（例如「slot 已判 pass」必然蕴含「slot 已作答」）；它不构成通用表达式语言。
- 默认 `policy: "unique"`。预留 `"first"` / `"priority"`，但切换时 `--check` 必须额外输出「被遮蔽的 link」清单，防止静默分叉。这与 DMN hit policy 的语义一致。
- 编译产物 `linkmap.json`（含每个阶段的真值表摘要、每条 link 的最小满足赋值、route + atoms + domains 的内容哈希）写回 `library/routes/<name>/`，可 diff、可入 git。

### 3.4 状态变更：显式、只由 runner 写、追加式

这是对 `v1-route.md`「回执是全部状态」的替换：

- **状态向量** = `{ window, snapshotHash, stage, atomValues, moleculeValues, runResults, slotAnswers, round }`。
- **谁可以改状态**：只有 runner。模型唯一的写入通道是 `--slot <id>=pass|fail`，且必须校验取值域、必须绑定当前 `snapshotHash` + `routeHash`，写入后成为结果原子。**模型不写文件、不选域、不改顺序。**
- **转移**：`选 link → 执行动作 → 追加一条 journal 记录 → 进入 `to.then` 阶段 → 重新求值`。每一回合都用同一张编译好的链路表，不重新让模型决策。
- **作废规则**：`snapshotHash` 变了、`routeHash` 变了、`atoms/*.mjs` 内容变了、或 `--window` 变了 → 旧 slot 全部作废，必须重答。记录 `prevHash` 形成哈希链，防止「diff 变回原样时把旧 pass 复活」。
- **并发**：回执写入用 `.latch/last-route.json.lock`（O_EXCL）或单写者；`latch` 与 hook 同时触发时不互相覆盖。
- **不落对话**：目标仓库 `.latch/` 加进 `.gitignore`（当前 openstrat_rn 未加）。

### 3.5 多回合：静态域之间如何连接

`to` 允许三种动作，且**一次只推进一个域**：

| `to.kind` | 语义 | 之后 |
| --- | --- | --- |
| `run` | 执行一个已有静态域（域内仍是直线） | 写入 `run.<domain>.ok` 等结果原子 → 进入 `then` 指定阶段 |
| `ask` | 打印一个具名 slot，等待 `--slot` 作答 | 答案成为结果原子 → 进入 `then` 阶段；未答则整次 route 失败 |
| `stop` | 退出码由 `to.exit` 指定（0 通过 / 1 被闩住），打印命中的原子与 link | 终止 |

要点：

- **域不引用域**。边只写在阶段决策表里，且引用的是**结果原子**，不是域名。加一个域不改旧域的步骤。
- 结果原子的命名空间是 `run.*` 与 `slot.*`，编译时校验「某个 `run.*` 原子只能出现在其对应域已被执行过的阶段」「某个 `slot.*` 原子只能出现在该 slot 可被作答的阶段」，避免引用尚未发生的事实。
- `maxRounds`（建议 4）+ visited 阶段集合，超出即 exit 4 并打印轨迹。这是「无环」的运行期兜底。`ask` 允许的阶段自环必须满足单调性：`slot.answered` 一旦变真，同一阶段不会再命中 `slot-pending`；编译器据此接受该自环，运行时仍受 `maxRounds` 约束。
- 域内 `assert` 改为引用原子名（`{ "kind": "assert", "atom": "diff.useEffect" }`），`slot` 改为具名、有取值域、有 `onFail`。共用原子放在 `library/atoms/`，域私有脚本保留在 `library/domains/<name>/steps/`——**彻底解决 `v1-route.md` 没写清的共用 lib 归属**。

### 3.6 完整可编译的 `route.json` 示例

```json
{
  "name": "openstrat",
  "version": 1,
  "policy": "unique",
  "maxRounds": 4,
  "routingAtoms": [
    "diff.useEffect", "diff.tabKeepalive",
    "diff.earlyReturnToTernary", "diff.moduleConstCamel",
    "paths.charts"
  ],
  "resultAtoms": {
    "run.discipline.ok": { "from": "domain", "domain": "openstrat-change-discipline", "field": "ok" },
    "slot.answered":     { "from": "slot",   "slot": "style-drift", "field": "answered" },
    "slot.pass":         { "from": "slot",   "slot": "style-drift", "field": "pass" }
  },
  "constraints": ["slot.pass => slot.answered"],
  "molecules": {
    "disciplineBreach": {
      "any": [
        "diff.useEffect", "diff.tabKeepalive",
        "diff.earlyReturnToTernary", "diff.moduleConstCamel"
      ]
    }
  },
  "stages": {
    "entry": {
      "scope": ["diff.useEffect", "diff.tabKeepalive", "diff.earlyReturnToTernary", "diff.moduleConstCamel", "paths.charts"],
      "links": [
        {
          "id": "stop-discipline",
          "when": "disciplineBreach",
          "to": { "kind": "stop", "exit": 1, "reason": "diff 违反改动纪律" }
        },
        {
          "id": "charts",
          "when": { "all": ["paths.charts", { "not": "disciplineBreach" }] },
          "to": { "kind": "run", "domain": "openstrat-change-discipline", "then": "after-discipline" }
        },
        {
          "id": "default",
          "when": { "all": [{ "not": "paths.charts" }, { "not": "disciplineBreach" }] },
          "to": { "kind": "run", "domain": "openstrat-change-discipline", "then": "after-discipline" }
        }
      ]
    },
    "after-discipline": {
      "scope": ["run.discipline.ok", "slot.answered", "slot.pass"],
      "links": [
        {
          "id": "discipline-failed",
          "when": { "not": "run.discipline.ok" },
          "to": { "kind": "stop", "exit": 1, "reason": "纪律域未通过" }
        },
        {
          "id": "slot-pending",
          "when": { "all": ["run.discipline.ok", { "not": "slot.answered" }] },
          "to": { "kind": "ask", "slot": "style-drift", "then": "after-discipline" }
        },
        {
          "id": "slot-failed",
          "when": { "all": ["run.discipline.ok", "slot.answered", { "not": "slot.pass" }] },
          "to": { "kind": "stop", "exit": 1, "reason": "style-drift 判定为 fail" }
        },
        {
          "id": "done",
          "when": { "all": ["run.discipline.ok", "slot.answered", "slot.pass"] },
          "to": { "kind": "stop", "exit": 0, "reason": "route 完成" }
        }
      ]
    }
  }
}
```

这份示例能通过七项体检：

- `entry` 5 个自由原子 → 32 种赋值；四个纪律原子的 16 种组合里有 15 种使 `disciplineBreach` 为真，乘 `paths.charts` 两种共命中 30 种；剩下 2 种由 `charts` / `default` 各领 1 种。三条 link 覆盖且互斥。修正了 `v1-route.md` 里 `default` 与 `charts` 重叠的示例。
- `after-discipline` 3 个结果原子 → 8 种赋值，`constraints` 排除 2 种不可能组合（`slot.pass=true` 但 `slot.answered=false`），余下 6 种被四条 link 恰好覆盖。`constraints` 在 v1 只是一组蕴含式，不是通用表达式语言。
- 以上两段已用本地穷举脚本实际跑过：`entry` 32 种可行赋值、`after-discipline` 6 种，均为 **0 遗漏 / 0 重叠**。`--check` 的实现就是这个脚本的产品化。
- `resultAtoms` 显式声明**出处**，编译器据此做「可产生性 + 时序」校验：某个 `run.*` 原子只能出现在其对应域已执行过的阶段；`slot.*` 只能出现在对应 slot 已能被作答的阶段。
- `slot-pending → ask → after-discipline` 是被允许的**单调自环**：答过之后 `slot.answered=true`，不会再命中自己，且受 `maxRounds=4` 约束。
- `chart-axis` 域还不存在时，两条 `entry` link 都指向纪律域但 `when` 仍互斥——以后只需把 `charts` 的 `then` 指向新阶段，不改旧域（沿用 `v1-route.md` 的正确思路）。

### 3.7 导向 agent：四层入口，只有最上面两层是「闩」

```
L0  git pre-commit / pre-push        → latch route openstrat --window=staged    （工具链强制，exit≠0 即拦）
L1  .cursor/hooks.json               → beforeSubmitPrompt / preToolUse(Write|Shell)
                                       command: latch route ... ; failClosed: true ; 阻断用 exit 2
    .claude/settings.json            → PreToolUse / UserPromptSubmit ; onFailure: "block" ; exit 2
L2  .cursor/rules/latch-*.mdc        → always-apply，只解释「为什么有这条闩」，不作为执行层
L3  library/skills/.../SKILL.md      → disable-model-invocation: true（域名不能被模型自行激活）
```

- 模型在 L0/L1 里**没有选择权**；它只在需要时回答具名 slot。
- hook 输出必须是干净的 JSON 或纯退出码；Cursor 要 `failClosed: true`，Claude Code 要 `onFailure: "block"`，否则脚本挂了会 fail-open——这是两个文档共同强调的坑。
- `always-apply` 规则由 `compileAlwaysApplyRule` 生成，但内容改成「本机已配置 hook，不要绕过；失败时看 `.latch/last-route.json`」，不再写「请运行 latch run」。
- `latch route` **默认自己按序执行域并给出结论**；`--print` 只打印链路表供人/控制台查看，不给 agent 一张需要它自觉执行的清单。这消除 `v1-route.md` 的默认行为矛盾。

---

## 4. 融入现有仓库：文件、接口、迁移

### 4.1 目录

```text
latch/
  library/
    atoms/                       # 共用判定：从 steps/*.mjs 提升，纯函数 atom(snapshot) -> bool
      diff-use-effect.mjs
      ...
      lib/snapshot.mjs           # 唯一一次 git 采集 + snapshotHash
    skills/<name>/SKILL.md
    domains/<name>/
      domain.json                # 直线步骤；assert 可引用 atom
      steps/                     # 尚未提升为原子的私有脚本
    routes/<name>/
      route.json                 # 阶段 + 分子 + link
      linkmap.json               # 编译产物（--check 生成，入库）
      fixtures/*.json            # 原子赋值 → 期望 link，供测试
  shared/
    snapshot.ts  atoms.ts  molecule.ts  linkmap.ts  route.ts  journal.ts  schema.ts
  cli/run.ts                     # 增加 route / check / explain / doctor
  server/index.ts                # /api/routes, /api/routes/:name/check, /api/routes/:name/run, /api/journal
  web/src/pages/RoutePage.tsx    # 只读：阶段表、真值表摘要、冲突/遗漏/死链、回执
  docs/v1-research-plan.md       # 本文件
目标仓库: .cursor/hooks.json, .claude/settings.json, .git/hooks/pre-commit, .latch/last-route.json(.gitignore)
```

### 4.2 CLI / API

| 命令 | 作用 |
| --- | --- |
| `latch route <name> --cwd <repo> [--window worktree\|staged\|last-commit\|range:X\|fixture:F]` | 采集快照、按阶段推进、执行域、写 journal；exit 0 通过 / 1 被闩住 / 2 编译失败 / 3 快照不可用 / 4 超出 maxRounds / 5 slot 未答 |
| `latch route <name> --check` | 七项编译体检，输出 linkmap；失败 exit 2 并指出具体赋值 / link / 阶段 |
| `latch route <name> --print` | 只打印链路表，不执行 |
| `latch explain <name> [--atoms ...]` | 「为什么命中这条 link」：打印原子真值、分子求值、命中的 when、最小反例 |
| `latch slot <route> <id>=pass\|fail --cwd <repo>` | 唯一的模型写入通道，校验取值域与哈希绑定 |
| `latch doctor` | 挂载发现检查、hook 是否注册、目标路径可写、`.gitignore` 是否含 `.latch/`、route 与 atoms 哈希一致 |

API 对应 `GET /api/routes`、`GET|POST /api/routes/:name/check`、`POST /api/routes/:name/run`、`GET /api/routes/:name/journal`、`POST /api/slot`；控制台新增第四屏「链路」，只做只读展示 + 触发 `--check`，不做连线编辑器。

### 4.3 迁移顺序（从当前 commit 出发）

1. **文档归位**：修 `PLAN.md:127`、给 `v1-route.md` 加「已被本文件取代」标注、把 `docs/` 纳入 git。
2. **快照层**：新增 `shared/snapshot.ts` 与 `library/atoms/lib/snapshot.mjs`，把 `git-diff.mjs` 换成读快照；补未跟踪文件；四个 `steps/*.mjs` 就地改为纯函数并加 fixture 测试。
3. **schema 与编译器**：`shared/schema.ts`（domain / route / settings 三份 JSON Schema 或 zod）、`molecule.ts`（DAG 求值）、`linkmap.ts`（七项检查 + `2^n` / BDD 后备）。先把现有 `openstrat-change-discipline` 写成一条可通过 `--check` 的路由。
4. **runner 改造**：`runDomain` 返回 step 级结果与 slot 状态；slot 未答时 `ok=false`；`assert` 支持 `atom`；`journal.ts` 写追加式日志与哈希链。
5. **入口替换**：先加 git `pre-commit` 与 `.cursor/hooks.json`（`failClosed: true`），确认生效后，再把 `.mdc` 改成解释层。顺序不能反——**不要在命令还不存在时改规则文案**（沿用 `v1-route.md` §8 的正确告诫）。
6. **控制台**：链路页 + 回执查看；`DeployPage` 去掉硬编码域名；库页显示路由与 hook 状态。
7. **基础功能收尾**：第 5 节 P0/P1。

### 4.4 兼容性

- `latch run <domain>` 保留（单域直线调试用），但 always-apply 不再指向它。
- `domain.json` 的 `script` 与 `atom` 两种 assert 形式 v1 都接受，迁移期共存；v1.1 只留 `atom`。
- `mount.when` 保留为展示字段，写入 README 说明「不参与判定」。
- `settings.json` 仍是本机绝对路径；README 写明「本机配置，不进路由判定、不进哈希」。

---

## 5. 其他基础功能与优化（顺带调查结论）

### 5.1 P0 阻塞项（与路由同批做）

| 项 | 依据 / 风险 | 动作 |
| --- | --- | --- |
| 挂载/卸载的破坏性删除 | `mount.ts:63-64,95-96` 对同名目标无条件 `rm -rf`。`openstrat_rn/.agents/skills/` 里已有 4 个非 Latch 管理的社区 skill 目录，误挂同名会直接删掉 | 只删「symlink 指向 `library/`」或「含 `.latch-source` 且 sourceRelative 指向 Latch」的挂载；其它一律拒绝并打印目标路径；`fs.rm` 改为 `lstat` 判定后单文件/单链接删除；卸载前备份到 `.latch/trash/` |
| API 路径穿越 | `PUT /api/skills/:name`、`GET /api/skills/:name` 把 URL 参数直接拼路径；`PUT /api/domains/:name` 无校验 | 名称统一走 `NAME_RE` + 目录白名单；`PUT` 前做 schema 校验；`realpath` 必须落在 `LIBRARY_DIR` 内 |
| 本地服务暴露面 | `serve({ port })` 未绑定 host；`tool` step 用 `shell: true` 执行 JSON 里的字符串 | 绑定 `127.0.0.1`；`tool` 改为 argv 数组 + 白名单，或至少在 README 声明「`library/` 是可执行可信源，等同本地代码」 |
| 事实采集（第 3.2 节） | 已实测漏未跟踪文件 | 快照层一次性采集 |
| slot 未落盘 / 退出码 0 | `runner.ts:60-67` | runner 返回结构 + journal 绑定 |
| `.gitignore` | openstrat_rn 未含 `.latch/` | 部署 hook 时自动追加，幂等 |
| 文档与实现脱节 | 第 1.2 节 | 同批修掉 |

### 5.2 P1 值得顺手收

| 项 | 说明 |
| --- | --- |
| Skill 规范校验补全 | 按 Agent Skills 规范加：禁连续/首尾连字符、`compatibility` ≤ 500、`metadata` 值必须为字符串、`description` 同时含做什么/何时用（启发式）；或直接接 `skills-ref validate` |
| 三份 JSON Schema | `domain.json` / `route.json` / `settings.json` 保存前在 API 与控制台同时校验，编辑页实时显示编译错误，而不是保存后才发现 |
| 挂载发现检查 | `latch doctor` 验证 symlink 是否被 agent 发现；失败自动切拷贝回退并写 `.latch-source`；`scanMounts` 校验 `sourceRelative` 确实指向 Latch 库（`hashDir` 用 `lstat` 避免跟随符号链接） |
| 多 agent 目标清单 | 从 2 个 target 扩到 `.agents/skills`、`.cursor/skills`、`~/.cursor/skills`（唯一可同步）、`.claude/skills`、`.codex/skills`、`~/.agents/skills`（不同步 Cloud），每个目标标注 scope / 是否同步 / 是否支持嵌套作用域 |
| 社区 skill 收编 | 把 `code-comments`、`expo-*`、`vercel-react-native-skills` 迁进 `library/skills`，项目内只留挂载点，兑现 `PLAN.md:60` |
| 可观测性 | `latch explain`、回执查看页、`--check` 结果入库；`latch doctor` 一键体检 |
| 测试与夹具 | 当前零测试。加最小 `node:test`：分子求值、完备/互斥/可达/连通、`git` 临时仓库快照（含未跟踪文件）、slot 作废、hook 失败模式（脚本缺失/超时/非法 JSON）；`npm test` 入 script |
| 部署记录 | `library/mounts.json` 记录谁挂到哪、内容哈希、时间；支持重新部署与回滚 |
| 域配套 skill 的 `disable-model-invocation` | 域对应的 SKILL.md 设为 `true`，runner 才能成为唯一激活者 |

### 5.3 P2 优化 / 明确不做

| 做（v1.1+） | 不做（v1） |
| --- | --- |
| 类型化原子（enum / number / set）与 CEL 表达式，配套 BDD/SMT 等价证明 | 在 v1 引入 CEL / Z3 依赖 |
| `policy: first/priority` 与「被遮蔽 link」报告 | 让模型填原子、用 skill description 做路由 |
| 原子级缓存（按 `snapshotHash` 复用真值表） | 域内 if/else、循环、子图 |
| 控制台只读真值表可视化（不是连线编辑器） | 图编辑器、常驻进程、队列、LangGraph/Temporal |
| 多 repo / 多 route 的 `--check` 汇总 | 为 Gamma/BasicChart 卡顿在 Latch 里加步骤；把 OptionAnalysis 业务判断抽进 Latch |
| `read` 步骤把文件内容（设字数上限）打进 stdout | 在这一轮迁移无关社区 skill 的全部规则正文 |

性能上还有一条明确收益：现在 n 个原子脚本各跑一次 `git diff`；快照化后变成一次采集 + n 次纯函数判定，且判定结果可按 `snapshotHash` 缓存。这是把「原子化」从概念变成实际收益的关键一步。

---

## 6. v1 范围、阶段与验收

### 6.1 做 / 不做

**做**：快照层与未跟踪文件；类型化状态向量 + 追加式 journal；分阶段链路表与七项编译体检；`latch route/check/explain/slot/doctor`；结果原子驱动的多回合（≤4）；hook 分层入口（git + Cursor + Claude Code）；runner 改造与原子迁移；控制台链路只读页；P0 全部；P1 里的 schema 校验、测试夹具、文档归位。

**不做**：域内分支；模型填原子；`policy` 切换（只预留字段）；可视化连线编辑；运行时编排；把 phase 做成原子；chart 专用域（但保留互斥的 `paths.charts` 分支）。

### 6.2 阶段（替换 `PLAN.md` 的旧四阶段）

| 阶段 | 产出 | 门槛 |
| --- | --- | --- |
| S0 基线 | 文档订正、`docs/` 入 git、`npm test` 可跑、`latch doctor` 骨架 | typecheck + 现有功能不回归 |
| S1 事实 | `snapshot.ts`、共用 `library/atoms/`、四个纪律脚本改纯函数、fixture 测试 | 未跟踪新文件里的 `useEffect` 能被检出 |
| S2 编译 | `molecule.ts` / `linkmap.ts`、七项检查、`--check` 输出与 `linkmap.json` | 第 6.3 节第 1–5 条通过 |
| S3 运行 | `route.ts` / `journal.ts`、runner 改造、`to` 三种动作、多回合与 maxRounds | 第 6.3 节第 6–9 条通过 |
| S4 入口 | git hook + `.cursor/hooks.json` + `.claude/settings.json`、`.mdc` 改解释层、`.gitignore` | 断网/脚本缺失时 fail-closed 生效 |
| S5 收尾 | 链路页、回执查看、部署记录、社区 skill 收编 | 三屏 → 四屏可用，无硬编码域名 |

### 6.3 验收（在 `v1-route.md` 六条之上补齐）

1. `--check`：完备互斥路由 exit 0，输出 `linkmap.json` 且内容哈希稳定
2. 手工制造重叠：`--check` exit 2，打印冲突赋值与两条 link id
3. 删掉一条覆盖赋值：exit 2，打印未覆盖赋值
4. 造一条永假 link、一个从未被引用的域、一个拼错的原子名：`--check` 分别报可达性 / 连通性 / 引用完整性
5. 造一个阶段环：exit 2；运行期 `--window=fixture` 配合 `maxRounds` 触发 exit 4
6. 夹具：四条纪律原子全假且不碰 charts → 只命中 `default`，只跑纪律域
7. 只把 `diff.useEffect` 设真 → 只命中 `stop`，exit 1，不执行任何域
8. **新增未跟踪文件**里写 `useEffect(` → 被 `diff.useEffect` 捕获（当前实现会漏，回归测试）
9. `--window=staged` 与 `--window=worktree` 在同一工作区得到不同快照哈希，回执互不复用
10. slot 未答 → route 失败；`fail` → 失败；`pass` 且 assert 全过 → 成功；改动任一文件使 `snapshotHash` 变化 → 旧 slot 作废
11. 改 `route.json` 或任一 `atoms/*.mjs` → 旧回执作废（`routeHash` / `atomsHash` 绑定，现有方案只绑 diff）
12. 停用 hook 脚本 / 让它输出非法 JSON → Cursor `failClosed`、Claude Code `onFailure: block` 下**仍然阻断**；去掉该配置则动作放行（验证配置确实生效）
13. 对 `code-comments` 这类非 Latch 管理的目录执行同名挂载/卸载 → 被拒绝，目录内容不变
14. `npm run typecheck` 与 `npm test` 全绿

**顺序约束**：1–12 全通过之后，才把 Openstrat 的 `.mdc` 与 hook 从「点名一个域」切到「只跑 route」。

---

## 7. 风险与升级触发条件

| 风险 | 缓解 |
| --- | --- |
| hook 是 agent 相关功能，换 IDE / 换 agent 就失效 | git `pre-commit` 作为与 agent 无关的最后一道；`latch doctor` 检查 hook 注册状态 |
| `2^n` 随原子数爆炸 | 区分 routingAtoms / checkAtoms；n > 8 走 BDD；n > 16 或类型化原子再引入 CEL/SMT |
| 阶段决策表写错但穷举通过（原子本身判错） | 原子是纯函数 + fixture 测试；`latch explain` 打印真值来源；`snapshotHash` 可复现 |
| 多回合让「静态」变模糊 | 拓扑、守卫、阶段转移全部编译期固定；运行期只有事实在变；round 有上界、图无环 |
| hook 让开发变慢（每次工具调用都跑 route） | 按 `snapshotHash` 缓存 + `preToolUse` matcher 只匹配 `Write|Shell|Delete` + `beforeSubmitPrompt`，不做全量扫描 |

**什么时候才该引入真正的运行时**：出现跨会话人工审批、并行域、需要崩溃恢复、或阶段不再是 DAG 时。届时按第 2.2 节的分层，先加 journal 重放，再考虑 LangGraph/Temporal；v1 不为此预留抽象层，避免过度设计。

---

## 8. 参考来源

- Agent Skills Specification — https://agentskills.io/specification
- Cursor · Skills — https://cursor.com/docs/skills
- Cursor · Hooks — https://cursor.com/docs/hooks
- Claude Code · Hooks reference — https://code.claude.com/docs/en/hooks
- CEL · Common Expression Language（含 Z3 形式化验证说明） — https://cel.dev/
- DMN hit policy 说明（UNIQUE / FIRST / PRIORITY / ANY） — https://www.capitalone.com/tech/software-engineering/decision-modeling-and-notation/ ；Flowable DMN 命中策略综述 — https://blog.csdn.net/gitblog_00610/article/details/148440562
- 确定性工作流 / 状态机编排综述（FSM outer loop、条件边为纯函数、确定性梯度、checkpoints ≠ durable execution、DMN + LLM 治理边界） — https://eidm.co.za/2026/10/06/non-deterministic-agents-in-deterministic-workflows-the-state-machine-pattern-that-makes-multi-agent-systems-traceable 、 https://agentmarketcap.ai/blog/2026/04/08/agent-state-machine-design-pattern-reliable-multi-step-workflows 、 https://www.reactify-solutions.com/articles/durable-ai-agents-2026
- `PLAN.md` 原有引用：Skills vs MCP — https://blog.logrocket.com/skills-vs-mcp-tools-agent-guide/
- 本地实证：临时 git 仓库验证 `git diff HEAD` 不含未跟踪新文件，`git add -N` 后可见（2026-11-04）

> 注：行业综述里的融资额、估值、性能数字来自媒体与厂商口径，本方案只采用其**架构结论**，不引用具体数值作为设计依据。

---

## 9. 实施记录（2026-11-04，v1 已落地）

| 阶段 | 状态 | 实际产出 |
| --- | --- | --- |
| S0 基线 | 完成 | `shared/schema.ts`（domain / route / settings 校验）、`paths.ts` 名称与路径越界防护、`skill.ts` 按 Agent Skills 规范补全校验、`npm test` 骨架、`typecheck` 纳入 tests |
| S1 事实 | 完成 | `shared/snapshot.ts`（worktree / staged / last-commit / range / fixture 五窗口，一次采集 + `snapshotHash` 含 HEAD）、`library/atoms/index.mjs` 五个纯函数原子、`domain.json` 改为引用原子、三份夹具 |
| S2 编译 | 完成 | `shared/molecule.ts`、`shared/route.ts`、`shared/linkmap.ts` 七项体检 + `linkmap.json`；`latch check` / `--check` / `--print` |
| S3 运行 | 完成 | `shared/journal.ts`（追加式哈希链、五重绑定作废、O_EXCL 风格的原子替换写）、`runner.ts` step 级结果与 slot 状态、`routeRunner.ts` 多回合引擎、`cli/run.ts` 全命令 |
| S4 入口 | 代码完成，**未激活** | `shared/hooks.ts` 生成 Cursor / Claude Code / git hook（fail-closed、exit 2、合并既有配置、不覆盖已有 pre-commit）；`latch hooks install` 与控制台「入口 hook」区块 |
| S5 控制台 | 完成 | `web/src/pages/RoutePage.tsx` 第四屏；API 新增 routes / journal / slot / doctor / hooks；路径穿越防护、绑定 `127.0.0.1`、挂载归属保护、去掉硬编码域名 |

### 相对计划书的两处实现调整

1. **回执排除方式**：改为写 `.git/info/exclude`，不再修改目标仓库**被跟踪的** `.gitignore`。原因：自动追加 `.gitignore` 会弄脏用户工作区，并让同一份快照的哈希在下一次运行发生变化，导致刚写入的 slot 立刻作废。`doctor` 同时接受 `.gitignore` 与 `.git/info/exclude`。
2. **slot 归属**：域内保留 `slot` step，但 route 引擎用 `slotPolicy: "defer"` 运行域，由路由层的 `ask` 转移做最终判定；独立 `latch run <domain>` 仍是 `strict`（未答即失败）。这样域格式不变，也避免「域在 slot 未答时先失败、路由却还没来得及问」的死锁。
3. **编译产物的根路径**：`paths.ts` 的 `LATCH_ROOT` 改为按 `settings.json` / `library/skills` 探测（dev 用源码目录、编译后从 `dist/shared` 回退一级），否则 `npm start` 会把 `library/` 误定位到 `dist/library/`。已用编译后的 CLI 与 API 端点实跑验证。

### 验证结果

- `npm run typecheck`、`npm run build`、`npm test` 全绿；**38 项测试**覆盖：未跟踪文件的 `useEffect` 检出、stage 决策表 32/6 种可行赋值 0 遗漏 0 重叠、七项体检的各类反例、slot 生命周期与三重哈希作废、journal 哈希链与防篡改、hook 阻断与 git pre-commit 拦截、挂载归属保护。
- 真实 Openstrat 仓库只读验证：`latch atoms` 与 `latch route --print` 正常；`doctor` 报告挂载 `owned=true valid=true discovered=true`、路由编译通过。
- 实测修正了一个设计期未发现的坑：`answerSlot` 首次写入会改变工作区快照，已用 `collectStableSnapshot` 在哈希前先完成一次性初始化。

### 唯一剩余的显式动作

`latch hooks install --target openstrat_rn` **尚未执行**。它会在 live 仓库里启用阻断式门禁；按计划书第 6.3 节的顺序约束，应在 14 条验收逐条确认后再激活。当前所有 hook 生成与阻断行为已在临时仓库的自动化测试中验证，不依赖在真实仓库上试错。

