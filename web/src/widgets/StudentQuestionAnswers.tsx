import { Globe2, LockKeyhole, MessageSquareReply } from "lucide-react";
import type { StudentQuestionAnswer } from "../app/api/student-api";

export function StudentQuestionAnswers({ answers }: { answers: StudentQuestionAnswer[] }) {
  if (answers.length === 0) return null;

  return (
    <section className="student-question-answers" aria-labelledby="student-answers-title">
      <div className="student-question-answers__heading">
        <MessageSquareReply size={20} aria-hidden="true" />
        <h2 id="student-answers-title">Ответы преподавателя</h2>
      </div>
      <ul>
        {answers.map((answer) => {
          const personal = answer.answerVisibility === "AUTHOR";
          return (
            <li key={answer.questionId}>
              <p className="student-question-answers__question">{answer.questionText}</p>
              <p className="student-question-answers__answer">{answer.answerText}</p>
              <small>
                {personal ? (
                  <LockKeyhole size={14} aria-hidden="true" />
                ) : (
                  <Globe2 size={14} aria-hidden="true" />
                )}
                {personal ? "Ответ только вам" : "Ответ для всех"} · {formatTime(answer.answeredAt)}
              </small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
