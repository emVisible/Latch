import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import { compileAlwaysApplyRule, listDomains, readDomain, writeDomain } from "../shared/domain.js";
import { mountSkill, scanMounts, unmountSkill } from "../shared/mount.js";
import { runDomain, formatRunOutput } from "../shared/runner.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import {
  listSkills,
  readSkill,
  serializeSkill,
  writeSkill,
} from "../shared/skill.js";
import { LATCH_ROOT } from "../shared/paths.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, root: LATCH_ROOT }));

app.get("/api/skills", async (c) => {
  const names = await listSkills();
  const items = await Promise.all(
    names.map(async (name) => {
      const skill = await readSkill(name);
      return {
        name,
        description: skill.description,
        issues: skill.issues,
      };
    }),
  );
  return c.json({ skills: items });
});

app.get("/api/skills/:name", async (c) => {
  const name = c.req.param("name");
  try {
    return c.json(await readSkill(name));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

app.put("/api/skills/:name", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ raw?: string; frontmatter?: Record<string, unknown>; body?: string }>();
  let raw = body.raw;
  if (!raw && body.frontmatter) {
    raw = serializeSkill(body.frontmatter, body.body ?? "");
  }
  if (!raw) {
    return c.json({ error: "raw or frontmatter required" }, 400);
  }
  const skill = await writeSkill(name, raw);
  return c.json(skill);
});

app.get("/api/domains", async (c) => {
  const names = await listDomains();
  const items = await Promise.all(
    names.map(async (name) => {
      const def = await readDomain(name);
      return { name, description: def.description };
    }),
  );
  return c.json({ domains: items });
});

app.get("/api/domains/:name", async (c) => {
  const name = c.req.param("name");
  try {
    return c.json(await readDomain(name));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

app.put("/api/domains/:name", async (c) => {
  const name = c.req.param("name");
  const def = await c.req.json();
  if (def.name !== name) {
    return c.json({ error: "name mismatch" }, 400);
  }
  await writeDomain(def);
  return c.json(await readDomain(name));
});

app.get("/api/domains/:name/rule", async (c) => {
  const name = c.req.param("name");
  try {
    const def = await readDomain(name);
    return c.text(compileAlwaysApplyRule(def));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

app.post("/api/domains/:name/install-rule", async (c) => {
  const name = c.req.param("name");
  const { targetId } = await c.req.json<{ targetId: string }>();
  const settings = await loadSettings();
  const target = settings.targets.find((t) => t.id === targetId);
  if (!target) return c.json({ error: "unknown target" }, 400);
  const def = await readDomain(name);
  const ruleName = `latch-${name}.mdc`;
  const dest = path.join(target.path, ".cursor", "rules", ruleName);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, compileAlwaysApplyRule(def), "utf8");
  return c.json({ path: dest });
});

app.get("/api/settings/targets", async (c) => {
  const settings = await loadSettings();
  return c.json(settings);
});

app.put("/api/settings/targets", async (c) => {
  const body = await c.req.json();
  await saveSettings(body);
  return c.json(await loadSettings());
});

app.get("/api/mounts/:skillName", async (c) => {
  const skillName = c.req.param("skillName");
  const settings = await loadSettings();
  const statuses = await scanMounts(skillName, settings.targets);
  return c.json({ mounts: statuses });
});

app.post("/api/mounts", async (c) => {
  const { skillName, targetIds } = await c.req.json<{
    skillName: string;
    targetIds: string[];
  }>();
  const settings = await loadSettings();
  const results = [];
  for (const id of targetIds) {
    const target = settings.targets.find((t) => t.id === id);
    if (!target) continue;
    results.push(await mountSkill(skillName, target));
  }
  return c.json({ mounted: results });
});

app.delete("/api/mounts", async (c) => {
  const { skillName, targetIds } = await c.req.json<{
    skillName: string;
    targetIds: string[];
  }>();
  const settings = await loadSettings();
  for (const id of targetIds) {
    const target = settings.targets.find((t) => t.id === id);
    if (!target) continue;
    await unmountSkill(skillName, target);
  }
  return c.json({ ok: true });
});

app.post("/api/run/:name", async (c) => {
  const name = c.req.param("name");
  const { cwd } = await c.req.json<{ cwd?: string }>();
  const workdir = cwd ?? process.cwd();
  try {
    const result = await runDomain(name, workdir);
    return c.json({ ...result, output: formatRunOutput(result) });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "run failed" },
      500,
    );
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Latch API http://127.0.0.1:${port}`);
});
