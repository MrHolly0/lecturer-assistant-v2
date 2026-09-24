import type { components } from "./schema";
import { apiFetch } from "./http";
import { clearStoredAuth, getStoredAuth, setStoredAuth } from "../auth";
import { refreshAuthSession } from "./refresh";

type AuthResponse = components["schemas"]["AuthResponse"];
export type MaxAuthResponse = components["schemas"]["MaxAuthResponse"];
type UserProfile = components["schemas"]["UserProfile"];
type MaxAuthRequest = components["schemas"]["MaxAuthRequest"] & { linkCode?: string };

export interface MaxLoginResult {
  auth: MaxAuthResponse;
  user: UserProfile;
}

let maxLoginInFlight: Promise<MaxLoginResult> | null = null;

export async function bootstrapAdmin(
  displayName: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await apiFetch("/auth/bootstrap-admin", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password }),
    skipAuthorization: true,
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
    skipAuthorization: true,
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
    skipAuthorization: true,
    skipAuthRefresh: true
  });
  const data: AuthResponse = await res.json();
  setStoredAuth({ accessToken: data.accessToken });
  return data;
}

export async function refreshAuth(): Promise<AuthResponse | null> {
  return refreshAuthSession();
}

export function loginWithMax(initData: string, linkCode?: string): Promise<MaxLoginResult> {
  if (maxLoginInFlight) return maxLoginInFlight;
  maxLoginInFlight = performMaxLogin(initData, linkCode).finally(() => {
    maxLoginInFlight = null;
  });
  return maxLoginInFlight;
}

async function performMaxLogin(initData: string, linkCode?: string): Promise<MaxLoginResult> {
  clearStoredAuth();
  try {
    const request: MaxAuthRequest = { initData };
    if (linkCode) request.linkCode = linkCode;
    const res = await apiFetch("/auth/max", {
      method: "POST",
      body: JSON.stringify(request),
      skipAuthorization: true,
      skipAuthRefresh: true
    });
    const auth = (await res.json()) as MaxAuthResponse;
    setStoredAuth({ accessToken: auth.accessToken });
    const user = await getCurrentUser();
    return { auth, user };
  } catch (error) {
    clearStoredAuth();
    throw error;
  }
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
