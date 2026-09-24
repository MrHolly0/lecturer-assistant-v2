import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, HelpCircle, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import {
  askStudentQuestion,
  connectStudentSession,
  getStudentSession,
  joinStudentSession,
  submitStudentSignal,
  type SignalValue,
  type StudentQuestion,
  type StudentSessionSnapshot
} from "../app/api/student-api";
import { respondToPoll } from "../app/api/interaction-api";
import { useAuth } from "../app/AuthContext";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";

interface StudentSessionPageProps {
  joinCode: string;
}

const SIGNALS: Array<{ value: SignalValue; label: string; helper: string }> = [
  { value: "GREEN", label: "Понятно", helper: "идем дальше" },
  { value: "YELLOW", label: "Есть вопрос", helper: "нужно медленнее" },
  { value: "RED", label: "Не понимаю", helper: "нужна остановка" }
];

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
  const [displayName, setDisplayName] = useState("");
  const [question, setQuestion] = useState("");
  const [lastSignal, setLastSignal] = useState<SignalValue | null>(null);
  const [snapshot, setSnapshot] = useState<StudentSessionSnapshot | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
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
    onError: () => toast.error("Не удалось отправить сигнал. Попробуйте ещё раз.")
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
      setMyVote(result.myVote);
      setSnapshot((value) => (value ? { ...value, myVote: result.myVote } : value));
      toast.success(result.accepted ? "Ответ принят." : "Ваш первый ответ уже сохранён.");
    },
    onError: () => toast.error("Не удалось отправить ответ.")
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
    const disconnect = connectStudentSession(normalizedCode, participantToken, (next) => {
      setSnapshot((previous) => ({
        ...next,
        myVote:
          next.myVote ??
          (previous?.activePoll?.pollId === next.activePoll?.pollId ? previous?.myVote : null)
      }));
    });
    return disconnect;
  }, [normalizedCode, participantToken]);

  const slideLabel = useMemo(() => {
    if (!current) return "";
    return `${current.currentSlideIdx} / ${current.slideCount}`;
  }, [current]);

  function join(event: FormEvent) {
    event.preventDefault();
    joinMut.mutate();
  }

  function sendQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    questionMut.mutate();
  }

  function sendSignal(value: SignalValue) {
    signalMut.mutate(value);
  }

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
        <section className="student-action-panel">
          {user ? (
            <div className="student-profile-join" aria-live="polite">
              <h2>Подключаем к лекции</h2>
              {joinMut.isError ? (
                <>
                  <p className="form-error" role="alert">
                    Не удалось подключиться от имени {user.displayName}.
                  </p>
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={joinMut.isPending}
                    onClick={() => joinMut.mutate()}
                  >
                    Попробовать снова
                  </button>
                </>
              ) : (
                <p className="muted">Имя участника: {user.displayName}</p>
              )}
            </div>
          ) : (
            <>
              <h2>Как вас показать преподавателю?</h2>
              <form onSubmit={join} className="student-join-form">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Имя на лекции"
                  maxLength={80}
                />
                <button className="btn-primary" type="submit" disabled={joinMut.isPending}>
                  Подключиться
                </button>
              </form>
            </>
          )}
        </section>
      ) : (
        <section className="student-action-panel">
          {current.activePoll && (
            <div className="student-poll-card">
              <div className="student-poll-heading">
                <span className="student-poll-kicker">
                  {current.activePoll.status === "OPEN" ? "Вопрос-проверка" : "Результат"}
                </span>
                <h2 className="student-poll-question">{current.activePoll.questionText}</h2>
              </div>
              {current.activePoll.status === "OPEN" && myVote === null ? (
                <div className="student-poll-options">
                  {current.activePoll.options.map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="student-poll-option"
                      disabled={pollMut.isPending || !isLive}
                      aria-label={`Ответить: ${opt}`}
                      onClick={() =>
                        pollMut.mutate({ pollId: current.activePoll!.pollId, optionIdx: idx })
                      }
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : current.activePoll.status === "OPEN" ? (
                <div className="student-poll-waiting" role="status">
                  <CheckCircle2 size={20} />
                  <div>
                    <strong>Ваш ответ сохранён</strong>
                    <span>{current.activePoll.options[myVote ?? -1]}</span>
                  </div>
                  <p>Результат появится, когда преподаватель закроет опрос.</p>
                </div>
              ) : (
                <div className="student-poll-bars">
                  {current.activePoll.options.map((opt, idx) => {
                    const votes = current.activePoll!.votes ?? [];
                    const total = votes.reduce((a, b) => a + b, 0);
                    const count = votes[idx] ?? 0;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    const isCorrect = current.activePoll!.correctOptionIdx === idx;
                    const isMyVote = myVote === idx;
                    return (
                      <div
                        key={idx}
                        className={[
                          "student-poll-bar-row",
                          isCorrect ? "student-poll-bar-row--correct" : "",
                          isMyVote ? "student-poll-bar-row--mine" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="student-poll-bar-label">
                          {opt}
                          <small>
                            {isCorrect && "Правильный ответ"}
                            {isCorrect && isMyVote && " · "}
                            {isMyVote && "Ваш ответ"}
                          </small>
                        </span>
                        <div className="student-poll-bar-track">
                          <div className="student-poll-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="student-poll-bar-pct">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {current.activePoll.status === "CLOSED" && myVote === null && (
                <p className="student-poll-closed muted">Вы не отвечали на этот вопрос.</p>
              )}
            </div>
          )}
          <div className="section-heading">
            <h2>Сигнал преподавателю</h2>
          </div>
          <div className="student-signal-grid">
            {SIGNALS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={[
                  "student-signal-btn",
                  `student-signal-btn--${item.value.toLowerCase()}`,
                  lastSignal === item.value ? "student-signal-btn--selected" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!isLive || signalMut.isPending}
                aria-pressed={lastSignal === item.value}
                onClick={() => sendSignal(item.value)}
              >
                <strong>
                  {lastSignal === item.value && <Check size={16} aria-hidden="true" />}
                  {item.label}
                </strong>
                <span>{item.helper}</span>
              </button>
            ))}
          </div>

          <form onSubmit={sendQuestion} className="student-question-form">
            <label htmlFor="student-question">Вопрос</label>
            <textarea
              id="student-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Напишите вопрос преподавателю"
              maxLength={1000}
              rows={3}
            />
            <button
              className="btn-primary"
              type="submit"
              disabled={!isLive || questionMut.isPending || !question.trim()}
            >
              <MessageSquareText size={16} />
              Отправить
            </button>
          </form>

          {questions.length > 0 && (
            <ul className="student-question-list">
              {questions.map((item) => (
                <li key={item.id}>
                  <span>{item.text}</span>
                  <small>{new Date(item.createdAt).toLocaleTimeString("ru-RU")}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
