# Latch

技能库中控。技能从这里挂载到 agent，静态域在这里编译成确定流程；**全链接路由**决定何时进哪个静态域、域之间怎么连、状态怎么变。

方案与调研见 [PLAN.md](PLAN.md)、[docs/v1-research-plan.md](docs/v1-research-plan.md)。图标在 `assets/icon.jpg`。

## 开发

```bash
npm install
npm run dev            # API :8787（仅 127.0.0.1）+ Web :5173
npm run typecheck
npm test               # node:test + tsx，38 项
npm run build
```

`settings.json` 配置挂载目标（本机绝对路径，不参与路由判定、不进哈希）。

## 常用命令

```bash
# 编译体检：七项检查（覆盖/互斥/可达/引用/连通终止/孤儿/最小），写入 linkmap.json
npm run latch -- check openstrat

# 读取当前事实快照的原子真值
npm run latch -- atoms --cwd ~/Company/openstrat_rn --window worktree

# 只打印编译结果，不执行、不写回执
npm run latch -- route openstrat --cwd ~/Company/openstrat_rn --print

# 真正跑链路（默认 runner 自己按序执行，模型不选域）
npm run latch -- route openstrat --cwd ~/Company/openstrat_rn --window worktree

# 回答具名 slot（唯一的模型写入通道，绑定 snapshotHash / routeHash / atomsHash）
npm run latch -- slot openstrat style-drift=pass --cwd ~/Company/openstrat_rn

# 为什么命中这条 link
npm run latch -- explain openstrat --cwd ~/Company/openstrat_rn

# 体检：挂载归属、发现检查、hook 状态、linkmap 新鲜度、规范校验
npm run latch -- doctor
```

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
web/src/pages/RoutePage.tsx     # 链路只读页
目标仓库 .latch/last-route.json  # 追加式回执（由 .git/info/exclude 排除）
```

## 入口：hook 才是闩

`always-apply .mdc` 只是解释层。执行层由 `latch hooks install --target <id>` 生成：

- `.cursor/hooks.json`（`beforeSubmitPrompt` / `preToolUse`，`failClosed: true`）
- `.claude/settings.json`（`PreToolUse` / `UserPromptSubmit`，`onFailure: block`）
- `.git/hooks/pre-commit`（`--window staged`，与 agent 无关的最后一道）

**默认不会自动在 live 仓库激活**：hook 会阻断操作，请先跑 `latch doctor` 与计划书第 6.3 节验收，再显式执行安装。已存在的非 Latch `pre-commit` 不会被覆盖，会生成 `pre-commit.latch` 供手动合并。

## v1 状态

- 静态域 `openstrat-change-discipline`：4 条原子 assert + 1 个 slot，`read` 会带字数上限输出正文
- 路由 `openstrat`：2 阶段、5 个自由原子、3 个结果原子，`entry` 32 种 / `after-discipline` 6 种可行赋值，0 遗漏 0 重叠
- 四屏控制台：库 / 链路 / 编辑 / 部署；链路页只读展示编译结果、运行日志与回执
- 38 项测试覆盖快照（含未跟踪文件）、七项体检、slot 生命周期与哈希作废、hook fail-closed、挂载归属保护
