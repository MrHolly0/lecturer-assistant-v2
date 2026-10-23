const KEY = "la_auth";

export interface StoredAuth {
  accessToken: string;
  refreshMode?: "max";
  accountId?: string;
}

export function getStoredAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  sessionStorage.setItem(KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
  sessionStorage.removeItem(KEY);
}

export function expireStoredAuth(): void {
  const rejected = getStoredAuth();
  if (!rejected) return;
  clearStoredAuth();
  window.dispatchEvent(
    new CustomEvent("auth:expired", { detail: { refreshMode: rejected.refreshMode } })
  );
}
