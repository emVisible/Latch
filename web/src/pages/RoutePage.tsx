import { useEffect, useState } from "react";
import {
  api,
  type CompileReport,
  type RouteRunResult,
  type RouteSummary,
} from "../api";

const WINDOWS = [
  { id: "worktree", label: "worktree · 工作区" },
  { id: "staged", label: "staged · 暂存区" },
  { id: "last-commit", label: "last-commit · 上一次提交" },
];

export function RoutePage() {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("/Users/thawn/Company/openstrat_rn");
  const [window, setWindow] = useState("worktree");
  const [report, setReport] = useState<CompileReport | null>(null);
  const [run, setRun] = useState<RouteRunResult | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [textLabel, setTextLabel] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listRoutes()
      .then((items) => {
        setRoutes(items);
        if (items[0]) setName(items[0].name);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!name) return;
    api
      .getRoute(name)
      .then((r) => setSource(JSON.stringify(r, null, 2)))
      .catch((e) => setError(String(e)));
  }, [name]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setTextLabel(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const check = () =>
    act("编译结果", async () => {
      const r = await api.checkRoute(name);
      setReport(r);
      setRun(null);
      setText(null);
    });

  const execute = () =>
    act("运行结果", async () => {
      const r = await api.runRoute(name, cwd, window);
      setRun(r);
      setReport(null);
      setText(null);
    });

  const explain = () =>
    act("explain", async () => setText(await api.explainRoute(name, cwd, window)));
  const journal = () =>
    act("回执", async () =>
      setText(JSON.stringify(await api.getJournal(name, cwd), null, 2)),
    );
  const summary = () =>
    act("摘要", async () => setText(await api.getSummary(name)));
  const doctor = () =>
    act("doctor", async () => setText(await api.doctor()));

  const answer = (slot: string, value: "pass" | "fail") =>
    act("slot 作答", async () => {
      const res = await api.answerSlot(name, slot, value, cwd, window);
      setText(res.message);
      setRun(null);
    });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">链路</h1>
        <p className="mt-1 text-sm text-zinc-500">
          只读查看。链路表与原子都编译在 <code className="text-zinc-400">library/routes</code>
          ，控制台不做连线编辑
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
        >
          {routes.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name} · {r.stages} 阶段 / {r.atoms} 原子
            </option>
          ))}
        </select>
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          className="min-w-[260px] flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200"
          aria-label="目标仓库路径"
        />
        <select
          value={window}
          onChange={(e) => setWindow(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
        >
          {WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={check} disabled={busy} className="text-blue-400 hover:text-blue-300 disabled:opacity-50">
          编译检查
        </button>
        <button type="button" onClick={execute} disabled={busy} className="text-blue-400 hover:text-blue-300 disabled:opacity-50">
          运行 route
        </button>
        <button type="button" onClick={explain} disabled={busy} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
          explain
        </button>
        <button type="button" onClick={journal} disabled={busy} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
          回执
        </button>
        <button type="button" onClick={summary} disabled={busy} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
          摘要
        </button>
        <button type="button" onClick={doctor} disabled={busy} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
          doctor
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {report ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">
            编译检查 ·{" "}
            <span className={report.ok ? "text-emerald-400" : "text-red-400"}>
              {report.ok ? "通过" : "未通过"}
            </span>
          </h2>
          <div className="space-y-3">
            {Object.entries(report.stages).map(([id, st]) => (
              <div key={id} className="border-t border-zinc-800 pt-3">
                <p className="text-sm text-zinc-300">
                  {id} · {st.scope.length} 原子 · {st.feasible} 种可行赋值
                </p>
                <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                  {st.links.map((l) => (
                    <li key={l.id}>
                      <span className="text-zinc-300">{l.id}</span> · 命中 {l.satisfying} 种
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {report.issues.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {report.issues.map((i, idx) => (
                <li key={idx} className={i.severity === "error" ? "text-red-400" : "text-amber-400"}>
                  [{i.code}] {i.stage ? `${i.stage}: ` : ""}{i.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-zinc-600">
            routeHash={report.linkmap.routeHash} · atomsHash={report.linkmap.atomsHash}
          </p>
        </section>
      ) : null}

      {run ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">
            运行结果 ·{" "}
            <span className={run.ok ? "text-emerald-400" : "text-amber-400"}>
              exit {run.exitCode} / {run.status}
            </span>
          </h2>
          {run.pendingSlot ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-zinc-400">等待 slot：{run.pendingSlot}</span>
              <button type="button" onClick={() => answer(run.pendingSlot!, "pass")} className="text-blue-400">
                答 pass
              </button>
              <button type="button" onClick={() => answer(run.pendingSlot!, "fail")} className="text-zinc-400">
                答 fail
              </button>
            </div>
          ) : null}
          <pre className="max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-900/50 p-4 text-xs leading-relaxed text-zinc-300">
            {run.log.join("\n")}
          </pre>
        </section>
      ) : null}

      {text !== null ? (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">{textLabel}</h2>
          <pre className="max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-900/50 p-4 text-xs leading-relaxed text-zinc-300">
            {text}
          </pre>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">route.json</h2>
        <pre className="max-h-72 overflow-auto rounded border border-zinc-800 bg-zinc-900/50 p-4 text-xs leading-relaxed text-zinc-400">
          {source}
        </pre>
      </section>
    </div>
  );
}
