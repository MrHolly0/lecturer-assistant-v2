import type { components } from "./schema";
import { apiFetch } from "./http";

type UserProfile = components["schemas"]["UserProfile"];
type CreateInvitationRequest = components["schemas"]["CreateInvitationRequest"];
type UpdateUserRoleRequest = components["schemas"]["UpdateUserRoleRequest"];
type UpdateUserStatusRequest = components["schemas"]["UpdateUserStatusRequest"];
type Invitation = components["schemas"]["Invitation"];
export type UserPage = components["schemas"]["UserPage"];

export async function getUserPage(options: {
  q?: string;
  role?: UserProfile["role"];
  status?: "ACTIVE" | "DISABLED";
  limit: number;
  offset: number;
}): Promise<UserPage> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    offset: String(options.offset)
  });
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.role) params.set("role", options.role);
  if (options.status) params.set("status", options.status);
  const response = await apiFetch(`/admin/users/page?${params}`);
  return response.json() as Promise<UserPage>;
}

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
