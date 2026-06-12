import type { Lecture, SlideDeck } from "../app/api/content-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../shared/ui/select";
import { ConfirmActionButton } from "./ConfirmActionButton";

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

  return (
    <section className="material-section">
      <div className="section-heading">
        <h2>Лекции</h2>
        <span className="muted">{activeLectures.length} активных</span>
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
      <LectureRows
        lectures={activeLectures}
        empty="Лекции ещё не созданы."
        canManage={canManage}
        startingId={startingId}
        onStart={onStart}
        onArchive={onArchive}
      />
      {archivedLectures.length > 0 && (
        <div className="archive-section">
          <div className="section-heading">
            <h3>Архив</h3>
            <span className="muted">{archivedLectures.length} лекций</span>
          </div>
          <LectureRows
            lectures={archivedLectures}
            empty=""
            canManage={canManage}
            onRestore={onRestore}
            onHardDelete={onHardDelete}
          />
        </div>
      )}
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
