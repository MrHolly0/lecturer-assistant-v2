import { apiFetch } from "./http";

export interface MaxLinkCode {
  code: string;
  expiresAt: string;
}

export async function createMaxLinkCode(): Promise<MaxLinkCode> {
  const response = await apiFetch("/identity/max/link-codes", { method: "POST" });
  return response.json() as Promise<MaxLinkCode>;
}

export async function getMaxIdentityStatus(): Promise<{ connected: boolean }> {
  const response = await apiFetch("/identity/max");
  return response.json() as Promise<{ connected: boolean }>;
}

export async function unlinkMaxIdentity(): Promise<void> {
  await apiFetch("/identity/max", { method: "DELETE" });
}
