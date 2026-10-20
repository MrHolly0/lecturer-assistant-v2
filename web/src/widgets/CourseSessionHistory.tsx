import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarClock } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { listSessionHistory } from "../app/api/live-api";
import { Button, LinkButton } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { localDayBoundary } from "../shared/lib/sessionHistoryDates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { PaginationBar, SearchField } from "./ListControls";
import { SessionGroups } from "./SessionGroups";

const PAGE_SIZE = 20;
const FILTER_KEYS = ["historySearch", "historyGroup", "historyFrom", "historyTo", "historyPage"];

export function CourseSessionHistory({ courseId }: { courseId: string }) {
  const [params, setParams] = useSearchParams();
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
        return next;
      },
      { replace: true }
    );
  }
  function changePage(value: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
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

  return (
    <section className="session-history" aria-labelledby="session-history-title">
      <div className="section-heading session-history__heading">
        <div>
          <h2 id="session-history-title">История занятий</h2>
          {showFilters && (
            <p className="muted">Найдите занятие по лекции, учебной группе или дате завершения.</p>
          )}
        </div>
      </div>
      {showFilters && (
        <div className="session-history-filters" role="search" aria-label="Поиск в истории занятий">
          <div className="field session-history-filters__search">
            <span>Поиск</span>
            <SearchField
              value={query}
              onChange={(value) => changeFilter("historySearch", value.slice(0, 200))}
              placeholder="Название лекции или группа"
            />
          </div>
          <label className="field">
            <span>Учебная группа</span>
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
          </label>
          <label className="field">
            <span>Дата завершения с</span>
            <Input
              type="date"
              aria-label="Дата завершения с"
              value={dateFrom}
              max={dateTo || "9999-12-31"}
              aria-invalid={Boolean(dateError)}
              aria-describedby={dateError ? "history-date-error" : undefined}
              onChange={(event) => changeFilter("historyFrom", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Дата завершения по</span>
            <Input
              type="date"
              aria-label="Дата завершения по"
              value={dateTo}
              min={dateFrom || "0001-01-01"}
              max="9999-12-30"
              aria-invalid={Boolean(dateError)}
              aria-describedby={dateError ? "history-date-error" : undefined}
              onChange={(event) => changeFilter("historyTo", event.target.value)}
            />
          </label>
        </div>
      )}
      {dateError && (
        <p id="history-date-error" className="form-error" role="alert">
          {dateError}
        </p>
      )}
      <div className="session-history-results-heading">
        <p className="muted" role="status">
          {dateError
            ? "Исправьте период для поиска."
            : busy
              ? "Поиск занятий…"
              : historyQuery.isError
                ? "История недоступна"
                : `Найдено занятий: ${history?.total ?? 0}`}
        </p>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Сбросить фильтры
          </Button>
        )}
      </div>
      <div className="session-history-results" aria-busy={busy}>
        {historyQuery.isError && !dateError && !typing && (
          <div className="analytics-load-error" role="alert">
            Не удалось загрузить историю занятий.
            <Button variant="outline" onClick={() => void historyQuery.refetch()}>
              Повторить
            </Button>
          </div>
        )}
        {ready && history && history.items.length === 0 && (
          <div className="session-history-empty">
            <BarChart3 size={24} aria-hidden="true" />
            <div>
              <strong>{hasFilters ? "Занятия не найдены" : "Завершённых занятий пока нет"}</strong>
              <p className="muted">
                {hasFilters
                  ? "Измените запрос, группу или период."
                  : "После занятия здесь появятся сигналы и результаты проверок."}
              </p>
            </div>
          </div>
        )}
        {ready && history && history.items.length > 0 && (
          <>
            <ul className="session-history-list">
              {history.items.map((session) => (
                <li key={session.id} className="session-history-row">
                  <div className="session-history-row__copy">
                    <h3>{session.lectureTitle}</h3>
                    <SessionGroups groups={session.groups} compact />
                    <span className="session-history-row__time">
                      <CalendarClock size={15} aria-hidden="true" />
                      {formatDateTime(session.endedAt ?? session.startedAt)}
                    </span>
                  </div>
                  <span className="badge badge--muted">
                    {session.status === "ARCHIVED" ? "В архиве" : "Завершена"}
                  </span>
                  <LinkButton
                    variant="outline"
                    to={`/courses/${courseId}/sessions/${session.id}/summary`}
                  >
                    Открыть итог
                  </LinkButton>
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
    </section>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
