export type PersonName = { familyName: string; givenName: string; middleName: string };

export function formatPersonName(name: PersonName): string {
  return [name.familyName, name.givenName, name.middleName]
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");
}
