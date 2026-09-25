import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, History, RotateCcw, Trash2 } from "lucide-react";
import type { SlideDeck } from "../app/api/content-api";
import { pluralizeRu } from "../shared/lib/plural";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Button } from "../shared/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../shared/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { PaginationBar, SearchField } from "./ListControls";

type DeckTab = "active" | "archive";

interface DeckVersionGroup {
  title: string;
  current: SlideDeck;
  history: SlideDeck[];
}

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

export function DeckListPanel(props: DeckListPanelProps) {
  const { decks } = props;
  const [tab, setTab] = useState<DeckTab>("active");
  const [query, setQuery] = useState("");
  const activeGroups = useMemo(() => groupActiveDecks(decks), [decks]);
  const archivedDecks = useMemo(() => decks.filter((deck) => deck.archived), [decks]);
  const visibleGroups = useMemo(
    () =>
      activeGroups.filter((group) =>
        group.history
          .concat(group.current)
          .some((deck) => includesQuery(query, deck.title, deck.sourceFilename))
      ),
    [activeGroups, query]
  );
  const visibleArchived = useMemo(
    () => archivedDecks.filter((deck) => includesQuery(query, deck.title, deck.sourceFilename)),
    [archivedDecks, query]
  );
  const activePaged = usePagedList(visibleGroups, 20);
  const archivePaged = usePagedList(visibleArchived, 20);
  const showTabs = archivedDecks.length > 0;
  const showSearch = activeGroups.length + archivedDecks.length > 5 || Boolean(query);

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
                <TabsTrigger value="active">Доступные ({activeGroups.length})</TabsTrigger>
                <TabsTrigger value="archive">Архив ({archivedDecks.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {showSearch && (
            <SearchField value={query} onChange={setQuery} placeholder="Найти презентацию" />
          )}
        </div>
      )}

      {tab === "active" ? (
        <div className="deck-list">
          {visibleGroups.length === 0 && (
            <p className="muted">
              {query ? "По запросу презентаций нет." : "Загрузите первую презентацию курса."}
            </p>
          )}
          {activePaged.pageItems.map((group) => (
            <DeckVersionSection key={group.title} group={group} {...props} />
          ))}
        </div>
      ) : (
        <div className="deck-list">
          {visibleArchived.length === 0 && <p className="muted">В архиве презентаций нет.</p>}
          {archivePaged.pageItems.map((deck) => (
            <DeckRow key={deck.id} deck={deck} context="archive" {...props} />
          ))}
        </div>
      )}

      {tab === "active" ? (
        <PaginationBar {...activePaged} onPageChange={activePaged.setPage} />
      ) : (
        <PaginationBar {...archivePaged} onPageChange={archivePaged.setPage} />
      )}
    </section>
  );
}

function DeckVersionSection({ group, ...props }: DeckListPanelProps & { group: DeckVersionGroup }) {
  const selectedInHistory = group.history.some((deck) => deck.id === props.selectedDeckId);
  return (
    <article className="deck-version-group">
      <DeckRow deck={group.current} context="current" {...props} />
      {group.history.length > 0 && (
        <Collapsible defaultOpen={selectedInHistory}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" className="deck-history__trigger">
              <History size={16} aria-hidden="true" />
              История версий ({group.history.length})
              <ChevronDown className="deck-history__chevron" size={16} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="deck-history__content">
            {group.history.map((deck) => (
              <DeckRow key={deck.id} deck={deck} context="history" {...props} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </article>
  );
}

function DeckRow({
  deck,
  context,
  selectedDeckId,
  canManage,
  archivePending,
  restorePending,
  hardDeletePending,
  onSelect,
  onArchive,
  onRestore,
  onHardDelete
}: DeckListPanelProps & { deck: SlideDeck; context: "current" | "history" | "archive" }) {
  const status =
    context === "current"
      ? "Последняя доступная версия"
      : context === "history"
        ? "Предыдущая версия"
        : "В архиве";
  return (
    <div className={`deck-pill${deck.id === selectedDeckId ? " deck-pill--active" : ""}`}>
      <button className="deck-pill__open" type="button" onClick={() => onSelect(deck.id)}>
        <span>{deck.title}</span>
        <small>
          {status} · v{deck.version} · {deck.slideCount}{" "}
          {pluralizeRu(deck.slideCount, "слайд", "слайда", "слайдов")}
        </small>
      </button>
      {canManage && (
        <div className="deck-pill__actions">
          {!deck.archived ? (
            <ConfirmActionButton
              title="Архивировать презентацию?"
              description="Презентация исчезнет из активного списка, но её можно восстановить."
              confirmLabel="Архивировать"
              variant="outline"
              disabled={archivePending}
              onConfirm={() => onArchive(deck.id)}
            >
              <Archive size={16} aria-hidden="true" /> Архивировать
            </ConfirmActionButton>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={restorePending}
                onClick={() => onRestore(deck.id)}
              >
                <RotateCcw size={16} aria-hidden="true" /> Восстановить
              </Button>
              <ConfirmActionButton
                title="Удалить презентацию навсегда?"
                description="Удаление возможно только если дек не привязан к лекциям."
                confirmLabel="Удалить навсегда"
                variant="destructive"
                disabled={hardDeletePending}
                onConfirm={() => onHardDelete(deck.id)}
              >
                <Trash2 size={16} aria-hidden="true" /> Удалить навсегда
              </ConfirmActionButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function groupActiveDecks(decks: SlideDeck[]): DeckVersionGroup[] {
  const byTitle = new Map<string, SlideDeck[]>();
  decks
    .filter((deck) => !deck.archived)
    .forEach((deck) => {
      byTitle.set(deck.title, [...(byTitle.get(deck.title) ?? []), deck]);
    });
  return Array.from(byTitle.entries())
    .map(([title, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { title, current: sorted[0], history: sorted.slice(1) };
    })
    .sort((a, b) => b.current.createdAt.localeCompare(a.current.createdAt));
}
