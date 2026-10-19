import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { CirclePause, CircleStop } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  connectStudentSession,
  getPublicStudentSession,
  type StudentConnectionState,
  type StudentSessionSnapshot
} from "../app/api/student-api";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { BrandMark } from "../shared/brand/BrandMark";
import { SessionGroups } from "../widgets/SessionGroups";
import { Button } from "../shared/ui/button";
import { ScreenShareViewer } from "../widgets/ScreenShareViewer";

/** Экран показа использует только доступное студентам состояние лекции. */
export function ProjectionPage({ joinCode }: { joinCode: string }) {
  const slideImageRef = useRef<HTMLImageElement>(null);
  const code = joinCode.trim().toUpperCase();
  const [query] = useSearchParams();
  const localChannelId = query.get("attempt") ?? query.get("shareAttempt");
  const projectionViewToken = query.get("projectionViewToken") ?? undefined;
  const [connectionState, setConnectionState] = useState<StudentConnectionState>("CONNECTING");
  const [liveSnapshot, setLiveSnapshot] = useState<StudentSessionSnapshot | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["projection", code],
    queryFn: () => getPublicStudentSession(code),
    enabled: Boolean(code),
    retry: 1
  });
  const { refetch } = sessionQuery;
  const session = liveSnapshot ?? sessionQuery.data;
  const joinUrl = useMemo(() => buildMaxJoinUrl(code), [code]);
  const showJoinCode = Boolean(session?.showJoinCode);

  useEffect(() => {
    setLiveSnapshot(null);
    if (!code) return;
    const connection = connectStudentSession(code, "", setLiveSnapshot, setConnectionState);
    return () => connection.disconnect();
  }, [code]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refetch]);

  useEffect(() => {
    if (session?.status !== "ENDED" && session?.status !== "ARCHIVED") return;
    if (!window.opener) return;
    const timer = window.setTimeout(() => window.close(), 350);
    return () => window.clearTimeout(timer);
  }, [session?.status]);

  if (sessionQuery.isError && !session) {
    return (
      <main className="projection-shell projection-fallback">
        <h1>Не удалось открыть проектор</h1>
        <p>Проверьте ссылку и подключение к сети.</p>
        <Button type="button" onClick={() => void sessionQuery.refetch()}>
          Повторить
        </Button>
      </main>
    );
  }
  if (session?.status === "ENDED" || session?.status === "ARCHIVED") {
    return (
      <main className="projection-shell projection-fallback">
        <CircleStop size={48} aria-hidden="true" />
        <h1>Лекция завершена</h1>
        <p>Экран показа можно закрыть.</p>
      </main>
    );
  }
  if (!session) {
    return <main className="projection-shell">Загрузка показа…</main>;
  }

  return (
    <main className="projection-shell">
      <ScreenShareViewer
        joinCode={code}
        local={!projectionViewToken}
        projectionViewToken={projectionViewToken}
        localChannelId={localChannelId}
        paused={session.status === "PAUSED"}
      >
        {showJoinCode || session.status === "SCHEDULED" ? (
          <section
            className="projection-code projection-code--live"
            aria-label="Код подключения к занятию"
          >
            <div className="projection-brand">
              <BrandMark />
              <span>Lecturer Assistant</span>
            </div>
            <h1>Подключитесь к занятию</h1>
            <div className="projection-join-row">
              <div className="projection-join-code">
                <span>Код занятия</span>
                <strong>{session.joinCode}</strong>
                <p>Введите код или откройте занятие в MAX</p>
              </div>
              {joinUrl ? (
                <LocalQrCode value={joinUrl} label="Открыть занятие в MAX" />
              ) : (
                <p className="muted">MAX-бот не настроен. Введите код занятия.</p>
              )}
            </div>
            <div className="projection-context">
              <h2>{session.courseTitle}</h2>
              <p>{session.lectureTitle}</p>
              <SessionGroups groups={session.groups} compact />
            </div>
          </section>
        ) : (
          <>
            {session.currentSlide ? (
              <img
                ref={slideImageRef}
                src={session.currentSlide.imageUrl}
                alt={`Слайд ${session.currentSlideIdx}`}
              />
            ) : (
              <p>Ожидаем слайд</p>
            )}
            <DrawingOverlay
              imageRef={slideImageRef}
              slideIdx={session.currentSlideIdx}
              annotations={session.annotations as LiveAnnotations}
              active={false}
              onChange={() => undefined}
            />
          </>
        )}
      </ScreenShareViewer>
      {session.status === "PAUSED" && (
        <div className="projection-pause-banner" role="status">
          <CirclePause size={24} aria-hidden="true" />
          Показ приостановлен
        </div>
      )}
      {(connectionState === "OFFLINE" || connectionState === "RECONNECTING") && (
        <div className="projection-sync-warning" role="status">
          Связь потеряна. На экране последнее подтверждённое состояние.
        </div>
      )}
    </main>
  );
}
