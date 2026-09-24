import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HelpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  askStudentQuestion,
  connectStudentSession,
  getStudentSession,
  joinStudentSession,
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
  const normalizedCode = joinCode.trim().toUpperCase();
  const storageKey = `student-session:${normalizedCode}`;
  const [participantToken, setParticipantToken] = useState(() =>
    user ? "" : sessionStorage.getItem(storageKey) ?? ""
  );
  const autoJoinRequested = useRef(false);
  const reconnectRef = useRef<() => void>(() => undefined);
  const [displayName, setDisplayName] = useState("");
  const [question, setQuestion] = useState("");
  const [lastSignal, setLastSignal] = useState<SignalValue | null>(null);
  const [snapshot, setSnapshot] = useState<StudentSessionSnapshot | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<StudentConnectionState>("CONNECTING");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["student-session", normalizedCode, participantToken],
    queryFn: () => getStudentSession(normalizedCode, participantToken),
    enabled: Boolean(normalizedCode)
  });
  const current = snapshot ?? sessionQuery.data ?? null;
  const isLive = current?.status === "LIVE";
  const isJoined = Boolean(participantToken);

  const joinMut = useMutation({
    mutationFn: () => joinStudentSession(normalizedCode, user ? undefined : displayName.trim()),
    onSuccess: (response) => {
      sessionStorage.setItem(storageKey, response.participantToken);
      setParticipantToken(response.participantToken);
      setSnapshot(response.snapshot);
      toast.success("Вы подключены к лекции.");
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
    }
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

  useEffect(() => {
    if (!sessionQuery.data) return;
    setSnapshot(sessionQuery.data);
    setMyVote(sessionQuery.data.myVote ?? null);
  }, [sessionQuery.data]);

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

  const slideLabel = useMemo(() => {
    if (!current) return "";
    return `${current.currentSlideIdx} / ${current.slideCount}`;
  }, [current]);

  if (sessionQuery.isLoading && !current) {
    return (
      <main className="student-session-shell student-session-shell--center">
        <Loader2 className="student-spinner" size={24} />
        Загрузка лекции...
      </main>
    );
  }

  if (sessionQuery.isError || !current) {
    return (
      <main className="student-session-shell student-session-shell--center">
        <HelpCircle size={28} />
        <h1>Лекция не найдена</h1>
        <p className="muted">Проверьте код подключения у преподавателя.</p>
      </main>
    );
  }

  return (
    <main className="student-session-shell">
      <header className="student-session-topbar">
        <div>
          <span className="muted">Код {current.joinCode}</span>
          <h1>{current.lectureTitle}</h1>
        </div>
        <span className={`badge student-status student-status--${current.status.toLowerCase()}`}>
          {STATUS_LABELS[current.status]}
        </span>
      </header>

      {isJoined && (
        <StudentConnectionBanner
          state={connectionState}
          lastSyncedAt={lastSyncedAt}
          onRetry={() => reconnectRef.current()}
        />
      )}

      <section className="student-slide-card">
        <div className="student-slide-meta">
          <span>Слайд {slideLabel}</span>
          {!isLive && <span className="muted">Показ сейчас не идет</span>}
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

      {!isJoined ? (
        <StudentJoinPanel
          displayName={displayName}
          userName={user?.displayName}
          isPending={joinMut.isPending}
          isError={joinMut.isError}
          onDisplayNameChange={setDisplayName}
          onJoin={() => joinMut.mutate()}
        />
      ) : (
        <section className="student-action-panel">
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
            onSignal={(value) => signalMut.mutate(value)}
            onQuestionChange={setQuestion}
            onQuestionSubmit={() => questionMut.mutate()}
          />
        </section>
      )}
    </main>
  );
}
