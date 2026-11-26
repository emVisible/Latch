import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import { loadAtomRegistry } from "../shared/atoms.js";
import { compileAlwaysApplyRule, listDomains, readDomain, writeDomain } from "../shared/domain.js";
import { runDoctor } from "../shared/doctor.js";
import { installHooks, hookStatus } from "../shared/hooks.js";
import { InitError, initRepo } from "../shared/init.js";
import { readJournal } from "../shared/journal.js";
import { loopView } from "../shared/loopView.js";
import { readMapForRepo, resolveMap, writeResolution } from "../shared/map.js";
import { addSessionStep, endSession, openSession, SessionError } from "../shared/session.js";
import { MountConflictError, mountSkill, scanMounts, unmountSkill } from "../shared/mount.js";
import { assertSafeName, LATCH_ROOT } from "../shared/paths.js";
import { readLinkmap, listRoutes, readRoute, writeRoute } from "../shared/route.js";
import {
  answerSlot,
  checkRoute,
  explainRoute,
  routeSummary,
  runRoute,
} from "../shared/routeRunner.js";
import { runDomain, formatRunOutput } from "../shared/runner.js";
import { MODULE_CONST_CASES, validateDomain, validateRoute, validateSettings, type ModuleConstCase } from "../shared/schema.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import {
  listSkills,
  readSkill,
  serializeSkill,
  writeSkill,
} from "../shared/skill.js";
import { collectSnapshot, writeTaskFile } from "../shared/snapshot.js";
import { evaluateAtoms } from "../shared/atoms.js";

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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function status(e: unknown): 400 | 409 {
  return e instanceof MountConflictError ? 409 : 400;
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

app.put("/api/skills/:name", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const body = await c.req.json<{ raw?: string; frontmatter?: Record<string, unknown>; body?: string }>();
  let raw = body.raw;
  if (!raw && body.frontmatter) raw = serializeSkill(body.frontmatter, body.body ?? "");
  if (!raw) return c.json({ error: "raw or frontmatter required" }, 400);
  try {
    return c.json(await writeSkill(name, raw));
  } catch (e) {
    return c.json({ error: message(e) }, status(e));
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

app.put("/api/domains/:name", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const def = await c.req.json();
  if (def.name !== name) return c.json({ error: "name mismatch" }, 400);
  const issues = validateDomain(def);
  if (issues.length) return c.json({ error: "校验失败", issues }, 400);
  await writeDomain(def);
  return c.json(await readDomain(name));
});

app.get("/api/domains/:name/rule", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const route = c.req.query("route");
  if (!route) return c.json({ error: "route required" }, 400);
  try {
    return c.text(compileAlwaysApplyRule(await readDomain(name), route));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

app.post("/api/domains/:name/install-rule", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const { targetId, route } = await c.req.json<{ targetId: string; route?: string }>();
  if (!route) return c.json({ error: "route required" }, 400);
  const target = (await loadSettings()).targets.find((t) => t.id === targetId);
  if (!target) return c.json({ error: "unknown target" }, 400);
  const def = await readDomain(name);
  const dest = path.join(target.path, ".cursor", "rules", `latch-${name}.mdc`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, compileAlwaysApplyRule(def, route), "utf8");
  return c.json({ path: dest });
});

app.post("/api/init", async (c) => {
  const body = await c.req.json<{ path?: string; moduleConstCase?: string }>();
  if (!body.path) return c.json({ error: "需要仓库的绝对路径" }, 400);
  const mode = body.moduleConstCase ?? "screaming-snake";
  if (!(MODULE_CONST_CASES as readonly string[]).includes(mode)) {
    return c.json({ error: "moduleConstCase 只能是 screaming-snake / camel / off" }, 400);
  }
  try {
    const result = await initRepo(body.path, { moduleConstCase: mode as ModuleConstCase });
    return c.json({
      root: result.root,
      target: result.target,
      wrotePolicy: result.wrotePolicy,
      wroteAgents: result.wroteAgents,
      lines: result.lines,
    });
  } catch (e) {
    const message = e instanceof InitError ? e.message : String(e);
    return c.json({ error: message }, 400);
  }
});

app.get("/api/loop", async (c) => {
  const cwd = c.req.query("cwd");
  if (!cwd) return c.json({ error: "需要 cwd" }, 400);
  return c.json(await loopView(path.resolve(cwd)));
});

app.post("/api/loop/task", async (c) => {
  const body = await c.req.json<{
    cwd?: string;
    intent?: string;
    durability?: string;
    writable?: string;
  }>();
  if (!body.cwd || !body.intent || (body.durability !== "once" && body.durability !== "lasting")) {
    return c.json({ error: "需要 cwd、intent，以及 once 或 lasting" }, 400);
  }
  try {
    await writeTaskFile(path.resolve(body.cwd), {
      intent: body.intent,
      durability: body.durability,
      writable: (body.writable ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      returns: [],
    });
    return c.json(await loopView(path.resolve(body.cwd)));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post("/api/loop/session", async (c) => {
  const body = await c.req.json<{
    cwd?: string;
    action?: string;
    target?: string;
    at?: string;
    evidence?: string;
  }>();
  if (!body.cwd || !body.action) return c.json({ error: "需要 cwd 和 action" }, 400);
  const cwd = path.resolve(body.cwd);
  try {
    if (body.action === "open") await openSession(cwd, body.target ?? "");
    else if (body.action === "step") await addSessionStep(cwd, body.at ?? "", body.evidence ?? "");
    else if (body.action === "end") await endSession(cwd);
    else return c.json({ error: "action 只能是 open、step 或 end" }, 400);
    return c.json(await loopView(cwd));
  } catch (e) {
    const message = e instanceof SessionError ? e.message : e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 400);
  }
});

app.post("/api/loop/map", async (c) => {
  const body = await c.req.json<{ cwd?: string; app?: string; query?: string }>();
  if (!body.cwd || !body.query) return c.json({ error: "需要 cwd 和 query" }, 400);
  const cwd = path.resolve(body.cwd);
  try {
    const map = await readMapForRepo(cwd, body.app || "desk");
    const resolved = resolveMap(map, body.query);
    await writeResolution(cwd, {
      app: map.name,
      query: body.query,
      state: resolved.state,
      entryId: resolved.state === "hit" ? resolved.entryIds[0] : null,
      entryIds: resolved.entryIds,
    });
    return c.json(await loopView(cwd));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.get("/api/settings/targets", async (c) => c.json(await loadSettings()));

app.put("/api/settings/targets", async (c) => {
  const body = await c.req.json();
  const issues = validateSettings(body);
  if (issues.length) return c.json({ error: "校验失败", issues }, 400);
  await saveSettings(body);
  return c.json(await loadSettings());
});

app.get("/api/mounts/:skillName", async (c) => {
  const name = safe(c.req.param("skillName"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  return c.json({ mounts: await scanMounts(name, (await loadSettings()).targets) });
});

app.post("/api/mounts", async (c) => {
  const { skillName, targetIds } = await c.req.json<{ skillName: string; targetIds: string[] }>();
  if (!safe(skillName)) return c.json({ error: "invalid name" }, 400);
  const targets = (await loadSettings()).targets;
  try {
    const mounted = [];
    for (const id of targetIds) {
      const target = targets.find((t) => t.id === id);
      if (target) mounted.push(await mountSkill(skillName, target));
    }
    return c.json({ mounted });
  } catch (e) {
    return c.json({ error: message(e) }, status(e));
  }
});

app.delete("/api/mounts", async (c) => {
  const { skillName, targetIds } = await c.req.json<{ skillName: string; targetIds: string[] }>();
  if (!safe(skillName)) return c.json({ error: "invalid name" }, 400);
  const targets = (await loadSettings()).targets;
  try {
    for (const id of targetIds) {
      const target = targets.find((t) => t.id === id);
      if (target) await unmountSkill(skillName, target);
    }
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: message(e) }, status(e));
  }
});

app.post("/api/run/:name", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const { cwd } = await c.req.json<{ cwd?: string }>();
  const workdir = cwd ?? process.cwd();
  const { atoms } = await loadAtomRegistry();
  const snapshot = await collectSnapshot(workdir);
  const evaluation = evaluateAtoms(Object.keys(atoms), snapshot, atoms);
  try {
    const result = await runDomain(name, workdir, { atomValues: evaluation.values });
    return c.json({ ...result, output: formatRunOutput(result) });
  } catch (e) {
    return c.json({ error: message(e) }, 500);
  }
});

app.get("/api/routes", async (c) => {
  const names = await listRoutes();
  const items = await Promise.all(
    names.map(async (name) => {
      const route = await readRoute(name);
      const linkmap = await readLinkmap(name);
      return {
        name,
        policy: route.policy,
        stages: Object.keys(route.stages).length,
        atoms: route.routingAtoms.length,
        linkmap: linkmap?.generatedAt ?? null,
      };
    }),
  );
  return c.json({ routes: items });
});

app.get("/api/routes/:name", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  try {
    return c.json(await readRoute(name));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

app.put("/api/routes/:name", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const def = await c.req.json();
  if (def.name !== name) return c.json({ error: "name mismatch" }, 400);
  const issues = validateRoute(def);
  if (issues.length) return c.json({ error: "校验失败", issues }, 400);
  await writeRoute(def);
  return c.json(await readRoute(name));
});

app.get("/api/routes/:name/linkmap", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  return c.json({ linkmap: await readLinkmap(name) });
});

app.post("/api/routes/:name/check", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const { report, linkmapWritten } = await checkRoute(name, { write: true });
  return c.json({ ...report, linkmapWritten });
});

app.post("/api/routes/:name/run", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const { cwd, window } = await c.req.json<{ cwd?: string; window?: string }>();
  const result = await runRoute(name, path.resolve(cwd ?? process.cwd()), { window });
  return c.json(result);
});

app.post("/api/routes/:name/explain", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const { cwd, window } = await c.req.json<{ cwd?: string; window?: string }>();
  return c.text(
    await explainRoute(name, path.resolve(cwd ?? process.cwd()), window ?? "worktree"),
  );
});

app.get("/api/routes/:name/journal", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  const cwd = c.req.query("cwd") ?? process.cwd();
  return c.json({ journal: await readJournal(path.resolve(cwd)) });
});

app.get("/api/routes/:name/summary", async (c) => {
  const name = safe(c.req.param("name"));
  if (!name) return c.json({ error: "invalid name" }, 400);
  return c.text(await routeSummary(name));
});

app.post("/api/slot", async (c) => {
  const { route, slot, answer, cwd, window } = await c.req.json<{
    route: string;
    slot: string;
    answer: "pass" | "fail";
    cwd?: string;
    window?: string;
  }>();
  if (!safe(route) || !/^[\w-]+$/.test(slot ?? "") || !["pass", "fail"].includes(answer)) {
    return c.json({ error: "invalid slot request" }, 400);
  }
  return c.json(
    await answerSlot(route, slot, answer, path.resolve(cwd ?? process.cwd()), window ?? "worktree"),
  );
});

app.get("/api/doctor", async (c) => c.text(await runDoctor()));

app.get("/api/hooks/status", async (c) => {
  const targetId = c.req.query("targetId") ?? "";
  const target = (await loadSettings()).targets.find((t) => t.id === targetId);
  if (!target) return c.json({ error: "unknown target" }, 400);
  return c.json({ status: await hookStatus(target.path) });
});

app.post("/api/hooks/install", async (c) => {
  const { targetId, route, window } = await c.req.json<{
    targetId: string;
    route?: string;
    window?: string;
  }>();
  const target = (await loadSettings()).targets.find((t) => t.id === targetId);
  if (!target) return c.json({ error: "unknown target" }, 400);
  return c.json(await installHooks(target.path, route ?? "daily", { window }));
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`Latch API http://127.0.0.1:${port}`);
});
