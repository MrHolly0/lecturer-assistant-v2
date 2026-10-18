import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  createQuestion,
  updateQuestion,
  type CreateQuestionRequest,
  type QuestionBankEntry,
  type QuestionOption,
  type QuestionType
} from "../app/api/interaction-api";
import { userErrorMessage } from "../app/api/errors";
import { Button, IconButton } from "../shared/ui/button";
import { Checkbox } from "../shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";

interface QuestionDialogProps {
  courseId: string;
  open: boolean;
  initial?: QuestionBankEntry;
  onClose: () => void;
  onSaved: () => void;
}

function emptyOptions(): QuestionOption[] {
  return [
    { text: "", correct: false },
    { text: "", correct: false }
  ];
}

function optionDrafts(initial?: QuestionBankEntry): Record<QuestionType, QuestionOption[]> {
  const drafts: Record<QuestionType, QuestionOption[]> = {
    CHOICE: emptyOptions(),
    MULTIPLE_CHOICE: emptyOptions(),
    TRUE_FALSE: [
      { text: "Верно", correct: true },
      { text: "Неверно", correct: false }
    ],
    SHORT_ANSWER: [{ text: "", correct: true }]
  };
  if (initial) {
    const savedOptions = initial.options
      .filter((option) => initial.questionType !== "SHORT_ANSWER" || option.correct)
      .map((option) => ({ ...option }));
    if (savedOptions.length > 0) drafts[initial.questionType] = savedOptions;
  }
  return drafts;
}

export function QuestionDialog({ courseId, open, initial, onClose, onSaved }: QuestionDialogProps) {
  const id = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [text, setText] = useState(initial?.text ?? "");
  const [type, setType] = useState<QuestionType>(initial?.questionType ?? "CHOICE");
  const [drafts, setDrafts] = useState(() => optionDrafts(initial));
  const options = drafts[type];
  const shortAnswer = type === "SHORT_ANSWER";
  function setOptions(update: (items: QuestionOption[]) => QuestionOption[]) {
    setDrafts((current) => ({ ...current, [type]: update(current[type]) }));
  }
  const [tagsText, setTagsText] = useState(initial?.tags.join(", ") ?? "");
  useEffect(() => {
    if (!open) return;
    setText(initial?.text ?? "");
    setType(initial?.questionType ?? "CHOICE");
    setDrafts(optionDrafts(initial));
    setTagsText(initial?.tags.join(", ") ?? "");
  }, [open, initial, courseId]);

  const saveMut = useMutation({
    mutationFn: () => {
      const request: CreateQuestionRequest = {
        text: text.trim(),
        questionType: type,
        options: options.map((option) => ({
          text: option.text.trim(),
          correct: shortAnswer || option.correct
        })),
        tags: [
          ...new Set(
            tagsText
              .split(",")
              .map((tag) => tag.trim().toLowerCase())
              .filter(Boolean)
          )
        ]
      };
      return initial
        ? updateQuestion(courseId, initial.id, request)
        : createQuestion(courseId, request);
    },
    onSuccess: () => {
      toast.success(initial ? "Вопрос обновлён." : "Вопрос создан.");
      onSaved();
    },
    onError: () => toast.error("Не удалось сохранить вопрос.")
  });
  const correctCount = options.filter((option) => option.correct).length;
  const validAnswers = shortAnswer
    ? options.length >= 1
    : options.length >= 2 && (type === "MULTIPLE_CHOICE" ? correctCount >= 1 : correctCount === 1);
  const canSave =
    text.trim().length > 0 &&
    validAnswers &&
    options.every((option) => option.text.trim().length > 0) &&
    !saveMut.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saveMut.isPending) onClose();
      }}
    >
      <DialogContent
        className="qbank-dialog preparation-dialog"
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{initial ? "Редактировать вопрос" : "Новый вопрос"}</DialogTitle>
          <DialogDescription className="sr-only">
            Текст, тип, варианты ответа и теги вопроса.
          </DialogDescription>
        </DialogHeader>
        <div className="preparation-dialog__body">
          <div className="qbank-field">
            <Label htmlFor={`${id}-type`}>Тип вопроса</Label>
            <Select
              value={type}
              disabled={Boolean(initial) || saveMut.isPending}
              onValueChange={(value) => setType(value as QuestionType)}
            >
              <SelectTrigger id={`${id}-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {initial && (
              <p className="muted qbank-hint">Чтобы изменить тип, создайте новый вопрос.</p>
            )}
          </div>
          <div className="qbank-field">
            <Label htmlFor={`${id}-text`}>Текст вопроса</Label>
            <textarea
              id={`${id}-text`}
              className="qbank-textarea"
              value={text}
              disabled={saveMut.isPending}
              onChange={(event) => setText(event.target.value)}
              placeholder="Введите текст вопроса"
              rows={4}
              maxLength={2000}
            />
          </div>
          <div className="qbank-field">
            <Label>{shortAnswer ? "Допустимые ответы" : "Варианты ответа"}</Label>
            <p className="muted qbank-hint">
              {type === "MULTIPLE_CHOICE"
                ? "Отметьте все правильные варианты."
                : shortAnswer
                  ? "Запишите один или несколько допустимых ответов. Все строки считаются правильными."
                  : "Отметьте один правильный вариант."}
            </p>
            {shortAnswer && initial?.options.some((option) => !option.correct) && (
              <p className="form-warning qbank-hint">
                Из прежней формы перенесены только ответы, отмеченные правильными. Проверьте список
                перед сохранением.
              </p>
            )}
            {(type === "MULTIPLE_CHOICE" || type === "SHORT_ANSWER") && (
              <p className="form-warning qbank-hint">
                Этот тип можно хранить в банке. Запуск в живом занятии пока доступен только для
                одного правильного ответа и «Верно / Неверно».
              </p>
            )}
            <div className="qbank-options-editor">
              {options.map((option, index) => (
                <div
                  key={`${type}-${index}`}
                  className={`qbank-option-edit-row${shortAnswer ? " qbank-option-edit-row--short-answer" : ""}`}
                >
                  {!shortAnswer && (
                    <label className="qbank-correct-target">
                      {type === "MULTIPLE_CHOICE" ? (
                        <Checkbox
                          checked={option.correct}
                          disabled={saveMut.isPending}
                          aria-label={`Правильный вариант ${index + 1}`}
                          onCheckedChange={(checked) =>
                            setOptions((items) =>
                              items.map((item, position) =>
                                position === index ? { ...item, correct: Boolean(checked) } : item
                              )
                            )
                          }
                        />
                      ) : (
                        <input
                          type="radio"
                          name={`${id}-correct`}
                          checked={option.correct}
                          disabled={saveMut.isPending}
                          aria-label={`Правильный вариант ${index + 1}`}
                          onChange={() =>
                            setOptions((items) =>
                              items.map((item, position) => ({
                                ...item,
                                correct: position === index
                              }))
                            )
                          }
                        />
                      )}
                    </label>
                  )}
                  <Input
                    value={option.text}
                    disabled={saveMut.isPending}
                    onChange={(event) =>
                      setOptions((items) =>
                        items.map((item, position) =>
                          position === index ? { ...item, text: event.target.value } : item
                        )
                      )
                    }
                    placeholder={
                      shortAnswer ? `Допустимый ответ ${index + 1}` : `Вариант ${index + 1}`
                    }
                    aria-label={
                      shortAnswer ? `Допустимый ответ ${index + 1}` : `Текст варианта ${index + 1}`
                    }
                    maxLength={500}
                  />
                  {options.length > (shortAnswer ? 1 : 2) && type !== "TRUE_FALSE" ? (
                    <IconButton
                      label={
                        shortAnswer ? `Удалить ответ ${index + 1}` : `Удалить вариант ${index + 1}`
                      }
                      disabled={saveMut.isPending}
                      onClick={() =>
                        setOptions((items) => items.filter((_, position) => position !== index))
                      }
                    >
                      <X size={18} />
                    </IconButton>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && type !== "TRUE_FALSE" && (
              <Button
                variant="outline"
                disabled={saveMut.isPending}
                onClick={() =>
                  setOptions((items) => [...items, { text: "", correct: shortAnswer }])
                }
              >
                <Plus size={18} /> {shortAnswer ? "Добавить допустимый ответ" : "Добавить вариант"}
              </Button>
            )}
          </div>
          <div className="qbank-field">
            <Label htmlFor={`${id}-tags`}>Теги</Label>
            <Input
              id={`${id}-tags`}
              value={tagsText}
              disabled={saveMut.isPending}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="Например, обратная связь, вовлечение"
              maxLength={500}
            />
            <p className="muted qbank-hint">Разделяйте теги запятыми.</p>
          </div>
          {saveMut.isError && (
            <p className="form-error" role="alert">
              {userErrorMessage(
                saveMut.error,
                "Не удалось сохранить вопрос. Введённые данные сохранены в форме."
              )}
            </p>
          )}
        </div>
        <DialogFooter className="qbank-dialog-footer">
          <Button variant="outline" disabled={saveMut.isPending} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!canSave} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Сохраняем…" : "Сохранить вопрос"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
