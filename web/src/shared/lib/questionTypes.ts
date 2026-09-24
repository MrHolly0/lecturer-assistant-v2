import type { QuestionType } from "../../app/api/interaction-api";

export const QUESTION_TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: "CHOICE", label: "Один правильный" },
  { value: "MULTIPLE_CHOICE", label: "Несколько правильных" },
  { value: "TRUE_FALSE", label: "Верно / Неверно" },
  { value: "SHORT_ANSWER", label: "Краткий ответ" }
];
