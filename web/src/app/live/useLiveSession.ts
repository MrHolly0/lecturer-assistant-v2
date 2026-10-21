import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/errors";
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
  const refreshRef = useRef<(blocking?: boolean) => Promise<void>>(() => Promise.resolve());
  const transportRef = useRef<LiveConnectionState>("connecting");
  const httpConfirmedAt = useRef(0);
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
    generationRef.current += 1;
  }
  const versionOf = (value: LiveSession | null) => value?.version;

  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    meta: { connectionSync: true },
    queryFn: async () => {
      const generation = generationRef.current;
      const requestScope = scopeRef.current;
      const fresh = await getLiveSession(courseId, sessionId);
      if (scopeRef.current !== requestScope) return fresh;
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
    retry: 1,
    refetchInterval: connection === "connected" ? 30000 : 5000,
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
      if (blocking) {
        setSyncing(true);
        setSyncError(false);
      }
      try {
        const result = await refetch({ cancelRefetch: false });
        if (result.error) throw result.error;
      } catch (error) {
        if (
          blocking ||
          transportRef.current !== "connected" ||
          (error instanceof ApiError && [401, 403, 404].includes(error.status))
        )
          setSyncError(true);
        setSyncing(false);
      }
    },
    [refetch]
  );
  refreshRef.current = refreshAuthoritative;

  useEffect(() => {
    const id = snapshot?.id;
    if (!id) return undefined;
    const disconnect = connectLiveSession(
      id,
      (message) => {
        // The server publishes committed revisions. Apply them immediately; equal
        // revisions can still carry fresher durations and engagement events.
        acceptSnapshot(message.session);
        if (message.type.startsWith("interaction.poll")) {
          void queryClient.invalidateQueries({ queryKey: ["poll", courseId, sessionId] });
        }
        if (message.type.startsWith("participant.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "participants"]
          });
        }
        if (message.type.startsWith("feedback.") || message.type.startsWith("qa.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "engagement"]
          });
        }
        if (message.type.startsWith("qa.")) {
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
  const commandsBlocked =
    snapshot?.id !== sessionId ||
    syncing ||
    syncError ||
    !["connected", "polling"].includes(effectiveConnection);

  return {
    session: (snapshot?.id === sessionId ? snapshot : null) ?? sessionQuery.data ?? null,
    setSession: acceptSnapshot,
    connection: effectiveConnection,
    commandsBlocked,
    syncedAt,
    syncError,
    syncing,
    refresh: () => refreshAuthoritative(),
    isLoading: sessionQuery.isLoading
  };
}
