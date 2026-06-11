import type { components } from "./schema";
import { apiFetch } from "./http";

type UserProfile = components["schemas"]["UserProfile"];
type CreateInvitationRequest = components["schemas"]["CreateInvitationRequest"];
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
