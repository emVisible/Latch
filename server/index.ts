import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { listDomains, readDomain } from "../shared/domain.js";
import { assertSafeName, LATCH_ROOT } from "../shared/paths.js";
import { listSkills, readSkill } from "../shared/skill.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

function safe(name: string): string | null {
  try {
    return assertSafeName(name);
  } catch {
    return null;
  }
}

app.get("/api/health", (c) => c.json({ ok: true, root: LATCH_ROOT }));

app.get("/api/skills", async (c) => {
  const names = await listSkills();
  const items = await Promise.all(
    names.map(async (name) => {
      const skill = await readSkill(name);
      return { name, description: skill.description, issues: skill.issues };
    }),
  );
  return c.json({ skills: items });
});

app.get("/api/skills/:name", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  try {
    return c.json(await readSkill(name));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
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
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  try {
    return c.json(await readDomain(name));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`Latch API http://127.0.0.1:${port}`);
});
