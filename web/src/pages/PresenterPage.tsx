import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import { getStudentEngagement } from "../app/api/student-api";
import {
  changeLiveSessionSlide,
  endLiveSession,
  listSessionParticipants,
  pauseLiveSession,
  resumeLiveSession,
  saveLiveSessionAnnotations
} from "../app/api/live-api";
import { precacheDeck } from "../app/offline";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { PresenterSlideStrip } from "../widgets/PresenterSlideStrip";
import { PresenterSidePanel } from "../widgets/PresenterSidePanel";
import { PresenterSessionSummary } from "../widgets/PresenterSessionSummary";
import { AppHeader } from "../widgets/Layout";
import { PresenterTopbar } from "../widgets/PresenterTopbar";
import { Button } from "../shared/ui/button";
import { useSessionTimers } from "../app/live/useSessionTimers";
import { useLiveSession } from "../app/live/useLiveSession";
import { closePublicProjection } from "../app/projection/browserProjection";
import { screenShare } from "../app/sharing/screenShare";

export function PresenterPage(props: { courseId: string; sessionId: string }) {
  return (
    <>
      <AppHeader />
      <PresenterWorkspace key={`${props.courseId}/${props.sessionId}`} {...props} />
    </>
  );
}

function PresenterWorkspace({ courseId, sessionId }: { courseId: string; sessionId: string }) {
  const slideImageRef = useRef<HTMLImageElement>(null);
  const slideInFlightRef = useRef(false);
  const [drawing, setDrawing] = useState(false);
  const [slideErrorTarget, setSlideErrorTarget] = useState<number | null>(null);
  const goRef = useRef<(idx: number) => void>(() => undefined);
  const [optimisticAnnotations, setOptimisticAnnotations] = useState<LiveAnnotations | null>(null);
  const [annotationSaveError, setAnnotationSaveError] = useState(false);
  const annotationQueue = useRef<LiveAnnotations | null>(null);
  const savingAnnotations = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!drawing || !window.matchMedia("(max-width: 900px)").matches) return;
    window.scrollTo(0, 0);
  }, [drawing]);

  const live = useLiveSession(courseId, sessionId);
  const session = live.session;
  useEffect(() => {
    if (!session || !["ENDED", "ARCHIVED"].includes(session.status)) return;
    closePublicProjection(session.joinCode);
    if (screenShare.getSnapshot().scope?.sessionId === session.id) void screenShare.stop();
  }, [session]);
  const paused = session?.status === "PAUSED";
  const commandsBlocked = live.commandsBlocked;
  const { elapsed, slideElapsed } = useSessionTimers(session);
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
    if (imageUrls.length > 0) precacheDeck(imageUrls);
  }, [imageUrls]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (session?.status === "LIVE" && sessionStorage.getItem("la_app_updating") !== "true") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session?.status]);

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

  const setSession = live.setSession;

  function persistAnnotations(annotations: LiveAnnotations) {
    if (paused || commandsBlocked) return;
    setOptimisticAnnotations(annotations);
    setAnnotationSaveError(false);
    annotationQueue.current = annotations;
    if (savingAnnotations.current) return;
    savingAnnotations.current = true;
    void (async () => {
      let failed = false;
      try {
        while (mounted.current && annotationQueue.current) {
          const next = annotationQueue.current;
          annotationQueue.current = null;
          try {
            const saved = await annotationMut.mutateAsync(next);
            if (mounted.current) setSession(saved);
            failed = false;
          } catch {
            failed = true;
          }
        }
      } finally {
        savingAnnotations.current = false;
        if (mounted.current) {
          setAnnotationSaveError(failed);
          if (failed) toast.error("Рисунок не сохранён. Повторите сохранение в панели рисования.");
          else setOptimisticAnnotations(null);
        }
      }
    })();
  }

  function go(idx: number) {
    if (
      !session ||
      !deck ||
      paused ||
      commandsBlocked ||
      slideInFlightRef.current ||
      idx < 1 ||
      idx > deck.slides.length
    )
      return;
    if (idx === session.currentSlideIdx) return;
    slideInFlightRef.current = true;
    slideMut.mutate(idx, {
      onSuccess: (saved) => {
        setSlideErrorTarget(null);
        setSession(saved);
      },
      onError: () => {
        setSlideErrorTarget(idx);
        toast.error("Не удалось переключить слайд.");
      },
      onSettled: () => {
        slideInFlightRef.current = false;
      }
    });
  }
  goRef.current = go;

  useEffect(() => {
    const handleSlideKeys = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || paused || drawing) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest(
          "input, textarea, select, button, [role='button'], [role='tab'], [role='dialog'], [role='menu'], [data-radix-collection-item]"
        )
      )
        return;
      if (event.key === "ArrowLeft" && session) {
        event.preventDefault();
        goRef.current(session.currentSlideIdx - 1);
      } else if (event.key === "ArrowRight" && session) {
        event.preventDefault();
        goRef.current(session.currentSlideIdx + 1);
      }
    };
    window.addEventListener("keydown", handleSlideKeys);
    return () => window.removeEventListener("keydown", handleSlideKeys);
  }, [drawing, paused, session]);

  if (!session) {
    return (
      <div className="presenter-shell presenter-live-error action-message">
        <p>{live.syncError ? "Не удалось обновить занятие." : "Подключаемся к занятию…"}</p>
        {live.syncError && (
          <Button type="button" onClick={live.refresh}>
            Повторить
          </Button>
        )}
      </div>
    );
  }

  if (session.status === "SCHEDULED") {
    return <Navigate to={`/courses/${courseId}/sessions/${sessionId}/join`} replace />;
  }

  if (session.status === "ENDED") {
    return <PresenterSessionSummary courseId={courseId} session={session} />;
  }

  if (deckQuery.isError) {
    return (
      <div className="presenter-shell presenter-live-error">
        <p>Не удалось загрузить слайды.</p>
        <Button type="button" onClick={() => void deckQuery.refetch()}>
          Повторить
        </Button>
      </div>
    );
  }
  if (!deck || !slide) return <div className="presenter-shell">Загружаем слайды…</div>;

  return (
    <div className={`presenter-shell${drawing ? " presenter-shell--drawing" : ""}`}>
      <PresenterTopbar
        courseId={courseId}
        session={session}
        connection={live.connection}
        syncedAt={live.syncedAt}
        syncing={live.syncing}
        syncError={live.syncError}
        commandsBlocked={commandsBlocked}
        onRefresh={() => void live.refresh()}
        drawing={drawing}
        pausePending={pauseMut.isPending}
        resumePending={resumeMut.isPending}
        endPending={endMut.isPending}
        onDrawingChange={setDrawing}
        onSessionChange={setSession}
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

      <main id="main-content" className="presenter-grid">
        <section className="presenter-main">
          <div className="presenter-stage">
            <img ref={slideImageRef} src={slideImageUrl(slide)} alt={`Слайд ${slide.idx}`} />
            <DrawingOverlay
              imageRef={slideImageRef}
              slideIdx={slide.idx}
              active={drawing && !paused && !commandsBlocked}
              toolsVisible={drawing}
              onClose={() => setDrawing(false)}
              annotations={optimisticAnnotations ?? (session.annotations as LiveAnnotations)}
              onChange={persistAnnotations}
              saveError={annotationSaveError}
              saving={annotationMut.isPending}
              onRetry={() => optimisticAnnotations && persistAnnotations(optimisticAnnotations)}
            />
            {!drawing && (
              <div className="presenter-stage-navigation" aria-label="Переключение слайдов">
                <button
                  type="button"
                  className="presenter-stage-navigation__previous"
                  aria-label="Предыдущий слайд"
                  title="Предыдущий слайд"
                  disabled={
                    paused || commandsBlocked || slideMut.isPending || session.currentSlideIdx <= 1
                  }
                  onClick={() => go(session.currentSlideIdx - 1)}
                >
                  <ChevronLeft size={28} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="presenter-stage-navigation__next"
                  aria-label="Следующий слайд"
                  title="Следующий слайд"
                  disabled={
                    paused ||
                    commandsBlocked ||
                    slideMut.isPending ||
                    session.currentSlideIdx >= deck.slides.length
                  }
                  onClick={() => go(session.currentSlideIdx + 1)}
                >
                  <ChevronRight size={28} aria-hidden="true" />
                </button>
              </div>
            )}
            {paused && <div className="presenter-pause-banner">Показ приостановлен</div>}
          </div>
          <div className="deck-controls">
            <Button
              variant="outline"
              type="button"
              disabled={
                paused || commandsBlocked || slideMut.isPending || session.currentSlideIdx <= 1
              }
              onClick={() => go(session.currentSlideIdx - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              Назад
            </Button>
            <span>
              Слайд {session.currentSlideIdx} из {deck.slides.length}
            </span>
            <Button
              type="button"
              disabled={
                paused ||
                commandsBlocked ||
                slideMut.isPending ||
                session.currentSlideIdx >= deck.slides.length
              }
              onClick={() => go(session.currentSlideIdx + 1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
              Далее
            </Button>
          </div>
          {slideErrorTarget !== null && (
            <div className="presenter-slide-error" role="alert">
              <span>Слайд не изменён в эфире.</span>
              <Button
                type="button"
                variant="outline"
                disabled={slideMut.isPending}
                onClick={() => go(slideErrorTarget)}
              >
                Повторить
              </Button>
            </div>
          )}
          <PresenterSlideStrip
            slides={deck.slides}
            currentSlideIdx={session.currentSlideIdx}
            disabled={paused || commandsBlocked || slideMut.isPending}
            onShow={go}
          />
        </section>
        <PresenterSidePanel
          slide={slide}
          participants={participants}
          engagement={engagementQuery.data}
          elapsed={elapsed}
          slideElapsed={slideElapsed}
          courseId={courseId}
          sessionId={sessionId}
          paused={paused}
          commandsBlocked={commandsBlocked}
          questionsLoading={engagementQuery.isLoading}
          questionsError={engagementQuery.isError}
          onRetryQuestions={() => void engagementQuery.refetch()}
          engagementLoading={engagementQuery.isLoading}
          engagementError={engagementQuery.isError}
          onRetryEngagement={() => void engagementQuery.refetch()}
          participantsError={participantsQuery.isError}
          onRetryParticipants={() => void participantsQuery.refetch()}
        />
      </main>
    </div>
  );
}
