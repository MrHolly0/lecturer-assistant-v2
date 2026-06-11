const KEY = 'la_auth';

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
}

export function getStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(KEY);
}
