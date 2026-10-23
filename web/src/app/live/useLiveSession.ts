import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/errors";
import { readRetryDelay, retryDelayMs, shouldRetryRead } from "../api/retry";
import { createSnapshotInvalidationReader } from "./snapshotInvalidation";
import {
  connectLiveSession,
  getLiveSession,
  type LiveConnectionState,
  type LiveSession
} from "../api/live-api";

/** One server-backed session snapshot shared by the desktop presenter and mobile remote. */
export function useLiveSession(courseId: string, sessionId: string) {
  const queryClient = useQueryClient();
  const snapshotRef = useRef<LiveSession | null>(null);
  const scope = `${courseId}/${sessionId}`;
  const scopeRef = useRef(scope);
  const generationRef = useRef(0);
  const refreshRef = useRef<(blocking?: boolean) => Promise<boolean>>(() => Promise.resolve(false));
  const transportRef = useRef<LiveConnectionState>("connecting");
  const httpConfirmedAt = useRef(0);
  const readFailures = useRef(0);
  const nextReadAt = useRef(0);
  const pollingSpread = useRef(Math.random());
  const [, tickFreshness] = useState(0);
  const [snapshot, setSnapshot] = useState<LiveSession | null>(null);
  const [connection, setConnection] = useState<LiveConnectionState>("connecting");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [syncing, setSyncing] = useState(true);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    snapshotRef.current = null;
    httpConfirmedAt.current = 0;
    readFailures.current = 0;
    nextReadAt.current = 0;
    generationRef.current += 1;
  }
  const versionOf = (value: LiveSession | null) => value?.version;

  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    meta: { connectionSync: true },
    queryFn: async ({ signal }) => {
      const generation = generationRef.current;
      const requestScope = scopeRef.current;
      let fresh: LiveSession;
      try {
        fresh = await getLiveSession(courseId, sessionId, signal);
      } catch (error) {
        if (!signal.aborted && scopeRef.current === requestScope) {
          readFailures.current += 1;
          nextReadAt.current =
            Date.now() +
            retryDelayMs(readFailures.current - 1, { baseMs: 10000, maxMs: 60000, error });
        }
        throw error;
      }
      if (scopeRef.current !== requestScope) return fresh;
      readFailures.current = 0;
      nextReadAt.current = 0;
      httpConfirmedAt.current = Date.now();
      const current = snapshotRef.current;
      if (
        (generation !== generationRef.current && current) ||
        (current &&
          versionOf(current) !== undefined &&
          versionOf(fresh) !== undefined &&
          versionOf(fresh)! < versionOf(current)!)
      ) {
        setSyncing(false);
        setSyncError(false);
        return snapshotRef.current;
      }
      snapshotRef.current = fresh;
      setSnapshot(fresh);
      setSyncedAt(new Date());
      setSyncError(false);
      setSyncing(false);
      return fresh;
    },
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
    refetchInterval: () =>
      readFailures.current > 0
        ? Math.max(5000, nextReadAt.current - Date.now())
        : connection === "connected"
          ? 30000 + Math.floor(pollingSpread.current * 6000)
          : 5000 + Math.floor(pollingSpread.current * 1000),
    refetchOnWindowFocus: false
  });
  const { refetch } = sessionQuery;

  const acceptSnapshot = useCallback(
    (next: LiveSession) => {
      if (next.id !== sessionId) return;
      const current = snapshotRef.current;
      const currentVersion = versionOf(current);
      const nextVersion = versionOf(next);
      if (
        current &&
        currentVersion !== undefined &&
        nextVersion !== undefined &&
        nextVersion < currentVersion
      ) {
        return;
      }
      generationRef.current += 1;
      snapshotRef.current = next;
      setSnapshot(next);
      queryClient.setQueryData(["live", courseId, sessionId], next);
      setSyncedAt(new Date());
      setSyncError(false);
      setSyncing(false);
    },
    [courseId, queryClient, sessionId]
  );

  const refreshAuthoritative = useCallback(
    async (blocking = true) => {
      if (Date.now() < nextReadAt.current) return false;
      if (blocking) {
        setSyncing(true);
        setSyncError(false);
      }
      try {
        const result = await refetch({ cancelRefetch: false });
        if (result.error) throw result.error;
        return true;
      } catch (error) {
        if (
          blocking ||
          transportRef.current !== "connected" ||
          (error instanceof ApiError && [401, 403, 404].includes(error.status))
        )
          setSyncError(true);
        setSyncing(false);
        return false;
      }
    },
    [refetch]
  );
  refreshRef.current = refreshAuthoritative;

  useEffect(() => {
    const id = snapshot?.id;
    if (!id) return undefined;
    const invalidations = createSnapshotInvalidationReader(
      () => refreshRef.current(false),
      () => snapshotRef.current?.version
    );
    const disconnect = connectLiveSession(
      id,
      (message) => {
        // The server publishes committed revisions. Apply them immediately; equal
        // revisions can still carry fresher durations and engagement events.
        let eventType = message.type;
        if ("session" in message) {
          acceptSnapshot(message.session);
        } else {
          if (message.sessionId !== id || message.type !== "session.invalidate") return;
          eventType = message.eventType;
          invalidations.invalidate(message.version);
        }
        if (eventType.startsWith("interaction.poll")) {
          void queryClient.invalidateQueries({ queryKey: ["poll", courseId, sessionId] });
        }
        if (eventType.startsWith("participant.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "participants"]
          });
        }
        if (eventType.startsWith("feedback.") || eventType.startsWith("qa.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "engagement"]
          });
        }
        if (eventType.startsWith("qa.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "questions"]
          });
        }
      },
      (state) => {
        const previous = transportRef.current;
        transportRef.current = state;
        setConnection(state);
        if (state === "offline" || (previous === "connected" && state === "reconnecting")) {
          setSyncing(true);
          if (state !== "offline") void refreshRef.current(false);
        }
        if (state === "connected") {
          void refreshRef.current(false);
          void queryClient.invalidateQueries({ queryKey: ["poll", courseId, sessionId] });
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "participants"]
          });
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "engagement"]
          });
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "questions"]
          });
        }
      }
    );
    return () => {
      invalidations.dispose();
      disconnect();
    };
  }, [acceptSnapshot, courseId, queryClient, sessionId, snapshot?.id]);

  useEffect(() => {
    let lastResume = 0;
    const refreshWhenVisible = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || now - lastResume < 1000) return;
      lastResume = now;
      void refreshRef.current(false);
    };
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (sessionQuery.isError) {
      const error = sessionQuery.error;
      if (
        transportRef.current !== "connected" ||
        (error instanceof ApiError && [401, 403, 404].includes(error.status))
      )
        setSyncError(true);
      setSyncing(false);
    }
  }, [sessionQuery.isError, sessionQuery.error]);

  useEffect(() => {
    if (connection === "connected") return;
    const timer = window.setInterval(() => tickFreshness((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [connection]);

  const effectiveConnection: LiveConnectionState =
    connection !== "connected" &&
    connection !== "offline" &&
    httpConfirmedAt.current > 0 &&
    Date.now() - httpConfirmedAt.current <= 15000 &&
    !syncing &&
    !syncError
      ? "polling"
      : connection;
  const getSnapshot = () => snapshotRef.current;
  const commandsBlocked =
    snapshot?.id !== sessionId ||
    syncing ||
    syncError ||
    !["connected", "polling"].includes(effectiveConnection);

  return {
    session: (snapshot?.id === sessionId ? snapshot : null) ?? sessionQuery.data ?? null,
    setSession: acceptSnapshot,
    getSnapshot,
    connection: effectiveConnection,
    commandsBlocked,
    syncedAt,
    syncError,
    syncing,
    refresh: () => refreshAuthoritative(),
    isLoading: sessionQuery.isLoading
  };
}
