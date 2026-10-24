import { useEffect, useRef, useState } from "react";
import { CircleStop, MessageCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clearStudentResume,
  readStudentResume,
  readTabStudentToken,
  storeStudentResume,
  storeTabStudentToken
} from "../app/studentResume";
import {
  acknowledgeStudentDelivery,
  askStudentQuestion,
  connectStudentSession,
  getStudentSession,
  joinStudentSession,
  sendStudentSlideToChat,
  sendStudentShareFrameToChat,
  submitStudentName,
  submitStudentSignal,
  type SignalValue,
  type StudentConnectionState,
  type StudentQuestion,
  type StudentSessionSnapshot
} from "../app/api/student-api";
import { respondToPoll } from "../app/api/interaction-api";
import { ApiError, userErrorMessage } from "../app/api/errors";
import { mutationRetryDelay, shouldRetryMutation } from "../app/api/retry";
import { PendingOperationKey } from "../app/api/operation-key";
import { StudentSnapshotGate } from "../app/api/student-snapshot-gate";
import { trackStudentDelivery } from "../app/live/studentDelivery";
import { useAuth } from "../app/AuthContext";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { BrandMark } from "../shared/brand/BrandMark";
import { StudentConnectionBanner } from "../widgets/StudentConnectionBanner";
import { StudentFeedbackControls } from "../widgets/StudentFeedbackControls";
import { StudentJoinPanel } from "../widgets/StudentJoinPanel";
import { StudentPollCard } from "../widgets/StudentPollCard";
import { ScreenShareViewer } from "../widgets/ScreenShareViewer";
import { StudentSlideViewer } from "../widgets/StudentSlideViewer";
import { StudentGroupJoinIssue, StudentGroupPicker } from "../widgets/StudentGroupJoin";
import { StudentSessionError, StudentSessionLoading } from "../widgets/StudentSessionState";
import { ThemeToggle } from "../widgets/ThemeToggle";
import { Button, LinkButton } from "../shared/ui/button";
import { joinIssueFromError, type JoinIssue } from "../app/api/studentGroupJoinIssue";

interface StudentSessionPageProps {
  joinCode: string;
}

const STATUS_LABELS: Record<StudentSessionSnapshot["status"], string> = {
  SCHEDULED: "Ожидание",
  LIVE: "В эфире",
  PAUSED: "Пауза",
  ENDED: "Завершена",
  ARCHIVED: "В архиве"
};

export function StudentSessionPage({ joinCode }: StudentSessionPageProps) {
  const slideImageRef = useRef<HTMLImageElement>(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const normalizedCode = joinCode.trim().toUpperCase();
  const scopeForToken = (token: string) =>
    JSON.stringify([normalizedCode, user?.id ?? "guest", token]);
  const resumeToken = useRef(
    readStudentResume(normalizedCode, user?.id ?? null)?.participantToken ?? ""
  );
  const [participantToken, setParticipantToken] = useState(() =>
    user ? "" : readTabStudentToken(normalizedCode) ?? resumeToken.current
  );
  const autoJoinRequested = useRef(false);
  const reconnectRef = useRef<() => void>(() => undefined);
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const nameRequestTitleRef = useRef<HTMLHeadingElement>(null);
  const revealedNameRequestRef = useRef<string | null>(null);
  const questionDraftKey = user
    ? `student-question-draft:${normalizedCode}:${user.id}`
    : `student-question-draft:${normalizedCode}`;
  const questionHistoryKey = user
    ? `student-question-history:${normalizedCode}:${user.id}`
    : `student-question-history:${normalizedCode}`;
  const [question, setQuestion] = useState(() => {
    try {
      return sessionStorage.getItem(questionDraftKey) ?? "";
    } catch {
      return "";
    }
  });
  const [snapshotSyncing, setSnapshotSyncing] = useState(false);
  const [lastSignal, setLastSignal] = useState<SignalValue | null>(null);
  const [requestedSlideIdx, setRequestedSlideIdx] = useState<number | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>(() => {
    try {
      const stored = sessionStorage.getItem(questionHistoryKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? (parsed as StudentQuestion[]) : [];
    } catch {
      return [];
    }
  });
  const [myVote, setMyVote] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<StudentConnectionState>("CONNECTING");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [joinIssue, setJoinIssue] = useState<JoinIssue | null>(null);
  const scope = scopeForToken(participantToken);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const gateRef = useRef({ scope, gate: new StudentSnapshotGate<StudentSessionSnapshot>() });
  if (gateRef.current.scope !== scope) {
    gateRef.current = { scope, gate: new StudentSnapshotGate<StudentSessionSnapshot>() };
  }
  const [snapshotState, setSnapshotState] = useState<{
    scope: string;
    snapshot: StudentSessionSnapshot;
  } | null>(null);

  function commitSnapshot(
    next: StudentSessionSnapshot,
    targetScope: string,
    requestGeneration?: number
  ) {
    if (scopeRef.current !== targetScope || gateRef.current.scope !== targetScope) return false;
    const entry = gateRef.current;
    const merged = mergeStudentSnapshot(next, entry.gate.current);
    const accepted =
      requestGeneration === undefined
        ? entry.gate.accept(merged)
        : entry.gate.acceptRequest(merged, requestGeneration);
    if (!accepted) return false;
    setSnapshotState({ scope: targetScope, snapshot: merged });
    setMyVote(merged.myVote ?? null);
    setLastSyncedAt(new Date());
    return true;
  }

  const sessionQuery = useQuery({
    queryKey: ["student-session", normalizedCode, user?.id ?? "guest", participantToken],
    queryFn: async ({ signal }) => {
      const requestScope = scope;
      const requestEntry = gateRef.current;
      const requestGeneration = requestEntry.gate.generation;
      const fresh = await getStudentSession(normalizedCode, participantToken, signal);
      if (scopeRef.current !== requestScope || gateRef.current !== requestEntry) return fresh;
      commitSnapshot(fresh, requestScope, requestGeneration);
      return requestEntry.gate.current ?? fresh;
    },
    enabled: Boolean(normalizedCode)
  });
  const { refetch } = sessionQuery;
  const current =
    (snapshotState?.scope === scope ? snapshotState.snapshot : null) ?? sessionQuery.data ?? null;
  const isLive = current?.status === "LIVE";
  const isTerminalSession = current?.status === "ENDED" || current?.status === "ARCHIVED";
  const isJoined = Boolean(participantToken) && !current?.kicked;
  const commandsReady =
    isLive &&
    !snapshotSyncing &&
    !sessionQuery.isError &&
    (connectionState === "CONNECTED" || connectionState === "POLLING");

  const joinMut = useMutation({
    mutationFn: () =>
      joinStudentSession(
        normalizedCode,
        user ? undefined : displayName.trim(),
        selectedGroupId || undefined,
        user ? resumeToken.current || undefined : undefined
      ),
    onSuccess: (response) => {
      if (scopeRef.current !== scope) return;
      storeTabStudentToken(normalizedCode, response.participantToken, user?.id ?? null);
      resumeToken.current = response.participantToken;
      storeStudentResume({
        joinCode: normalizedCode,
        participantToken: response.participantToken,
        userId: user?.id
      });
      if (user) queryClient.setQueryData(["student-active-session"], { joinCode: normalizedCode });
      setParticipantToken(response.participantToken);
      const nextScope = scopeForToken(response.participantToken);
      const nextEntry = {
        scope: nextScope,
        gate: new StudentSnapshotGate<StudentSessionSnapshot>()
      };
      nextEntry.gate.accept(response.snapshot);
      gateRef.current = nextEntry;
      const accepted = mergeStudentSnapshot(response.snapshot, null);
      setSnapshotState({ scope: nextScope, snapshot: accepted });
      setMyVote(accepted.myVote ?? null);
      setLastSyncedAt(new Date());
      setJoinIssue(null);
      toast.success("Вы подключены к занятию.");
    },
    onError: (error) => {
      if (user && resumeToken.current && error instanceof ApiError && error.status === 403) {
        resumeToken.current = "";
        clearStudentResume(normalizedCode, user?.id ?? null);
        joinMut.mutate();
        return;
      }
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
    mutationFn: ({ value, slideIdx }: { value: SignalValue; slideIdx: number }) =>
      submitStudentSignal(normalizedCode, participantToken, value, slideIdx),
    onSuccess: (signalAggregate, variables) => {
      const latest = gateRef.current.gate.current;
      if (latest?.currentSlideIdx !== variables.slideIdx) return;
      commitSnapshot({ ...latest, signalAggregate }, scope);
      setLastSignal(variables.value);
      toast.success("Сигнал отправлен.");
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось отправить сигнал. Попробуйте ещё раз.")),
    retry: shouldRetryMutation,
    retryDelay: mutationRetryDelay
  });
  const [questionAnonymous, setQuestionAnonymous] = useState(false);
  const pendingQuestion = useRef(new PendingOperationKey());
  const questionMut = useMutation({
    mutationFn: (request: {
      text: string;
      anonymous: boolean;
      operationKey: string;
      scope: string;
    }) =>
      askStudentQuestion(
        normalizedCode,
        participantToken,
        request.text,
        request.anonymous,
        request.operationKey
      ),
    onSuccess: (created, request) => {
      pendingQuestion.current.clear(request.operationKey);
      if (scopeRef.current !== request.scope) return;
      setQuestions((items) => [created, ...items]);
      setQuestion((draft) => (draft.trim() === request.text ? "" : draft));
      toast.success("Вопрос отправлен преподавателю.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить вопрос."))
  });
  const pollMut = useMutation({
    mutationFn: ({ pollId, optionIdx }: { pollId: string; optionIdx: number | string }) =>
      respondToPoll(normalizedCode, pollId, participantToken, optionIdx),
    onSuccess: (result, variables) => {
      const acceptedVote = result.myVote ?? null;
      const latest = gateRef.current.gate.current;
      if (latest?.activePoll?.pollId === variables.pollId) {
        commitSnapshot(
          { ...latest, myVote: acceptedVote, myTextAnswer: result.myTextAnswer ?? null },
          scope
        );
      }
      toast.success(result.accepted ? "Ответ принят." : "Ваш первый ответ уже сохранён.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить ответ.")),
    retry: shouldRetryMutation,
    retryDelay: mutationRetryDelay
  });
  const nameMut = useMutation({
    mutationFn: async () => {
      const requestScope = scope;
      const requestEntry = gateRef.current;
      const requestGeneration = requestEntry.gate.generation;
      const next = await submitStudentName(
        normalizedCode,
        participantToken,
        lastName.trim(),
        firstName.trim()
      );
      return { next, requestScope, requestEntry, requestGeneration };
    },
    onSuccess: ({ next, requestScope, requestEntry, requestGeneration }) => {
      if (scopeRef.current !== requestScope || gateRef.current !== requestEntry) return;
      commitSnapshot(next, requestScope, requestGeneration);
      setEditingName(false);
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
  const frameChatMut = useMutation({
    mutationFn: () => sendStudentShareFrameToChat(normalizedCode, participantToken),
    onSuccess: () => toast.success("Кадр отправляется файлом в чат MAX, без пережатия."),
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отправить кадр в MAX."))
  });

  useEffect(() => {
    try {
      if (question) sessionStorage.setItem(questionDraftKey, question);
      else sessionStorage.removeItem(questionDraftKey);
    } catch {
      // Keep the draft in component state if storage is unavailable.
    }
  }, [question, questionDraftKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(questionHistoryKey, JSON.stringify(questions));
    } catch {
      // The server-backed answers still remain available if browser storage is unavailable.
    }
  }, [questions, questionHistoryKey]);

  useEffect(() => {
    if (current?.status !== "ENDED" && current?.status !== "ARCHIVED") return;
    clearStudentResume(normalizedCode, user?.id ?? null);
    if (user) void queryClient.invalidateQueries({ queryKey: ["student-active-session"] });
  }, [current?.status, normalizedCode, queryClient, user]);

  useEffect(() => {
    if (current?.groups?.length === 1 && !selectedGroupId) {
      setSelectedGroupId(current.groups[0].id);
    }
  }, [current?.groups, selectedGroupId]);

  useEffect(() => {
    if (
      !user ||
      participantToken ||
      !current ||
      current.status === "ENDED" ||
      current.status === "ARCHIVED" ||
      autoJoinRequested.current
    )
      return;
    autoJoinRequested.current = true;
    joinMut.mutate();
  }, [current, joinMut, participantToken, user]);

  useEffect(() => {
    setMyVote(current?.myVote ?? null);
  }, [current?.activePoll?.pollId, current?.myVote]);

  useEffect(() => {
    setLastSignal(null);
    setRequestedSlideIdx(null);
  }, [current?.currentSlideIdx]);

  useEffect(() => {
    if (!current?.nameRequested || !isJoined || isTerminalSession) {
      revealedNameRequestRef.current = null;
      return;
    }
    if (revealedNameRequestRef.current === scope) return;
    let frame = 0;
    const reveal = () => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const title = nameRequestTitleRef.current;
        if (!title || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        title.focus({ preventScroll: true });
        title.closest("form")?.scrollIntoView({ block: "start", behavior: "instant" });
        revealedNameRequestRef.current = scope;
        observer.disconnect();
      });
    };
    // A teacher request waits for an open question/slide dialog to close.
    const observer = new MutationObserver(reveal);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"]
    });
    reveal();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [current?.nameRequested, isJoined, isTerminalSession, scope]);

  useEffect(() => {
    if (!participantToken || !normalizedCode) return undefined;
    const delivery = trackStudentDelivery((sessionId, completed, signal) =>
      acknowledgeStudentDelivery(
        normalizedCode,
        participantToken,
        sessionId,
        completed,
        signal,
        user?.id
      )
    );
    const connection = connectStudentSession(
      normalizedCode,
      participantToken,
      (next) => {
        if (commitSnapshot(next, scope)) setSnapshotSyncing(false);
      },
      (state) => {
        setConnectionState(state);
        if (state === "CONNECTED") {
          setSnapshotSyncing(true);
          void refetch({ cancelRefetch: false }).finally(() => {
            if (scopeRef.current === scope) setSnapshotSyncing(false);
          });
        }
      },
      async () => {
        // Initial reads, manual refreshes and fallback polling share React
        // Query's one request. A reconnect must not create a parallel GET.
        const result = await refetch({ cancelRefetch: false });
        if (result.error) throw result.error;
        if (!result.data) throw new ApiError(0, "Не удалось обновить занятие.");
        return result.data;
      },
      delivery.received
    );
    reconnectRef.current = connection.reconnect;
    return () => {
      reconnectRef.current = () => undefined;
      connection.disconnect();
      delivery.stop();
    };
  }, [normalizedCode, participantToken, refetch, scope, user?.id]);

  const slideLabel = current ? `${current.currentSlideIdx} из ${current.slideCount}` : "";
  const feedbackUnavailableMessage =
    current?.status === "SCHEDULED"
      ? "Показ ещё не начался. Отправить сигнал или вопрос можно будет, когда преподаватель начнёт занятие."
      : current?.status === "PAUSED"
        ? "Преподаватель поставил показ на паузу. Сигналы и вопросы станут доступны после продолжения."
        : "Восстанавливаем связь. Сигналы и вопросы станут доступны после подключения.";

  if (sessionQuery.isLoading && !current) {
    return <StudentSessionLoading />;
  }

  if (!current) {
    const notFound = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404;
    return notFound ? (
      <StudentSessionError />
    ) : (
      <StudentSessionError
        title="Не удалось открыть занятие"
        description="Проверьте подключение. Черновик вопроса сохранён."
        onRetry={() => void sessionQuery.refetch()}
      />
    );
  }

  const nameForm =
    isJoined && !isTerminalSession && (current.nameRequested || editingName) ? (
      <form
        className="student-name-request"
        onSubmit={(event) => {
          event.preventDefault();
          nameMut.mutate();
        }}
      >
        <h2 ref={nameRequestTitleRef} tabIndex={-1}>
          {current.nameRequested
            ? "Преподаватель просит указать имя и фамилию"
            : "Ваше имя на лекции"}
        </h2>
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
        <Button
          type="submit"
          disabled={
            nameMut.isPending ||
            snapshotSyncing ||
            sessionQuery.isError ||
            !["CONNECTED", "POLLING"].includes(connectionState)
          }
        >
          Отправить преподавателю
        </Button>
        {!current.nameRequested && (
          <Button type="button" variant="ghost" onClick={() => setEditingName(false)}>
            Отмена
          </Button>
        )}
      </form>
    ) : null;

  return (
    <main className="student-session-shell">
      <header className="student-session-topbar">
        <div className="live-mobile-brand">
          <BrandMark />
          <strong>Занятие</strong>
        </div>
        <div className="student-session-topbar__actions">
          <ThemeToggle compact />
        </div>
      </header>
      <div className="student-session-context">
        <h1>{current.lectureTitle}</h1>
      </div>

      {current.kicked && !isTerminalSession && (
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

      {current.nameRequested && nameForm}

      {(current.status === "ENDED" || current.status === "ARCHIVED") && (
        <div className="student-session-notice student-session-notice--ended" role="status">
          <CircleStop size={22} aria-hidden="true" />
          <div>
            <strong>Лекция завершена</strong>
            <span>Показ и отправка ответов остановлены.</span>
            <div className="student-session-ended-actions">
              {user && (
                <LinkButton to="/home" variant="outline">
                  На главную
                </LinkButton>
              )}
              <LinkButton to="/student/join">Другое занятие</LinkButton>
            </div>
          </div>
        </div>
      )}

      {isJoined && !isTerminalSession && (
        <section className="student-slide-card">
          <ScreenShareViewer
            joinCode={normalizedCode}
            participantToken={participantToken}
            paused={current.status === "PAUSED"}
            onFrameToChat={() => frameChatMut.mutate()}
            frameToChatPending={frameChatMut.isPending}
          >
            <div className="student-slide-meta">
              <span>Слайд {slideLabel}</span>
              {current.currentSlide && (
                <StudentSlideViewer
                  slide={current.currentSlide}
                  restoreFocusOnClose={!current.nameRequested}
                />
              )}
              {user &&
                current.currentSlide &&
                (current.status === "LIVE" || current.status === "PAUSED") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !commandsReady ||
                      slideChatMut.isPending ||
                      requestedSlideIdx === current.currentSlideIdx
                    }
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
                <img
                  ref={slideImageRef}
                  src={current.currentSlide.imageUrl}
                  alt={`Слайд ${current.currentSlide.idx}`}
                />
                <DrawingOverlay
                  imageRef={slideImageRef}
                  slideIdx={current.currentSlide.idx}
                  annotations={(current.annotations ?? {}) as LiveAnnotations}
                  active={false}
                  onChange={() => undefined}
                />
              </div>
            ) : (
              <div className="student-slide-empty">Слайд пока не выбран</div>
            )}
          </ScreenShareViewer>
        </section>
      )}

      {isTerminalSession ? (
        <section className="student-action-panel student-action-panel--feedback">
          {current.activePoll && (
            <StudentPollCard
              poll={current.activePoll}
              myVote={myVote}
              myTextAnswer={current.myTextAnswer ?? null}
              isLive={false}
              isPending={false}
              onAnswer={() => undefined}
            />
          )}
          <StudentFeedbackControls
            readOnly
            isLive={false}
            isSignalPending={false}
            isQuestionPending={false}
            lastSignal={null}
            question=""
            questions={mergeStudentQuestions(current.myQuestions ?? [], questions)}
            answers={current.questionAnswers ?? []}
            onSignal={() => undefined}
            onQuestionChange={() => undefined}
            onQuestionSubmit={() => undefined}
            anonymous={false}
            onAnonymousChange={() => undefined}
          />
        </section>
      ) : current.kicked ? null : !isJoined ? (
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
          <StudentConnectionBanner
            state={connectionState}
            lastSyncedAt={lastSyncedAt}
            onRetry={() => {
              setSnapshotSyncing(true);
              reconnectRef.current();
              void refetch({ cancelRefetch: false }).finally(() => {
                if (scopeRef.current === scope) setSnapshotSyncing(false);
              });
            }}
            syncing={snapshotSyncing}
            error={Boolean(sessionQuery.error)}
          />
          {current.activePoll && (
            <StudentPollCard
              poll={current.activePoll}
              myVote={myVote}
              myTextAnswer={current.myTextAnswer ?? null}
              isLive={commandsReady}
              isPending={pollMut.isPending}
              onAnswer={(optionIdx) =>
                pollMut.mutate({ pollId: current.activePoll!.pollId, optionIdx })
              }
            />
          )}
          <StudentFeedbackControls
            isLive={commandsReady}
            restoreFocusOnClose={!current.nameRequested}
            unavailableMessage={feedbackUnavailableMessage}
            isSignalPending={signalMut.isPending}
            isQuestionPending={questionMut.isPending}
            lastSignal={lastSignal}
            question={question}
            questions={mergeStudentQuestions(current.myQuestions ?? [], questions)}
            answers={current.questionAnswers ?? []}
            onSignal={(value) => signalMut.mutate({ value, slideIdx: current.currentSlideIdx })}
            onQuestionChange={setQuestion}
            onQuestionSubmit={() => {
              const request = { text: question.trim(), anonymous: questionAnonymous };
              questionMut.mutate({
                ...request,
                scope,
                operationKey: pendingQuestion.current.forPayload({ scope, request })
              });
            }}
            questionError={questionMut.isError}
            anonymous={questionAnonymous}
            onAnonymousChange={setQuestionAnonymous}
          />
        </section>
      )}

      <details className="student-session-details">
        <summary>О занятии</summary>
        <dl>
          {current.courseTitle && (
            <div>
              <dt>Курс</dt>
              <dd>{current.courseTitle}</dd>
            </div>
          )}
          <div>
            <dt>Состояние</dt>
            <dd>{STATUS_LABELS[current.status]}</dd>
          </div>
          <div>
            <dt>Код занятия</dt>
            <dd>{current.joinCode}</dd>
          </div>
        </dl>
        {isJoined && !isTerminalSession && !current.nameRequested && !editingName && (
          <Button variant="outline" onClick={() => setEditingName(true)}>
            Указать имя и фамилию
          </Button>
        )}
        {!current.nameRequested && nameForm}
      </details>
    </main>
  );
}

function mergeStudentSnapshot(
  next: StudentSessionSnapshot,
  previous: StudentSessionSnapshot | null
): StudentSessionSnapshot {
  const sameSession = previous?.sessionId === next.sessionId;
  const samePoll = sameSession && previous?.activePoll?.pollId === next.activePoll?.pollId;
  return {
    ...next,
    myVote: next.myVote ?? (samePoll ? previous?.myVote ?? null : null),
    myTextAnswer: next.myTextAnswer ?? (samePoll ? previous?.myTextAnswer ?? null : null),
    myQuestions: mergeStudentQuestions(
      next.myQuestions ?? [],
      sameSession ? previous?.myQuestions ?? [] : []
    )
  };
}

function mergeStudentQuestions(
  current: StudentQuestion[],
  saved: StudentQuestion[]
): StudentQuestion[] {
  const questions = new Map<string, StudentQuestion>();
  for (const question of saved) questions.set(question.id, question);
  for (const question of current) questions.set(question.id, question);
  return [...questions.values()].sort(
    (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
  );
}
