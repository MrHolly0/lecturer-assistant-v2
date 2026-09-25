import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { PresenterSidePanel } from "../widgets/PresenterSidePanel";
import { PresenterSessionSummary } from "../widgets/PresenterSessionSummary";
import { PresenterTopbar } from "../widgets/PresenterTopbar";

export function PresenterPage({ courseId, sessionId }: { courseId: string; sessionId: string }) {
  const qc = useQueryClient();
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [localSession, setLocalSession] = useState<LiveSession | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [slideElapsed, setSlideElapsed] = useState(0);

  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const session = localSession ?? sessionQuery.data;
  const elapsed = useMemo(() => {
    const startedAt = session?.startedAt ? Date.parse(session.startedAt) : now;
    return Math.max(0, Math.floor((now - startedAt) / 1000));
  }, [now, session?.startedAt]);
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
      if (message.type === "participant.joined") {
        void qc.invalidateQueries({ queryKey: ["live", courseId, sessionId, "participants"] });
        toast("Студент подключился", { duration: 2500 });
      } else if (message.type === "participant.left") {
        void qc.invalidateQueries({ queryKey: ["live", courseId, sessionId, "participants"] });
      }
      if (message.type === "qa.question_asked") {
        void qc.invalidateQueries({ queryKey: ["live", courseId, sessionId, "engagement"] });
        toast.warning("Новый вопрос от студента", { duration: 5000 });
      } else if (message.type === "feedback.signal_submitted") {
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
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
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
    slideMut.mutate(idx, {
      onSuccess: (saved) => setSession(saved),
      onError: () => {
        setSession(session);
        toast.error("Не удалось переключить слайд.");
      }
    });
  }

  if (!session) {
    return <div className="presenter-shell">Загрузка...</div>;
  }

  if (session.status === "ENDED") {
    return (
      <PresenterSessionSummary
        courseId={courseId}
        session={session}
        participants={participants}
        engagement={engagementQuery.data}
      />
    );
  }

  if (!deck || !slide) return <div className="presenter-shell">Загрузка...</div>;

  return (
    <div className="presenter-shell">
      <PresenterTopbar
        courseId={courseId}
        sessionId={sessionId}
        session={session}
        drawing={drawing}
        pausePending={pauseMut.isPending}
        resumePending={resumeMut.isPending}
        endPending={endMut.isPending}
        onDrawingChange={setDrawing}
        onPause={() =>
          pauseMut.mutate(undefined, {
            onSuccess: (saved) => setSession(saved),
            onError: () => toast.error("Не удалось поставить лекцию на паузу.")
          })
        }
        onResume={() =>
          resumeMut.mutate(undefined, {
            onSuccess: (saved) => setSession(saved),
            onError: () => toast.error("Не удалось продолжить лекцию.")
          })
        }
        onEnd={() =>
          endMut.mutate(undefined, {
            onSuccess: (saved) => setSession(saved),
            onError: () => toast.error("Не удалось завершить лекцию.")
          })
        }
      />

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
          slide={slide}
          participants={participants}
          engagement={engagementQuery.data}
          elapsed={elapsed}
          slideElapsed={slideElapsed}
          courseId={courseId}
          sessionId={sessionId}
        />
      </main>
    </div>
  );
}
