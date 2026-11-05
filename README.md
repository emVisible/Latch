# Latch

技能库中控。技能从这里挂载到 agent，静态域在这里编译成确定流程。

方案见 [PLAN.md](PLAN.md)。图标在 `assets/icon.jpg`。

## 开发

```bash
npm install
npm run dev          # API :8787 + Web :5173
npm run latch -- run openstrat-change-discipline --cwd /path/to/openstrat_rn
npm run latch -- rule openstrat-change-discipline --write --target openstrat_rn
```

`settings.json` 里配置挂载目标（仓库路径与 `.agents/skills` 相对目录）。

## v1 核心

- 第一个静态域 `openstrat-change-discipline`：4 条 diff assert + 1 个 slot
- 库页展示各目标的挂载状态
- 部署：挂载技能、写入目标仓库 `.cursor/rules/latch-*.mdc`
