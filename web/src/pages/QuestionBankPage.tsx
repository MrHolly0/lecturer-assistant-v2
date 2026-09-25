import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { archiveQuestion, listQuestions, type QuestionBankEntry } from "../app/api/interaction-api";
import { Button } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Badge } from "../shared/ui/badge";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { QuestionDialog } from "../widgets/QuestionDialog";
import { CourseSectionNav } from "../widgets/CourseSectionNav";

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
    <div className="page page--wide qbank-shell">
      <div className="page-header qbank-page-header">
        <div>
          <Link to={`/courses/${courseId}`} className="breadcrumb">← Курс</Link>
          <h1>Банк вопросов</h1>
          <p className="muted">Подготовьте короткие проверки до начала лекции.</p>
        </div>
      </div>
      <CourseSectionNav courseId={courseId} />
      <div className="qbank-toolbar">
        <h2>Вопросы курса</h2>
        {questions.length > 0 && <div className="qbank-filters">
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
        </div>}
        {questions.length > 0 && <Button onClick={() => setCreating(true)}>
          <Plus size={14} />
          Новый вопрос
        </Button>}
      </div>

      {questionsQuery.isLoading && <p className="muted">Загрузка…</p>}

      <ul className="qbank-list">
        {questions.map((q) => (
          <li key={q.id} className="qbank-item">
            <div className="qbank-item-meta">
              <span className="qbank-type-badge">
                {QUESTION_TYPES.find((t) => t.value === q.questionType)?.label ?? q.questionType}
              </span>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(q)}
                aria-label="Редактировать вопрос"
                title="Редактировать вопрос"
              >
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={archiveMut.isPending}
                onClick={() => archiveMut.mutate(q.id)}
                aria-label="Удалить вопрос"
                title="Удалить вопрос"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </li>
        ))}
        {!questionsQuery.isLoading && questions.length === 0 && (
          <li className="qbank-empty">
            <span className="qbank-empty__icon" aria-hidden="true">
              <ListChecks size={28} />
            </span>
            <div>
              <strong>Соберите первую проверку</strong>
              <p className="muted">
                Готовый вопрос можно запустить из боковой панели во время лекции.
              </p>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" /> Создать вопрос
            </Button>
          </li>
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
