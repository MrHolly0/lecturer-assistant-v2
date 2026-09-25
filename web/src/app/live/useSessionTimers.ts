import { useEffect, useMemo, useState } from "react";
import type { LiveSession } from "../api/live-api";

export function useSessionTimers(session?: LiveSession | null) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = session?.status === "LIVE";

  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.timingCalculatedAt, ticking]);

  return useMemo(() => {
    if (!session) return { elapsed: 0, slideElapsed: 0 };
    const calculatedAt = Date.parse(session.timingCalculatedAt);
    const delta =
      ticking && Number.isFinite(calculatedAt)
        ? Math.max(0, Math.floor((now - calculatedAt) / 1000))
        : 0;
    return {
      elapsed: session.activeDurationSeconds + delta,
      slideElapsed: session.currentSlideDurationSeconds + delta
    };
  }, [now, session, ticking]);
}

export function formatSessionTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}
