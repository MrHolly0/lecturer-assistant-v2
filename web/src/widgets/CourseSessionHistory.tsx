import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, CalendarDays } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { listSessionHistory } from "../app/api/live-api";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { localDayBoundary } from "../shared/lib/sessionHistoryDates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { PaginationBar, SearchField } from "./ListControls";
import { pluralizeRu } from "../shared/lib/plural";
import { SessionGroups } from "./SessionGroups";
import { CourseSessionPreview } from "./CourseSessionPreview";
import { formatSessionDuration } from "../shared/lib/analyticsNavigation";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/popover";

const PAGE_SIZE = 20;
const FILTER_KEYS = ["historySearch", "historyGroup", "historyFrom", "historyTo", "historyPage"];

export function CourseSessionHistory({ courseId }: { courseId: string }) {
  const [params, setParams] = useSearchParams();
  const [periodOpen, setPeriodOpen] = useState(false);
  const requestedId = params.get("historySession") ?? "";
  const showDetail = Boolean(requestedId) && params.get("historyList") !== "1";
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    if (!window.matchMedia("(max-width: 800px)").matches) return;
    const target = document.querySelector<HTMLElement>(
      showDetail ? ".session-history__mobile-back" : '.session-history__item[aria-current="true"]'
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [requestedId, showDetail]);
  const query = (params.get("historySearch") ?? "").slice(0, 200);
  const groupId = params.get("historyGroup") ?? "";
  const dateFrom = params.get("historyFrom") ?? "";
  const dateTo = params.get("historyTo") ?? "";
  const rawPage = Number(params.get("historyPage") ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage < 1000000 ? rawPage : 1;
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const endedFrom = localDayBoundary(dateFrom);
  const endedBefore = localDayBoundary(dateTo, true);
  const dateError =
    (dateFrom && !endedFrom) || (dateTo && !endedBefore)
      ? "Проверьте даты периода."
      : dateFrom && dateTo && dateFrom > dateTo
        ? "Дата «по» должна быть не раньше даты «с»."
        : "";
  const typing = query !== debouncedQuery;
  const historyQuery = useQuery({
    queryKey: [
      "live",
      courseId,
      "history",
      page,
      debouncedQuery.trim(),
      groupId,
      endedFrom,
      endedBefore
    ],
    queryFn: () =>
      listSessionHistory(courseId, PAGE_SIZE, (page - 1) * PAGE_SIZE, {
        query: debouncedQuery.trim(),
        groupId,
        endedFrom,
        endedBefore
      }),
    enabled: !dateError && !typing,
    placeholderData: keepPreviousData
  });
  const history = historyQuery.data;
  const groups = history?.availableGroups ?? [];
  const pageCount = Math.max(1, Math.ceil((history?.total ?? 0) / PAGE_SIZE));
  const busy = typing || historyQuery.isFetching;
  const ready = !dateError && !typing && !historyQuery.isPlaceholderData && !historyQuery.isError;
  const hasFilters = Boolean(query || groupId || dateFrom || dateTo);
  const showFilters = hasFilters || Boolean(history?.total) || page > 1;
  function changeFilter(key: string, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("historyPage");
        next.delete("historySession");
        next.delete("historyList");
        return next;
      },
      { replace: true }
    );
  }
  function changePage(value: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("historySession");
      next.delete("historyList");
      if (value > 1) next.set("historyPage", String(value));
      else next.delete("historyPage");
      return next;
    });
  }
  function clearFilters() {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        FILTER_KEYS.forEach((key) => next.delete(key));
        next.delete("historySession");
        next.delete("historyList");
        return next;
      },
      { replace: true }
    );
  }
  useEffect(() => {
    if (
      history &&
      !historyQuery.isPlaceholderData &&
      !historyQuery.isFetching &&
      page > pageCount
    ) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (pageCount > 1) next.set("historyPage", String(pageCount));
          else next.delete("historyPage");
          return next;
        },
        { replace: true }
      );
    }
  }, [
    history,
    historyQuery.isPlaceholderData,
    historyQuery.isFetching,
    page,
    pageCount,
    setParams
  ]);

  const selected =
    history?.items.find((item) => item.id === requestedId) ??
    (!requestedId ? history?.items[0] : undefined);
  function choose(id: string) {
    pendingFocus.current = true;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) {
        next.set("historySession", id);
        next.delete("historyList");
      } else {
        next.set("historyList", "1");
        if (selected) next.set("historySession", selected.id);
      }
      return next;
    });
  }
  return (
    <section
      className={`session-history session-history--workspace${showDetail && selected ? " has-selection" : ""}`}
      aria-labelledby="session-history-title"
    >
      <h2 id="session-history-title" className="sr-only">
        История занятий
      </h2>
      <aside className="session-history__master" aria-label="Завершённые занятия">
        {showFilters && (
          <div
            className="session-history-filters"
            role="search"
            aria-label="Поиск в истории занятий"
          >
            <SearchField
              value={query}
              onChange={(value) => changeFilter("historySearch", value.slice(0, 200))}
              placeholder="Название лекции или группа"
            />
            <Select
              value={groupId || "all"}
              onValueChange={(value) => changeFilter("historyGroup", value === "all" ? "" : value)}
            >
              <SelectTrigger aria-label="Группа в истории занятий">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все группы</SelectItem>
                {groupId && !groups.some((group) => group.id === groupId) && (
                  <SelectItem value={groupId}>Группа из ссылки</SelectItem>
                )}
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover open={periodOpen} onOpenChange={setPeriodOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" aria-label="Период в истории занятий">
                  <CalendarDays size={18} aria-hidden="true" />
                  {dateFrom || dateTo ? "Выбран период" : "Все даты"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="history-period" align="start">
                <h3>Период завершения</h3>
                <label className="field">
                  <span>С</span>
                  <Input
                    type="date"
                    aria-label="Дата завершения с"
                    value={dateFrom}
                    max={dateTo || "9999-12-31"}
                    aria-invalid={Boolean(dateError)}
                    onChange={(event) => changeFilter("historyFrom", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>По включительно</span>
                  <Input
                    type="date"
                    aria-label="Дата завершения по"
                    value={dateTo}
                    min={dateFrom || undefined}
                    max="9999-12-31"
                    aria-invalid={Boolean(dateError)}
                    onChange={(event) => changeFilter("historyTo", event.target.value)}
                  />
                </label>
                {dateError && (
                  <p className="form-error" role="alert">
                    {dateError}
                  </p>
                )}
                <Button variant="outline" onClick={() => setPeriodOpen(false)}>
                  Готово
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        )}
        <div className="session-history-results-heading">
          <p className="muted" role="status">
            {dateError
              ? "Исправьте период для поиска."
              : busy
                ? "Поиск занятий…"
                : historyQuery.isError
                  ? "История недоступна"
                  : `${history?.total ?? 0} ${pluralizeRu(history?.total ?? 0, "занятие", "занятия", "занятий")}`}
          </p>
          {hasFilters && (
            <Button variant="ghost" onClick={clearFilters}>
              Сбросить фильтры
            </Button>
          )}
        </div>
        {dateError && !periodOpen && (
          <p className="form-error" role="alert">
            {dateError}
          </p>
        )}
        <div className="session-history-results" aria-busy={busy}>
          {historyQuery.isError && !dateError && !typing && (
            <div className="analytics-load-error" role="alert">
              <p>Не удалось загрузить историю занятий.</p>
              <Button variant="outline" onClick={() => void historyQuery.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {ready && history && history.items.length === 0 && (
            <div className="session-history-empty">
              <BarChart3 size={24} aria-hidden="true" />
              <div>
                <strong>
                  {hasFilters ? "Занятия не найдены" : "Завершённых занятий пока нет"}
                </strong>
                <p className="muted">
                  {hasFilters
                    ? "Измените запрос, группу или период."
                    : "После занятия здесь появятся сигналы и результаты проверок."}
                </p>
              </div>
            </div>
          )}
          {history && history.items.length > 0 && (
            <>
              <ul className="session-history__list">
                {history.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="session-history__item"
                      aria-current={selected?.id === item.id ? "true" : undefined}
                      disabled={!ready}
                      onClick={() => choose(item.id)}
                    >
                      <span className="session-history__item-title">
                        <strong>{item.lectureTitle}</strong>
                        <span className="muted">
                          {formatSessionDuration(
                            (Date.parse(item.endedAt) - Date.parse(item.startedAt)) / 1000
                          )}
                        </span>
                      </span>
                      <span className="session-history__item-meta">
                        {new Date(item.startedAt).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                        {item.groups.length > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <SessionGroups groups={item.groups} compact />
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <PaginationBar
                page={page}
                pageCount={pageCount}
                pageSize={PAGE_SIZE}
                total={history.total}
                onPageChange={changePage}
              />
            </>
          )}
        </div>
      </aside>
      <div className="session-history__detail">
        {requestedId && (
          <Button
            variant="ghost"
            className="session-history__mobile-back"
            onClick={() => choose("")}
          >
            <ArrowLeft size={18} aria-hidden="true" />К списку занятий
          </Button>
        )}
        {ready && selected ? (
          <CourseSessionPreview key={selected.id} courseId={courseId} sessionId={selected.id} />
        ) : (
          <p className="muted" role="status">
            {busy ? "Поиск занятий…" : "Выберите занятие из списка, чтобы посмотреть итог."}
          </p>
        )}
      </div>
    </section>
  );
}
