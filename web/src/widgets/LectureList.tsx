import { useEffect, useMemo, useState } from "react";
import { Archive, Plus, Presentation, Play, RotateCcw, Trash2 } from "lucide-react";
import type { Lecture, SlideDeck } from "../app/api/content-api";
import { pluralizeRu } from "../shared/lib/plural";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { PaginationBar, SearchField } from "./ListControls";
import { StartSessionDialog } from "./StartSessionDialog";

type LectureTab = "active" | "archive";

interface LectureListProps {
  lectures: Lecture[];
  decks: SlideDeck[];
  canManage: boolean;
  title: string;
  deckId: string;
  creating: boolean;
  courseId: string;
  onTitleChange: (value: string) => void;
  onDeckChange: (value: string) => void;
  onCreate: () => void;
  onArchive: (lectureId: string) => void;
  onRestore: (lectureId: string) => void;
  onHardDelete: (lectureId: string) => void;
  onAddPresentation: () => void;
}

export function LectureList({
  lectures,
  decks,
  canManage,
  title,
  deckId,
  creating,
  courseId,
  onTitleChange,
  onDeckChange,
  onCreate,
  onArchive,
  onRestore,
  onHardDelete,
  onAddPresentation
}: LectureListProps) {
  const activeLectures = lectures.filter((lecture) => !lecture.archived);
  const archivedLectures = lectures.filter((lecture) => lecture.archived);
  const [tab, setTab] = useState<LectureTab>("active");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
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
  const showSearch = activeLectures.length + archivedLectures.length > 5 || Boolean(query);

  useEffect(() => {
    if (archivedLectures.length === 0 && tab === "archive") setTab("active");
  }, [archivedLectures.length, tab]);

  return (
    <section className="material-section lecture-hub" aria-labelledby="lecture-hub-title">
      <div className="section-heading lecture-hub__header">
        <div>
          <h2 id="lecture-hub-title">Лекции</h2>
          <p className="muted">
            {activeLectures.length > 0
              ? `${activeLectures.length} ${pluralizeRu(activeLectures.length, "лекция готова", "лекции готовы", "лекций готовы")}`
              : "Создайте лекцию и привяжите презентацию."}
          </p>
        </div>
        {canManage && activeLectures.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setShowCreate((value) => !value)}>
            <Plus size={16} aria-hidden="true" />
            Новая лекция
          </Button>
        )}
      </div>
      {canManage && showCreate && (
        <div className="inline-form lecture-create-form">
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Название лекции"
          />
          <Select value={deckId || undefined} onValueChange={onDeckChange}>
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
          <Button type="button" disabled={!title || !deckId || creating} onClick={onCreate}>
            Создать
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
            Отмена
          </Button>
        </div>
      )}
      {tab === "active" && activeLectures.length === 0 ? (
        <div className="lecture-empty-state">
          <Presentation size={28} aria-hidden="true" />
          <div>
            <strong>
              {decks.length === 0 ? "Сначала добавьте презентацию" : "Соберите первую лекцию"}
            </strong>
            <p className="muted">
              {decks.length === 0
                ? "После загрузки презентации здесь появится быстрый запуск занятия."
                : "Название и презентация уже могут стать готовой лекцией."}
            </p>
          </div>
          {decks.length === 0 ? (
            <Button type="button" onClick={onAddPresentation}>
              Добавить презентацию
            </Button>
          ) : (
            <Button type="button" onClick={() => setShowCreate(true)}>
              Создать лекцию
            </Button>
          )}
        </div>
      ) : (
        <>
          {(showTabs || showSearch) && (
            <div className="list-toolbar lecture-hub__toolbar">
              {showTabs && (
                <Tabs value={tab} onValueChange={(value) => setTab(value as LectureTab)}>
                  <TabsList>
                    <TabsTrigger value="active">Готовые ({activeLectures.length})</TabsTrigger>
                    <TabsTrigger value="archive">Архив ({archivedLectures.length})</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              {showSearch && (
                <SearchField value={query} onChange={setQuery} placeholder="Найти лекцию" />
              )}
            </div>
          )}
          <LectureRows
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
    </section>
  );
}

interface LectureRowsProps {
  lectures: Lecture[];
  empty: string;
  canManage: boolean;
  onStart?: (lecture: Lecture) => void;
  onArchive?: (lectureId: string) => void;
  onRestore?: (lectureId: string) => void;
  onHardDelete?: (lectureId: string) => void;
}

function LectureRows({
  lectures,
  empty,
  canManage,
  onStart,
  onArchive,
  onRestore,
  onHardDelete
}: LectureRowsProps) {
  return (
    <ul className="card-list">
      {lectures.length === 0 && empty && <li className="muted">{empty}</li>}
      {lectures.map((lecture) => (
        <li key={lecture.id} className="lecture-row">
          <div className="lecture-row__copy">
            <strong>{lecture.title}</strong>
            <span className="muted">
              {lecture.deckTitle} · версия {lecture.deckVersion}
            </span>
          </div>
          {canManage && !lecture.archived && (
            <div className="lecture-row__actions">
              <Button type="button" onClick={() => onStart?.(lecture)}>
                <Play size={16} aria-hidden="true" />
                Запустить занятие
              </Button>
              <ConfirmActionButton
                title="Архивировать лекцию?"
                description="Лекция уйдёт в архив, её можно будет восстановить."
                confirmLabel="Архивировать"
                variant="outline"
                onConfirm={() => onArchive?.(lecture.id)}
              >
                <Archive size={16} aria-hidden="true" /> Архивировать
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
  );
}
