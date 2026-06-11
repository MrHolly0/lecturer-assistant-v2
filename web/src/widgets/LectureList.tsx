import type { Lecture, SlideDeck } from "../app/api/content-api";

interface LectureListProps {
  lectures: Lecture[];
  decks: SlideDeck[];
  title: string;
  deckId: string;
  creating: boolean;
  startingId?: string;
  onTitleChange: (value: string) => void;
  onDeckChange: (value: string) => void;
  onCreate: () => void;
  onStart: (lectureId: string) => void;
}

export function LectureList({
  lectures,
  decks,
  title,
  deckId,
  creating,
  startingId,
  onTitleChange,
  onDeckChange,
  onCreate,
  onStart
}: LectureListProps) {
  return (
    <section className="material-section">
      <div className="section-heading">
        <h2>Лекции</h2>
        <span className="muted">{lectures.length} создано</span>
      </div>
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
      <ul className="card-list">
        {lectures.length === 0 && <li className="muted">Лекции ещё не созданы.</li>}
        {lectures.map((lecture) => (
          <li key={lecture.id} className="card-link">
            <span className="card-title">{lecture.title}</span>
            <span className="muted">{lecture.archived ? "архив" : "активна"}</span>
            <button
              type="button"
              className="btn-ghost"
              disabled={startingId === lecture.id}
              onClick={() => onStart(lecture.id)}
            >
              Старт
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
