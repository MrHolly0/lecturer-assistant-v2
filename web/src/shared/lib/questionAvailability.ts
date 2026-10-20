import type { QuestionOption, QuestionType } from "../../app/api/interaction-api";

export function questionAvailability(question: {
  questionType: QuestionType;
  options: QuestionOption[];
}): string | null {
  if (question.questionType !== "CHOICE" && question.questionType !== "TRUE_FALSE") {
    return "Этот тип можно сохранить в банке. Запуск в занятии пока недоступен.";
  }
  if (question.options.length < 2 || question.options.length > 6) {
    return "Для запуска в занятии нужно от 2 до 6 вариантов.";
  }
  if (question.options.filter((option) => option.correct).length !== 1) {
    return "Для запуска в занятии нужен ровно один правильный ответ.";
  }
  return null;
}
