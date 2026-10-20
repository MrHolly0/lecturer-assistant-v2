import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, ChevronDown, ListChecks, Plus, Pencil, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { archiveQuestion, listQuestions, type QuestionBankEntry } from "../app/api/interaction-api";
import { Button } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { PaginationBar, SearchField } from "../widgets/ListControls";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Badge } from "../shared/ui/badge";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { questionAvailability } from "../shared/lib/questionAvailability";
import { QuestionDialog } from "../widgets/QuestionDialog";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";
import { getCourse } from "../app/api/courses-api";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";

export function QuestionBankPage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("__all__");
  const [typeFilter, setTypeFilter] = useState("__all__");
  const [readyOnly, setReadyOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuestionBankEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const questionsQuery = useQuery({
    queryKey: ["questions", courseId],
    queryFn: () => listQuestions(courseId)
  });
  const questions = questionsQuery.data ?? [];
  const filtered = questions.filter(
    (question) =>
      includesQuery(query, question.text, ...question.tags) &&
      (tagFilter === "__all__" || question.tags.includes(tagFilter)) &&
      (typeFilter === "__all__" || question.questionType === typeFilter)
  );
  const ready = filtered.filter((question) => !questionAvailability(question));
  const visible = readyOnly ? ready : filtered;
  const paged = usePagedList(visible, 20);
  const hasFilters = Boolean(
    query || tagFilter !== "__all__" || typeFilter !== "__all__" || readyOnly
  );
  const allTags = [...new Set(questions.flatMap((question) => question.tags))].sort();
  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveQuestion(courseId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["questions", courseId] });
      toast.success("Вопрос архивирован.");
    },
    onError: () => toast.error("Не удалось архивировать вопрос.")
  });
  const canManage = !courseQuery.isError && courseQuery.data?.canManage;
  return (
    <div className="page page--wide qbank-shell course-workflows preparation-page question-catalog">
      <header className="page-header qbank-page-header course-workflow-header">
        <div className="course-workflow-header__copy">
          <Link to={`/courses/${courseId}`} className="breadcrumb">
            ← Курсы / {courseQuery.data?.title ?? "Курс"}
          </Link>
          <h1>Банк вопросов</h1>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Новый вопрос
          </Button>
        )}
      </header>
      <CourseSectionNav courseId={courseId} canManage={courseQuery.data?.canManage} />
      {courseQuery.isError && (
        <div className="qbank-load-error" role="alert">
          <p>Не удалось загрузить курс и проверить доступ к банку вопросов.</p>
          <Button variant="outline" onClick={() => void courseQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {!courseQuery.isError && (
        <>
          <div className="question-catalog__filters">
            <SearchField value={query} onChange={setQuery} placeholder="Поиск по тексту вопроса" />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger aria-label="Тип вопросов">
                <ListChecks size={17} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Все типы</SelectItem>
                {QUESTION_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger aria-label="Тег вопросов">
                <Tag size={17} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Все теги</SelectItem>
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="question-catalog__scope">
            <Tabs
              value={readyOnly ? "ready" : "all"}
              onValueChange={(value) => setReadyOnly(value === "ready")}
            >
              <TabsList>
                <TabsTrigger value="all">
                  Все{questionsQuery.data ? ` (${filtered.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="ready">
                  Доступны для занятия{questionsQuery.data ? ` (${ready.length})` : ""}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {hasFilters && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setTagFilter("__all__");
                  setTypeFilter("__all__");
                  setReadyOnly(false);
                }}
              >
                Сбросить фильтры
              </Button>
            )}
          </div>
          {questionsQuery.isLoading && (
            <p className="muted" role="status">
              Загрузка вопросов…
            </p>
          )}
          {questionsQuery.isError && (
            <div className="qbank-load-error" role="alert">
              <p>Не удалось загрузить банк вопросов.</p>
              <Button variant="outline" onClick={() => void questionsQuery.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {!questionsQuery.isLoading && !questionsQuery.isError && (
            <>
              {visible.length > 0 && (
                <div className="question-catalog__head" aria-hidden="true">
                  <span>Вопрос</span>
                  <span>Тип</span>
                  <span>Теги</span>
                  <span>Действия</span>
                </div>
              )}
              <ul className="question-catalog__list">
                {paged.pageItems.map((question) => {
                  const open = expanded === question.id;
                  const availability = questionAvailability(question);
                  return (
                    <li
                      key={question.id}
                      className={`question-catalog__item${open ? " is-expanded" : ""}`}
                    >
                      <div className="question-catalog__row">
                        <button
                          className="question-catalog__open"
                          type="button"
                          aria-expanded={open}
                          aria-controls={`answers-${question.id}`}
                          onClick={() => setExpanded(open ? null : question.id)}
                        >
                          <ChevronDown size={18} aria-hidden="true" />
                          <span>
                            <strong>{question.text}</strong>
                            <small>
                              {question.questionType === "SHORT_ANSWER"
                                ? `Допустимых ответов: ${question.options.filter((option) => option.correct).length}`
                                : `Вариантов: ${question.options.length} · правильных: ${question.options.filter((option) => option.correct).length}`}
                            </small>
                          </span>
                        </button>
                        <span className="question-catalog__type">
                          {QUESTION_TYPES.find((type) => type.value === question.questionType)
                            ?.label ?? question.questionType}
                        </span>
                        <div className="question-catalog__tags">
                          {question.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                          {!question.tags.length && <span className="muted">Без тегов</span>}
                        </div>
                        <div className="question-catalog__actions">
                          {canManage && (
                            <>
                              <Button variant="outline" onClick={() => setEditing(question)}>
                                <Pencil size={16} /> Редактировать
                              </Button>
                              <ConfirmActionButton
                                title="Архивировать вопрос?"
                                description="Вопрос исчезнет из активного банка."
                                confirmLabel="Архивировать"
                                variant="ghost"
                                size="icon"
                                label={`Архивировать вопрос: ${question.text}`}
                                disabled={archiveMut.isPending}
                                onConfirm={() => archiveMut.mutate(question.id)}
                              >
                                <Archive size={17} />
                              </ConfirmActionButton>
                            </>
                          )}
                        </div>
                      </div>
                      {open && (
                        <section
                          id={`answers-${question.id}`}
                          className="question-catalog__answers"
                          aria-label="Ответы"
                        >
                          <h3>
                            {question.questionType === "SHORT_ANSWER"
                              ? "Допустимые ответы"
                              : "Ответы"}
                          </h3>
                          {question.options
                            .filter(
                              (option) => question.questionType !== "SHORT_ANSWER" || option.correct
                            )
                            .map((option, index) => (
                              <div
                                key={index}
                                className={`question-catalog__answer${option.correct ? " is-correct" : ""}`}
                              >
                                {option.correct && <Check size={18} aria-hidden="true" />}
                                <span>{option.text}</span>
                                {option.correct && (
                                  <small>
                                    {question.questionType === "SHORT_ANSWER"
                                      ? "Допустимый ответ"
                                      : "Правильный ответ"}
                                  </small>
                                )}
                              </div>
                            ))}
                          {availability && <p className="muted">{availability}</p>}
                        </section>
                      )}
                    </li>
                  );
                })}
              </ul>
              {visible.length === 0 && (
                <div className="qbank-empty">
                  <ListChecks size={28} />
                  <div>
                    <strong>{hasFilters ? "Вопросов по запросу нет" : "Вопросов пока нет"}</strong>
                    <p className="muted">
                      {hasFilters
                        ? "Измените запрос или сбросьте фильтры."
                        : "Подготовьте текст и варианты ответа для занятия."}
                    </p>
                  </div>
                  {canManage && !hasFilters && (
                    <Button onClick={() => setCreating(true)}>Создать вопрос</Button>
                  )}
                </div>
              )}
              <PaginationBar {...paged} onPageChange={paged.setPage} />
              <p className="question-catalog__rule muted">
                Для запуска в занятии: «Один правильный» или «Верно / Неверно», от 2 до 6 вариантов
                и ровно один правильный ответ.
              </p>
            </>
          )}
        </>
      )}
      {canManage && (
        <QuestionDialog
          courseId={courseId}
          open={creating || Boolean(editing)}
          initial={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["questions", courseId] });
          }}
        />
      )}
    </div>
  );
}
