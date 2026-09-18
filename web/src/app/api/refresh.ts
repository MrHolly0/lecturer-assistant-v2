import type { components } from "./schema";
import { setStoredAuth } from "../auth";

export type RefreshedAuth = components["schemas"]["AuthResponse"];

let refreshInFlight: Promise<RefreshedAuth | null> | null = null;

export function refreshAuthSession(): Promise<RefreshedAuth | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(): Promise<RefreshedAuth | null> {
  try {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;

    const data = (await response.json()) as RefreshedAuth;
    if (!data.accessToken) return null;

    setStoredAuth({ accessToken: data.accessToken });
    window.dispatchEvent(
      new CustomEvent("auth:refreshed", { detail: { accessToken: data.accessToken } })
    );
    return data;
  } catch {
    return null;
  }
}
