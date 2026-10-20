import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionGroups } from "./sessionGroups.ts";

test("continuing includes an uncommitted draft alongside selected groups", () => {
  assert.deepEqual(resolveSessionGroups(["a"], [], "  БИСТ-234  ", []), [
    { groupId: "a" },
    { groupName: "БИСТ-234" }
  ]);
});
test("draft-only launch and duplicate existing names resolve to a single group", () => {
  assert.deepEqual(resolveSessionGroups([], [], "Новая группа", []), [
    { groupName: "Новая группа" }
  ]);
  assert.deepEqual(
    resolveSessionGroups(["a"], ["Группа  1"], " группа 1 ", [{ id: "a", name: "Группа 1" }]),
    [{ groupId: "a" }]
  );
  assert.deepEqual(resolveSessionGroups([], ["БИСТ-234"], "бист-234", []), [
    { groupName: "бист-234" }
  ]);
  assert.deepEqual(resolveSessionGroups([], [], "   ", []), []);
});
