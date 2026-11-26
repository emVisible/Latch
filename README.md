# Latch

技能库中控。技能从这里挂载到 agent。哪些步骤不许临场发挥，由编译好的路由决定。

## 第一次使用

```bash
npm install
npm run dev            # API :8787（仅 127.0.0.1）+ Web :5173
```

:5173 的页面只是库，只读列出技能和静态域。agent 运行 `latch next`、`latch map`、`latch map add`、`latch task`、`latch prove`、`latch daily`。也可以直接用命令：

```bash
npm run latch -- init --cwd <repo>
npm run latch -- task open --cwd <repo> --intent "看笔记" --durability once --writable NOTES.md
npm run latch -- session open --cwd <repo> --target desk
npm run latch -- session step --cwd <repo> --at NOTES.md --evidence NOTES.md
npm run latch -- map desk --query "笔记" --cwd <repo>
npm run latch -- route daily --cwd <repo>
```

`init` 会写入 `latch.policy.json`（还没有的话）、`.latch/map.json` 空模板（还没有的话）、一份 `AGENTS.md` 空约定（还没有的话），并把仓库登记进本机 `settings.json`。它不安装 hook。hook 会带上会话锁，直到 `latch session end`。等 `daily` 的退出码符合预期再装：

```bash
npm run latch -- hooks install --target <id>
```

被拦住时，日志里有一行「下一步」。改动纪律的开关和四条规则见 [docs/change-discipline.md](docs/change-discipline.md)。

## 开发

```bash
npm run typecheck
npm test
npm run build
```

方案与调研见 [PLAN.md](PLAN.md)、[docs/v2-loop.md](docs/v2-loop.md)。下一版方向见 [docs/v3-direction.md](docs/v3-direction.md)。

## 常用命令

```bash
# 编译体检：七项检查（覆盖/互斥/可达/引用/连通终止/孤儿/最小），写入 linkmap.json
npm run latch -- check change-discipline
npm run latch -- check daily

# 读取当前事实快照的原子真值
npm run latch -- atoms --cwd <repo> --window worktree

# 只打印编译结果，不执行、不写回执
npm run latch -- route change-discipline --cwd <repo> --print

# 日常入口：任务契约 →（policy 打开且有改动时）改动纪律 → 功能地图
npm run latch -- route daily --cwd <repo> --window worktree

# 显式跑改动纪律（没有 latch.policy.json 时退出 1）
npm run latch -- route change-discipline --cwd <repo> --window worktree

# 回答具名 slot（唯一的模型写入通道，绑定 snapshotHash / routeHash / atomsHash）
npm run latch -- slot daily style-drift=pass --cwd <repo>

# 为什么命中这条 link
npm run latch -- explain change-discipline --cwd <repo>

# 规则说明层必须点名路由
npm run latch -- rule change-discipline --route daily

# 体检：挂载归属、发现检查、hook 状态、linkmap 新鲜度、规范校验
npm run latch -- doctor

# 机器人一轮：stdout 一条 JSON，只做下一行「下一步：」
npm run latch -- bot next --cwd <repo>
```

目标仓库要让改动纪律在 `daily` 里生效，在仓库根目录放 `latch.policy.json`。没有这份文件时，`daily` 跳过纪律。说明见 [docs/change-discipline.md](docs/change-discipline.md)。本机挂载目标写在 `settings.json`（不入库，从 `settings.example.json` 复制）。

窗口 `--window`：`worktree`（含未跟踪新文件）| `staged` | `last-commit` | `range:<ref>` | `fixture:<file>`。

退出码：`0` 通过 / `1` 被闩住 / `2` 编译失败 / `3` 快照或原子不可用 / `4` 超出 `maxRounds` / `5` 等待 slot。

## 目录

```text
library/
  atoms/index.mjs               # 共用原子：atom(snapshot) -> {value, hits}，纯函数
  skills/<name>/SKILL.md        # Agent Skills 规范
  domains/<name>/domain.json    # 直线静态域，assert 引用原子
  routes/<name>/route.json      # 分阶段决策表 + 分子 + 结果原子
  routes/<name>/linkmap.json    # 编译产物（--check 生成）
  routes/<name>/fixtures/*.json # 夹具
shared/                         # 快照、原子、分子、编译、journal、runner、hook、doctor
web/src/pages/LibraryPage.tsx   # 库，只读
目标仓库 .latch/last-route.json  # 追加式回执（由 .git/info/exclude 排除）
```

## 入口：hook 才是闩

`always-apply .mdc` 只是解释层。执行层由 `latch hooks install --target <id>` 生成：

- `.cursor/hooks.json`（`beforeSubmitPrompt` / `preToolUse`，`failClosed: true`）
- `.claude/settings.json`（`PreToolUse` / `UserPromptSubmit`，`onFailure: block`）
- `.git/hooks/pre-commit`（`--window staged`，与 agent 无关的最后一道）

**默认不会自动在 live 仓库激活**：hook 会阻断操作，请先跑 `latch doctor` 与计划书第 6.3 节验收，再显式执行安装。已存在的非 Latch `pre-commit` 不会被覆盖，会生成 `pre-commit.latch` 供手动合并。

## v1 状态

- 静态域 `change-discipline`：4 条原子 assert + 1 个 slot。是否生效由目标仓库的 `latch.policy.json` 决定
- 路由 `change-discipline`：入口 19 种可行赋值，槽位阶段 6 种。`daily` 在契约之后接同一组检查；policy 没开或没有代码改动则跳到功能地图
- 网页只是库，只读。agent 运行 `latch next`、`latch map`、`latch map add`、`latch task`、`latch prove`、`latch daily`
- 测试覆盖快照、七项体检、slot 生命周期、hook fail-closed、初始化和日常回路，以 `npm test` 为准
