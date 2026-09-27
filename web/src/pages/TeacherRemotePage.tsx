import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock3, Pause, Play, Radio, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import { userErrorMessage } from "../app/api/errors";
import {
  beginLiveSession,
  changeLiveSessionSlide,
  connectLiveSession,
  endLiveSession,
  getLiveSession,
  listSessionParticipants,
  pauseLiveSession,
  resumeLiveSession,
  type LiveConnectionState,
  type LiveSession
} from "../app/api/live-api";
import { formatSessionTime, useSessionTimers } from "../app/live/useSessionTimers";
import { getStudentEngagement } from "../app/api/student-api";
import { Button, LinkButton } from "../shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { PollPanel } from "../widgets/PollPanel";
import { SessionGroups } from "../widgets/SessionGroups";
import { TeacherRemoteConnection } from "../widgets/TeacherRemoteConnection";
import { TeacherRemoteQuestions } from "../widgets/TeacherRemoteQuestions";
import { TeacherRemoteScheduledState } from "../widgets/TeacherRemoteScheduledState";
import { TeacherRemoteSignals } from "../widgets/TeacherRemoteSignals";
import { LiveSlideNotesEditor } from "../widgets/LiveSlideNotesEditor";
import { ThemeToggle } from "../widgets/ThemeToggle";
import { SessionParticipantList } from "../widgets/SessionParticipantList";

export function TeacherRemotePage({
  courseId,
  sessionId
}: {
  courseId: string;
  sessionId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const slideInFlightRef = useRef(false);
  const [sessionOverride, setSessionOverride] = useState<LiveSession | null>(null);
  const [connection, setConnection] = useState<LiveConnectionState>("connecting");
  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId),
    refetchInterval: 3000,
    retry: 1
  });
  const session = sessionOverride ?? sessionQuery.data;
  const deckQuery = useQuery({
    queryKey: ["content", courseId, "decks", session?.deckId],
    queryFn: () => getDeck(courseId, session?.deckId ?? ""),
    enabled: Boolean(session?.deckId)
  });
  const engagementQuery = useQuery({
    queryKey: ["live", courseId, sessionId, "engagement"],
    queryFn: () => getStudentEngagement(courseId, sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: 3000
  });
  const participantsQuery = useQuery({
    queryKey: ["live", courseId, sessionId, "participants"],
    queryFn: () => listSessionParticipants(courseId, sessionId),
    refetchInterval: 3000
  });
  const deck = deckQuery.data;
  const slide = deck?.slides.find((item) => item.idx === session?.currentSlideIdx);
  const paused = session?.status === "PAUSED";
  const { elapsed, slideElapsed } = useSessionTimers(session);

  useEffect(() => {
    if (sessionQuery.data) setSessionOverride(sessionQuery.data);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!session?.id) return;
    const disconnect = connectLiveSession(
      session.id,
      (message) => {
        setSessionOverride(message.session);
        if (message.type.startsWith("feedback.") || message.type.startsWith("qa.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "engagement"]
          });
        }
        if (message.type.startsWith("poll.") || message.type.startsWith("interaction.poll")) {
          void queryClient.invalidateQueries({ queryKey: ["poll", courseId, sessionId] });
        }
        if (message.type.startsWith("participant.")) {
          void queryClient.invalidateQueries({
            queryKey: ["live", courseId, sessionId, "participants"]
          });
        }
      },
      setConnection
    );
    return disconnect;
  }, [courseId, queryClient, session?.id, sessionId]);

  const slideMutation = useMutation({
    mutationFn: (slideIdx: number) => changeLiveSessionSlide(courseId, sessionId, slideIdx),
    onSuccess: setSessionOverride,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось переключить слайд.")),
    onSettled: () => {
      slideInFlightRef.current = false;
    }
  });
  const go = (idx: number) => {
    if (
      slideInFlightRef.current ||
      slideMutation.isPending ||
      paused ||
      idx < 1 ||
      idx > (deck?.slides.length ?? 0)
    )
      return;
    slideInFlightRef.current = true;
    slideMutation.mutate(idx);
  };
  const pauseMutation = useMutation({
    mutationFn: () => pauseLiveSession(courseId, sessionId),
    onSuccess: setSessionOverride,
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось поставить лекцию на паузу."))
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeLiveSession(courseId, sessionId),
    onSuccess: setSessionOverride,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось продолжить лекцию."))
  });
  const beginMutation = useMutation({
    mutationFn: () => beginLiveSession(courseId, sessionId),
    onSuccess: (started) => {
      setSessionOverride(started);
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      toast.success("Показ начался.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось начать показ."))
  });
  const cancelMutation = useMutation({
    mutationFn: () => endLiveSession(courseId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}`, { replace: true });
      toast.success("Занятие отменено.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отменить занятие."))
  });

  if (sessionQuery.isLoading) {
    return <RemoteState title="Подключаем пульт…" />;
  }
  if (sessionQuery.isError || !session) {
    return (
      <RemoteState title="Не удалось открыть пульт" description="Проверьте связь и повторите.">
        <Button type="button" variant="outline" onClick={() => sessionQuery.refetch()}>
          <RefreshCw size={18} aria-hidden="true" /> Повторить
        </Button>
      </RemoteState>
    );
  }
  if (session.status === "SCHEDULED") {
    return (
      <TeacherRemoteScheduledState
        lectureTitle={session.lectureTitle}
        joinCode={session.joinCode}
        beginPending={beginMutation.isPending}
        cancelPending={cancelMutation.isPending}
        onBegin={() => beginMutation.mutate()}
        onBack={() => navigate(`/courses/${courseId}`)}
        onCancel={() => cancelMutation.mutate()}
      />
    );
  }
  if (session.status === "ENDED" || session.status === "ARCHIVED") {
    return (
      <RemoteState title="Лекция завершена" description="Итог уже доступен в кабинете.">
        <LinkButton to={`/courses/${courseId}/sessions/${sessionId}/summary`}>
          Открыть итог
        </LinkButton>
      </RemoteState>
    );
  }

  const currentSlideIdx = session.currentSlideIdx;
  const slideCount = deck?.slides.length ?? 0;
  const actionPending =
    slideMutation.isPending || pauseMutation.isPending || resumeMutation.isPending;
  const questions = engagementQuery.data?.questions ?? [];
  const openQuestionCount = questions.filter((question) => question.status === "OPEN").length;

  return (
    <main className="teacher-remote-shell">
      <header className="teacher-remote-header">
        <div className="teacher-remote-header__copy">
          <span>
            <Radio size={15} aria-hidden="true" /> Пульт лекции
          </span>
          <h1>{session.lectureTitle}</h1>
          <SessionGroups groups={session.groups} compact />
        </div>
        <div className="teacher-remote-header__actions">
          <TeacherRemoteConnection state={connection} />
          <ThemeToggle compact />
        </div>
      </header>

      <section className="teacher-remote-stage" aria-label={`Слайд ${currentSlideIdx}`}>
        {slide ? (
          <img src={slideImageUrl(slide)} alt={`Слайд ${currentSlideIdx}`} />
        ) : (
          <div className="teacher-remote-stage__empty">Загружаем слайд…</div>
        )}
        {paused && <div className="teacher-remote-paused">Показ приостановлен</div>}
      </section>

      <div className="teacher-remote-counter" aria-live="polite">
        <strong>Слайд {currentSlideIdx}</strong>
        <span>из {slideCount || "…"}</span>
      </div>
      <div className="teacher-remote-timing">
        <Clock3 size={15} aria-hidden="true" />
        <span>С начала {formatSessionTime(elapsed)}</span>
        <span>Слайд {formatSessionTime(slideElapsed)}</span>
      </div>

      <div className="teacher-remote-controls">
        <Button
          type="button"
          variant="outline"
          disabled={paused || actionPending || currentSlideIdx <= 1}
          onClick={() => go(currentSlideIdx - 1)}
        >
          <ChevronLeft size={25} aria-hidden="true" /> Назад
        </Button>
        <Button
          type="button"
          variant={paused ? "default" : "secondary"}
          disabled={actionPending}
          onClick={() => (paused ? resumeMutation.mutate() : pauseMutation.mutate())}
        >
          {paused ? <Play size={22} aria-hidden="true" /> : <Pause size={22} aria-hidden="true" />}
          {paused ? "Продолжить" : "Пауза"}
        </Button>
        <Button
          type="button"
          disabled={paused || actionPending || currentSlideIdx >= slideCount}
          onClick={() => go(currentSlideIdx + 1)}
        >
          Далее <ChevronRight size={25} aria-hidden="true" />
        </Button>
      </div>

      <Tabs defaultValue="control" className="teacher-remote-tabs">
        <TabsList className="teacher-remote-tabs__list">
          <TabsTrigger value="control">Сводка</TabsTrigger>
          <TabsTrigger value="poll">Проверка</TabsTrigger>
          <TabsTrigger value="questions">
            Вопросы{" "}
            {openQuestionCount > 0 && <span className="tab-badge">{openQuestionCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="notes">Заметки</TabsTrigger>
          <TabsTrigger value="students">Студенты</TabsTrigger>
        </TabsList>
        <TabsContent value="control">
          <TeacherRemoteSignals engagement={engagementQuery.data} />
        </TabsContent>
        <TabsContent value="poll" className="teacher-remote-poll">
          <PollPanel courseId={courseId} sessionId={sessionId} disabled={paused} />
        </TabsContent>
        <TabsContent value="questions">
          <TeacherRemoteQuestions courseId={courseId} sessionId={sessionId} questions={questions} />
        </TabsContent>
        <TabsContent value="notes" className="teacher-remote-notes">
          {slide && (
            <LiveSlideNotesEditor courseId={courseId} deckId={slide.deckId} slide={slide} />
          )}
        </TabsContent>
        <TabsContent value="students" className="teacher-remote-students">
          <SessionParticipantList
            courseId={courseId}
            sessionId={sessionId}
            participants={participantsQuery.data ?? []}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function RemoteState({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="teacher-remote-state">
      <Radio size={28} aria-hidden="true" />
      <h1>{title}</h1>
      {description && <p className="muted">{description}</p>}
      {children}
    </main>
  );
}
