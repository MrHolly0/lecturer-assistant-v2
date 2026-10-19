import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [snapshot, setSnapshot] = useState<LiveSession | null>(null);
  const [connection, setConnection] = useState<LiveConnectionState>("connecting");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [syncing, setSyncing] = useState(true);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    snapshotRef.current = null;
    generationRef.current += 1;
  }
  const versionOf = (value: LiveSession | null) => value?.version;

  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: async () => {
      const generation = generationRef.current;
      const requestScope = scopeRef.current;
      const fresh = await getLiveSession(courseId, sessionId);
      if (scopeRef.current !== requestScope) return fresh;
      const current = snapshotRef.current;
      if (
        (generation !== generationRef.current && current) ||
        (current &&
          versionOf(current) !== undefined &&
          versionOf(fresh) !== undefined &&
          versionOf(fresh)! < versionOf(current)!)
      ) {
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

  const refreshAuthoritative = useCallback(async () => {
    setSyncing(true);
    setSyncError(false);
    try {
      const result = await refetch();
      if (result.error) throw result.error;
    } catch {
      setSyncError(true);
      setSyncing(false);
    }
  }, [refetch]);
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
        setConnection(state);
        if (state === "connected") {
          void refreshRef.current();
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
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
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
      setSyncError(true);
      setSyncing(false);
    }
  }, [sessionQuery.isError]);

  return {
    session: (snapshot?.id === sessionId ? snapshot : null) ?? sessionQuery.data ?? null,
    setSession: acceptSnapshot,
    connection,
    syncedAt,
    syncError,
    syncing,
    refresh: refreshAuthoritative,
    isLoading: sessionQuery.isLoading
  };
}
