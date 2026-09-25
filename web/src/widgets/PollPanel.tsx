import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  closePoll,
  getActivePoll,
  startPoll,
  startPollFromBank
} from "../app/api/interaction-api";
import { userErrorMessage } from "../app/api/errors";
import { pluralizeRu } from "../shared/lib/plural";
import { PollComposer, type PollDraft } from "./PollComposer";

interface Props {
  courseId: string;
  sessionId: string;
}

type View = "idle" | "create";

export function PollPanel({ courseId, sessionId }: Props) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("idle");
  const [markedCorrect, setMarkedCorrect] = useState<number | undefined>(undefined);

  const activeQuery = useQuery({
    queryKey: ["poll", courseId, sessionId, "active"],
    queryFn: () => getActivePoll(courseId, sessionId),
    refetchInterval: 1500
  });
  const activePoll = activeQuery.data;

  const startMut = useMutation({
    mutationFn: (draft: PollDraft) =>
      draft.questionId
        ? startPollFromBank(courseId, sessionId, { questionId: draft.questionId })
        : startPoll(courseId, sessionId, {
            questionText: draft.questionText,
            options: draft.options
          }),
    onSuccess: (result, draft) => {
      qc.setQueryData(["poll", courseId, sessionId, "active"], result);
      setView("idle");
      setMarkedCorrect(result.poll.correctOptionIdx ?? draft.correctOptionIdx);
      toast.success("Опрос запущен.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось запустить опрос."))
  });

  const closeMut = useMutation({
    mutationFn: (pollId: string) => closePoll(courseId, sessionId, pollId, markedCorrect),
    onSuccess: (result) => {
      qc.setQueryData(["poll", courseId, sessionId, "active"], result);
      toast.success("Опрос закрыт.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось закрыть опрос."))
  });

  useEffect(() => {
    if (activePoll?.poll.status === "CLOSED") setMarkedCorrect(undefined);
  }, [activePoll?.poll.id, activePoll?.poll.status]);

  if (activeQuery.isError) {
    return (
      <div className="poll-panel poll-panel-error" role="alert">
        <p>{userErrorMessage(activeQuery.error, "Не удалось проверить состояние опроса.")}</p>
        <button type="button" className="btn-ghost" onClick={() => activeQuery.refetch()}>
          Повторить
        </button>
      </div>
    );
  }

  if (view === "create") {
    return (
      <PollComposer
        courseId={courseId}
        pending={startMut.isPending}
        onCancel={() => setView("idle")}
        onStart={(draft) => startMut.mutate(draft)}
      />
    );
  }

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
        {activePoll.poll.status === "CLOSED" && (
          <button type="button" className="btn-ghost" onClick={() => setView("create")}>
            <Plus size={14} />
            Новая проверка
          </button>
        )}
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
