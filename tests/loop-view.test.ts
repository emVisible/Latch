import assert from "node:assert/strict";
import test from "node:test";
import { loopView } from "../shared/loopView.js";
import { writeTaskFile } from "../shared/snapshot.js";
import { cleanup, makeRepo } from "./helpers.js";

test("the home view asks for a task before a map", async () => {
  const repo = await makeRepo();
  try {
    const empty = await loopView(repo);
    assert.equal(empty.nextKind, "task");
    assert.equal(empty.next.includes("npm run latch"), false);
    await writeTaskFile(repo, {
      intent: "看笔记",
      durability: "once",
      writable: [],
      returns: [],
    });
    const tasked = await loopView(repo);
    assert.equal(tasked.nextKind, "map");
    assert.equal(tasked.next.includes("npm run latch"), false);
    assert.equal(tasked.task?.durability, "once");
  } finally {
    await cleanup(repo);
  }
});
