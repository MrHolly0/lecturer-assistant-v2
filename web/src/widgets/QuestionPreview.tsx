import { Check } from "lucide-react";
import type { QuestionBankEntry } from "../app/api/interaction-api";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { questionAvailability } from "../shared/lib/questionAvailability";

export function QuestionPreview({ question }: { question: QuestionBankEntry }) {
  const availability = questionAvailability(question);
  return (
    <div className="question-preview">
      <span className="question-catalog__type">
        {QUESTION_TYPES.find((type) => type.value === question.questionType)?.label}
      </span>
      <h3>{question.text}</h3>
      {question.questionType === "SHORT_ANSWER" ? (
        <>
          <textarea
            className="qbank-textarea"
            readOnly
            rows={3}
            aria-label="Пример текстового ответа"
            placeholder="Ответ студента"
          />
          <p className="muted">Свободный текст, без автоматической оценки.</p>
        </>
      ) : (
        <ul>
          {question.options.map((option, index) => (
            <li
              key={index}
              className={`question-catalog__answer${option.correct ? " is-correct" : ""}`}
            >
              {option.correct && <Check size={18} aria-hidden="true" />}
              <span>{option.text}</span>
              {option.correct && <small>Правильный ответ</small>}
            </li>
          ))}
        </ul>
      )}
      {availability && <p className="muted">{availability}</p>}
    </div>
  );
}
