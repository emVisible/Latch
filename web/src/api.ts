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
};

export const api = {
  listSkills: () =>
    request<{ skills: SkillSummary[] }>("/api/skills").then((r) => r.skills),
  getSkill: (name: string) => request<SkillRecord>(`/api/skills/${name}`),
  saveSkill: (name: string, raw: string) =>
    request<SkillRecord>(`/api/skills/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    }),
  listDomains: () =>
    request<{ domains: DomainSummary[] }>("/api/domains").then((r) => r.domains),
  getDomain: (name: string) => request<unknown>(`/api/domains/${name}`),
  saveDomain: (name: string, def: unknown) =>
    request(`/api/domains/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(def),
    }),
  getTargets: () =>
    request<{ targets: MountTarget[] }>("/api/settings/targets").then(
      (r) => r.targets,
    ),
  getMounts: (skillName: string) =>
    request<{ mounts: MountStatus[] }>(`/api/mounts/${skillName}`).then(
      (r) => r.mounts,
    ),
  mount: (skillName: string, targetIds: string[]) =>
    request("/api/mounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName, targetIds }),
    }),
  unmount: (skillName: string, targetIds: string[]) =>
    request("/api/mounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName, targetIds }),
    }),
  installRule: (domainName: string, targetId: string) =>
    request<{ path: string }>(`/api/domains/${domainName}/install-rule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    }),
};
