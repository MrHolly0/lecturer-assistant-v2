// Match the local calendar dates shown in history, including midnight DST transitions.
export function localDayBoundary(value: string, nextDay = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (
    year < 1 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return undefined;
  if (nextDay) {
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
  }
  return date.toISOString();
}
