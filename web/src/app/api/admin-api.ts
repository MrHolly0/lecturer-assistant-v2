import type { components } from "./schema";
import { apiFetch } from "./http";

type UserProfile = components["schemas"]["UserProfile"];
type CreateInvitationRequest = components["schemas"]["CreateInvitationRequest"];
type UpdateUserRoleRequest = components["schemas"]["UpdateUserRoleRequest"];
type UpdateUserStatusRequest = components["schemas"]["UpdateUserStatusRequest"];
type Invitation = components["schemas"]["Invitation"];

export async function listUsers(): Promise<UserProfile[]> {
  const res = await apiFetch("/admin/users");
  return res.json() as Promise<UserProfile[]>;
}

export async function createAdminInvitation(req: CreateInvitationRequest): Promise<Invitation> {
  const res = await apiFetch("/admin/invitations", {
    method: "POST",
    body: JSON.stringify(req)
  });
  return res.json() as Promise<Invitation>;
}

export async function updateUserRole(
  personId: string,
  req: UpdateUserRoleRequest
): Promise<UserProfile> {
  const res = await apiFetch(`/admin/users/${personId}/role`, {
    method: "PUT",
    body: JSON.stringify(req)
  });
  return res.json() as Promise<UserProfile>;
}

export async function updateUserStatus(
  personId: string,
  req: UpdateUserStatusRequest
): Promise<UserProfile> {
  const res = await apiFetch(`/admin/users/${personId}/status`, {
    method: "PUT",
    body: JSON.stringify(req)
  });
  return res.json() as Promise<UserProfile>;
}
