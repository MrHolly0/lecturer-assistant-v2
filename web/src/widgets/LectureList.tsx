import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Archive, Plus, Presentation, Play, RotateCcw, Trash2 } from "lucide-react";
import type { Lecture, SlideDeck } from "../app/api/content-api";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { PaginationBar, SearchField } from "./ListControls";
import { StartSessionDialog } from "./StartSessionDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";

type LectureTab = "active" | "archive";

interface LectureListProps {
  lectures: Lecture[];
  decks: SlideDeck[];
  canManage: boolean;
  title: string;
  deckId: string;
  creating: boolean;
  createError?: string | null;
  courseId: string;
  onTitleChange: (value: string) => void;
  onDeckChange: (value: string) => void;
  onCreate: () => void;
  onArchive: (lectureId: string) => void;
  onRestore: (lectureId: string) => void;
  onHardDelete: (lectureId: string) => void;
  onAddPresentation: () => void;
  onOpenDeck: (deckId: string) => void;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  partialImportWarning?: string;
  partialReviewAccepted: boolean;
  onPartialReviewAccepted: (accepted: boolean) => void;
}

export function LectureList({
  lectures,
  decks,
  canManage,
  title,
  deckId,
  creating,
  createError,
  courseId,
  onTitleChange,
  onDeckChange,
  onCreate,
  onArchive,
  onRestore,
  onHardDelete,
  onAddPresentation,
  onOpenDeck,
  createOpen,
  onCreateOpenChange,
  partialImportWarning,
  partialReviewAccepted,
  onPartialReviewAccepted
}: LectureListProps) {
  const activeLectures = lectures.filter((lecture) => !lecture.archived);
  const archivedLectures = lectures.filter((lecture) => lecture.archived);
  const [tab, setTab] = useState<LectureTab>("active");
  const [query, setQuery] = useState("");
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const showCreate = createOpen ?? localCreateOpen;
  const setShowCreate = (open: boolean) => {
    setLocalCreateOpen(open);
    onCreateOpenChange?.(open);
  };
  const [launchLecture, setLaunchLecture] = useState<Lecture | null>(null);
  const visibleLectures = useMemo(
    () =>
      (tab === "archive" ? archivedLectures : activeLectures).filter((lecture) =>
        includesQuery(query, lecture.title, lecture.deckTitle)
      ),
    [activeLectures, archivedLectures, query, tab]
  );
  const paged = usePagedList(visibleLectures, 20);
  const showTabs = archivedLectures.length > 0;
  const showSearch =
    (tab === "archive" ? archivedLectures : activeLectures).length > 1 || Boolean(query);

  useEffect(() => {
    if (archivedLectures.length === 0 && tab === "archive") setTab("active");
  }, [archivedLectures.length, tab]);

  return (
    <section className="material-section lecture-hub" aria-labelledby="lecture-hub-title">
      <div className="section-heading lecture-hub__header">
        <div>
          <h2 id="lecture-hub-title">
            Готовые лекции <span className="muted">({activeLectures.length})</span>
          </h2>
        </div>
        {canManage && decks.length > 0 && activeLectures.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus size={16} aria-hidden="true" />
            Новая лекция
          </Button>
        )}
      </div>
      {(showTabs || showSearch) && (
        <div className="list-toolbar lecture-hub__toolbar">
          {showSearch && (
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Найти лекцию или презентацию"
            />
          )}
          {showTabs && (
            <Tabs
              value={tab}
              onValueChange={(value) => {
                setTab(value as LectureTab);
                setQuery("");
              }}
            >
              <TabsList>
                <TabsTrigger value="active">Готовые ({activeLectures.length})</TabsTrigger>
                <TabsTrigger value="archive">Архив ({archivedLectures.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      )}
      {tab === "active" && activeLectures.length === 0 ? (
        <div className="lecture-empty-state">
          <Presentation size={28} aria-hidden="true" />
          <div>
            <strong>
              {!canManage
                ? "Лекций пока нет"
                : archivedLectures.length > 0
                  ? "Нет готовых лекций"
                  : decks.length === 0
                    ? "Сначала добавьте презентацию"
                    : "Соберите первую лекцию"}
            </strong>
            <p className="muted">
              {!canManage
                ? "Преподаватель ещё не подготовил лекции для этого курса."
                : archivedLectures.length > 0
                  ? "Восстановите лекцию из архива или подготовьте новую."
                  : decks.length === 0
                    ? "После загрузки презентации здесь появится быстрый запуск занятия."
                    : "Название и презентация уже могут стать готовой лекцией."}
            </p>
          </div>
          {canManage &&
            (decks.length === 0 ? (
              <Button type="button" onClick={onAddPresentation}>
                Добавить презентацию
              </Button>
            ) : (
              <Button type="button" onClick={() => setShowCreate(true)}>
                Создать лекцию
              </Button>
            ))}
        </div>
      ) : (
        <>
          <LectureRows
            decks={decks}
            onOpenDeck={onOpenDeck}
            lectures={paged.pageItems}
            empty={tab === "archive" ? "В архиве лекций нет." : "По запросу лекций нет."}
            canManage={canManage}
            onStart={setLaunchLecture}
            onArchive={onArchive}
            onRestore={onRestore}
            onHardDelete={onHardDelete}
          />
          <PaginationBar {...paged} onPageChange={paged.setPage} />
        </>
      )}
      <StartSessionDialog
        courseId={courseId}
        lecture={launchLecture}
        open={Boolean(launchLecture)}
        onOpenChange={(open) => {
          if (!open) setLaunchLecture(null);
        }}
      />
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent
          className="materials-dialog lecture-create-dialog"
          aria-labelledby="lecture-create-dialog-title"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("lecture-create-dialog-title")?.focus({
              preventScroll: true
            });
          }}
        >
          <DialogHeader>
            <DialogTitle id="lecture-create-dialog-title" tabIndex={-1} data-dialog-heading>
              Новая лекция
            </DialogTitle>
            <DialogDescription>
              Выберите сохранённую версию презентации для лекции.
            </DialogDescription>
          </DialogHeader>
          <div className="materials-dialog__body lecture-create-dialog__body">
            {partialImportWarning && (
              <div className="form-warning lecture-partial-warning" role="note">
                <strong>Презентация импортирована частично</strong>
                <p>{partialImportWarning}</p>
                <label className="lecture-partial-warning__accept">
                  <input
                    type="checkbox"
                    checked={partialReviewAccepted}
                    disabled={creating}
                    onChange={(event) => onPartialReviewAccepted(event.target.checked)}
                  />
                  <span>Я проверил доступные слайды и принимаю эту версию лекции</span>
                </label>
              </div>
            )}
            <form
              className="lecture-create-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (
                  title.trim() &&
                  deckId &&
                  !creating &&
                  !(partialImportWarning && !partialReviewAccepted)
                ) {
                  onCreate();
                }
              }}
            >
              {createError && (
                <p className="form-error lecture-create-error" role="alert">
                  {createError}
                </p>
              )}
              <label className="field">
                <span>Название лекции</span>
                <input
                  aria-label="Название лекции"
                  maxLength={255}
                  value={title}
                  disabled={creating}
                  onChange={(event) => onTitleChange(event.target.value)}
                  placeholder="Например, Практическое занятие"
                />
              </label>
              <label className="field">
                <span>Презентация и версия</span>
                <Select
                  value={deckId || undefined}
                  onValueChange={onDeckChange}
                  disabled={creating}
                >
                  <SelectTrigger className="inline-select">
                    <SelectValue placeholder="Выберите презентацию" />
                  </SelectTrigger>
                  <SelectContent>
                    {decks.map((deck) => (
                      <SelectItem key={deck.id} value={deck.id}>
                        {deck.title} v{deck.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p className="muted lecture-version-note">
                Лекция закрепит выбранную версию. Загрузка новой версии не заменит её автоматически.
              </p>
              <div className="lecture-create-actions">
                <Button
                  type="submit"
                  disabled={
                    !title.trim() ||
                    !deckId ||
                    creating ||
                    Boolean(partialImportWarning && !partialReviewAccepted)
                  }
                >
                  {creating ? "Сохраняем…" : "Сохранить лекцию"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={creating}
                  onClick={() => setShowCreate(false)}
                >
                  Отмена
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface LectureRowsProps {
  decks: SlideDeck[];
  onOpenDeck: (deckId: string) => void;
  lectures: Lecture[];
  empty: string;
  canManage: boolean;
  onStart?: (lecture: Lecture) => void;
  onArchive?: (lectureId: string) => void;
  onRestore?: (lectureId: string) => void;
  onHardDelete?: (lectureId: string) => void;
}

function LectureRows({
  decks,
  onOpenDeck,
  lectures,
  empty,
  canManage,
  onStart,
  onArchive,
  onRestore,
  onHardDelete
}: LectureRowsProps) {
  return (
    <div className="lecture-table">
      {lectures.length > 0 && (
        <div className="lecture-table__head" aria-hidden="true">
          <span>Лекция</span>
          <span>Презентация и версия</span>
          <span>Действия</span>
        </div>
      )}
      <ul className="card-list">
        {lectures.length === 0 && empty && <li className="muted">{empty}</li>}
        {lectures.map((lecture) => (
          <li key={lecture.id} className="lecture-row">
            <div className="lecture-row__copy">
              <strong>{lecture.title}</strong>
            </div>
            <div className="lecture-row__deck">
              <button
                type="button"
                className="lecture-deck-link"
                onClick={() => onOpenDeck(lecture.deckId)}
              >
                <Presentation size={17} aria-hidden="true" />
                <span>{lecture.deckTitle}</span>
                <span className="material-version">v{lecture.deckVersion}</span>
              </button>
              {decks.some(
                (deck) => deck.title === lecture.deckTitle && deck.version > lecture.deckVersion
              ) && (
                <small className="muted">
                  Доступна v
                  {Math.max(
                    ...decks
                      .filter((deck) => deck.title === lecture.deckTitle)
                      .map((deck) => deck.version)
                  )}
                </small>
              )}
            </div>
            {canManage && !lecture.archived && (
              <div className="lecture-row__actions">
                <Button type="button" variant="outline" onClick={() => onStart?.(lecture)}>
                  <Play size={16} aria-hidden="true" />
                  Провести занятие
                </Button>
                <ConfirmActionButton
                  title="Архивировать лекцию?"
                  description="Лекция уйдёт в архив, её можно будет восстановить."
                  confirmLabel="Архивировать"
                  variant="ghost"
                  size="icon"
                  label={`Архивировать лекцию ${lecture.title}`}
                  onConfirm={() => onArchive?.(lecture.id)}
                >
                  <Archive size={18} aria-hidden="true" />
                </ConfirmActionButton>
              </div>
            )}
            {canManage && lecture.archived && (
              <div className="lecture-row__actions">
                <Button type="button" variant="outline" onClick={() => onRestore?.(lecture.id)}>
                  <RotateCcw size={16} aria-hidden="true" /> Восстановить
                </Button>
                <ConfirmActionButton
                  title="Удалить лекцию навсегда?"
                  description="История сессий и вложения этой лекции будут удалены."
                  confirmLabel="Удалить навсегда"
                  variant="destructive"
                  onConfirm={() => onHardDelete?.(lecture.id)}
                >
                  <Trash2 size={16} aria-hidden="true" /> Удалить навсегда
                </ConfirmActionButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
