import type {
  OrganizationMember,
  OrganizationUnit,
  OrganizationView
} from "../../app/api/organization-api";
import type { UserRole } from "../../app/routes";
import { includesQuery } from "./usePagedList";

export function canAccessStaffDirectory(
  role: UserRole | undefined,
  organization?: OrganizationView
): boolean {
  if (role === "ADMIN") return true;
  if (role !== "LECTURER" && role !== "ASSISTANT") return false;
  return Boolean(
    organization?.administrator || organization?.units.some((unit) => unit.canViewMembers)
  );
}

export function firstAccessibleUnit(units: OrganizationUnit[]): OrganizationUnit | undefined {
  return units.find(
    (unit) =>
      unit.canViewMembers &&
      !units.some((parent) => parent.id === unit.parentId && parent.canViewMembers)
  );
}

export function canEditOrganizationMember(
  person: OrganizationMember,
  canManageSource: boolean,
  administrator: boolean,
  currentUserId: string | undefined
): boolean {
  return (
    administrator ||
    (canManageSource &&
      person.id !== currentUserId &&
      person.role !== "ADMIN" &&
      person.unitRole !== "MANAGER")
  );
}

export function searchOrganizationMemberChoices(
  people: OrganizationMember[],
  search: string,
  {
    targetUnitId,
    units,
    administrator,
    currentUserId
  }: {
    targetUnitId: string | null;
    units: OrganizationUnit[];
    administrator: boolean;
    currentUserId: string | undefined;
  }
) {
  const managedUnitIds = new Set(units.filter((unit) => unit.canManage).map((unit) => unit.id));
  const searching = Boolean(search.trim());
  return people.flatMap((person) => {
    const canManageSource = person.unitId !== null && managedUnitIds.has(person.unitId);
    if (!administrator && !canManageSource) return [];
    if (!includesQuery(search, person.displayName, person.email, person.unitName)) return [];

    const restriction =
      person.unitId === targetUnitId
        ? "already-assigned"
        : canEditOrganizationMember(person, canManageSource, administrator, currentUserId)
          ? null
          : "administrator-required";
    return searching || restriction === null ? [{ person, restriction }] : [];
  });
}
