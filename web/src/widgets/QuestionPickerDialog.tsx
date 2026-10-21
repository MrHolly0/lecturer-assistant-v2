import "../styles/question-lectures.css";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Link2, Play } from "lucide-react";
import { listLectures } from "../app/api/content-api";
import { listQuestions, type QuestionBankEntry } from "../app/api/interaction-api";
import { includesQuery } from "../shared/lib/usePagedList";
import { questionAvailability } from "../shared/lib/questionAvailability";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { SearchField } from "./ListControls";
import { QuestionPreview } from "./QuestionPreview";

export function QuestionPickerDialog({
  courseId,
  currentLectureId,
  currentLectureTitle,
  linkToLectureId,
  pending,
  blocked = false,
  error,
  contextLoading = false,
  contextError,
  onRetryContext,
  onClose,
  onConfirm,
  extraAction,
  container
}: {
  courseId: string;
  currentLectureId?: string;
  currentLectureTitle?: string;
  linkToLectureId?: string;
  pending: boolean;
  blocked?: boolean;
  error?: string;
  contextLoading?: boolean;
  contextError?: string;
  onRetryContext?: () => void;
  onClose: () => void;
  onConfirm: (question: QuestionBankEntry) => void;
  extraAction?: ReactNode;
  container?: HTMLElement;
}) {
  const linking = Boolean(linkToLectureId);
  const [scope, setScope] = useState(linking ? "all" : "current");
  const [lectureId, setLectureId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const questions = useQuery({
    queryKey: ["questions", courseId],
    queryFn: () => listQuestions(courseId)
  });
  const lectures = useQuery({
    queryKey: ["lectures", courseId],
    queryFn: () => listLectures(courseId)
  });
  const items = (questions.data ?? []).filter(
    (q) => !q.archived && (linking || !questionAvailability(q))
  );
  const currentItems = items.filter(
    (q) => currentLectureId && q.lectureIds.includes(currentLectureId)
  );
  const selectedLecture = lectures.data?.find((l) => l.id === lectureId);
  const scoped =
    scope === "current"
      ? currentItems
      : scope === "other"
        ? items.filter((q) => lectureId && q.lectureIds.includes(lectureId))
        : items;
  const visible = scoped.filter((q) => includesQuery(search, q.text, ...q.tags));
  const selected = visible.find((q) => q.id === selectedId);
  const folderView = scope === "other" && !lectureId;
  const linked = Boolean(
    selected && linkToLectureId && selected.lectureIds.includes(linkToLectureId)
  );
  const loading = questions.isLoading || lectures.isLoading || contextLoading;
  const loadError = questions.isError || lectures.isError || contextError;
  function reset() {
    setSearch("");
    setSelectedId(null);
    setLimit(10);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        container={container}
        className="question-picker"
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {linking ? "Привязать вопрос из банка" : "Выбрать вопрос для занятия"}
          </DialogTitle>
          <DialogDescription>
            {linking ? "Лекция" : "Текущая лекция"}: {currentLectureTitle ?? "Загрузка…"}
          </DialogDescription>
        </DialogHeader>
        <div className="question-picker__body">
          <div className="question-picker__toolbar">
            <Tabs
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setLectureId(null);
                reset();
              }}
            >
              <TabsList aria-label="Раздел банка вопросов">
                {!linking && (
                  <TabsTrigger value="current">Текущая лекция ({currentItems.length})</TabsTrigger>
                )}
                <TabsTrigger value="other">Другие лекции</TabsTrigger>
                <TabsTrigger value="all">Весь банк</TabsTrigger>
              </TabsList>
            </Tabs>
            {extraAction}
          </div>
          {loadError ? (
            <div className="qbank-load-error" role="alert">
              <p>{contextError || "Не удалось загрузить вопросы и лекции."}</p>
              <Button
                variant="outline"
                onClick={() => {
                  void questions.refetch();
                  void lectures.refetch();
                  onRetryContext?.();
                }}
              >
                Повторить
              </Button>
            </div>
          ) : loading ? (
            <p role="status">Загрузка вопросов…</p>
          ) : (
            <>
              {scope === "other" && (
                <nav className="question-picker__breadcrumbs" aria-label="Выбранная лекция">
                  <button
                    type="button"
                    disabled={!lectureId || pending}
                    onClick={() => {
                      setLectureId(null);
                      reset();
                    }}
                  >
                    Лекции курса
                  </button>
                  {selectedLecture && (
                    <>
                      <ChevronRight size={16} />
                      <strong>{selectedLecture.title}</strong>
                    </>
                  )}
                </nav>
              )}
              {folderView ? (
                <>
                  <SearchField value={search} onChange={setSearch} placeholder="Найти лекцию" />
                  <ul className="question-picker__folders">
                    {(lectures.data ?? [])
                      .filter((l) => l.id !== currentLectureId && includesQuery(search, l.title))
                      .map((l) => (
                        <li key={l.id}>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setLectureId(l.id);
                              reset();
                            }}
                          >
                            <BookOpen size={22} />
                            <span>
                              <strong>{l.title}</strong>
                              {l.archived && <small>В архиве</small>}
                            </span>
                            <span>{items.filter((q) => q.lectureIds.includes(l.id)).length}</span>
                            <ChevronRight size={18} />
                          </button>
                        </li>
                      ))}
                  </ul>
                  {!(lectures.data ?? []).some(
                    (l) => l.id !== currentLectureId && includesQuery(search, l.title)
                  ) && <p className="muted">Других лекций по запросу нет.</p>}
                </>
              ) : (
                <div className="question-picker__columns">
                  <section className="question-picker__results" aria-label="Вопросы для выбора">
                    <SearchField
                      value={search}
                      onChange={(value) => {
                        setSearch(value);
                        setSelectedId(null);
                        setLimit(10);
                      }}
                      placeholder={
                        scope === "all" ? "Поиск по всему банку" : "Поиск в выбранной лекции"
                      }
                    />
                    <p className="muted">Найдено вопросов: {visible.length}</p>
                    <div
                      className="question-picker__choices"
                      role="radiogroup"
                      aria-label="Вопрос для занятия"
                    >
                      {visible.slice(0, limit).map((q) => (
                        <label key={q.id} className={selected?.id === q.id ? "is-selected" : ""}>
                          <input
                            type="radio"
                            name="bank-question"
                            checked={selected?.id === q.id}
                            disabled={pending}
                            onChange={() => setSelectedId(q.id)}
                          />
                          <span>
                            <strong>{q.text}</strong>
                            <small>
                              {QUESTION_TYPES.find((t) => t.value === q.questionType)?.label}
                              {linkToLectureId && q.lectureIds.includes(linkToLectureId)
                                ? " · Уже в лекции"
                                : ""}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {visible.length === 0 && (
                      <p className="muted">
                        {search
                          ? "По этому запросу вопросов нет."
                          : scope === "current"
                            ? "В этой лекции пока нет вопросов для запуска. Выберите другую лекцию или весь банк."
                            : "В этом разделе пока нет вопросов для выбора."}
                      </p>
                    )}
                    {visible.length > limit && (
                      <Button variant="outline" onClick={() => setLimit((n) => n + 10)}>
                        Показать ещё {Math.min(10, visible.length - limit)}
                      </Button>
                    )}
                  </section>
                  <aside className="question-picker__preview" aria-label="Предпросмотр вопроса">
                    <h2>Предпросмотр</h2>
                    {selected ? (
                      <>
                        <QuestionPreview question={selected} />
                        <p className="question-picker__source muted">
                          {selectedLecture
                            ? `Выбран из лекции: ${selectedLecture.title}`
                            : scope === "current"
                              ? `Выбран из лекции: ${currentLectureTitle}`
                              : selected.lectureIds.length
                                ? `Используется в лекциях: ${(lectures.data ?? [])
                                    .filter((l) => selected.lectureIds.includes(l.id))
                                    .map((l) => l.title)
                                    .join(", ")}`
                                : "Без привязки к лекции"}
                        </p>
                      </>
                    ) : (
                      <p className="muted">
                        Выберите вопрос, чтобы посмотреть его перед{" "}
                        {linking ? "добавлением" : "запуском"}.
                      </p>
                    )}
                  </aside>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <p className="muted question-picker__note">
            {linking
              ? "Вопрос останется доступен в других лекциях."
              : "Вопрос будет запущен в текущем занятии."}
            <small>
              {linking
                ? "Редактирование изменит общий вопрос во всех лекциях."
                : "Это не изменит привязку вопроса к лекциям."}
            </small>
          </p>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={!selected || linked || pending || blocked || loading || Boolean(loadError)}
            onClick={() => {
              if (selected && !pending && !blocked && !linked) onConfirm(selected);
            }}
          >
            {linking ? <Link2 size={18} /> : <Play size={18} />}
            {pending
              ? "Подождите…"
              : linked
                ? "Уже в лекции"
                : linking
                  ? "Привязать вопрос"
                  : "Запустить вопрос"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
