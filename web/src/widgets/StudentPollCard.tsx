import { CheckCircle2 } from "lucide-react";
import type { StudentActivePoll } from "../app/api/student-api";
import { Button } from "../shared/ui/button";
import { PollOptionText } from "./PollOptionText";

interface StudentPollCardProps {
  poll: StudentActivePoll;
  myVote: number | null;
  isLive: boolean;
  isPending: boolean;
  onAnswer: (optionIdx: number) => void;
}

export function StudentPollCard({
  poll,
  myVote,
  isLive,
  isPending,
  onAnswer
}: StudentPollCardProps) {
  return (
    <div className="student-poll-card">
      <div className="student-poll-heading">
        <span className="student-poll-kicker">
          {poll.status === "OPEN" ? "Вопрос-проверка" : "Результат"}
        </span>
        <h2 className="student-poll-question">{poll.questionText}</h2>
      </div>
      {poll.status === "OPEN" && myVote === null ? (
        <div className="student-poll-options">
          {poll.options.map((option, idx) => (
            <article key={idx} className="student-poll-option-card">
              <PollOptionText text={option} />
              <Button
                type="button"
                variant="outline"
                className="student-poll-option"
                disabled={isPending || !isLive}
                onClick={() => onAnswer(idx)}
              >
                Выбрать вариант {idx + 1}
              </Button>
            </article>
          ))}
        </div>
      ) : poll.status === "OPEN" ? (
        <div className="student-poll-waiting" role="status">
          <CheckCircle2 size={20} />
          <div>
            <strong>Ваш ответ сохранён</strong>
            <span>{poll.options[myVote ?? -1]}</span>
          </div>
          <p>Результат появится, когда преподаватель закроет опрос.</p>
        </div>
      ) : (
        <PollResult poll={poll} myVote={myVote} />
      )}
      {poll.status === "CLOSED" && myVote === null && (
        <p className="student-poll-closed muted">Вы не отвечали на этот вопрос.</p>
      )}
    </div>
  );
}

function PollResult({ poll, myVote }: { poll: StudentActivePoll; myVote: number | null }) {
  const votes = poll.votes ?? [];
  const total = votes.reduce((sum, value) => sum + value, 0);

  return (
    <div className="student-poll-bars">
      {poll.options.map((option, idx) => {
        const count = votes[idx] ?? 0;
        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        const isCorrect = poll.correctOptionIdx === idx;
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
            <div className="student-poll-bar-label">
              <PollOptionText text={option} />
              <small>
                {isCorrect && (
                  <>
                    <CheckCircle2 size={15} aria-hidden="true" /> Правильный ответ
                  </>
                )}
                {isCorrect && isMyVote && " · "}
                {isMyVote && "Ваш ответ"}
              </small>
            </div>
            <div className="student-poll-bar-track">
              <div className="student-poll-bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="student-poll-bar-pct">{percent}%</span>
          </div>
        );
      })}
    </div>
  );
}
