import assert from "node:assert/strict";
import test from "node:test";
import { canAccessStaffDirectory, firstAccessibleUnit } from "./organizationAccess.ts";
const unit = (id, parentId, canViewMembers = false) => ({ id, parentId, canViewMembers, canManage: false });
test("staff navigation follows effective view rights, including grants and revocations", () => {
  for (const role of ["LECTURER", "ASSISTANT"]) {
    assert.equal(canAccessStaffDirectory(role), false);
    assert.equal(canAccessStaffDirectory(role, { units: [unit("faculty", null)], administrator: false }), false);
    assert.equal(canAccessStaffDirectory(role, { units: [unit("department", "faculty", true)], administrator: false }), true);
    assert.equal(canAccessStaffDirectory(role, { units: [unit("department", "faculty")], administrator: false }), false);
  }
  assert.equal(canAccessStaffDirectory("ADMIN"), true);
  assert.equal(canAccessStaffDirectory("STUDENT", { administrator: true, units: [unit("x", null, true)] }), false);
});
test("entry selects an accessible department even when its faculty cannot be opened", () => {
  const faculty = unit("faculty", null), department = unit("department", "faculty", true), team = unit("team", "department", true);
  assert.equal(firstAccessibleUnit([team, faculty, department]), department);
  assert.equal(firstAccessibleUnit([team, { ...faculty, canViewMembers: true }, department]).id, "faculty");
  assert.equal(firstAccessibleUnit([faculty]), undefined);
});
