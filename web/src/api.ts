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

export const api = {
  listSkills: () =>
    request<{ skills: SkillSummary[] }>("/api/skills").then((r) => r.skills),
  getSkill: (name: string) => request<SkillRecord>(`/api/skills/${name}`),
  listDomains: () =>
    request<{ domains: DomainSummary[] }>("/api/domains").then((r) => r.domains),
  getDomain: (name: string) => request<unknown>(`/api/domains/${name}`),
};
