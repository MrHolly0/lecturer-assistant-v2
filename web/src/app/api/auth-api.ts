import type { components } from "./schema";
import { apiFetch } from "./http";
import { getStoredAuth, setStoredAuth } from "../auth";
import { refreshAuthSession } from "./refresh";

type AuthResponse = components["schemas"]["AuthResponse"];
type UserProfile = components["schemas"]["UserProfile"];

export async function bootstrapAdmin(
  displayName: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await apiFetch("/auth/bootstrap-admin", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password }),
    skipAuthRefresh: true
  });
  const data: AuthResponse = await res.json();
  setStoredAuth({ accessToken: data.accessToken });
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    skipAuthRefresh: true
  });
  const data: AuthResponse = await res.json();
  setStoredAuth({ accessToken: data.accessToken });
  return data;
}

export async function registerByInvitation(
  displayName: string,
  email: string,
  password: string,
  invitationCode: string
): Promise<AuthResponse> {
  const res = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password, invitationCode }),
    skipAuthRefresh: true
  });
  const data: AuthResponse = await res.json();
  setStoredAuth({ accessToken: data.accessToken });
  return data;
}

export async function refreshAuth(): Promise<AuthResponse | null> {
  return refreshAuthSession();
}

export async function logout(): Promise<void> {
  const auth = getStoredAuth();
  if (!auth) return;
  try {
    await apiFetch("/auth/logout", {
      method: "POST"
    });
  } catch {
    // best-effort
  }
}

export async function getCurrentUser(): Promise<UserProfile> {
  const res = await apiFetch("/auth/me");
  return res.json() as Promise<UserProfile>;
}
