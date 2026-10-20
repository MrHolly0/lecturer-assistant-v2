export function resolveSessionGroups(
  selectedIds: string[],
  addedNames: string[],
  draftName: string,
  existing: Array<{ id: string; name: string }>
) {
  const ids = new Set(selectedIds);
  const names = new Map<string, string>();
  for (const value of [...addedNames, draftName]) {
    const name = value.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLocaleLowerCase("ru");
    const match = existing.find(
      (group) => group.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru") === key
    );
    if (match) ids.add(match.id);
    else names.set(key, name);
  }
  return [
    ...[...ids].map((groupId) => ({ groupId })),
    ...[...names.values()].map((groupName) => ({ groupName }))
  ];
}
