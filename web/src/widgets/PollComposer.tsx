import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Play, Plus, X } from "lucide-react";
import { getLiveSession } from "../app/api/live-api";
import { Button, IconButton } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Input } from "../shared/ui/input";
import { Textarea } from "../shared/ui/textarea";
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
  blocked?: boolean;
  error?: string;
  container?: HTMLElement;
  onCancel: () => void;
  onStart: (draft: PollDraft) => void;
}

export function PollComposer({
  courseId,
  sessionId,
  pending,
  blocked = false,
  error,
  container,
  onCancel,
  onStart
}: PollComposerProps) {
  const [quick, setQuick] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const formId = useId();
  const questionId = `${formId}-question`;
  const session = useQuery({
    queryKey: ["live", courseId, sessionId],
    meta: { connectionSync: true },
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const canStart =
    !pending &&
    !blocked &&
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
        blocked={blocked}
        error={
          error ??
          (blocked ? "Нет связи с занятием. Черновик сохранён, ждём восстановления." : undefined)
        }
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
        <form
          id={formId}
          className="poll-composer"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (canStart)
              onStart({
                questionText: question.trim(),
                options: options.map((option) => option.trim())
              });
          }}
        >
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setQuick(false)}>
            <ArrowLeft size={16} aria-hidden="true" />
            Выбрать из банка
          </Button>
          <label htmlFor={questionId}>Текст вопроса</label>
          <Textarea
            id={questionId}
            className="poll-question-input"
            disabled={pending}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Что хотите спросить у студентов?"
            rows={3}
            maxLength={500}
          />
          <fieldset className="poll-options-list" disabled={pending}>
            <legend>Варианты ответа</legend>
            {options.map((option, index) => (
              <div key={index} className="poll-option-row">
                <label className="poll-option-number" htmlFor={`${formId}-option-${index}`}>
                  <span className="sr-only">Вариант </span>
                  {index + 1}
                </label>
                <Input
                  id={`${formId}-option-${index}`}
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
                    type="button"
                    className="poll-icon-button"
                    disabled={pending}
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
          </fieldset>
          {options.length < 6 && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOptions([...options, ""])}
            >
              <Plus size={14} />
              Добавить вариант
            </Button>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {blocked && !error && (
            <p className="muted" role="status">
              Нет связи с занятием. Черновик сохранён, ждём восстановления.
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" form={formId} disabled={!canStart}>
            <Play size={16} aria-hidden="true" />
            {pending ? "Запускаем…" : "Запустить вопрос"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
