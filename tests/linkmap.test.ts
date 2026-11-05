import assert from "node:assert/strict";
import test from "node:test";
import { compileRoute, hashRoute } from "../shared/linkmap.js";
import type { RouteDefinition } from "../shared/route.js";
import { readRoute } from "../shared/route.js";
import { checkRoute } from "../shared/routeRunner.js";
import { validateMolecules } from "../shared/molecule.js";

function baseRoute(): RouteDefinition {
  return {
    name: "test",
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
          { id: "on", when: "a", to: { kind: "stop", exit: 0, reason: "a" } },
          {
            id: "off",
            when: { not: "a" },
            to: { kind: "stop", exit: 1, reason: "no a" },
          },
        ],
      },
    },
  };
}

const ctx = { domainNames: [] as string[], atomNames: ["a"] };

function codes(route: RouteDefinition): string[] {
  return compileRoute(route, ctx).issues.map((i) => i.code);
}

test("a complete and exclusive decision table compiles", () => {
  const report = compileRoute(baseRoute(), ctx);
  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
  assert.equal(report.stages.entry.feasible, 2);
  assert.equal(hashRoute(baseRoute()), hashRoute(baseRoute()));
});

test("overlapping links are rejected under policy=unique", () => {
  const r = baseRoute();
  r.stages.entry.links.push({
    id: "always",
    when: { any: ["a", { not: "a" }] },
    to: { kind: "stop", exit: 1, reason: "always" },
  });
  const report = compileRoute(r, ctx);
  assert.equal(report.ok, false);
  assert.ok(codes(r).includes("overlap"));
});

test("a gap in coverage is rejected with a concrete assignment", () => {
  const r = baseRoute();
  r.stages.entry.links = r.stages.entry.links.filter((l) => l.id === "on");
  const report = compileRoute(r, ctx);
  assert.ok(codes(r).includes("coverage"));
  assert.ok(report.issues.some((i) => i.message.includes("a")));
});

test("an unsatisfiable link is flagged as unreachable", () => {
  const r = baseRoute();
  r.stages.entry.links.push({
    id: "never",
    when: { all: ["a", { not: "a" }] },
    to: { kind: "stop", exit: 1, reason: "never" },
  });
  assert.ok(codes(r).includes("reachability"));
});

test("undeclared atom references are rejected", () => {
  const r = baseRoute();
  r.stages.entry.links[0].when = "typo";
  assert.ok(codes(r).includes("reference"));
});

test("semantically identical links are flagged", () => {
  const r = baseRoute();
  r.stages.entry.links.push({
    id: "on-copy",
    when: { all: ["a"] },
    to: { kind: "stop", exit: 0, reason: "copy" },
  });
  const report = compileRoute(r, ctx);
  assert.ok(report.issues.some((i) => i.code === "minimality"));
  assert.ok(report.issues.some((i) => i.code === "overlap"));
});

test("stage cycles other than monotone ask self-loops are rejected", () => {
  const r = baseRoute();
  r.stages.entry.links = [
    {
      id: "go",
      when: { any: ["a", { not: "a" }] },
      to: { kind: "run", domain: "d", then: "second" },
    },
  ];
  r.stages.second = {
    scope: ["a"],
    links: [
      {
        id: "back",
        when: { any: ["a", { not: "a" }] },
        to: { kind: "run", domain: "d", then: "entry" },
      },
    ],
  };
  const report = compileRoute(r, { domainNames: ["d"], atomNames: ["a"] });
  assert.ok(report.issues.some((i) => i.code === "termination"));
});

test("orphan result domains are rejected", () => {
  const r = baseRoute();
  r.resultAtoms = {
    "run.d.ok": { from: "domain", domain: "d", field: "ok" },
  };
  const report = compileRoute(r, { domainNames: ["d"], atomNames: ["a"] });
  assert.ok(report.issues.some((i) => i.code === "orphan"));
});

test("molecule cycles are rejected", () => {
  const issues = validateMolecules({ x: "y", y: "x" }, new Set(["a"]));
  assert.ok(issues.some((i) => i.includes("循环引用")));
});

test("constraints remove impossible assignments", () => {
  const r = baseRoute();
  r.routingAtoms = ["slot.answered"];
  r.resultAtoms = {};
  r.molecules = {};
  r.constraints = ["slot.pass => slot.answered"];
  r.stages = {
    entry: {
      scope: ["run.d.ok", "slot.answered", "slot.pass"],
      links: [
        {
          id: "pending",
          when: { not: "slot.answered" },
          to: { kind: "stop", exit: 1, reason: "pending" },
        },
        {
          id: "done",
          when: "slot.answered",
          to: { kind: "stop", exit: 0, reason: "done" },
        },
      ],
    },
  };
  const report = compileRoute(r, { domainNames: ["d"], atomNames: [] });
  assert.equal(report.stages.entry.feasible, 6);
  assert.equal(report.ok, true);
});

test("the shipped openstrat route passes all seven checks", async () => {
  const route = await readRoute("openstrat");
  const { report } = await checkRoute("openstrat");
  assert.equal(report.ok, true, JSON.stringify(report.issues));
  assert.equal(report.stages.entry.feasible, 32);
  assert.equal(report.stages["after-discipline"].feasible, 6);
  assert.equal(Object.keys(route.stages).length, 2);
});
