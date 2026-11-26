import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("library page has no init, mount, or hook install control", async () => {
  const source = await fs.readFile(path.join(root, "web/src/pages/LibraryPage.tsx"), "utf8");
  const forbidden = [
    "initRepo",
    "api.init",
    "api.mount",
    "api.unmount",
    "unmount",
    "installHooks",
    "installRule",
    "openTask",
    "runRoute",
    "初始化",
    "卸载",
    "写入规则",
    "安装 hook",
    "编辑说明",
  ];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, token);
  }
  for (const token of ["部署", "重新部署", "挂载", "卸下", "未挂载", "与库一致", "需要重新部署", "getMounts"]) {
    assert.equal(source.includes(token), false, token);
  }
  const buttons = [...source.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((match) => match[1]);
  assert.ok(buttons.length > 0);
  for (const inner of buttons) {
    assert.doesNotMatch(inner, /初始化|挂载|卸载|安装|编辑|保存|写入/);
  }
});

test("retired pages are gone and old routes redirect to the library", async () => {
  const app = await fs.readFile(path.join(root, "web/src/App.tsx"), "utf8");
  assert.match(app, /Navigate to="\/library"/);
  for (const route of ["/", "/routes", "/deploy", "/edit"]) {
    assert.match(app, new RegExp(`path="${route}"`));
  }
  assert.doesNotMatch(app, /DeployPage|EditPage|RoutePage|HomePage|NextForm/);
  assert.match(app, />\s*库\s*</);
  for (const file of [
    "web/src/pages/DeployPage.tsx",
    "web/src/pages/EditPage.tsx",
    "web/src/pages/RoutePage.tsx",
    "web/src/home/HomePage.tsx",
    "web/src/home/NextForm.tsx",
  ]) {
    await assert.rejects(fs.access(path.join(root, file)));
  }
});

test("cli does not dispatch an interactive tui", async () => {
  const source = await fs.readFile(path.join(root, "cli/run.ts"), "utf8");
  assert.doesNotMatch(source, /case "tui":/);
  assert.doesNotMatch(source, /runTui\(/);
  assert.doesNotMatch(source, /latch tui/);
  await assert.rejects(fs.access(path.join(root, "cli/tui.ts")));
});
