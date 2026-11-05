import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DomainSummary, type MountStatus, type SkillSummary } from "../api";

function mountLabel(m: MountStatus): string {
  if (!m.exists) return "未挂载";
  if (m.valid) return `${m.mode} · 与库一致`;
  return `${m.mode} · 需重新部署`;
}

export function LibraryPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [mountsBySkill, setMountsBySkill] = useState<
    Record<string, MountStatus[]>
  >({});
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listSkills(), api.listDomains()])
      .then(async ([s, d]) => {
        setSkills(s);
        setDomains(d);
        const entries = await Promise.all(
          s.map(async (skill) => {
            const mounts = await api.getMounts(skill.name);
            return [skill.name, mounts] as const;
          }),
        );
        setMountsBySkill(Object.fromEntries(entries));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold text-zinc-100">技能</h1>
        <p className="mt-1 text-sm text-zinc-500">
          正文在 <code className="text-zinc-400">library/skills</code>
        </p>
        <ul className="mt-4 divide-y divide-zinc-800/80 border-t border-zinc-800/80">
          {skills.map((s) => (
            <li key={s.name} className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-100">{s.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">{s.description}</p>
                  {s.issues.length > 0 ? (
                    <ul className="mt-2 text-xs text-amber-400/90">
                      {s.issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  ) : null}
                  <ul className="mt-3 space-y-1 text-xs text-zinc-500">
                    {(mountsBySkill[s.name] ?? []).map((m) => (
                      <li key={m.targetId}>
                        <span className="text-zinc-400">{m.targetId}</span>
                        {" · "}
                        {mountLabel(m)}
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  to={`/edit?skill=${encodeURIComponent(s.name)}`}
                  className="shrink-0 text-sm text-blue-400 hover:text-blue-300"
                >
                  编辑
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h1 className="text-xl font-semibold text-zinc-100">静态域</h1>
        <p className="mt-1 text-sm text-zinc-500">
          流程在 <code className="text-zinc-400">library/domains</code>，用{" "}
          <code className="text-zinc-400">latch run</code> 执行
        </p>
        <ul className="mt-4 divide-y divide-zinc-800/80 border-t border-zinc-800/80">
          {domains.map((d) => (
            <li key={d.name} className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-zinc-100">{d.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">{d.description}</p>
                </div>
                <Link
                  to={`/edit?domain=${encodeURIComponent(d.name)}`}
                  className="shrink-0 text-sm text-blue-400 hover:text-blue-300"
                >
                  编辑
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
