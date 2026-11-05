import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

export function EditPage() {
  const [params] = useSearchParams();
  const skillParam = params.get("skill");
  const domainParam = params.get("domain");
  const mode = domainParam ? "domain" : "skill";

  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState(
    domainParam ?? skillParam ?? "",
  );
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    const loader =
      mode === "domain" ? api.listDomains() : api.listSkills();
    loader.then((items) => {
      const list = items.map((i) => i.name);
      setNames(list);
      if (!selected && list[0]) setSelected(list[0]);
    });
  }, [mode]);

  useEffect(() => {
    if (!selected) return;
    setMessage(null);
    if (mode === "domain") {
      api
        .getDomain(selected)
        .then((def) => setText(JSON.stringify(def, null, 2)))
        .catch(() => setText(""));
    } else {
      api
        .getSkill(selected)
        .then((s) => {
          setText(s.raw);
          setIssues(s.issues);
        })
        .catch(() => setText(""));
    }
  }, [selected, mode]);

  const title = useMemo(
    () => (mode === "domain" ? "静态域" : "技能"),
    [mode],
  );

  async function save() {
    if (!selected) return;
    try {
      if (mode === "domain") {
        const def = JSON.parse(text);
        await api.saveDomain(selected, def);
        setMessage("已保存 domain.json");
      } else {
        const s = await api.saveSkill(selected, text);
        setIssues(s.issues);
        setMessage(s.issues.length ? "已保存，仍有校验提示" : "已保存");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">编辑{title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-sm text-zinc-500">选择</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          >
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              setSelected(mode === "domain" ? domainParam ?? "" : skillParam ?? "")
            }
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            切换类型请从库页进入
          </button>
        </div>
      </div>

      {issues.length > 0 && mode === "skill" ? (
        <ul className="text-sm text-amber-400/90">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[min(60vh,520px)] w-full resize-y rounded border border-zinc-800 bg-zinc-900/50 p-4 font-mono text-sm leading-relaxed text-zinc-200 outline-none focus:border-blue-500/50"
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          className="text-sm font-medium text-blue-400 hover:text-blue-300"
        >
          保存到 library
        </button>
        {message ? (
          <span className="text-sm text-zinc-500">{message}</span>
        ) : null}
      </div>
    </div>
  );
}
