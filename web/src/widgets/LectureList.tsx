import type { Lecture, SlideDeck } from "../app/api/content-api";
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
  onDelete: (lectureId: string) => void;
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
  onDelete
}: LectureListProps) {
  return (
    <section className="material-section">
      <div className="section-heading">
        <h2>Лекции</h2>
        <span className="muted">{lectures.length} создано</span>
      </div>
      {canManage && (
        <div className="inline-form">
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Название лекции"
          />
          <select value={deckId} onChange={(event) => onDeckChange(event.target.value)}>
            <option value="">Выберите презентацию</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.title} v{deck.version}
              </option>
            ))}
          </select>
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
      <ul className="card-list">
        {lectures.length === 0 && <li className="muted">Лекции ещё не созданы.</li>}
        {lectures.map((lecture) => (
          <li key={lecture.id} className="card-link">
            <span className="card-title">{lecture.title}</span>
            <span className="muted">{lecture.archived ? "архив" : "активна"}</span>
            {canManage && (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={startingId === lecture.id || lecture.archived}
                  onClick={() => onStart(lecture.id)}
                >
                  Старт
                </button>
                {!lecture.archived && (
                  <ConfirmActionButton
                    title="Удалить лекцию?"
                    description="Черновик без сессий будет удалён, лекция с историей уйдёт в архив."
                    disabled={startingId === lecture.id}
                    onConfirm={() => onDelete(lecture.id)}
                  >
                    Удалить
                  </ConfirmActionButton>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
