import { apiFetch, withRequestDeadline } from "./http";

export interface MaxLinkCode {
  code: string;
  expiresAt: string;
}

export async function createMaxLinkCode(): Promise<MaxLinkCode> {
  const response = await apiFetch("/identity/max/link-codes", { method: "POST" });
  return response.json() as Promise<MaxLinkCode>;
}

export async function getMaxIdentityStatus(signal?: AbortSignal): Promise<{ connected: boolean }> {
  return withRequestDeadline(async (requestSignal) => {
    const response = await apiFetch("/identity/max", { signal: requestSignal });
    return response.json() as Promise<{ connected: boolean }>;
  }, signal);
}

export async function unlinkMaxIdentity(): Promise<void> {
  await apiFetch("/identity/max", { method: "DELETE" });
}
