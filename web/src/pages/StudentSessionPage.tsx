import { useEffect, useRef, useState } from "react";
import { CirclePause, CircleStop, MessageCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  askStudentQuestion,
  connectStudentSession,
  getStudentSession,
  joinStudentSession,
  sendStudentSlideToChat,
  submitStudentName,
  submitStudentSignal,
  type SignalValue,
  type StudentConnectionState,
  type StudentQuestion,
  type StudentSessionSnapshot
} from "../app/api/student-api";
import { respondToPoll } from "../app/api/interaction-api";
import { userErrorMessage } from "../app/api/errors";
import { mutationRetryDelay, shouldRetryMutation } from "../app/api/retry";
import { useAuth } from "../app/AuthContext";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { StudentConnectionBanner } from "../widgets/StudentConnectionBanner";
import { StudentFeedbackControls } from "../widgets/StudentFeedbackControls";
import { StudentJoinPanel } from "../widgets/StudentJoinPanel";
import { StudentPollCard } from "../widgets/StudentPollCard";
import { SessionGroups } from "../widgets/SessionGroups";
import { StudentGroupJoinIssue, StudentGroupPicker } from "../widgets/StudentGroupJoin";
import { StudentSessionError, StudentSessionLoading } from "../widgets/StudentSessionState";
import { ThemeToggle } from "../widgets/ThemeToggle";
import { Button } from "../shared/ui/button";
import { joinIssueFromError, type JoinIssue } from "../app/api/studentGroupJoinIssue";

interface StudentSessionPageProps {
  joinCode: string;
}

const STATUS_LABELS: Record<StudentSessionSnapshot["status"], string> = {
  SCHEDULED: "Запланирована",
  LIVE: "В эфире",
  PAUSED: "Пауза",
  ENDED: "Завершена",
  ARCHIVED: "В архиве"
};

export function StudentSessionPage({ joinCode }: StudentSessionPageProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const normalizedCode = joinCode.trim().toUpperCase();
  const storageKey = `student-session:${normalizedCode}`;
  const [participantToken, setParticipantToken] = useState(() =>
    user ? "" : sessionStorage.getItem(storageKey) ?? ""
  );
  const autoJoinRequested = useRef(false);
  const reconnectRef = useRef<() => void>(() => undefined);
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [question, setQuestion] = useState("");
  const [lastSignal, setLastSignal] = useState<SignalValue | null>(null);
  const [requestedSlideIdx, setRequestedSlideIdx] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<StudentSessionSnapshot | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<StudentConnectionState>("CONNECTING");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [joinIssue, setJoinIssue] = useState<JoinIssue | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["student-session", normalizedCode, participantToken],
    queryFn: () => getStudentSession(normalizedCode, participantToken),
    enabled: Boolean(normalizedCode)
  });
  const current = snapshot ?? sessionQuery.data ?? null;
  const isLive = current?.status === "LIVE";
  const isJoined = Boolean(participantToken) && !current?.kicked;

  const joinMut = useMutation({
    mutationFn: () =>
      joinStudentSession(
        normalizedCode,
        user ? undefined : displayName.trim(),
        selectedGroupId || undefined
      ),
    onSuccess: (response) => {
      sessionStorage.setItem(storageKey, response.participantToken);
      if (user) queryClient.setQueryData(["student-active-session"], { joinCode: normalizedCode });
      setParticipantToken(response.participantToken);
      setSnapshot(response.snapshot);
      setJoinIssue(null);
      toast.success("Вы подключены к занятию.");
    },
    onError: (error) => {
      const issue = joinIssueFromError(error);
      if (issue) {
        setJoinIssue(issue);
        if (issue.kind === "selection") setSelectedGroupId("");
        return;
      }
      toast.error(userErrorMessage(error, "Не удалось подключиться к занятию."));
    }
  });
  const signalMut = useMutation({
    mutationFn: (value: SignalValue) =>
      submitStudentSignal(normalizedCode, participantToken, value, current?.currentSlideIdx ?? 0),
    onSuccess: (signalAggregate, value) => {
      setSnapshot((currentSnapshot) =>
        currentSnapshot ? { ...currentSnapshot, signalAggregate } : currentSnapshot
      );
      setLastSignal(value);
      toast.success("Сигнал отправлен.");
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось отправить сигнал. Попробуйте ещё раз.")),
    retry: shouldRetryMutation,
    retryDelay: mutationRetryDelay
  });
  const questionMut = useMutation({
    mutationFn: () => askStudentQuestion(normalizedCode, participantToken, question.trim()),
    onSuccess: (created) => {
      setQuestions((items) => [created, ...items]);
      setQuestion("");
      toast.success("Вопрос отправлен преподавателю.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить вопрос."))
  });
  const pollMut = useMutation({
    mutationFn: ({ pollId, optionIdx }: { pollId: string; optionIdx: number }) =>
      respondToPoll(normalizedCode, pollId, participantToken, optionIdx),
    onSuccess: (result) => {
      const acceptedVote = result.myVote ?? null;
      setMyVote(acceptedVote);
      setSnapshot((value) => (value ? { ...value, myVote: acceptedVote } : value));
      toast.success(result.accepted ? "Ответ принят." : "Ваш первый ответ уже сохранён.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить ответ.")),
    retry: shouldRetryMutation,
    retryDelay: mutationRetryDelay
  });
  const nameMut = useMutation({
    mutationFn: () =>
      submitStudentName(normalizedCode, participantToken, lastName.trim(), firstName.trim()),
    onSuccess: (next) => {
      setSnapshot(next);
      toast.success("Имя и фамилия отправлены преподавателю.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить имя."))
  });
  const slideChatMut = useMutation({
    mutationFn: () => sendStudentSlideToChat(normalizedCode, participantToken),
    onSuccess: () => {
      setRequestedSlideIdx(current?.currentSlideIdx ?? null);
      toast.success("Слайд отправляется в чат MAX.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить слайд в MAX."))
  });

  useEffect(() => {
    if (!sessionQuery.data) return;
    setSnapshot(sessionQuery.data);
    setMyVote(sessionQuery.data.myVote ?? null);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!user || (current?.status !== "ENDED" && current?.status !== "ARCHIVED")) return;
    void queryClient.invalidateQueries({ queryKey: ["student-active-session"] });
  }, [current?.status, queryClient, user]);

  useEffect(() => {
    if (current?.groups?.length === 1 && !selectedGroupId) {
      setSelectedGroupId(current.groups[0].id);
    }
  }, [current?.groups, selectedGroupId]);

  useEffect(() => {
    if (!user || participantToken || autoJoinRequested.current) return;
    autoJoinRequested.current = true;
    sessionStorage.removeItem(storageKey);
    joinMut.mutate();
  }, [joinMut, participantToken, storageKey, user]);

  useEffect(() => {
    setMyVote(current?.myVote ?? null);
  }, [current?.activePoll?.pollId, current?.myVote]);

  useEffect(() => {
    setLastSignal(null);
    setRequestedSlideIdx(null);
  }, [current?.currentSlideIdx]);

  useEffect(() => {
    if (!participantToken || !normalizedCode) return undefined;
    const connection = connectStudentSession(
      normalizedCode,
      participantToken,
      (next) => {
        setSnapshot((previous) => ({
          ...next,
          myVote:
            next.myVote ??
            (previous?.activePoll?.pollId === next.activePoll?.pollId ? previous?.myVote : null)
        }));
        setLastSyncedAt(new Date());
      },
      setConnectionState
    );
    reconnectRef.current = connection.reconnect;
    return () => {
      reconnectRef.current = () => undefined;
      connection.disconnect();
    };
  }, [normalizedCode, participantToken]);

  const slideLabel = current ? `${current.currentSlideIdx} / ${current.slideCount}` : "";

  if (sessionQuery.isLoading && !current) {
    return <StudentSessionLoading />;
  }

  if (sessionQuery.isError || !current) {
    return <StudentSessionError />;
  }

  return (
    <main className="student-session-shell">
      <header className="student-session-topbar">
        <div>
          {current.courseTitle && <span className="muted">{current.courseTitle}</span>}
          {!current.courseTitle && <span className="muted">Код {current.joinCode}</span>}
          <h1>{current.lectureTitle}</h1>
          <SessionGroups groups={current.groups} compact />
        </div>
        <div className="student-session-topbar__actions">
          <span className={`badge student-status student-status--${current.status.toLowerCase()}`}>
            {STATUS_LABELS[current.status]}
          </span>
          <ThemeToggle compact />
        </div>
      </header>

      {isJoined && (
        <StudentConnectionBanner
          state={connectionState}
          lastSyncedAt={lastSyncedAt}
          onRetry={() => reconnectRef.current()}
        />
      )}

      {current.kicked && (
        <div className="student-session-notice student-session-notice--ended" role="alert">
          <CircleStop size={22} aria-hidden="true" />
          <div>
            <strong>Вы отключены от занятия</strong>
            <span>Вы можете снова войти по коду лекции.</span>
            <Button type="button" disabled={joinMut.isPending} onClick={() => joinMut.mutate()}>
              {joinMut.isPending ? "Подключаем…" : "Войти снова"}
            </Button>
          </div>
        </div>
      )}

      {isJoined && current.nameRequested && (
        <form
          className="student-name-request"
          onSubmit={(event) => {
            event.preventDefault();
            nameMut.mutate();
          }}
        >
          <strong>Преподаватель просит указать имя и фамилию</strong>
          <p>Укажите данные, под которыми вас можно найти в списке участников.</p>
          <div className="student-name-request__fields">
            <label>
              Фамилия
              <input
                autoComplete="family-name"
                minLength={2}
                maxLength={80}
                required
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </label>
            <label>
              Имя
              <input
                autoComplete="given-name"
                minLength={2}
                maxLength={80}
                required
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </label>
          </div>
          <Button type="submit" disabled={nameMut.isPending}>
            Отправить преподавателю
          </Button>
        </form>
      )}

      {current.status === "PAUSED" && (
        <div className="student-session-notice student-session-notice--paused" role="status">
          <CirclePause size={22} aria-hidden="true" />
          <div>
            <strong>Лекция на паузе</strong>
            <span>Преподаватель скоро продолжит показ. Отвечать пока нельзя.</span>
          </div>
        </div>
      )}
      {(current.status === "ENDED" || current.status === "ARCHIVED") && (
        <div className="student-session-notice student-session-notice--ended" role="status">
          <CircleStop size={22} aria-hidden="true" />
          <div>
            <strong>Лекция завершена</strong>
            <span>Показ и отправка ответов остановлены.</span>
          </div>
        </div>
      )}

      {isJoined && (
        <section className="student-slide-card">
          <div className="student-slide-meta">
            <span>Слайд {slideLabel}</span>
            {!isLive && <span className="muted">Показ сейчас не идет</span>}
            {user &&
              current.currentSlide &&
              (current.status === "LIVE" || current.status === "PAUSED") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={slideChatMut.isPending || requestedSlideIdx === current.currentSlideIdx}
                  onClick={() => slideChatMut.mutate()}
                >
                  <MessageCircle size={16} aria-hidden="true" />{" "}
                  {requestedSlideIdx === current.currentSlideIdx
                    ? "Запрошен в MAX"
                    : "Получить в чате MAX"}
                </Button>
              )}
          </div>
          {current.currentSlide ? (
            <div className="student-slide-viewport">
              <img src={current.currentSlide.imageUrl} alt={`Слайд ${current.currentSlide.idx}`} />
              <DrawingOverlay
                slideIdx={current.currentSlide.idx}
                annotations={(current.annotations ?? {}) as LiveAnnotations}
                active={false}
                onChange={() => undefined}
              />
            </div>
          ) : (
            <div className="student-slide-empty">Слайд пока не выбран</div>
          )}
        </section>
      )}

      {current.kicked ? null : !isJoined ? (
        joinIssue ? (
          <StudentGroupJoinIssue
            issue={joinIssue}
            selectedGroupId={selectedGroupId}
            pending={joinMut.isPending}
            onGroupChange={setSelectedGroupId}
            onRetry={() => joinMut.mutate()}
          />
        ) : (
          <>
            {!user && (current.groups?.length ?? 0) > 1 && (
              <StudentGroupPicker
                groups={current.groups ?? []}
                value={selectedGroupId}
                onChange={setSelectedGroupId}
              />
            )}
            <StudentJoinPanel
              displayName={displayName}
              userName={user?.displayName}
              isPending={joinMut.isPending}
              isError={joinMut.isError}
              disabled={!user && (current.groups?.length ?? 0) > 1 && !selectedGroupId}
              onDisplayNameChange={setDisplayName}
              onJoin={() => joinMut.mutate()}
            />
          </>
        )
      ) : (
        <section className="student-action-panel student-action-panel--feedback">
          {current.activePoll && (
            <StudentPollCard
              poll={current.activePoll}
              myVote={myVote}
              isLive={isLive}
              isPending={pollMut.isPending}
              onAnswer={(optionIdx) =>
                pollMut.mutate({ pollId: current.activePoll!.pollId, optionIdx })
              }
            />
          )}
          <StudentFeedbackControls
            isLive={isLive}
            isSignalPending={signalMut.isPending}
            isQuestionPending={questionMut.isPending}
            lastSignal={lastSignal}
            question={question}
            questions={questions}
            answers={current.questionAnswers ?? []}
            onSignal={(value) => signalMut.mutate(value)}
            onQuestionChange={setQuestion}
            onQuestionSubmit={() => questionMut.mutate()}
          />
        </section>
      )}
    </main>
  );
}
