import type { components } from "./schema";
import { setStoredAuth } from "../auth";

export type RefreshedAuth = components["schemas"]["AuthResponse"];

let refreshInFlight: Promise<RefreshedAuth | null> | null = null;

export function refreshAuthSession(): Promise<RefreshedAuth | null> {
  if (refreshInFlight) return refreshInFlight;

  // Refresh cookies are shared by tabs, access tokens are kept per tab. Serialize
  // rotation across the origin so two open cabinets cannot consume the same cookie.
  const refresh = async () =>
    navigator.locks
      ? await navigator.locks.request("lecturer-assistant:refresh", performRefresh)
      : await performRefresh();
  refreshInFlight = refresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(): Promise<RefreshedAuth | null> {
  try {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;

    const data = (await response.json()) as RefreshedAuth;
    if (!data.accessToken) return null;

    setStoredAuth({ accessToken: data.accessToken });
    window.dispatchEvent(
      new CustomEvent("auth:refreshed", {
        detail: { accessToken: data.accessToken, user: data.user }
      })
    );
    return data;
  } catch {
    return null;
  }
}
