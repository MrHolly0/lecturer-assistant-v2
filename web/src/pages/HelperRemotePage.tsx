import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import {
  getLiveSession,
  pauseLiveSession,
  resumeLiveSession,
  type LiveSession
} from "../app/api/live-api";
import { configureHelperContext, readHelperContext } from "../app/projection/helperContext";
import { nativeCommand } from "../app/projection/nativeWorkspace";
import { ScreenShareControls } from "../widgets/ScreenShareControls";
import { Button } from "../shared/ui/button";

export function HelperRemotePage() {
  const [context] = useState(() => {
    const value = readHelperContext(window.location.hash);
    if (value) configureHelperContext(value);
    return value;
  });
  const session = useQuery({
    queryKey: ["helper-session", context?.sessionId],
    queryFn: () => getLiveSession(context!.courseId, context!.sessionId),
    enabled: Boolean(context),
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    retry: false
  });
  const pause = useMutation({
    mutationFn: () =>
      session.data?.status === "PAUSED"
        ? resumeLiveSession(context!.courseId, context!.sessionId)
        : pauseLiveSession(context!.courseId, context!.sessionId),
    onError: () => toast.error("Не удалось изменить паузу. Проверьте связь и повторите."),
    onSuccess: () => {
      void session.refetch();
    }
  });
  const [ended, setEnded] = useState<LiveSession | null>(null);
  if (!context || session.isError || ended || session.data?.status === "ENDED")
    return (
      <div className="helper-remote-message" role="status">
        <h1>
          {ended || session.data?.status === "ENDED" ? "Занятие завершено" : "Пульт недоступен"}
        </h1>
        <p>
          {session.isError
            ? "Подключение прервано. Вернитесь к лекции и откройте проектор снова."
            : "Вернитесь к вкладке лекции для дальнейшей работы."}
        </p>
        <Button onClick={() => nativeCommand("close")}>Закрыть пульт</Button>
      </div>
    );
  if (!session.data) return <p className="helper-remote-message">Подключаем пульт…</p>;
  return (
    <MemoryRouter>
      <ScreenShareControls
        courseId={context.courseId}
        session={session.data}
        nativeWorkspace
        disabled={pause.isPending || session.isError}
        onPause={() => pause.mutate()}
        onResume={() => pause.mutate()}
        onSessionChange={(updated) => {
          if (updated.status === "ENDED") setEnded(updated);
          else void session.refetch();
        }}
      />
    </MemoryRouter>
  );
}
