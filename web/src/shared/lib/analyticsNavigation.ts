export const SUMMARY_TABS = [
  "overview",
  "participants",
  "slides",
  "checks",
  "questions",
  "groups"
] as const;
export type SummaryTab = (typeof SUMMARY_TABS)[number];

export function summaryTab(value: string | null): SummaryTab {
  return SUMMARY_TABS.includes(value as SummaryTab) ? (value as SummaryTab) : "overview";
}

export function formatSessionDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return seconds === 0 ? "0 мин" : seconds < 60 ? "< 1 мин" : `${minutes} мин`;
}

export function courseAnalyticsParams(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  for (const key of [...next.keys()]) if (key.startsWith("summary")) next.delete(key);
  return next;
}

export function formatSessionPeriod(startedAt: string, endedAt?: string | null) {
  const start = new Date(startedAt),
    end = endedAt ? new Date(endedAt) : null;
  if (Number.isNaN(start.getTime())) return "Дата не указана";
  const day = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" });
  const clock = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const first = `${day.format(start)} · ${clock.format(start)}`;
  if (!end || Number.isNaN(end.getTime())) return first;
  return start.toDateString() === end.toDateString()
    ? `${first}–${clock.format(end)}`
    : `${first} — ${day.format(end)} · ${clock.format(end)}`;
}
