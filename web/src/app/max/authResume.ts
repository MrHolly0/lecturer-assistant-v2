const RESUME_PREFIX = "la_max_resume_v1:";
const SIGNED_OUT_PREFIX = "la_max_signed_out_v1:";
const SIGNED_OUT_SESSION_PREFIX = "la_max_signed_out:";
const LEGACY_SIGNED_OUT_KEY = "la_max_signed_out";
const LEGACY_IDENTITY_KEY = "la_max_signed_out_identity";

export type MaxResumeMode = "max" | "password";

export interface MaxResumeRecord {
  accountId: string;
  mode: MaxResumeMode;
}

/**
 * Extracts a stable MAX account hint from signed initData. This value is only
 * used to scope local resume hints; the server must still verify initData.
 */
export function maxIdentityFromInitData(initData: string | null | undefined): string | null {
  if (!initData) return null;
  try {
    const rawUser = new URLSearchParams(initData).get("user");
    if (!rawUser) return null;
    const user = JSON.parse(rawUser) as { id?: string | number };
    const identity = user.id == null ? "" : String(user.id);
    return /^[A-Za-z0-9_-]{1,100}$/.test(identity) ? identity : null;
  } catch {
    return null;
  }
}

export function readMaxResume(initData: string | null | undefined): MaxResumeRecord | null {
  const identity = maxIdentityFromInitData(initData);
  if (!identity) return null;
  try {
    const raw = localStorage.getItem(`${RESUME_PREFIX}${identity}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MaxResumeRecord>;
    if (
      typeof value.accountId !== "string" ||
      !value.accountId ||
      (value.mode !== "max" && value.mode !== "password")
    ) {
      return null;
    }
    return { accountId: value.accountId, mode: value.mode };
  } catch {
    return null;
  }
}

export function writeMaxResume(
  initData: string | null | undefined,
  accountId: string,
  mode: MaxResumeMode
): void {
  const identity = maxIdentityFromInitData(initData);
  if (!identity || !accountId) return;
  try {
    localStorage.setItem(
      `${RESUME_PREFIX}${identity}`,
      JSON.stringify({ accountId, mode } satisfies MaxResumeRecord)
    );
  } catch {
    // The current WebView session can still be used without a cold-resume hint.
  }
}

export function clearMaxResume(initData: string | null | undefined): void {
  const identity = maxIdentityFromInitData(initData);
  if (!identity) return;
  try {
    localStorage.removeItem(`${RESUME_PREFIX}${identity}`);
  } catch {
    // Ignore unavailable storage.
  }
}

export function readMaxSignedOut(initData: string | null | undefined): boolean {
  const identity = maxIdentityFromInitData(initData);
  try {
    if (identity && localStorage.getItem(`${SIGNED_OUT_PREFIX}${identity}`) === "true") {
      return true;
    }
    if (identity && sessionStorage.getItem(`${SIGNED_OUT_SESSION_PREFIX}${identity}`) === "true") {
      return true;
    }
    if (sessionStorage.getItem(LEGACY_SIGNED_OUT_KEY) !== "true") return false;
    const legacyIdentity = sessionStorage.getItem(LEGACY_IDENTITY_KEY);
    return !identity || !legacyIdentity || legacyIdentity === identity;
  } catch {
    return false;
  }
}

export function setMaxSignedOut(initData: string | null | undefined, signedOut: boolean): void {
  const identity = maxIdentityFromInitData(initData);
  try {
    if (identity) {
      const localKey = `${SIGNED_OUT_PREFIX}${identity}`;
      const sessionKey = `${SIGNED_OUT_SESSION_PREFIX}${identity}`;
      if (signedOut) {
        localStorage.setItem(localKey, "true");
        sessionStorage.setItem(sessionKey, "true");
        sessionStorage.setItem(LEGACY_SIGNED_OUT_KEY, "true");
        sessionStorage.setItem(LEGACY_IDENTITY_KEY, identity);
      } else {
        localStorage.removeItem(localKey);
        sessionStorage.removeItem(sessionKey);
        if (sessionStorage.getItem(LEGACY_IDENTITY_KEY) === identity) {
          sessionStorage.removeItem(LEGACY_SIGNED_OUT_KEY);
          sessionStorage.removeItem(LEGACY_IDENTITY_KEY);
        }
      }
    } else if (signedOut) {
      sessionStorage.setItem(LEGACY_SIGNED_OUT_KEY, "true");
      sessionStorage.removeItem(LEGACY_IDENTITY_KEY);
    } else {
      sessionStorage.removeItem(LEGACY_SIGNED_OUT_KEY);
      sessionStorage.removeItem(LEGACY_IDENTITY_KEY);
    }
  } catch {
    // In-memory auth state still enforces sign-out for this WebView.
  }
}

/** Clear only the legacy unscoped marker when a different MAX identity arrives. */
export function clearLegacyMaxSignedOut(): void {
  try {
    sessionStorage.removeItem(LEGACY_SIGNED_OUT_KEY);
    sessionStorage.removeItem(LEGACY_IDENTITY_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
