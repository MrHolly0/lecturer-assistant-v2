import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock, Monitor, Pause, Play, Square } from "lucide-react";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import {
  changeLiveSessionSlide,
  connectLiveSession,
  endLiveSession,
  getLiveSession,
  pauseLiveSession,
  resumeLiveSession,
  saveLiveSessionAnnotations,
  type LiveSession
} from "../app/api/live-api";
import { precacheDeck } from "../app/offline";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";

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
  const imageUrls = useMemo(
    () => deck?.slides.map((item) => slideImageUrl(courseId, deck.id, item.idx)) ?? [],
    [courseId, deck]
  );

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
    localStorage.setItem(`pending-slide-${session.id}`, String(idx));
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
        <button className="btn-ghost" type="button" onClick={() => setDrawing((value) => !value)}>
          Рисование
        </button>
        {session.status === "PAUSED" ? (
          <button className="btn-primary" type="button" onClick={() => resumeMut.mutate()}>
            <Play size={16} />
          </button>
        ) : (
          <button className="btn-ghost" type="button" onClick={() => pauseMut.mutate()}>
            <Pause size={16} />
          </button>
        )}
        <button className="btn-ghost" type="button" onClick={() => endMut.mutate()}>
          <Square size={16} />
        </button>
      </header>

      <main className="presenter-grid">
        <section className="presenter-stage">
          <img src={slideImageUrl(courseId, deck.id, slide.idx)} alt={`Слайд ${slide.idx}`} />
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
        </section>
        <aside className="presenter-side">
          <div className="live-metric">
            <Clock size={16} />
            Лекция {formatTime(elapsed)} · слайд {formatTime(slideElapsed)}
          </div>
          <div className="join-panel">
            <span className="muted">Подключение</span>
            <strong>{session.joinCode}</strong>
            <small>/join {session.joinCode}</small>
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
        </aside>
      </main>
    </div>
  );
}

function formatTime(total: number) {
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
