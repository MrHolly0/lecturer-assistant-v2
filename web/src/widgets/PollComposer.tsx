import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { getLiveSession } from "../app/api/live-api";
import { Button, IconButton } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { QuestionPickerDialog } from "./QuestionPickerDialog";

export interface PollDraft {
  questionText: string;
  options: string[];
  questionId?: string;
}

interface PollComposerProps {
  courseId: string;
  sessionId: string;
  pending: boolean;
  error?: string;
  container?: HTMLElement;
  onCancel: () => void;
  onStart: (draft: PollDraft) => void;
}

export function PollComposer({
  courseId,
  sessionId,
  pending,
  error,
  container,
  onCancel,
  onStart
}: PollComposerProps) {
  const [quick, setQuick] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const session = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const canStart =
    !pending &&
    question.trim().length > 0 &&
    options.length >= 2 &&
    options.every((option) => option.trim().length > 0);
  if (!quick)
    return (
      <QuestionPickerDialog
        courseId={courseId}
        currentLectureId={session.data?.lectureId}
        currentLectureTitle={session.data?.lectureTitle}
        contextLoading={session.isLoading}
        contextError={session.isError ? "Не удалось определить текущую лекцию." : undefined}
        onRetryContext={() => void session.refetch()}
        pending={pending}
        error={error}
        container={container}
        onClose={onCancel}
        extraAction={
          <Button variant="ghost" disabled={pending} onClick={() => setQuick(true)}>
            <Plus size={16} />
            Быстрый вопрос
          </Button>
        }
        onConfirm={(item) =>
          onStart({
            questionId: item.id,
            questionText: item.text,
            options: item.options.map((option) => option.text)
          })
        }
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent container={container} className="quick-question-dialog">
        <DialogHeader>
          <DialogTitle>Быстрый вопрос</DialogTitle>
          <DialogDescription>Создайте проверку для текущего занятия.</DialogDescription>
        </DialogHeader>
        <Button variant="outline" disabled={pending} onClick={() => setQuick(false)}>
          Выбрать из банка
        </Button>
        <div className="poll-composer" aria-busy={pending}>
          <textarea
            className="poll-question-input"
            aria-label="Текст вопроса"
            disabled={pending}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Текст вопроса"
            rows={2}
            maxLength={500}
          />
          <div className="poll-options-list">
            {options.map((option, index) => (
              <div key={index} className="poll-option-row">
                <input
                  className="poll-option-input"
                  aria-label={`Вариант ${index + 1}`}
                  disabled={pending}
                  value={option}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = event.target.value;
                    setOptions(next);
                  }}
                  placeholder={`Вариант ${index + 1}`}
                  maxLength={200}
                />
                {options.length > 2 && (
                  <IconButton
                    className="poll-icon-button"
                    onClick={() =>
                      setOptions(options.filter((_, itemIndex) => itemIndex !== index))
                    }
                    label={`Удалить вариант ${index + 1}`}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          {options.length < 6 && (
            <Button type="button" variant="ghost" onClick={() => setOptions([...options, ""])}>
              <Plus size={14} />
              Добавить вариант
            </Button>
          )}
          <Button
            type="button"
            disabled={!canStart}
            onClick={() =>
              onStart({
                questionText: question.trim(),
                options: options.map((option) => option.trim())
              })
            }
          >
            <Check size={16} />
            Запустить
          </Button>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
