import { useEffect, useMemo, useState } from "react";
import type { SlideDeck } from "../app/api/content-api";
import { pluralizeRu } from "../shared/lib/plural";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { PaginationBar, SearchField } from "./ListControls";

type DeckTab = "active" | "archive";

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
  const [tab, setTab] = useState<DeckTab>("active");
  const [query, setQuery] = useState("");
  const visibleDecks = useMemo(
    () =>
      (tab === "archive" ? archivedDecks : activeDecks).filter((deck) =>
        includesQuery(query, deck.title, deck.sourceFilename)
      ),
    [activeDecks, archivedDecks, query, tab]
  );
  const paged = usePagedList(visibleDecks, 20);
  const showTabs = archivedDecks.length > 0;
  const showSearch = activeDecks.length + archivedDecks.length > 5 || Boolean(query);

  useEffect(() => {
    if (!showTabs && tab === "archive") setTab("active");
  }, [showTabs, tab]);

  return (
    <section className="material-section" aria-label="Список презентаций">
      {(showTabs || showSearch) && (
        <div className="list-toolbar">
          {showTabs && (
            <Tabs value={tab} onValueChange={(value) => setTab(value as DeckTab)}>
              <TabsList>
                <TabsTrigger value="active">Активные ({activeDecks.length})</TabsTrigger>
                <TabsTrigger value="archive">Архив ({archivedDecks.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {showSearch && (
            <SearchField value={query} onChange={setQuery} placeholder="Найти презентацию" />
          )}
        </div>
      )}
      <div className="deck-list">
        {visibleDecks.length === 0 && (
          <p className="muted">
            {tab === "archive"
              ? "В архиве презентаций нет."
              : "Загрузите первую презентацию курса."}
          </p>
        )}
        {paged.pageItems.map((deck) => (
          <div
            key={deck.id}
            className={`deck-pill ${deck.id === selectedDeckId ? "deck-pill--active" : ""}`}
          >
            <button type="button" onClick={() => onSelect(deck.id)}>
              <span>{deck.title}</span>
              <small>
                v{deck.version} · {deck.slideCount}{" "}
                {pluralizeRu(deck.slideCount, "слайд", "слайда", "слайдов")}
              </small>
            </button>
            {canManage && !deck.archived && (
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
            {canManage && deck.archived && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={restorePending}
                  onClick={() => onRestore(deck.id)}
                >
                  Восстановить
                </Button>
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
      <PaginationBar {...paged} onPageChange={paged.setPage} />
    </section>
  );
}
