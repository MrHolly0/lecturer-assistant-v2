import { useEffect, useMemo, useState, useRef } from "react";
import {
  Archive,
  ChevronDown,
  RotateCcw,
  Trash2,
  ExternalLink,
  Info,
  Presentation,
  MoreHorizontal
} from "lucide-react";
import type { Lecture, SlideDeck } from "../app/api/content-api";
import { pluralizeRu } from "../shared/lib/plural";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Button } from "../shared/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../shared/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from "../shared/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from "../shared/ui/alert-dialog";
import { PaginationBar, SearchField } from "./ListControls";

type DeckTab = "active" | "archive";

interface DeckVersionGroup {
  title: string;
  current: SlideDeck;
  history: SlideDeck[];
}

interface DeckListPanelProps {
  decks: SlideDeck[];
  lectures?: Lecture[];
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
  useEffect(() => {
    if (!archivedDecks.length) setTab("active");
  }, [archivedDecks.length]);
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

  return (
    <section className="material-section presentation-library" aria-label="Список презентаций">
      {(decks.length > 1 || query || archivedDecks.length > 0) && (
        <div className="presentation-toolbar">
          {(decks.length > 1 || query) && (
            <SearchField value={query} onChange={setQuery} placeholder="Найти презентацию" />
          )}
          {archivedDecks.length > 0 && (
            <Tabs value={tab} onValueChange={(value) => setTab(value as DeckTab)}>
              <TabsList>
                <TabsTrigger value="active">Доступные ({activeGroups.length})</TabsTrigger>
                <TabsTrigger value="archive">Архив ({archivedDecks.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      )}

      {tab === "active" ? (
        <div className="presentation-list">
          {visibleGroups.length === 0 && (
            <p className="muted">
              {query
                ? "По запросу презентаций нет."
                : archivedDecks.length > 0
                  ? "Все презентации в архиве. Откройте архив, чтобы восстановить нужную."
                  : "Загрузите первую презентацию курса."}
            </p>
          )}
          {activePaged.pageItems.map((group) => (
            <DeckVersionSection key={group.title} group={group} {...props} />
          ))}
        </div>
      ) : (
        <div className="presentation-list">
          {visibleArchived.length === 0 && <p className="muted">В архиве презентаций нет.</p>}
          {archivePaged.pageItems.map((deck) => (
            <DeckRow key={deck.id} deck={deck} context="archive" {...props} />
          ))}
        </div>
      )}

      {activeGroups.some((group) => group.history.length > 0) && (
        <p className="deck-version-note">
          <Info size={17} aria-hidden="true" /> Загрузка новой версии не меняет уже созданные
          лекции.
        </p>
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
  const [open, setOpen] = useState(group.history.some((deck) => deck.id === props.selectedDeckId));
  const versions = [group.current, ...group.history];
  return (
    <article className="presentation-group">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="presentation-group__heading">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${open ? "Свернуть" : "Показать"} версии: ${group.title}`}
            >
              <ChevronDown size={18} className={open ? "is-open" : ""} />
            </Button>
          </CollapsibleTrigger>
          <DeckThumbnail deck={group.current} />
          <button
            type="button"
            className="presentation-group__title"
            onClick={() => props.onSelect(group.current.id)}
          >
            <strong>{group.title}</strong>
            <small>
              {!open && (
                <>
                  v{group.current.version} · {slideCount(group.current)} ·{" "}
                </>
              )}
              {versions.length} {pluralizeRu(versions.length, "версия", "версии", "версий")}
            </small>
          </button>
          <div className="presentation-group__actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onSelect(group.current.id)}
            >
              <ExternalLink size={17} /> Открыть слайды
            </Button>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline">
                <ChevronDown size={17} className={open ? "is-open" : ""} /> Версии
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent className="presentation-versions">
          {versions.map((deck, index) => (
            <DeckRow
              key={deck.id}
              deck={deck}
              context={index === 0 ? "current" : "history"}
              {...props}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

function slideCount(deck: SlideDeck) {
  return `${deck.slideCount} ${pluralizeRu(deck.slideCount, "слайд", "слайда", "слайдов")}`;
}

function DeckThumbnail({ deck }: { deck: SlideDeck }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="presentation-thumbnail">
      {deck.thumbnailUrl && !failed ? (
        <img src={deck.thumbnailUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Presentation size={24} aria-hidden="true" />
      )}
    </span>
  );
}

function DeckRow({
  deck,
  context,
  lectures,
  selectedDeckId,
  onSelect,
  ...props
}: DeckListPanelProps & {
  deck: SlideDeck;
  context: "current" | "history" | "archive";
}) {
  const archived = context === "archive";
  return (
    <div
      className={`presentation-version${deck.id === selectedDeckId ? " is-selected" : ""}${archived ? " is-archived" : ""}`}
    >
      {archived && <DeckThumbnail deck={deck} />}
      <div className="presentation-version__description">
        {archived && <strong>{deck.title}</strong>}
        <span>
          <b>v{deck.version}</b>{" "}
          <span className="muted">
            {context === "current" ? "Последняя доступная · " : ""}
            {slideCount(deck)}
          </span>
        </span>
      </div>
      <DeckUsage lectures={lectures} deckId={deck.id} />
      <div className="presentation-version__actions">
        <Button type="button" variant="outline" onClick={() => onSelect(deck.id)}>
          <ExternalLink size={16} /> Открыть
        </Button>
        {archived && props.canManage && (
          <Button
            type="button"
            variant="outline"
            disabled={props.restorePending}
            onClick={() => props.onRestore(deck.id)}
          >
            <RotateCcw size={16} /> Восстановить
          </Button>
        )}
        {props.canManage && <DeckActions deck={deck} {...props} />}
      </div>
    </div>
  );
}

function DeckActions({
  deck,
  archivePending,
  hardDeletePending,
  onArchive,
  onHardDelete
}: {
  deck: SlideDeck;
} & Pick<
  DeckListPanelProps,
  "archivePending" | "hardDeletePending" | "onArchive" | "onHardDelete"
>) {
  const [confirm, setConfirm] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Действия с презентацией ${deck.title}, версия ${deck.version}`}
          >
            <MoreHorizontal size={19} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={deck.archived ? hardDeletePending : archivePending}
            onSelect={() => setConfirm(true)}
          >
            {deck.archived ? <Trash2 size={16} /> : <Archive size={16} />}
            {deck.archived ? "Удалить навсегда" : "В архив"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deck.archived ? "Удалить презентацию навсегда?" : "Архивировать презентацию?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deck.archived
                ? "Удаление возможно только если презентация не привязана к лекциям."
                : "Эта версия исчезнет из доступных. Её можно восстановить из архива. Уже созданные лекции сохранят свою версию."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => (deck.archived ? onHardDelete(deck.id) : onArchive(deck.id))}
            >
              {deck.archived ? "Удалить навсегда" : "Архивировать"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DeckUsage({ lectures, deckId }: { lectures?: Lecture[]; deckId: string }) {
  if (!lectures) return <span className="presentation-usage muted">Привязки не загружены</span>;
  const bound = lectures.filter((lecture) => lecture.deckId === deckId);
  if (!bound.length)
    return <span className="presentation-usage muted">Не используется в лекциях</span>;
  return (
    <details className="presentation-usage">
      <summary>
        {bound.length === 1
          ? `В лекции: ${bound[0].title}${bound[0].archived ? " (в архиве)" : ""}`
          : `В лекциях: ${bound.length}`}
      </summary>
      <ul>
        {bound.map((lecture) => (
          <li key={lecture.id}>
            {lecture.title}
            {lecture.archived ? " (в архиве)" : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function groupActiveDecks(decks: SlideDeck[]): DeckVersionGroup[] {
  const byTitle = new Map<string, SlideDeck[]>();
  decks
    .filter((deck) => !deck.archived)
    .forEach((deck) => byTitle.set(deck.title, [...(byTitle.get(deck.title) ?? []), deck]));
  return Array.from(byTitle.entries())
    .map(([title, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { title, current: sorted[0], history: sorted.slice(1) };
    })
    .sort((a, b) => b.current.createdAt.localeCompare(a.current.createdAt));
}
