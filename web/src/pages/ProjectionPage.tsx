import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, CirclePause, CircleStop } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import {
  changeLiveSessionSlide,
  connectLiveSession,
  getLiveSession,
  type LiveSession
} from "../app/api/live-api";
import { userErrorMessage } from "../app/api/errors";
import { useMaxBridge } from "../app/max/context";
import { isMobileMax, teacherRemotePath } from "../app/max/navigation";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button } from "../shared/ui/button";
import { SessionGroups } from "../widgets/SessionGroups";

export function ProjectionPage({ courseId, sessionId }: { courseId: string; sessionId: string }) {
  const navigate = useNavigate();
  const maxEnvironment = useMaxBridge();
  const [localSession, setLocalSession] = useState<LiveSession | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const session = localSession ?? sessionQuery.data;
  const liveSessionId = session?.id;
  const deckQuery = useQuery({
    queryKey: ["content", courseId, "decks", session?.deckId],
    queryFn: () => getDeck(courseId, session?.deckId ?? ""),
    enabled: Boolean(session?.deckId)
  });
  const deck = deckQuery.data;
  const slide =
    deck?.slides.find((item) => item.idx === session?.currentSlideIdx) ?? deck?.slides[0];
  const showJoinCode = slide?.idx === 1;
  const joinUrl = useMemo(() => buildMaxJoinUrl(session?.joinCode ?? ""), [session?.joinCode]);
  const presenterPath = isMobileMax(maxEnvironment)
    ? teacherRemotePath(courseId, sessionId)
    : `/courses/${courseId}/sessions/${sessionId}/presenter`;
  const slideMutation = useMutation({
    mutationFn: (index: number) => changeLiveSessionSlide(courseId, sessionId, index),
    onSuccess: setLocalSession,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось переключить слайд."))
  });

  useEffect(() => {
    if (sessionQuery.data) setLocalSession(sessionQuery.data);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!liveSessionId) return;
    const channel = new BroadcastChannel(`session-${liveSessionId}`);
    channel.onmessage = (event) => setLocalSession(event.data as LiveSession);
    const disconnect = connectLiveSession(liveSessionId, (message) =>
      setLocalSession(message.session)
    );
    return () => {
      disconnect();
      channel.close();
    };
  }, [liveSessionId]);

  useEffect(() => {
    if (session?.status !== "ENDED" && session?.status !== "ARCHIVED") return;
    const timer = window.setTimeout(() => {
      if (window.opener) window.close();
      else navigate(`/courses/${courseId}/sessions/${sessionId}/summary`, { replace: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [courseId, navigate, session?.status, sessionId]);

  if (session?.status === "ENDED" || session?.status === "ARCHIVED") {
    return (
      <main className="projection-shell projection-fallback">
        <CircleStop size={48} aria-hidden="true" />
        <h1>Лекция завершена</h1>
        <p>Итог занятия доступен в кабинете.</p>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            window.opener
              ? window.close()
              : navigate(`/courses/${courseId}/sessions/${sessionId}/summary`)
          }
        >
          Открыть итог
        </Button>
      </main>
    );
  }

  if (!session || !deck || !slide) {
    return <div className="projection-shell">Загрузка...</div>;
  }

  return (
    <main className="projection-shell">
      <img src={slideImageUrl(slide)} alt={`Слайд ${slide.idx}`} />
      <DrawingOverlay
        slideIdx={slide.idx}
        annotations={session.annotations as LiveAnnotations}
        active={false}
        onChange={() => undefined}
      />
      {session.status === "PAUSED" && (
        <div className="projection-pause-banner" role="status">
          <CirclePause size={24} aria-hidden="true" />
          Показ приостановлен
        </div>
      )}
      {showJoinCode && (
        <div className="projection-code">
          <span>Код подключения</span>
          <strong>{session.joinCode}</strong>
          <SessionGroups groups={session.groups} compact />
          {joinUrl ? (
            <div className="projection-qr-lockup">
              <div className="projection-brand">
                <BrandMark />
                <span>Lecturer Assistant</span>
              </div>
              <LocalQrCode value={joinUrl} label="Открыть лекцию в MAX" />
            </div>
          ) : (
            <small>MAX-бот не настроен</small>
          )}
        </div>
      )}
      {maxEnvironment.isMax && (
        <nav className="projection-controls" aria-label="Управление проектором">
          <Button type="button" variant="outline" onClick={() => navigate(presenterPath)}>
            <ArrowLeft size={18} aria-hidden="true" /> К лекции
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="Предыдущий слайд"
            disabled={session.status === "PAUSED" || slideMutation.isPending || slide.idx <= 1}
            onClick={() => slideMutation.mutate(slide.idx - 1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </Button>
          <span>
            {slide.idx} / {deck.slides.length}
          </span>
          <Button
            type="button"
            variant="outline"
            aria-label="Следующий слайд"
            disabled={
              session.status === "PAUSED" ||
              slideMutation.isPending ||
              slide.idx >= deck.slides.length
            }
            onClick={() => slideMutation.mutate(slide.idx + 1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </Button>
        </nav>
      )}
    </main>
  );
}
