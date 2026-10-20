import type { components } from "../../app/api/schema";

type User = components["schemas"]["UserProfile"];
type Group = components["schemas"]["AccountGroup"];
export type AccountFolder = Group & { allPersonIds: Set<string> };

/** Existing memberships only: changing this view never changes account access. */
export function buildAccountFolders(users: User[], groups: Group[]): AccountFolder[] {
  const staff = users.filter((u) => u.role === "LECTURER" || u.role === "ASSISTANT");
  const students = users.filter((u) => u.role === "STUDENT");
  const categories = [
    { id: "staff", name: "Преподаватели", icon: "FOLDER", users: staff },
    { id: "students", name: "Студенты", icon: "GRADUATION", users: students },
    {
      id: "admins",
      name: "Администраторы",
      icon: "FOLDER",
      users: users.filter((u) => u.role === "ADMIN")
    }
  ];
  const staffIds = new Set(staff.map((u) => u.id));
  const studentIds = new Set(students.map((u) => u.id));
  const folders: AccountFolder[] = categories.map((category) => ({
    id: category.id,
    parentId: "",
    name: category.name,
    description: "",
    icon: category.icon,
    personIds: category.users.map((u) => u.id),
    allPersonIds: new Set()
  }));
  folders.push(
    ...groups.map((group) => ({
      ...group,
      personIds: group.personIds.filter((id) =>
        (group.id.startsWith("unit:") ? staffIds : studentIds).has(id)
      ),
      allPersonIds: new Set<string>()
    }))
  );
  for (const category of categories.slice(0, 2)) {
    const members = folders.filter((f) =>
      f.id.startsWith(category.id === "staff" ? "unit:" : "group:")
    );
    const assigned = new Set(members.flatMap((f) => f.personIds));
    const unassigned = category.users.filter((u) => !assigned.has(u.id)).map((u) => u.id);
    if (members.length && unassigned.length) {
      folders.push({
        id: `${category.id}:unassigned`,
        parentId: category.id,
        name: category.id === "staff" ? "Без подразделения" : "Без учебной группы",
        description: "",
        icon: "FOLDER",
        personIds: unassigned,
        allPersonIds: new Set()
      });
    }
  }
  const children = new Map<string, AccountFolder[]>();
  for (const folder of folders) {
    children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder]);
  }
  function collect(folder: AccountFolder, visited: Set<string>): Set<string> {
    if (visited.has(folder.id)) return new Set();
    const path = new Set(visited).add(folder.id);
    return new Set([
      ...folder.personIds,
      ...(children.get(folder.id) ?? []).flatMap((child) => [...collect(child, path)])
    ]);
  }
  return folders.map((folder) => ({ ...folder, allPersonIds: collect(folder, new Set()) }));
}

export function accountFolderPath(folders: AccountFolder[], selectedId: string): AccountFolder[] {
  const path: AccountFolder[] = [];
  const visited = new Set<string>();
  let current = folders.find((f) => f.id === selectedId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = folders.find((f) => f.id === current?.parentId);
  }
  return path;
}
