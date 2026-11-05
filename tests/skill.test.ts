import assert from "node:assert/strict";
import test from "node:test";
import { validateSkill } from "../shared/skill.js";
import { validateDomain, validateRoute, validateSettings } from "../shared/schema.js";
import { NAME_RE, resolveWithin } from "../shared/paths.js";
import { LIBRARY_DIR } from "../shared/paths.js";

test("skill name follows the Agent Skills spec", () => {
  const desc = "Does X. Use when editing Y.";
  assert.deepEqual(validateSkill("pdf-processing", { name: "pdf-processing", description: desc }), []);
  assert.ok(validateSkill("a--b", { name: "a--b", description: desc }).length > 0);
  assert.ok(validateSkill("-abc", { name: "-abc", description: desc }).length > 0);
  assert.ok(validateSkill("PDF", { name: "PDF", description: desc }).length > 0);
  assert.ok(validateSkill("abc", { name: "other", description: desc }).length > 0);
  assert.ok(NAME_RE.test("pdf-2"));
  assert.ok(!NAME_RE.test("pdf--2"));
});

test("optional frontmatter fields are validated", () => {
  const base = { name: "a", description: "Does X. Use when Y." };
  assert.ok(validateSkill("a", { ...base, compatibility: "x".repeat(501) }).length > 0);
  assert.ok(validateSkill("a", { ...base, metadata: { n: 1 } }).length > 0);
  assert.deepEqual(validateSkill("a", { ...base, metadata: { owner: "me" } }), []);
  assert.ok(validateSkill("a", { ...base, description: "Helps." }).some((i) => i.includes("建议")));
});

test("domain schema accepts atom asserts and rejects unknown step kinds", () => {
  const good = {
    name: "d",
    description: "x",
    steps: [{ id: "a", kind: "assert", atom: "diff.useEffect", expect: false }],
  };
  assert.deepEqual(validateDomain(good), []);
  assert.ok(validateDomain({ ...good, steps: [{ id: "a", kind: "if" }] }).length > 0);
  assert.ok(
    validateDomain({
      ...good,
      steps: [{ id: "a", kind: "assert", atom: "x", script: "s.mjs" }],
    }).length > 0,
  );
});

test("route schema rejects malformed actions and windows", () => {
  const route = {
    name: "r",
    version: 1,
    policy: "unique",
    maxRounds: 4,
    routingAtoms: ["a"],
    resultAtoms: {},
    constraints: [],
    molecules: {},
    stages: {
      entry: {
        scope: ["a"],
        links: [
          { id: "x", when: "a", to: { kind: "stop", exit: 0, reason: "ok" } },
        ],
      },
    },
  };
  assert.deepEqual(validateRoute(route), []);
  const bad = JSON.parse(JSON.stringify(route));
  bad.stages.entry.links[0].to = { kind: "run", domain: "d" };
  assert.ok(validateRoute(bad).length > 0);
  bad.constraints = ["a && b"];
  assert.ok(validateRoute(bad).length > 0);
});

test("settings validation and path traversal guard", () => {
  assert.deepEqual(validateSettings({ targets: [{ id: "t", label: "T", path: "/tmp/x", skillDir: ".agents/skills" }] }), []);
  assert.ok(validateSettings({ targets: [{ id: "t", path: "relative" }] }).length > 0);
  assert.throws(() => resolveWithin(LIBRARY_DIR, "..", "etc"));
  assert.doesNotThrow(() => resolveWithin(LIBRARY_DIR, "skills", "a"));
});
