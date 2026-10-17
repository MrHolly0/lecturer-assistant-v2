import { useEffect, useState, type FormEvent } from "react";
import { Check, EyeOff, MessageSquareText } from "lucide-react";
import type { SignalValue, StudentQuestion, StudentQuestionAnswer } from "../app/api/student-api";
import { Button } from "../shared/ui/button";
import { StudentQuestionAnswers } from "./StudentQuestionAnswers";

const SIGNALS: Array<{ value: SignalValue; label: string }> = [
  { value: "GREEN", label: "Понятно" },
  { value: "YELLOW", label: "Есть вопрос" },
  { value: "RED", label: "Не понимаю" }
];

interface StudentFeedbackControlsProps {
  isLive: boolean;
  isSignalPending: boolean;
  isQuestionPending: boolean;
  lastSignal: SignalValue | null;
  question: string;
  anonymous: boolean;
  questions: StudentQuestion[];
  answers: StudentQuestionAnswer[];
  onSignal: (value: SignalValue) => void;
  onQuestionChange: (value: string) => void;
  onQuestionSubmit: () => void;
  questionError?: boolean;
  onAnonymousChange: (value: boolean) => void;
}

export function StudentFeedbackControls(props: StudentFeedbackControlsProps) {
  const [questionOpen, setQuestionOpen] = useState(false);
  useEffect(() => {
    if (!props.question) setQuestionOpen(false);
  }, [props.question]);
  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (props.question.trim()) props.onQuestionSubmit();
  }

  return (
    <>
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
              props.lastSignal === item.value ? "student-signal-btn--selected" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={!props.isLive || props.isSignalPending}
            aria-pressed={props.lastSignal === item.value}
            onClick={() => props.onSignal(item.value)}
          >
            <strong>
              {props.lastSignal === item.value && <Check size={16} aria-hidden="true" />}
              {item.label}
            </strong>
            <span>{props.lastSignal === item.value ? "Сигнал отправлен" : "Отправить сигнал"}</span>
          </button>
        ))}
      </div>

      <section className="student-question-entry">
        <Button
          type="button"
          variant="outline"
          aria-expanded={questionOpen}
          onClick={() => setQuestionOpen((open) => !open)}
        >
          <MessageSquareText size={17} aria-hidden="true" />{" "}
          {questionOpen ? "Скрыть форму вопроса" : "Задать вопрос"}
        </Button>
        {questionOpen && (
          <form onSubmit={submitQuestion} className="student-question-form">
            <label htmlFor="student-question">Ваш вопрос</label>
            <p id="question-audience-hint" className="question-privacy-hint">
              {props.anonymous
                ? "Сотрудники и участники занятия не увидят ваше имя. Аккаунт используется для доставки личного ответа. Преподаватель может опубликовать вопрос и ответ для участников занятия без имени автора."
                : "Вопрос и ваше имя увидят сотрудники с доступом к занятию. Преподаватель может опубликовать вопрос и ответ для участников занятия без имени автора."}
            </p>
            <textarea
              id="student-question"
              value={props.question}
              onChange={(event) => props.onQuestionChange(event.target.value)}
              placeholder="Напишите вопрос преподавателю"
              maxLength={1000}
              rows={3}
              aria-describedby="question-audience-hint"
            />
            <label className="question-anonymous-option">
              <input
                type="checkbox"
                checked={props.anonymous}
                onChange={(event) => props.onAnonymousChange(event.target.checked)}
                disabled={props.isQuestionPending}
              />
              <EyeOff size={17} aria-hidden="true" />
              Спросить анонимно
            </label>
            <Button
              type="submit"
              disabled={!props.isLive || props.isQuestionPending || !props.question.trim()}
            >
              <MessageSquareText size={16} aria-hidden="true" />
              {props.isQuestionPending
                ? "Отправляем вопрос…"
                : props.anonymous
                  ? "Отправить анонимно"
                  : "Отправить с именем"}
            </Button>
            {props.questionError && (
              <p className="student-question-error" role="alert">
                Не удалось отправить вопрос. Черновик сохранён. Проверьте связь и нажмите
                «Отправить» ещё раз.
              </p>
            )}
          </form>
        )}
      </section>

      <details className="student-my-questions">
        <summary>
          Мои вопросы и ответы{" "}
          <span>
            {
              new Set([
                ...props.questions.map((question) => question.id),
                ...props.answers.map((answer) => answer.questionId)
              ]).size
            }
          </span>
        </summary>
        <StudentQuestionAnswers answers={props.answers} />
        {props.questions.length > 0 ? (
          <ul className="student-question-list">
            {props.questions.map((item) => (
              <li key={item.id}>
                <span>{item.text}</span>
                {item.anonymous && <small>Анонимно</small>}
                <small>{new Date(item.createdAt).toLocaleTimeString("ru-RU")}</small>
              </li>
            ))}
          </ul>
        ) : props.answers.length === 0 ? (
          <p className="muted">Отправленные вопросы и ответы преподавателя появятся здесь.</p>
        ) : null}
      </details>
    </>
  );
}
