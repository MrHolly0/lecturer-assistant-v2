import type { SlideDeck } from "../app/api/content-api";
import { ConfirmActionButton } from "./ConfirmActionButton";

interface DeckListPanelProps {
  decks: SlideDeck[];
  selectedDeckId: string;
  canManage: boolean;
  archivePending: boolean;
  restorePending: boolean;
  hardDeletePending: boolean;
  onSelect: (deckId: string) => void;
  onArchive: (deckId: string) => void;
  onRestore: (deckId: string) => void;
  onHardDelete: (deckId: string) => void;
}

export function DeckListPanel({
  decks,
  selectedDeckId,
  canManage,
  archivePending,
  restorePending,
  hardDeletePending,
  onSelect,
  onArchive,
  onRestore,
  onHardDelete
}: DeckListPanelProps) {
  const activeDecks = decks.filter((deck) => !deck.archived);
  const archivedDecks = decks.filter((deck) => deck.archived);

  return (
    <section className="material-section">
      <div className="section-heading">
        <h2>Презентации</h2>
        <span className="muted">{activeDecks.length} активных</span>
      </div>
      <div className="deck-list">
        {activeDecks.length === 0 && <p className="muted">Загрузите первую презентацию курса.</p>}
        {activeDecks.map((deck) => (
          <div key={deck.id} className={`deck-pill ${deck.id === selectedDeckId ? "deck-pill--active" : ""}`}>
            <button type="button" onClick={() => onSelect(deck.id)}>
              <span>{deck.title}</span>
              <small>
                v{deck.version} · {deck.slideCount} слайдов
              </small>
            </button>
            {canManage && (
              <ConfirmActionButton
                title="Архивировать презентацию?"
                description="Презентация исчезнет из активного списка, но её можно восстановить."
                confirmLabel="Архивировать"
                disabled={archivePending}
                onConfirm={() => onArchive(deck.id)}
              >
                Архив
              </ConfirmActionButton>
            )}
          </div>
        ))}
      </div>
      {archivedDecks.length > 0 && (
        <div className="archive-section">
          <div className="section-heading">
            <h3>Архив</h3>
            <span className="muted">{archivedDecks.length} презентаций</span>
          </div>
          <div className="deck-list">
            {archivedDecks.map((deck) => (
              <div key={deck.id} className="deck-pill">
                <button type="button" onClick={() => onSelect(deck.id)}>
                  <span>{deck.title}</span>
                  <small>
                    v{deck.version} · {deck.slideCount} слайдов
                  </small>
                </button>
                {canManage && (
                  <>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={restorePending}
                      onClick={() => onRestore(deck.id)}
                    >
                      Восстановить
                    </button>
                    <ConfirmActionButton
                      title="Удалить презентацию навсегда?"
                      description="Удаление возможно только если дек не привязан к лекциям."
                      confirmLabel="Удалить навсегда"
                      disabled={hardDeletePending}
                      onConfirm={() => onHardDelete(deck.id)}
                    >
                      Удалить навсегда
                    </ConfirmActionButton>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
