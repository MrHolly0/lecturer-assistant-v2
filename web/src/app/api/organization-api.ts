import type { components } from "./schema";
import { apiFetch } from "./http";

export type OrganizationUnit = components["schemas"]["OrganizationUnit"];
export type OrganizationMember = components["schemas"]["OrganizationMember"];
export type OrganizationView = components["schemas"]["OrganizationView"];
export type UnitKind = "FACULTY" | "DEPARTMENT" | "UNIT";
export type UnitRole = "MEMBER" | "MANAGER";

export interface MoveOrganizationMembersRequest {
  personIds: string[];
  unitId: string | null;
}

export async function getOrganization(): Promise<OrganizationView> {
  const response = await apiFetch("/organization");
  return response.json() as Promise<OrganizationView>;
}

export async function getOrganizationMembers(unitId?: string): Promise<OrganizationMember[]> {
  const response = await apiFetch(
    `/organization/members${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ""}`
  );
  return response.json() as Promise<OrganizationMember[]>;
}

export async function saveOrganizationUnit(
  id: string | null,
  body: { name: string; kind: UnitKind; parentId: string | null }
): Promise<OrganizationUnit> {
  const response = await apiFetch(`/organization/units${id ? `/${id}` : ""}`, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body)
  });
  return response.json() as Promise<OrganizationUnit>;
}

export async function deleteOrganizationUnit(id: string): Promise<void> {
  await apiFetch(`/organization/units/${id}`, { method: "DELETE" });
}

export async function assignOrganizationMember(
  personId: string,
  unitId: string | null,
  unitRole: UnitRole
): Promise<void> {
  await apiFetch(`/organization/members/${personId}`, {
    method: "PUT",
    body: JSON.stringify({ unitId, unitRole })
  });
}

export async function moveOrganizationMembers(body: MoveOrganizationMembersRequest): Promise<void> {
  await apiFetch("/organization/members/move", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
