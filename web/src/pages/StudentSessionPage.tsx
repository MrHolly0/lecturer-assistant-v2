import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HelpCircle, Loader2, MessageSquareText } from "lucide-react";
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
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";

interface StudentSessionPageProps {
  joinCode: string;
}

const SIGNALS: Array<{ value: SignalValue; label: string; helper: string }> = [
  { value: "GREEN", label: "Понятно", helper: "идем дальше" },
  { value: "YELLOW", label: "Есть вопрос", helper: "нужно медленнее" },
  { value: "RED", label: "Не понимаю", helper: "нужна остановка" }
];

export function StudentSessionPage({ joinCode }: StudentSessionPageProps) {
  const normalizedCode = joinCode.trim().toUpperCase();
  const storageKey = `student-session:${normalizedCode}`;
  const [participantToken, setParticipantToken] = useState(
    () => sessionStorage.getItem(storageKey) ?? ""
  );
  const [displayName, setDisplayName] = useState("");
  const [question, setQuestion] = useState("");
  const [snapshot, setSnapshot] = useState<StudentSessionSnapshot | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const sessionQuery = useQuery({
    queryKey: ["student-session", normalizedCode],
    queryFn: () => getStudentSession(normalizedCode),
    enabled: Boolean(normalizedCode)
  });
  const current = snapshot ?? sessionQuery.data ?? null;
  const isLive = current?.status === "LIVE";
  const isJoined = Boolean(participantToken);

  const joinMut = useMutation({
    mutationFn: () => joinStudentSession(normalizedCode, displayName.trim()),
    onSuccess: (response) => {
      sessionStorage.setItem(storageKey, response.participantToken);
      setParticipantToken(response.participantToken);
      setSnapshot(response.snapshot);
      toast.success("Вы подключены к лекции.");
    }
  });
  const signalMut = useMutation({
    mutationFn: (value: SignalValue) =>
      submitStudentSignal(normalizedCode, participantToken, value),
    onSuccess: (signalAggregate) => {
      setSnapshot((value) => (value ? { ...value, signalAggregate } : value));
      toast.success("Сигнал отправлен.");
    }
  });
  const questionMut = useMutation({
    mutationFn: () => askStudentQuestion(normalizedCode, participantToken, question.trim()),
    onSuccess: (created) => {
      setQuestions((items) => [created, ...items]);
      setQuestion("");
      toast.success("Вопрос отправлен преподавателю.");
    }
  });

  useEffect(() => {
    if (sessionQuery.data) setSnapshot(sessionQuery.data);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!participantToken || !normalizedCode) return undefined;
    const disconnect = connectStudentSession(normalizedCode, participantToken, setSnapshot);
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
          {current.status}
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
        </section>
      ) : (
        <section className="student-action-panel">
          <div className="section-heading">
            <h2>Сигнал преподавателю</h2>
            <span className="muted">{current.signalAggregate.total} ответов</span>
          </div>
          <div className="student-signal-grid">
            {SIGNALS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`student-signal-btn student-signal-btn--${item.value.toLowerCase()}`}
                disabled={!isLive || signalMut.isPending}
                onClick={() => signalMut.mutate(item.value)}
              >
                <strong>{item.label}</strong>
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
