async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return parseJson<T>(await fetch(url, init));
}

async function requestText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(res.statusText);
  return res.text();
}

function jsonBody(value: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export type SkillSummary = {
  name: string;
  description: string;
  issues: string[];
};

export type SkillRecord = SkillSummary & {
  body: string;
  raw: string;
  path: string;
};

export type DomainSummary = { name: string; description: string };

export type LoopView = {
  cwd: string;
  task: { intent: string; durability: string } | null;
  session: { target: string; steps: { at: string; evidence: string; sha256: string }[] } | null;
  sessionError: string | null;
  map: { state: string; entryId: string | null; location: string | null; query: string } | null;
  cards: { name: string; status: string; atom: string; onDaily: boolean }[];
  lease: { pid: number; session: string; alive: boolean } | null;
  mapApp: string;
  nextKind: "task" | "session-end" | "map" | "session-open" | "session-step" | "daily";
  next: string;
};

export type MountTarget = {
  id: string;
  label: string;
  path: string;
  skillDir: string;
};

export type MountStatus = {
  skillName: string;
  targetId: string;
  dest: string;
  mode: "symlink" | "copy";
  exists: boolean;
  valid: boolean;
  owned: boolean;
  discovered: boolean;
};

export type RouteSummary = {
  name: string;
  policy: string;
  stages: number;
  atoms: number;
  linkmap: string | null;
};

export type CompileIssue = {
  code: string;
  severity: "error" | "warning";
  stage?: string;
  message: string;
};

export type CompileReport = {
  ok: boolean;
  route: string;
  issues: CompileIssue[];
  stages: Record<
    string,
    {
      scope: string[];
      feasible: number;
      links: { id: string; satisfying: number; minimalAssignment: Record<string, boolean> | null }[];
    }
  >;
  linkmap: { generatedAt: string; routeHash: string; atomsHash: string };
  linkmapWritten?: boolean;
};

export type RouteRunResult = {
  route: string;
  exitCode: number;
  status: string;
  ok: boolean;
  log: string[];
  linkId?: string;
  stage?: string;
  pendingSlot?: string;
  snapshotHash: string;
  journal: {
    status: string;
    slotAnswers: Record<string, string>;
    entries: { seq: number; stage: string; linkId: string }[];
  };
};

export const api = {
  listSkills: () =>
    request<{ skills: SkillSummary[] }>("/api/skills").then((r) => r.skills),
  getSkill: (name: string) => request<SkillRecord>(`/api/skills/${name}`),
  saveSkill: (name: string, raw: string) =>
    request<SkillRecord>(`/api/skills/${name}`, {
      method: "PUT",
      ...jsonBody({ raw }),
    }),
  listDomains: () =>
    request<{ domains: DomainSummary[] }>("/api/domains").then((r) => r.domains),
  getDomain: (name: string) => request<unknown>(`/api/domains/${name}`),
  saveDomain: (name: string, def: unknown) =>
    request(`/api/domains/${name}`, {
      method: "PUT",
      ...jsonBody(def),
    }),
  getTargets: () =>
    request<{ targets: MountTarget[] }>("/api/settings/targets").then(
      (r) => r.targets,
    ),
  loop: (cwd: string) =>
    request<LoopView>(`/api/loop?cwd=${encodeURIComponent(cwd)}`),
  openTask: (cwd: string, intent: string, durability: string, writable: string) =>
    request<LoopView>("/api/loop/task", {
      method: "POST",
      ...jsonBody({ cwd, intent, durability, writable }),
    }),
  sessionAct: (
    cwd: string,
    action: "open" | "step" | "end",
    extra: { target?: string; at?: string; evidence?: string } = {},
  ) =>
    request<LoopView>("/api/loop/session", {
      method: "POST",
      ...jsonBody({ cwd, action, ...extra }),
    }),
  resolveMap: (cwd: string, app: string, query: string) =>
    request<LoopView>("/api/loop/map", {
      method: "POST",
      ...jsonBody({ cwd, app, query }),
    }),
  initRepo: (repoPath: string, moduleConstCase: string) =>
    request<{
      root: string;
      target: MountTarget;
      wrotePolicy: boolean;
      wroteAgents: boolean;
      lines: string[];
    }>("/api/init", {
      method: "POST",
      ...jsonBody({ path: repoPath, moduleConstCase }),
    }),
  getMounts: (skillName: string) =>
    request<{ mounts: MountStatus[] }>(`/api/mounts/${skillName}`).then(
      (r) => r.mounts,
    ),
  mount: (skillName: string, targetIds: string[]) =>
    request("/api/mounts", {
      method: "POST",
      ...jsonBody({ skillName, targetIds }),
    }),
  unmount: (skillName: string, targetIds: string[]) =>
    request("/api/mounts", {
      method: "DELETE",
      ...jsonBody({ skillName, targetIds }),
    }),
  installRule: (domainName: string, targetId: string, route: string) =>
    request<{ path: string }>(`/api/domains/${domainName}/install-rule`, {
      method: "POST",
      ...jsonBody({ targetId, route }),
    }),

  listRoutes: () =>
    request<{ routes: RouteSummary[] }>("/api/routes").then((r) => r.routes),
  getRoute: (name: string) => request<unknown>(`/api/routes/${name}`),
  checkRoute: (name: string) =>
    request<CompileReport>(`/api/routes/${name}/check`, { method: "POST" }),
  runRoute: (name: string, cwd: string, window: string) =>
    request<RouteRunResult>(`/api/routes/${name}/run`, {
      method: "POST",
      ...jsonBody({ cwd, window }),
    }),
  explainRoute: (name: string, cwd: string, window: string) =>
    requestText(`/api/routes/${name}/explain`, {
      method: "POST",
      ...jsonBody({ cwd, window }),
    }),
  getJournal: (name: string, cwd: string) =>
    request<{ journal: unknown }>(
      `/api/routes/${name}/journal?cwd=${encodeURIComponent(cwd)}`,
    ).then((r) => r.journal),
  getLinkmap: (name: string) =>
    request<{ linkmap: unknown }>(`/api/routes/${name}/linkmap`).then(
      (r) => r.linkmap,
    ),
  getSummary: (name: string) =>
    requestText(`/api/routes/${name}/summary`),
  answerSlot: (
    route: string,
    slot: string,
    answer: "pass" | "fail",
    cwd: string,
    window: string,
  ) =>
    request<{ ok: boolean; message: string }>("/api/slot", {
      method: "POST",
      ...jsonBody({ route, slot, answer, cwd, window }),
    }),
  doctor: () => requestText("/api/doctor"),
  hookStatus: (targetId: string) =>
    request<{ status: string[] }>(
      `/api/hooks/status?targetId=${encodeURIComponent(targetId)}`,
    ).then((r) => r.status),
  installHooks: (targetId: string, route: string) =>
    request<{ written: string[]; warnings: string[] }>("/api/hooks/install", {
      method: "POST",
      ...jsonBody({ targetId, route }),
    }),
};
