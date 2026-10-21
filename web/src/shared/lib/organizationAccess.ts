import type { OrganizationUnit, OrganizationView } from "../../app/api/organization-api";
import type { UserRole } from "../../app/routes";

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
