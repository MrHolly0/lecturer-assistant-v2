import type { components } from "./schema";
import { setStoredAuth } from "../auth";

export type RefreshedAuth = components["schemas"]["AuthResponse"];

/** A refresh could not be completed; the current session has not been rejected. */
export class RefreshUnavailableError extends Error {
  constructor(message = "Authentication refresh is temporarily unavailable") {
    super(message);
    this.name = "RefreshUnavailableError";
  }
}

/** The refresh was superseded by sign-out or another account transition. */
export class RefreshSupersededError extends Error {
  constructor() {
    super("Authentication refresh was superseded by a session change");
    this.name = "RefreshSupersededError";
  }
}

/** The cookie belongs to a different app account than the MAX resume hint. */
export class RefreshIdentityMismatchError extends Error {
  constructor() {
    super("The refreshed session belongs to a different account");
    this.name = "RefreshIdentityMismatchError";
  }
}

let refreshGeneration = 0;
let refreshInFlight: {
  expectedUserId: string | null;
  promise: Promise<RefreshedAuth | null>;
} | null = null;

/** Prevent an older refresh response from restoring auth after sign-out/account switch. */
export function invalidatePendingAuthRefresh(): void {
  refreshGeneration += 1;
  refreshInFlight = null;
}

/** Keep a pending MAX login from restoring auth after a newer user choice. */
export function captureAuthTransition(): () => void {
  const generation = refreshGeneration;
  return () => {
    if (generation !== refreshGeneration) throw new RefreshSupersededError();
  };
}

export function refreshAuthSession(
  options: { expectedUserId?: string } = {}
): Promise<RefreshedAuth | null> {
  const expectedUserId = options.expectedUserId ?? null;
  if (refreshInFlight) {
    if (expectedUserId === null || refreshInFlight.expectedUserId === expectedUserId) {
      return refreshInFlight.promise;
    }
    // Do not let a refresh started for another MAX/account identity install a token.
    invalidatePendingAuthRefresh();
  }

  const generation = refreshGeneration;
  // Refresh cookies are shared by tabs, access tokens are kept per tab. Serialize
  // rotation across the origin so two open cabinets cannot consume the same cookie.
  const refresh = async () => {
    if (navigator.locks) {
      return navigator.locks.request("lecturer-assistant:refresh", () => {
        if (generation !== refreshGeneration) throw new RefreshSupersededError();
        return performRefresh(generation, expectedUserId);
      });
    }
    return performRefresh(generation, expectedUserId);
  };
  const tracked = refresh().finally(() => {
    if (refreshInFlight?.promise === tracked) refreshInFlight = null;
  });
  refreshInFlight = { expectedUserId, promise: tracked };
  return tracked;
}

async function performRefresh(
  generation: number,
  expectedUserId: string | null
): Promise<RefreshedAuth | null> {
  if (generation !== refreshGeneration) throw new RefreshSupersededError();
  let response: Response;
  try {
    response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json" }
    });
  } catch {
    if (generation !== refreshGeneration) throw new RefreshSupersededError();
    throw new RefreshUnavailableError("Authentication refresh request failed");
  }

  if (generation !== refreshGeneration) throw new RefreshSupersededError();
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new RefreshUnavailableError(`Authentication refresh returned HTTP ${response.status}`);
  }

  let data: RefreshedAuth;
  try {
    data = (await response.json()) as RefreshedAuth;
  } catch {
    throw new RefreshUnavailableError("Authentication refresh returned invalid JSON");
  }
  if (
    !data ||
    typeof data.accessToken !== "string" ||
    data.accessToken.length === 0 ||
    !data.user ||
    (typeof data.user.id !== "string" && typeof data.user.id !== "number")
  ) {
    throw new RefreshUnavailableError("Authentication refresh returned an incomplete response");
  }

  if (expectedUserId && String(data.user.id) !== expectedUserId) {
    throw new RefreshIdentityMismatchError();
  }

  if (generation !== refreshGeneration) throw new RefreshSupersededError();
  try {
    setStoredAuth({ accessToken: data.accessToken });
  } catch {
    throw new RefreshUnavailableError("Could not persist the refreshed access token");
  }
  if (generation !== refreshGeneration) throw new RefreshSupersededError();
  window.dispatchEvent(
    new CustomEvent("auth:refreshed", {
      detail: { accessToken: data.accessToken, user: data.user }
    })
  );
  return data;
}
