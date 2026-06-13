import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Tag, X } from "lucide-react";
import { toast } from "sonner";
import {
  archiveQuestion,
  createQuestion,
  listQuestions,
  updateQuestion,
  type CreateQuestionRequest,
  type QuestionBankEntry,
  type QuestionOption,
  type QuestionType
} from "../app/api/interaction-api";
import { Button } from "../shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../shared/ui/dialog";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../shared/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../shared/ui/select";
import { Checkbox } from "../shared/ui/checkbox";
import { Badge } from "../shared/ui/badge";

const QUESTION_TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: "CHOICE", label: "Один правильный" },
  { value: "MULTIPLE_CHOICE", label: "Несколько правильных" },
  { value: "TRUE_FALSE", label: "Верно / Неверно" },
  { value: "SHORT_ANSWER", label: "Краткий ответ" }
];

interface Props {
  courseId: string;
}

export function QuestionBankPage({ courseId }: Props) {
  const qc = useQueryClient();
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<QuestionBankEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const questionsQuery = useQuery({
    queryKey: ["questions", courseId, tagFilter],
    queryFn: () => listQuestions(courseId, tagFilter)
  });
  const questions = questionsQuery.data ?? [];

  const allTags = [...new Set(questions.flatMap((q) => q.tags))].sort();

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveQuestion(courseId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["questions", courseId] });
      toast.success("Вопрос удалён.");
    },
    onError: () => toast.error("Не удалось удалить вопрос.")
  });

  return (
    <div className="qbank-shell">
      <div className="qbank-toolbar">
        <h1>Банк вопросов</h1>
        <div className="qbank-filters">
          <Select
            value={tagFilter ?? "__all__"}
            onValueChange={(v) => setTagFilter(v === "__all__" ? undefined : v)}
          >
            <SelectTrigger className="qbank-tag-filter">
              <Tag size={14} />
              <SelectValue placeholder="Все теги" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Все теги</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} />
          Новый вопрос
        </Button>
      </div>

      {questionsQuery.isLoading && <p className="muted">Загрузка…</p>}

      <ul className="qbank-list">
        {questions.map((q) => (
          <li key={q.id} className="qbank-item">
            <div className="qbank-item-meta">
              <span className="qbank-type-badge">{QUESTION_TYPES.find((t) => t.value === q.questionType)?.label ?? q.questionType}</span>
              {q.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="qbank-item-text">{q.text}</p>
            <div className="qbank-item-options">
              {q.options.map((opt, idx) => (
                <span
                  key={idx}
                  className={`qbank-option${opt.correct ? " qbank-option--correct" : ""}`}
                >
                  {opt.text}
                </span>
              ))}
            </div>
            <div className="qbank-item-actions">
              <Button variant="ghost" size="sm" onClick={() => setEditing(q)}>
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={archiveMut.isPending}
                onClick={() => archiveMut.mutate(q.id)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </li>
        ))}
        {!questionsQuery.isLoading && questions.length === 0 && (
          <li className="qbank-empty muted">Вопросов нет — создайте первый.</li>
        )}
      </ul>

      <QuestionDialog
        courseId={courseId}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ["questions", courseId] });
        }}
      />

      {editing && (
        <QuestionDialog
          courseId={courseId}
          open
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["questions", courseId] });
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  courseId: string;
  open: boolean;
  initial?: QuestionBankEntry;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY_OPTIONS: QuestionOption[] = [
  { text: "", correct: false },
  { text: "", correct: false }
];

function QuestionDialog({ courseId, open, initial, onClose, onSaved }: DialogProps) {
  const [text, setText] = useState(initial?.text ?? "");
  const [type, setType] = useState<QuestionType>(initial?.questionType ?? "CHOICE");
  const [options, setOptions] = useState<QuestionOption[]>(
    initial?.options && initial.options.length > 0 ? initial.options : EMPTY_OPTIONS
  );
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);

  const saveMut = useMutation({
    mutationFn: () => {
      const request: CreateQuestionRequest = { text: text.trim(), questionType: type, options, tags };
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

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }

  function canSave() {
    return (
      text.trim().length > 0 &&
      options.length >= 1 &&
      options.every((o) => o.text.trim().length > 0) &&
      !saveMut.isPending
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="qbank-dialog">
        <DialogHeader>
          <DialogTitle>{initial ? "Редактировать вопрос" : "Новый вопрос"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="question">
          <TabsList>
            <TabsTrigger value="question">Вопрос</TabsTrigger>
            <TabsTrigger value="options">Ответы</TabsTrigger>
            <TabsTrigger value="tags">Теги</TabsTrigger>
          </TabsList>

          <TabsContent value="question" className="qbank-tab">
            <div className="qbank-field">
              <Label>Тип вопроса</Label>
              <Select value={type} onValueChange={(v) => setType(v as QuestionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((qt) => (
                    <SelectItem key={qt.value} value={qt.value}>
                      {qt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="qbank-field">
              <Label htmlFor="q-text">Текст вопроса</Label>
              <textarea
                id="q-text"
                className="qbank-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Введите текст вопроса"
                rows={4}
                maxLength={2000}
              />
            </div>
          </TabsContent>

          <TabsContent value="options" className="qbank-tab">
            <p className="muted qbank-hint">
              {type === "MULTIPLE_CHOICE"
                ? "Отметьте все правильные варианты."
                : "Отметьте один правильный вариант."}
            </p>
            <div className="qbank-options-editor">
              {options.map((opt, idx) => (
                <div key={idx} className="qbank-option-edit-row">
                  <Checkbox
                    id={`opt-correct-${idx}`}
                    checked={opt.correct}
                    onCheckedChange={(checked) => {
                      const next = options.map((o, i) => ({
                        ...o,
                        correct:
                          type === "MULTIPLE_CHOICE"
                            ? i === idx
                              ? Boolean(checked)
                              : o.correct
                            : i === idx
                      }));
                      setOptions(next);
                    }}
                  />
                  <Input
                    value={opt.text}
                    onChange={(e) =>
                      setOptions(options.map((o, i) => (i === idx ? { ...o, text: e.target.value } : o)))
                    }
                    placeholder={`Вариант ${idx + 1}`}
                    maxLength={500}
                  />
                  {options.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                    >
                      <X size={12} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOptions([...options, { text: "", correct: false }])}
              >
                <Plus size={12} />
                Добавить вариант
              </Button>
            )}
          </TabsContent>

          <TabsContent value="tags" className="qbank-tab">
            <div className="qbank-tag-editor">
              <div className="qbank-tag-input-row">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Тег (напр. алгебра)"
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                  maxLength={50}
                />
                <Button variant="outline" size="sm" onClick={addTag}>
                  Добавить
                </Button>
              </div>
              <div className="qbank-tag-list">
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="qbank-tag-chip">
                    {t}
                    <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))}>
                      <X size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="qbank-dialog-footer">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!canSave()} onClick={() => saveMut.mutate()}>
            {initial ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
