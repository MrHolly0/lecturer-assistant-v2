import "../styles/question-lectures.css";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  File,
  Info,
  LayoutGrid,
  Link2,
  ListChecks,
  MoreHorizontal,
  Plus,
  Pencil,
  Tag,
  Unlink
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  archiveQuestion,
  linkQuestionLecture,
  unlinkQuestionLecture,
  listQuestions,
  type QuestionBankEntry
} from "../app/api/interaction-api";
import { Button } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { PaginationBar, SearchField } from "../widgets/ListControls";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Badge } from "../shared/ui/badge";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { questionAvailability } from "../shared/lib/questionAvailability";
import { QuestionDialog } from "../widgets/QuestionDialog";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { listLectures } from "../app/api/content-api";
import { QuestionPickerDialog } from "../widgets/QuestionPickerDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from "../shared/ui/alert-dialog";
import { getCourse } from "../app/api/courses-api";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";

export function QuestionBankPage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const scope = params.get("lecture") ?? "all";
  const [lectureSearch, setLectureSearch] = useState("");
  const [binding, setBinding] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<QuestionBankEntry | null>(null);
  const lecturesQuery = useQuery({
    queryKey: ["lectures", courseId],
    queryFn: () => listLectures(courseId)
  });
  const lectures = lecturesQuery.data ?? [];
  const selectedLecture = lectures.find((l) => l.id === scope);
  const heading =
    scope === "all"
      ? "Все вопросы"
      : scope === "unassigned"
        ? "Без привязки"
        : selectedLecture?.title ?? "Лекция";

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
  const scoped = questions.filter(
    (q) =>
      scope === "all" ||
      (scope === "unassigned" ? q.lectureIds.length === 0 : q.lectureIds.includes(scope))
  );
  const filtered = scoped.filter(
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
  const setPage = paged.setPage;
  useEffect(() => {
    setQuery("");
    setTagFilter("__all__");
    setTypeFilter("__all__");
    setReadyOnly(false);
    setExpanded(null);
    setPage(1);
  }, [scope, setPage]);
  const linksMut = useMutation({
    mutationFn: async ({ id, unlink = false }: { id: string; unlink?: boolean }) => {
      if (unlink) await unlinkQuestionLecture(courseId, id, scope);
      else await linkQuestionLecture(courseId, id, scope);
    },
    onSuccess: (_, action) => {
      void qc.invalidateQueries({ queryKey: ["questions", courseId] });
      toast.success(action.unlink ? "Вопрос отвязан от лекции." : "Вопрос добавлен в лекцию.");
      setBinding(false);
    },
    onError: () => toast.error("Не удалось изменить привязку вопроса.")
  });
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
          <Button
            disabled={scope !== "all" && scope !== "unassigned" && !selectedLecture}
            onClick={() => setCreating(true)}
          >
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
          <div className="lecture-question-workspace">
            <aside className="lecture-question-sidebar" aria-label="Разделы банка вопросов">
              <h2>Разделы</h2>
              <Link
                className={scope === "all" ? "is-selected" : ""}
                to={`/courses/${courseId}/questions`}
              >
                <LayoutGrid size={20} />
                <span>Все вопросы</span>
                <span>{questions.length}</span>
              </Link>
              <Link
                className={scope === "unassigned" ? "is-selected" : ""}
                to={`?lecture=unassigned`}
              >
                <File size={20} />
                <span>Без привязки</span>
                <span>{questions.filter((q) => !q.lectureIds.length).length}</span>
              </Link>
              <h2>Лекции</h2>
              <SearchField
                value={lectureSearch}
                onChange={setLectureSearch}
                placeholder="Найти лекцию"
              />
              {lecturesQuery.isLoading && <p role="status">Загрузка лекций…</p>}
              {lecturesQuery.isError && (
                <div role="alert">
                  <p>Не удалось загрузить лекции.</p>
                  <Button variant="outline" onClick={() => void lecturesQuery.refetch()}>
                    Повторить
                  </Button>
                </div>
              )}
              <nav aria-label="Лекции курса">
                {lectures
                  .filter((l) => includesQuery(lectureSearch, l.title))
                  .map((l) => (
                    <Link
                      key={l.id}
                      className={scope === l.id ? "is-selected" : ""}
                      to={`?lecture=${l.id}`}
                    >
                      <BookOpen size={21} />
                      <span>
                        {l.title}
                        {l.archived && <small>В архиве</small>}
                      </span>
                      <span>{questions.filter((q) => q.lectureIds.includes(l.id)).length}</span>
                    </Link>
                  ))}
              </nav>
              {!lecturesQuery.isLoading &&
                !lecturesQuery.isError &&
                !lectures.some((l) => includesQuery(lectureSearch, l.title)) && (
                  <p className="muted">
                    {lectureSearch ? "Лекций по запросу нет." : "В курсе пока нет лекций."}
                  </p>
                )}
              <p className="lecture-question-sidebar__hint muted">
                <Info size={19} />
                <span>Вопрос может входить в несколько лекций.</span>
              </p>
            </aside>
            <section className="lecture-question-content" aria-labelledby="question-scope-heading">
              <div className="lecture-question-content__heading">
                <div>
                  <h2 id="question-scope-heading">{heading}</h2>
                  <p className="muted">Вопросов: {scoped.length}</p>
                </div>
                {selectedLecture && canManage && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      linksMut.reset();
                      setBinding(true);
                    }}
                  >
                    <Link2 size={18} />
                    Привязать из банка
                  </Button>
                )}
              </div>
              {scope !== "all" &&
                scope !== "unassigned" &&
                !selectedLecture &&
                !lecturesQuery.isLoading &&
                !lecturesQuery.isError && (
                  <p role="alert">Эта лекция недоступна. Выберите другую в списке.</p>
                )}
              <div className="question-catalog__filters">
                <SearchField
                  value={query}
                  onChange={setQuery}
                  placeholder={
                    scope === "all"
                      ? "Поиск по всему банку"
                      : scope === "unassigned"
                        ? "Поиск без привязки"
                        : "Поиск в этой лекции"
                  }
                />
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
                                    ? "Свободный текст"
                                    : `Вариантов: ${question.options.length} · правильных: ${question.options.filter((option) => option.correct).length}`}
                                </small>
                                {question.lectureIds.filter((id) => id !== scope).length > 0 && (
                                  <small className="question-lecture-usage">
                                    <Link2 size={14} />
                                    {scope === "all" || scope === "unassigned"
                                      ? "В лекциях: "
                                      : "Также: "}
                                    {lectures
                                      .filter(
                                        (l) => question.lectureIds.includes(l.id) && l.id !== scope
                                      )
                                      .map((l) => l.title)
                                      .join(", ")}
                                  </small>
                                )}
                                {question.tags.length > 0 && (
                                  <span className="question-catalog__tags">
                                    {question.tags.map((tag) => (
                                      <Badge key={tag} variant="secondary">
                                        {tag}
                                      </Badge>
                                    ))}
                                  </span>
                                )}
                              </span>
                            </button>
                            <span className="question-catalog__type">
                              {QUESTION_TYPES.find((type) => type.value === question.questionType)
                                ?.label ?? question.questionType}
                            </span>
                            <div className="question-catalog__actions">
                              {canManage && (
                                <>
                                  <Button variant="outline" onClick={() => setEditing(question)}>
                                    <Pencil size={16} /> Редактировать
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Действия с вопросом: ${question.text}`}
                                      >
                                        <MoreHorizontal size={19} />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {selectedLecture && (
                                        <DropdownMenuItem
                                          disabled={linksMut.isPending}
                                          onSelect={() =>
                                            linksMut.mutate({ id: question.id, unlink: true })
                                          }
                                        >
                                          <Unlink size={16} />
                                          Отвязать от этой лекции
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem onSelect={() => setEditing(question)}>
                                        <Link2 size={16} />
                                        Изменить привязки
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={archiveMut.isPending}
                                        onSelect={() => setArchiveTarget(question)}
                                      >
                                        <Archive size={16} />
                                        Архивировать вопрос
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
                              <h3>Ответы</h3>
                              {question.questionType === "SHORT_ANSWER" ? (
                                <p className="muted">
                                  Студент отвечает текстом. Ответы доступны преподавателю в занятии
                                  и его итогах, без автоматической оценки.
                                </p>
                              ) : (
                                question.options.map((option, index) => (
                                  <div
                                    key={index}
                                    className={`question-catalog__answer${option.correct ? " is-correct" : ""}`}
                                  >
                                    {option.correct && <Check size={18} aria-hidden="true" />}
                                    <span>{option.text}</span>
                                    {option.correct && <small>Правильный ответ</small>}
                                  </div>
                                ))
                              )}
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
                        <strong>
                          {hasFilters ? "Вопросов по запросу нет" : "Вопросов пока нет"}
                        </strong>
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
                    Для запуска в занятии: «Один правильный» или «Верно / Неверно», от 2 до 6
                    вариантов и ровно один правильный ответ. «Краткий ответ» — свободный текст без
                    автоматической оценки.
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      )}
      {binding && selectedLecture && canManage && (
        <QuestionPickerDialog
          courseId={courseId}
          currentLectureId={scope}
          currentLectureTitle={selectedLecture.title}
          linkToLectureId={scope}
          pending={linksMut.isPending}
          error={linksMut.isError ? "Не удалось привязать вопрос. Попробуйте ещё раз." : undefined}
          onClose={() => setBinding(false)}
          onConfirm={(q) => linksMut.mutate({ id: q.id })}
        />
      )}
      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать вопрос?</AlertDialogTitle>
            <AlertDialogDescription>
              Вопрос исчезнет из активного банка и всех лекций. Результаты прошедших занятий
              сохранятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) archiveMut.mutate(archiveTarget.id);
              }}
            >
              Архивировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {canManage && (
        <QuestionDialog
          courseId={courseId}
          open={creating || Boolean(editing)}
          initial={editing ?? undefined}
          defaultLectureId={selectedLecture?.id}
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
