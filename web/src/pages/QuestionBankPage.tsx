import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { archiveQuestion, listQuestions, type QuestionBankEntry } from "../app/api/interaction-api";
import { Button, IconButton } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { SearchField } from "../widgets/ListControls";
import { includesQuery } from "../shared/lib/usePagedList";
import { Badge } from "../shared/ui/badge";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { QuestionDialog } from "../widgets/QuestionDialog";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";
import { getCourse } from "../app/api/courses-api";

interface Props {
  courseId: string;
}

export function QuestionBankPage({ courseId }: Props) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<QuestionBankEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });

  const questionsQuery = useQuery({
    queryKey: ["questions", courseId, tagFilter],
    queryFn: () => listQuestions(courseId, tagFilter)
  });
  const questions = questionsQuery.data ?? [];
  const visibleQuestions = questions.filter((question) =>
    includesQuery(query, question.text, ...question.tags)
  );

  const allTags = [...new Set(questions.flatMap((q) => q.tags))].sort();

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveQuestion(courseId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["questions", courseId] });
      toast.success("Вопрос архивирован.");
    },
    onError: () => toast.error("Не удалось архивировать вопрос.")
  });

  return (
    <div className="page page--wide qbank-shell course-workflows preparation-page">
      <header className="page-header qbank-page-header course-workflow-header">
        <div className="course-workflow-header__copy">
          <Link to={`/courses/${courseId}`} className="breadcrumb">
            ← Курсы / {courseQuery.data?.title ?? "Курс"}
          </Link>
          <h1>Банк вопросов</h1>
        </div>
        {!courseQuery.isError && courseQuery.data?.canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Новый вопрос
          </Button>
        )}
      </header>
      <CourseSectionNav courseId={courseId} canManage={courseQuery.data?.canManage} />
      {courseQuery.isError && (
        <div className="qbank-load-error" role="alert">
          <p>Не удалось загрузить курс и проверить доступ к банку вопросов.</p>
          <Button type="button" variant="outline" onClick={() => void courseQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      <div className="qbank-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Поиск по тексту вопроса" />
        {!courseQuery.isError && questions.length > 0 && (
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
        )}
      </div>

      {questionsQuery.isLoading && !courseQuery.isError && (
        <p className="muted" role="status">
          Загрузка вопросов…
        </p>
      )}
      {questionsQuery.isError && !courseQuery.isError && (
        <div className="qbank-load-error" role="alert">
          <p>Не удалось загрузить банк вопросов. Ваши изменения не потеряны.</p>
          <Button type="button" variant="outline" onClick={() => void questionsQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}

      {!questionsQuery.isError && !courseQuery.isError && (
        <ul className="qbank-list">
          {visibleQuestions.map((q) => (
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
              {courseQuery.data?.canManage && (
                <div className="qbank-item-actions">
                  <IconButton onClick={() => setEditing(q)} label="Редактировать вопрос">
                    <Pencil size={16} />
                  </IconButton>
                  <ConfirmActionButton
                    title="Архивировать вопрос?"
                    description="Вопрос исчезнет из активного банка."
                    confirmLabel="Архивировать"
                    variant="ghost"
                    size="icon"
                    label="Архивировать вопрос"
                    disabled={archiveMut.isPending}
                    onConfirm={() => archiveMut.mutate(q.id)}
                  >
                    <Trash2 size={16} />
                  </ConfirmActionButton>
                </div>
              )}
            </li>
          ))}
          {!questionsQuery.isLoading && visibleQuestions.length === 0 && (
            <li className="qbank-empty">
              <span className="qbank-empty__icon" aria-hidden="true">
                <ListChecks size={28} />
              </span>
              <div>
                <strong>
                  {query || tagFilter
                    ? "Вопросов по запросу нет"
                    : courseQuery.data?.canManage
                      ? "Соберите первую проверку"
                      : "Вопросов пока нет"}
                </strong>
                <p className="muted">
                  {query || tagFilter
                    ? "Попробуйте другой запрос или выберите все теги."
                    : "Подготовьте текст и варианты ответа для занятия."}
                </p>
              </div>
              {courseQuery.data?.canManage && (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} aria-hidden="true" /> Создать вопрос
                </Button>
              )}
            </li>
          )}
        </ul>
      )}

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
