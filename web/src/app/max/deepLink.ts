const configuredBotName = import.meta.env.VITE_MAX_BOT_NAME?.trim() ?? "";

export function buildMaxJoinUrl(joinCode: string): string | null {
  if (!configuredBotName || !joinCode) return null;
  const botName = configuredBotName
    .replace(/^https?:\/\/max\.ru\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/, 1)[0];
  if (!botName) return null;
  return `https://max.ru/${botName}?startapp=${encodeURIComponent(joinCode)}`;
}
