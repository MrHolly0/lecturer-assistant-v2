import type { FormEvent } from "react";
import { Check, MessageSquareText } from "lucide-react";
import type { SignalValue, StudentQuestion } from "../app/api/student-api";

const SIGNALS: Array<{ value: SignalValue; label: string; helper: string }> = [
  { value: "GREEN", label: "Понятно", helper: "идем дальше" },
  { value: "YELLOW", label: "Есть вопрос", helper: "нужно медленнее" },
  { value: "RED", label: "Не понимаю", helper: "нужна остановка" }
];

interface StudentFeedbackControlsProps {
  isLive: boolean;
  isSignalPending: boolean;
  isQuestionPending: boolean;
  lastSignal: SignalValue | null;
  question: string;
  questions: StudentQuestion[];
  onSignal: (value: SignalValue) => void;
  onQuestionChange: (value: string) => void;
  onQuestionSubmit: () => void;
}

export function StudentFeedbackControls(props: StudentFeedbackControlsProps) {
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
            <span>{item.helper}</span>
          </button>
        ))}
      </div>

      <form onSubmit={submitQuestion} className="student-question-form">
        <label htmlFor="student-question">Вопрос</label>
        <textarea
          id="student-question"
          value={props.question}
          onChange={(event) => props.onQuestionChange(event.target.value)}
          placeholder="Напишите вопрос преподавателю"
          maxLength={1000}
          rows={3}
        />
        <button
          className="btn-primary"
          type="submit"
          disabled={!props.isLive || props.isQuestionPending || !props.question.trim()}
        >
          <MessageSquareText size={16} />
          Отправить
        </button>
      </form>

      {props.questions.length > 0 && (
        <ul className="student-question-list">
          {props.questions.map((item) => (
            <li key={item.id}>
              <span>{item.text}</span>
              <small>{new Date(item.createdAt).toLocaleTimeString("ru-RU")}</small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
