# Latch v3 方向

日期：2026-11-23  
地位：v2 已落地，见 [v2-loop.md](v2-loop.md)。这三件已经按下面的规则生效。

v2 把日常回路收成命令、路由和六份 skill：`daily` 先契约再地图，错误卡要过三题，`latched` 必须已经出现在某条路由的 `scope` 里。下面三件已经生效，不再另加 skill 或路由阶段。

## 1. 现场要能核对

`latch session step` 写入这次会话清单：打开的目标、截屏或导出的 sha256、点中的位置。功能地图条目上的 `location` 和 `observe` 参加这次核对。对不上清单的回传，`claim.unresolved` 为真。未跟踪的新文件也算写入，空的 `writable` 照样拦住。

缺了目标、位置、observe 或证据文件，`latch session step` 拒绝写入。sha256 由 Latch 读盘计算，不接受手写。

Latch 仍不自己去点，不截屏，不启动 App，不记录真实指针。点击留在 agent 或人。Latch 只拒绝没有这次会话清单的结果。

## 2. 考卷和作者分开

出题读取 `.latch/reads.json` 里的数据源，并且不读取这张卡的 `SKILL.md` 和原子实现。陷阱题对照一次已记录的天真改法（`.latch/naive.json`，由 `latch card capture-naive` 写入），不再只对照作者填的 `naiveExpect`。

同一份 Latch 提交里同时改了考卷和 `library/atoms/index.mjs` 时，promote 拒绝。作者批改自己的卷，退出码不算通过：批改若能读到这张卡的 `SKILL.md` 或原子源码，退出码不是 0。

## 3. 闩住之后，下一次会停

`promote` 不会改 `route.json`。原子没进 `daily` 实际会执行到的 scope 就不能标 `latched`。接进 `daily` 仍然是一次人审过的 diff，不由 promote 自动改路由。doctor 对「标了 latched、但 daily 走不到」报红。

租约维持到 `latch session end`。命令本身结束不再等于锁没了。同一 git 根上，会话没结束，第二个 agent 不能开始写。

## 不做

- 不增加第六份以外的核心 skill，不把错误实例升成核心 skill。
- 不给任何目标装 live hook。
- 不把控制台做成编辑器，不把点击运行时放进 Latch。
