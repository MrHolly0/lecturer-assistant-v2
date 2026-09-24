import { apiFetch } from "./http";

export interface MaxLinkCode {
  code: string;
  expiresAt: string;
}

export async function createMaxLinkCode(): Promise<MaxLinkCode> {
  const response = await apiFetch("/identity/max/link-codes", { method: "POST" });
  return response.json() as Promise<MaxLinkCode>;
}
