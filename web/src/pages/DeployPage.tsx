import { useEffect, useState } from "react";
import {
  api,
  type MountStatus,
  type MountTarget,
  type RouteSummary,
  type SkillSummary,
} from "../api";

export function DeployPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [targets, setTargets] = useState<MountTarget[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [skillName, setSkillName] = useState("");
  const [mounts, setMounts] = useState<MountStatus[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, boolean>>(
    {},
  );
  const [domainName, setDomainName] = useState("");
  const [ruleTarget, setRuleTarget] = useState("");
  const [hookTarget, setHookTarget] = useState("");
  const [hookRoute, setHookRoute] = useState("openstrat");
  const [hookLines, setHookLines] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.listSkills(),
      api.getTargets(),
      api.listDomains(),
      api.listRoutes(),
    ]).then(([s, t, domains, routes]) => {
      setSkills(s);
      setTargets(t);
      setRoutes(routes);
      if (s[0]) setSkillName(s[0].name);
      if (t[0]) {
        setRuleTarget(t[0].id);
        setHookTarget(t[0].id);
        const init: Record<string, boolean> = {};
        for (const x of t) init[x.id] = true;
        setSelectedTargets(init);
      }
      if (domains[0]) setDomainName(domains[0].name);
      if (routes[0]) setHookRoute(routes[0].name);
    });
  }, []);

  useEffect(() => {
    if (!skillName) return;
    api.getMounts(skillName).then(setMounts);
  }, [skillName]);

  async function doMount() {
    const ids = targets.filter((t) => selectedTargets[t.id]).map((t) => t.id);
    await api.mount(skillName, ids);
    setMounts(await api.getMounts(skillName));
    setMessage("已挂载");
  }

  async function doUnmount() {
    const ids = targets.filter((t) => selectedTargets[t.id]).map((t) => t.id);
    await api.unmount(skillName, ids);
    setMounts(await api.getMounts(skillName));
    setMessage("已卸载");
  }

  async function installRule() {
    const res = await api.installRule(domainName, ruleTarget);
    setMessage(`规则已写入 ${res.path}`);
  }

  async function checkHooks() {
    setHookLines(await api.hookStatus(hookTarget));
  }

  async function doInstallHooks() {
    const res = await api.installHooks(hookTarget, hookRoute);
    setHookLines([
      ...res.written.map((p) => `已写入 ${p}`),
      ...res.warnings.map((w) => `注意 ${w}`),
    ]);
    setMessage("hook 已写入；激活前请先完成验收");
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">挂载技能</h1>
        <p className="text-sm text-zinc-500">
          优先符号链接；失败则拷贝并写入 .latch-source
        </p>
        <select
          value={skillName}
          onChange={(e) => setSkillName(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          {skills.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <ul className="space-y-2 text-sm">
          {targets.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!selectedTargets[t.id]}
                onChange={(e) =>
                  setSelectedTargets((prev) => ({
                    ...prev,
                    [t.id]: e.target.checked,
                  }))
                }
              />
              <span className="text-zinc-300">{t.label}</span>
              <span className="text-zinc-600">
                {t.path}/{t.skillDir}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 text-sm">
          <button
            type="button"
            onClick={doMount}
            className="text-blue-400 hover:text-blue-300"
          >
            挂载
          </button>
          <button
            type="button"
            onClick={doUnmount}
            className="text-zinc-400 hover:text-zinc-200"
          >
            卸载
          </button>
        </div>
        <ul className="divide-y divide-zinc-800/80 border-t border-zinc-800/80 text-sm">
          {mounts.map((m) => (
            <li key={m.targetId} className="py-3 text-zinc-400">
              <span className="text-zinc-200">{m.targetId}</span>
              {m.exists ? (
                <>
                  {" "}
                  · {m.mode} · {m.valid ? "与库一致" : "需重新部署"}
                </>
              ) : (
                " · 未挂载"
              )}
              <div className="mt-1 truncate font-mono text-xs text-zinc-600">
                {m.dest}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">静态域规则</h2>
        <p className="text-sm text-zinc-500">
          在目标仓库写入 always-apply 的 .mdc，仅作说明层；执行层是 hook
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={domainName}
            onChange={(e) => setDomainName(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
          <select
            value={ruleTarget}
            onChange={(e) => setRuleTarget(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={installRule}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            写入规则
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">入口 hook</h2>
        <p className="text-sm text-zinc-500">
          生成 Cursor / Claude Code / git pre-commit 的 fail-closed 门禁。
          hook 会阻断操作，请先跑 doctor 与验收再激活
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            value={hookTarget}
            onChange={(e) => setHookTarget(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={hookRoute}
            onChange={(e) => setHookRoute(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
          >
            {routes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={checkHooks} className="text-zinc-400 hover:text-zinc-200">
            查看状态
          </button>
          <button type="button" onClick={doInstallHooks} className="text-blue-400 hover:text-blue-300">
            安装 hook
          </button>
        </div>
        {hookLines.length > 0 ? (
          <ul className="space-y-1 font-mono text-xs text-zinc-500">
            {hookLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {message ? <p className="text-sm text-zinc-500">{message}</p> : null}
    </div>
  );
}
