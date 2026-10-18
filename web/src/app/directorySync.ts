import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const DIRECTORY_CHANGED = "lecturer-assistant:directory-changed";

/** No account data is broadcast; other tabs only learn to re-read their own directory. */
export function announceDirectoryChange(): void {
  window.dispatchEvent(new Event(DIRECTORY_CHANGED));
  try {
    localStorage.setItem(DIRECTORY_CHANGED, `${Date.now()}:${Math.random()}`);
  } catch {
    // Periodic verification also works across devices and private browser contexts.
  }
}

/** Refresh visible directories after registrations made in another tab or device. */
export function useDirectorySync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === DIRECTORY_CHANGED) refresh();
    };
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener(DIRECTORY_CHANGED, refresh);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(DIRECTORY_CHANGED, refresh);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [queryClient]);
}
