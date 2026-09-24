import { useMemo, useState } from "react";
import type { Lecture, SlideDeck } from "../app/api/content-api";
import { pluralizeRu } from "../shared/lib/plural";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { PaginationBar, SearchField } from "./ListControls";

type LectureTab = "active" | "archive";

interface LectureListProps {
  lectures: Lecture[];
  decks: SlideDeck[];
  canManage: boolean;
  title: string;
  deckId: string;
  creating: boolean;
  startingId?: string;
  onTitleChange: (value: string) => void;
  onDeckChange: (value: string) => void;
  onCreate: () => void;
  onStart: (lectureId: string) => void;
  onArchive: (lectureId: string) => void;
  onRestore: (lectureId: string) => void;
  onHardDelete: (lectureId: string) => void;
}

export function LectureList({
  lectures,
  decks,
  canManage,
  title,
  deckId,
  creating,
  startingId,
  onTitleChange,
  onDeckChange,
  onCreate,
  onStart,
  onArchive,
  onRestore,
  onHardDelete
}: LectureListProps) {
  const activeLectures = lectures.filter((lecture) => !lecture.archived);
  const archivedLectures = lectures.filter((lecture) => lecture.archived);
  const [tab, setTab] = useState<LectureTab>("active");
  const [query, setQuery] = useState("");
  const visibleLectures = useMemo(
    () =>
      (tab === "archive" ? archivedLectures : activeLectures).filter((lecture) =>
        includesQuery(query, lecture.title, lecture.deckTitle)
      ),
    [activeLectures, archivedLectures, query, tab]
  );
  const paged = usePagedList(visibleLectures, 20);

  return (
    <section className="material-section">
      <div className="section-heading">
        <h2>Лекции</h2>
        <span className="muted">
          {activeLectures.length}{" "}
          {pluralizeRu(activeLectures.length, "активная", "активные", "активных")}
        </span>
      </div>
      {canManage && (
        <div className="inline-form">
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
          <button
            className="btn-primary"
            type="button"
            disabled={!title || !deckId || creating}
            onClick={onCreate}
          >
            Создать
          </button>
        </div>
      )}
      <div className="list-toolbar">
        <Tabs value={tab} onValueChange={(value) => setTab(value as LectureTab)}>
          <TabsList>
            <TabsTrigger value="active">Активные ({activeLectures.length})</TabsTrigger>
            <TabsTrigger value="archive">Архив ({archivedLectures.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchField value={query} onChange={setQuery} placeholder="Найти лекцию или дек" />
      </div>
      <LectureRows
        lectures={paged.pageItems}
        empty={tab === "archive" ? "В архиве лекций нет." : "Лекции ещё не созданы."}
        canManage={canManage}
        startingId={startingId}
        onStart={onStart}
        onArchive={onArchive}
        onRestore={onRestore}
        onHardDelete={onHardDelete}
      />
      <PaginationBar {...paged} onPageChange={paged.setPage} />
    </section>
  );
}

interface LectureRowsProps {
  lectures: Lecture[];
  empty: string;
  canManage: boolean;
  startingId?: string;
  onStart?: (lectureId: string) => void;
  onArchive?: (lectureId: string) => void;
  onRestore?: (lectureId: string) => void;
  onHardDelete?: (lectureId: string) => void;
}

function LectureRows({
  lectures,
  empty,
  canManage,
  startingId,
  onStart,
  onArchive,
  onRestore,
  onHardDelete
}: LectureRowsProps) {
  return (
    <ul className="card-list">
      {lectures.length === 0 && empty && <li className="muted">{empty}</li>}
      {lectures.map((lecture) => (
        <li key={lecture.id} className="card-link">
          <span className="card-title">{lecture.title}</span>
          <span className="muted">
            {lecture.deckTitle} v{lecture.deckVersion}
          </span>
          {canManage && !lecture.archived && (
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={startingId === lecture.id}
                onClick={() => onStart?.(lecture.id)}
              >
                Старт
              </button>
              <ConfirmActionButton
                title="Архивировать лекцию?"
                description="Лекция уйдёт в архив, её можно будет восстановить."
                disabled={startingId === lecture.id}
                onConfirm={() => onArchive?.(lecture.id)}
              >
                Архив
              </ConfirmActionButton>
            </>
          )}
          {canManage && lecture.archived && (
            <>
              <button type="button" className="btn-ghost" onClick={() => onRestore?.(lecture.id)}>
                Восстановить
              </button>
              <ConfirmActionButton
                title="Удалить лекцию навсегда?"
                description="История сессий и вложения этой лекции будут удалены."
                confirmLabel="Удалить навсегда"
                onConfirm={() => onHardDelete?.(lecture.id)}
              >
                Удалить навсегда
              </ConfirmActionButton>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
