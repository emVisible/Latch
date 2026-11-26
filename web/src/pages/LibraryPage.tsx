import { useEffect, useRef, useState } from "react";
import { api, type DomainSummary, type SkillRecord, type SkillSummary } from "../api";

type DomainStepView = {
  id?: string;
  kind?: string;
  atom?: string;
  expect?: boolean;
  paths?: string[];
  question?: string;
  command?: string | string[];
  script?: string;
};

type DomainView = {
  name: string;
  description: string;
  steps: DomainStepView[];
};

function stepText(step: DomainStepView): string {
  if (step.kind === "read") return `读取 ${(step.paths ?? []).join("、")}`;
  if (step.kind === "assert") {
    if (step.atom) return `断言 ${step.atom} ${step.expect === false ? "应为假" : "应为真"}`;
    return `断言 ${step.script ?? ""}`;
  }
  if (step.kind === "slot") return `判断 ${step.question ?? ""}`;
  if (step.kind === "tool") {
    const command = Array.isArray(step.command) ? step.command.join(" ") : (step.command ?? "");
    return `工具 ${command}`;
  }
  return step.kind ?? "";
}

function asDomain(value: unknown): DomainView | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.description !== "string" || !Array.isArray(record.steps)) return null;
  const steps = record.steps.filter((step): step is DomainStepView => !!step && typeof step === "object");
  return {
    name: typeof record.name === "string" ? record.name : "",
    description: record.description,
    steps,
  };
}

export function LibraryPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState<SkillRecord | null>(null);
  const [domain, setDomain] = useState<DomainView | null>(null);
  const [picked, setPicked] = useState<{ kind: "skill" | "domain"; name: string } | null>(null);
  const request = useRef(0);

  useEffect(() => {
    Promise.all([api.listSkills(), api.listDomains()])
      .then(([nextSkills, nextDomains]) => {
        setSkills(nextSkills);
        setDomains(nextDomains);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  function chooseSkill(name: string) {
    const id = ++request.current;
    setPicked({ kind: "skill", name });
    setDomain(null);
    setSkill(null);
    api
      .getSkill(name)
      .then((record) => {
        if (request.current !== id) return;
        setSkill(record);
      })
      .catch((e) => {
        if (request.current !== id) return;
        setError(e instanceof Error ? e.message : "加载失败");
      });
  }

  function chooseDomain(name: string) {
    const id = ++request.current;
    setPicked({ kind: "domain", name });
    setSkill(null);
    setDomain(null);
    api
      .getDomain(name)
      .then((value) => {
        if (request.current !== id) return;
        const view = asDomain(value);
        if (!view) {
          setError("读不到这份域");
          return;
        }
        setDomain({ ...view, name: view.name || name });
      })
      .catch((e) => {
        if (request.current !== id) return;
        setError(e instanceof Error ? e.message : "加载失败");
      });
  }

  if (error && skills.length === 0 && domains.length === 0) return <p className="err">{error}</p>;

  return (
    <div>
      <p className="kicker">Library</p>
      <h1>库</h1>
      <p className="lede">这一页只读。agent 运行 latch next。</p>
      <div className="stack">
        {error ? <p className="err">{error}</p> : null}
        <section>
          <h2 className="step-label">技能</h2>
          <ul className="list" style={{ marginTop: 12 }}>
            {skills.map((item) => (
              <li key={item.name} className="item">
                <div>
                  <button
                    type="button"
                    className="choice"
                    aria-pressed={picked?.kind === "skill" && picked.name === item.name}
                    onClick={() => chooseSkill(item.name)}
                  >
                    <h2>{item.name}</h2>
                  </button>
                  <p>{item.description}</p>
                  {item.issues.map((issue) => (
                    <p key={issue} className="err">{issue}</p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="step-label">静态域</h2>
          <ul className="list" style={{ marginTop: 12 }}>
            {domains.map((item) => (
              <li key={item.name} className="item">
                <div>
                  <button
                    type="button"
                    className="choice"
                    aria-pressed={picked?.kind === "domain" && picked.name === item.name}
                    onClick={() => chooseDomain(item.name)}
                  >
                    <h2>{item.name}</h2>
                  </button>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
        {skill ? (
          <section className="panel stack" style={{ marginTop: 0 }}>
            <h2 className="step-label">{skill.name}</h2>
            <pre className="log mono" style={{ maxHeight: "none" }}>{skill.raw}</pre>
          </section>
        ) : null}
        {domain ? (
          <section className="panel stack" style={{ marginTop: 0 }}>
            <h2 className="step-label">{domain.name}</h2>
            <p className="step-status">{domain.description}</p>
            <ol className="list">
              {domain.steps.map((step, index) => (
                <li key={step.id ?? index} className="item">
                  <div>
                    <h2>{step.id ?? step.kind}</h2>
                    <p>{stepText(step)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  );
}
