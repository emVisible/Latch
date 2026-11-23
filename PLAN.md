# Latch 方案

Latch（闩）是一个本地技能库控制台。它只管两件事：技能从哪来，以及哪些步骤不许靠模型临场发挥。

> 2026-11-04：v1 更进依据见 [docs/v1-research-plan.md](docs/v1-research-plan.md)。本文件保留三层定位与静态域原设计；阶段表、全链接路由、状态与入口设计以新文档为准。

> 2026-11-22：自循环（任务契约、功能地图、错误卡、三题考卷、租约）见 [docs/v2-loop.md](docs/v2-loop.md)。散文 skill 仍然只作解释；能晋升的错误必须先有检查原子和三题全过。

> 2026-11-23：v2 收到这里。下一版只补现场核对、考卷与作者分开、daily 走得到的闩，见 [docs/v3-direction.md](docs/v3-direction.md)。

## 名字与标记

- 仓库：`~/Company/latch`
- 产品名：Latch
- 中文：闩。闩是插在活动件上的固定销
- 图标：`assets/icon.jpg`。黑底、象牙环、一根蓝色横销穿过环心。环是会转的 agent，销是不动的流程

## 它不是什么

不是又一个 agent 框架，也不是 MCP server 市场。LangGraph、Temporal 解决的是服务端工作流运行时。Latch 解决的是 Cursor 这类 coding agent 在本机上「读哪份说明、按什么顺序做、做到哪一步必须停」。

## 三层，中间缺的那层

现行 agent 只有两端：

| | Skill | MCP |
| --- | --- | --- |
| 形态 | `SKILL.md` 自然语言 | 带 schema 的工具调用 |
| 谁决定步骤 | 模型。描述没命中就整段不读 | 模型只决定叫不叫；叫了之后是黑盒 |
| 失败方式 | 漏触发，或把说明读歪 | 参数错或服务错，调用本身可复现 |
| 依据 | [Agent Skills](https://agentskills.io/specification) 的渐进加载：启动时只看 name/description，命中才读正文 | [Skills vs MCP](https://blog.logrocket.com/skills-vs-mcp-tools-agent-guide/)：工具换可审计，skill 换判断空间 |

Openstrat 那次返工就是动态端的失败：`AGENTS.md` 和 skill 都写了「不要 useEffect、不要把早返回改丑」，模型在 plan / build / commit 时没有打开它们。事后加一条 `alwaysApply` 规则才把关卡钉住。那条规则就是一个手写的静态域。

静态域补的是中间：

- **控制流是编译出来的**，模型不能调换、跳过、或用另一套写法代替
- **判断留在具名槽位里**，例如「这段 diff 是否把已有代码改差了」，由模型填一个有类型的结论
- **能力调用仍走 MCP 或脚本**，域只规定调用哪一个、成功条件是什么，不把工具内部再做成散文

一个静态域相当于在静态代码约束下的确定性 skill 流程。它仍可读、可改、可挂载，但运行时不再指望模型记得去读。

和 LangGraph 的关系：图、检查点、人机中断已经有成熟实现，Latch v1 不引入这套运行时。域的步骤少、在本机、失败即停。编译产物是一份有序清单加一个本地 runner，不是一个常驻编排服务。

## 仓库即源

```
latch/
  assets/icon.jpg
  library/
    skills/<name>/SKILL.md      # Agent Skills 规范
    domains/<name>/domain.json  # 静态域
  console/                      # 后续的本地 web
```

`library/` 是唯一正文。agent 目录里不放第二份手改副本。

挂载目标按 [Cursor 文档](https://cursor.com/docs/skills)：

- 项目：`<repo>/.agents/skills/<name>`
- 本机：`~/.cursor/skills/<name>`（目前只有这条会同步到 Cloud Agent）
- 兼容：`~/.agents/skills/<name>` 指向同一目标

挂载方式：优先符号链接，链接文本写回 Latch 的 `library/`。Cursor 对符号链接的发现曾经不一致（2.5 后有修复，CLI 仍有过漏发现）。控制台在挂载后做一次发现检查；检查失败就改为拷贝，并在目标里写 `.latch-source`，记录 repo 相对路径和内容哈希。之后的修剪和修改只发生在 Latch，再由控制台重新部署。

社区 skill（Vercel React Native、code-comments 等）也收进 `library/skills`，不在各个项目里各存一份。项目里只留下挂载点。

## 静态域格式

`library/domains/<name>/domain.json`：

```json
{
  "name": "openstrat-change-discipline",
  "description": "改 Openstrat 前必须走过的关卡",
  "mount": {
    "repos": ["openstrat_rn"],
    "when": ["plan", "edit", "commit"]
  },
  "steps": [
    { "id": "read-agents", "kind": "read", "paths": ["AGENTS.md"] },
    {
      "id": "no-new-useeffect",
      "kind": "assert",
      "script": "steps/no-new-useeffect.mjs"
    },
    {
      "id": "style-drift",
      "kind": "slot",
      "question": "新代码的命名和控制流是否和所在文件一致，且没有把已符合规范的写法改差？",
      "answer": "pass-fail",
      "onFail": "stop"
    }
  ]
}
```

步骤只有四种：

| kind | 谁执行 | 作用 |
| --- | --- | --- |
| `read` | runner | 指定文件必须被读到，路径固定 |
| `assert` | runner 里的脚本 | 对 diff 或文件做确定检查，退出码即结果 |
| `slot` | 模型 | 只回答这一个问题，不能改步骤顺序 |
| `tool` | MCP 或本地命令 | 工具名固定；参数来自上一步产物或槽位 |

编译结果两份：

1. `latch run <domain>`：按 `steps` 顺序执行。`read` / `assert` / `tool` 不过就停。`slot` 把问题打印成 agent 必须作答的固定格式。
2. 目标仓库一条很短的 always-apply 规则，只写「先运行 `latch run <domain>`，不要自己重排这些步骤」。规则是闩，散文 skill 不再单独承担「记得去做」。

第一个域就是现在的 `openstrat-change-discipline`：禁止新增 `useEffect`、禁止把早返回改成三元、禁止未经要求的 `display:none` 保活、模块常量沿用所在文件的全大写下划线。能写成 `assert` 的不留成散文。

## 控制台

本地 web，极简三屏：

1. **库**：技能和静态域列表，来源、挂到了哪些 agent 目录
2. **编辑**：改 `SKILL.md` 或域的步骤。保存即写回 `library/`。技能校验 name / description 是否符合 Agent Skills 规范（name ≤ 64、小写连字符；description ≤ 1024，同时写清做什么和何时用）
3. **部署**：勾选目标（某个 repo 的 `.agents/skills`，或本机 `~/.cursor/skills`），执行挂载或卸载

不做账号、市场、在线协作。正文靠 git。

技术栈：Vite、React、TypeScript、Tailwind。旁边一个本地 Hono 进程读写 `library/` 并执行挂载。浏览器不直接当数据源。视觉沿用图标：近黑底、少量蓝、无发光、无卡片堆砌。

## 阶段

1. 库的读写和规范校验，还没有挂载
2. 挂载、卸载、发现检查、拷贝回退
3. 静态域编辑器、`latch run`、生成 always-apply 规则
4. 把 Openstrat 现有 skill 迁到 `library/`，仓库里只留指向 Latch 的挂载；把改动纪律收成第一个静态域

仓库已有三屏控制台、runner、挂载、CLI 与 server（`a569508`，`npm run typecheck` 通过）。上面的四阶段表已被 `docs/v1-research-plan.md` 的 S0–S5 取代；路由、全链接与入口设计以该文档为准。
