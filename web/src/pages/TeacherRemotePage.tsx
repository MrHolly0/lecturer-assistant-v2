import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogOut,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Square
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import { userErrorMessage } from "../app/api/errors";
import {
  beginLiveSession,
  changeLiveSessionSlide,
  endLiveSession,
  listSessionParticipants,
  pauseLiveSession,
  resumeLiveSession
} from "../app/api/live-api";
import { formatSessionTime, useSessionTimers } from "../app/live/useSessionTimers";
import { getStudentEngagement } from "../app/api/student-api";
import { Button, LinkButton } from "../shared/ui/button";
import { useAuth } from "../app/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "../shared/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { PollPanel } from "../widgets/PollPanel";
import { SessionGroups } from "../widgets/SessionGroups";
import { TeacherRemoteConnection } from "../widgets/TeacherRemoteConnection";
import { TeacherRemoteQuestions } from "../widgets/TeacherRemoteQuestions";
import { TeacherRemoteScheduledState } from "../widgets/TeacherRemoteScheduledState";
import { TeacherRemoteSignals } from "../widgets/TeacherRemoteSignals";
import { LiveSlideNotesEditor } from "../widgets/LiveSlideNotesEditor";
import { ThemeToggle } from "../widgets/ThemeToggle";
import { SessionParticipantList } from "../widgets/SessionParticipantList";
import { useLiveSession } from "../app/live/useLiveSession";

export function TeacherRemotePage({
  courseId,
  sessionId
}: {
  courseId: string;
  sessionId: string;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const slideInFlightRef = useRef(false);
  const [remoteSection, setRemoteSection] = useState<"poll" | "students" | "notes" | "">("");
  const live = useLiveSession(courseId, sessionId);
  const session = live.session;
  const setSession = live.setSession;
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
    if (session?.status !== "ENDED" && session?.status !== "ARCHIVED") return;
    queryClient.setQueryData(["active-session"], null);
    void queryClient.invalidateQueries({ queryKey: ["active-session"] });
  }, [queryClient, session?.status]);

  const slideMutation = useMutation({
    mutationFn: (slideIdx: number) => changeLiveSessionSlide(courseId, sessionId, slideIdx),
    onSuccess: setSession,
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
    onSuccess: setSession,
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось поставить лекцию на паузу."))
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeLiveSession(courseId, sessionId),
    onSuccess: setSession,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось продолжить лекцию."))
  });
  const beginMutation = useMutation({
    mutationFn: () => beginLiveSession(courseId, sessionId),
    onSuccess: (started) => {
      setSession(started);
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
  const endMutation = useMutation({
    mutationFn: () => endLiveSession(courseId, sessionId),
    onSuccess: () => {
      queryClient.setQueryData(["active-session"], null);
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}`, { replace: true });
      toast.success("Лекция завершена. Итоги доступны в курсе.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось завершить лекцию."))
  });

  if (live.isLoading) {
    return <RemoteState title="Подключаем пульт…" />;
  }
  if (!session) {
    return (
      <RemoteState title="Не удалось открыть пульт" description="Проверьте связь и повторите.">
        <Button type="button" variant="outline" onClick={() => void live.refresh()}>
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
        <LinkButton to={`/courses/${courseId}`} variant="outline">
          К курсу
        </LinkButton>
        <LinkButton to="/courses" variant="ghost">
          Все курсы
        </LinkButton>
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
  const openQuestions = questions.filter((question) => question.status === "OPEN");

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
          <TeacherRemoteConnection
            state={live.connection}
            syncing={live.syncing}
            syncedAt={live.syncedAt}
            syncError={live.syncError}
            onRetry={live.refresh}
          />
          <ThemeToggle compact />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" aria-label="Меню пульта">
                <MoreHorizontal size={22} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate("/courses")}>К курсам</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/settings/max")}>
                MAX и вход
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void signOut().then(() => navigate("/login", { replace: true }));
                }}
              >
                <LogOut size={16} aria-hidden="true" /> Выйти из аккаунта
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <section className="teacher-remote-stage" aria-label={`Слайд ${currentSlideIdx}`}>
        {deckQuery.isError ? (
          <div className="teacher-remote-stage__empty">
            <span>Не удалось загрузить слайд.</span>
            <Button type="button" variant="outline" onClick={() => void deckQuery.refetch()}>
              Повторить
            </Button>
          </div>
        ) : slide ? (
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

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="teacher-remote-end"
            disabled={endMutation.isPending}
          >
            <Square size={15} aria-hidden="true" /> Завершить лекцию
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Завершить лекцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Показ на проекторе и у студентов закончится. Данные останутся в итогах лекции.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Продолжить показ</AlertDialogCancel>
            <AlertDialogAction onClick={() => endMutation.mutate()}>
              Завершить лекцию
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="teacher-remote-live-feedback" aria-label="Обратная связь по слайду">
        <TeacherRemoteSignals
          engagement={engagementQuery.data}
          isError={engagementQuery.isError}
          isLoading={engagementQuery.isLoading}
          onRetry={() => void engagementQuery.refetch()}
        />
        <TeacherRemoteQuestions
          courseId={courseId}
          sessionId={sessionId}
          questions={openQuestions}
          isLoading={engagementQuery.isLoading}
          loadError={engagementQuery.isError}
          onRetry={() => void engagementQuery.refetch()}
        />
      </section>

      <nav className="teacher-remote-tools" aria-label="Другие инструменты занятия">
        <button
          type="button"
          aria-expanded={remoteSection === "poll"}
          onClick={() => setRemoteSection(remoteSection === "poll" ? "" : "poll")}
        >
          Проверка
        </button>
        <button
          type="button"
          aria-expanded={remoteSection === "students"}
          onClick={() => setRemoteSection(remoteSection === "students" ? "" : "students")}
        >
          Участники ·{" "}
          {participantsQuery.data?.filter((participant) => !participant.leftAt).length ?? 0}
        </button>
        <button
          type="button"
          aria-expanded={remoteSection === "notes"}
          onClick={() => setRemoteSection(remoteSection === "notes" ? "" : "notes")}
        >
          Заметки к слайду
        </button>
      </nav>
      {remoteSection === "poll" && (
        <section className="teacher-remote-expanded">
          <h2>Проверка</h2>
          <PollPanel courseId={courseId} sessionId={sessionId} disabled={paused} />
        </section>
      )}
      {remoteSection === "notes" && slide && (
        <section className="teacher-remote-expanded">
          <h2>Заметки к слайду {slide.idx}</h2>
          <LiveSlideNotesEditor courseId={courseId} deckId={slide.deckId} slide={slide} />
        </section>
      )}
      {remoteSection === "students" && (
        <section className="teacher-remote-expanded">
          <h2>Участники</h2>
          {participantsQuery.isError && (
            <div className="teacher-remote-data-error" role="status">
              Не удалось обновить участников.{" "}
              {participantsQuery.data ? "Показаны последние данные." : ""}{" "}
              <button type="button" onClick={() => void participantsQuery.refetch()}>
                Повторить
              </button>
            </div>
          )}
          <SessionParticipantList
            courseId={courseId}
            sessionId={sessionId}
            participants={participantsQuery.data ?? []}
          />
        </section>
      )}
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
