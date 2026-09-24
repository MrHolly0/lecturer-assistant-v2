import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, CheckCircle2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { closePoll, getActivePoll, startPoll } from "../app/api/interaction-api";
import { pluralizeRu } from "../shared/lib/plural";

interface Props {
  courseId: string;
  sessionId: string;
}

type View = "idle" | "create";

export function PollPanel({ courseId, sessionId }: Props) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("idle");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [markedCorrect, setMarkedCorrect] = useState<number | undefined>(undefined);

  const activeQuery = useQuery({
    queryKey: ["poll", courseId, sessionId, "active"],
    queryFn: () => getActivePoll(courseId, sessionId),
    refetchInterval: 1500
  });
  const activePoll = activeQuery.data;

  const startMut = useMutation({
    mutationFn: () => startPoll(courseId, sessionId, { questionText: question.trim(), options }),
    onSuccess: (result) => {
      qc.setQueryData(["poll", courseId, sessionId, "active"], result);
      setView("idle");
      setQuestion("");
      setOptions(["", ""]);
      setMarkedCorrect(undefined);
      toast.success("Опрос запущен.");
    },
    onError: () => toast.error("Не удалось запустить опрос.")
  });

  const closeMut = useMutation({
    mutationFn: (pollId: string) => closePoll(courseId, sessionId, pollId, markedCorrect),
    onSuccess: (result) => {
      qc.setQueryData(["poll", courseId, sessionId, "active"], result);
      toast.success("Опрос закрыт.");
    },
    onError: () => toast.error("Не удалось закрыть опрос.")
  });

  if (activePoll) {
    const total = activePoll.totalResponses;
    return (
      <div className="poll-panel">
        <div className="poll-panel-header">
          <BarChart2 size={14} />
          <span className="poll-panel-title">{activePoll.poll.questionText}</span>
          <span className="poll-response-count">
            {total} {pluralizeRu(total, "ответ", "ответа", "ответов")}
          </span>
        </div>
        <div className="poll-bars">
          {activePoll.poll.options.map((opt, idx) => {
            const count = activePoll.votes[idx] ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const isClosed = activePoll.poll.status === "CLOSED";
            const isCorrect = isClosed
              ? activePoll.poll.correctOptionIdx === idx
              : markedCorrect === idx;
            return (
              <button
                key={idx}
                type="button"
                className={`poll-bar-row${isCorrect ? " poll-bar-row--correct" : ""}`}
                onClick={() =>
                  !isClosed && setMarkedCorrect(markedCorrect === idx ? undefined : idx)
                }
              >
                <span className="poll-bar-label">
                  {isCorrect && <CheckCircle2 size={12} />}
                  {opt}
                </span>
                <div className="poll-bar-track">
                  <div className="poll-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="poll-bar-pct">{pct}%</span>
              </button>
            );
          })}
        </div>
        {activePoll.poll.status === "OPEN" && (
          <button
            type="button"
            className="btn-primary"
            disabled={closeMut.isPending}
            onClick={() => closeMut.mutate(activePoll.poll.id)}
          >
            Закрыть и показать результат
          </button>
        )}
      </div>
    );
  }

  if (view === "create") {
    const canStart =
      !startMut.isPending &&
      question.trim().length > 0 &&
      options.length >= 2 &&
      options.every((o) => o.trim().length > 0);
    return (
      <div className="poll-panel">
        <div className="poll-panel-header">
          <span className="poll-panel-title">Новый опрос</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setView("idle")}
            aria-label="Закрыть редактор опроса"
            title="Закрыть редактор"
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          className="poll-question-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Текст вопроса"
          rows={2}
          maxLength={500}
        />
        <div className="poll-options-list">
          {options.map((opt, idx) => (
            <div key={idx} className="poll-option-row">
              <input
                className="poll-option-input"
                value={opt}
                onChange={(e) => {
                  const next = [...options];
                  next[idx] = e.target.value;
                  setOptions(next);
                }}
                placeholder={`Вариант ${idx + 1}`}
                maxLength={200}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                  aria-label={`Удалить вариант ${idx + 1}`}
                  title={`Удалить вариант ${idx + 1}`}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < 6 && (
          <button type="button" className="btn-ghost" onClick={() => setOptions([...options, ""])}>
            <Plus size={12} />
            Добавить вариант
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={!canStart}
          onClick={() => startMut.mutate()}
        >
          Запустить опрос
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="btn-ghost poll-launch-btn" onClick={() => setView("create")}>
      <BarChart2 size={14} />
      Опрос
    </button>
  );
}
