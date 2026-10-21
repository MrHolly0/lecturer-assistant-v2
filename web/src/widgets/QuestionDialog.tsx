import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Plus, X } from "lucide-react";
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
import { questionAvailability } from "../shared/lib/questionAvailability";
import { listLectures } from "../app/api/content-api";
import { RadioGroup, RadioGroupItem } from "../shared/ui/radio-group";

interface QuestionDialogProps {
  courseId: string;
  open: boolean;
  defaultLectureId?: string;
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
    SHORT_ANSWER: []
  };
  if (initial && initial.questionType !== "SHORT_ANSWER") {
    const savedOptions = initial.options.map((option) => ({ ...option }));
    if (savedOptions.length > 0) drafts[initial.questionType] = savedOptions;
  }
  return drafts;
}

export function QuestionDialog({
  courseId,
  open,
  initial,
  defaultLectureId,
  onClose,
  onSaved
}: QuestionDialogProps) {
  const id = useId();
  const submitting = useRef(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [text, setText] = useState(initial?.text ?? "");
  const [type, setType] = useState<QuestionType>(initial?.questionType ?? "CHOICE");
  const [drafts, setDrafts] = useState(() => optionDrafts(initial));
  const options = drafts[type];
  const shortAnswer = type === "SHORT_ANSWER";
  function setOptions(update: (items: QuestionOption[]) => QuestionOption[]) {
    setDrafts((current) => ({ ...current, [type]: update(current[type]) }));
  }
  const [lectureIds, setLectureIds] = useState<string[]>(
    initial?.lectureIds ?? (defaultLectureId ? [defaultLectureId] : [])
  );
  const [lectureSearch, setLectureSearch] = useState("");
  const lecturesQuery = useQuery({
    queryKey: ["lectures", courseId],
    queryFn: () => listLectures(courseId),
    enabled: open
  });
  const [tagsText, setTagsText] = useState(initial?.tags.join(", ") ?? "");
  useEffect(() => {
    if (!open) return;
    setText(initial?.text ?? "");
    setType(initial?.questionType ?? "CHOICE");
    setDrafts(optionDrafts(initial));
    setTagsText(initial?.tags.join(", ") ?? "");
    setPreviewOpen(false);
    setLectureIds(initial?.lectureIds ?? (defaultLectureId ? [defaultLectureId] : []));
    setLectureSearch("");
  }, [open, initial, courseId, defaultLectureId]);

  const saveMut = useMutation({
    mutationFn: () => {
      const request: CreateQuestionRequest = {
        text: text.trim(),
        questionType: type,
        options: shortAnswer
          ? []
          : options.map((option) => ({
              text: option.text.trim(),
              correct: option.correct
            })),
        lectureIds,
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
    onError: () => toast.error("Не удалось сохранить вопрос."),
    onSettled: () => {
      submitting.current = false;
    }
  });
  const { reset } = saveMut;
  useEffect(() => {
    if (open) reset();
  }, [open, initial, courseId, reset]);
  const correctCount = options.filter((option) => option.correct).length;
  const validAnswers = shortAnswer
    ? true
    : options.length >= 2 && (type === "MULTIPLE_CHOICE" ? correctCount >= 1 : correctCount === 1);
  const canSave =
    text.trim().length > 0 &&
    validAnswers &&
    (shortAnswer || options.every((option) => option.text.trim().length > 0)) &&
    !saveMut.isPending;
  const availability = questionAvailability({ questionType: type, options });
  function submit() {
    if (!canSave || submitting.current) return;
    submitting.current = true;
    saveMut.mutate();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saveMut.isPending) onClose();
      }}
    >
      <DialogContent
        className="qbank-dialog preparation-dialog question-authoring"
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
        <div className="preparation-dialog__body question-authoring__body">
          <form
            id={`${id}-form`}
            className="question-authoring__form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="qbank-field">
              <Label id={`${id}-type-label`}>Тип вопроса</Label>
              <RadioGroup
                aria-labelledby={`${id}-type-label`}
                value={type}
                disabled={Boolean(initial) || saveMut.isPending}
                onValueChange={(value) => setType(value as QuestionType)}
                className="question-authoring__types"
              >
                {QUESTION_TYPES.map((item) => (
                  <label key={item.value} className={type === item.value ? "is-selected" : ""}>
                    <RadioGroupItem value={item.value} /> <span>{item.label}</span>
                  </label>
                ))}
              </RadioGroup>
              {initial && (
                <p className="muted qbank-hint">Чтобы изменить тип, создайте новый вопрос.</p>
              )}
            </div>
            {availability && (
              <p className="question-authoring__availability" role="note">
                <AlertTriangle size={19} aria-hidden="true" />
                <span>{availability}</span>
              </p>
            )}
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
            {shortAnswer ? (
              <p className="muted qbank-hint">
                Студент напишет ответ текстом. Ответы видит преподаватель, автоматической оценки
                нет.
              </p>
            ) : (
              <div className="qbank-field">
                <Label>Варианты ответа</Label>
                <p className="muted qbank-hint">
                  {type === "MULTIPLE_CHOICE"
                    ? "Отметьте все правильные варианты."
                    : "Отметьте один правильный вариант."}
                </p>
                <div className="qbank-options-editor">
                  {options.map((option, index) => (
                    <div key={`${type}-${index}`} className="qbank-option-edit-row">
                      {
                        <label className="qbank-correct-target">
                          {type === "MULTIPLE_CHOICE" ? (
                            <Checkbox
                              checked={option.correct}
                              disabled={saveMut.isPending}
                              aria-label={`Правильный вариант ${index + 1}`}
                              onCheckedChange={(checked) =>
                                setOptions((items) =>
                                  items.map((item, position) =>
                                    position === index
                                      ? { ...item, correct: Boolean(checked) }
                                      : item
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
                      }
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
                        placeholder={`Вариант ${index + 1}`}
                        aria-label={`Текст варианта ${index + 1}`}
                        maxLength={500}
                      />
                      {options.length > 2 && type !== "TRUE_FALSE" ? (
                        <IconButton
                          label={`Удалить вариант ${index + 1}`}
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
                    className="question-authoring__add-option"
                    type="button"
                    disabled={saveMut.isPending}
                    onClick={() => setOptions((items) => [...items, { text: "", correct: false }])}
                  >
                    <Plus size={18} /> Добавить вариант
                  </Button>
                )}
              </div>
            )}
            <fieldset className="question-lecture-fields" disabled={saveMut.isPending}>
              <legend>Лекции</legend>
              <p className="muted qbank-hint">
                Вопрос можно использовать в нескольких лекциях. Без выбора он останется в разделе
                «Без привязки».
              </p>
              {lecturesQuery.isLoading && <p role="status">Загрузка лекций…</p>}
              {lecturesQuery.isError && (
                <div role="alert">
                  <p>Не удалось загрузить лекции.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void lecturesQuery.refetch()}
                  >
                    Повторить
                  </Button>
                </div>
              )}
              {(lecturesQuery.data?.length ?? 0) > 5 && (
                <Input
                  aria-label="Найти лекцию для привязки"
                  value={lectureSearch}
                  onChange={(e) => setLectureSearch(e.target.value)}
                  placeholder="Найти лекцию"
                />
              )}
              <div className="question-lecture-fields__list">
                {(lecturesQuery.data ?? [])
                  .filter((l) =>
                    l.title.toLocaleLowerCase("ru").includes(lectureSearch.toLocaleLowerCase("ru"))
                  )
                  .map((l) => (
                    <label key={l.id}>
                      <Checkbox
                        checked={lectureIds.includes(l.id)}
                        onCheckedChange={(checked) =>
                          setLectureIds((ids) =>
                            checked ? [...ids, l.id] : ids.filter((id) => id !== l.id)
                          )
                        }
                      />
                      <span>
                        {l.title}
                        {l.archived ? " (в архиве)" : ""}
                      </span>
                    </label>
                  ))}
              </div>
              {lecturesQuery.data?.length === 0 && (
                <p className="muted">В курсе пока нет лекций. Вопрос можно привязать позже.</p>
              )}
              {initial && lectureIds.length > 1 && (
                <p className="muted qbank-hint">
                  Изменения текста и ответов будут видны во всех выбранных лекциях.
                </p>
              )}
            </fieldset>
            <div className="qbank-field">
              <Label htmlFor={`${id}-tags`}>
                Теги <span className="muted">через запятую</span>
              </Label>
              <Input
                id={`${id}-tags`}
                value={tagsText}
                disabled={saveMut.isPending}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="Например, обратная связь, вовлечение"
                maxLength={500}
              />
            </div>
            {saveMut.isError && (
              <p className="form-error" role="alert">
                {userErrorMessage(
                  saveMut.error,
                  "Не удалось сохранить вопрос. Введённые данные сохранены в форме."
                )}
              </p>
            )}
          </form>
          <aside
            className={`question-authoring__preview${previewOpen ? " is-open" : ""}`}
            aria-label="Предпросмотр вопроса"
          >
            <h2>Предпросмотр</h2>
            <Button
              type="button"
              variant="ghost"
              className="question-authoring__preview-toggle"
              aria-expanded={previewOpen}
              aria-controls={`${id}-preview`}
              onClick={() => setPreviewOpen(!previewOpen)}
            >
              Предпросмотр <ChevronDown size={17} />
            </Button>
            <div id={`${id}-preview`} className="question-authoring__preview-content">
              <p className="muted">{QUESTION_TYPES.find((item) => item.value === type)?.label}</p>
              <h3>{text.trim() || "Текст вопроса появится здесь"}</h3>
              {shortAnswer ? (
                <textarea
                  className="qbank-textarea"
                  aria-label="Пример текстового ответа"
                  placeholder="Ответ студента"
                  rows={3}
                  readOnly
                />
              ) : (
                <ul>
                  {options.map((option, index) => (
                    <li key={index}>
                      <span
                        aria-hidden="true"
                        className={type === "MULTIPLE_CHOICE" ? "sample-checkbox" : "sample-radio"}
                      />
                      <span>{option.text.trim() || `Вариант ${index + 1}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              <small className="muted">
                {shortAnswer
                  ? "Свободный текст, без автоматической проверки."
                  : "Без подсказки правильных ответов."}
                {availability ? " Пример оформления, запуск этого вопроса пока недоступен." : ""}
              </small>
            </div>
          </aside>
        </div>
        <DialogFooter className="qbank-dialog-footer">
          <Button variant="outline" disabled={saveMut.isPending} onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={!canSave}>
            {saveMut.isPending ? "Сохраняем…" : "Сохранить вопрос"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
