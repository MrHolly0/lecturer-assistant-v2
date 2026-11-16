import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessStaffDirectory,
  firstAccessibleUnit,
  searchOrganizationMemberChoices
} from "./organizationAccess.ts";
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

const person = (id, displayName, email, unitId, unitRole, role = "LECTURER") => ({
  id,
  displayName,
  email,
  unitId,
  unitRole,
  role
});

test("system administrator finds themselves across the directory and can move to another group", () => {
  const self = person("admin", "Ирина Волкова", "irina@example.test", null, null, "ADMIN");
  const options = { targetUnitId: "team", units: [], administrator: true, currentUserId: self.id };
  assert.deepEqual(searchOrganizationMemberChoices([self], "  IRINA@EXAMPLE.TEST  ", options), [
    { person: self, restriction: null }
  ]);

  const assigned = { ...self, unitId: "team", unitRole: "MEMBER" };
  assert.deepEqual(searchOrganizationMemberChoices([assigned], "ирина волк", options), [
    { person: assigned, restriction: "already-assigned" }
  ]);
  assert.deepEqual(searchOrganizationMemberChoices([assigned], "", options), []);
});

test("group administrator finds their own account and can select ordinary staff only in their branch", () => {
  const managed = (id, parentId) => ({ ...unit(id, parentId, true), canManage: true });
  const units = [managed("faculty", null), managed("team", "faculty"), unit("other", null)];
  const self = person("me", "Анна Иванова", "me@example.test", "faculty", "MANAGER");
  const colleague = person("colleague", "Анна Петрова", "peer@example.test", "faculty", "MEMBER");
  const assigned = person("assigned", "Анна Миронова", "team@example.test", "team", "MEMBER");
  const protectedAdmin = person(
    "admin",
    "Анна Соколова",
    "admin@example.test",
    "faculty",
    "MEMBER",
    "ADMIN"
  );
  const outsider = person("outside", "Анна Сидорова", "outside@example.test", "other", "MEMBER");
  const unassigned = person("unassigned", "Анна Смирнова", "root@example.test", null, null);
  const people = [self, colleague, assigned, protectedAdmin, outsider, unassigned];
  const options = { targetUnitId: "team", units, administrator: false, currentUserId: self.id };
  assert.deepEqual(searchOrganizationMemberChoices(people, " анна ", options), [
    { person: self, restriction: "administrator-required" },
    { person: colleague, restriction: null },
    { person: assigned, restriction: "already-assigned" },
    { person: protectedAdmin, restriction: "administrator-required" }
  ]);
  assert.deepEqual(searchOrganizationMemberChoices(people, "", options), [
    { person: colleague, restriction: null }
  ]);
});
