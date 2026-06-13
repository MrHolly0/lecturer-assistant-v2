import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Monitor, Pause, Play, QrCode, Square } from "lucide-react";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import { getStudentEngagement } from "../app/api/student-api";
import {
  changeLiveSessionSlide,
  connectLiveSession,
  endLiveSession,
  getLiveSession,
  listSessionParticipants,
  pauseLiveSession,
  resumeLiveSession,
  saveLiveSessionAnnotations,
  type LiveSession
} from "../app/api/live-api";
import { precacheDeck } from "../app/offline";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";
import { PollPanel } from "../widgets/PollPanel";
import { PresenterSidePanel } from "../widgets/PresenterSidePanel";

export function PresenterPage({ courseId, sessionId }: { courseId: string; sessionId: string }) {
  const qc = useQueryClient();
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [localSession, setLocalSession] = useState<LiveSession | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [slideElapsed, setSlideElapsed] = useState(0);

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
  const imageUrls = useMemo(() => deck?.slides.map((item) => slideImageUrl(item)) ?? [], [deck]);
  const participantsQuery = useQuery({
    queryKey: ["live", courseId, sessionId, "participants"],
    queryFn: () => listSessionParticipants(courseId, sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: 3000
  });
  const participants = participantsQuery.data ?? [];
  const engagementQuery = useQuery({
    queryKey: ["live", courseId, sessionId, "engagement"],
    queryFn: () => getStudentEngagement(courseId, sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: 3000
  });

  useEffect(() => {
    if (sessionQuery.data) setLocalSession(sessionQuery.data);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!liveSessionId) return;
    const channel = new BroadcastChannel(`session-${liveSessionId}`);
    channelRef.current = channel;
    const disconnect = connectLiveSession(liveSessionId, (message) => {
      setLocalSession(message.session);
      channel.postMessage(message.session);
      void qc.invalidateQueries({ queryKey: ["live", courseId, sessionId] });
      if (message.type === "participant.joined" || message.type === "participant.left") {
        void qc.invalidateQueries({ queryKey: ["live", courseId, sessionId, "participants"] });
      }
      if (message.type === "feedback.signal_submitted" || message.type === "qa.question_asked") {
        void qc.invalidateQueries({ queryKey: ["live", courseId, sessionId, "engagement"] });
      }
    });
    return () => {
      disconnect();
      channel.close();
    };
  }, [courseId, liveSessionId, qc, sessionId]);

  useEffect(() => {
    if (imageUrls.length > 0) precacheDeck(imageUrls);
  }, [imageUrls]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (session?.status === "LIVE") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session?.status]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSlideElapsed(0);
    const timer = window.setInterval(() => setSlideElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [session?.currentSlideIdx]);

  const slideMut = useMutation({
    mutationFn: (idx: number) => changeLiveSessionSlide(courseId, sessionId, idx)
  });
  const annotationMut = useMutation({
    mutationFn: (annotations: LiveAnnotations) =>
      saveLiveSessionAnnotations(courseId, sessionId, annotations)
  });
  const pauseMut = useMutation({ mutationFn: () => pauseLiveSession(courseId, sessionId) });
  const resumeMut = useMutation({ mutationFn: () => resumeLiveSession(courseId, sessionId) });
  const endMut = useMutation({ mutationFn: () => endLiveSession(courseId, sessionId) });

  function setSession(next: LiveSession) {
    setLocalSession(next);
    channelRef.current?.postMessage(next);
  }

  function go(idx: number) {
    if (!session || !deck || idx < 1 || idx > deck.slides.length) return;
    const next = { ...session, currentSlideIdx: idx };
    setSession(next);
    slideMut.mutate(idx, { onSuccess: (saved) => setSession(saved) });
  }

  if (!session || !deck || !slide) {
    return <div className="presenter-shell">Загрузка...</div>;
  }

  return (
    <div className="presenter-shell">
      <header className="presenter-topbar">
        <Link to={`/courses/${courseId}/materials`} className="breadcrumb">
          ← Материалы
        </Link>
        <strong>{session.lectureTitle}</strong>
        <span className="badge">{session.status}</span>
        <span className="live-code">Код: {session.joinCode}</span>
        <button
          className="btn-ghost"
          type="button"
          title="Открыть проектор в отдельном окне"
          onClick={() =>
            window.open(
              `/#/courses/${courseId}/sessions/${sessionId}/projection`,
              "projection",
              "width=1280,height=720"
            )
          }
        >
          <Monitor size={16} />
          Проектор
        </button>
        <button
          className="btn-ghost"
          type="button"
          title="Показать QR и ссылки для подключения — окно можно унести на другой экран"
          onClick={() =>
            window.open(
              `/#/courses/${courseId}/sessions/${sessionId}/join`,
              "session-join",
              "width=560,height=760"
            )
          }
        >
          <QrCode size={16} />
          Подключение
        </button>
        <button className="btn-ghost" type="button" onClick={() => setDrawing((value) => !value)}>
          Рисование
        </button>
        <PollPanel courseId={courseId} sessionId={sessionId} />
        {session.status === "PAUSED" ? (
          <button
            className="btn-primary"
            type="button"
            title="Продолжить показ слайдов"
            onClick={() => resumeMut.mutate(undefined, { onSuccess: (saved) => setSession(saved) })}
          >
            <Play size={16} />
            Продолжить
          </button>
        ) : (
          <button
            className="btn-ghost"
            type="button"
            title="Поставить лекцию на паузу"
            onClick={() => pauseMut.mutate(undefined, { onSuccess: (saved) => setSession(saved) })}
          >
            <Pause size={16} />
            Пауза
          </button>
        )}
        <ConfirmActionButton
          title="Завершить лекцию?"
          description="Завершение необратимо: рассылка и управление этой сессией остановятся."
          confirmLabel="Завершить"
          className="btn-ghost"
          disabled={endMut.isPending}
          onConfirm={() => endMut.mutate(undefined, { onSuccess: (saved) => setSession(saved) })}
        >
          <Square size={16} />
          Завершить
        </ConfirmActionButton>
      </header>

      <main className="presenter-grid">
        <section className="presenter-main">
          <div className="presenter-stage">
            <img src={slideImageUrl(slide)} alt={`Слайд ${slide.idx}`} />
            <DrawingOverlay
              slideIdx={slide.idx}
              active={drawing}
              annotations={session.annotations as LiveAnnotations}
              onChange={(annotations) => {
                const next = { ...session, annotations };
                setSession(next);
                annotationMut.mutate(annotations, { onSuccess: (saved) => setSession(saved) });
              }}
            />
          </div>
          <div className="deck-controls">
            <button
              className="btn-ghost"
              type="button"
              onClick={() => go(session.currentSlideIdx - 1)}
            >
              Назад
            </button>
            <span>
              {session.currentSlideIdx} / {deck.slides.length}
            </span>
            <button
              className="btn-primary"
              type="button"
              onClick={() => go(session.currentSlideIdx + 1)}
            >
              Далее
            </button>
          </div>
          <div className="presenter-slide-strip">
            {deck.slides.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`slide-thumb ${item.idx === session.currentSlideIdx ? "slide-thumb--active" : ""}`}
                onClick={() => go(item.idx)}
                title={`Перейти к слайду ${item.idx}`}
              >
                <img src={slideImageUrl(item)} alt={`Слайд ${item.idx}`} />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        </section>
        <PresenterSidePanel
          session={session}
          slide={slide}
          participants={participants}
          engagement={engagementQuery.data}
          elapsed={elapsed}
          slideElapsed={slideElapsed}
        />
      </main>
    </div>
  );
}
