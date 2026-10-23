import type { components } from "./schema";
import { ApiError, apiFetch } from "./http";
import { clearStoredAuth, getStoredAuth, setStoredAuth } from "../auth";
import { captureAuthTransition, invalidatePendingAuthRefresh, refreshAuthSession } from "./refresh";
import { announceDirectoryChange } from "../directorySync";

type AuthResponse = components["schemas"]["AuthResponse"];
export type MaxAuthResponse = components["schemas"]["MaxAuthResponse"];
type UserProfile = components["schemas"]["UserProfile"];
type MaxAuthRequest = components["schemas"]["MaxAuthRequest"] & { linkCode?: string };
type ChangePasswordRequest = components["schemas"]["ChangePasswordRequest"];

export type MaxLinkPreview = components["schemas"]["MaxLinkPreview"];

export type MaxLinkPreviewRequest =
  | { initData: string; email: string; password: string; linkCode?: never }
  | { initData: string; linkCode: string; email?: never; password?: never };

export interface MaxLoginResult {
  auth: MaxAuthResponse;
  user: UserProfile;
}

let maxLoginInFlight: Promise<MaxLoginResult> | null = null;
let maxLoginKey: string | null = null;

export async function login(email: string, password: string): Promise<AuthResponse> {
  invalidatePendingAuthRefresh();
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
  invalidatePendingAuthRefresh();
  const res = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password, invitationCode }),
    skipAuthorization: true,
    skipAuthRefresh: true
  });
  const data: AuthResponse = await res.json();
  setStoredAuth({ accessToken: data.accessToken });
  announceDirectoryChange();
  return data;
}

export async function changePassword(request: ChangePasswordRequest): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export async function previewMaxLink(request: MaxLinkPreviewRequest): Promise<MaxLinkPreview> {
  const response = await apiFetch("/auth/max/link-preview", {
    method: "POST",
    body: JSON.stringify(request),
    skipAuthorization: true,
    skipAuthRefresh: true
  });
  return response.json() as Promise<MaxLinkPreview>;
}

export async function confirmMaxLink(
  initData: string,
  confirmationToken: string
): Promise<MaxLoginResult> {
  invalidatePendingAuthRefresh();
  const ensureCurrent = captureAuthTransition();
  clearStoredAuth();
  let issuedAccessToken: string | null = null;
  try {
    const response = await apiFetch("/auth/max/link-confirm", {
      method: "POST",
      body: JSON.stringify({ initData, confirmationToken }),
      skipAuthorization: true,
      skipAuthRefresh: true
    });
    const auth = (await response.json()) as MaxAuthResponse;
    ensureCurrent();
    issuedAccessToken = auth.accessToken;
    setStoredAuth({
      accessToken: auth.accessToken,
      refreshMode: "max",
      accountId: auth.personId
    });
    const user = await getCurrentUser({ skipAuthRefresh: true });
    ensureCurrent();
    return { auth, user };
  } catch (error) {
    if (issuedAccessToken && getStoredAuth()?.accessToken === issuedAccessToken) clearStoredAuth();
    throw error;
  }
}

export async function refreshAuth(): Promise<AuthResponse | null> {
  return refreshAuthSession();
}

export function loginWithMax(
  initData: string,
  linkCode?: string,
  startParam?: string,
  existingOnly = false
): Promise<MaxLoginResult> {
  const key = JSON.stringify([initData, linkCode, startParam, existingOnly]);
  if (maxLoginInFlight) {
    if (maxLoginKey === key) return maxLoginInFlight;
    const ensureCurrent = captureAuthTransition();
    return maxLoginInFlight
      .catch(() => undefined)
      .then(() => {
        ensureCurrent();
        return loginWithMax(initData, linkCode, startParam, existingOnly);
      });
  }
  maxLoginKey = key;
  maxLoginInFlight = performMaxLogin(initData, linkCode, startParam, existingOnly).finally(() => {
    maxLoginInFlight = null;
    maxLoginKey = null;
  });
  return maxLoginInFlight;
}

async function performMaxLogin(
  initData: string,
  linkCode?: string,
  startParam?: string,
  existingOnly = false
): Promise<MaxLoginResult> {
  invalidatePendingAuthRefresh();
  const ensureCurrent = captureAuthTransition();
  let issuedAccessToken: string | null = null;
  try {
    const request: MaxAuthRequest = { initData };
    if (linkCode) request.linkCode = linkCode;
    if (startParam) request.startParam = startParam;
    if (existingOnly) request.existingOnly = true;
    const res = await apiFetch("/auth/max", {
      method: "POST",
      body: JSON.stringify(request),
      skipAuthorization: true,
      skipAuthRefresh: true
    });
    const auth = (await res.json()) as MaxAuthResponse;
    ensureCurrent();
    issuedAccessToken = auth.accessToken;
    setStoredAuth({
      accessToken: auth.accessToken,
      refreshMode: "max",
      accountId: auth.personId
    });
    const user = await getCurrentUser({ skipAuthRefresh: true });
    ensureCurrent();
    return { auth, user };
  } catch (error) {
    if (
      issuedAccessToken &&
      getStoredAuth()?.accessToken === issuedAccessToken &&
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      clearStoredAuth();
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  const auth = getStoredAuth();
  if (!auth) return;
  try {
    await apiFetch("/auth/logout", {
      method: "POST",
      headers: auth.refreshMode === "max" ? { "X-Auth-Channel": "max" } : undefined
    });
  } catch {
    // best-effort
  } finally {
    invalidatePendingAuthRefresh();
  }
}

export async function getCurrentUser(
  options: { skipAuthRefresh?: boolean } = {}
): Promise<UserProfile> {
  const res = await apiFetch("/auth/me", { skipAuthRefresh: options.skipAuthRefresh });
  return res.json() as Promise<UserProfile>;
}
